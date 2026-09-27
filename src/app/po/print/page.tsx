'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id:             number
  group_name:     string
  product_name:   string
  section_order:  number
  section_name:   string
  subgroup_order: number
  subgroup_name:  string
}

type SubgroupColor = 'gray' | 'light' | 'orange' | 'teal' | 'maroon'

type SectionRow =
  | { type: 'subgroup'; name: string; color: SubgroupColor }
  | { type: 'product';  product: CatalogProduct }
  | { type: 'foy_cat';  category: string }
  | { type: 'foy_item'; category: string; model_name: string; qty: number }

interface Section { order: number; name: string; rows: SectionRow[] }

interface POOrder {
  po_no:          string
  supplier:       string | null
  notes:          string | null
  total_amount:   string
  quantities:     Record<string, number>
  foy_quantities: Record<string, { qty: number; amount: number }>
  created_at:     string
}

type FlatRow =
  | { type: 'subgroup'; name: string; color: SubgroupColor }
  | { type: 'foy_cat';  category: string }
  | { type: 'product';  name: string; qty: number }
  | { type: 'foy_item'; category: string; model_name: string; qty: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const SUBGROUP_COLOR: Record<string, SubgroupColor> = {
  '2-1':'light','2-2':'gray','2-3':'gray','2-4':'gray','2-6':'light',
  '3-1':'gray','3-2':'gray','3-3':'gray','3-4':'gray',
  '3-5':'light','3-6':'gray','3-7':'gray','3-8':'orange','3-9':'light',
  '4-1':'light','4-2':'light','4-3':'light','4-4':'gray','4-5':'light',
  '4-6':'gray','4-7':'orange','4-8':'orange','4-9':'gray','4-10':'orange','4-11':'gray',
  '5-1':'gray','5-2':'gray','5-3':'gray','5-4':'light','5-5':'teal',
  '5-6':'gray','5-7':'gray','5-8':'orange','5-9':'orange','5-10':'gray',
  '6-1':'gray','6-2':'orange','6-3':'orange','6-4':'orange','6-5':'orange',
  '6-6':'orange','6-7':'teal',
}

const FOY_GROUP_NAMES    = new Set(['กระดาษฝอย'])
const FOY_SUBGROUP_NAMES = new Set(['กระดาษฝอย'])
const FOY_CATS_ORDER     = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก']
const FOY_MODEL_ORDER    = ['สีอ่อน', 'พิเศษ B', 'พิเศษ A', 'ครีเอท']

const FOY_ITEM_BG: Record<string, string> = {
  '2 มิล':'#FCF3CF','4 มิล':'#FAE5D3','1.5 มิล':'#FADBD8','ฝอยหยัก':'#FBDEF0',
}

// Portrait A4: width=210mm, pad=8mm each side → content ≈ 733 CSS px
const A4_W_PX   = 210 * (96 / 25.4)   // ≈ 793 px
const A4_PAD_PX = 8   * (96 / 25.4)   // ≈ 30 px
// Table columns (portrait single-column list)
const ROW_NUM_W = 22
const COL_NAME  = 611
const COL_QTY   = 100
const TABLE_W   = ROW_NUM_W + COL_NAME + COL_QTY   // ≈ 733
const CONTENT_SCALE = (A4_W_PX - A4_PAD_PX * 2) / TABLE_W   // ≈ 1.0

// ── Build sections ────────────────────────────────────────────────────────────

function buildSections(products: CatalogProduct[]): Section[] {
  const map = new Map<number, Section>()
  for (const p of products) {
    if (!map.has(p.section_order))
      map.set(p.section_order, { order: p.section_order, name: p.section_name, rows: [] })
    const sec = map.get(p.section_order)!
    if (p.section_order === 1 && sec.rows.length === 0)
      sec.rows.push({ type: 'subgroup', name: p.section_name, color: 'gray' })
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

function injectFoyRows(
  sections: Section[],
  foyPending: Record<string, { qty: number; amount: number }>,
  foyModels: { category: string; model_name: string }[]
): Section[] {
  const allCatModels = new Map<string, string[]>()
  for (const cat of FOY_CATS_ORDER) {
    const ms = foyModels.filter(it => it.category === cat).map(it => it.model_name)
    const u  = [...new Set(ms)]
    const o  = [...FOY_MODEL_ORDER.filter(m => u.includes(m)), ...u.filter(m => !FOY_MODEL_ORDER.includes(m))]
    if (o.length > 0) allCatModels.set(cat, o)
  }
  for (const key of Object.keys(foyPending)) {
    const idx = key.indexOf('|'); if (idx < 0) continue
    const cat = key.slice(0, idx); const model = key.slice(idx + 1)
    if (!allCatModels.has(cat)) allCatModels.set(cat, [])
    if (!allCatModels.get(cat)!.includes(model)) allCatModels.get(cat)!.push(model)
  }
  return sections.map(sec => {
    const hasFoy = sec.rows.some(r => r.type === 'product' && FOY_GROUP_NAMES.has(r.product.group_name))
    if (!hasFoy) return sec
    const newRows: SectionRow[] = []; let injected = false
    for (const row of sec.rows) {
      if (row.type === 'subgroup' && FOY_SUBGROUP_NAMES.has(row.name)) continue
      if (row.type === 'product' && FOY_GROUP_NAMES.has(row.product.group_name)) {
        if (!injected) { injected = true
          for (const [cat, models] of allCatModels) {
            newRows.push({ type: 'foy_cat', category: cat })
            for (const model of models) {
              const data = foyPending[`${cat}|${model}`]
              newRows.push({ type: 'foy_item', category: cat, model_name: model, qty: data?.qty ?? 0 })
            }
          }
        }
        continue
      }
      newRows.push(row)
    }
    return { ...sec, rows: newRows }
  })
}

// ── Build flat active list ────────────────────────────────────────────────────

function buildFlatRows(
  sections: Section[],
  quantities: Record<string, number>
): FlatRow[] {
  const flat: FlatRow[] = []

  for (const sec of sections) {
    // Precompute active product/foy_item rows, then activate headers above them
    const activeIdx = new Set<number>()
    for (let ri = 0; ri < sec.rows.length; ri++) {
      const cell = sec.rows[ri]
      if (cell.type === 'product' && !FOY_GROUP_NAMES.has(cell.product.group_name)) {
        if ((quantities[cell.product.id] ?? 0) > 0) activeIdx.add(ri)
      } else if (cell.type === 'foy_item' && cell.qty > 0) {
        activeIdx.add(ri)
      }
    }
    let headerIdx = -1
    for (let ri = 0; ri < sec.rows.length; ri++) {
      const cell = sec.rows[ri]
      if (cell.type === 'subgroup' || cell.type === 'foy_cat') { headerIdx = ri }
      else if (activeIdx.has(ri) && headerIdx >= 0) { activeIdx.add(headerIdx) }
    }

    // Collect active rows in order
    for (let ri = 0; ri < sec.rows.length; ri++) {
      if (!activeIdx.has(ri)) continue
      const cell = sec.rows[ri]
      if (cell.type === 'subgroup')  { flat.push({ type: 'subgroup', name: cell.name, color: cell.color }) }
      else if (cell.type === 'foy_cat') { flat.push({ type: 'foy_cat', category: cell.category }) }
      else if (cell.type === 'product') {
        const qty = quantities[cell.product.id] ?? 0
        if (qty > 0 && !FOY_GROUP_NAMES.has(cell.product.group_name))
          flat.push({ type: 'product', name: cell.product.product_name, qty })
      } else if (cell.type === 'foy_item' && cell.qty > 0) {
        flat.push({ type: 'foy_item', category: cell.category, model_name: cell.model_name, qty: cell.qty })
      }
    }
  }
  return flat
}

// ── Date helper ───────────────────────────────────────────────────────────────

function fmtThaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

// ── Inner component ───────────────────────────────────────────────────────────

function POPrintInner() {
  const poNo = useSearchParams().get('no') ?? ''

  const [order,    setOrder]    = useState<POOrder | null>(null)
  const [flatRows, setFlatRows] = useState<FlatRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentNaturalH, setContentNaturalH] = useState(0)
  const [viewScale, setViewScale] = useState(1)

  useEffect(() => {
    if (!poNo) { setError('ไม่พบเลขที่ใบPO'); setLoading(false); return }
    Promise.all([
      fetch(`/api/po?no=${encodeURIComponent(poNo)}`).then(r => r.json()),
      fetch('/api/booking2').then(r => r.json()),
      fetch('/api/stock').then(r => r.json()).catch(() => ({ items: [] })),
    ]).then(([poData, catalogData, foyData]) => {
      if (!poData) { setError(`ไม่พบใบPO: ${poNo}`); setLoading(false); return }
      const po: POOrder = poData
      setOrder(po)
      const products: CatalogProduct[] = Array.isArray(catalogData) ? catalogData : []
      const foyItems = Array.isArray(foyData) ? foyData : (foyData?.items ?? [])
      const foyModels = foyItems.map((it: { category: string; model_name: string }) => ({ category: it.category, model_name: it.model_name }))
      let secs = buildSections(products)
      secs = injectFoyRows(secs, po.foy_quantities ?? {}, foyModels)
      setFlatRows(buildFlatRows(secs, po.quantities ?? {}))
      setLoading(false)
    }).catch(() => { setError('โหลดข้อมูลล้มเหลว'); setLoading(false) })
  }, [poNo])

  useEffect(() => {
    if (!contentRef.current) return
    const obs = new ResizeObserver(() => {
      if (contentRef.current) setContentNaturalH(contentRef.current.offsetHeight)
    })
    obs.observe(contentRef.current)
    return () => obs.disconnect()
  }, [flatRows])

  useEffect(() => {
    const calc = () => setViewScale(Math.min(1, (window.innerWidth - 16) / A4_W_PX))
    calc(); window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  // Auto-print
  useEffect(() => {
    if (loading || !order || flatRows.length === 0) return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [loading, order, flatRows])

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>
  if (error)   return <div className="flex items-center justify-center h-screen text-red-500">{error}</div>
  if (!order)  return null

  const total = parseFloat(order.total_amount) || 0
  const scaledFrameH = contentNaturalH * CONTENT_SCALE + A4_PAD_PX * 2

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body, html { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .a4-frame { box-shadow: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          td:not(.print-sg) { background-color: white !important; }
          .print-sg { background-color: inherit !important; }
        }
      `}</style>

      {/* Screen toolbar */}
      <div className="no-print bg-[#4e7a5e] text-white px-4 py-2 flex items-center gap-4 shadow">
        <button onClick={() => window.close()}
          className="text-white/80 hover:text-white text-sm px-3 py-1.5 rounded border border-white/30 hover:bg-white/10 transition-colors">
          ✕ ปิด
        </button>
        <div className="flex-1 font-bold">{order.po_no}</div>
        <button onClick={() => window.print()}
          className="bg-white text-[#4e7a5e] font-bold text-sm px-5 py-1.5 rounded shadow hover:bg-green-50 transition-colors">
          🖨️ พิมพ์
        </button>
      </div>

      {/* A4 portrait wrapper */}
      <div className="py-3 px-2 flex justify-center print:p-0 print:justify-start">
        <div style={viewScale < 1 ? {
          transform: `scale(${viewScale})`,
          transformOrigin: 'top left',
          marginRight: `${-A4_W_PX * (1 - viewScale)}px`,
          ...(scaledFrameH > 0 ? { marginBottom: `${-(scaledFrameH * (1 - viewScale))}px` } : {}),
        } : undefined}>
          <div className="a4-frame bg-white shadow-xl"
            style={{ width: '210mm', minHeight: '297mm', padding: '8mm', boxSizing: 'border-box' }}>

            <div ref={contentRef} style={{
              transform: `scale(${CONTENT_SCALE})`,
              transformOrigin: 'top left',
              width: TABLE_W,
              marginRight: `${-TABLE_W * (1 - CONTENT_SCALE)}px`,
              ...(contentNaturalH > 0 ? { marginBottom: `${-(contentNaturalH * (1 - CONTENT_SCALE))}px` } : {}),
            }}>

              {/* ── Title ─────────────────────────────────────────────────── */}
              <div className="text-center mb-3">
                <div className="text-[30px] font-extrabold text-[#4e7a5e] leading-tight">ใบPO</div>
                <div className="text-[13px] text-gray-500 mt-0.5">
                  เลขที่: <span className="font-semibold text-gray-700">{order.po_no}</span>
                </div>
              </div>

              {/* ── Info row ──────────────────────────────────────────────── */}
              <div className="flex border border-gray-300 rounded mb-3 text-[12px] overflow-hidden">
                <div className="flex-1 px-3 py-1.5 border-r border-gray-200">
                  <span className="font-semibold text-gray-500">วันที่: </span>
                  <span className="text-gray-700">{fmtThaiDate(order.created_at)}</span>
                </div>
                <div className="flex-1 px-3 py-1.5 border-r border-gray-200">
                  <span className="font-semibold text-gray-500">ซัพพลายเออร์: </span>
                  <span className="text-gray-700">{order.supplier ?? '-'}</span>
                </div>
                <div className="flex-1 px-3 py-1.5">
                  <span className="font-semibold text-gray-500">หมายเหตุ: </span>
                  <span className="text-gray-700">{order.notes ?? ''}</span>
                </div>
              </div>

              {/* ── Product table (portrait single-column) ────────────────── */}
              <div className="rounded overflow-hidden border border-gray-400 shadow-sm">
                <table className="text-[13px] leading-[1.4] border-collapse w-full"
                  style={{ tableLayout: 'fixed', width: TABLE_W }}>
                  <colgroup>
                    <col style={{ width: ROW_NUM_W }} />
                    <col style={{ width: COL_NAME }} />
                    <col style={{ width: COL_QTY }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#4e7a5e] text-white">
                      <th className="border border-[#3d6149] px-1 py-1.5 text-center text-[10px] font-semibold">#</th>
                      <th className="border border-[#3d6149] px-2 py-1.5 text-left text-[11px] font-semibold">รายการสินค้า</th>
                      <th className="border border-[#3d6149] px-2 py-1.5 text-right text-[11px] font-semibold">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let rowNum = 0
                      return flatRows.map((row, i) => {
                        if (row.type === 'subgroup') {
                          return (
                            <tr key={i}>
                              <td colSpan={3}
                                className="border px-3 py-px text-[11px] font-bold text-white print-sg bg-[#4e7a5e]">
                                {row.name}
                              </td>
                            </tr>
                          )
                        }
                        if (row.type === 'foy_cat') {
                          return (
                            <tr key={i}>
                              <td colSpan={3}
                                style={{ backgroundColor: '#4e7a5e' }}
                                className="border px-3 py-px text-[10px] font-bold text-white print-sg">
                                กระดาษฝอย {row.category}
                              </td>
                            </tr>
                          )
                        }
                        if (row.type === 'foy_item') {
                          rowNum++
                          const bg = FOY_ITEM_BG[row.category] ?? '#fefce8'
                          return (
                            <tr key={i} className={rowNum % 2 === 0 ? '' : ''}>
                              <td style={{ backgroundColor: bg }}
                                className="border border-gray-200 text-center text-[10px] text-gray-400 py-1">
                                {rowNum}
                              </td>
                              <td style={{ backgroundColor: bg }}
                                className="border border-gray-200 px-2 py-1 text-gray-700">
                                {row.model_name}
                              </td>
                              <td style={{ backgroundColor: bg }}
                                className="border border-gray-200 px-2 py-1 text-right font-semibold text-gray-700">
                                ×{row.qty.toLocaleString('th-TH')}
                              </td>
                            </tr>
                          )
                        }
                        // product
                        rowNum++
                        return (
                          <tr key={i} className={rowNum % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                            <td className="border border-gray-200 text-center text-[10px] text-gray-400 py-1">
                              {rowNum}
                            </td>
                            <td className="border border-gray-200 px-2 py-1 text-gray-700">
                              {row.name}
                            </td>
                            <td className="border border-gray-200 px-2 py-1 text-right font-semibold text-[#4e7a5e]">
                              ×{row.qty.toLocaleString('th-TH')}
                            </td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>

              {/* ── Total ─────────────────────────────────────────────────── */}
              {total > 0 && (
                <div className="text-right mt-2 pr-1">
                  <span className="text-[14px] font-bold text-gray-600">ยอดรวม </span>
                  <span className="text-[22px] font-extrabold text-[#4e7a5e]">
                    {total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[14px] font-bold text-gray-600"> บาท</span>
                </div>
              )}

              {/* ── Signature boxes ───────────────────────────────────────── */}
              <div className="flex gap-4 mt-4" style={{ width: TABLE_W }}>
                <div className="flex-1 border border-gray-300 rounded px-4 py-3 min-h-[90px]">
                  <div className="text-[12px] font-bold text-gray-500 mb-1">ผู้ส่งสินค้า</div>
                  <div className="mt-10 border-t border-gray-300 pt-1 text-[10px] text-gray-400">
                    ลงชื่อ ________________________ วันที่ ____________
                  </div>
                </div>
                <div className="flex-1 border border-gray-300 rounded px-4 py-3 min-h-[90px]">
                  <div className="text-[12px] font-bold text-gray-500 mb-1">ผู้รับสินค้า</div>
                  <div className="mt-10 border-t border-gray-300 pt-1 text-[10px] text-gray-400">
                    ลงชื่อ ________________________ วันที่ ____________
                  </div>
                </div>
              </div>

            </div>{/* /content */}
          </div>{/* /a4-frame */}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function POPrintPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>}>
      <POPrintInner />
    </Suspense>
  )
}
