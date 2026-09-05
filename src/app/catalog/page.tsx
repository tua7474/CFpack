'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// Group names that appear in booking2 (for quick-select dropdown)
const BOOKING2_GROUPS = [
  'กล่อง', 'กล่อง Thank You', 'กล่องผลไม้ 5 ชั้น', 'กล่องเอกสาร', 'กล่อง 5 ชั้น',
  'ถุงใส่กระดาษฝอย',
  'ซอง PP', 'ซองเมทาลิค', 'ซอง PP สี', 'ซองน้ำตาล', 'ซองขยายข้าง', 'ซองจ่าหน้า',
  'ซองบับเบิล', 'ซองPPกันกระแทก', 'ฟิล์มยืด',
  'บับเบิล', 'บับเบิลสี', 'บับเบิลบาง 35g', 'โฟมบาง 2 มิล', 'ตัวตัดเทป',
  'เทปOPPแกนดำ', 'เทประวังแตก', 'เทปOPPแกนส้ม', 'เทปThankYou', 'ถุงหิ้วบริการ', 'ลาเบล 10x15',
  'ถุงแก้วฝากาว 60M/100P', 'ถุงซิปรูด', 'ซองใสปะหน้า', 'กระบอก', 'ฝาปิดกระบอก',
  'สายรัด PP', 'กระดาษห่อ', 'เชือก', 'เบิกฟรี',
  'ซองกันกระแทก', 'MINI AIR BAG ม้วนเปล่า', 'AIRLOCK', 'MINI AIR เครื่องเป่า',
  'กระดาษพิมพ์สลิป', 'ปากกาเขียน PP', 'สติกเกอร์ระวังแตกม้วน', 'เครื่อง/สติกเกอร์/เคส',
]

interface CatalogItem {
  id: number
  group_name: string
  product_name: string
  price: string | null
  quantity: string | null
  show_in_booking: boolean
}

