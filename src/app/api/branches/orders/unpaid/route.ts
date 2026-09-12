import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/branches/orders/unpaid
// Returns withdrawal types + unpaid orders grouped by branch_id → type_id
export async function GET() {
  try {
    // Ensure withdrawal_types table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_types (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Ensure withdrawal_type_id column exists on booking_orders
    await pool.query(
      `ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS withdrawal_type_id INT REFERENCES withdrawal_types(id)`
    ).catch(() => {})

    const [{ rows: types }, { rows: orders }] = await Promise.all([
      pool.query(`SELECT id, name FROM withdrawal_types ORDER BY id`),
      pool.query(`
        SELECT id, order_no, total_amount::text, branch_id, withdrawal_type_id
        FROM booking_orders
        WHERE payment_status != 'paid'
          AND branch_id IS NOT NULL
          AND withdrawal_type_id IS NOT NULL
        ORDER BY created_at DESC
      `),
    ])

    // Group: branch_id → withdrawal_type_id → orders[]
    const byBranch: Record<number, Record<number, { id: number; order_no: string; total_amount: string }[]>> = {}
    for (const o of orders) {
      if (!byBranch[o.branch_id]) byBranch[o.branch_id] = {}
      if (!byBranch[o.branch_id][o.withdrawal_type_id]) byBranch[o.branch_id][o.withdrawal_type_id] = []
      byBranch[o.branch_id][o.withdrawal_type_id].push({
        id: o.id,
        order_no: o.order_no,
        total_amount: o.total_amount,
      })
    }

    return NextResponse.json({ types, byBranch })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
