'use client'

import { Fragment, useState, useEffect, useRef, Suspense } from 'react'
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

interface Section {
  order: number
  name:  string
  rows:  SectionRow[]
}

interface POOrder {
  id:               number
  po_no:            string
  status:           string
  supplier:         string | null
  notes:            string | null
  total_amount:     string
  quantities:       Record<string, number>
  foy_quantities:   Record<string, { qty: number; amount: number }>
  created_at:       string
}

// ── Sub-group colors ──────────────────────────────────────────────────────────

const SUBGROUP_COLOR: Record<string, SubgroupColor> = {
  '2-1': 'light',  '2-2': 'gray',   '2-3': 'gray',   '2-4': 'gray',  '2-6': 'light',
  '3-1': 'gray',   '3-2': 'gray',   '3-3': 'gray',   '3-4': 'gray',
  '3-5': 'light',  '3-6': 'gray',   '3-7': 'gray',   '3-8': 'orange', '3-9': 'light',
  '4-1': 'light',  '4-2': 'light',  '4-3': 'light',  '4-4': 'gray',  '4-5': 'light',
  '4-6': 'gray',   '4-7': 'orange', '4-8': 'orange', '4-9': 'gray',  '4-10': 'orange',
  '4-11': 'gray',
  '5-1': 'gray',   '5-2': 'gray',   '5-3': 'gray',   '5-4': 'light', '5-5': 'teal',
  '5-6': 'gray',   '5-7': 'gray',   '5-8': 'orange', '5-9': 'orange','5-10': 'gray',
  '6-1': 'gray',   '6-2': 'orange', '6-3': 'orange', '6-4': 'orange','6-5': 'orange',
  '6-6': 'orange', '6-7': 'teal',
}

const FOY_SUBGROUP_NAMES = new Set(['กระดาษฝอย'])
const FOY_GROUP_NAMES    = new Set(['กระดาษฝอย'])
const FOY_CATS_ORDER     = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก']
const FOY_MODEL_ORDER    = ['สีอ่อน', 'พิเศษ B', 'พิเศษ A', 'ครีเอท']

const FOY_ITEM_BG: Record<string, string> = {
  '2 มิล':   '#FCF3CF',
  '4 มิล':   '#FAE5D3',
  '1.5 มิล': '#FADBD8',
  'ฝอยหยัก': '#FBDEF0',
}

// ── Column widths (same total TABLE_W as po/page.tsx → same A4 scale) ─────────
// Original per-section: name(82) + price(54) + qty(44) + total(62) = 242
// Print (no price/total): name(198) + qty(44) = 242 → identical TABLE_W
const ROW_NUM_W   = 24
const COL_NAME    = 198
const COL_QTY     = 44
const TABLE_W     = ROW_NUM_W + 6 * (COL_NAME + COL_QTY)   // = 24 + 6*242 = 1476

const A4_W_PX       = 297 * (96 / 25.4)
const A4_PAD_PX     = 8   * (96 / 25.4)
const CONTENT_SCALE = (A4_W_PX - A4_PAD_PX * 2) / TABLE_W

const INFO_PANEL_ROWS = 9

// ── Build sections ────────────────────────────────────────────────────────────

