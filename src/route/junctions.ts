import type { FixedJunction } from '../generator';
import type { Arm, Intersection } from '../types';
import type { OsmData, OsmNode, OsmWay, Tags } from './osm';
import { angleDiff, bearing, distance, lerp, nearPasses, pointAt, type LonLat, type Route } from './route';

export interface RouteJunction {
  /** Smallest OSM node id of the junction – the same for every pass. */
  id: number;
  center: LonLat;
  /** The car stops here, metres from the start. */
  at: number;
  label: string;
  /** OSM has no signs here, the priority is guessed from the road classes. */
  estimated: boolean;
  fixed: FixedJunction;
}

interface RealArm {
  /** From the junction centre outwards, degrees from north. */
  bearing: number;
  rank: number;
  priority: boolean;
  sign: 'giveWay' | 'stop' | null;
  crossing: boolean;
  signals: boolean;
  canEnter: boolean;
  canExit: boolean;
  names: string[];
}

/** Junction found in OSM data, independent of any route – the content of the offline files. */
export interface JunctionSite {
  /** Smallest OSM node id of the junction. */
  id: number;
  center: LonLat;
  /** Junction nodes; the route drives through the junction where it comes close to one of them. */
  nodes: LonLat[];
  arms: RealArm[];
  roundabout: boolean;
  signals: boolean;
  /** Bearings of tram tracks leaving the junction. */
  trams: number[];
}

interface GameArm {
  real: RealArm;
  slot: Arm;
}

/** Max distance of a junction node from the route, metres. */
const NEAR = 12;
/** Junction nodes closer than this form one junction (dual carriageways, turn lanes). */
const CLUSTER = 25;
/** The direction of an arm is measured to its point this far away. */
const ARM_POINT = 20;
/** Signs, signals and crossings up to this distance belong to the junction. */
const ARM_TAGS = 30;
/** Arms closer than this angle are one arm (both carriageways of a divided road). */
const MERGE_ARMS = 25;
/** The two one-way carriageways of one road may diverge this much at the junction mouth. */
const MERGE_CARRIAGEWAYS = 60;
/** Max angle between the route and the arm it uses. */
const MATCH_ROUTE = 40;
/** Max angle between a real arm and the game arm it is drawn as. */
const MAX_SKEW = 55;
const STOP_BEFORE = 15;
/** Passes of one junction closer than this along the route are one pass (roundabout). */
const PASS_GAP = 150;

const RANK: Record<string, number> = {
  motorway: 7,
  trunk: 6,
  primary: 5,
  secondary: 4,
  tertiary: 3,
  unclassified: 2,
  residential: 1,
  living_street: 0,
};

/** Relative angle (clockwise from the entry arm) where each game arm lies. */
const SLOT_ANGLE: Record<1 | 2 | 3, number> = { 1: 270, 2: 180, 3: 90 };

const pos = (n: OsmNode): LonLat => [n.lon, n.lat];
/** Grid cell in degrees, at least CLUSTER metres in both directions. */
const CELL = 0.0005;

