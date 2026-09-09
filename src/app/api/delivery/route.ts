import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

const SEED = ['รถCF01', 'รถCF02', 'ขนส่งพัสดุ', 'Grab-Bolt', 'สาขารับเอง']

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_methods (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  // Seed initial 5 methods if table is empty
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM delivery_methods`)
  if (rows[0].cnt === 0) {
    for (const name of SEED) {
      await pool.query(`INSERT INTO delivery_methods (name) VALUES ($1)`, [name])
    }
  }
}

export async function GET() {
  try {
    await ensureTable()
    const { rows } = await pool.query(`SELECT id, name, created_at FROM delivery_methods ORDER BY id`)
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const { name } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { rows } = await pool.query(
      `INSERT INTO delivery_methods (name) VALUES ($1) RETURNING *`,
      [name.trim()]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, name } = await req.json()
    if (!id || !name?.trim()) return NextResponse.json({ error: 'id and name required' }, { status: 400 })
    await pool.query(`UPDATE delivery_methods SET name=$1 WHERE id=$2`, [name.trim(), id])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    await pool.query(`DELETE FROM delivery_methods WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
