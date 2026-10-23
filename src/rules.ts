/**
 * Pravidla přednosti v jízdě (zákon č. 361/2000 Sb.).
 *
 * Každé rameno má na obvodu křižovatky čtyři body (výjezd do pruhu, výjezd po kolejích,
 * vjezd po kolejích, vjezd z pruhu) seřazené proti směru hodinových ručiček; dráhy dvou vozidel
 * se kříží, když se jejich tětivy protínají, nebo když míří do stejného výjezdového bodu.
 *
 * Pořadí rozhodování:
 * - vozidlo v koloně čeká na vozidlo před sebou,
 * - vozidlu s majákem dávají přednost všichni, jejichž dráhu kříží (§ 41 odst. 7),
 * - chodci na přechodu mají přednost před vozidly, která přechod přejíždějí (§ 5 odst. 2 písm. f, g),
 *   sami dávají přednost tramvaji (§ 54 odst. 3),
 * - kruhový objezd se značkou „Dej přednost“: přednost mají vozidla na kruhu (§ 22 odst. 5),
 *   bez ní platí pravidlo pravé ruky, tedy přednost mají vjíždějící,
 * - pokyny policisty mají přednost před semafory a semafory před značkami (§ 76),
 * - hlavní × vedlejší pozemní komunikace (§ 22 odst. 1),
 * - auto odbočující vlevo dává přednost tramvaji v obou směrech (§ 21 odst. 5), odbočující tramvaj
 *   má přednost před vozidlem jedoucím vedle ní (§ 21 odst. 7),
 * - odbočující vlevo dává přednost protijedoucím (§ 21 odst. 5),
 * - pravidlo pravé ruky (§ 22 odst. 2) – platí i pro tramvaj.
 *
 * Na zelenou platí jen pravidla odbočování (§ 70 odst. 2 písm. c); se zelenou šipkou vlevo
 * odbočující nedává přednost protijedoucím (písm. e); na doplňkovou šipku vpravo se jede
 * s předností vozidel ve volném směru (písm. g). Blikající žlutá = platí značky (písm. d).
 */
import { turnOf } from './geometry';
import type { Arm, Intersection, RoundaboutPlan, SignalPhase, Turn, Vehicle } from './types';

export type YieldReason =
  | 'main'
  | 'right'
  | 'oncoming'
  | 'tramSameDir'
  | 'ahead'
  | 'emergency'
  | 'pedestrian'
  | 'tramFirst'
  | 'ring'
  | 'ringRight'
  | 'red'
  | 'police'
  | 'arrowOnly'
  | 'arrow';

export interface Blocker {
  /** Null when the vehicle waits for a signal or the police officer, not for another road user. */
  other: Vehicle | null;
  reason: YieldReason;
}

const ccw = (from: number, to: number, n: number): number => (to - from + n) % n;
const isTram = (v: Vehicle): boolean => v.kind === 'tram';
const isPedestrian = (v: Vehicle): boolean => v.kind === 'pedestrian';

const entryPos = (v: Vehicle): number => 4 * v.from + (isTram(v) ? 2 : 3);
const exitPos = (v: Vehicle): number => 4 * v.to + (isTram(v) ? 1 : 0);

function strictlyBetween(p: number, a: number, b: number): boolean {
  const dp = ccw(a, p, 16);
  return dp > 0 && dp < ccw(a, b, 16);
}

export function pathsConflict(v: Vehicle, w: Vehicle): boolean {
  if (isPedestrian(v) || isPedestrian(w) || v.circulating || w.circulating) return false;
  const a = entryPos(v);
  const b = exitPos(v);
  const c = entryPos(w);
  const d = exitPos(w);
  if (a === c) return false;
  if (b === d) return true;
  return strictlyBetween(c, a, b) !== strictlyBetween(d, a, b);
}

/** Both wait in the same lane of the same arm. */
export function sameColumn(v: Vehicle, w: Vehicle): boolean {
  return (
    !isPedestrian(v) &&
    !isPedestrian(w) &&
    !v.circulating &&
    !w.circulating &&
    v.from === w.from &&
    isTram(v) === isTram(w)
  );
}

const crossesCrosswalk = (v: Vehicle, arm: Arm): boolean => !v.circulating && (v.from === arm || v.to === arm);

const hasMainRoad = (inter: Intersection): boolean => inter.mainArms.length === 2;
const onMain = (inter: Intersection, v: Vehicle): boolean => inter.mainArms.includes(v.from);

