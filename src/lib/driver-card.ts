import pool from '@/lib/db'
import { pushLine } from '@/lib/line-push'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriverStop {
  id: number
  stop_order: number
  branch_id: number
  branch_name: string
  delivery_type: string
  order_nos: string[]
  status: string
}

export interface DriverTrip {
  id: number
  truck_no: number
  trip_date: string
  round: string
  status: string
  stops: DriverStop[]
}

// ── Flex card builder ─────────────────────────────────────────────────────────

function buildSkipBtn(label: string, data: string): object {
  return {
    type: 'box', layout: 'vertical', flex: 1,
    backgroundColor: '#f59e0b', cornerRadius: '4px', paddingAll: '6px',
    action: { type: 'postback', label, data },
    contents: [{ type: 'text', text: label, color: '#ffffff', size: 'xxs', align: 'center' }],
  }
}

export function buildDriverCardFlex(trip: DriverTrip): object {
  const TRUCK_COLOR = trip.truck_no === 1 ? '#1d4ed8' : '#7c3aed'
  const TRUCK_NAME  = trip.truck_no === 1 ? 'อ๊อบ CF01' : 'ต้น CF02'

  const nextStop       = trip.stops.find(s => s.status === 'pending')
  const deliveredCount = trip.stops.filter(s => s.status === 'delivered').length
  const skippedCount   = trip.stops.filter(s => s.status === 'skipped').length

  const dateLabel = new Date(trip.trip_date + 'T00:00:00')
    .toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })

  const rows: object[] = []

  for (const stop of trip.stops) {
    if (stop.status === 'delivered') {
      rows.push({
        type: 'text',
        text: `✅ ${stop.stop_order}. ${stop.branch_name}`,
        size: 'xs', color: '#9ca3af',
      })
    } else if (stop.status === 'skipped') {
      rows.push({
        type: 'text',
        text: `⏭ ${stop.stop_order}. ${stop.branch_name} (ข้าม)`,
        size: 'xs', color: '#d97706',
      })
    } else if (stop.id === nextStop?.id) {
      rows.push(
        // current stop box
        {
          type: 'box', layout: 'horizontal',
          backgroundColor: '#fff7ed', cornerRadius: '6px',
          paddingAll: '8px', margin: 'xs',
          contents: [
            {
              type: 'text',
              text: `📍 ${stop.stop_order}. ${stop.branch_name}`,
              size: 'sm', weight: 'bold', color: '#c2410c', flex: 1, wrap: true,
            },
            {
              type: 'text',
              text: stop.delivery_type === 'ส่งตรง' ? 'ตรง' : 'พ่วง',
              size: 'xxs', color: '#ea580c', align: 'end', flex: 0,
            },
          ],
        },
        // deliver button
        {
          type: 'box', layout: 'vertical', margin: 'xs',
          backgroundColor: '#16a34a', cornerRadius: '6px', paddingAll: '8px',
          action: { type: 'postback', label: '✓ ส่งสำเร็จ', data: `STOP_DEL:${stop.id}:${trip.id}` },
          contents: [{
            type: 'text', text: '✓ ส่งสำเร็จ',
            color: '#ffffff', align: 'center', size: 'sm', weight: 'bold',
          }],
        },
        // skip buttons
        {
          type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
          contents: [
            buildSkipBtn('รถเต็ม',   `STOP_SKIP:${stop.id}:${trip.id}:full_truck`),
            buildSkipBtn('สาขาปิด',  `STOP_SKIP:${stop.id}:${trip.id}:branch_closed`),
            buildSkipBtn('อื่นๆ',    `STOP_SKIP:${stop.id}:${trip.id}:other`),
          ],
        }
      )
    } else {
      rows.push({
        type: 'text',
        text: `◻ ${stop.stop_order}. ${stop.branch_name}`,
        size: 'xs', color: '#d1d5db',
      })
    }
  }

  if (!nextStop) {
    rows.push({
      type: 'text',
      text: '🎉 ส่งครบทุกสาขาแล้วครับ',
      size: 'sm', weight: 'bold', color: '#16a34a', margin: 'md', align: 'center',
    })
  }

  rows.push({ type: 'separator', margin: 'md' })
  rows.push({
    type: 'text',
    text: `${deliveredCount}/${trip.stops.length} สาขา${skippedCount > 0 ? ` · ข้าม ${skippedCount}` : ''}`,
    size: 'xxs', color: '#9ca3af', align: 'end', margin: 'xs',
  })

  const altStop = nextStop ? `📍 ${nextStop.branch_name}` : '✅ เสร็จสิ้น'

  return {
    type: 'flex',
    altText: `🚛 ${TRUCK_NAME} รอบ${trip.round} — ${altStop}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: TRUCK_COLOR,
        paddingAll: '10px', alignItems: 'center',
        contents: [
          { type: 'text', text: `🚛 ${TRUCK_NAME}`, color: '#ffffff', weight: 'bold', size: 'sm', flex: 1 },
          { type: 'text', text: `รอบ${trip.round} ${dateLabel}`, color: '#ffffff99', size: 'xs', align: 'end', flex: 0 },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'xs',
        contents: rows,
      },
    },
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function fetchTripFull(tripId: number): Promise<DriverTrip | null> {
  const { rows } = await pool.query(`
    SELECT
      t.id, t.truck_no, t.trip_date::text, t.round, t.status,
      COALESCE(
        json_agg(
          json_build_object(
            'id', s.id, 'stop_order', s.stop_order,
            'branch_id', s.branch_id, 'branch_name', s.branch_name,
            'delivery_type', s.delivery_type, 'order_nos', s.order_nos,
            'status', s.status
          ) ORDER BY s.stop_order
        ) FILTER (WHERE s.id IS NOT NULL), '[]'
      ) AS stops
    FROM delivery_trips t
    LEFT JOIN delivery_trip_stops s ON s.trip_id = t.id
    WHERE t.id = $1
    GROUP BY t.id
  `, [tripId])
  return rows[0] ?? null
}

async function getDriverLineId(truckNo: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT value FROM system_settings WHERE key=$1`,
    [`driver_line_id_truck_${truckNo}`]
  )
  return rows[0]?.value ?? null
}

// ── Push functions (fire-and-forget safe) ─────────────────────────────────────

export async function pushDriverCard(tripId: number): Promise<void> {
  try {
    const trip = await fetchTripFull(tripId)
    if (!trip) return
    const lineId = await getDriverLineId(trip.truck_no)
    if (!lineId) return
    await pushLine(lineId, [buildDriverCardFlex(trip)])
  } catch (e) {
    console.error('[pushDriverCard]', e)
  }
}

export async function notifyBranchArrived(branchId: number, truckName: string): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT line_group_id FROM branches WHERE id=$1`, [branchId]
    )
    const groupId: string | null = rows[0]?.line_group_id
    if (!groupId) return
    const timeStr = new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
    })
    await pushLine(groupId, [{
      type: 'text',
      text: `✅ รถ ${truckName} ส่งสินค้าถึงสาขาแล้วครับ 🚛\nเวลา ${timeStr}`,
    }])
  } catch (e) {
    console.error('[notifyBranchArrived]', e)
  }
}
