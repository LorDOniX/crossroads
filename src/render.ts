import {
  ARM_DIR,
  CENTER,
  CORNER_R,
  RING_IN,
  RING_OUT,
  TRAM_SECTIONS,
  VIEW,
  approachAngle,
  armPoint,
  buildVehiclePath,
  crosswalkBand,
  laneLateral,
  layoutOf,
  pointAt,
  trackPath,
  turnOf,
  waitDistances,
  type Layout,
  type PathPoint,
  type Vec,
  type VehiclePath,
} from './geometry';
import { drawPoliceOfficer, drawVehicle, svgEl, type Attrs } from './sprites';
import type { Arm, Intersection, Scenario, Vehicle } from './types';

export interface VehicleView {
  vehicle: Vehicle;
  /** Focusable, clickable group. */
  node: SVGGElement;
  /** Positioned groups, one per rigid section (three for a tram). */
  sections: SVGGElement[];
  /** Shapes inside the sections, used for the crash effect. */
  bodies: SVGGElement[];
  path: VehiclePath;
  s: number;
  /** Current waiting distance from the centre (changes when the column moves up). */
  waitDist: number;
}

export interface Scene {
  views: Map<string, VehicleView>;
  layout: Layout;
  badges: SVGGElement;
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

function armRect(arm: Arm, half: number): Attrs {
  const d = ARM_DIR[arm];
  return d.x === 0
    ? { x: CENTER - half, y: d.y > 0 ? CENTER : 0, width: 2 * half, height: CENTER }
    : { x: d.x > 0 ? CENTER : 0, y: CENTER - half, width: CENTER, height: 2 * half };
}

function drawRoads(inter: Intersection, layout: Layout): SVGGElement {
  const g = svgEl('g');
  const fill = 'url(#asphalt)';
  for (const arm of inter.arms) g.appendChild(svgEl('rect', { ...armRect(arm, layout.roadHalf[arm]), fill }));
  if (layout.roundabout) {
    g.append(
      svgEl('circle', { cx: CENTER, cy: CENTER, r: RING_OUT, fill }),
      svgEl('circle', {
        cx: CENTER,
        cy: CENTER,
        r: RING_IN,
        fill: 'url(#grass)',
        stroke: '#d8d8d8',
        'stroke-width': 6,
      }),
      svgEl('circle', { cx: CENTER, cy: CENTER, r: RING_IN - 30, fill: '#4f8a33', opacity: 0.6 }),
    );
    return g;
  }
  const halfX = layout.roadHalf[0];
  const halfY = layout.roadHalf[1];
  g.appendChild(svgEl('rect', { x: CENTER - halfX, y: CENTER - halfY, width: 2 * halfX, height: 2 * halfY, fill }));
  // rounded curbs between neighbouring arms
  for (const arm of inter.arms) {
    const next = ((arm + 1) % 4) as Arm;
    if (!inter.arms.includes(next)) continue;
    const sx = Math.sign(ARM_DIR[arm].x + ARM_DIR[next].x);
    const sy = Math.sign(ARM_DIR[arm].y + ARM_DIR[next].y);
    const cx = CENTER + sx * halfX;
    const cy = CENTER + sy * halfY;
    g.appendChild(
      svgEl('rect', {
        x: Math.min(cx, cx + sx * CORNER_R),
        y: Math.min(cy, cy + sy * CORNER_R),
        width: CORNER_R,
        height: CORNER_R,
        fill,
      }),
    );
    g.appendChild(
      svgEl('circle', { cx: cx + sx * CORNER_R, cy: cy + sy * CORNER_R, r: CORNER_R, fill: 'url(#grass)' }),
    );
  }
  return g;
}

function crosswalk(layout: Layout, arm: Arm): SVGGElement {
  const g = svgEl('g');
  const [near, far] = crosswalkBand(layout, arm);
  const half = layout.roadHalf[arm];
  for (let lat = -half + 6; lat < half - 4; lat += 16) {
    const corners = [
      armPoint(arm, near, lat),
      armPoint(arm, far, lat),
      armPoint(arm, far, lat + 9),
      armPoint(arm, near, lat + 9),
    ];
    g.appendChild(svgEl('polygon', { points: corners.map((p) => `${p.x},${p.y}`).join(' '), fill: MARKING }));
  }
  return g;
}

function stopLine(layout: Layout, arm: Arm, dashed: boolean): SVGLineElement {
  const dist = layout.stop[arm] - 4;
  return line(
    armPoint(arm, dist, 2),
    armPoint(arm, dist, layout.roadHalf[arm] - 2),
    dashed
      ? { stroke: MARKING, 'stroke-width': 7, 'stroke-dasharray': '10 7' }
      : { stroke: MARKING, 'stroke-width': 8 },
  );
}

function drawMarkings(inter: Intersection, layout: Layout): SVGGElement {
  const g = svgEl('g');
  for (const arm of inter.arms) {
    const start = layout.stop[arm];
    const solidEnd = start + 110;
    g.appendChild(line(armPoint(arm, start, 0), armPoint(arm, solidEnd, 0), { stroke: MARKING, 'stroke-width': 4 }));
    g.appendChild(
      line(armPoint(arm, solidEnd, 0), armPoint(arm, CENTER + 10, 0), {
        stroke: MARKING,
        'stroke-width': 4,
        'stroke-dasharray': '34 26',
      }),
    );
    if (inter.crosswalks.includes(arm)) g.appendChild(crosswalk(layout, arm));
    if (inter.roundabout) {
      if (inter.roundabout.yieldOnEntry) g.appendChild(stopLine(layout, arm, true));
    } else if (inter.mainArms.length === 2 && !inter.mainArms.includes(arm)) {
      g.appendChild(stopLine(layout, arm, inter.yieldSign !== 'stop'));
    } else if (inter.signals) {
      g.appendChild(stopLine(layout, arm, false));
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

function drawTramLine(layout: Layout, [a, b]: [Arm, Arm]): SVGGElement {
  const g = svgEl('g');
  const routes: [Arm, Arm][] = [
    [a, b],
    [b, a],
  ];
  for (const [from, to] of routes) {
    const points = trackPath(layout, from, to).points;
    g.appendChild(offsetPolyline(points, 0, { stroke: 'rgba(40,36,30,0.35)', 'stroke-width': 30 }));
    for (const rail of [-8, 8]) g.appendChild(offsetPolyline(points, rail, { stroke: '#c4c4c4', 'stroke-width': 3 }));
  }
  return g;
}

function giveWaySign(): SVGGElement {
  return svgEl('g', {}, [
    svgEl('polygon', {
      points: '-26,-22 26,-22 0,24',
      fill: '#d4141c',
      stroke: '#d4141c',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
    }),
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
  return svgEl('g', {}, [
    svgEl('polygon', { points: octagon, fill: '#d4141c', stroke: '#fff', 'stroke-width': 3 }),
    text,
  ]);
}

function mainRoadSign(): SVGGElement {
  return svgEl('g', {}, [
    svgEl('polygon', { points: '0,-26 26,0 0,26 -26,0', fill: '#fff', stroke: '#777', 'stroke-width': 1 }),
    svgEl('polygon', { points: '0,-18 18,0 0,18 -18,0', fill: '#f6c700' }),
  ]);
}

/** Dodatková tabulka „Tvar křižovatky“ drawn from the point of view of a driver on `approach`. */
function shapePlate(inter: Intersection, approach: Arm): SVGGElement {
  const g = svgEl('g', {}, [
    svgEl('rect', { x: -22, y: 32, width: 44, height: 44, rx: 3, fill: '#fff', stroke: '#222', 'stroke-width': 2 }),
  ]);
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

function roundaboutSign(): SVGGElement {
  const arrows = [0, 120, 240].map((start) => {
    const a0 = ((start + 30) * Math.PI) / 180;
    const a1 = ((start - 50) * Math.PI) / 180;
    const p0 = { x: Math.cos(a0) * 13, y: Math.sin(a0) * 13 };
    const p1 = { x: Math.cos(a1) * 13, y: Math.sin(a1) * 13 };
    // arrowhead pointing along the counter-clockwise direction of travel
    const t = { x: Math.sin(a1), y: -Math.cos(a1) };
    const n = { x: Math.cos(a1), y: Math.sin(a1) };
    const tip = { x: p1.x + t.x * 5, y: p1.y + t.y * 5 };
    const head = [tip, { x: p1.x + n.x * 4.5, y: p1.y + n.y * 4.5 }, { x: p1.x - n.x * 4.5, y: p1.y - n.y * 4.5 }];
    return svgEl('g', {}, [
      svgEl('path', {
        d: `M${p0.x} ${p0.y} A13 13 0 0 0 ${p1.x} ${p1.y}`,
        fill: 'none',
        stroke: '#fff',
        'stroke-width': 3.5,
      }),
      svgEl('polygon', { points: head.map((p) => `${p.x},${p.y}`).join(' '), fill: '#fff' }),
    ]);
  });
  return svgEl('g', { transform: 'translate(0 54)' }, [
    svgEl('circle', { cx: 0, cy: 0, r: 25, fill: '#1f5aa6', stroke: '#fff', 'stroke-width': 3 }),
    ...arrows,
  ]);
}

function drawSigns(inter: Intersection, layout: Layout): SVGGElement {
  const g = svgEl('g');
  const bent = isBentMain(inter);
  for (const arm of inter.arms) {
    const pos = armPoint(arm, layout.stop[arm] + 72, layout.roadHalf[arm] + 40);
    const sign = svgEl('g', { transform: `translate(${pos.x} ${pos.y}) rotate(${approachAngle(arm)})` });
    if (inter.roundabout) {
      if (inter.roundabout.yieldOnEntry) sign.appendChild(giveWaySign());
      sign.appendChild(roundaboutSign());
    } else {
      sign.appendChild(
        inter.mainArms.includes(arm) ? mainRoadSign() : inter.yieldSign === 'stop' ? stopSign() : giveWaySign(),
      );
      if (bent) sign.appendChild(shapePlate(inter, arm));
    }
    g.appendChild(sign);
  }
  return g;
}

type LampKind = 'red' | 'yellow' | 'green' | 'arrow' | 'left';
type LampState = 'off' | 'on' | 'blink';
type ArmLamps = Partial<Record<LampKind, LampState>>;

function signalHead(layout: Layout, arm: Arm, rightArrow: boolean, leftArrow: boolean): SVGGElement {
  const pos = armPoint(arm, layout.stop[arm] + 18, layout.roadHalf[arm] + 30);
  const lamp = (kind: LampKind, cy: number): SVGCircleElement =>
    svgEl('circle', { class: `lamp ${kind}`, cx: 0, cy, r: 6.5, 'data-arm': arm, 'data-lamp': kind });
  const head = svgEl('g', { transform: `translate(${pos.x} ${pos.y}) rotate(${approachAngle(arm)})` }, [
    svgEl('rect', {
      x: -9,
      y: -26,
      width: 18,
      height: 52,
      rx: 4,
      fill: '#1b1b1b',
      stroke: '#000',
      'stroke-width': 1.5,
    }),
    lamp('red', -16),
    lamp('yellow', 0),
    lamp('green', 16),
  ]);
  if (leftArrow) {
    head.appendChild(
      svgEl('path', {
        class: 'lamp left',
        d: 'M4 16 H-4 M-1 12.5 L-4.5 16 L-1 19.5',
        'data-arm': arm,
        'data-lamp': 'left',
      }),
    );
  }
  if (rightArrow) {
    head.append(
      svgEl('rect', {
        x: 10,
        y: 6,
        width: 20,
        height: 20,
        rx: 3,
        fill: '#1b1b1b',
        stroke: '#000',
        'stroke-width': 1.5,
      }),
      svgEl('path', {
        class: 'lamp arrow',
        d: 'M14 16 H26 M21 11 L26 16 L21 21',
        'data-arm': arm,
        'data-lamp': 'arrow',
      }),
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

function lampsFor(inter: Intersection, arm: Arm, phase: number): ArmLamps {
  const plan = inter.signals;
  if (!plan) return {};
  if (plan.blinking) return { yellow: 'blink' };
  const ph = plan.phases[phase];
  if (ph.arms.includes(arm)) return ph.leftOnly ? { red: 'on', left: 'on', arrow: 'on' } : { green: 'on' };
  return { red: 'on', arrow: 'on' };
}

const policeAngle = (inter: Intersection, phase: number): number =>
  inter.police && inter.police.phases[phase].includes(0) ? 90 : 0;

/** Shows the lights or turns the police officer for `phase`. */
export function showControl(svg: SVGSVGElement, inter: Intersection, phase: number): void {
  applyLamps(svg, (arm) => lampsFor(inter, arm, phase));
  const officer = svg.querySelector<SVGGElement>('[data-police]');
  officer?.setAttribute('transform', `translate(${CENTER} ${CENTER}) rotate(${policeAngle(inter, phase)})`);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Amber interval between two light phases, or the officer turning. */
export async function changeControl(svg: SVGSVGElement, inter: Intersection, from: number, to: number): Promise<void> {
  if (inter.police) {
    const officer = svg.querySelector<SVGGElement>('[data-police]');
    const a0 = policeAngle(inter, from);
    const a1 = policeAngle(inter, to);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (now: number): void => {
        const t = Math.min(1, (now - t0) / 800);
        officer?.setAttribute('transform', `translate(${CENTER} ${CENTER}) rotate(${a0 + (a1 - a0) * t})`);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    return;
  }
  const plan = inter.signals;
  if (!plan) return;
  applyLamps(svg, (arm) => {
    const was = plan.phases[from].arms.includes(arm);
    const will = plan.phases[to].arms.includes(arm);
    if (was && will) return lampsFor(inter, arm, from);
    if (was) return { yellow: 'on' };
    return will ? { red: 'on', yellow: 'on' } : { red: 'on' };
  });
  await wait(1100);
  showControl(svg, inter, to);
}

/** Moves every section of the vehicle to its place for the current `s`. */
export function placeVehicle(view: VehicleView): void {
  const offsets = view.sections.length > 1 ? TRAM_SECTIONS : [0];
  view.sections.forEach((section, i) => {
    const p = pointAt(view.path, view.s + offsets[i]);
    section.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.angle.toFixed(2)})`);
  });
}

function describe(v: Vehicle): string {
  if (v.kind === 'pedestrian') return `${v.name}, přechází silnici`;
  if (v.circulating) return `${v.name}, jede po kruhovém objezdu`;
  const turn = turnOf(v.from, v.to);
  const where = turn === 'straight' ? 'jede rovně' : turn === 'right' ? 'odbočuje vpravo' : 'odbočuje vlevo';
  return `${v.name}, ${where}${v.beacons ? ', má zapnutý maják' : ''}`;
}

export function renderScene(svg: SVGSVGElement, scenario: Scenario, onPick: (id: string) => void): Scene {
  const inter = scenario.intersection;
  const layout = layoutOf(inter);
  svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
  svg.replaceChildren(
    svgEl('defs', {}, [pattern('grass', 48, '#5e9b3c', GRASS_DOTS), pattern('asphalt', 20, '#585b60', ASPHALT_DOTS)]),
    svgEl('rect', { width: VIEW, height: VIEW, fill: 'url(#grass)' }),
    drawRoads(inter, layout),
    drawMarkings(inter, layout),
  );
  if (inter.tramLine) svg.appendChild(drawTramLine(layout, inter.tramLine));
  if (inter.mainArms.length === 2 || inter.roundabout) svg.appendChild(drawSigns(inter, layout));
  if (inter.signals) {
    const plan = inter.signals;
    const leftArms = plan.phases.filter((p) => p.leftOnly).flatMap((p) => p.arms);
    svg.appendChild(
      svgEl(
        'g',
        {},
        inter.arms.map((arm) => signalHead(layout, arm, plan.rightArrows.includes(arm), leftArms.includes(arm))),
      ),
    );
  }
  const badges = svgEl('g', { class: 'badges' });
  svg.appendChild(badges);
  if (inter.police) {
    const officer = drawPoliceOfficer();
    officer.setAttribute('data-police', '');
    svg.appendChild(officer);
  }
  showControl(svg, inter, scenario.startPhase);

  const layer = svgEl('g');
  svg.appendChild(layer);
  const waits = waitDistances(layout, scenario.vehicles);
  const views = new Map<string, VehicleView>();
  for (const vehicle of scenario.vehicles) {
    const waitDist = waits.get(vehicle.id) ?? 0;
    const path = buildVehiclePath(layout, vehicle, waitDist);
    const bodies = drawVehicle(vehicle, turnOf(vehicle.from, vehicle.to));
    const sections = bodies.map((body) => svgEl('g', {}, [body]));
    const title = svgEl('title');
    title.textContent = vehicle.name;
    const node = svgEl(
      'g',
      { class: 'vehicle', tabindex: 0, role: 'button', 'aria-pressed': 'false', 'aria-label': describe(vehicle) },
      [...sections, title],
    );
    node.addEventListener('click', () => onPick(vehicle.id));
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onPick(vehicle.id);
    });
    layer.appendChild(node);
    const view: VehicleView = { vehicle, node, sections, bodies, path, s: path.sWait, waitDist };
    placeVehicle(view);
    views.set(vehicle.id, view);
  }
  return { views, layout, badges };
}

/** Number showing the order of departure, beside the place the road user left (in the opposite lane). */
export function addOrderBadge(scene: Scene, view: VehicleView, order: number): void {
  const v = view.vehicle;
  const wait = pointAt(view.path, view.path.sWait);
  let p: Vec = wait;
  if (v.circulating) p = { x: CENTER + (wait.x - CENTER) * 0.55, y: CENTER + (wait.y - CENTER) * 0.55 };
  else if (v.kind !== 'pedestrian')
    p = armPoint(v.from, view.waitDist, -laneLateral(scene.layout, v.from, v.kind === 'tram'));
  const text = svgEl('text', {
    x: p.x,
    y: p.y + 1,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    class: 'badge-text',
  });
  text.textContent = String(order);
  scene.badges.appendChild(svgEl('g', { class: 'badge' }, [svgEl('circle', { cx: p.x, cy: p.y, r: 17 }), text]));
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
      // ease-in: speed grows during the first 35 % of the time, then stays constant
      const e =
        easing === 'in'
          ? t < 0.35
            ? (t * t) / 0.5775
            : (t - 0.175) / 0.825
          : t < 0.5
            ? 2 * t * t
            : 1 - (-2 * t + 2) ** 2 / 2;
      view.s = from + (target - from) * e;
      placeVehicle(view);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
