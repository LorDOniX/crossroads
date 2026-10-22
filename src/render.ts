import {
  ARM_DIR,
  CENTER,
  CORNER_R,
  HALF_ROAD,
  STOP_DIST,
  VIEW,
  approachAngle,
  armPoint,
  buildPath,
  pointAt,
  turnOf,
  type PathPoint,
  type Vec,
  type VehiclePath,
} from './geometry';
import { VEHICLE_SIZE, drawVehicle, svgEl, type Attrs } from './sprites';
import type { Arm, Intersection, Scenario, Vehicle } from './types';

export interface VehicleView {
  vehicle: Vehicle;
  node: SVGGElement;
  inner: SVGGElement;
  path: VehiclePath;
  s: number;
}

const MARKING = '#f2f2f2';

const GRASS_DOTS: [number, number, number, string][] = [
  [6, 8, 3, '#6aa846'],
  [30, 5, 2, '#538a34'],
  [18, 22, 3, '#69a744'],
  [40, 30, 2.5, '#558d36'],
  [10, 38, 2, '#70ae4b'],
  [28, 42, 3, '#5a9539'],
  [44, 14, 2, '#6eac48'],
];

const ASPHALT_DOTS: [number, number, number, string][] = [
  [3, 4, 1.2, '#64676c'],
  [12, 9, 1, '#4f5256'],
  [17, 16, 1.3, '#66696e'],
  [7, 15, 1, '#505357'],
];

function pattern(id: string, size: number, base: string, dots: [number, number, number, string][]): SVGPatternElement {
  return svgEl('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' }, [
    svgEl('rect', { width: size, height: size, fill: base }),
    ...dots.map(([cx, cy, r, fill]) => svgEl('circle', { cx, cy, r, fill })),
  ]);
}

const line = (a: Vec, b: Vec, attrs: Attrs): SVGLineElement =>
  svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...attrs });

const isBentMain = (inter: Intersection): boolean =>
  inter.mainArms.length === 2 && (inter.mainArms[1] - inter.mainArms[0] + 4) % 4 !== 2;

function drawRoads(inter: Intersection): SVGGElement {
  const g = svgEl('g');
  const fill = 'url(#asphalt)';
  const H = HALF_ROAD;
  g.appendChild(svgEl('rect', { x: CENTER - H, y: CENTER - H, width: 2 * H, height: 2 * H, fill }));
  for (const arm of inter.arms) {
    const d = ARM_DIR[arm];
    const rect =
      d.x === 0
        ? { x: CENTER - H, y: d.y > 0 ? CENTER : 0, width: 2 * H, height: CENTER }
        : { x: d.x > 0 ? CENTER : 0, y: CENTER - H, width: CENTER, height: 2 * H };
    g.appendChild(svgEl('rect', { ...rect, fill }));
  }
  // rounded curbs between neighbouring arms
  for (const arm of inter.arms) {
    const next = ((arm + 1) % 4) as Arm;
    if (!inter.arms.includes(next)) continue;
    const sx = Math.sign(ARM_DIR[arm].x + ARM_DIR[next].x);
    const sy = Math.sign(ARM_DIR[arm].y + ARM_DIR[next].y);
    const cx = CENTER + sx * H;
    const cy = CENTER + sy * H;
    g.appendChild(
      svgEl('rect', {
        x: Math.min(cx, cx + sx * CORNER_R),
        y: Math.min(cy, cy + sy * CORNER_R),
        width: CORNER_R,
        height: CORNER_R,
        fill,
      }),
    );
    g.appendChild(svgEl('circle', { cx: cx + sx * CORNER_R, cy: cy + sy * CORNER_R, r: CORNER_R, fill: 'url(#grass)' }));
  }
  return g;
}

function drawMarkings(inter: Intersection): SVGGElement {
  const g = svgEl('g');
  const solidEnd = STOP_DIST + 110;
  for (const arm of inter.arms) {
    g.appendChild(line(armPoint(arm, STOP_DIST, 0), armPoint(arm, solidEnd, 0), { stroke: MARKING, 'stroke-width': 4 }));
    g.appendChild(
      line(armPoint(arm, solidEnd, 0), armPoint(arm, CENTER + 10, 0), {
        stroke: MARKING,
        'stroke-width': 4,
        'stroke-dasharray': '34 26',
      }),
    );
    if (inter.mainArms.length === 2 && !inter.mainArms.includes(arm)) {
      const a = armPoint(arm, STOP_DIST - 4, 2);
      const b = armPoint(arm, STOP_DIST - 4, HALF_ROAD - 2);
      g.appendChild(
        line(
          a,
          b,
          inter.yieldSign === 'stop'
            ? { stroke: MARKING, 'stroke-width': 8 }
            : { stroke: MARKING, 'stroke-width': 7, 'stroke-dasharray': '10 7' },
        ),
      );
    } else if (inter.signals) {
      g.appendChild(
        line(armPoint(arm, STOP_DIST - 4, 2), armPoint(arm, STOP_DIST - 4, HALF_ROAD - 2), {
          stroke: MARKING,
          'stroke-width': 8,
        }),
      );
    }
  }
  return g;
}

