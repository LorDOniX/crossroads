import { ALL_ARMS } from './geometry';
import { allConflictsDecided, hasAnyYield, hasGreen, isSolvable } from './rules';
import type { Arm, Intersection, Scenario, SignalPlan, Vehicle, VehicleKind } from './types';

export type IntersectionType =
  | 'x-equal'
  | 't-equal'
  | 'x-main-straight'
  | 'x-main-bent'
  | 't-main-straight'
  | 't-main-bent'
  | 'x-signals'
  | 't-signals'
  | 'x-signals-blinking';

export interface TestItem {
  type: IntersectionType;
  withTram: boolean;
}

const TYPES: readonly IntersectionType[] = [
  'x-equal',
  't-equal',
  'x-main-straight',
  'x-main-bent',
  't-main-straight',
  't-main-bent',
  'x-signals',
  't-signals',
  'x-signals-blinking',
];

const LABELS: Record<IntersectionType, string> = {
  'x-equal': 'Rovnocenná křižovatka',
  't-equal': 'Rovnocenná křižovatka tvaru T',
  'x-main-straight': 'Hlavní silnice vede rovně',
  'x-main-bent': 'Lomená hlavní silnice',
  't-main-straight': 'Křižovatka T, hlavní vede rovně',
  't-main-bent': 'Křižovatka T, lomená hlavní',
  'x-signals': 'Křižovatka řízená semafory',
  't-signals': 'Křižovatka T řízená semafory',
  'x-signals-blinking': 'Semafory blikají žlutě',
};

const PALETTE: readonly { color: string; adj: string }[] = [
  { color: '#1f6fd1', adj: 'modré' },
  { color: '#f2c200', adj: 'žluté' },
  { color: '#2e9e44', adj: 'zelené' },
  { color: '#b8bec6', adj: 'stříbrné' },
  { color: '#f4f4f4', adj: 'bílé' },
  { color: '#2b2b2b', adj: 'černé' },
  { color: '#ef7d1a', adj: 'oranžové' },
  { color: '#7b3fb5', adj: 'fialové' },
];

const PLAYER_COLOR = '#d62828';
const TRAM_COLOR = '#efe6cc';

const rand = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(items: readonly T[]): T => items[rand(items.length)];
const chance = (p: number): boolean => Math.random() < p;

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weighted<T>(items: readonly T[], weights: readonly number[]): T {
  let r = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Pairs of present arms that are adjacent (gap 1) or opposite (gap 2). */
function armPairs(arms: readonly Arm[], gap: 1 | 2): Arm[][] {
  const result: Arm[][] = [];
  for (const a of arms) {
    const b = ((a + gap) % 4) as Arm;
    if (arms.includes(b) && (gap === 1 || a < b)) result.push([a, b]);
  }
  return result;
}

function buildSignalPlan(arms: readonly Arm[], blinking: boolean): SignalPlan {
  const through = armPairs(arms, 2);
  const phases =
    through.length === 2 ? shuffle(through) : [through[0], arms.filter((a) => !through[0].includes(a))];
  return { blinking, phases, rightArrows: blinking ? [] : arms.filter(() => chance(0.35)) };
}

function buildIntersection(type: IntersectionType): Intersection {
  // the player always comes from the south, so that arm never goes missing
  const missing: Arm | null = type.startsWith('t-') ? pick<Arm>([1, 2, 3]) : null;
  const arms = ALL_ARMS.filter((a) => a !== missing);
  let mainArms: Arm[] = [];
  let signals: SignalPlan | null = null;
  if (type.endsWith('main-straight')) mainArms = pick(armPairs(arms, 2));
  if (type.endsWith('main-bent')) mainArms = pick(armPairs(arms, 1));
  if (type.includes('signals')) {
    const blinking = type.endsWith('blinking');
    // signs for the case the lights are off; while lit they are overridden
    if (blinking || chance(0.5)) mainArms = pick([...armPairs(arms, 2), ...armPairs(arms, 1)]);
    signals = buildSignalPlan(arms, blinking);
  }
  return {
    arms,
    mainArms,
    yieldSign: chance(0.3) ? 'stop' : 'giveWay',
    tramLine: null,
    signals,
    label: LABELS[type],
  };
}

function pickExit(inter: Intersection, from: Arm, preferStraight: boolean): Arm {
  const exits = inter.arms.filter((a) => a !== from);
  const straight = ((from + 2) % 4) as Arm;
  if (preferStraight && exits.includes(straight) && chance(0.6)) return straight;
  return pick(exits);
}

function buildVehicles(inter: Intersection, withTram: boolean): Vehicle[] {
  const others = inter.arms.filter((a) => a !== 0);
  const count =
    others.length === 3 ? weighted([1, 2, 3], [0.2, 0.45, 0.35]) : weighted([1, 2], [0.35, 0.65]);
  const occupied = shuffle(others).slice(0, count);
  const tramArm = withTram ? pick(occupied) : null;
  const colors = shuffle(PALETTE);

  const vehicles: Vehicle[] = [
    {
      id: 'player',
      kind: 'car',
      color: PLAYER_COLOR,
      name: 'tvoje červené auto',
      from: 0,
      to: pickExit(inter, 0, false),
      isPlayer: true,
    },
  ];
  occupied.forEach((from, i) => {
    const kind: VehicleKind = from === tramArm ? 'tram' : chance(0.3) ? 'truck' : 'car';
    const paint = colors[i];
    vehicles.push({
      id: `v${i}`,
      kind,
      color: kind === 'tram' ? TRAM_COLOR : paint.color,
      name: kind === 'tram' ? 'tramvaj' : kind === 'truck' ? `${paint.adj} nákladní auto` : `${paint.adj} auto`,
      from,
      to: pickExit(inter, from, kind === 'tram'),
      isPlayer: false,
    });
  });
  return vehicles;
}

/** Random phase in which at least one vehicle has green. */
function pickStartPhase(inter: Intersection, vehicles: readonly Vehicle[]): number {
  if (!inter.signals || inter.signals.blinking) return 0;
  const candidates = inter.signals.phases
    .map((_, i) => i)
    .filter((i) => vehicles.some((v) => hasGreen(inter, v.from, i)));
  return pick(candidates);
}

export function generateScenario(item: TestItem): Scenario {
  for (let attempt = 0; attempt < 500; attempt++) {
    const intersection = buildIntersection(item.type);
    const vehicles = buildVehicles(intersection, item.withTram);
    const tram = vehicles.find((v) => v.kind === 'tram');
    intersection.tramLine = tram ? [tram.from, tram.to] : null;
    const startPhase = pickStartPhase(intersection, vehicles);
    if (
      allConflictsDecided(intersection, vehicles) &&
      isSolvable(intersection, vehicles, startPhase) &&
      hasAnyYield(intersection, vehicles, startPhase)
    ) {
      return { intersection, vehicles, startPhase };
    }
  }
  if (!item.withTram) throw new Error(`Nelze vygenerovat křižovatku typu ${item.type}`);
  return generateScenario({ ...item, withTram: false });
}

/** Test of `total` intersections spread evenly over all types, roughly 40 % of them with a tram. */
export function buildTestSequence(total: number): TestItem[] {
  const items: TestItem[] = [];
  for (let i = 0; i < total; i++) {
    items.push({ type: TYPES[i % TYPES.length], withTram: i % 5 === 1 || i % 5 === 3 });
  }
  return shuffle(items);
}
