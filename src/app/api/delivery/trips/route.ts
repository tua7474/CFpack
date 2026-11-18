import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { pushDriverCard, notifyBranchArrived } from '@/lib/driver-card'
import { bestInsertionRoute, calcRouteKm, type Coord, type Depot } from '@/lib/route-optimizer'

// ── Ensure tables ─────────────────────────────────────────────────────────────

async function ensureTables() {
  // delivery_trips — บันทึกแต่ละรอบวิ่ง
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_trips (
      id                      SERIAL PRIMARY KEY,
      truck_no                SMALLINT    NOT NULL CHECK (truck_no IN (1, 2)),
      trip_date               DATE        NOT NULL,
      round                   VARCHAR(10) NOT NULL CHECK (round IN ('เช้า', 'บ่าย')),
      status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','in_progress','completed','cancelled')),
      departed_at             TIMESTAMPTZ,
      completed_at            TIMESTAMPTZ,
      total_distance_km       DECIMAL(6,2),
      total_distance_calc     DECIMAL(6,2),
      rescheduled_stop_count  SMALLINT    NOT NULL DEFAULT 0,
      driver_note             TEXT,
      created_by              VARCHAR(100),
      created_at              TIMESTAMP   NOT NULL DEFAULT NOW()
    )
  `)

  // delivery_trip_stops — บันทึกแต่ละจุดแวะในรอบ
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_trip_stops (
      id               SERIAL PRIMARY KEY,
      trip_id          INT          NOT NULL REFERENCES delivery_trips(id) ON DELETE CASCADE,
      stop_order       SMALLINT     NOT NULL DEFAULT 1,
      branch_id        INT          NOT NULL REFERENCES branches(id),
      branch_name      VARCHAR(200) NOT NULL,
      delivery_type    VARCHAR(20)  NOT NULL DEFAULT 'รอพ่วง'
                         CHECK (delivery_type IN ('ส่งตรง', 'รอพ่วง')),
      order_nos        TEXT[]       NOT NULL DEFAULT '{}',
      arrived_at       TIMESTAMPTZ,
      departed_at      TIMESTAMPTZ,
      stop_distance_km DECIMAL(5,2),
      status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','delivered','skipped','failed')),
      moved_to_trip_id INT          REFERENCES delivery_trips(id),
      moved_at         TIMESTAMPTZ,
      moved_by         VARCHAR(100),
      skip_reason_code VARCHAR(30)
                         CHECK (skip_reason_code IN ('full_truck','branch_closed','road_blocked','other')),
      skip_reason_note TEXT,
      created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `)

  // booking_orders — เพิ่ม trip_id FK
  await pool.query(`
    ALTER TABLE booking_orders ADD COLUMN IF NOT EXISTS trip_id INT REFERENCES delivery_trips(id)
  `)
}

// ── GET ───────────────────────────────────────────────────────────────────────
// ?date=YYYY-MM-DD[&truck_no=1]   → trips ของวันนั้น + stops
// ?from=YYYY-MM-DD&to=YYYY-MM-DD  → ช่วงวัน สำหรับตารางประวัติ

