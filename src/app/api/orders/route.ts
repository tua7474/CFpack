import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── LINE push notification ────────────────────────────────────────────────────

const LINE_TOKEN  = process.env.LINE_CHANNEL_ACCESS_TOKEN!
const BASE_URL    = process.env.RAILWAY_PUBLIC_DOMAIN

// คืน true = สำเร็จ, false = ล้มเหลว (หยุดส่งต่อถ้าเจอ 429)
async function pushLineMsg(to: string, messages: object[]): Promise<boolean> {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[pushLineMsg] failed', res.status, body, 'to:', to)
    return false
  }
  return true
}

// ── fetchOrderDetails — ดึงข้อมูลครบจาก DB สำหรับ LINE notification ────────────

interface OrderDetails {
  branch_id: number | null
  branch_name: string
  total_amount: number
  nv_total: number | null
  v_total: number | null
  coupon_amount: number
  coupon_col: string
  vehicle_type: string
  withdrawal_type_name: string
  items: { name: string; qty: number; total: number }[]
}

async function fetchOrderDetails(order_no: string): Promise<OrderDetails | null> {
  const { rows: [order] } = await pool.query(`
    SELECT o.branch_id, o.branch_name,
           o.total_amount::float, o.nv_total::float, o.v_total::float,
           o.coupon_amount::float, o.coupon_col,
           o.vehicle_type, wt.name AS withdrawal_type_name,
           o.quantities, o.foy_item_quantities, o.foy_quantities
    FROM booking_orders o
    LEFT JOIN withdrawal_types wt ON wt.id = o.withdrawal_type_id
    WHERE o.order_no = $1
  `, [order_no])
  if (!order) return null

  const quantities: Record<string, number> = order.quantities ?? {}
  const foyItems: Record<string, number>   = order.foy_item_quantities ?? {}
  const foyQty: Record<string, { qty: number; amount: number }> = order.foy_quantities ?? {}

  const items: { name: string; qty: number; total: number }[] = []

  // Regular products
  const productIds = Object.keys(quantities).map(Number).filter(id => quantities[String(id)] > 0)
  if (productIds.length) {
    const { rows } = await pool.query(
      `SELECT id, product_name, price::float
       FROM products_catalog WHERE id = ANY($1)
       ORDER BY section_order, subgroup_order, id`,
      [productIds]
    )
    for (const p of rows) {
      const qty = quantities[String(p.id)] ?? 0
      if (qty > 0) items.push({ name: p.product_name, qty, total: p.price * qty })
    }
  }
  // FOY items (paper_stock)
  const foyItemIds = Object.keys(foyItems).map(Number).filter(id => foyItems[String(id)] > 0)
  if (foyItemIds.length) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (model_name) id, model_name, warehouse_price::float
       FROM paper_stock WHERE id = ANY($1) ORDER BY model_name, id`,
      [foyItemIds]
    )
    for (const fp of rows) {
      const qty = foyItems[String(fp.id)] ?? 0
      if (qty > 0) items.push({ name: fp.model_name, qty, total: fp.warehouse_price * qty })
    }
  }
  // Old FOY format
  for (const [model, data] of Object.entries(foyQty)) {
    if (data.qty > 0 && !items.find(x => x.name === model))
      items.push({ name: model, qty: data.qty, total: data.amount })
  }

  return {
    branch_id: order.branch_id ?? null,
    branch_name: order.branch_name ?? '',
    total_amount: order.total_amount ?? 0,
    nv_total: order.nv_total ?? null,
    v_total: order.v_total ?? null,
    coupon_amount: order.coupon_amount ?? 0,
    coupon_col: order.coupon_col ?? '',
    vehicle_type: order.vehicle_type ?? '',
    withdrawal_type_name: order.withdrawal_type_name ?? '',
    items,
  }
}

// ── buildBodyContents — body ของ Flex bubble พร้อมรายการสินค้า ───────────────

function buildBodyContents(order_no: string, d: OrderDetails, includeThank: boolean): object[] {
  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })
  const label = d.branch_name || 'ไม่ระบุสาขา'
  const contents: object[] = []

  // สาขา + เลขใบจอง
  contents.push({
    type: 'box', layout: 'horizontal', spacing: 'xs',
    contents: [
      { type: 'text', text: label,         size: 'xs', color: '#555555', flex: 3, weight: 'bold', wrap: true },
      { type: 'text', text: `#${order_no}`, size: 'xs', color: '#9b9484', flex: 2, align: 'end' },
    ],
  })

  // เบิกของ / จัดส่ง
  if (d.withdrawal_type_name || d.vehicle_type) {
    contents.push({
      type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
      contents: [
        ...(d.withdrawal_type_name ? [{ type: 'text', text: `เบิกของ: ${d.withdrawal_type_name}`, size: 'xxs', color: '#666666', flex: 1, wrap: true }] : []),
        ...(d.vehicle_type         ? [{ type: 'text', text: `จัดส่ง: ${d.vehicle_type}`,           size: 'xxs', color: '#666666', flex: 1, wrap: true }] : []),
      ],
    })
  }

  // รายการสินค้า
  if (d.items.length > 0) {
    contents.push({ type: 'separator', margin: 'sm', color: '#cccccc' })
    for (const item of d.items) {
      contents.push({
        type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
        contents: [
          { type: 'text', text: item.name,         size: 'xxs', color: '#333333', flex: 4, wrap: true },
          { type: 'text', text: `×${item.qty}`,    size: 'xxs', color: '#888888', flex: 1, align: 'end' },
          { type: 'text', text: fmt(item.total),   size: 'xxs', color: '#1a5c29', flex: 2, align: 'end', weight: 'bold' },
        ],
      })
    }
  }

  // ยอดรวม
  contents.push({ type: 'separator', margin: 'sm', color: '#cccccc' })
  if (d.nv_total != null && d.v_total != null) {
    contents.push({
      type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
      contents: [
        { type: 'text', text: 'ไม่มีใบกำกับ', size: 'xxs', color: '#c05000', flex: 3, wrap: true },
        { type: 'text', text: fmt(d.nv_total), size: 'xxs', color: '#c05000', flex: 2, align: 'end', weight: 'bold' },
      ],
    })
    contents.push({
      type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
      contents: [
        { type: 'text', text: 'มีใบกำกับ', size: 'xxs', color: '#555555', flex: 3, wrap: true },
        { type: 'text', text: fmt(d.v_total), size: 'xxs', color: '#555555', flex: 2, align: 'end', weight: 'bold' },
      ],
    })
  }
  if (d.coupon_amount > 0) {
    contents.push({
      type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
      contents: [
        { type: 'text', text: `ส่วนลด${d.coupon_col ? ` (${d.coupon_col})` : ''}`, size: 'xxs', color: '#c0004a', flex: 3, wrap: true },
        { type: 'text', text: `- ${fmt(d.coupon_amount)}`, size: 'xxs', color: '#c0004a', flex: 2, align: 'end', weight: 'bold' },
      ],
    })
  }
  contents.push({
    type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'sm',
    contents: [
      { type: 'text', text: 'ยอดรวม',           size: 'sm', color: '#27ae60', flex: 3, weight: 'bold' },
      { type: 'text', text: `฿${fmt(d.total_amount)}`, size: 'sm', color: '#27ae60', flex: 2, align: 'end', weight: 'bold' },
    ],
  })

  if (includeThank) {
    contents.push({
      type: 'text', text: 'ขอบคุณค่ะ รอแจ้งกำหนดส่ง/รับนะคะ',
      size: 'xxs', color: '#9b9484', align: 'center', wrap: true, margin: 'xs',
    })
  }
  return contents
}

