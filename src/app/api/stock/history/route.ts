import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/stock/history?id=X&type=add|book
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id   = Number(searchParams.get('id'))
    const type = searchParams.get('type') // 'add' or 'book'
    if (!id || !type) return NextResponse.json({ error: 'id and type required' }, { status: 400 })

    const { rows } = await pool.query(
      `SELECT id, qty, created_at, branch_name
       FROM paper_stock_log
       WHERE paper_stock_id = $1 AND action = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [id, type]
    )
    return NextResponse.json(rows)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