/** Turn relative to the course of the main road (a bent main road counts as "straight"). */
function virtualTurn(inter: Intersection, v: Vehicle): Turn {
  if (hasMainRoad(inter) && onMain(inter, v)) {
    const other = inter.mainArms.find((a) => a !== v.from) as Arm;
    if (v.to === other) return 'straight';
    // arms passed counter-clockwise from v.from to the other main arm lie on the right of the main road
    return ccw(v.from, v.to, 4) < ccw(v.from, other, 4) ? 'right' : 'left';
  }
  return turnOf(v.from, v.to);
}

function areOpposite(inter: Intersection, v: Vehicle, w: Vehicle): boolean {
  if (hasMainRoad(inter) && onMain(inter, v) && onMain(inter, w)) return true;
  return ccw(v.from, w.from, 4) === 2;
}

/** A car gives way to a tram from its own arm whose path it crosses. */
const sameArmReason = (v: Vehicle, w: Vehicle): YieldReason | null => (isTram(w) && !isTram(v) ? 'tramSameDir' : null);

/** Why `v` has to give way to `w` at a junction regulated by signs only (paths assumed to conflict). */
export function yieldReason(inter: Intersection, v: Vehicle, w: Vehicle): YieldReason | null {
  if (!pathsConflict(v, w)) return null;
  if (v.from === w.from) return sameArmReason(v, w);
  const vMain = onMain(inter, v);
  const wMain = onMain(inter, w);
  if (vMain !== wMain) return wMain ? 'main' : null;
  if (areOpposite(inter, v, w)) {
    return virtualTurn(inter, v) === 'left' && virtualTurn(inter, w) !== 'left' ? 'oncoming' : null;
  }
  return ccw(v.from, w.from, 4) === 1 ? 'right' : null;
}

/** Between vehicles with a go signal the signs do not apply, only the turning rules. */
function greenYieldReason(v: Vehicle, w: Vehicle): YieldReason | null {
  if (v.from === w.from) return sameArmReason(v, w);
  if (ccw(v.from, w.from, 4) === 2) {
    return turnOf(v.from, v.to) === 'left' && turnOf(w.from, w.to) !== 'left' ? 'oncoming' : null;
  }
  return ccw(v.from, w.from, 4) === 1 ? 'right' : null;
}

/** Vehicle on the roundabout passes the entry of `arm` before leaving. */
function passesEntry(circulating: Vehicle, arm: Arm): boolean {
  const k = ccw(circulating.from, arm, 4);
  const span = ccw(circulating.from, circulating.to, 4) || 4;
  return k >= 1 && k < span;
}

function ringReason(plan: RoundaboutPlan, v: Vehicle, w: Vehicle): YieldReason | null {
  if (isPedestrian(w) || v.circulating === w.circulating) return null;
  const circ = v.circulating ? v : w;
  const entering = v.circulating ? w : v;
  if (!passesEntry(circ, entering.from)) return null;
  if (plan.yieldOnEntry) return v === entering ? 'ring' : null;
  return v === circ ? 'ringRight' : null;
}

interface Control {
  kind: 'lights' | 'police';
  phases: SignalPhase[];
}

/** Police officer overrides the lights; flashing amber means no control. */
export function controlOf(inter: Intersection): Control | null {
  if (inter.police) return { kind: 'police', phases: inter.police.phases.map((arms) => ({ arms, leftOnly: false })) };
  if (inter.signals && !inter.signals.blinking) return { kind: 'lights', phases: inter.signals.phases };
  return null;
}

const permittedIn = (ph: SignalPhase, v: Vehicle): boolean =>
  ph.arms.includes(v.from) && (!ph.leftOnly || turnOf(v.from, v.to) === 'left');

/** Red ball is lit for the arm and a green supplementary right arrow allows this right turn. */
function onRightArrow(inter: Intersection, v: Vehicle, ph: SignalPhase): boolean {
  const redLit = !ph.arms.includes(v.from) || ph.leftOnly;
  return redLit && (inter.signals?.rightArrows.includes(v.from) ?? false) && turnOf(v.from, v.to) === 'right';
}

