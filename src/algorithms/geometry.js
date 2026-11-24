/**
 * Pure geometry helpers shared by the vessel radar (Module 2) and the sensitive-area map (Module 3).
 * Bearings are compass degrees: 0 = north (up), 90 = east (right), measured clockwise.
 */

const toRad = (deg) => (deg * Math.PI) / 180;
const normalise = (deg) => ((deg % 360) + 360) % 360;

/**
 * Compass bearing from the hydrophone to a vessel.
 * Uses an explicit `bearingDeg` when the AIS record has one; otherwise derives it from the
 * legacy `xRel`/`yRel` plot position (hydrophone at 0.5, 0.5). Returns null when neither exists.
 */
export function vesselBearingDeg(vessel) {
  if (Number.isFinite(vessel?.bearingDeg)) return normalise(vessel.bearingDeg);
  if (Number.isFinite(vessel?.xRel) && Number.isFinite(vessel?.yRel)) {
    const dx = vessel.xRel - 0.5;
    const dy = vessel.yRel - 0.5;
    if (dx === 0 && dy === 0) return 0;
    return Math.round(normalise((Math.atan2(dx, -dy) * 180) / Math.PI));
  }
  return null;
}

/** Converts bearing + distance into SVG coordinates around a centre point. */
export function polarToXY(bearingDeg, distance, pxPerUnit, cx, cy) {
  const rad = toRad(bearingDeg);
  return {
    x: cx + Math.sin(rad) * distance * pxPerUnit,
    y: cy - Math.cos(rad) * distance * pxPerUnit,
  };
}

/** Evenly spaced range rings (in km) for a radar of the given radius. */
export function radarRingsKm(radiusKm, count = 3) {
  return Array.from({ length: count }, (_, i) => Number(((radiusKm * (i + 1)) / count).toFixed(2)));
}

/** Human-readable range label: 0.83 -> "0.8 km", 5 -> "5.0 km". */
export const formatKm = (km) => `${Number(km).toFixed(1)} km`;

// Planning heuristic, not a propagation model: ~0.15 km of audible footprint per dB above ambient,
// bounded to 1–8 km so the overlay stays readable. Labelled "estimated" wherever it is shown.
export const FOOTPRINT_KM_PER_DB = 0.15;
export const FOOTPRINT_MIN_KM = 1;
export const FOOTPRINT_MAX_KM = 8;

/** Estimated acoustic footprint radius (km) for an event, or null when the event has no excess level. */
export function estimateAcousticFootprintKm(event) {
  const delta = Number(event?.deltaAboveAmbient);
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const km = Math.min(FOOTPRINT_MAX_KM, Math.max(FOOTPRINT_MIN_KM, delta * FOOTPRINT_KM_PER_DB));
  return Number(km.toFixed(1));
}

/** Great-circle distance between two { lat, lon } points, in km (haversine). */
export function haversineKm(a, b) {
  const R = 6371.0088;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Parses an SVG `points` string ("x,y x,y ...") into [[x, y], ...]. */
export function parsePolygonPoints(points) {
  return String(points || "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
}

/** Ray-casting point-in-polygon test. `polygon` is an SVG points string or an array of [x, y]. */
export function pointInPolygon(x, y, polygon) {
  const pts = Array.isArray(polygon) ? polygon : parsePolygonPoints(polygon);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Formats signed decimal coordinates with hemispheres: { lat: 13.08, lon: 80.3 } -> "13.0800° N, 80.3000° E". */
export function formatLatLon(coords) {
  if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lon)) return null;
  const lat = `${Math.abs(coords.lat).toFixed(4)}° ${coords.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(coords.lon).toFixed(4)}° ${coords.lon >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

// ---------------------------------------------------------------------------------------------
// Phase 3: geographic [lon, lat] polygons (WDPA-style protected areas)
// ---------------------------------------------------------------------------------------------

const KM_PER_DEG = 111.195; // mean Earth radius 6371.0088 km * pi / 180
const BOUNDARY_EPS = 1e-9; // degrees; tolerance for "exactly on the edge" in decimal-degree space

const isLonLat = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** True when `p` lies on the segment a-b (within BOUNDARY_EPS). All points are [x, y]. */
export function isPointOnSegment(p, a, b, eps = BOUNDARY_EPS) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > eps) return false;
  return (
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
}

/**
 * Ray-casting Point-in-Polygon for geographic coordinates.
 *  - `point` is [lon, lat]; `ring` is an array of [lon, lat] (closed or open; a repeated first vertex is fine).
 *  - Points exactly on an edge or vertex count as INSIDE (conservative for intrusion checks).
 *  - Planar test in degree space: valid for polygons that do not cross the antimeridian or enclose a pole.
 * Returns false for invalid input (non-finite point, fewer than 3 vertices).
 */
export function isPointInPolygon(point, ring) {
  if (!isLonLat(point) || !Array.isArray(ring)) return false;
  const pts = ring.filter(isLonLat);
  if (pts.length < 3) return false;
  const [x, y] = point;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (isPointOnSegment([x, y], pts[j], pts[i])) return true;
  }

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Local equirectangular projection of [lon, lat] to km east/north of `origin` ({ lat, lon }). */
export function lonLatToLocalKm(point, origin) {
  const cosLat = Math.cos(toRad(origin.lat));
  return [(point[0] - origin.lon) * cosLat * KM_PER_DEG, (point[1] - origin.lat) * KM_PER_DEG];
}

/** Projects [lon, lat] to SVG coordinates around (cx, cy) with north up. */
export function lonLatToXY(point, origin, pxPerKm, cx, cy) {
  const [eastKm, northKm] = lonLatToLocalKm(point, origin);
  return { x: cx + eastKm * pxPerKm, y: cy - northKm * pxPerKm };
}

/** SVG `points` string for a [lon, lat] ring (drops the closing duplicate vertex). */
export function ringToSvgPoints(ring, origin, pxPerKm, cx, cy) {
  const pts = (ring || []).filter(isLonLat);
  const open =
    pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
  return open
    .map((p) => {
      const { x, y } = lonLatToXY(p, origin, pxPerKm, cx, cy);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function distancePointToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Distance in km from `point` ({ lat, lon }) to a [lon, lat] polygon: 0 when inside or on the boundary,
 * otherwise the shortest distance to an edge. Used to test an acoustic footprint (a circle of radius r)
 * against a protected area: the footprint overlaps the polygon when this distance is <= r.
 * Returns null for invalid input.
 */
export function distanceToPolygonKm(point, ring) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon) || !Array.isArray(ring)) return null;
  const pts = ring.filter(isLonLat);
  if (pts.length < 3) return null;
  if (isPointInPolygon([point.lon, point.lat], pts)) return 0;
  const local = pts.map((p) => lonLatToLocalKm(p, point));
  let best = Infinity;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    best = Math.min(best, distancePointToSegment([0, 0], local[j], local[i]));
  }
  return best;
}

/** Planar-projected polygon area in km² (shoelace on a local equirectangular projection). */
export function polygonAreaKm2(ring) {
  const pts = (ring || []).filter(isLonLat);
  if (pts.length < 3) return null;
  const origin = { lat: pts.reduce((s, p) => s + p[1], 0) / pts.length, lon: pts[0][0] };
  const local = pts.map((p) => lonLatToLocalKm(p, origin));
  let sum = 0;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    sum += local[j][0] * local[i][1] - local[i][0] * local[j][1];
  }
  return Math.abs(sum) / 2;
}
