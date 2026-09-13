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
  status: string
  payment_status: string
  payment_date: string | null
  payment_bank: string | null
  pickup_status: string
  source_type: string | null
  vehicle_type: string | null
  branch_name: string | null
  created_at: string
  updated_at: string
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

  // Print state
  const [products, setProducts]     = useState<CatalogProduct[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [printOrder, setPrintOrder] = useState<BookingOrder | null>(null)
  const [printType, setPrintType]   = useState<'booking' | 'foy' | null>(null)

  // Role
  const [isAdmin, setIsAdmin]       = useState(true)
  const [branchName, setBranchName] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/orders')
      .then(r => r.json())
      .then((data: BookingOrder[]) => { setOrders(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch catalog + stock for print (parallel, once)
  useEffect(() => {
    fetch('/api/booking2').then(r => r.json()).then(setProducts).catch(() => {})
    fetch('/api/stock').then(r => r.json()).then(setStockItems).catch(() => {})
  }, [])

  // Read role + branch from branch_session
  useEffect(() => {
    try {
      const bs = localStorage.getItem('branch_session')
      if (bs) {
        const s = JSON.parse(bs)
        setIsAdmin(s?.is_admin !== false)
        if (s?.branch_name) setBranchName(s.branch_name)
      }
    } catch { /* ignore */ }
  }, [])

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

  const handlePrint = (order: BookingOrder, type: 'booking' | 'foy') => {
    setPrintType(type)
    setPrintOrder(order)
  }

  // ── Print render: ใบจอง ────────────────────────────────────────────────────

  function BookingPrint({ order }: { order: BookingOrder }) {
    type BookedItem = { product: CatalogProduct; qty: number; total: number }
    const productMap = new Map(products.map(p => [p.id, p]))
    const sectionMap = new Map<string, { order: number; items: BookedItem[] }>()

    for (const [idStr, qty] of Object.entries(order.quantities ?? {})) {
      if (!qty) continue
      const p = productMap.get(Number(idStr))
      if (!p) continue
      const price = parseFloat(p.price ?? '0') || 0
      if (!sectionMap.has(p.section_name)) {
        sectionMap.set(p.section_name, { order: p.section_order, items: [] })
      }
      sectionMap.get(p.section_name)!.items.push({ product: p, qty, total: price * qty })
    }

    const sections = Array.from(sectionMap.entries())
      .sort(([, a], [, b]) => a.order - b.order)

    const foyEntries = Object.entries(order.foy_quantities ?? {}).filter(([, d]) => d.qty > 0)
    const grandTotal = parseFloat(order.total_amount)
    const orderDate  = fmtOrderDate(order.updated_at)

    const tdBase: React.CSSProperties = { padding: '1.5mm 2mm', border: '1px solid #ccc', fontSize: '8.5pt' }
    const thBase: React.CSSProperties = { padding: '2mm', border: '1px solid #888', fontSize: '8.5pt', backgroundColor: '#9b9484', color: 'white' }

    return (
      <div style={{ width: '210mm', height: '297mm', padding: '8mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: 'sans-serif' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
          <div style={{ fontSize: '16pt', fontWeight: 'bold', color: '#4ade80' }}>ใบจองสินค้า</div>
          <div style={{ fontSize: '9pt', color: '#555' }}>เลขที่: {order.order_no}</div>
        </div>

        {/* Info bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '2mm', marginBottom: '3mm', border: '1px solid #ccc', padding: '2.5mm', borderRadius: '1mm', backgroundColor: '#f9fafb', fontSize: '8.5pt' }}>
          <div><strong>วันที่:</strong> {orderDate}</div>
          <div><strong>เบิกของ:</strong> {order.source_type ?? '—'}</div>
          <div><strong>รถ:</strong> {order.vehicle_type ?? '—'}</div>
          <div><strong>สาขา/ตัวแทน:</strong> {order.branch_name ?? '—'}</div>
        </div>

        {/* Product table */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '28mm' }} />
              <col />
              <col style={{ width: '22mm' }} />
              <col style={{ width: '14mm' }} />
              <col style={{ width: '24mm' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...thBase, textAlign: 'left' }}>หมวดหมู่</th>
                <th style={{ ...thBase, textAlign: 'left' }}>ชื่อสินค้า</th>
                <th style={{ ...thBase, textAlign: 'right' }}>ราคา/หน่วย</th>
                <th style={{ ...thBase, textAlign: 'right' }}>จำนวน</th>
                <th style={{ ...thBase, textAlign: 'right' }}>รวม (฿)</th>
              </tr>
            </thead>
            <tbody>
              {sections.flatMap(([sectionName, { items }]) =>
                items.map((item, idx) => (
                  <tr key={`${sectionName}-${idx}`} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f5f5f5' }}>
                    {idx === 0 && (
                      <td rowSpan={items.length} style={{ ...tdBase, fontWeight: 'bold', color: '#444', textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#e8f5e9', fontSize: '7.5pt' }}>
                        {sectionName}
                      </td>
                    )}
                    <td style={{ ...tdBase }}>{item.product.product_name}</td>
                    <td style={{ ...tdBase, textAlign: 'right' }}>
                      {item.product.price ? parseFloat(item.product.price).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold' }}>{item.qty}</td>
                    <td style={{ ...tdBase, textAlign: 'right' }}>{item.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))
              )}

              {/* FOY summary rows */}
              {foyEntries.map(([model, data]) => (
                <tr key={`foy-${model}`} style={{ backgroundColor: '#f0fdf4' }}>
                  <td style={{ ...tdBase, fontWeight: 'bold', color: '#166534', textAlign: 'center', fontSize: '7.5pt' }}>กระดาษฝอย</td>
                  <td style={{ ...tdBase, color: '#166534' }}>{model}</td>
                  <td style={{ ...tdBase, textAlign: 'right', color: '#166534' }}>—</td>
                  <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', color: '#166534' }}>{data.qty}</td>
                  <td style={{ ...tdBase, textAlign: 'right', color: '#166534' }}>{data.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#d1fae5' }}>
                <td colSpan={4} style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', borderColor: '#888' }}>ยอดเงินรวม</td>
                <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', color: '#14532d', borderColor: '#888' }}>
                  {fmtMoney(grandTotal)} บาท
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Signature area */}
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
    )
  }

  // ── Print render: ใบจองกระดาษฝอย ──────────────────────────────────────────

  function FoyPrint({ order }: { order: BookingOrder }) {
    type FoyItem = { item: StockItem; qty: number; total: number }
    const stockMap = new Map(stockItems.map(s => [s.id, s]))
    const modelMap = new Map<string, FoyItem[]>()

    for (const [idStr, qty] of Object.entries(order.foy_item_quantities ?? {})) {
      if (!qty) continue
      const s = stockMap.get(Number(idStr))
      if (!s) continue
      const price = parseFloat(s.warehouse_price ?? '0') || 0
      if (!modelMap.has(s.model_name)) modelMap.set(s.model_name, [])
      modelMap.get(s.model_name)!.push({ item: s, qty, total: price * qty })
    }

    // Fallback: if no item-level data, use model-level summary from foy_quantities
    const hasFoyItems = modelMap.size > 0
    const foyQtyEntries = Object.entries(order.foy_quantities ?? {}).filter(([, d]) => d.qty > 0)

    const grandTotal = hasFoyItems
      ? Array.from(modelMap.values()).flat().reduce((s, i) => s + i.total, 0)
      : foyQtyEntries.reduce((s, [, d]) => s + d.amount, 0)

    const orderDate = fmtOrderDate(order.updated_at)

    const tdBase: React.CSSProperties = { padding: '1.5mm 2mm', border: '1px solid #ccc', fontSize: '8.5pt' }
    const thBase: React.CSSProperties = { padding: '2mm', border: '1px solid #888', fontSize: '8.5pt', backgroundColor: '#0f766e', color: 'white' }

    return (
      <div style={{ width: '210mm', height: '297mm', padding: '8mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: 'sans-serif' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
          <div style={{ fontSize: '16pt', fontWeight: 'bold', color: '#0f766e' }}>ใบจองกระดาษฝอย</div>
          <div style={{ fontSize: '9pt', color: '#555' }}>เลขที่: {order.order_no}</div>
        </div>

        {/* Info bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '2mm', marginBottom: '3mm', border: '1px solid #ccc', padding: '2.5mm', borderRadius: '1mm', backgroundColor: '#f0fdfa', fontSize: '8.5pt' }}>
          <div><strong>วันที่:</strong> {orderDate}</div>
          <div><strong>เบิกของ:</strong> {order.source_type ?? '—'}</div>
          <div><strong>รถ:</strong> {order.vehicle_type ?? '—'}</div>
          <div><strong>สาขา/ตัวแทน:</strong> {order.branch_name ?? '—'}</div>
        </div>

        {/* FOY table */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {hasFoyItems ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '30mm' }} />
                <col />
                <col style={{ width: '40mm' }} />
                <col style={{ width: '16mm' }} />
                <col style={{ width: '24mm' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thBase, textAlign: 'left' }}>รุ่น</th>
                  <th style={{ ...thBase, textAlign: 'left' }}>รหัสสี</th>
                  <th style={{ ...thBase, textAlign: 'left' }}>ชื่อสี</th>
                  <th style={{ ...thBase, textAlign: 'right' }}>จำนวน</th>
                  <th style={{ ...thBase, textAlign: 'right' }}>รวม (฿)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(modelMap.entries()).flatMap(([modelName, items]) =>
                  items.map((item, idx) => (
                    <tr key={`${modelName}-${idx}`} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f5f5f5' }}>
                      {idx === 0 && (
                        <td rowSpan={items.length} style={{ ...tdBase, fontWeight: 'bold', color: '#4ade80', textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#ccfbf1', fontSize: '7.5pt' }}>
                          {modelName}
                        </td>
                      )}
                      <td style={{ ...tdBase, fontFamily: 'monospace' }}>{item.item.color_code}</td>
                      <td style={{ ...tdBase }}>{item.item.color_name}</td>
                      <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold' }}>{item.qty}</td>
                      <td style={{ ...tdBase, textAlign: 'right' }}>
                        {item.total ? item.total.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#ccfbf1' }}>
                  <td colSpan={4} style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', borderColor: '#888' }}>ยอดเงินรวม</td>
                  <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', color: '#4ade80', borderColor: '#888' }}>
                    {grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : foyQtyEntries.length > 0 ? (
            /* Fallback: model-level summary only */
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thBase, textAlign: 'left' }}>รุ่น</th>
                  <th style={{ ...thBase, textAlign: 'right' }}>จำนวน</th>
                  <th style={{ ...thBase, textAlign: 'right' }}>รวม (฿)</th>
                </tr>
              </thead>
              <tbody>
                {foyQtyEntries.map(([model, data], idx) => (
                  <tr key={model} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f5f5f5' }}>
                    <td style={{ ...tdBase }}>{model}</td>
                    <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold' }}>{data.qty}</td>
                    <td style={{ ...tdBase, textAlign: 'right' }}>{data.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#ccfbf1' }}>
                  <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', borderColor: '#888' }} colSpan={2}>ยอดเงินรวม</td>
                  <td style={{ ...tdBase, textAlign: 'right', fontWeight: 'bold', fontSize: '10pt', color: '#4ade80', borderColor: '#888' }}>
                    {grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div style={{ padding: '10mm', textAlign: 'center', color: '#aaa', fontSize: '10pt' }}>ไม่มีรายการกระดาษฝอย</div>
          )}
        </div>

        {/* Signature area */}
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
    )
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
        {printType === 'foy'     && printOrder && <FoyPrint     order={printOrder} />}
      </div>

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
          {msg && (
            <span className="text-sm px-3 py-1 rounded-full bg-red-500 text-white">{msg}</span>
          )}
        </header>

        {/* Main */}
        <main className="p-4 overflow-x-auto">
          {loading ? (
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
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">ขึ้นของ</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">แจ้งชื่อตัวแทนสาขา</th>
                    <th className="px-4 py-2 whitespace-nowrap border-r border-gray-500">สถานะการชำระเงิน</th>
                    <th className="px-4 py-2 whitespace-nowrap text-center">พิมพ์</th>
                  </tr>
                </thead>
                <tbody>
                  {(isAdmin ? orders : orders.filter(o => o.branch_name === branchName)).map((order, i) => {
                    const cancelled = order.status === 'cancelled'
                    const pickedUp  = order.pickup_status === 'picked_up'
                    const paid      = order.payment_status === 'paid'
                    const isPaying  = payingOrderNo === order.order_no
                    const hasFoy    = Object.keys(order.foy_quantities ?? {}).length > 0 ||
                                      Object.keys(order.foy_item_quantities ?? {}).length > 0

                    return (
                      <tr key={order.id} className={cancelled ? 'bg-red-50 opacity-60' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>

                        {/* 1. เลขที่ใบจอง */}
                        <td className="px-4 py-3 border-r border-gray-200 font-mono font-bold text-green-400 text-base">
                          {order.order_no}
                        </td>

                        {/* 2. ยอดเงินรวม */}
                        <td className="px-4 py-3 border-r border-gray-200 text-right font-semibold">
                          {fmtMoney(order.total_amount)}
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
                              <span className={order.source_type ? 'text-gray-500 font-medium' : 'text-gray-300'}>
                                {order.source_type ?? '—'}
                              </span>
                            </div>
                            {cancelled ? (
                              <span className="inline-block px-2 py-1 text-xs rounded border border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed select-none w-fit">
                                ✕ ยกเลิกแล้ว
                              </span>
                            ) : pickedUp ? (
                              <span className="inline-block px-2 py-1 text-xs rounded border border-red-200 bg-red-50 text-red-400 cursor-not-allowed select-none w-fit">
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

                        {/* 5. ขึ้นของ */}
                        <td className="px-4 py-3 border-r border-gray-200 text-center">
                          {cancelled ? (
                            <span className="text-gray-300 text-xs">—</span>
                          ) : pickedUp ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-400">
                                ✅ ขึ้นของแล้ว
                              </span>
                              {isAdmin && (
                                <button
                                  onClick={() => handleResetPickup(order)}
                                  className="text-[10px] text-gray-400 hover:text-red-500 hover:underline transition-colors"
                                >
                                  รีเซ็ต
                                </button>
                              )}
                            </div>
                          ) : isAdmin ? (
                            <button
                              onClick={() => handlePickup(order)}
                              className="px-3 py-1 text-xs rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-300 transition-colors font-medium"
                            >
                              📦 ขึ้นของ
                            </button>
                          ) : (
                            <span className="text-gray-300 text-xs">รอดำเนินการ</span>
                          )}
                        </td>

                        {/* 6. แจ้งชื่อตัวแทนสาขา */}
                        <td className="px-4 py-3 border-r border-gray-200 text-sm text-gray-500 whitespace-nowrap">
                          {order.branch_name ?? <span className="text-gray-300 text-xs">—</span>}
                        </td>

                        {/* 7. สถานะการชำระเงิน */}
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

                        {/* 8. ปุ่มพิมพ์ */}
                        <td className="px-3 py-3 text-center">
                          <div className="flex flex-col gap-1.5 items-center">
                            <button
                              onClick={() => handlePrint(order, 'booking')}
                              className="px-2 py-1 text-xs rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors whitespace-nowrap font-medium"
                            >
                              🖨️ ใบจอง
                            </button>
                            <button
                              onClick={() => handlePrint(order, 'foy')}
                              disabled={!hasFoy}
                              className="px-2 py-1 text-xs rounded bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 transition-colors whitespace-nowrap font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              🖨️ ฝอย
                            </button>
                          </div>
                        </td>

                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
