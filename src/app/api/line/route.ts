import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import pool from '@/lib/db'

const TOKEN  = process.env.LINE_CHANNEL_ACCESS_TOKEN!
const SECRET = process.env.LINE_CHANNEL_SECRET!
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://cf-production-6234.up.railway.app'

// ── LINE API ──────────────────────────────────────────────────────────────────

async function reply(replyToken: string, messages: object[]) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ replyToken, messages }),
  })
}

function verifySignature(body: string, sig: string) {
  const hash = crypto.createHmac('sha256', SECRET).update(body).digest('base64')
  return hash === sig
}

// ── Session (DB) ──────────────────────────────────────────────────────────────

interface InputState {
  id: number; name: string; price: number; sec: number; sg: number; page: number
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_sessions (
      user_id     VARCHAR(100) PRIMARY KEY,
      order_data  JSONB        NOT NULL DEFAULT '{}',
      input_state JSONB,
      updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
    )`)
  // slips table (shared with /api/slips)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slips (
      id            SERIAL PRIMARY KEY,
      branch_id     INT REFERENCES branches(id) ON DELETE SET NULL,
      category      VARCHAR(20) NOT NULL,
      amount        DECIMAL(12,2) NOT NULL,
      account_name  VARCHAR(200),
      slip_date     DATE NOT NULL,
      status        VARCHAR(20) NOT NULL DEFAULT 'pending',
      line_image_id TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  // Add input_state column if upgrading from older schema
  await pool.query(`
    ALTER TABLE line_sessions ADD COLUMN IF NOT EXISTS input_state JSONB
  `).catch(() => {})
}

async function getOrder(userId: string): Promise<Record<number, number>> {
  await ensureTable()
  const { rows } = await pool.query('SELECT order_data FROM line_sessions WHERE user_id=$1', [userId])
  return rows[0]?.order_data ?? {}
}

async function saveOrder(userId: string, data: Record<number, number>) {
  await ensureTable()
  await pool.query(`
    INSERT INTO line_sessions (user_id, order_data, updated_at) VALUES ($1,$2,NOW())
    ON CONFLICT (user_id) DO UPDATE SET order_data=$2, updated_at=NOW()
  `, [userId, JSON.stringify(data)])
}

async function getInputState(userId: string): Promise<InputState | null> {
  const { rows } = await pool.query('SELECT input_state FROM line_sessions WHERE user_id=$1', [userId])
  return rows[0]?.input_state ?? null
}

async function setInputState(userId: string, state: InputState | null) {
  await ensureTable()
  await pool.query(`
    INSERT INTO line_sessions (user_id, order_data, input_state, updated_at) VALUES ($1,'{}', $2, NOW())
    ON CONFLICT (user_id) DO UPDATE SET input_state=$2, updated_at=NOW()
  `, [userId, state ? JSON.stringify(state) : null])
}

// ── DB Queries ────────────────────────────────────────────────────────────────

async function getSections() {
  const { rows } = await pool.query(`
    SELECT DISTINCT section_order, section_name, is_vat_included
    FROM booking_products ORDER BY section_order`)
  return rows
}

async function getSubgroups(sectionOrder: number) {
  const { rows } = await pool.query(`
    SELECT DISTINCT subgroup_order, subgroup_name
    FROM booking_products WHERE section_order=$1 AND subgroup_order>0
    ORDER BY subgroup_order`, [sectionOrder])
  return rows
}

async function getProducts(sectionOrder: number, subgroupOrder: number) {
  const { rows } = await pool.query(`
    SELECT id, product_name, unit_price, is_free
    FROM booking_products
    WHERE section_order=$1 AND subgroup_order=$2 AND is_free=false
    ORDER BY sort_order`, [sectionOrder, subgroupOrder])
  return rows
}

async function getSectionInfo(sectionOrder: number) {
  const { rows } = await pool.query(`
    SELECT section_name, is_vat_included FROM booking_products
    WHERE section_order=$1 LIMIT 1`, [sectionOrder])
  return rows[0]
}

async function getSubgroupInfo(sectionOrder: number, subgroupOrder: number) {
  const { rows } = await pool.query(`
    SELECT section_name, subgroup_name, is_vat_included FROM booking_products
    WHERE section_order=$1 AND subgroup_order=$2 LIMIT 1`, [sectionOrder, subgroupOrder])
  return rows[0]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function countOrdered(userId: string): Promise<Record<number, number>> {
  const order = await getOrder(userId)
  // returns { sectionOrder: count }
  const ids = Object.keys(order).map(Number).filter(id => order[id] > 0)
  if (!ids.length) return {}
  const { rows } = await pool.query(`
    SELECT section_order, COUNT(*)::int as cnt FROM booking_products
    WHERE id=ANY($1) GROUP BY section_order`, [ids])
  return Object.fromEntries(rows.map(r => [r.section_order, r.cnt]))
}

// ── Group / Branch helpers ────────────────────────────────────────────────────

async function getGroupName(groupId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { groupName?: string }
    return data.groupName ?? null
  } catch { return null }
}

// ค้นหาสาขาที่ชื่อกลุ่มมีคำว่าชื่อสาขา เช่น กลุ่ม "CF สนามบินน้ำ" → สาขา "สนามบินน้ำ"
async function findBranchByGroupName(groupName: string): Promise<{ id: number; name: string } | null> {
  try {
    const { rows } = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM branches
       WHERE $1 LIKE '%' || name || '%'
       ORDER BY length(name) DESC LIMIT 1`,
      [groupName]
    )
    return rows[0] ?? null
  } catch { return null }
}

// ── Branch / Orders helpers ───────────────────────────────────────────────────

const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function fmtDateShortLine(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Bangkok',
  })
}

