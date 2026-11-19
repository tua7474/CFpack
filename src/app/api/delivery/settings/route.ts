import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

async function ensureTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL)`
  ).catch(() => {})
}

// GET — return driver LINE IDs
export async function GET() {
  try {
    await ensureTable()
    const { rows } = await pool.query(`
      SELECT key, value FROM system_settings
      WHERE key IN ('driver_line_id_truck_1','driver_line_id_truck_2')
    `)
    const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]))
    return NextResponse.json({
      driver_cf01: map['driver_line_id_truck_1'] ?? '',
      driver_cf02: map['driver_line_id_truck_2'] ?? '',
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH — update a driver LINE ID
export async function PATCH(req: NextRequest) {
  try {
    await ensureTable()
    const { key, value } = await req.json()
    const allowed = ['driver_line_id_truck_1', 'driver_line_id_truck_2']
    if (!allowed.includes(key))
      return NextResponse.json({ error: 'invalid key' }, { status: 400 })
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [key, String(value ?? '').trim()]
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
