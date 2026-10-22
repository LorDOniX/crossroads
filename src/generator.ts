import { ALL_ARMS } from './geometry';
import { Rng, deriveSeed } from './random';
import { allConflictsDecided, controlOf, hasAnyYield, isSolvable, settlePhase } from './rules';
import type { Arm, Intersection, Scenario, SignalPhase, SignalPlan, Vehicle } from './types';

export type IntersectionType =
  | 'x-equal'
  | 't-equal'
  | 'x-main-straight'
  | 'x-main-bent'
  | 't-main-straight'
  | 't-main-bent'
  | 'x-signals'
  | 't-signals'
  | 'x-signals-blinking'
  | 'x-police'
  | 'roundabout';

export type Extra = 'none' | 'column' | 'emergency' | 'pedestrian';

export interface TestItem {
  type: IntersectionType;
  seed: number;
  tram: boolean;
  extra: Extra;
}

export const TYPES: readonly IntersectionType[] = [
  'x-equal',
  't-equal',
  'x-main-straight',
  'x-main-bent',
  't-main-straight',
  't-main-bent',
  'x-signals',
  't-signals',
  'x-signals-blinking',
  'x-police',
  'roundabout',
];

export const LABELS: Record<IntersectionType, string> = {
  'x-equal': 'Rovnocenná křižovatka',
  't-equal': 'Rovnocenná křižovatka tvaru T',
  'x-main-straight': 'Hlavní silnice vede rovně',
  'x-main-bent': 'Lomená hlavní silnice',
  't-main-straight': 'Křižovatka T, hlavní vede rovně',
  't-main-bent': 'Křižovatka T, lomená hlavní',
  'x-signals': 'Křižovatka řízená semafory',
  't-signals': 'Křižovatka T řízená semafory',
  'x-signals-blinking': 'Semafory blikají žlutě',
  'x-police': 'Křižovatku řídí policista',
  roundabout: 'Kruhový objezd',
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

const JACKETS = ['#e94e77', '#3f88c5', '#f49d37', '#7bc67b'];
const PLAYER_COLOR = '#d62828';
const TRAM_COLOR = '#efe6cc';
const AMBULANCE_COLOR = '#f6f6f0';

const isActiveControl = (type: IntersectionType): boolean =>
  type === 'x-signals' || type === 't-signals' || type === 'x-police';

/** Features that make sense for the given intersection type. */
function allowedExtras(type: IntersectionType): Extra[] {
  if (type === 'roundabout') return ['none'];
  if (isActiveControl(type)) return ['none', 'column', 'emergency'];
  return ['none', 'column', 'emergency', 'pedestrian'];
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

function buildSignalPlan(rng: Rng, arms: readonly Arm[], blinking: boolean): SignalPlan {
  const through = armPairs(arms, 2);
  const axes = through.length === 2 ? rng.shuffle(through) : [through[0], arms.filter((a) => !through[0].includes(a))];
  const phases: SignalPhase[] = axes.map((a) => ({ arms: a, leftOnly: false }));
  if (!blinking && through.length === 2 && rng.chance(0.4)) phases.unshift({ arms: axes[0], leftOnly: true });
  return { blinking, phases, rightArrows: blinking ? [] : arms.filter(() => rng.chance(0.35)) };
}

function buildIntersection(rng: Rng, item: TestItem): Intersection {
  const { type } = item;
  // the player always comes from the south, so that arm never goes missing
  const tShaped = type.startsWith('t-') || (type === 'roundabout' && rng.chance(0.25));
  const missing: Arm | null = tShaped ? rng.pick<Arm>([1, 2, 3]) : null;
  const arms = ALL_ARMS.filter((a) => a !== missing);
  const inter: Intersection = {
    arms,
    mainArms: [],
    yieldSign: rng.chance(0.3) ? 'stop' : 'giveWay',
    tramLine: null,
    signals: null,
    police: null,
    roundabout: null,
    crosswalks: [],
    label: LABELS[type],
  };
  const anyMainRoad = (): Arm[] => rng.pick([...armPairs(arms, 2), ...armPairs(arms, 1)]);
  if (type.endsWith('main-straight')) inter.mainArms = rng.pick(armPairs(arms, 2));
  if (type.endsWith('main-bent')) inter.mainArms = rng.pick(armPairs(arms, 1));
  if (type.includes('signals')) {
    const blinking = type.endsWith('blinking');
    // signs for the case the lights are off; while lit they are overridden
    if (blinking || rng.chance(0.5)) inter.mainArms = anyMainRoad();
    inter.signals = buildSignalPlan(rng, arms, blinking);
  }
  if (type === 'x-police') {
    if (rng.chance(0.5)) inter.mainArms = anyMainRoad();
    inter.police = { phases: rng.shuffle(armPairs(arms, 2)) };
  }
  if (type === 'roundabout') inter.roundabout = { yieldOnEntry: rng.chance(0.7) };
  if (item.extra === 'pedestrian') inter.crosswalks = rng.shuffle(arms).slice(0, 1 + rng.int(2));
  return inter;
}

function pickExit(rng: Rng, inter: Intersection, from: Arm, preferStraight: boolean): Arm {
  const exits = inter.arms.filter((a) => a !== from);
  const straight = ((from + 2) % 4) as Arm;
  if (preferStraight && exits.includes(straight) && rng.chance(0.6)) return straight;
  return rng.pick(exits);
}

function buildVehicles(rng: Rng, inter: Intersection, item: TestItem): Vehicle[] {
  const colors = rng.shuffle(PALETTE);
  let colorIndex = 0;
  let idCounter = 0;
  const vehicles: Vehicle[] = [];
  const add = (partial: Partial<Vehicle> & Pick<Vehicle, 'from' | 'to'>): Vehicle => {
    const vehicle: Vehicle = {
      id: `v${idCounter++}`,
      kind: 'car',
      color: '',
      name: '',
      isPlayer: false,
      queue: 0,
      beacons: false,
      circulating: false,
      walkDir: 1,
      ...partial,
    };
    if (!vehicle.name) {
      const paint = colors[colorIndex++ % colors.length];
      if (vehicle.kind !== 'truck' && rng.chance(0.3)) vehicle.kind = 'truck';
      vehicle.color = paint.color;
      vehicle.name = vehicle.kind === 'truck' ? `${paint.adj} nákladní auto` : `${paint.adj} auto`;
    }
    vehicles.push(vehicle);
    return vehicle;
  };

  const player = add({
    id: 'player',
    from: 0,
    to: pickExit(rng, inter, 0, false),
    isPlayer: true,
    color: PLAYER_COLOR,
    name: 'tvoje červené auto',
  });
  const others = inter.arms.filter((a) => a !== 0);
  const count = others.length === 3 ? rng.weighted([1, 2, 3], [0.2, 0.45, 0.35]) : rng.weighted([1, 2], [0.35, 0.65]);
  for (const from of rng.shuffle(others).slice(0, count)) add({ from, to: pickExit(rng, inter, from, false) });

  if (inter.roundabout) {
    const circulating = rng.weighted([0, 1, 2], [0.2, 0.5, 0.3]);
    for (const from of rng.shuffle(ALL_ARMS).slice(0, circulating)) {
      add({ from, to: rng.pick(inter.arms), circulating: true });
    }
    return vehicles;
  }

  if (item.tram) {
    const from = rng.pick(inter.arms);
    add({ from, to: pickExit(rng, inter, from, true), kind: 'tram', color: TRAM_COLOR, name: 'tramvaj' });
  }

  const fronts = vehicles.filter((v) => v.kind !== 'tram');
  if (item.extra === 'column') {
    const target = rng.pick(fronts);
    if (target.isPlayer && rng.chance(0.4)) {
      add({ from: 0, to: pickExit(rng, inter, 0, false) });
      player.queue = 1;
    } else {
      add({ from: target.from, to: pickExit(rng, inter, target.from, false), queue: 1 });
    }
  }
  if (item.extra === 'emergency') {
    const candidates = fronts.filter((v) => !v.isPlayer && v.queue === 0);
    if (candidates.length) {
      const target = rng.pick(candidates);
      Object.assign(target, { kind: 'ambulance', color: AMBULANCE_COLOR, name: 'sanitka', beacons: rng.chance(0.75) });
    }
  }
  if (item.extra === 'pedestrian' && inter.crosswalks.length) {
    add({
      kind: 'pedestrian',
      from: 0,
      to: rng.pick(inter.crosswalks),
      color: rng.pick(JACKETS),
      name: 'chodec',
      walkDir: rng.chance(0.5) ? 1 : -1,
    });
  }
  return vehicles;
}

function difficultyOf(inter: Intersection, vehicles: readonly Vehicle[]): number {
  const tram = vehicles.find((v) => v.kind === 'tram');
  const features = [
    vehicles.some((v) => v.queue > 0),
    vehicles.some((v) => v.kind === 'ambulance'),
    vehicles.some((v) => v.kind === 'pedestrian'),
    tram !== undefined && vehicles.some((v) => v !== tram && v.from === tram.from),
    inter.police !== null,
    inter.roundabout !== null && !inter.roundabout.yieldOnEntry,
    inter.signals?.blinking === true,
    inter.signals?.phases.some((p) => p.leftOnly) === true,
    (inter.signals?.rightArrows.length ?? 0) > 0,
  ];
  return Math.min(3, 1 + features.filter(Boolean).length);
}

export function generateScenario(item: TestItem): Scenario {
  const rng = new Rng(item.seed);
  for (let attempt = 0; attempt < 600; attempt++) {
    const intersection = buildIntersection(rng, item);
    const vehicles = buildVehicles(rng, intersection, item);
    const tram = vehicles.find((v) => v.kind === 'tram');
    intersection.tramLine = tram ? [tram.from, tram.to] : null;
    const control = controlOf(intersection);
    const startPhase = control ? settlePhase(intersection, vehicles, rng.int(control.phases.length)) : 0;
    if (
      allConflictsDecided(intersection, vehicles) &&
      isSolvable(intersection, vehicles, startPhase) &&
      hasAnyYield(intersection, vehicles, startPhase)
    ) {
      return { intersection, vehicles, startPhase, difficulty: difficultyOf(intersection, vehicles) };
    }
  }
  if (!item.tram && item.extra === 'none') throw new Error(`Nelze vygenerovat křižovatku typu ${item.type}`);
  return generateScenario({ ...item, tram: false, extra: 'none' });
}

function makeItem(rng: Rng, type: IntersectionType, seed: number, tram: boolean): TestItem {
  const extra = rng.pick(allowedExtras(type).flatMap((e): Extra[] => (e === 'none' ? [e, e] : [e])));
  return { type, seed, tram: tram && type !== 'roundabout', extra };
}

/** Test of `total` intersections spread evenly over all types, roughly 40 % of them with a tram. */
export function buildTestSequence(seed: number, total: number): TestItem[] {
  const rng = new Rng(seed);
  const items: TestItem[] = [];
  for (let i = 0; i < total; i++) {
    items.push(makeItem(rng, TYPES[i % TYPES.length], deriveSeed(seed, i), i % 5 === 1 || i % 5 === 3));
  }
  return rng.shuffle(items);
}

/** Random intersection for practice; `type` null means any. */
export function practiceItem(seed: number, type: IntersectionType | null): TestItem {
  const rng = new Rng(seed);
  return makeItem(rng, type ?? rng.pick(TYPES), seed, rng.chance(0.4));
}
