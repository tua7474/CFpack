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

    // ดึง foy_add entries เสมอ (ใช้เป็น timeline markers ทั้งสองหน้า)
    const { rows: lotMarkers } = await pool.query(
      `SELECT id, qty::text AS qty, created_at, lot_number, 'foy_add' AS action
       FROM paper_stock_log
       WHERE paper_stock_id = $1 AND action = 'foy_add'
       ORDER BY created_at ASC`,
      [id]
    )

    if (type === 'add') {
      // ประวัติเพิ่มสต็อค: รวม 'add' + 'foy_add' เรียงตาม date DESC
      // foy_add = is_lot_marker ด้วย
      const { rows: addRows } = await pool.query(
        `SELECT id, qty::text AS qty, created_at, branch_name, lot_number, action
         FROM paper_stock_log
         WHERE paper_stock_id = $1 AND action IN ('add', 'foy_add')
         ORDER BY created_at DESC
         LIMIT 200`,
        [id]
      )
      const result = addRows.map(r => ({
        ...r,
        active_lot: null,
        is_lot_marker: r.action === 'foy_add',
      }))
      return NextResponse.json(result)
    }

    // type === 'book'
    const { rows: bookRows } = await pool.query(
      `SELECT id, qty::text AS qty, created_at, branch_name, action
       FROM paper_stock_log
       WHERE paper_stock_id = $1 AND action = 'book'
       ORDER BY created_at DESC
       LIMIT 200`,
      [id]
    )

    // หา active_lot สำหรับแต่ละ booking
    const annotated = bookRows.map(row => {
      const bookTime = new Date(row.created_at).getTime()
      let activeLot: string | null = null
      for (const lot of lotMarkers) {
        if (new Date(lot.created_at).getTime() <= bookTime) activeLot = lot.lot_number
        else break
      }
      return { ...row, lot_number: null, active_lot: activeLot, is_lot_marker: false }
    })

    // แปลง lotMarkers เป็น marker rows สำหรับ inject เข้า timeline
    const markerRows = lotMarkers.map(lot => ({
      id: lot.id,
      qty: lot.qty,
      created_at: lot.created_at,
      branch_name: null,
      action: 'foy_add',
      lot_number: lot.lot_number,
      active_lot: null,
      is_lot_marker: true,
    }))

    // รวมและเรียงตาม date DESC
    const merged = [...annotated, ...markerRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    return NextResponse.json(merged)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
