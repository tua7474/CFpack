import { NextResponse } from 'next/server'
import pool from '@/lib/db'

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS po_orders (
    id           SERIAL PRIMARY KEY,
    po_no        VARCHAR(20) UNIQUE NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    supplier     VARCHAR(200),
    notes        TEXT,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantities   JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    received_at  TIMESTAMP
  )
`

async function ensureTable() {
  await pool.query(CREATE_TABLE)
}

async function genPoNo(): Promise<string> {
  const thai = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const yy   = String(thai.getUTCFullYear()).slice(-2)
  const mo   = String(thai.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(thai.getUTCDate()).padStart(2, '0')
  const prefix = `PO${yy}${mo}${dd}`
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM po_orders WHERE po_no LIKE $1`,
    [`${prefix}%`]
  )
  const seq = (parseInt(rows[0].count) + 1).toString().padStart(3, '0')
  return `${prefix}-${seq}`
}

export async function GET() {
  await ensureTable()
  const { rows } = await pool.query(
    `SELECT * FROM po_orders ORDER BY created_at DESC`
  )
  // Resolve product names for each PO
  const productIds = new Set<number>()
  for (const row of rows) {
    for (const id of Object.keys(row.quantities ?? {})) {
      productIds.add(Number(id))
    }
  }
  let productMap: Record<number, { product_name: string; group_name: string; price: string | null }> = {}
  if (productIds.size > 0) {
    const { rows: prods } = await pool.query(
      `SELECT id, product_name, group_name, price FROM products_catalog WHERE id = ANY($1)`,
      [Array.from(productIds)]
    )
    productMap = Object.fromEntries(prods.map(p => [p.id, p]))
  }

  const result = rows.map(row => ({
    ...row,
    items: Object.entries(row.quantities ?? {}).map(([pid, qty]) => {
      const p = productMap[Number(pid)]
      return {
        product_id:   Number(pid),
        product_name: p?.product_name ?? `#${pid}`,
        group_name:   p?.group_name ?? '',
        qty:          qty as number,
        price:        p?.price ? parseFloat(p.price) : 0,
      }
    }),
  }))

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  await ensureTable()
  const { supplier, notes, total_amount, quantities } = await request.json()
  const po_no = await genPoNo()
  const { rows } = await pool.query(
    `INSERT INTO po_orders (po_no, supplier, notes, total_amount, quantities)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [po_no, supplier ?? null, notes ?? null, total_amount ?? 0, JSON.stringify(quantities ?? {})]
  )
  return NextResponse.json(rows[0], { status: 201 })
}

export async function PATCH(request: Request) {
  await ensureTable()
  const { id, status, supplier, notes, total_amount, quantities } = await request.json()

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (status       !== undefined) { sets.push(`status = $${i++}`);       vals.push(status) }
  if (supplier     !== undefined) { sets.push(`supplier = $${i++}`);     vals.push(supplier) }
  if (notes        !== undefined) { sets.push(`notes = $${i++}`);        vals.push(notes) }
  if (total_amount !== undefined) { sets.push(`total_amount = $${i++}`); vals.push(total_amount) }
  if (quantities   !== undefined) { sets.push(`quantities = $${i++}`);   vals.push(JSON.stringify(quantities)) }

  if (status === 'received') {
    sets.push(`received_at = NOW()`)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  vals.push(id)
  const { rows } = await pool.query(
    `UPDATE po_orders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  )

  // If marking received, add stock
  if (status === 'received' && rows[0]) {
    const qty: Record<string, number> = quantities ?? rows[0].quantities ?? {}
    for (const [idStr, q] of Object.entries(qty)) {
      if (!q || (q as number) <= 0) continue
      await pool.query(
        `UPDATE products_catalog SET quantity = COALESCE(quantity, 0) + $1 WHERE id = $2`,
        [q, Number(idStr)]
      )
      await pool.query(
        `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, 'po_receive', $2)`,
        [Number(idStr), q]
      )
    }
  }

  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request) {
  await ensureTable()
  const { id } = await request.json()
  await pool.query(`DELETE FROM po_orders WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
