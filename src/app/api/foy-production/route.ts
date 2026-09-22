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
}

// Field mapping (DB → frontend):
//   product_name → model_name
//   color_name   → color_name
//   product_id   → product_id  (catalog product id for the color)
//   new_job_kg   → raw_kg
//   new_job_date → raw_date
//   sessions     → sessions  [{ kg, cut_type, date }]

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
    JSON.stringify(b.sessions ?? []),
    b.id,
  ])
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  await pool.query('DELETE FROM foy_production WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
