'use client'

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }
interface FoyItem   { id: number; category: string; model_name: string; color_name: string }
interface BSBranch  { id: number; name: string; color_group: string | null }

// ── Color group logic (เหมือนหน้าสาขาและตัวแทน) ──────────────────────────────
const GREEN_BRANCHES  = ['โกดัง', 'โกดังCF']
const YELLOW_BRANCHES = ['ท่าฉลอม', 'หนองแขม', 'ไทรม้า', 'อ้อมน้อย', 'นครชัยศรี', 'ศรีนครินทร์']
const RED_BRANCHES    = ['สนามบินน้ำ', 'ตลาดรังสิต']

type ColorGroup = 'orange' | 'yellow' | 'red' | 'green' | 'black' | 'editor'

function getBranchColor(name: string, colorGroup: string | null): ColorGroup {
  if (colorGroup === 'black' || colorGroup === 'editor' || colorGroup === 'yellow' || colorGroup === 'red' || colorGroup === 'orange') return colorGroup
  if (GREEN_BRANCHES.some(n => name.includes(n)))  return 'green'
  if (YELLOW_BRANCHES.some(n => name.includes(n))) return 'yellow'
  if (RED_BRANCHES.some(n => name.includes(n)))    return 'red'
  return 'orange'
}

const COL_ORDER: ColorGroup[] = ['orange', 'yellow', 'red', 'green', 'black', 'editor']
const COL_HEADER: Record<ColorGroup, string> = {
  orange: 'bg-orange-200 text-orange-900',
  yellow: 'bg-yellow-200 text-yellow-900',
  red:    'bg-red-200    text-red-900',
  green:  'bg-green-200  text-green-900',
  black:  'bg-gray-700   text-white',
  editor: 'bg-blue-200   text-blue-900',
}

