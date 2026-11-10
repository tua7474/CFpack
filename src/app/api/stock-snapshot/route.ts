import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://cf-production-6234.up.railway.app'

// ── LINE push ─────────────────────────────────────────────────────────────────

async function linePush(to: string, messages: object[]) {
  if (!LINE_TOKEN || !to) return
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages }),
  }).catch(e => console.error('[stock-snapshot push]', e))
}

// ── Table ─────────────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_snapshots (
      id              SERIAL PRIMARY KEY,
      snapshot_no     VARCHAR(20) UNIQUE NOT NULL,
      branch_id       INT REFERENCES branches(id) ON DELETE SET NULL,
      branch_name     VARCHAR(200),
      line_user_id    VARCHAR(100),
      status          VARCHAR(20) NOT NULL DEFAULT 'draft',
      quantities      JSONB NOT NULL DEFAULT '{}',
      foy_quantities  JSONB NOT NULL DEFAULT '{}',
      ocr_warnings    JSONB NOT NULL DEFAULT '[]',
      source_image_id TEXT,
      confirmed_at    TIMESTAMP,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE catalog_stock_log ADD COLUMN IF NOT EXISTS snapshot_no VARCHAR(20)`).catch(() => {})
  await pool.query(`ALTER TABLE paper_stock_log   ADD COLUMN IF NOT EXISTS snapshot_no VARCHAR(20)`).catch(() => {})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genSnapNo(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const y  = String(now.getFullYear()).slice(2)
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d  = String(now.getDate()).padStart(2, '0')
  const h  = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `SS${y}${mo}${d}${h}${mi}`
}

// ── Flex Confirm Card ─────────────────────────────────────────────────────────

function snapConfirmFlex(snap_no: string, totalItems: number, warnings: number) {
  const formUrl  = `${BASE_URL}/stock-form?snap=${snap_no}`
  const warningText = warnings > 0 ? `⚠️ อ่านไม่ชัด ${warnings} รายการ ` : ''
  return {
    type: 'flex',
    altText: `📦 ตรวจสอบรายการสต็อค ${snap_no}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'horizontal',
        backgroundColor: '#1a6b4a', paddingAll: '10px', alignItems: 'center',
        contents: [
          { type: 'text', text: '📦 ตรวจสอบสต็อค', color: '#ffffff', weight: 'bold', size: 'sm', flex: 1 },
          { type: 'text', text: snap_no, color: '#a7f3d0', size: 'xxs', align: 'end', flex: 0 },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [
          { type: 'text', text: `รายการทั้งหมด ${totalItems} รายการ`, size: 'sm', color: '#111' },
          ...(warnings > 0 ? [{ type: 'text' as const, text: `${warningText}— กรุณาตรวจสอบ`, size: 'xs' as const, color: '#c05000', wrap: true }] : []),
          { type: 'separator', margin: 'sm' },
          { type: 'text', text: 'กรุณาตรวจสอบรายการก่อนยืนยัน', size: 'xs', color: '#666', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              {
                type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: '#16a34a', cornerRadius: '4px', paddingAll: '8px',
                action: { type: 'postback', label: 'ยืนยัน', data: `STOCK_CONFIRM:${snap_no}` },
                contents: [{ type: 'text', text: '✅ ยืนยัน', color: '#fff', align: 'center', size: 'sm', weight: 'bold' }],
              },
              {
                type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: '#d97706', cornerRadius: '4px', paddingAll: '8px',
                action: { type: 'uri', label: 'แก้ไข', uri: formUrl },
                contents: [{ type: 'text', text: '✏️ แก้ไข', color: '#fff', align: 'center', size: 'sm', weight: 'bold' }],
              },
              {
                type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: '#dc2626', cornerRadius: '4px', paddingAll: '8px',
                action: { type: 'postback', label: 'ยกเลิก', data: `STOCK_CANCEL:${snap_no}` },
                contents: [{ type: 'text', text: '❌ ยกเลิก', color: '#fff', align: 'center', size: 'sm', weight: 'bold' }],
              },
            ],
          },
        ],
      },
    },
  }
}

// ── GET — ดึง snapshot ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  await ensureTable()
  const url = new URL(req.url)
  const no  = url.searchParams.get('no')
  if (no) {
    const { rows } = await pool.query(`SELECT * FROM stock_snapshots WHERE snapshot_no=$1`, [no])
    if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(rows[0])
  }
  const { rows } = await pool.query(
    `SELECT * FROM stock_snapshots ORDER BY created_at DESC LIMIT 50`
  )
  return NextResponse.json(rows)
}

