import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

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
      branch_id  INT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
      fee        DECIMAL(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

export interface SlipEntry { date: string; amount: number }
export interface BranchFinanceRow {
  id: number; name: string; color_group: string | null
  pay:   SlipEntry[]
  store: SlipEntry[]
  vat:   SlipEntry[]
  fee:   SlipEntry[]
  order_total: number; order_paid: number; order_pending: number
}

export async function GET(req: NextRequest) {
  await ensureFeeTable()
  const url    = new URL(req.url)
  const period = url.searchParams.get('period') ?? 'month'

  let dateFilter  = ''
  let orderFilter = ''
  const slipVals: string[] = []
  const ordVals:  string[] = []

  if (period === 'week') {
    const r = getWeekRange()
    dateFilter  = `AND s.slip_date >= $1 AND s.slip_date <= $2`
    orderFilter = `AND o.created_at AT TIME ZONE 'Asia/Bangkok' >= $1 AND o.created_at AT TIME ZONE 'Asia/Bangkok' < ($2::date + interval '1 day')`
    slipVals.push(r.start, r.end)
    ordVals.push(r.start, r.end)
  } else if (period === 'month') {
    const r = getMonthRange()
    dateFilter  = `AND s.slip_date >= $1 AND s.slip_date <= $2`
    orderFilter = `AND o.created_at AT TIME ZONE 'Asia/Bangkok' >= $1 AND o.created_at AT TIME ZONE 'Asia/Bangkok' < ($2::date + interval '1 day')`
    slipVals.push(r.start, r.end)
    ordVals.push(r.start, r.end)
  }

  // All branches
  const { rows: branches } = await pool.query(
    `SELECT id, name, color_group FROM branches ORDER BY name`
  )

  // Individual confirmed slips per branch — always return all (frontend groups by week)
  const { rows: slipRows } = await pool.query(`
    SELECT s.branch_id, s.category, s.applied,
           s.amount::float, s.slip_date::text
    FROM slips s
    WHERE s.status = 'confirmed' AND s.branch_id IS NOT NULL
    ORDER BY s.branch_id, s.slip_date ASC, s.created_at ASC
  `)

  // Order totals per branch
  const { rows: orderRows } = await pool.query(`
    SELECT
      o.branch_id,
      COALESCE(SUM(o.total_amount), 0)::float AS order_total,
      COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0)::float AS order_paid,
      COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status != 'paid' AND o.status != 'cancelled'), 0)::float AS order_pending
    FROM booking_orders o
    WHERE o.branch_id IS NOT NULL AND o.status != 'cancelled' ${orderFilter}
    GROUP BY o.branch_id
  `, ordVals)

  const orderMap: Record<number, { order_total: number; order_paid: number; order_pending: number }> = {}
  for (const r of orderRows) orderMap[r.branch_id] = r

  // Group slips per branch by type
  const slipMap: Record<number, { pay: SlipEntry[]; store: SlipEntry[]; vat: SlipEntry[]; fee: SlipEntry[] }> = {}
  for (const s of slipRows) {
    if (!slipMap[s.branch_id]) slipMap[s.branch_id] = { pay: [], store: [], vat: [], fee: [] }
    const entry: SlipEntry = { date: s.slip_date, amount: s.amount }
    if (s.category === 'vat') {
      slipMap[s.branch_id].vat.push(entry)
    } else if (s.category === 'fee') {
      slipMap[s.branch_id].fee.push(entry)
    } else if (s.applied) {
      slipMap[s.branch_id].pay.push(entry)
    } else {
      slipMap[s.branch_id].store.push(entry)
    }
  }

  const result: BranchFinanceRow[] = branches.map(b => ({
    id:            b.id,
    name:          b.name,
    color_group:   b.color_group,
    pay:           slipMap[b.id]?.pay   ?? [],
    store:         slipMap[b.id]?.store ?? [],
    vat:           slipMap[b.id]?.vat   ?? [],
    fee:           slipMap[b.id]?.fee   ?? [],
    order_total:   orderMap[b.id]?.order_total   ?? 0,
    order_paid:    orderMap[b.id]?.order_paid     ?? 0,
    order_pending: orderMap[b.id]?.order_pending  ?? 0,
  }))

  return NextResponse.json(result)
}
