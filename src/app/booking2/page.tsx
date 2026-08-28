'use client'

import { Fragment, useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id: number
  group_name: string
  product_name: string
  price: string | null
  stock_qty: string | null
  section_order: number
  section_name: string
  is_vat_included: boolean
  subgroup_order: number
  subgroup_name: string
}

type SubgroupColor = 'gray' | 'light' | 'orange' | 'teal' | 'maroon'

type SectionRow =
  | { type: 'subgroup'; name: string; color: SubgroupColor }
  | { type: 'product'; product: CatalogProduct }
  | { type: 'foy_cat'; category: string }
  | { type: 'foy_item'; category: string; model_name: string; qty: number; amount: number }

interface Section {
  order: number
  name: string
  is_vat_included: boolean
  rows: SectionRow[]
}

// ── Sub-group colors ──────────────────────────────────────────────────────────
// key = "section_order-subgroup_order"

const SUBGROUP_COLOR: Record<string, SubgroupColor> = {
  // S2 ซองน้ำตาล
  '2-1': 'gray',   '2-2': 'light',  '2-3': 'gray',   '2-4': 'gray',
  '2-5': 'orange', '2-6': 'gray',   '2-7': 'orange', '2-8': 'orange',
  '2-9': 'gray',   '2-10': 'gray',
  // S3 ซอง PP
  '3-1': 'gray',   '3-2': 'gray',   '3-3': 'gray',   '3-4': 'gray',
  '3-5': 'light',  '3-6': 'light',  '3-7': 'teal',   '3-8': 'orange',
  // S4 บับเบิล
  '4-1': 'light',  '4-2': 'light',  '4-2.5': 'light', '4-3': 'gray',   '4-4': 'light',
  '4-5': 'gray',   '4-6': 'gray',   '4-7': 'orange', '4-8': 'orange',
  '4-9': 'orange', '4-10': 'orange','4-11': 'orange', '4-12': 'orange',
  '4-13': 'light', '4-14': 'light', '4-15': 'gray',  '4-16': 'gray',
  '4-17': 'light', '4-18': 'teal',
  // S5 กล่อง Thank You
  '5-1': 'light',  '5-2': 'gray',   '5-3': 'gray',   '5-4': 'gray',
  '5-5': 'orange', '5-6': 'orange',
  // S6 ซองกันกระแทก
  '6-1': 'gray',   '6-2': 'orange', '6-3': 'orange', '6-4': 'gray',
  '6-5': 'gray',   '6-6': 'orange', '6-7': 'orange', '6-8': 'orange',
}

const SUBGROUP_BG: Record<SubgroupColor, string> = {
  gray:   'bg-[#9b9484]   text-white    border-gray-500',
  light:  'bg-gray-300   text-gray-500 border-gray-400',
  orange: 'bg-orange-400 text-white    border-orange-400',
  teal:   'bg-teal-500   text-white    border-teal-600',
  maroon: 'bg-red-800    text-white    border-red-900',
}

// ── กระดาษฝอย groups — link to /booking-foy ──────────────────────────────────
// ทุก model จาก paper_stock จะมี group_name='กระดาษฝอย' และ subgroup_name='กระดาษฝอย'
const FOY_SUBGROUP_NAMES = new Set(['กระดาษฝอย'])
const FOY_GROUP_NAMES    = new Set(['กระดาษฝอย'])

const FOY_CATS_ORDER = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก']
const FOY_CAT_BG: Record<string, string> = {
  '2 มิล':   'bg-[#d4ccc4] text-gray-700',
  '4 มิล':   'bg-[#c4bcac] text-gray-700',
  '1.5 มิล': 'bg-[#C5D6BA] text-gray-700',
  'ฝอยหยัก': 'bg-[#ece4d4] text-gray-700',
}

// ── Column widths ─────────────────────────────────────────────────────────────

const COL_NAME  = 82
const COL_PRICE = 54
const COL_QTY   = 44
const COL_TOTAL = 62
const ROW_NUM_W = 24
const TABLE_W        = ROW_NUM_W + 6 * (COL_NAME + COL_PRICE + COL_QTY + COL_TOTAL)
const INFO_PANEL_ROWS = 11  // 3 sig + 2 total + 3 date/source + 3 branch/vehicle

// ── A4 landscape dimensions ───────────────────────────────────────────────────
// 1 CSS mm = 96/25.4 px (CSS reference pixel)
const A4_W_PX       = 297 * (96 / 25.4)          // ≈ 1122.5 CSS px
const A4_PAD_PX     = 8   * (96 / 25.4)          // 8 mm padding each side ≈ 30.2 px
const CONTENT_SCALE = (A4_W_PX - A4_PAD_PX * 2) / TABLE_W  // ≈ 0.72

// ── Draft helpers ─────────────────────────────────────────────────────────────

const DRAFT_KEY = 'cf_draft_booking2'

function loadDraft(): Record<number, number> {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} }
}
function saveDraft(e: Record<number, number>) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(e))
}

// ── Build sections (insert subgroup headers) ──────────────────────────────────

function buildSections(products: CatalogProduct[]): Section[] {
  const map = new Map<number, Section>()
  for (const p of products) {
    if (!map.has(p.section_order)) {
      map.set(p.section_order, {
        order: p.section_order,
        name: p.section_name,
        is_vat_included: p.is_vat_included,
        rows: [],
      })
    }
    const sec = map.get(p.section_order)!
    if (p.subgroup_order > 0) {
      const prev = [...sec.rows].reverse().find(r => r.type === 'subgroup') as { type: 'subgroup'; name: string; color: SubgroupColor } | undefined
      if (!prev || prev.name !== p.subgroup_name) {
        const key = `${p.section_order}-${p.subgroup_order}`
        sec.rows.push({ type: 'subgroup', name: p.subgroup_name, color: SUBGROUP_COLOR[key] ?? 'gray' })
      }
    }
    sec.rows.push({ type: 'product', product: p })
  }
  return Array.from(map.values()).sort((a, b) => a.order - b.order)
}

// ── Inject dynamic FOY rows (category-separated) ──────────────────────────────
// Replaces catalog กระดาษฝอย product rows with foy_cat/foy_item rows derived
// from foyPending (keys = "category|model_name").