// ── notifyNewBooking ──────────────────────────────────────────────────────────

async function notifyNewBooking(order_no: string) {
  if (!LINE_TOKEN) return
  try {
    const d = await fetchOrderDetails(order_no)
    if (!d) return

    const [branchRow, settingRow] = await Promise.all([
      d.branch_id ? pool.query(`SELECT line_group_id FROM branches WHERE id=$1`, [d.branch_id]) : null,
      pool.query(`SELECT value FROM system_settings WHERE key='order_notify_group_id'`).catch(() => ({ rows: [] })),
    ])
    const branchGroupId  = branchRow?.rows[0]?.line_group_id ?? null
    const centralGroupId = settingRow?.rows[0]?.value ?? null

    const fmt      = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })
    const baseUrl  = BASE_URL ? `https://${BASE_URL}` : 'https://cf-production-6234.up.railway.app'
    const editUrl  = `${baseUrl}/booking2?edit=${order_no}`
    const ordersUrl = `${baseUrl}/orders`

    const centralFlexMsg: object = {
      type: 'flex',
      altText: `✅ ใบจอง #${order_no} — ${d.branch_name || 'ไม่ระบุสาขา'} — ฿${fmt(d.total_amount)}`,
      contents: {
        type: 'bubble', size: 'mega',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#9b9484', paddingAll: '8px',
          contents: [{ type: 'text', text: '✅ จองสำเร็จ', weight: 'bold', color: '#ffffff', size: 'xs' }],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: buildBodyContents(order_no, d, false),
        },
        footer: {
          type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: [
            { type: 'button', style: 'primary', color: '#9b9484', height: 'sm', flex: 1,
              action: { type: 'uri', label: '✏️ แก้ไข', uri: editUrl } },
            { type: 'button', style: 'primary', color: '#4ade80', height: 'sm', flex: 1,
              action: { type: 'uri', label: '📦 ขึ้นของ', uri: ordersUrl } },
          ],
        },
      },
    }

    const branchFlexMsg: object = {
      type: 'flex',
      altText: `✅ จองสำเร็จ #${order_no} — ฿${fmt(d.total_amount)}`,
      contents: {
        type: 'bubble', size: 'mega',
        header: {
          type: 'box', layout: 'horizontal', backgroundColor: '#9b9484', paddingAll: '8px',
          alignItems: 'center', spacing: 'sm',
          contents: [
            { type: 'text', text: '✅ จองสำเร็จ', weight: 'bold', color: '#ffffff', size: 'xs', flex: 1 },
            { type: 'button', style: 'primary', color: '#4ade80', height: 'sm', flex: 0,
              action: { type: 'uri', label: 'รับออเดอร์', uri: ordersUrl } },
          ],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: buildBodyContents(order_no, d, true),
        },
      },
    }

    console.log('[notifyNewBooking] targets centralGroupId:', centralGroupId, 'branchGroupId:', branchGroupId, '| order:', order_no)
    if (!centralGroupId) { console.warn('[notifyNewBooking] order_notify_group_id not set in system_settings!'); return }
    const ok = await pushLineMsg(centralGroupId, [centralFlexMsg])
    if (!ok) return  // 429 หรือ error — หยุด ไม่ push ต่อ
    if (branchGroupId && branchGroupId !== centralGroupId)
      await pushLineMsg(branchGroupId, [branchFlexMsg])
  } catch (e) { console.error('[notifyNewBooking] error:', e) }
}

