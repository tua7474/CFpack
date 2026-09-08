import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { ensureTables } from '../route'

// POST { phone } → { branch_id, branch_name, phone, is_admin } | 404
export async function POST(req: NextRequest) {
  try {
    await ensureTables()
    const { phone } = await req.json()
    if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

    const clean = String(phone).replace(/\D/g, '')
    const { rows } = await pool.query(
      `SELECT bp.id, bp.branch_id, bp.phone, bp.is_admin, bp.is_manager, bp.allowed_pages, bp.line_user_id,
              b.name AS branch_name
       FROM branch_phones bp
       JOIN branches b ON b.id = bp.branch_id
       WHERE bp.phone = $1`,
      [clean]
    )
    if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({
      branch_id:    rows[0].branch_id,
      branch_name:  rows[0].branch_name,
      phone:        rows[0].phone,
      is_admin:     rows[0].is_admin,
      is_manager:   rows[0].is_manager,
      allowed_pages: rows[0].allowed_pages ?? [],
      line_user_id: rows[0].line_user_id,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
