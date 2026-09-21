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

export async function push(to: string, messages: object[]) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to, messages }),
  })
}

function verifySignature(body: string, sig: string) {
  const hash = crypto.createHmac('sha256', SECRET).update(body).digest('base64')
  return hash === sig
}

// ── Session (DB) ──────────────────────────────────────────────────────────────

type InputState =
  | { type?: 'product_qty'; id: number; name: string; price: number; sec: number; sg: number; page: number }
  | { type: 'slip_edit'; slip_id: number; field: 'date' | 'account_name' | 'amount' }
  | { type: 'slip_purpose'; slip_id: number; purpose: 'PAY' | 'STORE'; matched_order_id?: number; matched_order_no?: string }

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
  // Ensure slips status column is wide enough for 'pending_confirm'
  await pool.query(`ALTER TABLE slips ALTER COLUMN status TYPE VARCHAR(30)`).catch(() => {})
  // Payment selection per user
  await pool.query(`ALTER TABLE line_sessions ADD COLUMN IF NOT EXISTS pay_selection JSONB DEFAULT '[]'`).catch(() => {})
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

async function getPaySelection(userId: string): Promise<string[]> {
  await ensureTable()
  const { rows } = await pool.query('SELECT pay_selection FROM line_sessions WHERE user_id=$1', [userId])
  return rows[0]?.pay_selection ?? []
}

async function setPaySelection(userId: string, sel: string[]) {
  await ensureTable()
  await pool.query(`
    INSERT INTO line_sessions (user_id, order_data, pay_selection, updated_at) VALUES ($1,'{}', $2, NOW())
    ON CONFLICT (user_id) DO UPDATE SET pay_selection=$2, updated_at=NOW()
  `, [userId, JSON.stringify(sel)])
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

// บันทึก LINE group ID ให้สาขา (ครั้งแรกที่เจอ หรืออัปเดตถ้าเปลี่ยน)
async function saveGroupId(branchId: number, groupId: string) {
  try {
    await pool.query(
      `UPDATE branches SET line_group_id = $1 WHERE id = $2`,
      [groupId, branchId]
    )
  } catch { /* ignore */ }
}

// ── Branch / Orders helpers ───────────────────────────────────────────────────

const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function fmtDateShortLine(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Bangkok',
  })
}

async function getLineDisplayName(userId: string, source?: Record<string, string>): Promise<string | null> {
  try {
    let url = `https://api.line.me/v2/bot/profile/${userId}`
    if (source?.type === 'group' && source.groupId) {
      url = `https://api.line.me/v2/bot/group/${source.groupId}/member/${userId}`
    } else if (source?.type === 'room' && source.roomId) {
      url = `https://api.line.me/v2/bot/room/${source.roomId}/member/${userId}`
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (!res.ok) return null
    const data = await res.json() as { displayName?: string }
    return data.displayName ?? null
  } catch { return null }
}

async function isLineAdmin(userId: string, source?: Record<string, string>): Promise<boolean> {
  const displayName = await getLineDisplayName(userId, source)
  if (displayName === 'TUA74^^') return true
  const info = await getBranchFromLineUser(userId)
  return info?.is_admin === true
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

// ── PromptPay QR ──────────────────────────────────────────────────────────────

function crc16(str: string): number {
  let crc = 0xFFFF
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) { crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1; crc &= 0xFFFF }
  }
  return crc
}

function f(tag: string, value: string) { return `${tag}${value.length.toString().padStart(2, '0')}${value}` }

function promptPayPayload(promptPayId: string, amount: number): string {
  // Normalize phone: 0812345678 → 0066812345678
  const acct = /^\d{10}$/.test(promptPayId) ? '0066' + promptPayId.slice(1) : promptPayId
  const merchantAcc = f('00', 'A000000677010111') + f('01', acct)
  const name = (process.env.PROMPTPAY_NAME ?? 'CF PACKAGING').slice(0, 25)
  const raw = [
    f('00', '01'), f('01', '12'),
    f('29', merchantAcc),
    f('52', '0000'), f('53', '764'),
    f('54', amount.toFixed(2)),
    f('58', 'TH'), f('59', name), f('60', 'BANGKOK'),
    '6304',
  ].join('')
  return raw + crc16(raw).toString(16).toUpperCase().padStart(4, '0')
}

function promptPayQrUrl(promptPayId: string, amount: number): string {
  const payload = promptPayPayload(promptPayId, amount)
  return `https://api.qrserver.com/v1/create-qr-code/?size=512x512&ecc=M&data=${encodeURIComponent(payload)}`
}

// ── Weekly summary helpers ────────────────────────────────────────────────────

interface WeekSummary {
  yr: number; wk: number
  total_count: number; total_amount: number
  paid_count: number; paid_amount: number; pending_amount: number
}

function getISOWeekInfo(): { year: number; week: number; dayOfWeek: number } {
  // Use Thai time UTC+7
  const now = new Date(Date.now() + 7 * 3600 * 1000)
  const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() || 7               // 1=Mon … 7=Sun
  const thu = new Date(d)
  thu.setUTCDate(d.getUTCDate() + 4 - dow)     // nearest Thursday
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((thu.getTime() - jan1.getTime()) / 86400000) + 1) / 7)
  return { year: thu.getUTCFullYear(), week, dayOfWeek: dow }
}

