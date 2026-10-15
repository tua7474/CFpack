'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'mapping' | 'preview' | 'done'

interface ParsedItem { ocha_name: string; qty: number }

interface ParsedResult {
  date: string
  branch_name: string
  branch_id: number | null
  filename: string
  items: ParsedItem[]
  unmapped: string[]
}

interface TempMapping {
  ocha_name: string
  product_id: number | null
  multiplier: number
  skip: boolean
  note: string
}

interface Mapping {
  id: number
  ocha_name: string
  product_id: number | null
  product_name: string | null
  group_name: string | null
  multiplier: number
  skip: boolean
  note: string | null
}

interface ProductCatalog {
  id: number
  group_name: string
  product_name: string
}

interface Branch {
  id: number
  name: string
}

interface ImportRecord {
  id: number
  import_date: string
  branch_id: number | null
  branch_name: string
  filename: string | null
  imported_at: string
  row_count: number
  status: string
}

interface PreviewItem extends ParsedItem {
  mapping: Mapping | null
  deducted_qty: number
  skipped: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUnmapped(items: ParsedItem[], mappings: Mapping[]): string[] {
  const mapped = new Set(mappings.map(m => m.ocha_name))
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (!seen.has(item.ocha_name) && !mapped.has(item.ocha_name)) {
      out.push(item.ocha_name)
      seen.add(item.ocha_name)
    }
  }
  return out
}