async function getBranchFromLineUser(userId: string): Promise<{ branch_id: number; branch_name: string; is_admin: boolean } | null> {
  try {
    const { rows } = await pool.query(`
      SELECT bp.is_admin, b.id AS branch_id, b.name AS branch_name
      FROM branch_phones bp
      JOIN branches b ON b.id = bp.branch_id
      WHERE bp.line_user_id = $1 LIMIT 1
    `, [userId])
    return rows[0] ?? null
  } catch { return null }
}

async function getMonthlySummary(branchId: number, year: number): Promise<Record<number, { pending: number; paid: number }>> {
  const { rows } = await pool.query(`
    SELECT
      EXTRACT(MONTH FROM created_at AT TIME ZONE 'Asia/Bangkok')::int AS month,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::int   AS paid,
      COUNT(*) FILTER (WHERE payment_status != 'paid')::int  AS pending
    FROM booking_orders
    WHERE branch_id = $1 AND EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Bangkok') = $2
    GROUP BY month ORDER BY month
  `, [branchId, year])
  const out: Record<number, { pending: number; paid: number }> = {}
  for (const r of rows) out[r.month] = { pending: r.pending, paid: r.paid }
  return out
}

async function getMonthOrders(branchId: number, year: number, month: number) {
  const { rows } = await pool.query(`
    SELECT id, order_no, total_amount::float AS total_amount,
           status, payment_status, created_at, updated_at
    FROM booking_orders
    WHERE branch_id = $1
      AND EXTRACT(YEAR  FROM created_at AT TIME ZONE 'Asia/Bangkok') = $2
      AND EXTRACT(MONTH FROM created_at AT TIME ZONE 'Asia/Bangkok') = $3
    ORDER BY created_at DESC
  `, [branchId, year, month])
  return rows
}

async function getPendingOrders(branchId: number) {
  const { rows } = await pool.query(`
    SELECT id, order_no, total_amount::float AS total_amount, created_at
    FROM booking_orders
    WHERE branch_id = $1 AND payment_status != 'paid'
    ORDER BY created_at ASC
  `, [branchId])
  return rows
}

// ── Flex Builders ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 7

async function mainMenu(userId: string) {
  const [sections, secCounts] = await Promise.all([getSections(), countOrdered(userId)])
  const totalItems = Object.values(await getOrder(userId)).filter(q => q > 0).length

  const rows = sections.map(sec => {
    const cnt = secCounts[sec.section_order] ?? 0
    const color = sec.is_vat_included ? '#9b9484' : '#4ade80'
    return {
      type: 'box', layout: 'horizontal', paddingAll: '10px',
      borderWidth: '1px', borderColor: '#eeeeee', cornerRadius: '8px', margin: 'sm',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 1, justifyContent: 'center',
          contents: [{ type: 'text', text: sec.is_vat_included ? '🔘' : '🟠', size: 'lg', align: 'center' }]
        },
        {
          type: 'box', layout: 'vertical', flex: 5, paddingStart: '8px',
          contents: [
            { type: 'text', text: sec.section_name, weight: 'bold', size: 'sm', color: '#222222' },
            { type: 'text', text: cnt ? `✅ จอง ${cnt} รายการแล้ว` : 'ยังไม่ได้จอง', size: 'xs', color: cnt ? '#4ade80' : '#aaaaaa' }
          ]
        },
        {
          type: 'button', flex: 2,
          action: { type: 'postback', label: 'เลือก >', data: `S:${sec.section_order}` },
          style: 'primary', color, height: 'sm'
        }
      ]
    }
  })

  return {
    type: 'flex', altText: '📋 เมนูใบจอง',
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#9b9484',
        contents: [
          { type: 'text', text: '📋 กระดาษฝอยไทย — ใบจอง', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: totalItems ? `เลือกไว้แล้ว ${totalItems} รายการ` : 'เลือกหมวดสินค้าที่ต้องการ', color: '#aaffaa', size: 'xs' }
        ]
      },
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: rows },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: '🧾 สรุปรายการสั่งซื้อรอบนี้', data: 'C' },
            style: 'primary', color: '#9b9484', height: 'sm'
          }
        ]
      }
    }
  }
}

async function sectionMenu(sectionOrder: number, userId: string) {
  const [sec, subgroups] = await Promise.all([
    getSectionInfo(sectionOrder), getSubgroups(sectionOrder)
  ])
  if (!subgroups.length) return productsView(sectionOrder, 0, 0, userId)

  const order = await getOrder(userId)
  const ids = Object.keys(order).map(Number).filter(id => order[id] > 0)
  const sgCounts: Record<number, number> = {}
  if (ids.length) {
    const { rows } = await pool.query(`
      SELECT subgroup_order, COUNT(*)::int as cnt FROM booking_products
      WHERE section_order=$1 AND id=ANY($2) GROUP BY subgroup_order`,
      [sectionOrder, ids])
    rows.forEach(r => { sgCounts[r.subgroup_order] = r.cnt })
  }

  const btns = subgroups.map(sg => {
    const cnt = sgCounts[sg.subgroup_order] ?? 0
    return {
      type: 'box', layout: 'horizontal', margin: 'sm', paddingAll: '6px',
      borderWidth: '1px', borderColor: '#eeeeee', cornerRadius: '6px',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 4, justifyContent: 'center',
          contents: [
            { type: 'text', text: sg.subgroup_name, size: 'sm', wrap: true, color: '#222222' },
            ...(cnt ? [{ type: 'text', text: `✅ ${cnt} รายการ`, size: 'xs', color: '#4ade80' }] : [])
          ]
        },
        {
          type: 'button', flex: 2,
          action: { type: 'postback', label: 'เลือก', data: `SG:${sectionOrder}:${sg.subgroup_order}:0` },
          style: 'primary', color: '#4ade80', height: 'sm'
        }
      ]
    }
  })

  const headerColor = sec?.is_vat_included ? '#9b9484' : '#4ade80'
  return {
    type: 'flex', altText: `${sec?.section_name} — เลือกหมวดย่อย`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: headerColor,
        contents: [
          { type: 'text', text: sec?.section_name ?? '', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: 'เลือกหมวดย่อย', color: '#ffffff99', size: 'xs' }
        ]
      },
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: btns },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button',
          action: { type: 'postback', label: '← กลับเมนูหลัก', data: 'M' },
          style: 'secondary', height: 'sm'
        }]
      }
    }
  }
}

