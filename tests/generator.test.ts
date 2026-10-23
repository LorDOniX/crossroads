import { describe, expect, it } from 'vitest';
import { TYPES, buildTestSequence, generateScenario, practiceItem } from '../src/generator';
import { ringPassesThrough } from '../src/geometry';
import { allConflictsDecided, freeVehicles, isSolvable, pathsConflict, solutionSteps } from '../src/rules';

describe('generátor', () => {
  it('stejný kód testu dá stejné křižovatky', () => {
    const a = buildTestSequence(123456, 30).map(generateScenario);
    const b = buildTestSequence(123456, 30).map(generateScenario);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('test pokryje všechny typy křižovatek', () => {
    const types = new Set(buildTestSequence(42, 30).map((item) => item.type));
    expect(types.size).toBe(TYPES.length);
  });

  it('každá vygenerovaná křižovatka je řešitelná a jednoznačná', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const scenario = generateScenario(practiceItem(seed, null));
      const { intersection, vehicles, startPhase } = scenario;
      expect(vehicles.filter((v) => v.isPlayer)).toHaveLength(1);
      expect(allConflictsDecided(intersection, vehicles)).toBe(true);
      expect(isSolvable(intersection, vehicles, startPhase)).toBe(true);
      expect(scenario.difficulty).toBeGreaterThanOrEqual(1);
      expect(scenario.difficulty).toBeLessThanOrEqual(3);
    }
  });

  it('vozidla, která jedou současně, se navzájem nekříží', () => {
    for (const type of TYPES) {
      for (let seed = 1; seed <= 60; seed++) {
        const { intersection, vehicles, startPhase } = generateScenario(practiceItem(seed * 104729, type));
        const steps = solutionSteps(intersection, vehicles, startPhase);
        expect(steps).not.toBeNull();
        if (intersection.roundabout) {
          const stepOf = (v: (typeof vehicles)[number]): number => (steps ?? []).findIndex((g) => g.includes(v));
          for (const v of vehicles)
            for (const w of vehicles)
              if (stepOf(v) < stepOf(w)) expect(ringPassesThrough(v, w), `${seed} ${v.id} ${w.id}`).toBe(false);
          continue;
        }
        for (const step of steps ?? []) {
          const drivers = step.filter((v) => v.kind !== 'pedestrian');
          for (const v of drivers)
            for (const w of drivers)
              if (v !== w) expect(pathsConflict(v, w), `${type} ${seed} ${v.id} ${w.id}`).toBe(false);
        }
      }
    }
  });

  it('sanitka pustí současně ty, jejichž dráhu nekříží (seed 821443)', () => {
    const scenarios = buildTestSequence(821443, 30).map(generateScenario);
    const found = scenarios.filter(
      (s) => s.vehicles.some((v) => v.beacons) && s.vehicles.some((v) => v.kind === 'tram'),
    );
    expect(found.length).toBeGreaterThan(0);
    let together = 0;
    for (const { intersection, vehicles, startPhase } of found) {
      const ambulance = vehicles.find((v) => v.beacons);
      const tram = vehicles.find((v) => v.kind === 'tram');
      if (!ambulance || !tram || pathsConflict(ambulance, tram)) continue;
      const first = solutionSteps(intersection, vehicles, startPhase)?.[0] ?? [];
      const others = vehicles.filter((v) => v !== ambulance);
      expect(first).toContain(ambulance);
      expect(first.includes(tram)).toBe(freeVehicles(intersection, others, startPhase).includes(tram));
      if (first.includes(tram)) together++;
    }
    expect(together).toBeGreaterThan(0);
  });

  it('každý typ jde vygenerovat', () => {
    for (const type of TYPES) {
      for (let seed = 1; seed <= 20; seed++) {
        expect(() => generateScenario(practiceItem(seed * 7919, type))).not.toThrow();
      }
    }
  });
});
