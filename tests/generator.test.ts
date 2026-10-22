import { describe, expect, it } from 'vitest';
import { TYPES, buildTestSequence, generateScenario, practiceItem } from '../src/generator';
import { allConflictsDecided, isSolvable } from '../src/rules';

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

  it('každý typ jde vygenerovat', () => {
    for (const type of TYPES) {
      for (let seed = 1; seed <= 20; seed++) {
        expect(() => generateScenario(practiceItem(seed * 7919, type))).not.toThrow();
      }
    }
  });
});
