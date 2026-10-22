/**
 * Pravidla přednosti v jízdě (zákon č. 361/2000 Sb., § 21 a § 22).
 *
 * Každé rameno má na obvodu křižovatky dva body (výjezd, vjezd) seřazené proti směru
 * hodinových ručiček; dráhy dvou vozidel se kříží, když se jejich tětivy protínají,
 * nebo když míří do stejného výjezdu. Mezi konfliktními vozidly rozhoduje:
 * 1. hlavní × vedlejší pozemní komunikace (§ 22 odst. 1),
 * 2. odbočování vlevo vůči protijedoucím včetně tramvají (§ 21 odst. 5),
 * 3. pravidlo pravé ruky (§ 22 odst. 2) – platí i pro tramvaj.
 *
 * Na křižovatce řízené semafory mají světla přednost před značkami (§ 76 odst. 6): jet smí jen
 * vozidla se zelenou (při odbočování vlevo dávají přednost protijedoucím, § 70 odst. 2 písm. c),
 * na doplňkovou šipku vpravo i při červené, ale s předností vozidel ve volném směru (písm. g).
 * Blikající žlutá znamená neřízenou křižovatku – platí značky (písm. d).
 */
import { turnOf } from './geometry';
import type { Arm, Intersection, Turn, Vehicle } from './types';

export type YieldReason = 'main' | 'right' | 'oncoming' | 'red' | 'arrow';

export interface Blocker {
  /** Null when the vehicle waits for the signal, not for another vehicle. */
  other: Vehicle | null;
  reason: YieldReason;
}

const ccw = (from: number, to: number, n: number): number => (to - from + n) % n;
const inPos = (a: Arm): number => 2 * a + 1;
const outPos = (a: Arm): number => 2 * a;

function strictlyBetween(p: number, a: number, b: number): boolean {
  const dp = ccw(a, p, 8);
  return dp > 0 && dp < ccw(a, b, 8);
}

export function pathsConflict(v: Vehicle, w: Vehicle): boolean {
  if (v.to === w.to) return true;
  const a = inPos(v.from);
  const b = outPos(v.to);
  return strictlyBetween(inPos(w.from), a, b) !== strictlyBetween(outPos(w.to), a, b);
}

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

/** Why `v` has to give way to `w`, or null when it does not. */
export function yieldReason(inter: Intersection, v: Vehicle, w: Vehicle): YieldReason | null {
  if (!pathsConflict(v, w)) return null;
  const vMain = onMain(inter, v);
  const wMain = onMain(inter, w);
  if (vMain !== wMain) return wMain ? 'main' : null;
  if (areOpposite(inter, v, w)) {
    return virtualTurn(inter, v) === 'left' && virtualTurn(inter, w) !== 'left' ? 'oncoming' : null;
  }
  return ccw(v.from, w.from, 4) === 1 ? 'right' : null;
}

export function blockersOf(
  inter: Intersection,
  v: Vehicle,
  remaining: readonly Vehicle[],
  phase: number,
): Blocker[] {
  const active = signalsActive(inter);
  const arrow = active && onRightArrow(inter, v, phase);
  if (active && !arrow && !hasGreen(inter, v.from, phase)) return [{ other: null, reason: 'red' }];
  const result: Blocker[] = [];
  for (const w of remaining) {
    if (w === v || !pathsConflict(v, w)) continue;
    let reason: YieldReason | null;
    if (!active) reason = yieldReason(inter, v, w);
    else if (arrow) reason = hasGreen(inter, w.from, phase) ? 'arrow' : null;
    else reason = hasGreen(inter, w.from, phase) ? greenYieldReason(v, w) : null;
    if (reason) result.push({ other: w, reason });
  }
  return result;
}

const signalsActive = (inter: Intersection): boolean => inter.signals !== null && !inter.signals.blinking;

export const hasGreen = (inter: Intersection, arm: Arm, phase: number): boolean =>
  inter.signals?.phases[phase].includes(arm) ?? false;

function onRightArrow(inter: Intersection, v: Vehicle, phase: number): boolean {
  return (
    !hasGreen(inter, v.from, phase) &&
    (inter.signals?.rightArrows.includes(v.from) ?? false) &&
    turnOf(v.from, v.to) === 'right'
  );
}

/** Between vehicles on green the signs do not apply, only the turning rules. */
function greenYieldReason(v: Vehicle, w: Vehicle): YieldReason | null {
  if (ccw(v.from, w.from, 4) === 2) {
    return turnOf(v.from, v.to) === 'left' && turnOf(w.from, w.to) !== 'left' ? 'oncoming' : null;
  }
  return ccw(v.from, w.from, 4) === 1 ? 'right' : null;
}

/** Keeps `phase` while someone on green still waits, otherwise switches to the next phase with traffic. */
export function settlePhase(inter: Intersection, remaining: readonly Vehicle[], phase: number): number {
  if (!signalsActive(inter) || !inter.signals) return phase;
  const count = inter.signals.phases.length;
  for (let k = 0; k < count; k++) {
    const p = (phase + k) % count;
    if (remaining.some((v) => hasGreen(inter, v.from, p))) return p;
  }
  return phase;
}

/** Vehicles that may enter the junction now. */
export function freeVehicles(inter: Intersection, remaining: readonly Vehicle[], phase: number): Vehicle[] {
  return remaining.filter((v) => blockersOf(inter, v, remaining, phase).length === 0);
}

/** Every conflicting pair must have exactly one vehicle that gives way. */
export function allConflictsDecided(inter: Intersection, vehicles: readonly Vehicle[]): boolean {
  // green phases pair only opposite arms, which the left-turn rule always decides
  if (signalsActive(inter)) return true;
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
  let remaining = [...vehicles];
  let current = phase;
  while (remaining.length) {
    current = settlePhase(inter, remaining, current);
    const free = freeVehicles(inter, remaining, current);
    if (!free.length) return false;
    remaining = remaining.filter((v) => !free.includes(v));
  }
  return true;
}

export function hasAnyYield(inter: Intersection, vehicles: readonly Vehicle[], phase: number): boolean {
  return vehicles.some((v) => blockersOf(inter, v, vehicles, phase).length > 0);
}
