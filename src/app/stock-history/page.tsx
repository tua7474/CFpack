'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'

interface LogRow {
  id: number
  qty: string
  created_at: string
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

export default function StockHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; type?: string; name?: string; model?: string; color?: string; category?: string }>
}) {
  const params      = use(searchParams)
  const stockId     = params.id       ?? ''
  const type        = params.type     ?? 'add'
  const productName = params.name     ?? ''
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

  // Product detail line shown on each row
  const productLine = [modelName, colorName, category, stockId ? `#${stockId}` : '']
    .filter(Boolean).join(' · ')

  // thead color by category (matches model row colors in stock page)
  const theadCls =
    category === '2 มิล'   ? 'bg-[#F7DC6F] text-gray-700' :
    category === '4 มิล'   ? 'bg-[#F0B27A] text-gray-700' :
    category === '1.5 มิล' ? 'bg-[#F1948A] text-gray-700' :
    category === 'ฝอยหยัก' ? 'bg-[#C39BD3] text-gray-700' :
    'bg-[#9b9484] text-white'

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center gap-3">
        <Link href="/stock" className="text-orange-200 hover:text-white text-sm transition-colors">
          ← สต็อคกระดาษฝอย
        </Link>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
      </header>

      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400">ยังไม่มีประวัติ</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden max-w-lg">
            <table className="min-w-full text-sm">
              <thead>
                {productLine && (
                  <tr className={theadCls}>
                    <th colSpan={3} className="px-4 py-1.5 text-[12px] font-semibold">{productLine}</th>
                  </tr>
                )}
                <tr className={`${theadCls} text-left font-semibold border-t border-black/10`}>
                  <th className="px-4 py-2 w-10 text-center">#</th>
                  <th className="px-4 py-2">วันเวลา</th>
                  <th className="px-4 py-2 text-right">จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id} className="bg-white even:bg-gray-50 border-t border-gray-100">
                    <td className="px-4 py-2 text-center text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(row.created_at)}</td>
                    <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${isAdd ? 'text-green-500' : 'text-orange-500'}`}>
                      {isAdd ? '+' : '−'}{fmtQty(row.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
