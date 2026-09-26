import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Catalog group → booking section/subgroup mapping ─────────────────────────

const CATALOG_GROUP_TO_BOOKING: Record<string, {
  section_order: number; section_name: string; is_vat_included: boolean
  subgroup_order: number; subgroup_name: string
}> = {
  'กล่อง':                               { section_order: 1, section_name: 'กล่อง',          is_vat_included: true,  subgroup_order: 0,  subgroup_name: '' },
  'ซองน้ำตาล':                           { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 1,  subgroup_name: 'ซองน้ำตาล' },
  'ซองขยายข้าง':                         { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 2,  subgroup_name: 'ซองขยายข้าง' },
  'ซองจ่าหน้า':                          { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 3,  subgroup_name: 'ซองจ่าหน้า' },
  'ซองบับเบิล':                          { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 4,  subgroup_name: 'ซองบับเบิล' },
  'PP กันกระแทก':                        { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 5,  subgroup_name: 'PP กันกระแทก' },
  'เทป OPP':                             { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 6,  subgroup_name: 'เทป OPP' },
  'เทประวังแตก':                         { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 7,  subgroup_name: 'เทประวังแตก' },
  'เทป OPP แกนส้ม (ใหม่)':              { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 8,  subgroup_name: 'เทป OPP แกนส้ม (ใหม่)' },
  'เทป THANK YOU':                       { section_order: 2, section_name: 'ซองน้ำตาล',      is_vat_included: false, subgroup_order: 9,  subgroup_name: 'เทป THANK YOU' },
  'กล่องเอกสาร':                         { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 5,  subgroup_name: 'กล่องเอกสาร' },
  'ซอง PP':                              { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 1,  subgroup_name: 'ซอง PP' },
  'ซองเมทาลิค':                          { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 2,  subgroup_name: 'ซองเมทาลิค' },
  'ซองสี':                               { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 3,  subgroup_name: 'ซองสี' },
  'สติ๊กเกอร์ลาเบล100*150':             { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 4,  subgroup_name: 'สติ๊กเกอร์ลาเบล100*150' },
  'ฟิล์มยืด':                            { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 5,  subgroup_name: 'ฟิล์มยืด' },
  'กระบอก 2 inc':                        { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 6,  subgroup_name: 'กระบอก 2 inc' },
  'กระบอก 3 inc':                        { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 7,  subgroup_name: 'กระบอก 3 inc' },
  'ฝากระบอก':                            { section_order: 3, section_name: 'ซอง PP',          is_vat_included: false, subgroup_order: 8,  subgroup_name: 'ฝากระบอก' },
  'ถุงหิ้วบริการ':                        { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 6,  subgroup_name: 'ถุงหิ้วบริการ' },
  'บับเบิล':                             { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 1,  subgroup_name: 'บับเบิล' },
  'โฟมบาง 2 มิล':                        { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 2,  subgroup_name: 'โฟมบาง 2 มิล' },
  'ตัดเทป':                              { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 3,  subgroup_name: 'ตัดเทป' },
  'สายรัด PP':                           { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 4,  subgroup_name: 'สายรัด PP' },
  'กระดาษห่อ':                           { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 5,  subgroup_name: 'กระดาษห่อ' },
  'สติ๊กเกอร์ระวังแตก':                  { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 6,  subgroup_name: 'สติ๊กเกอร์ระวังแตก' },
  'กระดาษฝอย':                           { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 7,  subgroup_name: 'กระดาษฝอย' },
  'ซองใสปะหน้า':                         { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 8,  subgroup_name: 'ซองใสปะหน้า' },
  'ปากกาเขียนPP (แพ็ค10)':              { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 9,  subgroup_name: 'ปากกาเขียนPP (แพ็ค10)' },
  'กล่อง Thank You':                     { section_order: 5, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 1,  subgroup_name: 'กล่อง Thank You' },
  'กล่องผลไม้':                          { section_order: 5, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 2,  subgroup_name: 'กล่องผลไม้' },
  'ถุงแก้วฝากาว 60 ไมครอน/แพ็ค 100ใบ': { section_order: 5, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 3,  subgroup_name: 'ถุงแก้วฝากาว 60 ไมครอน/แพ็ค 100ใบ' },
  'ถุงซิปรูด/แพ็ค 50ใบ':                { section_order: 5, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 4,  subgroup_name: 'ถุงซิปรูด/แพ็ค 50ใบ' },
  'เชือกขาว / เชือกฟาง':                { section_order: 5, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 5,  subgroup_name: 'เชือกขาว / เชือกฟาง' },
  'เบิกฟรี':                             { section_order: 4, section_name: 'บับเบิล',         is_vat_included: false, subgroup_order: 18, subgroup_name: 'เบิกฟรี' },
  'ซองกันกระแทก':                        { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 1,  subgroup_name: 'ซองกันกระแทก' },
  'AirBag แผ่น /เมตรละ':                { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 2,  subgroup_name: 'AirBag แผ่น /เมตรละ' },
  'AirBag ม้วน':                         { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 3,  subgroup_name: 'AirBag ม้วน' },
  'MINI AIR':                            { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 4,  subgroup_name: 'MINI AIR' },
  'ถุงเปล่า 30 กรัม':                    { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 5,  subgroup_name: 'ถุงเปล่า 30 กรัม' },
  'กระบอก 1.5 inc':                      { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 6,  subgroup_name: 'กระบอก 1.5 inc' },
  'กระดาษฝอยหนา 4 มิล':                 { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 7,  subgroup_name: 'กระดาษฝอยหนา 4 มิล' },
  'กระดาษฝอย เส้นหยัก':                 { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 8,  subgroup_name: 'กระดาษฝอย เส้นหยัก' },
  'เครื่อง Peripage /สติ๊กเกอร์ /เคส':  { section_order: 5, section_name: 'กล่อง Thank You', is_vat_included: false, subgroup_order: 6,  subgroup_name: 'เครื่อง Peripage /สติ๊กเกอร์ /เคส' },
  'กล่อง5ชั้น':                          { section_order: 6, section_name: 'ซองกันกระแทก',   is_vat_included: false, subgroup_order: 10, subgroup_name: 'กล่อง5ชั้น' },
}

