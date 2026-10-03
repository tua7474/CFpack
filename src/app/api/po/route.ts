import { NextResponse } from 'next/server'
import pool from '@/lib/db'

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const BASE_URL   = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://cf-production-6234.up.railway.app'

async function getWarehouseGroupId(): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'warehouse_group_id' LIMIT 1`
    )
    return rows[0]?.value ?? null
  } catch { return null }
}

async function pushToWarehouse(messages: object[]) {
  if (!LINE_TOKEN) return
  const groupId = await getWarehouseGroupId()
  if (!groupId) return
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: groupId, messages }),
  }).catch(() => {})
}

function poNotifyBubble(opts: {
  icon: string; title: string; poNo: string
  supplier?: string | null; detail?: string; detailColor?: string
}) {
  const detailUrl = `${BASE_URL}/po/detail?no=${encodeURIComponent(opts.poNo)}`
  return {
    type: 'flex',
    altText: `${opts.icon} ${opts.title} ${opts.poNo}`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical',
        paddingAll: '10px', spacing: 'xs',
        backgroundColor: '#e8f5e9',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center',
            contents: [
              { type: 'text', text: opts.icon, size: 'xl', flex: 0 },
              { type: 'text', text: opts.title, size: 'sm', weight: 'bold', color: '#1b5e20', flex: 3, wrap: true },
            ],
          },
          { type: 'separator', color: '#a5d6a7' },
          { type: 'text', text: opts.poNo, size: 'md', weight: 'bold', color: '#2e7d32' },
          ...(opts.supplier ? [{ type: 'text', text: opts.supplier, size: 'xs', color: '#555555' }] : []),
          ...(opts.detail   ? [{ type: 'text', text: opts.detail,   size: 'xs', color: opts.detailColor ?? '#777777', wrap: true }] : []),
          {
            type: 'box', layout: 'vertical', margin: 'sm',
            backgroundColor: '#4e7a5e', cornerRadius: '4px', paddingAll: '6px',
            action: { type: 'uri', uri: detailUrl },
            contents: [{ type: 'text', text: 'ดูรายละเอียด', size: 'xs', color: '#ffffff', align: 'center', weight: 'bold' }],
          },
        ],
      },
    },
  }
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS po_orders (
    id           SERIAL PRIMARY KEY,
    po_no        VARCHAR(20) UNIQUE NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    supplier     VARCHAR(200),
    notes        TEXT,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantities   JSONB NOT NULL DEFAULT '{}',
    foy_quantities      JSONB NOT NULL DEFAULT '{}',
    foy_item_quantities JSONB NOT NULL DEFAULT '{}',
    nv_total     DECIMAL(12,2),
    v_total      DECIMAL(12,2),
    factory_total DECIMAL(12,2),
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    received_at  TIMESTAMP
  )
`

async function ensureTable() {
  await pool.query(CREATE_TABLE)
  // Migrations for columns added after initial deploy
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS foy_quantities JSONB NOT NULL DEFAULT '{}'`)
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS foy_item_quantities JSONB NOT NULL DEFAULT '{}'`)
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS nv_total DECIMAL(12,2)`)
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS v_total DECIMAL(12,2)`)
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS factory_total DECIMAL(12,2)`)
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMP`)
  await pool.query(`ALTER TABLE po_orders ADD COLUMN IF NOT EXISTS delivery_due DATE`)
}