async function productsView(sectionOrder: number, subgroupOrder: number, page: number, userId: string) {
  const [products, info, order] = await Promise.all([
    getProducts(sectionOrder, subgroupOrder),
    subgroupOrder > 0 ? getSubgroupInfo(sectionOrder, subgroupOrder) : getSectionInfo(sectionOrder),
    getOrder(userId)
  ])

  const totalPages = Math.ceil(products.length / PAGE_SIZE) || 1
  const pageProds  = products.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const secName    = (info as Record<string,string>)?.section_name ?? ''
  const sgName     = (info as Record<string,string>)?.subgroup_name ?? ''
  const isVat      = (info as Record<string,boolean>)?.is_vat_included ?? false

  const prodRows = pageProds.map(p => {
    const qty = order[p.id] ?? 0
    const total = qty * p.unit_price
    return {
      type: 'box', layout: 'vertical', margin: 'sm', paddingAll: '8px',
      backgroundColor: qty > 0 ? '#f0fff4' : '#f8f8f8', cornerRadius: '8px',
      contents: [
        // Product name + qty badge
        {
          type: 'box', layout: 'horizontal', alignItems: 'center',
          contents: [
            { type: 'text', text: p.product_name, size: 'sm', flex: 5, wrap: true, color: '#222222', weight: qty > 0 ? 'bold' : 'regular' },
            { type: 'text', text: qty > 0 ? `×${qty}` : '', size: 'sm', flex: 1, align: 'end', color: '#4ade80', weight: 'bold' }
          ]
        },
        // Price + total row
        {
          type: 'box', layout: 'horizontal', margin: 'xs',
          contents: [
            { type: 'text', text: `฿${fmt(p.unit_price)}/ชิ้น`, size: 'xs', flex: 3, color: '#888888' },
            { type: 'text', text: qty > 0 ? `รวม ฿${fmt(total)}` : '', size: 'xs', flex: 3, align: 'end', color: '#4ade80', weight: 'bold' }
          ]
        },
        // Buttons row: ⌨️ ระบุจำนวน + ✕
        {
          type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'sm',
          contents: [
            {
              type: 'button', flex: 4,
              action: { type: 'postback', label: '⌨️ ระบุจำนวน', data: `QI:${p.id}:${sectionOrder}:${subgroupOrder}:${page}` },
              style: 'primary', color: '#9b9484', height: 'sm'
            },
            {
              type: 'button', flex: 1,
              action: { type: 'postback', label: '✕', data: `R:${p.id}` },
              style: 'secondary', height: 'sm'
            }
          ]
        }
      ]
    }
  })

  const navBtns: object[] = []
  if (page > 0)
    navBtns.push({ type: 'button', action: { type: 'postback', label: '← หน้าก่อน', data: `SG:${sectionOrder}:${subgroupOrder}:${page-1}` }, style: 'secondary', height: 'sm', flex: 1 })
  if (page < totalPages - 1)
    navBtns.push({ type: 'button', action: { type: 'postback', label: 'หน้าถัดไป →', data: `SG:${sectionOrder}:${subgroupOrder}:${page+1}` }, style: 'secondary', height: 'sm', flex: 1 })

  const backData = subgroupOrder === 0 ? 'M' : `S:${sectionOrder}`
  const headerBg = isVat ? '#9b9484' : '#4ade80'
  const title    = sgName ? `${secName} › ${sgName}` : secName

  return {
    type: 'flex', altText: `${title} — เลือกจำนวน`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: headerBg,
        contents: [
          { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'sm', wrap: true },
          { type: 'text', text: `หน้า ${page+1}/${totalPages}  ·  กด ⌨️ แล้วพิมพ์จำนวน`, color: '#ffffff99', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs',
        contents: prodRows.length ? prodRows : [{ type: 'text', text: 'ไม่มีสินค้าในหมวดนี้', color: '#aaaaaa' }]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...(navBtns.length ? [{ type: 'box', layout: 'horizontal', spacing: 'sm', contents: navBtns }] : []),
          { type: 'button', action: { type: 'postback', label: '✅ ยืนยันและกลับ', data: backData }, style: 'primary', color: '#9b9484', height: 'sm' }
        ]
      }
    }
  }
}

