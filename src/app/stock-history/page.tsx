'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'

interface LogRow {
  id: number
  qty: string
  created_at: string
  branch_name: string | null
  lot_number: string | null
  action: string | null
  active_lot: string | null   // booking only: lot active at time of booking
}

function fmtQty(n: string | number | null): string {
  if (n === null || n === undefined || n === '') return '0'
  const v = parseFloat(String(n))
  return isNaN(v) ? '0' : v.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Bangkok',
  })
}

// สีสลับสำหรับแต่ละล็อต (วนซ้ำ)
const LOT_PALETTE = [
  { row: 'bg-orange-50',  badge: 'bg-orange-100 text-orange-700 border-orange-300' },
  { row: 'bg-sky-50',     badge: 'bg-sky-100 text-sky-700 border-sky-300' },
  { row: 'bg-violet-50',  badge: 'bg-violet-100 text-violet-700 border-violet-300' },
  { row: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { row: 'bg-rose-50',    badge: 'bg-rose-100 text-rose-700 border-rose-300' },
  { row: 'bg-yellow-50',  badge: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
]

export default function StockHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; type?: string; name?: string; model?: string; color?: string; category?: string }>
}) {
  const params      = use(searchParams)
  const stockId     = params.id       ?? ''
  const type        = params.type     ?? 'add'
  const modelName   = params.model    ? decodeURIComponent(params.model)    : ''
  const colorName   = params.color    ? decodeURIComponent(params.color)    : ''
  const category    = params.category ? decodeURIComponent(params.category) : ''

  const [rows, setRows]       = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!stockId) return
    setLoading(true)
    fetch(`/api/stock/history?id=${stockId}&type=${type}`)
      .then(r => r.json())
      .then((data: LogRow[]) => { setRows(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [stockId, type])

  const title = type === 'add' ? 'ประวัติการเพิ่มสต็อค' : 'ประวัติการจอง'
  const isAdd = type === 'add'

  const productLine = [modelName, colorName, category, stockId ? `#${stockId}` : '']
    .filter(Boolean).join(' · ')

  const theadCls =
    category === '2 มิล'   ? 'bg-[#F7DC6F] text-gray-700' :
    category === '4 มิล'   ? 'bg-[#F0B27A] text-gray-700' :
    category === '1.5 มิล' ? 'bg-[#F1948A] text-gray-700' :
    category === 'ฝอยหยัก' ? 'bg-[#C39BD3] text-gray-700' :
    'bg-[#9b9484] text-white'

  // สร้าง lot→index map เพื่อกำหนดสี (สำหรับ booking)
  const lotIndexMap = new Map<string, number>()
  let lotCounter = 0
  for (const row of [...rows].reverse()) {
    const lot = row.active_lot ?? '__none__'
    if (!lotIndexMap.has(lot)) { lotIndexMap.set(lot, lotCounter++) }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center gap-3">
        <Link href="/stock" className="text-orange-200 hover:text-white text-sm transition-colors">
          ← สต็อคกระดาษฝอย
        </Link>
        <h1 className="text-xl font-bold">{title}</h1>
      </header>

      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400">ยังไม่มีประวัติ</div>
        ) : (
          <div className="max-w-lg">
            {/* Legend */}
            {isAdd && (
              <div className="mb-2 flex gap-3 text-xs">
                <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 text-blue-600 font-semibold border border-blue-200">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-300 inline-block" /> 🌀 ไลน์ผลิต
                </span>
                <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-50 text-green-700 font-semibold border border-green-200">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-300 inline-block" /> 📦 เพิ่มตรง
                </span>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <table className="min-w-full text-sm">
                <thead>
                  {productLine && (
                    <tr className={theadCls}>
                      <th colSpan={isAdd ? 4 : 4} className="px-4 py-1.5 text-[12px] font-semibold">{productLine}</th>
                    </tr>
                  )}
                  <tr className={`${theadCls} text-left font-semibold border-t border-black/10`}>
                    <th className="px-4 py-2 w-10 text-center">#</th>
                    <th className="px-4 py-2">วันเวลา</th>
                    <th className="px-4 py-2">{isAdd ? 'ล็อต' : 'ล็อตที่ตัด'}</th>
                    <th className="px-4 py-2 text-right">จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {isAdd ? (
                    // ── ประวัติเพิ่มสต็อค ──────────────────────────────────────
                    rows.map((row, i) => {
                      const isFoyAdd = row.action === 'foy_add'
                      const rowBg = isFoyAdd ? 'bg-blue-50' : 'bg-green-50'
                      return (
                        <tr key={row.id} className={`${rowBg} border-t border-gray-100`}>
                          <td className="px-4 py-2 text-center text-gray-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-2">
                            <div className="text-gray-500 text-xs whitespace-nowrap">{fmtDate(row.created_at)}</div>
                            {row.branch_name && <div className="text-[10px] text-gray-400">{row.branch_name}</div>}
                            <div className={`text-[10px] font-semibold ${isFoyAdd ? 'text-blue-500' : 'text-green-600'}`}>
                              {isFoyAdd ? '🌀 ไลน์ผลิต' : '📦 เพิ่มตรง'}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            {row.lot_number && (
                              <span className="px-2 py-0.5 text-[11px] rounded-full bg-blue-100 text-blue-700 font-mono font-semibold border border-blue-200 whitespace-nowrap">
                                {row.lot_number}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-green-600 whitespace-nowrap">
                            +{fmtQty(row.qty)}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    // ── ประวัติการจอง (แยกล็อต) ───────────────────────────────
                    rows.map((row, i) => {
                      const lot = row.active_lot
                      const lotIdx = lotIndexMap.get(lot ?? '__none__') ?? 0
                      const palette = LOT_PALETTE[lotIdx % LOT_PALETTE.length]
                      const noLot = !lot
                      const rowBg = noLot ? 'bg-gray-50' : palette.row
                      const badgeCls = noLot ? 'bg-gray-100 text-gray-400 border-gray-200' : palette.badge

                      // แสดง separator เมื่อล็อตเปลี่ยน (เทียบกับแถวก่อนหน้า)
                      const prevLot = i > 0 ? (rows[i - 1].active_lot ?? null) : undefined
                      const lotChanged = i > 0 && prevLot !== lot

                      return [
                        lotChanged && (
                          <tr key={`sep-${row.id}`} className="border-t-2 border-dashed border-gray-400">
                            <td colSpan={4} className="px-4 py-1 text-[11px] text-gray-500 font-semibold bg-gray-100">
                              ▼ เริ่มล็อตใหม่ {lot ? `· ${lot}` : '(ไม่มีข้อมูลล็อต)'}
                            </td>
                          </tr>
                        ),
                        <tr key={row.id} className={`${rowBg} border-t border-white/60`}>
                          <td className="px-4 py-2 text-center text-gray-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-2">
                            <div className="text-gray-500 text-xs whitespace-nowrap">{fmtDate(row.created_at)}</div>
                            {row.branch_name && <div className="text-[10px] text-gray-400">{row.branch_name}</div>}
                          </td>
                          <td className="px-4 py-2">
                            {lot ? (
                              <span className={`px-2 py-0.5 text-[11px] rounded-full font-mono font-semibold border whitespace-nowrap ${badgeCls}`}>
                                {lot}
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-orange-500 whitespace-nowrap">
                            −{fmtQty(row.qty)}
                          </td>
                        </tr>,
                      ]
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
