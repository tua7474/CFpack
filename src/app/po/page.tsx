'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface CatalogProduct {
  id: number
  group_name: string
  product_name: string
  price: string | null
  show_in_booking: boolean
}

interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }

const FOY_HIDDEN = new Set(['กระดาษฝอย', 'รุ่นสีอ่อน', 'รุ่นสีพิเศษ A', 'รุ่นสีพิเศษ B', 'รุ่นหยัก', 'ฝอยนุ่น', 'ฝอยหยัก'])

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function POPage() {
  const router = useRouter()
  const [session, setSession]     = useState<SessionInfo | null>(null)
  const [products, setProducts]   = useState<CatalogProduct[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [supplier, setSupplier]   = useState('')
  const [notes, setNotes]         = useState('')
  const [quantities, setQuantities] = useState<Record<number, number>>({})

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

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/catalog')
    const data = await res.json() as CatalogProduct[]
    setProducts(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  // Filter and group
  const visibleProducts = products.filter(p =>
    p.show_in_booking !== false && !FOY_HIDDEN.has(p.group_name)
  )

  const grouped: Record<string, CatalogProduct[]> = {}
  for (const p of visibleProducts) {
    if (!grouped[p.group_name]) grouped[p.group_name] = []
    grouped[p.group_name].push(p)
  }

  const totalAmount = visibleProducts.reduce((sum, p) => {
    const qty   = quantities[p.id] ?? 0
    const price = parseFloat(p.price ?? '0') || 0
    return sum + qty * price
  }, 0)

  async function handleSave() {
    const nonZero: Record<number, number> = {}
    for (const [id, qty] of Object.entries(quantities)) {
      if (qty > 0) nonZero[Number(id)] = qty
    }
    if (Object.keys(nonZero).length === 0) {
      alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier: supplier.trim() || null,
          notes:    notes.trim() || null,
          total_amount: totalAmount,
          quantities: nonZero,
        }),
      })
      if (res.ok) {
        router.push('/restock')
      } else {
        alert('เกิดข้อผิดพลาด กรุณาลองใหม่')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-green-50 pb-24">
      {/* Header */}
      <header className="bg-[#4e7a5e] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
          {session && <p className="text-green-200 text-xs mt-0.5">เข้าสู่ระบบ: {session.branch_name} · {session.phone}</p>}
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
          📦 สต็อคสินค้า
        </Link>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌿 สต็อคกระดาษฝอย
        </Link>
        <Link href="/branches"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🏪 สาขาและตัวแทน
        </Link>
        <Link href="/delivery"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🚚 จัดส่ง
        </Link>
        <Link href="/withdrawal"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📤 เบิกของ
        </Link>
        <Link href="/restock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📥 ใบPO
        </Link>
        <Link href="/foy-line"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌀 ไลน์ผลิตกระดาษฝอย
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        <h2 className="text-base font-bold text-gray-700 mb-3">สร้างใบPO</h2>

        {/* Info row */}
        <div className="bg-white rounded-lg shadow border border-green-100 p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">ซัพพลายเออร์</label>
            <input
              value={supplier}
              onChange={e => setSupplier(e.target.value)}
              placeholder="ชื่อซัพพลายเออร์..."
              className="w-full text-sm border border-green-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="หมายเหตุ..."
              className="w-full text-sm border border-green-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
            />
          </div>
        </div>

        {/* Product table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
        ) : (
          <div className="bg-white rounded-lg shadow border border-green-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#6b7d6b] text-white">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">สินค้า</th>
                  <th className="text-right py-2 px-3 font-medium w-28">ราคา/ชิ้น</th>
                  <th className="text-right py-2 px-3 font-medium w-24">จำนวน</th>
                  <th className="text-right py-2 px-3 font-medium w-28">รวม</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([group, prods]) => (
                  <Fragment key={group}>
                    <tr className="bg-[#6b7d6b] text-white">
                      <td colSpan={4} className="py-1.5 px-3 text-xs font-semibold">{group}</td>
                    </tr>
                    {prods.map(p => {
                      const qty   = quantities[p.id] ?? 0
                      const price = parseFloat(p.price ?? '0') || 0
                      return (
                        <tr key={p.id} className="border-b border-gray-100 hover:bg-green-50">
                          <td className="py-2 px-3 text-gray-800">{p.product_name}</td>
                          <td className="py-2 px-3 text-right text-gray-500">{price > 0 ? fmt(price) : '-'}</td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min={0}
                              value={qty === 0 ? '' : qty}
                              onChange={e => {
                                const v = parseInt(e.target.value) || 0
                                setQuantities(prev => ({ ...prev, [p.id]: v }))
                              }}
                              className="w-20 text-right text-sm border border-green-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-400"
                              placeholder="0"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-medium text-gray-700">
                            {qty > 0 ? fmt(qty * price) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-green-200 shadow-lg px-4 py-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          ยอดรวม: <span className="text-lg font-bold text-green-700">{fmt(totalAmount)} บาท</span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold px-6 py-2 rounded shadow text-sm transition-colors"
        >
          {saving ? 'กำลังบันทึก...' : '💾 บันทึกใบPO'}
        </button>
      </div>
    </div>
  )
}
