import { TRAM_SECTION_LENGTH, VEHICLE_SIZE } from './geometry';
import type { Turn, Vehicle } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type Attrs = Record<string, string | number>;

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Element[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
}

const GLASS = '#2c3a47';
const HEADLIGHT = '#fff6c4';
const TAILLIGHT = '#b3121b';

/** Darkens (f < 0) or lightens (f > 0) a #rrggbb colour. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const pts = (list: number[][]): string => list.map((p) => p.join(',')).join(' ');

function lights(hw: number, hl: number): SVGElement[] {
  return [
    svgEl('rect', { x: -hw + 4, y: -hl + 1.5, width: 9, height: 4, rx: 2, fill: HEADLIGHT }),
    svgEl('rect', { x: hw - 13, y: -hl + 1.5, width: 9, height: 4, rx: 2, fill: HEADLIGHT }),
    svgEl('rect', { x: -hw + 4, y: hl - 5, width: 9, height: 3.5, rx: 1.5, fill: TAILLIGHT }),
    svgEl('rect', { x: hw - 13, y: hl - 5, width: 9, height: 3.5, rx: 1.5, fill: TAILLIGHT }),
  ];
}

function mirrors(hw: number, y: number, fill: string): SVGElement[] {
  return [
    svgEl('rect', { x: -hw - 4, y, width: 6, height: 6, rx: 2, fill }),
    svgEl('rect', { x: hw - 2, y, width: 6, height: 6, rx: 2, fill }),
  ];
}

function carParts(color: string): SVGElement[] {
  const { length: L, width: W } = VEHICLE_SIZE.car;
  const hl = L / 2;
  const hw = W / 2;
  const edge = shade(color, -0.4);
  return [
    svgEl('rect', { x: -hw + 3, y: -hl + 5, width: W, height: L, rx: 13, fill: 'rgba(0,0,0,0.3)' }),
    ...mirrors(hw, -hl + 25, edge),
    svgEl('rect', { x: -hw, y: -hl, width: W, height: L, rx: 13, fill: color, stroke: edge, 'stroke-width': 1.5 }),
    ...lights(hw, hl),
    svgEl('polygon', {
      points: pts([
        [-hw + 5, -hl + 36],
        [hw - 5, -hl + 36],
        [hw - 8, -hl + 21],
        [-hw + 8, -hl + 21],
      ]),
      fill: GLASS,
    }),
    svgEl('rect', { x: -hw + 6, y: -hl + 36, width: W - 12, height: 27, rx: 4, fill: shade(color, -0.12) }),
    svgEl('polygon', {
      points: pts([
        [-hw + 6, -hl + 63],
        [hw - 6, -hl + 63],
        [hw - 9, -hl + 75],
        [-hw + 9, -hl + 75],
      ]),
      fill: GLASS,
    }),
  ];
}

function truckParts(color: string): SVGElement[] {
  const { length: L, width: W } = VEHICLE_SIZE.truck;
  const hl = L / 2;
  const hw = W / 2;
  const cab = 36;
  const edge = shade(color, -0.4);
  const ribs: SVGElement[] = [];
  for (let y = -hl + cab + 16; y < hl - 8; y += 14) {
    ribs.push(svgEl('line', { x1: -hw + 3, y1: y, x2: hw - 3, y2: y, stroke: '#c5c9cd', 'stroke-width': 1.5 }));
  }
  return [
    svgEl('rect', { x: -hw + 3, y: -hl + 5, width: W, height: L, rx: 6, fill: 'rgba(0,0,0,0.3)' }),
    svgEl('rect', {
      x: -hw,
      y: -hl + cab + 4,
      width: W,
      height: L - cab - 4,
      rx: 3,
      fill: '#dfe1e3',
      stroke: '#9ea3a8',
      'stroke-width': 1.5,
    }),
    ...ribs,
    svgEl('rect', { x: -hw + 3, y: hl - 5, width: 9, height: 3.5, rx: 1.5, fill: TAILLIGHT }),
    svgEl('rect', { x: hw - 12, y: hl - 5, width: 9, height: 3.5, rx: 1.5, fill: TAILLIGHT }),
    ...mirrors(hw, -hl + 8, edge),
    svgEl('rect', {
      x: -hw + 2,
      y: -hl,
      width: W - 4,
      height: cab,
      rx: 9,
      fill: color,
      stroke: edge,
      'stroke-width': 1.5,
    }),
    svgEl('rect', { x: -hw + 6, y: -hl + 5, width: W - 12, height: 8, rx: 3, fill: GLASS }),
    svgEl('rect', { x: -hw + 8, y: -hl + 15, width: W - 16, height: 17, rx: 3, fill: shade(color, -0.12) }),
    svgEl('rect', { x: -hw + 5, y: -hl + 1, width: 8, height: 3.5, rx: 1.5, fill: HEADLIGHT }),
    svgEl('rect', { x: hw - 13, y: -hl + 1, width: 8, height: 3.5, rx: 1.5, fill: HEADLIGHT }),
  ];
}

type Section = 'front' | 'middle' | 'rear';

/** One rigid section of the articulated tram. */
function tramSection(color: string, section: Section): SVGElement[] {
  const L = TRAM_SECTION_LENGTH;
  const W = VEHICLE_SIZE.tram.width;
  const hl = L / 2;
  const hw = W / 2;
  const stripe = '#1f5aa6';
  const parts: SVGElement[] = [
    svgEl('rect', { x: -hw + 3, y: -hl + 5, width: W, height: L, rx: 6, fill: 'rgba(0,0,0,0.3)' }),
    svgEl('rect', {
      x: -hw,
      y: -hl,
      width: W,
      height: L,
      rx: section === 'middle' ? 3 : 12,
      fill: color,
      stroke: shade(color, -0.4),
      'stroke-width': 1.5,
    }),
    svgEl('rect', { x: -hw, y: -hl + 8, width: 4, height: L - 16, fill: stripe }),
    svgEl('rect', { x: hw - 4, y: -hl + 8, width: 4, height: L - 16, fill: stripe }),
    svgEl('rect', { x: -hw + 7, y: -hl + 8, width: W - 14, height: L - 16, rx: 5, fill: shade(color, -0.1) }),
  ];
  if (section === 'front') {
    parts.push(
      svgEl('rect', { x: -hw + 6, y: -hl + 3, width: W - 12, height: 10, rx: 5, fill: GLASS }),
      svgEl('rect', { x: -hw + 6, y: -hl + 0.5, width: 8, height: 3, rx: 1.5, fill: HEADLIGHT }),
      svgEl('rect', { x: hw - 14, y: -hl + 0.5, width: 8, height: 3, rx: 1.5, fill: HEADLIGHT }),
    );
  }
  if (section === 'middle') {
    parts.push(
      svgEl('polygon', { points: '0,-14 11,0 0,14 -11,0', fill: 'none', stroke: '#333', 'stroke-width': 2 }),
      svgEl('line', { x1: -11, y1: 0, x2: 11, y2: 0, stroke: '#333', 'stroke-width': 2 }),
    );
  }
  if (section === 'rear') {
    parts.push(svgEl('rect', { x: -hw + 6, y: hl - 13, width: W - 12, height: 10, rx: 5, fill: GLASS }));
  }
  if (section !== 'rear') {
    parts.push(svgEl('rect', { x: -hw + 2, y: hl - 1, width: W - 4, height: 4, fill: '#3d3d3d' }));
  }
  return parts;
}

