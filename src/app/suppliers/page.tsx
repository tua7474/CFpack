'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Supplier {
  id:         number
  name:       string
  phone:      string | null
  address:    string | null
  notes:      string | null
  created_at: string
}

interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }

export default function SuppliersPage() {
  const router = useRouter()
  const [session,    setSession]    = useState<SessionInfo | null>(null)
  const [suppliers,  setSuppliers]  = useState<Supplier[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [editId,     setEditId]     = useState<number | null>(null)
  const [busy,       setBusy]       = useState(false)

  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' })

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

  const fetchSuppliers = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/suppliers')
    const data = await res.json() as Supplier[]
    setSuppliers(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchSuppliers() }, [fetchSuppliers])

  function resetForm() {
    setForm({ name: '', phone: '', address: '', notes: '' })
    setEditId(null)
    setShowAdd(false)
  }

  function startEdit(s: Supplier) {
    setForm({ name: s.name, phone: s.phone ?? '', address: s.address ?? '', notes: s.notes ?? '' })
    setEditId(s.id)
    setShowAdd(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setBusy(true)
    try {
      if (editId) {
        await fetch('/api/suppliers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editId, ...form }),
        })
      } else {
        await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      resetForm()
      await fetchSuppliers()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`ลบซัพพลายเออร์ "${name}"?`)) return
    setBusy(true)
    try {
      await fetch('/api/suppliers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await fetchSuppliers()
    } finally {
      setBusy(false)
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
        <Link href="/" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📦 สต็อคสินค้า
        </Link>
        <Link href="/stock" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌿 สต็อคกระดาษฝอย
        </Link>
        <Link href="/orders" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📋 ใบจอง
        </Link>
        <Link href="/branches" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🏪 สาขาและตัวแทน
        </Link>
        <Link href="/delivery" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🚚 จัดส่ง
        </Link>
        <Link href="/withdrawal" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📤 เบิกของ
        </Link>
        <Link href="/restock" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          📥 ใบPO
        </Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">
          🏭 ซัพพลายเออร์
        </span>
        <Link href="/foy-line" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          🌀 ไลน์ผลิตกระดาษฝอย
        </Link>
        <Link href="/finance" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">
          💰 การเงิน
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-700">ซัพพลายเออร์</h2>
          {!showAdd && (
            <button onClick={() => setShowAdd(true)}
              className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded shadow">
              ➕ เพิ่มซัพพลายเออร์
            </button>
          )}
        </div>

        {/* Add / Edit form */}
        {showAdd && (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">{editId ? 'แก้ไขซัพพลายเออร์' : 'เพิ่มซัพพลายเออร์ใหม่'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อ *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ชื่อบริษัท / ร้านค้า"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">เบอร์โทร</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="0XX-XXXXXXX"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">หมายเหตุ</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="หมายเหตุ"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-400" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ที่อยู่</label>
                <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="ที่อยู่"
                  rows={2}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={resetForm}
                className="px-4 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
                ยกเลิก
              </button>
              <button onClick={handleSave} disabled={busy || !form.name.trim()}
                className="px-4 py-1.5 text-sm rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium transition-colors">
                {busy ? 'กำลังบันทึก...' : (editId ? 'บันทึก' : 'เพิ่ม')}
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-12 text-gray-400">ยังไม่มีซัพพลายเออร์ กดเพิ่มด้านบน</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#4e7a5e] text-white">
                  <th className="px-4 py-2.5 text-left font-semibold">ชื่อ</th>
                  <th className="px-4 py-2.5 text-left font-semibold">เบอร์โทร</th>
                  <th className="px-4 py-2.5 text-left font-semibold">หมายเหตุ</th>
                  <th className="px-4 py-2.5 text-left font-semibold">ที่อยู่</th>
                  <th className="px-4 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, idx) => (
                  <tr key={s.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{s.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{s.phone ?? '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{s.notes ?? ''}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{s.address ?? ''}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEdit(s)}
                          className="text-xs text-blue-500 hover:text-blue-700">✏️</button>
                        <button onClick={() => handleDelete(s.id, s.name)} disabled={busy}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
