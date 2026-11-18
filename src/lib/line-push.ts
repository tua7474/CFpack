export async function pushLine(to: string, messages: object[]): Promise<void> {
  const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!TOKEN || !to) return
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to, messages }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[pushLine]', res.status, body.slice(0, 200))
    }
  } catch (e) {
    console.error('[pushLine] error:', e)
  }
}
