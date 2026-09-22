'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import Link from 'next/link'

// กลุ่มกระดาษฝอยในสต็อค (เหมือนกับ FOY_HIDDEN ใน stock page)
const FOY_GROUPS = new Set([
  'กระดาษฝอย', 'รุ่นสีอ่อน', 'รุ่นสีพิเศษ A', 'รุ่นสีพิเศษ B',
  'รุ่นหยัก', 'ฝอยนุ่น', 'ฝอยหยัก',
])

// ── Types ──────────────────────────────────────────────────────────────────────

interface Session {
  produced?: number
  produced_date?: string
  moved?: number
  moved_date?: string
}

interface ProductionRow {
  id?: number
  product_id?: number
  product_name?: string
  new_job_qty?: number
  new_job_kg?: number
  new_job_date?: string
  sessions: Session[]
}

interface CatalogProduct {
  id: number
  group_name: string
  product_name: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

function fmtDateShort(d?: string) {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok',
  })
}

function emptyRow(): ProductionRow {
  return { sessions: Array(8).fill(null).map(() => ({})) }
}

function hasData(row: ProductionRow) {
  return (
    !!row.product_id ||
    row.new_job_qty != null ||
    row.new_job_kg != null ||
    row.sessions.some(s => s?.produced != null || s?.moved != null)
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FoyLinePage() {
  const [rows, setRows]       = useState<ProductionRow[]>([emptyRow()])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading]  = useState(true)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/catalog').then(r => r.json()),
      fetch('/api/foy-production').then(r => r.json()).catch(() => []),
    ]).then(([catalog, production]: [CatalogProduct[], ProductionRow[]]) => {
      setProducts((catalog as CatalogProduct[]).filter(p => FOY_GROUPS.has(p.group_name)))
      const dbRows = (production as ProductionRow[]).map(r => ({
        ...r,
        sessions: Array(8).fill(null).map((_, i) => r.sessions[i] ?? {}),
      }))
      setRows(dbRows.length ? dbRows : [emptyRow()])
      setLoading(false)
    })
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveRow = useCallback(async (row: ProductionRow, rowIdx: number) => {
    const body = JSON.stringify(row)
    if (!row.id) {
      const res = await fetch('/api/foy-production', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      })
      const saved = await res.json()
      setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, id: saved.id } : r))
    } else {
      await fetch('/api/foy-production', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
      })
    }
  }, [])

  const scheduleSave = useCallback((row: ProductionRow, rowIdx: number) => {
    if (!hasData(row)) return
    const prev = timers.current.get(rowIdx)
    if (prev) clearTimeout(prev)
    timers.current.set(rowIdx, setTimeout(() => saveRow(row, rowIdx), 800))
  }, [saveRow])

  // ── Update helpers ────────────────────────────────────────────────────────
  const selectProduct = useCallback((rowIdx: number, productId: number) => {
    setRows(prev => {
      const p = prev[rowIdx]
      const found = products.find(x => x.id === productId)
      if (!found) return prev
      const updated: ProductionRow = {
        ...p,
        product_id: found.id,
        product_name: `${found.group_name} / ${found.product_name}`,
      }
      const newRows = [...prev]
      newRows[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return newRows
    })
  }, [products, scheduleSave])

  const updateNewJob = useCallback((rowIdx: number, field: 'new_job_qty' | 'new_job_kg', raw: string) => {
    const val = raw === '' ? undefined : Number(raw)
    setRows(prev => {
      const row = prev[rowIdx]
      const patch: Partial<ProductionRow> = { [field]: val }
      if (val != null && !row.new_job_date) patch.new_job_date = todayStr()
      const updated = { ...row, ...patch }
      const newRows = [...prev]
      newRows[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return newRows
    })
  }, [scheduleSave])

  const updateSession = useCallback((
    rowIdx: number, si: number, field: 'produced' | 'moved', raw: string
  ) => {
    const val = raw === '' ? undefined : Number(raw)
    setRows(prev => {
      const row = prev[rowIdx]
      const sessions = row.sessions.map((s, i) => {
        if (i !== si) return s
        const ns = { ...s, [field]: val }
        if (field === 'produced' && val != null && !ns.produced_date) ns.produced_date = todayStr()
        if (field === 'moved'    && val != null && !ns.moved_date)    ns.moved_date    = todayStr()
        return ns
      })
      const updated = { ...row, sessions }
      const newRows = [...prev]
      newRows[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return newRows
    })
  }, [scheduleSave])

  const deleteRow = useCallback(async (rowIdx: number) => {
    const row = rows[rowIdx]
    if (row.id) {
      await fetch('/api/foy-production', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
    }
    setRows(prev => prev.filter((_, i) => i !== rowIdx))
  }, [rows])

  const addRow = () => setRows(prev => [...prev, emptyRow()])

  const totalProduced = (row: ProductionRow) =>
    row.sessions.reduce((s, sess) => s + (Number(sess?.produced) || 0), 0)

  // ── Styles ────────────────────────────────────────────────────────────────
  const numInput = (extra = '') =>
    `w-full px-1 py-0.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] text-center text-black bg-white ${extra}`

  const dateLabel = (d?: string, color = 'text-blue-400') => (
    <div className={`text-[9px] ${color} text-center leading-none h-3 mb-0.5`}>
      {fmtDateShort(d)}
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-400">
      กำลังโหลด...
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow">
        <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex overflow-x-auto">
        <Link href="/"          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📦 สต็อคสินค้า</Link>
        <Link href="/stock"     className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌿 สต็อคกระดาษฝอย</Link>
        <Link href="/branches"  className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏪 สาขาและตัวแทน</Link>
        <Link href="/delivery"  className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🚚 จัดส่ง</Link>
        <Link href="/withdrawal" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📤 เบิกของ</Link>
        <Link href="/restock"   className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📥 เติมสต็อค</Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">🌀 ไลน์ผลิตกระดาษฝอย</span>
      </div>

      {/* Main */}
      <main className="p-4">
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="text-xs border-collapse bg-white" style={{ minWidth: 'max-content' }}>
            <thead>
              {/* ── Row 1: top-level ── */}
              <tr className="bg-[#9b9484] text-white">
                <th rowSpan={3} className="px-3 py-2 border border-white/20 text-left whitespace-nowrap" style={{ minWidth: 200 }}>
                  รุ่น / หมวด / สี
                </th>
                <th colSpan={2} className="px-3 py-1.5 border border-white/20 text-center whitespace-nowrap">
                  ขึ้นงานใหม่
                </th>
                <th colSpan={16} className="px-3 py-1.5 border border-white/20 text-center">
                  บันทึกรายวัน
                </th>
                <th rowSpan={3} className="px-3 py-2 border border-white/20 text-center whitespace-nowrap bg-green-700">
                  รวมผลิต
                </th>
                <th rowSpan={3} className="px-2 py-2 border border-white/20 text-center bg-red-800" />
              </tr>

              {/* ── Row 2: sub-groups ── */}
              <tr className="bg-[#9b9484] text-white">
                <th className="px-2 py-1 border border-white/20 text-center whitespace-nowrap" style={{ minWidth: 58 }}>จำนวน</th>
                <th className="px-2 py-1 border border-white/20 text-center whitespace-nowrap" style={{ minWidth: 58 }}>กิโล</th>
                {Array.from({ length: 8 }, (_, i) => (
                  <th key={i} colSpan={2} className="px-2 py-1 border border-white/20 text-center whitespace-nowrap">
                    ครั้งที่ {i + 1}
                  </th>
                ))}
              </tr>

              {/* ── Row 3: produced / moved ── */}
              <tr className="bg-[#7a7568] text-white text-[10px]">
                <th className="px-1 py-1 border border-white/20 text-center">ม้วน</th>
                <th className="px-1 py-1 border border-white/20 text-center">กก.</th>
                {Array.from({ length: 8 }, (_, i) => (
                  <Fragment key={i}>
                    <th className="px-1 py-1 border border-white/20 text-center" style={{ minWidth: 52 }}>ผลิต</th>
                    <th className="px-1 py-1 border border-white/20 text-center bg-green-800/60" style={{ minWidth: 52 }}>ย้ายสต็อค</th>
                  </Fragment>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, rowIdx) => {
                const total = totalProduced(row)
                return (
                  <tr key={rowIdx} className="border-b border-gray-100 hover:bg-yellow-50/40">

                    {/* ── Col 1: dropdown ── */}
                    <td className="px-2 py-1.5 border-r border-gray-200">
                      <select
                        value={row.product_id ?? ''}
                        onChange={e => selectProduct(rowIdx, Number(e.target.value))}
                        className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] bg-white text-black"
                        style={{ minWidth: 190 }}
                      >
                        <option value="">-- เลือกสินค้า --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.group_name} / {p.product_name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* ── Col 2a: new_job_qty ── */}
                    <td className="px-1 py-1 border-r border-gray-200">
                      {dateLabel(row.new_job_qty != null ? row.new_job_date : undefined)}
                      <input
                        type="number" inputMode="numeric"
                        value={row.new_job_qty ?? ''}
                        onChange={e => updateNewJob(rowIdx, 'new_job_qty', e.target.value)}
                        className={numInput()}
                      />
                    </td>

                    {/* ── Col 2b: new_job_kg ── */}
                    <td className="px-1 py-1 border-r border-gray-200">
                      {dateLabel(row.new_job_kg != null ? row.new_job_date : undefined)}
                      <input
                        type="number" inputMode="decimal" step="0.1"
                        value={row.new_job_kg ?? ''}
                        onChange={e => updateNewJob(rowIdx, 'new_job_kg', e.target.value)}
                        className={numInput()}
                      />
                    </td>

                    {/* ── Col 3: 8 sessions ── */}
                    {row.sessions.map((sess, si) => (
                      <Fragment key={si}>
                        {/* ผลิตได้ */}
                        <td className="px-1 py-1 border-r border-gray-100">
                          {dateLabel(sess?.produced != null ? sess.produced_date : undefined)}
                          <input
                            type="number" inputMode="numeric"
                            value={sess?.produced ?? ''}
                            onChange={e => updateSession(rowIdx, si, 'produced', e.target.value)}
                            className={numInput()}
                          />
                        </td>
                        {/* ย้ายเข้าสต็อค */}
                        <td className="px-1 py-1 border-r border-gray-200 bg-green-50/60">
                          {dateLabel(sess?.moved != null ? sess.moved_date : undefined, 'text-green-500')}
                          <input
                            type="number" inputMode="numeric"
                            value={sess?.moved ?? ''}
                            onChange={e => updateSession(rowIdx, si, 'moved', e.target.value)}
                            className={numInput('bg-green-50')}
                          />
                        </td>
                      </Fragment>
                    ))}

                    {/* ── Col 4: รวม ── */}
                    <td className="px-3 py-1 text-center font-bold bg-green-50 border-l border-gray-200">
                      <div className="text-green-700 whitespace-nowrap text-sm">
                        {total > 0 ? total.toLocaleString('th-TH') : '—'}
                      </div>
                    </td>

                    {/* ── ลบแถว ── */}
                    <td className="px-2 py-1 border-l border-gray-200 text-center">
                      <button
                        onClick={() => {
                          if (confirm('ลบแถวนี้ใช่หรือไม่?')) deleteRow(rowIdx)
                        }}
                        className="px-2 py-0.5 text-[10px] rounded bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 transition-colors"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <button
          onClick={addRow}
          className="mt-3 px-5 py-2 text-sm rounded bg-[#9b9484] hover:bg-[#7a7568] text-white font-medium transition-colors"
        >
          + เพิ่มแถว
        </button>
      </main>
    </div>
  )
}
