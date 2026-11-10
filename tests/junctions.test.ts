import { describe, expect, it } from 'vitest';
import { generateScenarioFor, type FixedJunction } from '../src/generator';
import { findJunctions } from '../src/route/junctions';
import type { OsmData, OsmNode, Tags } from '../src/route/osm';
import { createRoute, type LonLat } from '../src/route/route';
import { isSolvable } from '../src/rules';
import type { Intersection } from '../src/types';

// metres east (x) and north (y) of a point in Brno
const KX = 111_320 * Math.cos((49.2 * Math.PI) / 180);
const KY = 110_574;
const at = (x: number, y: number): LonLat => [16.6 + x / KX, 49.2 + y / KY];

function osm(nodes: Record<number, [number, number, Tags?]>, ways: [number[], Tags][]): OsmData {
  const map = new Map<number, OsmNode>();
  for (const [id, [x, y, tags]] of Object.entries(nodes)) {
    const [lon, lat] = at(x, y);
    map.set(Number(id), { id: Number(id), lon, lat, tags });
  }
  return { nodes: map, ways: ways.map(([ids, tags], i) => ({ id: 100 + i, nodes: ids, tags })) };
}

/** Cross of a secondary road (south–north) and a residential street (west–east). */
const CROSS_NODES: Record<number, [number, number, Tags?]> = {
  1: [0, 0],
  2: [0, -50],
  3: [0, -100],
  4: [0, 50],
  5: [0, 100],
  6: [50, 0],
  7: [100, 0],
  8: [-50, 0],
  9: [-100, 0],
};
const crossWays = (east: Tags = {}, west: Tags = {}): [number[], Tags][] => [
  [[3, 2, 1, 4, 5], { highway: 'secondary', name: 'Hlavní' }],
  [[7, 6, 1], { highway: 'residential', name: 'Východní', ...east }],
  [[1, 8, 9], { highway: 'residential', name: 'Západní', ...west }],
];

const route = (...points: [number, number][]) => createRoute(points.map(([x, y]) => at(x, y)));