// ── FoyStockCell ──────────────────────────────────────────────────────────────
function FoyStockCell({ branchId, itemId, currentQty, onSave }: {
  branchId: number; itemId: number; currentQty: number
  onSave: (branchId: number, itemId: number, qty: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => { setVal(currentQty > 0 ? String(currentQty) : ''); setEditing(true) }
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commit = () => {
    setEditing(false)
    const num = parseFloat(val) || 0
    if (num !== currentQty) onSave(branchId, itemId, num)
  }

  if (editing) {
    return (
      <input ref={inputRef} type="number" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-full min-w-[48px] text-center text-xs border border-blue-400 rounded px-1 py-0.5 focus:outline-none bg-white"
      />
    )
  }
  return (
    <div onClick={startEdit}
      className={`text-center cursor-pointer rounded px-1 py-0.5 hover:bg-blue-50 min-w-[48px] text-xs select-none ${currentQty > 0 ? 'font-semibold text-gray-800' : 'text-gray-300'}`}>
      {currentQty > 0 ? currentQty.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '—'}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BranchFoyStockPage() {
  const router = useRouter()

  const [items,    setItems]    = useState<FoyItem[]>([])
  const [branches, setBranches] = useState<BSBranch[]>([])
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  const [loading,  setLoading]  = useState(true)
  const [session,  setSession]  = useState<SessionInfo | null>(null)

  useEffect(() => {
    try {
      const s = localStorage.getItem('branch_session')
      if (s) {
        const parsed: SessionInfo = JSON.parse(s)
        if (!parsed.is_admin) { window.location.replace('/booking2'); return }
        setSession(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('branch_session')
    router.replace('/branches')
  }

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/branch-foy-stock')
    if (!r.ok) { setLoading(false); return }
    const data = await r.json()
    setItems(data.items)
    setBranches(data.branches)
    const map: Record<string, number> = {}
    for (const s of data.stock) map[`${s.branch_id}_${s.paper_stock_id}`] = Number(s.quantity)
    setStockMap(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const sortedBranches = useMemo(
    () => [...branches].sort((a, b) => {
      const ca = COL_ORDER.indexOf(getBranchColor(a.name, a.color_group))
      const cb = COL_ORDER.indexOf(getBranchColor(b.name, b.color_group))
      return ca !== cb ? ca - cb : a.name.localeCompare(b.name, 'th')
    }),
    [branches]
  )

  // จัดกลุ่ม: category → model_name → items[]
  const grouped = useMemo(() => {
    const catMap = new Map<string, Map<string, FoyItem[]>>()
    for (const item of items) {
      if (!catMap.has(item.category)) catMap.set(item.category, new Map())
      const modelMap = catMap.get(item.category)!
      if (!modelMap.has(item.model_name)) modelMap.set(item.model_name, [])
      modelMap.get(item.model_name)!.push(item)
    }
    return Array.from(catMap.entries()).map(([cat, modelMap]) => ({
      cat,
      models: Array.from(modelMap.entries()).map(([model, rows]) => ({ model, rows })),
    }))
  }, [items])

  const handleSave = useCallback(async (branchId: number, itemId: number, qty: number) => {
    setStockMap(prev => ({ ...prev, [`${branchId}_${itemId}`]: qty }))
    await fetch('/api/branch-foy-stock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branchId, paper_stock_id: itemId, quantity: qty }),
    })
  }, [])

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
          {session && <p className="text-orange-200 text-xs mt-0.5">เข้าสู่ระบบ: {session.branch_name} · {session.phone}</p>}
        </div>
        {session && (
          <button onClick={handleLogout}
            className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white border border-white/30 transition-colors whitespace-nowrap">
            ออกจากระบบ
          </button>
        )}
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex overflow-x-auto">
        <Link href="/"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📦 สต็อคสินค้า
        </Link>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌿 สต็อคกระดาษฝอย
        </Link>
        <Link href="/orders"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📋 ใบจอง
        </Link>
        <Link href="/branches"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🏪 สาขาและตัวแทน
        </Link>
        <Link href="/delivery"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🚚 จัดส่ง
        </Link>
        <Link href="/withdrawal"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📤 เบิกของ
        </Link>
        <Link href="/restock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📥 ใบPO
        </Link>
        <Link href="/suppliers"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🏭 ซัพพลายเออร์
        </Link>
        <Link href="/foy-line"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌀 ไลน์ผลิตกระดาษฝอย
        </Link>
        <Link href="/finance"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          💰 การเงิน
        </Link>
        <Link href="/branch-stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🏬 สต็อคทุกสาขา
        </Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">
          🌿 สต็อคกระดาษฝอยทุกสาขา
        </span>
      </div>

      {/* Main */}
      <main className="p-4">
        <h2 className="text-sm font-bold text-gray-600 mb-3">🌿 สต็อคกระดาษฝอยทุกสาขา</h2>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-gray-400 text-sm">กำลังโหลด...</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white">
            <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
              <table className="text-xs border-collapse" style={{ minWidth: `${200 + sortedBranches.length * 80}px` }}>
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="sticky left-0 z-30 bg-[#9b9484] text-white text-left px-3 py-2 font-bold min-w-[200px] border-r border-white/30">
                      กระดาษฝอย
                    </th>
                    {sortedBranches.map(b => (
                      <th key={b.id}
                        className={`px-2 py-2 text-center font-semibold whitespace-nowrap border-l border-white/30 ${COL_HEADER[getBranchColor(b.name, b.color_group)]}`}>
                        {b.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(({ cat, models }) => (
                    <Fragment key={cat}>
                      {/* Category header */}
                      <tr>
                        <td colSpan={sortedBranches.length + 1}
                          className="sticky left-0 bg-[#6b7280] text-white text-[11px] font-bold px-3 py-1">
                          {cat}
                        </td>
                      </tr>
                      {models.map(({ model, rows }) => (
                        <Fragment key={model}>
                          {/* Model header */}
                          <tr>
                            <td colSpan={sortedBranches.length + 1}
                              className="sticky left-0 bg-[#9b9484] text-white text-[11px] font-bold px-3 py-1 pl-5">
                              {model}
                            </td>
                          </tr>
                          {/* Color rows */}
                          {rows.map(item => (
                            <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                              <td className="sticky left-0 bg-white z-10 px-3 py-1 pl-7 text-gray-700 border-r border-gray-200 min-w-[200px]">
                                {item.color_name || '—'}
                              </td>
                              {sortedBranches.map(b => (
                                <td key={b.id} className="px-1 py-0.5 border-l border-gray-100 text-center">
                                  <FoyStockCell
                                    branchId={b.id} itemId={item.id}
                                    currentQty={stockMap[`${b.id}_${item.id}`] ?? 0}
                                    onSave={handleSave}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
