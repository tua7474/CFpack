import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_stock (
      id         SERIAL PRIMARY KEY,
      branch_id  INT            NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      product_id INT            NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
      quantity   NUMERIC(12,2)  NOT NULL DEFAULT 0,
      updated_at TIMESTAMP      NOT NULL DEFAULT NOW(),
      UNIQUE (branch_id, product_id)
    )
  `)
}

// GET — return products, branches (with color_group), and all stock entries
export async function GET() {
  await ensureTable()
  const [prodRows, branchRows, stockRows] = await Promise.all([
    pool.query(`SELECT id, group_name, product_name, sort_order FROM products_catalog ORDER BY group_name, sort_order, id`),
    pool.query(`SELECT id, name, color_group FROM branches ORDER BY name`),
    pool.query(`SELECT branch_id, product_id, quantity::float AS quantity FROM branch_stock`),
  ])
  return NextResponse.json({
    products: prodRows.rows,
    branches: branchRows.rows,
    stock:    stockRows.rows,
  })
}

// PATCH — upsert one cell
export async function PATCH(req: NextRequest) {
  try {
    await ensureTable()
    const { branch_id, product_id, quantity } = await req.json()
    await pool.query(`
      INSERT INTO branch_stock (branch_id, product_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET quantity = $3, updated_at = NOW()
    `, [branch_id, product_id, quantity ?? 0])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