function offsetPolyline(points: PathPoint[], offset: number, attrs: Attrs): SVGPolylineElement {
  const list = points
    .map((p) => {
      const r = (p.angle * Math.PI) / 180;
      return `${(p.x + Math.cos(r) * offset).toFixed(1)},${(p.y + Math.sin(r) * offset).toFixed(1)}`;
    })
    .join(' ');
  return svgEl('polyline', { points: list, fill: 'none', 'stroke-linejoin': 'round', ...attrs });
}

function drawTramLine([a, b]: [Arm, Arm]): SVGGElement {
  const g = svgEl('g');
  const routes: [Arm, Arm][] = [
    [a, b],
    [b, a],
  ];
  for (const [from, to] of routes) {
    const points = buildPath(from, to, CENTER + 20, CENTER + 20).points;
    g.appendChild(offsetPolyline(points, 0, { stroke: 'rgba(40,36,30,0.35)', 'stroke-width': 30 }));
    for (const rail of [-8, 8]) g.appendChild(offsetPolyline(points, rail, { stroke: '#c4c4c4', 'stroke-width': 3 }));
  }
  return g;
}

function giveWaySign(): SVGGElement {
  return svgEl('g', {}, [
    svgEl('polygon', { points: '-26,-22 26,-22 0,24', fill: '#d4141c', stroke: '#d4141c', 'stroke-width': 3, 'stroke-linejoin': 'round' }),
    svgEl('polygon', { points: '-15,-15.5 15,-15.5 0,11', fill: '#fff' }),
  ]);
}

function stopSign(): SVGGElement {
  const octagon = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 8) * (2 * i + 1);
    return `${(Math.cos(a) * 25).toFixed(1)},${(Math.sin(a) * 25).toFixed(1)}`;
  }).join(' ');
  const text = svgEl('text', {
    x: 0,
    y: 1,
    fill: '#fff',
    'font-size': 13,
    'font-weight': 700,
    'font-family': 'Arial, sans-serif',
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
  });
  text.textContent = 'STOP';
  return svgEl('g', {}, [svgEl('polygon', { points: octagon, fill: '#d4141c', stroke: '#fff', 'stroke-width': 3 }), text]);
}

function mainRoadSign(): SVGGElement {
  return svgEl('g', {}, [
    svgEl('polygon', { points: '0,-26 26,0 0,26 -26,0', fill: '#fff', stroke: '#777', 'stroke-width': 1 }),
    svgEl('polygon', { points: '0,-18 18,0 0,18 -18,0', fill: '#f6c700' }),
  ]);
}

/** Dodatková tabulka „Tvar křižovatky“ drawn from the point of view of a driver on `approach`. */
function shapePlate(inter: Intersection, approach: Arm): SVGGElement {
  const g = svgEl('g', {}, [svgEl('rect', { x: -22, y: 32, width: 44, height: 44, rx: 3, fill: '#fff', stroke: '#222', 'stroke-width': 2 })]);
  for (const arm of inter.arms) {
    const d = ARM_DIR[(arm - approach + 4) % 4];
    const main = inter.mainArms.includes(arm);
    g.appendChild(
      svgEl('line', {
        x1: 0,
        y1: 54,
        x2: d.x * 17,
        y2: 54 + d.y * 17,
        stroke: '#111',
        'stroke-width': main ? 6 : 2.5,
        'stroke-linecap': main ? 'square' : 'butt',
      }),
    );
  }
  return g;
}

function drawSigns(inter: Intersection): SVGGElement {
  const g = svgEl('g');
  const bent = isBentMain(inter);
  for (const arm of inter.arms) {
    const pos = armPoint(arm, STOP_DIST + 72, HALF_ROAD + 40);
    const sign = svgEl('g', { transform: `translate(${pos.x} ${pos.y}) rotate(${approachAngle(arm)})` });
    sign.appendChild(
      inter.mainArms.includes(arm) ? mainRoadSign() : inter.yieldSign === 'stop' ? stopSign() : giveWaySign(),
    );
    if (bent) sign.appendChild(shapePlate(inter, arm));
    g.appendChild(sign);
  }
  return g;
}

type LampKind = 'red' | 'yellow' | 'green' | 'arrow';
type LampState = 'off' | 'on' | 'blink';
type ArmLamps = Partial<Record<LampKind, LampState>>;