function injectFoyRows(
  sections: Section[],
  foyPending: Record<string, { qty: number; amount: number }>
): Section[] {
  // Group foyPending by category
  const byCat = new Map<string, { model: string; qty: number; amount: number }[]>()
  for (const [key, data] of Object.entries(foyPending)) {
    if (data.qty <= 0) continue
    const idx = key.indexOf('|')
    if (idx === -1) continue  // legacy key — skip
    const cat   = key.slice(0, idx)
    const model = key.slice(idx + 1)
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push({ model, qty: data.qty, amount: data.amount })
  }

  return sections.map(sec => {
    const hasFoy = sec.rows.some(r => r.type === 'product' && FOY_GROUP_NAMES.has(r.product.group_name))
    if (!hasFoy) return sec

    const newRows: SectionRow[] = []
    let foyInjected = false
    for (const row of sec.rows) {
      if (row.type === 'product' && FOY_GROUP_NAMES.has(row.product.group_name)) {
        if (!foyInjected) {
          foyInjected = true
          if (byCat.size > 0) {
            for (const cat of FOY_CATS_ORDER) {
              const its = byCat.get(cat)
              if (!its?.length) continue
              newRows.push({ type: 'foy_cat', category: cat })
              for (const it of its) {
                newRows.push({ type: 'foy_item', category: cat, model_name: it.model, qty: it.qty, amount: it.amount })
              }
            }
          }
        }
        continue  // always skip original catalog FOY rows
      }
      newRows.push(row)
    }
    return { ...sec, rows: newRows }
  })
}

const BUBBLE_GROUPS_SET = new Set(['บับเบิล', 'บับเบิลสี', 'บับเบิลบาง 35g'])

function getBubbleUnits(product_name: string): number {
  const w = parseFloat(product_name)
  if (w === 32.5) return 1
  if (w === 65)   return 2
  if (w === 130)  return 4
  return 0
}

