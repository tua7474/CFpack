import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

const CREATE = `
  CREATE TABLE IF NOT EXISTS foy_production (
    id           SERIAL PRIMARY KEY,
    product_id   INT,
    product_name VARCHAR(200),
    color_name   VARCHAR(200),
    new_job_qty  DECIMAL(12,2),
    new_job_kg   DECIMAL(12,4),
    new_job_date DATE,
    sessions     JSONB NOT NULL DEFAULT '[]',
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
  )
`

async function ensureSchema() {
  await pool.query(CREATE)
  await pool.query(`ALTER TABLE foy_production ADD COLUMN IF NOT EXISTS color_name VARCHAR(200)`).catch(() => {})
  await pool.query(`ALTER TABLE foy_production ADD COLUMN IF NOT EXISTS synced_kg DECIMAL(12,4) NOT NULL DEFAULT 0`).catch(() => {})
}

// Field mapping (DB → frontend):
//   product_name → model_name
//   color_name   → color_name
//   product_id   → product_id  (catalog product id for the color)
//   new_job_kg   → raw_kg
//   new_job_date → raw_date
//   sessions     → sessions  [{ kg, cut_type, date }]
//   synced_kg    → synced_kg (total kg already pushed to paper_stock)

function sessionsTotal(sessions: { kg?: number }[]): number {
  return sessions.reduce((s, sess) => s + (Number(sess?.kg) || 0), 0)
}

async function syncStockAdd(colorName: string, deltaKg: number) {
  const { rows } = await pool.query(
    `UPDATE paper_stock
     SET stock_qty      = stock_qty + $1,
         last_added_qty = $1,
         last_added_at  = NOW()
     WHERE color_name = $2
     RETURNING id, model_name`,
    [deltaKg, colorName]
  )
  if (rows.length === 0) return
  await pool.query(
    `INSERT INTO paper_stock_log (paper_stock_id, action, qty) VALUES ($1, 'foy_add', $2)`,
    [rows[0].id, deltaKg]
  )
  // Sync total to catalog
  const { rows: tot } = await pool.query(
    `SELECT COALESCE(SUM(stock_qty), 0) AS total FROM paper_stock WHERE model_name = $1`,
    [rows[0].model_name]
  )
  await pool.query(
    `UPDATE products_catalog SET quantity = $1, updated_at = NOW()
     WHERE group_name = 'กระดาษฝอย' AND product_name = $2`,
    [tot[0].total, rows[0].model_name]
  )
}

export async function GET() {
  await ensureSchema()
  const { rows } = await pool.query(`
    SELECT id,
           product_id,
           product_name AS model_name,
           color_name,
           new_job_kg::float   AS raw_kg,
           new_job_date::text  AS raw_date,
           sessions,
           synced_kg::float    AS synced_kg,
           created_at, updated_at
    FROM foy_production ORDER BY created_at ASC
  `)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const b = await req.json()
  const { rows } = await pool.query(`
    INSERT INTO foy_production
      (product_id, product_name, color_name, new_job_kg, new_job_date, sessions)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
  `, [
    b.product_id  ?? null,
    b.model_name  ?? null,
    b.color_name  ?? null,
    b.raw_kg      ?? null,
    b.raw_date    ?? null,
    JSON.stringify(b.sessions ?? []),
  ])
  return NextResponse.json(rows[0], { status: 201 })
}

export async function PATCH(req: NextRequest) {
  await ensureSchema()
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Read current synced_kg before update
  const { rows: cur } = await pool.query(
    `SELECT synced_kg::float AS synced_kg FROM foy_production WHERE id = $1`,
    [b.id]
  )
  const syncedKg = cur[0]?.synced_kg ?? 0

  // Compute new sessions total
  const newSessions: { kg?: number }[] = b.sessions ?? []
  const newTotal = sessionsTotal(newSessions)
  const delta = newTotal - syncedKg

  // Update row
  await pool.query(`
    UPDATE foy_production SET
      product_id   = $1,
      product_name = $2,
      color_name   = $3,
      new_job_kg   = $4,
      new_job_date = $5,
      sessions     = $6,
      updated_at   = NOW()
    WHERE id = $7
  `, [
    b.product_id  ?? null,
    b.model_name  ?? null,
    b.color_name  ?? null,
    b.raw_kg      ?? null,
    b.raw_date    ?? null,
    JSON.stringify(newSessions),
    b.id,
  ])

  // Sync to stock if total increased and we have a color
  if (delta > 0 && b.color_name) {
    await syncStockAdd(b.color_name, delta)
    await pool.query(
      `UPDATE foy_production SET synced_kg = $1 WHERE id = $2`,
      [newTotal, b.id]
    )
  }

  return NextResponse.json({ ok: true, synced_kg: delta > 0 ? newTotal : syncedKg })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  await pool.query('DELETE FROM foy_production WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
