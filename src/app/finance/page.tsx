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

interface SlipEntry { date: string; amount: number }
interface BranchFinance {
  id: number; name: string; color_group: string | null
  pay: SlipEntry[]; store: SlipEntry[]; vat: SlipEntry[]; fee: SlipEntry[]
  order_entries: SlipEntry[]
  order_total: number; order_paid: number; order_pending: number
}

type Period = 'week' | 'month' | 'all'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateShort(iso: string): string {
  // "2026-10-02" → "2 ต.ค."
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

function fmtTotal(n: number): string {
  if (n === 0) return '-'
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Week boundaries (Bangkok time) ───────────────────────────────────────────

function getWeekBounds() {
  const bkk      = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const dow      = bkk.getDay()
  const toMon    = dow === 0 ? 6 : dow - 1
  const thisMon  = new Date(bkk); thisMon.setDate(bkk.getDate() - toMon); thisMon.setHours(0,0,0,0)
  const lastMon  = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7)
  const twoMon   = new Date(thisMon); twoMon.setDate(thisMon.getDate() - 14)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { thisMondayStr: fmt(thisMon), lastMondayStr: fmt(lastMon), twoMondaysStr: fmt(twoMon) }
}

// ── MonthlySlipCell — vat/fee: 3 month groups ────────────────────────────────

function getMonthBounds() {
  const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const y = bkk.getFullYear(), m = bkk.getMonth() + 1
  const thisKey = `${y}-${String(m).padStart(2, '0')}`
  const lm = m === 1 ? 12 : m - 1
  const ly = m === 1 ? y - 1 : y
  const lastKey = `${ly}-${String(lm).padStart(2, '0')}`
  return { thisKey, lastKey, thisNum: m, lastNum: lm }
}

function MonthlySlipCell({ entries, amtColor, title, onDetail }: {
  entries: SlipEntry[]; amtColor: string; title: string
  onDetail: (info: ModalInfo) => void
}) {
  if (entries.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
  const { thisKey, lastKey, thisNum, lastNum } = getMonthBounds()

  const thisMonth = entries.filter(e => e.date.slice(0, 7) === thisKey)
  const lastMonth = entries.filter(e => e.date.slice(0, 7) === lastKey)
  const older     = entries.filter(e => e.date.slice(0, 7) < lastKey)

  const sum = (arr: SlipEntry[]) => arr.reduce((s, e) => s + e.amount, 0)
  const fmt = (n: number) => n === 0 ? '0' : n.toLocaleString('th-TH', { maximumFractionDigits: 0 })

  const groups = [
    { key: 'older', label: `ก่อนๆ`, num: null,     items: older },
    { key: 'last',  label: `${lastNum}`,  num: lastNum, items: lastMonth },
    { key: 'this',  label: `${thisNum}`,  num: thisNum, items: thisMonth },
  ].filter(g => g.items.length > 0)

  if (groups.length === 0) return <span className="text-gray-300 text-[10px]">-</span>

  return (
    <div className="flex flex-col gap-0.5">
      {groups.map(g => (
        <button key={g.key}
          onClick={() => onDetail({ title: `${title} (${g.label})`, entries: g.items })}
          className={`text-left text-[11px] font-mono font-semibold ${amtColor} hover:underline leading-tight`}
        >
          {g.label}/{fmt(sum(g.items))}
        </button>
      ))}
    </div>
  )
}

// ── SlipCell — (unused, kept for reference) ───────────────────────────────────

function SlipCell({ entries, amtColor }: { entries: SlipEntry[]; amtColor: string }) {
  if (entries.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
  const total = entries.reduce((s, e) => s + e.amount, 0)
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map((e, i) => (
        <div key={i} className="flex flex-col leading-tight">
          <span className="text-[9px] text-gray-400">{fmtDateShort(e.date)}</span>
          <span className={`text-[11px] font-semibold font-mono ${amtColor}`}>{fmtAmt(e.amount)}</span>
        </div>
      ))}
      {entries.length > 1 && (
        <div className="border-t border-gray-300 mt-0.5 pt-0.5">
          <span className={`text-[10px] font-bold font-mono ${amtColor}`}>รวม {fmtAmt(total)}</span>
        </div>
      )}
    </div>
  )
}

// ── WeeklyCompactCell — order/paid: last 3 weeks breakdown ───────────────────

interface ModalInfo { title: string; entries: SlipEntry[] }

function WeeklyCompactCell({ entries, amtColor, title, onDetail }: {
  entries: SlipEntry[]; amtColor: string; title: string
  onDetail: (info: ModalInfo) => void
}) {
  const { thisMondayStr, lastMondayStr, twoMondaysStr } = getWeekBounds()
  const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
  const groups = [
    { label: '2 สัปดาห์ก่อน', items: entries.filter(e => e.date >= twoMondaysStr && e.date < lastMondayStr) },
    { label: 'สัปดาห์ที่แล้ว',  items: entries.filter(e => e.date >= lastMondayStr && e.date < thisMondayStr) },
    { label: 'สัปดาห์นี้',       items: entries.filter(e => e.date >= thisMondayStr) },
  ].filter(g => g.items.length > 0)
  if (groups.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
  return (
    <div className="flex flex-col gap-0.5">
      {groups.map(({ label, items }) => (
        <button key={label}
          onClick={() => onDetail({ title: `${title} (${label})`, entries: items })}
          className={`text-left text-[11px] font-mono font-semibold ${amtColor} hover:underline leading-tight`}
        >
          {items.length}/{fmt(items.reduce((s, e) => s + e.amount, 0))}
        </button>
      ))}
    </div>
  )
}

function WeeklyPendingCell({ orderEntries, paidEntries }: {
  orderEntries: SlipEntry[]; paidEntries: SlipEntry[]
}) {
  const { thisMondayStr, lastMondayStr, twoMondaysStr } = getWeekBounds()
  const sumRange = (arr: SlipEntry[], s: string, e?: string) =>
    arr.filter(x => x.date >= s && (!e || x.date < e)).reduce((acc, x) => acc + x.amount, 0)
  const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
  const weeks = [
    { label: '2 สัปดาห์ก่อน', oTotal: sumRange(orderEntries, twoMondaysStr, lastMondayStr), pTotal: sumRange(paidEntries, twoMondaysStr, lastMondayStr) },
    { label: 'สัปดาห์ที่แล้ว',  oTotal: sumRange(orderEntries, lastMondayStr, thisMondayStr), pTotal: sumRange(paidEntries, lastMondayStr, thisMondayStr) },
    { label: 'สัปดาห์นี้',       oTotal: sumRange(orderEntries, thisMondayStr),                pTotal: sumRange(paidEntries, thisMondayStr) },
  ].filter(w => w.oTotal > 0)
  if (weeks.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
  return (
    <div className="flex flex-col gap-0.5">
      {weeks.map(({ label, oTotal, pTotal }) => {
        const pending = Math.max(0, oTotal - pTotal)
        return (
          <div key={label} className={`text-[11px] font-mono font-semibold leading-tight ${pending > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {pending > 0 ? fmt(pending) : '✓'}
          </div>
        )
      })}
    </div>
  )
}

// ── GroupedSlipCell — pay/store: 3 time-period groups ─────────────────────────

function GroupedSlipCell({ entries, amtColor, title, onDetail, compact }: {
  entries: SlipEntry[]; amtColor: string; title: string
  onDetail: (info: ModalInfo) => void
  compact?: boolean
}) {
  if (entries.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
  const { thisMondayStr, lastMondayStr } = getWeekBounds()
  const groups = [
    { label: 'เกิน 2 สัปดาห์', items: entries.filter(e => e.date < lastMondayStr) },
    { label: 'สัปดาห์ที่แล้ว',  items: entries.filter(e => e.date >= lastMondayStr && e.date < thisMondayStr) },
    { label: 'สัปดาห์นี้',       items: entries.filter(e => e.date >= thisMondayStr) },
  ]
  const fmt = (n: number) => n === 0 ? '0' : n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
  if (compact) {
    const active = groups.filter(g => g.items.length > 0)
    if (active.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
    return (
      <div className="flex flex-col gap-0.5">
        {active.map(({ label, items }) => (
          <button key={label}
            onClick={() => onDetail({ title: `${title} (${label})`, entries: items })}
            className={`text-left text-[11px] font-mono font-semibold ${amtColor} hover:underline leading-tight`}
          >
            {items.length}/{fmt(items.reduce((s, e) => s + e.amount, 0))}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1 min-w-[88px]">
      {groups.map(({ label, items }) => {
        if (items.length === 0) return null
        const total = items.reduce((s, e) => s + e.amount, 0)
        return (
          <div key={label} className="border border-gray-200 rounded px-1.5 py-0.5 bg-white/60">
            <div className="text-[8px] text-gray-400 leading-tight">{label}</div>
            <button
              onClick={() => onDetail({ title: `${title} (${label})`, entries: items })}
              className={`text-[11px] font-bold font-mono ${amtColor} hover:underline leading-tight`}
            >
              {items.length} รายการ
            </button>
            <div className={`text-[10px] font-semibold font-mono ${amtColor} leading-tight`}>
              {fmtAmt(total)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [data, setData]       = useState<BranchFinance[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<Period>('month')
  const [modal, setModal]     = useState<ModalInfo | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/finance?period=${period}`)
      .then(r => r.json())
      .then((rows: BranchFinance[]) => { setData(rows); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period])

  useEffect(() => { load() }, [load])

  type GroupedItem = { color: ColorGroup; items: BranchFinance[] }
  const grouped: GroupedItem[] = (() => {
    const map: Record<ColorGroup, BranchFinance[]> = { black: [], editor: [], green: [], yellow: [], red: [], orange: [] }
    for (const b of data) map[getBranchColor(b.name, b.color_group)].push(b)
    return GROUP_ORDER.filter(g => map[g].length > 0).map(g => ({ color: g, items: map[g] }))
  })()

  const sumEntries = (rows: BranchFinance[], key: 'pay' | 'store' | 'vat' | 'fee') =>
    rows.reduce((s, b) => s + b[key].reduce((ss, e) => ss + e.amount, 0), 0)

  const grand = {
    pay:     (rows: BranchFinance[]) => sumEntries(rows, 'pay'),
    store:   (rows: BranchFinance[]) => sumEntries(rows, 'store'),
    vat:     (rows: BranchFinance[]) => sumEntries(rows, 'vat'),
    fee:     (rows: BranchFinance[]) => sumEntries(rows, 'fee'),
    total:   (rows: BranchFinance[]) => rows.reduce((s, b) => s + b.order_total, 0),
    paid:    (rows: BranchFinance[]) => rows.reduce((s, b) => s + b.pay.reduce((ss, e) => ss + e.amount, 0) + b.store.reduce((ss, e) => ss + e.amount, 0), 0),
    pending: (rows: BranchFinance[]) => rows.reduce((s, b) => {
      const slipPaid = b.pay.reduce((ss, e) => ss + e.amount, 0) + b.store.reduce((ss, e) => ss + e.amount, 0)
      return s + Math.max(0, b.order_total - slipPaid)
    }, 0),
  }

  const periodLabel: Record<Period, string> = { week: 'สัปดาห์นี้', month: 'เดือนนี้', all: 'ทั้งหมด' }

  const thBase = 'px-3 py-2 border-r border-gray-500 whitespace-nowrap text-right'

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center gap-4">
        <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex overflow-x-auto">
        <Link href="/"          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📦 สต็อคสินค้า</Link>
        <Link href="/stock"     className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌿 สต็อคกระดาษฝอย</Link>
        <Link href="/orders"    className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📋 ใบจอง</Link>
        <Link href="/branches"  className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏪 สาขาและตัวแทน</Link>
        <Link href="/delivery"  className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🚚 จัดส่ง</Link>
        <Link href="/withdrawal" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📤 เบิกของ</Link>
        <Link href="/restock"   className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📥 ใบPO</Link>
        <Link href="/suppliers" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏭 ซัพพลายเออร์</Link>
        <Link href="/foy-line"  className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌀 ไลน์ผลิตกระดาษฝอย</Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">💰 การเงิน</span>
      </div>

      {/* Period selector */}
      <div className="px-4 pt-4 flex gap-2 items-center">
        {(['week', 'month', 'all'] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 text-xs rounded-full font-semibold border transition-colors ${
              period === p ? 'bg-[#9b9484] text-white border-[#9b9484]' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
            }`}>
            {periodLabel[p]}
          </button>
        ))}
        <button onClick={load} className="px-3 py-1.5 text-xs rounded-full border border-gray-300 bg-white text-gray-500 hover:bg-gray-50">
          🔄 รีเฟรช
        </button>
      </div>

      {/* Main table */}
      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลดข้อมูล...</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 155px)' }}>
              <table className="text-xs border-collapse" style={{ tableLayout: 'auto' }}>
                <thead className="sticky top-0 z-20">
                  {/* Group headers */}
                  <tr className="bg-[#7a7568] text-white text-center text-[10px]">
                    <th className="px-3 py-1 border-r border-gray-500 text-left whitespace-nowrap">สาขา / ตัวแทน</th>
                    <th colSpan={4} className="px-3 py-1 border-r border-gray-500 whitespace-nowrap">สลิปจาก LINE</th>
                    <th colSpan={3} className="px-3 py-1 whitespace-nowrap">ยอดใบจอง</th>
                  </tr>
                  <tr className="bg-[#9b9484] text-white text-left">
                    <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">ชื่อสาขา</th>
                    <th className={`${thBase} bg-green-700`}>ยอดตรงใบจอง</th>
                    <th className={`${thBase} bg-amber-700`}>หักค่าของ</th>
                    <th className={`${thBase} bg-blue-700`}>แวต</th>
                    <th className={`${thBase} bg-purple-700 border-r-2 border-white/40`}>Fee</th>
                    <th className={`${thBase}`}>ยอดรวมใบจอง</th>
                    <th className={`${thBase} bg-green-600`}>
                      ชำระแล้ว
                      <div className="text-[8px] font-normal opacity-75 leading-tight">ไม่รวมยอดแวต กับ Fee</div>
                    </th>
                    <th className="px-3 py-2 whitespace-nowrap text-right bg-red-700">ค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(({ color, items }) => {
                    const gPay     = sumEntries(items, 'pay')
                    const gStore   = sumEntries(items, 'store')
                    const gVat     = sumEntries(items, 'vat')
                    const gFee     = sumEntries(items, 'fee')
                    const gTotal   = items.reduce((s, b) => s + b.order_total, 0)
                    const gPaid    = items.reduce((s, b) => s + b.pay.reduce((ss, e) => ss + e.amount, 0) + b.store.reduce((ss, e) => ss + e.amount, 0), 0)
                    const gPending = items.reduce((s, b) => {
                      const slipPaid = b.pay.reduce((ss, e) => ss + e.amount, 0) + b.store.reduce((ss, e) => ss + e.amount, 0)
                      return s + Math.max(0, b.order_total - slipPaid)
                    }, 0)
                    return [
                      <tr key={`g-${color}`} className={GROUP_HEADER_BG[color]}>
                        <td colSpan={8} className="px-3 py-1.5 font-bold text-sm">{GROUP_LABEL[color]}</td>
                      </tr>,

                      ...items.map(b => {
                        const bPaid    = b.pay.reduce((s, e) => s + e.amount, 0) + b.store.reduce((s, e) => s + e.amount, 0)
                        const bPending = Math.max(0, b.order_total - bPaid)
                        return (
                        <tr key={b.id} className={`border-b border-gray-100 hover:brightness-95 transition-all align-top ${ROW_BG[color]}`}>
                          <td className="px-3 py-2 border-r border-gray-200 font-medium whitespace-nowrap">{b.name}</td>
                          <td className="px-3 py-2 border-r border-gray-200 text-right">
                            <GroupedSlipCell entries={b.pay}   amtColor="text-green-700" title={`${b.name} — ยอดตรงใบจอง`}   onDetail={setModal} compact />
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 text-right">
                            <GroupedSlipCell entries={b.store} amtColor="text-amber-700" title={`${b.name} — หักค่าของ`} onDetail={setModal} compact />
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 text-right">
                            <MonthlySlipCell entries={b.vat} amtColor="text-blue-700"   title={`${b.name} — แวต`} onDetail={setModal} />
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 text-right">
                            <MonthlySlipCell entries={b.fee} amtColor="text-purple-700" title={`${b.name} — Fee`}  onDetail={setModal} />
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 text-right">
                            <WeeklyCompactCell entries={b.order_entries} amtColor="text-gray-700" title={`${b.name} — ยอดรวมใบจอง`} onDetail={setModal} />
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 text-right">
                            <WeeklyCompactCell entries={[...b.pay, ...b.store].sort((a, x) => a.date.localeCompare(x.date))} amtColor="text-green-700" title={`${b.name} — ชำระแล้ว`} onDetail={setModal} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <WeeklyPendingCell orderEntries={b.order_entries} paidEntries={[...b.pay, ...b.store]} />
                          </td>
                        </tr>
                        )
                      }),

                      <tr key={`gt-${color}`} className={`border-b-2 border-gray-300 text-[10px] font-semibold ${GROUP_HEADER_BG[color]} opacity-80`}>
                        <td className="px-3 py-1 text-right border-r border-gray-300 whitespace-nowrap">รวมกลุ่ม</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300 whitespace-nowrap">{fmtTotal(gPay)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300 whitespace-nowrap">{fmtTotal(gStore)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300 whitespace-nowrap">{fmtTotal(gVat)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300 whitespace-nowrap">{fmtTotal(gFee)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300 whitespace-nowrap">{fmtTotal(gTotal)}</td>
                        <td className="px-3 py-1 text-right font-mono border-r border-gray-300 whitespace-nowrap">{fmtTotal(gPaid)}</td>
                        <td className="px-3 py-1 text-right font-mono whitespace-nowrap">{fmtTotal(gPending)}</td>
                      </tr>,
                    ]
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#9b9484] text-white font-bold text-xs">
                    <td className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">รวมทั้งหมด ({periodLabel[period]})</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono whitespace-nowrap">{fmtTotal(grand.pay(data))}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono whitespace-nowrap">{fmtTotal(grand.store(data))}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono whitespace-nowrap">{fmtTotal(grand.vat(data))}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono whitespace-nowrap">{fmtTotal(grand.fee(data))}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono whitespace-nowrap">{fmtTotal(grand.total(data))}</td>
                    <td className="px-3 py-2 border-r border-gray-500 text-right font-mono whitespace-nowrap">{fmtTotal(grand.paid(data))}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{fmtTotal(grand.pending(data))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Detail modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200">
              <span className="font-bold text-sm text-gray-800 leading-tight">{modal.title}</span>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-2">
              {modal.entries.map((e, i) => (
                <div key={i} className="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-xs text-gray-500">{fmtDateShort(e.date)}</span>
                  <span className="text-xs font-mono font-semibold text-gray-800">{fmtAmt(e.amount)}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 flex justify-between items-center bg-gray-50 rounded-b-xl">
              <span className="text-xs text-gray-500">{modal.entries.length} รายการ</span>
              <span className="text-sm font-bold font-mono text-gray-800">
                {fmtAmt(modal.entries.reduce((s, e) => s + e.amount, 0))}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