// ── Booking sync helpers ──────────────────────────────────────────────────────

async function syncNewToBooking(group_name: string, product_name: string, price: number | null) {
  const info = CATALOG_GROUP_TO_BOOKING[group_name]
  if (!info || price === null || price === undefined) return
  const { rows: ex } = await pool.query(
    `SELECT 1 FROM booking_products WHERE section_order=$1 AND subgroup_order=$2 AND product_name=$3`,
    [info.section_order, info.subgroup_order, product_name]
  )
  if (ex.length > 0) return
  const { rows: mx } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM booking_products WHERE section_order=$1 AND subgroup_order=$2`,
    [info.section_order, info.subgroup_order]
  )
  await pool.query(
    `INSERT INTO booking_products
       (section_order,section_name,is_vat_included,subgroup_name,subgroup_order,product_name,unit_price,is_free,sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
    [info.section_order, info.section_name, info.is_vat_included, info.subgroup_name, info.subgroup_order, product_name, price, mx[0].next]
  )
}

async function syncPriceToBooking(product_name: string, price: number) {
  await pool.query(
    `UPDATE booking_products SET unit_price=$1 WHERE product_name=$2`,
    [price, product_name]
  )
}

async function syncNameToBooking(old_name: string, new_name: string) {
  await pool.query(
    `UPDATE booking_products SET product_name=$1 WHERE product_name=$2`,
    [new_name, old_name]
  )
}

