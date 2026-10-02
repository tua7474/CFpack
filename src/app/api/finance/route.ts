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

export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const period = url.searchParams.get('period') ?? 'month'  // week | month | all

  let dateFilter = ''
  const vals: string[] = []
  if (period === 'week') {
    const r = getWeekRange()
    dateFilter = `AND s.slip_date >= $1 AND s.slip_date <= $2`
    vals.push(r.start, r.end)
  } else if (period === 'month') {
    const r = getMonthRange()
    dateFilter = `AND s.slip_date >= $1 AND s.slip_date <= $2`
    vals.push(r.start, r.end)
  }
  // 'all' → no date filter

  const { rows } = await pool.query(`
    SELECT
      b.id,
      b.name,
      b.color_group,
      COALESCE(SUM(s.amount) FILTER (
        WHERE s.status = 'confirmed' AND s.applied = true  AND s.category != 'vat' ${dateFilter}
      ), 0)::float AS pay_total,
      COALESCE(SUM(s.amount) FILTER (
        WHERE s.status = 'confirmed' AND s.applied = false AND s.category != 'vat' ${dateFilter}
      ), 0)::float AS store_total,
      COALESCE(SUM(s.amount) FILTER (
        WHERE s.status = 'confirmed' AND s.category = 'vat' ${dateFilter}
      ), 0)::float AS vat_total
    FROM branches b
    LEFT JOIN slips s ON s.branch_id = b.id
    GROUP BY b.id, b.name, b.color_group
    ORDER BY b.name
  `, vals)

  return NextResponse.json(rows)
}
