'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id: number
  product_name: string
  price: string | null
  section_order: number
  section_name: string
  subgroup_order: number
  subgroup_name: string
}

interface StockItem {
  id: number
  model_name: string
  color_code: string
  color_name: string
  warehouse_price: string
}

interface BookingOrder {
  id: number
  order_no: string
  total_amount: string
  quantities: Record<string, number>
  foy_quantities: Record<string, { qty: number; amount: number }>
  foy_item_quantities: Record<string, number>
  priorities: Record<string, string>
  status: string
  payment_status: string
  payment_date: string | null
  payment_bank: string | null
  pickup_status: string
  source_type: string | null
  vehicle_type: string | null
  branch_name: string | null
  withdrawal_type_id: number | null
  nv_total: string | null
  v_total: string | null
  created_at: string
  updated_at: string
}

// Display row = 1 order may split into NV + V rows
interface DisplayRow {
  order: BookingOrder
  displayNo: string   // "NV2504211023" | "V2504211023" | "2504211023"
  displayAmount: number
  vatTag: 'NV' | 'V' | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: string | number): string {
  return parseFloat(String(n)).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    year:     '2-digit',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'Asia/Bangkok',
  })
}

function fmtPayDate(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  })
}

function fmtOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const router = useRouter()
  const [orders, setOrders]   = useState<BookingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState<string | null>(null)

  // Payment form state
  const [payingOrderNo, setPayingOrderNo] = useState<string | null>(null)
  const [payDate, setPayDate] = useState('')
  const [payBank, setPayBank] = useState('')

  // Bulk payment modal
  const [showPayModal, setShowPayModal]     = useState(false)
  const [payModalOrders, setPayModalOrders] = useState<{ display_no: string; order_no: string; total_amount: string; branch_name: string | null; vat_tag: 'NV' | 'V' | null }[]>([])
  const [selOrderNos, setSelOrderNos]       = useState<Set<string>>(new Set())
  const [branchSlips, setBranchSlips]       = useState<{ id: number; category: string; amount: number; account_name: string | null; slip_date: string; applied: boolean }[]>([])
  const [appliedSlipIds, setAppliedSlipIds] = useState<Set<number>>(new Set())
  const [payStep, setPayStep]               = useState<1 | 2>(1)
  const [qrDataUrl, setQrDataUrl]           = useState<string | null>(null)
  const [qrAmount, setQrAmount]             = useState(0)
  const [qrLoading, setQrLoading]           = useState(false)
  const [qrSaving, setQrSaving]             = useState(false)

  // Print state
  const [products, setProducts]     = useState<CatalogProduct[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [printOrder, setPrintOrder] = useState<BookingOrder | null>(null)
  const [printType, setPrintType]   = useState<'booking' | null>(null)

  // Withdrawal types for display
  const [withdrawalTypes, setWithdrawalTypes] = useState<{ id: number; name: string }[]>([])

  // Delivery methods + pickup dropdown
  const [deliveries, setDeliveries]           = useState<string[]>([])
  const [pickupOpen, setPickupOpen]           = useState<string | null>(null)  // order_no
  const [pickupDelivery, setPickupDelivery]   = useState('')

  // Role
  const [isAdmin, setIsAdmin]           = useState(false)
  const [isManager, setIsManager]       = useState(false)
  const [branchName, setBranchName]     = useState<string | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [branchId, setBranchId]         = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/orders')
      .then(r => r.json())
      .then((data: BookingOrder[]) => { setOrders(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch catalog + stock + delivery methods (parallel, once)
  useEffect(() => {
    fetch('/api/booking2').then(r => r.json()).then(setProducts).catch(() => {})
    fetch('/api/stock').then(r => r.json()).then((data: { items: StockItem[] }) => setStockItems(data.items ?? [])).catch(() => {})
    fetch('/api/delivery').then(r => r.json()).then((data: { name: string }[]) => setDeliveries(data.map(d => d.name))).catch(() => {})
    fetch('/api/withdrawal').then(r => r.json()).then(setWithdrawalTypes).catch(() => {})
  }, [])

  // Read role + branch from branch_session
  useEffect(() => {
    try {
      const bs = localStorage.getItem('branch_session')
      if (bs) {
        const s = JSON.parse(bs)
        setIsAdmin(s?.is_admin === true)
        setIsManager(s?.is_manager === true)
        if (s?.branch_name) setBranchName(s.branch_name)
        if (s?.branch_id)   setBranchId(s.branch_id)
      } else {
        // ไม่มี session → ถือว่าเป็น admin (เข้าตรง)
        setIsAdmin(true)
      }
    } catch { /* ignore */ }
    setSessionLoaded(true)
  }, [])

  // Auto-open payment modal when ?pay=1
  useEffect(() => {
    if (!sessionLoaded || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('pay') !== '1') return
    const urlBranch = params.get('branch_name')
    openPayModal(urlBranch ?? undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoaded])

  // Auto-print when print order is set
  useEffect(() => {
    if (!printOrder) return
    const t = setTimeout(() => window.print(), 80)
    return () => clearTimeout(t)
  }, [printOrder, printType])

  // Clear print state after printing
  useEffect(() => {
    const h = () => { setPrintOrder(null); setPrintType(null) }
    window.addEventListener('afterprint', h)
    return () => window.removeEventListener('afterprint', h)
  }, [])

  const patch = async (order_no: string, fields: Record<string, unknown>) => {
    const res = await fetch('/api/orders', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ order_no, ...fields }),
    })
    if (!res.ok) { setMsg('เกิดข้อผิดพลาด'); return }
    load()
  }

  const handlePickup = async (order: BookingOrder) => {
    if (!confirm(`ยืนยัน "ขึ้นของแล้ว" สำหรับใบจอง ${order.order_no}?`)) return
    await patch(order.order_no, { pickup_status: 'picked_up' })
  }

  const handleResetPickup = async (order: BookingOrder) => {
    if (!confirm(`รีเซ็ตสถานะขึ้นของของใบจอง ${order.order_no}?`)) return
    await patch(order.order_no, { pickup_status: 'pending' })
  }

  const handlePickupAndPrint = async (order: BookingOrder) => {
    await patch(order.order_no, {
      pickup_status: 'picked_up',
      ...(pickupDelivery ? { vehicle_type: pickupDelivery } : {}),
    })
    setPickupOpen(null)
    setPickupDelivery('')
    handlePrint(order)
  }

  const handlePayment = async (order_no: string) => {
    if (!payDate || !payBank.trim()) return
    await patch(order_no, {
      payment_status: 'paid',
      payment_date:   payDate,
      payment_bank:   payBank.trim(),
    })
    setPayingOrderNo(null)
    setPayDate('')
    setPayBank('')
  }

  const handlePrint = (order: BookingOrder) => {
    setPrintType('booking')
    setPrintOrder(order)
  }

  const openPayModal = async (filterBranch?: string) => {
    try {
      const activeBranch = filterBranch ?? branchName ?? null
      const [ordersRes, slipsRes] = await Promise.all([
        fetch('/api/orders').then(r => r.json()).catch(() => []),
        activeBranch
          ? fetch(`/api/slips?branch_name=${encodeURIComponent(activeBranch)}`).then(r => r.json()).catch(() => [])
          : Promise.resolve([]),
      ])
      const allOrders: { order_no: string; total_amount: string; nv_total: string | null; v_total: string | null; branch_name: string | null; payment_status: string; status: string }[] =
        Array.isArray(ordersRes) ? ordersRes : []
      const unpaid = allOrders.filter(o =>
        o.payment_status !== 'paid' &&
        o.status !== 'cancelled' &&
        (activeBranch ? o.branch_name === activeBranch : true)
      )
      // Expand into NV/V entries for independent payment selection
      const payEntries: { display_no: string; order_no: string; total_amount: string; branch_name: string | null; vat_tag: 'NV' | 'V' | null }[] = []
      for (const o of unpaid) {
        const nvT = parseFloat(o.nv_total ?? '0') || 0
        const vT  = parseFloat(o.v_total  ?? '0') || 0
        if (nvT > 0 && vT > 0) {
          payEntries.push({ display_no: `NV${o.order_no}`, order_no: o.order_no, total_amount: String(nvT), branch_name: o.branch_name, vat_tag: 'NV' })
          payEntries.push({ display_no: `V${o.order_no}`,  order_no: o.order_no, total_amount: String(vT),  branch_name: o.branch_name, vat_tag: 'V'  })
        } else if (nvT > 0) {
          payEntries.push({ display_no: `NV${o.order_no}`, order_no: o.order_no, total_amount: String(nvT), branch_name: o.branch_name, vat_tag: 'NV' })
        } else if (vT > 0) {
          payEntries.push({ display_no: `V${o.order_no}`,  order_no: o.order_no, total_amount: String(vT),  branch_name: o.branch_name, vat_tag: 'V'  })
        } else {
          payEntries.push({ display_no: o.order_no, order_no: o.order_no, total_amount: o.total_amount, branch_name: o.branch_name, vat_tag: null })
        }
      }
      setPayModalOrders(payEntries)
      setSelOrderNos(new Set(payEntries.map(e => e.display_no)))
      setBranchSlips(Array.isArray(slipsRes) ? slipsRes : [])
      setAppliedSlipIds(new Set())
      setPayStep(1)
      setQrDataUrl(null)
    } catch { /* ignore fetch errors — still open modal */ }
    setShowPayModal(true)
  }

  const goToStep2 = async (remaining: number) => {
    // Mark selected slips as applied
    if (appliedSlipIds.size > 0) {
      await Promise.all([...appliedSlipIds].map(id =>
        fetch('/api/slips', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, applied: true }),
        })
      ))
    }
    setPayStep(2)
    setQrAmount(remaining)
    setQrDataUrl(null)
    if (remaining > 0) {
      setQrLoading(true)
      try {
        // Get PromptPay payload from server (reads PROMPTPAY_ID securely server-side)
        const res = await fetch(`/api/promptpay?amount=${remaining.toFixed(2)}`)
        if (res.ok) {
          const data = await res.json()
          const payload: string = data.payload
          if (payload) {
            // Generate QR entirely client-side — no external image service needed
            const QRCode = (await import('qrcode')).default
            const dataUrl = await QRCode.toDataURL(payload, {
              width: 300,
              margin: 2,
              errorCorrectionLevel: 'M',
              color: { dark: '#000000', light: '#ffffff' },
            })
            setQrDataUrl(dataUrl)
          }
        } else {
          console.error('[goToStep2] /api/promptpay returned', res.status, await res.text())
        }
      } catch (e) {
        console.error('[goToStep2] QR generation error:', e)
      }
      setQrLoading(false)
    }
  }

  const saveQrImage = () => {
    if (!qrDataUrl || qrSaving) return
    setQrSaving(true)
    const filename = `promptpay-${qrAmount.toFixed(0)}thb.png`
    // qrDataUrl is already a data:image/png;base64,... — download directly, no fetch needed
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setQrSaving(false)
    setShowPayModal(false)
  }

  // ── Print render: ใบจอง ────────────────────────────────────────────────────

  function BookingPrint({ order }: { order: BookingOrder }) {
    type BookedItem = { product: CatalogProduct; qty: number; total: number }

    // Switchable subgroup names → NV form; all others → V form
    const SWITCHABLE_SG = new Set(['ซองPPกันกระแทก', 'ซองใสปะหน้า', 'ฝาปิดกระบอก', 'ถุงหิ้วบริการ', 'เชือก'])

    const productMap = new Map(products.map(p => [p.id, p]))

    type SectionMap = Map<string, { order: number; subOrder: number; items: BookedItem[] }>
    const nvSectionMap: SectionMap = new Map()
    const vSectionMap:  SectionMap = new Map()

    for (const [idStr, qty] of Object.entries(order.quantities ?? {})) {
      if (!qty) continue
      const p = productMap.get(Number(idStr))
      if (!p) continue
      const price = parseFloat(p.price ?? '0') || 0
      const key = p.subgroup_name || p.section_name
      const targetMap = SWITCHABLE_SG.has(p.subgroup_name) ? nvSectionMap : vSectionMap
      if (!targetMap.has(key)) {
        targetMap.set(key, { order: p.section_order, subOrder: p.subgroup_order, items: [] })
      }
      targetMap.get(key)!.items.push({ product: p, qty, total: price * qty })
    }

    const sortSections = (m: SectionMap) =>
      Array.from(m.entries()).sort(([, a], [, b]) => a.order !== b.order ? a.order - b.order : a.subOrder - b.subOrder)

    const nvSections = sortSections(nvSectionMap)
    const vSections  = sortSections(vSectionMap)
    const allSections = sortSections(new Map([...nvSectionMap, ...vSectionMap]))

    const nvTotal = parseFloat(order.nv_total ?? '0') || 0
    const vTotal  = parseFloat(order.v_total  ?? '0') || 0
    const orderDate = fmtOrderDate(order.updated_at)

    const renderSingleForm = (
      displayOrderNo: string,
      sections: [string, { order: number; subOrder: number; items: BookedItem[] }][],
      grandTotal: number,
      accentColor: string,
      vatLabel: string | null,
      wrapperStyle?: React.CSSProperties,
    ) => {
      // Build foy color-level data:
      // - NV form (vatLabel='NV'): always show foy
      // - V-only form (vatLabel='V', nvTotal=0): show foy (no NV form exists to carry it)
      // - V form when NV also exists (vatLabel='V', nvTotal>0): skip (foy already in NV)
      // - Legacy null: always show foy
      type FoyCI = { item: StockItem; qty: number; total: number }
      const foyModelMap = new Map<string, FoyCI[]>()
      const showFoyHere = vatLabel !== 'V' || nvTotal === 0
      if (showFoyHere) {
        const foyStockMap = new Map(stockItems.map(s => [s.id, s]))
        for (const [idStr, qtyVal] of Object.entries(order.foy_item_quantities ?? {})) {
          if (!qtyVal) continue
          const s = foyStockMap.get(Number(idStr))
          if (!s) continue
          const price = parseFloat(s.warehouse_price ?? '0') || 0
          if (!foyModelMap.has(s.model_name)) foyModelMap.set(s.model_name, [])
          foyModelMap.get(s.model_name)!.push({ item: s, qty: qtyVal, total: price * qtyVal })
        }
      }

      const rowBase: React.CSSProperties = {
        display: 'flex', alignItems: 'baseline',
        padding: '0.7mm 1.5mm', fontSize: '8pt', gap: '1.5mm',
        borderBottom: '1px solid #eee',
      }
      const catHdr: React.CSSProperties = {
        padding: '1mm 1.5mm', fontSize: '9pt', fontWeight: 'bold',
      }

      // Priority symbol: ● filled = critical, ○ hollow thick = important
      const PrioSymbol = ({ prio }: { prio: string | undefined }) => {
        if (prio === 'critical') return (
          <span style={{ flexShrink: 0, display: 'inline-block', width: '2.8mm', height: '2.8mm', borderRadius: '50%', backgroundColor: '#111', verticalAlign: 'middle', marginRight: '0.5mm' }} />
        )
        if (prio === 'important') return (
          <span style={{ flexShrink: 0, display: 'inline-block', width: '2.8mm', height: '2.8mm', borderRadius: '50%', border: '0.6mm solid #111', backgroundColor: 'white', verticalAlign: 'middle', marginRight: '0.5mm' }} />
        )
        return null
      }

      return (
        <div style={{ width: '210mm', padding: '8mm', boxSizing: 'border-box', fontFamily: 'sans-serif', ...wrapperStyle }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
            <div style={{ fontSize: '16pt', fontWeight: 'bold', color: accentColor }}>
              ใบจองสินค้า{vatLabel ? ` (${vatLabel})` : ''}
            </div>
            <div style={{ fontSize: '10pt', color: '#333' }}>เลขที่: {displayOrderNo}</div>
          </div>

          {/* Info bar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '2mm', marginBottom: '3mm', border: '1px solid #ccc', padding: '2.5mm', borderRadius: '1mm', backgroundColor: '#f9fafb', fontSize: '9pt', color: '#111' }}>
            <div><strong>วันที่:</strong> {orderDate}</div>
            <div><strong>เบิกของ:</strong> {withdrawalTypes.find(w => w.id === order.withdrawal_type_id)?.name ?? order.source_type ?? '—'}</div>
            <div><strong>รถ:</strong> {order.vehicle_type ?? '—'}</div>
            <div><strong>สาขา/ตัวแทน:</strong> {order.branch_name ?? '—'}</div>
          </div>

          {/*
            2-column layout: all category blocks + foy blocks flow left→right.
            columnCount:2 fills left column first, then right column.
            breakInside:avoid on each block keeps header+rows together.
            Products are single-column rows within each ~90mm-wide column.
          */}
          <div style={{ columnCount: 3, columnGap: '4mm' }}>

            {/* Product category sections */}
            {sections.map(([sectionName, { items }]) => (
              <div key={sectionName} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: '1.5mm' }}>
                <div style={{ ...catHdr, backgroundColor: '#9b9484', color: 'white' }}>
                  {sectionName}
                </div>
                <div style={{ border: '1px solid #ddd', borderTop: 'none' }}>
                  {items.map((item, idx) => {
                    const prio = (order.priorities ?? {})[String(item.product.id)]
                    return (
                      <div key={idx} style={{ ...rowBase, alignItems: 'center', backgroundColor: idx % 2 === 0 ? 'white' : '#f0f0f0', color: '#111' }}>
                        <PrioSymbol prio={prio} />
                        <span style={{ flex: 1 }}>{item.product.product_name}</span>
                        <span style={{ fontWeight: 'bold', flexShrink: 0 }}>×{item.qty}</span>
                        <span style={{ flexShrink: 0, color: '#333', minWidth: '10mm', textAlign: 'right' }}>{item.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Foy model sections — each model flows as its own column block */}
            {Array.from(foyModelMap.entries()).map(([modelName, colorItems]) => (
              <div key={`foy-${modelName}`} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: '1.5mm' }}>
                <div style={{ ...catHdr, backgroundColor: '#0f766e', color: 'white' }}>
                  ฝอย: {modelName}
                </div>
                <div style={{ border: '1px solid #0d9488', borderTop: 'none' }}>
                  {colorItems.map((fi, idx) => {
                    const foyPrio = (order.priorities ?? {})[`foy_${fi.item.id}`]
                    return (
                      <div key={idx} style={{ ...rowBase, alignItems: 'center', backgroundColor: idx % 2 === 0 ? 'white' : '#f0f0f0', color: '#111' }}>
                        <PrioSymbol prio={foyPrio} />
                        <span style={{ flexShrink: 0, fontFamily: 'monospace', color: '#555', fontSize: '7.5pt', minWidth: '8mm' }}>{fi.item.color_code}</span>
                        <span style={{ flex: 1 }}>{fi.item.color_name}</span>
                        <span style={{ fontWeight: 'bold', flexShrink: 0 }}>×{fi.qty}</span>
                        <span style={{ flexShrink: 0, color: '#333', minWidth: '10mm', textAlign: 'right' }}>{fi.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

          </div>{/* end 2-column */}

          {/* Grand total + signature — full width, never split */}
          <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4mm', marginTop: '3mm', borderTop: '2px solid #888', paddingTop: '2mm' }}>
              <span style={{ fontSize: '11pt', fontWeight: 'bold', color: '#111' }}>ยอดเงินรวม</span>
              <span style={{ fontSize: '12pt', fontWeight: 'bold', color: '#111' }}>{fmtMoney(grandTotal)} บาท</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginTop: '4mm' }}>
              {[{ label: 'ผู้ส่งสินค้า' }, { label: 'ผู้รับสินค้า' }].map(({ label }) => (
                <div key={label} style={{ border: '1px solid #ccc', padding: '3mm', borderRadius: '1mm' }}>
                  <div style={{ fontSize: '8pt', color: '#666', marginBottom: '10mm' }}>{label}</div>
                  <div style={{ borderTop: '1px solid #aaa', paddingTop: '1.5mm', fontSize: '7.5pt', color: '#888' }}>
                    ลงชื่อ _________________________ วันที่ _____________
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    }

    // Determine which forms to render
    if (nvTotal > 0 && vTotal > 0) {
      return (
        <>
          {renderSingleForm(`NV${order.order_no}`, nvSections, nvTotal, '#f97316', 'NV', { pageBreakAfter: 'always' })}
          {renderSingleForm(`V${order.order_no}`,  vSections,  vTotal,  '#4ade80', 'V')}
        </>
      )
    } else if (nvTotal > 0) {
      return renderSingleForm(`NV${order.order_no}`, nvSections, nvTotal, '#f97316', 'NV')
    } else if (vTotal > 0) {
      return renderSingleForm(`V${order.order_no}`, vSections, vTotal, '#4ade80', 'V')
    } else {
      // Legacy: both totals are 0 — combined form
      return renderSingleForm(order.order_no, allSections, parseFloat(order.total_amount), '#4ade80', null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .print-only { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          .print-only { display: block !important; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Print area */}
      <div className="print-only">
        {printType === 'booking' && printOrder && <BookingPrint order={printOrder} />}
      </div>

      {/* ── Payment Modal */}
      {showPayModal && (() => {
        const selectedTotal = payModalOrders
          .filter(o => selOrderNos.has(o.display_no))
          .reduce((s, o) => s + parseFloat(o.total_amount), 0)
        const safeSlips = Array.isArray(branchSlips) ? branchSlips : []
        const totalDeduct = safeSlips
          .filter(s => appliedSlipIds.has(s.id))
          .reduce((sum, s) => sum + s.amount, 0)
        const remaining   = Math.max(0, selectedTotal - totalDeduct)
        const allSelected = payModalOrders.every(o => selOrderNos.has(o.display_no))
        const SLIP_LABEL_MAP: Record<string, string> = {
          'วรวุฒิ': 'สลิปวรวุฒิ', 'print': 'สลิปPRINT', 'pack': 'สลิปPACK', 'bb': 'สลิปBB', 'กล่อง': 'สลิปกล่อง'
        }

        const BANKS = [
          { key: 'kbank',   label: 'กสิกรไทย',    abbr: 'KBank',  bg: '#138f2d', icon: '🟩' },
          { key: 'scb',     label: 'ไทยพาณิชย์',  abbr: 'SCB',    bg: '#4e2d8c', icon: '🟪' },
          { key: 'bbl',     label: 'กรุงเทพ',      abbr: 'BBL',    bg: '#1e3a8a', icon: '🟦' },
          { key: 'ktb',     label: 'กรุงไทย',      abbr: 'KTB',    bg: '#0284c7', icon: '🔵' },
          { key: 'bay',     label: 'กรุงศรี',       abbr: 'BAY',    bg: '#fbbf24', icon: '🟡' },
          { key: 'ttb',     label: 'ทหารไทยธนชาต', abbr: 'TTB',    bg: '#f97316', icon: '🟠' },
          { key: 'gsb',     label: 'ออมสิน',       abbr: 'GSB',    bg: '#ec4899', icon: '🩷' },
          { key: 'promptpay', label: 'PromptPay',  abbr: 'QR',     bg: '#7c3aed', icon: '📱' },
        ]

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto flex flex-col">
              {/* header */}
              <div className="bg-orange-500 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold">
                    💳 แจ้งชำระเงิน
                    {payStep === 2 && <span className="ml-2 text-base font-normal">— QR PromptPay</span>}
                  </div>
                  <div className="text-orange-100 text-xs mt-0.5">
                    {branchName ? `สาขา: ${branchName}` : 'ทุกสาขา'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {payStep === 2 && (
                    <button onClick={() => setPayStep(1)} className="text-white/80 hover:text-white text-sm px-2 py-1 rounded border border-white/30">← กลับ</button>
                  )}
                  <button onClick={() => setShowPayModal(false)} className="text-white/70 hover:text-white text-2xl leading-none">✕</button>
                </div>
              </div>

              {/* STEP 1 */}
              {payStep === 1 && (
                <div className="p-5 flex flex-col gap-5">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-gray-700">ใบจองค้างชำระ</div>
                      <button
                        onClick={() => setSelOrderNos(allSelected ? new Set() : new Set(payModalOrders.map(o => o.display_no)))}
                        className="text-xs px-2 py-1 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors"
                      >
                        {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                      </button>
                    </div>
                    <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                      {payModalOrders.length === 0 && (
                        <div className="px-4 py-3 text-sm text-gray-400 text-center">ไม่มียอดค้างชำระ</div>
                      )}
                      {payModalOrders.map(o => {
                        const checked = selOrderNos.has(o.display_no)
                        return (
                          <label key={o.display_no} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-orange-50' : 'hover:bg-gray-50'}`}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              const next = new Set(selOrderNos)
                              checked ? next.delete(o.display_no) : next.add(o.display_no)
                              setSelOrderNos(next)
                            }} className="accent-orange-500 w-4 h-4 flex-shrink-0" />
                            <span className={`font-mono text-sm font-bold flex-shrink-0 ${o.vat_tag === 'NV' ? 'text-orange-500' : o.vat_tag === 'V' ? 'text-green-600' : 'text-green-600'}`}>{o.display_no}</span>
                            <span className="text-xs text-gray-500 flex-1 truncate">{o.branch_name ?? ''}</span>
                            <span className="text-sm font-semibold text-gray-800 flex-shrink-0">
                              ฿{parseFloat(o.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex justify-between items-center">
                    <span className="text-sm font-semibold text-orange-800">ยอดรวมที่เลือก ({selOrderNos.size} ใบ)</span>
                    <span className="text-xl font-bold text-orange-700">฿{selectedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {safeSlips.length > 0 && (
                    <div>
                      <div className="text-sm font-semibold text-gray-700 mb-2">มียอดโอนตรงเข้าบัญชีดังนี้</div>
                      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                        {safeSlips.map(slip => {
                          const isChecked = appliedSlipIds.has(slip.id)
                          return (
                            <div key={slip.id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isChecked ? 'bg-blue-50' : slip.applied ? 'bg-gray-50 opacity-50' : 'hover:bg-gray-50'}`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-blue-700">{SLIP_LABEL_MAP[slip.category] ?? slip.category}</span>
                                  <span className="text-xs text-gray-400">{slip.slip_date}</span>
                                  {slip.applied && <span className="text-xs text-gray-400">(ใช้แล้ว)</span>}
                                </div>
                                {slip.account_name && <div className="text-xs text-gray-500 truncate">{slip.account_name}</div>}
                              </div>
                              <span className="text-sm font-bold text-gray-800 flex-shrink-0">
                                ฿{slip.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </span>
                              <button
                                onClick={() => {
                                  const next = new Set(appliedSlipIds)
                                  isChecked ? next.delete(slip.id) : next.add(slip.id)
                                  setAppliedSlipIds(next)
                                }}
                                disabled={slip.applied}
                                className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors
                                  ${slip.applied
                                    ? 'border-gray-200 text-gray-400 bg-gray-100 cursor-not-allowed'
                                    : isChecked
                                      ? 'border-blue-500 text-blue-700 bg-blue-100 hover:bg-blue-200'
                                      : 'border-gray-300 text-gray-600 bg-white hover:border-blue-400 hover:text-blue-600'
                                  }`}
                              >
                                {isChecked ? '✓ หักยอด' : 'หักยอด'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex flex-col gap-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>ยอดรวม</span>
                      <span>฿{selectedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {totalDeduct > 0 && (
                      <div className="flex justify-between text-sm text-blue-600">
                        <span>หักยอดโอนตรง</span>
                        <span>- ฿{totalDeduct.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="border-t border-gray-300 mt-1 pt-1.5 flex justify-between items-center">
                      <span className="text-base font-bold text-gray-800">ยอดคงเหลือต้องโอน</span>
                      <span className={`text-xl font-bold ${remaining <= 0 ? 'text-green-600' : 'text-gray-900'}`}>
                        ฿{remaining.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => goToStep2(remaining)}
                    disabled={selOrderNos.size === 0}
                    className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-base font-bold shadow transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ถัดไป: สร้าง QR →
                  </button>
                  <p className="text-center text-xs text-orange-600 font-medium pt-1">
                    📌 อย่าลืมส่งสลิปเข้ากลุ่ม เพื่อตัดยอดบิลด้วยนะคะ
                  </p>
                </div>
              )}

              {/* STEP 2 */}
              {payStep === 2 && (
                <div className="p-5 flex flex-col items-center gap-5">
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-center w-full">
                    <div className="text-xs text-orange-700 font-semibold mb-1">ยอดคงเหลือต้องโอน</div>
                    <div className="text-3xl font-bold text-orange-600">฿{remaining.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-orange-500 mt-1">{selOrderNos.size} ใบจอง</div>
                  </div>
                  {remaining > 0 ? (
                    <>
                      <div className="border-2 border-purple-200 rounded-2xl p-3 bg-white shadow">
                        {qrLoading ? (
                          <div className="w-52 h-52 flex items-center justify-center text-gray-400 text-sm">กำลังสร้าง QR...</div>
                        ) : qrDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={qrDataUrl} alt="PromptPay QR" width={208} height={208} className="rounded-lg" />
                        ) : (
                          <div className="w-52 h-52 flex flex-col items-center justify-center text-gray-400 text-sm text-center gap-2">
                            <span className="text-3xl">⚠️</span>
                            <span>ยังไม่ได้ตั้งค่า PROMPTPAY_ID<br/>ใน Railway environment</span>
                          </div>
                        )}
                      </div>
                      {qrDataUrl && (
                        <button
                          onClick={saveQrImage}
                          disabled={qrSaving}
                          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-base font-semibold shadow transition-colors disabled:opacity-60"
                        >
                          {qrSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึกรูป QR'}
                        </button>
                      )}
                      <p className="text-center text-xs text-orange-600 font-medium">
                        📌 อย่าลืมส่งสลิปเข้ากลุ่ม เพื่อตัดยอดบิลด้วยนะคะ
                      </p>
                    </>
                  ) : (
                    <div className="text-green-600 font-semibold text-center py-4">ไม่มียอดคงค้าง ✅</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Screen area */}
      <div className="no-print min-h-screen bg-gray-100">

        {/* Header */}
        <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/booking2" className="text-orange-200 hover:text-white text-sm transition-colors">
              ← กลับหน้าใบจองสินค้า
            </Link>
            <div>
              <h1 className="text-xl font-bold">ประวัติใบจอง</h1>
              <p className="text-orange-200 text-xs mt-0.5">ประวัติรายการทั้งหมด</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {msg && <span className="text-sm px-3 py-1 rounded-full bg-red-500 text-white">{msg}</span>}
            {(() => {
              const unpaidOrders = orders.filter(o =>
                o.payment_status !== 'paid' && o.status !== 'cancelled' &&
                ((isAdmin || isManager) ? true : o.branch_name === branchName)
              )
              const unpaidCount = unpaidOrders.length
              const unpaidTotal = unpaidOrders.reduce((s, o) => s + parseFloat(o.total_amount), 0)
              return unpaidCount > 0 ? (
                <button
                  onClick={() => openPayModal()}
                  className="px-3 py-1.5 text-sm rounded bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors shadow leading-tight text-left"
                >
                  <div className="text-xs font-bold">💳 แจ้งชำระเงิน ({unpaidCount} ใบ)</div>
                  <div className="text-[11px] text-orange-100 font-normal">
                    ฿{unpaidTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </div>
                </button>
              ) : null
            })()}
          </div>
        </header>

        {/* Main */}
        <main className="p-4 overflow-x-auto">
          {(!sessionLoaded || loading) ? (
            <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลด...</div>
          ) : orders.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400">ยังไม่มีใบจอง</div>
          ) : (
            <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden min-w-max">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-[#9b9484] text-white text-left text-xs">
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">เลขที่ใบจอง</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500 text-right">ยอดเงินรวม (฿)</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">วันเวลาอัพเดทล่าสุด</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">สถานะใบจอง</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">แจ้งชื่อตัวแทนสาขา</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">สถานะการชำระเงิน</th>
                    <th className="px-4 py-2 whitespace-nowrap text-center">ขึ้นของ / พิมพ์</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredOrders = (isAdmin || isManager) ? orders : orders.filter(o => o.branch_name === branchName)
                    // Build display rows (1 order → 1 or 2 rows depending on nv/v totals)
                    const displayRows: DisplayRow[] = []
                    for (const order of filteredOrders) {
                      const nvT = parseFloat(order.nv_total ?? '0') || 0
                      const vT  = parseFloat(order.v_total  ?? '0') || 0
                      if (nvT > 0 && vT > 0) {
                        displayRows.push({ order, displayNo: `NV${order.order_no}`, displayAmount: nvT, vatTag: 'NV' })
                        displayRows.push({ order, displayNo: `V${order.order_no}`,  displayAmount: vT,  vatTag: 'V'  })
                      } else if (nvT > 0) {
                        displayRows.push({ order, displayNo: `NV${order.order_no}`, displayAmount: nvT, vatTag: 'NV' })
                      } else if (vT > 0) {
                        displayRows.push({ order, displayNo: `V${order.order_no}`,  displayAmount: vT,  vatTag: 'V'  })
                      } else {
                        // legacy order: no prefix
                        displayRows.push({ order, displayNo: order.order_no, displayAmount: parseFloat(order.total_amount), vatTag: null })
                      }
                    }
                    return displayRows.map(({ order, displayNo, displayAmount, vatTag }, i) => {
                    const cancelled = order.status === 'cancelled'
                    const pickedUp  = order.pickup_status === 'picked_up'
                    const paid      = order.payment_status === 'paid'
                    const isPaying  = payingOrderNo === order.order_no
                    return (
                      <tr key={`${order.id}-${vatTag ?? 'x'}`} className={cancelled ? 'bg-red-50 opacity-60' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>

                        {/* 1. เลขที่ใบจอง */}
                        <td className="px-4 py-3 border-r border-gray-200 font-mono font-bold text-base">
                          <span className={vatTag === 'NV' ? 'text-orange-500' : vatTag === 'V' ? 'text-green-500' : 'text-green-400'}>
                            {displayNo}
                          </span>
                        </td>

                        {/* 2. ยอดเงินรวม */}
                        <td className="px-4 py-3 border-r border-gray-200 text-right font-semibold">
                          {fmtMoney(displayAmount)}
                          {vatTag && <div className="text-[10px] text-gray-400 font-normal">{vatTag === 'NV' ? 'ไม่รวมแวต' : 'รวมแวต'}</div>}
                        </td>

                        {/* 3. วันเวลาอัพเดท */}
                        <td className="px-4 py-3 border-r border-gray-200 text-gray-500 whitespace-nowrap text-xs">
                          {fmtDate(order.updated_at)}
                        </td>

                        {/* 4. สถานะใบจอง */}
                        <td className="px-4 py-3 border-r border-gray-200">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between items-center gap-2 text-[11px]">
                              <span className={order.vehicle_type ? (order.vehicle_type === 'จองรถ60000' ? 'text-blue-700 font-medium' : 'text-green-400 font-medium') : 'text-gray-300'}>
                                {order.vehicle_type === 'จองรถ60000' ? 'เต็มคัน 25k' : order.vehicle_type === 'รอพ่วง' ? 'รอพ่วง' : order.vehicle_type === 'รับเอง' ? 'รับเอง' : order.vehicle_type === 'รถโรงงาน' ? 'รถโรงงาน' : '—'}
                              </span>
                              <span className={order.withdrawal_type_id || order.source_type ? 'text-gray-500 font-medium' : 'text-gray-300'}>
                                {withdrawalTypes.find(w => w.id === order.withdrawal_type_id)?.name ?? order.source_type ?? '—'}
                              </span>
                            </div>
                            {cancelled ? (
                              <span className="inline-block px-2 py-1 text-xs rounded border border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed select-none w-fit">
                                ✕ ยกเลิกแล้ว
                              </span>
                            ) : pickedUp ? (
                              <span className="inline-block px-2 py-1 text-xs rounded border border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed select-none w-fit">
                                ✎ แก้ไขไม่ได้
                              </span>
                            ) : (
                              <button
                                onClick={() => router.push(`/booking2?edit=${order.order_no}`)}
                                className="px-2 py-1 text-xs rounded bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-300 transition-colors w-fit"
                              >
                                ✎ แก้ไข
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 5. แจ้งชื่อตัวแทนสาขา */}
                        <td className="px-4 py-3 border-r border-gray-200 text-sm text-gray-500 whitespace-nowrap">
                          {order.branch_name ?? <span className="text-gray-300 text-xs">—</span>}
                        </td>

                        {/* 6. สถานะการชำระเงิน */}
                        <td className="px-4 py-3 border-r border-gray-200">
                          {cancelled ? (
                            <span className="text-gray-300 text-xs">—</span>
                          ) : paid ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-400">
                                ✅ ชำระแล้ว
                              </span>
                              {order.payment_date && (
                                <span className="text-[11px] text-gray-500">{fmtPayDate(order.payment_date)}</span>
                              )}
                              {order.payment_bank && (
                                <span className="text-[11px] text-gray-500">{order.payment_bank}</span>
                              )}
                            </div>
                          ) : isPaying ? (
                            <div className="flex flex-col gap-1.5 min-w-[180px]">
                              <div className="text-[11px] text-gray-500 font-semibold">บันทึกการชำระเงิน</div>
                              <input
                                type="date"
                                value={payDate}
                                onChange={e => setPayDate(e.target.value)}
                                className="w-full px-2 py-1 text-xs rounded border border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-400"
                              />
                              <input
                                type="text"
                                placeholder="ธนาคาร / ยอดเงิน"
                                value={payBank}
                                onChange={e => setPayBank(e.target.value)}
                                className="w-full px-2 py-1 text-xs rounded border border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-400"
                              />
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handlePayment(order.order_no)}
                                  disabled={!payDate || !payBank.trim()}
                                  className="flex-1 px-2 py-1 text-xs rounded bg-[#9b9484] hover:bg-[#9b9484] text-white font-semibold transition-colors disabled:opacity-40"
                                >
                                  ✓ ยืนยัน
                                </button>
                                <button
                                  onClick={() => { setPayingOrderNo(null); setPayDate(''); setPayBank('') }}
                                  className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-300 transition-colors"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            </div>
                          ) : isAdmin ? (
                            <button
                              onClick={() => setPayingOrderNo(order.order_no)}
                              className="px-2 py-1 text-xs rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors"
                            >
                              รอการชำระเงิน
                            </button>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
                              รอการชำระเงิน
                            </span>
                          )}
                        </td>

                        {/* 7. ขึ้นของ / พิมพ์ (combined) */}
                        <td className="px-3 py-3 text-center min-w-[140px]">
                          {cancelled ? (
                            <span className="text-gray-300 text-xs">—</span>
                          ) : pickedUp ? (
                            /* ── หลังขึ้นของแล้ว: แสดงสถานะ + ปุ่มพิมพ์ซ้ำ ── */
                            <div className="flex flex-col items-center gap-1.5">
                              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-600">
                                ✅ ขึ้นของแล้ว
                              </span>
                              {order.vehicle_type && (
                                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{order.vehicle_type}</span>
                              )}
                              <div className="flex gap-1 mt-0.5">
                                <button onClick={() => handlePrint(order)}
                                  className="px-2 py-0.5 text-[10px] rounded bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors whitespace-nowrap">
                                  🖨️ ใบจอง
                                </button>
                              </div>
                              {(isAdmin || isManager) && (
                                <button onClick={() => handleResetPickup(order)}
                                  className="text-[10px] text-gray-400 hover:text-red-500 hover:underline transition-colors">
                                  รีเซ็ต
                                </button>
                              )}
                            </div>
                          ) : (isAdmin || isManager) ? (
                            /* ── ก่อนขึ้นของ (admin/manager): ปุ่มรวม + dropdown จัดส่ง ── */
                            pickupOpen === order.order_no ? (
                              <div className="flex flex-col gap-1.5 text-left min-w-[160px]">
                                <div className="text-[10px] font-semibold text-gray-600">เลือกช่องทางจัดส่ง</div>
                                <select
                                  value={pickupDelivery}
                                  onChange={e => setPickupDelivery(e.target.value)}
                                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                                >
                                  <option value="">— เลือกการจัดส่ง —</option>
                                  {deliveries.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                  ))}
                                </select>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => handlePickupAndPrint(order)}
                                    disabled={!pickupDelivery}
                                    className="flex-1 px-2 py-1 text-[10px] rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                                  >
                                    📦 ยืนยัน+พิมพ์
                                  </button>
                                  <button
                                    onClick={() => { setPickupOpen(null); setPickupDelivery('') }}
                                    className="px-2 py-1 text-[10px] rounded bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-300 transition-colors"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setPickupOpen(order.order_no); setPickupDelivery('') }}
                                className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 transition-colors font-semibold shadow-sm whitespace-nowrap"
                              >
                                📦 ขึ้นของ / สั่งพิมพ์
                              </button>
                            )
                          ) : (
                            /* ── สาขา/ตัวแทน: แสดงสถานะ + พิมพ์ ── */
                            <div className="flex flex-col items-center gap-1.5">
                              <span className="text-gray-400 text-xs">รอดำเนินการ</span>
                              <div className="flex gap-1">
                                <button onClick={() => handlePrint(order)}
                                  className="px-2 py-0.5 text-[10px] rounded bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors whitespace-nowrap">
                                  🖨️ ใบจอง
                                </button>
                              </div>
                            </div>
                          )}
                        </td>

                      </tr>
                    )
                  })
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