// ── POST — สร้าง snapshot draft ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  await ensureTable()
  const body = await req.json()
  const { line_user_id, branch_id, branch_name } = body

  // พยายามสร้าง snap_no ไม่ซ้ำ (ถ้าซ้ำ เพิ่ม suffix)
  let snap_no = genSnapNo()
  const { rows: dup } = await pool.query(
    `SELECT 1 FROM stock_snapshots WHERE snapshot_no=$1`, [snap_no]
  )
  if (dup.length > 0) snap_no = snap_no + 'A'

  const { rows } = await pool.query(`
    INSERT INTO stock_snapshots (snapshot_no, branch_id, branch_name, line_user_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [snap_no, branch_id ?? null, branch_name ?? null, line_user_id ?? null])

  return NextResponse.json(rows[0], { status: 201 })
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  await ensureTable()
  const body = await req.json()
  const { snap_no, action } = body

  const { rows: snapRows } = await pool.query(
    `SELECT * FROM stock_snapshots WHERE snapshot_no=$1`, [snap_no]
  )
  const snap = snapRows[0]
  if (!snap) return NextResponse.json({ error: 'snapshot not found' }, { status: 404 })

  // ── set_quantities: บันทึกจาก web form ──────────────────────────────────────
  if (action === 'set_quantities') {
    const { quantities, foy_quantities } = body
    await pool.query(`
      UPDATE stock_snapshots
      SET quantities=$1, foy_quantities=$2
      WHERE snapshot_no=$3
    `, [JSON.stringify(quantities ?? {}), JSON.stringify(foy_quantities ?? {}), snap_no])

    // นับรายการ
    const totalItems =
      Object.values(quantities ?? {}).filter((v) => (v as number) > 0).length +
      Object.values(foy_quantities ?? {}).filter((v) => (v as number) > 0).length

    // Push LINE confirmation
    if (snap.line_user_id) {
      const warnings: { id: number; name: string }[] = snap.ocr_warnings ?? []
      await linePush(snap.line_user_id, [snapConfirmFlex(snap_no, totalItems, warnings.length)])
    }

    return NextResponse.json({ ok: true, snap_no, totalItems })
  }

  // ── set_ocr: บันทึกผล OCR จาก Claude ────────────────────────────────────────
  if (action === 'set_ocr') {
    const { quantities, foy_quantities, ocr_warnings, source_image_id } = body
    await pool.query(`
      UPDATE stock_snapshots
      SET quantities=$1, foy_quantities=$2, ocr_warnings=$3, source_image_id=$4
      WHERE snapshot_no=$5
    `, [
      JSON.stringify(quantities ?? {}),
      JSON.stringify(foy_quantities ?? {}),
      JSON.stringify(ocr_warnings ?? []),
      source_image_id ?? null,
      snap_no,
    ])
    return NextResponse.json({ ok: true })
  }

  // ── confirm: ยืนยัน → อัปเดตสต็อกจริง ───────────────────────────────────────
  if (action === 'confirm') {
    if (snap.status === 'confirmed') {
      return NextResponse.json({ ok: true, already: true })
    }
    if (snap.status === 'cancelled') {
      return NextResponse.json({ error: 'snapshot cancelled' }, { status: 400 })
    }

    const quantities:    Record<string, number> = snap.quantities    ?? {}
    const foyQuantities: Record<string, number> = snap.foy_quantities ?? {}

    // ตรวจสอบว่ามี branch_id
    if (!snap.branch_id) {
      return NextResponse.json({ error: 'snapshot has no branch_id' }, { status: 400 })
    }

    // อัปเดต branch_stock (สต็อคสาขา)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS branch_stock (
        id         SERIAL PRIMARY KEY,
        branch_id  INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        product_id INT NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
        quantity   INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (branch_id, product_id)
      )
    `)
    for (const [idStr, qty] of Object.entries(quantities)) {
      const q = Number(qty)
      if (isNaN(q)) continue
      await pool.query(`
        INSERT INTO branch_stock (branch_id, product_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity=$3, updated_at=NOW()
      `, [snap.branch_id, Number(idStr), q])
    }

    // อัปเดต branch_foy_stock (สต็อคฝอยสาขา)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS branch_foy_stock (
        id             SERIAL PRIMARY KEY,
        branch_id      INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        paper_stock_id INT NOT NULL REFERENCES paper_stock(id) ON DELETE CASCADE,
        quantity       INT NOT NULL DEFAULT 0,
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (branch_id, paper_stock_id)
      )
    `)
    for (const [idStr, qty] of Object.entries(foyQuantities)) {
      const q = Number(qty)
      if (isNaN(q)) continue
      await pool.query(`
        INSERT INTO branch_foy_stock (branch_id, paper_stock_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (branch_id, paper_stock_id) DO UPDATE SET quantity=$3, updated_at=NOW()
      `, [snap.branch_id, Number(idStr), q])
    }

    await pool.query(`
      UPDATE stock_snapshots SET status='confirmed', confirmed_at=NOW() WHERE snapshot_no=$1
    `, [snap_no])

    return NextResponse.json({ ok: true })
  }

  // ── cancel ───────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    await pool.query(
      `UPDATE stock_snapshots SET status='cancelled' WHERE snapshot_no=$1`, [snap_no]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
