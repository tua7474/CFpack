import { NextResponse } from 'next/server'

// ── PromptPay EMV QR ──────────────────────────────────────────────────────────

function crc16(str: string): number {
  let crc = 0xFFFF
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
    }
  }
  return crc & 0xFFFF
}

function f(tag: string, value: string) {
  return `${tag}${value.length.toString().padStart(2, '0')}${value}`
}

function promptPayPayload(promptPayId: string, amount: number): string {
  // Phone number (10 digit) → convert to international format 0066xxxxxxxxx
  const acct = /^\d{10}$/.test(promptPayId) ? '0066' + promptPayId.slice(1) : promptPayId
  const merchantAcc = f('00', 'A000000677010111') + f('01', acct)
  const name = (process.env.PROMPTPAY_NAME ?? 'CF PACKAGING').slice(0, 25)
  const raw = [
    f('00', '01'),
    f('01', '12'),
    f('29', merchantAcc),
    f('52', '0000'),
    f('53', '764'),
    f('54', amount.toFixed(2)),
    f('58', 'TH'),
    f('59', name),
    f('60', 'BANGKOK'),
    '6304',
  ].join('')
  return raw + crc16(raw).toString(16).toUpperCase().padStart(4, '0')
}

// GET /api/promptpay?amount=1234.56
// Returns JSON: { qrUrl, payload, name, id }
export async function GET(req: Request) {
  const reqUrl      = new URL(req.url)
  const { searchParams } = reqUrl
  const amount      = parseFloat(searchParams.get('amount') ?? '0')
  const promptPayId = process.env.PROMPTPAY_ID ?? ''

  if (!promptPayId) {
    console.error('[/api/promptpay] PROMPTPAY_ID not set in environment')
    return NextResponse.json({ error: 'PROMPTPAY_ID not configured' }, { status: 400 })
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  const payload = promptPayPayload(promptPayId, amount)
  // Use self-hosted QR endpoint (same origin) instead of external api.qrserver.com
  const qrUrl   = `${reqUrl.origin}/api/qr?size=400&data=${encodeURIComponent(payload)}`
  const name    = process.env.PROMPTPAY_NAME ?? 'CF PACKAGING'

  console.log('[/api/promptpay] amount:', amount, '| PROMPTPAY_ID length:', promptPayId.length, '| qrUrl:', qrUrl.slice(0, 80))
  return NextResponse.json({ qrUrl, payload, name, id: promptPayId })
}
