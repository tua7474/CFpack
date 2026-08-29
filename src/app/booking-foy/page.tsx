'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StockItem {
  id: number
  model_name: string
  category: string
  color_code: string
  color_name: string
  stock_qty: string
  warehouse_price: string
  retail_price: string
  show_in_booking: boolean
}

interface ModelGroup {
  name: string
  items: StockItem[]
}

interface CatGroup {
  name: string
  models: ModelGroup[]
}

const CATEGORIES_ORDER = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก']

const CATEGORY_BG: Record<string, string> = {
  '2 มิล':   'bg-[#d4ccc4] text-gray-700',
  '4 มิล':   'bg-[#c4bcac] text-gray-700',
  '1.5 มิล': 'bg-[#C5D6BA] text-gray-700',
  'ฝอยหยัก': 'bg-[#ece4d4] text-gray-700',
}

// ── Layout constants (A4 portrait) ────────────────────────────────────────────
//
// A4 portrait content width = (210 − 2×8)mm × (96/25.4) ≈ 733 px
// 3 columns with 4px gap each → COL_W = (733 − 8) / 3 ≈ 241px
//
const NUM_COLS   = 3
const MCOL_COLOR = 96          // ชื่อสี
const MCOL_PRICE = 48          // ราคา (แบ่งมาจาก MCOL_COLOR เดิม)
const MCOL_QTY   = 42          // จำนวน
const MCOL_TOTAL = 55          // รวม
const COL_W      = MCOL_COLOR + MCOL_PRICE + MCOL_QTY + MCOL_TOTAL  // 241
const COL_GAP    = 4
const TOTAL_W    = NUM_COLS * COL_W + (NUM_COLS - 1) * COL_GAP      // 731

// A4 portrait px dimensions
const A4_W_PX    = 210 * (96 / 25.4)   // ≈ 793.7
const A4_PAD_PX  = 8   * (96 / 25.4)   // ≈ 30.2
const CONTENT_SCALE = Math.min(1, (A4_W_PX - A4_PAD_PX * 2) / TOTAL_W)  // ≈ 1.0

