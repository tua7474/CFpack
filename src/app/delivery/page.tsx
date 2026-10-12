'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface DeliveryMethod { id: number; name: string }
interface Branch { id: number; name: string }
interface ScheduleEntry { id: number; week_start: string; day_of_week: number; round: string; branch_id: number; branch_name: string }
interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }

const DAYS_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const ROUNDS = ['เช้า', 'บ่าย'] as const

// Returns ISO date string (YYYY-MM-DD) of the Monday of the current week + offset weeks
function getWeekStart(offsetWeeks = 0): string {
  const now = new Date()
  const day = now.getDay() // 0=Sun 1=Mon...
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diff + offsetWeeks * 7)
  mon.setHours(0, 0, 0, 0)
  return mon.toISOString().slice(0, 10)
}

function fmtWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00')
  const end = new Date(start)
  end.setDate(start.getDate() + 6) // Sunday
  const fmt = (d: Date) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

function getDayDate(weekStart: string, dayIndex: number): string {
  const d = new Date(weekStart + 'T00:00:00')
  d.setDate(d.getDate() + dayIndex)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

// ── Cell component ────────────────────────────────────────────────────────────

function ScheduleCell({
  entries, branches, onAdd, onRemove, busy,
}: {
  entries: ScheduleEntry[]
  branches: Branch[]
  onAdd: (branchId: number) => void
  onRemove: (id: number) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const assignedIds = new Set(entries.map(e => e.branch_id))
  const available = branches.filter(b => !assignedIds.has(b.id))

  return (
    <div className="flex flex-wrap gap-1 items-start min-h-7 py-0.5">
      {entries.map(e => (
        <span key={e.id}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-100 text-orange-800 text-[11px] rounded-full leading-none whitespace-nowrap">
          {e.branch_name}
          <button
            onClick={() => onRemove(e.id)}
            disabled={busy}
            className="ml-0.5 text-orange-400 hover:text-red-500 leading-none disabled:opacity-40">×</button>
        </span>
      ))}
      {available.length > 0 && (
        open ? (
          <select
            autoFocus
            className="text-[11px] border border-gray-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-[120px]"
            defaultValue=""
            onBlur={() => setOpen(false)}
            onChange={e => {
              if (e.target.value) { onAdd(Number(e.target.value)); setOpen(false) }
            }}
          >
            <option value="" disabled>-- เลือกสาขา --</option>
            {available.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setOpen(true)}
            disabled={busy}
            className="px-1.5 py-0.5 text-[11px] rounded bg-gray-100 hover:bg-orange-50 text-gray-400 hover:text-orange-500 border border-dashed border-gray-300 hover:border-orange-300 transition-colors leading-none disabled:opacity-40">
            + เพิ่ม
          </button>
        )
      )}
    </div>
  )
}

// ── Week schedule table ───────────────────────────────────────────────────────

function WeekTable({
  label, weekStart, schedule, branches, onAdd, onRemove, busy,
}: {
  label: string
  weekStart: string
  schedule: ScheduleEntry[]
  branches: Branch[]
  onAdd: (weekStart: string, dayOfWeek: number, round: string, branchId: number) => void
  onRemove: (id: number) => void
  busy: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white">
      <div className="bg-[#9b9484] text-white px-4 py-2 flex items-center justify-between">
        <h2 className="text-sm font-bold">{label}</h2>
        <span className="text-xs text-orange-200">{fmtWeekRange(weekStart)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left text-gray-500 font-semibold w-24">วัน</th>
              <th className="px-3 py-2 text-left text-gray-500 font-semibold">รอบเช้า</th>
              <th className="px-3 py-2 text-left text-gray-500 font-semibold">รอบบ่าย</th>
            </tr>
          </thead>
          <tbody>
            {DAYS_TH.map((dayName, i) => {
              const dow = i + 1 // 1=Mon...6=Sat
              const morning = schedule.filter(e => e.day_of_week === dow && e.round === 'เช้า')
              const afternoon = schedule.filter(e => e.day_of_week === dow && e.round === 'บ่าย')
              return (
                <tr key={dow} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                    <div>{dayName}</div>
                    <div className="text-[10px] text-gray-400 font-normal">{getDayDate(weekStart, i)}</div>
                  </td>
                  <td className="px-3 py-2 border-l border-gray-100">
                    <ScheduleCell
                      entries={morning} branches={branches} busy={busy}
                      onAdd={branchId => onAdd(weekStart, dow, 'เช้า', branchId)}
                      onRemove={onRemove}
                    />
                  </td>
                  <td className="px-3 py-2 border-l border-gray-100">
                    <ScheduleCell
                      entries={afternoon} branches={branches} busy={busy}
                      onAdd={branchId => onAdd(weekStart, dow, 'บ่าย', branchId)}
                      onRemove={onRemove}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const router = useRouter()

  // ── delivery methods ──────────────────────────────────────────────────────
  const [deliveries, setDeliveries]   = useState<DeliveryMethod[]>([])
  const [loadingDel, setLoadingDel]   = useState(true)
  const [newDelivery, setNewDelivery] = useState('')
  const [editDelivery, setEditDelivery] = useState<DeliveryMethod | null>(null)
  const [busyDel, setBusyDel]         = useState(false)
  const [confirmDel, setConfirmDel]   = useState<number | null>(null)

  // ── schedule ──────────────────────────────────────────────────────────────
  const [branches, setBranches]         = useState<Branch[]>([])
  const [scheduleThis, setScheduleThis] = useState<ScheduleEntry[]>([])
  const [scheduleNext, setScheduleNext] = useState<ScheduleEntry[]>([])
  const [loadingSched, setLoadingSched] = useState(true)
  const [busySched, setBusySched]       = useState(false)

  const weekThis = getWeekStart(0)
  const weekNext = getWeekStart(1)

  // ── session guard ─────────────────────────────────────────────────────────
  const [session, setSession] = useState<SessionInfo | null>(null)
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

  // ── load delivery methods ─────────────────────────────────────────────────
  const loadDeliveries = useCallback(async () => {
    setLoadingDel(true)
    const r = await fetch('/api/delivery')
    if (r.ok) setDeliveries(await r.json())
    setLoadingDel(false)
  }, [])

  // ── load schedule ─────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async () => {
    setLoadingSched(true)
    const [r1, r2, rb] = await Promise.all([
      fetch(`/api/delivery/schedule?week=${weekThis}`),
      fetch(`/api/delivery/schedule?week=${weekNext}`),
      fetch('/api/branches'),
    ])
    if (r1.ok) setScheduleThis(await r1.json())
    if (r2.ok) setScheduleNext(await r2.json())
    if (rb.ok) {
      const data = await rb.json()
      setBranches((data as { id: number; name: string }[]).map(b => ({ id: b.id, name: b.name })))
    }
    setLoadingSched(false)
  }, [weekThis, weekNext])

  useEffect(() => { loadDeliveries() }, [loadDeliveries])
  useEffect(() => { loadSchedule() }, [loadSchedule])

  // ── schedule actions ──────────────────────────────────────────────────────
  const handleAddSlot = async (weekStart: string, dayOfWeek: number, round: string, branchId: number) => {
    setBusySched(true)
    const res = await fetch('/api/delivery/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start: weekStart, day_of_week: dayOfWeek, round, branch_id: branchId }),
    })
    if (res.ok) {
      const entry: ScheduleEntry = await res.json()
      if (weekStart === weekThis) setScheduleThis(prev => [...prev, entry])
      else setScheduleNext(prev => [...prev, entry])
    }
    setBusySched(false)
  }

  const handleRemoveSlot = async (id: number) => {
    setBusySched(true)
    await fetch('/api/delivery/schedule', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setScheduleThis(prev => prev.filter(e => e.id !== id))
    setScheduleNext(prev => prev.filter(e => e.id !== id))
    setBusySched(false)
  }

  // ── delivery method actions ───────────────────────────────────────────────
  const addDelivery = async () => {
    if (!newDelivery.trim()) return
    setBusyDel(true)
    await fetch('/api/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDelivery.trim() }),
    })
    setNewDelivery('')
    setBusyDel(false)
    loadDeliveries()
  }

  const saveDelivery = async () => {
    if (!editDelivery?.name.trim()) return
    setBusyDel(true)
    await fetch('/api/delivery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editDelivery.id, name: editDelivery.name.trim() }),
    })
    setEditDelivery(null)
    setBusyDel(false)
    loadDeliveries()
  }

  const deleteDelivery = async (id: number) => {
    await fetch('/api/delivery', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setConfirmDel(null)
    loadDeliveries()
  }

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
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">
          🚚 จัดส่ง
        </span>
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
      </div>

      {/* Main */}
      <main className="p-4 flex flex-col gap-6">

        {/* ── ตารางคิวรถจัดส่ง ── */}
        <div>
          <h2 className="text-sm font-bold text-gray-600 mb-3">📅 ตารางคิวรถจัดส่ง</h2>
          {loadingSched ? (
            <div className="flex items-center justify-center h-24 text-gray-400 text-sm">กำลังโหลด...</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <WeekTable
                label="สัปดาห์นี้"
                weekStart={weekThis}
                schedule={scheduleThis}
                branches={branches}
                onAdd={handleAddSlot}
                onRemove={handleRemoveSlot}
                busy={busySched}
              />
              <WeekTable
                label="สัปดาห์หน้า"
                weekStart={weekNext}
                schedule={scheduleNext}
                branches={branches}
                onAdd={handleAddSlot}
                onRemove={handleRemoveSlot}
                busy={busySched}
              />
            </div>
          )}
        </div>

        {/* ── รูปแบบการจัดส่ง ── */}
        <div>
          <h2 className="text-sm font-bold text-gray-600 mb-3">🚛 รูปแบบการจัดส่ง</h2>
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white max-w-lg">
            {loadingDel ? (
              <div className="flex items-center justify-center h-24 text-gray-400 text-sm">กำลังโหลด...</div>
            ) : (
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500">
                    <th className="px-4 py-2 w-8">#</th>
                    <th className="px-4 py-2">รูปแบบการจัดส่ง</th>
                    <th className="px-4 py-2 w-44"></th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d, i) => (
                    <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2">
                        {editDelivery?.id === d.id ? (
                          <input
                            value={editDelivery.name}
                            onChange={e => setEditDelivery({ ...editDelivery, name: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && saveDelivery()}
                            className="w-full px-2 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                            autoFocus
                          />
                        ) : (
                          <span className="font-medium text-gray-700">{d.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {confirmDel === d.id ? (
                          <div className="flex gap-1 items-center">
                            <span className="text-[10px] text-red-500">ยืนยันลบ?</span>
                            <button onClick={() => deleteDelivery(d.id)}
                              className="px-2 py-0.5 text-xs rounded bg-red-500 hover:bg-red-600 text-white">ลบ</button>
                            <button onClick={() => setConfirmDel(null)}
                              className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500">ยกเลิก</button>
                          </div>
                        ) : editDelivery?.id === d.id ? (
                          <div className="flex gap-1">
                            <button onClick={saveDelivery} disabled={busyDel}
                              className="px-2 py-0.5 text-xs rounded bg-green-500 hover:bg-green-600 text-white disabled:opacity-50">บันทึก</button>
                            <button onClick={() => setEditDelivery(null)}
                              className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500">ยกเลิก</button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <button onClick={() => setEditDelivery({ id: d.id, name: d.name })}
                              className="px-2 py-0.5 text-xs rounded bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200">แก้ไข</button>
                            <button onClick={() => setConfirmDel(d.id)}
                              className="px-2 py-0.5 text-xs rounded bg-red-50 hover:bg-red-100 text-red-600 border border-red-200">ลบ</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2">
              <input
                value={newDelivery}
                onChange={e => setNewDelivery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addDelivery()}
                placeholder="ชื่อรูปแบบการจัดส่งใหม่..."
                className="flex-1 px-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <button onClick={addDelivery} disabled={busyDel || !newDelivery.trim()}
                className="px-3 py-1.5 text-xs rounded bg-[#9b9484] hover:bg-[#857e72] text-white font-medium disabled:opacity-50 whitespace-nowrap">
                + เพิ่ม
              </button>
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
