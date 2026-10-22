import type { Arm, Intersection, Turn, Vehicle, VehicleKind } from './types';

export const VIEW = 1000;
export const CENTER = VIEW / 2;
export const LANE = 60;
export const CORNER_R = 34;
export const CROSSWALK_W = 34;
export const RING_IN = 88;
export const RING_OUT = 150;
export const RING_MID = (RING_IN + RING_OUT) / 2;
/** Every path starts this far behind the waiting position (room for tram segments and moving up in a column). */
export const PRE_PATH = 260;

export const VEHICLE_SIZE: Record<VehicleKind, { length: number; width: number }> = {
  car: { length: 88, width: 42 },
  truck: { length: 136, width: 50 },
  tram: { length: 210, width: 50 },
  ambulance: { length: 100, width: 46 },
  pedestrian: { length: 22, width: 24 },
};

/** Centres of the three tram sections relative to the tram centre, measured along the path. */
export const TRAM_SECTIONS: readonly number[] = [70, 0, -70];
export const TRAM_SECTION_LENGTH = 68;

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
  /** Distance along the path of the waiting position. */
  sWait: number;
  /** Distance along the path where the vehicle enters the junction. */
  sEntry: number;
  /** Distance along the path where the vehicle leaves the junction. */
  sExit: number;
}

export interface Layout {
  roundabout: boolean;
  /** Half width of the road on each arm (wider where tram tracks run). */
  roadHalf: number[];
  /** Distance from the centre to the junction mouth on each arm. */
  mouth: number[];
  /** Distance from the centre to the stop line on each arm. */
  stop: number[];
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

export function layoutOf(inter: Intersection): Layout {
  const wideAxis = [false, false];
  if (inter.tramLine) for (const a of inter.tramLine) wideAxis[a % 2] = true;
  const roadHalf = ALL_ARMS.map((a) => (wideAxis[a % 2] ? 2 * LANE : LANE));
  const mouth = ALL_ARMS.map((a) => (inter.roundabout ? RING_OUT : roadHalf[(a + 1) % 4]));
  const stop = ALL_ARMS.map((a) => mouth[a] + 12 + (inter.crosswalks.includes(a) ? CROSSWALK_W + 12 : 0));
  return { roundabout: inter.roundabout !== null, roadHalf, mouth, stop };
}

/** Lateral offset of the lane centre: trams use the inner lane with the tracks, everything else the outer one. */
export const laneLateral = (layout: Layout, arm: Arm, tram: boolean): number =>
  tram ? LANE / 2 : layout.roadHalf[arm] - LANE / 2;

/** Crossing band on `arm`: distances from the centre. */
export const crosswalkBand = (layout: Layout, arm: Arm): [number, number] => [
  layout.mouth[arm] + 6,
  layout.mouth[arm] + 6 + CROSSWALK_W,
];

/** Waiting distance from the centre for every vehicle; columns line up behind the stop line. */
export function waitDistances(layout: Layout, vehicles: readonly Vehicle[]): Map<string, number> {
  const result = new Map<string, number>();
  const columns = new Map<string, Vehicle[]>();
  for (const v of vehicles) {
    if (v.kind === 'pedestrian' || v.circulating) continue;
    const key = `${v.from}-${v.kind === 'tram'}`;
    columns.set(key, [...(columns.get(key) ?? []), v]);
  }
  for (const column of columns.values()) {
    let dist = 0;
    let prevHalf = 0;
    column
      .sort((a, b) => a.queue - b.queue)
      .forEach((v, i) => {
        const half = VEHICLE_SIZE[v.kind].length / 2;
        dist = i === 0 ? layout.stop[v.from] + half + 8 : dist + prevHalf + half + 14;
        prevHalf = half;
        result.set(v.id, dist);
      });
  }
  return result;
}

function finishPath(raw: Vec[], waitIndex: number, entryIndex: number, exitIndex: number): VehiclePath {
  const points: PathPoint[] = [];
  let s = 0;
  const marks = { sWait: 0, sEntry: 0, sExit: 0 };
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) s += distance(raw[i - 1], raw[i]);
    const a = i < raw.length - 1 ? raw[i] : raw[i - 1];
    const b = i < raw.length - 1 ? raw[i + 1] : raw[i];
    points.push({ ...raw[i], s, angle: headingAngle({ x: b.x - a.x, y: b.y - a.y }) });
    if (i === waitIndex) marks.sWait = s;
    if (i === entryIndex) marks.sEntry = s;
    if (i === exitIndex) marks.sExit = s;
  }
  return { points, length: s, ...marks };
}

function pushCubic(raw: Vec[], p0: Vec, p1: Vec, p2: Vec, p3: Vec, samples = CURVE_SAMPLES): void {
  for (let i = 1; i <= samples; i++) raw.push(cubic(p0, p1, p2, p3, i / samples));
}

const EXIT_DIST = CENTER + 300;

