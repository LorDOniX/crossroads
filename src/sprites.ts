import type { Turn, VehicleKind } from './types';

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

export const VEHICLE_SIZE: Record<VehicleKind, { length: number; width: number }> = {
  car: { length: 88, width: 42 },
  truck: { length: 136, width: 50 },
  tram: { length: 210, width: 50 },
};

const GLASS = '#2c3a47';
const HEADLIGHT = '#fff6c4';
const TAILLIGHT = '#b3121b';

/** Darkens (f < 0) or lightens (f > 0) a #rrggbb colour. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number =>
    Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
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
      points: pts([[-hw + 5, -hl + 36], [hw - 5, -hl + 36], [hw - 8, -hl + 21], [-hw + 8, -hl + 21]]),
      fill: GLASS,
    }),
    svgEl('rect', { x: -hw + 6, y: -hl + 36, width: W - 12, height: 27, rx: 4, fill: shade(color, -0.12) }),
    svgEl('polygon', {
      points: pts([[-hw + 6, -hl + 63], [hw - 6, -hl + 63], [hw - 9, -hl + 75], [-hw + 9, -hl + 75]]),
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
    svgEl('rect', { x: -hw, y: -hl + cab + 4, width: W, height: L - cab - 4, rx: 3, fill: '#dfe1e3', stroke: '#9ea3a8', 'stroke-width': 1.5 }),
    ...ribs,
    svgEl('rect', { x: -hw + 3, y: hl - 5, width: 9, height: 3.5, rx: 1.5, fill: TAILLIGHT }),
    svgEl('rect', { x: hw - 12, y: hl - 5, width: 9, height: 3.5, rx: 1.5, fill: TAILLIGHT }),
    ...mirrors(hw, -hl + 8, edge),
    svgEl('rect', { x: -hw + 2, y: -hl, width: W - 4, height: cab, rx: 9, fill: color, stroke: edge, 'stroke-width': 1.5 }),
    svgEl('rect', { x: -hw + 6, y: -hl + 5, width: W - 12, height: 8, rx: 3, fill: GLASS }),
    svgEl('rect', { x: -hw + 8, y: -hl + 15, width: W - 16, height: 17, rx: 3, fill: shade(color, -0.12) }),
    svgEl('rect', { x: -hw + 5, y: -hl + 1, width: 8, height: 3.5, rx: 1.5, fill: HEADLIGHT }),
    svgEl('rect', { x: hw - 13, y: -hl + 1, width: 8, height: 3.5, rx: 1.5, fill: HEADLIGHT }),
  ];
}

function tramParts(color: string): SVGElement[] {
  const { length: L, width: W } = VEHICLE_SIZE.tram;
  const hl = L / 2;
  const hw = W / 2;
  const stripe = '#1f5aa6';
  const joints = [1, 2].map((k) =>
    svgEl('rect', { x: -hw, y: -hl + (k * L) / 3 - 3, width: W, height: 6, fill: '#3d3d3d' }),
  );
  return [
    svgEl('rect', { x: -hw + 3, y: -hl + 5, width: W, height: L, rx: 14, fill: 'rgba(0,0,0,0.3)' }),
    svgEl('rect', { x: -hw, y: -hl, width: W, height: L, rx: 14, fill: color, stroke: shade(color, -0.4), 'stroke-width': 1.5 }),
    svgEl('rect', { x: -hw, y: -hl + 22, width: 4, height: L - 44, fill: stripe }),
    svgEl('rect', { x: hw - 4, y: -hl + 22, width: 4, height: L - 44, fill: stripe }),
    svgEl('rect', { x: -hw + 7, y: -hl + 20, width: W - 14, height: L - 40, rx: 6, fill: shade(color, -0.1) }),
    ...joints,
    svgEl('rect', { x: -hw + 6, y: -hl + 3, width: W - 12, height: 11, rx: 6, fill: GLASS }),
    svgEl('rect', { x: -hw + 6, y: hl - 14, width: W - 12, height: 11, rx: 6, fill: GLASS }),
    svgEl('polygon', { points: '0,-14 11,0 0,14 -11,0', fill: 'none', stroke: '#333', 'stroke-width': 2 }),
    svgEl('line', { x1: -11, y1: 0, x2: 11, y2: 0, stroke: '#333', 'stroke-width': 2 }),
    svgEl('rect', { x: -hw + 6, y: -hl + 0.5, width: 8, height: 3, rx: 1.5, fill: HEADLIGHT }),
    svgEl('rect', { x: hw - 14, y: -hl + 0.5, width: 8, height: 3, rx: 1.5, fill: HEADLIGHT }),
  ];
}

function indicators(hw: number, hl: number, turn: Turn): SVGElement[] {
  if (turn === 'straight') return [];
  const x = (turn === 'right' ? 1 : -1) * (hw - 2);
  return [-hl + 6, hl - 6].map((y) => svgEl('circle', { class: 'ind on', cx: x, cy: y, r: 6 }));
}

/** Top-down vehicle heading up (-y), centred at the origin. */
export function drawVehicle(kind: VehicleKind, color: string, turn: Turn): SVGGElement {
  const parts = kind === 'car' ? carParts(color) : kind === 'truck' ? truckParts(color) : tramParts(color);
  const { length, width } = VEHICLE_SIZE[kind];
  return svgEl('g', { class: 'body' }, [...parts, ...indicators(width / 2, length / 2, turn)]);
}
