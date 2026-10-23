import { describe, expect, it } from 'vitest';
import { blockersOf, freeVehicles, isSolvable, settlePhase } from '../src/rules';
import type { Arm, Intersection, Vehicle } from '../src/types';

const ALL: Arm[] = [0, 1, 2, 3];

function junction(overrides: Partial<Intersection> = {}): Intersection {
  return {
    arms: ALL,
    mainArms: [],
    yieldSign: 'giveWay',
    tramLine: null,
    signals: null,
    police: null,
    roundabout: null,
    crosswalks: [],
    label: 'test',
    ...overrides,
  };
}

function road(id: string, from: Arm, to: Arm, extra: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    kind: 'car',
    color: '#000',
    name: id,
    from,
    to,
    isPlayer: false,
    queue: 0,
    beacons: false,
    circulating: false,
    walkDir: 1,
    ...extra,
  };
}

const reasons = (inter: Intersection, v: Vehicle, all: Vehicle[], phase = 0): string[] =>
  blockersOf(inter, v, all, phase).map((b) => `${b.reason}:${b.other?.id ?? '-'}`);

// arms: 0 = south, 1 = east, 2 = north, 3 = west; from south: 1 = right, 2 = straight, 3 = left
describe('rovnocenná křižovatka', () => {
  it('pravidlo pravé ruky', () => {
    const s = road('s', 0, 2);
    const e = road('e', 1, 3);
    expect(reasons(junction(), s, [s, e])).toEqual(['right:e']);
    expect(reasons(junction(), e, [s, e])).toEqual([]);
  });

  it('odbočující vlevo dává přednost protijedoucímu', () => {
    const s = road('s', 0, 3);
    const n = road('n', 2, 0);
    expect(reasons(junction(), s, [s, n])).toEqual(['oncoming:n']);
    expect(reasons(junction(), n, [s, n])).toEqual([]);
  });

  it('protijedoucí odbočující vlevo se nekříží', () => {
    const s = road('s', 0, 3);
    const n = road('n', 2, 1);
    expect(freeVehicles(junction(), [s, n], 0)).toHaveLength(2);
  });

  it('čtyři auta rovně = zablokovaná křižovatka', () => {
    const cars = ALL.map((a) => road(`c${a}`, a, ((a + 2) % 4) as Arm));
    expect(isSolvable(junction(), cars, 0)).toBe(false);
  });
});

describe('hlavní a vedlejší silnice', () => {
  it('vedlejší dává přednost hlavní', () => {
    const inter = junction({ mainArms: [0, 2] });
    const e = road('e', 1, 3);
    const n = road('n', 2, 0);
    expect(reasons(inter, e, [e, n])).toEqual(['main:n']);
  });

  it('lomená hlavní: kdo z ní odbočuje vlevo, dává přednost protijedoucímu po hlavní', () => {
    const inter = junction({ mainArms: [0, 1] });
    const s = road('s', 0, 2);
    const e = road('e', 1, 0);
    expect(reasons(inter, s, [s, e])).toEqual(['oncoming:e']);
  });

  it('lomená hlavní: mezi vedlejšími platí pravá ruka', () => {
    const inter = junction({ mainArms: [0, 1] });
    const n = road('n', 2, 0);
    const w = road('w', 3, 1);
    expect(reasons(inter, n, [n, w])).toEqual(['right:w']);
  });
});

describe('tramvaj, kolona, sanitka, chodci', () => {
  it('auto odbočující vlevo dává přednost tramvaji ve stejném směru', () => {
    const car = road('car', 0, 3);
    const tram = road('tram', 0, 2, { kind: 'tram' });
    expect(reasons(junction(), car, [car, tram])).toEqual(['tramSameDir:tram']);
    expect(reasons(junction(), tram, [car, tram])).toEqual([]);
  });

  it('odbočující tramvaj má přednost před autem jedoucím vedle ní', () => {
    const car = road('car', 0, 2);
    const tram = road('tram', 0, 1, { kind: 'tram' });
    expect(reasons(junction(), car, [car, tram])).toEqual(['tramSameDir:tram']);
  });

  it('auto v koloně čeká na auto před sebou', () => {
    const front = road('front', 0, 2);
    const rear = road('rear', 0, 1, { queue: 1 });
    expect(reasons(junction(), rear, [front, rear])).toEqual(['ahead:front']);
  });

  it('vozidlu s majákem dávají přednost ti, jejichž dráhu kříží, bez majáku je to běžné auto', () => {
    const inter = junction({ mainArms: [0, 2] });
    const ambulance = road('amb', 1, 3, { kind: 'ambulance', beacons: true });
    const car = road('car', 0, 2);
    expect(reasons(inter, car, [car, ambulance])).toEqual(['emergency:amb']);
    expect(freeVehicles(inter, [car, ambulance], 0)).toEqual([ambulance]);
    const silent = { ...ambulance, beacons: false };
    expect(reasons(inter, silent, [car, silent])).toEqual(['main:car']);
    const turning = road('right', 0, 1);
    expect(freeVehicles(inter, [turning, ambulance], 0)).toEqual([turning, ambulance]);
  });

  it('chodec na přechodu má přednost, sám ji dává tramvaji', () => {
    const inter = junction({ crosswalks: [1] });
    const pedestrian = road('ped', 0, 1, { kind: 'pedestrian' });
    const car = road('car', 0, 1);
    const tram = road('tram', 3, 1, { kind: 'tram' });
    expect(reasons(inter, car, [car, pedestrian])).toEqual(['pedestrian:ped']);
    expect(reasons(inter, pedestrian, [pedestrian, tram])).toEqual(['tramFirst:tram']);
  });
});

