import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Table ─────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS booking_orders (
    id             SERIAL PRIMARY KEY,
    order_no       VARCHAR(14) UNIQUE NOT NULL,
    total_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantities     JSONB        NOT NULL DEFAULT '{}',
    status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
    payment_status VARCHAR(20)  NOT NULL DEFAULT 'unpaid',
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP    NOT NULL DEFAULT NOW()
  )
`

// ── Generate order number (Thai time UTC+7) ────────────────────────────────────
// Format: YYMMDDHHmm (10 digits) — e.g. 2604211023

function genOrderNo(): string {
  const thai = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const yy   = String(thai.getUTCFullYear()).slice(-2)
  const mo   = String(thai.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(thai.getUTCDate()).padStart(2, '0')
  const hh   = String(thai.getUTCHours()).padStart(2, '0')
  const mn   = String(thai.getUTCMinutes()).padStart(2, '0')
  return `${yy}${mo}${dd}${hh}${mn}`
}

// ── GET — list all orders (or single order by ?no=XXXX) ───────────────────────

export async function GET(request: Request) {
  await pool.query(CREATE_TABLE)
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS pickup_status VARCHAR(20) NOT NULL DEFAULT 'pending'`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS payment_date  DATE`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS payment_bank  VARCHAR(100)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS source_type        VARCHAR(50)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS vehicle_type       VARCHAR(50)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS branch_name        VARCHAR(200)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS foy_quantities     JSONB NOT NULL DEFAULT '{}'`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS foy_item_quantities JSONB NOT NULL DEFAULT '{}'`).catch(() => {})
  const { searchParams } = new URL(request.url)
  const no = searchParams.get('no')

  if (no) {
    const { rows } = await pool.query(
      'SELECT * FROM booking_orders WHERE order_no = $1', [no]
    )
    return NextResponse.json(rows[0] ?? null)
  }

  const { rows } = await pool.query(
    'SELECT * FROM booking_orders ORDER BY created_at DESC'
  )
  return NextResponse.json(rows)
}

// ── Deduct stock from products_catalog for each booked quantity ───────────────

async function deductStock(quantities: Record<string, number>) {
  for (const [idStr, qty] of Object.entries(quantities)) {
    if (!qty || qty <= 0) continue
    const id = Number(idStr)
    await pool.query(`
      UPDATE products_catalog
      SET quantity        = COALESCE(quantity, 0) - $1,
          last_booked_qty = $1,
          last_booked_at  = NOW(),
          updated_at      = NOW()
      WHERE id = $2
    `, [qty, id])
    await pool.query(
      `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, 'book', $2)`,
      [id, qty]
    )
  }
}

// ── POST — create new order ───────────────────────────────────────────────────

export async function POST(request: Request) {
  const { total_amount, quantities, branch_id, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id } = await request.json()
  await pool.query(CREATE_TABLE)
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS branch_id INT`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS withdrawal_type_id INT`).catch(() => {})

  let order_no = genOrderNo()

  try {
    const { rows } = await pool.query(
      `INSERT INTO booking_orders (order_no, total_amount, quantities, branch_id, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [order_no, total_amount, JSON.stringify(quantities), branch_id ?? null, source_type ?? null, vehicle_type ?? null, branch_name ?? null,
       JSON.stringify(foy_quantities ?? {}), JSON.stringify(foy_item_quantities ?? {}), withdrawal_type_id ?? null]
    )
    await deductStock(quantities ?? {})
    return NextResponse.json(rows[0], { status: 201 })
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      order_no = order_no + String(new Date().getUTCSeconds()).padStart(2, '0')
      const { rows } = await pool.query(
        `INSERT INTO booking_orders (order_no, total_amount, quantities, branch_id, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [order_no, total_amount, JSON.stringify(quantities), branch_id ?? null, source_type ?? null, vehicle_type ?? null, branch_name ?? null,
         JSON.stringify(foy_quantities ?? {}), JSON.stringify(foy_item_quantities ?? {}), withdrawal_type_id ?? null]
      )
      await deductStock(quantities ?? {})
      return NextResponse.json(rows[0], { status: 201 })
    }
    throw e
  }
}

// ── Adjust stock delta when editing an order ──────────────────────────────────
// delta > 0 → deduct more, delta < 0 → return to stock

async function adjustStockDelta(
  oldQty: Record<string, number>,
  newQty: Record<string, number>
) {
  const allIds = new Set([...Object.keys(oldQty), ...Object.keys(newQty)])
  for (const idStr of allIds) {
    const old = oldQty[idStr] ?? 0
    const next = newQty[idStr] ?? 0
    const delta = next - old
    if (delta === 0) continue
    const id = Number(idStr)
    await pool.query(`
      UPDATE products_catalog
      SET quantity        = COALESCE(quantity, 0) - $1,
          last_booked_qty = $2,
          last_booked_at  = NOW(),
          updated_at      = NOW()
      WHERE id = $3
    `, [delta, next, id])
    const action = delta > 0 ? 'book' : 'add'
    await pool.query(
      `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, $2, $3)`,
      [id, action, Math.abs(delta)]
    )
  }
}

// ── PATCH — update order (status / payment / quantities) ─────────────────────

export async function PATCH(request: Request) {
  const { order_no, status, payment_status, payment_date, payment_bank, pickup_status, total_amount, quantities, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id } = await request.json()

  // If quantities are being updated, load old quantities first to compute delta
  let oldQuantities: Record<string, number> = {}
  if (quantities !== undefined) {
    const { rows: old } = await pool.query(
      `SELECT quantities FROM booking_orders WHERE order_no = $1`, [order_no]
    )
    if (old.length > 0) oldQuantities = old[0].quantities ?? {}
  }

  const sets: string[] = ['updated_at = NOW()']
  const vals: unknown[] = []
  let i = 1

  if (status         !== undefined) { sets.push(`status = $${i++}`);         vals.push(status) }
  if (payment_status !== undefined) { sets.push(`payment_status = $${i++}`); vals.push(payment_status) }
  if (payment_date   !== undefined) { sets.push(`payment_date = $${i++}`);   vals.push(payment_date) }
  if (payment_bank   !== undefined) { sets.push(`payment_bank = $${i++}`);   vals.push(payment_bank) }
  if (pickup_status  !== undefined) { sets.push(`pickup_status = $${i++}`);  vals.push(pickup_status) }
  if (total_amount   !== undefined) { sets.push(`total_amount = $${i++}`);   vals.push(total_amount) }
  if (quantities     !== undefined) { sets.push(`quantities = $${i++}`);     vals.push(JSON.stringify(quantities)) }
  if (source_type         !== undefined) { sets.push(`source_type = $${i++}`);          vals.push(source_type) }
  if (vehicle_type        !== undefined) { sets.push(`vehicle_type = $${i++}`);         vals.push(vehicle_type) }
  if (branch_name         !== undefined) { sets.push(`branch_name = $${i++}`);          vals.push(branch_name) }
  if (foy_quantities      !== undefined) { sets.push(`foy_quantities = $${i++}`);       vals.push(JSON.stringify(foy_quantities)) }
  if (foy_item_quantities !== undefined) { sets.push(`foy_item_quantities = $${i++}`);  vals.push(JSON.stringify(foy_item_quantities)) }
  if (withdrawal_type_id  !== undefined) { sets.push(`withdrawal_type_id = $${i++}`);   vals.push(withdrawal_type_id) }

  vals.push(order_no)
  const { rows } = await pool.query(
    `UPDATE booking_orders SET ${sets.join(', ')} WHERE order_no = $${i} RETURNING *`,
    vals
  )

  if (quantities !== undefined) {
    await adjustStockDelta(oldQuantities, quantities)
  }

  return NextResponse.json(rows[0])
}