// ── notifyEditBooking ─────────────────────────────────────────────────────────

async function notifyEditBooking(order_no: string) {
  if (!LINE_TOKEN) return
  try {
    const d = await fetchOrderDetails(order_no)
    if (!d) return

    const [branchRow, settingRow] = await Promise.all([
      d.branch_id ? pool.query(`SELECT line_group_id FROM branches WHERE id=$1`, [d.branch_id]) : null,
      pool.query(`SELECT value FROM system_settings WHERE key='order_notify_group_id'`).catch(() => ({ rows: [] })),
    ])
    const branchGroupId  = branchRow?.rows[0]?.line_group_id ?? null
    const centralGroupId = settingRow?.rows[0]?.value ?? null

    const fmt      = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })
    const baseUrl  = BASE_URL ? `https://${BASE_URL}` : 'https://cf-production-6234.up.railway.app'
    const editUrl  = `${baseUrl}/booking2?edit=${order_no}`
    const ordersUrl = `${baseUrl}/orders`

    const centralMsg: object = {
      type: 'flex',
      altText: `✏️ แก้ไขใบจอง #${order_no} — ${d.branch_name || 'ไม่ระบุสาขา'} — ฿${fmt(d.total_amount)}`,
      contents: {
        type: 'bubble', size: 'mega',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#9b9484', paddingAll: '8px',
          contents: [{ type: 'text', text: '✏️ แก้ไขใบจองสำเร็จ', weight: 'bold', color: '#ffffff', size: 'xs' }],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: buildBodyContents(order_no, d, false),
        },
        footer: {
          type: 'box', layout: 'horizontal', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: [
            { type: 'button', style: 'primary', color: '#9b9484', height: 'sm', flex: 1,
              action: { type: 'uri', label: '✏️ แก้ไข', uri: editUrl } },
            { type: 'button', style: 'primary', color: '#4ade80', height: 'sm', flex: 1,
              action: { type: 'uri', label: '📦 ขึ้นของ', uri: ordersUrl } },
          ],
        },
      },
    }

    const branchMsg: object = {
      type: 'flex',
      altText: `✏️ แก้ไขใบจอง #${order_no} — ฿${fmt(d.total_amount)}`,
      contents: {
        type: 'bubble', size: 'mega',
        header: {
          type: 'box', layout: 'horizontal', backgroundColor: '#9b9484', paddingAll: '8px',
          alignItems: 'center', spacing: 'sm',
          contents: [
            { type: 'text', text: '✏️ แก้ไขใบจองสำเร็จ', weight: 'bold', color: '#ffffff', size: 'xs', flex: 1 },
            { type: 'button', style: 'primary', color: '#4ade80', height: 'sm', flex: 0,
              action: { type: 'uri', label: 'รับออเดอร์', uri: ordersUrl } },
          ],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: buildBodyContents(order_no, d, true),
        },
      },
    }

    const pushTasks: Promise<unknown>[] = []
    if (centralGroupId) pushTasks.push(pushLineMsg(centralGroupId, [centralMsg]))
    if (branchGroupId && branchGroupId !== centralGroupId) pushTasks.push(pushLineMsg(branchGroupId, [branchMsg]))
    await Promise.all(pushTasks)
  } catch (e) { console.error('[notifyEditBooking] error:', e) }
}