async function genPoNo(): Promise<string> {
  const thai = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const yy   = String(thai.getUTCFullYear()).slice(-2)
  const mo   = String(thai.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(thai.getUTCDate()).padStart(2, '0')
  const prefix = `PO${yy}${mo}${dd}`
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM po_orders WHERE po_no LIKE $1`,
    [`${prefix}%`]
  )
  const seq = (parseInt(rows[0].count) + 1).toString().padStart(3, '0')
  return `${prefix}-${seq}`
}

export async function GET(request: Request) {
  await ensureTable()

  // Support ?no=PO... for single order lookup
  const url = new URL(request.url)
  const no = url.searchParams.get('no')
  if (no) {
    const { rows } = await pool.query(`SELECT * FROM po_orders WHERE po_no = $1`, [no])
    return NextResponse.json(rows[0] ?? null)
  }

  const { rows } = await pool.query(
    `SELECT * FROM po_orders ORDER BY created_at DESC`
  )
  // Resolve product names for each PO
  const productIds = new Set<number>()
  for (const row of rows) {
    for (const id of Object.keys(row.quantities ?? {})) {
      productIds.add(Number(id))
    }
  }
  let productMap: Record<number, { product_name: string; group_name: string; price: string | null }> = {}
  if (productIds.size > 0) {
    const { rows: prods } = await pool.query(
      `SELECT id, product_name, group_name, price FROM products_catalog WHERE id = ANY($1)`,
      [Array.from(productIds)]
    )
    productMap = Object.fromEntries(prods.map(p => [p.id, p]))
  }

  const result = rows.map(row => ({
    ...row,
    items: Object.entries(row.quantities ?? {}).map(([pid, qty]) => {
      const p = productMap[Number(pid)]
      return {
        product_id:   Number(pid),
        product_name: p?.product_name ?? `#${pid}`,
        group_name:   p?.group_name ?? '',
        qty:          qty as number,
        price:        p?.price ? parseFloat(p.price) : 0,
      }
    }),
  }))

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  await ensureTable()
  const { supplier, notes, total_amount, quantities, foy_quantities, foy_item_quantities, nv_total, v_total, priorities } = await request.json()
  const po_no = await genPoNo()
  const { rows } = await pool.query(
    `INSERT INTO po_orders (po_no, supplier, notes, total_amount, quantities, foy_quantities, foy_item_quantities, nv_total, v_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      po_no,
      supplier ?? null,
      notes ?? null,
      total_amount ?? 0,
      JSON.stringify(quantities ?? {}),
      JSON.stringify(foy_quantities ?? {}),
      JSON.stringify(foy_item_quantities ?? {}),
      nv_total ?? null,
      v_total ?? null,
    ]
  )
  const created = rows[0]
  // Push notification to warehouse group
  pushToWarehouse([poNotifyBubble({
    icon: '📋', title: 'สร้างใบPO ใหม่',
    poNo: created.po_no,
    supplier: created.supplier,
    detail: `ยอดรวม ${parseFloat(created.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,
  })]).catch(() => {})

  return NextResponse.json(created, { status: 201 })
}

