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

    if (type === 'add') {
      const { rows } = await pool.query(
        `SELECT id, qty, created_at, branch_name, lot_number, action
         FROM paper_stock_log
         WHERE paper_stock_id = $1 AND action IN ('add', 'foy_add')
         ORDER BY created_at DESC
         LIMIT 200`,
        [id]
      )
      return NextResponse.json(rows)
    }

    // type === 'book': annotate each booking with the active lot at that time
    // active lot = most recent foy_add before the booking's created_at
    const { rows: bookRows } = await pool.query(
      `SELECT id, qty, created_at, branch_name, action
       FROM paper_stock_log
       WHERE paper_stock_id = $1 AND action = 'book'
       ORDER BY created_at DESC
       LIMIT 200`,
      [id]
    )
    const { rows: lotRows } = await pool.query(
      `SELECT lot_number, created_at
       FROM paper_stock_log
       WHERE paper_stock_id = $1 AND action = 'foy_add' AND lot_number IS NOT NULL
       ORDER BY created_at ASC`,
      [id]
    )

    // For each booking, find the active lot (last foy_add before or at booking time)
    const annotated = bookRows.map(row => {
      const bookTime = new Date(row.created_at).getTime()
      let activeLot: string | null = null
      for (const lot of lotRows) {
        if (new Date(lot.created_at).getTime() <= bookTime) {
          activeLot = lot.lot_number
        } else {
          break
        }
      }
      return { ...row, active_lot: activeLot }
    })

    return NextResponse.json(annotated)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