describe('semafory a policista', () => {
  const lights = (phases: Intersection['signals']) => junction({ signals: phases });

  it('na červenou se nejede, na zelenou odbočující vlevo dává přednost protijedoucímu', () => {
    const inter = lights({
      blinking: false,
      phases: [
        { arms: [0, 2], leftOnly: false },
        { arms: [1, 3], leftOnly: false },
      ],
      rightArrows: [],
    });
    const s = road('s', 0, 3);
    const n = road('n', 2, 0);
    const e = road('e', 1, 3);
    expect(reasons(inter, e, [s, n, e])).toEqual(['red:-']);
    expect(reasons(inter, s, [s, n, e])).toEqual(['oncoming:n']);
  });

  it('značky neplatí, když svítí semafor', () => {
    const inter = junction({
      mainArms: [1, 3],
      signals: {
        blinking: false,
        phases: [
          { arms: [0, 2], leftOnly: false },
          { arms: [1, 3], leftOnly: false },
        ],
        rightArrows: [],
      },
    });
    const s = road('s', 0, 2);
    const e = road('e', 1, 3);
    expect(freeVehicles(inter, [s, e], 0)).toEqual([s]);
  });

  it('doplňková šipka: vpravo i na červenou, ale s předností vozidel na zelenou', () => {
    const inter = lights({
      blinking: false,
      phases: [
        { arms: [0, 2], leftOnly: false },
        { arms: [1, 3], leftOnly: false },
      ],
      rightArrows: [1],
    });
    const e = road('e', 1, 2);
    const s = road('s', 0, 2);
    expect(reasons(inter, e, [e, s])).toEqual(['arrow:s']);
    expect(reasons(inter, e, [e], 0)).toEqual([]);
  });

  it('zelená šipka vlevo: odbočující vlevo jede bez čekání, rovně se nejede', () => {
    const inter = lights({
      blinking: false,
      phases: [
        { arms: [0, 2], leftOnly: true },
        { arms: [0, 2], leftOnly: false },
        { arms: [1, 3], leftOnly: false },
      ],
      rightArrows: [],
    });
    const s = road('s', 0, 3);
    const n = road('n', 2, 0);
    expect(reasons(inter, s, [s, n], 0)).toEqual([]);
    expect(reasons(inter, n, [s, n], 0)).toEqual(['arrowOnly:-']);
    expect(settlePhase(inter, [n], 0)).toBe(1);
  });

  it('blikající žlutá: platí značky', () => {
    const inter = junction({
      mainArms: [1, 3],
      signals: { blinking: true, phases: [{ arms: [0, 2], leftOnly: false }], rightArrows: [] },
    });
    const s = road('s', 0, 2);
    const e = road('e', 1, 3);
    expect(reasons(inter, s, [s, e])).toEqual(['main:e']);
  });

  it('policista má přednost před značkami', () => {
    const inter = junction({
      mainArms: [1, 3],
      police: {
        phases: [
          [0, 2],
          [1, 3],
        ],
      },
    });
    const s = road('s', 0, 2);
    const e = road('e', 1, 3);
    expect(reasons(inter, e, [s, e])).toEqual(['police:-']);
    expect(freeVehicles(inter, [s, e], 0)).toEqual([s]);
    expect(settlePhase(inter, [e], 0)).toBe(1);
  });
});

describe('kruhový objezd', () => {
  it('se značkou Dej přednost mají přednost vozidla na kruhu', () => {
    const inter = junction({ roundabout: { yieldOnEntry: true } });
    const entering = road('in', 1, 3);
    const ring = road('ring', 0, 2, { circulating: true });
    expect(reasons(inter, entering, [entering, ring])).toEqual(['ring:ring']);
  });

  it('vozidlo, které před vjezdem vyjede, nepřekáží', () => {
    const inter = junction({ roundabout: { yieldOnEntry: true } });
    const entering = road('in', 2, 0);
    const ring = road('ring', 0, 1, { circulating: true });
    expect(reasons(inter, entering, [entering, ring])).toEqual([]);
  });

  it('bez značky Dej přednost platí pravá ruka – přednost mají vjíždějící', () => {
    const inter = junction({ roundabout: { yieldOnEntry: false } });
    const entering = road('in', 1, 3);
    const ring = road('ring', 0, 2, { circulating: true });
    expect(reasons(inter, ring, [entering, ring])).toEqual(['ringRight:in']);
    expect(reasons(inter, entering, [entering, ring])).toEqual([]);
  });
});