function signalHead(arm: Arm, withArrow: boolean): SVGGElement {
  const pos = armPoint(arm, STOP_DIST + 18, HALF_ROAD + 30);
  const lamp = (kind: LampKind, cy: number): SVGCircleElement =>
    svgEl('circle', { class: `lamp ${kind}`, cx: 0, cy, r: 6.5, 'data-arm': arm, 'data-lamp': kind });
  const head = svgEl('g', { transform: `translate(${pos.x} ${pos.y}) rotate(${approachAngle(arm)})` }, [
    svgEl('rect', { x: -9, y: -26, width: 18, height: 52, rx: 4, fill: '#1b1b1b', stroke: '#000', 'stroke-width': 1.5 }),
    lamp('red', -16),
    lamp('yellow', 0),
    lamp('green', 16),
  ]);
  if (withArrow) {
    head.append(
      svgEl('rect', { x: 10, y: 6, width: 20, height: 20, rx: 3, fill: '#1b1b1b', stroke: '#000', 'stroke-width': 1.5 }),
      svgEl('path', { class: 'lamp arrow', d: 'M14 16 H26 M21 11 L26 16 L21 21', 'data-arm': arm, 'data-lamp': 'arrow' }),
    );
  }
  return head;
}

function applyLamps(svg: SVGSVGElement, state: (arm: Arm) => ArmLamps): void {
  for (const lamp of svg.querySelectorAll<SVGElement>('[data-lamp]')) {
    const value = state(Number(lamp.dataset.arm) as Arm)[lamp.dataset.lamp as LampKind] ?? 'off';
    lamp.classList.toggle('on', value === 'on');
    lamp.classList.toggle('blink', value === 'blink');
  }
}

export function showSignals(svg: SVGSVGElement, inter: Intersection, phase: number): void {
  const plan = inter.signals;
  if (!plan) return;
  applyLamps(svg, (arm) => {
    if (plan.blinking) return { yellow: 'blink' };
    if (plan.phases[phase].includes(arm)) return { green: 'on' };
    return { red: 'on', arrow: 'on' };
  });
}

/** Amber (or red + amber) interval between two phases. */
export function changeSignals(svg: SVGSVGElement, inter: Intersection, from: number, to: number): Promise<void> {
  const plan = inter.signals;
  if (!plan) return Promise.resolve();
  applyLamps(svg, (arm) => {
    const was = plan.phases[from].includes(arm);
    const will = plan.phases[to].includes(arm);
    if (was) return will ? { green: 'on' } : { yellow: 'on' };
    return will ? { red: 'on', yellow: 'on' } : { red: 'on' };
  });
  return new Promise((resolve) =>
    setTimeout(() => {
      showSignals(svg, inter, to);
      resolve();
    }, 1100),
  );
}

function placeVehicle(view: VehicleView): void {
  const p = pointAt(view.path, view.s);
  view.node.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.angle.toFixed(2)})`);
}

export function renderScene(svg: SVGSVGElement, scenario: Scenario, onPick: (id: string) => void): Map<string, VehicleView> {
  const inter = scenario.intersection;
  svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
  svg.replaceChildren(
    svgEl('defs', {}, [pattern('grass', 48, '#5e9b3c', GRASS_DOTS), pattern('asphalt', 20, '#585b60', ASPHALT_DOTS)]),
    svgEl('rect', { width: VIEW, height: VIEW, fill: 'url(#grass)' }),
    drawRoads(inter),
    drawMarkings(inter),
  );
  if (inter.tramLine) svg.appendChild(drawTramLine(inter.tramLine));
  if (inter.mainArms.length === 2) svg.appendChild(drawSigns(inter));
  if (inter.signals) {
    const plan = inter.signals;
    svg.appendChild(svgEl('g', {}, inter.arms.map((arm) => signalHead(arm, plan.rightArrows.includes(arm)))));
    showSignals(svg, inter, scenario.startPhase);
  }

  const layer = svgEl('g');
  svg.appendChild(layer);
  const views = new Map<string, VehicleView>();
  for (const vehicle of scenario.vehicles) {
    const { length } = VEHICLE_SIZE[vehicle.kind];
    const path = buildPath(vehicle.from, vehicle.to, STOP_DIST + length / 2 + 8, CENTER + length / 2 + 30);
    const inner = drawVehicle(vehicle.kind, vehicle.color, turnOf(vehicle.from, vehicle.to));
    const title = svgEl('title');
    title.textContent = vehicle.name;
    const node = svgEl('g', { class: 'vehicle' }, [inner, title]);
    node.addEventListener('click', () => onPick(vehicle.id));
    layer.appendChild(node);
    const view: VehicleView = { vehicle, node, inner, path, s: 0 };
    placeVehicle(view);
    views.set(vehicle.id, view);
  }
  return views;
}

/** Moves the vehicle along its path to distance `target`. */
export function animateTo(view: VehicleView, target: number, easing: 'in' | 'inOut'): Promise<void> {
  const from = view.s;
  const duration = Math.max(300, (Math.abs(target - from) / (easing === 'in' ? 340 : 230)) * 1000);
  view.node.parentNode?.appendChild(view.node);
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now: number): void => {
      const t = Math.min(1, (now - t0) / duration);
      const e = easing === 'in' ? t * t : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      view.s = from + (target - from) * e;
      placeVehicle(view);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
