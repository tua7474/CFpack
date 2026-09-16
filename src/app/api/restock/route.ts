import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Ensure table ──────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restock_entries (
      id           SERIAL PRIMARY KEY,
      scanned_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      notes        TEXT,
      raw_text     TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restock_items (
      id              SERIAL PRIMARY KEY,
      entry_id        INT NOT NULL REFERENCES restock_entries(id) ON DELETE CASCADE,
      product_name    VARCHAR(200) NOT NULL DEFAULT '',
      quantity        DECIMAL(12,2),
      unit            VARCHAR(50) NOT NULL DEFAULT '',
      sort_order      INT NOT NULL DEFAULT 0
    )
  `)
}

// ── GET — list entries with items ─────────────────────────────────────────────

export async function GET() {
  try {
    await ensureTable()
    const { rows: entries } = await pool.query(`
      SELECT id, scanned_at, notes, raw_text, created_at
      FROM restock_entries
      ORDER BY scanned_at DESC, created_at DESC
    `)
    const { rows: items } = await pool.query(`
      SELECT id, entry_id, product_name, quantity::float, unit, sort_order
      FROM restock_items
      ORDER BY entry_id, sort_order, id
    `)
    const itemMap: Record<number, typeof items> = {}
    for (const it of items) {
      if (!itemMap[it.entry_id]) itemMap[it.entry_id] = []
      itemMap[it.entry_id].push(it)
    }
    return NextResponse.json(entries.map(e => ({ ...e, items: itemMap[e.id] ?? [] })))
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── POST — create entry ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const { scanned_at, notes, raw_text, items } = await req.json()
    const { rows } = await pool.query(
      `INSERT INTO restock_entries (scanned_at, notes, raw_text)
       VALUES ($1, $2, $3) RETURNING *`,
      [scanned_at ?? new Date(), notes ?? null, raw_text ?? null]
    )
    const entry = rows[0]
    if (Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        await pool.query(
          `INSERT INTO restock_items (entry_id, product_name, quantity, unit, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [entry.id, it.product_name ?? '', it.quantity ?? null, it.unit ?? '', i]
        )
      }
    }
    // Return entry with items
    const { rows: newItems } = await pool.query(
      `SELECT id, entry_id, product_name, quantity::float, unit, sort_order
       FROM restock_items WHERE entry_id=$1 ORDER BY sort_order, id`,
      [entry.id]
    )
    return NextResponse.json({ ...entry, items: newItems }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── PATCH — update entry or item ──────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()

    // Update individual item
    if (body.action === 'update_item') {
      const { item_id, product_name, quantity, unit } = body
      const sets: string[] = []
      const vals: unknown[] = []
      let i = 1
      if (product_name !== undefined) { sets.push(`product_name=$${i++}`); vals.push(product_name) }
      if (quantity     !== undefined) { sets.push(`quantity=$${i++}`);     vals.push(quantity === '' ? null : quantity) }
      if (unit         !== undefined) { sets.push(`unit=$${i++}`);         vals.push(unit) }
      if (!sets.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
      vals.push(item_id)
      await pool.query(`UPDATE restock_items SET ${sets.join(', ')} WHERE id=$${i}`, vals)
      return NextResponse.json({ ok: true })
    }

    // Add item to entry
    if (body.action === 'add_item') {
      const { entry_id, product_name, quantity, unit } = body
      const { rows: maxRows } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM restock_items WHERE entry_id=$1`,
        [entry_id]
      )
      const sort_order = (maxRows[0].mx as number) + 1
      const { rows } = await pool.query(
        `INSERT INTO restock_items (entry_id, product_name, quantity, unit, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, entry_id, product_name, quantity::float, unit, sort_order`,
        [entry_id, product_name ?? '', quantity ?? null, unit ?? '', sort_order]
      )
      return NextResponse.json(rows[0], { status: 201 })
    }

    // Remove item
    if (body.action === 'remove_item') {
      await pool.query(`DELETE FROM restock_items WHERE id=$1`, [body.item_id])
      return NextResponse.json({ ok: true })
    }

    // Update entry metadata
    const { id, scanned_at, notes } = body
    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1
    if (scanned_at !== undefined) { sets.push(`scanned_at=$${i++}`); vals.push(scanned_at) }
    if (notes      !== undefined) { sets.push(`notes=$${i++}`);      vals.push(notes) }
    if (!sets.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    vals.push(id)
    await pool.query(`UPDATE restock_entries SET ${sets.join(', ')} WHERE id=$${i}`, vals)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── DELETE — delete entry ─────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    await pool.query(`DELETE FROM restock_entries WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
