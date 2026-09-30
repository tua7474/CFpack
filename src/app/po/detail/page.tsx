'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id:             number
  group_name:     string
  product_name:   string
  price:          string | null
  section_order:  number
  section_name:   string
  subgroup_order: number
  subgroup_name:  string
}

interface FoyModel {
  category:   string
  model_name: string
}

interface POOrder {
  id:                  number
  po_no:               string
  status:              'pending' | 'received'
  supplier:            string | null
  notes:               string | null
  total_amount:        string
  factory_total:       string | null
  quantities:          Record<string, number>
  foy_quantities:      Record<string, { qty: number; amount: number }>
  foy_item_quantities: Record<string, number>
  nv_total:            string | null
  v_total:             string | null
  created_at:          string
  received_at:         string | null
}

interface SessionInfo { branch_name: string; phone: string; is_admin: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

const FOY_CATS_ORDER  = ['2 มิล', '4 มิล', '1.5 มิล', 'ฝอยหยัก']
const FOY_MODEL_ORDER = ['สีอ่อน', 'พิเศษ B', 'พิเศษ A', 'ครีเอท']

function sortedFoyItems(
  foyModels: FoyModel[],
  qtys: Record<string, number>
): { key: string; category: string; model_name: string; qty: number }[] {
  const result: { key: string; category: string; model_name: string; qty: number }[] = []
  for (const cat of FOY_CATS_ORDER) {
    const models = foyModels.filter(m => m.category === cat)
    const modelNames = [...new Set(models.map(m => m.model_name))]
    const ordered = [
      ...FOY_MODEL_ORDER.filter(m => modelNames.includes(m)),
      ...modelNames.filter(m => !FOY_MODEL_ORDER.includes(m)),
    ]
    for (const model of ordered) {
      const key = `${cat}|${model}`
      result.push({ key, category: cat, model_name: model, qty: qtys[key] ?? 0 })
    }
  }
  // Include any keys not in standard cats
  for (const [key, qty] of Object.entries(qtys)) {
    if (!result.find(r => r.key === key)) {
      const idx = key.indexOf('|')
      if (idx >= 0) result.push({ key, category: key.slice(0, idx), model_name: key.slice(idx + 1), qty })
    }
  }
  return result
}

// ── Grouped product list ──────────────────────────────────────────────────────

interface GroupedSection {
  sectionName:  string
  sectionOrder: number
  subgroups: {
    name:     string
    products: CatalogProduct[]
  }[]
}

function buildGrouped(products: CatalogProduct[]): GroupedSection[] {
  const secMap = new Map<number, GroupedSection>()
  for (const p of products) {
    if (!secMap.has(p.section_order))
      secMap.set(p.section_order, { sectionName: p.section_name, sectionOrder: p.section_order, subgroups: [] })
    const sec = secMap.get(p.section_order)!
    const subName = p.subgroup_order > 0 ? p.subgroup_name : p.section_name
    let sub = sec.subgroups.find(s => s.name === subName)
    if (!sub) { sub = { name: subName, products: [] }; sec.subgroups.push(sub) }
    sub.products.push(p)
  }
  return Array.from(secMap.values()).sort((a, b) => a.sectionOrder - b.sectionOrder)
}

// ── Inner page ────────────────────────────────────────────────────────────────

function PODetailInner() {
  const router     = useRouter()
  const poNo       = useSearchParams().get('no') ?? ''

  const [session,  setSession]  = useState<SessionInfo | null>(null)
  const [order,    setOrder]    = useState<POOrder | null>(null)
  const [catalog,  setCatalog]  = useState<CatalogProduct[]>([])
  const [foyModels,setFoyModels]= useState<FoyModel[]>([])
  const [supplierList, setSupplierList] = useState<{ id: number; name: string }[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  // Edit state
  const [supplier,  setSupplier]  = useState('')
  const [notes,     setNotes]     = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [foyQtys,   setFoyQtys]   = useState<Record<string, number>>({})

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

  const loadData = useCallback(async () => {
    if (!poNo) { setError('ไม่พบเลขที่ใบPO'); setLoading(false); return }
    try {
      const [orderRes, catalogRes, stockRes, supplierRes] = await Promise.all([
        fetch(`/api/po?no=${encodeURIComponent(poNo)}`),
        fetch('/api/booking2'),
        fetch('/api/stock'),
        fetch('/api/suppliers'),
      ])
      const orderData:    POOrder            = await orderRes.json()
      const catalogData:  CatalogProduct[]   = await catalogRes.json()
      const stockData                        = await stockRes.json()
      const supplierData: { id: number; name: string }[] = await supplierRes.json()

      if (!orderData) { setError('ไม่พบข้อมูลใบPO'); setLoading(false); return }

      setOrder(orderData)
      setCatalog(Array.isArray(catalogData) ? catalogData : [])
      setFoyModels(stockData?.items ?? [])
      setSupplierList(Array.isArray(supplierData) ? supplierData : [])

      // Init edit state
      setSupplier(orderData.supplier ?? '')
      setNotes(orderData.notes ?? '')
      setQuantities({ ...orderData.quantities })
      // foy_item_quantities stores flat {cat|model: qty}
      setFoyQtys({ ...(orderData.foy_item_quantities ?? {}) })
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [poNo])

  useEffect(() => { loadData() }, [loadData])

  async function handleSave() {
    if (!order) return
    setSaving(true)
    try {
      // Recalculate total from catalog prices
      let total = 0
      for (const p of catalog) {
        const qty = quantities[p.id] ?? 0
        if (qty > 0 && p.price) total += qty * parseFloat(p.price)
      }

      await fetch('/api/po', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          po_no: order.po_no,
          supplier: supplier || null,
          notes: notes || null,
          quantities,
          foy_item_quantities: foyQtys,
          total_amount: total,
        }),
      })
      await loadData()
      alert('บันทึกสำเร็จ')
    } catch {
      alert('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center text-gray-400">
      กำลังโหลด...
    </div>
  )

  if (error || !order) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-500 mb-4">{error || 'ไม่พบข้อมูล'}</p>
        <Link href="/restock" className="text-green-600 hover:underline">← กลับหน้าใบPO</Link>
      </div>
    </div>
  )

  // Build grouped catalog (excluding foy products — those use foyModels)
  const FOY_GROUP_NAMES = new Set(['กระดาษฝอย'])
  const nonFoyCatalog   = catalog.filter(p => !FOY_GROUP_NAMES.has(p.group_name))
  const grouped         = buildGrouped(nonFoyCatalog)
  const foyItems        = sortedFoyItems(foyModels, foyQtys)

  const isPending = order.status === 'pending'

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
        <Link href="/" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📦 สต็อคสินค้า</Link>
        <Link href="/stock" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌿 สต็อคกระดาษฝอย</Link>
        <Link href="/orders" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📋 ใบจอง</Link>
        <Link href="/branches" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏪 สาขาและตัวแทน</Link>
        <Link href="/delivery" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🚚 จัดส่ง</Link>
        <Link href="/withdrawal" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">📤 เบิกของ</Link>
        <Link href="/restock" className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">📥 ใบPO</Link>
        <Link href="/suppliers" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🏭 ซัพพลายเออร์</Link>
        <Link href="/foy-line" className="inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap">🌀 ไลน์ผลิตกระดาษฝอย</Link>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
          <Link href="/restock" className="hover:text-green-600">ประวัติใบPO</Link>
          <span>/</span>
          <span className="text-gray-800 font-semibold">{order.po_no}</span>
        </div>

        {/* PO Header Card */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800">{order.po_no}</h2>
              <p className="text-xs text-gray-400 mt-0.5">วันที่สร้าง: {fmtDate(order.created_at)}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${isPending ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                {isPending ? 'รอรับสินค้า' : `รับสินค้าแล้ว${order.received_at ? ` · ${fmtDate(order.received_at)}` : ''}`}
              </span>
              <Link
                href={`/po/print?no=${encodeURIComponent(order.po_no)}`}
                target="_blank"
                className="bg-[#4e7a5e] hover:bg-[#3d6149] text-white text-xs font-medium px-3 py-1.5 rounded shadow transition-colors whitespace-nowrap">
                🖨️ พิมพ์
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">ซัพพลายเออร์</label>
              <select
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-400">
                <option value="">— เลือกซัพพลายเออร์ —</option>
                {supplierList.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">หมายเหตุ</label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="หมายเหตุ"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-400" />
            </div>
          </div>

          {/* Totals row */}
          <div className="mt-3 flex gap-6 text-sm">
            <div>
              <span className="text-gray-400 text-xs">ยอดรวมPO (เรา)</span>
              <p className="font-bold text-gray-700">{fmt(parseFloat(order.total_amount) || 0)}</p>
            </div>
            {order.factory_total && (
              <div>
                <span className="text-gray-400 text-xs">ยอดรวมPO (โรงงาน)</span>
                <p className="font-bold text-gray-700">{fmt(parseFloat(order.factory_total))}</p>
              </div>
            )}
          </div>
        </div>

        {/* Product list */}
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-4">
          <div className="bg-[#4e7a5e] text-white px-4 py-2.5">
            <h3 className="text-sm font-semibold">รายการสินค้า</h3>
          </div>

          <div className="divide-y divide-gray-100">
            {grouped.map(sec => (
              <div key={sec.sectionOrder}>
                <div className="px-4 py-1.5 bg-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {sec.sectionName}
                </div>
                {sec.subgroups.map(sub => {
                  const activeProducts = sub.products.filter(p => (quantities[p.id] ?? 0) > 0)
                  if (activeProducts.length === 0) return null
                  return (
                    <div key={sub.name}>
                      <div className="px-4 py-1 bg-gray-50 text-xs text-gray-400 font-medium">
                        {sub.name}
                      </div>
                      {activeProducts.map(p => (
                        <div key={p.id} className="flex items-center px-4 py-2 hover:bg-green-50 gap-3">
                          <span className="flex-1 text-sm text-gray-700">{p.product_name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setQuantities(prev => ({ ...prev, [p.id]: Math.max(0, (prev[p.id] ?? 0) - 1) }))}
                              className="w-6 h-6 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 text-xs font-bold flex items-center justify-center">
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={quantities[p.id] ?? 0}
                              onChange={e => setQuantities(prev => ({ ...prev, [p.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                              className="w-16 text-center border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:border-green-400"
                            />
                            <button
                              onClick={() => setQuantities(prev => ({ ...prev, [p.id]: (prev[p.id] ?? 0) + 1 }))}
                              className="w-6 h-6 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 text-xs font-bold flex items-center justify-center">
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}

            {/* FOY items */}
            {foyItems.filter(f => f.qty > 0).length > 0 && (
              <div>
                <div className="px-4 py-1.5 bg-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wide">
                  กระดาษฝอย
                </div>
                {FOY_CATS_ORDER.map(cat => {
                  const catItems = foyItems.filter(f => f.category === cat && f.qty > 0)
                  if (catItems.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="px-4 py-1 bg-gray-50 text-xs text-gray-400 font-medium">{cat}</div>
                      {catItems.map(f => (
                        <div key={f.key} className="flex items-center px-4 py-2 hover:bg-green-50 gap-3">
                          <span className="flex-1 text-sm text-gray-700">{f.model_name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setFoyQtys(prev => ({ ...prev, [f.key]: Math.max(0, (prev[f.key] ?? 0) - 1) }))}
                              className="w-6 h-6 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 text-xs font-bold flex items-center justify-center">
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={foyQtys[f.key] ?? 0}
                              onChange={e => setFoyQtys(prev => ({ ...prev, [f.key]: Math.max(0, parseInt(e.target.value) || 0) }))}
                              className="w-16 text-center border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:border-green-400"
                            />
                            <button
                              onClick={() => setFoyQtys(prev => ({ ...prev, [f.key]: (prev[f.key] ?? 0) + 1 }))}
                              className="w-6 h-6 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 text-xs font-bold flex items-center justify-center">
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Empty state */}
            {grouped.every(sec => sec.subgroups.every(sub => sub.products.filter(p => (quantities[p.id] ?? 0) > 0).length === 0)) &&
             foyItems.filter(f => f.qty > 0).length === 0 && (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">ไม่มีรายการสินค้า</div>
            )}
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end gap-3">
          <Link href="/restock"
            className="px-5 py-2 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
            ยกเลิก
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium transition-colors">
            {saving ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function PODetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-green-50 flex items-center justify-center text-gray-400">กำลังโหลด...</div>}>
      <PODetailInner />
    </Suspense>
  )
}