// ── Ensure table + seed ───────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products_catalog (
      id           SERIAL PRIMARY KEY,
      group_name   VARCHAR(100) NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      price        NUMERIC(12,2),
      cost         NUMERIC(12,2),
      quantity     NUMERIC(12,2),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  // Add stock-tracking columns if not yet present
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS last_added_qty  NUMERIC(12,2) DEFAULT 0`)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS last_added_at   TIMESTAMP`)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS last_booked_qty NUMERIC(12,2) DEFAULT 0`)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS last_booked_at  TIMESTAMP`)
  // Stock log table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_stock_log (
      id         SERIAL PRIMARY KEY,
      product_id INT NOT NULL,
      action     VARCHAR(10) NOT NULL,
      qty        NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS show_in_booking BOOLEAN NOT NULL DEFAULT true`)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS prev_warehouse_price NUMERIC(12,2)`)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS price_updated_at     TIMESTAMP`)
  await pool.query(`ALTER TABLE products_catalog ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0`)
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products_catalog')
  if (rows[0].n === 0) await seedData()
  // Seed กระดาษฝอย products if not yet present
  await seedKradaatFoi()
  // Merge groups that share the same prefix into one group
  await mergeGroupsByPrefix()
}

async function mergeGroupsByPrefix() {
  // Merge any group starting with "กระดาษฝอย" → "กระดาษฝอย"
  await pool.query(`
    UPDATE products_catalog SET group_name = 'กระดาษฝอย', updated_at = NOW()
    WHERE group_name LIKE 'กระดาษฝอย%' AND group_name <> 'กระดาษฝอย'
  `)
  // Merge any group starting with "กระบอก" → "กระบอก"
  await pool.query(`
    UPDATE products_catalog SET group_name = 'กระบอก', updated_at = NOW()
    WHERE group_name LIKE 'กระบอก%' AND group_name <> 'กระบอก'
  `)
}

async function seedKradaatFoi() {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM products_catalog WHERE group_name IN ('รุ่นสีอ่อน','รุ่นสีพิเศษ A','รุ่นหยัก')"
  )
  if (rows[0].n > 0) return  // already seeded

  const foiProducts: [string, string, number, number][] = [
    ['รุ่นสีอ่อน',  '510 ขาวธรรมชาติ',    150, 90],
    ['รุ่นสีอ่อน',  '861 ฟ้าอ่อน',        150, 80],
    ['รุ่นสีอ่อน',  '831 สีโอรส',         150, 80],
    ['รุ่นสีอ่อน',  '552 ชมพูเข้ม',       150, 80],
    ['รุ่นสีอ่อน',  '551 ชมพูอ่อน',       150, 80],
    ['รุ่นสีอ่อน',  '860 ม่วงอ่อน',       150, 80],
    ['รุ่นสีอ่อน',  '591 เทาอ่อน',        150, 70],
    ['รุ่นสีอ่อน',  '561 ฟ้าเข้ม',        150, 80],
    ['รุ่นสีอ่อน',  '521 ครีม',           150, 80],
    ['รุ่นสีพิเศษ A','111 เงินเงา',        400, 250],
    ['รุ่นสีพิเศษ A','112 เงินด้าน',       400, 250],
    ['รุ่นสีอ่อน',  '881 เปลือกไม้',      150, 80],
    ['รุ่นสีอ่อน',  '863 ฟ้าพาสเทลเข้ม', 150, 70],
    ['รุ่นหยัก',    '881 เปลือกไม้ รุ่นหยัก', 250, 20],
    ['รุ่นสีอ่อน',  '853 ชมพูพาสเทล',    150, 80],
    ['รุ่นสีอ่อน',  '862 ฟ้า PT อ่อน',   150, 80],
    ['รุ่นสีอ่อน',  '863 ฟ้า PT เข้ม',   150, 80],
    ['รุ่นสีอ่อน',  '522 เหลืองอ่อน',    150, 60],
    ['รุ่นสีอ่อน',  '571 เขียวหยก',      150, 60],
    ['รุ่นสีอ่อน',  '882 กาแฟ',          150, 60],
    ['รุ่นสีอ่อน',  '511 กรีนรีด',       150, 60],
  ]

  const placeholders = foiProducts.map((_, j) => {
    const b = j * 4
    return `($${b+1},$${b+2},$${b+3},$${b+4})`
  }).join(',')
  const flat = foiProducts.flatMap(([g, n, p, c]) => [g, n, p, c])
  await pool.query(
    `INSERT INTO products_catalog (group_name,product_name,price,cost) VALUES ${placeholders}`,
    flat
  )
}

async function seedData() {
  const values: [string, string, number | null, null, number | null][] = [
    ['กล่อง','00ม.พ.',0.83,null,null],
    ['กล่อง','00',0.88,null,null],
    ['กล่อง','0',1.10,null,null],
    ['กล่อง','0+4',1.42,null,null],
    ['กล่อง','00+',2.62,null,null],
    ['กล่อง','AA',1.48,null,null],
    ['กล่อง','A',1.66,null,null],
    ['กล่อง','AB',1.94,null,null],
    ['กล่อง','2A',2.11,null,null],
    ['กล่อง','AH',4.24,null,null],
    ['กล่อง','Q',2.13,null,null],
    ['กล่อง','B',2.60,null,null],
    ['กล่อง','B+7',3.37,null,null],
    ['กล่อง','2B',3.53,null,null],
    ['กล่อง','BH',5.47,null,null],
    ['กล่อง','C',3.57,null,null],
    ['กล่อง','2C',4.97,null,null],
    ['กล่อง','CD',2.18,null,null],
    ['กล่อง','C+8',4.62,null,null],
    ['กล่อง','C+9',4.83,null,null],
    ['กล่อง','D-7',3.30,null,null],
    ['กล่อง','D',4.91,null,null],
    ['กล่อง','D+11',6.39,null,null],
    ['กล่อง','2D',6.75,null,null],
    ['กล่อง','S+',5.62,null,null],
    ['กล่อง','E',6.21,null,null],
    ['กล่อง','F',7.22,null,null],
    ['กล่อง','Fกลาง',8.76,null,null],
    ['กล่อง','F+',11.72,null,null],
    ['กล่อง','2F',8.11,null,null],
    ['กล่อง','ฉ',9.47,null,null],
    ['กล่อง','M',7.93,null,null],
    ['กล่อง','M+',11.36,null,null],
    ['กล่อง','G',8.88,null,null],
    ['กล่อง','H',15.09,null,null],
    ['กล่อง','L',14.73,null,null],
    ['กล่อง','7',13.73,null,null],
    ['กล่อง','P1',8.34,null,null],
    ['กล่อง','P2',10.23,null,null],
    ['กล่อง','P3',7.71,null,null],
    ['กล่อง','P4',12.85,null,null],
    ['กล่อง','1',19.35,null,null],
    ['กล่อง','2',11.86,null,null],
    ['กล่อง','7(5ชั้น)',26.51,null,null],
    ['กล่อง','I (3ชั้น)',19.53,null,null],
    ['กล่อง','I (5ชั้น)',35.38,null,null],
    ['กล่อง','T1',1.93,null,null],
    ['กล่อง','T2',4.62,null,null],
    ['กล่อง','2E',11.60,null,null],
    ['ซองน้ำตาล','5x8',0.88,null,null],
    ['ซองน้ำตาล','7x10',0.92,null,null],
    ['ซองน้ำตาล','9x12.75',1.35,null,null],
    ['ซองน้ำตาล','10x15',1.63,null,null],
    ['ซองน้ำตาล','15x19',3.42,null,null],
    ['ซองน้ำตาล','9x12.75+2',2.31,null,null],
    ['ซองน้ำตาล','10x15+2',3.47,null,null],
    ['ซองน้ำตาล','11x17+2',3.53,null,null],
    ['ซองน้ำตาล','6x9',1.44,null,null],
    ['ซองน้ำตาล','7x10',1.55,null,null],
    ['ซองน้ำตาล','9x12.75',1.85,null,null],
    ['ซองน้ำตาล','6x9',0.74,null,null],
    ['ซองน้ำตาล','7x10',1.03,null,null],
    ['ซองน้ำตาล','9x12.75',1.35,null,null],
    ['ซองน้ำตาล','5*8',0.90,null,null],
    ['ซองน้ำตาล','7x9.2',1.44,null,null],
    ['ซองน้ำตาล','8x10',1.73,null,null],
    ['ซองน้ำตาล','10x12',2.67,null,null],
    ['ซองน้ำตาล','11x15+2',3.63,null,null],
    ['ซองน้ำตาล','ใส 45',12.04,null,null],
    ['ซองน้ำตาล','ใส 100',23.60,null,null],
    ['ซองน้ำตาล','ทึบ 45',12.04,null,null],
    ['ซองน้ำตาล','ทึบ 100',23.60,null,null],
    ['ซองน้ำตาล','เหลือง',12.40,null,null],
    ['ซองน้ำตาล','ดำ',12.40,null,null],
    ['ซองน้ำตาล','แดง',12.40,null,null],
    ['ซองน้ำตาล','ขาว',12.40,null,null],
    ['ซองน้ำตาล','ใส 45',9.63,null,null],
    ['ซองน้ำตาล','ใส 100',19.26,null,null],
    ['ซองน้ำตาล','ทึบ 45',9.63,null,null],
    ['ซองน้ำตาล','ทึบ 100',19.26,null,null],
    ['ซองน้ำตาล','เขียว',20.33,null,null],
    ['ซองน้ำตาล','ชมพู',20.33,null,null],
    ['ซองน้ำตาล','บานเย็น',20.33,null,null],
    ['ซองน้ำตาล','ฟ้า',20.33,null,null],
    ['ซองน้ำตาล','ม่วง',20.33,null,null],
    ['ซองน้ำตาล','เหลือง',20.33,null,null],
    ['ซองน้ำตาล','NO.01',28.36,null,null],
    ['ซองน้ำตาล','No.03',33.23,null,null],
    ['ซองน้ำตาล','No.04',38.00,null,null],
    ['ซอง PP','0/17x30',0.75,null,null],
    ['ซอง PP','1/25x35',1.25,null,null],
    ['ซอง PP','2/28x42',1.69,null,null],
    ['ซอง PP','3/32x45',2.10,null,null],
    ['ซอง PP','4/38x52',2.85,null,null],
    ['ซอง PP','5/45x60',3.75,null,null],
    ['ซอง PP','6/50x70',5.20,null,null],
    ['ซอง PP','7/60x80',6.70,null,null],
    ['ซอง PP','0/17x30',0.70,null,null],
    ['ซอง PP','1/25x35',1.00,null,null],
    ['ซอง PP','2/28x42',1.20,null,null],
    ['ซอง PP','3/32x45',1.60,null,null],
    ['ซอง PP','4/38x52',2.30,null,null],
    ['ซอง PP','5/45x60',3.10,null,null],
    ['ซอง PP','0/17x30',0.75,null,null],
    ['ซอง PP','1/25x35',1.25,null,null],
    ['ซอง PP','2/28x42',1.69,null,null],
    ['ซอง PP','3/32x45',2.10,null,null],
    ['ซอง PP','4/38x52',2.85,null,null],
    ['ซอง PP','350 แผ่น',85.00,null,null],
    ['ซอง PP','15x250',117.70,null,null],
    ['ซอง PP','15x300',144.45,null,null],
    ['ซอง PP','45 cm',7.43,null,null],
    ['ซอง PP','55 cm',8.07,null,null],
    ['ซอง PP','65 cm',8.82,null,null],
    ['ซอง PP','75 cm',9.56,null,null],
    ['ซอง PP','85 cm',10.21,null,null],
    ['ซอง PP','95 cm',10.96,null,null],
    ['ซอง PP','100 cm',11.33,null,null],
    ['ซอง PP','120 cm',12.83,null,null],
    ['ซอง PP','45 cm',9.92,null,null],
    ['ซอง PP','55 cm',10.99,null,null],
    ['ซอง PP','65 cm',12.12,null,null],
    ['ซอง PP','ฝามินิ',1.50,null,null],
    ['ซอง PP','ฝา2นิ้ว',2.00,null,null],
    ['ซอง PP','ฝา3นิ้ว',2.50,null,null],
    ['ซอง PP','9x18',30.00,null,null],
    ['ซอง PP','12x20',30.00,null,null],
    ['ซอง PP','12x26',30.00,null,null],
    ['ซอง PP','15x30',30.00,null,null],
    ['ซอง PP','18x36',30.00,null,null],
    ['บับเบิล','32.5x100',109.14,null,null],
    ['บับเบิล','65x100',208.65,null,null],
    ['บับเบิล','130x100',417.30,null,null],
    ['บับเบิล','32.5x150',244.00,null,null],
    ['บับเบิล','65x150',482.00,null,null],
    ['บับเบิล','130x150',900.00,null,null],
    ['บับเบิล','รุ่นล็อค',42.80,null,null],
    ['บับเบิล','รุ่นมีเบรค',37.45,null,null],
    ['บับเบิล','Shocking Pink',15.00,null,null],
    ['บับเบิล','12มิล',230.99,null,null],
    ['บับเบิล','15มิล',193.67,null,null],
    ['บับเบิล','A 80g',2.80,null,null],
    ['บับเบิล','A 110g',3.40,null,null],
    ['บับเบิล','KA 125g',4.90,null,null],
    ['บับเบิล','แดง',95.00,null,null],
    ['บับเบิล','พิเศษ A',225.00,null,null],
    ['บับเบิล','พิเศษ B',200.00,null,null],
    ['บับเบิล','รุ่นสีอ่อน',100.00,null,null],
    ['บับเบิล','รุ่นปุยนุ่น',150.00,null,null],
    ['บับเบิล','14.5x18cm.',1.00,null,null],
    ['บับเบิล','17x25cm.',1.50,null,null],
    ['บับเบิล','32.5x150',98.98,null,null],
    ['บับเบิล','65x150',187.25,null,null],
    ['บับเบิล','130x150',374.50,null,null],
    ['กล่อง Thank You','00',0.72,null,null],
    ['กล่อง Thank You','0',0.90,null,null],
    ['กล่อง Thank You','0+4',1.16,null,null],
    ['กล่อง Thank You','A',1.36,null,null],
    ['กล่อง Thank You','AA',1.21,null,null],
    ['กล่อง Thank You','2A',2.11,null,null],
    ['กล่อง Thank You','AB',1.59,null,null],
    ['กล่อง Thank You','B',2.13,null,null],
    ['กล่อง Thank You','2B',2.89,null,null],
    ['กล่อง Thank You','C',2.93,null,null],
    ['กล่อง Thank You','D',4.03,null,null],
    ['กล่อง Thank You','E',5.09,null,null],
    ['กล่อง Thank You','S+',16.00,null,null],
    ['กล่อง Thank You','D+11',18.00,null,null],
    ['กล่อง Thank You','M',20.00,null,null],
    ['กล่อง Thank You','M+',24.40,null,null],
    ['กล่อง Thank You','L',30.50,null,null],
    ['กล่อง Thank You','20*34',64.20,null,null],
    ['กล่อง Thank You','25*35',74.90,null,null],
    ['กล่อง Thank You','28*40',90.95,null,null],
    ['กล่อง Thank You','32*45',112.35,null,null],
    ['กล่อง Thank You','15*20',64.20,null,null],
    ['กล่อง Thank You','20*25',74.90,null,null],
    ['กล่อง Thank You','25*30',101.65,null,null],
    ['กล่อง Thank You','30*35',128.40,null,null],
    ['กล่อง Thank You','35*45',171.20,null,null],
    ['กล่อง Thank You','40*50',208.65,null,null],
    ['กล่อง Thank You','50*60',272.85,null,null],
    ['กล่อง Thank You','เชือกฟาง',32.00,null,null],
    ['กล่อง Thank You','500 g.',55.00,null,null],
    ['กล่อง Thank You','1 kg.',114.00,null,null],
    ['ซองกันกระแทก','6x9',2.68,null,null],
    ['ซองกันกระแทก','7x10',3.08,null,null],
    ['ซองกันกระแทก','9x12.75',3.70,null,null],
    ['ซองกันกระแทก','No.30',1200.00,null,null],
    ['ซองกันกระแทก','No.45',1200.00,null,null],
    ['ซองกันกระแทก','No.610',1200.00,null,null],
    ['ซองกันกระแทก','No.1016',700.00,null,null],
    ['ซองกันกระแทก','รุ่น 1003',8346.00,null,null],
    ['ซองกันกระแทก','รุ่น1002',5493.00,null,null],
    ['ซองกันกระแทก','ใบเสร็จ',21.00,null,null],
    ['ซองกันกระแทก','1หัว',2.00,null,null],
    ['ซองกันกระแทก','2หัว',3.00,null,null],
    ['ซองกันกระแทก','เครื่อง+STK',856.00,null,null],
    ['ซองกันกระแทก','STK.เว้นขอบ',27.30,null,null],
    ['ซองกันกระแทก','STKปกติ',26.00,null,null],
    ['ซองกันกระแทก','STK.สี',27.30,null,null],
    ['ซองกันกระแทก','เคสใส',53.50,null,null],
    ['ซองกันกระแทก','เคสซิลิโคน',53.50,null,null],
    ['ซองกันกระแทก','พิเศษ A',250.00,null,null],
    ['ซองกันกระแทก','พิเศษ B',225.00,null,null],
    ['ซองกันกระแทก','รุ่นสีอ่อน',125.00,null,null],
    ['ซองกันกระแทก','พิเศษ A',275.00,null,null],
    ['ซองกันกระแทก','พิเศษ B',250.00,null,null],
    ['ซองกันกระแทก','รุ่นสีอ่อน',150.00,null,null],
    ['ซองกันกระแทก','ถุง 30 กรัม',1.00,null,null],
    ['ซองกันกระแทก','34cm',6.80,null,null],
    ['ซองกันกระแทก','S+',9.60,null,null],
    ['ซองกันกระแทก','M',12.37,null,null],
    ['ซองกันกระแทก','M+',17.46,null,null],
    ['ซองกันกระแทก','L',23.28,null,null],
    ['ซองกันกระแทก','G',16.01,null,null],
    ['ซองกันกระแทก','H',24.06,null,null],
    ['ซองกันกระแทก','1',28.62,null,null],
    ['ซองกันกระแทก','2',17.90,null,null],
    ['ซองกันกระแทก','J',55.78,null,null],
    ['ซองกันกระแทก','K',35.89,null,null],
    ['ซองกันกระแทก','X',54.32,null,null],
    ['ซองกันกระแทก','D',7.99,null,null],
    ['ซองกันกระแทก','T3',3.67,null,null],
  ]

  // Batch insert
  const chunkSize = 50
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize)
    const placeholders = chunk.map((_, j) => {
      const base = j * 5
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5})`
    }).join(',')
    const flat = chunk.flatMap(([g, n, p, c, q]) => [g, n, p, c, q])
    await pool.query(
      `INSERT INTO products_catalog (group_name,product_name,price,cost,quantity) VALUES ${placeholders}`,
      flat
    )
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await ensureTable()
    const { rows } = await pool.query(`
      SELECT id, group_name, product_name, price, quantity,
             last_added_qty, last_added_at, last_booked_qty, last_booked_at,
             show_in_booking, prev_warehouse_price, price_updated_at
      FROM products_catalog
      ORDER BY group_name, sort_order, id
    `)
    return NextResponse.json(rows)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()

    // Reorder: { action: 'reorder', group_name, ids: number[] }
    if (!Array.isArray(body) && body.action === 'reorder') {
      const { group_name, ids } = body as { group_name: string; ids: number[] }
      await Promise.all(
        ids.map((id: number, idx: number) =>
          pool.query(
            'UPDATE products_catalog SET sort_order = $1 WHERE id = $2 AND group_name = $3',
            [idx, id, group_name]
          )
        )
      )
      return NextResponse.json({ ok: true })
    }

    // Group toggle: { action:'toggle_group', group_name, show_in_booking }
    if (!Array.isArray(body) && body.action === 'toggle_group') {
      const { group_name, show_in_booking } = body
      await pool.query(
        `UPDATE products_catalog SET show_in_booking=$1, updated_at=NOW() WHERE group_name=$2`,
        [show_in_booking, group_name]
      )
      return NextResponse.json({ ok: true })
    }

    // Stock operation: { id, action:'add'|'book', qty }
    if (!Array.isArray(body) && body.action) {
      const { id, action, qty } = body
      if (action === 'add') {
        const { rows } = await pool.query(`
          UPDATE products_catalog
          SET quantity       = COALESCE(quantity, 0) + $1,
              last_added_qty = $1,
              last_added_at  = NOW(),
              updated_at     = NOW()
          WHERE id = $2 RETURNING *`, [qty, id])
        await pool.query(
          `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, 'add', $2)`,
          [id, qty]
        )
        return NextResponse.json(rows[0])
      }
      if (action === 'book') {
        const { rows } = await pool.query(`
          UPDATE products_catalog
          SET quantity        = COALESCE(quantity, 0) - $1,
              last_booked_qty = $1,
              last_booked_at  = NOW(),
              updated_at      = NOW()
          WHERE id = $2 RETURNING *`, [qty, id])
        await pool.query(
          `INSERT INTO catalog_stock_log (product_id, action, qty) VALUES ($1, 'book', $2)`,
          [id, qty]
        )
        return NextResponse.json(rows[0])
      }
    }

    // Info update: single object { id, group_name?, product_name?, price?, show_in_booking? }
    if (!Array.isArray(body)) {
      const { id, group_name, product_name, price, show_in_booking } = body
      // Fetch current state before updating (for booking sync + price snapshot)
      const { rows: curr } = await pool.query(
        'SELECT group_name, product_name, price FROM products_catalog WHERE id=$1', [id]
      )
      const fields: string[] = []
      const vals: unknown[] = []
      let n = 1
      if (group_name       !== undefined) { fields.push(`group_name=$${n++}`);       vals.push(group_name) }
      if (product_name     !== undefined) { fields.push(`product_name=$${n++}`);     vals.push(product_name) }
      if (price            !== undefined) {
        // Snapshot old price before overwriting
        if (curr[0]) {
          fields.push(`prev_warehouse_price=$${n++}`); vals.push(curr[0].price)
          fields.push(`price_updated_at=NOW()`)
        }
        fields.push(`price=$${n++}`); vals.push(price)
      }
      if (show_in_booking  !== undefined) { fields.push(`show_in_booking=$${n++}`);  vals.push(show_in_booking) }
      if (!fields.length) return NextResponse.json({ ok: true })
      fields.push(`updated_at=NOW()`)
      vals.push(id)
      await pool.query(`UPDATE products_catalog SET ${fields.join(',')} WHERE id=$${n}`, vals)
      // Sync to booking_products
      if (curr.length > 0) {
        const old = curr[0]
        if (product_name !== undefined && product_name !== old.product_name) {
          await syncNameToBooking(old.product_name, product_name)
        }
        if (price !== undefined) {
          const finalName = product_name ?? old.product_name
          await syncPriceToBooking(finalName, price)
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Batch info update: array
    const rows = body as { id: number; group_name?: string; product_name?: string; price?: number; cost?: number; quantity?: number }[]
    for (const row of rows) {
      // Fetch current state for sync
      const { rows: curr } = await pool.query(
        'SELECT group_name, product_name, price FROM products_catalog WHERE id=$1', [row.id]
      )
      const fields: string[] = []
      const vals: unknown[] = []
      let n = 1
      if (row.group_name   !== undefined) { fields.push(`group_name=$${n++}`);   vals.push(row.group_name) }
      if (row.product_name !== undefined) { fields.push(`product_name=$${n++}`); vals.push(row.product_name) }
      if (row.price        !== undefined) { fields.push(`price=$${n++}`);        vals.push(row.price) }
      if (row.cost         !== undefined) { fields.push(`cost=$${n++}`);         vals.push(row.cost) }
      if (row.quantity     !== undefined) { fields.push(`quantity=$${n++}`);     vals.push(row.quantity) }
      if (!fields.length) continue
      fields.push(`updated_at=NOW()`)
      vals.push(row.id)
      await pool.query(`UPDATE products_catalog SET ${fields.join(',')} WHERE id=$${n}`, vals)
      // Sync to booking_products
      if (curr.length > 0) {
        const old = curr[0]
        if (row.product_name !== undefined && row.product_name !== old.product_name) {
          await syncNameToBooking(old.product_name, row.product_name)
        }
        if (row.price !== undefined) {
          const finalName = row.product_name ?? old.product_name
          await syncPriceToBooking(finalName, row.price)
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const { group_name, product_name, price, cost, quantity } =
      await req.json() as { group_name: string; product_name: string; price?: number; cost?: number; quantity?: number }
    if (!group_name || !product_name)
      return NextResponse.json({ error: 'group_name and product_name required' }, { status: 400 })
    const { rows } = await pool.query(
      `INSERT INTO products_catalog (group_name,product_name,price,cost,quantity)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [group_name, product_name, price ?? null, cost ?? null, quantity ?? null]
    )
    // Auto-add to booking_products if group maps to a known section
    await syncNewToBooking(group_name, product_name, price ?? null)
    return NextResponse.json({ ok: true, id: rows[0].id })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = Number(searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await pool.query('DELETE FROM products_catalog WHERE id=$1', [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
