import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Category config ───────────────────────────────────────────────────────────

export const SLIP_CATEGORIES = ['วรวุฒิ', 'print', 'pack', 'bb', 'กล่อง'] as const
export type SlipCategory = typeof SLIP_CATEGORIES[number]

export const SLIP_LABEL: Record<SlipCategory, string> = {
  'วรวุฒิ': 'สลิปวรวุฒิ',
  'print':  'สลิปPRINT',
  'pack':   'สลิปPACK',
  'bb':     'สลิปBB',
  'กล่อง': 'สลิปกล่อง',
}

// Map ชื่อบัญชีผู้รับ → category
export function categorizeByAccount(name: string): SlipCategory | null {
  const n = name.toLowerCase()
  if (name.includes('วรวุฒิ'))                           return 'วรวุฒิ'
  if (name.includes('พริ้นติ้ง') || n.includes('printing')) return 'print'
  if (name.includes('แพ็ค')     || n.includes('pack'))      return 'pack'
  if (name.includes('ลักกี้')   || n.includes('lucky'))     return 'bb'
  if (name.includes('เจ วี อาร์') || n.includes('jvr'))    return 'กล่อง'
  return null
}

// ── Ensure table ──────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slips (
      id            SERIAL PRIMARY KEY,
      branch_id     INT REFERENCES branches(id) ON DELETE SET NULL,
      category      VARCHAR(20) NOT NULL,
      amount        DECIMAL(12,2) NOT NULL,
      account_name  VARCHAR(200),
      slip_date     DATE NOT NULL,
      status        VARCHAR(20) NOT NULL DEFAULT 'pending',
      line_image_id TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

// ── Date range helpers (Bangkok time) ─────────────────────────────────────────

function todayBkk(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonthRange() {
  const now   = todayBkk()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { start: fmtDate(start), end: fmtDate(end) }
}

function getWeekRange() {
  const now = todayBkk()
  const day = now.getDay() // 0=Sun, 1=Mon...
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: fmtDate(monday), end: fmtDate(sunday) }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await ensureTable()
    const url = new URL(req.url)

    // Return pending slips
    if (url.searchParams.get('pending') === 'true') {
      const { rows } = await pool.query(`
        SELECT id, branch_id, category, amount::float, account_name,
               slip_date::text, status, line_image_id, created_at
        FROM slips WHERE status = 'pending' ORDER BY created_at DESC
      `)
      return NextResponse.json(rows)
    }

    // Return totals for all categories (both month and week pre-computed)
    const month = getMonthRange()
    const week  = getWeekRange()

    const { rows } = await pool.query(`
      SELECT
        category,
        COALESCE(SUM(amount) FILTER (WHERE slip_date >= $1 AND slip_date <= $2), 0)::float AS month_total,
        COALESCE(SUM(amount) FILTER (WHERE slip_date >= $3 AND slip_date <= $4), 0)::float AS week_total
      FROM slips
      WHERE status = 'confirmed'
      GROUP BY category
    `, [month.start, month.end, week.start, week.end])

    const totals: Record<string, { month: number; week: number }> = {}
    for (const r of rows) totals[r.category] = { month: r.month_total, week: r.week_total }

    return NextResponse.json({ totals, month, week })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── POST — create slip ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const { branch_id, category, amount, account_name, slip_date, line_image_id } = await req.json()
    if (!category || !amount || !slip_date) {
      return NextResponse.json({ error: 'category, amount, slip_date required' }, { status: 400 })
    }
    const { rows } = await pool.query(`
      INSERT INTO slips (branch_id, category, amount, account_name, slip_date, line_image_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [branch_id ?? null, category, amount, account_name ?? null, slip_date, line_image_id ?? null])
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── PATCH — confirm / edit (never changes amount) ─────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const { id, slip_date, account_name, category, status } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1
    if (slip_date    !== undefined) { sets.push(`slip_date=$${i++}`);    vals.push(slip_date) }
    if (account_name !== undefined) { sets.push(`account_name=$${i++}`); vals.push(account_name) }
    if (category     !== undefined) { sets.push(`category=$${i++}`);     vals.push(category) }
    if (status       !== undefined) { sets.push(`status=$${i++}`);       vals.push(status) }
    if (!sets.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

    vals.push(id)
    await pool.query(`UPDATE slips SET ${sets.join(', ')} WHERE id=$${i}`, vals)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    await pool.query('DELETE FROM slips WHERE id=$1', [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