/** Items within one grid cell around a point (cheap first filter before measuring distances). */
function gridOf<T>(items: readonly T[], at: (item: T) => LonLat): (p: LonLat) => T[] {
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const [lon, lat] = at(item);
    const key = `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
    const cell = cells.get(key);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  return ([lon, lat]) => {
    const x = Math.floor(lon / CELL);
    const y = Math.floor(lat / CELL);
    const result: T[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) result.push(...(cells.get(`${x + dx},${y + dy}`) ?? []));
    return result;
  };
}
const rankOf = (tags: Tags | undefined): number | undefined => RANK[(tags?.highway ?? '').replace(/_link$/, '')];
const isRoad = (way: OsmWay): boolean =>
  rankOf(way.tags) !== undefined && !['no', 'private'].includes(way.tags?.access ?? '') && way.tags?.area !== 'yes';
const isRing = (way: OsmWay): boolean => way.tags?.junction === 'roundabout' || way.tags?.junction === 'circular';
const isSignal = (tags: Tags | undefined): boolean =>
  tags?.highway === 'traffic_signals' && tags.traffic_signals !== 'crossing';

/** 1 = traffic only in the direction of the node order, -1 = only against it. */
function onewayOf(way: OsmWay): -1 | 0 | 1 {
  const value = way.tags?.oneway;
  if (value === 'yes' || value === 'true' || value === '1') return 1;
  if (value === '-1' || value === 'reverse') return -1;
  if (value === 'no') return 0;
  return way.tags?.highway === 'motorway' ? 1 : 0;
}

/** Walks the way from node `index` in direction `dir`; returns the point `target` metres away (or the way end). */
function walkWay(
  data: OsmData,
  way: OsmWay,
  index: number,
  dir: -1 | 1,
  target: number,
  limit: number,
  visit?: (node: OsmNode) => void,
): { point: LonLat; travelled: number } {
  let prev = pos(data.nodes.get(way.nodes[index]) as OsmNode);
  let point = prev;
  let travelled = 0;
  for (let j = index + dir; j >= 0 && j < way.nodes.length; j += dir) {
    const node = data.nodes.get(way.nodes[j]);
    if (!node) break;
    const p = pos(node);
    const step = distance(prev, p);
    if (travelled < target) point = travelled + step > target ? lerp(prev, p, (target - travelled) / step) : p;
    travelled += step;
    prev = p;
    if (travelled > limit) break;
    visit?.(node);
  }
  return { point, travelled };
}

function walkArm(data: OsmData, way: OsmWay, index: number, dir: -1 | 1, center: LonLat): RealArm {
  const arm: RealArm = {
    bearing: 0,
    rank: rankOf(way.tags) ?? 0,
    priority: way.tags?.priority_road === 'designated',
    sign: null,
    crossing: false,
    signals: false,
    canEnter: onewayOf(way) !== dir,
    canExit: onewayOf(way) !== -dir,
    names: way.tags?.name ? [way.tags.name] : [],
  };
  const { point } = walkWay(data, way, index, dir, ARM_POINT, ARM_TAGS, ({ tags }) => {
    if (tags?.highway === 'stop') arm.sign = 'stop';
    else if (tags?.highway === 'give_way') arm.sign ??= 'giveWay';
    if (tags?.highway === 'crossing' && tags.crossing !== 'no' && tags.crossing !== 'unmarked') arm.crossing = true;
    if (isSignal(tags)) arm.signals = true;
  });
  arm.bearing = Math.round(bearing(center, point) * 10) / 10;
  return arm;
}

/** One carriageway leads into the junction and the other out of it, both of the same road. */
const carriageways = (a: RealArm, b: RealArm): boolean =>
  a.canEnter !== a.canExit &&
  b.canEnter !== b.canExit &&
  a.canEnter === b.canExit &&
  (a.names.some((name) => b.names.includes(name)) || (!a.names.length && !b.names.length));

/** Adds `arm` to `into`: the direction ends up halfway, the attributes are combined. */
function absorb(into: RealArm, arm: RealArm): void {
  const diff = ((((arm.bearing - into.bearing) % 360) + 540) % 360) - 180;
  into.bearing = Math.round(((((into.bearing + diff / 2) % 360) + 360) % 360) * 10) / 10;
  into.rank = Math.max(into.rank, arm.rank);
  into.priority ||= arm.priority;
  into.sign = into.sign === 'stop' || arm.sign === 'stop' ? 'stop' : (into.sign ?? arm.sign);
  into.crossing ||= arm.crossing;
  into.signals ||= arm.signals;
  into.canEnter ||= arm.canEnter;
  into.canExit ||= arm.canExit;
  for (const name of arm.names) if (!into.names.includes(name)) into.names.push(name);
}

const copyArm = (arm: RealArm): RealArm => ({ ...arm, names: [...arm.names] });

function mergeArms(arms: readonly RealArm[]): RealArm[] {
  const merged: RealArm[] = [];
  for (const arm of arms) {
    const same = merged.find(
      (m) =>
        angleDiff(m.bearing, arm.bearing) < MERGE_ARMS ||
        (angleDiff(m.bearing, arm.bearing) < MERGE_CARRIAGEWAYS && carriageways(m, arm)),
    );
    if (same) absorb(same, arm);
    else merged.push(copyArm(arm));
  }
  return merged;
}

function closestArm<T extends { bearing: number }>(arms: readonly T[], direction: number, maxAngle: number): T | null {
  let best: T | null = null;
  for (const arm of arms) {
    if (angleDiff(arm.bearing, direction) < Math.min(maxAngle, best ? angleDiff(best.bearing, direction) : 360)) {
      best = arm;
    }
  }
  return best;
}

/** Game arms for arms at relative angles `rel`, or null when the junction does not fit the cross shape. */
function assignSlots(rel: readonly number[]): Arm[] | null {
  let best: Arm[] | null = null;
  let bestCost = Infinity;
  const permute = (used: Arm[]): void => {
    if (used.length === rel.length) {
      const cost = used.reduce<number>((sum, slot, i) => sum + angleDiff(rel[i], SLOT_ANGLE[slot as 1 | 2 | 3]), 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = used;
      }
      return;
    }
    for (const slot of [1, 2, 3] as const) if (!used.includes(slot)) permute([...used, slot]);
  };
  permute([]);
  const result = best as Arm[] | null;
  return result?.every((slot, i) => angleDiff(rel[i], SLOT_ANGLE[slot as 1 | 2 | 3]) <= MAX_SKEW) ? result : null;
}

function mainRoad(arms: readonly GameArm[]): { main: Arm[]; estimated: boolean } {
  const byRank = (list: readonly GameArm[]): GameArm[] => [...list].sort((a, b) => b.real.rank - a.real.rank);
  const free = arms.filter((a) => !a.real.sign);
  if (free.length < arms.length) {
    if (free.length >= 2)
      return {
        main: byRank(free)
          .slice(0, 2)
          .map((a) => a.slot),
        estimated: free.length > 2,
      };
    if (free.length === 1) {
      return { main: [free[0].slot, byRank(arms.filter((a) => a !== free[0]))[0].slot], estimated: true };
    }
    return { main: [], estimated: true };
  }
  const priority = arms.filter((a) => a.real.priority);
  if (priority.length === 2) return { main: priority.map((a) => a.slot), estimated: false };
  const sorted = byRank(arms);
  if (sorted[1].real.rank > sorted[2].real.rank) return { main: [sorted[0].slot, sorted[1].slot], estimated: true };
  return { main: [], estimated: true };
}

function tramLineOf(trams: readonly number[], arms: readonly GameArm[]): [Arm, Arm] | null {
  const slots = new Set<Arm>();
  for (const direction of trams) {
    const arm = closestArm(
      arms.map((a) => ({ bearing: a.real.bearing, slot: a.slot })),
      direction,
      MATCH_ROUTE,
    );
    if (arm) slots.add(arm.slot);
  }
  const list = [...slots];
  if (list.length < 2) return null;
  const straight = list.find((a) => list.includes(((a + 2) % 4) as Arm));
  return straight !== undefined ? [straight, ((straight + 2) % 4) as Arm] : [list[0], list[1]];
}

function tramBearings(data: OsmData, near: { way: OsmWay; index: number }[], center: LonLat): number[] {
  const nearest = new Map<OsmWay, { index: number; dist: number }>();
  for (const { way, index } of near) {
    const node = data.nodes.get(way.nodes[index]);
    const dist = node ? distance(center, pos(node)) : Infinity;
    if (dist < CLUSTER && dist < (nearest.get(way)?.dist ?? Infinity)) nearest.set(way, { index, dist });
  }
  const bearings: number[] = [];
  for (const [way, { index }] of nearest) {
    for (const dir of [-1, 1] as const) {
      const end = walkWay(data, way, index, dir, ARM_TAGS, ARM_TAGS);
      if (end.travelled < ARM_POINT) continue;
      const direction = Math.round(bearing(center, end.point) * 10) / 10;
      if (!bearings.some((b) => angleDiff(b, direction) < MERGE_ARMS)) bearings.push(direction);
    }
  }
  return bearings;
}

/** A junction with more than four arms drawn as a cross: arms on the same side are joined into one. */
function groupBySides(
  entry: RealArm,
  others: readonly RealArm[],
  exit: RealArm,
): { game: GameArm[]; playerTo: Arm } | null {
  const sides: (RealArm | null)[] = [copyArm(entry), null, null, null];
  let playerTo: Arm = 0;
  for (const arm of others) {
    const rel = (arm.bearing - entry.bearing + 360) % 360;
    const side = ((4 - Math.round(rel / 90)) % 4) as Arm;
    if (arm === exit) playerTo = side;
    const into = sides[side];
    if (into) absorb(into, arm);
    else sides[side] = copyArm(arm);
  }
  const game = sides.flatMap((real, slot) => (real ? [{ real, slot: slot as Arm }] : []));
  return playerTo !== 0 && game.length >= 3 ? { game, playerTo } : null;
}

function junctionOnPass(route: Route, site: JunctionSite, sMin: number, sMax: number): RouteJunction | null {
  const { center, arms } = site;
  if (sMin < STOP_BEFORE + 10 || sMax + 25 > route.length) return null;
  const entry = closestArm(arms, bearing(center, pointAt(route, sMin - 25).point), MATCH_ROUTE);
  const exit = closestArm(arms, bearing(center, pointAt(route, sMax + 25).point), MATCH_ROUTE);
  if (!entry || !exit || entry === exit) return null;
  const others = arms.filter((a) => a !== entry);
  if (others.length < 2) return null;
  let game: GameArm[];
  let playerTo: Arm;
  if (others.length <= 3) {
    const slots = assignSlots(others.map((a) => (a.bearing - entry.bearing + 360) % 360));
    if (!slots) return null;
    game = [{ real: entry, slot: 0 }, ...others.map((real, i) => ({ real, slot: slots[i] }))];
    playerTo = (game.find((g) => g.real === exit) as GameArm).slot;
  } else {
    const grouped = groupBySides(entry, others, exit);
    if (!grouped) return null;
    ({ game, playerTo } = grouped);
  }

  const roundabout = site.roundabout;
  const hasSignals = !roundabout && (site.signals || arms.some((a) => a.signals));
  const { main, estimated } = roundabout ? { main: [], estimated: false } : mainRoad(game);
  const names = [...new Set(game.flatMap((g) => g.real.names))];
  const intersection: Intersection = {
    arms: game.map((g) => g.slot).sort((a, b) => a - b),
    mainArms: main,
    yieldSign: game.some((g) => g.real.sign === 'stop') ? 'stop' : 'giveWay',
    tramLine: roundabout ? null : tramLineOf(site.trams, game),
    signals: null,
    police: null,
    roundabout: roundabout ? { yieldOnEntry: true } : null,
    // the generator draws crossings only at junctions without lights
    crosswalks: hasSignals || roundabout ? [] : game.filter((g) => g.real.crossing).map((g) => g.slot),
    label: names.slice(0, 3).join(' × ') || 'Křižovatka bez názvu',
  };
  return {
    id: site.id,
    center,
    at: Math.max(0, sMin - STOP_BEFORE),
    label: intersection.label,
    estimated: estimated && !hasSignals,
    fixed: {
      intersection,
      hasSignals,
      playerTo,
      noEntry: game.filter((g) => g.slot !== 0 && !g.real.canEnter).map((g) => g.slot),
      noExit: game.filter((g) => g.slot !== playerTo && !g.real.canExit).map((g) => g.slot),
    },
  };
}

/** All junctions in the OSM data with at least three arms; more than four are joined into a cross for each pass. */
export function findSites(data: OsmData): JunctionSite[] {
  const roads = data.ways.filter(isRoad);
  const rings = roads.filter(isRing);
  const nodeOf = (id: number): OsmNode => data.nodes.get(id) as OsmNode;

  const refs = new Map<number, { way: OsmWay; index: number }[]>();
  for (const way of roads) {
    way.nodes.forEach((id, index) => {
      if (!data.nodes.has(id)) return;
      const list = refs.get(id) ?? [];
      list.push({ way, index });
      refs.set(id, list);
    });
  }
  const degree = (id: number): number =>
    (refs.get(id) ?? []).reduce(
      (sum, { way, index }) => sum + (index > 0 ? 1 : 0) + (index < way.nodes.length - 1 ? 1 : 0),
      0,
    );
  const candidates = [...refs.keys()].filter((id) => degree(id) >= 3).map(nodeOf);

  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const p = parent.get(id);
    if (p === undefined || p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const nearCandidates = gridOf(candidates, pos);
  // a junction next to a roundabout stays a junction of its own
  const ringNodes = new Set(rings.flatMap((ring) => ring.nodes));
  for (const a of candidates) {
    for (const b of nearCandidates(pos(a))) {
      if (b.id > a.id && ringNodes.has(a.id) === ringNodes.has(b.id) && distance(pos(a), pos(b)) < CLUSTER) {
        union(a.id, b.id);
      }
    }
  }
  for (const ring of rings) for (const id of ring.nodes) union(id, ring.nodes[0]);

  const groups = new Map<number, number[]>();
  for (const { id } of candidates) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);

  const tramNodes = data.ways
    .filter((w) => w.tags?.railway === 'tram')
    .flatMap((way) => way.nodes.map((id, index) => ({ way, index, node: data.nodes.get(id) })))
    .filter((t): t is { way: OsmWay; index: number; node: OsmNode } => t.node !== undefined);
  const nearTrams = gridOf(tramNodes, (t) => pos(t.node));

  const sites: JunctionSite[] = [];
  for (const group of groups.values()) {
    const members = new Set(group);
    const ringWays = rings.filter((w) => w.nodes.some((id) => members.has(id)));
    const centerIds = ringWays.length ? [...new Set(ringWays.flatMap((w) => w.nodes))] : group;
    const centerNodes = centerIds.filter((id) => data.nodes.has(id)).map(nodeOf);
    const center: LonLat = [
      centerNodes.reduce((sum, n) => sum + n.lon, 0) / centerNodes.length,
      centerNodes.reduce((sum, n) => sum + n.lat, 0) / centerNodes.length,
    ];
    const arms = mergeArms(
      group.flatMap((id) =>
        (refs.get(id) ?? []).flatMap(({ way, index }) =>
          isRing(way)
            ? []
            : ([-1, 1] as const).flatMap((dir) => {
                const next = way.nodes[index + dir];
                return next === undefined || members.has(next) ? [] : [walkArm(data, way, index, dir, center)];
              }),
        ),
      ),
    );
    if (arms.length < 3) continue;
    sites.push({
      id: Math.min(...group),
      center,
      nodes: group.map((id) => pos(nodeOf(id))),
      arms,
      roundabout: ringWays.length > 0,
      signals: group.some((id) => isSignal(nodeOf(id).tags)),
      trams: tramBearings(data, nearTrams(center), center),
    });
  }
  return sites;
}

/** Junctions the route drives through, in the order of driving; a junction passed twice is listed twice. */
export function junctionsOnRoute(route: Route, sites: readonly JunctionSite[]): RouteJunction[] {
  const lons = route.points.map((p) => p[0]);
  const lats = route.points.map((p) => p[1]);
  const margin = 0.001;
  const [west, east] = [Math.min(...lons) - margin, Math.max(...lons) + margin];
  const [south, north] = [Math.min(...lats) - margin, Math.max(...lats) + margin];

  const result: RouteJunction[] = [];
  for (const site of sites) {
    const [lon, lat] = site.center;
    if (lon < west || lon > east || lat < south || lat > north) continue;
    const passes = site.nodes
      .flatMap((p) => nearPasses(route, p, NEAR).map((pass) => pass.along))
      .sort((a, b) => a - b);
    let start = 0;
    for (let i = 1; i <= passes.length; i++) {
      if (i < passes.length && passes[i] - passes[i - 1] < PASS_GAP) continue;
      const junction = junctionOnPass(route, site, passes[start], passes[i - 1]);
      if (junction) result.push(junction);
      start = i;
    }
  }
  return result.sort((a, b) => a.at - b.at);
}

export const findJunctions = (route: Route, data: OsmData): RouteJunction[] => junctionsOnRoute(route, findSites(data));