function ambulanceParts(beacons: boolean): SVGElement[] {
  const { length: L, width: W } = VEHICLE_SIZE.ambulance;
  const hl = L / 2;
  const hw = W / 2;
  const body = '#f6f6f0';
  const edge = '#9a9a92';
  const lime = '#cfe233';
  return [
    svgEl('rect', { x: -hw + 3, y: -hl + 5, width: W, height: L, rx: 8, fill: 'rgba(0,0,0,0.3)' }),
    ...mirrors(hw, -hl + 16, edge),
    svgEl('rect', { x: -hw, y: -hl, width: W, height: L, rx: 9, fill: body, stroke: edge, 'stroke-width': 1.5 }),
    svgEl('rect', { x: -hw, y: -hl + 30, width: 5, height: L - 40, fill: lime }),
    svgEl('rect', { x: hw - 5, y: -hl + 30, width: 5, height: L - 40, fill: lime }),
    svgEl('rect', { x: -hw + 6, y: -hl + 8, width: W - 12, height: 10, rx: 3, fill: GLASS }),
    svgEl('rect', { x: -hw + 7, y: -hl + 32, width: W - 14, height: L - 44, rx: 3, fill: '#ebebe4' }),
    svgEl('rect', { x: -4, y: 2, width: 8, height: 24, fill: '#d4141c' }),
    svgEl('rect', { x: -12, y: 10, width: 24, height: 8, fill: '#d4141c' }),
    svgEl('rect', { x: -hw + 6, y: -hl + 21, width: 13, height: 7, rx: 2, class: beacons ? 'beacon on' : 'beacon' }),
    svgEl('rect', {
      x: hw - 19,
      y: -hl + 21,
      width: 13,
      height: 7,
      rx: 2,
      class: beacons ? 'beacon on alt' : 'beacon',
    }),
    ...lights(hw, hl),
  ];
}

