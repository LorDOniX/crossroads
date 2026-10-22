/**
 * Pravidla přednosti v jízdě (zákon č. 361/2000 Sb., § 21 a § 22).
 *
 * Každé rameno má na obvodu křižovatky dva body (výjezd, vjezd) seřazené proti směru
 * hodinových ručiček; dráhy dvou vozidel se kříží, když se jejich tětivy protínají,
 * nebo když míří do stejného výjezdu. Mezi konfliktními vozidly rozhoduje:
 * 1. hlavní × vedlejší pozemní komunikace (§ 22 odst. 1),
 * 2. odbočování vlevo vůči protijedoucím včetně tramvají (§ 21 odst. 5),
 * 3. pravidlo pravé ruky (§ 22 odst. 2) – platí i pro tramvaj.
 */
import { turnOf } from './geometry';
import type { Arm, Intersection, Turn, Vehicle } from './types';

export type YieldReason = 'main' | 'right' | 'oncoming';

export interface Blocker {
  other: Vehicle;
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

export function blockersOf(inter: Intersection, v: Vehicle, remaining: readonly Vehicle[]): Blocker[] {
  const result: Blocker[] = [];
  for (const w of remaining) {
    if (w === v) continue;
    const reason = yieldReason(inter, v, w);
    if (reason) result.push({ other: w, reason });
  }
  return result;
}

/** Vehicles that may enter the junction now. */
export function freeVehicles(inter: Intersection, remaining: readonly Vehicle[]): Vehicle[] {
  return remaining.filter((v) => blockersOf(inter, v, remaining).length === 0);
}

/** Every conflicting pair must have exactly one vehicle that gives way. */
export function allConflictsDecided(inter: Intersection, vehicles: readonly Vehicle[]): boolean {
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
export function isSolvable(inter: Intersection, vehicles: readonly Vehicle[]): boolean {
  let remaining = [...vehicles];
  while (remaining.length) {
    const free = freeVehicles(inter, remaining);
    if (!free.length) return false;
    remaining = remaining.filter((v) => !free.includes(v));
  }
  return true;
}

export function hasAnyYield(inter: Intersection, vehicles: readonly Vehicle[]): boolean {
  return vehicles.some((v) => blockersOf(inter, v, vehicles).length > 0);
}
