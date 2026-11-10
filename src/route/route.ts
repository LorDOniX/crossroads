import { decodeMirek } from './mirek';

/** [lon, lat] in degrees – the order used by GeoJSON and MapLibre. */
export type LonLat = [number, number];

export interface Route {
  points: LonLat[];
  /** Distance of each point from the start along the route, in metres. */
  distances: number[];
  length: number;
}

const EARTH_RADIUS = 6_371_000;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distance([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

/** Initial bearing from `a` to `b` in degrees clockwise from north. */
export function bearing([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest difference of two bearings, 0–180°. */
export const angleDiff = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

export const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Position and heading `s` metres from the start, clamped to the route. */
export function pointAt(route: Route, s: number): { point: LonLat; heading: number } {
  const { points, distances } = route;
  const d = Math.min(Math.max(s, 0), route.length);
  let lo = 0;
  let hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] <= d) lo = mid;
    else hi = mid;
  }
  const t = (d - distances[lo]) / (distances[hi] - distances[lo]);
  return { point: lerp(points[lo], points[hi], t), heading: bearing(points[lo], points[hi]) };
}

/** Every pass of the route within `maxOffset` metres of `p`: distance along the route and the offset. */
export function nearPasses(route: Route, p: LonLat, maxOffset: number): { along: number; offset: number }[] {
  const { points, distances } = route;
  // local flat projection in metres around p
  const kx = 111_320 * Math.cos(rad(p[1]));
  const ky = 110_574;
  const passes: { along: number; offset: number }[] = [];
  let current: { along: number; offset: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = (points[i][0] - p[0]) * kx;
    const ay = (points[i][1] - p[1]) * ky;
    const dx = (points[i + 1][0] - points[i][0]) * kx;
    const dy = (points[i + 1][1] - points[i][1]) * ky;
    const len2 = dx * dx + dy * dy;
    const dot = ax * dx + ay * dy;
    // part of the segment inside the circle: |A + tD| <= maxOffset
    const disc = dot * dot - len2 * (ax * ax + ay * ay - maxOffset * maxOffset);
    const tIn = disc < 0 ? Infinity : (-dot - Math.sqrt(disc)) / len2;
    const tOut = disc < 0 ? -Infinity : (-dot + Math.sqrt(disc)) / len2;
    if (tIn > 1 || tOut < 0) {
      current = null;
      continue;
    }
    // the route left the circle since the previous segment
    if (tIn > 0) current = null;
    const t = Math.min(1, Math.max(0, -dot / len2));
    const offset = Math.hypot(ax + dx * t, ay + dy * t);
    const along = distances[i] + t * (distances[i + 1] - distances[i]);
    if (!current) {
      current = { along, offset };
      passes.push(current);
    } else if (offset < current.offset) {
      current.along = along;
      current.offset = offset;
    }
    if (tOut < 1) current = null;
  }
  return passes;
}

/** Route from an array of [lon, lat] points or from a Mirek string. */
export function createRoute(input: string | readonly LonLat[]): Route {
  const source = typeof input === 'string' ? decodeMirek(input) : input;
  const points: LonLat[] = [];
  const distances: number[] = [];
  for (const [lon, lat] of source) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new Error(`Neplatný bod trasy: ${lon}, ${lat}`);
    }
    const prev = points[points.length - 1];
    const step = prev ? distance(prev, [lon, lat]) : 0;
    // a repeated point has no heading
    if (prev && step === 0) continue;
    points.push([lon, lat]);
    distances.push((distances[distances.length - 1] ?? 0) + step);
  }
  if (points.length < 2) throw new Error('Trasa musí mít aspoň dva různé body');
  return { points, distances, length: distances[distances.length - 1] };
}
