import { NextRequest, NextResponse } from 'next/server'

// POST { image_base64: string, mime_type: string }
// Returns { items: [{product_name, quantity, unit}], raw_text: string }

export async function POST(req: NextRequest) {
  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) return NextResponse.json({ error: 'image_base64 required' }, { status: 400 })

    const mimeType = mime_type || 'image/jpeg'

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image_base64 } },
            {
              type: 'text',
              text: 'นี่คือเอกสารรายการสินค้า กรุณาอ่านและสรุปรายการสินค้าทั้งหมด ตอบเป็น JSON เท่านั้น ไม่ต้องอธิบาย:\n{"items": [{"product_name": "ชื่อสินค้า", "quantity": ตัวเลขจำนวน (หรือ null ถ้าไม่ระบุ), "unit": "หน่วย เช่น ม้วน ชิ้น กล่อง ห่อ (หรือ \\"\\")"}]}\nถ้าอ่านไม่ได้หรือไม่มีรายการสินค้าให้ตอบ: {"items": [], "error": "อ่านไม่ได้"}'
            }
          ]
        }]
      })
    })

    const apiData = await apiRes.json() as {
      type?: string
      error?: { message?: string }
      content?: Array<{ text?: string }>
    }
    if (apiData?.type === 'error' || apiData?.error) {
      const msg = apiData?.error?.message ?? JSON.stringify(apiData)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const rawText = apiData?.content?.[0]?.text ?? ''
    let parsed: { items?: Array<{ product_name: string; quantity: number | null; unit: string }>; error?: string } = { items: [] }
    try {
      const match = rawText.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0])
    } catch { /* ignore */ }

    return NextResponse.json({ items: parsed.items ?? [], raw_text: rawText })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
