import { NextResponse } from 'next/server'
import pool from '@/lib/db'

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS suppliers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    phone      VARCHAR(50),
    address    TEXT,
    notes      TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`

async function ensureTable() {
  await pool.query(CREATE_TABLE)
}

export async function GET() {
  await ensureTable()
  const { rows } = await pool.query(`
    SELECT
      s.*,
      COALESCE(po.week_total,  0)::float AS week_total,
      COALESCE(po.month_total, 0)::float AS month_total
    FROM suppliers s
    LEFT JOIN (
      SELECT
        supplier,
        SUM(total_amount) FILTER (
          WHERE created_at AT TIME ZONE 'Asia/Bangkok' >=
                date_trunc('week', (NOW() AT TIME ZONE 'Asia/Bangkok') + INTERVAL '1 day') - INTERVAL '1 day'
        )::float AS week_total,
        SUM(total_amount) FILTER (
          WHERE created_at AT TIME ZONE 'Asia/Bangkok' >=
                date_trunc('month', NOW() AT TIME ZONE 'Asia/Bangkok')
        )::float AS month_total
      FROM po_orders
      WHERE supplier IS NOT NULL AND status != 'cancelled'
      GROUP BY supplier
    ) po ON po.supplier = s.name
    ORDER BY s.name
  `)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  await ensureTable()
  const { name, phone, address, notes } = await request.json()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, phone, address, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, phone ?? null, address ?? null, notes ?? null]
  )
  return NextResponse.json(rows[0], { status: 201 })
}

export async function PATCH(request: Request) {
  await ensureTable()
  const { id, name, phone, address, notes } = await request.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  if (name    !== undefined) { sets.push(`name = $${i++}`);    vals.push(name) }
  if (phone   !== undefined) { sets.push(`phone = $${i++}`);   vals.push(phone) }
  if (address !== undefined) { sets.push(`address = $${i++}`); vals.push(address) }
  if (notes   !== undefined) { sets.push(`notes = $${i++}`);   vals.push(notes) }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  vals.push(id)
  const { rows } = await pool.query(
    `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
  )
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request) {
  await ensureTable()
  const { id } = await request.json()
  await pool.query(`DELETE FROM suppliers WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
