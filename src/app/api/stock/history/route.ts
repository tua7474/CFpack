import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/stock/history?id=X&type=add|book
export async function GET(req: NextRequest) {
  try {
    await pool.query(`ALTER TABLE paper_stock_log ADD COLUMN IF NOT EXISTS lot_number VARCHAR(20)`).catch(() => {})
    const { searchParams } = new URL(req.url)
    const id   = Number(searchParams.get('id'))
    const type = searchParams.get('type') // 'add' or 'book'
    if (!id || !type) return NextResponse.json({ error: 'id and type required' }, { status: 400 })

    const actionFilter = type === 'add' ? `action IN ('add', 'foy_add')` : `action = $2`
    const queryParams  = type === 'add' ? [id] : [id, type]
    const { rows } = await pool.query(
      `SELECT id, qty, created_at, branch_name, lot_number, action
       FROM paper_stock_log
       WHERE paper_stock_id = $1 AND ${actionFilter}
       ORDER BY created_at DESC
       LIMIT 200`,
      queryParams
    )
    return NextResponse.json(rows)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
