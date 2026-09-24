import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

// GET /api/qr?data=<url-encoded-payload>&size=512
// Returns a PNG image of the QR code — uses SVG→PNG via sharp (no canvas needed)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const data = searchParams.get('data') ?? ''
  const size = Math.min(1024, Math.max(64, parseInt(searchParams.get('size') ?? '512')))

  if (!data) {
    return NextResponse.json({ error: 'data required' }, { status: 400 })
  }

  try {
    // Generate QR as SVG string (pure JS, no canvas required)
    const svg = await QRCode.toString(data, {
      type: 'svg',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })

    // Convert SVG → PNG using sharp (already installed)
    const { default: sharp } = await import('sharp')
    const png = await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer()

    return new NextResponse(png as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    console.error('[/api/qr] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