async function summaryView(userId: string) {
  const order = await getOrder(userId)
  const ids   = Object.keys(order).map(Number).filter(id => order[id] > 0)

  if (!ids.length) {
    return { type: 'text', text: 'ยังไม่มีรายการสั่งซื้อครับ\nกลับไปเลือกหมวดสินค้าก่อนนะครับ' }
  }

  const { rows: products } = await pool.query(`
    SELECT id, product_name, unit_price, section_name, section_order, is_vat_included
    FROM booking_products WHERE id=ANY($1)
    ORDER BY section_order, subgroup_order, sort_order`, [ids])

  let grayTotal = 0, orangeTotal = 0
  const pMap = Object.fromEntries(products.map(p => [p.id, p]))
  const sections: Record<number, { name: string; items: { name: string; qty: number; total: number }[] }> = {}

  for (const id of ids) {
    const p = pMap[id]
    if (!p) continue
    const qty   = order[id]
    const total = p.unit_price * qty
    if (p.is_vat_included) grayTotal += total
    else orangeTotal += total
    if (!sections[p.section_order]) sections[p.section_order] = { name: p.section_name, items: [] }
    sections[p.section_order].items.push({ name: p.product_name, qty, total })
  }

  const noVat   = grayTotal + orangeTotal
  const withVat = grayTotal + orangeTotal * 1.07

  const bodyContents: object[] = [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: 'สินค้า', size: 'xs', color: '#aaaaaa', flex: 5, weight: 'bold' },
      { type: 'text', text: 'จน.', size: 'xs', color: '#aaaaaa', flex: 2, align: 'end', weight: 'bold' },
      { type: 'text', text: 'รวม (฿)', size: 'xs', color: '#aaaaaa', flex: 3, align: 'end', weight: 'bold' }
    ]},
    { type: 'separator' }
  ]

  for (const [, sec] of Object.entries(sections)) {
    bodyContents.push({ type: 'text', text: `— ${sec.name} —`, size: 'xs', color: '#888888', margin: 'md' })
    sec.items.forEach(item => {
      bodyContents.push({
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: item.name, size: 'xs', flex: 5, wrap: false, color: '#333333' },
          { type: 'text', text: `×${item.qty}`, size: 'xs', flex: 2, align: 'end', color: '#666666' },
          { type: 'text', text: fmt(item.total), size: 'xs', flex: 3, align: 'end', color: '#4ade80' }
        ]
      })
    })
  }

  bodyContents.push(
    { type: 'separator', margin: 'lg' },
    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
      { type: 'text', text: '🟠 ไม่มีใบกำกับภาษี', size: 'sm', flex: 5, weight: 'bold', color: '#4ade80' },
      { type: 'text', text: `${fmt(noVat)} ฿`, size: 'sm', flex: 5, align: 'end', weight: 'bold', color: '#4ade80' }
    ]},
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: '🔘 มีใบกำกับภาษี', size: 'sm', flex: 5, weight: 'bold', color: '#9b9484' },
      { type: 'text', text: `${fmt(withVat)} ฿`, size: 'sm', flex: 5, align: 'end', weight: 'bold', color: '#9b9484' }
    ]}
  )

  return {
    type: 'flex', altText: '🧾 สรุปรายการสั่งซื้อ',
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#9b9484',
        contents: [
          { type: 'text', text: '🧾 สรุปรายการสั่งซื้อ', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: `${ids.length} รายการ`, color: '#aaffaa', size: 'xs' }
        ]
      },
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: bodyContents },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', action: { type: 'postback', label: '📄 ส่งใบจองเป็นรูปภาพ', data: 'IMG' }, style: 'primary', color: '#1a3a6c', height: 'sm' },
          { type: 'button', action: { type: 'postback', label: '← แก้ไขรายการ', data: 'M' }, style: 'secondary', height: 'sm' },
          { type: 'button', action: { type: 'postback', label: '🗑 ล้างรายการทั้งหมด', data: 'CLEAR' }, style: 'secondary', height: 'sm' }
        ]
      }
    }
  }
}

// ── History / Payment Flex builders ──────────────────────────────────────────

function monthSummaryRows(summary: Record<number, { pending: number; paid: number }>, branchId: number, year: number): object[] {
  const rows: object[] = []
  for (let m = 1; m <= 12; m++) {
    const s = summary[m]
    if (!s || (s.pending === 0 && s.paid === 0)) continue
    const subTexts: object[] = []
    if (s.pending > 0) subTexts.push({ type: 'text', text: `${s.pending} รอชำระ`,   size: 'xs', color: '#f59e0b' })
    if (s.paid    > 0) subTexts.push({ type: 'text', text: `${s.paid} ชำระแล้ว`, size: 'xs', color: '#4ade80' })
    rows.push({
      type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
      contents: [
        { type: 'text', text: TH_MONTHS[m - 1], size: 'sm', flex: 2, color: '#333333', weight: 'bold' },
        { type: 'box', flex: 5, layout: 'vertical', contents: subTexts },
        { type: 'button', flex: 2,
          action: { type: 'postback', label: 'ดู', data: `MON:${branchId}:${m}:${year}` },
          style: 'secondary', height: 'sm' }
      ]
    })
  }
  return rows
}

async function historyView(branchId: number, branchName: string): Promise<object> {
  const year    = new Date().getFullYear()
  const summary = await getMonthlySummary(branchId, year)
  const rows    = monthSummaryRows(summary, branchId, year)
  return {
    type: 'flex', altText: `📊 ประวัติรายเดือน — ${branchName}`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#9b9484',
        contents: [
          { type: 'text', text: '📊 ประวัติรายเดือน', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: `${branchName} · ${year + 543}`, color: '#aaffaa', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '12px',
        contents: rows.length
          ? rows
          : [{ type: 'text', text: 'ยังไม่มีประวัติการสั่งซื้อ', color: '#aaaaaa', size: 'sm' }]
      }
    }
  }
}

