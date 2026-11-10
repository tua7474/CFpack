'use client'
import { useEffect, useState, Suspense } from 'react'
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
  branch_name: string | null
  created_at: string
}

function StockPrintInner() {
  const params  = useSearchParams()
  const snap_no = params.get('snap') ?? ''

  const [snap,    setSnap]    = useState<Snapshot | null>(null)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [stock,   setStock]   = useState<StockItem[]>([])
  const [qrUrl,   setQrUrl]   = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!snap_no) { setError('ไม่พบรหัสฟอร์ม'); setLoading(false); return }

    Promise.all([
      fetch(`/api/stock-snapshot?no=${snap_no}`).then(r => r.json()),
      fetch('/api/catalog').then(r => r.json()),
      fetch('/api/stock').then(r => r.json()),
    ]).then(async ([snapData, catData, stockData]) => {
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

      try {
        const QRCode = (await import('qrcode')).default
        const formUrl = `${window.location.origin}/stock-form?snap=${snap_no}`
        const dataUrl = await QRCode.toDataURL(formUrl, { width: 120, margin: 1 })
        setQrUrl(dataUrl)
      } catch { /* QR optional */ }
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [snap_no])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', fontFamily: 'sans-serif', color: '#666' }}>
      กำลังโหลด...
    </div>
  )

  if (error) return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: '#c00' }}>❌ {error}</div>
  )

  // Group catalog by group_name
  const catalogGroups: Record<string, CatalogProduct[]> = {}
  for (const p of catalog) {
    if (!catalogGroups[p.group_name]) catalogGroups[p.group_name] = []
    catalogGroups[p.group_name].push(p)
  }

  // Group foy by category → model_name
  const foyCategories: Record<string, Record<string, StockItem[]>> = {}
  for (const s of stock) {
    if (!foyCategories[s.category]) foyCategories[s.category] = {}
    if (!foyCategories[s.category][s.model_name]) foyCategories[s.category][s.model_name] = []
    foyCategories[s.category][s.model_name].push(s)
  }

  const printDate = snap
    ? new Date(snap.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' })
    : ''

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', borderBottom: '1px solid #ddd',
    padding: '1mm 2mm', fontSize: '8.5pt', gap: '2mm', minHeight: '9mm',
  }
  const boxStyle: React.CSSProperties = {
    width: '24mm', height: '9mm', border: '1.5px solid #333',
    borderRadius: '1mm', flexShrink: 0,
  }
  const catHdr: React.CSSProperties = {
    padding: '1.5mm 2mm', fontSize: '9pt', fontWeight: 'bold',
    backgroundColor: '#9b9484', color: '#fff',
  }
  const foyHdr: React.CSSProperties = {
    padding: '1.5mm 2mm', fontSize: '9pt', fontWeight: 'bold',
    backgroundColor: '#0f766e', color: '#fff',
  }

  const PageHeader = ({ sheet }: { sheet: 1 | 2 }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4mm', borderBottom: '2px solid #1a6b4a', paddingBottom: '3mm' }}>
      <div>
        <div style={{ fontSize: '15pt', fontWeight: 'bold', color: '#1a6b4a' }}>
          แบบฟอร์มนับสต็อค {sheet === 1 ? '(หน้า 1 — สินค้าทั่วไป)' : '(หน้า 2 — กระดาษฝอย)'}
        </div>
        <div style={{ fontSize: '9pt', color: '#555', marginTop: '1mm' }}>
          <span style={{ marginRight: '6mm' }}>สาขา: <strong>{snap?.branch_name ?? '—'}</strong></span>
          <span style={{ marginRight: '6mm' }}>วันที่: <strong>{printDate}</strong></span>
          <span>รหัส: <strong>{snap_no}</strong></span>
        </div>
      </div>
      {qrUrl && (
        <div style={{ textAlign: 'center' }}>
          <img src={qrUrl} alt="QR" style={{ width: '24mm', height: '24mm' }} />
          <div style={{ fontSize: '6pt', color: '#888', marginTop: '0.5mm' }}>สแกนเพื่อบันทึก</div>
        </div>
      )}
    </div>
  )

  const PageFooter = () => (
    <div style={{ marginTop: '5mm', borderTop: '1px solid #ccc', paddingTop: '3mm', display: 'flex', gap: '10mm' }}>
      {['ผู้นับ', 'ผู้ตรวจ'].map(label => (
        <div key={label} style={{ flex: 1, border: '1px solid #ccc', padding: '2mm', borderRadius: '1mm' }}>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8mm' }}>{label}</div>
          <div style={{ borderTop: '1px solid #aaa', paddingTop: '1mm', fontSize: '7pt', color: '#999' }}>
            ลงชื่อ ______________________ วันที่ ____________
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { margin: 0 !important; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        body { margin: 0; }
      `}</style>

      {/* Print button */}
      <div className="no-print" style={{ position: 'fixed', top: '12px', right: '12px', zIndex: 100 }}>
        <button
          onClick={() => window.print()}
          style={{ padding: '10px 20px', backgroundColor: '#1a6b4a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          🖨️ พิมพ์
        </button>
      </div>

      {/* ── Sheet 1 — สินค้าทั่วไป ── */}
      <div style={{ width: '210mm', minHeight: '297mm', padding: '8mm', boxSizing: 'border-box', fontFamily: 'sans-serif', pageBreakAfter: 'always' }}>
        <PageHeader sheet={1} />
        <div style={{ columnCount: 2, columnGap: '5mm' }}>
          {Object.entries(catalogGroups).map(([group, products]) => (
            <div key={group} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: '2mm' }}>
              <div style={catHdr}>{group}</div>
              <div style={{ border: '1px solid #ccc', borderTop: 'none' }}>
                {products.map((p, idx) => (
                  <div key={p.id} style={{ ...rowStyle, backgroundColor: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '8.5pt', color: '#111' }}>{p.product_name}</div>
                      <div style={{ fontSize: '7pt', color: '#888' }}>คงเหลือ: {p.quantity ?? 0}</div>
                    </div>
                    <div style={boxStyle} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <PageFooter />
      </div>

      {/* ── Sheet 2 — กระดาษฝอย ── */}
      <div style={{ width: '210mm', minHeight: '297mm', padding: '8mm', boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
        <PageHeader sheet={2} />
        <div style={{ columnCount: 2, columnGap: '5mm' }}>
          {Object.entries(foyCategories).map(([cat, models]) =>
            Object.entries(models).map(([modelName, items]) => (
              <div key={`${cat}-${modelName}`} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: '2mm' }}>
                <div style={foyHdr}>ฝอย {cat} · {modelName}</div>
                <div style={{ border: '1px solid #0d9488', borderTop: 'none' }}>
                  {items.map((s, idx) => (
                    <div key={s.id} style={{ ...rowStyle, backgroundColor: idx % 2 === 0 ? '#fff' : '#f0fffe' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '7.5pt', color: '#555', minWidth: '10mm', flexShrink: 0 }}>{s.color_code}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '8.5pt', color: '#111' }}>{s.color_name}</div>
                        <div style={{ fontSize: '7pt', color: '#888' }}>คงเหลือ: {s.stock_qty}</div>
                      </div>
                      <div style={boxStyle} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <PageFooter />
      </div>
    </>
  )
}

export default function StockPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: '20px', fontFamily: 'sans-serif' }}>กำลังโหลด...</div>}>
      <StockPrintInner />
    </Suspense>
  )
}
