import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

// GET /api/qr?data=<url-encoded-payload>&size=512
// Returns a PNG image of the QR code for the given data
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const data = searchParams.get('data') ?? ''
  const size = Math.min(1024, Math.max(64, parseInt(searchParams.get('size') ?? '512')))

  if (!data) {
    return NextResponse.json({ error: 'data required' }, { status: 400 })
  }

  try {
    // Generate QR as PNG buffer
    const pngBuffer = await QRCode.toBuffer(data, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })

    return new NextResponse(pngBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    console.error('QR generation error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
