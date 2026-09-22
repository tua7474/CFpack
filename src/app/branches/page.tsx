'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Page access config — เพิ่มหน้าใหม่ที่นี่เพื่อให้ขึ้น UI อัตโนมัติ ────────

export const PAGE_LIST = [
  { key: 'booking2',    label: 'ใบจองสินค้า' },
  { key: 'stock',       label: 'สต็อคสินค้า' },
  { key: 'stock-paper', label: 'สต็อคกระดาษฝอย' },
] as const

export type PageKey = typeof PAGE_LIST[number]['key']

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchPhone { id: number; phone: string; is_admin: boolean; is_manager: boolean; allowed_pages: string[]; line_user_id: string | null }
interface Branch { id: number; name: string; color_group: string | null; phones: BranchPhone[]; pending_count: number }

// ── Color groups ──────────────────────────────────────────────────────────────

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

const ROW_BG: Record<ColorGroup, string> = {
  black:  'bg-gray-900   hover:bg-gray-800',
  editor: 'bg-green-50   hover:bg-green-100/70',
  green:  'bg-green-50   hover:bg-green-100/70',
  yellow: 'bg-yellow-50  hover:bg-yellow-100/70',
  red:    'bg-red-50     hover:bg-red-100/70',
  orange: 'bg-orange-50  hover:bg-orange-100/70',
}
const GROUP_HEADER_BG: Record<ColorGroup, string> = {
  black:  'bg-black      text-white',
  editor: 'bg-green-600  text-white',
  green:  'bg-green-200  text-green-400',
  yellow: 'bg-yellow-200 text-yellow-900',
  red:    'bg-red-200    text-red-900',
  orange: 'bg-orange-200 text-orange-900',
}
const GROUP_LABEL: Record<ColorGroup, string> = {
  black:  'ทีมงาน',
  editor: 'กลุ่ม Editor',
  green:  'โกดังCF',
  yellow: 'กลุ่มสีเหลือง',
  red:    'กลุ่มสีแดง',
  orange: 'กลุ่มสีส้ม',
}

function sortAndGroup(branches: Branch[]): { color: ColorGroup; items: Branch[] }[] {
  const grouped: Record<ColorGroup, Branch[]> = { black: [], editor: [], green: [], yellow: [], red: [], orange: [] }
  for (const b of branches) {
    grouped[getBranchColor(b.name, b.color_group)].push(b)
  }
  // Sort within each group by pending_count desc
  for (const g of GROUP_ORDER) {
    grouped[g].sort((a, b) => b.pending_count - a.pending_count)
  }
  return GROUP_ORDER
    .filter(g => grouped[g].length > 0)
    .map(g => ({ color: g, items: grouped[g] }))
}
interface BranchOrder {
  id: number; order_no: string; total_amount: string
  nv_total: string | null; v_total: string | null
  status: string; payment_status: string; created_at: string; updated_at: string
}

// ── Slip types ────────────────────────────────────────────────────────────────

interface Slip {
  id: number; branch_id: number | null; category: string; amount: number
  account_name: string | null; slip_date: string; status: string
  line_image_id: string | null; created_at: string
}

const SLIP_CATS = [
  { key: 'วรวุฒิ', label: 'สลิปวรวุฒิ' },
  { key: 'print',  label: 'สลิปPRINT'  },
  { key: 'pack',   label: 'สลิปPACK'   },
  { key: 'bb',     label: 'สลิปBB'     },
  { key: 'กล่อง', label: 'สลิปกล่อง' },
] as const

interface WithdrawalType { id: number; name: string }
interface UnpaidOrder { id: number; order_no: string; total_amount: string; nv_total: string | null; v_total: string | null }

interface BranchSession {
  branch_id: number; branch_name: string; phone: string
  is_admin: boolean; is_manager: boolean; allowed_pages: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: string | number | null) {
  if (n === null || n === undefined) return '0'
  const v = parseFloat(String(n))
  return isNaN(v) ? '0' : v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  })
}
function fmtDateShort(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Bangkok',
  })
}

const MONTH_NAMES = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function computeWeekBounds(weeksAgo: number) {
  const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const day = bkk.getDay()
  const mon = new Date(bkk)
  mon.setDate(bkk.getDate() - (day === 0 ? 6 : day - 1) - weeksAgo * 7)
  mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const yr = mon.getFullYear()
  const jan1 = new Date(yr, 0, 1)
  const jan1Day = jan1.getDay()
  const jan1Mon = new Date(jan1)
  jan1Mon.setDate(jan1.getDate() - (jan1Day === 0 ? 6 : jan1Day - 1))
  const weekNum = Math.floor((mon.getTime() - jan1Mon.getTime()) / (7 * 864e5)) + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso   = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const short = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`
  return { start: iso(mon), end: iso(sun), weekNum, year: yr, dateRange: `${short(mon)}–${short(sun)}` }
}

function getMonthOptions() {
  const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const options: { value: string; label: string }[] = []
  for (let i = 0; i < 13; i++) {
    const d = new Date(bkk.getFullYear(), bkk.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    options.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_NAMES[m - 1]} ${y + 543}` })
  }
  return options
}

// ── Slip Confirm Modal ────────────────────────────────────────────────────────