describe('křižovatky na trase', () => {
  it('najde křižovatku a směr jízdy rovně', () => {
    const [junction, ...rest] = findJunctions(route([0, -100], [0, 100]), osm(CROSS_NODES, crossWays()));
    expect(rest).toHaveLength(0);
    expect(junction.fixed.intersection.arms).toEqual([0, 1, 2, 3]);
    expect(junction.fixed.playerTo).toBe(2);
    expect(Math.abs(junction.at - 85)).toBeLessThan(2);
    expect(junction.label).toBe('Hlavní × Východní × Západní');
  });

  it('odbočení vpravo a vlevo', () => {
    const data = osm(CROSS_NODES, crossWays());
    expect(findJunctions(route([0, -100], [0, 0], [100, 0]), data)[0].fixed.playerTo).toBe(1);
    expect(findJunctions(route([0, -100], [0, 0], [-100, 0]), data)[0].fixed.playerTo).toBe(3);
  });

  it('ramena se natočí podle směru příjezdu', () => {
    // from the east, turning south = left
    const [junction] = findJunctions(route([100, 0], [0, 0], [0, -100]), osm(CROSS_NODES, crossWays()));
    expect(junction.fixed.playerTo).toBe(3);
    // the main road (south–north) is now left–right
    expect([...junction.fixed.intersection.mainArms].sort()).toEqual([1, 3]);
  });

  it('hlavní silnice podle značek, jinak odhad podle třídy', () => {
    const estimated = findJunctions(route([0, -100], [0, 100]), osm(CROSS_NODES, crossWays()))[0];
    expect([...estimated.fixed.intersection.mainArms].sort()).toEqual([0, 2]);
    expect(estimated.estimated).toBe(true);

    const nodes: Record<number, [number, number, Tags?]> = {
      ...CROSS_NODES,
      6: [25, 0, { highway: 'stop' }],
      8: [-25, 0, { highway: 'give_way' }],
    };
    const signed = findJunctions(route([0, -100], [0, 100]), osm(nodes, crossWays()))[0];
    expect([...signed.fixed.intersection.mainArms].sort()).toEqual([0, 2]);
    expect(signed.fixed.intersection.yieldSign).toBe('stop');
    expect(signed.estimated).toBe(false);
  });

  it('semafory a jednosměrky', () => {
    const nodes: Record<number, [number, number, Tags?]> = {
      ...CROSS_NODES,
      1: [0, 0, { highway: 'traffic_signals' }],
    };
    const [junction] = findJunctions(
      route([0, -100], [0, 100]),
      osm(nodes, crossWays({ oneway: 'yes' }, { oneway: 'yes' })),
    );
    expect(junction.fixed.hasSignals).toBe(true);
    // east flows into the junction, west out of it
    expect(junction.fixed.noExit).toEqual([1]);
    expect(junction.fixed.noEntry).toEqual([3]);
  });

  it('křižovatka T a dva průjezdy stejnou křižovatkou', () => {
    const ways: [number[], Tags][] = [
      [[3, 2, 1], { highway: 'residential' }],
      [[7, 6, 1, 8, 9], { highway: 'residential' }],
    ];
    const junctions = findJunctions(route([0, -100], [0, 0], [100, 0], [0, 0], [0, -100]), osm(CROSS_NODES, ways));
    expect(junctions.map((j) => j.id)).toEqual([1, 1]);
    expect(junctions[0].fixed.intersection.arms).toEqual([0, 1, 3]);
    expect(junctions[0].fixed.playerTo).toBe(1);
    // back from the east, turning left to the south
    expect(junctions[1].fixed.playerTo).toBe(3);
  });

  it('kruhový objezd', () => {
    const nodes: Record<number, [number, number, Tags?]> = {
      1: [0, -20],
      2: [20, 0],
      3: [0, 20],
      4: [-20, 0],
      5: [0, -100],
      6: [100, 0],
      7: [0, 100],
      8: [-100, 0],
    };
    const ways: [number[], Tags][] = [
      [[1, 2, 3, 4, 1], { highway: 'tertiary', junction: 'roundabout' }],
      [[5, 1], { highway: 'tertiary' }],
      [[6, 2], { highway: 'tertiary' }],
      [[7, 3], { highway: 'tertiary' }],
      [[8, 4], { highway: 'tertiary' }],
    ];
    const junctions = findJunctions(route([0, -100], [0, -20], [20, 0], [0, 20], [0, 100]), osm(nodes, ways));
    expect(junctions).toHaveLength(1);
    expect(junctions[0].fixed.intersection.roundabout).not.toBeNull();
    expect(junctions[0].fixed.playerTo).toBe(2);
  });

  it('ignoruje křižovatku mimo trasu', () => {
    expect(findJunctions(route([30, -100], [30, 100]), osm(CROSS_NODES, crossWays()))).toHaveLength(0);
  });
});

describe('situace na skutečné křižovatce', () => {
  const intersection: Intersection = {
    arms: [0, 1, 2, 3],
    mainArms: [],
    yieldSign: 'giveWay',
    tramLine: null,
    signals: null,
    police: null,
    roundabout: null,
    crosswalks: [],
    label: 'Test',
  };
  const fixed: FixedJunction = { intersection, hasSignals: false, playerTo: 1, noEntry: [3], noExit: [] };

  it('náš směr je pevný, ostatní provoz náhodný a řešitelný', () => {
    const scenarios = Array.from({ length: 30 }, (_, seed) => generateScenarioFor(fixed, seed + 1));
    for (const s of scenarios) {
      expect(s.intersection.arms).toEqual([0, 1, 2, 3]);
      expect(s.vehicles.find((v) => v.isPlayer)?.to).toBe(1);
      expect(s.vehicles.some((v) => v.from === 3)).toBe(false);
      expect(isSolvable(s.intersection, s.vehicles, s.startPhase)).toBe(true);
    }
    expect(new Set(scenarios.map((s) => JSON.stringify(s.vehicles))).size).toBeGreaterThan(10);
  });

  it('semafory se losují při každém průjezdu', () => {
    const s = generateScenarioFor({ ...fixed, hasSignals: true }, 7);
    expect(s.intersection.signals).not.toBeNull();
    expect(fixed.intersection.signals).toBeNull();
  });
});
