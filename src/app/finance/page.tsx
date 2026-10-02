'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Color group logic ─────────────────────────────────────────────────────────

const GREEN_BRANCHES  = ['โกดัง', 'โกดังCF']
const YELLOW_BRANCHES = ['ท่าฉลอม', 'หนองแขม', 'ไทรม้า', 'อ้อมน้อย', 'นครชัยศรี', 'ศรีนครินทร์']
const RED_BRANCHES    = ['สนามบินน้ำ', 'ตลาดรังสิต']

type ColorGroup = 'black' | 'editor' | 'green' | 'yellow' | 'red' | 'orange'

function getBranchColor(name: string, colorGroup?: string | null): ColorGroup {
  if (colorGroup === 'black' || colorGroup === 'editor' || colorGroup === 'yellow' || colorGroup === 'red' || colorGroup === 'orange') return colorGroup
  if (GREEN_BRANCHES.some(n => name.includes(n)))  return 'green'
  if (YELLOW_BRANCHES.some(n => name.includes(n))) return 'yellow'
  if (RED_BRANCHES.some(n => name.includes(n)))    return 'red'
  return 'orange'
}

const GROUP_ORDER: ColorGroup[] = ['black', 'editor', 'green', 'yellow', 'red', 'orange']

const GROUP_HEADER_BG: Record<ColorGroup, string> = {
  black:  'bg-black      text-white',
  editor: 'bg-green-600  text-white',
  green:  'bg-green-200  text-green-900',
  yellow: 'bg-yellow-200 text-yellow-900',
  red:    'bg-red-200    text-red-900',
  orange: 'bg-orange-200 text-orange-900',
}
const ROW_BG: Record<ColorGroup, string> = {
  black:  'bg-gray-900 text-white',
  editor: 'bg-green-50',
  green:  'bg-green-50',
  yellow: 'bg-yellow-50',
  red:    'bg-red-50',
  orange: 'bg-orange-50',
}
const GROUP_LABEL: Record<ColorGroup, string> = {
  black:  'ทีมงาน',
  editor: 'กลุ่ม Editor',
  green:  'โกดังCF',
  yellow: 'กลุ่มสีเหลือง',
  red:    'กลุ่มสีแดง',
  orange: 'กลุ่มสีส้ม',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchFinance {
  id: number
  name: string
  color_group: string | null
  pay_total: number
  store_total: number
  vat_total: number
  fee: number
  order_total: number
  order_paid: number
  order_pending: number
}

type Period = 'week' | 'month' | 'all'

function fmt(n: number): string {
  if (n === 0) return '-'
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const COLS = 9  // total columns

// ── Component ─────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [data, setData]       = useState<BranchFinance[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<Period>('month')
  const [feeEdits, setFeeEdits] = useState<Record<number, string>>({})
  const [saving, setSaving]   = useState<Record<number, boolean>>({})

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/finance?period=${period}`)
      .then(r => r.json())
      .then((rows: BranchFinance[]) => { setData(rows); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period])

  useEffect(() => { load() }, [load])

  const saveFee = async (branchId: number) => {
    const raw = feeEdits[branchId]
    if (raw === undefined) return
    const fee = parseFloat(raw) || 0
    setSaving(s => ({ ...s, [branchId]: true }))
    await fetch('/api/finance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branchId, fee }),
    })
    setSaving(s => ({ ...s, [branchId]: false }))
    setFeeEdits(e => { const n = { ...e }; delete n[branchId]; return n })
    setData(prev => prev.map(b => b.id === branchId ? { ...b, fee } : b))
  }

  // Group branches by color
  type GroupedItem = { color: ColorGroup; items: BranchFinance[] }
  const grouped: GroupedItem[] = (() => {
    const map: Record<ColorGroup, BranchFinance[]> = { black: [], editor: [], green: [], yellow: [], red: [], orange: [] }
    for (const b of data) map[getBranchColor(b.name, b.color_group)].push(b)
    return GROUP_ORDER.filter(g => map[g].length > 0).map(g => ({ color: g, items: map[g] }))
  })()

  const grand = {
    pay:     data.reduce((s, b) => s + b.pay_total,     0),
    store:   data.reduce((s, b) => s + b.store_total,   0),
    vat:     data.reduce((s, b) => s + b.vat_total,     0),
    fee:     data.reduce((s, b) => s + b.fee,           0),
    total:   data.reduce((s, b) => s + b.order_total,   0),
    paid:    data.reduce((s, b) => s + b.order_paid,    0),
    pending: data.reduce((s, b) => s + b.order_pending, 0),
  }

  const periodLabel: Record<Period, string> = {
    week:  'สัปดาห์นี้',
    month: 'เดือนนี้',
    all:   'ทั้งหมด',
  }

  const thCls = 'px-3 py-2 border-r border-gray-500 whitespace-nowrap text-right'

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center gap-4">
        <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex overflow-x-auto">
        <Link href="/"         className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📦 สต็อคสินค้า</Link>
        <Link href="/stock"    className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌿 สต็อคกระดาษฝอย</Link>
        <Link href="/orders"   className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📋 ใบจอง</Link>
        <Link href="/branches" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏪 สาขาและตัวแทน</Link>
        <Link href="/delivery" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🚚 จัดส่ง</Link>
        <Link href="/withdrawal" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📤 เบิกของ</Link>
        <Link href="/restock"  className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📥 ใบPO</Link>
        <Link href="/suppliers" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏭 ซัพพลายเออร์</Link>
        <Link href="/foy-line" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌀 ไลน์ผลิตกระดาษฝอย</Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">💰 การเงิน</span>
      </div>

      {/* Period selector */}
      <div className="px-4 pt-4 flex gap-2">
        {(['week', 'month', 'all'] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 text-xs rounded-full font-semibold border transition-colors ${
              period === p ? 'bg-[#9b9484] text-white border-[#9b9484]' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
            }`}>
            {periodLabel[p]}
          </button>
        ))}
      </div>

      {/* Main table */}
      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลดข้อมูล...</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 150px)' }}>
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-20">
                  {/* Column group headers */}
                  <tr className="bg-[#7a7568] text-white text-center text-[10px]">
                    <th className="px-3 py-1 border-r border-gray-500 text-left">สาขา / ตัวแทน</th>
                    <th colSpan={3} className="px-3 py-1 border-r border-gray-500">สลิปจาก LINE</th>
                    <th className="px-3 py-1 border-r border-gray-500">ค่าธรรมเนียม</th>
                    <th colSpan={3} className="px-3 py-1">ยอดใบจอง</th>
                  </tr>
                  <tr className="bg-[#9b9484] text-white text-left">
                    <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap min-w-[160px]">ชื่อสาขา</th>
                    <th className={thCls + ' min-w-[110px] bg-green-700'}>ยอดตรงใบจอง</th>
                    <th className={thCls + ' min-w-[110px] bg-amber-700'}>หักค่าของ</th>
                    <th className={thCls + ' min-w-[100px] bg-blue-700 border-r-2 border-white/40'}>แวต</th>
                    <th className={thCls + ' min-w-[100px] bg-purple-700 border-r-2 border-white/40'}>Fee</th>
                    <th className={thCls + ' min-w-[120px]'}>รวมทั้งหมด</th>
                    <th className={thCls + ' min-w-[120px] bg-green-600'}>ชำระแล้ว</th>
                    <th className="px-3 py-2 whitespace-nowrap text-right min-w-[120px] bg-red-700">ค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(({ color, items }) => {
                    const gPay     = items.reduce((s, b) => s + b.pay_total,     0)
                    const gStore   = items.reduce((s, b) => s + b.store_total,   0)
                    const gVat     = items.reduce((s, b) => s + b.vat_total,     0)
                    const gFee     = items.reduce((s, b) => s + b.fee,           0)
                    const gTotal   = items.reduce((s, b) => s + b.order_total,   0)
                    const gPaid    = items.reduce((s, b) => s + b.order_paid,    0)
                    const gPending = items.reduce((s, b) => s + b.order_pending, 0)
                    return [
                      <tr key={`g-${color}`} className={GROUP_HEADER_BG[color]}>
                        <td colSpan={COLS} className="px-3 py-1.5 font-bold text-sm">{GROUP_LABEL[color]}</td>
                      </tr>,

                      ...items.map(b => {
                        const feeVal = feeEdits[b.id] !== undefined ? feeEdits[b.id] : String(b.fee === 0 ? '' : b.fee)
                        const feePending = feeEdits[b.id] !== undefined
                        return (
                          <tr key={b.id} className={`border-b border-gray-100 hover:brightness-95 transition-all ${ROW_BG[color]}`}>
                            <td className="px-3 py-2 border-r border-gray-200 font-medium">{b.name}</td>
                            <td className={`px-3 py-2 border-r border-gray-200 text-right font-mono ${b.pay_total > 0 ? 'text-green-700 font-semibold' : 'text-gray-300'}`}>
                              {fmt(b.pay_total)}
                            </td>
                            <td className={`px-3 py-2 border-r border-gray-200 text-right font-mono ${b.store_total > 0 ? 'text-amber-700 font-semibold' : 'text-gray-300'}`}>
                              {fmt(b.store_total)}
                            </td>
                            <td className={`px-3 py-2 border-r border-gray-200 text-right font-mono ${b.vat_total > 0 ? 'text-blue-700 font-semibold' : 'text-gray-300'}`}>
                              {fmt(b.vat_total)}
                            </td>
                            {/* Fee — editable */}
                            <td className="px-2 py-1 border-r border-gray-200">
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="number" inputMode="decimal" step="0.01"
                                  placeholder="0"
                                  value={feeVal}
                                  onChange={e => setFeeEdits(fe => ({ ...fe, [b.id]: e.target.value }))}
                                  onBlur={() => saveFee(b.id)}
                                  onKeyDown={e => e.key === 'Enter' && saveFee(b.id)}
                                  className={`w-20 px-1.5 py-0.5 text-xs rounded border text-right focus:outline-none focus:ring-1 focus:ring-purple-400 ${feePending ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'} ${saving[b.id] ? 'opacity-50' : ''}`}
                                />
                              </div>
                            </td>
                            {/* Order totals */}
                            <td className={`px-3 py-2 border-r border-gray-200 text-right font-mono ${b.order_total > 0 ? 'text-gray-700 font-semibold' : 'text-gray-300'}`}>
                              {fmt(b.order_total)}
                            </td>
                            <td className={`px-3 py-2 border-r border-gray-200 text-right font-mono ${b.order_paid > 0 ? 'text-green-700 font-semibold' : 'text-gray-300'}`}>
                              {fmt(b.order_paid)}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono ${b.order_pending > 0 ? 'text-red-600 font-semibold' : 'text-gray-300'}`}>
                              {fmt(b.order_pending)}
                            </td>
                          </tr>
                        )
                      }),

                      <tr key={`gt-${color}`} className={`border-b-2 border-gray-300 text-xs font-semibold ${GROUP_HEADER_BG[color]} opacity-80`}>
                        <td className="px-3 py-1 text-right border-r border-gray-300">รวมกลุ่ม</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300">{fmt(gPay)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300">{fmt(gStore)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300">{fmt(gVat)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300">{fmt(gFee)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300">{fmt(gTotal)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300">{fmt(gPaid)}</td>
                        <td className="px-3 py-1 text-right font-mono">{fmt(gPending)}</td>
                      </tr>,
                    ]
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#9b9484] text-white font-bold text-xs">
                    <td className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">รวมทั้งหมด ({periodLabel[period]})</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono">{fmt(grand.pay)}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono">{fmt(grand.store)}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono">{fmt(grand.vat)}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono">{fmt(grand.fee)}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono">{fmt(grand.total)}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono">{fmt(grand.paid)}</td>
                    <td className="px-3 py-2 text-right font-mono">{grand.pending > 0 ? grand.pending.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
