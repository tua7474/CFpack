import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Ensure tables ─────────────────────────────────────────────────────────────

export async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS color_group VARCHAR(20)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_phones (
      id           SERIAL PRIMARY KEY,
      branch_id    INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      phone        VARCHAR(20) NOT NULL,
      is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
      line_user_id VARCHAR(100),
      UNIQUE(phone)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_otps (
      id         SERIAL PRIMARY KEY,
      phone      VARCHAR(20) NOT NULL,
      code       VARCHAR(6)  NOT NULL,
      expires_at TIMESTAMP   NOT NULL,
      used       BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP   NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id)
  `)
  // Seed initial branch
  await pool.query(`
    INSERT INTO branches (id, name) VALUES (1, 'CFpack สาย4')
    ON CONFLICT (id) DO NOTHING
  `)
  await pool.query(`
    INSERT INTO branch_phones (branch_id, phone, is_admin) VALUES (1, '0942399974', true)
    ON CONFLICT (phone) DO NOTHING
  `)
}

// ── GET — list all branches with phone numbers + pending count ────────────────

export async function GET() {
  try {
    await ensureTables()
    const { rows: branches } = await pool.query(`SELECT id, name, color_group, created_at FROM branches ORDER BY name`)
    const { rows: phones }   = await pool.query(`SELECT id, branch_id, phone, is_admin, line_user_id FROM branch_phones ORDER BY branch_id, id`)
    const { rows: counts }   = await pool.query(`
      SELECT branch_id, COUNT(*)::int AS pending_count
      FROM booking_orders
      WHERE branch_id IS NOT NULL AND payment_status != 'paid'
      GROUP BY branch_id
    `)
    const countMap = Object.fromEntries(counts.map(r => [r.branch_id, r.pending_count]))

    const result = branches.map(b => ({
      ...b,
      phones: phones.filter(p => p.branch_id === b.id),
      pending_count: countMap[b.id] ?? 0,
    }))
    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── POST — create branch ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await ensureTables()
    const { name, color_group } = await req.json()
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { rows } = await pool.query(
      `INSERT INTO branches (name, color_group) VALUES ($1, $2) RETURNING *`,
      [name, color_group ?? null]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── PATCH — update branch name / add phone / remove phone ─────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()

    // Add phone to branch
    if (body.action === 'add_phone') {
      const { branch_id, phone, is_admin } = body
      const { rows } = await pool.query(
        `INSERT INTO branch_phones (branch_id, phone, is_admin)
         VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE SET branch_id=$1, is_admin=$3
         RETURNING *`,
        [branch_id, phone, is_admin ?? false]
      )
      return NextResponse.json(rows[0])
    }

    // Remove phone
    if (body.action === 'remove_phone') {
      await pool.query(`DELETE FROM branch_phones WHERE id=$1`, [body.phone_id])
      return NextResponse.json({ ok: true })
    }

    // Update branch name
    const { id, name } = body
    await pool.query(`UPDATE branches SET name=$1 WHERE id=$2`, [name, id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── DELETE — delete branch ────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    await pool.query(`DELETE FROM booking_orders WHERE branch_id=$1`, [id])
    await pool.query(`DELETE FROM branches WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