// ── notifyCancelBooking ───────────────────────────────────────────────────────

async function notifyCancelBooking(
  branch_id: number | null, order_no: string,
  total_amount: number, branch_name: string | null
) {
  if (!LINE_TOKEN) return
  try {
    const [branchRow, settingRow] = await Promise.all([
      branch_id ? pool.query(`SELECT line_group_id FROM branches WHERE id=$1`, [branch_id]) : null,
      pool.query(`SELECT value FROM system_settings WHERE key='order_notify_group_id'`).catch(() => ({ rows: [] })),
    ])
    const branchGroupId  = branchRow?.rows[0]?.line_group_id ?? null
    const centralGroupId = settingRow?.rows[0]?.value ?? null

    const fmt   = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 })
    const label = branch_name ?? (branch_id ? `สาขา #${branch_id}` : 'ไม่ระบุสาขา')

    const bodyContents = [
      {
        type: 'box', layout: 'horizontal', spacing: 'xs',
        contents: [
          { type: 'text', text: label,          size: 'xs', color: '#555555', flex: 3, weight: 'bold', wrap: true },
          { type: 'text', text: `#${order_no}`, size: 'xs', color: '#9b9484', flex: 3, align: 'end', wrap: false },
        ],
      },
      { type: 'text', text: `฿${fmt(total_amount)}`, size: 'sm', color: '#9b9484', weight: 'bold', align: 'center', margin: 'xs' },
    ]

    // ── กลุ่มกลาง ────────────────────────────────────────────────────────────
    const centralMsg: object = {
      type: 'flex',
      altText: `🗑️ ยกเลิกใบจองสำเร็จ #${order_no} — ${label}`,
      contents: {
        type: 'bubble', size: 'kilo',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#9b9484', paddingAll: '8px',
          contents: [{ type: 'text', text: '🗑️ ยกเลิกใบจองสำเร็จ', weight: 'bold', color: '#ffffff', size: 'xs' }],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: bodyContents,
        },
      },
    }

    // ── กลุ่มสาขา ────────────────────────────────────────────────────────────
    const branchMsg: object = {
      type: 'flex',
      altText: `🗑️ ยกเลิกใบจองสำเร็จ #${order_no}`,
      contents: {
        type: 'bubble', size: 'kilo',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#9b9484', paddingAll: '8px',
          contents: [{ type: 'text', text: '🗑️ ยกเลิกใบจองสำเร็จ', weight: 'bold', color: '#ffffff', size: 'xs' }],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '8px',
          backgroundColor: '#F5EED8',
          contents: [
            ...bodyContents,
            {
              type: 'text', text: 'ใบจองนี้ถูกยกเลิกแล้วค่ะ',
              size: 'xxs', color: '#9b9484', align: 'center', wrap: true, margin: 'xs',
            },
          ],
        },
      },
    }

    if (!centralGroupId) return
    const ok = await pushLineMsg(centralGroupId, [centralMsg])
    if (!ok) return  // 429 หรือ error — หยุด
    if (branchGroupId && branchGroupId !== centralGroupId)
      await pushLineMsg(branchGroupId, [branchMsg])
  } catch (e) { console.error('[notifyCancelBooking] error:', e) }
}

