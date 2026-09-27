'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface POItem {
  product_id:   number
  product_name: string
  group_name:   string
  qty:          number
  price:        number
}

interface POOrder {
  id:           number
  po_no:        string
  status:       'pending' | 'received'
  supplier:     string | null
  notes:        string | null
  total_amount: string
  quantities:   Record<string, number>
  created_at:   string
  received_at:  string | null
  items:        POItem[]
}

interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  })
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function RestockPage() {
  const router = useRouter()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [orders, setOrders]   = useState<POOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<Record<number, boolean>>({})

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

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/po')
    const data = await res.json() as POOrder[]
    setOrders(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  async function handleReceive(id: number) {
    if (!confirm('ยืนยันว่ารับสินค้าแล้ว? สต็อคจะถูกอัพเดทอัตโนมัติ')) return
    setBusy(prev => ({ ...prev, [id]: true }))
    try {
      await fetch('/api/po', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'received' }),
      })
      await fetchOrders()
    } finally {
      setBusy(prev => ({ ...prev, [id]: false }))
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('ลบใบPO นี้?')) return
    setBusy(prev => ({ ...prev, [id]: true }))
    try {
      await fetch('/api/po', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await fetchOrders()
    } finally {
      setBusy(prev => ({ ...prev, [id]: false }))
    }
  }

  return (
    <div className="min-h-screen bg-green-50">
      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
          {session && <p className="text-orange-200 text-xs mt-0.5">เข้าสู่ระบบ: {session.branch_name} · {session.phone}</p>}
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
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">
          📥 ใบPO
        </span>
        <Link href="/foy-line"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌀 ไลน์ผลิตกระดาษฝอย
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-700">ประวัติใบPO</h2>
          <Link href="/po"
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded shadow">
            ➕ สร้างใบPO
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 text-gray-400">ยังไม่มีใบPO กดสร้างใบPO เพื่อเพิ่ม</div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => {
              const isPending = order.status === 'pending'
              const total     = parseFloat(order.total_amount) || 0
              return (
                <div key={order.id} className="bg-white rounded-lg shadow border border-gray-200">
                  {/* Card header */}
                  <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">{order.po_no}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          {isPending ? 'รอรับสินค้า' : 'รับสินค้าแล้ว'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{fmtDate(order.created_at)}</div>
                      {order.supplier && <div className="text-xs text-gray-500 mt-0.5">ซัพพลายเออร์: {order.supplier}</div>}
                      {order.notes    && <div className="text-xs text-gray-500">หมายเหตุ: {order.notes}</div>}
                    </div>
                    <button
                      onClick={() => handleDelete(order.id)}
                      disabled={busy[order.id]}
                      className="ml-2 text-xs text-red-400 hover:text-red-600 px-2 py-1 shrink-0"
                      title="ลบ"
                    >
                      🗑️
                    </button>
                  </div>

                  {/* Items table */}
                  {order.items.length > 0 && (
                    <div className="px-3 py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="text-left py-1 pr-2 font-medium">สินค้า</th>
                            <th className="text-right py-1 pr-2 font-medium w-20">จำนวน</th>
                            <th className="text-right py-1 pr-2 font-medium w-24">ราคา/ชิ้น</th>
                            <th className="text-right py-1 font-medium w-24">รวม</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map(item => (
                            <tr key={item.product_id} className="border-b border-gray-50">
                              <td className="py-1 pr-2 text-gray-700">{item.product_name}</td>
                              <td className="py-1 pr-2 text-right text-gray-600">{item.qty.toLocaleString('th-TH')}</td>
                              <td className="py-1 pr-2 text-right text-gray-500">{item.price > 0 ? fmt(item.price) : '-'}</td>
                              <td className="py-1 text-right font-medium text-gray-700">{item.price > 0 ? fmt(item.qty * item.price) : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
                    <div className="text-sm font-semibold text-gray-700">
                      ยอดรวม: <span className="text-green-700">{fmt(total)} บาท</span>
                    </div>
                    {isPending && (
                      <button
                        onClick={() => handleReceive(order.id)}
                        disabled={busy[order.id]}
                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-medium px-3 py-1.5 rounded shadow transition-colors"
                      >
                        {busy[order.id] ? 'กำลังอัพเดท...' : '✅ ยืนยันรับสินค้าแล้ว'}
                      </button>
                    )}
                    {!isPending && order.received_at && (
                      <span className="text-xs text-green-600">รับแล้ว: {fmtDate(order.received_at)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