function fmtPrice(p: string | null): string {
  if (!p) return ''
  const n = parseFloat(p)
  return isNaN(n) ? '' : n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CatalogPage() {
  const [items, setItems]         = useState<CatalogItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [filterGroup, setFilterGroup] = useState('')
  const [msg, setMsg]             = useState<string | null>(null)
  const [busy, setBusy]           = useState<Record<string, boolean>>({})
  const [edits, setEdits]         = useState<Record<number, { product_name?: string; price?: string }>>({})
  const [newRow, setNewRow]       = useState({ group_name: '', product_name: '', price: '' })
  const [allGroups, setAllGroups] = useState<string[]>([])

  const showMsg = (text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(null), 2500)
  }

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/catalog')
      .then(r => r.json())
      .then((data: CatalogItem[]) => {
        setItems(data)
        // Collect all unique group names
        const groups = [...new Set(data.map(it => it.group_name))].sort((a, b) => a.localeCompare(b, 'th'))
        // Merge with BOOKING2_GROUPS (known groups might not have products yet)
        const merged = [...new Set([...BOOKING2_GROUPS, ...groups])].sort((a, b) => a.localeCompare(b, 'th'))
        setAllGroups(merged)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = filterGroup ? items.filter(it => it.group_name === filterGroup) : items

  // Group for display
  const grouped = new Map<string, CatalogItem[]>()
  for (const it of filtered) {
    if (!grouped.has(it.group_name)) grouped.set(it.group_name, [])
    grouped.get(it.group_name)!.push(it)
  }

  const handleAdd = async () => {
    if (!newRow.group_name || !newRow.product_name.trim()) return
    setBusy(b => ({ ...b, new: true }))
    const res = await fetch('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_name: newRow.group_name,
        product_name: newRow.product_name.trim(),
        price: parseFloat(newRow.price) || null,
      }),
    })
    setBusy(b => ({ ...b, new: false }))
    if (res.ok) {
      setNewRow(p => ({ ...p, product_name: '', price: '' }))
      load()
      showMsg('เพิ่มสินค้าสำเร็จ')
    }
  }

  const handleSave = async (id: number) => {
    const edit = edits[id]
    if (!edit || !Object.keys(edit).length) return
    setBusy(b => ({ ...b, [id]: true }))
    const payload: Record<string, unknown> = { id }
    if (edit.product_name !== undefined) payload.product_name = edit.product_name
    if (edit.price        !== undefined) payload.price        = parseFloat(edit.price) || null
    await fetch('/api/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(b => ({ ...b, [id]: false }))
    setEdits(p => { const n = { ...p }; delete n[id]; return n })
    load()
    showMsg('บันทึกสำเร็จ')
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`ลบ "${name}" ใช่หรือไม่?`)) return
    await fetch(`/api/catalog?id=${id}`, { method: 'DELETE' })
    load()
    showMsg('ลบสำเร็จ')
  }

  const handleToggle = async (id: number, val: boolean) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, show_in_booking: val } : it))
    await fetch('/api/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, show_in_booking: val }),
    })
  }

  const editVal = (id: number, key: 'product_name' | 'price', fallback: string) =>
    edits[id]?.[key] !== undefined ? edits[id][key]! : fallback

  const hasPending = (id: number) => !!edits[id] && Object.keys(edits[id]).length > 0

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center gap-4">
        <Link href="/stock" className="text-orange-200 hover:text-white text-sm transition-colors">
          ← สต็อคกระดาษฝอย
        </Link>
        <div>
          <h1 className="text-xl font-bold">จัดการ Catalog สินค้า</h1>
          <p className="text-orange-200 text-xs mt-0.5">เพิ่ม / แก้ไข / ลบ สินค้าในระบบจอง</p>
        </div>
        {msg && (
          <span className={`ml-4 text-sm px-3 py-1 rounded-full text-white ${msg.includes('ลบ') && !msg.includes('สำเร็จ') ? 'bg-red-500' : 'bg-green-500'}`}>
            {msg}
          </span>
        )}
      </header>

      <main className="p-4 max-w-4xl mx-auto">

        {/* ── Add new product ── */}
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-blue-500 whitespace-nowrap">+ เพิ่มสินค้าใหม่</span>
          <select
            value={newRow.group_name}
            onChange={e => setNewRow(p => ({ ...p, group_name: e.target.value }))}
            className="px-2 py-1 text-xs rounded border border-blue-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[180px]">
            <option value="">-- หมวด --</option>
            {BOOKING2_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <input
            type="text" placeholder="ชื่อสินค้า / ขนาด"
            value={newRow.product_name}
            onChange={e => setNewRow(p => ({ ...p, product_name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="flex-1 min-w-[120px] px-2 py-1 text-xs rounded border border-blue-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <input
            type="text" inputMode="numeric" placeholder="ราคา"
            value={newRow.price}
            onChange={e => setNewRow(p => ({ ...p, price: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="w-24 px-2 py-1 text-xs rounded border border-blue-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 text-right" />
          <button
            onClick={handleAdd}
            disabled={!!busy.new || !newRow.group_name || !newRow.product_name.trim()}
            className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
            + เพิ่ม
          </button>
        </div>

        {/* ── Filter ── */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">กรองหมวด:</span>
          <select
            value={filterGroup}
            onChange={e => setFilterGroup(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 max-w-[200px]">
            <option value="">-- ทั้งหมด ({items.length} รายการ) --</option>
            {allGroups.map(g => {
              const cnt = items.filter(it => it.group_name === g).length
              return <option key={g} value={g}>{g} ({cnt})</option>
            })}
          </select>
          {filterGroup && (
            <button onClick={() => setFilterGroup('')} className="text-xs text-gray-400 hover:text-gray-600">✕ ล้าง</button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} รายการ</span>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div className="text-center py-10 text-gray-400">กำลังโหลด...</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {[...grouped.entries()].map(([groupName, groupItems]) => (
              <div key={groupName}>
                {/* Group header */}
                <div className="bg-[#9b9484] text-white px-3 py-1.5 text-xs font-bold tracking-wide flex items-center justify-between">
                  <span>{groupName}</span>
                  <span className="text-orange-200 font-normal">{groupItems.length} รายการ</span>
                </div>
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left border-b border-gray-200">
                      <th className="px-3 py-1.5 w-8 text-center">#</th>
                      <th className="px-3 py-1.5">ชื่อสินค้า</th>
                      <th className="px-3 py-1.5 text-right w-28">ราคา (฿)</th>
                      <th className="px-3 py-1.5 text-center w-20">ใบจอง</th>
                      <th className="px-3 py-1.5 text-center w-24">บันทึก</th>
                      <th className="px-3 py-1.5 text-center w-16">ลบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupItems.map((item, idx) => {
                      const pending = hasPending(item.id)
                      return (
                        <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-1 text-center text-gray-400">{idx + 1}</td>
                          <td className="px-3 py-1">
                            <input
                              type="text"
                              value={editVal(item.id, 'product_name', item.product_name)}
                              onChange={e => setEdits(p => ({ ...p, [item.id]: { ...p[item.id], product_name: e.target.value } }))}
                              className={`w-full px-1.5 py-0.5 text-xs rounded border focus:outline-none focus:ring-1 focus:ring-gray-400 ${pending && edits[item.id]?.product_name !== undefined ? 'border-yellow-400 bg-yellow-50' : 'border-transparent bg-transparent'}`}
                            />
                          </td>
                          <td className="px-3 py-1">
                            <input
                              type="text" inputMode="numeric"
                              value={editVal(item.id, 'price', item.price ?? '')}
                              onChange={e => setEdits(p => ({ ...p, [item.id]: { ...p[item.id], price: e.target.value } }))}
                              className={`w-full px-1.5 py-0.5 text-xs rounded border text-right focus:outline-none focus:ring-1 focus:ring-gray-400 ${pending && edits[item.id]?.price !== undefined ? 'border-yellow-400 bg-yellow-50' : 'border-transparent bg-transparent'}`}
                              placeholder={fmtPrice(item.price) || '–'}
                            />
                          </td>
                          <td className="px-3 py-1 text-center">
                            <button
                              onClick={() => handleToggle(item.id, !item.show_in_booking)}
                              className={`px-2 py-0.5 text-[10px] text-white rounded-full font-semibold transition-colors ${item.show_in_booking ? 'bg-green-500 hover:bg-green-400' : 'bg-red-500 hover:bg-red-400'}`}>
                              {item.show_in_booking ? '● โชว์' : '● ซ่อน'}
                            </button>
                          </td>
                          <td className="px-3 py-1 text-center">
                            {pending && (
                              <button
                                onClick={() => handleSave(item.id)}
                                disabled={!!busy[item.id]}
                                className="px-2 py-0.5 text-[10px] rounded bg-[#F2E9D3] hover:bg-[#E8DFC9] text-[#2baf2b] font-semibold whitespace-nowrap disabled:opacity-50">
                                {busy[item.id] ? '...' : '💾 บันทึก'}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-1 text-center">
                            <button
                              onClick={() => handleDelete(item.id, item.product_name)}
                              className="px-2 py-0.5 text-[10px] rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors">
                              ลบ
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-sm">
                {filterGroup ? `ไม่มีสินค้าในหมวด "${filterGroup}"` : 'ไม่มีข้อมูล'}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
