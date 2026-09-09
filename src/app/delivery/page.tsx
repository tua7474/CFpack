'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface DeliveryMethod { id: number; name: string }

export default function DeliveryPage() {
  const [deliveries, setDeliveries]             = useState<DeliveryMethod[]>([])
  const [loading, setLoading]                   = useState(true)
  const [newDelivery, setNewDelivery]           = useState('')
  const [editDelivery, setEditDelivery]         = useState<DeliveryMethod | null>(null)
  const [busy, setBusy]                         = useState(false)
  const [confirmDel, setConfirmDel]             = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/delivery')
    if (r.ok) setDeliveries(await r.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addDelivery = async () => {
    if (!newDelivery.trim()) return
    setBusy(true)
    await fetch('/api/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDelivery.trim() }),
    })
    setNewDelivery('')
    setBusy(false)
    load()
  }

  const saveDelivery = async () => {
    if (!editDelivery?.name.trim()) return
    setBusy(true)
    await fetch('/api/delivery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editDelivery.id, name: editDelivery.name.trim() }),
    })
    setEditDelivery(null)
    setBusy(false)
    load()
  }

  const deleteDelivery = async (id: number) => {
    await fetch('/api/delivery', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setConfirmDel(null)
    load()
  }

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow">
        <div>
          <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
          <p className="text-orange-200 text-xs mt-0.5">ข้อมูลจาก Railway PostgreSQL</p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex">
        <Link href="/"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          📦 สต็อคสินค้า
        </Link>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          🌿 สต็อคกระดาษฝอย
        </Link>
        <Link href="/branches"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          🏪 สาขาและตัวแทน
        </Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50">
          🚚 จัดส่ง
        </span>
        <Link href="/withdrawal"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          📤 เบิกของ
        </Link>
      </div>

      {/* Main */}
      <main className="p-4">
        <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden bg-white max-w-lg">
          <div className="bg-[#9b9484] text-white px-4 py-2">
            <h2 className="text-sm font-bold">รูปแบบการจัดส่ง</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-24 text-gray-400 text-sm">กำลังโหลด...</div>
          ) : (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500">
                  <th className="px-4 py-2 w-8">#</th>
                  <th className="px-4 py-2">รูปแบบการจัดส่ง</th>
                  <th className="px-4 py-2 w-44"></th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d, i) => (
                  <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2">
                      {editDelivery?.id === d.id ? (
                        <input
                          value={editDelivery.name}
                          onChange={e => setEditDelivery({ ...editDelivery, name: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && saveDelivery()}
                          className="w-full px-2 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                          autoFocus
                        />
                      ) : (
                        <span className="font-medium text-gray-700">{d.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {confirmDel === d.id ? (
                        <div className="flex gap-1 items-center">
                          <span className="text-[10px] text-red-500">ยืนยันลบ?</span>
                          <button onClick={() => deleteDelivery(d.id)}
                            className="px-2 py-0.5 text-xs rounded bg-red-500 hover:bg-red-600 text-white">ลบ</button>
                          <button onClick={() => setConfirmDel(null)}
                            className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500">ยกเลิก</button>
                        </div>
                      ) : editDelivery?.id === d.id ? (
                        <div className="flex gap-1">
                          <button onClick={saveDelivery} disabled={busy}
                            className="px-2 py-0.5 text-xs rounded bg-green-500 hover:bg-green-600 text-white disabled:opacity-50">บันทึก</button>
                          <button onClick={() => setEditDelivery(null)}
                            className="px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500">ยกเลิก</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => setEditDelivery({ id: d.id, name: d.name })}
                            className="px-2 py-0.5 text-xs rounded bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200">แก้ไข</button>
                          <button onClick={() => setConfirmDel(d.id)}
                            className="px-2 py-0.5 text-xs rounded bg-red-50 hover:bg-red-100 text-red-600 border border-red-200">ลบ</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add new */}
          <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2">
            <input
              value={newDelivery}
              onChange={e => setNewDelivery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDelivery()}
              placeholder="ชื่อรูปแบบการจัดส่งใหม่..."
              className="flex-1 px-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
            <button onClick={addDelivery} disabled={busy || !newDelivery.trim()}
              className="px-3 py-1.5 text-xs rounded bg-[#9b9484] hover:bg-[#857e72] text-white font-medium disabled:opacity-50 whitespace-nowrap">
              + เพิ่ม
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