// Print: (210−6)mm available, 3mm padding each side
const PRINT_ZOOM = Math.min(1, Math.round(((204 * 96) / 25.4) / TOTAL_W * 1000) / 1000)  // ≈ 1.0

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt2(n: number) {
  if (!n) return ''
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BookingFoyPage() {
  const router = useRouter()
  const [items, setItems]         = useState<StockItem[]>([])
  const [categoryVis, setCategoryVis] = useState<Record<string, boolean>>({})
  const [modelVis, setModelVis]       = useState<Record<string, boolean>>({})
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [saveMsg, setSaveMsg]     = useState<string | null>(null)
  const [pending, setPending]     = useState<Record<number, number>>({})
  const [cameFromBooking, setCameFromBooking] = useState(false)
  const [editFoyMode, setEditFoyMode]         = useState(false)
  const [editOrderNo, setEditOrderNo]         = useState<string | null>(null)
  const [originalItems, setOriginalItems]     = useState<Record<number, number>>({})
  const [zoom, setZoom]           = useState(1)
  const [sourceType, setSourceType]   = useState<'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล' | ''>('')
  const [vehicleType, setVehicleType] = useState<'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน' | ''>('')
  const [manualTotal, setManualTotal] = useState('')
  const [branchInfo, setBranchInfo]       = useState<{ name: string; phone: string } | null>(null)
  const [isAdmin, setIsAdmin]             = useState(true)
  const [branchColorGroup, setBranchColorGroup] = useState<'orange' | 'yellow' | 'red' | null>(null)

  // ตรวจว่าเปิดจาก booking2 และ/หรือ edit_foy mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromBooking = params.get('from') === 'booking'
    setCameFromBooking(fromBooking)
    const isEditFoy = params.get('edit_foy') === '1'
    const orderNo   = params.get('order_no') ?? null
    setEditOrderNo(orderNo)

    // Pre-populate ถ้ามียอดเดิมใน localStorage (ทั้ง edit mode และ new order ที่จองไปแล้วรอบหนึ่ง)
    try {
      const stored = localStorage.getItem('cf_foy_items')
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, number>
        const hasPrev = Object.values(parsed).some(v => v > 0)
        if (hasPrev) {
          const orig: Record<number, number> = {}
          for (const [k, v] of Object.entries(parsed)) orig[Number(k)] = v
          setOriginalItems(orig)
          setPending(orig)
          // ถ้าเปิดจาก booking2 และมียอดเดิม → ใช้ replace flow เสมอ
          setEditFoyMode(true)
          return
        }
      }
    } catch { /* ignore */ }
    setEditFoyMode(isEditFoy)
  }, [])

  // Scale A4 portrait frame to fit narrow screens
  useEffect(() => {
    const calc = () => setZoom(Math.min(1, window.innerWidth / (A4_W_PX + 32)))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  useEffect(() => {
    try {
      const bs = localStorage.getItem('branch_session')
      if (bs) {
        const s = JSON.parse(bs)
        if (s?.branch_name) setBranchInfo({ name: s.branch_name, phone: s.phone ?? '' })
        setIsAdmin(s?.is_admin !== false)
        // Fetch color group for pricing
        if (s?.branch_id) {
          fetch('/api/branches')
            .then(r => r.json())
            .then((branches: { id: number; color_group: string | null }[]) => {
              const b = branches.find(br => br.id === s.branch_id)
              if (b?.color_group) setBranchColorGroup(b.color_group as 'orange' | 'yellow' | 'red')
            })
            .catch(() => {})
        }
      }
    } catch { /* ignore */ }
    // Load persisted source/vehicle from localStorage (shared with booking2)
    try {
      const st = localStorage.getItem('cf_source_type')
      const vt = localStorage.getItem('cf_vehicle_type')
      if (st) setSourceType(st as 'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล')
      if (vt) setVehicleType(vt as 'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน')
    } catch { /* ignore */ }
  }, [])

  // Persist source/vehicle to localStorage whenever they change
  useEffect(() => { if (sourceType)  try { localStorage.setItem('cf_source_type',  sourceType)  } catch { /* ignore */ } }, [sourceType])
  useEffect(() => { if (vehicleType) try { localStorage.setItem('cf_vehicle_type', vehicleType) } catch { /* ignore */ } }, [vehicleType])

  useEffect(() => {
    fetch('/api/stock')
      .then(r => r.json())
      .then((data: { items: StockItem[]; categoryVis: Record<string, boolean>; modelVis: Record<string, boolean> }) => {
        setItems(data.items)
        setCategoryVis(data.categoryVis)
        setModelVis(data.modelVis)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleQtyChange = useCallback((id: number, val: string) => {
    const qty = parseInt(val, 10) || 0
    setPending(prev =>
      qty > 0
        ? { ...prev, [id]: qty }
        : (() => { const n = { ...prev }; delete n[id]; return n })()
    )
  }, [])

  // ── จอง: call stock API action='book' for each pending item ───────────────

  const handleBook = async () => {
    const entries = Object.entries(pending).filter(([, q]) => q > 0)
    // ใน edit mode อนุญาตให้จองแม้จำนวน = 0 (เพื่อยกเลิก/คืนสต็อคทั้งหมด)
    if (!entries.length && !editFoyMode) return
    setSaving(true)
    setSaveMsg(null)
    try {
      if (editFoyMode) {
        // ── Edit mode: คืนสต็อคเก่าก่อน แล้ว book ใหม่ ─────────────────────
        const oldEntries = Object.entries(originalItems).filter(([, q]) => q > 0)
        if (oldEntries.length > 0) {
          await Promise.all(
            oldEntries.map(([idStr, qty]) =>
              fetch('/api/stock', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: Number(idStr), action: 'add', qty }),
              })
            )
          )
        }
      }

      // Book รายการใหม่ (ถ้ามี)
      if (entries.length > 0) {
        await Promise.all(
          entries.map(([idStr, qty]) =>
            fetch('/api/stock', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: Number(idStr), action: 'book', qty }),
            })
          )
        )
      }

      // คำนวณยอดรวมต่อรุ่น (key = "category|model_name")
      const modelTotals: Record<string, { qty: number; amount: number }> = {}
      const itemQty: Record<number, number> = {}
      for (const [idStr, qty] of entries) {
        const item = items.find(it => it.id === Number(idStr))
        if (!item) continue
        const price = getItemPrice(item)
        const m = `${item.category}|${item.model_name}`
        if (!modelTotals[m]) modelTotals[m] = { qty: 0, amount: 0 }
        modelTotals[m].qty += qty
        modelTotals[m].amount += qty * price
        itemQty[Number(idStr)] = qty
      }

      if (editFoyMode) {
        // REPLACE: บันทึกยอดใหม่ (อาจเป็น {} ถ้าลดเป็น 0 ทั้งหมด)
        localStorage.setItem('cf_foy_result', JSON.stringify(modelTotals))
      } else {
        // รวมกับยอดเดิม (กรณีจองหลายรอบ)
        try {
          const prev = JSON.parse(localStorage.getItem('cf_foy_result') ?? '{}') as typeof modelTotals
          for (const [m, d] of Object.entries(prev)) {
            if (!modelTotals[m]) modelTotals[m] = { qty: 0, amount: 0 }
            modelTotals[m].qty += d.qty
            modelTotals[m].amount += d.amount
          }
        } catch { /* ignore */ }
        localStorage.setItem('cf_foy_result', JSON.stringify(modelTotals))
      }
      // บันทึก item-level quantities (อาจเป็น {} ถ้าลดเป็น 0)
      localStorage.setItem('cf_foy_items', JSON.stringify(itemQty))

      setSaveMsg(entries.length > 0 ? `จองสำเร็จ ${entries.length} รายการ` : 'ยกเลิกกระดาษฝอยสำเร็จ')
      setPending({})

      // ถ้าเปิดจาก booking2 ให้กลับไปหลัง 1 วินาที
      if (cameFromBooking) {
        const dest = editOrderNo ? `/booking2?edit=${editOrderNo}` : '/booking2'
        setTimeout(() => router.push(dest), 800)
      } else {
        setTimeout(() => setSaveMsg(null), 3000)
      }
    } catch {
      setSaveMsg('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setTimeout(() => setSaveMsg(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  // ── Branch price helper ────────────────────────────────────────────────────
  // orange → warehouse_price, yellow → +9%, red → +9%+7%, null → warehouse_price

  const getItemPrice = (item: StockItem): number => {
    const wp = parseFloat(item.warehouse_price) || 0
    if (branchColorGroup === 'yellow') return Math.round(wp * 1.09 * 100) / 100
    if (branchColorGroup === 'red')    return Math.round(wp * 1.09 * 1.07 * 100) / 100
    return wp  // orange or null → warehouse_price
  }

  // Group items: category → model_name, filtered by visibility
  const catMap = new Map<string, Map<string, StockItem[]>>()
  for (const item of items.filter(it => categoryVis[it.category] !== false && modelVis[it.model_name] !== false)) {
    const cat = item.category || '2 มิล'
    if (!catMap.has(cat)) catMap.set(cat, new Map())
    const mm = catMap.get(cat)!
    if (!mm.has(item.model_name)) mm.set(item.model_name, [])
    mm.get(item.model_name)!.push(item)
  }
  const orderedCats = [
    ...CATEGORIES_ORDER.filter(c => catMap.has(c)),
    ...[...catMap.keys()].filter(c => !CATEGORIES_ORDER.includes(c)),
  ]
  const MODEL_ORDER = ['สีอ่อน', 'พิเศษ B', 'พิเศษ A', 'ครีเอท']
  const catGroups: CatGroup[] = orderedCats.map(cat => {
    const mm = catMap.get(cat)!
    const orderedModels = [
      ...MODEL_ORDER.filter(m => mm.has(m)),
      ...[...mm.keys()].filter(m => !MODEL_ORDER.includes(m)),
    ]
    return { name: cat, models: orderedModels.map(name => ({ name, items: mm.get(name)! })) }
  })

  // Grand total (auto-calc from pending)
  let grandTotal = 0
  for (const [idStr, qty] of Object.entries(pending)) {
    const item = items.find(it => it.id === Number(idStr))
    if (item) grandTotal += getItemPrice(item) * qty
  }
  const displayTotal = manualTotal !== '' ? manualTotal : grandTotal.toFixed(2)
  const today = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const pendingCount = Object.values(pending).filter(q => q > 0).length

  // ── Model section renderer ─────────────────────────────────────────────────

  const renderModelSection = (g: ModelGroup, ci: number, mi: number) => {
    return (
    <div key={`c${ci}m${mi}`} className="mb-1.5">
      <table className="border-collapse" style={{ tableLayout: 'fixed', width: COL_W }}>
        <colgroup>
          <col style={{ width: MCOL_COLOR }} />
          <col style={{ width: MCOL_PRICE }} />
          <col style={{ width: MCOL_QTY }} />
          <col style={{ width: MCOL_TOTAL }} />
        </colgroup>
        <thead>
          {/* รุ่น header */}
          <tr className="bg-[#9b9484] text-white">
            <th colSpan={4} className="border border-gray-500 px-1 py-0.5 font-bold overflow-hidden text-[10px] text-left truncate">
              {g.name}
            </th>
          </tr>
          {/* sub-column header */}
          <tr className="bg-[#9b9484] text-white text-[9px]">
            <th className="border border-gray-500 px-1 py-0.5 text-left font-medium">ชื่อสี</th>
            <th className="border border-gray-500 px-1 py-0.5 text-right font-medium">ราคา</th>
            <th className="border border-gray-500 px-1 py-0.5 text-right font-medium">จำนวน</th>
            <th className="border border-gray-500 px-1 py-0.5 text-right font-medium">รวม</th>
          </tr>
        </thead>
        <tbody>
          {g.items.map(item => {
            const price      = getItemPrice(item)
            const qty        = pending[item.id] ?? 0
            const total      = qty * price
            const hasPending = qty > 0
            return (
              <tr key={item.id} className="hover:bg-yellow-50/30 transition-colors">
                {/* ชื่อสี */}
                <td className={`border border-gray-300 px-1 py-px bg-gray-100 overflow-hidden ${hasPending ? 'ring-1 ring-inset ring-yellow-400' : ''}`}>
                  <div className="flex items-start justify-between gap-0.5">
                    <div className="truncate text-[9px] text-gray-500">{item.color_name || item.color_code || '–'}</div>
                    <div className="shrink-0 text-[7px] text-gray-400 leading-tight">{parseInt(item.stock_qty) || 0}</div>
                  </div>
                </td>
                {/* ราคา */}
                <td className="border border-gray-300 px-1 py-px text-right bg-gray-100 text-[9px] text-gray-500">
                  {price > 0 ? fmt2(price) : ''}
                </td>
                {/* จำนวน */}
                <td className={`border border-gray-300 p-0 ${hasPending ? 'bg-yellow-50' : 'bg-white'}`}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    defaultValue={qty || ''}
                    key={`qty-${item.id}`}
                    onChange={e => handleQtyChange(item.id, e.target.value)}
                    className={`w-full px-1 py-px text-[9px] text-right bg-transparent focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-400 ${hasPending ? 'font-semibold' : ''}`}
                  />
                </td>
                {/* รวม */}
                <td className="border border-gray-300 px-1 py-px text-right bg-gray-100 text-[9px] text-gray-500">
                  {total > 0 ? fmt2(total) : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }

          .screen-zoom-wrapper {
            zoom: 1 !important;
            padding: 0 !important;
            display: block !important;
          }

          /* A4 portrait: 210×297mm, 4mm padding */
          .a4-frame {
            width: 210mm !important;
            height: 297mm !important;
            min-height: unset !important;
            padding: 4mm !important;
            margin: 0 !important;
            box-shadow: none !important;
            overflow: hidden !important;
          }

          .a4-content {
            zoom: ${PRINT_ZOOM} !important;
          }

          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="no-print bg-[#9b9484] text-white px-6 py-3 shadow flex items-center gap-4">
        <Link href="/stock" className="text-orange-200 hover:text-white text-sm transition-colors">
          ← สต็อคกระดาษฝอย
        </Link>
        <div>
          <h1 className="text-xl font-bold">ใบจองกระดาษฝอย</h1>
          <p className="text-orange-200 text-xs mt-0.5">A4 แนวตั้ง · 3 คอลัมน์ · {catGroups.reduce((s, c) => s + c.models.length, 0)} รุ่น</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {saveMsg && (
            <span className={`text-sm px-3 py-1 rounded-full text-white ${saveMsg.includes('สำเร็จ') ? 'bg-green-500' : 'bg-red-500'}`}>
              {saveMsg}
            </span>
          )}

          {/* ปุ่มกลับ — เมื่อเปิดจาก booking2 และยังไม่มีรายการ */}
          {cameFromBooking && pendingCount === 0 && !editFoyMode ? (
            <button
              onClick={() => router.push(editOrderNo ? `/booking2?edit=${editOrderNo}` : '/booking2')}
              className="px-4 py-1.5 text-sm rounded font-semibold bg-white/20 hover:bg-white/30 text-white border border-white/30 transition-colors">
              ← กลับใบจองสินค้า
            </button>
          ) : (
            <button
              onClick={handleBook}
              disabled={saving || (pendingCount === 0 && !editFoyMode)}
              className={`px-4 py-1.5 text-sm rounded font-semibold transition-colors disabled:opacity-40 ${
                pendingCount > 0
                  ? 'bg-[#F2E9D3] hover:bg-[#E8DFC9] text-[#2baf2b]'
                  : editFoyMode
                    ? 'bg-red-500 hover:bg-red-400 text-white'
                    : 'bg-white/20 text-white border border-white/30 cursor-not-allowed'
              }`}>
              {saving ? 'กำลังจอง...' : pendingCount > 0 ? `📦 จอง (${pendingCount})` : editFoyMode ? '🗑️ ยกเลิกกระดาษฝอย' : '📦 จอง'}
            </button>
          )}

          {/* ปุ่มพิมพ์ — admin only */}
          {isAdmin && (
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white transition-colors border border-white/30">
              🖨️ พิมพ์
            </button>
          )}
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main>
        <div
          className="screen-zoom-wrapper p-4 flex justify-center"
          style={{ zoom: zoom < 1 ? zoom : undefined }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลดข้อมูล...</div>
          ) : (
            <div
              className="a4-frame bg-white shadow-xl"
              style={{ width: '210mm', minHeight: '297mm', padding: '8mm', boxSizing: 'border-box' }}
            >
              <div
                className="a4-content"
                style={{ zoom: CONTENT_SCALE, transformOrigin: 'top left' }}
              >
                {/* Title */}
                <div className="text-center text-sm font-bold text-gray-500 mb-2 tracking-wide">
                  ใบจองกระดาษฝอย
                </div>

                {/* ── Categories with 3-column model grid per category ── */}
                {catGroups.map(cg => {
                  const perCol = Math.ceil(cg.models.length / NUM_COLS)
                  const cols: ModelGroup[][] = Array.from({ length: NUM_COLS }, (_, ci) =>
                    cg.models.slice(ci * perCol, (ci + 1) * perCol)
                  )
                  const catCls = CATEGORY_BG[cg.name] ?? 'bg-gray-700 text-white'
                  return (
                    <div key={cg.name} className="mb-2">
                      {/* Category header */}
                      <div className={`${catCls} px-2 py-0.5 text-[10px] font-bold tracking-wider rounded-sm mb-1`}
                        style={{ width: TOTAL_W }}>
                        กระดาษฝอย {cg.name}
                      </div>
                      {/* Models in 3 columns */}
                      <div className="flex" style={{ gap: COL_GAP, width: TOTAL_W }}>
                        {cols.map((colGroups, ci) => (
                          <div key={ci} style={{ width: COL_W, flexShrink: 0 }}>
                            {colGroups.map((g, mi) => renderModelSection(g, ci, mi))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}

                {/* ── Info panel ── */}
                <div className="flex gap-1 mt-2" style={{ width: TOTAL_W }}>

                  {/* ผู้ส่ง / ผู้รับ */}
                  <div className="flex-1 border border-gray-400 rounded overflow-hidden">
                    <div className="flex h-14">
                      <div className="flex-1 border-r border-gray-300 p-1">
                        <div className="text-[8px] font-semibold text-gray-500">ผู้ส่งสินค้า</div>
                      </div>
                      <div className="flex-1 p-1">
                        <div className="text-[8px] font-semibold text-gray-500">ผู้รับสินค้า</div>
                      </div>
                    </div>
                  </div>

                  {/* ยอดรวม */}
                  <div
                    className="border border-gray-400 rounded p-1 bg-green-50 flex flex-col justify-center"
                    style={{ width: 130 }}
                  >
                    <div className="text-[8px] font-semibold text-gray-500">ยอดเงินรวม (฿)</div>
                    <input
                      type="number"
                      step="0.01"
                      max="999999.99"
                      value={displayTotal}
                      onChange={e => setManualTotal(e.target.value)}
                      className="w-full text-xl font-bold text-green-400 text-right bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-400 rounded"
                    />
                  </div>

                  {/* วันที่ */}
                  <div
                    className="border border-gray-400 rounded p-1 bg-gray-50 flex flex-col items-center justify-center"
                    style={{ width: 84 }}
                  >
                    <div className="text-[7px] text-gray-400 leading-none">วันที่</div>
                    <div className="text-[12px] font-extrabold text-gray-500 leading-tight text-center">{today}</div>
                  </div>

                  {/* เบิกของ */}
                  <div
                    className={`border border-gray-400 rounded p-1 flex flex-col justify-center ${sourceType === '' ? 'bg-red-50' : 'bg-white'}`}
                    style={{ width: 80 }}
                  >
                    <div className="text-[7px] font-semibold text-gray-500 leading-none mb-0.5">เบิกของ</div>
                    <select
                      value={sourceType}
                      onChange={e => {
                        const val = e.target.value as 'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล'
                        setSourceType(val)
                        if ((val === 'โรงกล่อง' || val === 'โรงบับเบิล') && vehicleType !== 'รับเอง' && vehicleType !== 'รถโรงงาน') setVehicleType('')
                      }}
                      className={`w-full border-2 rounded font-bold text-[10px] px-0.5 bg-white focus:outline-none ${sourceType === '' ? 'border-red-400 text-red-500' : 'border-gray-400 text-gray-500'}`}
                    >
                      <option value="" disabled>— เลือก —</option>
                      <option value="โกดัง">โกดัง</option>
                      <option value="หน้าร้าน">หน้าร้าน</option>
                      <option value="โรงกล่อง">โรงกล่อง</option>
                      <option value="โรงบับเบิล">โรงบับเบิล</option>
                    </select>
                    {sourceType === '' && <div className="text-[7px] text-red-500 leading-none mt-0.5">กรุณาเลือก</div>}
                  </div>

                  {/* สาขา */}
                  <div
                    className="border border-gray-400 rounded p-1 bg-gray-50 flex flex-col justify-center overflow-hidden"
                    style={{ width: 100 }}
                  >
                    {branchInfo ? (
                      <>
                        <div className="text-[7px] text-gray-400 leading-none">สาขา/ตัวแทน</div>
                        <div className="text-[13px] font-extrabold text-gray-500 leading-tight truncate">{branchInfo.name}</div>
                        <div className="text-[8px] text-gray-500 truncate">{branchInfo.phone}</div>
                      </>
                    ) : (
                      <div className="text-[8px] text-gray-400 italic">ยังไม่ได้เข้าสู่ระบบ</div>
                    )}
                  </div>

                  {/* รถ */}
                  <div
                    className={`border border-gray-400 rounded p-1 flex flex-col justify-center ${vehicleType === '' ? 'bg-red-50' : 'bg-white'}`}
                    style={{ width: 90 }}
                  >
                    <div className="text-[7px] font-semibold text-gray-500 leading-none mb-0.5">รถ</div>
                    <select
                      value={vehicleType}
                      onChange={e => setVehicleType(e.target.value as 'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน')}
                      className={`w-full border-2 rounded font-bold text-[10px] px-0.5 bg-white focus:outline-none ${vehicleType === '' ? 'border-red-400 text-red-500' : 'border-gray-400 text-gray-500'}`}
                    >
                      <option value="" disabled>— เลือก —</option>
                      {(sourceType === 'โรงกล่อง' || sourceType === 'โรงบับเบิล') ? (
                        <>
                          <option value="รถโรงงาน">รถโรงงาน</option>
                          <option value="รับเอง">รับเอง</option>
                        </>
                      ) : (
                        <>
                          <option value="จองรถ60000">เต็มคัน 25k</option>
                          <option value="รอพ่วง">รอพ่วง</option>
                          <option value="รับเอง">รับเอง</option>
                        </>
                      )}
                    </select>
                    {vehicleType === '' && <div className="text-[7px] text-red-500 leading-none mt-0.5">กรุณาเลือก</div>}
                  </div>

                </div>
                {/* ── end info panel ── */}

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
