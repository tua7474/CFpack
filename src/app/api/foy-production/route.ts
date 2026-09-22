import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

const CREATE = `
  CREATE TABLE IF NOT EXISTS foy_production (
    id           SERIAL PRIMARY KEY,
    product_id   INT,
    product_name VARCHAR(200),
    new_job_qty  DECIMAL(12,2),
    new_job_kg   DECIMAL(12,4),
    new_job_date DATE,
    sessions     JSONB NOT NULL DEFAULT '[]',
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
  )
`

export async function GET() {
  await pool.query(CREATE)
  const { rows } = await pool.query(
    'SELECT * FROM foy_production ORDER BY created_at ASC'
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  await pool.query(CREATE)
  const b = await req.json()
  const { rows } = await pool.query(`
    INSERT INTO foy_production (product_id, product_name, new_job_qty, new_job_kg, new_job_date, sessions)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
  `, [
    b.product_id   ?? null,
    b.product_name ?? null,
    b.new_job_qty  ?? null,
    b.new_job_kg   ?? null,
    b.new_job_date ?? null,
    JSON.stringify(b.sessions ?? []),
  ])
  return NextResponse.json(rows[0], { status: 201 })
}

export async function PATCH(req: NextRequest) {
  await pool.query(CREATE)
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await pool.query(`
    UPDATE foy_production SET
      product_id = $1, product_name = $2,
      new_job_qty = $3, new_job_kg = $4, new_job_date = $5,
      sessions = $6, updated_at = NOW()
    WHERE id = $7
  `, [
    b.product_id   ?? null,
    b.product_name ?? null,
    b.new_job_qty  ?? null,
    b.new_job_kg   ?? null,
    b.new_job_date ?? null,
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
