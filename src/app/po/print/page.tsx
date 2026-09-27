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
  po_no:          string
  supplier:       string | null
  notes:          string | null
  total_amount:   string
  quantities:     Record<string, number>
  foy_quantities: Record<string, { qty: number; amount: number }>
  created_at:     string
}

// ── Sub-group color map ───────────────────────────────────────────────────────

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

const FOY_GROUP_NAMES    = new Set(['กระดาษฝอย'])
const FOY_SUBGROUP_NAMES = new Set(['กระดาษฝอย'])
const FOY_CATS_ORDER     = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก']
const FOY_MODEL_ORDER    = ['สีอ่อน', 'พิเศษ B', 'พิเศษ A', 'ครีเอท']

const FOY_ITEM_BG: Record<string, string> = {
  '2 มิล':   '#FCF3CF',
  '4 มิล':   '#FAE5D3',
  '1.5 มิล': '#FADBD8',
  'ฝอยหยัก': '#FBDEF0',
}

// ── Column widths ─────────────────────────────────────────────────────────────
// Keep TABLE_W = 1476 (same as po/page.tsx) so CONTENT_SCALE is unchanged.
// Original per-section: name(82)+price(54)+qty(44)+total(62) = 242
// PO print (no price): name(198)+qty(44) = 242  → same TABLE_W
const ROW_NUM_W = 24
const COL_NAME  = 198
const COL_QTY   = 44
const TABLE_W   = ROW_NUM_W + 6 * (COL_NAME + COL_QTY)   // 1476
const TOTAL_COLS = 1 + 6 * 2                               // 13