function pedestrianParts(color: string): SVGElement[] {
  return [
    svgEl('ellipse', { cx: 2, cy: 3, rx: 17, ry: 10, fill: 'rgba(0,0,0,0.25)' }),
    svgEl('ellipse', { cx: 0, cy: 0, rx: 17, ry: 10, fill: color, stroke: shade(color, -0.4), 'stroke-width': 2 }),
    svgEl('circle', { cx: 0, cy: 0, r: 8.5, fill: '#5a3b25', stroke: '#3b2616', 'stroke-width': 1 }),
  ];
}

/** Police officer seen from above; his sides (local x axis) face the free direction. */
export function drawPoliceOfficer(): SVGGElement {
  const figure = svgEl('g', { transform: 'scale(1.7)' }, [
    svgEl('circle', {
      cx: 0,
      cy: 0,
      r: 30,
      fill: 'rgba(255,255,255,0.18)',
      stroke: 'rgba(255,255,255,0.7)',
      'stroke-width': 1.5,
      'stroke-dasharray': '5 4',
    }),
    svgEl('rect', { x: -34, y: -4, width: 68, height: 8, rx: 4, fill: '#24324d' }),
    svgEl('circle', { cx: -35, cy: 0, r: 4.5, fill: '#fff' }),
    svgEl('circle', { cx: 35, cy: 0, r: 4.5, fill: '#fff' }),
    svgEl('rect', { x: 34, y: -2, width: 14, height: 4, rx: 2, fill: '#fff', stroke: '#d4141c', 'stroke-width': 1.5 }),
    svgEl('ellipse', { cx: 0, cy: 0, rx: 16, ry: 9, fill: '#2d3e60' }),
    svgEl('circle', { cx: 0, cy: 0, r: 7.5, fill: '#f2f2f2', stroke: '#1b2235', 'stroke-width': 1.5 }),
    svgEl('rect', { x: -6, y: -9, width: 12, height: 4, rx: 2, fill: '#1b2235' }),
  ]);
  return svgEl('g', { class: 'police' }, [figure]);
}

function indicators(hw: number, ys: number[], turn: Turn): SVGElement[] {
  if (turn === 'straight') return [];
  const x = (turn === 'right' ? 1 : -1) * (hw - 2);
  return ys.map((y) => svgEl('circle', { class: 'ind on', cx: x, cy: y, r: 6 }));
}

/** Transparent area around the sprite so that it is easy to hit on a touch screen. */
const hitArea = (length: number, width: number): SVGElement =>
  svgEl('rect', {
    x: -width / 2 - 10,
    y: -length / 2 - 8,
    width: width + 20,
    height: length + 16,
    fill: 'transparent',
  });

/** Top-down road user heading up (-y), centred at the origin; one group per rigid section. */
export function drawVehicle(v: Vehicle, turn: Turn): SVGGElement[] {
  const { length, width } = VEHICLE_SIZE[v.kind];
  const hw = width / 2;
  const hl = length / 2;
  if (v.kind === 'tram') {
    const sections: Section[] = ['front', 'middle', 'rear'];
    const half = TRAM_SECTION_LENGTH / 2;
    return sections.map((section) =>
      svgEl('g', { class: 'body' }, [
        hitArea(TRAM_SECTION_LENGTH + 6, width),
        ...tramSection(v.color, section),
        ...(section === 'front' ? indicators(hw, [-half + 6], turn) : []),
        ...(section === 'rear' ? indicators(hw, [half - 6], turn) : []),
      ]),
    );
  }
  if (v.kind === 'pedestrian') return [svgEl('g', { class: 'body' }, [hitArea(40, 40), ...pedestrianParts(v.color)])];
  const parts =
    v.kind === 'car' ? carParts(v.color) : v.kind === 'truck' ? truckParts(v.color) : ambulanceParts(v.beacons);
  return [
    svgEl('g', { class: 'body' }, [hitArea(length, width), ...parts, ...indicators(hw, [-hl + 6, hl - 6], turn)]),
  ];
}
