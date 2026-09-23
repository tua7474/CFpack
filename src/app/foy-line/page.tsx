'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import Link from 'next/link'

// ── Config ─────────────────────────────────────────────────────────────────────

const MODELS = [
  { label: 'สีอ่อน',    group: 'รุ่นสีอ่อน'    },
  { label: 'สีพิเศษ B', group: 'รุ่นสีพิเศษ B' },
  { label: 'สีพิเศษ A', group: 'รุ่นสีพิเศษ A' },
  { label: 'ปุยนุ่น',   group: 'ฝอยนุ่น'        },
  { label: 'ครีเอท',    group: 'กระดาษฝอย'      },
] as const

const CUT_TYPES = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก'] as const

// ── Types ──────────────────────────────────────────────────────────────────────

interface Session {
  kg?: number
  cut_type?: string
  date?: string
}

interface ProductionRow {
  id?: number
  model_name?: string   // stored in product_name in DB
  color_name?: string
  product_id?: number   // catalog product id (for color reference)
  raw_kg?: number       // stored in new_job_kg in DB
  raw_date?: string     // stored in new_job_date in DB
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
  return { sessions: [{}] }
}

// ตัด trailing empty sessions เวลา load จาก DB
function trimSessions(sessions: Session[]): Session[] {
  const arr = [...sessions]
  while (arr.length > 1) {
    const last = arr[arr.length - 1]
    if (!last?.kg && !last?.cut_type) arr.pop()
    else break
  }
  return arr
}

