// ── Shared route-optimization utilities ───────────────────────────────────────

export type Depot = { lat: number; lng: number }
export type Coord = { id: number; name: string; lat: number; lng: number; deliveryType: string }

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function bestInsertionRoute(depot: Depot, stops: Coord[]): Coord[] {
  if (!stops.length) return []
  const dist = (a: Depot | Coord, b: Depot | Coord) =>
    haversineKm(a.lat, a.lng, b.lat, b.lng)

  const nearest = stops.reduce((best, s) => dist(depot, s) < dist(depot, best) ? s : best, stops[0])
  const route: Coord[] = [nearest]
  const remaining = stops.filter(s => s.id !== nearest.id)

  while (remaining.length) {
    let bestExtra = Infinity, bestPos = 0, bestIdx = 0
    for (let ri = 0; ri < remaining.length; ri++) {
      const cand = remaining[ri]
      for (let pos = 0; pos <= route.length; pos++) {
        const prev: Depot | Coord = pos === 0 ? depot : route[pos - 1]
        const next: Depot | Coord = pos === route.length ? depot : route[pos]
        const extra = dist(prev, cand) + dist(cand, next) - dist(prev, next)
        if (extra < bestExtra) { bestExtra = extra; bestPos = pos; bestIdx = ri }
      }
    }
    route.splice(bestPos, 0, remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }
  return route
}

export function calcRouteKm(depot: Depot, route: Coord[]): number {
  if (!route.length) return 0
  let total = haversineKm(depot.lat, depot.lng, route[0].lat, route[0].lng)
  for (let i = 1; i < route.length; i++)
    total += haversineKm(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng)
  total += haversineKm(route[route.length - 1].lat, route[route.length - 1].lng, depot.lat, depot.lng)
  return total
}
