import { describe, expect, it } from 'vitest';
import { decodeMirek } from '../src/route/mirek';
import { createRoute, type LonLat } from '../src/route/route';

// "9fqfruRRRR" = absolute point [14, 15]; "-g" = lon delta +1000 units, "N0" = zero delta
const MIREK = '9fqfruRRRR-gN0';
// PROCHAZKA_CENTRUM_UNOR from makuderovi/src/tracks/2026.ts – walk through Brno centre, contains zero deltas
const BRNO =
  '9mMiWxT9l3LhKN63LvM4KpM4KiMDKyM-L8MZJIMpJXNFJXNaJBN0N0N0N0IkLgNKLMNhIL6CGZNQ4FMjJRMoMtNLNHKIfe6MjLaMvMPMiJYMpJPIOIvMpNqKUXlJLgO9LcTyMuNbJLg68OWNjM36vNWLERzOJ8DOnNrNFNgMnNQM3NQM3QP68M-PzMuPdNKPdNbPrNa6gNxOCNsORNsOKLW6ENs65';

describe('Mirek', () => {
  it('dekóduje absolutní bod i delty', () => {
    const [a, b] = decodeMirek(MIREK);
    expect(a[0]).toBeCloseTo(14, 5);
    expect(a[1]).toBeCloseTo(15, 5);
    expect(b[0] - a[0]).toBeCloseTo((1000 * 360) / 2 ** 28, 12);
    expect(b[1]).toBe(a[1]);
  });

  it('neúplný řetězec je chyba', () => {
    expect(() => decodeMirek('9fqfruRRR')).toThrow();
  });
});

describe('trasa', () => {
  it('z Mirka i z pole bodů dá stejnou trasu', () => {
    const fromMirek = createRoute(MIREK);
    expect(createRoute(fromMirek.points)).toEqual(fromMirek);
    expect(fromMirek.length).toBeCloseTo(144.04, 1);
    expect(fromMirek.distances).toEqual([0, fromMirek.length]);
  });

  it('skutečná trasa v centru Brna', () => {
    const route = createRoute(BRNO);
    expect(route.points[0][0]).toBeCloseTo(16.6096, 3);
    expect(route.points[0][1]).toBeCloseTo(49.1988, 3);
    expect(route.points.length).toBeLessThan(decodeMirek(BRNO).length);
    for (const [lon, lat] of route.points) {
      expect(lon).toBeGreaterThan(16.55);
      expect(lon).toBeLessThan(16.65);
      expect(lat).toBeGreaterThan(49.17);
      expect(lat).toBeLessThan(49.23);
    }
    expect(route.distances.every((d, i) => i === 0 || d > route.distances[i - 1])).toBe(true);
    expect(route.length).toBeGreaterThan(500);
    expect(route.length).toBeLessThan(15_000);
  });

  it('vynechá opakované body', () => {
    const route = createRoute([
      [14, 50],
      [14, 50],
      [14.001, 50],
    ]);
    expect(route.points).toHaveLength(2);
  });

  it('odmítne neplatnou trasu', () => {
    const outOfRange: LonLat[] = [
      [14, 50],
      [200, 50],
    ];
    expect(() => createRoute([[14, 50]])).toThrow();
    expect(() => createRoute(outOfRange)).toThrow();
  });
});