function SlipConfirmModal({ slip, onClose, onSaved }: {
  slip: Slip; onClose: () => void; onSaved: () => void
}) {
  const [slipDate,     setSlipDate]     = useState(slip.slip_date)
  const [accountName,  setAccountName]  = useState(slip.account_name ?? '')
  const [category,     setCategory]     = useState(slip.category)
  const [saving,       setSaving]       = useState(false)
  const [confirmDel,   setConfirmDel]   = useState(false)

  const handleConfirm = async () => {
    setSaving(true)
    await fetch('/api/slips', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: slip.id, slip_date: slipDate, account_name: accountName, category, status: 'confirmed' }),
    })
    setSaving(false)
    onSaved()
  }

  const handleDelete = async () => {
    await fetch('/api/slips', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: slip.id }),
    })
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm">
        <h3 className="text-base font-bold text-green-400 mb-4">ยืนยันสลิปโอนเงิน</h3>

        {/* Amount — read only */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">ยอดเงิน</div>
          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-lg font-bold text-green-500">
            ฿{slip.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* วันที่ — editable */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">วันที่</div>
          <input type="date" value={slipDate} onChange={e => setSlipDate(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400" />
        </div>

        {/* บัญชีที่โอนเข้า — editable */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">บัญชีที่โอนเข้า</div>
          <input value={accountName} onChange={e => setAccountName(e.target.value)}
            placeholder="ชื่อบัญชีผู้รับ"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400" />
        </div>

        {/* หมวดสลิป — editable */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1">หมวดสลิป</div>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white">
            {SLIP_CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            <option value="other">อื่นๆ</option>
          </select>
        </div>

        <button onClick={handleConfirm} disabled={saving}
          className="w-full py-2 text-sm rounded bg-[#9b9484] text-white font-semibold disabled:opacity-50 mb-2">
          {saving ? 'กำลังบันทึก...' : '✅ ยืนยันข้อมูล'}
        </button>
        <button onClick={onClose}
          className="w-full py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-500 mb-3">
          ปิด
        </button>

        {/* Delete */}
        <div className="pt-3 border-t border-gray-200">
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)}
              className="w-full py-1.5 text-sm rounded border border-red-300 text-red-500 hover:bg-red-50">
              🗑 ลบสลิปนี้
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-600 text-center">ยืนยันลบสลิปนี้?</p>
              <div className="flex gap-2">
                <button onClick={handleDelete}
                  className="flex-1 py-1.5 text-sm rounded bg-red-600 text-white">ยืนยันลบ</button>
                <button onClick={() => setConfirmDel(false)}
                  className="flex-1 py-1.5 text-sm rounded bg-gray-100 text-gray-500">ยกเลิก</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Branch Row Component ──────────────────────────────────────────────────────

type SlipTotals = Record<string, { month: number; week: number; applied_month: number; applied_week: number }>

type SlipPeriods = Record<string, 'month' | 'week'>

type VatItem = { amount: number; slip_date: string }

function BranchRow({
  branch, session, onManage, colorGroup, slipTotals, slipPeriods,
  withdrawalTypes, unpaidOrders, vatItems, activePeriod, periodOrders,
}: {
  branch: Branch
  session: BranchSession | null
  onManage: (b: Branch) => void
  colorGroup: ColorGroup
  slipTotals: SlipTotals
  slipPeriods: SlipPeriods
  withdrawalTypes: WithdrawalType[]
  unpaidOrders: Record<number, UnpaidOrder[]>
  vatItems: VatItem[]
  activePeriod: { start: string; end: string; label: string } | null
  periodOrders: BranchOrder[]
}) {
  const [weekOrders,     setWeekOrders]     = useState<BranchOrder[]>([])
  const [selectedWeek,   setSelectedWeek]   = useState<number | null>(null)
  const [weeklySummary,  setWeeklySummary]  = useState<Record<number, { pending: number; paid: number }>>({})

  const thisMonth = new Date().getMonth() + 1
  const thisYear  = new Date().getFullYear()

  const loadOrders = useCallback(async () => {
    // ดึงออเดอร์ 3 สัปดาห์ย้อนหลัง
    const oldest = computeWeekBounds(2)
    const r = await fetch(`/api/branches/orders?branch_id=${branch.id}&date_from=${oldest.start}&date_to=2099-12-31`)
    const all: BranchOrder[] = await r.json()

    // จัดกลุ่มตามสัปดาห์ (offset 0–2)
    const summary: Record<number, { pending: number; paid: number }> = {}
    for (const o of all) {
      const orderDate = new Date(o.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
      for (let w = 0; w < 3; w++) {
        const { start, end } = computeWeekBounds(w)
        if (orderDate >= start && orderDate <= end) {
          if (!summary[w]) summary[w] = { pending: 0, paid: 0 }
          if (o.payment_status === 'paid') summary[w].paid++
          else summary[w].pending++
          break
        }
      }
    }
    setWeeklySummary(summary)
  }, [branch.id])

  useEffect(() => { loadOrders() }, [loadOrders])

  const thisWeekData = weeklySummary[0] ?? { pending: 0, paid: 0 }
  const thisMonthPaid    = thisWeekData.paid
  const thisMonthPending = thisWeekData.pending

  const handleWeekClick = async (w: number) => {
    if (selectedWeek === w) { setSelectedWeek(null); return }
    setSelectedWeek(w)
    const { start, end } = computeWeekBounds(w)
    const r = await fetch(`/api/branches/orders?branch_id=${branch.id}&date_from=${start}&date_to=${end}`)
    setWeekOrders(await r.json())
  }

  const handleMarkPaid = async (orderId: number) => {
    await fetch('/api/branches/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branch.id, order_ids: [orderId], action: 'pay' }),
    })
    setWeekOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, payment_status: 'paid', updated_at: new Date().toISOString() } : o
    ))
    loadOrders()
  }

  const handleResetPaid = async (orderId: number) => {
    await fetch('/api/branches/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branch.id, order_ids: [orderId], action: 'reset' }),
    })
    setWeekOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, payment_status: 'pending', updated_at: new Date().toISOString() } : o
    ))
    loadOrders()
  }

  return (
    <tr className={`${ROW_BG[colorGroup]} align-top border-b border-gray-200 transition-colors`}>

      {/* 1. ชื่อสาขา */}
      <td className={`px-3 py-2 border-r border-gray-600 font-semibold whitespace-nowrap ${colorGroup === 'black' ? 'text-white border-gray-600' : 'text-green-400 border-gray-200'}`}>
        <div>{branch.name}</div>
        {branch.phones.length > 0 && (
          <div className="mt-0.5">
            {branch.phones.map(p => (
              <div key={p.id}
                className={`text-[10px] ${colorGroup === 'black' ? 'text-gray-400' : 'text-gray-400'}`}>
                {p.phone}
              </div>
            ))}
          </div>
        )}
        {session?.is_admin && (
          <button onClick={() => onManage(branch)}
            className={`mt-1 text-[10px] underline cursor-pointer ${colorGroup === 'black' ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-green-400'}`}>
            จัดการ
          </button>
        )}
      </td>

      {/* 2. สรุปสัปดาห์นี้ */}
      <td className="px-3 py-2 border-r border-gray-200 text-center">
        <div className="text-[10px] text-gray-400 mb-0.5">สัปดาห์ที่ {computeWeekBounds(0).weekNum}</div>
        <div className="text-sm font-bold text-green-400">{thisMonthPending}</div>
        <div className="text-xs text-gray-400">/ {thisMonthPaid} ชำระแล้ว</div>
      </td>

      {/* 4. ปุ่ม 36 สัปดาห์ */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1 max-w-[420px]">
          {Array.from({ length: 3 }, (_, w) => w).map(w => {
            const s = weeklySummary[w] ?? { pending: 0, paid: 0 }
            const { weekNum, year } = computeWeekBounds(w)
            const currentYear = new Date().getFullYear()
            const isSelected = selectedWeek === w
            const hasData = s.pending > 0 || s.paid > 0
            const btnLabel = year < currentYear ? `${weekNum}(${year})` : `${weekNum}`
            return (
              <button key={w} onClick={() => handleWeekClick(w)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#9b9484] text-white border-gray-500'
                    : s.pending > 0
                    ? 'bg-orange-50 text-green-500 border-orange-300 hover:bg-orange-100'
                    : hasData
                    ? 'bg-green-50 text-green-400 border-green-200 hover:bg-green-100'
                    : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                }`}>
                {btnLabel}
                {hasData && <span className="ml-0.5 font-semibold">{s.pending > 0 ? ` ${s.pending}รอ` : ` ${s.paid}✓`}</span>}
              </button>
            )
          })}
        </div>

        {/* Global period orders */}
        {activePeriod && (
          <div className="mt-2 border border-indigo-200 rounded p-2 bg-indigo-50/30 text-xs max-w-[420px]">
            <div className="font-semibold text-indigo-600 mb-1 text-[10px]">{activePeriod.label}</div>
            {periodOrders.length === 0 ? (
              <div className="text-gray-400">ไม่มีรายการ</div>
            ) : periodOrders.flatMap(o => {
              const nvT = parseFloat(o.nv_total ?? '0') || 0
              const vT  = parseFloat(o.v_total  ?? '0') || 0
              const rows: { key: string; prefix: string; tag: 'NV'|'V'|null; amount: number }[] =
                nvT > 0 && vT > 0
                  ? [{ key: `p${o.id}-NV`, prefix: 'NV', tag: 'NV', amount: nvT },
                     { key: `p${o.id}-V`,  prefix: 'V',  tag: 'V',  amount: vT  }]
                  : nvT > 0 ? [{ key: `p${o.id}-NV`, prefix: 'NV', tag: 'NV', amount: nvT }]
                  : vT > 0  ? [{ key: `p${o.id}-V`,  prefix: 'V',  tag: 'V',  amount: vT  }]
                  : [{ key: `p${o.id}-x`, prefix: '', tag: null, amount: parseFloat(o.total_amount) }]
              return rows.map(row => (
                <div key={row.key} className={`flex items-start gap-1.5 py-1 border-b border-indigo-100 last:border-0 ${o.payment_status === 'paid' ? 'text-green-400' : 'text-gray-500'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      <span className={row.tag === 'NV' ? 'text-orange-500' : row.tag === 'V' ? 'text-green-500' : ''}>
                        #{row.prefix}{o.order_no}
                      </span>
                    </div>
                    <div className="text-[9px] text-gray-400">จอง {fmtDateShort(o.created_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-gray-500">฿{fmtMoney(row.amount)}</div>
                    {row.tag && <div className={`text-[9px] ${row.tag === 'NV' ? 'text-orange-400' : 'text-green-400'}`}>{row.tag === 'NV' ? 'ไม่รวมแวต' : 'รวมแวต'}</div>}
                    {o.payment_status === 'paid'
                      ? <div className="text-[10px] text-green-500 font-medium">ชำระแล้ว</div>
                      : <div className="text-[10px] text-red-500 font-medium">รอชำระ</div>}
                  </div>
                </div>
              ))
            })}
          </div>
        )}

        {/* Week detail */}
        {selectedWeek !== null && (
          <div className="mt-2 border border-gray-200 rounded p-2 bg-white text-xs max-w-[420px]">
            <div className="font-semibold text-gray-500 mb-1">
              สัปดาห์ที่ {computeWeekBounds(selectedWeek).weekNum} · {computeWeekBounds(selectedWeek).dateRange}
            </div>
            {weekOrders.length === 0 ? (
              <div className="text-gray-400">ไม่มีรายการ</div>
            ) : weekOrders.flatMap(o => {
                const nvT = parseFloat(o.nv_total ?? '0') || 0
                const vT  = parseFloat(o.v_total  ?? '0') || 0
                const rows: { key: string; prefix: string; tag: 'NV'|'V'|null; amount: number }[] =
                  nvT > 0 && vT > 0
                    ? [{ key: `${o.id}-NV`, prefix: 'NV', tag: 'NV', amount: nvT },
                       { key: `${o.id}-V`,  prefix: 'V',  tag: 'V',  amount: vT  }]
                    : nvT > 0
                    ? [{ key: `${o.id}-NV`, prefix: 'NV', tag: 'NV', amount: nvT }]
                    : vT > 0
                    ? [{ key: `${o.id}-V`,  prefix: 'V',  tag: 'V',  amount: vT  }]
                    : [{ key: `${o.id}-x`,  prefix: '',   tag: null,  amount: parseFloat(o.total_amount) }]
                return rows.map(row => (
                <div key={row.key} className={`flex items-start gap-1.5 py-1 border-b border-gray-100 last:border-0 ${o.payment_status === 'paid' ? 'text-green-400' : 'text-gray-500'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      <span className={row.tag === 'NV' ? 'text-orange-500' : row.tag === 'V' ? 'text-green-500' : ''}>
                        #{row.prefix}{o.order_no}
                      </span>
                    </div>
                    <div className="text-[9px] text-gray-400">จอง {fmtDateShort(o.created_at)}</div>
                    {session?.is_admin && o.payment_status === 'paid' && row.tag !== 'V' && (
                      <button onClick={() => handleResetPaid(o.id)}
                        className="text-[9px] text-gray-400 hover:text-red-500 hover:underline">
                        รีเซ็ต
                      </button>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-gray-500">฿{fmtMoney(row.amount)}</div>
                    {row.tag && <div className={`text-[9px] ${row.tag === 'NV' ? 'text-orange-400' : 'text-green-400'}`}>{row.tag === 'NV' ? 'ไม่รวมแวต' : 'รวมแวต'}</div>}
                    {o.payment_status === 'paid' ? (
                      <div>
                        <div className="text-[10px] text-green-500 font-medium">ชำระแล้ว</div>
                        <div className="text-[9px] text-green-400">{fmtDateShort(o.updated_at)}</div>
                      </div>
                    ) : session?.is_admin ? (
                      <button onClick={() => handleMarkPaid(o.id)}
                        className="text-[10px] text-red-500 font-medium hover:text-red-700 hover:underline">
                        รอชำระ
                      </button>
                    ) : (
                      <div className="text-[10px] text-red-500 font-medium">รอชำระ</div>
                    )}
                  </div>
                </div>
                ))
              })}
            </div>
          )}
        </td>

      {/* ค่าแวต */}
      <td className="px-3 py-2 border-r border-gray-200 align-top min-w-[110px]">
        {vatItems.length === 0 ? (
          <span className="text-xs text-gray-300">-</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            {vatItems.map((v, i) => (
              <div key={i} className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {new Date(v.slip_date + 'T12:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-xs font-medium text-[#7c3aed] whitespace-nowrap">
                  ฿{Math.round(v.amount).toLocaleString('th-TH')}
                </span>
              </div>
            ))}
            {vatItems.length > 1 && (
              <div className="flex items-center justify-between gap-1 border-t border-gray-200 pt-0.5 mt-0.5">
                <span className="text-[10px] text-gray-500 font-semibold">รวม</span>
                <span className="text-xs font-bold text-[#7c3aed] whitespace-nowrap">
                  ฿{Math.round(vatItems.reduce((s, v) => s + v.amount, 0)).toLocaleString('th-TH')}
                </span>
              </div>
            )}
          </div>
        )}
      </td>

      {/* ใบจองค้างชำระ — 1 คอลัมน์ต่อ 1 ประเภทเบิกของ */}
      {withdrawalTypes.map(wt => {
        const orders = unpaidOrders[wt.id] ?? []
        return (
          <td key={wt.id} className="px-2 py-1.5 border-r border-gray-200 align-top">
            {orders.length === 0 ? (
              <span className="text-[10px] text-gray-300">-</span>
            ) : (
              <div className="flex flex-col gap-0.5">
                {orders.flatMap(o => {
                  const nvT = parseFloat(o.nv_total ?? '0') || 0
                  const vT  = parseFloat(o.v_total  ?? '0') || 0
                  const rows: { key: string; prefix: string; tag: 'NV'|'V'|null; amount: number }[] =
                    nvT > 0 && vT > 0
                      ? [{ key: `${o.id}-NV`, prefix: 'NV', tag: 'NV', amount: nvT },
                         { key: `${o.id}-V`,  prefix: 'V',  tag: 'V',  amount: vT  }]
                      : nvT > 0 ? [{ key: `${o.id}-NV`, prefix: 'NV', tag: 'NV', amount: nvT }]
                      : vT > 0  ? [{ key: `${o.id}-V`,  prefix: 'V',  tag: 'V',  amount: vT  }]
                      : [{ key: `${o.id}-x`, prefix: '', tag: null, amount: parseFloat(o.total_amount) }]
                  return rows.map(row => (
                    <div key={row.key} className="text-[10px] whitespace-nowrap">
                      <span className={row.tag === 'NV' ? 'text-orange-500' : row.tag === 'V' ? 'text-green-500' : 'text-gray-500'}>
                        #{row.prefix}{o.order_no}
                      </span>
                      <span className="text-gray-500 ml-1">฿{fmtMoney(row.amount)}</span>
                    </div>
                  ))
                })}
              </div>
            )}
          </td>
        )
      })}

      {/* 7–11. Slip totals per category */}
      {SLIP_CATS.map((cat, i) => {
        const t           = slipTotals[cat.key]
        const period      = slipPeriods[cat.key] ?? 'month'
        const total       = period === 'month' ? (t?.month ?? 0) : (t?.week ?? 0)
        const appliedAmt  = period === 'month' ? (t?.applied_month ?? 0) : (t?.applied_week ?? 0)
        const fullyUsed   = total > 0 && appliedAmt >= total
        return (
          <td key={cat.key}
            className={`px-3 py-2 text-center whitespace-nowrap ${i < SLIP_CATS.length - 1 ? 'border-r border-gray-200' : ''}`}>
            {total > 0 ? (
              <span className={`text-xs font-semibold ${fullyUsed ? 'text-gray-400 line-through' : 'text-green-500'}`}
                title={fullyUsed ? 'ใช้หักยอดแล้ว' : undefined}>
                ฿{Math.round(total).toLocaleString('th-TH')}
              </span>
            ) : (
              <span className="text-xs text-gray-300">-</span>
            )}
          </td>
        )
      })}

    </tr>
  )
}

// ── Manage Branch Modal ───────────────────────────────────────────────────────

// สถานะ → is_admin, is_manager, allowed_pages
const ROLE_CONFIG = {
  admin:   { is_admin: true,  is_manager: false, allowed_pages: [] as string[] },
  manager: { is_admin: false, is_manager: true,  allowed_pages: ['booking2', 'stock', 'stock-paper', 'orders'] },
  branch:  { is_admin: false, is_manager: false, allowed_pages: ['booking2'] },
} as const

type Role = keyof typeof ROLE_CONFIG

const ROLE_LABEL: Record<Role, string> = {
  admin:   'แอดมิน',
  manager: 'ผู้จัดการ',
  branch:  'สาขา',
}

const ROLE_DESC: Record<Role, string> = {
  admin:   'เข้าได้ทุกหน้า แก้ไขได้ทุกจุด',
  manager: 'เข้าได้ทุกหน้า ยกเว้นจัดส่ง เบิกของ สาขาและตัวแทน',
  branch:  'เข้าได้เฉพาะหน้าใบจองสินค้า',
}

function roleFromFlags(is_admin: boolean, is_manager: boolean): Role {
  if (is_admin)   return 'admin'
  if (is_manager) return 'manager'
  return 'branch'
}

function ManageModal({ branch: branchProp, onClose, onSaved, onLineIdSaved, onDeleted }: {
  branch: Branch; onClose: () => void; onSaved: () => void
  onLineIdSaved: (phoneId: number, lineId: string | null) => void
  onDeleted: (id: number) => void
}) {
  const [branch, setBranch]   = useState<Branch>(branchProp)
  const [newCode, setNewCode] = useState('')
  const [role, setRole]       = useState<Role>('branch')
  const [saving, setSaving]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editLineId, setEditLineId] = useState<{ phoneId: number; value: string } | null>(null)

  const deleteBranch = async () => {
    await fetch('/api/branches', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: branch.id }),
    })
    onDeleted(branch.id)
  }

  const addCode = async () => {
    const c = newCode.trim()
    if (!c) return
    setSaving(true)
    const { is_admin, is_manager, allowed_pages } = ROLE_CONFIG[role]
    await fetch('/api/branches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_phone', branch_id: branch.id, code: c, is_admin, is_manager, allowed_pages }),
    })
    setNewCode(''); setRole('branch'); setSaving(false)
    onSaved()
  }

  const removePhone = async (phone_id: number) => {
    await fetch('/api/branches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_phone', phone_id }),
    })
    onSaved()
  }

  const saveLineId = async () => {
    if (!editLineId) return
    const lineId = editLineId.value.trim() || null
    await fetch('/api/branches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_line_id', phone_id: editLineId.phoneId, line_user_id: lineId }),
    })
    // Update local branch state so the modal shows the new value immediately
    setBranch(prev => ({
      ...prev,
      phones: prev.phones.map(p => p.id === editLineId.phoneId ? { ...p, line_user_id: lineId } : p),
    }))
    setEditLineId(null)
    onLineIdSaved(editLineId.phoneId, lineId)  // refresh parent list in background (no modal close)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm">
        <h3 className="text-base font-bold text-green-400 mb-3">จัดการสาขา: {branch.name}</h3>

        {/* Code list */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">รหัสที่ลงทะเบียน</div>
          {branch.phones.length === 0 && <div className="text-xs text-gray-400">ยังไม่มีรหัส</div>}
          {branch.phones.map(p => (
            <div key={p.id} className="py-1.5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="text-sm font-mono">
                  {p.phone}
                  <span className={`ml-1.5 text-[10px] font-medium font-sans ${p.is_admin ? 'text-green-500' : p.is_manager ? 'text-blue-500' : 'text-gray-400'}`}>
                    ({ROLE_LABEL[roleFromFlags(p.is_admin, p.is_manager)]})
                  </span>
                </div>
                <button onClick={() => removePhone(p.id)}
                  className="text-xs text-red-400 hover:text-red-600">ลบ</button>
              </div>
              {/* LINE ID row */}
              {editLineId?.phoneId === p.id ? (
                <div className="flex gap-1.5 mt-1">
                  <input
                    autoFocus
                    value={editLineId.value}
                    onChange={e => setEditLineId({ phoneId: p.id, value: e.target.value })}
                    placeholder="Uxxxxxxxxxxxxxxxx"
                    className="flex-1 px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                  />
                  <button onClick={saveLineId} className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">บันทึก</button>
                  <button onClick={() => setEditLineId(null)} className="px-2 py-1 text-xs bg-gray-100 text-gray-500 rounded hover:bg-gray-200">ยกเลิก</button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {p.line_user_id ? (
                    <span className="text-[10px] text-green-600 font-mono bg-green-50 px-1.5 py-0.5 rounded">✓ {p.line_user_id}</span>
                  ) : (
                    <span className="text-[10px] text-gray-400">ยังไม่มี LINE ID</span>
                  )}
                  <button
                    onClick={() => setEditLineId({ phoneId: p.id, value: p.line_user_id ?? '' })}
                    className="text-[10px] text-blue-400 hover:text-blue-600 underline"
                  >
                    {p.line_user_id ? 'แก้ไข LINE ID' : '+ ตั้ง LINE ID'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add code */}
        <div className="space-y-2">
          <div className="text-xs text-gray-500">เพิ่มรหัส</div>
          <input value={newCode} onChange={e => setNewCode(e.target.value)}
            placeholder="ตัวอักษร/ตัวเลขผสมกันได้" type="text" autoComplete="off"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400" />

          {/* Role selector */}
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {(Object.keys(ROLE_CONFIG) as Role[]).map(r => (
              <button key={r} type="button" onClick={() => setRole(r)}
                className={`py-1.5 text-xs rounded border-2 font-semibold transition-colors ${
                  role === r
                    ? r === 'admin'   ? 'bg-black text-white border-black'
                    : r === 'manager' ? 'bg-blue-500 text-white border-blue-500'
                    :                   'bg-[#9b9484] text-white border-[#9b9484]'
                    : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'
                }`}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 leading-snug">{ROLE_DESC[role]}</p>

          <button onClick={addCode} disabled={saving}
            className="w-full py-1.5 text-sm rounded bg-[#9b9484] hover:bg-[#9b9484] text-white font-medium disabled:opacity-50">
            + เพิ่มรหัส
          </button>
        </div>

        <button onClick={onClose}
          className="mt-3 w-full py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-500">
          ปิด
        </button>

        {/* Delete branch */}
        <div className="mt-4 pt-3 border-t border-gray-200">
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              className="w-full py-1.5 text-sm rounded border border-red-300 text-red-500 hover:bg-red-50 transition-colors">
              🗑 ลบสาขา
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-600 text-center font-medium">
                ยืนยันลบสาขา "{branch.name}" ?<br/>
                <span className="font-normal text-gray-500">ข้อมูลจะถูกลบออกถาวร ไม่สามารถกู้คืนได้</span>
              </p>
              <div className="flex gap-2">
                <button onClick={deleteBranch}
                  className="flex-1 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white font-medium">
                  ยืนยันลบ
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-500">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BranchesPage() {
  const router = useRouter()
  const [session, setSession]         = useState<BranchSession | null>(null)
  const [loginCode, setLoginCode]     = useState('')
  const [loginError, setLoginError]   = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [branches, setBranches]       = useState<Branch[]>([])
  const [loading, setLoading]         = useState(true)
  const [manageBranch, setManageBranch] = useState<Branch | null>(null)
  const [showAddBranch, setShowAddBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchColor, setNewBranchColor] = useState<'black' | 'yellow' | 'red' | 'orange'>('orange')

  // Slip state
  const [slipPeriods,  setSlipPeriods]  = useState<SlipPeriods>({ วรวุฒิ: 'month', print: 'month', pack: 'month', bb: 'month', กล่อง: 'month' })
  const [slipData,     setSlipData]     = useState<Record<number, SlipTotals>>({})
  const [vatItemsMap,  setVatItemsMap]  = useState<Record<number, VatItem[]>>({})
  const [pendingSlips, setPendingSlips] = useState<Slip[]>([])
  const [confirmSlip,  setConfirmSlip]  = useState<Slip | null>(null)

  // Global period selection for ประวัติใบจอง
  const [activePeriod,         setActivePeriod]         = useState<{ start: string; end: string; label: string } | null>(null)
  const [selectedMonth,        setSelectedMonth]        = useState('')
  const [periodOrdersByBranch, setPeriodOrdersByBranch] = useState<Record<number, BranchOrder[]>>({})

  // Unpaid orders by withdrawal type
  const [withdrawalTypes,  setWithdrawalTypes]  = useState<WithdrawalType[]>([])
  const [unpaidByBranch,   setUnpaidByBranch]   = useState<Record<number, Record<number, UnpaidOrder[]>>>({})

  // Load session from localStorage
  // แอดมิน → โหลด session ปกติ
  // non-admin → clear session แสดง login modal (ให้ login ใหม่เป็นแอดมินได้)
  useEffect(() => {
    try {
      const s = localStorage.getItem('branch_session')
      if (s) {
        const parsed: BranchSession = JSON.parse(s)
        if (parsed.is_admin) {
          setSession(parsed)
        } else {
          localStorage.removeItem('branch_session')
        }
      }
    } catch { /* ignore */ }
  }, [])

  const loadBranches = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/branches')
    setBranches(await r.json())
    setLoading(false)
  }, [])

  const loadSlipData = useCallback(async () => {
    const [byBranchRes, pendingRes, vatRes] = await Promise.all([
      fetch('/api/slips?by_branch=true'),
      fetch('/api/slips?pending=true'),
      fetch('/api/slips?vat_items=true'),
    ])
    const rows: { branch_id: number; category: string; month_total: number; week_total: number; applied_month_total: number; applied_week_total: number }[] = await byBranchRes.json()
    const pending: Slip[] = await pendingRes.json()
    const vatRows: { branch_id: number; amount: number; slip_date: string }[] = await vatRes.json()
    // Build map: branch_id → category → { month, week, applied_month, applied_week }
    const map: Record<number, SlipTotals> = {}
    for (const r of rows) {
      if (!map[r.branch_id]) map[r.branch_id] = {}
      map[r.branch_id][r.category] = { month: r.month_total, week: r.week_total, applied_month: r.applied_month_total ?? 0, applied_week: r.applied_week_total ?? 0 }
    }
    // Build map: branch_id → VatItem[]
    const vatMap: Record<number, VatItem[]> = {}
    for (const v of vatRows) {
      if (!vatMap[v.branch_id]) vatMap[v.branch_id] = []
      vatMap[v.branch_id].push({ amount: v.amount, slip_date: v.slip_date })
    }
    setSlipData(map)
    setVatItemsMap(vatMap)
    setPendingSlips(pending)
  }, [])

  const loadUnpaidData = useCallback(async () => {
    const r = await fetch('/api/branches/orders/unpaid')
    const data: { types: WithdrawalType[]; byBranch: Record<string, Record<string, UnpaidOrder[]>> } = await r.json()
    setWithdrawalTypes(data.types ?? [])
    const byBranch: Record<number, Record<number, UnpaidOrder[]>> = {}
    for (const [bid, typeMap] of Object.entries(data.byBranch ?? {})) {
      byBranch[Number(bid)] = {}
      for (const [tid, orders] of Object.entries(typeMap)) {
        byBranch[Number(bid)][Number(tid)] = orders
      }
    }
    setUnpaidByBranch(byBranch)
  }, [])

  useEffect(() => { loadBranches() }, [loadBranches])
  useEffect(() => { loadSlipData() }, [loadSlipData])
  useEffect(() => { loadUnpaidData() }, [loadUnpaidData])

  // Fetch all-branch orders when activePeriod changes
  useEffect(() => {
    if (!activePeriod || branches.length === 0) { setPeriodOrdersByBranch({}); return }
    const fetchAll = async () => {
      const entries = await Promise.all(
        branches.map(async b => {
          const r = await fetch(`/api/branches/orders?branch_id=${b.id}&date_from=${activePeriod.start}&date_to=${activePeriod.end}`)
          const orders: BranchOrder[] = await r.json()
          return [b.id, orders] as [number, BranchOrder[]]
        })
      )
      setPeriodOrdersByBranch(Object.fromEntries(entries))
    }
    fetchAll()
  }, [activePeriod, branches])

  const handleSelectGlobalWeek = (weeksAgo: number) => {
    const { start, end, weekNum, dateRange } = computeWeekBounds(weeksAgo)
    if (activePeriod?.start === start) { setActivePeriod(null); setSelectedMonth(''); return }
    setSelectedMonth('')
    setActivePeriod({ start, end, label: `สัปดาห์ที่ ${weekNum} (${dateRange})` })
  }

  const handleSelectGlobalMonth = (value: string) => {
    setSelectedMonth(value)
    if (!value) { setActivePeriod(null); return }
    const [y, m] = value.split('-').map(Number)
    const pad = (n: number) => String(n).padStart(2, '0')
    const start = `${y}-${pad(m)}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const end = `${y}-${pad(m)}-${pad(lastDay)}`
    setActivePeriod({ start, end, label: `${MONTH_NAMES[m - 1]} ${y + 543}` })
  }

  const handleLogin = async () => {
    setLoginError('')
    setLoginLoading(true)
    const code = loginCode.trim()
    const res = await fetch('/api/branches/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    setLoginLoading(false)
    if (!res.ok) { setLoginError('ไม่พบรหัสนี้ในระบบ กรุณาติดต่อผู้ดูแล'); return }
    const data = await res.json()
    const s: BranchSession = { branch_id: data.branch_id, branch_name: data.branch_name, phone: data.phone, is_admin: data.is_admin, is_manager: data.is_manager ?? false, allowed_pages: data.allowed_pages ?? [] }
    localStorage.setItem('branch_session', JSON.stringify(s))
    if (!data.is_admin) { router.replace('/booking2'); return }
    setSession(s)
  }

  const handleLogout = () => {
    localStorage.removeItem('branch_session')
    setSession(null)
    setLoginCode('')
  }

  const handleAddBranch = async () => {
    if (!newBranchName.trim()) return
    await fetch('/api/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBranchName.trim(), color_group: newBranchColor }),
    })
    setNewBranchName(''); setNewBranchColor('orange'); setShowAddBranch(false)
    loadBranches()
  }

  // Filter branches: admin + manager see all; others see only their branch
  const visibleBranches = (session?.is_admin || session?.is_manager)
    ? branches
    : branches.filter(b => b.id === session?.branch_id)

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
          {session && <p className="text-orange-200 text-xs mt-0.5">เข้าสู่ระบบ: {session.branch_name} · {session.phone}</p>}
        </div>
        <div className="flex items-center gap-2">
          {session?.is_admin && (
            <button onClick={() => setShowAddBranch(true)}
              className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white border border-white/30 transition-colors">
              + เพิ่มสาขา
            </button>
          )}
          {session && (
            <Link href="/booking2"
              className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white border border-white/30 transition-colors">
              ใบจองสินค้า
            </Link>
          )}
          {session ? (
            <button onClick={handleLogout}
              className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white border border-white/30 transition-colors">
              ออกจากระบบ
            </button>
          ) : (
            <span className="text-orange-200 text-sm">กรุณาล็อกอิน</span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex">
        <Link href="/"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          📦 สต็อคสินค้า
        </Link>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          🌿 สต็อคกระดาษฝอย
        </Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50">
          🏪 สาขาและตัวแทน
        </span>
        <Link href="/delivery"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          🚚 จัดส่ง
        </Link>
        <Link href="/withdrawal"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          📤 เบิกของ
        </Link>
        <Link href="/restock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          📥 เติมสต็อค
        </Link>
        <Link href="/foy-line"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌀 ไลน์ผลิตกระดาษฝอย
        </Link>
      </div>

      {/* Pending slips notification bar */}
      {session && (session.is_admin || session.is_manager) && pendingSlips.length > 0 && (
        <div className="bg-orange-50 border-b border-orange-200 px-4 py-2 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-semibold text-orange-600 mr-1">สลิปรอยืนยัน {pendingSlips.length} รายการ:</span>
          {pendingSlips.map(s => (
            <button key={s.id} onClick={() => setConfirmSlip(s)}
              className="px-2 py-0.5 rounded bg-orange-100 border border-orange-300 hover:bg-orange-200 transition-colors text-left">
              <span className="text-[11px] font-bold text-orange-700">
                {SLIP_CATS.find(c => c.key === s.category)?.label ?? s.category}
              </span>
              <span className="text-[10px] text-gray-500 ml-1">
                ฿{s.amount.toLocaleString('th-TH', { minimumFractionDigits: 0 })} · {s.slip_date}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Slip confirm modal */}
      {confirmSlip && (
        <SlipConfirmModal
          slip={confirmSlip}
          onClose={() => setConfirmSlip(null)}
          onSaved={() => { setConfirmSlip(null); loadSlipData() }}
        />
      )}

      {/* Login Modal */}
      {!session && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-xs">
            <h2 className="text-lg font-bold text-green-400 mb-1">เข้าสู่ระบบสาขา</h2>
            <p className="text-xs text-gray-500 mb-4">กรอกรหัสที่ได้รับจากผู้ดูแล</p>
            <input value={loginCode} onChange={e => setLoginCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="ใส่รหัส" type="text" autoComplete="off"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 mb-2" />
            {loginError && <p className="text-xs text-red-500 mb-2">{loginError}</p>}
            <button onClick={handleLogin} disabled={loginLoading}
              className="w-full py-2 rounded-lg bg-[#9b9484] hover:bg-[#9b9484] text-white font-semibold disabled:opacity-50">
              {loginLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
          </div>
        </div>
      )}

      {/* Add Branch Modal */}
      {showAddBranch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-xs">
            <h3 className="text-base font-bold text-green-400 mb-3">เพิ่มสาขาใหม่</h3>
            <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
              placeholder="ชื่อสาขา" className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 mb-3" />
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1.5">กลุ่มสี</div>
              <div className="flex gap-2 flex-wrap">
                {([
                  ['black',  'ทีมงาน',   'bg-black text-white'],
                  ['yellow', 'สีเหลือง', 'bg-yellow-200 text-yellow-900'],
                  ['red',    'สีแดง',    'bg-red-200 text-red-900'],
                  ['orange', 'สีส้ม',    'bg-orange-200 text-orange-900'],
                ] as const).map(([val, label, cls]) => (
                  <button key={val} type="button"
                    onClick={() => setNewBranchColor(val)}
                    className={`flex-1 py-1.5 text-xs rounded font-semibold border-2 transition-colors ${newBranchColor === val ? `${cls} border-current` : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddBranch}
                className="flex-1 py-1.5 text-sm rounded bg-[#9b9484] hover:bg-[#9b9484] text-white font-medium">
                เพิ่ม
              </button>
              <button onClick={() => { setShowAddBranch(false); setNewBranchName(''); setNewBranchColor('orange') }}
                className="flex-1 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-500">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Branch Modal */}
      {manageBranch && (
        <ManageModal
          branch={manageBranch}
          onClose={() => setManageBranch(null)}
          onSaved={() => { loadBranches(); setManageBranch(null) }}
          onLineIdSaved={(phoneId, lineId) => {
            // Refresh parent list but keep modal open; update manageBranch too so re-open shows correct data
            loadBranches()
            setManageBranch(prev => prev ? {
              ...prev,
              phones: prev.phones.map(p => p.id === phoneId ? { ...p, line_user_id: lineId } : p),
            } : null)
          }}
          onDeleted={(id) => { setBranches(prev => prev.filter(b => b.id !== id)); setManageBranch(null) }}
        />
      )}

      {/* Main Table */}
      <main className="p-4 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลด...</div>
        ) : !session ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กรุณาล็อกอินก่อนครับ</div>
        ) : visibleBranches.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400">ยังไม่มีสาขา</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-[#9b9484] text-white text-left">
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">ชื่อสาขา</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap text-center">เดือนนี้</th>
                  <th className="px-3 py-2 border-r border-gray-500 min-w-[360px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="whitespace-nowrap font-semibold">ประวัติใบจอง</span>
                      {[0, 1, 2].map(w => {
                        const wb = computeWeekBounds(w)
                        const isActive = activePeriod?.start === wb.start
                        return (
                          <button key={w} onClick={() => handleSelectGlobalWeek(w)}
                            className={`text-[10px] px-2 py-0.5 rounded border whitespace-nowrap transition-colors ${isActive ? 'bg-white text-gray-700 border-white font-semibold' : 'bg-white/15 border-white/40 hover:bg-white/30 text-white'}`}>
                            สัปดาห์ {wb.weekNum}<span className="opacity-70"> ({wb.dateRange})</span>
                          </button>
                        )
                      })}
                      <select value={selectedMonth} onChange={e => handleSelectGlobalMonth(e.target.value)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${selectedMonth ? 'bg-white text-gray-700 border-white' : 'bg-white/15 border-white/40 text-white hover:bg-white/30'}`}>
                        <option value="" className="text-black">รายเดือน ▾</option>
                        {getMonthOptions().map(opt => <option key={opt.value} value={opt.value} className="text-black">{opt.label}</option>)}
                      </select>
                      {activePeriod && (
                        <button onClick={() => { setActivePeriod(null); setSelectedMonth('') }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-white/40 bg-white/10 hover:bg-white/30 text-white">
                          ✕
                        </button>
                      )}
                    </div>
                  </th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap text-center min-w-[100px] bg-purple-700">ค่าแวต</th>
                  {withdrawalTypes.map(wt => (
                    <th key={wt.id} className="px-2 py-2 border-r border-gray-500 whitespace-nowrap text-center min-w-[120px]">
                      <div className="text-[11px] font-semibold">{wt.name}</div>
                    </th>
                  ))}
                  {SLIP_CATS.map((cat, i) => (
                    <th key={cat.key} className={`px-2 py-1.5 whitespace-nowrap text-center ${i < SLIP_CATS.length - 1 ? 'border-r border-gray-500' : ''}`}>
                      <div className="font-semibold text-[11px] mb-1">{cat.label}</div>
                      <button
                        onClick={() => setSlipPeriods(prev => ({ ...prev, [cat.key]: prev[cat.key] === 'month' ? 'week' : 'month' }))}
                        className="px-2 py-0.5 rounded border border-white/40 bg-white/15 hover:bg-white/30 text-white text-[10px] transition-colors whitespace-nowrap">
                        {(slipPeriods[cat.key] ?? 'month') === 'month' ? 'รอบเดือน' : 'รอบสัปดาห์'}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortAndGroup(visibleBranches).map(({ color, items }) => (
                  <>
                    <tr key={`header-${color}`} className={GROUP_HEADER_BG[color]}>
                      <td colSpan={8 + withdrawalTypes.length + SLIP_CATS.length} className="px-3 py-1 text-xs font-bold tracking-wide">
                        {GROUP_LABEL[color]}
                      </td>
                    </tr>
                    {items.map(b => (
                      <BranchRow key={b.id} branch={b} session={session}
                        onManage={setManageBranch} colorGroup={color}
                        slipTotals={slipData[b.id] ?? {}}
                        slipPeriods={slipPeriods}
                        withdrawalTypes={withdrawalTypes}
                        unpaidOrders={unpaidByBranch[b.id] ?? {}}
                        vatItems={vatItemsMap[b.id] ?? []}
                        activePeriod={activePeriod}
                        periodOrders={periodOrdersByBranch[b.id] ?? []} />
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 border-t-2 border-gray-400 text-xs font-semibold">
                  <td colSpan={2} className="px-3 py-2 border-r border-gray-300 text-right text-gray-500 text-[11px]">รวม</td>
                  {/* ประวัติใบจอง total */}
                  <td className="px-3 py-2 border-r border-gray-300">
                    {activePeriod ? (() => {
                      const allOrders = Object.values(periodOrdersByBranch).flat()
                      if (allOrders.length === 0) return <span className="text-gray-400 font-normal">ไม่มีรายการ</span>
                      const total = allOrders.reduce((s, o) => s + parseFloat(o.total_amount), 0)
                      const paid  = allOrders.reduce((s, o) => s + (o.payment_status === 'paid' ? parseFloat(o.total_amount) : 0), 0)
                      return (
                        <div>
                          <div className="text-green-600">฿{fmtMoney(total)}</div>
                          {paid > 0 && <div className="text-[10px] text-green-400 font-normal">ชำระแล้ว ฿{fmtMoney(paid)}</div>}
                        </div>
                      )
                    })() : <span className="text-gray-300 font-normal text-[10px]">เลือกช่วงเวลาเพื่อดูยอดรวม</span>}
                  </td>
                  {/* ค่าแวต total */}
                  <td className="px-3 py-2 border-r border-gray-300 text-center">
                    {(() => {
                      const total = Object.values(vatItemsMap).flat().reduce((s, v) => s + v.amount, 0)
                      return total > 0
                        ? <span className="text-[#7c3aed]">฿{Math.round(total).toLocaleString('th-TH')}</span>
                        : <span className="text-gray-300 font-normal">-</span>
                    })()}
                  </td>
                  {/* Withdrawal type totals */}
                  {withdrawalTypes.map(wt => {
                    const total = Object.values(unpaidByBranch).reduce((s, byType) => {
                      return s + (byType[wt.id] ?? []).reduce((ss, o) => ss + parseFloat(o.total_amount), 0)
                    }, 0)
                    return (
                      <td key={wt.id} className="px-2 py-2 border-r border-gray-300 text-center">
                        {total > 0
                          ? <span className="text-gray-600">฿{fmtMoney(total)}</span>
                          : <span className="text-gray-300 font-normal">-</span>}
                      </td>
                    )
                  })}
                  {/* Slip category totals */}
                  {SLIP_CATS.map((cat, i) => {
                    const total = Object.values(slipData).reduce((s, catMap) => {
                      const t = catMap[cat.key]
                      const period = slipPeriods[cat.key] ?? 'month'
                      return s + (period === 'month' ? (t?.month ?? 0) : (t?.week ?? 0))
                    }, 0)
                    return (
                      <td key={cat.key} className={`px-3 py-2 text-center ${i < SLIP_CATS.length - 1 ? 'border-r border-gray-300' : ''}`}>
                        {total > 0
                          ? <span className="text-green-600">฿{Math.round(total).toLocaleString('th-TH')}</span>
                          : <span className="text-gray-300 font-normal">-</span>}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