function hasData(row: ProductionRow) {
  return (
    !!row.model_name || !!row.color_name ||
    row.raw_kg != null ||
    row.sessions.some(s => s?.kg != null)
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FoyLinePage() {
  const [rows,     setRows]     = useState<ProductionRow[]>([emptyRow()])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading,  setLoading]  = useState(true)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch('/api/catalog').then(r => r.json()),
      fetch('/api/foy-production').then(r => r.json()).catch(() => []),
    ]).then(([catalog, production]: [CatalogProduct[], ProductionRow[]]) => {
      // Keep only foy-relevant groups
      const foyGroups = new Set<string>(MODELS.map(m => m.group))
      setProducts((catalog as CatalogProduct[]).filter(p => foyGroups.has(p.group_name)))
      const dbRows = (production as ProductionRow[]).map(r => ({
        ...r,
        sessions: trimSessions(r.sessions?.length ? r.sessions : [{}]),
      }))
      setRows(dbRows.length ? dbRows : [emptyRow()])
      setLoading(false)
    })
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────────

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

  // ── Color options for a given model ─────────────────────────────────────────

  const colorOptions = useCallback((modelLabel: string) => {
    const found = MODELS.find(m => m.label === modelLabel)
    if (!found) return []
    return products.filter(p => p.group_name === found.group)
  }, [products])

  // ── Update helpers ──────────────────────────────────────────────────────────

  const updateModel = useCallback((rowIdx: number, model: string) => {
    setRows(prev => {
      const updated: ProductionRow = {
        ...prev[rowIdx],
        model_name: model || undefined,
        color_name: undefined,
        product_id: undefined,
      }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
    })
  }, [scheduleSave])

  const updateColor = useCallback((rowIdx: number, productId: number) => {
    setRows(prev => {
      const found = products.find(p => p.id === productId)
      if (!found) return prev
      const updated: ProductionRow = {
        ...prev[rowIdx],
        product_id: found.id,
        color_name: found.product_name,
      }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
    })
  }, [products, scheduleSave])

  const updateRawDate = useCallback((rowIdx: number, val: string) => {
    setRows(prev => {
      const updated = { ...prev[rowIdx], raw_date: val || undefined }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
    })
  }, [scheduleSave])

  const updateRawKg = useCallback((rowIdx: number, raw: string) => {
    const val = raw === '' ? undefined : Number(raw)
    setRows(prev => {
      const row = prev[rowIdx]
      const patch: Partial<ProductionRow> = { raw_kg: val }
      if (val != null && !row.raw_date) patch.raw_date = todayStr()
      const updated = { ...row, ...patch }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
    })
  }, [scheduleSave])

  const updateSessionKg = useCallback((rowIdx: number, si: number, raw: string) => {
    const val = raw === '' ? undefined : Number(raw)
    setRows(prev => {
      const row = prev[rowIdx]
      const sessions = row.sessions.map((s, i) => {
        if (i !== si) return s
        const ns = { ...s, kg: val }
        if (val != null && !ns.date) ns.date = todayStr()
        return ns
      })
      const updated = { ...row, sessions }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
    })
  }, [scheduleSave])

  const updateSessionType = useCallback((rowIdx: number, si: number, val: string) => {
    setRows(prev => {
      const row = prev[rowIdx]
      const sessions = row.sessions.map((s, i) =>
        i !== si ? s : { ...s, cut_type: val || undefined }
      )
      const updated = { ...row, sessions }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
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

  const addSession = useCallback((rowIdx: number) => {
    setRows(prev => {
      const updated = { ...prev[rowIdx], sessions: [...prev[rowIdx].sessions, {}] }
      const next = [...prev]; next[rowIdx] = updated
      scheduleSave(updated, rowIdx)
      return next
    })
  }, [scheduleSave])

  // ── Computed ─────────────────────────────────────────────────────────────────

  const maxSessions = Math.max(1, ...rows.map(r => r.sessions.length))

  const totalKg = (row: ProductionRow) =>
    row.sessions.reduce((s, sess) => s + (Number(sess?.kg) || 0), 0)

  // ── Styles ───────────────────────────────────────────────────────────────────

  const numCls = 'w-full px-0.5 py-0.5 text-[10px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] text-center text-black bg-white'

  const dateLbl = (d?: string) => (
    <div className="text-[9px] text-blue-400 text-center leading-none h-3 mb-0.5 truncate">
      {fmtDateShort(d)}
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────────

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
        <Link href="/"           className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📦 สต็อคสินค้า</Link>
        <Link href="/stock"      className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌿 สต็อคกระดาษฝอย</Link>
        <Link href="/branches"   className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏪 สาขาและตัวแทน</Link>
        <Link href="/delivery"   className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🚚 จัดส่ง</Link>
        <Link href="/withdrawal" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📤 เบิกของ</Link>
        <Link href="/restock"    className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📥 เติมสต็อค</Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">🌀 ไลน์ผลิตกระดาษฝอย</span>
      </div>

      {/* Table */}
      <main className="p-4">
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="text-xs border-collapse bg-white" style={{ minWidth: 'max-content' }}>

            <thead>
              {/* Row 1 */}
              <tr className="bg-[#9b9484] text-white">
                <th rowSpan={3} className="px-3 py-2 border border-white/20 text-left align-top" style={{ minWidth: 210 }}>
                  <div className="font-semibold">รุ่น / สี · วันที่ / กก.</div>
                </th>
                <th colSpan={maxSessions * 2} className="px-3 py-1.5 border border-white/20 text-center font-semibold">
                  บันทึกการตัด
                </th>
                <th rowSpan={3} className="px-1 py-2 border border-white/20 text-center bg-[#6b7280]" style={{ minWidth: 32 }} />
                <th rowSpan={3} className="px-3 py-2 border border-white/20 text-center whitespace-nowrap bg-green-700" style={{ minWidth: 64 }}>
                  รวม<br/>กก.
                </th>
                <th rowSpan={3} className="px-3 py-2 border border-white/20 text-center whitespace-nowrap bg-blue-700" style={{ minWidth: 64 }}>
                  เหลือ<br/>กก.
                </th>
                <th rowSpan={3} className="px-2 py-2 border border-white/20 bg-red-900/50" style={{ minWidth: 40 }} />
              </tr>

              {/* Row 2 */}
              <tr className="bg-[#9b9484] text-white">
                {Array.from({ length: maxSessions }, (_, i) => (
                  <th key={i} colSpan={2} className="px-2 py-1 border border-white/20 text-center whitespace-nowrap text-[11px]">
                    ครั้งที่ {i + 1}
                  </th>
                ))}
              </tr>

              {/* Row 3 */}
              <tr className="bg-[#7a7568] text-white text-[10px]">
                {Array.from({ length: maxSessions }, (_, i) => (
                  <Fragment key={i}>
                    <th className="px-0.5 py-1 border border-white/20 text-center" style={{ minWidth: 26 }}>กก.</th>
                    <th className="px-0.5 py-1 border border-white/20 text-center bg-amber-900/40" style={{ minWidth: 36 }}>หมวด</th>
                  </Fragment>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, rowIdx) => {
                const total     = totalKg(row)
                const remaining = row.raw_kg != null ? row.raw_kg - total : null
                const colors    = colorOptions(row.model_name ?? '')

                return (
                  <tr key={rowIdx} className="border-b border-gray-100 hover:bg-yellow-50/30 align-top">

                    {/* ── Col 1: วัตถุดิบ ── */}
                    <td className="px-2 py-1.5 border-r border-gray-200 align-top">
                      {/* บรรทัด 1: รุ่น + สี */}
                      <div className="flex gap-1 mb-1">
                        <select
                          value={row.model_name ?? ''}
                          onChange={e => updateModel(rowIdx, e.target.value)}
                          className="w-[90px] shrink-0 px-1 py-0.5 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] bg-white text-black"
                        >
                          <option value="">-- รุ่น --</option>
                          {MODELS.map(m => (
                            <option key={m.label} value={m.label}>{m.label}</option>
                          ))}
                        </select>
                        <select
                          value={row.product_id ?? ''}
                          onChange={e => updateColor(rowIdx, Number(e.target.value))}
                          disabled={!row.model_name || colors.length === 0}
                          className="flex-1 min-w-0 px-1 py-0.5 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] bg-white text-black disabled:opacity-40"
                        >
                          <option value="">-- สี --</option>
                          {colors.map(p => (
                            <option key={p.id} value={p.id}>{p.product_name}</option>
                          ))}
                        </select>
                      </div>

                      {/* บรรทัด 2: วันที่ + กก. */}
                      <div className="flex gap-1 items-center">
                        <input
                          type="date"
                          value={row.raw_date ?? ''}
                          onChange={e => updateRawDate(rowIdx, e.target.value)}
                          className="w-[112px] shrink-0 px-1 py-0.5 text-[10px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] text-black bg-white"
                        />
                        <input
                          type="number" inputMode="decimal" step="0.1"
                          value={row.raw_kg ?? ''}
                          onChange={e => updateRawKg(rowIdx, e.target.value)}
                          className="flex-1 min-w-0 px-1 py-0.5 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] text-center text-black bg-white"
                          placeholder="กก."
                        />
                      </div>

                    </td>

                    {/* ── Sessions ── */}
                    {Array.from({ length: maxSessions }, (_, si) => {
                      const sess = row.sessions[si]
                      const active = si < row.sessions.length
                      return (
                        <Fragment key={si}>
                          {/* กก. */}
                          <td className="px-0.5 py-1 border-r border-gray-100 align-top" style={{ minWidth: 26 }}>
                            {dateLbl(active && sess?.kg != null ? sess?.date : undefined)}
                            <input
                              type="number" inputMode="decimal" step="0.1"
                              value={active ? (sess?.kg ?? '') : ''}
                              onChange={e => updateSessionKg(rowIdx, si, e.target.value)}
                              disabled={!active}
                              className={numCls + (active ? '' : ' opacity-20 cursor-not-allowed')}
                              placeholder="กก."
                            />
                          </td>
                          {/* หมวด */}
                          <td className="px-0 py-1 border-r border-gray-200 align-top bg-amber-50/40" style={{ minWidth: 36 }}>
                            <div className="h-3 mb-0.5" />
                            <select
                              value={active ? (sess?.cut_type ?? '') : ''}
                              onChange={e => updateSessionType(rowIdx, si, e.target.value)}
                              disabled={!active}
                              className={'w-full px-0 py-0.5 text-[9px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#9b9484] bg-white text-black' + (active ? '' : ' opacity-20 cursor-not-allowed')}
                            >
                              <option value="">--</option>
                              {CUT_TYPES.map(t => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                        </Fragment>
                      )
                    })}

                    {/* ── + เพิ่มครั้ง ── */}
                    <td className="px-1 py-2 border-r border-gray-200 text-center align-middle bg-gray-50">
                      <button
                        onClick={() => addSession(rowIdx)}
                        title="เพิ่มครั้งตัด"
                        className="w-6 h-6 rounded-full bg-gray-200 hover:bg-[#9b9484] hover:text-white text-gray-600 font-bold text-sm leading-none transition-colors flex items-center justify-center mx-auto"
                      >
                        +
                      </button>
                    </td>

                    {/* ── รวม กก. ── */}
                    <td className="px-3 py-2 text-center font-bold bg-green-50 border-l border-gray-200 align-middle">
                      <div className={`whitespace-nowrap text-sm ${total > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                        {total > 0 ? total.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '—'}
                      </div>
                      {total > 0 && (
                        <div className="text-[10px] text-green-400 font-normal">
                          {row.sessions.filter(s => s?.kg != null).length} ครั้ง
                        </div>
                      )}
                    </td>

                    {/* ── เหลือ กก. ── */}
                    <td className="px-3 py-2 text-center font-bold bg-blue-50 border-l border-gray-200 align-middle">
                      {remaining !== null ? (
                        <div className={`whitespace-nowrap text-sm ${remaining < 0 ? 'text-red-500' : remaining === 0 ? 'text-gray-400' : 'text-blue-600'}`}>
                          {remaining.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>

                    {/* ── ลบ ── */}
                    <td className="px-2 py-2 border-l border-gray-200 text-center align-middle">
                      <button
                        onClick={() => { if (confirm('ลบแถวนี้?')) deleteRow(rowIdx) }}
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
