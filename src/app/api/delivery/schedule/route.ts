import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_schedule (
      id          SERIAL PRIMARY KEY,
      week_start  DATE        NOT NULL,
      day_of_week SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
      round       VARCHAR(10) NOT NULL CHECK (round IN ('เช้า', 'บ่าย')),
      branch_id   INT         NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      sort_order  INT         NOT NULL DEFAULT 0,
      created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
      UNIQUE (week_start, day_of_week, round, branch_id)
    )
  `)
  // Widen existing constraint to include Sunday (day 7)
  await pool.query(`ALTER TABLE delivery_schedule DROP CONSTRAINT IF EXISTS delivery_schedule_day_of_week_check`).catch(() => {})
  await pool.query(`ALTER TABLE delivery_schedule ADD CONSTRAINT delivery_schedule_day_of_week_check CHECK (day_of_week BETWEEN 1 AND 7)`).catch(() => {})
}

// GET /api/delivery/schedule?week=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const week = req.nextUrl.searchParams.get('week')
  if (!week) return NextResponse.json({ error: 'week required' }, { status: 400 })
  await ensureTable()
  const { rows } = await pool.query(`
    SELECT ds.id, ds.week_start::text, ds.day_of_week, ds.round, ds.branch_id, b.name AS branch_name
    FROM delivery_schedule ds
    JOIN branches b ON b.id = ds.branch_id
    WHERE ds.week_start = $1
    ORDER BY ds.day_of_week, ds.round, ds.sort_order, ds.id
  `, [week])
  return NextResponse.json(rows)
}

// POST — add a branch to a slot
export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const { week_start, day_of_week, round, branch_id } = await req.json()
    const { rows } = await pool.query(`
      INSERT INTO delivery_schedule (week_start, day_of_week, round, branch_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [week_start, day_of_week, round, branch_id])
    if (rows.length === 0) return NextResponse.json({ error: 'already exists' }, { status: 409 })
    // Return with branch_name
    const { rows: full } = await pool.query(`
      SELECT ds.id, ds.week_start::text, ds.day_of_week, ds.round, ds.branch_id, b.name AS branch_name
      FROM delivery_schedule ds JOIN branches b ON b.id = ds.branch_id
      WHERE ds.id = $1
    `, [rows[0].id])
    return NextResponse.json(full[0], { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE — remove a slot entry by id
export async function DELETE(req: NextRequest) {
  try {
    await ensureTable()
    const { id } = await req.json()
    await pool.query(`DELETE FROM delivery_schedule WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
