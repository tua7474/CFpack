'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Page access config — เพิ่มหน้าใหม่ที่นี่เพื่อให้ขึ้น UI อัตโนมัติ ────────

export const PAGE_LIST = [
  { key: 'booking2',    label: 'ใบจองสินค้า' },
  { key: 'stock',       label: 'สต็อค' },
  { key: 'stock-paper', label: 'สต็อคฝอย' },
] as const

export type PageKey = typeof PAGE_LIST[number]['key']

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchPhone { id: number; phone: string; is_admin: boolean; is_manager: boolean; allowed_pages: string[]; line_user_id: string | null }
interface Branch { id: number; name: string; color_group: string | null; map_url: string | null; phones: BranchPhone[]; pending_count: number }

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

interface FinanceEntry { date: string; amount: number; order_no?: string; payment_status?: string }

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
interface UnpaidOrder { id: number; order_no: string; total_amount: string; nv_total: string | null; v_total: string | null; date?: string }

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

function computeWeekBounds(weeksAgo: number) {
  const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const day = bkk.getDay()  // 0=อาทิตย์ … 6=เสาร์
  // สัปดาห์เริ่มอาทิตย์ (เหมือน finance page)
  const sun = new Date(bkk)
  sun.setDate(bkk.getDate() - day - weeksAgo * 7)
  sun.setHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setDate(sun.getDate() + 6)
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso   = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const short = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`
  return { start: iso(sun), end: iso(sat), dateRange: `${short(sun)}–${short(sat)}` }
}

// ── Slip Confirm Modal ────────────────────────────────────────────────────────

function SlipConfirmModal({ slip, onClose, onSaved, session, branches }: {
  slip: Slip; onClose: () => void; onSaved: () => void
  session: BranchSession | null; branches: Branch[]
}) {
  const [slipDate,     setSlipDate]     = useState(slip.slip_date)
  const [accountName,  setAccountName]  = useState(slip.account_name ?? '')
  const [category,     setCategory]     = useState(slip.category)
  const [branchId,     setBranchId]     = useState<number | null>(slip.branch_id)
  const [saving,       setSaving]       = useState(false)
  const [confirmDel,   setConfirmDel]   = useState(false)

  const isAdmin = session?.is_admin ?? false

  const handleConfirm = async () => {
    setSaving(true)
    const body: Record<string, unknown> = { id: slip.id, slip_date: slipDate, account_name: accountName, category, status: 'confirmed' }
    if (isAdmin) body.branch_id = branchId
    await fetch('/api/slips', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">ประเภท</div>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white">
            {SLIP_CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            <option value="other">อื่นๆ</option>
          </select>
        </div>

        {/* ปลายทาง — admin only */}
        {isAdmin && (
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-1">ปลายทาง</div>
            <select value={branchId ?? ''} onChange={e => setBranchId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white">
              <option value="">— ยังไม่ระบุ —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

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

// ── MapCell ───────────────────────────────────────────────────────────────────
function MapCell({ branchId, currentUrl, onSave }: {
  branchId: number; currentUrl: string | null
  onSave: (branchId: number, url: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => { setVal(currentUrl ?? ''); setEditing(true) }
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = val.trim()
    if (trimmed !== (currentUrl ?? '')) onSave(branchId, trimmed)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1 min-w-[80px]">
        <input ref={inputRef} type="text" value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          placeholder="วางลิงก์ Google Maps..."
          className="w-full text-[11px] border border-blue-400 rounded px-1.5 py-1 focus:outline-none bg-white"
        />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-0.5">
      {currentUrl ? (
        <a href={currentUrl} target="_blank" rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700 text-[11px] font-semibold leading-none" title="ดูแผนที่">
          Map
        </a>
      ) : (
        <span className="text-gray-300 text-xs">—</span>
      )}
      <button onClick={startEdit}
        className="text-gray-300 hover:text-blue-400 text-[11px] transition-colors leading-none" title="แก้ไข URL">
        ✏️
      </button>
    </div>
  )
}

// ── Branch Row Component ──────────────────────────────────────────────────────

function BranchRow({
  branch, session, onManage, colorGroup,
  withdrawalTypes, unpaidOrders, orderEntries, slipEntries, heldCount, onMapSave,
}: {
  branch: Branch
  session: BranchSession | null
  onManage: (b: Branch) => void
  colorGroup: ColorGroup
  withdrawalTypes: WithdrawalType[]
  unpaidOrders: Record<number, UnpaidOrder[]>
  orderEntries: FinanceEntry[]
  slipEntries: FinanceEntry[]
  heldCount: number
  onMapSave: (branchId: number, url: string) => void
}) {
  return (
    <tr className={`${ROW_BG[colorGroup]} align-top border-b border-gray-200 transition-colors`}>

      {/* 1. ชื่อสาขา */}
      <td className={`px-3 py-2 border-r border-gray-600 font-semibold whitespace-nowrap ${colorGroup === 'black' ? 'text-white border-gray-600' : 'text-green-400 border-gray-200'}`}>
        <div className="flex items-center justify-between gap-2">
          <span>{branch.name}</span>
          {session?.is_admin && (
            <button onClick={() => onManage(branch)}
              className={`text-[10px] font-normal underline cursor-pointer ${colorGroup === 'black' ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-green-400'}`}>
              จัดการ
            </button>
          )}
        </div>
        {branch.phones.length > 0 && (
          <div className="mt-0.5">
            {branch.phones.map(p => (
              <div key={p.id} className="text-[10px] text-gray-400">{p.phone}</div>
            ))}
          </div>
        )}
        {heldCount > 0 && (
          <div className="mt-0.5">
            <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded whitespace-nowrap">
              ⏸ พักบิล {heldCount} รายการ
            </span>
          </div>
        )}
      </td>

      {/* ประวัติใบจอง */}
      <td className="px-3 py-2 border-r border-gray-200">
        {(() => {
          const thisW  = computeWeekBounds(0)
          const lastW  = computeWeekBounds(1)
          const twoW   = computeWeekBounds(2)
          const bkk    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
          const isoDow = bkk.getDay()  // 0=อาทิตย์ … 6=เสาร์ (ตรงกับ finance page)
          const fmt    = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
          const groups = [
            { label: '2wk', items: orderEntries.filter(e => e.date >= twoW.start && e.date < lastW.start), stores: slipEntries.filter(e => e.date >= twoW.start && e.date < lastW.start), pastSat: true },
            { label: 'last', items: orderEntries.filter(e => e.date >= lastW.start && e.date < thisW.start), stores: slipEntries.filter(e => e.date >= lastW.start && e.date < thisW.start), pastSat: isoDow === 6 },
            { label: 'this', items: orderEntries.filter(e => e.date >= thisW.start), stores: slipEntries.filter(e => e.date >= thisW.start), pastSat: false },
          ].filter(g => g.items.length > 0)
          if (groups.length === 0) return <span className="text-gray-300 text-[10px]">-</span>
          return (
            <div className="flex flex-col gap-0.5">
              {groups.map(({ label, items, stores, pastSat }) => {
                const total     = items.reduce((s, e) => s + e.amount, 0)
                const allPaid   = items.every(e => e.payment_status === 'paid')
                const noSlips   = stores.length === 0
                const suspended = !allPaid && noSlips && pastSat
                const color     = allPaid ? 'text-green-600' : 'text-red-500'
                return (
                  <div key={label} className={`text-[11px] font-mono font-semibold ${color} leading-tight flex items-center gap-1`}>
                    <span>{items.length}/{fmt(total)}</span>
                    {suspended && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600 border border-red-300 leading-none whitespace-nowrap">
                        🚫 ระงับ
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </td>

      {/* MAP */}
      <td className="px-1 py-1 border-r border-gray-200 align-middle text-center w-px whitespace-nowrap">
        <MapCell branchId={branch.id} currentUrl={branch.map_url} onSave={onMapSave} />
      </td>

      {/* ใบจองค้างชำระ — 1 คอลัมน์ต่อ 1 ประเภทเบิกของ */}
      {withdrawalTypes.map(wt => {
        const orders = unpaidOrders[wt.id] ?? []
        const total = orders.reduce((s, o) => s + parseFloat(o.total_amount), 0)
        return (
          <td key={wt.id} className="px-2 py-1.5 border-r border-gray-200 text-center align-middle">
            {orders.length === 0 ? (
              <span className="text-[10px] text-gray-300">-</span>
            ) : (
              <span className="text-[11px] font-semibold text-gray-600 whitespace-nowrap">
                {orders.length}/{Math.round(total).toLocaleString('th-TH')}
              </span>
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
  const [pendingSlips, setPendingSlips] = useState<Slip[]>([])
  const [confirmSlip,  setConfirmSlip]  = useState<Slip | null>(null)

  // Finance order entries by branch
  const [orderEntriesByBranch, setOrderEntriesByBranch] = useState<Record<number, FinanceEntry[]>>({})
  const [slipEntriesByBranch,  setSlipEntriesByBranch]  = useState<Record<number, FinanceEntry[]>>({})
  const [heldCountByBranch,    setHeldCountByBranch]    = useState<Record<number, number>>({})

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

  const loadPendingSlips = useCallback(async () => {
    const res = await fetch('/api/slips?pending=true')
    setPendingSlips(await res.json())
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

  const loadFinanceOrders = useCallback(async () => {
    const r = await fetch('/api/finance')
    const data: { id: number; order_entries: FinanceEntry[]; pay: FinanceEntry[]; store: FinanceEntry[]; held_count: number }[] = await r.json()
    const orderMap: Record<number, FinanceEntry[]> = {}
    const slipMap:  Record<number, FinanceEntry[]> = {}
    const heldMap:  Record<number, number>         = {}
    for (const b of data) {
      orderMap[b.id] = b.order_entries ?? []
      slipMap[b.id]  = [...(b.pay ?? []), ...(b.store ?? [])]
      heldMap[b.id]  = b.held_count ?? 0
    }
    setOrderEntriesByBranch(orderMap)
    setSlipEntriesByBranch(slipMap)
    setHeldCountByBranch(heldMap)
  }, [])

  useEffect(() => { loadBranches() }, [loadBranches])
  useEffect(() => { loadPendingSlips() }, [loadPendingSlips])
  useEffect(() => { loadUnpaidData() }, [loadUnpaidData])
  useEffect(() => { loadFinanceOrders() }, [loadFinanceOrders])

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

  const handleMapSave = useCallback(async (branchId: number, url: string) => {
    setBranches(prev => prev.map(b => b.id === branchId ? { ...b, map_url: url || null } : b))
    await fetch('/api/branches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_map_url', id: branchId, map_url: url || null }),
    })
  }, [])

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
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex overflow-x-auto">
        <Link href="/"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📦 สต็อค
        </Link>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌿 สต็อคฝอย
        </Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">
          🏪 สาขาและตัวแทน
        </span>
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
          🏬 สต็อคสาขา
        </Link>
        <Link href="/branch-foy-stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌿 สต็อคฝอยสาขา
        </Link>
        <Link href="/ocha-import" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📊 นำเข้า Ocha</Link>
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
          onSaved={() => { setConfirmSlip(null); loadPendingSlips() }}
          session={session}
          branches={branches}
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
            <table className="text-xs w-auto">
              <thead>
                {/* Row 1 */}
                <tr className="bg-[#9b9484] text-white text-left">
                  <th rowSpan={2} className="px-3 py-2 border-r border-gray-500 whitespace-nowrap align-bottom">ชื่อสาขา</th>
                  <th rowSpan={2} className="px-3 py-2 border-r border-gray-500 whitespace-nowrap align-bottom">
                    ประวัติใบจอง
                  </th>
                  <th rowSpan={2} className="px-1 py-2 border-r border-gray-500 whitespace-nowrap text-center align-bottom w-px">MAP</th>
                  {withdrawalTypes.length > 0 && (
                    <th colSpan={withdrawalTypes.length} className="px-2 py-1.5 border-r border-[#5a4530] text-center text-[11px] font-bold whitespace-nowrap bg-[#7d6348]">
                      เบิกของ
                    </th>
                  )}
                </tr>
                {/* Row 2 — withdrawal sub-headers */}
                <tr className="bg-[#7d6348] text-white text-center">
                  {withdrawalTypes.map((wt, i) => (
                    <th key={wt.id} className={`px-2 py-1 text-[10px] font-semibold whitespace-nowrap ${i < withdrawalTypes.length - 1 ? 'border-r border-[#5a4530]' : 'border-r border-[#5a4530]'}`}>
                      {wt.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortAndGroup(visibleBranches).map(({ color, items }) => (
                  <>
                    <tr key={`header-${color}`} className={GROUP_HEADER_BG[color]}>
                      <td colSpan={3 + withdrawalTypes.length} className="px-3 py-1 text-xs font-bold tracking-wide">
                        {GROUP_LABEL[color]}
                      </td>
                    </tr>
                    {items.map(b => (
                      <BranchRow key={b.id} branch={b} session={session}
                        onManage={setManageBranch} colorGroup={color}
                        withdrawalTypes={withdrawalTypes}
                        unpaidOrders={unpaidByBranch[b.id] ?? {}}
                        orderEntries={orderEntriesByBranch[b.id] ?? []}
                        slipEntries={slipEntriesByBranch[b.id] ?? []}
                        heldCount={heldCountByBranch[b.id] ?? 0}
                        onMapSave={handleMapSave} />
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                {(() => {
                  const thisW  = computeWeekBounds(0)
                  const lastW  = computeWeekBounds(1)
                  const twoW   = computeWeekBounds(2)
                  const bkk    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
                  const monthStart = `${bkk.getFullYear()}-${String(bkk.getMonth() + 1).padStart(2, '0')}-01`
                  const allEntries = Object.values(orderEntriesByBranch).flat()
                  const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
                  const periods = [
                    { label: 'สัปดาห์นี้',     from: thisW.start, to: null,          to2: null },
                    { label: 'สัปดาห์ที่แล้ว',  from: lastW.start, to: thisW.start,   to2: null },
                    { label: '2 สัปดาห์ก่อน',  from: twoW.start,  to: lastW.start,   to2: null },
                    { label: 'เดือนนี้',        from: monthStart,  to: null,          to2: null },
                  ]
                  return periods.map(({ label, from, to }, idx) => {
                    const orderItems = allEntries.filter(e => e.date >= from && (to === null || e.date < to))
                    const total   = orderItems.reduce((s, e) => s + e.amount, 0)
                    const allPaid = orderItems.length > 0 && orderItems.every(e => e.payment_status === 'paid')
                    const color   = orderItems.length === 0 ? 'text-gray-300' : allPaid ? 'text-green-600' : 'text-red-500'
                    return (
                      <tr key={label} className={`bg-gray-50 text-xs ${idx === 0 ? 'border-t-2 border-gray-400' : 'border-t border-gray-200'}`}>
                        <td className="px-3 py-1.5 border-r border-gray-200 text-[10px] font-semibold text-gray-500 text-right whitespace-nowrap">
                          {label}
                        </td>
                        <td className="px-3 py-1.5 border-r border-gray-200">
                          {orderItems.length === 0
                            ? <span className="text-gray-300 text-[10px]">-</span>
                            : <span className={`text-[11px] font-mono font-semibold ${color}`}>{orderItems.length}/{fmt(total)}</span>
                          }
                        </td>
                        {/* MAP — rowspan ครั้งแรก */}
                        {idx === 0 && <td rowSpan={4} className="px-1 py-1 border-r border-gray-200" />}
                        {/* Withdrawal columns — คำนวณตาม period */}
                        {withdrawalTypes.map(wt => {
                          const allOrders = Object.values(unpaidByBranch).flatMap(byType => byType[wt.id] ?? [])
                          const filtered  = allOrders.filter(o => o.date && o.date >= from && (to === null || o.date < to))
                          const wtTotal   = filtered.reduce((s, o) => s + parseFloat(o.total_amount), 0)
                          return (
                            <td key={wt.id} className="px-2 py-1.5 border-r border-gray-200 text-center">
                              {filtered.length === 0
                                ? <span className="text-gray-300 text-[10px]">-</span>
                                : <span className="text-[11px] font-semibold text-gray-600 whitespace-nowrap">{filtered.length}/{Math.round(wtTotal).toLocaleString('th-TH')}</span>
                              }
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                })()}
              </tfoot>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
