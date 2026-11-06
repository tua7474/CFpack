'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

interface CatalogProduct {
  id: number
  group_name: string
  product_name: string
  quantity: number | null
  show_in_booking: boolean
}

interface StockItem {
  id: number
  model_name: string
  category: string
  color_code: string
  color_name: string
  stock_qty: number
  show_in_booking: boolean
}

interface Snapshot {
  snapshot_no: string
  branch_id:   number | null
  branch_name: string | null
  status: string
  quantities: Record<string, number>
  foy_quantities: Record<string, number>
  ocr_warnings: { id: number; name: string; reason?: string }[]
}

function StockFormInner() {
  const params  = useSearchParams()
  const snap_no = params.get('snap') ?? ''

  const [snap,    setSnap]    = useState<Snapshot | null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [stock,   setStock]   = useState<StockItem[]>([])
  const [qty,     setQty]     = useState<Record<string, number>>({})
  const [tab,     setTab]     = useState<1 | 2>(1)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!snap_no) { setError('ไม่พบรหัสฟอร์ม'); setLoading(false); return }

    Promise.all([
      fetch(`/api/stock-snapshot?no=${snap_no}`).then(r => r.json()),
      fetch('/api/catalog').then(r => r.json()),
      fetch('/api/stock').then(r => r.json()),
    ]).then(([snapData, catData, stockData]) => {
      if (snapData.error) { setError(snapData.error); return }
      setSnap(snapData)

      const products: CatalogProduct[] = Array.isArray(catData)
        ? catData.filter((p: CatalogProduct) => p.show_in_booking && p.group_name !== 'กระดาษฝอย')
        : []
      setCatalog(products)

      const items: StockItem[] = Array.isArray(stockData?.items)
        ? stockData.items.filter((s: StockItem) => s.show_in_booking)
        : []
      setStock(items)

      const init: Record<string, number> = {}
      for (const [k, v] of Object.entries(snapData.quantities ?? {})) {
        init[`c_${k}`] = Number(v)
      }
      for (const [k, v] of Object.entries(snapData.foy_quantities ?? {})) {
        init[`f_${k}`] = Number(v)
      }
      setQty(init)
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [snap_no])

  const handleChange = useCallback((key: string, val: string) => {
    const n = val === '' ? 0 : parseFloat(val)
    setQty(prev => ({ ...prev, [key]: isNaN(n) ? 0 : n }))
  }, [])

  const handleSubmit = async () => {
    if (!snap_no) return
    setSaving(true)
    try {
      const quantities: Record<string, number>     = {}
      const foy_quantities: Record<string, number> = {}
      for (const [k, v] of Object.entries(qty)) {
        if (v > 0) {
          if (k.startsWith('c_')) quantities[k.slice(2)]     = v
          if (k.startsWith('f_')) foy_quantities[k.slice(2)] = v
        }
      }
      // บันทึกจำนวนลง snapshot
      const res = await fetch('/api/stock-snapshot', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snap_no, action: 'set_quantities', quantities, foy_quantities }),
      })
      if (!res.ok) throw new Error(await res.text())

      // ถ้ามี branch_id → ยืนยันเลย ไม่ต้องผ่าน LINE
      if (snap?.branch_id) {
        const res2 = await fetch('/api/stock-snapshot', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snap_no, action: 'confirm' }),
        })
        if (!res2.ok) throw new Error(await res2.text())
      }

      setDone(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const warnSet = new Set<string>()
  if (snap) {
    for (const w of snap.ocr_warnings ?? []) warnSet.add(String(w.id))
  }

  const catalogGroups: Record<string, CatalogProduct[]> = {}
  for (const p of catalog) {
    if (!catalogGroups[p.group_name]) catalogGroups[p.group_name] = []
    catalogGroups[p.group_name].push(p)
  }

  const foyCategories: Record<string, Record<string, StockItem[]>> = {}
  for (const s of stock) {
    if (!foyCategories[s.category]) foyCategories[s.category] = {}
    if (!foyCategories[s.category][s.model_name]) foyCategories[s.category][s.model_name] = []
    foyCategories[s.category][s.model_name].push(s)
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', fontFamily: 'sans-serif', fontSize: '16px', color: '#666' }}>
      กำลังโหลด...
    </div>
  )

  if (error) return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: '#c00' }}>❌ {error}</div>
  )

  if (done) return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', fontFamily: 'sans-serif', gap: '12px', padding: '20px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>✅</div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#16a34a' }}>บันทึกสต็อคเรียบร้อย</div>
      {snap?.branch_name && <div style={{ fontSize: '14px', color: '#555' }}>สาขา: {snap.branch_name}</div>}
      {snap?.branch_id
        ? <div style={{ fontSize: '13px', color: '#888' }}>อัปเดตสต็อคสาขาแล้ว — ปิดหน้านี้ได้เลย</div>
        : <div style={{ fontSize: '13px', color: '#888' }}>กรุณาตรวจสอบและยืนยันใน LINE ครับ</div>
      }
    </div>
  )

  if (snap?.status === 'confirmed') return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', fontFamily: 'sans-serif', gap: '12px', padding: '20px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>✅</div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#16a34a' }}>บันทึกสต็อคแล้ว</div>
      <div style={{ fontSize: '13px', color: '#888' }}>{snap_no}</div>
    </div>
  )

  if (snap?.status === 'cancelled') return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', fontFamily: 'sans-serif', gap: '12px', padding: '20px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>❌</div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#dc2626' }}>ยกเลิกแล้ว</div>
    </div>
  )

  const totalCat = Object.entries(qty).filter(([k, v]) => k.startsWith('c_') && v > 0).length
  const totalFoy = Object.entries(qty).filter(([k, v]) => k.startsWith('f_') && v > 0).length
  const totalFilled = totalCat + totalFoy

  const inputStyle: React.CSSProperties = {
    width: '72px', textAlign: 'right', padding: '4px 6px',
    border: '1px solid #ccc', borderRadius: '4px', fontSize: '15px',
    backgroundColor: '#fff',
  }
  const warnInputStyle: React.CSSProperties = { ...inputStyle, borderColor: '#f97316', backgroundColor: '#fff7ed' }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '480px', margin: '0 auto', paddingBottom: '100px' }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, backgroundColor: '#1a6b4a', color: '#fff', padding: '10px 16px 0', zIndex: 10 }}>
        <div style={{ fontWeight: 'bold', fontSize: '16px' }}>📦 บันทึกสต็อค</div>
        <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '2px', marginBottom: '8px' }}>
          {snap?.branch_name ?? snap_no} · กรอก {totalFilled} รายการ
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0' }}>
          {([1, 2] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: 'bold',
                backgroundColor: tab === t ? '#fff' : 'rgba(255,255,255,0.15)',
                color: tab === t ? '#1a6b4a' : '#fff',
                borderRadius: t === 1 ? '6px 0 0 0' : '0 6px 0 0',
              }}
            >
              {t === 1 ? `สินค้าทั่วไป${totalCat > 0 ? ` (${totalCat})` : ''}` : `สต็อคฝอย${totalFoy > 0 ? ` (${totalFoy})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1 — Catalog products */}
      {tab === 1 && Object.entries(catalogGroups).map(([group, products]) => (
        <div key={group}>
          <div style={{ backgroundColor: '#9b9484', color: '#fff', padding: '6px 16px', fontSize: '13px', fontWeight: 'bold' }}>
            {group}
          </div>
          {products.map(p => {
            const key  = `c_${p.id}`
            const warn = warnSet.has(String(p.id))
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #f0f0f0', gap: '8px', backgroundColor: warn ? '#fff7ed' : '#fff' }}>
                <div style={{ flex: 1, fontSize: '14px' }}>
                  {warn && <span style={{ color: '#f97316', marginRight: '4px' }}>⚠️</span>}
                  {p.product_name}
                  {p.quantity != null && (
                    <span style={{ marginLeft: '6px', fontSize: '11px', color: '#888' }}>คงเหลือ {p.quantity}</span>
                  )}
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={qty[key] ?? ''}
                  onChange={e => handleChange(key, e.target.value)}
                  placeholder="0"
                  style={warn ? warnInputStyle : inputStyle}
                />
              </div>
            )
          })}
        </div>
      ))}

      {/* Tab 2 — Foy stock */}
      {tab === 2 && Object.entries(foyCategories).map(([cat, models]) => (
        <div key={cat}>
          {Object.entries(models).map(([modelName, items]) => (
            <div key={modelName}>
              <div style={{ backgroundColor: '#0f766e', color: '#fff', padding: '6px 16px', fontSize: '13px', fontWeight: 'bold' }}>
                ฝอย: {cat} · {modelName}
              </div>
              {items.map(s => {
                const key  = `f_${s.id}`
                const warn = warnSet.has(String(s.id))
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #f0f0f0', gap: '8px', backgroundColor: warn ? '#fff7ed' : '#fff' }}>
                    <span style={{ fontFamily: 'monospace', color: '#555', fontSize: '12px', minWidth: '36px' }}>{s.color_code}</span>
                    <div style={{ flex: 1, fontSize: '14px' }}>
                      {warn && <span style={{ color: '#f97316', marginRight: '4px' }}>⚠️</span>}
                      {s.color_name}
                      <span style={{ marginLeft: '6px', fontSize: '11px', color: '#888' }}>คงเหลือ {s.stock_qty}</span>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={qty[key] ?? ''}
                      onChange={e => handleChange(key, e.target.value)}
                      placeholder="0"
                      style={warn ? warnInputStyle : inputStyle}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}

      {/* Submit button */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', backgroundColor: '#fff', borderTop: '1px solid #ddd', maxWidth: '480px', margin: '0 auto' }}>
        <button
          onClick={handleSubmit}
          disabled={saving || totalFilled === 0}
          style={{
            width: '100%', padding: '14px', borderRadius: '8px', border: 'none',
            backgroundColor: totalFilled === 0 ? '#ccc' : '#16a34a',
            color: '#fff', fontSize: '16px', fontWeight: 'bold',
            cursor: totalFilled === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'กำลังบันทึก...' : snap?.branch_id ? `✅ ยืนยัน ${totalFilled} รายการ` : `บันทึก ${totalFilled} รายการ`}
        </button>
      </div>
    </div>
  )
}

export default function StockFormPage() {
  return (
    <Suspense fallback={<div style={{ padding: '20px', fontFamily: 'sans-serif' }}>กำลังโหลด...</div>}>
      <StockFormInner />
    </Suspense>
  )
}
