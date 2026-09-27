'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface POOrder {
  id:            number
  po_no:         string
  status:        'pending' | 'received'
  supplier:      string | null
  notes:         string | null
  total_amount:  string
  factory_total: string | null
  quantities:    Record<string, number>
  created_at:    string
  received_at:   string | null
}

interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

export default function RestockPage() {
  const router = useRouter()
  const [session, setSession]   = useState<SessionInfo | null>(null)
  const [orders, setOrders]     = useState<POOrder[]>([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState<Record<number, boolean>>({})
  const [suppliers, setSuppliers] = useState<string[]>([])

  // Inline edit buffers (keyed by order id)
  const [editSupplier, setEditSupplier]         = useState<Record<number, string>>({})
  const [editFactoryTotal, setEditFactoryTotal] = useState<Record<number, string>>({})

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
    // Collect unique non-empty supplier names for datalist
    const unique = [...new Set(data.map(o => o.supplier).filter(Boolean))] as string[]
    setSuppliers(unique)
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  async function patchOrder(id: number, patch: Record<string, unknown>) {
    await fetch('/api/po', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    await fetchOrders()
  }

  async function handleReceive(id: number) {
    if (!confirm('ยืนยันว่ารับสินค้าแล้ว? สต็อคจะถูกอัพเดทอัตโนมัติ')) return
    setBusy(prev => ({ ...prev, [id]: true }))
    try {
      await patchOrder(id, { status: 'received' })
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

  function supplierValue(order: POOrder) {
    return editSupplier[order.id] !== undefined ? editSupplier[order.id] : (order.supplier ?? '')
  }

  function factoryValue(order: POOrder) {
    return editFactoryTotal[order.id] !== undefined ? editFactoryTotal[order.id] : (order.factory_total ?? '')
  }

  async function blurSupplier(order: POOrder) {
    const val = editSupplier[order.id]
    if (val === undefined) return // never edited
    if (val === (order.supplier ?? '')) return
    setBusy(prev => ({ ...prev, [order.id]: true }))
    try {
      await patchOrder(order.id, { supplier: val || null })
    } finally {
      setBusy(prev => ({ ...prev, [order.id]: false }))
      setEditSupplier(prev => { const n = { ...prev }; delete n[order.id]; return n })
    }
  }

  async function blurFactoryTotal(order: POOrder) {
    const val = editFactoryTotal[order.id]
    if (val === undefined) return
    if (val === (order.factory_total ?? '')) return
    setBusy(prev => ({ ...prev, [order.id]: true }))
    try {
      await patchOrder(order.id, { factory_total: val ? parseFloat(val) : null })
    } finally {
      setBusy(prev => ({ ...prev, [order.id]: false }))
      setEditFactoryTotal(prev => { const n = { ...prev }; delete n[order.id]; return n })
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

      <div className="max-w-7xl mx-auto px-4 py-4">
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
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#4e7a5e] text-white">
                  <th className="px-4 py-3 text-left whitespace-nowrap font-semibold">เลขที่ใบPO</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap font-semibold">ชื่อโรงงาน</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap font-semibold">ยอดรวมPO (เรา)</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap font-semibold">ยอดรวมPO (โรงงาน)</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap font-semibold">ส่วนต่าง</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap font-semibold">สถานะ</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => {
                  const ourTotal     = parseFloat(order.total_amount) || 0
                  const factoryTotal = order.factory_total ? parseFloat(order.factory_total) : null
                  const diff         = factoryTotal !== null ? ourTotal - factoryTotal : null
                  const isPending    = order.status === 'pending'

                  return (
                    <tr key={order.id}
                      className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>

                      {/* เลขที่ใบPO */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-800 whitespace-nowrap">{order.po_no}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{fmtDate(order.created_at)}</div>
                        {order.notes && (
                          <div className="text-xs text-gray-400 mt-0.5 max-w-[160px] truncate" title={order.notes}>
                            {order.notes}
                          </div>
                        )}
                      </td>

                      {/* ชื่อโรงงาน — datalist dropdown */}
                      <td className="px-4 py-3">
                        <input
                          list={`sup-${order.id}`}
                          value={supplierValue(order)}
                          onChange={e => setEditSupplier(prev => ({ ...prev, [order.id]: e.target.value }))}
                          onBlur={() => blurSupplier(order)}
                          disabled={busy[order.id]}
                          placeholder="เลือกหรือพิมพ์"
                          className="border border-gray-200 rounded px-2 py-1.5 text-sm w-40 focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-300 disabled:opacity-50"
                        />
                        <datalist id={`sup-${order.id}`}>
                          {suppliers.map(s => <option key={s} value={s} />)}
                        </datalist>
                      </td>

                      {/* ยอดรวมPO (เรา) */}
                      <td className="px-4 py-3 text-right font-medium text-gray-700 whitespace-nowrap">
                        {fmt(ourTotal)}
                      </td>

                      {/* ยอดรวมPO (โรงงาน) — editable */}
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={factoryValue(order)}
                          onChange={e => setEditFactoryTotal(prev => ({ ...prev, [order.id]: e.target.value }))}
                          onBlur={() => blurFactoryTotal(order)}
                          disabled={busy[order.id]}
                          placeholder="กรอกยอด"
                          className="border border-gray-200 rounded px-2 py-1.5 text-sm w-36 text-right focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-300 disabled:opacity-50"
                        />
                      </td>

                      {/* ส่วนต่าง */}
                      <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                        {diff === null ? (
                          <span className="text-gray-300 font-normal">-</span>
                        ) : diff > 0 ? (
                          <span className="text-green-600">+{fmt(diff)}</span>
                        ) : diff === 0 ? (
                          <span className="text-yellow-500">0</span>
                        ) : (
                          <span className="text-red-600">{fmt(diff)}</span>
                        )}
                      </td>

                      {/* สถานะ */}
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          {isPending ? 'รอรับสินค้า' : 'รับสินค้าแล้ว'}
                        </span>
                        {!isPending && order.received_at && (
                          <div className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{fmtDate(order.received_at)}</div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-center">
                          {isPending && (
                            <button
                              onClick={() => handleReceive(order.id)}
                              disabled={busy[order.id]}
                              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-medium px-3 py-1.5 rounded shadow transition-colors whitespace-nowrap">
                              {busy[order.id] ? '...' : '📥 เติมสต็อค'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(order.id)}
                            disabled={busy[order.id]}
                            title="ลบ"
                            className="text-red-400 hover:text-red-600 px-1 transition-colors disabled:opacity-30">
                            🗑️
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
      </div>
    </div>
  )
}
