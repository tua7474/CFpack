import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── group_name → section/subgroup mapping (catalog → booking format) ───────────

type SectionInfo = {
  section_order: number; section_name: string; is_vat_included: boolean
  subgroup_order: number; subgroup_name: string
}

const GROUP_MAP: Record<string, SectionInfo> = {
  // S1 กล่อง (เหมือนเดิม)
  'กล่อง':                        { section_order: 1, section_name: 'กล่อง',          is_vat_included: true,  subgroup_order: 0,  subgroup_name: '' },
  // S2 — กล่อง Thank You, กล่องผลไม้ 5 ชั้น, กล่องเอกสาร, กล่อง 5 ชั้น, [กระดาษฝอย=5], ถุงใส่กระดาษฝอย
  'กล่อง Thank You':              { section_order: 2, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 1,  subgroup_name: 'กล่อง Thank You' },
  'กล่องผลไม้ 5 ชั้น':            { section_order: 2, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 2,  subgroup_name: 'กล่องผลไม้ 5 ชั้น' },
  'กล่องเอกสาร':                  { section_order: 2, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 3,  subgroup_name: 'กล่องเอกสาร' },
  'กล่อง 5 ชั้น':                 { section_order: 2, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 4,  subgroup_name: 'กล่อง 5 ชั้น' },
  // กระดาษฝอย subgroup_order 5 — assigned via foyProducts in GET handler
  'ถุงใส่กระดาษฝอย':              { section_order: 2, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 6,  subgroup_name: 'ถุงใส่กระดาษฝอย' },
  // S3 — ซอง PP, ซองเมทาลิค, ซอง PP สี, ซองน้ำตาล, ซองขยายข้าง, ซองจ่าหน้า, ซองบับเบิล, ซองPPกันกระแทก, ฟิล์มยืด
  'ซอง PP':                       { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 1,  subgroup_name: 'ซอง PP' },
  'ซองเมทาลิค':                   { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 2,  subgroup_name: 'ซองเมทาลิค' },
  'ซอง PP สี':                    { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 3,  subgroup_name: 'ซอง PP สี' },
  'ซองน้ำตาล':                    { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 4,  subgroup_name: 'ซองน้ำตาล' },
  'ซองขยายข้าง':                  { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 5,  subgroup_name: 'ซองขยายข้าง' },
  'ซองจ่าหน้า':                   { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 6,  subgroup_name: 'ซองจ่าหน้า' },
  'ซองบับเบิล':                   { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 7,  subgroup_name: 'ซองบับเบิล' },
  'ซองPPกันกระแทก':               { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 8,  subgroup_name: 'ซองPPกันกระแทก' },
  'ฟิล์มยืด':                     { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 9,  subgroup_name: 'ฟิล์มยืด' },
  // S4 — บับเบิล, บับเบิลสี, บับเบิลบาง 35g, โฟมบาง 2 มิล, ตัวตัดเทป, เทป OPP แกนดำ, เทประวังแตก, เทป OPP แกนส้ม, เทป Thank You, ถุงหิ้วบริการ, ลาเบล 10x15
  'บับเบิล':                      { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 1,  subgroup_name: 'บับเบิล' },
  'บับเบิลสี':                    { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 2,  subgroup_name: 'บับเบิลสี' },
  'บับเบิลบาง 35g':              { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 3,  subgroup_name: 'บับเบิลบาง 35g' },
  'โฟมบาง 2 มิล':                 { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 4,  subgroup_name: 'โฟมบาง 2 มิล' },
  'ตัวตัดเทป':                    { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 5,  subgroup_name: 'ตัวตัดเทป' },
  'เทปOPPแกนดำ':                  { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 6,  subgroup_name: 'เทป OPP แกนดำ' },
  'เทประวังแตก':                  { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 7,  subgroup_name: 'เทประวังแตก' },
  'เทปOPPแกนส้ม':                 { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 8,  subgroup_name: 'เทป OPP แกนส้ม' },
  'เทปThankYou':                  { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 9,  subgroup_name: 'เทป Thank You' },
  'ถุงหิ้วบริการ':                 { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 10, subgroup_name: 'ถุงหิ้วบริการ' },
  'ลาเบล 10x15':                  { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 11, subgroup_name: 'ลาเบล 10x15' },
  'สติกเกอร์ระวังแตกม้วน':        { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 12, subgroup_name: 'สติกเกอร์ระวังแตก' },
  // S5 — ถุงแก้วฝากาว 60M/100P, ถุงซิปรูด, ซองใสปะหน้า, กระบอก, ฝาปิดกระบอก, สายรัด PP, กระดาษห่อ, เชือก, เบิกฟรี
  'ถุงแก้วฝากาว 60M/100P':        { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 1,  subgroup_name: 'ถุงแก้วฝากาว 60M/100P' },
  'ถุงซิปรูด':                    { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 2,  subgroup_name: 'ถุงซิปรูด' },
  'ซองใสปะหน้า':                  { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 3,  subgroup_name: 'ซองใสปะหน้า' },
  'กระบอก':                       { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 4,  subgroup_name: 'กระบอก' },
  'ฝาปิดกระบอก':                  { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 5,  subgroup_name: 'ฝาปิดกระบอก' },
  'สายรัด PP':                    { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 6,  subgroup_name: 'สายรัด PP' },
  'กระดาษห่อ':                    { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 7,  subgroup_name: 'กระดาษห่อ' },
  'เชือก':                        { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 8,  subgroup_name: 'เชือก' },
  'เบิกฟรี':                      { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 9,  subgroup_name: 'เบิกฟรี' },
  'เครื่อง/สติกเกอร์/เคส':        { section_order: 5, section_name: 'เบ็ดเตล็ด',       is_vat_included: false, subgroup_order: 10, subgroup_name: 'เครื่อง/สติกเกอร์/เคส' },
  // S6 — AIRBAG แผ่น/เมตร, MINI AIR BAG ม้วนเปล่า, MINI AIR, กระดาษพิมพ์สลิป, ปากกาเขียน PP
  'ซองกันกระแทก':                 { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 1,  subgroup_name: 'ซองกันกระแทก' },
  'MINI AIR BAG ม้วนเปล่า':       { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 2,  subgroup_name: 'MINI AIR BAG ม้วนเปล่า' },
  'MINI AIR เครื่องเป่า':         { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 3,  subgroup_name: 'MINI AIR เครื่องเป่า' },
  'กระดาษพิมพ์สลิป':              { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 4,  subgroup_name: 'กระดาษพิมพ์สลิป' },
  'ปากกาเขียน PP':                { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 5,  subgroup_name: 'ปากกาเขียน PP' },
}