// ── Table ─────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS booking_orders (
    id             SERIAL PRIMARY KEY,
    order_no       VARCHAR(14) UNIQUE NOT NULL,
    total_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantities     JSONB        NOT NULL DEFAULT '{}',
    status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
    payment_status VARCHAR(20)  NOT NULL DEFAULT 'unpaid',
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP    NOT NULL DEFAULT NOW()
  )
`

// ── Generate order number (Thai time UTC+7) ────────────────────────────────────
// Format: YYMMDDHHmm (10 digits) — e.g. 2604211023

function genOrderNo(): string {
  const thai = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const yy   = String(thai.getUTCFullYear()).slice(-2)
  const mo   = String(thai.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(thai.getUTCDate()).padStart(2, '0')
  const hh   = String(thai.getUTCHours()).padStart(2, '0')
  const mn   = String(thai.getUTCMinutes()).padStart(2, '0')
  return `${yy}${mo}${dd}${hh}${mn}`
}

// ── GET — list all orders (or single order by ?no=XXXX) ───────────────────────

export async function GET(request: Request) {
  await pool.query(CREATE_TABLE)
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS pickup_status VARCHAR(20) NOT NULL DEFAULT 'pending'`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS payment_date  DATE`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS payment_bank  VARCHAR(100)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS source_type        VARCHAR(50)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS vehicle_type       VARCHAR(50)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS branch_name        VARCHAR(200)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS foy_quantities     JSONB NOT NULL DEFAULT '{}'`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS foy_item_quantities JSONB NOT NULL DEFAULT '{}'`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS priorities          JSONB NOT NULL DEFAULT '{}'`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS nv_total           DECIMAL(12,2)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS v_total            DECIMAL(12,2)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS paid_amount        DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS coupon_amount      DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS coupon_col              VARCHAR(10)`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS is_on_hold             BOOLEAN NOT NULL DEFAULT false`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS hold_reason            TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS hold_at               TIMESTAMPTZ`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS hold_by               TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS billing_start_date    DATE`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS expected_delivery_date DATE`).catch(() => {})
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_order_hold_log (
      id               SERIAL PRIMARY KEY,
      order_no         TEXT NOT NULL,
      action           TEXT NOT NULL,
      reason           TEXT,
      acted_by         TEXT,
      billing_start_date DATE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {})
  const { searchParams } = new URL(request.url)
  const no = searchParams.get('no')

  if (no) {
    const { rows } = await pool.query(
      'SELECT * FROM booking_orders WHERE order_no = $1', [no]
    )
    return NextResponse.json(rows[0] ?? null)
  }

  const { rows } = await pool.query(
    'SELECT * FROM booking_orders ORDER BY created_at DESC'
  )
  return NextResponse.json(rows)
}

// ── Deduct stock from products_catalog for each booked quantity ───────────────

async function deductStock(quantities: Record<string, number>) {
  for (const [idStr, qty] of Object.entries(quantities)) {
    if (!qty || qty <= 0) continue
    const id = Number(idStr)
    await pool.query(`
      UPDATE products_catalog
      SET quantity        = COALESCE(quantity, 0) - $1,
          last_booked_qty = $1,
          last_booked_at  = NOW(),
          updated_at      = NOW()
      WHERE id = $2
    `, [qty, id])
    await pool.query(
      `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, 'book', $2)`,
      [id, qty]
    )
  }
}

// ── POST — create new order ───────────────────────────────────────────────────

export async function POST(request: Request) {
  const { total_amount, quantities, branch_id, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id, priorities, nv_total, v_total, coupon_amount, coupon_col } = await request.json()
  await pool.query(CREATE_TABLE)
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS branch_id INT`).catch(() => {})
  await pool.query(`ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS withdrawal_type_id INT`).catch(() => {})

  let order_no = genOrderNo()

  try {
    const { rows } = await pool.query(
      `INSERT INTO booking_orders (order_no, total_amount, quantities, branch_id, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id, priorities, nv_total, v_total, coupon_amount, coupon_col)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [order_no, total_amount, JSON.stringify(quantities), branch_id ?? null, source_type ?? null, vehicle_type ?? null, branch_name ?? null,
       JSON.stringify(foy_quantities ?? {}), JSON.stringify(foy_item_quantities ?? {}), withdrawal_type_id ?? null, JSON.stringify(priorities ?? {}),
       nv_total ?? null, v_total ?? null, coupon_amount ?? 0, coupon_col ?? null]
    )
    if (source_type === 'โกดัง') await deductStock(quantities ?? {})
    notifyNewBooking(rows[0].order_no)
    return NextResponse.json(rows[0], { status: 201 })
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      order_no = order_no + String(new Date().getUTCSeconds()).padStart(2, '0')
      const { rows } = await pool.query(
        `INSERT INTO booking_orders (order_no, total_amount, quantities, branch_id, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id, priorities, nv_total, v_total, coupon_amount, coupon_col)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [order_no, total_amount, JSON.stringify(quantities), branch_id ?? null, source_type ?? null, vehicle_type ?? null, branch_name ?? null,
         JSON.stringify(foy_quantities ?? {}), JSON.stringify(foy_item_quantities ?? {}), withdrawal_type_id ?? null, JSON.stringify(priorities ?? {}),
         nv_total ?? null, v_total ?? null, coupon_amount ?? 0, coupon_col ?? null]
      )
      if (source_type === 'โกดัง') await deductStock(quantities ?? {})
      notifyNewBooking(rows[0].order_no)
      return NextResponse.json(rows[0], { status: 201 })
    }
    throw e
  }
}