export async function PATCH(request: Request) {
  await ensureTable()
  const body = await request.json()
  const { id, po_no, order_no, status, supplier, notes, total_amount, quantities, foy_quantities, foy_item_quantities, nv_total, v_total, factory_total, ordered_at, delivery_due } = body

  // Support lookup by id, po_no, or order_no
  const lookupValue = id ?? po_no ?? order_no
  const lookupColumn = id ? 'id' : 'po_no'
  if (!lookupValue) return NextResponse.json({ error: 'id or po_no required' }, { status: 400 })

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (status              !== undefined) { sets.push(`status = $${i++}`);              vals.push(status) }
  if (supplier            !== undefined) { sets.push(`supplier = $${i++}`);            vals.push(supplier) }
  if (notes               !== undefined) { sets.push(`notes = $${i++}`);               vals.push(notes) }
  if (total_amount        !== undefined) { sets.push(`total_amount = $${i++}`);        vals.push(total_amount) }
  if (quantities          !== undefined) { sets.push(`quantities = $${i++}`);          vals.push(JSON.stringify(quantities)) }
  if (foy_quantities      !== undefined) { sets.push(`foy_quantities = $${i++}`);      vals.push(JSON.stringify(foy_quantities)) }
  if (foy_item_quantities !== undefined) { sets.push(`foy_item_quantities = $${i++}`); vals.push(JSON.stringify(foy_item_quantities)) }
  if (nv_total            !== undefined) { sets.push(`nv_total = $${i++}`);            vals.push(nv_total) }
  if (v_total             !== undefined) { sets.push(`v_total = $${i++}`);             vals.push(v_total) }
  if (factory_total       !== undefined) { sets.push(`factory_total = $${i++}`);       vals.push(factory_total) }
  if (ordered_at          !== undefined) {
    if (ordered_at === 'now') { sets.push(`ordered_at = NOW()`) }
    else { sets.push(`ordered_at = $${i++}`); vals.push(ordered_at) }
  }
  if (delivery_due        !== undefined) { sets.push(`delivery_due = $${i++}`);        vals.push(delivery_due) }

  if (status === 'received') {
    sets.push(`received_at = NOW()`)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  vals.push(lookupValue)
  const { rows } = await pool.query(
    `UPDATE po_orders SET ${sets.join(', ')} WHERE ${lookupColumn} = $${i} RETURNING *`,
    vals
  )

  // If marking received, add catalog stock (skip FOY items — their IDs are from paper_stock, not products_catalog)
  if (status === 'received' && rows[0]) {
    const qty: Record<string, number> = quantities ?? rows[0].quantities ?? {}
    let itemCount = 0
    for (const [idStr, q] of Object.entries(qty)) {
      if (!q || (q as number) <= 0) continue
      await pool.query(
        `UPDATE products_catalog SET quantity = COALESCE(quantity, 0) + $1, last_added_qty = $1, last_added_at = NOW() WHERE id = $2`,
        [q, Number(idStr)]
      )
      await pool.query(
        `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, 'po_receive', $2)`,
        [Number(idStr), q]
      )
      itemCount++
    }
    pushToWarehouse([poNotifyBubble({
      icon: '✅', title: 'รับสินค้าแล้ว — อัพเดทสต็อค',
      poNo: rows[0].po_no,
      supplier: rows[0].supplier,
      detail: `อัพเดทสต็อค ${itemCount} รายการเรียบร้อย`, detailColor: '#2e7d32',
    })]).catch(() => {})
  } else if (rows[0]) {
    // อัพเดทข้อมูลอื่นๆ
    const changed: string[] = []
    if (supplier    !== undefined) changed.push(`โรงงาน: ${supplier ?? '-'}`)
    if (notes       !== undefined) changed.push(`หมายเหตุ: ${notes ?? '-'}`)
    if (factory_total !== undefined) changed.push(`ยอดโรงงาน: ${factory_total ?? '-'}`)
    if (ordered_at  === 'now')     changed.push('สั่งสินค้าแล้ว')
    if (ordered_at  === null)      changed.push('ยกเลิกสถานะสั่ง')
    if (delivery_due !== undefined) changed.push(`กำหนดส่ง: ${delivery_due ?? '-'}`)
    if (changed.length > 0) {
      pushToWarehouse([poNotifyBubble({
        icon: '✏️', title: 'แก้ไขใบPO',
        poNo: rows[0].po_no,
        supplier: rows[0].supplier,
        detail: changed.join(' · '),
      })]).catch(() => {})
    }
  }

  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request) {
  await ensureTable()
  const { id } = await request.json()
  // Get PO info before delete for notification
  const { rows: before } = await pool.query(`SELECT po_no, supplier FROM po_orders WHERE id = $1`, [id])
  await pool.query(`DELETE FROM po_orders WHERE id = $1`, [id])
  if (before[0]) {
    pushToWarehouse([{
      type: 'flex',
      altText: `🗑️ ลบใบPO ${before[0].po_no}`,
      contents: {
        type: 'bubble', size: 'kilo',
        body: {
          type: 'box', layout: 'vertical',
          paddingAll: '10px', spacing: 'xs',
          backgroundColor: '#ffebee',
          contents: [
            {
              type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center',
              contents: [
                { type: 'text', text: '🗑️', size: 'xl', flex: 0 },
                { type: 'text', text: 'ลบใบPO แล้ว', size: 'sm', weight: 'bold', color: '#b71c1c', flex: 3 },
              ],
            },
            { type: 'separator', color: '#ef9a9a' },
            { type: 'text', text: before[0].po_no, size: 'md', weight: 'bold', color: '#c62828' },
            ...(before[0].supplier ? [{ type: 'text', text: before[0].supplier, size: 'xs', color: '#555555' }] : []),
          ],
        },
      },
    }]).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