export async function GET() {
  try {
    // One-time migration: rename old group key to match current GROUP_MAP
    await pool.query(
      `UPDATE products_catalog SET group_name = 'เบิกฟรี', updated_at = NOW()
       WHERE group_name = 'เบิกของ ฟรี'`
    )

    const groupNames = Object.keys(GROUP_MAP)
    const { rows } = await pool.query<{
      id: number; group_name: string; product_name: string
      price: string | null; stock_qty: string | null
    }>(
      `SELECT id, group_name, product_name, price,
              quantity AS stock_qty
       FROM products_catalog
       WHERE group_name = ANY($1) AND show_in_booking = true
       ORDER BY group_name, id`,
      [groupNames]
    )
    const enriched = rows.map(p => ({ ...p, ...GROUP_MAP[p.group_name] }))

    // กระดาษฝอย models จาก paper_stock (subgroup 8)
    const { rows: foyRows } = await pool.query<{
      model_name: string; total_qty: string; warehouse_price: string
    }>(
      `SELECT model_name,
              COALESCE(SUM(stock_qty), 0)  AS total_qty,
              MAX(warehouse_price)          AS warehouse_price
       FROM paper_stock
       WHERE show_in_booking = true
       GROUP BY model_name
       ORDER BY model_name`
    )
    const foyProducts = foyRows.map((r, i) => ({
      id: -(i + 1),
      group_name: 'กระดาษฝอย',
      product_name: r.model_name,
      price: r.warehouse_price ?? null,
      stock_qty: r.total_qty,
      section_order: 2,
      section_name: 'กล่อง Thank You',
      is_vat_included: false,
      subgroup_order: 5,
      subgroup_name: 'กระดาษฝอย',
    }))

    const all = [...enriched, ...foyProducts]
    all.sort((a, b) =>
      a.section_order - b.section_order ||
      a.subgroup_order - b.subgroup_order ||
      a.id - b.id
    )
    return NextResponse.json(all)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
