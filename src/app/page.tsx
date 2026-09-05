'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Known booking2 group names (for datalist autocomplete) ────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: number
  group_name: string
  product_name: string
  price: string | null
  quantity: string | null
  last_added_qty: string | null
  last_added_at: string | null
  last_booked_qty: string | null
  last_booked_at: string | null
  show_in_booking: boolean
  prev_warehouse_price: string | null
  price_updated_at: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtQty(n: string | number | null): string {
  if (n === null || n === undefined || n === '') return '0'
  const v = parseFloat(String(n))
  return isNaN(v) ? '0' : v.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

function fmtMoney(n: string | number | null): string {
  if (n === null || n === undefined || n === '') return '-'
  const v = parseFloat(String(n))
  return isNaN(v) ? '-' : v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [addInputs, setAddInputs]   = useState<Record<number, string>>({})
  const [bookInputs, setBookInputs] = useState<Record<number, string>>({})
  const [rowEdits, setRowEdits] = useState<Record<number, { group_name?: string; product_name?: string; price?: string }>>({})
  const [busy, setBusy]   = useState<Record<string, boolean>>({})
  const [msg, setMsg]     = useState<string | null>(null)
  const [newRow, setNewRow] = useState({ group_name: '', product_name: '', price: '' })
  const [now, setNow] = useState<Date | null>(null)


  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/catalog')
      .then(r => r.json())
      .then((data: Product[]) => { setProducts(data); setLoading(false); setNow(new Date()) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const showMsg = (text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(null), 2500)
  }

  // ── Stock operations ─────────────────────────────────────────────────────────

  const handleStock = async (id: number, action: 'add' | 'book') => {
    const raw = action === 'add' ? addInputs[id] : bookInputs[id]
    const qty = parseFloat(raw ?? '')
    if (!qty || qty <= 0) return
    setBusy(b => ({ ...b, [`${action}-${id}`]: true }))
    const res = await fetch('/api/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, qty }),
    })
    setBusy(b => ({ ...b, [`${action}-${id}`]: false }))
    if (res.ok) {
      if (action === 'add') setAddInputs(p => ({ ...p, [id]: '' }))
      else setBookInputs(p => ({ ...p, [id]: '' }))
      load()
      showMsg(action === 'add' ? 'เพิ่มสต็อคสำเร็จ' : 'บันทึกจองสำเร็จ')
    }
  }

  // ── Bulk update: add stock + save all pending price/info edits ───────────────

  const handleAddAll = async () => {
    const stockEntries = Object.entries(addInputs).filter(([, v]) => parseFloat(v) > 0)
    const infoEntries  = Object.entries(rowEdits).filter(([, edits]) => Object.keys(edits).length > 0)
    if (!stockEntries.length && !infoEntries.length) return
    setBusy(b => ({ ...b, addAll: true }))
    await Promise.all([
      ...stockEntries.map(([idStr, v]) =>
        fetch('/api/catalog', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(idStr), action: 'add', qty: parseFloat(v) }),
        })
      ),
      ...infoEntries.map(([idStr, edits]) => {
        const payload: Record<string, unknown> = { id: Number(idStr) }
        for (const [k, v] of Object.entries(edits)) {
          payload[k] = k === 'price' ? (parseFloat(String(v)) || null) : v
        }
        return fetch('/api/catalog', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }),
    ])
    setAddInputs({})
    setRowEdits({})
    load()
    const parts: string[] = []
    if (stockEntries.length) parts.push(`เพิ่มสต็อค ${stockEntries.length} รายการ`)
    if (infoEntries.length)  parts.push(`อัพเดทราคา ${infoEntries.length} รายการ`)
    showMsg(parts.join(' · '))
    setBusy(b => ({ ...b, addAll: false }))
  }

  // ── Save info edits ───────────────────────────────────────────────────────────

  const handleSaveInfo = async (id: number) => {
    const edits = rowEdits[id]
    if (!edits || Object.keys(edits).length === 0) return
    setBusy(b => ({ ...b, [`info-${id}`]: true }))
    const payload: Record<string, unknown> = { id }
    for (const [k, v] of Object.entries(edits)) {
      payload[k] = k === 'price' ? (parseFloat(String(v)) || null) : v
    }
    const res = await fetch('/api/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(b => ({ ...b, [`info-${id}`]: false }))
    if (res.ok) {
      setRowEdits(p => { const n = { ...p }; delete n[id]; return n })
      load()
      showMsg('บันทึกสำเร็จ')
    }
  }

  const setEdit = (id: number, key: string, val: string) =>
    setRowEdits(p => ({ ...p, [id]: { ...p[id], [key]: val } }))

  const editVal = (p: Product, key: 'group_name' | 'product_name' | 'price') =>
    rowEdits[p.id]?.[key] !== undefined ? String(rowEdits[p.id][key]) : String(p[key] ?? '')

  // ── Toggle show_in_booking ────────────────────────────────────────────────────

  const handleToggleBooking = useCallback(async (id: number, newVal: boolean) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, show_in_booking: newVal } : p))
    await fetch('/api/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, show_in_booking: newVal }),
    })
  }, [])

  const handleAddProduct = async () => {
    if (!newRow.group_name.trim() || !newRow.product_name.trim()) return
    setBusy(b => ({ ...b, new: true }))
    const res = await fetch('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_name: newRow.group_name.trim(),
        product_name: newRow.product_name.trim(),
        price: newRow.price ? parseFloat(newRow.price) : null,
      }),
    })
    setBusy(b => ({ ...b, new: false }))
    if (res.ok) { setNewRow({ group_name: '', product_name: '', price: '' }); load(); showMsg('เพิ่มสินค้าสำเร็จ') }
    else showMsg('❌ เพิ่มสินค้าไม่สำเร็จ')
  }

  const handleDelete = useCallback(async (id: number, name: string) => {
    if (!confirm(`ลบ "${name}" ใช่หรือไม่?`)) return
    setProducts(prev => prev.filter(p => p.id !== id))
    await fetch('/api/catalog', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }, [])

  const handleToggleGroupBooking = useCallback(async (groupName: string, newVal: boolean) => {
    setProducts(prev => prev.map(p => p.group_name === groupName ? { ...p, show_in_booking: newVal } : p))
    await fetch('/api/catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_group', group_name: groupName, show_in_booking: newVal }),
    })
  }, [])

  // ── Build grouped entries ─────────────────────────────────────────────────────

  // กระดาษฝอย groups ถูกจัดการที่หน้าสต็อคกระดาษฝอยแทน
  const FOY_HIDDEN = new Set([
    'กระดาษฝอย', 'รุ่นสีอ่อน', 'รุ่นสีพิเศษ A', 'รุ่นสีพิเศษ B',
    'รุ่นหยัก', 'ฝอยนุ่น', 'ฝอยหยัก',
  ])

  type Entry = { type: 'group'; name: string } | { type: 'row'; product: Product }
  const entries: Entry[] = []
  let lastGroup = ''
  for (const p of products) {
    if (FOY_HIDDEN.has(p.group_name)) continue
    if (p.group_name !== lastGroup) {
      entries.push({ type: 'group', name: p.group_name })
      lastGroup = p.group_name
    }
    entries.push({ type: 'row', product: p })
  }

  // ── Stock total value ────────────────────────────────────────────────────────

  const totalValue = products
    .filter(p => !FOY_HIDDEN.has(p.group_name))
    .reduce((sum, p) => {
      const qty   = parseFloat(String(p.quantity ?? 0))
      const price = parseFloat(String(p.price ?? 0))
      return sum + (isNaN(qty) || isNaN(price) ? 0 : qty * price)
    }, 0)

  const dateBE  = now ? now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }) : ''
  const dateCEY = now ? now.toLocaleDateString('th-TH-u-ca-gregory', { year: 'numeric', timeZone: 'Asia/Bangkok' }) : ''
  const dateStr = now ? `${dateBE} (ค.ศ. ${dateCEY})` : ''

  const handlePrint = () => window.print()

  // ── Input styles ─────────────────────────────────────────────────────────────

  const inputCls = (pending: boolean) =>
    `w-full px-1.5 py-1 text-xs rounded border focus:outline-none focus:ring-1 focus:ring-gray-400 ${pending ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'}`

  // ── Render ────────────────────────────────────────────────────────────────────

  const printItems = products.filter(p => !FOY_HIDDEN.has(p.group_name) && p.show_in_booking)
  const printTotal = printItems.reduce((sum, p) => {
    const qty = parseFloat(String(p.quantity ?? 0))
    const pr  = parseFloat(String(p.price ?? 0))
    return sum + (isNaN(qty) || isNaN(pr) ? 0 : qty * pr)
  }, 0)

  return (
    <>
    <div className="min-h-screen bg-gray-100 print:hidden">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">กระดาษฝอยไทย — ระบบจัดการข้อมูล</h1>
          <p className="text-orange-200 text-xs mt-0.5">ข้อมูลจาก Railway PostgreSQL</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleAddAll} disabled={!!busy.addAll}
            className="px-4 py-1.5 text-sm rounded bg-green-500 hover:bg-green-400 text-white font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
            {busy.addAll ? 'กำลังอัพเดท...' : '🔄 อัพเดทสต็อค/ราคา'}
          </button>
          <button onClick={handlePrint}
            className="px-4 py-1.5 text-sm rounded bg-white hover:bg-gray-100 text-green-400 font-semibold transition-colors border border-white/50 whitespace-nowrap">
            🖨️ พิมพ์
          </button>
          <Link href="/booking2"
            className="px-4 py-1.5 text-sm rounded bg-[#F2E9D3] hover:bg-[#E8DFC9] text-[#2baf2b] font-medium transition-colors border border-yellow-400">
            📝 ใบจองสินค้า
          </Link>
          {msg && (
            <span className="text-sm px-3 py-1 rounded-full bg-green-500 text-white">{msg}</span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex">
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50">
          📦 สต็อคสินค้า
        </span>
        <Link href="/stock"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          🌿 สต็อคกระดาษฝอย
        </Link>
        <Link href="/branches"
          className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors">
          🏪 สาขาและตัวแทน
        </Link>
      </div>

      {/* Main */}
      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">กำลังโหลดข้อมูล...</div>
        ) : (
          <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 96px)' }}>
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-20">
                <tr className="bg-[#9b9484] text-white text-left">
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">หมวดสินค้า ✎</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap">ชื่อสินค้า ✎</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap text-center">สต็อคล่าสุด</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap text-center">เพิ่มสต็อค</th>
                  <th className="px-3 py-2 border-r border-gray-500 whitespace-nowrap text-center">จำนวนจอง</th>
                  <th className="px-3 py-2 border-r border-orange-400 whitespace-nowrap text-right bg-orange-400">ราคาโกดัง ✎</th>
                  <th className="px-3 py-2 border-r border-yellow-400 whitespace-nowrap text-right bg-yellow-500 text-gray-500 w-12">+9%</th>
                  <th className="px-3 py-2 border-r border-red-500 whitespace-nowrap text-right bg-red-600 w-14">+9%+7%</th>
                  <th className="px-3 py-2 whitespace-nowrap text-center bg-[#9b9484]">ใบจองสินค้า</th>
                  <th className="px-3 py-2 whitespace-nowrap text-center bg-[#9b9484]">จัดการ</th>
                </tr>

                {/* ── Add new product row (sticky) ── */}
                <tr className="bg-blue-50 border-b-2 border-blue-300">
                  <td className="px-2 py-1.5 border-r border-gray-200">
                    <datalist id="group-suggestions">
                      {BOOKING2_GROUPS.map(g => <option key={g} value={g} />)}
                    </datalist>
                    <input type="text" list="group-suggestions" placeholder="หมวดสินค้า" value={newRow.group_name}
                      onChange={e => setNewRow(p => ({ ...p, group_name: e.target.value }))}
                      className="w-full px-1.5 py-1 text-xs rounded border border-blue-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-2 py-1.5 border-r border-gray-200">
                    <input type="text" placeholder="ชื่อสินค้า" value={newRow.product_name}
                      onChange={e => setNewRow(p => ({ ...p, product_name: e.target.value }))}
                      className="w-full px-1.5 py-1 text-xs rounded border border-blue-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="border-r border-gray-200" />
                  <td className="border-r border-gray-200" />
                  <td className="border-r border-gray-200" />
                  <td className="px-2 py-1.5 border-r border-orange-200 bg-orange-50">
                    <input type="text" inputMode="numeric" placeholder="ราคาโกดัง" value={newRow.price}
                      onChange={e => setNewRow(p => ({ ...p, price: e.target.value }))}
                      className="w-full px-1.5 py-1 text-xs rounded border border-blue-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 text-right" />
                  </td>
                  <td className="border-r border-gray-200 bg-yellow-50" />
                  <td className="border-r border-gray-200 bg-red-50" />
                  <td className="border-r border-gray-200" />
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={handleAddProduct} disabled={!!busy.new || !newRow.group_name.trim() || !newRow.product_name.trim()}
                      className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
                      เพิ่ม
                    </button>
                  </td>
                </tr>
              </thead>

              <tbody>
                {entries.map((entry, ei) => {
                  if (entry.type === 'group') {
                    const groupProducts = products.filter(p => p.group_name === entry.name)
                    const allOn = groupProducts.length > 0 && groupProducts.every(p => p.show_in_booking)
                    return (
                      <tr key={`g-${ei}`} className="bg-[#9b9484] text-white">
                        <td colSpan={8} className="px-3 py-1.5 font-bold text-sm tracking-wide">
                          {entry.name}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            onClick={() => handleToggleGroupBooking(entry.name, !allOn)}
                            className={`px-3 py-0.5 text-[11px] rounded-full font-semibold transition-colors ${allOn ? 'bg-green-400 hover:bg-green-300 text-green-400' : 'bg-red-500 hover:bg-red-400 text-white'}`}
                          >
                            {allOn ? '● โชว์ทั้งหมวด' : '● ซ่อนทั้งหมวด'}
                          </button>
                        </td>
                        <td />
                      </tr>
                    )
                  }

                  const p = entry.product
                  const hasPending = !!rowEdits[p.id] && Object.keys(rowEdits[p.id]).length > 0
                  const stock = parseFloat(String(p.quantity ?? 0))
                  const price = parseFloat(String(p.price ?? 0))
                  const price9    = price > 0 ? price * 1.09 : null
                  const price9p7  = price > 0 ? price * 1.09 * 1.07 : null

                  return (
                    <tr key={p.id} className="bg-white even:bg-gray-50 hover:bg-yellow-50/40 transition-colors">

                      {/* 1. หมวดสินค้า */}
                      <td className="px-2 py-1 border-r border-gray-200">
                        <input type="text" value={editVal(p, 'group_name')}
                          onChange={e => setEdit(p.id, 'group_name', e.target.value)}
                          className={inputCls(!!rowEdits[p.id]?.group_name)} />
                      </td>

                      {/* 2. ชื่อสินค้า */}
                      <td className="px-2 py-1 border-r border-gray-200">
                        <input type="text" value={editVal(p, 'product_name')}
                          onChange={e => setEdit(p.id, 'product_name', e.target.value)}
                          className={inputCls(!!rowEdits[p.id]?.product_name)} />
                      </td>

                      {/* 3. สต็อคล่าสุด */}
                      <td className="px-3 py-1 border-r border-gray-200 text-center whitespace-nowrap">
                        <div className={`text-sm font-bold ${stock < 0 ? 'text-red-600' : 'text-green-400'}`}>
                          {fmtQty(p.quantity)}
                        </div>
                      </td>

                      {/* 4. เพิ่มสต็อค */}
                      <td className="px-2 py-1 border-r border-gray-200 min-w-[130px]">
                        <div className="text-[10px] text-gray-400 mb-0.5">
                          ล่าสุด {fmtQty(p.last_added_qty)} · {fmtDate(p.last_added_at)}
                        </div>
                        <div className="flex gap-1">
                          <input type="text" inputMode="numeric" placeholder="จำนวน"
                            value={addInputs[p.id] ?? ''}
                            onChange={e => setAddInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-16 px-1.5 py-1 text-xs rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 text-right" />
                          <Link href={`/history?id=${p.id}&type=add&name=${encodeURIComponent(p.product_name)}`}
                            className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-300 transition-colors whitespace-nowrap">
                            ประวัติ
                          </Link>
                        </div>
                      </td>

                      {/* 5. จำนวนจอง */}
                      <td className="px-2 py-1 border-r border-gray-200 min-w-[130px]">
                        <div className="text-[10px] text-gray-400 mb-0.5">
                          ล่าสุด {fmtQty(p.last_booked_qty)} · {fmtDate(p.last_booked_at)}
                        </div>
                        <div className="flex gap-1">
                          <input type="text" inputMode="numeric" placeholder="จำนวน"
                            value={bookInputs[p.id] ?? ''}
                            onChange={e => setBookInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-16 px-1.5 py-1 text-xs rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400 text-right" />
                          <button onClick={() => handleStock(p.id, 'book')}
                            disabled={!!busy[`book-${p.id}`]}
                            className="px-2 py-1 text-xs rounded bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-400 transition-colors disabled:opacity-50 whitespace-nowrap">
                            − จอง
                          </button>
                          <Link href={`/history?id=${p.id}&type=book&name=${encodeURIComponent(p.product_name)}`}
                            className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-300 transition-colors whitespace-nowrap">
                            ประวัติ
                          </Link>
                        </div>
                      </td>

                      {/* 6. ราคาโกดัง */}
                      <td className="px-2 py-1 border-r border-orange-200 bg-orange-50">
                        {p.price_updated_at && p.prev_warehouse_price !== null && (
                          <div className="text-[9px] text-gray-400 leading-tight mb-0.5 whitespace-nowrap">
                            {fmtDate(p.price_updated_at)}
                            <span className="ml-0.5 text-gray-400">({fmtMoney(parseFloat(p.prev_warehouse_price))})</span>
                          </div>
                        )}
                        <input type="text" inputMode="numeric" value={editVal(p, 'price')}
                          onChange={e => setEdit(p.id, 'price', e.target.value)}
                          className={`${inputCls(!!rowEdits[p.id]?.price)} text-right`} />
                      </td>

                      {/* 7. ราคา+9% */}
                      <td className="px-3 py-1 border-r border-yellow-200 bg-yellow-50 text-right text-gray-500 whitespace-nowrap font-medium">
                        {price9 !== null ? fmtMoney(price9) : '-'}
                      </td>

                      {/* 8. ราคา+9%+7% */}
                      <td className="px-3 py-1 bg-red-50 border-r border-red-200 text-right text-red-700 whitespace-nowrap font-medium">
                        <div>{price9p7 !== null ? fmtMoney(price9p7) : '-'}</div>
                        {hasPending && (
                          <button onClick={() => handleSaveInfo(p.id)}
                            disabled={!!busy[`info-${p.id}`]}
                            className="mt-0.5 px-2 py-0.5 text-[10px] rounded bg-[#F2E9D3] hover:bg-[#E8DFC9] text-[#2baf2b] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap">
                            💾 บันทึก
                          </button>
                        )}
                      </td>

                      {/* 9. ใบจองสินค้า toggle */}
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button
                          onClick={() => handleToggleBooking(p.id, !p.show_in_booking)}
                          className={`px-2 py-0.5 text-[11px] rounded-full font-semibold transition-colors ${p.show_in_booking ? 'bg-green-500 hover:bg-green-400 text-white' : 'bg-red-500 hover:bg-red-400 text-white'}`}
                        >
                          {p.show_in_booking ? '● โชว์' : '● ซ่อน'}
                        </button>
                      </td>

                      {/* 10. ลบ */}
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button
                          onClick={() => handleDelete(p.id, p.product_name)}
                          className="px-2 py-0.5 text-xs rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors">
                          ลบ
                        </button>
                      </td>

                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#9b9484] text-white text-xs">
                  <td colSpan={7} className="px-3 py-2 text-right font-semibold">
                    มูลค่าสต็อครวมทั้งหมด
                  </td>
                  <td colSpan={3} className="px-3 py-2 text-right font-bold text-base whitespace-nowrap">
                    ฿{totalValue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
                {dateStr && (
                  <tr className="bg-[#9b9484] text-orange-200 text-[11px]">
                    <td colSpan={10} className="px-3 py-1 text-right">{dateStr}</td>
                  </tr>
                )}
              </tfoot>
            </table>
            </div>
          </div>
        )}
      </main>
    </div>

    {/* ── Print view (A4) ── */}
    <div className="hidden print:block p-10 font-sans text-black bg-white">
      <h1 className="text-xl font-bold mb-0.5">รายงานสต็อคสินค้า</h1>
      <p className="text-sm text-gray-500 mb-5">{dateStr}</p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-1.5 pr-4">หมวดสินค้า</th>
            <th className="text-left py-1.5 pr-4">ชื่อสินค้า</th>
            <th className="text-right py-1.5 pr-4">จำนวนสต็อค</th>
            <th className="text-right py-1.5 pr-4">ราคาโกดัง (฿)</th>
            <th className="text-right py-1.5">มูลค่า (฿)</th>
          </tr>
        </thead>
        <tbody>
          {printItems.map(p => {
            const qty = parseFloat(String(p.quantity ?? 0))
            const pr  = parseFloat(String(p.price ?? 0))
            const val = isNaN(qty) || isNaN(pr) ? 0 : qty * pr
            return (
              <tr key={p.id} className="border-b border-gray-200">
                <td className="py-1 pr-4 text-gray-500">{p.group_name}</td>
                <td className="py-1 pr-4">{p.product_name}</td>
                <td className="py-1 pr-4 text-right">{fmtQty(p.quantity)}</td>
                <td className="py-1 pr-4 text-right">{fmtMoney(p.price)}</td>
                <td className="py-1 text-right">{val > 0 ? val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td colSpan={4} className="text-right pt-2 pr-4">รวมมูลค่าทั้งหมด</td>
            <td className="text-right pt-2">
              {printTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  )
}