function fmt2(n: number) {
  if (!n) return ''
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Main Component ────────────────────────────────────────────────────────────

function Booking2Inner() {
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const editOrderNo    = searchParams.get('edit')         // null = new order, string = edit mode
  const branchIdParam  = searchParams.get('branch_id')    // from LINE group auto-detect
  const branchNameParam = searchParams.get('branch_name') // from LINE group auto-detect

  const [products, setProducts]     = useState<CatalogProduct[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [saveMsg, setSaveMsg]       = useState<string | null>(null)
  const [resetKey, setResetKey]     = useState(0)
  const [pending, setPending]       = useState<Record<number, number>>({})
  const [foyPending, setFoyPending]         = useState<Record<string, { qty: number; amount: number }>>({})
  const [foyItemPending, setFoyItemPending] = useState<Record<number, number>>({})
  const [sourceType, setSourceType]   = useState<'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล' | ''>('')
  const [vehicleType, setVehicleType] = useState<'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน' | ''>('')
  const [manualTotal, setManualTotal] = useState<string>('')
  const [branchInfo, setBranchInfo] = useState<{ name: string; phone: string } | null>(null)
  const [isAdmin, setIsAdmin]       = useState(true)   // false = non-admin branch (LINE group)
  const [branchReady, setBranchReady] = useState<boolean | null>(null) // null=loading, false=ไม่มีสาขา, true=เข้าได้

  // Load foy result from booking-foy (new order mode only)
  useEffect(() => {
    if (editOrderNo) return
    try {
      const stored = localStorage.getItem('cf_foy_result')
      if (stored) setFoyPending(JSON.parse(stored))
      const storedItems = localStorage.getItem('cf_foy_items')
      if (storedItems) setFoyItemPending(JSON.parse(storedItems))
    } catch { /* ignore */ }
  }, [editOrderNo])

  // Load draft / branch session on mount
  // URL params (from LINE group auto-detect) take priority over localStorage
  useEffect(() => {
    if (!editOrderNo) setPending(loadDraft())
    if (branchNameParam) {
      // มาจาก LINE group → ระบุสาขาได้, non-admin
      setBranchInfo({ name: branchNameParam, phone: '' })
      setIsAdmin(false)
      setBranchReady(true)
      if (branchIdParam) {
        try {
          localStorage.setItem('branch_session', JSON.stringify({
            branch_id: Number(branchIdParam),
            branch_name: branchNameParam,
            phone: '',
            is_admin: false,
          }))
        } catch { /* ignore */ }
      }
    } else {
      try {
        const bs = localStorage.getItem('branch_session')
        if (bs) {
          const s = JSON.parse(bs)
          if (s?.branch_name) {
            setBranchInfo({ name: s.branch_name, phone: s.phone ?? '' })
            setIsAdmin(s?.is_admin !== false)
            setBranchReady(true)
          } else {
            setBranchReady(false)
          }
        } else {
          setBranchReady(false)
        }
      } catch {
        setBranchReady(false)
      }
    }
  }, [editOrderNo, branchIdParam, branchNameParam])

  // When editing — load existing order quantities + FOY data + selections
  useEffect(() => {
    if (!editOrderNo) return
    fetch(`/api/orders?no=${editOrderNo}`)
      .then(r => r.json())
      .then((order: {
        quantities: Record<string, number>;
        total_amount: string;
        source_type: string | null;
        vehicle_type: string | null;
        foy_quantities?: Record<string, { qty: number; amount: number }>;
        foy_item_quantities?: Record<string, number>;
      } | null) => {
        if (!order) return
        const qty: Record<number, number> = {}
        for (const [k, v] of Object.entries(order.quantities)) qty[Number(k)] = v
        setPending(qty)
        // Restore FOY data — prefer localStorage (set by booking-foy after edit) over DB value
        const freshFoyResult = localStorage.getItem('cf_foy_result')
        const freshFoyItems  = localStorage.getItem('cf_foy_items')
        if (freshFoyResult) {
          try { setFoyPending(JSON.parse(freshFoyResult)) } catch { /* ignore */ }
        } else if (order.foy_quantities && Object.keys(order.foy_quantities).length > 0) {
          setFoyPending(order.foy_quantities)
        }
        if (freshFoyItems) {
          try {
            const itemQty: Record<number, number> = {}
            for (const [k, v] of Object.entries(JSON.parse(freshFoyItems) as Record<string, number>)) itemQty[Number(k)] = v
            setFoyItemPending(itemQty)
          } catch { /* ignore */ }
        } else if (order.foy_item_quantities && Object.keys(order.foy_item_quantities).length > 0) {
          const itemQty: Record<number, number> = {}
          for (const [k, v] of Object.entries(order.foy_item_quantities)) itemQty[Number(k)] = v
          setFoyItemPending(itemQty)
          // Save to localStorage so booking-foy can read when editing
          localStorage.setItem('cf_foy_items', JSON.stringify(order.foy_item_quantities))
        }
        if (order.source_type) setSourceType(order.source_type as 'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล')
        if (order.vehicle_type) setVehicleType(order.vehicle_type as 'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน')
      })
      .catch(() => {})
  }, [editOrderNo])

  // Fetch products
  useEffect(() => {
    fetch('/api/booking2')
      .then(r => r.json())
      .then((data: CatalogProduct[]) => { setProducts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Load persisted source/vehicle from localStorage (new order only; edit mode uses order values)
  useEffect(() => {
    if (editOrderNo) return
    try {
      const st = localStorage.getItem('cf_source_type')
      const vt = localStorage.getItem('cf_vehicle_type')
      if (st) setSourceType(st as 'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล')
      if (vt) setVehicleType(vt as 'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน')
    } catch { /* ignore */ }
  }, [editOrderNo])

  // Persist source/vehicle to localStorage whenever they change
  useEffect(() => { if (sourceType)  try { localStorage.setItem('cf_source_type',  sourceType)  } catch { /* ignore */ } }, [sourceType])
  useEffect(() => { if (vehicleType) try { localStorage.setItem('cf_vehicle_type', vehicleType) } catch { /* ignore */ } }, [vehicleType])

  // Auto-reset vehicle if total drops below 25,000
  useEffect(() => {
    if (vehicleType !== 'จองรถ60000') return
    let total = 0
    if (manualTotal !== '') {
      total = parseFloat(manualTotal) || 0
    } else {
      for (const [idStr, qty] of Object.entries(pending)) {
        const p = products.find(p => p.id === Number(idStr))
        if (!p || qty <= 0) continue
        total += (parseFloat(p.price ?? '0') || 0) * qty
      }
    }
    if (total < 25000) setVehicleType('')
  }, [pending, manualTotal, vehicleType, products])

  // Auto-force เบิกของ + รถ ตามเงื่อนไขยอด
  useEffect(() => {
    if (!products.length) return
    const BOX_GROUPS = new Set(['กล่อง', 'กล่อง Thank You', 'กล่องผลไม้ 5 ชั้น', 'กล่อง 5 ชั้น'])
    let bt = 0, otherTotal = 0
    let hasOther = false
    for (const p of products) {
      const qty = pending[p.id] ?? 0
      const price = parseFloat(p.price ?? '0') || 0
      const val = qty * price
      if (BOX_GROUPS.has(p.group_name)) bt += val
      else { otherTotal += val; if (qty > 0) hasOther = true }
    }
    const foyAmt = Object.values(foyPending).reduce((s, d) => s + d.amount, 0)
    if (foyAmt > 0) hasOther = true
    const total = bt + otherTotal + foyAmt

    // ตรวจบับเบิลล้วน
    let bubbleUnits = 0, hasBubble = false, hasNonBubble = false
    for (const p of products) {
      const qty = pending[p.id] ?? 0
      if (BUBBLE_GROUPS_SET.has(p.group_name)) {
        bubbleUnits += qty * getBubbleUnits(p.product_name)
        if (qty > 0) hasBubble = true
      } else if (qty > 0) hasNonBubble = true
    }
    if (foyAmt > 0) hasNonBubble = true

    if (hasBubble && !hasNonBubble && bubbleUnits >= 120 && bubbleUnits <= 128) {
      setSourceType('โรงบับเบิล')
      setVehicleType('รถโรงงาน')
    } else if (hasOther && total >= 25000) {
      setSourceType('โกดัง')
      setVehicleType('จองรถ60000')
    } else if (!hasOther && bt >= 20000) {
      setSourceType('โรงกล่อง')
      setVehicleType('รถโรงงาน')
    } else if (hasOther) {
      // มิกซ์ แต่ยอด < 25,000 — reset ตัวเลือกที่ไม่รองรับในโหมดมิกซ์
      if (sourceType === 'โรงกล่อง' || sourceType === 'โรงบับเบิล') setSourceType('')
      if (vehicleType === 'จองรถ60000' || vehicleType === 'รถโรงงาน') setVehicleType('')
    }
  }, [pending, foyPending, products, sourceType, vehicleType])

  const handleQtyChange = useCallback((id: number, val: string) => {
    const qty = parseInt(val, 10) || 0
    setPending(prev => {
      const next = qty > 0 ? { ...prev, [id]: qty } : (() => { const n = { ...prev }; delete n[id]; return n })()
      if (!editOrderNo) saveDraft(next)
      return next
    })
  }, [editOrderNo])

  const pendingCount = Object.values(pending).filter(q => q > 0).length
  const hasFoyPending = Object.keys(foyPending).length > 0

  const handleSave = async () => {
    if (!pendingCount && !hasFoyPending && !editOrderNo) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const productMap = new Map(products.map(p => [p.id, p]))
      const quantities: Record<number, number> = {}
      let computedTotal = 0
      for (const [idStr, qty] of Object.entries(pending)) {
        const id = Number(idStr)
        const p = productMap.get(id)
        if (!p || qty <= 0) continue
        quantities[id] = qty
        const price = parseFloat(p.price ?? '0') || 0
        computedTotal += price * qty
      }
      // รวมยอด FOY เข้าใน total ที่บันทึก
      const foyTotalAmt = Object.values(foyPending).reduce((s, d) => s + d.amount, 0)
      const computedWithFoy = computedTotal + foyTotalAmt
      const totalToSave = manualTotal !== '' ? (parseFloat(manualTotal) || computedWithFoy) : computedWithFoy

      if (editOrderNo) {
        // ── Edit existing order ───────────────────────────────────────────────
        const res = await fetch('/api/orders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_no: editOrderNo, total_amount: totalToSave, quantities,
            source_type: sourceType || null, vehicle_type: vehicleType || null, branch_name: branchInfo?.name ?? null,
            foy_quantities: foyPending, foy_item_quantities: foyItemPending,
          }),
        })
        if (!res.ok) throw new Error()
        setPending({})
        setFoyPending({})
        setFoyItemPending({})
        setResetKey(k => k + 1)
        localStorage.removeItem('cf_foy_result')
        localStorage.removeItem('cf_foy_items')
        setSaveMsg(`อัพเดทใบจอง ${editOrderNo} สำเร็จ`)
      } else {
        // ── Create new order ──────────────────────────────────────────────────
        let branchId: number | null = null
        try {
          const bs = localStorage.getItem('branch_session')
          if (bs) branchId = JSON.parse(bs)?.branch_id ?? null
        } catch { /* ignore */ }
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            total_amount: totalToSave, quantities, branch_id: branchId,
            source_type: sourceType || null, vehicle_type: vehicleType || null, branch_name: branchInfo?.name ?? null,
            foy_quantities: foyPending, foy_item_quantities: foyItemPending,
          }),
        })
        if (!res.ok) throw new Error()
        setPending({})
        setFoyPending({})
        setFoyItemPending({})
        setResetKey(k => k + 1)
        localStorage.removeItem(DRAFT_KEY)
        localStorage.removeItem('cf_foy_result')
        localStorage.removeItem('cf_foy_items')
        const totalItems = pendingCount + Object.keys(foyPending).length
        setSaveMsg(`บันทึกสำเร็จ ${totalItems} รายการ`)
      }
    } catch {
      setSaveMsg('เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  // ── Cancel order ──────────────────────────────────────────────────────────

  const handleCancelOrder = async () => {
    if (!editOrderNo) return
    if (!confirm(`ยืนยันยกเลิกใบจอง ${editOrderNo} ?`)) return
    setSaving(true)
    setSaveMsg(null)
    try {
      // คืนสต็อค FOY ถ้ายังมี (กรณีที่ยังไม่ได้ล้างผ่านหน้า booking-foy)
      const foyItemEntries = Object.entries(foyItemPending).filter(([, q]) => q > 0)
      if (foyItemEntries.length > 0) {
        await Promise.all(
          foyItemEntries.map(([idStr, qty]) =>
            fetch('/api/stock', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: Number(idStr), action: 'add', qty }),
            })
          )
        )
      }
      // อัพเดทสถานะเป็น cancelled + quantities={} เพื่อคืนสต็อคสินค้าปกติ
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_no: editOrderNo,
          status: 'cancelled',
          quantities: {},
          foy_quantities: {},
          foy_item_quantities: {},
        }),
      })
      if (!res.ok) throw new Error()
      localStorage.removeItem('cf_foy_result')
      localStorage.removeItem('cf_foy_items')
      setSaveMsg(`ยกเลิกใบจอง ${editOrderNo} สำเร็จ`)
      setTimeout(() => { window.location.href = '/orders' }, 1500)
    } catch {
      setSaveMsg('เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const sections    = injectFoyRows(buildSections(products), foyPending)
  const lastSec     = sections[sections.length - 1]
  const lastSecRows = lastSec?.rows.length ?? 0
  const maxRows     = sections.length
    ? Math.max(...sections.map(s => s.rows.length), lastSecRows + INFO_PANEL_ROWS)
    : 0
  const panelStart  = Math.max(lastSecRows, maxRows - INFO_PANEL_ROWS)

  let grayTotal = 0, orangeTotal = 0
  const sectionTotals  = new Map<number, number>()
  const subgroupTotals = new Map<string, number>()   // key = `${sec.order}-${subgroup.name}`
  for (const sec of sections) {
    let secTotal = 0
    let currentSubgroup: string | null = null
    for (const row of sec.rows) {
      if (row.type === 'subgroup') {
        currentSubgroup = row.name
      } else if (row.type === 'foy_cat') {
        // category header — no value
      } else if (row.type === 'foy_item') {
        // FOY amount tracked separately in foyTotal; add to subgroupTotals for display
        if (currentSubgroup !== null) {
          const sgKey = `${sec.order}-${currentSubgroup}`
          subgroupTotals.set(sgKey, (subgroupTotals.get(sgKey) ?? 0) + row.amount)
        }
        secTotal += row.amount
      } else {
        const qty   = pending[row.product.id] ?? 0
        const price = parseFloat(row.product.price ?? '0') || 0
        const val   = price * qty
        if (sec.is_vat_included) grayTotal += val
        else orangeTotal += val
        secTotal += val
        if (currentSubgroup !== null) {
          const sgKey = `${sec.order}-${currentSubgroup}`
          subgroupTotals.set(sgKey, (subgroupTotals.get(sgKey) ?? 0) + val)
        }
      }
    }
    sectionTotals.set(sec.order, secTotal)
  }
  const foyTotal = Object.values(foyPending).reduce((s, d) => s + d.amount, 0)
  const effectiveTotal  = manualTotal !== '' ? (parseFloat(manualTotal) || 0) : (grayTotal + orangeTotal + foyTotal)
  const cannotBook25k   = vehicleType === 'จองรถ60000' && effectiveTotal < 25000

  const BOX_GROUPS_RENDER = new Set(['กล่อง', 'กล่อง Thank You', 'กล่องผลไม้ 5 ชั้น', 'กล่อง 5 ชั้น'])
  let boxTotal = 0, hasNonBoxItems = false
  for (const sec of sections) {
    for (const row of sec.rows) {
      if (row.type !== 'product') continue
      const qty = pending[row.product.id] ?? 0
      const price = parseFloat(row.product.price ?? '0') || 0
      if (BOX_GROUPS_RENDER.has(row.product.group_name)) boxTotal += qty * price
      else if (qty > 0) hasNonBoxItems = true
    }
  }
  if (Object.values(foyPending).some(d => d.amount > 0)) hasNonBoxItems = true
  const hasMixItems        = hasNonBoxItems  // มีสินค้ามิกซ์ (ไม่ใช่กล่องล้วน)
  const autoForceFactory   = !hasNonBoxItems && boxTotal >= 20000
  const autoForceWarehouse = hasNonBoxItems && (grayTotal + orangeTotal + foyTotal) >= 25000

  // ── Bubble unit validation ─────────────────────────────────────────────────
  let totalBubbleUnits = 0, hasBubbleItems = false, hasNonBubbleInOrder = false
  for (const sec of sections) {
    for (const row of sec.rows) {
      if (row.type !== 'product') continue
      const qty = pending[row.product.id] ?? 0
      if (BUBBLE_GROUPS_SET.has(row.product.group_name)) {
        totalBubbleUnits += qty * getBubbleUnits(row.product.product_name)
        if (qty > 0) hasBubbleItems = true
      } else if (qty > 0) {
        hasNonBubbleInOrder = true
      }
    }
  }
  if (foyTotal > 0) hasNonBubbleInOrder = true

  const autoForceBubble = hasBubbleItems && !hasNonBubbleInOrder && totalBubbleUnits >= 120 && totalBubbleUnits <= 128
  const isAutoForced    = autoForceFactory || autoForceWarehouse || autoForceBubble

  let bubbleWarning: string | null = null
  let bubbleBlocking = false
  if (hasBubbleItems) {
    if (hasNonBubbleInOrder) {
      if (totalBubbleUnits > 20) {
        const over = totalBubbleUnits - 20
        bubbleBlocking = true
        bubbleWarning = `⛔ บับเบิลเกิน (ลด ${over} ลูก 32.5)`
      }
    } else {
      if (totalBubbleUnits < 120) {
        const need = 120 - totalBubbleUnits
        bubbleBlocking = true
        bubbleWarning = `⛔ เทียบเท่า 32.5x100 ขาด ${need} ลูก`
      } else if (totalBubbleUnits > 128) {
        const over = totalBubbleUnits - 128
        bubbleBlocking = true
        bubbleWarning = `⛔ เทียบเท่า 32.5x100 เกิน ${over} ลูก`
      }
    }
  }

  const today = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })

  // Scale A4 landscape frame to fit narrow screens (same pattern as booking-foy)
  const [viewScale, setViewScale] = useState(1)
  useEffect(() => {
    const calc = () => setViewScale(Math.min(1, (window.innerWidth - 16) / A4_W_PX))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          html, body {
            margin: 0 !important; padding: 0 !important;
            height: 210mm !important; max-height: 210mm !important;
            overflow: hidden !important;
          }
          .no-print   { display: none !important; }

          /* Remove screen-only zoom on outer wrapper */
          .screen-zoom-wrapper {
            zoom: 1 !important;
            padding: 0 !important;
            display: block !important;
          }

          /* A4 frame fills exactly one page */
          .a4-frame {
            width: 297mm !important;
            height: 210mm !important;
            min-height: unset !important;
            padding: 1mm !important;
            margin: 0 !important;
            box-shadow: none !important;
            overflow: hidden !important;
          }

          /* Scale content to fill A4 width at 1mm padding:
             (297-2)mm × (96/25.4) ÷ 1476px ≈ 0.756
             Unscaled height to fill A4: (210-2)mm × (96/25.4) ÷ 0.756 ≈ 1044px */
          .a4-content {
            zoom: 0.756 !important;
            height: 1040px !important;
          }
          /* Table wrapper: fill full height */
          .a4-content > div { display: block !important; height: 100% !important; }
          /* Table itself: stretch rows to fill */
          .a4-content table { height: 100% !important; }

          /* Ensure colors print correctly */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Header */}
      <header className="no-print bg-[#9b9484] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link href="/" className="text-orange-200 hover:text-white text-sm transition-colors">
              ← กลับหน้าหลัก
            </Link>
          )}
          <div>
            <h1 className="text-xl font-bold">
              {editOrderNo ? `แก้ไขใบจอง — ${editOrderNo}` : 'ใบจองสินค้า'}
            </h1>
            <p className="text-orange-200 text-xs mt-0.5">
              {editOrderNo ? 'แก้ไขรายการแล้วกดบันทึกเพื่ออัพเดท' : 'ข้อมูลจากสต็อคสินค้า · Auto-save ใน browser'}
            </p>
          </div>
        </div>

        <Link href="/orders"
          className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white transition-colors border border-white/30">
          📋 ประวัติใบจอง
        </Link>

        {isAdmin && (
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white transition-colors border border-white/30">
            🖨️ พิมพ์
          </button>
        )}

        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={`text-sm px-3 py-1 rounded-full text-white ${saveMsg.includes('สำเร็จ') ? 'bg-green-500' : 'bg-red-500'}`}>
              {saveMsg}
            </span>
          )}
          {/* ── New order: show save when has items ── */}
          {!editOrderNo && (pendingCount > 0 || hasFoyPending) && (
            <>
              {pendingCount > 0 && (
                <>
                  <span className="text-yellow-300 text-sm">✎ แก้ไขค้างอยู่ {pendingCount} รายการ</span>
                  <button
                    onClick={() => { setPending({}); localStorage.removeItem(DRAFT_KEY) }}
                    className="px-3 py-1.5 text-sm rounded bg-white/20 hover:bg-white/30 text-white transition-colors"
                  >
                    ยกเลิก
                  </button>
                </>
              )}
              {hasFoyPending && pendingCount === 0 && (
                <span className="text-teal-300 text-sm">📦 กระดาษฝอย {Object.keys(foyPending).length} รุ่น พร้อมจอง</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || cannotBook25k || vehicleType === '' || sourceType === '' || bubbleBlocking}
                className="px-4 py-1.5 text-sm rounded bg-[#F2E9D3] hover:bg-[#E8DFC9] text-[#2baf2b] font-semibold transition-colors disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก...' : '💾 บันทึกการจอง'}
              </button>
              {cannotBook25k && <span className="text-red-400 text-sm font-semibold">⛔ ยอดไม่ถึง 25,000 — เลือกเต็มคันไม่ได้</span>}
              {bubbleWarning && <span className="text-red-400 text-sm font-semibold">{bubbleWarning}</span>}
            </>
          )}

          {/* ── Edit mode: save always visible + cancel order when empty ── */}
          {editOrderNo && (
            <>
              {pendingCount > 0 && (
                <span className="text-yellow-300 text-sm">✎ แก้ไขค้างอยู่ {pendingCount} รายการ</span>
              )}
              {hasFoyPending && pendingCount === 0 && (
                <span className="text-teal-300 text-sm">📦 กระดาษฝอย {Object.keys(foyPending).length} รุ่น</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || cannotBook25k || vehicleType === '' || sourceType === '' || bubbleBlocking}
                className="px-4 py-1.5 text-sm rounded bg-[#F2E9D3] hover:bg-[#E8DFC9] text-[#2baf2b] font-semibold transition-colors disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก...' : '💾 อัพเดทการจอง'}
              </button>
              {cannotBook25k && <span className="text-red-400 text-sm font-semibold">⛔ ยอดไม่ถึง 25,000 — เลือกเต็มคันไม่ได้</span>}
              {bubbleWarning && <span className="text-red-400 text-sm font-semibold">{bubbleWarning}</span>}
              {pendingCount === 0 && !hasFoyPending && (
                <button
                  onClick={handleCancelOrder}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? 'กำลังดำเนินการ...' : '🗑️ ยกเลิกใบจองนี้'}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main */}
      <main>
        <div className="screen-zoom-wrapper p-4 flex justify-center"
          style={{ zoom: viewScale < 1 ? viewScale : undefined }}>

          {/* ── ยังไม่ได้ระบุสาขา → lock screen ── */}
          {branchReady === false ? (
            <div className="flex flex-col items-center justify-center min-h-[70vh] gap-5 text-center px-6">
              <div className="text-6xl select-none">🔒</div>
              <div>
                <div className="text-xl font-bold text-gray-500 mb-1">ใบจองสินค้า</div>
                <div className="text-sm text-gray-400">ไม่สามารถเข้าใช้งานได้</div>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-6 py-4 max-w-xs text-sm text-yellow-800">
                กรุณาเปิดหน้าจองผ่าน <strong>LINE กลุ่มสาขา</strong><br/>
                เพื่อระบุตัวตนก่อนใช้งาน
              </div>
            </div>
          ) : branchReady === null ? (
            <div className="flex items-center justify-center h-40 text-gray-400">กำลังตรวจสอบ...</div>
          ) : loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลดข้อมูล...</div>
          ) : (
            <div className="a4-frame bg-white shadow-xl"
              style={{ width: '297mm', minHeight: '210mm', padding: '8mm', boxSizing: 'border-box' }}>
              <div className="a4-content" style={{ zoom: CONTENT_SCALE, transformOrigin: 'top left' }}>

              {/* Table */}
              <div className="inline-block rounded shadow overflow-hidden border border-gray-400">
                <table
                  className="text-[13px] leading-[1.35] border-collapse"
                  style={{ tableLayout: 'fixed', width: TABLE_W }}
                >
                  <colgroup>
                    <col style={{ width: ROW_NUM_W }} />
                    {sections.flatMap(sec => [
                      <col key={`${sec.order}-cn`} style={{ width: COL_NAME }} />,
                      <col key={`${sec.order}-cp`} style={{ width: COL_PRICE }} />,
                      <col key={`${sec.order}-cq`} style={{ width: COL_QTY }} />,
                      <col key={`${sec.order}-ct`} style={{ width: COL_TOTAL }} />,
                    ])}
                  </colgroup>

                  {/* Header — section names */}
                  <thead>
                    <tr>
                      <th className="border border-gray-300 bg-[#9b9484]" />
                      {sections.flatMap(sec => (
                        <th key={sec.order} colSpan={4}
                          className="border border-gray-300 bg-[#9b9484] text-white text-center text-[11px] font-bold py-0.5 px-1">
                          {sec.name}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  {/* Body */}
                  <tbody>
                    {Array.from({ length: maxRows }, (_, rowIdx) => (
                      <tr key={rowIdx} className="hover:bg-yellow-50/30 transition-colors">
                        <td className="border border-gray-300 text-center text-[9px] text-gray-400 py-0.5 select-none">
                          {rowIdx + 1}
                        </td>

                        {sections.flatMap((sec, si) => {
                          // ── Info panel in last section's bottom rows ────────
                          if (si === sections.length - 1 && rowIdx >= panelStart) {
                            const pr = rowIdx - panelStart
                            const base = 'border border-gray-300'
                            // pr 0-2: ผู้ส่ง | ผู้รับ — rowSpan=3
                            if (pr === 0) return [
                              <td key={`${si}-ip0`} colSpan={4} rowSpan={3} className={`${base} p-1 align-top`}>
                                <div className="flex h-full text-[9px]">
                                  <div className="flex-1 border-r border-gray-300 pr-1">
                                    <div className="font-semibold text-gray-500 mb-0.5">ผู้ส่งสินค้า</div>
                                  </div>
                                  <div className="flex-1 pl-1">
                                    <div className="font-semibold text-gray-500 mb-0.5">ผู้รับสินค้า</div>
                                  </div>
                                </div>
                              </td>,
                            ]
                            if (pr === 1 || pr === 2) return []

                            // pr 3-4: ยอดรวม — rowSpan=2, large editable
                            if (pr === 3) {
                              const autoVal = grayTotal + orangeTotal + foyTotal
                              const displayVal = manualTotal !== '' ? manualTotal : autoVal.toFixed(2)
                              return [
                                <td key={`${si}-ip3`} colSpan={4} rowSpan={2} className={`${base} p-0 bg-green-50 align-middle`}>
                                  <div className="flex flex-col items-center justify-center h-full px-1 py-0.5">
                                    <div className="text-[8px] font-semibold text-gray-500 self-start">ยอดเงินรวม (฿)</div>
                                    <input
                                      type="number"
                                      step="0.01"
                                      max="999999.99"
                                      value={displayVal}
                                      onChange={e => setManualTotal(e.target.value)}
                                      className="w-full text-xl font-bold text-green-400 text-right bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-400 rounded"
                                    />
                                  </div>
                                </td>,
                              ]
                            }
                            if (pr === 4) return []

                            // pr 5-7: วันที่ (left colSpan=2 rowSpan=3) + เบิกของ (right colSpan=2 rowSpan=3)
                            if (pr === 5) return [
                              <td key={`${si}-ip5a`} colSpan={2} rowSpan={3}
                                className={`${base} p-1 bg-gray-50 align-middle overflow-hidden`}>
                                <div className="flex flex-col items-center justify-center h-full gap-0.5">
                                  <div className="text-[7px] text-gray-400 leading-none">วันที่</div>
                                  <div className="text-[20px] font-extrabold text-gray-500 leading-none text-center truncate w-full">
                                    {today}
                                  </div>
                                </div>
                              </td>,
                              <td key={`${si}-ip5b`} colSpan={2} rowSpan={3}
                                className={`${base} p-1 align-middle ${sourceType === '' ? 'bg-red-50' : 'bg-white'}`}>
                                <div className="flex flex-col justify-center h-full gap-0.5">
                                  <div className="text-[7px] text-gray-500 font-semibold leading-none">เบิกของ</div>
                                  <select value={sourceType}
                                    disabled={isAutoForced}
                                    onChange={e => {
                                      const val = e.target.value as 'โกดัง' | 'หน้าร้าน' | 'โรงกล่อง' | 'โรงบับเบิล'
                                      setSourceType(val)
                                      if ((val === 'โรงกล่อง' || val === 'โรงบับเบิล') && vehicleType !== 'รับเอง' && vehicleType !== 'รถโรงงาน') setVehicleType('')
                                    }}
                                    className={`w-full border-2 rounded font-bold text-[13px] h-8 px-0.5 focus:outline-none ${isAutoForced ? 'bg-blue-50 border-blue-400 text-blue-700 opacity-90' : sourceType === '' ? 'bg-white border-red-400 text-red-500' : 'bg-white border-gray-400 text-gray-500'}`}>
                                    <option value="" disabled>— เลือก —</option>
                                    {hasMixItems && !isAutoForced ? (
                                      <>
                                        <option value="หน้าร้าน">หน้าร้าน</option>
                                        <option value="โกดัง">โกดัง</option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="โกดัง">โกดัง</option>
                                        <option value="หน้าร้าน">หน้าร้าน</option>
                                        <option value="โรงกล่อง">โรงกล่อง</option>
                                        <option value="โรงบับเบิล">โรงบับเบิล</option>
                                      </>
                                    )}
                                  </select>
                                  {sourceType === '' && <div className="text-[7px] text-red-500 leading-none">กรุณาเลือก</div>}
                                  {isAutoForced && <div className="text-[7px] text-blue-600 leading-none">ระบบกำหนดอัตโนมัติ</div>}
                                </div>
                              </td>,
                            ]
                            if (pr === 6 || pr === 7) return []

                            // pr 8-10: สาขา (left colSpan=2 rowSpan=3) + รถ (right colSpan=2 rowSpan=3)
                            if (pr === 8) return [
                              <td key={`${si}-ip8a`} colSpan={2} rowSpan={3}
                                className={`${base} p-1 bg-gray-50 align-middle overflow-hidden`}>
                                {branchInfo ? (
                                  <div className="flex flex-col justify-center h-full gap-0.5">
                                    <div className="text-[7px] text-gray-400 leading-none">สาขา/ตัวแทน</div>
                                    <div className="text-[16px] font-extrabold text-gray-500 leading-tight truncate">
                                      {branchInfo.name}
                                    </div>
                                    <div className="text-[8px] text-gray-500 leading-none truncate">{branchInfo.phone}</div>
                                  </div>
                                ) : (
                                  <div className="text-[8px] text-gray-400 italic">ยังไม่ได้เข้าสู่ระบบ</div>
                                )}
                              </td>,
                              <td key={`${si}-ip8b`} colSpan={2} rowSpan={3}
                                className={`${base} p-1 align-middle ${(vehicleType === '' || cannotBook25k) ? 'bg-red-50' : 'bg-white'}`}>
                                <div className="flex flex-col justify-center h-full gap-0.5">
                                  <div className="text-[7px] text-gray-500 font-semibold leading-none">รถ</div>
                                  <select value={vehicleType}
                                    disabled={isAutoForced}
                                    onChange={e => setVehicleType(e.target.value as 'จองรถ60000' | 'รอพ่วง' | 'รับเอง' | 'รถโรงงาน')}
                                    className={`w-full border-2 rounded font-bold text-[13px] h-8 px-0.5 focus:outline-none ${isAutoForced ? 'bg-blue-50 border-blue-400 text-blue-700 opacity-90' : (vehicleType === '' || cannotBook25k) ? 'bg-white border-red-400 text-red-500' : 'bg-white border-gray-400 text-gray-500'}`}>
                                    <option value="" disabled>— เลือก —</option>
                                    {(sourceType === 'โรงกล่อง' || sourceType === 'โรงบับเบิล') ? (
                                      <>
                                        <option value="รถโรงงาน">รถโรงงาน</option>
                                        <option value="รับเอง">รับเอง</option>
                                      </>
                                    ) : hasMixItems && !isAutoForced ? (
                                      <>
                                        <option value="รอพ่วง">รอพ่วง</option>
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
                                  {vehicleType === '' && <div className="text-[7px] text-red-500 leading-none">กรุณาเลือก</div>}
                                  {isAutoForced && <div className="text-[7px] text-blue-600 leading-none">ระบบกำหนดอัตโนมัติ</div>}
                                  {cannotBook25k && (
                                    <div className="text-[7px] text-red-600 font-bold leading-tight">
                                      จองไม่ได้ — ยอดไม่ถึง 60,000
                                    </div>
                                  )}
                                </div>
                              </td>,
                            ]
                            if (pr === 9 || pr === 10) return []
                            return [<td key={`${si}-ipx`} colSpan={4} className="border border-gray-200 bg-gray-50" />]
                          }

                          const cell = sec.rows[rowIdx] ?? null

                          if (!cell) return [
                            <td key={`${si}-en`} className="border border-gray-200 bg-gray-50" />,
                            <td key={`${si}-ep`} className="border border-gray-200 bg-gray-50" />,
                            <td key={`${si}-eq`} className="border border-gray-200 bg-gray-50" />,
                            <td key={`${si}-et`} className="border border-gray-200 bg-gray-50" />,
                          ]

                          if (cell.type === 'subgroup') {
                            const sgTotal = subgroupTotals.get(`${sec.order}-${cell.name}`) ?? 0
                            const isFoy = FOY_SUBGROUP_NAMES.has(cell.name)
                            return [
                              <td key={`${si}-sg`} colSpan={4}
                                onClick={isFoy ? () => router.push(editOrderNo ? `/booking-foy?from=booking&edit_foy=1&order_no=${editOrderNo}` : '/booking-foy?from=booking') : undefined}
                                className={`border px-2 py-px text-[11px] font-bold ${SUBGROUP_BG[cell.color]}${isFoy ? ' cursor-pointer' : ''}`}>
                                {isFoy ? (
                                  <div className="flex items-center justify-between gap-1 w-full">
                                    <span>{cell.name}</span>
                                    <span className="text-[9px] font-normal opacity-90">→ ใบจองกระดาษฝอย</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-1">
                                    <span>{cell.name}</span>
                                    {sgTotal > 0 && (
                                      <span className="text-[8px] font-semibold opacity-90 whitespace-nowrap">฿{fmt2(sgTotal)}</span>
                                    )}
                                  </div>
                                )}
                              </td>,
                            ]
                          }

                          if (cell.type === 'foy_cat') {
                            const catBg = FOY_CAT_BG[cell.category] ?? 'bg-gray-200 text-gray-700'
                            const foyClick = () => router.push(editOrderNo ? `/booking-foy?from=booking&edit_foy=1&order_no=${editOrderNo}` : '/booking-foy?from=booking')
                            return [
                              <td key={`${si}-fc`} colSpan={4}
                                onClick={foyClick}
                                className={`border px-2 py-px text-[10px] font-bold ${catBg} cursor-pointer`}>
                                <div className="flex items-center justify-between gap-1 w-full">
                                  <span>กระดาษฝอย {cell.category}</span>
                                  <span className="text-[8px] font-normal opacity-70">→ แก้ไข</span>
                                </div>
                              </td>,
                            ]
                          }

                          if (cell.type === 'foy_item') {
                            const foyClick = () => router.push(editOrderNo ? `/booking-foy?from=booking&edit_foy=1&order_no=${editOrderNo}` : '/booking-foy?from=booking')
                            return [
                              <td key={`${si}-fin`} onClick={foyClick} className="border border-gray-300 px-1 py-px bg-yellow-50 text-gray-700 overflow-hidden cursor-pointer">
                                <span className="truncate block">{cell.model_name}</span>
                              </td>,
                              <td key={`${si}-fip`} onClick={foyClick} className="border border-gray-300 px-1 py-px text-right bg-yellow-50 text-gray-400 cursor-pointer">
                              </td>,
                              <td key={`${si}-fiq`} onClick={foyClick} className="border border-gray-300 px-1 py-px text-right bg-yellow-50 font-semibold text-gray-700 cursor-pointer">
                                {cell.qty}
                              </td>,
                              <td key={`${si}-fit`} onClick={foyClick} className="border border-gray-300 px-1 py-px text-right bg-yellow-50 text-gray-700 cursor-pointer">
                                {fmt2(cell.amount)}
                              </td>,
                            ]
                          }

                          const { product: p } = cell
                          const price      = parseFloat(p.price ?? '0') || 0
                          const qty        = pending[p.id] ?? 0
                          const total      = qty * price
                          const hasPending = (pending[p.id] ?? 0) > 0

                          if (FOY_GROUP_NAMES.has(p.group_name)) {
                            // Catalog FOY rows are replaced by foy_cat/foy_item via injectFoyRows.
                            // This branch only fires when foyPending is empty (no rows injected).
                            const bg = sec.is_vat_included ? 'bg-gray-200 text-gray-500' : 'bg-orange-50 text-gray-500'
                            const foyClick = () => router.push(editOrderNo ? `/booking-foy?from=booking&edit_foy=1&order_no=${editOrderNo}` : '/booking-foy?from=booking')
                            return [
                              <td key={`${si}-pn`} onClick={foyClick} colSpan={4} className={`border border-gray-300 px-1 py-px ${bg} overflow-hidden cursor-pointer`}>
                                <div className="flex items-center gap-1">
                                  <span className="truncate">{p.product_name}</span>
                                  <span className="text-[9px] text-teal-700 ml-2 shrink-0">→</span>
                                </div>
                              </td>,
                            ]
                          }

                          const nameBg = sec.is_vat_included ? 'bg-gray-200 text-gray-500' : 'bg-orange-50 text-gray-500'
                          const pendingRing = hasPending ? 'ring-1 ring-inset ring-yellow-400' : ''
                          const qtyBg = hasPending ? 'bg-yellow-50' : (sec.is_vat_included ? 'bg-gray-200' : 'bg-orange-50')

                          return [
                            // ชื่อสินค้า
                            <td key={`${si}-pn`}
                              className={`border border-gray-300 px-1 py-px ${nameBg} ${pendingRing} relative overflow-hidden`}
                              title={p.product_name}>
                              {p.stock_qty !== null && p.stock_qty !== undefined && (
                                <span className="absolute top-0 right-0 text-[7px] text-blue-500 leading-none px-0.5 py-px">
                                  {parseFloat(String(p.stock_qty)).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                                </span>
                              )}
                              <div className="truncate pr-4">{p.product_name}</div>
                            </td>,

                            // ราคา/หน่วย
                            <td key={`${si}-pp`} className={`border border-gray-300 px-1 py-px text-right ${nameBg}`}>
                              {p.price ? price.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '–'}
                            </td>,

                            // จำนวน
                            <td key={`${si}-pq`} className={`border border-gray-300 p-0 ${qtyBg}`}>
                              {p.price && (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  defaultValue={qty || ''}
                                  key={`qty-${p.id}-${resetKey}`}
                                  onChange={e => handleQtyChange(p.id, e.target.value)}
                                  className={`w-full px-1 py-px text-[13px] text-right bg-transparent focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-400 ${hasPending ? 'font-semibold' : ''}`}
                                />
                              )}
                            </td>,

                            // รวม
                            <td key={`${si}-pt`} className={`border border-gray-300 px-1 py-px text-right ${nameBg}`}>
                              {total > 0 ? fmt2(total) : ''}
                            </td>,
                          ]
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function Booking2Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>}>
      <Booking2Inner />
    </Suspense>
  )
}