// ── Adjust stock delta when editing an order ──────────────────────────────────
// delta > 0 → deduct more, delta < 0 → return to stock

async function adjustStockDelta(
  oldQty: Record<string, number>,
  newQty: Record<string, number>
) {
  const allIds = new Set([...Object.keys(oldQty), ...Object.keys(newQty)])
  for (const idStr of allIds) {
    const old = oldQty[idStr] ?? 0
    const next = newQty[idStr] ?? 0
    const delta = next - old
    if (delta === 0) continue
    const id = Number(idStr)
    await pool.query(`
      UPDATE products_catalog
      SET quantity        = COALESCE(quantity, 0) - $1,
          last_booked_qty = $2,
          last_booked_at  = NOW(),
          updated_at      = NOW()
      WHERE id = $3
    `, [delta, next, id])
    const action = delta > 0 ? 'book' : 'add'
    await pool.query(
      `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, $2, $3)`,
      [id, action, Math.abs(delta)]
    )
  }
}

// ── PATCH — update order (status / payment / quantities) ─────────────────────

export async function PATCH(request: Request) {
  const body = await request.json()
  const { order_no, status, payment_status, payment_date, payment_bank, pickup_status, total_amount, quantities, source_type, vehicle_type, branch_name, foy_quantities, foy_item_quantities, withdrawal_type_id, priorities, nv_total, v_total, coupon_amount, coupon_col } = body
  const { action: holdAction, reason: holdReason, acted_by: holdActedBy, expected_delivery_date } = body

  // ── พักบิล / ส่งของแล้ว ───────────────────────────────────────────────────
  if (holdAction === 'hold') {
    if (!holdReason?.trim()) return NextResponse.json({ error: 'กรุณาระบุเหตุผลการพักบิล' }, { status: 400 })
    await pool.query(`
      UPDATE booking_orders
      SET is_on_hold = true,
          hold_reason = $1,
          hold_at = NOW(),
          hold_by = $2,
          expected_delivery_date = $3,
          updated_at = NOW()
      WHERE order_no = $4
    `, [holdReason.trim(), holdActedBy ?? 'admin', expected_delivery_date ?? null, order_no])
    await pool.query(`
      INSERT INTO booking_order_hold_log (order_no, action, reason, acted_by)
      VALUES ($1, 'hold', $2, $3)
    `, [order_no, holdReason.trim(), holdActedBy ?? 'admin'])
    const { rows } = await pool.query('SELECT * FROM booking_orders WHERE order_no = $1', [order_no])
    return NextResponse.json(rows[0])
  }

  if (holdAction === 'resume') {
    const today = new Date(Date.now() + 7 * 3600 * 1000)
    const billingStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
    await pool.query(`
      UPDATE booking_orders
      SET is_on_hold = false,
          hold_reason = NULL,
          billing_start_date = $1,
          expected_delivery_date = NULL,
          updated_at = NOW()
      WHERE order_no = $2
    `, [billingStart, order_no])
    await pool.query(`
      INSERT INTO booking_order_hold_log (order_no, action, reason, acted_by, billing_start_date)
      VALUES ($1, 'resume', $2, $3, $4)
    `, [order_no, holdReason ?? null, holdActedBy ?? 'admin', billingStart])
    const { rows } = await pool.query('SELECT * FROM booking_orders WHERE order_no = $1', [order_no])
    return NextResponse.json(rows[0])
  }

  // Load old quantities + source_type for stock adjustment logic
  let oldQuantities: Record<string, number> = {}
  let oldSourceType: string | null = null
  if (quantities !== undefined || source_type !== undefined) {
    const { rows: old } = await pool.query(
      `SELECT quantities, source_type FROM booking_orders WHERE order_no = $1`, [order_no]
    )
    if (old.length > 0) {
      oldQuantities = old[0].quantities ?? {}
      oldSourceType = old[0].source_type ?? null
    }
  }

  const sets: string[] = ['updated_at = NOW()']
  const vals: unknown[] = []
  let i = 1

  if (status         !== undefined) { sets.push(`status = $${i++}`);         vals.push(status) }
  if (payment_status !== undefined) { sets.push(`payment_status = $${i++}`); vals.push(payment_status) }
  if (payment_date   !== undefined) { sets.push(`payment_date = $${i++}`);   vals.push(payment_date) }
  if (payment_bank   !== undefined) { sets.push(`payment_bank = $${i++}`);   vals.push(payment_bank) }
  if (pickup_status  !== undefined) { sets.push(`pickup_status = $${i++}`);  vals.push(pickup_status) }
  if (total_amount   !== undefined) { sets.push(`total_amount = $${i++}`);   vals.push(total_amount) }
  if (quantities     !== undefined) { sets.push(`quantities = $${i++}`);     vals.push(JSON.stringify(quantities)) }
  if (source_type         !== undefined) { sets.push(`source_type = $${i++}`);          vals.push(source_type) }
  if (vehicle_type        !== undefined) { sets.push(`vehicle_type = $${i++}`);         vals.push(vehicle_type) }
  if (branch_name         !== undefined) { sets.push(`branch_name = $${i++}`);          vals.push(branch_name) }
  if (foy_quantities      !== undefined) { sets.push(`foy_quantities = $${i++}`);       vals.push(JSON.stringify(foy_quantities)) }
  if (foy_item_quantities !== undefined) { sets.push(`foy_item_quantities = $${i++}`);  vals.push(JSON.stringify(foy_item_quantities)) }
  if (withdrawal_type_id  !== undefined) { sets.push(`withdrawal_type_id = $${i++}`);   vals.push(withdrawal_type_id) }
  if (priorities          !== undefined) { sets.push(`priorities = $${i++}`);           vals.push(JSON.stringify(priorities)) }
  if (nv_total            !== undefined) { sets.push(`nv_total = $${i++}`);             vals.push(nv_total) }
  if (v_total             !== undefined) { sets.push(`v_total = $${i++}`);              vals.push(v_total) }
  if (coupon_amount       !== undefined) { sets.push(`coupon_amount = $${i++}`);        vals.push(coupon_amount) }
  if (coupon_col          !== undefined) { sets.push(`coupon_col = $${i++}`);           vals.push(coupon_col) }

  vals.push(order_no)
  const { rows } = await pool.query(
    `UPDATE booking_orders SET ${sets.join(', ')} WHERE order_no = $${i} RETURNING *`,
    vals
  )

  if (quantities !== undefined) {
    const wasWarehouse = oldSourceType === 'โกดัง'
    const isWarehouse  = (source_type !== undefined ? source_type : oldSourceType) === 'โกดัง'
    if (wasWarehouse && isWarehouse) {
      // เดิม+ใหม่ = โกดัง → ปรับ delta ตามปกติ
      await adjustStockDelta(oldQuantities, quantities)
    } else if (wasWarehouse && !isWarehouse) {
      // เปลี่ยนจาก โกดัง → อื่น: คืนสต็อคเดิมทั้งหมด
      await adjustStockDelta(oldQuantities, {})
    } else if (!wasWarehouse && isWarehouse) {
      // เปลี่ยนจาก อื่น → โกดัง: ตัดสต็อคใหม่ทั้งหมด
      await adjustStockDelta({}, quantities)
    }
    // ทั้งสอง ≠ โกดัง: ไม่ตัดสต็อค
  }

  // แจ้ง LINE
  const updated = rows[0]
  if (status === 'cancelled') {
    // ยกเลิกใบจอง → แจ้งเฉพาะ cancel popup (ไม่มีปุ่มแก้ไข/ขึ้นของ)
    notifyCancelBooking(
      updated.branch_id ?? null,
      updated.order_no,
      parseFloat(updated.total_amount ?? '0'),
      updated.branch_name ?? null,
    ).catch(e => console.error('[PATCH notifyCancelBooking]', e))
  }

  return NextResponse.json(rows[0])
}