export async function GET(req: NextRequest) {
  try {
    await ensureTables()
    const { searchParams } = req.nextUrl
    const date     = searchParams.get('date')
    const from     = searchParams.get('from')
    const to       = searchParams.get('to')
    const truckNo  = searchParams.get('truck_no')

    // ── history range ──────────────────────────────────────────────────────
    if (from && to) {
      const { rows: trips } = await pool.query(`
        SELECT
          t.id, t.truck_no, t.trip_date::text, t.round, t.status,
          t.departed_at, t.completed_at,
          t.total_distance_km, t.total_distance_calc,
          t.rescheduled_stop_count, t.driver_note, t.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id',              s.id,
                'stop_order',      s.stop_order,
                'branch_id',       s.branch_id,
                'branch_name',     s.branch_name,
                'delivery_type',   s.delivery_type,
                'order_nos',       s.order_nos,
                'arrived_at',      s.arrived_at,
                'departed_at',     s.departed_at,
                'stop_distance_km',s.stop_distance_km,
                'status',          s.status,
                'moved_to_trip_id',s.moved_to_trip_id,
                'skip_reason_code',s.skip_reason_code,
                'skip_reason_note',s.skip_reason_note
              ) ORDER BY s.stop_order
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'
          ) AS stops
        FROM delivery_trips t
        LEFT JOIN delivery_trip_stops s ON s.trip_id = t.id
        WHERE t.trip_date BETWEEN $1 AND $2
          AND ($3::smallint IS NULL OR t.truck_no = $3)
          AND t.status != 'cancelled'
        GROUP BY t.id
        ORDER BY t.trip_date DESC, t.truck_no, t.round
      `, [from, to, truckNo ? parseInt(truckNo) : null])
      return NextResponse.json(trips)
    }

    // ── pivot mode: สรุปรายสัปดาห์ per branch ────────────────────────────
    if (searchParams.get('pivot') === '1' && from && to) {
      const { rows: pivotRows } = await pool.query(`
        SELECT
          date_trunc('week', t.trip_date)::date  AS week_start,
          t.truck_no,
          s.branch_id,
          b.name                                 AS branch_name,
          b.color_group,
          COUNT(unnested) FILTER (
            WHERE unnested IS NOT NULL AND unnested != ''
          )::int                                 AS order_count,
          COALESCE(
            SUM(bo.total_amount::decimal) FILTER (
              WHERE unnested IS NOT NULL AND unnested != ''
            ), 0
          )                                      AS total_amount
        FROM delivery_trips t
        JOIN delivery_trip_stops s ON s.trip_id = t.id
        JOIN branches b             ON b.id = s.branch_id
        LEFT JOIN LATERAL unnest(s.order_nos) AS unnested ON true
        LEFT JOIN booking_orders bo ON bo.order_no = unnested
        WHERE t.trip_date BETWEEN $1 AND $2
          AND t.status != 'cancelled'
          AND s.status  = 'delivered'
        GROUP BY
          date_trunc('week', t.trip_date)::date,
          t.truck_no, s.branch_id, b.name, b.color_group
        ORDER BY week_start DESC, t.truck_no, b.name
      `, [from, to])
      return NextResponse.json(pivotRows)
    }

    // ── single date ────────────────────────────────────────────────────────
    if (date) {
      const { rows: trips } = await pool.query(`
        SELECT
          t.id, t.truck_no, t.trip_date::text, t.round, t.status,
          t.departed_at, t.completed_at,
          t.total_distance_km, t.total_distance_calc,
          t.rescheduled_stop_count, t.driver_note, t.created_at,
          COALESCE(
            json_agg(
              json_build_object(
                'id',              s.id,
                'stop_order',      s.stop_order,
                'branch_id',       s.branch_id,
                'branch_name',     s.branch_name,
                'delivery_type',   s.delivery_type,
                'order_nos',       s.order_nos,
                'arrived_at',      s.arrived_at,
                'departed_at',     s.departed_at,
                'stop_distance_km',s.stop_distance_km,
                'status',          s.status,
                'moved_to_trip_id',s.moved_to_trip_id,
                'skip_reason_code',s.skip_reason_code,
                'skip_reason_note',s.skip_reason_note
              ) ORDER BY s.stop_order
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'
          ) AS stops
        FROM delivery_trips t
        LEFT JOIN delivery_trip_stops s ON s.trip_id = t.id
        WHERE t.trip_date = $1
          AND ($2::smallint IS NULL OR t.truck_no = $2)
        GROUP BY t.id
        ORDER BY t.truck_no, t.round
      `, [date, truckNo ? parseInt(truckNo) : null])
      return NextResponse.json(trips)
    }

    return NextResponse.json({ error: 'date or from/to required' }, { status: 400 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── POST — สร้าง trip ใหม่ ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await ensureTables()
    const { truck_no, trip_date, round, created_by } = await req.json()
    if (!truck_no || !trip_date || !round)
      return NextResponse.json({ error: 'truck_no, trip_date, round required' }, { status: 400 })

    const { rows } = await pool.query(`
      INSERT INTO delivery_trips (truck_no, trip_date, round, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id, truck_no, trip_date::text, round, status, created_at
    `, [truck_no, trip_date, round, created_by ?? null])
    return NextResponse.json(rows[0], { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── PATCH — อัปเดต trip / stop ───────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables()
    const body = await req.json()

    // ── อัปเดต trip header ─────────────────────────────────────────────────
    if (body.action === 'update_trip') {
      const { id, status, departed_at, completed_at, total_distance_km, driver_note } = body
      await pool.query(`
        UPDATE delivery_trips SET
          status               = COALESCE($2, status),
          departed_at          = COALESCE($3::timestamptz, departed_at),
          completed_at         = COALESCE($4::timestamptz, completed_at),
          total_distance_km    = COALESCE($5, total_distance_km),
          driver_note          = COALESCE($6, driver_note)
        WHERE id = $1
      `, [id, status ?? null, departed_at ?? null, completed_at ?? null,
          total_distance_km ?? null, driver_note ?? null])
      // เมื่อรอบเริ่มวิ่ง → ส่งการ์ดคนขับ
      if (status === 'in_progress') {
        pushDriverCard(id).catch(e => console.error('[trip in_progress push]', e))
      }
      return NextResponse.json({ ok: true })
    }

    // ── เพิ่ม stop ─────────────────────────────────────────────────────────
    if (body.action === 'add_stop') {
      const { trip_id, branch_id, delivery_type, stop_order, order_nos } = body
      // ดึงชื่อสาขา snapshot
      const { rows: br } = await pool.query(`SELECT name FROM branches WHERE id=$1`, [branch_id])
      if (!br.length) return NextResponse.json({ error: 'branch not found' }, { status: 404 })
      // คำนวณ stop_order ถ้าไม่ส่งมา
      let order = stop_order
      if (!order) {
        const { rows: maxRow } = await pool.query(
          `SELECT COALESCE(MAX(stop_order),0)+1 AS next FROM delivery_trip_stops WHERE trip_id=$1`, [trip_id]
        )
        order = maxRow[0].next
      }
      const { rows } = await pool.query(`
        INSERT INTO delivery_trip_stops (trip_id, stop_order, branch_id, branch_name, delivery_type, order_nos)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [trip_id, order, branch_id, br[0].name, delivery_type ?? 'รอพ่วง', order_nos ?? []])
      return NextResponse.json(rows[0], { status: 201 })
    }

    // ── อัปเดต stop ────────────────────────────────────────────────────────
    if (body.action === 'update_stop') {
      const {
        id, status, arrived_at, departed_at, stop_distance_km,
        skip_reason_code, skip_reason_note, moved_to_trip_id, moved_by, order_nos,
      } = body
      await pool.query(`
        UPDATE delivery_trip_stops SET
          status           = COALESCE($2,  status),
          arrived_at       = COALESCE($3::timestamptz, arrived_at),
          departed_at      = COALESCE($4::timestamptz, departed_at),
          stop_distance_km = COALESCE($5,  stop_distance_km),
          skip_reason_code = COALESCE($6,  skip_reason_code),
          skip_reason_note = COALESCE($7,  skip_reason_note),
          moved_to_trip_id = COALESCE($8,  moved_to_trip_id),
          moved_at         = CASE WHEN $8 IS NOT NULL THEN NOW() ELSE moved_at END,
          moved_by         = COALESCE($9,  moved_by),
          order_nos        = COALESCE($10, order_nos)
        WHERE id = $1
      `, [id, status ?? null, arrived_at ?? null, departed_at ?? null,
          stop_distance_km ?? null, skip_reason_code ?? null, skip_reason_note ?? null,
          moved_to_trip_id ?? null, moved_by ?? null,
          order_nos ? order_nos : null])
      // ถ้าย้าย → เพิ่ม rescheduled_stop_count ของ trip ต้นทาง
      if (moved_to_trip_id) {
        const { rows: stopRow } = await pool.query(`SELECT trip_id FROM delivery_trip_stops WHERE id=$1`, [id])
        if (stopRow.length) {
          await pool.query(
            `UPDATE delivery_trips SET rescheduled_stop_count = rescheduled_stop_count + 1 WHERE id=$1`,
            [stopRow[0].trip_id]
          )
        }
      }
      // notifications: ส่งสำเร็จ → แจ้งสาขา + อัปเดตการ์ดคนขับ
      if (status === 'delivered' || status === 'skipped') {
        pool.query(`
          SELECT s.branch_id, s.trip_id, t.truck_no
          FROM delivery_trip_stops s
          JOIN delivery_trips t ON t.id = s.trip_id
          WHERE s.id = $1
        `, [id]).then(async ({ rows: [info] }) => {
          if (!info) return
          if (status === 'delivered') {
            const tn = info.truck_no === 1 ? 'CF01 (อ๊อบ)' : 'CF02 (ต้น)'
            await notifyBranchArrived(info.branch_id, tn)
          }
          await pushDriverCard(info.trip_id)
        }).catch(e => console.error('[stop notify]', e))
      }
      return NextResponse.json({ ok: true })
    }

    // ── ลบ stop (admin) ────────────────────────────────────────────────────
    if (body.action === 'remove_stop') {
      await pool.query(`DELETE FROM delivery_trip_stops WHERE id=$1`, [body.id])
      return NextResponse.json({ ok: true })
    }

    // ── เรียงลำดับ stops ───────────────────────────────────────────────────
    if (body.action === 'reorder_stops') {
      const { stop_ids } = body as { stop_ids: number[] }
      for (let i = 0; i < stop_ids.length; i++) {
        await pool.query(
          `UPDATE delivery_trip_stops SET stop_order=$1 WHERE id=$2`,
          [i + 1, stop_ids[i]]
        )
      }
      return NextResponse.json({ ok: true })
    }

    // ── เติม stops จาก delivery_schedule + เรียงเส้นทาง ─────────────────
    if (body.action === 'populate_from_schedule') {
      const { trip_id } = body
      // ดึงข้อมูล trip
      const { rows: [trip] } = await pool.query(
        `SELECT truck_no, trip_date, round FROM delivery_trips WHERE id=$1`, [trip_id]
      )
      if (!trip) return NextResponse.json({ error: 'trip not found' }, { status: 404 })

      // หา week_start (วันจันทร์) ของ trip_date
      const dt = new Date(trip.trip_date + 'T00:00:00')
      const dow = dt.getDay() // 0=Sun
      const dbDow = dow === 0 ? 7 : dow
      const diffToMon = dow === 0 ? -6 : 1 - dow
      const mon = new Date(dt)
      mon.setDate(dt.getDate() + diffToMon)
      const weekStart = mon.toISOString().slice(0, 10)

      // ดึง warehouse lat/lng จาก system_settings
      const { rows: wRows } = await pool.query(
        `SELECT key, value FROM system_settings WHERE key IN ('warehouse_lat','warehouse_lng')`
      )
      const wMap = Object.fromEntries(wRows.map(r => [r.key, r.value]))
      const depot: Depot | null = (wMap.warehouse_lat && wMap.warehouse_lng)
        ? { lat: parseFloat(wMap.warehouse_lat), lng: parseFloat(wMap.warehouse_lng) }
        : null

      // ดึง branches จาก delivery_schedule
      const { rows: sched } = await pool.query(`
        SELECT ds.branch_id, b.name, b.lat::float, b.lng::float
        FROM delivery_schedule ds
        JOIN branches b ON b.id = ds.branch_id
        WHERE ds.week_start=$1 AND ds.day_of_week=$2 AND ds.truck_no=$3 AND ds.round=$4
        ORDER BY ds.sort_order, ds.id
      `, [weekStart, dbDow, trip.truck_no, trip.round])

      if (!sched.length) return NextResponse.json({ ok: true, inserted: 0 })

      // เรียงเส้นทางถ้ามี depot coordinates
      const withCoords  = sched.filter(r => r.lat != null && r.lng != null)
      const noCoords    = sched.filter(r => r.lat == null || r.lng == null)

      let ordered: typeof sched
      if (depot && withCoords.length) {
        const coords: Coord[] = withCoords.map(r => ({
          id: r.branch_id, name: r.name, lat: r.lat, lng: r.lng, deliveryType: 'รอพ่วง',
        }))
        const route = bestInsertionRoute(depot, coords)
        ordered = [...route.map(c => withCoords.find(r => r.branch_id === c.id)!), ...noCoords]
      } else {
        ordered = sched
      }

      // insert stops (ข้ามถ้ามีอยู่แล้ว)
      let inserted = 0
      for (let i = 0; i < ordered.length; i++) {
        const r = ordered[i]
        const { rowCount } = await pool.query(`
          INSERT INTO delivery_trip_stops (trip_id, stop_order, branch_id, branch_name, delivery_type, order_nos)
          SELECT $1,$2,$3,$4,'รอพ่วง','{}'
          WHERE NOT EXISTS (SELECT 1 FROM delivery_trip_stops WHERE trip_id=$1 AND branch_id=$3)
        `, [trip_id, i + 1, r.branch_id, r.name])
        inserted += rowCount ?? 0
      }

      // คำนวณ total_distance_calc
      if (depot && withCoords.length) {
        const coords: Coord[] = withCoords.map(r => ({
          id: r.branch_id, name: r.name, lat: r.lat, lng: r.lng, deliveryType: 'รอพ่วง',
        }))
        const route = bestInsertionRoute(depot, coords)
        const km = calcRouteKm(depot, route)
        await pool.query(
          `UPDATE delivery_trips SET total_distance_calc=$1 WHERE id=$2`,
          [parseFloat(km.toFixed(1)), trip_id]
        )
      }

      return NextResponse.json({ ok: true, inserted })
    }

    // ── เรียงเส้นทาง stops ที่มีอยู่ใหม่ ──────────────────────────────────
    if (body.action === 'optimize_route') {
      const { trip_id } = body

      // ดึง warehouse lat/lng
      const { rows: wRows } = await pool.query(
        `SELECT key, value FROM system_settings WHERE key IN ('warehouse_lat','warehouse_lng')`
      )
      const wMap = Object.fromEntries(wRows.map(r => [r.key, r.value]))
      if (!wMap.warehouse_lat || !wMap.warehouse_lng)
        return NextResponse.json({ error: 'warehouse coords not set' }, { status: 400 })
      const depot: Depot = { lat: parseFloat(wMap.warehouse_lat), lng: parseFloat(wMap.warehouse_lng) }

      // ดึง pending stops ที่มี lat/lng
      const { rows: stops } = await pool.query(`
        SELECT s.id, s.branch_id, b.lat::float, b.lng::float, s.branch_name
        FROM delivery_trip_stops s
        JOIN branches b ON b.id = s.branch_id
        WHERE s.trip_id=$1 AND s.status='pending'
          AND b.lat IS NOT NULL AND b.lng IS NOT NULL
        ORDER BY s.stop_order
      `, [trip_id])

      if (stops.length < 2) return NextResponse.json({ ok: true, reordered: 0 })

      const coords: Coord[] = stops.map(r => ({
        id: r.id, name: r.branch_name, lat: r.lat, lng: r.lng, deliveryType: 'รอพ่วง',
      }))
      const route = bestInsertionRoute(depot, coords)

      // อัปเดต stop_order
      for (let i = 0; i < route.length; i++) {
        await pool.query(
          `UPDATE delivery_trip_stops SET stop_order=$1 WHERE id=$2`,
          [i + 1, route[i].id]
        )
      }

      // อัปเดต total_distance_calc
      const km = calcRouteKm(depot, route)
      await pool.query(
        `UPDATE delivery_trips SET total_distance_calc=$1 WHERE id=$2`,
        [parseFloat(km.toFixed(1)), trip_id]
      )

      return NextResponse.json({ ok: true, reordered: route.length })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── DELETE — ยกเลิก/ลบ trip (admin เท่านั้น) ─────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables()
    const { id, hard_delete } = await req.json()
    if (hard_delete) {
      // ลบถาวร (stops ถูกลบตาม cascade)
      await pool.query(`DELETE FROM delivery_trips WHERE id=$1`, [id])
    } else {
      // soft cancel
      await pool.query(`UPDATE delivery_trips SET status='cancelled' WHERE id=$1`, [id])
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