function junctionPath(layout: Layout, v: Vehicle, waitDist: number): VehiclePath {
  const tram = v.kind === 'tram';
  const latIn = laneLateral(layout, v.from, tram);
  const latOut = laneLateral(layout, v.to, tram);
  const hIn = neg(ARM_DIR[v.from]);
  const hOut = ARM_DIR[v.to];
  const p0 = armPoint(v.from, layout.mouth[v.from] + 4, latIn);
  const p3 = armPoint(v.to, layout.mouth[v.to] + 4, -latOut);
  const chord = distance(p0, p3);
  // 0.39 * chord ≈ cubic handle length approximating a quarter circle
  const k = turnOf(v.from, v.to) === 'straight' ? chord / 3 : chord * 0.39;
  const raw: Vec[] = [armPoint(v.from, waitDist + PRE_PATH, latIn), armPoint(v.from, waitDist, latIn), p0];
  pushCubic(raw, p0, add(p0, scale(hIn, k)), add(p3, scale(hOut, -k)), p3);
  raw.push(armPoint(v.to, EXIT_DIST, -latOut));
  return finishPath(raw, 1, 2, 2 + CURVE_SAMPLES);
}

/** Ring angle (SVG degrees) of each arm; traffic circulates towards decreasing angles. */
const RING_THETA = [90, 0, -90, 180];
const RING_ENTRY_OFFSET = 35;
const RING_HANDLE = 25;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const ringPoint = (deg: number): Vec => ({
  x: CENTER + RING_MID * Math.cos(rad(deg)),
  y: CENTER + RING_MID * Math.sin(rad(deg)),
});
const ringTangent = (deg: number): Vec => ({ x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) });

function pushArc(raw: Vec[], fromDeg: number, toDeg: number): void {
  const steps = Math.max(2, Math.ceil((fromDeg - toDeg) / 4));
  for (let i = 1; i <= steps; i++) raw.push(ringPoint(fromDeg + ((toDeg - fromDeg) * i) / steps));
}

function ringPath(v: Vehicle, waitDist: number): VehiclePath {
  const lat = LANE / 2;
  const hOut = ARM_DIR[v.to];
  const exitDeg = RING_THETA[v.to] + RING_ENTRY_OFFSET;
  const raw: Vec[] = [];
  let waitIndex: number;
  let entryIndex: number;
  let startDeg: number;
  if (v.circulating) {
    startDeg = RING_THETA[v.from] - 45;
    raw.push(ringPoint(startDeg + 60));
    pushArc(raw, startDeg + 60, startDeg);
    waitIndex = raw.length - 1;
    entryIndex = waitIndex;
  } else {
    const hIn = neg(ARM_DIR[v.from]);
    const p0 = armPoint(v.from, RING_OUT + 4, lat);
    startDeg = RING_THETA[v.from] - RING_ENTRY_OFFSET;
    const q = ringPoint(startDeg);
    raw.push(armPoint(v.from, waitDist + PRE_PATH, lat), armPoint(v.from, waitDist, lat), p0);
    pushCubic(raw, p0, add(p0, scale(hIn, RING_HANDLE)), add(q, scale(ringTangent(startDeg), -RING_HANDLE)), q, 12);
    waitIndex = 1;
    entryIndex = 2;
  }
  let endDeg = exitDeg;
  while (endDeg > startDeg - 5) endDeg -= 360;
  pushArc(raw, startDeg, endDeg);
  const exitIndex = raw.length - 1;
  const r = ringPoint(endDeg);
  const p3 = armPoint(v.to, RING_OUT + 4, -lat);
  pushCubic(raw, r, add(r, scale(ringTangent(endDeg), RING_HANDLE)), add(p3, scale(hOut, -RING_HANDLE)), p3, 12);
  raw.push(armPoint(v.to, EXIT_DIST, -lat));
  return finishPath(raw, waitIndex, entryIndex, exitIndex);
}

function pedestrianPath(layout: Layout, v: Vehicle): VehiclePath {
  const [near, far] = crosswalkBand(layout, v.to);
  const d = (near + far) / 2;
  const curb = layout.roadHalf[v.to];
  const raw = [
    armPoint(v.to, d, (curb + 22) * v.walkDir),
    armPoint(v.to, d, curb * v.walkDir),
    armPoint(v.to, d, -curb * v.walkDir),
    armPoint(v.to, d, -(curb + 80) * v.walkDir),
  ];
  return finishPath(raw, 0, 1, 2);
}

export function buildVehiclePath(layout: Layout, v: Vehicle, waitDist: number): VehiclePath {
  if (v.kind === 'pedestrian') return pedestrianPath(layout, v);
  if (layout.roundabout) return ringPath(v, waitDist);
  return junctionPath(layout, v, waitDist);
}

/** Lane-centre path for drawing tram tracks between two arms. */
export function trackPath(layout: Layout, from: Arm, to: Arm): VehiclePath {
  const fake = { id: '', kind: 'tram', from, to, circulating: false } as Vehicle;
  return junctionPath(layout, fake, CENTER - PRE_PATH + 40);
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
