'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RestockItem {
  id: number
  entry_id: number
  product_name: string
  quantity: number | null
  unit: string
  sort_order: number
}

interface RestockEntry {
  id: number
  scanned_at: string
  notes: string | null
  raw_text: string | null
  created_at: string
  items: RestockItem[]
}

interface CatalogProduct {
  id: number
  group_name: string
  product_name: string
  quantity: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
  return { date, time }
}

function localISOString(d: Date): string {
  const bkk = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${bkk.getFullYear()}-${pad(bkk.getMonth() + 1)}-${pad(bkk.getDate())}T${pad(bkk.getHours())}:${pad(bkk.getMinutes())}`
}

// ── Fuzzy match ───────────────────────────────────────────────────────────────

function normStr(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/[()\/]/g, '')
}

function matchScore(scanned: string, prod: CatalogProduct): number {
  const s = normStr(scanned)
  const g = normStr(prod.group_name)
  const p = normStr(prod.product_name)
  const full = g + p

  if (!s) return 0
  if (s === full || s === p) return 100
  if (full.includes(s) || s.includes(full)) return 90
  if (p.includes(s) || s.includes(p)) return 80
  if (g.includes(s) || s.includes(g)) return 60

  // character overlap score
  const setS = new Set(s.split(''))
  const setF = new Set(full.split(''))
  const inter = [...setS].filter(c => setF.has(c)).length
  return Math.round((inter / Math.max(setS.size, setF.size)) * 40)
}

function bestMatch(scanned: string, catalog: CatalogProduct[]): number | null {
  let best = -1
  let bestId: number | null = null
  for (const prod of catalog) {
    const sc = matchScore(scanned, prod)
    if (sc > best) { best = sc; bestId = prod.id }
  }
  return best >= 30 ? bestId : null
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RestockPage() {
  const [entries, setEntries]   = useState<RestockEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [catalog, setCatalog]   = useState<CatalogProduct[]>([])

  // scan modal state
  const [showScan, setShowScan]       = useState(false)
  const [modalStep, setModalStep]     = useState<'edit' | 'confirm'>('edit')
  const [scanning, setScanning]       = useState(false)
  const [scanPreview, setScanPreview] = useState<string | null>(null)
  const [scanItems, setScanItems]     = useState<Array<{ product_name: string; quantity: string; unit: string }>>([])
  const [mappings, setMappings]       = useState<Array<number | null>>([])   // catalog_id per scanItem
  const [scanDate, setScanDate]       = useState('')
  const [scanNotes, setScanNotes]     = useState('')
  const [saving, setSaving]           = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // inline edit (history)
  const [editItemId, setEditItemId]   = useState<number | null>(null)
  const [editField, setEditField]     = useState<'product_name' | 'quantity' | 'unit' | null>(null)
  const [editValue, setEditValue]     = useState('')

  // edit entry meta
  const [editEntryId, setEditEntryId]     = useState<number | null>(null)
  const [editEntryDate, setEditEntryDate] = useState('')
  const [editEntryNotes, setEditEntryNotes] = useState('')

  // expand/collapse
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/restock')
    const data = await res.json() as RestockEntry[]
    setEntries(data)
    setLoading(false)
  }, [])

  const fetchCatalog = useCallback(async () => {
    const res  = await fetch('/api/catalog')
    const data = await res.json() as CatalogProduct[]
    setCatalog(data)
  }, [])

  useEffect(() => { fetchEntries(); fetchCatalog() }, [fetchEntries, fetchCatalog])

  // ── Catalog grouped for select ──────────────────────────────────────────────

  const catalogByGroup: Record<string, CatalogProduct[]> = {}
  for (const p of catalog) {
    if (!catalogByGroup[p.group_name]) catalogByGroup[p.group_name] = []
    catalogByGroup[p.group_name].push(p)
  }

  // ── Scan modal ──────────────────────────────────────────────────────────────

  function openScan() {
    setScanPreview(null)
    setScanItems([])
    setMappings([])
    setScanDate(localISOString(new Date()))
    setScanNotes('')
    setModalStep('edit')
    setShowScan(true)
  }

  async function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setScanPreview(dataUrl)
      const base64 = dataUrl.split(',')[1]
      const mime   = file.type || 'image/jpeg'
      setScanning(true)
      setScanItems([])
      setMappings([])
      try {
        const res  = await fetch('/api/restock/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64, mime_type: mime }),
        })
        const data = await res.json() as {
          items?: Array<{ product_name: string; quantity: number | null; unit: string }>
        }
        if (data.items) {
          const items = data.items.map(it => ({
            product_name: it.product_name,
            quantity: it.quantity !== null && it.quantity !== undefined ? String(it.quantity) : '',
            unit: it.unit,
          }))
          setScanItems(items)
          setMappings(items.map(it => bestMatch(it.product_name, catalog)))
        }
      } finally {
        setScanning(false)
      }
    }
    reader.readAsDataURL(file)
  }

  function addScanRow() {
    setScanItems(prev => [...prev, { product_name: '', quantity: '', unit: '' }])
    setMappings(prev => [...prev, null])
  }

  function removeScanRow(i: number) {
    setScanItems(prev => prev.filter((_, idx) => idx !== i))
    setMappings(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateScanRow(i: number, field: 'product_name' | 'quantity' | 'unit', val: string) {
    setScanItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
    // Re-run match when name changes
    if (field === 'product_name') {
      setMappings(prev => prev.map((m, idx) => idx === i ? bestMatch(val, catalog) : m))
    }
  }

  function setMapping(i: number, catalogId: number | null) {
    setMappings(prev => prev.map((m, idx) => idx === i ? catalogId : m))
  }

  function goToConfirm() {
    // Sync mappings length with items length
    setMappings(prev => {
      const updated = [...prev]
      while (updated.length < scanItems.length) updated.push(null)
      return updated.slice(0, scanItems.length)
    })
    setModalStep('confirm')
  }

  async function saveEntry() {
    setSaving(true)
    try {
      const items = scanItems
        .filter(it => it.product_name.trim())
        .map(it => ({
          product_name: it.product_name.trim(),
          quantity: it.quantity !== '' ? parseFloat(it.quantity) : null,
          unit: it.unit.trim(),
        }))

      // 1. Add to catalog stock for matched items
      const addPromises = items.map((it, i) => {
        const catalogId = mappings[i] ?? null
        if (catalogId && it.quantity) {
          return fetch('/api/catalog', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: catalogId, action: 'add', qty: it.quantity }),
          })
        }
        return Promise.resolve()
      })
      await Promise.all(addPromises)

      // 2. Save restock history
      const res = await fetch('/api/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanned_at: scanDate ? new Date(scanDate).toISOString() : new Date().toISOString(),
          notes: scanNotes.trim() || null,
          items,
        }),
      })
      if (res.ok) {
        setShowScan(false)
        await Promise.all([fetchEntries(), fetchCatalog()])
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Inline item edit ────────────────────────────────────────────────────────

  async function saveItemEdit(item: RestockItem) {
    if (!editField) return
    const payload: Record<string, unknown> = { action: 'update_item', item_id: item.id }
    if (editField === 'quantity') payload.quantity = editValue === '' ? null : parseFloat(editValue)
    else payload[editField] = editValue
    await fetch('/api/restock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setEditItemId(null)
    setEditField(null)
    await fetchEntries()
  }

  async function addItemToEntry(entryId: number) {
    await fetch('/api/restock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_item', entry_id: entryId, product_name: 'สินค้าใหม่', quantity: null, unit: '' }),
    })
    await fetchEntries()
  }

  async function removeItem(itemId: number) {
    await fetch('/api/restock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_item', item_id: itemId }),
    })
    await fetchEntries()
  }

  // ── Entry meta edit ─────────────────────────────────────────────────────────

  function startEditEntry(entry: RestockEntry) {
    setEditEntryId(entry.id)
    setEditEntryDate(localISOString(new Date(entry.scanned_at)))
    setEditEntryNotes(entry.notes ?? '')
  }

  async function saveEntryMeta() {
    await fetch('/api/restock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editEntryId,
        scanned_at: editEntryDate ? new Date(editEntryDate).toISOString() : undefined,
        notes: editEntryNotes || null,
      }),
    })
    setEditEntryId(null)
    await fetchEntries()
  }

  async function deleteEntry(id: number) {
    if (!confirm('ลบรายการนี้?')) return
    await fetch('/api/restock', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchEntries()
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const catalogMap = Object.fromEntries(catalog.map(p => [p.id, p]))
  const mappedCount = mappings.filter((m, i) => m !== null && scanItems[i]?.product_name.trim()).length

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#5B4A3A] text-white px-4 py-3 flex items-center justify-between shadow">
        <h1 className="text-base font-bold">CF ระบบจัดการข้อมูล</h1>
      </div>

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
          📥 เติมสต็อค
        </span>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-700">ประวัติการเติมสต็อค</h2>
          <button
            onClick={openScan}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded shadow"
          >
            📷 สแกนเอกสาร
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-gray-400">ยังไม่มีรายการ กดสแกนเอกสารเพื่อเพิ่ม</div>
        ) : (
          <div className="space-y-3">
            {entries.map(entry => {
              const { date, time } = fmtDateTime(entry.scanned_at)
              const isCollapsed   = collapsed.has(entry.id)
              const isEditingMeta = editEntryId === entry.id
              return (
                <div key={entry.id} className="bg-white rounded-lg shadow border border-gray-200">
                  {/* Entry header */}
                  <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100">
                    {isEditingMeta ? (
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500 w-16">วันที่</label>
                          <input
                            type="datetime-local"
                            value={editEntryDate}
                            onChange={e => setEditEntryDate(e.target.value)}
                            className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-400"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500 w-16">หมายเหตุ</label>
                          <input
                            value={editEntryNotes}
                            onChange={e => setEditEntryNotes(e.target.value)}
                            placeholder="หมายเหตุ..."
                            className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-400"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={saveEntryMeta} className="text-xs bg-green-600 text-white px-3 py-1 rounded">บันทึก</button>
                          <button onClick={() => setEditEntryId(null)} className="text-xs text-gray-500 px-3 py-1 rounded border border-gray-300">ยกเลิก</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-gray-800">{date}</span>
                          <span className="text-xs text-gray-400">{time} น.</span>
                          {entry.notes && <span className="text-xs text-gray-500">· {entry.notes}</span>}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{entry.items.length} รายการ</div>
                      </div>
                    )}
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {!isEditingMeta && (
                        <button onClick={() => startEditEntry(entry)} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1" title="แก้ไข">✏️</button>
                      )}
                      <button onClick={() => deleteEntry(entry.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1" title="ลบ">🗑️</button>
                      <button
                        onClick={() => setCollapsed(prev => {
                          const s = new Set(prev)
                          if (s.has(entry.id)) s.delete(entry.id); else s.add(entry.id)
                          return s
                        })}
                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
                      >{isCollapsed ? '▼' : '▲'}</button>
                    </div>
                  </div>

                  {/* Items table */}
                  {!isCollapsed && (
                    <div className="px-3 py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="text-left py-1 pr-2 font-medium">ชื่อสินค้าในเอกสาร</th>
                            <th className="text-right py-1 pr-2 font-medium w-20">จำนวน</th>
                            <th className="text-left py-1 pr-2 font-medium w-16">หน่วย</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.items.map(item => (
                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-1 pr-2">
                                {editItemId === item.id && editField === 'product_name' ? (
                                  <input autoFocus value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveItemEdit(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') { setEditItemId(null); setEditField(null) } }}
                                    className="w-full text-sm border border-green-400 rounded px-1 py-0.5 focus:outline-none"
                                  />
                                ) : (
                                  <span className="cursor-pointer hover:underline text-gray-800"
                                    onClick={() => { setEditItemId(item.id); setEditField('product_name'); setEditValue(item.product_name) }}>
                                    {item.product_name || <span className="text-gray-300">-</span>}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 pr-2 text-right">
                                {editItemId === item.id && editField === 'quantity' ? (
                                  <input autoFocus type="number" value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveItemEdit(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') { setEditItemId(null); setEditField(null) } }}
                                    className="w-full text-sm border border-green-400 rounded px-1 py-0.5 focus:outline-none text-right"
                                  />
                                ) : (
                                  <span className="cursor-pointer hover:underline text-gray-800"
                                    onClick={() => { setEditItemId(item.id); setEditField('quantity'); setEditValue(item.quantity !== null ? String(item.quantity) : '') }}>
                                    {item.quantity !== null ? item.quantity.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : <span className="text-gray-300">-</span>}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 pr-2">
                                {editItemId === item.id && editField === 'unit' ? (
                                  <input autoFocus value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveItemEdit(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') { setEditItemId(null); setEditField(null) } }}
                                    className="w-full text-sm border border-green-400 rounded px-1 py-0.5 focus:outline-none"
                                  />
                                ) : (
                                  <span className="cursor-pointer hover:underline text-gray-500"
                                    onClick={() => { setEditItemId(item.id); setEditField('unit'); setEditValue(item.unit) }}>
                                    {item.unit || <span className="text-gray-300">-</span>}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 text-center">
                                <button onClick={() => removeItem(item.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button onClick={() => addItemToEntry(entry.id)}
                        className="mt-2 text-xs text-green-600 hover:text-green-800 flex items-center gap-1">
                        <span>+</span> เพิ่มรายการ
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Scan Modal ── */}
      {showScan && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white w-full sm:max-w-xl sm:rounded-xl rounded-t-xl max-h-[92vh] flex flex-col">

            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                {modalStep === 'confirm' && (
                  <button onClick={() => setModalStep('edit')} className="text-gray-400 hover:text-gray-600 text-sm mr-1">← กลับ</button>
                )}
                <h3 className="font-semibold text-gray-800">
                  {modalStep === 'edit' ? '📷 สแกนเอกสาร' : '🔗 จับคู่สต็อคสินค้า'}
                </h3>
                {modalStep === 'confirm' && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    จับคู่ {mappedCount}/{scanItems.filter(it => it.product_name.trim()).length} รายการ
                  </span>
                )}
              </div>
              <button onClick={() => setShowScan(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Step indicator */}
            <div className="flex border-b border-gray-100 shrink-0">
              <div className={`flex-1 py-2 text-center text-xs font-medium ${modalStep === 'edit' ? 'text-green-600 border-b-2 border-green-500' : 'text-gray-400'}`}>
                1 แก้ไขรายการ
              </div>
              <div className={`flex-1 py-2 text-center text-xs font-medium ${modalStep === 'confirm' ? 'text-green-600 border-b-2 border-green-500' : 'text-gray-400'}`}>
                2 จับคู่สต็อค &amp; ยืนยัน
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="px-4 py-4 space-y-4">

                {/* ── STEP 1: EDIT ── */}
                {modalStep === 'edit' && (
                  <>
                    {/* Date + Notes */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">วันที่รับ</label>
                        <input type="datetime-local" value={scanDate}
                          onChange={e => setScanDate(e.target.value)}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
                        <input value={scanNotes} onChange={e => setScanNotes(e.target.value)}
                          placeholder="เช่น รับของจากซัพพลายเออร์..."
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
                        />
                      </div>
                    </div>

                    {/* Image upload */}
                    <div>
                      <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
                      />
                      {scanPreview ? (
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={scanPreview} alt="preview" className="w-full max-h-40 object-contain rounded border border-gray-200" />
                          <button onClick={() => fileInputRef.current?.click()}
                            className="absolute bottom-2 right-2 bg-white/80 text-xs text-gray-600 border border-gray-300 rounded px-2 py-1">
                            เปลี่ยนรูป
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => fileInputRef.current?.click()}
                          className="w-full border-2 border-dashed border-gray-300 rounded-lg py-8 text-gray-400 hover:border-green-400 hover:text-green-500 transition-colors text-sm">
                          📷 แตะเพื่อถ่ายรูป / เลือกรูป
                        </button>
                      )}
                    </div>

                    {scanning && (
                      <div className="text-center py-3 text-sm text-gray-500">🔍 กำลังอ่านข้อมูล...</div>
                    )}

                    {/* Items list */}
                    {!scanning && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">รายการสินค้าในเอกสาร</span>
                          <button onClick={addScanRow} className="text-xs text-green-600 hover:text-green-800">+ เพิ่มแถว</button>
                        </div>
                        {scanItems.length === 0 ? (
                          <div className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded">
                            {scanPreview ? 'ไม่พบรายการในเอกสาร' : 'สแกนรูปเพื่อดึงข้อมูลอัตโนมัติ หรือกด + เพิ่มแถว'}
                          </div>
                        ) : (
                          <div className="border border-gray-100 rounded overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr className="text-xs text-gray-400">
                                  <th className="text-left py-1.5 px-2 font-medium">ชื่อสินค้า</th>
                                  <th className="text-right py-1.5 px-2 font-medium w-20">จำนวน</th>
                                  <th className="text-left py-1.5 px-2 font-medium w-16">หน่วย</th>
                                  <th className="w-7"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {scanItems.map((it, i) => (
                                  <tr key={i} className="border-t border-gray-50">
                                    <td className="py-1 px-1">
                                      <input value={it.product_name}
                                        onChange={e => updateScanRow(i, 'product_name', e.target.value)}
                                        className="w-full text-sm border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-green-400"
                                      />
                                    </td>
                                    <td className="py-1 px-1">
                                      <input type="number" value={it.quantity}
                                        onChange={e => updateScanRow(i, 'quantity', e.target.value)}
                                        className="w-full text-sm border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-green-400 text-right"
                                      />
                                    </td>
                                    <td className="py-1 px-1">
                                      <input value={it.unit}
                                        onChange={e => updateScanRow(i, 'unit', e.target.value)}
                                        placeholder="หน่วย"
                                        className="w-full text-sm border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-green-400"
                                      />
                                    </td>
                                    <td className="py-1 text-center">
                                      <button onClick={() => removeScanRow(i)} className="text-gray-300 hover:text-red-400 text-sm">✕</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Next button */}
                    <button
                      onClick={goToConfirm}
                      disabled={scanning || scanItems.filter(it => it.product_name.trim()).length === 0}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-lg text-sm"
                    >
                      ถัดไป: จับคู่สต็อค →
                    </button>
                  </>
                )}

                {/* ── STEP 2: CONFIRM + MAPPING ── */}
                {modalStep === 'confirm' && (
                  <>
                    <p className="text-xs text-gray-500">
                      เลือกว่าสินค้าแต่ละรายการในเอกสาร ตรงกับสินค้าใดในสต็อค
                      ระบบเลือกให้อัตโนมัติ — แก้ไขได้ก่อนยืนยัน
                    </p>

                    <div className="space-y-3">
                      {scanItems.map((it, i) => {
                        if (!it.product_name.trim()) return null
                        const mapped     = mappings[i] ? catalogMap[mappings[i]!] : null
                        const qty        = parseFloat(it.quantity) || 0
                        const currentQty = mapped?.quantity ?? 0
                        return (
                          <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                            {/* Scanned item info */}
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-sm font-medium text-gray-800">{it.product_name}</span>
                                {it.quantity && (
                                  <span className="ml-2 text-sm text-green-700 font-semibold">+{it.quantity} {it.unit}</span>
                                )}
                              </div>
                              {mapped && qty > 0 && (
                                <div className="text-right shrink-0 ml-2">
                                  <div className="text-xs text-gray-400">สต็อคใหม่</div>
                                  <div className="text-sm font-bold text-green-600">
                                    {(currentQty + qty).toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Catalog mapping select */}
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">จับคู่กับสินค้าในสต็อค</label>
                              <select
                                value={mappings[i] ?? ''}
                                onChange={e => setMapping(i, e.target.value ? parseInt(e.target.value) : null)}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                              >
                                <option value="">— ไม่เพิ่มสต็อค —</option>
                                {Object.entries(catalogByGroup).map(([group, products]) => (
                                  <optgroup key={group} label={group}>
                                    {products.map(p => (
                                      <option key={p.id} value={p.id}>
                                        {p.product_name}
                                        {p.quantity !== null ? ` (มี ${p.quantity.toLocaleString('th-TH', { maximumFractionDigits: 2 })})` : ''}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>

                            {/* Current stock info */}
                            {mapped && (
                              <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1.5">
                                <span>หมวด: <span className="font-medium text-gray-700">{mapped.group_name}</span></span>
                                <span>·</span>
                                <span>สต็อคปัจจุบัน: <span className="font-medium text-gray-700">{(mapped.quantity ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</span></span>
                                {qty > 0 && (
                                  <>
                                    <span>→</span>
                                    <span className="text-green-700 font-semibold">{(currentQty + qty).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Summary */}
                    {mappedCount > 0 && (
                      <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
                        ✅ จะเพิ่มสต็อค {mappedCount} รายการ
                        {scanItems.filter(it => it.product_name.trim()).length - mappedCount > 0 &&
                          ` · บันทึกประวัติเท่านั้น ${scanItems.filter(it => it.product_name.trim()).length - mappedCount} รายการ`
                        }
                      </div>
                    )}

                    <button
                      onClick={saveEntry}
                      disabled={saving}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg text-sm"
                    >
                      {saving ? 'กำลังบันทึก...' : `✅ ยืนยันเติมสต็อค${mappedCount > 0 ? ` (${mappedCount} รายการ)` : ''}`}
                    </button>
                  </>
                )}

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