async function paymentView(branchId: number, branchName: string): Promise<object> {
  const pending = await getPendingOrders(branchId)
  if (!pending.length) {
    return {
      type: 'flex', altText: '✅ ไม่มียอดค้างชำระ',
      contents: {
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', paddingAll: '20px',
          contents: [
            { type: 'text', text: '✅ ชำระครบแล้ว', weight: 'bold', size: 'lg', color: '#4ade80' },
            { type: 'text', text: `${branchName} ไม่มียอดค้างชำระ`, size: 'sm', color: '#666666', margin: 'sm' }
          ]
        }
      }
    }
  }
  const total = pending.reduce((s: number, o: Record<string, number>) => s + (o.total_amount ?? 0), 0)
  const orderItems = pending.map((o: Record<string, string | number>) => ({
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'box', flex: 5, layout: 'vertical', contents: [
        { type: 'text', text: `#${o.order_no}`, size: 'xs', color: '#333333', weight: 'bold' },
        { type: 'text', text: fmtDateShortLine(String(o.created_at)), size: 'xs', color: '#aaaaaa' }
      ]},
      { type: 'text', text: `฿${fmt(Number(o.total_amount))}`, size: 'xs', flex: 3, align: 'end', color: '#f59e0b', weight: 'bold' }
    ]
  }))
  return {
    type: 'flex', altText: `💳 ยืนยันชำระเงิน — ${branchName}`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#9b9484',
        contents: [
          { type: 'text', text: '💳 ยืนยันชำระเงิน', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: branchName, color: '#aaffaa', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '12px',
        contents: [
          { type: 'text', text: `${pending.length} ใบจองรอชำระ`, size: 'sm', color: '#666666' },
          { type: 'separator', margin: 'sm' },
          ...orderItems,
          { type: 'separator', margin: 'md' },
          { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
            { type: 'text', text: 'รวมทั้งหมด', size: 'sm', flex: 5, weight: 'bold', color: '#333333' },
            { type: 'text', text: `฿${fmt(total)}`, size: 'sm', flex: 3, align: 'end', weight: 'bold', color: '#f59e0b' }
          ]}
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [
          { type: 'button', action: { type: 'postback', label: '✅ ยืนยันชำระเงิน', data: `PAYCONFIRM:${branchId}` }, style: 'primary', color: '#4ade80', height: 'sm' },
          { type: 'button', action: { type: 'postback', label: '← ยกเลิก', data: `HIST:${branchId}` }, style: 'secondary', height: 'sm' }
        ]
      }
    }
  }
}

async function monthDetailView(branchId: number, branchName: string, month: number, year: number): Promise<object> {
  const orders = await getMonthOrders(branchId, year, month)
  const orderRows = orders.map((o: Record<string, string | number>) => ({
    type: 'box', layout: 'horizontal', margin: 'sm', paddingAll: '6px',
    backgroundColor: o.payment_status === 'paid' ? '#f0fff4' : '#fffbeb', cornerRadius: '4px',
    contents: [
      { type: 'box', flex: 5, layout: 'vertical', contents: [
        { type: 'text', text: `#${o.order_no}`, size: 'xs', color: '#333333', weight: 'bold' },
        { type: 'text', text: fmtDateShortLine(String(o.created_at)), size: 'xs', color: '#aaaaaa' },
        ...(o.payment_status === 'paid'
          ? [{ type: 'text', text: `ชำระ ${fmtDateShortLine(String(o.updated_at))}`, size: 'xs', color: '#4ade80' }]
          : [])
      ]},
      { type: 'box', flex: 3, layout: 'vertical', alignItems: 'flex-end', contents: [
        { type: 'text', text: `฿${fmt(Number(o.total_amount))}`, size: 'xs', align: 'end', weight: 'bold',
          color: o.payment_status === 'paid' ? '#4ade80' : '#f59e0b' },
        { type: 'text', text: o.payment_status === 'paid' ? '✓ ชำระแล้ว' : 'รอชำระ', size: 'xs', align: 'end',
          color: o.payment_status === 'paid' ? '#4ade80' : '#f59e0b' }
      ]}
    ]
  }))
  return {
    type: 'flex', altText: `📋 ${TH_MONTHS[month - 1]} ${year + 543} — ${branchName}`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#9b9484',
        contents: [
          { type: 'text', text: `📋 ${TH_MONTHS[month - 1]} ${year + 543}`, color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: branchName, color: '#aaffaa', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '12px',
        contents: orders.length
          ? [
              { type: 'text', text: `${orders.length} ใบจอง`, size: 'xs', color: '#888888' },
              { type: 'separator', margin: 'sm' },
              ...orderRows
            ]
          : [{ type: 'text', text: 'ไม่มีรายการในเดือนนี้', color: '#aaaaaa', size: 'sm' }]
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{ type: 'button', action: { type: 'postback', label: '← กลับ', data: `HIST:${branchId}` }, style: 'secondary', height: 'sm' }]
      }
    }
  }
}

// ── Postback handler ──────────────────────────────────────────────────────────

