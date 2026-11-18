'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface DeliveryMethod { id: number; name: string }
interface Branch { id: number; name: string }
interface ScheduleEntry { id: number; week_start: string; day_of_week: number; truck_no: number; round: string; branch_id: number; branch_name: string }
interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }


const DAYS_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const ROUNDS = ['เช้า', 'บ่าย'] as const

// สีประจำวัน (ตามธรรมเนียมไทย)
const DAY_COLORS = [
  { dayCell: 'bg-yellow-400  text-white', truck1: 'bg-yellow-50',  truck2: 'bg-yellow-100' }, // จันทร์
  { dayCell: 'bg-pink-400    text-white', truck1: 'bg-pink-50',    truck2: 'bg-pink-100'   }, // อังคาร
  { dayCell: 'bg-green-500   text-white', truck1: 'bg-green-50',   truck2: 'bg-green-100'  }, // พุธ
  { dayCell: 'bg-orange-400  text-white', truck1: 'bg-orange-50',  truck2: 'bg-orange-100' }, // พฤหัสบดี
  { dayCell: 'bg-sky-400     text-white', truck1: 'bg-sky-50',     truck2: 'bg-sky-100'    }, // ศุกร์
  { dayCell: 'bg-purple-500  text-white', truck1: 'bg-purple-50',  truck2: 'bg-purple-100' }, // เสาร์
  { dayCell: 'bg-red-500     text-white', truck1: 'bg-red-50',     truck2: 'bg-red-100'    }, // อาทิตย์
]

