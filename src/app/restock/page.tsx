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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RestockPage() {
  const [entries, setEntries] = useState<RestockEntry[]>([])
  const [loading, setLoading] = useState(true)

  // scan modal
  const [showScan, setShowScan] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanPreview, setScanPreview] = useState<string | null>(null)
  const [scanMime, setScanMime] = useState('image/jpeg')
  const [scanItems, setScanItems] = useState<Array<{ product_name: string; quantity: string; unit: string }>>([])
  const [scanDate, setScanDate] = useState('')
  const [scanNotes, setScanNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // inline edit
  const [editItemId, setEditItemId] = useState<number | null>(null)
  const [editField, setEditField] = useState<'product_name' | 'quantity' | 'unit' | null>(null)
  const [editValue, setEditValue] = useState('')

  // edit entry date/notes
  const [editEntryId, setEditEntryId] = useState<number | null>(null)
  const [editEntryDate, setEditEntryDate] = useState('')
  const [editEntryNotes, setEditEntryNotes] = useState('')

  // expand/collapse entries
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/restock')
    const data = await res.json() as RestockEntry[]
    setEntries(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  // ── Scan modal ──────────────────────────────────────────────────────────────

  function openScan() {
    setScanPreview(null)
    setScanItems([])
    setScanDate(localISOString(new Date()))
    setScanNotes('')
    setShowScan(true)
  }

  async function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setScanPreview(dataUrl)
      const base64 = dataUrl.split(',')[1]
      const mime = file.type || 'image/jpeg'
      setScanMime(mime)
      setScanning(true)
      try {
        const res = await fetch('/api/restock/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64, mime_type: mime }),
        })
        const data = await res.json() as { items?: Array<{ product_name: string; quantity: number | null; unit: string }>; error?: string }
        if (data.items) {
          setScanItems(data.items.map(it => ({
            product_name: it.product_name,
            quantity: it.quantity !== null && it.quantity !== undefined ? String(it.quantity) : '',
            unit: it.unit,
          })))
        }
      } finally {
        setScanning(false)
      }
    }
    reader.readAsDataURL(file)
  }

  function addScanRow() {
    setScanItems(prev => [...prev, { product_name: '', quantity: '', unit: '' }])
  }

  function removeScanRow(i: number) {
    setScanItems(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateScanRow(i: number, field: 'product_name' | 'quantity' | 'unit', val: string) {
    setScanItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
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
        await fetchEntries()
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
              const isCollapsed = collapsed.has(entry.id)
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
                        <button
                          onClick={() => startEditEntry(entry)}
                          className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1"
                          title="แก้ไขวันที่/หมายเหตุ"
                        >✏️</button>
                      )}
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                        title="ลบ"
                      >🗑️</button>
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
                            <th className="text-left py-1 pr-2 font-medium">ชื่อสินค้า</th>
                            <th className="text-right py-1 pr-2 font-medium w-20">จำนวน</th>
                            <th className="text-left py-1 pr-2 font-medium w-16">หน่วย</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.items.map(item => (
                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                              {/* product_name */}
                              <td className="py-1 pr-2">
                                {editItemId === item.id && editField === 'product_name' ? (
                                  <input
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveItemEdit(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') { setEditItemId(null); setEditField(null) } }}
                                    className="w-full text-sm border border-green-400 rounded px-1 py-0.5 focus:outline-none"
                                  />
                                ) : (
                                  <span
                                    className="cursor-pointer hover:underline text-gray-800"
                                    onClick={() => { setEditItemId(item.id); setEditField('product_name'); setEditValue(item.product_name) }}
                                  >{item.product_name || <span className="text-gray-300">-</span>}</span>
                                )}
                              </td>
                              {/* quantity */}
                              <td className="py-1 pr-2 text-right">
                                {editItemId === item.id && editField === 'quantity' ? (
                                  <input
                                    autoFocus
                                    type="number"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveItemEdit(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') { setEditItemId(null); setEditField(null) } }}
                                    className="w-full text-sm border border-green-400 rounded px-1 py-0.5 focus:outline-none text-right"
                                  />
                                ) : (
                                  <span
                                    className="cursor-pointer hover:underline text-gray-800"
                                    onClick={() => { setEditItemId(item.id); setEditField('quantity'); setEditValue(item.quantity !== null ? String(item.quantity) : '') }}
                                  >{item.quantity !== null ? item.quantity.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : <span className="text-gray-300">-</span>}</span>
                                )}
                              </td>
                              {/* unit */}
                              <td className="py-1 pr-2">
                                {editItemId === item.id && editField === 'unit' ? (
                                  <input
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => saveItemEdit(item)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') { setEditItemId(null); setEditField(null) } }}
                                    className="w-full text-sm border border-green-400 rounded px-1 py-0.5 focus:outline-none"
                                  />
                                ) : (
                                  <span
                                    className="cursor-pointer hover:underline text-gray-500"
                                    onClick={() => { setEditItemId(item.id); setEditField('unit'); setEditValue(item.unit) }}
                                  >{item.unit || <span className="text-gray-300">-</span>}</span>
                                )}
                              </td>
                              <td className="py-1 text-center">
                                <button onClick={() => removeItem(item.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        onClick={() => addItemToEntry(entry.id)}
                        className="mt-2 text-xs text-green-600 hover:text-green-800 flex items-center gap-1"
                      >
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

      {/* Scan Modal */}
      {showScan && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-800">สแกนเอกสาร</h3>
              <button onClick={() => setShowScan(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-4 py-4 space-y-4">

              {/* Date */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-20 shrink-0">วันที่รับ</label>
                <input
                  type="datetime-local"
                  value={scanDate}
                  onChange={e => setScanDate(e.target.value)}
                  className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
                />
              </div>

              {/* Notes */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 w-20 shrink-0">หมายเหตุ</label>
                <input
                  value={scanNotes}
                  onChange={e => setScanNotes(e.target.value)}
                  placeholder="เช่น รับของจากซัพพลายเออร์..."
                  className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
                />
              </div>

              {/* Image upload */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
                />
                {scanPreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={scanPreview} alt="preview" className="w-full max-h-48 object-contain rounded border border-gray-200" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-2 right-2 bg-white/80 text-xs text-gray-600 border border-gray-300 rounded px-2 py-1"
                    >เปลี่ยนรูป</button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg py-8 text-gray-400 hover:border-green-400 hover:text-green-500 transition-colors text-sm"
                  >
                    📷 แตะเพื่อถ่ายรูป / เลือกรูป
                  </button>
                )}
              </div>

              {/* Scanning indicator */}
              {scanning && (
                <div className="text-center py-3 text-sm text-gray-500">🔍 กำลังอ่านข้อมูล...</div>
              )}

              {/* Scanned items */}
              {!scanning && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">รายการสินค้า</span>
                    <button onClick={addScanRow} className="text-xs text-green-600 hover:text-green-800">+ เพิ่มแถว</button>
                  </div>
                  {scanItems.length === 0 ? (
                    <div className="text-xs text-gray-400 text-center py-3 border border-dashed border-gray-200 rounded">
                      {scanPreview ? 'ไม่พบรายการ' : 'สแกนรูปเพื่อดึงข้อมูลอัตโนมัติ หรือกด + เพิ่มแถว'}
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-100">
                          <th className="text-left py-1 pr-1 font-medium">ชื่อสินค้า</th>
                          <th className="text-right py-1 pr-1 font-medium w-20">จำนวน</th>
                          <th className="text-left py-1 pr-1 font-medium w-16">หน่วย</th>
                          <th className="w-6"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanItems.map((it, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="py-0.5 pr-1">
                              <input
                                value={it.product_name}
                                onChange={e => updateScanRow(i, 'product_name', e.target.value)}
                                className="w-full text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-green-400"
                              />
                            </td>
                            <td className="py-0.5 pr-1">
                              <input
                                type="number"
                                value={it.quantity}
                                onChange={e => updateScanRow(i, 'quantity', e.target.value)}
                                className="w-full text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-green-400 text-right"
                              />
                            </td>
                            <td className="py-0.5 pr-1">
                              <input
                                value={it.unit}
                                onChange={e => updateScanRow(i, 'unit', e.target.value)}
                                placeholder="หน่วย"
                                className="w-full text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-green-400"
                              />
                            </td>
                            <td className="py-0.5 text-center">
                              <button onClick={() => removeScanRow(i)} className="text-gray-300 hover:text-red-400">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Save */}
              <button
                onClick={saveEntry}
                disabled={saving || scanning}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-lg text-sm"
              >
                {saving ? 'กำลังบันทึก...' : '💾 บันทึกรายการ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