async function handlePostback(data: string, userId: string, replyToken: string) {
  // MENU
  if (data === 'M') {
    return reply(replyToken, [await mainMenu(userId)])
  }

  // CONFIRM
  if (data === 'C') {
    return reply(replyToken, [await summaryView(userId)])
  }

  // CLEAR
  if (data === 'CLEAR') {
    await saveOrder(userId, {})
    return reply(replyToken, [
      { type: 'text', text: '🗑 ล้างรายการทั้งหมดแล้วครับ' },
      await mainMenu(userId)
    ])
  }

  // IMAGE
  if (data === 'IMG') {
    const imageUrl = `${BASE_URL}/api/line/image?userId=${encodeURIComponent(userId)}&t=${Date.now()}`
    return reply(replyToken, [
      {
        type: 'image',
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      }
    ])
  }

  // SECTION: S:{n}
  if (data.startsWith('S:')) {
    const sec = parseInt(data.split(':')[1])
    return reply(replyToken, [await sectionMenu(sec, userId)])
  }

  // SUBGROUP: SG:{sec}:{sg}:{page}
  if (data.startsWith('SG:')) {
    const [, sec, sg, pg] = data.split(':').map(Number)
    return reply(replyToken, [await productsView(sec, sg, pg, userId)])
  }

  // ADD: A:{id}:{qty}
  if (data.startsWith('A:')) {
    const [, idStr, qtyStr] = data.split(':')
    const id  = Number(idStr)
    const add = Number(qtyStr)
    const order = await getOrder(userId)
    order[id]   = (order[id] ?? 0) + add
    await saveOrder(userId, order)

    // Find which page this product is on and refresh
    const { rows } = await pool.query(
      'SELECT section_order, subgroup_order FROM booking_products WHERE id=$1', [id])
    if (rows[0]) {
      const { section_order: sec, subgroup_order: sg } = rows[0]
      const allProds = await getProducts(sec, sg)
      const idx  = allProds.findIndex(p => p.id === id)
      const page = Math.floor(idx / PAGE_SIZE)
      return reply(replyToken, [await productsView(sec, sg, page, userId)])
    }
    return reply(replyToken, [{ type: 'text', text: `✅ เพิ่ม ${add} ชิ้นแล้ว` }])
  }

  // RESET: R:{id}
  if (data.startsWith('R:')) {
    const id    = Number(data.split(':')[1])
    const order = await getOrder(userId)
    delete order[id]
    await saveOrder(userId, order)
    // Reply with simple text — don't push new Flex
    return reply(replyToken, [{ type: 'text', text: '✕ รีเซ็ตจำนวนสินค้าแล้วครับ' }])
  }

  // QUERY INPUT: QI:{id}:{sec}:{sg}:{page}
  if (data.startsWith('QI:')) {
    const [, idStr, secStr, sgStr, pageStr] = data.split(':')
    const id = Number(idStr)
    const { rows } = await pool.query(
      'SELECT product_name, unit_price FROM booking_products WHERE id=$1', [id])
    if (!rows[0]) return reply(replyToken, [{ type: 'text', text: 'ไม่พบสินค้า' }])
    const { product_name, unit_price } = rows[0]

    // Store input state
    await setInputState(userId, {
      id, name: product_name, price: unit_price,
      sec: Number(secStr), sg: Number(sgStr), page: Number(pageStr)
    })

    return reply(replyToken, [{
      type: 'text',
      text: `⌨️ กรอกจำนวน:\n"${product_name}"\nราคา ฿${fmt(unit_price)} / ชิ้น\n\nพิมพ์จำนวนที่ต้องการ (ตัวเลขเท่านั้น):`
    }])
  }

  // HIST: monthly history for a branch
  if (data.startsWith('HIST:')) {
    const branchId = parseInt(data.split(':')[1])
    const { rows: br } = await pool.query('SELECT name FROM branches WHERE id=$1', [branchId])
    return reply(replyToken, [await historyView(branchId, br[0]?.name ?? `สาขา #${branchId}`)])
  }

  // PAYVIEW: show pending orders for payment confirmation
  if (data.startsWith('PAYVIEW:')) {
    const branchId = parseInt(data.split(':')[1])
    const { rows: br } = await pool.query('SELECT name FROM branches WHERE id=$1', [branchId])
    return reply(replyToken, [await paymentView(branchId, br[0]?.name ?? `สาขา #${branchId}`)])
  }

  // PAYCONFIRM: mark all pending orders paid (admin only via LINE user_id)
  if (data.startsWith('PAYCONFIRM:')) {
    const branchId = parseInt(data.split(':')[1])
    const { rows: adminCheck } = await pool.query(`
      SELECT 1 FROM branch_phones
      WHERE line_user_id=$1 AND branch_id=$2 AND is_admin=true LIMIT 1
    `, [userId, branchId])
    if (!adminCheck.length) {
      return reply(replyToken, [{
        type: 'text',
        text: '❌ ไม่มีสิทธิ์ชำระเงิน\nกรุณาลงทะเบียนเบอร์ Admin ก่อน\nพิมพ์: ลงทะเบียน [เบอร์โทร]'
      }])
    }
    const { rowCount } = await pool.query(`
      UPDATE booking_orders SET payment_status='paid', updated_at=NOW()
      WHERE branch_id=$1 AND payment_status != 'paid'
    `, [branchId])
    const { rows: br } = await pool.query('SELECT name FROM branches WHERE id=$1', [branchId])
    return reply(replyToken, [{
      type: 'text',
      text: `✅ บันทึกชำระเงินสำเร็จ!\n${br[0]?.name ?? ''}\nอัปเดต ${rowCount} ใบจองแล้วครับ`
    }])
  }

  // MON: month detail view
  if (data.startsWith('MON:')) {
    const [, bId, mStr, yStr] = data.split(':')
    const branchId = parseInt(bId)
    const month    = parseInt(mStr)
    const year     = parseInt(yStr)
    const { rows: br } = await pool.query('SELECT name FROM branches WHERE id=$1', [branchId])
    return reply(replyToken, [await monthDetailView(branchId, br[0]?.name ?? `สาขา #${branchId}`, month, year)])
  }
}

// ── Text handler ──────────────────────────────────────────────────────────────

