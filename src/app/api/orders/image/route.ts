import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import pool from '@/lib/db'

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string | Date) {
  const d = new Date(iso)
  // Display in Bangkok time
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Group → section mapping (mirrors booking2/route.ts GROUP_MAP) ─────────────

type SecInfo = { section_order: number; section_name: string; is_vat_included: boolean; subgroup_order: number; subgroup_name: string }
const GROUP_MAP: Record<string, SecInfo> = {
  'กล่อง':              { section_order: 1, section_name: 'กล่อง',            is_vat_included: true,  subgroup_order: 0, subgroup_name: '' },
  'กล่อง Thank You':    { section_order: 2, section_name: 'กล่อง Thank You',  is_vat_included: false, subgroup_order: 1, subgroup_name: 'กล่อง Thank You' },
  'กล่องผลไม้ 5 ชั้น':  { section_order: 2, section_name: 'กล่อง Thank You',  is_vat_included: false, subgroup_order: 2, subgroup_name: 'กล่องผลไม้ 5 ชั้น' },
  'กล่องเอกสาร':        { section_order: 2, section_name: 'กล่อง Thank You',  is_vat_included: false, subgroup_order: 3, subgroup_name: 'กล่องเอกสาร' },
  'กล่อง 5 ชั้น':       { section_order: 2, section_name: 'กล่อง Thank You',  is_vat_included: false, subgroup_order: 4, subgroup_name: 'กล่อง 5 ชั้น' },
  'ถุงใส่กระดาษฝอย':    { section_order: 2, section_name: 'กล่อง Thank You',  is_vat_included: false, subgroup_order: 6, subgroup_name: 'ถุงใส่กระดาษฝอย' },
  'ซอง PP':             { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 1, subgroup_name: 'ซอง PP' },
  'ซองเมทาลิค':         { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 2, subgroup_name: 'ซองเมทาลิค' },
  'ซอง PP สี':          { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 3, subgroup_name: 'ซอง PP สี' },
  'ซองน้ำตาล':          { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 4, subgroup_name: 'ซองน้ำตาล' },
  'ซองขยายข้าง':        { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 5, subgroup_name: 'ซองขยายข้าง' },
  'ซองจ่าหน้า':         { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 6, subgroup_name: 'ซองจ่าหน้า' },
  'ซองบับเบิล':         { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 7, subgroup_name: 'ซองบับเบิล' },
  'ซองPPกันกระแทก':     { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 8, subgroup_name: 'ซองPPกันกระแทก' },
  'ฟิล์มยืด':           { section_order: 3, section_name: 'ซอง PP',           is_vat_included: false, subgroup_order: 9, subgroup_name: 'ฟิล์มยืด' },
  'บับเบิล':            { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 1, subgroup_name: 'บับเบิล' },
  'บับเบิลสี':          { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 2, subgroup_name: 'บับเบิลสี' },
  'บับเบิลบาง 35g':     { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 3, subgroup_name: 'บับเบิลบาง 35g' },
  'โฟมบาง 2 มิล':       { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 4, subgroup_name: 'โฟมบาง 2 มิล' },
  'ตัดเทป':             { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 5, subgroup_name: 'ตัดเทป' },
  'เทป OPP แกนดำ':      { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 6, subgroup_name: 'เทป OPP แกนดำ' },
  'เทประวังแตก':        { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 7, subgroup_name: 'เทประวังแตก' },
  'เทป OPP แกนส้ม':     { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 8, subgroup_name: 'เทป OPP แกนส้ม' },
  'เทป Thank You':      { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 9, subgroup_name: 'เทป Thank You' },
  'ถุงหิ้วบริการ':       { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 10, subgroup_name: 'ถุงหิ้วบริการ' },
  'ลาเบล 10x15':        { section_order: 4, section_name: 'บับเบิล',          is_vat_included: false, subgroup_order: 11, subgroup_name: 'ลาเบล 10x15' },
  'ถุงแก้วฝากาว 60M/100P': { section_order: 5, section_name: 'อื่นๆ',        is_vat_included: false, subgroup_order: 1, subgroup_name: 'ถุงแก้วฝากาว 60M/100P' },
  'ถุงซิปรูด':           { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 2, subgroup_name: 'ถุงซิปรูด' },
  'ซองใสปะหน้า':        { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 3, subgroup_name: 'ซองใสปะหน้า' },
  'กระบอก':             { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 4, subgroup_name: 'กระบอก' },
  'ฝาปิดกระบอก':        { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 5, subgroup_name: 'ฝาปิดกระบอก' },
  'สายรัด PP':          { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 6, subgroup_name: 'สายรัด PP' },
  'กระดาษห่อ':          { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 7, subgroup_name: 'กระดาษห่อ' },
  'เชือก':              { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 8, subgroup_name: 'เชือก' },
  'กระดาษพิมพ์สลิป':    { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 9, subgroup_name: 'กระดาษพิมพ์สลิป' },
  'ปากกาเขียน PP':      { section_order: 5, section_name: 'อื่นๆ',           is_vat_included: false, subgroup_order: 10, subgroup_name: 'ปากกาเขียน PP' },
  'ซองกันกระแทก':       { section_order: 6, section_name: 'Air Cushion',     is_vat_included: false, subgroup_order: 1, subgroup_name: 'ซองกันกระแทก' },
  'MINI AIR BAG ม้วนเปล่า': { section_order: 6, section_name: 'Air Cushion', is_vat_included: false, subgroup_order: 2, subgroup_name: 'MINI AIR BAG ม้วนเปล่า' },
  'AIRLOCK':            { section_order: 6, section_name: 'Air Cushion',     is_vat_included: false, subgroup_order: 3, subgroup_name: 'AIRLOCK' },
  'MINI AIR เครื่องเป่า': { section_order: 6, section_name: 'Air Cushion',   is_vat_included: false, subgroup_order: 4, subgroup_name: 'MINI AIR เครื่องเป่า' },
  'สติกเกอร์ระวังแตก':   { section_order: 6, section_name: 'Air Cushion',    is_vat_included: false, subgroup_order: 5, subgroup_name: 'สติกเกอร์ระวังแตก' },
  'เบิกฟรี':            { section_order: 6, section_name: 'Air Cushion',     is_vat_included: false, subgroup_order: 7, subgroup_name: 'เบิกฟรี' },
}

// ── GET /api/orders/image?no=ORDER_NO ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const orderNo = searchParams.get('no') ?? ''

  try {
    // 1. Fetch order
    const { rows: orderRows } = await pool.query(
      `SELECT order_no, branch_name, total_amount::float, nv_total::float, v_total::float,
              coupon_amount::float, coupon_col,
              quantities, foy_item_quantities, foy_quantities, created_at
       FROM booking_orders WHERE order_no = $1`,
      [orderNo]
    )
    if (!orderRows.length) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    const order = orderRows[0]
    const quantities: Record<string, number>     = order.quantities ?? {}
    const foyItems: Record<string, number>       = order.foy_item_quantities ?? {}
    const foyQty: Record<string, { qty: number; amount: number }> = order.foy_quantities ?? {}

    // 2. Fetch regular product info
    const productIds = Object.keys(quantities).map(Number).filter(id => (quantities[String(id)] ?? 0) > 0)
    type ProductRow = { id: number; product_name: string; group_name: string; price: string }
    let products: ProductRow[] = []
    if (productIds.length) {
      const { rows } = await pool.query<ProductRow>(
        `SELECT id, product_name, group_name, price::text
         FROM products_catalog WHERE id = ANY($1) ORDER BY id`,
        [productIds]
      )
      products = rows
    }

    // 3. Fetch FOY item info (paper_stock)
    const foyItemIds = Object.keys(foyItems).map(Number).filter(id => (foyItems[String(id)] ?? 0) > 0)
    type FoyRow = { id: number; model_name: string; warehouse_price: string }
    let foyItemProducts: FoyRow[] = []
    if (foyItemIds.length) {
      const { rows } = await pool.query<FoyRow>(
        `SELECT DISTINCT ON (model_name) id, model_name, warehouse_price::text
         FROM paper_stock WHERE id = ANY($1) ORDER BY model_name, id`,
        [foyItemIds]
      )
      foyItemProducts = rows
    }

    // 4. Build grouped sections
    type Item = { name: string; qty: number; price: number; total: number }
    type Section = { name: string; isVat: boolean; items: Item[] }
    const secMap = new Map<number, Section>()

    for (const p of products) {
      const info = GROUP_MAP[p.group_name]
      if (!info) continue
      const qty = quantities[String(p.id)] ?? 0
      if (qty <= 0) continue
      const price = parseFloat(p.price ?? '0')
      if (!secMap.has(info.section_order)) {
        secMap.set(info.section_order, { name: info.section_name, isVat: info.is_vat_included, items: [] })
      }
      secMap.get(info.section_order)!.items.push({ name: p.product_name, qty, price, total: price * qty })
    }

    // FOY items → section 2.5 (กระดาษฝอย)
    const foySecItems: Item[] = []
    for (const fp of foyItemProducts) {
      const qty = foyItems[String(fp.id)] ?? 0
      if (qty <= 0) continue
      const price = parseFloat(fp.warehouse_price ?? '0')
      foySecItems.push({ name: fp.model_name, qty, price, total: price * qty })
    }
    // also foy_quantities (old format)
    for (const [model, data] of Object.entries(foyQty)) {
      if (!data.qty || data.qty <= 0) continue
      if (!foySecItems.find(x => x.name === model)) {
        foySecItems.push({ name: model, qty: data.qty, price: data.amount / data.qty, total: data.amount })
      }
    }
    if (foySecItems.length) {
      secMap.set(2.5, { name: 'กระดาษฝอย', isVat: false, items: foySecItems })
    }

    const sections: Section[] = Array.from(secMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, s]) => s)

    // 5. Totals
    const totalAmt   = order.total_amount ?? 0
    const nvTotal    = order.nv_total
    const vTotal     = order.v_total
    const couponAmt  = order.coupon_amount ?? 0
    const couponCol  = order.coupon_col ?? ''
    const branchName = order.branch_name ?? ''
    const orderDate  = fmtDate(order.created_at)

    // 6. Load fonts
    const fontDir     = path.join(process.cwd(), 'public', 'fonts')
    const fontRegular = fs.readFileSync(path.join(fontDir, 'Sarabun-Regular.ttf'))
    const fontBold    = fs.readFileSync(path.join(fontDir, 'Sarabun-Bold.ttf'))

    const { default: satori } = await import('satori')
    const { default: sharp }  = await import('sharp')

    // 7. Layout constants
    const W       = 760
    const PAD     = 20
    const ROW_H   = 28
    const SEC_H   = 30
    const HEAD_H  = 72
    const FOOT_H  = nvTotal != null ? 116 : 64
    const totalItemRows = sections.reduce((s, sec) => s + sec.items.length, 0)
    const totalSecRows  = sections.length
    const H = HEAD_H + PAD + totalSecRows * SEC_H + totalItemRows * ROW_H + FOOT_H + PAD

    // helper: row element
    const mkRow = (name: string, qty: number, price: number | null, total: number, bg: string, bold: boolean) => ({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', backgroundColor: bg, padding: `4px ${PAD}px`, borderBottom: '1px solid #eeeeee', alignItems: 'center' } as Record<string, unknown>,
        children: [
          { type: 'div', props: { style: { flex: 5, fontSize: 12, display: 'flex', fontWeight: bold ? 700 : 400 }, children: name } },
          price != null
            ? { type: 'div', props: { style: { flex: 2, fontSize: 11, display: 'flex', justifyContent: 'flex-end', color: '#888888' }, children: fmt(price) } }
            : { type: 'div', props: { style: { flex: 2, display: 'flex' }, children: '' } },
          { type: 'div', props: { style: { flex: 1, fontSize: 12, display: 'flex', justifyContent: 'flex-end', fontWeight: 700 }, children: String(qty) } },
          { type: 'div', props: { style: { flex: 2, fontSize: 12, display: 'flex', justifyContent: 'flex-end', fontWeight: 700, color: '#1a5c29' }, children: fmt(total) } },
        ],
      },
    })

    const element = {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', width: W, minHeight: H, backgroundColor: '#ffffff', fontFamily: 'Sarabun', fontSize: 13, color: '#222222' },
        children: [
          // ── Header ──────────────────────────────────────────────────────────
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', backgroundColor: '#1a5c29', padding: `12px ${PAD}px`, gap: 3 },
              children: [
                { type: 'div', props: { style: { fontSize: 18, fontWeight: 700, color: '#ffffff', display: 'flex' }, children: `ใบจอง #${orderNo}` } },
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'row', gap: 12 },
                    children: [
                      { type: 'div', props: { style: { fontSize: 12, color: '#aaffaa', display: 'flex' }, children: branchName || 'ไม่ระบุสาขา' } },
                      { type: 'div', props: { style: { fontSize: 12, color: '#aaffaa', display: 'flex' }, children: `วันที่ ${orderDate}` } },
                    ],
                  },
                },
              ],
            },
          },
          // ── Column header ────────────────────────────────────────────────────
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'row', backgroundColor: '#e8f5e9', padding: `5px ${PAD}px`, borderBottom: '2px solid #1a5c29' },
              children: [
                { type: 'div', props: { style: { flex: 5, fontWeight: 700, fontSize: 12, display: 'flex' }, children: 'สินค้า' } },
                { type: 'div', props: { style: { flex: 2, fontWeight: 700, fontSize: 12, display: 'flex', justifyContent: 'flex-end' }, children: 'ราคา/หน่วย' } },
                { type: 'div', props: { style: { flex: 1, fontWeight: 700, fontSize: 12, display: 'flex', justifyContent: 'flex-end' }, children: 'จำนวน' } },
                { type: 'div', props: { style: { flex: 2, fontWeight: 700, fontSize: 12, display: 'flex', justifyContent: 'flex-end' }, children: 'รวม (฿)' } },
              ],
            },
          },
          // ── Sections ─────────────────────────────────────────────────────────
          ...sections.flatMap((sec, si) => [
            {
              type: 'div',
              props: {
                style: { display: 'flex', flexDirection: 'row', backgroundColor: sec.isVat ? '#555555' : '#9b9484', padding: `6px ${PAD}px` },
                children: [
                  { type: 'div', props: { style: { fontWeight: 700, fontSize: 13, color: '#ffffff', display: 'flex' }, children: sec.name + (sec.isVat ? ' (รวม VAT)' : '') } },
                ],
              },
            },
            ...sec.items.map((item, ii) => mkRow(item.name, item.qty, item.price, item.total, ii % 2 === 0 ? '#fafafa' : '#ffffff', false)),
          ]),
          // ── Footer ───────────────────────────────────────────────────────────
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', margin: `12px ${PAD}px 0`, gap: 6, borderTop: '2px solid #cccccc', paddingTop: 12 },
              children: [
                ...(nvTotal != null && vTotal != null ? [
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff8f0', padding: '7px 12px', borderRadius: 6 },
                      children: [
                        { type: 'div', props: { style: { fontWeight: 400, color: '#c05000', fontSize: 13, display: 'flex' }, children: 'ไม่มีใบกำกับภาษี' } },
                        { type: 'div', props: { style: { fontWeight: 700, color: '#c05000', fontSize: 13, display: 'flex' }, children: `${fmt(nvTotal)} ฿` } },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f5f5f5', padding: '7px 12px', borderRadius: 6 },
                      children: [
                        { type: 'div', props: { style: { fontWeight: 400, color: '#333333', fontSize: 13, display: 'flex' }, children: 'มีใบกำกับภาษี' } },
                        { type: 'div', props: { style: { fontWeight: 700, color: '#333333', fontSize: 13, display: 'flex' }, children: `${fmt(vTotal)} ฿` } },
                      ],
                    },
                  },
                ] : []),
                ...(couponAmt > 0 ? [
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff0f3', padding: '7px 12px', borderRadius: 6 },
                      children: [
                        { type: 'div', props: { style: { fontWeight: 400, color: '#c0004a', fontSize: 13, display: 'flex' }, children: `ส่วนลด${couponCol ? ` (${couponCol})` : ''}` } },
                        { type: 'div', props: { style: { fontWeight: 700, color: '#c0004a', fontSize: 13, display: 'flex' }, children: `- ${fmt(couponAmt)} ฿` } },
                      ],
                    },
                  },
                ] : []),
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#e8f5e9', padding: '8px 12px', borderRadius: 6 },
                    children: [
                      { type: 'div', props: { style: { fontWeight: 700, color: '#1a5c29', fontSize: 15, display: 'flex' }, children: 'ยอดรวมทั้งหมด' } },
                      { type: 'div', props: { style: { fontWeight: 700, color: '#1a5c29', fontSize: 15, display: 'flex' }, children: `${fmt(totalAmt)} ฿` } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    }

    const svg  = await satori(element as Parameters<typeof satori>[0], {
      width: W,
      height: H + 40,
      fonts: [
        { name: 'Sarabun', data: fontRegular, weight: 400, style: 'normal' },
        { name: 'Sarabun', data: fontBold,    weight: 700, style: 'normal' },
      ],
    })
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()

    return new NextResponse(jpeg as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[orders/image] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