function buildSections(products: CatalogProduct[]): Section[] {
  const map = new Map<number, Section>()
  for (const p of products) {
    if (!map.has(p.section_order)) {
      map.set(p.section_order, { order: p.section_order, name: p.section_name, rows: [] })
    }
    const sec = map.get(p.section_order)!
    if (p.section_order === 1 && sec.rows.length === 0) {
      sec.rows.push({ type: 'subgroup', name: p.section_name, color: 'gray' })
    }
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
  foyStockModels: { category: string; model_name: string }[]
): Section[] {
  // Build category→models map from foy stock
  const allCatModels = new Map<string, string[]>()
  for (const cat of FOY_CATS_ORDER) {
    const models = foyStockModels
      .filter(it => it.category === cat)
      .map(it => it.model_name)
    const unique  = [...new Set(models)]
    const ordered = [
      ...FOY_MODEL_ORDER.filter(m => unique.includes(m)),
      ...unique.filter(m => !FOY_MODEL_ORDER.includes(m)),
    ]
    if (ordered.length > 0) allCatModels.set(cat, ordered)
  }

  // Also include any cat/model from foyPending even if not in stock
  for (const [key] of Object.entries(foyPending)) {
    const idx = key.indexOf('|')
    if (idx === -1) continue
    const cat   = key.slice(0, idx)
    const model = key.slice(idx + 1)
    if (!allCatModels.has(cat)) allCatModels.set(cat, [])
    if (!allCatModels.get(cat)!.includes(model)) allCatModels.get(cat)!.push(model)
  }

  return sections.map(sec => {
    const hasFoy = sec.rows.some(r => r.type === 'product' && FOY_GROUP_NAMES.has(r.product.group_name))
    if (!hasFoy) return sec

    const newRows: SectionRow[] = []
    let foyInjected = false
    for (const row of sec.rows) {
      if (row.type === 'subgroup' && FOY_SUBGROUP_NAMES.has(row.name)) continue
      if (row.type === 'product' && FOY_GROUP_NAMES.has(row.product.group_name)) {
        if (!foyInjected) {
          foyInjected = true
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

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtThaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

// ── Print inner ───────────────────────────────────────────────────────────────

function POPrintInner() {
  const searchParams  = useSearchParams()
  const poNo          = searchParams.get('no') ?? ''

  const [order,    setOrder]    = useState<POOrder | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const contentRef              = useRef<HTMLDivElement>(null)
  const [contentNaturalH, setContentNaturalH] = useState(0)
  const [viewScale, setViewScale]             = useState(1)

  // Fetch PO + catalog in parallel
  useEffect(() => {
    if (!poNo) { setError('ไม่พบเลขที่ใบPO'); setLoading(false); return }

    Promise.all([
      fetch(`/api/po?no=${encodeURIComponent(poNo)}`).then(r => r.json()),
      fetch('/api/booking2').then(r => r.json()),
      fetch('/api/stock').then(r => r.json()).catch(() => ({ items: [] })),  // foy stock models
    ]).then(([poData, catalogData, foyData]) => {
      if (!poData) { setError(`ไม่พบใบPO: ${poNo}`); setLoading(false); return }

      const po: POOrder = poData
      setOrder(po)

      const products: CatalogProduct[] = Array.isArray(catalogData) ? catalogData : []
      let secs = buildSections(products)

      // Inject FOY rows using foy_quantities from the PO
      const foyItems = Array.isArray(foyData) ? foyData : (foyData?.items ?? [])
      const foyModels: { category: string; model_name: string }[] = foyItems.map(
        (it: { category: string; model_name: string }) => ({ category: it.category, model_name: it.model_name })
      )

      secs = injectFoyRows(secs, po.foy_quantities ?? {}, foyModels)
      setSections(secs)
      setLoading(false)
    }).catch(() => {
      setError('โหลดข้อมูลล้มเหลว')
      setLoading(false)
    })
  }, [poNo])

  // Auto-print once content is rendered and measured
  useEffect(() => {
    if (loading || !order || sections.length === 0) return
    // Small delay so layout paints first
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [loading, order, sections])

  // Measure content height for scaling
  useEffect(() => {
    if (!contentRef.current) return
    const obs = new ResizeObserver(() => {
      if (contentRef.current) setContentNaturalH(contentRef.current.offsetHeight)
    })
    obs.observe(contentRef.current)
    return () => obs.disconnect()
  }, [sections])

  // Viewport scale
  useEffect(() => {
    const calc = () => setViewScale(Math.min(1, (window.innerWidth - 16) / A4_W_PX))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>
  if (error)   return <div className="flex items-center justify-center h-screen text-red-500">{error}</div>
  if (!order)  return null

  const maxRows    = Math.max(...sections.map(s => s.rows.length), 0) + INFO_PANEL_ROWS
  const panelStart = Math.max(...sections.map(s => s.rows.length), 0)

  // ── Precompute which rows are "active" (have qty > 0) per section ─────────
  const activeRowsPerSection: Set<number>[] = sections.map(sec => {
    const active = new Set<number>()

    // Pass 1 — mark product/foy_item rows that have qty > 0
    for (let ri = 0; ri < sec.rows.length; ri++) {
      const cell = sec.rows[ri]
      if (cell.type === 'product' && !FOY_GROUP_NAMES.has(cell.product.group_name)) {
        if ((order.quantities[cell.product.id] ?? 0) > 0) active.add(ri)
      } else if (cell.type === 'foy_item') {
        if (cell.qty > 0) active.add(ri)
      }
    }

    // Pass 2 — activate the nearest subgroup/foy_cat header above each active row
    let headerIdx = -1
    for (let ri = 0; ri < sec.rows.length; ri++) {
      const cell = sec.rows[ri]
      if (cell.type === 'subgroup' || cell.type === 'foy_cat') {
        headerIdx = ri
      } else if (active.has(ri) && headerIdx >= 0) {
        active.add(headerIdx)
      }
    }

    return active
  })

  // A table row renders in print only if ≥1 section has it active (or it's the info panel)
  const rowActiveInPrint = (rowIdx: number) =>
    rowIdx >= panelStart || sections.some((_, si) => activeRowsPerSection[si].has(rowIdx))

  const scaledFrameH = contentNaturalH * CONTENT_SCALE + A4_PAD_PX * 2

  const poDate = fmtThaiDate(order.created_at)
  const total  = parseFloat(order.total_amount) || 0

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          body, html { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .a4-frame { box-shadow: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .a4-frame td:not(.print-sg) { background-color: white !important; }
          .print-sg { background-color: inherit !important; }
          .compact-hide { display: none !important; }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print bg-[#4e7a5e] text-white px-4 py-2 flex items-center gap-4 shadow">
        <button
          onClick={() => window.close()}
          className="text-white/80 hover:text-white text-sm px-3 py-1.5 rounded border border-white/30 hover:bg-white/10 transition-colors">
          ✕ ปิด
        </button>
        <div className="flex-1">
          <span className="font-bold">ใบPO </span>
          <span className="text-white/80 text-sm">{order.po_no}</span>
          {order.supplier && <span className="text-white/60 text-sm ml-2">· {order.supplier}</span>}
        </div>
        <button
          onClick={() => window.print()}
          className="bg-white text-[#4e7a5e] font-bold text-sm px-5 py-1.5 rounded shadow hover:bg-green-50 transition-colors">
          🖨️ พิมพ์
        </button>
      </div>

      {/* A4 frame */}
      <div className="py-3 px-2 flex justify-center print:p-0 print:justify-start">
        <div style={viewScale < 1 ? {
          transform: `scale(${viewScale})`,
          transformOrigin: 'top left',
          marginRight: `${-A4_W_PX * (1 - viewScale)}px`,
          ...(scaledFrameH > 0 ? { marginBottom: `${-(scaledFrameH * (1 - viewScale))}px` } : {}),
        } : undefined}>
          <div className="a4-frame bg-white shadow-xl"
            style={{ width: '297mm', minHeight: '210mm', padding: '8mm', boxSizing: 'border-box' }}>
            <div
              ref={contentRef}
              style={{
                transform: `scale(${CONTENT_SCALE})`,
                transformOrigin: 'top left',
                width: TABLE_W,
                marginRight: `${-TABLE_W * (1 - CONTENT_SCALE)}px`,
                ...(contentNaturalH > 0 ? { marginBottom: `${-(contentNaturalH * (1 - CONTENT_SCALE))}px` } : {}),
              }}>

              <div className="inline-block rounded shadow overflow-hidden border border-gray-400">
                <table
                  className="text-[13px] leading-[1.35] border-collapse"
                  style={{ tableLayout: 'fixed', width: TABLE_W }}>

                  <colgroup>
                    <col style={{ width: ROW_NUM_W }} />
                    {sections.flatMap(sec => [
                      <col key={`${sec.order}-cn`} style={{ width: COL_NAME }} />,
                      <col key={`${sec.order}-cq`} style={{ width: COL_QTY }} />,
                    ])}
                  </colgroup>

                  <thead>
                    {/* Row 1: document title + section names */}
                    <tr>
                      <th
                        rowSpan={2}
                        className="border border-gray-400 text-center align-middle bg-[#4e7a5e] text-white"
                        style={{ fontSize: 9, writingMode: 'vertical-rl', transform: 'rotate(180deg)', padding: '2px 1px' }}>
                        ใบPO
                      </th>
                      {sections.map(sec => (
                        <th key={sec.order} colSpan={2}
                          className="border border-gray-400 px-1 py-0.5 text-center text-[11px] font-bold bg-[#4e7a5e] text-white print-sg">
                          {sec.name}
                        </th>
                      ))}
                    </tr>
                    {/* Row 2: column labels */}
                    <tr>
                      {sections.map(sec => (
                        <Fragment key={sec.order}>
                          <th className="border border-gray-300 px-1 py-0.5 text-[10px] font-semibold text-gray-600 bg-gray-100 text-left">รายการ</th>
                          <th className="border border-gray-300 px-1 py-0.5 text-[10px] font-semibold text-gray-600 bg-gray-100 text-right">จำนวน</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {Array.from({ length: maxRows }, (_, rowIdx) => (
                      <tr key={rowIdx}
                        className={`hover:bg-green-50/20 transition-colors${!rowActiveInPrint(rowIdx) ? ' compact-hide' : ''}`}>
                        {/* Row number */}
                        <td className="border border-gray-300 text-center text-[9px] text-gray-400 py-0.5 select-none">
                          {rowIdx + 1}
                        </td>

                        {sections.flatMap((sec, si) => {
                          // ── Info panel (last section, bottom rows) ──────────
                          if (si === sections.length - 1 && rowIdx >= panelStart) {
                            const pr = rowIdx - panelStart

                            // pr 0-2: ผู้ส่งสินค้า | ผู้รับสินค้า
                            if (pr === 0) return [
                              <td key="ip-sig" colSpan={2} rowSpan={3}
                                className="border border-gray-300 p-1 align-top">
                                <div className="flex h-full">
                                  <div className="flex-1 border-r border-gray-300 pr-1">
                                    <div className="text-[10px] font-extrabold text-gray-500 mb-0.5">ผู้ส่งสินค้า</div>
                                  </div>
                                  <div className="flex-1 pl-1">
                                    <div className="text-[10px] font-extrabold text-gray-500 mb-0.5">ผู้รับสินค้า</div>
                                  </div>
                                </div>
                              </td>,
                            ]
                            if (pr === 1 || pr === 2) return []

                            // pr 3-4: เลขที่ใบPO | วันที่
                            if (pr === 3) return [
                              <td key="ip-pono" colSpan={1} rowSpan={2}
                                className="border border-gray-300 p-1 bg-green-50 align-middle">
                                <div className="flex flex-col justify-center h-full">
                                  <div className="text-[8px] text-gray-500 font-semibold leading-none">เลขที่ใบPO</div>
                                  <div className="text-[14px] font-extrabold text-[#4e7a5e] leading-tight mt-0.5">{order.po_no}</div>
                                </div>
                              </td>,
                              <td key="ip-date" colSpan={1} rowSpan={2}
                                className="border border-gray-300 p-1 bg-gray-50 align-middle">
                                <div className="flex flex-col justify-center h-full">
                                  <div className="text-[8px] text-gray-500 font-semibold leading-none">วันที่</div>
                                  <div className="text-[11px] font-bold text-gray-700 leading-tight mt-0.5">{poDate}</div>
                                </div>
                              </td>,
                            ]
                            if (pr === 4) return []

                            // pr 5-6: ซัพพลายเออร์
                            if (pr === 5) return [
                              <td key="ip-sup" colSpan={2} rowSpan={2}
                                className="border border-gray-300 p-1 bg-gray-50 align-middle">
                                <div className="flex flex-col justify-center h-full">
                                  <div className="text-[8px] text-gray-500 font-semibold leading-none">ซัพพลายเออร์</div>
                                  <div className="text-[13px] font-bold text-gray-700 leading-tight mt-0.5">{order.supplier ?? '-'}</div>
                                </div>
                              </td>,
                            ]
                            if (pr === 6) return []

                            // pr 7-8: หมายเหตุ + ยอดรวม
                            if (pr === 7) return [
                              <td key="ip-notes" colSpan={1} rowSpan={2}
                                className="border border-gray-300 p-1 bg-gray-50 align-middle">
                                <div className="flex flex-col justify-center h-full">
                                  <div className="text-[8px] text-gray-500 font-semibold leading-none">หมายเหตุ</div>
                                  <div className="text-[11px] text-gray-600 leading-tight mt-0.5">{order.notes ?? ''}</div>
                                </div>
                              </td>,
                              <td key="ip-total" colSpan={1} rowSpan={2}
                                className="border border-gray-300 p-1 bg-green-100 align-middle">
                                <div className="flex flex-col items-end justify-center h-full">
                                  <div className="text-[8px] text-green-700 font-semibold leading-none">ยอดรวม (฿)</div>
                                  <div className="text-[18px] font-extrabold text-green-700 leading-tight mt-0.5">
                                    {total > 0 ? total.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : ''}
                                  </div>
                                </div>
                              </td>,
                            ]
                            if (pr === 8) return []

                            return [<td key={`ip-x${pr}`} colSpan={2} className="border border-gray-200 bg-gray-50" />]
                          }

                          // ── Normal product rows ─────────────────────────────
                          const cell = sec.rows[rowIdx] ?? null

                          if (!cell) return [
                            <td key={`${si}-en`} className="border border-gray-200 bg-gray-50" />,
                            <td key={`${si}-eq`} className="border border-gray-200 bg-gray-50" />,
                          ]

                          if (cell.type === 'subgroup') {
                            if (FOY_SUBGROUP_NAMES.has(cell.name)) return [
                              <td key={`${si}-sg`} colSpan={2} className="border border-gray-200 bg-gray-50 py-0" />,
                            ]
                            return [
                              <td key={`${si}-sg`} colSpan={2}
                                className="border px-2 py-px text-[11px] font-bold text-white print-sg bg-[#4e7a5e]">
                                {cell.name}
                              </td>,
                            ]
                          }

                          if (cell.type === 'foy_cat') {
                            return [
                              <td key={`${si}-fc`} colSpan={2}
                                style={{ backgroundColor: '#4e7a5e' }}
                                className="border px-2 py-px text-[10px] font-bold text-white print-sg">
                                กระดาษฝอย {cell.category}
                              </td>,
                            ]
                          }

                          if (cell.type === 'foy_item') {
                            const itemBg = FOY_ITEM_BG[cell.category] ?? '#fefce8'
                            return [
                              <td key={`${si}-fin`} style={{ backgroundColor: itemBg }}
                                className="border border-gray-300 px-1 py-px text-gray-700 overflow-hidden">
                                <span className="truncate">{cell.model_name}</span>
                              </td>,
                              <td key={`${si}-fiq`} style={{ backgroundColor: itemBg }}
                                className="border border-gray-300 px-1 py-px text-right font-semibold text-gray-700">
                                {cell.qty > 0 ? cell.qty.toLocaleString('th-TH') : ''}
                              </td>,
                            ]
                          }

                          // product
                          const { product: p } = cell
                          const qty = order.quantities[p.id] ?? 0

                          if (FOY_GROUP_NAMES.has(p.group_name)) return [
                            <td key={`${si}-pn`} colSpan={2}
                              className="border border-gray-300 px-1 py-px bg-green-50 text-gray-500 overflow-hidden">
                              <span className="truncate">{p.product_name}</span>
                            </td>,
                          ]

                          return [
                            <td key={`${si}-pn`}
                              className="border border-gray-300 px-1 py-px text-gray-700 overflow-hidden">
                              <div className="flex items-center justify-between gap-0.5">
                                <span className="truncate">{p.product_name}</span>
                              </div>
                            </td>,
                            <td key={`${si}-pq`}
                              className={`border border-gray-300 px-1 py-px text-right font-semibold ${qty > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                              {qty > 0 ? qty.toLocaleString('th-TH') : ''}
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
        </div>
      </div>
    </div>
  )
}

// ── Page (Suspense wrapper) ───────────────────────────────────────────────────

export default function POPrintPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>}>
      <POPrintInner />
    </Suspense>
  )
}