export function blockersOf(inter: Intersection, v: Vehicle, remaining: readonly Vehicle[], phase: number): Blocker[] {
  const others = remaining.filter((w) => w !== v);
  if (isPedestrian(v)) {
    return others.flatMap((w): Blocker[] => {
      if (w.beacons && crossesCrosswalk(w, v.to)) return [{ other: w, reason: 'emergency' }];
      if (isTram(w) && crossesCrosswalk(w, v.to)) return [{ other: w, reason: 'tramFirst' }];
      return [];
    });
  }
  const ahead = others.find((w) => sameColumn(v, w) && w.queue < v.queue);
  if (ahead) return [{ other: ahead, reason: 'ahead' }];
  if (v.beacons) return [];
  // only those whose path the emergency vehicle crosses have to let it go first
  const emergency = others.filter((w) => w.beacons && (inter.roundabout !== null || pathsConflict(v, w)));
  if (emergency.length) return emergency.map((w) => ({ other: w, reason: 'emergency' }));

  const result: Blocker[] = [];
  if (!isTram(v)) {
    for (const p of others)
      if (isPedestrian(p) && crossesCrosswalk(v, p.to)) result.push({ other: p, reason: 'pedestrian' });
  }

  if (inter.roundabout) {
    const plan = inter.roundabout;
    for (const w of others) {
      const reason = ringReason(plan, v, w);
      if (reason) result.push({ other: w, reason });
    }
    return result;
  }

  const control = controlOf(inter);
  if (!control) {
    for (const w of others) {
      const reason = isPedestrian(w) ? null : yieldReason(inter, v, w);
      if (reason) result.push({ other: w, reason });
    }
    return result;
  }

  const ph = control.phases[phase];
  const arrow = control.kind === 'lights' && onRightArrow(inter, v, ph);
  if (!arrow) {
    if (!ph.arms.includes(v.from))
      return [...result, { other: null, reason: control.kind === 'police' ? 'police' : 'red' }];
    if (ph.leftOnly && turnOf(v.from, v.to) !== 'left') return [...result, { other: null, reason: 'arrowOnly' }];
  }
  for (const w of others) {
    if (isPedestrian(w) || !pathsConflict(v, w) || !permittedIn(ph, w)) continue;
    const reason = arrow ? 'arrow' : ph.leftOnly ? null : greenYieldReason(v, w);
    if (reason) result.push({ other: w, reason });
  }
  return result;
}

/** Keeps `phase` while a first-in-column vehicle may still go, otherwise switches to the next phase with traffic. */
export function settlePhase(inter: Intersection, remaining: readonly Vehicle[], phase: number): number {
  const control = controlOf(inter);
  if (!control) return phase;
  const fronts = remaining.filter(
    (v) => !isPedestrian(v) && !remaining.some((w) => sameColumn(v, w) && w.queue < v.queue),
  );
  const count = control.phases.length;
  for (let k = 0; k < count; k++) {
    const p = (phase + k) % count;
    if (fronts.some((v) => permittedIn(control.phases[p], v))) return p;
  }
  return phase;
}

/** Road users that may go now. */
export function freeVehicles(inter: Intersection, remaining: readonly Vehicle[], phase: number): Vehicle[] {
  return remaining.filter((v) => blockersOf(inter, v, remaining, phase).length === 0);
}

/** Every conflicting pair must have exactly one vehicle that gives way. */
export function allConflictsDecided(inter: Intersection, vehicles: readonly Vehicle[]): boolean {
  // controlled phases pair only opposite arms (left-turn rule); the roundabout rule is one-sided
  if (controlOf(inter) || inter.roundabout) return true;
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const v = vehicles[i];
      const w = vehicles[j];
      if (!pathsConflict(v, w)) continue;
      if ((yieldReason(inter, v, w) !== null) === (yieldReason(inter, w, v) !== null)) return false;
    }
  }
  return true;
}

/** False for a deadlock (e.g. four cars going straight at an equal intersection). */
export function isSolvable(inter: Intersection, vehicles: readonly Vehicle[], phase: number): boolean {
  return solutionSteps(inter, vehicles, phase) !== null;
}

/** Groups of road users that go at the same time, or null for a deadlock. */
export function solutionSteps(inter: Intersection, vehicles: readonly Vehicle[], phase: number): Vehicle[][] | null {
  let remaining = [...vehicles];
  let current = phase;
  const steps: Vehicle[][] = [];
  while (remaining.length) {
    current = settlePhase(inter, remaining, current);
    const free = freeVehicles(inter, remaining, current);
    if (!free.length) return null;
    steps.push(free);
    remaining = remaining.filter((v) => !free.includes(v));
  }
  return steps;
}

export function hasAnyYield(inter: Intersection, vehicles: readonly Vehicle[], phase: number): boolean {
  return vehicles.some((v) => blockersOf(inter, v, vehicles, phase).length > 0);
}
