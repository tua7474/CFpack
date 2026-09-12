'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

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
  black:  'กลุ่มแอดมิน',
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

type SlipTotals = Record<string, { month: number; week: number }>

type SlipPeriods = Record<string, 'month' | 'week'>

function BranchRow({
  branch, session, onManage, colorGroup, slipTotals, slipPeriods,
}: {
  branch: Branch
  session: BranchSession | null
  onManage: (b: Branch) => void
  colorGroup: ColorGroup
  slipTotals: SlipTotals
  slipPeriods: SlipPeriods
}) {
  const [orders, setOrders] = useState<BranchOrder[]>([])
  const [monthOrders, setMonthOrders] = useState<BranchOrder[]>([])
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [monthlySummary, setMonthlySummary] = useState<Record<number, { pending: number; paid: number }>>({})
  const [showOtp, setShowOtp] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [payMsg, setPayMsg] = useState('')

  const thisMonth = new Date().getMonth() + 1
  const thisYear  = new Date().getFullYear()

  const loadOrders = useCallback(async () => {
    const r = await fetch(`/api/branches/orders?branch_id=${branch.id}`)
    const all: BranchOrder[] = await r.json()
    setOrders(all)

    // Build monthly summary
    const summary: Record<number, { pending: number; paid: number }> = {}
    for (let m = 1; m <= 12; m++) summary[m] = { pending: 0, paid: 0 }
    for (const o of all) {
      const m = new Date(o.created_at).getMonth() + 1
      if (o.payment_status === 'paid') summary[m].paid++
      else summary[m].pending++
    }
    setMonthlySummary(summary)
  }, [branch.id])

  useEffect(() => { loadOrders() }, [loadOrders])

  const pendingOrders = orders.filter(o => o.payment_status !== 'paid')
  const thisMonthPaid = monthlySummary[thisMonth]?.paid ?? 0
  const thisMonthPending = monthlySummary[thisMonth]?.pending ?? 0

  const handleMonthClick = async (month: number) => {
    if (selectedMonth === month) { setSelectedMonth(null); return }
    setSelectedMonth(month)
    const r = await fetch(`/api/branches/orders?branch_id=${branch.id}&year=${thisYear}&month=${month}`)
    setMonthOrders(await r.json())
  }

  const handleMarkPaid = async (orderId: number) => {
    await fetch('/api/branches/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branch.id, order_ids: [orderId], action: 'pay' }),
    })
    setMonthOrders(prev => prev.map(o =>
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
    setMonthOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, payment_status: 'pending', updated_at: new Date().toISOString() } : o
    ))
    loadOrders()
  }

  const handleSendOtp = async () => {
    setOtpError('')
    const res = await fetch('/api/branches/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', phone: session?.phone }),
    })
    const data = await res.json()
    if (data.ok) {
      setOtpSent(true)
    } else if (data.error === 'line_not_linked') {
      setOtpError('ยังไม่ได้เชื่อม LINE กรุณาส่ง "ลงทะเบียน [เบอร์]" ใน LINE Bot ก่อนครับ')
    } else {
      setOtpError('เกิดข้อผิดพลาด กรุณาลองใหม่')
    }
  }

  const handleVerifyOtp = async () => {
    setOtpError('')
    const res = await fetch('/api/branches/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', phone: session?.phone, code: otpCode }),
    })
    const { valid } = await res.json()
    if (!valid) { setOtpError('รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว'); return }

    // Mark pending orders as paid
    const ids = pendingOrders.map(o => o.id)
    await fetch('/api/branches/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branch.id, order_ids: ids, action: 'pay' }),
    })
    setShowOtp(false)
    setOtpCode('')
    setOtpSent(false)
    setPayMsg('บันทึกชำระเงินสำเร็จ')
    setTimeout(() => setPayMsg(''), 3000)
    loadOrders()
  }

  return (
    <tr className={`${ROW_BG[colorGroup]} align-top border-b border-gray-200 transition-colors`}>

      {/* 1. ชื่อสาขา */}
      <td className={`px-3 py-2 border-r border-gray-600 font-semibold whitespace-nowrap ${colorGroup === 'black' ? 'text-white border-gray-600' : 'text-green-400 border-gray-200'}`}>
        <div>{branch.name}</div>
        {session?.is_admin && (
          <button onClick={() => onManage(branch)}
            className={`mt-1 text-[10px] underline ${colorGroup === 'black' ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-green-400'}`}>
            จัดการ
          </button>
        )}
      </td>

      {/* 2. เบอร์โทร */}
      <td className={`px-3 py-2 border-r ${colorGroup === 'black' ? 'border-gray-600 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
        {branch.phones.map(p => (
          <div key={p.id} className="text-xs whitespace-nowrap">
            {p.phone}
            {p.is_admin && <span className={`ml-1 text-[10px] ${colorGroup === 'black' ? 'text-yellow-400' : 'text-green-400'}`}>(admin)</span>}
            {!p.is_admin && p.is_manager && <span className={`ml-1 text-[10px] ${colorGroup === 'black' ? 'text-blue-300' : 'text-blue-500'}`}>(ผู้จัดการ)</span>}
            {!p.is_admin && !p.is_manager && p.allowed_pages.length > 0 && (
              <span className="ml-1 text-[9px] text-gray-400">
                [{p.allowed_pages.map(k => PAGE_LIST.find(pg => pg.key === k)?.label ?? k).join(', ')}]
              </span>
            )}
          </div>
        ))}
      </td>

      {/* 3. ใบจองรอชำระ */}
      <td className="px-3 py-2 border-r border-gray-200 min-w-[180px]">
        {pendingOrders.length === 0 ? (
          <span className="text-xs text-gray-400">ไม่มีรายการค้าง</span>
        ) : pendingOrders.map(o => (
          <div key={o.id} className="text-xs mb-1 pb-1 border-b border-gray-100 last:border-0">
            <div className="font-medium text-gray-500">#{o.order_no}</div>
            <div className="text-gray-500">
              จำนวน 1 ใบ · ฿{fmtMoney(o.total_amount)}
            </div>
            <div className="text-[10px] text-gray-400">{fmtDate(o.created_at)}</div>
          </div>
        ))}
      </td>

      {/* 4. สถานะ + ชำระเงิน */}
      <td className="px-3 py-2 border-r border-gray-200 min-w-[130px]">
        {pendingOrders.length > 0 ? (
          <div>
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-orange-100 text-green-400 font-medium mb-1">
              รอชำระเงิน
            </span>
            {payMsg && <div className="text-xs text-green-400">{payMsg}</div>}
            {(session?.is_admin || session?.is_manager) && !showOtp && (
              <button onClick={() => { setShowOtp(true); setOtpSent(false); setOtpCode(''); setOtpError('') }}
                className="block text-xs px-2 py-1 rounded bg-[#9b9484] hover:bg-[#9b9484] text-white mt-1 whitespace-nowrap">
                ✓ ชำระเงินแล้ว
              </button>
            )}
            {(session?.is_admin || session?.is_manager) && showOtp && (
              <div className="mt-1 space-y-1">
                {!otpSent ? (
                  <button onClick={handleSendOtp}
                    className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap">
                    ส่ง OTP ทาง LINE
                  </button>
                ) : (
                  <div className="space-y-1">
                    <input value={otpCode} onChange={e => setOtpCode(e.target.value)}
                      placeholder="รหัส OTP 6 หลัก"
                      className="w-28 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400" />
                    <div className="flex gap-1">
                      <button onClick={handleVerifyOtp}
                        className="text-xs px-2 py-1 rounded bg-[#9b9484] hover:bg-[#9b9484] text-white">
                        ยืนยัน
                      </button>
                      <button onClick={() => setShowOtp(false)}
                        className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-500">
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}
                {otpError && <div className="text-[10px] text-red-500">{otpError}</div>}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-green-400">ชำระครบแล้ว</span>
        )}
      </td>

      {/* 5. สรุปเดือนนี้ */}
      <td className="px-3 py-2 border-r border-gray-200 text-center">
        <div className="text-xs text-gray-500 mb-0.5">{MONTH_NAMES[thisMonth - 1]}</div>
        <div className="text-sm font-bold text-green-400">{thisMonthPending}</div>
        <div className="text-xs text-gray-400">/ {thisMonthPaid} ชำระแล้ว</div>
      </td>

      {/* 6. ปุ่มเดือน 1-12 */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
            const s = monthlySummary[m] ?? { pending: 0, paid: 0 }
            const isSelected = selectedMonth === m
            return (
              <button key={m} onClick={() => handleMonthClick(m)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  isSelected
                    ? 'bg-[#9b9484] text-white border-gray-500'
                    : s.pending > 0
                    ? 'bg-orange-50 text-green-400 border-orange-400 hover:bg-orange-100'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                }`}>
                {m}
                {(s.pending > 0 || s.paid > 0) && (
                  <span className="ml-0.5">{s.pending}/{s.paid}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Month detail */}
        {selectedMonth !== null && (
          <div className="mt-2 border border-gray-200 rounded p-2 bg-white text-xs max-w-[280px]">
            <div className="font-semibold text-gray-500 mb-1">{MONTH_NAMES[selectedMonth - 1]} {thisYear}</div>
            {monthOrders.length === 0 ? (
              <div className="text-gray-400">ไม่มีรายการ</div>
            ) : monthOrders.map(o => (
              <div key={o.id} className={`flex items-start gap-1.5 py-1 border-b border-gray-100 last:border-0 ${o.payment_status === 'paid' ? 'text-green-400' : 'text-gray-500'}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">#{o.order_no}</div>
                  <div className="text-[9px] text-gray-400">จอง {fmtDateShort(o.created_at)}</div>
                  {session?.is_admin && o.payment_status === 'paid' && (
                    <button onClick={() => handleResetPaid(o.id)}
                      className="text-[9px] text-gray-400 hover:text-red-500 hover:underline">
                      รีเซ็ต
                    </button>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-gray-500">฿{fmtMoney(o.total_amount)}</div>
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
            ))}
          </div>
        )}
      </td>

      {/* 7–11. Slip totals per category */}
      {SLIP_CATS.map((cat, i) => {
        const t     = slipTotals[cat.key]
        const total = (slipPeriods[cat.key] ?? 'month') === 'month' ? (t?.month ?? 0) : (t?.week ?? 0)
        return (
          <td key={cat.key}
            className={`px-3 py-2 text-center whitespace-nowrap ${i < SLIP_CATS.length - 1 ? 'border-r border-gray-200' : ''} ${colorGroup === 'black' ? '' : ''}`}>
            {total > 0 ? (
              <span className="text-xs font-semibold text-green-500">
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

function ManageModal({ branch, onClose, onSaved, onDeleted }: { branch: Branch; onClose: () => void; onSaved: () => void; onDeleted: (id: number) => void }) {
  const [newPhone, setNewPhone] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isManager, setIsManager] = useState(false)
  const [allowedPages, setAllowedPages] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const deleteBranch = async () => {
    await fetch('/api/branches', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: branch.id }),
    })
    onDeleted(branch.id)
  }

  const addPhone = async () => {
    const p = newPhone.replace(/\D/g, '')
    if (!p) return
    setSaving(true)
    await fetch('/api/branches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_phone', branch_id: branch.id, phone: p, is_admin: isAdmin, is_manager: isManager, allowed_pages: allowedPages }),
    })
    setNewPhone(''); setIsAdmin(false); setIsManager(false); setAllowedPages([]); setSaving(false)
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm">
        <h3 className="text-base font-bold text-green-400 mb-3">จัดการสาขา: {branch.name}</h3>

        {/* Phone list */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">เบอร์โทรที่ลงทะเบียน</div>
          {branch.phones.length === 0 && <div className="text-xs text-gray-400">ยังไม่มีเบอร์</div>}
          {branch.phones.map(p => (
            <div key={p.id} className="flex items-center justify-between py-1 border-b border-gray-100">
              <div className="text-sm">
                {p.phone}
                {p.is_admin && <span className="ml-1 text-[10px] text-green-400 font-medium">(admin)</span>}
                {!p.is_admin && p.is_manager && <span className="ml-1 text-[10px] text-blue-500 font-medium">(ผู้จัดการ)</span>}
                {p.line_user_id && <span className="ml-1 text-[10px] text-green-400">✓LINE</span>}
              </div>
              <button onClick={() => removePhone(p.id)}
                className="text-xs text-red-400 hover:text-red-600">ลบ</button>
            </div>
          ))}
        </div>

        {/* Add phone */}
        <div className="space-y-2">
          <div className="text-xs text-gray-500">เพิ่มเบอร์โทร</div>
          <input value={newPhone} onChange={e => setNewPhone(e.target.value)}
            placeholder="0812345678" type="text" inputMode="numeric"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isAdmin} onChange={e => { setIsAdmin(e.target.checked); if (e.target.checked) setIsManager(false) }}
              className="rounded" />
            เป็น Admin (กดชำระเงินได้)
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isManager} onChange={e => { setIsManager(e.target.checked); if (e.target.checked) setIsAdmin(false) }}
              className="rounded" />
            เป็นผู้จัดการ (กดชำระเงินได้)
          </label>
          {/* หน้าที่เข้าถึงได้ — driven by PAGE_LIST */}
          <div className="border-t border-gray-100 pt-2">
            <div className="text-xs text-gray-500 mb-1.5">หน้าที่เข้าถึงได้</div>
            <div className="space-y-1">
              {PAGE_LIST.map(pg => (
                <label key={pg.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedPages.includes(pg.key)}
                    onChange={e => setAllowedPages(prev =>
                      e.target.checked ? [...prev, pg.key] : prev.filter(k => k !== pg.key)
                    )}
                    className="rounded"
                  />
                  {pg.label}
                </label>
              ))}
            </div>
          </div>
          <button onClick={addPhone} disabled={saving}
            className="w-full py-1.5 text-sm rounded bg-[#9b9484] hover:bg-[#9b9484] text-white font-medium disabled:opacity-50">
            + เพิ่มเบอร์
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
  const [session, setSession]         = useState<BranchSession | null>(null)
  const [loginPhone, setLoginPhone]   = useState('')
  const [loginError, setLoginError]   = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [branches, setBranches]       = useState<Branch[]>([])
  const [loading, setLoading]         = useState(true)
  const [manageBranch, setManageBranch] = useState<Branch | null>(null)
  const [showAddBranch, setShowAddBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchColor, setNewBranchColor] = useState<'black' | 'editor' | 'yellow' | 'red' | 'orange'>('orange')

  // Slip state
  const [slipPeriods,  setSlipPeriods]  = useState<SlipPeriods>({ วรวุฒิ: 'month', print: 'month', pack: 'month', bb: 'month', กล่อง: 'month' })
  const [slipData,     setSlipData]     = useState<Record<number, SlipTotals>>({})
  const [pendingSlips, setPendingSlips] = useState<Slip[]>([])
  const [confirmSlip,  setConfirmSlip]  = useState<Slip | null>(null)

  // Load session from localStorage
  useEffect(() => {
    try {
      const s = localStorage.getItem('branch_session')
      if (s) setSession(JSON.parse(s))
    } catch { /* ignore */ }
  }, [])

  const loadBranches = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/branches')
    setBranches(await r.json())
    setLoading(false)
  }, [])

  const loadSlipData = useCallback(async () => {
    const [byBranchRes, pendingRes] = await Promise.all([
      fetch('/api/slips?by_branch=true'),
      fetch('/api/slips?pending=true'),
    ])
    const rows: { branch_id: number; category: string; month_total: number; week_total: number }[] = await byBranchRes.json()
    const pending: Slip[] = await pendingRes.json()
    // Build map: branch_id → category → { month, week }
    const map: Record<number, SlipTotals> = {}
    for (const r of rows) {
      if (!map[r.branch_id]) map[r.branch_id] = {}
      map[r.branch_id][r.category] = { month: r.month_total, week: r.week_total }
    }
    setSlipData(map)
    setPendingSlips(pending)
  }, [])

  useEffect(() => { loadBranches() }, [loadBranches])
  useEffect(() => { loadSlipData() }, [loadSlipData])

  const handleLogin = async () => {
    setLoginError('')
    setLoginLoading(true)
    const clean = loginPhone.replace(/\D/g, '')
    const res = await fetch('/api/branches/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clean }),
    })
    setLoginLoading(false)
    if (!res.ok) { setLoginError('ไม่พบเบอร์โทรนี้ในระบบ กรุณาติดต่อผู้ดูแล'); return }
    const data = await res.json()
    const s: BranchSession = { branch_id: data.branch_id, branch_name: data.branch_name, phone: clean, is_admin: data.is_admin, is_manager: data.is_manager ?? false, allowed_pages: data.allowed_pages ?? [] }
    localStorage.setItem('branch_session', JSON.stringify(s))
    setSession(s)
  }

  const handleLogout = () => {
    localStorage.removeItem('branch_session')
    setSession(null)
    setLoginPhone('')
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
            <p className="text-xs text-gray-500 mb-4">กรอกเบอร์โทรที่ลงทะเบียนไว้</p>
            <input value={loginPhone} onChange={e => setLoginPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="0812345678" type="text" inputMode="numeric"
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
                  ['black',  'แอดมิน',  'bg-black text-white'],
                  ['editor', 'Editor',  'bg-green-600 text-white'],
                  ['yellow', 'สีเหลือง','bg-yellow-200 text-yellow-900'],
                  ['red',    'สีแดง',   'bg-red-200 text-red-900'],
                  ['orange', 'สีส้ม',   'bg-orange-200 text-orange-900'],
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
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">เบอร์โทร</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">ใบจองรอชำระ</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">สถานะ</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap text-center">เดือนนี้</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">ประวัติรายเดือน</th>
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
                      <td colSpan={11} className="px-3 py-1 text-xs font-bold tracking-wide">
                        {GROUP_LABEL[color]}
                      </td>
                    </tr>
                    {items.map(b => (
                      <BranchRow key={b.id} branch={b} session={session}
                        onManage={setManageBranch} colorGroup={color}
                        slipTotals={slipData[b.id] ?? {}}
                        slipPeriods={slipPeriods} />
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