const TRUCKS = [
  { no: 1, name: 'อ๊อบ 4 ฒญ', badge: 'bg-blue-600  text-white' },
  { no: 2, name: 'ต้น 3 ฒท',  badge: 'bg-violet-600 text-white' },
]

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
  onAdd: (weekStart: string, dayOfWeek: number, truckNo: number, round: string, branchId: number) => void
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
              <th className="px-3 py-2 text-left text-gray-500 font-semibold w-28">คนขับ</th>
              <th className="px-3 py-2 text-left text-gray-500 font-semibold">รอบเช้า</th>
              <th className="px-3 py-2 text-left text-gray-500 font-semibold">รอบบ่าย</th>
            </tr>
          </thead>
          <tbody>
            {DAYS_TH.map((dayName, i) => {
              const dow      = i + 1
              const dc       = DAY_COLORS[i]
              const isLastDay = i === DAYS_TH.length - 1
              return (
                <Fragment key={dow}>
                  {TRUCKS.map((truck, ti) => {
                    const morning   = schedule.filter(e => e.day_of_week === dow && e.truck_no === truck.no && e.round === 'เช้า')
                    const afternoon = schedule.filter(e => e.day_of_week === dow && e.truck_no === truck.no && e.round === 'บ่าย')
                    const isLastRow = isLastDay && ti === TRUCKS.length - 1
                    const rowBg     = ti === 0 ? dc.truck1 : dc.truck2
                    return (
                      <tr key={truck.no}
                        className={`${rowBg} ${isLastRow ? '' : ti === TRUCKS.length - 1 ? 'border-b border-gray-300' : 'border-b border-white/60'}`}>
                        {ti === 0 && (
                          <td rowSpan={TRUCKS.length}
                            className={`px-3 py-2 font-bold whitespace-nowrap border-r border-white/40 align-middle ${dc.dayCell}`}>
                            <div className="text-sm">{dayName}</div>
                            <div className="text-[10px] opacity-80 font-normal">{getDayDate(weekStart, i)}</div>
                          </td>
                        )}
                        <td className="px-2 py-1.5 border-r border-white/40 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold leading-none shadow-sm ${truck.badge}`}>
                            {truck.name}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 border-r border-white/40">
                          <ScheduleCell
                            entries={morning} branches={branches} busy={busy}
                            onAdd={branchId => onAdd(weekStart, dow, truck.no, 'เช้า', branchId)}
                            onRemove={onRemove}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <ScheduleCell
                            entries={afternoon} branches={branches} busy={busy}
                            onAdd={branchId => onAdd(weekStart, dow, truck.no, 'บ่าย', branchId)}
                            onRemove={onRemove}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Trip interfaces & constants ───────────────────────────────────────────────

type TripStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type StopStatus = 'pending' | 'delivered' | 'skipped' | 'failed'

interface Trip {
  id: number
  truck_no: number
  trip_date: string
  round: string
  status: TripStatus
  departed_at: string | null
  completed_at: string | null
  total_distance_km: string | null
  total_distance_calc: string | null
  rescheduled_stop_count: number
  driver_note: string | null
  stops: TripStop[]
}

interface TripStop {
  id: number
  stop_order: number
  branch_id: number
  branch_name: string
  delivery_type: string
  order_nos: string[]
  status: StopStatus
  skip_reason_code: string | null
  skip_reason_note: string | null
}

const TRIP_STATUS: Record<TripStatus, { label: string; cls: string }> = {
  pending:     { label: 'รอออก',     cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  in_progress: { label: 'กำลังวิ่ง', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  completed:   { label: 'เสร็จสิ้น', cls: 'bg-green-100 text-green-700 border-green-300' },
  cancelled:   { label: 'ยกเลิก',   cls: 'bg-red-50 text-red-500 border-red-200' },
}

const STOP_STATUS: Record<StopStatus, { label: string; cls: string }> = {
  pending:   { label: 'รอส่ง',    cls: 'bg-gray-100 text-gray-500' },
  delivered: { label: 'ส่งแล้ว',  cls: 'bg-green-100 text-green-700' },
  skipped:   { label: 'ข้ามสาขา', cls: 'bg-amber-100 text-amber-700' },
  failed:    { label: 'ล้มเหลว',  cls: 'bg-red-100 text-red-600' },
}

function fmtTime(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

// ── TripCard ──────────────────────────────────────────────────────────────────

function TripCard({
  trip, branches, onUpdateTrip, onUpdateStop, onAddStop, onRemoveStop, onOptimize, busy,
}: {
  trip: Trip
  branches: Branch[]
  onUpdateTrip: (id: number, patch: object) => Promise<void>
  onUpdateStop: (id: number, patch: object) => Promise<void>
  onAddStop: (tripId: number, branchId: number, deliveryType: string) => Promise<void>
  onRemoveStop: (id: number) => Promise<void>
  onOptimize: (tripId: number) => Promise<void>
  busy: boolean
}) {
  const [expanded,       setExpanded]       = useState(true)
  const [addingStop,     setAddingStop]     = useState(false)
  const [newBranchId,    setNewBranchId]    = useState<number | ''>('')
  const [newDelivType,   setNewDelivType]   = useState<'ส่งตรง' | 'รอพ่วง'>('รอพ่วง')
  const [skipTarget,     setSkipTarget]     = useState<number | null>(null)
  const [skipReason,     setSkipReason]     = useState('')
  const [distEdit,       setDistEdit]       = useState(false)
  const [distVal,        setDistVal]        = useState(trip.total_distance_km ?? '')

  const ts = TRIP_STATUS[trip.status] ?? TRIP_STATUS.pending
  const deliveredCount  = trip.stops.filter(s => s.status === 'delivered').length
  const pendingStops    = trip.stops.filter(s => s.status === 'pending')
  const usedBranchIds   = new Set(trip.stops.map(s => s.branch_id))
  const availBranches   = branches.filter(b => !usedBranchIds.has(b.id))

  const handleStart    = () => onUpdateTrip(trip.id, { status: 'in_progress', departed_at: new Date().toISOString() })
  const handleComplete = () => onUpdateTrip(trip.id, { status: 'completed',   completed_at: new Date().toISOString() })
  const handleCancel   = () => { if (confirm('ยืนยันยกเลิกรอบนี้?')) onUpdateTrip(trip.id, { status: 'cancelled' }) }

  const handleDelivered = (stopId: number) =>
    onUpdateStop(stopId, { status: 'delivered', arrived_at: new Date().toISOString() })

  const handleSkip = (stopId: number) => {
    onUpdateStop(stopId, { status: 'skipped', skip_reason_code: skipReason || 'other' })
    setSkipTarget(null); setSkipReason('')
  }

  const handleSaveDist = () => {
    onUpdateTrip(trip.id, { total_distance_km: distVal ? parseFloat(String(distVal)) : null })
    setDistEdit(false)
  }

  if (trip.status === 'cancelled') {
    return (
      <div className="rounded border border-dashed border-red-200 bg-red-50 px-3 py-2 text-xs text-red-400 italic">
        ยกเลิกรอบนี้แล้ว
      </div>
    )
  }

  const headerBg = trip.status === 'in_progress' ? 'bg-blue-50' : trip.status === 'completed' ? 'bg-green-50' : 'bg-gray-50'
  const cardBorder = trip.status === 'in_progress' ? 'border-blue-300' : trip.status === 'completed' ? 'border-green-300' : 'border-gray-200'

  return (
    <div className={`rounded-lg border shadow-sm bg-white overflow-hidden ${cardBorder}`}>
      {/* header */}
      <div className={`px-3 py-2 flex items-center gap-2 ${headerBg}`}>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ts.cls}`}>{ts.label}</span>
        <span className="text-[11px] text-gray-500">
          {trip.stops.length > 0 && <>{deliveredCount}/{trip.stops.length} สาขา</>}
          {trip.total_distance_km
            ? <> · {trip.total_distance_km} กม.</>
            : trip.total_distance_calc
              ? <> · ~{trip.total_distance_calc} กม.</>
              : null}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {pendingStops.length >= 2 && trip.status !== 'completed' && (
            <button onClick={() => onOptimize(trip.id)} disabled={busy}
              className="px-2.5 py-0.5 text-[11px] rounded bg-white hover:bg-orange-50 text-orange-500 border border-orange-200 disabled:opacity-50">
              🔀 เรียงเส้นทาง
            </button>
          )}
          {trip.status === 'pending' && (
            <button onClick={handleStart} disabled={busy}
              className="px-2.5 py-0.5 text-[11px] rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50">
              เริ่มออก
            </button>
          )}
          {trip.status === 'in_progress' && (
            <button onClick={handleComplete} disabled={busy}
              className="px-2.5 py-0.5 text-[11px] rounded bg-green-500 hover:bg-green-600 text-white disabled:opacity-50">
              เสร็จสิ้น
            </button>
          )}
          {(trip.status === 'pending' || trip.status === 'in_progress') && (
            <button onClick={handleCancel} disabled={busy}
              className="px-2 py-0.5 text-[11px] rounded bg-white hover:bg-red-50 text-red-400 border border-red-200 disabled:opacity-50">
              ยกเลิก
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="px-2 py-0.5 text-[11px] rounded bg-white border border-gray-200 text-gray-400 hover:bg-gray-50">
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* timing + distance row */}
          {(trip.departed_at || trip.completed_at || trip.status !== 'pending') && (
            <div className="px-3 py-1.5 border-b border-gray-100 flex gap-4 text-[11px] text-gray-500 items-center">
              {trip.departed_at  && <span>ออก {fmtTime(trip.departed_at)}</span>}
              {trip.completed_at && <span>กลับ {fmtTime(trip.completed_at)}</span>}
              <div className="ml-auto flex items-center gap-1">
                {distEdit ? (
                  <>
                    <input type="number" step="0.1" min="0" value={distVal}
                      onChange={e => setDistVal(e.target.value)}
                      className="w-16 px-1 py-0.5 border border-gray-300 rounded text-[11px] focus:outline-none"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveDist(); if (e.key === 'Escape') setDistEdit(false) }}
                    />
                    <span className="text-gray-400">กม.</span>
                    <button onClick={handleSaveDist} className="text-green-600 text-[11px] hover:text-green-700">✓</button>
                    <button onClick={() => setDistEdit(false)} className="text-gray-400 text-[11px] hover:text-gray-600">✕</button>
                  </>
                ) : (
                  <button onClick={() => { setDistVal(trip.total_distance_km ?? ''); setDistEdit(true) }}
                    className="text-gray-400 hover:text-gray-600 text-[11px]">
                    {trip.total_distance_km ? `${trip.total_distance_km} กม. ✏️` : '+ บันทึกระยะทาง'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* stops list */}
          {trip.stops.length > 0 ? (
            <table className="w-full text-xs border-collapse">
              <tbody>
                {trip.stops.map((stop, si) => {
                  const ss = STOP_STATUS[stop.status] ?? STOP_STATUS.pending
                  return (
                    <Fragment key={stop.id}>
                      <tr className={`border-t border-gray-100 ${stop.status === 'delivered' ? 'bg-green-50/40' : stop.status === 'skipped' ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-2 py-1.5 w-6 text-gray-300 text-[10px] text-center">{stop.stop_order}</td>
                        <td className="px-1 py-1.5">
                          <div className="font-medium text-gray-700">{stop.branch_name}</div>
                          {stop.order_nos.length > 0 && (
                            <div className="text-[10px] text-gray-400">{stop.order_nos.length} ใบจอง</div>
                          )}
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${stop.delivery_type === 'ส่งตรง' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                            {stop.delivery_type}
                          </span>
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${ss.cls}`}>{ss.label}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {stop.status === 'pending' && trip.status !== 'completed' && (
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => handleDelivered(stop.id)} disabled={busy}
                                className="px-2 py-0.5 text-[10px] rounded bg-green-500 hover:bg-green-600 text-white disabled:opacity-50">
                                ✓ ส่งแล้ว
                              </button>
                              <button onClick={() => setSkipTarget(id => id === stop.id ? null : stop.id)}
                                className="px-2 py-0.5 text-[10px] rounded bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-200">
                                ข้าม
                              </button>
                              <button onClick={() => onRemoveStop(stop.id)} disabled={busy}
                                className="px-1.5 py-0.5 text-[10px] rounded text-gray-300 hover:text-red-400 hover:bg-red-50">
                                ✕
                              </button>
                            </div>
                          )}
                          {stop.status === 'skipped' && stop.skip_reason_code && (
                            <span className="text-[9px] text-amber-500 italic">{stop.skip_reason_code}</span>
                          )}
                        </td>
                      </tr>
                      {skipTarget === stop.id && (
                        <tr className="bg-amber-50 border-t border-amber-100">
                          <td colSpan={5} className="px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] text-amber-700 font-medium">เหตุผล:</span>
                              <select value={skipReason} onChange={e => setSkipReason(e.target.value)}
                                className="text-xs border border-amber-300 rounded px-1.5 py-0.5 bg-white focus:outline-none">
                                <option value="">— เลือก —</option>
                                <option value="full_truck">รถเต็ม</option>
                                <option value="branch_closed">สาขาปิด</option>
                                <option value="road_blocked">ถนนปิด</option>
                                <option value="other">อื่นๆ</option>
                              </select>
                              <button onClick={() => handleSkip(stop.id)} disabled={busy || !skipReason}
                                className="px-2 py-0.5 text-xs rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50">
                                ยืนยัน
                              </button>
                              <button onClick={() => { setSkipTarget(null); setSkipReason('') }}
                                className="px-2 py-0.5 text-xs rounded bg-white border border-gray-200 text-gray-500">
                                ยกเลิก
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-3 py-3 text-[11px] text-gray-300 italic">ยังไม่มีสาขาในรอบนี้</div>
          )}

          {/* add stop */}
          {trip.status !== 'completed' && (
            <div className="border-t border-gray-100 px-3 py-2">
              {addingStop ? (
                <div className="flex gap-2 items-center flex-wrap">
                  <select value={newBranchId} onChange={e => setNewBranchId(e.target.value ? Number(e.target.value) : '')}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-orange-300">
                    <option value="">— เลือกสาขา —</option>
                    {availBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <select value={newDelivType} onChange={e => setNewDelivType(e.target.value as 'ส่งตรง' | 'รอพ่วง')}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none">
                    <option value="รอพ่วง">รอพ่วง</option>
                    <option value="ส่งตรง">ส่งตรง</option>
                  </select>
                  <button onClick={() => { if (newBranchId) { onAddStop(trip.id, Number(newBranchId), newDelivType); setNewBranchId(''); setAddingStop(false) } }}
                    disabled={!newBranchId || busy}
                    className="px-2.5 py-1 text-xs rounded bg-[#9b9484] hover:bg-[#857e72] text-white disabled:opacity-50">
                    + เพิ่ม
                  </button>
                  <button onClick={() => setAddingStop(false)}
                    className="px-2 py-1 text-xs rounded bg-white border border-gray-200 text-gray-500">
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button onClick={() => setAddingStop(true)}
                  className="text-[11px] text-gray-400 hover:text-orange-500 transition-colors">
                  + เพิ่มสาขา
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── TripDayView ───────────────────────────────────────────────────────────────

function TripDayView({ branches }: { branches: Branch[] }) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [date,    setDate]    = useState(todayStr)
  const [trips,   setTrips]   = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)

  const loadTrips = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/delivery/trips?date=${date}`)
    if (r.ok) setTrips(await r.json())
    else setTrips([])
    setLoading(false)
  }, [date])

  useEffect(() => { loadTrips() }, [loadTrips])

  const shiftDate = (d: number) => {
    const dt = new Date(date + 'T00:00:00')
    dt.setDate(dt.getDate() + d)
    setDate(dt.toISOString().slice(0, 10))
  }

  const patch = async (body: object) => {
    setBusy(true)
    await fetch('/api/delivery/trips', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await loadTrips()
    setBusy(false)
  }

  const handleCreateTrip = async (truckNo: number, round: string) => {
    setBusy(true)
    const r = await fetch('/api/delivery/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truck_no: truckNo, trip_date: date, round }),
    })
    if (r.ok) {
      const trip = await r.json()
      // เติม stops จาก schedule + เรียงเส้นทาง
      await fetch('/api/delivery/trips', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'populate_from_schedule', trip_id: trip.id }),
      })
      await loadTrips()
    }
    setBusy(false)
  }

  const handleUpdateTrip = (id: number, p: object) => patch({ action: 'update_trip', id, ...p })
  const handleUpdateStop = (id: number, p: object) => patch({ action: 'update_stop', id, ...p })
  const handleAddStop    = (tripId: number, branchId: number, deliveryType: string) =>
    patch({ action: 'add_stop', trip_id: tripId, branch_id: branchId, delivery_type: deliveryType, order_nos: [] })
  const handleRemoveStop = (id: number) => patch({ action: 'remove_stop', id })
  const handleOptimize   = (tripId: number) => patch({ action: 'optimize_route', trip_id: tripId })

  // ── day summary stats ──────────────────────────────────────────────────────
  const activeTrips    = trips.filter(t => t.status !== 'cancelled')
  const totalDelivered = activeTrips.reduce((s, t) => s + t.stops.filter(st => st.status === 'delivered').length, 0)
  const totalStops     = activeTrips.reduce((s, t) => s + t.stops.length, 0)
  const anyInProgress  = activeTrips.some(t => t.status === 'in_progress')

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="flex flex-col gap-4">
      {/* date nav */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => shiftDate(-1)}
          className="px-2.5 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 leading-none">‹</button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
        <button onClick={() => shiftDate(1)}
          className="px-2.5 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 leading-none">›</button>
        <button onClick={() => setDate(todayStr)} disabled={date === todayStr}
          className="px-2.5 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500 disabled:opacity-30">
          วันนี้
        </button>
        <span className="text-sm text-gray-600">{dateLabel}</span>
        {anyInProgress && (
          <span className="ml-auto px-2.5 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 animate-pulse">
            กำลังวิ่งอยู่
          </span>
        )}
      </div>

      {/* stats strip */}
      {!loading && activeTrips.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {TRUCKS.map(truck => {
            const tTrips = activeTrips.filter(t => t.truck_no === truck.no)
            if (!tTrips.length) return null
            const tDel   = tTrips.reduce((s, t) => s + t.stops.filter(st => st.status === 'delivered').length, 0)
            const tTotal = tTrips.reduce((s, t) => s + t.stops.length, 0)
            const tDist  = tTrips.reduce((s, t) => s + (t.total_distance_km ? parseFloat(String(t.total_distance_km)) : 0), 0)
            return (
              <div key={truck.no} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm text-xs">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${truck.badge}`}>{truck.name}</span>
                <span className="text-gray-600 font-medium">{tDel}/{tTotal} สาขา</span>
                {tDist > 0 && <span className="text-gray-400">{tDist.toFixed(1)} กม.</span>}
              </div>
            )
          })}
          {totalStops > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-xs font-bold text-orange-700">
              รวม {totalDelivered}/{totalStops} สาขา
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">กำลังโหลด...</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {TRUCKS.map(truck => (
            <div key={truck.no} className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white">
              <div className={`px-4 py-2.5 flex items-center gap-2 ${truck.no === 1 ? 'bg-blue-600' : 'bg-violet-600'} text-white`}>
                <span className="font-bold text-sm">{truck.name}</span>
                <span className="text-xs opacity-75">{truck.no === 1 ? 'CF01' : 'CF02'}</span>
              </div>
              {ROUNDS.map(round => {
                const trip = trips.find(t => t.truck_no === truck.no && t.round === round && t.status !== 'cancelled')
                return (
                  <div key={round} className="border-t border-gray-100">
                    <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-600">รอบ{round}</span>
                      {!trip && (
                        <button onClick={() => handleCreateTrip(truck.no, round)} disabled={busy}
                          className="px-2.5 py-0.5 text-[11px] rounded bg-[#9b9484] hover:bg-[#857e72] text-white disabled:opacity-50">
                          + สร้างรอบวิ่ง
                        </button>
                      )}
                    </div>
                    <div className="p-2">
                      {trip ? (
                        <TripCard
                          trip={trip}
                          branches={branches}
                          onUpdateTrip={handleUpdateTrip}
                          onUpdateStop={handleUpdateStop}
                          onAddStop={handleAddStop}
                          onRemoveStop={handleRemoveStop}
                          onOptimize={handleOptimize}
                          busy={busy}
                        />
                      ) : (
                        <div className="text-[11px] text-gray-300 italic py-1 px-1">ยังไม่มีรอบวิ่ง</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── HistoryTable ──────────────────────────────────────────────────────────────

interface PivotRow {
  week_start: string
  truck_no: number
  branch_id: number
  branch_name: string
  color_group: string | null
  order_count: number
  total_amount: string
}

const COL_GROUP_ORDER = ['orange', 'yellow', 'red']
const BRANCH_COL_COLOR: Record<string, { header: string }> = {
  orange: { header: 'bg-orange-200 text-orange-900' },
  yellow: { header: 'bg-yellow-200 text-yellow-900' },
  red:    { header: 'bg-red-200    text-red-900'    },
}
const DEFAULT_COL_COLOR = { header: 'bg-gray-200 text-gray-700' }
function getColColor(cg: string | null) {
  return BRANCH_COL_COLOR[cg ?? ''] ?? DEFAULT_COL_COLOR
}

function HistoryTable() {
  const [rows,    setRows]    = useState<PivotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [weeks,   setWeeks]   = useState(8)

  useEffect(() => {
    setLoading(true)
    const to   = new Date()
    const from = new Date()
    from.setDate(from.getDate() - weeks * 7)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    fetch(`/api/delivery/trips?pivot=1&from=${fmt(from)}&to=${fmt(to)}`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [weeks])

  // ── build branch columns (sorted by color group) ──────────────────────
  const branchMap = new Map<number, { name: string; color_group: string | null }>()
  for (const r of rows) {
    if (!branchMap.has(r.branch_id))
      branchMap.set(r.branch_id, { name: r.branch_name, color_group: r.color_group })
  }
  const branchCols = [...branchMap.entries()]
    .sort(([, a], [, b]) => {
      const ai = COL_GROUP_ORDER.indexOf(a.color_group ?? '')
      const bi = COL_GROUP_ORDER.indexOf(b.color_group ?? '')
      const ao = ai === -1 ? 99 : ai
      const bo = bi === -1 ? 99 : bi
      return ao !== bo ? ao - bo : a.name.localeCompare(b.name, 'th')
    })
    .map(([id, info]) => ({ id, ...info }))

  // group cols by color for colspan header
  const colorGroups: { key: string; branches: typeof branchCols }[] = []
  for (const cg of COL_GROUP_ORDER) {
    const bs = branchCols.filter(b => b.color_group === cg)
    if (bs.length) colorGroups.push({ key: cg, branches: bs })
  }
  const others = branchCols.filter(b => !COL_GROUP_ORDER.includes(b.color_group ?? ''))
  if (others.length) colorGroups.push({ key: 'other', branches: others })

  // ── unique weeks (desc) ───────────────────────────────────────────────
  const weekSet = [...new Set(rows.map(r => r.week_start))].sort((a, b) => b.localeCompare(a))

  // ── helper: sum per week+truck ────────────────────────────────────────
  const getWkTruck = (week: string, truck: number) => {
    const filtered = rows.filter(r => r.week_start === week && r.truck_no === truck)
    return {
      totalOrders: filtered.reduce((s, r) => s + Number(r.order_count), 0),
      totalAmount: filtered.reduce((s, r) => s + parseFloat(r.total_amount), 0),
      byBranch: Object.fromEntries(
        filtered.map(r => [r.branch_id, { orders: Number(r.order_count), amount: parseFloat(r.total_amount) }])
      ) as Record<number, { orders: number; amount: number }>,
    }
  }

  const fmtAmt = (n: number) =>
    n > 0 ? n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) : ''

  return (
    <div className="flex flex-col gap-3">
      {/* controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">แสดงย้อนหลัง</span>
        {[4, 8, 12, 24].map(w => (
          <button key={w} onClick={() => setWeeks(w)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${weeks === w ? 'bg-[#9b9484] text-white border-[#9b9484]' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}>
            {w} สัปดาห์
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">กำลังโหลด...</div>
      ) : !weekSet.length ? (
        <div className="text-gray-400 text-sm py-12 text-center">ยังไม่มีข้อมูลประวัติการวิ่ง</div>
      ) : (
        <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-auto">
              <thead>
                {/* row 1 — group headers */}
                <tr className="bg-[#9b9484] text-white">
                  <th rowSpan={2} className="px-3 py-2 border-r border-gray-500 whitespace-nowrap align-bottom text-left">สัปดาห์</th>
                  <th rowSpan={2} className="px-2 py-2 border-r border-gray-500 whitespace-nowrap align-bottom text-center">รถ</th>
                  <th rowSpan={2} className="px-2 py-2 border-r border-gray-500 whitespace-nowrap align-bottom text-center">ใบจอง</th>
                  <th rowSpan={2} className="px-2 py-2 border-r border-gray-500 whitespace-nowrap align-bottom text-center">มูลค่า (฿)</th>
                  {colorGroups.map(cg => (
                    <th key={cg.key} colSpan={cg.branches.length}
                      className={`px-2 py-1.5 border-r border-gray-500 text-center font-bold text-[11px] ${getColColor(cg.key === 'other' ? null : cg.key).header}`}>
                      {cg.key === 'orange' ? '🟠 ส้ม' : cg.key === 'yellow' ? '🟡 เหลือง' : cg.key === 'red' ? '🔴 แดง' : '—'}
                    </th>
                  ))}
                </tr>
                {/* row 2 — branch names */}
                <tr className="bg-gray-50">
                  {branchCols.map((b, i) => (
                    <th key={b.id}
                      className={`px-2 py-1 ${i < branchCols.length - 1 ? 'border-r' : ''} border-gray-200 text-center whitespace-nowrap font-semibold text-[10px] ${getColColor(b.color_group).header}`}>
                      {b.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekSet.map((week, wi) => {
                  const t1 = getWkTruck(week, 1)
                  const t2 = getWkTruck(week, 2)
                  const total = {
                    totalOrders: t1.totalOrders + t2.totalOrders,
                    totalAmount: t1.totalAmount + t2.totalAmount,
                    byBranch: Object.fromEntries(
                      branchCols.map(bc => {
                        const a = t1.byBranch[bc.id] ?? { orders: 0, amount: 0 }
                        const b = t2.byBranch[bc.id] ?? { orders: 0, amount: 0 }
                        return [bc.id, { orders: a.orders + b.orders, amount: a.amount + b.amount }]
                      })
                    ) as Record<number, { orders: number; amount: number }>,
                  }

                  return (
                    <Fragment key={week}>
                      {[{ truck: TRUCKS[0], data: t1 }, { truck: TRUCKS[1], data: t2 }].map(({ truck, data }, ti) => (
                        <tr key={truck.no}
                          className={`hover:bg-gray-50/50 ${ti === 0 ? (wi === 0 ? 'border-t-2 border-gray-400' : 'border-t-2 border-gray-300') : 'border-t border-gray-100'}`}>
                          {ti === 0 && (
                            <td rowSpan={3} className="px-3 py-2 border-r border-gray-200 font-semibold text-gray-600 whitespace-nowrap align-middle text-[11px]">
                              {fmtWeekRange(week)}
                            </td>
                          )}
                          <td className="px-2 py-1.5 border-r border-gray-200 text-center whitespace-nowrap">
                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${truck.badge}`}>
                              {truck.name}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 border-r border-gray-200 text-center font-mono font-bold text-gray-700">
                            {data.totalOrders > 0 ? data.totalOrders : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-2 py-1.5 border-r border-gray-200 text-right font-mono text-gray-600 whitespace-nowrap">
                            {fmtAmt(data.totalAmount) || <span className="text-gray-200">—</span>}
                          </td>
                          {branchCols.map((bc, bci) => {
                            const cell = data.byBranch[bc.id]
                            return (
                              <td key={bc.id}
                                className={`px-1.5 py-1 ${bci < branchCols.length - 1 ? 'border-r' : ''} border-gray-200 text-center`}>
                                {cell?.orders > 0 ? (
                                  <div className="flex flex-col items-center leading-tight">
                                    <span className="text-[12px] font-bold text-gray-700">{cell.orders}</span>
                                    {cell.amount > 0 && <span className="text-[9px] text-gray-400">{fmtAmt(cell.amount)}</span>}
                                  </div>
                                ) : <span className="text-gray-200">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {/* รวม row */}
                      <tr className="bg-orange-50 border-t border-orange-200 font-bold">
                        <td className="px-2 py-1 border-r border-orange-200 text-center text-orange-700 text-[10px] whitespace-nowrap">รวม</td>
                        <td className="px-2 py-1 border-r border-orange-200 text-center font-mono text-orange-800">
                          {total.totalOrders > 0 ? total.totalOrders : <span className="text-orange-200">—</span>}
                        </td>
                        <td className="px-2 py-1 border-r border-orange-200 text-right font-mono text-orange-700 whitespace-nowrap">
                          {fmtAmt(total.totalAmount) || <span className="text-orange-200">—</span>}
                        </td>
                        {branchCols.map((bc, bci) => {
                          const cell = total.byBranch[bc.id]
                          return (
                            <td key={bc.id}
                              className={`px-1.5 py-1 ${bci < branchCols.length - 1 ? 'border-r' : ''} border-orange-200 text-center`}>
                              {cell?.orders > 0 ? (
                                <div className="flex flex-col items-center leading-tight">
                                  <span className="text-[11px] font-bold text-orange-700">{cell.orders}</span>
                                  {cell.amount > 0 && <span className="text-[9px] text-orange-400">{fmtAmt(cell.amount)}</span>}
                                </div>
                              ) : <span className="text-orange-200">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

  const [activeTab, setActiveTab] = useState<'schedule' | 'trips' | 'history'>('trips')

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
  const handleAddSlot = async (weekStart: string, dayOfWeek: number, truckNo: number, round: string, branchId: number) => {
    setBusySched(true)
    const res = await fetch('/api/delivery/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start: weekStart, day_of_week: dayOfWeek, truck_no: truckNo, round, branch_id: branchId }),
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
          📦 สต็อค
        </Link>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌿 สต็อคฝอย
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

      {/* Sub-tab switcher */}
      <div className="bg-white border-b border-gray-200 px-4 flex gap-1 items-center">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${activeTab === 'schedule' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          📅 ตารางคิวรถ
        </button>
        <button
          onClick={() => setActiveTab('trips')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${activeTab === 'trips' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          🚛 รอบวิ่ง
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${activeTab === 'history' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          📊 ประวัติการวิ่ง
        </button>
      </div>

      {/* Main */}
      <main className="p-4 flex flex-col gap-6">

        {activeTab === 'history' && <HistoryTable />}

        {activeTab === 'trips' && <TripDayView branches={branches} />}

        {activeTab === 'schedule' && <>
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
        </>}

      </main>
    </div>
  )
}