async function handleText(text: string, userId: string, replyToken: string, source?: Record<string, string>) {
  const t = text.trim().toLowerCase()

  // Check if user is responding to a QI: input prompt
  const numVal = parseFloat(text.trim())
  if (!isNaN(numVal) && numVal > 0 && /^\d+(\.\d+)?$/.test(text.trim())) {
    const state = await getInputState(userId)
    if (state) {
      const qty = Math.round(numVal)
      const order = await getOrder(userId)
      order[state.id] = qty
      await saveOrder(userId, order)
      await setInputState(userId, null)
      const total = qty * state.price
      return reply(replyToken, [{
        type: 'text',
        text: `✅ บันทึกแล้วครับ\n${state.name}\n× ${qty} ชิ้น = ฿${fmt(total)}\n\nกรอกสินค้าถัดไปได้เลย หรือกด ✅ ยืนยันและกลับ เพื่อกลับหน้าหมวด`
      }])
    }
  }

  // ลงทะเบียน 0xxxxxxxxx — link phone to LINE userId
  if (t.startsWith('ลงทะเบียน')) {
    const phone = t.replace('ลงทะเบียน', '').trim().replace(/\D/g, '')
    if (!phone) return reply(replyToken, [{ type: 'text', text: 'กรุณาระบุเบอร์โทร เช่น: ลงทะเบียน 0812345678' }])
    try {
      const { rows } = await pool.query(
        `UPDATE branch_phones SET line_user_id=$1 WHERE phone=$2 AND is_admin=true RETURNING id`,
        [userId, phone]
      )
      if (!rows[0]) return reply(replyToken, [{ type: 'text', text: `❌ ไม่พบเบอร์ ${phone} ในรายชื่อ Admin\nกรุณาให้ผู้ดูแลระบบเพิ่มเบอร์ของคุณก่อนครับ` }])
      return reply(replyToken, [{ type: 'text', text: `✅ ลงทะเบียนสำเร็จ!\nเบอร์ ${phone} เชื่อมกับบัญชี LINE นี้แล้ว\nคุณจะได้รับ OTP ผ่าน LINE เมื่อต้องการยืนยันชำระเงินครับ` }])
    } catch {
      return reply(replyToken, [{ type: 'text', text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่' }])
    }
  }

  if (['ใบจอง', 'จอง', 'สั่งสินค้า', 'order', 'booking', 'เมนู', 'menu'].includes(t)) {
    // ── หาสาขา: จากกลุ่ม หรือจาก userId ──────────────────────────────────────
    let bookingUrl    = `${BASE_URL}/booking2`
    let branchLabel   = 'ข้อมูลสินค้าและราคาล่าสุดจากระบบ'
    let branchId: number | null    = null
    let branchNameStr: string | null = null

    if (source?.type === 'group' && source.groupId) {
      const groupName = await getGroupName(source.groupId)
      if (groupName) {
        const branch = await findBranchByGroupName(groupName)
        if (branch) {
          bookingUrl    = `${BASE_URL}/booking2?branch_id=${branch.id}&branch_name=${encodeURIComponent(branch.name)}`
          branchLabel   = `สาขา: ${branch.name}`
          branchId      = branch.id
          branchNameStr = branch.name
        }
      }
    }
    if (!branchId) {
      const ub = await getBranchFromLineUser(userId)
      if (ub) {
        branchId      = ub.branch_id
        branchNameStr = ub.branch_name
        branchLabel   = `สาขา: ${ub.branch_name}`
        bookingUrl    = `${BASE_URL}/booking2?branch_id=${ub.branch_id}&branch_name=${encodeURIComponent(ub.branch_name)}`
      }
    }

    // ── ประวัติรายเดือน + ยอดค้างชำระ ────────────────────────────────────────
    const year = new Date().getFullYear()
    const summaryExtra: object[] = []
    let pendingCount = 0

    if (branchId !== null) {
      const [summary, pending] = await Promise.all([
        getMonthlySummary(branchId, year),
        getPendingOrders(branchId),
      ])
      pendingCount = pending.length
      const mRows = monthSummaryRows(summary, branchId, year)
      if (mRows.length > 0) {
        summaryExtra.push(
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: `ประวัติรายเดือน ${year + 543}`, size: 'xs', color: '#9b9484', weight: 'bold', margin: 'md' },
          ...mRows
        )
      }
    }

    // ── Footer buttons ────────────────────────────────────────────────────────
    const footerBtns: object[] = [
      { type: 'button', action: { type: 'uri', label: '🛒 เปิดใบจองสินค้า', uri: bookingUrl }, style: 'primary', color: '#9b9484', height: 'md' },
      { type: 'button', action: { type: 'uri', label: '📋 ประวัติใบจอง', uri: `${BASE_URL}/orders` }, style: 'secondary', height: 'sm' },
    ]
    if (branchId !== null) {
      footerBtns.push({
        type: 'button',
        action: { type: 'postback', label: pendingCount > 0 ? `💳 ชำระเงิน (${pendingCount} ใบ)` : '✅ ชำระครบแล้ว', data: `PAYVIEW:${branchId}` },
        style: 'primary', color: pendingCount > 0 ? '#f59e0b' : '#4ade80', height: 'sm'
      })
    }

    return reply(replyToken, [{
      type: 'flex',
      altText: '📋 เปิดใบจองสินค้า',
      contents: {
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#9b9484', paddingAll: '16px',
          contents: [
            { type: 'text', text: '📋 ใบจองสินค้า', color: '#ffffff', weight: 'bold', size: 'xl' },
            { type: 'text', text: branchLabel, color: '#aaffaa', size: 'sm', margin: 'sm' }
          ]
        },
        body: {
          type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#F5EED8',
          contents: [
            { type: 'text', text: 'กดปุ่มด้านล่างเพื่อเปิดหน้าจองสินค้า สามารถเลือกสินค้า บันทึกใบจอง และดูประวัติได้ทันทีครับ', wrap: true, size: 'sm', color: '#9b9484' },
            ...summaryExtra
          ]
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', backgroundColor: '#F5EED8',
          contents: footerBtns
        }
      }
    }])
  }
  if (['สรุป', 'ยืนยัน', 'confirm', 'c', 'summary'].includes(t)) {
    return reply(replyToken, [await summaryView(userId)])
  }
  if (['ล้าง', 'clear', 'reset', 'ลบทั้งหมด'].includes(t)) {
    await saveOrder(userId, {})
    return reply(replyToken, [{ type: 'text', text: '🗑 ล้างรายการแล้วครับ' }])
  }

  // Old commands still work
  if (['ขาย', 'sell'].includes(t)) {
    const { rows } = await pool.query('SELECT date,product_name,total_value FROM sell_transactions ORDER BY date DESC,id DESC LIMIT 10')
    const lines = rows.map(r => `${new Date(r.date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}  ${r.product_name}  ${fmt(r.total_value)}฿`).join('\n')
    return reply(replyToken, [{ type: 'text', text: `📊 ยอดขายล่าสุด:\n${lines || 'ไม่มีข้อมูล'}` }])
  }
  if (['คงเหลือ', 'stock'].includes(t)) {
    const { rows } = await pool.query('SELECT product_name,stock_qty,min_quantity,unit FROM inventory_view ORDER BY product_name')
    const low = rows.filter(r => r.stock_qty < r.min_quantity)
    const msg = low.length ? low.map(r => `⚠️ ${r.product_name}: ${r.stock_qty} ${r.unit} (ขั้นต่ำ ${r.min_quantity})`).join('\n') : '✅ Stock ทุกรายการอยู่ในเกณฑ์ดี'
    return reply(replyToken, [{ type: 'text', text: `📊 Stock ต่ำ:\n${msg}` }])
  }
  if (['เป้าหมาย', 'เป้า', 'target'].includes(t)) {
    const { rows } = await pool.query('SELECT year_month,target,actual,achievement_pct FROM targets ORDER BY year_month DESC LIMIT 3')
    const lines = rows.map(r => `${r.year_month}: เป้า ${fmt(r.target)} | จริง ${fmt(r.actual)} | ${parseFloat(r.achievement_pct).toFixed(1)}%`).join('\n')
    return reply(replyToken, [{ type: 'text', text: `🎯 เป้าหมาย:\n${lines || 'ไม่มีข้อมูล'}` }])
  }

}

// ── Slip scanning via Claude Vision ──────────────────────────────────────────

function categorizeByAccount(name: string): string | null {
  const n = name.toLowerCase()
  if (name.includes('วรวุฒิ'))                              return 'วรวุฒิ'
  if (name.includes('พริ้นติ้ง') || n.includes('printing')) return 'print'
  if (name.includes('แพ็ค')      || n.includes('pack'))     return 'pack'
  if (name.includes('ลักกี้')    || n.includes('lucky'))    return 'bb'
  if (name.includes('เจ วี อาร์') || n.includes('jvr'))    return 'กล่อง'
  return null
}

const SLIP_LABEL: Record<string, string> = {
  'วรวุฒิ': 'สลิปวรวุฒิ', 'print': 'สลิปPRINT',
  'pack': 'สลิปPACK', 'bb': 'สลิปBB', 'กล่อง': 'สลิปกล่อง',
}

async function handleImage(messageId: string, userId: string, replyToken: string, source?: Record<string, string>) {
  // Download image from LINE Content API
  const imgRes = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!imgRes.ok) return // ไม่ reply ถ้าไม่ใช่สลิป (อาจเป็นรูปทั่วไป)

  if (!process.env.ANTHROPIC_API_KEY) {
    return reply(replyToken, [{ type: 'text', text: '⚠️ ไม่สามารถสแกนสลิปได้ (ไม่มี ANTHROPIC_API_KEY)' }])
  }

  const buffer  = await imgRes.arrayBuffer()
  const base64  = Buffer.from(buffer).toString('base64')
  const mimeType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0]

  // Scan with Claude Vision
  let scanResult: { amount?: number; account_name?: string; date?: string; error?: string } = {}
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: 'นี่คือสลิปโอนเงิน กรุณาอ่านและตอบเป็น JSON เท่านั้น ไม่ต้องอธิบาย:\n{"amount": ตัวเลขยอดโอน (ไม่มีสัญลักษณ์), "account_name": "ชื่อบัญชีผู้รับ", "date": "YYYY-MM-DD"}\nถ้าไม่ใช่สลิปโอนเงินหรืออ่านไม่ได้ให้ตอบ: {"error": "not a slip"}' }
          ]
        }]
      })
    })
    const apiData = await apiRes.json()
    const text = apiData?.content?.[0]?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (jsonMatch) scanResult = JSON.parse(jsonMatch[0])
  } catch {
    return // scan error — ไม่ reply ถ้าอ่านไม่ออก
  }

  if (scanResult.error || !scanResult.amount) return // ไม่ใช่สลิปโอนเงิน

  // Determine category
  const category = scanResult.account_name ? categorizeByAccount(scanResult.account_name) : null

  // Find branch from group name or user
  let branchId: number | null = null
  if (source?.type === 'group' && source.groupId) {
    const groupName = await getGroupName(source.groupId)
    if (groupName) {
      const branch = await findBranchByGroupName(groupName)
      if (branch) branchId = branch.id
    }
  }
  if (!branchId) {
    const ub = await getBranchFromLineUser(userId)
    if (ub) branchId = ub.branch_id
  }

  // Save slip as pending
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  await pool.query(`
    INSERT INTO slips (branch_id, category, amount, account_name, slip_date, line_image_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    branchId,
    category ?? 'other',
    scanResult.amount,
    scanResult.account_name ?? null,
    scanResult.date ?? today,
    messageId,
  ])

  const catLabel  = category ? (SLIP_LABEL[category] ?? category) : '❓ ไม่ระบุหมวด'
  const fmtAmount = Number(scanResult.amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return reply(replyToken, [{
    type: 'text',
    text: `✅ รับสลิปแล้วครับ\n💰 ฿${fmtAmount}\n🏦 ${scanResult.account_name ?? '-'}\n📅 ${scanResult.date ?? today}\n📂 ${catLabel}\n\n⚠️ กรุณายืนยันข้อมูลในเว็บ สาขาและตัวแทน ด้วยครับ`,
  }])
}

// ── Webhook entry ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('x-line-signature') ?? ''
  if (!verifySignature(body, sig))
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })

  const { events = [] } = JSON.parse(body)

  await Promise.all(events.map(async (ev: Record<string, unknown>) => {
    const userId     = (ev.source as Record<string, string>)?.userId ?? ''
    const replyToken = ev.replyToken as string

    if (ev.type === 'postback') {
      const data = (ev.postback as Record<string, string>)?.data ?? ''
      await handlePostback(data, userId, replyToken)
    } else if (ev.type === 'message') {
      const msg = ev.message as Record<string, unknown>
      if (msg?.type === 'text')  await handleText(msg.text as string, userId, replyToken, ev.source as Record<string, string>)
      if (msg?.type === 'image') await handleImage(msg.id as string, userId, replyToken, ev.source as Record<string, string>)
    }
  }))

  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'LINE webhook active' })
}
