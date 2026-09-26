import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/branches/orders/unpaid[?date_from=X&date_to=Y]
// Default: unpaid orders only (no date filter)
// With date range: all orders (paid+unpaid) in that period
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dateFrom = searchParams.get('date_from')
    const dateTo   = searchParams.get('date_to')

    // Ensure withdrawal_types table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_types (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Ensure columns exist on booking_orders
    await pool.query(
      `ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS withdrawal_type_id INT REFERENCES withdrawal_types(id)`
    ).catch(() => {})
    await pool.query(
      `ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0`
    ).catch(() => {})

    const [{ rows: types }, { rows: orders }] = await Promise.all([
      pool.query(`SELECT id, name FROM withdrawal_types ORDER BY id`),
      dateFrom && dateTo
        ? pool.query(`
            SELECT id, order_no, total_amount::text, payment_status, branch_id, withdrawal_type_id
            FROM booking_orders
            WHERE branch_id IS NOT NULL AND withdrawal_type_id IS NOT NULL
              AND (created_at AT TIME ZONE 'Asia/Bangkok')::date >= $1
              AND (created_at AT TIME ZONE 'Asia/Bangkok')::date <= $2
            ORDER BY created_at DESC
          `, [dateFrom, dateTo])
        : pool.query(`
            SELECT id, order_no, total_amount::text, payment_status, branch_id, withdrawal_type_id
            FROM booking_orders
            WHERE payment_status != 'paid'
              AND branch_id IS NOT NULL AND withdrawal_type_id IS NOT NULL
            ORDER BY created_at DESC
          `),
    ])

    // Group: branch_id → withdrawal_type_id → orders[]
    const byBranch: Record<number, Record<number, { id: number; order_no: string; total_amount: string; payment_status?: string }[]>> = {}
    for (const o of orders) {
      if (!byBranch[o.branch_id]) byBranch[o.branch_id] = {}
      if (!byBranch[o.branch_id][o.withdrawal_type_id]) byBranch[o.branch_id][o.withdrawal_type_id] = []
      byBranch[o.branch_id][o.withdrawal_type_id].push({
        id: o.id,
        order_no: o.order_no,
        total_amount: o.total_amount,
        payment_status: o.payment_status,
      })
    }

    return NextResponse.json({ types, byBranch })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
