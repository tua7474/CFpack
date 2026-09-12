import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/branches/orders?branch_id=X[&year=Y&month=M]
// Returns orders for a branch, optionally filtered by month
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const branchId = Number(searchParams.get('branch_id'))
    const year     = searchParams.get('year')
    const month    = searchParams.get('month')

    if (!branchId) return NextResponse.json({ error: 'branch_id required' }, { status: 400 })

    let query = `
      SELECT id, order_no, total_amount, status, payment_status, created_at, updated_at
      FROM booking_orders
      WHERE branch_id = $1
    `
    const vals: unknown[] = [branchId]

    if (year && month) {
      query += ` AND EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Bangkok') = $2
                 AND EXTRACT(MONTH FROM created_at AT TIME ZONE 'Asia/Bangkok') = $3`
      vals.push(year, month)
    } else if (searchParams.get('date_from') && searchParams.get('date_to')) {
      query += ` AND (created_at AT TIME ZONE 'Asia/Bangkok')::date >= $2
                 AND (created_at AT TIME ZONE 'Asia/Bangkok')::date <= $3`
      vals.push(searchParams.get('date_from'), searchParams.get('date_to'))
    }

    query += ` ORDER BY created_at DESC`

    const { rows } = await pool.query(query, vals)
    return NextResponse.json(rows)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH { branch_id, order_ids[], action: 'pay'|'reset' }
export async function PATCH(req: NextRequest) {
  try {
    const { branch_id, order_ids, action } = await req.json()
    if (!branch_id || !order_ids?.length || !['pay','reset'].includes(action))
      return NextResponse.json({ error: 'invalid request' }, { status: 400 })

    if (action === 'pay') {
      await pool.query(
        `UPDATE booking_orders
         SET payment_status='paid', updated_at=NOW()
         WHERE id=ANY($1) AND branch_id=$2`,
        [order_ids, branch_id]
      )
    } else {
      await pool.query(
        `UPDATE booking_orders
         SET payment_status='pending', updated_at=NOW()
         WHERE id=ANY($1) AND branch_id=$2`,
        [order_ids, branch_id]
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
