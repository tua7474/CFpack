import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_foy_stock (
      id             SERIAL PRIMARY KEY,
      branch_id      INT            NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      paper_stock_id INT            NOT NULL REFERENCES paper_stock(id) ON DELETE CASCADE,
      quantity       NUMERIC(12,2)  NOT NULL DEFAULT 0,
      updated_at     TIMESTAMP      NOT NULL DEFAULT NOW(),
      UNIQUE (branch_id, paper_stock_id)
    )
  `)
}

// GET — return paper_stock items, branches (with color_group), and all stock entries
export async function GET() {
  await ensureTable()
  const [itemRows, branchRows, stockRows] = await Promise.all([
    pool.query(`SELECT id, category, model_name, color_name FROM paper_stock ORDER BY category, model_name, color_name`),
    pool.query(`SELECT id, name, color_group FROM branches ORDER BY name`),
    pool.query(`SELECT branch_id, paper_stock_id, quantity::float AS quantity FROM branch_foy_stock`),
  ])
  return NextResponse.json({
    items:    itemRows.rows,
    branches: branchRows.rows,
    stock:    stockRows.rows,
  })
}

// PATCH — upsert one cell
export async function PATCH(req: NextRequest) {
  try {
    await ensureTable()
    const { branch_id, paper_stock_id, quantity } = await req.json()
    await pool.query(`
      INSERT INTO branch_foy_stock (branch_id, paper_stock_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (branch_id, paper_stock_id)
      DO UPDATE SET quantity = $3, updated_at = NOW()
    `, [branch_id, paper_stock_id, quantity ?? 0])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
