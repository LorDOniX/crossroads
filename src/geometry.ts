import type { Arm, Turn } from './types';

export const VIEW = 1000;
export const CENTER = VIEW / 2;
export const LANE = 60;
export const HALF_ROAD = LANE;
export const STOP_DIST = HALF_ROAD + 12;
export const CORNER_R = 34;

export interface Vec {
  x: number;
  y: number;
}

export interface PathPoint extends Vec {
  s: number;
  angle: number;
}

export interface VehiclePath {
  points: PathPoint[];
  length: number;
  /** Distance along the path where the vehicle crosses its stop line. */
  sEntry: number;
  /** Distance along the path where the vehicle leaves the junction. */
  sExit: number;
}

export const ALL_ARMS: readonly Arm[] = [0, 1, 2, 3];

/** Unit vector from the centre towards each arm (SVG coordinates, y points down). */
export const ARM_DIR: readonly Vec[] = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
];

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const neg = (a: Vec): Vec => ({ x: -a.x, y: -a.y });
const rightOf = (h: Vec): Vec => ({ x: -h.y, y: h.x });
const distance = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);

export function turnOf(from: Arm, to: Arm): Turn {
  const d = (to - from + 4) % 4;
  return d === 1 ? 'right' : d === 2 ? 'straight' : 'left';
}

/** SVG rotation (degrees) of a sprite drawn heading up so that it faces `h`. */
export function headingAngle(h: Vec): number {
  return (Math.atan2(h.x, -h.y) * 180) / Math.PI;
}

/** Rotation of a driver approaching the junction from `arm`. */
export function approachAngle(arm: Arm): number {
  return headingAngle(neg(ARM_DIR[arm]));
}

/** Point on the arm axis `dist` from the centre, shifted `lateral` towards the inbound lane side. */
export function armPoint(arm: Arm, dist: number, lateral: number): Vec {
  const d = ARM_DIR[arm];
  const r = rightOf(neg(d));
  return { x: CENTER + d.x * dist + r.x * lateral, y: CENTER + d.y * dist + r.y * lateral };
}

const inboundPoint = (arm: Arm, dist: number): Vec => armPoint(arm, dist, LANE / 2);
const outboundPoint = (arm: Arm, dist: number): Vec => armPoint(arm, dist, -LANE / 2);

function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

const CURVE_SAMPLES = 36;

/** Lane-centre path: waiting position -> stop line -> through the junction -> away along the exit arm. */
export function buildPath(from: Arm, to: Arm, startDist: number, endDist: number): VehiclePath {
  const hIn = neg(ARM_DIR[from]);
  const hOut = ARM_DIR[to];
  const p0 = inboundPoint(from, STOP_DIST);
  const p3 = outboundPoint(to, STOP_DIST);
  const chord = distance(p0, p3);
  // 0.39 * chord ≈ cubic handle length approximating a quarter circle
  const k = turnOf(from, to) === 'straight' ? chord / 3 : chord * 0.39;
  const p1 = add(p0, scale(hIn, k));
  const p2 = add(p3, scale(hOut, -k));

  const raw: Vec[] = [inboundPoint(from, startDist), p0];
  for (let i = 1; i <= CURVE_SAMPLES; i++) raw.push(cubic(p0, p1, p2, p3, i / CURVE_SAMPLES));
  raw.push(outboundPoint(to, endDist));

  const points: PathPoint[] = [];
  let s = 0;
  let sEntry = 0;
  let sExit = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += distance(raw[i - 1], raw[i]);
    const a = i < raw.length - 1 ? raw[i] : raw[i - 1];
    const b = i < raw.length - 1 ? raw[i + 1] : raw[i];
    points.push({ ...raw[i], s, angle: headingAngle({ x: b.x - a.x, y: b.y - a.y }) });
    if (i === 1) sEntry = s;
    if (i === CURVE_SAMPLES + 1) sExit = s;
  }
  return { points, length: s, sEntry, sExit };
}

export function pointAt(path: VehiclePath, s: number): { x: number; y: number; angle: number } {
  const pts = path.points;
  if (s <= 0) return pts[0];
  if (s >= path.length) return pts[pts.length - 1];
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const t = (s - a.s) / (b.s - a.s || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: a.angle };
}