const A4_W_PX       = 297 * (96 / 25.4)
const A4_PAD_PX     = 8   * (96 / 25.4)
const CONTENT_SCALE = (A4_W_PX - A4_PAD_PX * 2) / TABLE_W

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
  const allCatModels = new Map<string, string[]>()
  for (const cat of FOY_CATS_ORDER) {
    const models  = foyStockModels.filter(it => it.category === cat).map(it => it.model_name)
    const unique  = [...new Set(models)]
    const ordered = [...FOY_MODEL_ORDER.filter(m => unique.includes(m)), ...unique.filter(m => !FOY_MODEL_ORDER.includes(m))]
    if (ordered.length > 0) allCatModels.set(cat, ordered)
  }
  for (const key of Object.keys(foyPending)) {
    const idx = key.indexOf('|'); if (idx === -1) continue
    const cat = key.slice(0, idx); const model = key.slice(idx + 1)
    if (!allCatModels.has(cat)) allCatModels.set(cat, [])
    if (!allCatModels.get(cat)!.includes(model)) allCatModels.get(cat)!.push(model)
  }

  return sections.map(sec => {
    const hasFoy = sec.rows.some(r => r.type === 'product' && FOY_GROUP_NAMES.has(r.product.group_name))
    if (!hasFoy) return sec
    const newRows: SectionRow[] = []; let foyInjected = false
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtThaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

function fmtMoney(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Print inner ───────────────────────────────────────────────────────────────

function POPrintInner() {
  const searchParams = useSearchParams()
  const poNo         = searchParams.get('no') ?? ''

  const [order,    setOrder]    = useState<POOrder | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const contentRef              = useRef<HTMLDivElement>(null)
  const [contentNaturalH, setContentNaturalH] = useState(0)
  const [viewScale,       setViewScale]       = useState(1)

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
      setSections(secs)
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
  }, [sections])

  useEffect(() => {
    const calc = () => setViewScale(Math.min(1, (window.innerWidth - 16) / A4_W_PX))
    calc(); window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  // Auto-print
  useEffect(() => {
    if (loading || !order || sections.length === 0) return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [loading, order, sections])

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>
  if (error)   return <div className="flex items-center justify-center h-screen text-red-500">{error}</div>
  if (!order)  return null

  const maxRows    = Math.max(...sections.map(s => s.rows.length), 0)
  const quantities = order.quantities ?? {}

  // ── Precompute active rows (for compact print) ────────────────────────────
  const activeRowsPerSection: Set<number>[] = sections.map(sec => {
    const active = new Set<number>()
    for (let ri = 0; ri < sec.rows.length; ri++) {
      const cell = sec.rows[ri]
      if (cell.type === 'product' && !FOY_GROUP_NAMES.has(cell.product.group_name)) {
        if ((quantities[cell.product.id] ?? 0) > 0) active.add(ri)
      } else if (cell.type === 'foy_item') {
        if (cell.qty > 0) active.add(ri)
      }
    }
    // Activate headers above active rows
    let headerIdx = -1
    for (let ri = 0; ri < sec.rows.length; ri++) {
      const cell = sec.rows[ri]
      if (cell.type === 'subgroup' || cell.type === 'foy_cat') { headerIdx = ri }
      else if (active.has(ri) && headerIdx >= 0) { active.add(headerIdx) }
    }
    return active
  })

  const rowIsActive = (ri: number) => sections.some((_, si) => activeRowsPerSection[si].has(ri))

  const total    = parseFloat(order.total_amount) || 0
  const scaledFrameH = contentNaturalH * CONTENT_SCALE + A4_PAD_PX * 2

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          body, html { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .a4-frame { box-shadow: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          td:not(.print-sg) { background-color: white !important; }
          .print-sg { background-color: inherit !important; }
          .compact-hide { display: none !important; }
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

      {/* A4 wrapper */}
      <div className="py-3 px-2 flex justify-center print:p-0 print:justify-start">
        <div style={viewScale < 1 ? {
          transform: `scale(${viewScale})`,
          transformOrigin: 'top left',
          marginRight: `${-A4_W_PX * (1 - viewScale)}px`,
          ...(scaledFrameH > 0 ? { marginBottom: `${-(scaledFrameH * (1 - viewScale))}px` } : {}),
        } : undefined}>
          <div className="a4-frame bg-white shadow-xl"
            style={{ width: '297mm', minHeight: '210mm', padding: '8mm', boxSizing: 'border-box' }}>

            <div ref={contentRef} style={{
              transform: `scale(${CONTENT_SCALE})`,
              transformOrigin: 'top left',
              width: TABLE_W,
              marginRight: `${-TABLE_W * (1 - CONTENT_SCALE)}px`,
              ...(contentNaturalH > 0 ? { marginBottom: `${-(contentNaturalH * (1 - CONTENT_SCALE))}px` } : {}),
            }}>

              {/* ── Title ────────────────────────────────────────────────── */}
              <div className="text-center mb-2">
                <div className="text-[28px] font-extrabold text-[#4e7a5e] leading-tight">ใบPO</div>
                <div className="text-[13px] text-gray-500 mt-0.5">เลขที่: <span className="font-semibold text-gray-700">{order.po_no}</span></div>
              </div>

              {/* ── Main table ───────────────────────────────────────────── */}
              <div className="inline-block rounded overflow-hidden border border-gray-400 shadow">
                <table className="text-[13px] leading-[1.35] border-collapse"
                  style={{ tableLayout: 'fixed', width: TABLE_W }}>
                  <colgroup>
                    <col style={{ width: ROW_NUM_W }} />
                    {sections.flatMap(sec => [
                      <col key={`${sec.order}-cn`} style={{ width: COL_NAME }} />,
                      <col key={`${sec.order}-cq`} style={{ width: COL_QTY }} />,
                    ])}
                  </colgroup>

                  <thead>
                    {/* Info row */}
                    <tr>
                      <td colSpan={Math.ceil(TOTAL_COLS / 4) + 1}
                        className="border border-gray-300 px-2 py-1 bg-gray-50 text-[11px]">
                        <span className="font-semibold text-gray-500">วันที่: </span>
                        <span className="text-gray-700">{fmtThaiDate(order.created_at)}</span>
                      </td>
                      <td colSpan={3}
                        className="border border-gray-300 px-2 py-1 bg-gray-50 text-[11px]">
                        <span className="font-semibold text-gray-500">เลขที่: </span>
                        <span className="text-gray-700 font-medium">{order.po_no}</span>
                      </td>
                      <td colSpan={3}
                        className="border border-gray-300 px-2 py-1 bg-gray-50 text-[11px]">
                        <span className="font-semibold text-gray-500">ซัพพลายเออร์: </span>
                        <span className="text-gray-700">{order.supplier ?? '-'}</span>
                      </td>
                      <td colSpan={TOTAL_COLS - Math.ceil(TOTAL_COLS / 4) - 1 - 3 - 3}
                        className="border border-gray-300 px-2 py-1 bg-gray-50 text-[11px]">
                        <span className="font-semibold text-gray-500">หมายเหตุ: </span>
                        <span className="text-gray-700">{order.notes ?? ''}</span>
                      </td>
                    </tr>
                  </thead>

                  <tbody>
                    {Array.from({ length: maxRows }, (_, rowIdx) => {
                      const active = rowIsActive(rowIdx)
                      return (
                        <tr key={rowIdx}
                          className={`transition-colors${!active ? ' compact-hide' : ''}`}>

                          {/* Row number */}
                          <td className="border border-gray-300 text-center text-[9px] text-gray-400 py-0.5 select-none">
                            {rowIdx + 1}
                          </td>

                          {sections.flatMap((sec, si) => {
                            const cell = sec.rows[rowIdx] ?? null

                            // Empty cell
                            if (!cell) return [
                              <td key={`${si}-en`} className="border border-gray-200 bg-gray-50" />,
                              <td key={`${si}-eq`} className="border border-gray-200 bg-gray-50" />,
                            ]

                            // Subgroup header
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

                            // FOY category header
                            if (cell.type === 'foy_cat') return [
                              <td key={`${si}-fc`} colSpan={2}
                                style={{ backgroundColor: '#4e7a5e' }}
                                className="border px-2 py-px text-[10px] font-bold text-white print-sg">
                                กระดาษฝอย {cell.category}
                              </td>,
                            ]

                            // FOY item
                            if (cell.type === 'foy_item') {
                              const bg = FOY_ITEM_BG[cell.category] ?? '#fefce8'
                              return [
                                <td key={`${si}-fin`} style={{ backgroundColor: bg }}
                                  className="border border-gray-300 px-1 py-px text-gray-700 overflow-hidden">
                                  <span className="truncate">{cell.model_name}</span>
                                </td>,
                                <td key={`${si}-fiq`} style={{ backgroundColor: bg }}
                                  className="border border-gray-300 px-1 py-px text-right font-semibold text-gray-700">
                                  {cell.qty > 0 ? `×${cell.qty.toLocaleString('th-TH')}` : ''}
                                </td>,
                              ]
                            }

                            // Product
                            const { product: p } = cell
                            const qty = quantities[p.id] ?? 0

                            if (FOY_GROUP_NAMES.has(p.group_name)) return [
                              <td key={`${si}-pn`} colSpan={2}
                                className="border border-gray-300 px-1 py-px bg-green-50 text-gray-500 overflow-hidden">
                                <span className="truncate">{p.product_name}</span>
                              </td>,
                            ]

                            return [
                              <td key={`${si}-pn`}
                                className="border border-gray-300 px-1 py-px text-gray-700 overflow-hidden">
                                <span className="truncate">{p.product_name}</span>
                              </td>,
                              <td key={`${si}-pq`}
                                className={`border border-gray-300 px-1 py-px text-right font-semibold ${qty > 0 ? 'text-[#4e7a5e]' : 'text-gray-200'}`}>
                                {qty > 0 ? `×${qty.toLocaleString('th-TH')}` : ''}
                              </td>,
                            ]
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Total ────────────────────────────────────────────────── */}
              {total > 0 && (
                <div className="text-right mt-2 pr-1">
                  <span className="text-[14px] font-bold text-gray-600">ยอดรวม </span>
                  <span className="text-[20px] font-extrabold text-[#4e7a5e]">{fmtMoney(total)}</span>
                  <span className="text-[14px] font-bold text-gray-600"> บาท</span>
                </div>
              )}

              {/* ── Signature boxes ───────────────────────────────────────── */}
              <div className="flex gap-4 mt-3" style={{ width: TABLE_W }}>
                {/* ผู้ส่งสินค้า */}
                <div className="flex-1 border border-gray-300 rounded p-3 min-h-[80px]">
                  <div className="text-[11px] font-bold text-gray-500 mb-1">ผู้ส่งสินค้า</div>
                  <div className="mt-8 border-t border-gray-300 pt-1 text-[10px] text-gray-400">
                    ลงชื่อ ________________________ วันที่ ______________
                  </div>
                </div>
                {/* ผู้รับสินค้า */}
                <div className="flex-1 border border-gray-300 rounded p-3 min-h-[80px]">
                  <div className="text-[11px] font-bold text-gray-500 mb-1">ผู้รับสินค้า</div>
                  <div className="mt-8 border-t border-gray-300 pt-1 text-[10px] text-gray-400">
                    ลงชื่อ ________________________ วันที่ ______________
                  </div>
                </div>
              </div>

            </div>{/* /content scale */}
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
