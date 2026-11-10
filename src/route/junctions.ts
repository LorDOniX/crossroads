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
  arm.bearing = bearing(center, point);
  return arm;
}

function mergeArms(arms: readonly RealArm[]): RealArm[] {
  const merged: RealArm[] = [];
  for (const arm of arms) {
    const same = merged.find((m) => angleDiff(m.bearing, arm.bearing) < MERGE_ARMS);
    if (!same) {
      merged.push({ ...arm, names: [...arm.names] });
      continue;
    }
    same.rank = Math.max(same.rank, arm.rank);
    same.priority ||= arm.priority;
    same.sign = same.sign === 'stop' || arm.sign === 'stop' ? 'stop' : (same.sign ?? arm.sign);
    same.crossing ||= arm.crossing;
    same.signals ||= arm.signals;
    same.canEnter ||= arm.canEnter;
    same.canExit ||= arm.canExit;
    for (const name of arm.names) if (!same.names.includes(name)) same.names.push(name);
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

function tramLineOf(
  data: OsmData,
  trams: readonly OsmWay[],
  center: LonLat,
  arms: readonly GameArm[],
): [Arm, Arm] | null {
  const slots = new Set<Arm>();
  for (const way of trams) {
    let nearest = -1;
    let nearestDist = CLUSTER;
    way.nodes.forEach((id, i) => {
      const node = data.nodes.get(id);
      const d = node ? distance(center, pos(node)) : Infinity;
      if (d < nearestDist) {
        nearest = i;
        nearestDist = d;
      }
    });
    if (nearest < 0) continue;
    for (const dir of [-1, 1] as const) {
      const end = walkWay(data, way, nearest, dir, ARM_TAGS, ARM_TAGS);
      if (end.travelled < ARM_POINT) continue;
      const arm = closestArm(
        arms.map((a) => ({ bearing: a.real.bearing, slot: a.slot })),
        bearing(center, end.point),
        MATCH_ROUTE,
      );
      if (arm) slots.add(arm.slot);
    }
  }
  const list = [...slots];
  if (list.length < 2) return null;
  const straight = list.find((a) => list.includes(((a + 2) % 4) as Arm));
  return straight !== undefined ? [straight, ((straight + 2) % 4) as Arm] : [list[0], list[1]];
}

interface Cluster {
  id: number;
  center: LonLat;
  arms: RealArm[];
  roundabout: boolean;
  signals: boolean;
  tramLine: (arms: readonly GameArm[]) => [Arm, Arm] | null;
}

function junctionOnPass(route: Route, cluster: Cluster, sMin: number, sMax: number): RouteJunction | null {
  const { center, arms } = cluster;
  if (sMin < STOP_BEFORE + 10 || sMax + 25 > route.length) return null;
  const entry = closestArm(arms, bearing(center, pointAt(route, sMin - 25).point), MATCH_ROUTE);
  const exit = closestArm(arms, bearing(center, pointAt(route, sMax + 25).point), MATCH_ROUTE);
  if (!entry || !exit || entry === exit) return null;
  const others = arms.filter((a) => a !== entry);
  if (others.length < 2 || others.length > 3) return null;
  const slots = assignSlots(others.map((a) => (a.bearing - entry.bearing + 360) % 360));
  if (!slots) return null;
  const game: GameArm[] = [{ real: entry, slot: 0 }, ...others.map((real, i) => ({ real, slot: slots[i] }))];
  const playerTo = (game.find((g) => g.real === exit) as GameArm).slot;

  const roundabout = cluster.roundabout;
  const hasSignals = !roundabout && (cluster.signals || arms.some((a) => a.signals));
  const { main, estimated } = roundabout ? { main: [], estimated: false } : mainRoad(game);
  const names = [...new Set(game.flatMap((g) => g.real.names))];
  const intersection: Intersection = {
    arms: game.map((g) => g.slot).sort((a, b) => a - b),
    mainArms: main,
    yieldSign: game.some((g) => g.real.sign === 'stop') ? 'stop' : 'giveWay',
    tramLine: roundabout ? null : cluster.tramLine(game),
    signals: null,
    police: null,
    roundabout: roundabout ? { yieldOnEntry: true } : null,
    // the generator draws crossings only at junctions without lights
    crosswalks: hasSignals || roundabout ? [] : game.filter((g) => g.real.crossing).map((g) => g.slot),
    label: names.slice(0, 3).join(' × ') || 'Křižovatka bez názvu',
  };
  return {
    id: cluster.id,
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

/** Junctions the route drives through, in the order of driving; a junction passed twice is listed twice. */
export function findJunctions(route: Route, data: OsmData): RouteJunction[] {
  const roads = data.ways.filter(isRoad);
  const rings = roads.filter(isRing);
  const trams = data.ways.filter((w) => w.tags?.railway === 'tram');
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
  const candidates = [...refs.keys()].filter((id) => degree(id) >= 3);

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
  for (let i = 0; i < candidates.length; i++) {
    const a = nodeOf(candidates[i]);
    for (let j = i + 1; j < candidates.length; j++) {
      const b = nodeOf(candidates[j]);
      if (Math.abs(a.lat - b.lat) < 0.0005 && distance(pos(a), pos(b)) < CLUSTER) union(a.id, b.id);
    }
  }
  for (const ring of rings) for (const id of ring.nodes) union(id, ring.nodes[0]);

  const groups = new Map<number, number[]>();
  for (const id of candidates) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);

  const result: RouteJunction[] = [];
  for (const group of groups.values()) {
    const members = new Set(group);
    const passes = group
      .flatMap((id) => nearPasses(route, pos(nodeOf(id)), NEAR).map((p) => p.along))
      .sort((a, b) => a - b);
    if (!passes.length) continue;

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
    const cluster: Cluster = {
      id: Math.min(...group),
      center,
      arms,
      roundabout: ringWays.length > 0,
      signals: group.some((id) => isSignal(nodeOf(id).tags)),
      tramLine: (gameArms) => tramLineOf(data, trams, center, gameArms),
    };

    let start = 0;
    for (let i = 1; i <= passes.length; i++) {
      if (i < passes.length && passes[i] - passes[i - 1] < PASS_GAP) continue;
      const junction = junctionOnPass(route, cluster, passes[start], passes[i - 1]);
      if (junction) result.push(junction);
      start = i;
    }
  }
  return result.sort((a, b) => a.at - b.at);
}
