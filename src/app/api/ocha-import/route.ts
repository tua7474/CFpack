import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import * as XLSX from 'xlsx'

// ── Ensure tables ─────────────────────────────────────────────────────────────

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocha_product_mapping (
      id          SERIAL PRIMARY KEY,
      ocha_name   VARCHAR(200) NOT NULL UNIQUE,
      product_id  INT REFERENCES products_catalog(id) ON DELETE SET NULL,
      multiplier  NUMERIC(10,4) NOT NULL DEFAULT 1,
      skip        BOOLEAN NOT NULL DEFAULT false,
      note        TEXT,
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocha_imports (
      id           SERIAL PRIMARY KEY,
      import_date  DATE NOT NULL,
      branch_id    INT REFERENCES branches(id) ON DELETE SET NULL,
      branch_name  VARCHAR(100) NOT NULL,
      filename     VARCHAR(200),
      imported_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      row_count    INT NOT NULL DEFAULT 0,
      status       VARCHAR(20) NOT NULL DEFAULT 'active'
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocha_import_items (
      id           SERIAL PRIMARY KEY,
      import_id    INT NOT NULL REFERENCES ocha_imports(id) ON DELETE CASCADE,
      ocha_name    VARCHAR(200) NOT NULL,
      product_id   INT REFERENCES products_catalog(id) ON DELETE SET NULL,
      product_name VARCHAR(200),
      ocha_qty     NUMERIC(10,2) NOT NULL,
      deducted_qty NUMERIC(10,2) NOT NULL DEFAULT 0,
      skipped      BOOLEAN NOT NULL DEFAULT false
    )
  `)
}

// ── Parse Ocha xlsx ───────────────────────────────────────────────────────────

interface ParsedItem { ocha_name: string; qty: number }
interface ParsedFile { date: string; branch_name: string; items: ParsedItem[] }

function parseOchaXlsx(buffer: Buffer): ParsedFile {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })

  // date: row[2][3] e.g. "15-10-2026" → "2026-10-15"
  const dateRaw = String((rows[2] as unknown[])?.[3] ?? '').trim()
  let date = dateRaw
  const m = dateRaw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`

  // branch: row[4][3]
  const branch_name = String((rows[4] as unknown[])?.[3] ?? '').trim()

  // items: row 8 onwards (row 7 is header)
  const itemMap = new Map<string, number>()
  for (let i = 8; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const name = String(row[2] ?? '').trim()
    const qty = Number(row[5]) || 0
    if (!name || qty === 0) continue
    itemMap.set(name, (itemMap.get(name) ?? 0) + qty)
  }

  const items: ParsedItem[] = Array.from(itemMap.entries()).map(([ocha_name, qty]) => ({ ocha_name, qty }))
  return { date, branch_name, items }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  await ensureTables()
  const [mappings, imports, products, branches] = await Promise.all([
    pool.query(`
      SELECT m.*, p.product_name, p.group_name
      FROM ocha_product_mapping m
      LEFT JOIN products_catalog p ON p.id = m.product_id
      ORDER BY m.ocha_name
    `),
    pool.query(`
      SELECT i.*, b.name AS branch_db_name
      FROM ocha_imports i
      LEFT JOIN branches b ON b.id = i.branch_id
      ORDER BY i.imported_at DESC
      LIMIT 50
    `),
    pool.query(`SELECT id, group_name, product_name FROM products_catalog ORDER BY group_name, product_name`),
    pool.query(`SELECT id, name FROM branches ORDER BY name`),
  ])
  return NextResponse.json({
    mappings: mappings.rows,
    imports:  imports.rows,
    products: products.rows,
    branches: branches.rows,
  })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  await ensureTables()
  const ct = req.headers.get('content-type') ?? ''

  // ── Parse xlsx (multipart upload) ─────────────────────────────────────────
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    let parsed: ParsedFile
    try {
      parsed = parseOchaXlsx(buffer)
    } catch (e) {
      return NextResponse.json({ error: `อ่านไฟล์ไม่ได้: ${String(e)}` }, { status: 400 })
    }

    // Match branch: try exact, then strip "CFpack " prefix, then ILIKE
    const cleanName = parsed.branch_name.replace(/^CFpack\s*/i, '').trim()
    const { rows: branchRows } = await pool.query(
      `SELECT id, name FROM branches
       WHERE name = $1 OR name = $2 OR name ILIKE $3
       ORDER BY CASE WHEN name = $1 THEN 0 WHEN name = $2 THEN 1 ELSE 2 END
       LIMIT 1`,
      [parsed.branch_name, cleanName, `%${cleanName}%`]
    )
    const branch_id: number | null = branchRows[0]?.id ?? null

    // Get current mappings to find unmapped
    const { rows: mappingRows } = await pool.query(`SELECT ocha_name FROM ocha_product_mapping`)
    const mappedNames = new Set(mappingRows.map((r: { ocha_name: string }) => r.ocha_name))
    const unmapped = [...new Set(parsed.items.map(i => i.ocha_name))].filter(n => !mappedNames.has(n))

    return NextResponse.json({ ...parsed, branch_id, filename: file.name, unmapped })
  }

  const body = await req.json()

  // ── Save / update mappings ─────────────────────────────────────────────────
  if (body.action === 'save_mappings') {
    const mappings = body.mappings as {
      ocha_name: string; product_id: number | null; multiplier: number; skip: boolean; note: string
    }[]
    for (const m of mappings) {
      await pool.query(`
        INSERT INTO ocha_product_mapping (ocha_name, product_id, multiplier, skip, note, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (ocha_name) DO UPDATE
          SET product_id = $2, multiplier = $3, skip = $4, note = $5, updated_at = NOW()
      `, [m.ocha_name, m.product_id || null, m.multiplier || 1, !!m.skip, m.note || null])
    }
    return NextResponse.json({ ok: true })
  }

  // ── Confirm import ─────────────────────────────────────────────────────────
  if (body.action === 'confirm') {
    const { date, branch_id, branch_name, filename, items } = body as {
      date: string; branch_id: number | null; branch_name: string
      filename: string; items: ParsedItem[]
    }

    // Duplicate check
    if (branch_id) {
      const { rows: dup } = await pool.query(
        `SELECT id FROM ocha_imports WHERE import_date = $1 AND branch_id = $2 AND status = 'active'`,
        [date, branch_id]
      )
      if (dup.length > 0) {
        return NextResponse.json({ error: 'duplicate', import_id: dup[0].id }, { status: 409 })
      }
    }

    // Fetch all relevant mappings
    const names = [...new Set(items.map(i => i.ocha_name))]
    const { rows: mappingRows } = await pool.query(
      `SELECT ocha_name, product_id, multiplier, skip FROM ocha_product_mapping WHERE ocha_name = ANY($1)`,
      [names]
    )
    const mappingMap = new Map(mappingRows.map((m: { ocha_name: string; product_id: number | null; multiplier: number; skip: boolean }) => [m.ocha_name, m]))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [importRec] } = await client.query(`
        INSERT INTO ocha_imports (import_date, branch_id, branch_name, filename, row_count)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [date, branch_id, branch_name, filename, items.length])
      const import_id = importRec.id

      for (const item of items) {
        const mapping = mappingMap.get(item.ocha_name) as { product_id: number | null; multiplier: number; skip: boolean } | undefined
        const skipped = !mapping || mapping.skip || !mapping.product_id
        let deducted_qty = 0
        let product_name: string | null = null

        if (!skipped && mapping!.product_id) {
          deducted_qty = item.qty * (Number(mapping!.multiplier) || 1)
          const { rows: [prod] } = await client.query(
            `SELECT product_name FROM products_catalog WHERE id = $1`, [mapping!.product_id]
          )
          product_name = prod?.product_name ?? null

          if (branch_id) {
            await client.query(`
              INSERT INTO branch_stock (branch_id, product_id, quantity, updated_at)
              VALUES ($1, $2, 0 - $3, NOW())
              ON CONFLICT (branch_id, product_id)
              DO UPDATE SET quantity = branch_stock.quantity - $3, updated_at = NOW()
            `, [branch_id, mapping!.product_id, deducted_qty])
          }
        }

        await client.query(`
          INSERT INTO ocha_import_items
            (import_id, ocha_name, product_id, product_name, ocha_qty, deducted_qty, skipped)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [import_id, item.ocha_name, mapping?.product_id ?? null, product_name, item.qty, deducted_qty, skipped])
      }

      await client.query('COMMIT')
      return NextResponse.json({ ok: true, import_id })
    } catch (e) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: String(e) }, { status: 500 })
    } finally {
      client.release()
    }
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ── DELETE — rollback ─────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  await ensureTables()
  const { import_id } = await req.json()

  const { rows: [imp] } = await pool.query(`SELECT * FROM ocha_imports WHERE id = $1`, [import_id])
  if (!imp) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (imp.status === 'rolled_back') return NextResponse.json({ error: 'already rolled back' }, { status: 400 })

  const { rows: items } = await pool.query(
    `SELECT product_id, deducted_qty FROM ocha_import_items
     WHERE import_id = $1 AND NOT skipped AND product_id IS NOT NULL AND deducted_qty > 0`,
    [import_id]
  )

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of items) {
      if (imp.branch_id) {
        await client.query(`
          UPDATE branch_stock
          SET quantity = quantity + $1, updated_at = NOW()
          WHERE branch_id = $2 AND product_id = $3
        `, [item.deducted_qty, imp.branch_id, item.product_id])
      }
    }
    await client.query(`UPDATE ocha_imports SET status = 'rolled_back' WHERE id = $1`, [import_id])
    await client.query('COMMIT')
    return NextResponse.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: String(e) }, { status: 500 })
  } finally {
    client.release()
  }
}
