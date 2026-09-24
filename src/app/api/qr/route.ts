import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

// GET /api/qr?data=<url-encoded-payload>&size=400
// Returns an SVG image of the QR code (no canvas / librsvg needed)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const data = searchParams.get('data') ?? ''
  const size = Math.min(1024, Math.max(64, parseInt(searchParams.get('size') ?? '400')))

  if (!data) {
    return NextResponse.json({ error: 'data required' }, { status: 400 })
  }

  try {
    const svg = await QRCode.toString(data, {
      type: 'svg',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    console.error('[/api/qr] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