// ตรวจสอบบล็อกจาก DB โดยตรง (ครอบคลุมทุกออเดอร์ ไม่จำกัด 3 สัปดาห์)
// วันจันทร์: ยกเว้น W-1 (มี grace 1 สัปดาห์) → block ถ้ามีค้างก่อน W-1
// วันอื่น:   ไม่มี grace → block ถ้ามีค้างก่อน W-ปัจจุบัน
async function checkBlockedFromDB(branchId: number): Promise<boolean> {
  const { dayOfWeek } = getISOWeekInfo()
  // Monday: weeksBack=1 → cutoff = start of last week (W-1 start)
  // Tue-Sun: weeksBack=0 → cutoff = start of this week (W-0 start)
  const weeksBack = dayOfWeek === 1 ? 1 : 0
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM booking_orders
      WHERE branch_id = $1
        AND payment_status != 'paid'
        AND created_at AT TIME ZONE 'Asia/Bangkok' <
            date_trunc('week', NOW() AT TIME ZONE 'Asia/Bangkok') - ($2 * INTERVAL '1 week')
    ) AS blocked
  `, [branchId, weeksBack])
  return rows[0]?.blocked === true
}

function isoWeekStart(yr: number, wk: number): Date {
  const jan4 = new Date(Date.UTC(yr, 0, 4))
  const jan4Dow = jan4.getUTCDay() || 7
  const start = new Date(jan4)
  start.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (wk - 1) * 7)
  return start
}

function weekLabel(yr: number, wk: number): string {
  const s = isoWeekStart(yr, wk)
  const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6)
  const sm = TH_MONTHS[s.getUTCMonth()], em = TH_MONTHS[e.getUTCMonth()]
  const range = sm === em
    ? `${s.getUTCDate()}–${e.getUTCDate()} ${sm}`
    : `${s.getUTCDate()} ${sm}–${e.getUTCDate()} ${em}`
  return `W${wk} (${range} ${(yr + 543).toString().slice(-2)})`
}

async function getWeeklySummary(branchId: number): Promise<WeekSummary[]> {
  const { rows } = await pool.query(`
    SELECT
      EXTRACT(ISOYEAR FROM created_at AT TIME ZONE 'Asia/Bangkok')::int AS yr,
      EXTRACT(WEEK   FROM created_at AT TIME ZONE 'Asia/Bangkok')::int AS wk,
      COUNT(*)::int AS total_count,
      SUM(total_amount)::float AS total_amount,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid_count,
      SUM(CASE WHEN payment_status = 'paid'  THEN total_amount ELSE 0 END)::float AS paid_amount,
      SUM(CASE WHEN payment_status != 'paid' THEN total_amount ELSE 0 END)::float AS pending_amount
    FROM booking_orders
    WHERE branch_id = $1
    GROUP BY yr, wk
    HAVING
      -- แสดงทุกสัปดาห์ที่มียอดค้างชำระ (ไม่จำกัดช่วงเวลา)
      SUM(CASE WHEN payment_status != 'paid' THEN 1 ELSE 0 END) > 0
      OR
      -- หรือ 3 สัปดาห์ล่าสุดสำหรับบริบท (แม้ชำระครบแล้ว)
      MAX(created_at) AT TIME ZONE 'Asia/Bangkok' >=
        date_trunc('week', NOW() AT TIME ZONE 'Asia/Bangkok') - INTERVAL '2 weeks'
    ORDER BY yr DESC, wk DESC
    LIMIT 20
  `, [branchId])
  return rows as WeekSummary[]
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

async function paymentView(branchId: number, branchName: string, userId: string): Promise<object> {
  const [pending, rawSel] = await Promise.all([
    getPendingOrders(branchId),
    getPaySelection(userId),
  ])

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

  const pendingNos  = new Set(pending.map((o: Record<string, string>) => o.order_no))
  const selectedSet = new Set(rawSel.filter(no => pendingNos.has(no)))
  const totalAll    = pending.reduce((s: number, o: Record<string, number>) => s + (o.total_amount ?? 0), 0)
  const totalSel    = pending
    .filter((o: Record<string, string>) => selectedSet.has(o.order_no))
    .reduce((s: number, o: Record<string, number>) => s + (o.total_amount ?? 0), 0)
  const selCount = selectedSet.size

  const orderRows = pending.map((o: Record<string, string | number>) => {
    const isSel = selectedSet.has(String(o.order_no))
    return {
      type: 'box', layout: 'horizontal', margin: 'xs', paddingAll: '8px',
      backgroundColor: isSel ? '#fff1f2' : '#fafafa', cornerRadius: '6px',
      contents: [
        { type: 'box', flex: 6, layout: 'vertical', justifyContent: 'center', contents: [
          { type: 'text', text: `#${o.order_no}`, size: 'xs', weight: 'bold', color: isSel ? '#dc2626' : '#333333' },
          { type: 'text', text: fmtDateShortLine(String(o.created_at)), size: 'xs', color: '#aaaaaa' }
        ]},
        { type: 'text', text: `฿${fmt(Number(o.total_amount))}`, size: 'xs', flex: 4, align: 'end',
          color: isSel ? '#dc2626' : '#f59e0b', weight: 'bold' },
        { type: 'button', flex: 2,
          action: { type: 'postback', label: isSel ? '✔' : '○', data: `PAY_TOGGLE:${branchId}:${o.order_no}` },
          style: isSel ? 'primary' : 'secondary', color: isSel ? '#ef4444' : undefined, height: 'sm' }
      ]
    }
  })

  const summaryBox = {
    type: 'box', layout: 'horizontal', margin: 'md', paddingAll: '10px',
    backgroundColor: '#f9fafb', cornerRadius: '8px',
    contents: [
      { type: 'box', flex: 6, layout: 'vertical', contents: [
        { type: 'text', text: selCount > 0 ? `เลือก ${selCount} ใบ` : 'ยังไม่ได้เลือก', size: 'sm', weight: 'bold', color: selCount > 0 ? '#dc2626' : '#888888' },
        { type: 'text', text: `ทั้งหมด ${pending.length} ใบ · ฿${fmt(totalAll)}`, size: 'xs', color: '#888888', margin: 'xs' }
      ]},
      { type: 'text', text: selCount > 0 ? `฿${fmt(totalSel)}` : '-', size: 'lg', flex: 4, align: 'end', weight: 'bold', color: '#dc2626' }
    ]
  }

  const footerBtns: object[] = [
    {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'button', flex: 1, action: { type: 'postback', label: '✔ ทั้งหมด', data: `PAY_SELECTALL:${branchId}` }, style: 'secondary', height: 'sm' },
        { type: 'button', flex: 1, action: { type: 'postback', label: '○ ล้าง', data: `PAY_CLEARSEL:${branchId}` }, style: 'secondary', height: 'sm' }
      ]
    }
  ]

  if (selCount > 0 && process.env.PROMPTPAY_ID) {
    footerBtns.push({
      type: 'button',
      action: { type: 'postback', label: `💳 สร้าง QR ฿${fmt(totalSel)} (${selCount} ใบ)`, data: `PAY_QR:${branchId}` },
      style: 'primary', color: '#dc2626', height: 'sm'
    })
  } else if (selCount > 0) {
    footerBtns.push({ type: 'text', text: '⚠️ ยังไม่ได้ตั้งค่า PROMPTPAY_ID', size: 'xs', color: '#dc2626', align: 'center', margin: 'sm' })
  }

  footerBtns.push({ type: 'button', action: { type: 'postback', label: '← กลับ', data: `HIST:${branchId}` }, style: 'secondary', height: 'sm' })

  return {
    type: 'flex', altText: `💳 เลือกยอดชำระ — ${branchName}`,
    contents: {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#9b9484',
        contents: [
          { type: 'text', text: '💳 เลือกยอดที่ต้องการชำระ', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: branchName, color: '#aaffaa', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '12px',
        contents: [
          { type: 'text', text: 'กด ○ เพื่อเลือก · กด ✔ เพื่อยกเลิกการเลือก', size: 'xs', color: '#888888' },
          { type: 'separator', margin: 'sm' },
          ...orderRows,
          { type: 'separator', margin: 'md' },
          summaryBox
        ]
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: footerBtns }
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

async function handlePostback(data: string, userId: string, replyToken: string, source?: Record<string, string>) {
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

  // PAYVIEW: show selectable pending orders
  if (data.startsWith('PAYVIEW:')) {
    const branchId = parseInt(data.split(':')[1])
    const { rows: br } = await pool.query('SELECT name FROM branches WHERE id=$1', [branchId])
    return reply(replyToken, [await paymentView(branchId, br[0]?.name ?? `สาขา #${branchId}`, userId)])
  }

  // PAY_TOGGLE:{branchId}:{orderNo} — อัปเดต DB อย่างเดียว ไม่ส่งข้อความในกลุ่ม
  if (data.startsWith('PAY_TOGGLE:')) {
    const parts   = data.split(':')
    const orderNo = parts[2]
    const sel     = await getPaySelection(userId)
    await setPaySelection(userId, sel.includes(orderNo) ? sel.filter(s => s !== orderNo) : [...sel, orderNo])
    return
  }

  // PAY_SELECTALL:{branchId} — อัปเดต DB อย่างเดียว
  if (data.startsWith('PAY_SELECTALL:')) {
    const branchId = parseInt(data.split(':')[1])
    const pending  = await getPendingOrders(branchId)
    await setPaySelection(userId, pending.map((o: Record<string, string>) => o.order_no))
    return
  }

  // PAY_CLEARSEL:{branchId} — อัปเดต DB อย่างเดียว
  if (data.startsWith('PAY_CLEARSEL:')) {
    await setPaySelection(userId, [])
    return
  }

  // PAY_QR:{branchId} — generate PromptPay QR for selected orders
  if (data.startsWith('PAY_QR:')) {
    const branchId = parseInt(data.split(':')[1])
    const promptPayId = process.env.PROMPTPAY_ID
    if (!promptPayId) return reply(replyToken, [{ type: 'text', text: '⚠️ ยังไม่ได้ตั้งค่า PROMPTPAY_ID' }])

    const [pending, sel] = await Promise.all([getPendingOrders(branchId), getPaySelection(userId)])
    const pendingNos = new Set(pending.map((o: Record<string, string>) => o.order_no))
    const validSel   = sel.filter(no => pendingNos.has(no))
    const selOrders  = pending.filter((o: Record<string, string>) => validSel.includes(o.order_no))
    const total      = selOrders.reduce((s: number, o: Record<string, number>) => s + (o.total_amount ?? 0), 0)

    if (!total) return reply(replyToken, [{ type: 'text', text: '⚠️ ยังไม่ได้เลือกรายการ กด ○ เพื่อเลือกก่อนครับ' }])

    const qrUrl   = promptPayQrUrl(promptPayId, total)
    const orderNos = selOrders.map((o: Record<string, string>) => `#${o.order_no}`).join(', ')

    return reply(replyToken, [
      { type: 'image', originalContentUrl: qrUrl, previewImageUrl: qrUrl },
      { type: 'text', text: `💳 PromptPay\n฿${fmt(total)}\n\nรายการ: ${orderNos}\n\nสแกน QR โอนเงินได้เลยครับ\nเสร็จแล้วส่งสลิปในกลุ่มนี้` }
    ])
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
    const branchName = br[0]?.name ?? `สาขา #${branchId}`
    const stillBlocked = await checkBlockedFromDB(branchId)
    const msgs: object[] = [{
      type: 'text',
      text: `✅ บันทึกชำระเงินสำเร็จ!\n${branchName}\nอัปเดต ${rowCount} ใบจองแล้วครับ`
    }]
    if (!stillBlocked) {
      msgs.push(buildBookingOpenCard(branchName, `${BASE_URL}/booking2?branch_id=${branchId}&branch_name=${encodeURIComponent(branchName)}`))
    }
    return reply(replyToken, msgs)
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

  // SLIP_CONFIRM:{id}:{type} — confirm slip with category, mark branch orders paid
  if (data.startsWith('SLIP_CONFIRM:')) {
    // เฉพาะ admin เท่านั้นที่ยืนยันได้
    if (!await isLineAdmin(userId, source)) {
      return reply(replyToken, [{
        type: 'text',
        text: '❌ เฉพาะแอดมินเท่านั้นที่สามารถยืนยันรับสลิปได้\nกรุณาแจ้งผู้ดูแลระบบดำเนินการให้'
      }])
    }

    const parts    = data.split(':')
    const slipId   = parseInt(parts[1])
    const slipType = parts[2] ?? 'other'   // วรวุฒิ | print | pack | bb | กล่อง | other
    const slipTypeLabel = SLIP_TYPE_OPTS.find(o => o.key === slipType)?.label ?? slipType

    // Check if already confirmed
    const { rows: existing } = await pool.query('SELECT status FROM slips WHERE id=$1', [slipId])
    if (existing[0]?.status === 'confirmed') {
      return reply(replyToken, [{ type: 'text', text: '✅ ดำเนินการไปแล้วครับ' }])
    }
    const { rows: [slip] } = await pool.query(
      `UPDATE slips SET status='confirmed', category=$2, applied=true WHERE id=$1 RETURNING branch_id, amount`,
      [slipId, slipType]
    )
    const slipBranchId: number | null = slip?.branch_id ?? null
    const slipAmount: number = parseFloat(slip?.amount ?? '0') || 0

    if (slipBranchId !== null) {
      // หักยอดใบจองค้างชำระจากเก่าสุดก่อน จนหมดยอดสลิป
      const { rows: pending } = await pool.query(`
        SELECT id, order_no, total_amount FROM booking_orders
        WHERE branch_id=$1 AND payment_status != 'paid' AND status != 'cancelled'
        ORDER BY created_at ASC
      `, [slipBranchId])
      let left = slipAmount
      for (const o of pending) {
        if (left <= 0) break
        const amt = parseFloat(o.total_amount) || 0
        if (left >= amt) {
          await pool.query(
            `UPDATE booking_orders SET payment_status='paid', payment_bank=$2, updated_at=NOW() WHERE id=$1`,
            [o.id, slipTypeLabel]
          )
          left -= amt
        }
        // ถ้ายอดสลิปไม่พอปิดบิลนี้ ไม่มาร์คว่าชำระแล้ว (รอโอนส่วนที่เหลือ)
      }
    }

    const { rows: br } = slipBranchId !== null
      ? await pool.query('SELECT name FROM branches WHERE id=$1', [slipBranchId])
      : { rows: [] as {name:string}[] }
    const branchName = br[0]?.name ?? ''

    const msgs: object[] = [{
      type: 'text',
      text: `🙏 ขอบคุณครับ\nบันทึก${slipTypeLabel} ฿${slipAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} เรียบร้อย${branchName ? `\nสาขา: ${branchName}` : ''}`
    }]
    if (slipBranchId !== null) {
      const stillBlocked = await checkBlockedFromDB(slipBranchId)
      if (!stillBlocked) {
        msgs.push(buildBookingOpenCard(branchName, `${BASE_URL}/booking2?branch_id=${slipBranchId}&branch_name=${encodeURIComponent(branchName)}`))
      }
    }
    return reply(replyToken, msgs)
  }

  // SLIP_PAY:{id} — ชำระยอดค้าง: ยืนยันสลิป + ปิดบิล + applied=true (เทาในสาขา)
  if (data.startsWith('SLIP_PAY:')) {
    if (!await isLineAdmin(userId, source)) {
      return reply(replyToken, [{ type: 'text', text: '❌ เฉพาะแอดมินเท่านั้นที่สามารถยืนยันรับสลิปได้\nกรุณาแจ้งผู้ดูแลระบบดำเนินการให้' }])
    }
    const slipId = parseInt(data.split(':')[1])
    const { rows: existing } = await pool.query('SELECT status FROM slips WHERE id=$1', [slipId])
    if (existing[0]?.status === 'confirmed') {
      return reply(replyToken, [{ type: 'text', text: '✅ ดำเนินการไปแล้วครับ' }])
    }
    const { rows: [slip] } = await pool.query(
      `UPDATE slips SET status='confirmed', applied=true WHERE id=$1 RETURNING branch_id, amount, category`,
      [slipId]
    )
    const slipBranchId: number | null = slip?.branch_id ?? null
    const slipAmount: number = parseFloat(slip?.amount ?? '0') || 0
    if (slipBranchId !== null) {
      const { rows: pending } = await pool.query(`
        SELECT id, total_amount FROM booking_orders
        WHERE branch_id=$1 AND payment_status != 'paid' AND status != 'cancelled'
        ORDER BY created_at ASC
      `, [slipBranchId])
      let left = slipAmount
      for (const o of pending) {
        if (left <= 0) break
        const amt = parseFloat(o.total_amount) || 0
        if (left >= amt) {
          await pool.query(
            `UPDATE booking_orders SET payment_status='paid', payment_bank='ชำระยอดค้าง', updated_at=NOW() WHERE id=$1`,
            [o.id]
          )
          left -= amt
        }
      }
    }
    const { rows: br } = slipBranchId !== null
      ? await pool.query('SELECT name FROM branches WHERE id=$1', [slipBranchId])
      : { rows: [] as {name:string}[] }
    const branchName = br[0]?.name ?? ''
    const msgs: object[] = [{
      type: 'text',
      text: `✅ บันทึกชำระยอดค้างเรียบร้อย\n฿${slipAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}${branchName ? `\nสาขา: ${branchName}` : ''}`
    }]
    if (slipBranchId !== null) {
      const stillBlocked = await checkBlockedFromDB(slipBranchId)
      if (!stillBlocked) msgs.push(buildBookingOpenCard(branchName, `${BASE_URL}/booking2?branch_id=${slipBranchId}&branch_name=${encodeURIComponent(branchName)}`))
    }
    return reply(replyToken, msgs)
  }

  // SLIP_STORE:{id} — ไว้หักค่าของ: ยืนยันสลิป แต่ไม่ปิดบิล (available ใน payment modal)
  if (data.startsWith('SLIP_STORE:')) {
    if (!await isLineAdmin(userId, source)) {
      return reply(replyToken, [{ type: 'text', text: '❌ เฉพาะแอดมินเท่านั้นที่สามารถยืนยันรับสลิปได้\nกรุณาแจ้งผู้ดูแลระบบดำเนินการให้' }])
    }
    const slipId = parseInt(data.split(':')[1])
    const { rows: existing } = await pool.query('SELECT status FROM slips WHERE id=$1', [slipId])
    if (existing[0]?.status === 'confirmed') {
      return reply(replyToken, [{ type: 'text', text: '✅ ดำเนินการไปแล้วครับ' }])
    }
    const { rows: [slip] } = await pool.query(
      `UPDATE slips SET status='confirmed', applied=false WHERE id=$1 RETURNING branch_id, amount`,
      [slipId]
    )
    const slipBranchId: number | null = slip?.branch_id ?? null
    const slipAmount: number = parseFloat(slip?.amount ?? '0') || 0
    const { rows: br } = slipBranchId !== null
      ? await pool.query('SELECT name FROM branches WHERE id=$1', [slipBranchId])
      : { rows: [] as {name:string}[] }
    const branchName = br[0]?.name ?? ''
    return reply(replyToken, [{
      type: 'text',
      text: `✅ บันทึกยอดไว้หักค่าของเรียบร้อย\n฿${slipAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}${branchName ? `\nสาขา: ${branchName}` : ''}\nสามารถนำยอดนี้ไปหักค่าของได้ในหน้าแจ้งชำระเงิน`
    }])
  }

  // SLIP_CANCEL:{id} — ลบสลิปออก (ไม่ใช่สลิปจริง)
  if (data.startsWith('SLIP_CANCEL:')) {
    const slipId = parseInt(data.split(':')[1])
    try {
      await pool.query(`DELETE FROM slips WHERE id = $1`, [slipId])
    } catch { /* ignore if already gone */ }
    await setInputState(userId, null)
    return reply(replyToken, [{ type: 'text', text: '🗑️ ลบรูปนี้ออกแล้ว (ไม่ใช่สลิปโอนเงิน)' }])
  }

  // SLIP_EDIT:{id}:{field} — ask user to type corrected value
  if (data.startsWith('SLIP_EDIT:')) {
    const parts = data.split(':')
    const slipId = parseInt(parts[1])
    const field  = parts[2] as 'date' | 'account_name' | 'amount'
    const prompts: Record<string, string> = {
      date:         '📅 แก้ไขวันที่โอน\nพิมพ์ในรูปแบบ วว/ดด/ปปปป เช่น 12/09/2026\n(หรือ YYYY-MM-DD ก็ได้)',
      account_name: '👤 แก้ไขชื่อผู้รับ\nพิมพ์ชื่อที่ถูกต้อง',
      amount:       '💰 แก้ไขยอดเงิน\nพิมพ์ตัวเลขเท่านั้น เช่น 22254.10',
    }
    await setInputState(userId, { type: 'slip_edit', slip_id: slipId, field })
    return reply(replyToken, [{ type: 'text', text: prompts[field] ?? 'พิมพ์ข้อมูลใหม่:' }])
  }

  // SLIP_PURPOSE:{id}:{PAY|STORE} — ขั้นตอนที่ 1: เลือกวัตถุประสงค์
  if (data.startsWith('SLIP_PURPOSE:')) {
    if (!await isLineAdmin(userId, source)) {
      return reply(replyToken, [{ type: 'text', text: '❌ เฉพาะแอดมินเท่านั้นที่สามารถยืนยันรับสลิปได้\nกรุณาแจ้งผู้ดูแลระบบดำเนินการให้' }])
    }
    const parts   = data.split(':')
    const slipId  = parseInt(parts[1])
    const purpose = parts[2] as 'PAY' | 'STORE'

    const { rows: existing } = await pool.query('SELECT status, amount FROM slips WHERE id=$1', [slipId])
    if (existing[0]?.status === 'confirmed') {
      return reply(replyToken, [{ type: 'text', text: '✅ ดำเนินการไปแล้วครับ' }])
    }

    // Store purpose in session with matched order info if PAY
    let matched_order_id: number | undefined
    let matched_order_no: string | undefined
    if (purpose === 'PAY') {
      const slipAmt = parseFloat(existing[0]?.amount ?? '0')
      const { rows: [slip] } = await pool.query('SELECT branch_id FROM slips WHERE id=$1', [slipId])
      if (slip?.branch_id) {
        const { rows: pending } = await pool.query(`
          SELECT id, order_no, total_amount::float FROM booking_orders
          WHERE branch_id=$1 AND payment_status != 'paid' AND status != 'cancelled'
        `, [slip.branch_id])
        const match = pending.find(o => Math.abs(parseFloat(o.total_amount) - slipAmt) < 0.01)
        if (match) { matched_order_id = match.id; matched_order_no = match.order_no }
      }
    }
    await setInputState(userId, { type: 'slip_purpose', slip_id: slipId, purpose, matched_order_id, matched_order_no })

    const fmtAmt = Number(existing[0]?.amount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
    return reply(replyToken, [slipTypeCard(slipId, purpose, fmtAmt)])
  }

  // SLIP_TYPE:{id}:{type} — ขั้นตอนที่ 2: เลือกประเภทปลายทาง → confirm สมบูรณ์
  if (data.startsWith('SLIP_TYPE:')) {
    if (!await isLineAdmin(userId, source)) {
      return reply(replyToken, [{ type: 'text', text: '❌ เฉพาะแอดมินเท่านั้นที่สามารถยืนยันรับสลิปได้\nกรุณาแจ้งผู้ดูแลระบบดำเนินการให้' }])
    }
    const parts    = data.split(':')
    const slipId   = parseInt(parts[1])
    const slipType = parts[2]
    const slipTypeLabel = SLIP_TYPE_OPTS.find(o => o.key === slipType)?.label ?? slipType

    // ดึง purpose จาก session
    const state = await getInputState(userId)
    if (!state || state.type !== 'slip_purpose' || state.slip_id !== slipId) {
      return reply(replyToken, [{ type: 'text', text: '⚠️ กรุณาเลือกวัตถุประสงค์ (ชำระยอดตามบิล หรือ ไว้หักค่าของ) ก่อนครับ' }])
    }
    const { purpose, matched_order_id } = state

    const { rows: existing } = await pool.query('SELECT status FROM slips WHERE id=$1', [slipId])
    if (existing[0]?.status === 'confirmed') {
      await setInputState(userId, null)
      return reply(replyToken, [{ type: 'text', text: '✅ ดำเนินการไปแล้วครับ' }])
    }

    const applied = purpose === 'PAY'
    const { rows: [slip] } = await pool.query(
      `UPDATE slips SET status='confirmed', category=$2, applied=$3 WHERE id=$1 RETURNING branch_id, amount`,
      [slipId, slipType, applied]
    )
    await setInputState(userId, null)

    const slipBranchId: number | null = slip?.branch_id ?? null
    const slipAmount: number = parseFloat(slip?.amount ?? '0') || 0
    const msgs: object[] = []

    if (purpose === 'PAY' && slipBranchId !== null) {
      if (matched_order_id) {
        // ตัดใบจองที่ตรงกันโดยตรง
        await pool.query(
          `UPDATE booking_orders SET payment_status='paid', payment_bank=$2, updated_at=NOW() WHERE id=$1`,
          [matched_order_id, slipTypeLabel]
        )
      } else {
        // ตัดจากเก่าสุดก่อน
        const { rows: pending } = await pool.query(`
          SELECT id, total_amount FROM booking_orders
          WHERE branch_id=$1 AND payment_status != 'paid' AND status != 'cancelled'
          ORDER BY created_at ASC
        `, [slipBranchId])
        let left = slipAmount
        for (const o of pending) {
          if (left <= 0) break
          const amt = parseFloat(o.total_amount) || 0
          if (left >= amt) {
            await pool.query(
              `UPDATE booking_orders SET payment_status='paid', payment_bank=$2, updated_at=NOW() WHERE id=$1`,
              [o.id, slipTypeLabel]
            )
            left -= amt
          }
        }
      }
    }

    const { rows: br } = slipBranchId !== null
      ? await pool.query('SELECT name FROM branches WHERE id=$1', [slipBranchId])
      : { rows: [] as {name:string}[] }
    const branchName = br[0]?.name ?? ''
    const purposeLabel = purpose === 'PAY' ? 'ชำระยอดตามบิล' : 'ไว้หักค่าของ'

    msgs.push({
      type: 'text',
      text: `✅ บันทึกสลิปเรียบร้อย\n${slipTypeLabel} — ${purposeLabel}\n฿${slipAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}${branchName ? `\nสาขา: ${branchName}` : ''}`
    })

    if (purpose === 'PAY' && slipBranchId !== null) {
      const stillBlocked = await checkBlockedFromDB(slipBranchId)
      if (!stillBlocked) msgs.push(buildBookingOpenCard(branchName, `${BASE_URL}/booking2?branch_id=${slipBranchId}&branch_name=${encodeURIComponent(branchName)}`))
    }
    return reply(replyToken, msgs)
  }
}

// ── Text handler ──────────────────────────────────────────────────────────────

async function handleText(text: string, userId: string, replyToken: string, source?: Record<string, string>) {
  const t = text.trim().toLowerCase()

  // Check input state first (slip_edit or product_qty)
  const inputState = await getInputState(userId)

  // ── Slip edit: user typed corrected value ─────────────────────────────────
  if (inputState && inputState.type === 'slip_edit') {
    const { slip_id, field } = inputState
    await setInputState(userId, null)

    if (field === 'amount') {
      const num = parseFloat(text.trim().replace(/,/g, ''))
      if (isNaN(num) || num <= 0) {
        return reply(replyToken, [{ type: 'text', text: '❌ กรุณาพิมพ์ตัวเลขเท่านั้น เช่น 22254.10' }])
      }
      await pool.query(`UPDATE slips SET amount=$1 WHERE id=$2`, [num, slip_id])
    } else if (field === 'date') {
      const iso = parseDateInput(text.trim())
      if (!iso) {
        return reply(replyToken, [{ type: 'text', text: '❌ รูปแบบวันที่ไม่ถูกต้อง\nกรุณาพิมพ์ เช่น 12/09/2026 หรือ 2026-09-12' }])
      }
      await pool.query(`UPDATE slips SET slip_date=$1 WHERE id=$2`, [iso, slip_id])
    } else {
      await pool.query(`UPDATE slips SET account_name=$1 WHERE id=$2`, [text.trim(), slip_id])
    }

    const { rows: [slip] } = await pool.query(
      'SELECT id, amount, account_name, slip_date, created_at FROM slips WHERE id=$1', [slip_id]
    )
    if (!slip) return reply(replyToken, [{ type: 'text', text: '✅ แก้ไขแล้วครับ' }])
    return reply(replyToken, [
      { type: 'text', text: '✅ แก้ไขแล้วครับ กรุณาตรวจสอบอีกครั้ง:' },
      slipConfirmCard(slip)
    ])
  }

  // ── Product qty input: user typed a number after QI: prompt ──────────────
  const numVal = parseFloat(text.trim())
  if (!isNaN(numVal) && numVal > 0 && /^\d+(\.\d+)?$/.test(text.trim())) {
    if (inputState && (!inputState.type || inputState.type === 'product_qty')) {
      const state = inputState
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

  if (['ไอดีฉัน', 'id ฉัน', 'myid', 'my id', 'lineid'].includes(t)) {
    const isAdmin = await isLineAdmin(userId, source)
    return reply(replyToken, [{
      type: 'text',
      text: `🪪 LINE User ID ของคุณ:\n${userId}\n\n${isAdmin ? '✅ คุณเป็นแอดมินในระบบแล้ว' : '📋 นำ ID นี้ไปให้แอดมิน\nเพื่อเพิ่มสิทธิ์ในหน้า CF ระบบจัดการข้อมูล\n→ สาขาและตัวแทน → ผู้ใช้งาน → ใส่ LINE ID → ติ๊ก แอดมิน'}`
    }])
  }

  if (['ใบจอง', 'จอง', 'สั่งสินค้า', 'order', 'booking', 'เมนู', 'menu'].includes(t)) {
    // ── หาสาขา ───────────────────────────────────────────────────────────────
    let bookingUrl  = `${BASE_URL}/booking2`
    let branchLabel = 'ข้อมูลสินค้าและราคาล่าสุดจากระบบ'
    let branchId: number | null = null

    if (source?.type === 'group' && source.groupId) {
      const groupName = await getGroupName(source.groupId)
      if (groupName) {
        const branch = await findBranchByGroupName(groupName)
        if (branch) {
          bookingUrl  = `${BASE_URL}/booking2?branch_id=${branch.id}&branch_name=${encodeURIComponent(branch.name)}`
          branchLabel = `สาขา: ${branch.name}`
          branchId    = branch.id
          saveGroupId(branch.id, source.groupId)  // บันทึก group ID ไว้สำหรับส่งแจ้งเตือน
        }
      }
    }
    if (!branchId) {
      const ub = await getBranchFromLineUser(userId)
      if (ub) {
        branchId    = ub.branch_id
        branchLabel = `สาขา: ${ub.branch_name}`
        bookingUrl  = `${BASE_URL}/booking2?branch_id=${ub.branch_id}&branch_name=${encodeURIComponent(ub.branch_name)}`
      }
    }

    // ── สรุปรายสัปดาห์ + ตรวจสอบการบล็อก ────────────────────────────────────
    const { year: curYear, week: curWeek } = getISOWeekInfo()
    let weekRows: WeekSummary[] = []
    let blocked = false

    if (branchId !== null) {
      const [wRows, blockedResult] = await Promise.all([
        getWeeklySummary(branchId),
        checkBlockedFromDB(branchId),   // ตรวจทุกออเดอร์ใน DB ไม่จำกัด 3 สัปดาห์
      ])
      weekRows = wRows
      blocked  = blockedResult
    }

    // ── สร้าง body rows สรุปแต่ละสัปดาห์ ─────────────────────────────────────
    const weekBodyRows: object[] = weekRows.map(w => {
      const allPaid = w.pending_amount === 0
      const label   = weekLabel(w.yr, w.wk)
      return {
        type: 'box', layout: 'vertical', margin: 'sm', paddingAll: '8px',
        backgroundColor: allPaid ? '#f0fff4' : '#fff1f2', cornerRadius: '6px',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: label, size: 'xs', color: '#555555', weight: 'bold', flex: 5 },
              { type: 'text', text: allPaid ? '✅ ครบ' : '🔴 ค้าง', size: 'xs',
                color: allPaid ? '#4ade80' : '#ef4444', weight: 'bold', flex: 2, align: 'end' }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: `${w.total_count} ใบจอง`, size: 'xs', color: '#888888', flex: 3 },
              { type: 'text',
                text: allPaid
                  ? `฿${fmt(w.total_amount)}`
                  : `ค้าง ฿${fmt(w.pending_amount)} / ฿${fmt(w.total_amount)}`,
                size: 'xs', color: allPaid ? '#4ade80' : '#ef4444', flex: 7, align: 'end', weight: 'bold' }
            ]
          }
        ]
      }
    })

    // ── Footer buttons ────────────────────────────────────────────────────────
    const footerBtns: object[] = []

    if (blocked) {
      footerBtns.push({
        type: 'box', layout: 'vertical', backgroundColor: '#fef2f2',
        cornerRadius: '8px', paddingAll: '10px', margin: 'none',
        contents: [
          { type: 'text', text: '🔴 ค้างชำระ — จองสินค้าไม่ได้', weight: 'bold', size: 'sm', color: '#dc2626', align: 'center' },
          { type: 'text', text: 'ต้องชำระยอดค้างทั้งหมดก่อนจึงจะจองได้', size: 'xs', color: '#dc2626', align: 'center', margin: 'xs', wrap: true }
        ]
      })
    } else {
      footerBtns.push({
        type: 'button',
        action: { type: 'uri', label: '🛒 เปิดใบจองสินค้า', uri: bookingUrl },
        style: 'primary', color: '#9b9484', height: 'md'
      })
    }

    footerBtns.push({
      type: 'button',
      action: { type: 'uri', label: '📋 ประวัติใบจอง', uri: `${BASE_URL}/orders` },
      style: 'secondary', height: 'sm'
    })

    footerBtns.push({
      type: 'button',
      action: { type: 'uri', label: '💳 แจ้งชำระเงิน', uri: branchId && branchLabel.startsWith('สาขา: ')
        ? `${BASE_URL}/orders?pay=1&branch_name=${encodeURIComponent(branchLabel.replace('สาขา: ', ''))}`
        : `${BASE_URL}/orders?pay=1` },
      style: 'primary', color: '#ea580c', height: 'sm'
    })


    const bodyContents: object[] = [
      {
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: 'สรุปรายสัปดาห์', size: 'sm', weight: 'bold', color: '#9b9484', flex: 4 },
          { type: 'text', text: `สัปดาห์ปัจจุบัน W${curWeek}`, size: 'xs', color: '#aaaaaa', flex: 3, align: 'end' }
        ]
      },
      ...(weekBodyRows.length
        ? [{ type: 'separator', margin: 'sm' }, ...weekBodyRows]
        : [{ type: 'text', text: 'ยังไม่มีประวัติการสั่งซื้อ', size: 'sm', color: '#aaaaaa', margin: 'sm' }])
    ]

    return reply(replyToken, [{
      type: 'flex',
      altText: blocked ? '🔴 ค้างชำระ — จองสินค้าไม่ได้' : '📋 เปิดใบจองสินค้า',
      contents: {
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical',
          backgroundColor: blocked ? '#dc2626' : '#9b9484', paddingAll: '16px',
          contents: [
            { type: 'text', text: '📋 ใบจองสินค้า', color: '#ffffff', weight: 'bold', size: 'xl' },
            { type: 'text', text: branchLabel, color: blocked ? '#fecaca' : '#aaffaa', size: 'sm', margin: 'sm' }
          ]
        },
        body: {
          type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#F5EED8',
          contents: bodyContents
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

// ── Slip Confirm Card ─────────────────────────────────────────────────────────

interface SlipRow {
  id: number; amount: string | number; account_name: string | null
  slip_date: Date | string; created_at: Date | string
}

function buildBookingOpenCard(branchName: string, bookingUrl: string): object {
  return {
    type: 'flex', altText: '🟢 เปิดใบจองสินค้าได้แล้ว',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#16a34a', paddingAll: '16px',
        contents: [
          { type: 'text', text: '🟢 เปิดใบจองสินค้าได้แล้ว', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: branchName || 'ชำระครบแล้ว', color: '#bbf7d0', size: 'sm', margin: 'sm' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '🛒 เปิดใบจองสินค้า', uri: bookingUrl },
            style: 'primary', color: '#16a34a', height: 'md'
          }
        ]
      }
    }
  }
}

// ── slip category labels (same as web) ───────────────────────────────────────
const SLIP_TYPE_OPTS = [
  { key: 'วรวุฒิ', label: 'สลิปวรวุฒิ' },
  { key: 'print',  label: 'สลิปPrint'   },
  { key: 'pack',   label: 'สลิปPACK'    },
  { key: 'bb',     label: 'สลิปBB'      },
  { key: 'กล่อง', label: 'สลิปกล่อง'  },
]

type SlipAutoSuggest = {
  purpose: 'PAY' | 'STORE'
  orderNo?: string
  orderAmt?: number
}

function slipConfirmCard(slip: SlipRow, suggest?: SlipAutoSuggest): object {
  const fmtAmount = Number(slip.amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const slipDateIso = typeof slip.slip_date === 'string'
    ? slip.slip_date.slice(0, 10) : (slip.slip_date as Date).toISOString().slice(0, 10)
  const transferDateDisplay = new Date(slipDateIso + 'T12:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
  const sentDisplay = new Date(slip.created_at).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok'
  })

  const autoBox: object = suggest
    ? {
        type: 'box', layout: 'vertical', backgroundColor: suggest.purpose === 'PAY' ? '#dcfce7' : '#fef9c3',
        cornerRadius: '8px', paddingAll: '10px', margin: 'md',
        contents: [
          {
            type: 'text', size: 'xs', wrap: true,
            color: suggest.purpose === 'PAY' ? '#15803d' : '#92400e',
            text: suggest.purpose === 'PAY'
              ? `🔍 พบใบจอง ${suggest.orderNo} (฿${Number(suggest.orderAmt).toLocaleString('th-TH', { minimumFractionDigits: 2 })}) ตรงกับยอดสลิป\n→ แนะนำ: ชำระยอดตามบิล`
              : '🔍 ไม่พบใบจองที่ตรงกับยอดนี้\n→ แนะนำ: ไว้หักค่าของ'
          }
        ]
      }
    : { type: 'text', text: ' ', size: 'xs', color: '#ffffff', margin: 'none' }

  return {
    type: 'flex',
    altText: `🧾 สลิป ฿${fmtAmount} — กรุณายืนยัน`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: '#9b9484', paddingAll: '14px',
        contents: [
          {
            type: 'box', layout: 'vertical', flex: 1,
            contents: [
              { type: 'text', text: '🧾 ข้อมูลสลิปโอนเงิน', color: '#ffffff', weight: 'bold', size: 'md' },
              { type: 'text', text: `ส่งสลิปเมื่อ: ${sentDisplay}`, color: '#ffe8cc', size: 'xs', margin: 'xs' }
            ]
          },
          {
            type: 'button', flex: 0,
            action: { type: 'postback', label: '✕ ไม่ใช่สลิป', data: `SLIP_CANCEL:${slip.id}` },
            style: 'primary', color: '#CC0000', height: 'sm',
          }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', backgroundColor: '#F5EED8',
        contents: [
          { type: 'text', text: 'กรุณาตรวจสอบ — กด ✏️ เพื่อแก้ไข', size: 'xs', color: '#888888', margin: 'none' },
          { type: 'separator', margin: 'sm' },
          {
            type: 'box', layout: 'horizontal', margin: 'md', alignItems: 'center',
            contents: [
              { type: 'text', text: '📅 วันที่โอน', size: 'sm', flex: 4, color: '#555555' },
              { type: 'text', text: transferDateDisplay, size: 'sm', flex: 5, align: 'end', weight: 'bold', color: '#333333', wrap: true },
              { type: 'button', flex: 2, action: { type: 'postback', label: '✏️', data: `SLIP_EDIT:${slip.id}:date` }, style: 'secondary', height: 'sm' }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
            contents: [
              { type: 'text', text: '👤 ผู้รับ', size: 'sm', flex: 4, color: '#555555' },
              { type: 'text', text: slip.account_name ?? '-', size: 'sm', flex: 5, align: 'end', weight: 'bold', color: '#333333', wrap: true },
              { type: 'button', flex: 2, action: { type: 'postback', label: '✏️', data: `SLIP_EDIT:${slip.id}:account_name` }, style: 'secondary', height: 'sm' }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
            contents: [
              { type: 'text', text: '💰 ยอดเงิน', size: 'sm', flex: 4, color: '#555555' },
              { type: 'text', text: `฿${fmtAmount}`, size: 'md', flex: 5, align: 'end', weight: 'bold', color: '#9b5e00' },
              { type: 'button', flex: 2, action: { type: 'postback', label: '✏️', data: `SLIP_EDIT:${slip.id}:amount` }, style: 'secondary', height: 'sm' }
            ]
          },
          autoBox,
          { type: 'separator', margin: 'md' },
          { type: 'text', text: 'ขั้นตอนที่ 1: เลือกวัตถุประสงค์', size: 'xs', color: '#9b9484', weight: 'bold', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm',
            contents: [
              {
                type: 'button',
                action: { type: 'postback', label: '💳 ชำระยอดตามบิล', data: `SLIP_PURPOSE:${slip.id}:PAY` },
                style: suggest?.purpose === 'PAY' ? 'primary' : 'secondary',
                color: '#16a34a', flex: 1, height: 'sm',
              },
              {
                type: 'button',
                action: { type: 'postback', label: '🛒 ไว้หักค่าของ', data: `SLIP_PURPOSE:${slip.id}:STORE` },
                style: suggest?.purpose === 'STORE' ? 'primary' : 'secondary',
                color: '#9b9484', flex: 1, height: 'sm',
              }
            ]
          }
        ]
      }
    }
  }
}

function slipTypeCard(slipId: number, purpose: 'PAY' | 'STORE', fmtAmount: string): object {
  const purposeLabel = purpose === 'PAY' ? 'ชำระยอดตามบิล' : 'ไว้หักค่าของ'
  return {
    type: 'flex',
    altText: `🧾 เลือกประเภทสลิป ฿${fmtAmount}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: purpose === 'PAY' ? '#16a34a' : '#9b9484', paddingAll: '14px',
        contents: [
          { type: 'text', text: `✅ ${purposeLabel}`, color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: `ยอด ฿${fmtAmount}`, color: '#ffffff', size: 'sm', margin: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', backgroundColor: '#F5EED8',
        contents: [
          { type: 'text', text: 'ขั้นตอนที่ 2: เลือกประเภทปลายทางรับเงิน', size: 'xs', color: '#9b9484', weight: 'bold', margin: 'none' },
          { type: 'separator', margin: 'sm' },
          {
            type: 'box', layout: 'vertical', spacing: 'sm', margin: 'sm',
            contents: SLIP_TYPE_OPTS.map(opt => ({
              type: 'button',
              action: { type: 'postback', label: opt.label, data: `SLIP_TYPE:${slipId}:${opt.key}` },
              style: 'secondary', height: 'sm', color: '#9b9484',
            }))
          }
        ]
      }
    }
  }
}

function parseDateInput(raw: string): string | null {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (m) {
    let y = parseInt(m[3])
    if (y > 2500) y -= 543
    else if (y < 100) y += 2000
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
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
  try {
  // Download image from LINE Content API
  const imgRes = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!imgRes.ok) return // ไม่ reply ถ้าดาวน์โหลดรูปไม่ได้ (อาจเป็นรูปทั่วไป)

  if (!process.env.ANTHROPIC_API_KEY) {
    return reply(replyToken, [{ type: 'text', text: '⚠️ ไม่สามารถสแกนสลิปได้ (ไม่มี ANTHROPIC_API_KEY)' }])
  }

  const buffer  = await imgRes.arrayBuffer()
  const base64  = Buffer.from(buffer).toString('base64')
  const mimeType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0]

  // Scan with Claude Vision
  let scanResult: { amount?: number; account_name?: string; date?: string; error?: string } = {}
  let rawText = ''
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
            { type: 'text', text: 'นี่คือสลิปโอนเงิน กรุณาอ่านและตอบเป็น JSON เท่านั้น ไม่ต้องอธิบาย:\n{"amount": ตัวเลขยอดโอน (ไม่มีสัญลักษณ์ เช่น 22254.10), "account_name": "ชื่อบัญชีผู้รับ (เฉพาะชื่อ ไม่ต้องมีธนาคาร)", "date": "YYYY-MM-DD (วันที่โอนในรูปแบบ Gregorian)"}\nถ้าไม่ใช่สลิปโอนเงินหรืออ่านไม่ได้ให้ตอบ: {"error": "not a slip"}' }
          ]
        }]
      })
    })
    const apiData = await apiRes.json()
    console.log('[slip-scan] status:', apiRes.status, 'body:', JSON.stringify(apiData).slice(0, 400))
    // Handle Anthropic error response
    if (apiData?.type === 'error' || apiData?.error) {
      const errMsg = apiData?.error?.message ?? apiData?.message ?? JSON.stringify(apiData)
      return reply(replyToken, [{ type: 'text', text: `⚠️ Claude API error:\n${errMsg}` }])
    }
    rawText = apiData?.content?.[0]?.text ?? ''
    console.log('[slip-scan] raw text:', rawText)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) scanResult = JSON.parse(jsonMatch[0])
  } catch (e) {
    console.error('[slip-scan] error:', e)
    return reply(replyToken, [{ type: 'text', text: `⚠️ เกิดข้อผิดพลาดในการสแกนสลิป\n${String(e)}` }])
  }

  if (scanResult.error) {
    return // ไม่ใช่สลิป — ไม่ตอบ (รูปทั่วไป)
  }
  if (!scanResult.amount) {
    return reply(replyToken, [{ type: 'text', text: '🔍 รับรูปแล้ว แต่ไม่พบยอดเงินในสลิป\nลองส่งรูปใหม่ที่ชัดขึ้นได้เลยครับ' }])
  }

  // Determine category
  const category = scanResult.account_name ? categorizeByAccount(scanResult.account_name) : null

  // Find branch from group name or user
  let branchId: number | null = null
  if (source?.type === 'group' && source.groupId) {
    const groupName = await getGroupName(source.groupId)
    if (groupName) {
      const branch = await findBranchByGroupName(groupName)
      if (branch) {
        branchId = branch.id
        saveGroupId(branch.id, source.groupId)  // บันทึก group ID ไว้สำหรับส่งแจ้งเตือน
      }
    }
  }
  if (!branchId) {
    const ub = await getBranchFromLineUser(userId)
    if (ub) branchId = ub.branch_id
  }

  // Save slip as pending_confirm — wait for user to confirm
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const { rows: [slip] } = await pool.query(`
    INSERT INTO slips (branch_id, category, amount, account_name, slip_date, status, line_image_id)
    VALUES ($1, $2, $3, $4, $5, 'pending_confirm', $6)
    RETURNING id, amount, account_name, slip_date, created_at
  `, [
    branchId,
    category ?? 'other',
    scanResult.amount,
    scanResult.account_name ?? null,
    scanResult.date ?? today,
    messageId,
  ])

  // Auto-detect matching pending order
  let suggest: SlipAutoSuggest = { purpose: 'STORE' }
  if (branchId) {
    const { rows: pending } = await pool.query(`
      SELECT id, order_no, total_amount::float FROM booking_orders
      WHERE branch_id=$1 AND payment_status != 'paid' AND status != 'cancelled'
    `, [branchId])
    const matched = pending.find(o => Math.abs(parseFloat(o.total_amount) - scanResult.amount!) < 0.01)
    if (matched) {
      suggest = { purpose: 'PAY', orderNo: matched.order_no, orderAmt: matched.total_amount }
    }
  }

  return reply(replyToken, [slipConfirmCard(slip, suggest)])
  } catch (e) {
    console.error('[handleImage] error:', e)
    return reply(replyToken, [{ type: 'text', text: `⚠️ เกิดข้อผิดพลาดในการสแกนสลิป\n${String(e)}` }])
  }
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
    try {
      if (ev.type === 'postback') {
        const data = (ev.postback as Record<string, string>)?.data ?? ''
        await handlePostback(data, userId, replyToken, ev.source as Record<string, string>)
      } else if (ev.type === 'message') {
        const msg = ev.message as Record<string, unknown>
        if (msg?.type === 'text')  await handleText(msg.text as string, userId, replyToken, ev.source as Record<string, string>)
        if (msg?.type === 'image') await handleImage(msg.id as string, userId, replyToken, ev.source as Record<string, string>)
      }
    } catch (e) {
      console.error('[webhook] unhandled error for event', ev.type, e)
      try { await reply(replyToken, [{ type: 'text', text: `⚠️ เกิดข้อผิดพลาด\n${String(e)}` }]) } catch {}
    }
  }))

  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'LINE webhook active' })
}