function computePreview(items: ParsedItem[], mappings: Mapping[]): PreviewItem[] {
  const map = new Map(mappings.map(m => [m.ocha_name, m]))
  return items.map(item => {
    const mapping = map.get(item.ocha_name) ?? null
    const skipped = !mapping || mapping.skip || !mapping.product_id
    const deducted_qty = skipped ? 0 : item.qty * (Number(mapping!.multiplier) || 1)
    return { ...item, mapping, deducted_qty, skipped }
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OchaImportPage() {
  const [step,     setStep]     = useState<Step>('upload')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const [products,  setProducts]  = useState<ProductCatalog[]>([])
  const [branches,  setBranches]  = useState<Branch[]>([])
  const [mappings,  setMappings]  = useState<Mapping[]>([])
  const [imports,   setImports]   = useState<ImportRecord[]>([])

  const [parsed,         setParsed]         = useState<ParsedResult | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null)
  const [tempMappings,   setTempMappings]   = useState<TempMapping[]>([])
  const [importId,       setImportId]       = useState<number | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const res  = await fetch('/api/ocha-import')
    const data = await res.json()
    setProducts(data.products ?? [])
    setBranches(data.branches ?? [])
    setMappings(data.mappings  ?? [])
    setImports(data.imports   ?? [])
    return data
  }

  // ── Upload & parse ──────────────────────────────────────────────────────────

  async function handleUpload(file: File) {
    setLoading(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/ocha-import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'อ่านไฟล์ไม่สำเร็จ')

      setParsed(data)
      setSelectedBranch(data.branch_id)

      const unmapped = getUnmapped(data.items, mappings)
      if (unmapped.length > 0) {
        setTempMappings(unmapped.map(n => ({ ocha_name: n, product_id: null, multiplier: 1, skip: false, note: '' })))
        setStep('mapping')
      } else {
        setStep('preview')
      }
    } catch (e) { setError(String(e)) }
    finally     { setLoading(false) }
  }

  // ── Save mappings ───────────────────────────────────────────────────────────

  async function handleSaveMappings() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/ocha-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_mappings', mappings: tempMappings }),
      })
      if (!res.ok) throw new Error((await res.json()).error)

      const fresh    = await fetchData()
      const stillUnmapped = getUnmapped(parsed!.items, fresh.mappings)
      if (stillUnmapped.length > 0) {
        setTempMappings(stillUnmapped.map(n => ({ ocha_name: n, product_id: null, multiplier: 1, skip: false, note: '' })))
        setError(`ยังมีสินค้าที่ยังไม่จับคู่อีก ${stillUnmapped.length} รายการ`)
      } else {
        setError(null)
        setStep('preview')
      }
    } catch (e) { setError(String(e)) }
    finally     { setLoading(false) }
  }

  // ── Confirm import ──────────────────────────────────────────────────────────

  async function handleConfirm() {
    if (!parsed) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/ocha-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          date:        parsed.date,
          branch_id:   selectedBranch,
          branch_name: parsed.branch_name,
          filename:    parsed.filename,
          items:       parsed.items,
        }),
      })
      const data = await res.json()
      if (res.status === 409) {
        setError(`ซ้ำ! วันที่ ${parsed.date} สาขานี้ถูกนำเข้าแล้ว (import #${data.import_id}) — ถ้าต้องการนำเข้าใหม่ให้ย้อนกลับอันเดิมก่อน`)
        return
      }
      if (!res.ok) throw new Error(data.error)
      setImportId(data.import_id)
      setStep('done')
      fetchData()
    } catch (e) { setError(String(e)) }
    finally     { setLoading(false) }
  }

  // ── Rollback ────────────────────────────────────────────────────────────────

  async function handleRollback(id: number, date: string, branchName: string) {
    if (!confirm(`ย้อนกลับการนำเข้า #${id} (${date} · ${branchName})?\nสต็อคสาขาจะถูกคืนค่า`)) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/ocha-import', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_id: id }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      fetchData()
    } catch (e) { setError(String(e)) }
    finally     { setLoading(false) }
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  function reset() {
    setStep('upload'); setParsed(null); setTempMappings([])
    setError(null); setImportId(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const preview = parsed ? computePreview(parsed.items, mappings) : []
  const deductCount = preview.filter(p => !p.skipped).length
  const skipCount   = preview.filter(p =>  p.skipped).length

  const productGroups = products.reduce((acc, p) => {
    if (!acc[p.group_name]) acc[p.group_name] = []
    acc[p.group_name].push(p)
    return acc
  }, {} as Record<string, ProductCatalog[]>)

  const canSaveMappings = tempMappings.length > 0 && tempMappings.every(m => m.skip || m.product_id)

  const tabCls  = 'inline-block px-4 py-3 text-sm font-medium text-gray-500 hover:text-green-400 hover:bg-green-50 transition-colors whitespace-nowrap'
  const numCls  = 'w-full px-2 py-1 border border-gray-200 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-[#9b9484] disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-[#9b9484] text-white px-6 py-3 shadow">
        <h1 className="text-xl font-bold">CF ระบบจัดการข้อมูล</h1>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 shadow-sm flex overflow-x-auto">
        <Link href="/"               className={tabCls}>📦 สต็อคสินค้า</Link>
        <Link href="/stock"          className={tabCls}>🌿 สต็อคกระดาษฝอย</Link>
        <Link href="/orders"         className={tabCls}>📋 ใบจอง</Link>
        <Link href="/branches"       className={tabCls}>🏪 สาขาและตัวแทน</Link>
        <Link href="/delivery"       className={tabCls}>🚚 จัดส่ง</Link>
        <Link href="/withdrawal"     className={tabCls}>📤 เบิกของ</Link>
        <Link href="/restock"        className={tabCls}>📥 ใบPO</Link>
        <Link href="/foy-line"       className={tabCls}>🌀 ไลน์ผลิตกระดาษฝอย</Link>
        <Link href="/finance"        className={tabCls}>💰 การเงิน</Link>
        <Link href="/branch-stock"   className={tabCls}>🏬 สต็อคทุกสาขา</Link>
        <Link href="/branch-foy-stock" className={tabCls}>🌿 สต็อคกระดาษฝอยทุกสาขา</Link>
        <span className="inline-block px-4 py-3 text-sm font-medium border-b-2 border-gray-500 text-green-400 bg-green-50 whitespace-nowrap">📊 นำเข้า Ocha</span>
      </div>

      <main className="p-4 max-w-4xl mx-auto">

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* ── Step: Upload ── */}
        {step === 'upload' && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-700 mb-1">📊 นำเข้ายอดขาย Ocha</h2>
            <p className="text-sm text-gray-400 mb-4">อัปโหลดไฟล์ xlsx ที่ export จาก Ocha หัวข้อ "รายการขายดี"</p>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#9b9484] hover:bg-amber-50/30 transition-colors">
              <div className="text-4xl mb-1">📂</div>
              <div className="text-sm text-gray-500">คลิกเพื่อเลือกไฟล์ .xlsx</div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
              />
            </label>
            {loading && <p className="mt-3 text-sm text-gray-400 text-center">กำลังวิเคราะห์ไฟล์...</p>}
          </div>
        )}

        {/* ── Step: Mapping ── */}
        {step === 'mapping' && parsed && (
          <div className="bg-white rounded-lg border border-amber-200 shadow-sm p-6 mb-6">
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-base font-semibold text-amber-800">⚠️ พบสินค้าที่ยังไม่จับคู่ {tempMappings.length} รายการ</h2>
              <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 ml-4">← อัปโหลดใหม่</button>
            </div>
            <p className="text-sm text-amber-600 mb-4">ต้องจับคู่ให้ครบก่อนนำเข้า หรือทำเครื่องหมาย "ข้าม" ถ้าไม่ต้องการตัดสต็อก</p>

            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-amber-50 border-b border-amber-200">
                    <th className="text-left px-3 py-2 font-medium text-amber-800 w-[200px]">ชื่อสินค้าใน Ocha</th>
                    <th className="text-left px-3 py-2 font-medium text-amber-800">สินค้าใน CF</th>
                    <th className="text-center px-3 py-2 font-medium text-amber-800 w-20">ตัวคูณ</th>
                    <th className="text-center px-3 py-2 font-medium text-amber-800 w-16">ข้าม</th>
                  </tr>
                </thead>
                <tbody>
                  {tempMappings.map((tm, i) => (
                    <tr key={tm.ocha_name} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-3 py-2 font-medium text-gray-700">{tm.ocha_name}</td>
                      <td className="px-3 py-2">
                        <select
                          value={tm.product_id ?? ''}
                          disabled={tm.skip}
                          onChange={e => {
                            const val = e.target.value ? Number(e.target.value) : null
                            setTempMappings(prev => prev.map((m, j) => j === i ? { ...m, product_id: val } : m))
                          }}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#9b9484] bg-white disabled:opacity-40"
                        >
                          <option value="">-- เลือกสินค้า CF --</option>
                          {Object.entries(productGroups).map(([group, prods]) => (
                            <optgroup key={group} label={group}>
                              {prods.map(p => (
                                <option key={p.id} value={p.id}>{p.product_name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.01" min="0.01"
                          value={tm.multiplier}
                          disabled={tm.skip}
                          onChange={e => {
                            const val = Number(e.target.value) || 1
                            setTempMappings(prev => prev.map((m, j) => j === i ? { ...m, multiplier: val } : m))
                          }}
                          className={numCls}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={tm.skip}
                          onChange={e => setTempMappings(prev => prev.map((m, j) => j === i ? { ...m, skip: e.target.checked } : m))}
                          className="w-4 h-4 accent-[#9b9484]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!canSaveMappings && (
              <p className="text-xs text-red-500 mb-3">กรุณาเลือกสินค้า CF หรือทำเครื่องหมาย "ข้าม" ให้ครบทุกแถว</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleSaveMappings}
                disabled={loading || !canSaveMappings}
                className="px-5 py-2 bg-[#9b9484] hover:bg-[#7a7568] text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'กำลังบันทึก...' : 'บันทึกการจับคู่และตรวจสอบอีกครั้ง'}
              </button>
              <button onClick={reset} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">ยกเลิก</button>
            </div>
          </div>
        )}

        {/* ── Step: Preview ── */}
        {step === 'preview' && parsed && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mb-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-700">✅ ยืนยันการนำเข้า</h2>
              <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">← อัปโหลดใหม่</button>
            </div>

            {/* Info */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-0.5">วันที่ (จากไฟล์)</div>
                <div className="font-semibold text-gray-700">{parsed.date}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">สาขา (จากไฟล์: {parsed.branch_name})</div>
                <select
                  value={selectedBranch ?? ''}
                  onChange={e => setSelectedBranch(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#9b9484] bg-white"
                >
                  <option value="">-- ไม่ระบุสาขา --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>

            {!selectedBranch && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700 text-sm">
                ⚠️ ยังไม่ได้เลือกสาขา — ประวัติจะถูกบันทึกแต่สต็อคสาขาจะไม่ถูกตัด
              </div>
            )}

            {/* Summary table */}
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#9b9484] text-white">
                    <th className="text-left px-3 py-2">สินค้า Ocha</th>
                    <th className="text-center px-3 py-2 w-20">จำนวนขาย</th>
                    <th className="text-left px-3 py-2">สินค้า CF</th>
                    <th className="text-center px-3 py-2 w-16">×</th>
                    <th className="text-center px-3 py-2 w-24 bg-green-700">ตัดสต็อก</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((item, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-100 ${item.skipped ? 'opacity-40' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    >
                      <td className="px-3 py-1.5 font-medium text-gray-700">{item.ocha_name}</td>
                      <td className="px-3 py-1.5 text-center">{item.qty.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-gray-600 text-xs">
                        {item.skipped
                          ? <span className="text-gray-300 italic">ข้าม</span>
                          : item.mapping?.product_name ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-center text-gray-400 text-xs">
                        {!item.skipped && item.mapping ? `×${item.mapping.multiplier}` : ''}
                      </td>
                      <td className={`px-3 py-1.5 text-center font-medium ${item.skipped ? 'text-gray-300' : 'text-green-700'}`}>
                        {item.skipped ? '—' : item.deducted_qty.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-medium">
                    <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-500">
                      ตัดสต็อก {deductCount} รายการ · ข้าม {skipCount} รายการ
                    </td>
                    <td className="px-3 py-2 text-center text-green-700">
                      {preview.reduce((s, p) => s + p.deducted_qty, 0)
                        .toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="px-6 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'กำลังบันทึก...' : 'ยืนยันนำเข้า'}
              </button>
              <button onClick={reset} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">ยกเลิก</button>
            </div>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <div className="bg-white rounded-lg border border-green-200 shadow-sm p-8 text-center mb-6">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-lg font-semibold text-green-700 mb-1">นำเข้าสำเร็จ</h2>
            <p className="text-sm text-gray-400 mb-5">บันทึกแล้ว · import #{importId}</p>
            <button
              onClick={reset}
              className="px-5 py-2 bg-[#9b9484] hover:bg-[#7a7568] text-white text-sm font-medium rounded transition-colors"
            >
              นำเข้าไฟล์ใหม่
            </button>
          </div>
        )}

        {/* ── History ── */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 text-sm">ประวัติการนำเข้า</h3>
            <span className="text-xs text-gray-400">{imports.length} รายการ</span>
          </div>
          {imports.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">ยังไม่มีประวัติ</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">วันที่ (ไฟล์)</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">สาขา</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">ไฟล์</th>
                    <th className="text-center px-3 py-2 text-gray-500 font-medium">รายการ</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">นำเข้าเมื่อ</th>
                    <th className="text-center px-3 py-2 text-gray-500 font-medium">สถานะ</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp, i) => (
                    <tr
                      key={imp.id}
                      className={`border-b border-gray-50 hover:bg-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'} ${imp.status === 'rolled_back' ? 'opacity-50' : ''}`}
                    >
                      <td className="px-3 py-1.5 text-gray-400">{imp.id}</td>
                      <td className="px-3 py-1.5 font-medium">{imp.import_date}</td>
                      <td className="px-3 py-1.5">{imp.branch_name}</td>
                      <td className="px-3 py-1.5 text-gray-400 truncate max-w-[140px]">{imp.filename ?? '—'}</td>
                      <td className="px-3 py-1.5 text-center">{imp.row_count}</td>
                      <td className="px-3 py-1.5 text-gray-400">
                        {new Date(imp.imported_at).toLocaleString('th-TH', {
                          timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short',
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`px-2 py-0.5 rounded font-medium ${imp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {imp.status === 'active' ? 'ใช้งาน' : 'ย้อนกลับแล้ว'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {imp.status === 'active' && (
                          <button
                            onClick={() => handleRollback(imp.id, imp.import_date, imp.branch_name)}
                            className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 transition-colors"
                          >
                            ย้อนกลับ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
