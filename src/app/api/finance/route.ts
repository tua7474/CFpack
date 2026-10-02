import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// Bangkok date helpers
function todayBkk(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function getWeekRange() {
  const now = todayBkk()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: fmtDate(monday), end: fmtDate(sunday) }
}
function getMonthRange() {
  const now = todayBkk()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { start: fmtDate(start), end: fmtDate(end) }
}

async function ensureFeeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_finance_fee (
      branch_id INT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
      fee       DECIMAL(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

export async function GET(req: NextRequest) {
  await ensureFeeTable()

  const url    = new URL(req.url)
  const period = url.searchParams.get('period') ?? 'month'  // week | month | all

  // Date range for slips (slip_date) and orders (created_at in Bangkok)
  let slipDateFilter  = ''
  let orderDateFilter = ''
  const slipVals:  string[] = []
  const orderVals: string[] = []

  if (period === 'week') {
    const r = getWeekRange()
    slipDateFilter  = `AND s.slip_date   >= $1 AND s.slip_date   <= $2`
    orderDateFilter = `AND o.created_at AT TIME ZONE 'Asia/Bangkok' >= $1 AND o.created_at AT TIME ZONE 'Asia/Bangkok' <= ($2::date + interval '1 day')`
    slipVals.push(r.start, r.end)
    orderVals.push(r.start, r.end)
  } else if (period === 'month') {
    const r = getMonthRange()
    slipDateFilter  = `AND s.slip_date   >= $1 AND s.slip_date   <= $2`
    orderDateFilter = `AND o.created_at AT TIME ZONE 'Asia/Bangkok' >= $1 AND o.created_at AT TIME ZONE 'Asia/Bangkok' <= ($2::date + interval '1 day')`
    slipVals.push(r.start, r.end)
    orderVals.push(r.start, r.end)
  }

  // Slips per branch
  const { rows: slipRows } = await pool.query(`
    SELECT
      b.id,
      b.name,
      b.color_group,
      COALESCE(SUM(s.amount) FILTER (
        WHERE s.status = 'confirmed' AND s.applied = true  AND s.category != 'vat' ${slipDateFilter}
      ), 0)::float AS pay_total,
      COALESCE(SUM(s.amount) FILTER (
        WHERE s.status = 'confirmed' AND s.applied = false AND s.category != 'vat' ${slipDateFilter}
      ), 0)::float AS store_total,
      COALESCE(SUM(s.amount) FILTER (
        WHERE s.status = 'confirmed' AND s.category = 'vat' ${slipDateFilter}
      ), 0)::float AS vat_total
    FROM branches b
    LEFT JOIN slips s ON s.branch_id = b.id
    GROUP BY b.id, b.name, b.color_group
    ORDER BY b.name
  `, slipVals)

  // Order totals per branch
  const { rows: orderRows } = await pool.query(`
    SELECT
      o.branch_id,
      COALESCE(SUM(o.total_amount), 0)::float AS order_total,
      COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0)::float AS order_paid,
      COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status != 'paid' AND o.status != 'cancelled'), 0)::float AS order_pending
    FROM booking_orders o
    WHERE o.branch_id IS NOT NULL AND o.status != 'cancelled' ${orderDateFilter}
    GROUP BY o.branch_id
  `, orderVals)

  // Fee per branch
  const { rows: feeRows } = await pool.query(`SELECT branch_id, fee::float FROM branch_finance_fee`)

  const orderMap: Record<number, { order_total: number; order_paid: number; order_pending: number }> = {}
  for (const r of orderRows) orderMap[r.branch_id] = r

  const feeMap: Record<number, number> = {}
  for (const r of feeRows) feeMap[r.branch_id] = r.fee

  const result = slipRows.map(b => ({
    ...b,
    order_total:   orderMap[b.id]?.order_total   ?? 0,
    order_paid:    orderMap[b.id]?.order_paid     ?? 0,
    order_pending: orderMap[b.id]?.order_pending  ?? 0,
    fee:           feeMap[b.id] ?? 0,
  }))

  return NextResponse.json(result)
}

// PATCH — save fee for a branch
export async function PATCH(req: NextRequest) {
  await ensureFeeTable()
  const { branch_id, fee } = await req.json()
  if (!branch_id) return NextResponse.json({ error: 'branch_id required' }, { status: 400 })
  await pool.query(`
    INSERT INTO branch_finance_fee (branch_id, fee, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (branch_id) DO UPDATE SET fee = $2, updated_at = NOW()
  `, [branch_id, fee ?? 0])
  return NextResponse.json({ ok: true })
}
