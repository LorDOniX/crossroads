import type { Route } from './route';

export type Tags = Record<string, string>;

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OsmWay {
  id: number;
  nodes: number[];
  tags?: Tags;
}

export interface OsmData {
  nodes: Map<number, OsmNode>;
  ways: OsmWay[];
}

type Element = ({ type: 'node' } & OsmNode) | ({ type: 'way' } & OsmWay) | { type: 'relation' };
/** [south, west, north, east] */
type Box = [number, number, number, number];

// the public instances are often overloaded – the next one starts when the previous one is slow or fails
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const STAGGER_MS = 6000;
const REQUEST_MS = 45_000;
const BUSY_RETRIES = 3;
const BUSY_RETRY_MS = 2000;
const ROADS = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$';
/** Roads this close to the route are downloaded, in metres. */
const CORRIDOR = 40;
/** The route is covered by boxes around pieces of about this length, in metres. */
const BOX_LENGTH = 250;
const BOXES_PER_QUERY = 40;

/** Small boxes along the route – much cheaper for Overpass than `around` with a long line. */
function boxesAlong(route: Route): Box[] {
  const boxes: Box[] = [];
  let box: Box | null = null;
  let from = 0;
  route.points.forEach(([lon, lat], i) => {
    box = box
      ? [Math.min(box[0], lat), Math.min(box[1], lon), Math.max(box[2], lat), Math.max(box[3], lon)]
      : [lat, lon, lat, lon];
    if (route.distances[i] - from >= BOX_LENGTH || i === route.points.length - 1) {
      boxes.push(box);
      box = [lat, lon, lat, lon];
      from = route.distances[i];
    }
  });
  return boxes.map(([s, w, n, e]) => {
    const dLat = CORRIDOR / 110_574;
    const dLon = CORRIDOR / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
    return [s - dLat, w - dLon, n + dLat, e + dLon];
  });
}

export function overpassQuery(boxes: readonly Box[]): string {
  const parts = boxes.map((box) => {
    const bbox = box.map((v) => v.toFixed(6)).join(',');
    return `way["highway"~"${ROADS}"](${bbox});way["railway"="tram"](${bbox});`;
  });
  return `[out:json][timeout:30];(${parts.join('')});(._;>;);out body;`;
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** A busy server answers at once with 429/502/503/504 and asks to be retried with backoff. */
async function request(endpoint: string, data: string, signal: AbortSignal): Promise<Element[]> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]),
    });
    if (response.ok) return ((await response.json()) as { elements: Element[] }).elements;
    if (![429, 502, 503, 504].includes(response.status) || attempt >= BUSY_RETRIES) {
      throw new Error(response.status === 502 || response.status === 504 ? 'přetížený' : `chyba ${response.status}`);
    }
    await sleep(BUSY_RETRY_MS * 2 ** attempt, signal);
  }
}

/** Asks the servers one after another without waiting for a slow one; the first answer wins. */
function query(data: string, signal?: AbortSignal): Promise<Element[]> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const errors: string[] = [];
    let started = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      controller.abort();
    };
    signal?.addEventListener(
      'abort',
      () => {
        finish();
        reject(signal.reason);
      },
      { once: true },
    );
    const startNext = (): void => {
      clearTimeout(timer);
      if (controller.signal.aborted || started >= ENDPOINTS.length) return;
      const endpoint = ENDPOINTS[started++];
      timer = setTimeout(startNext, STAGGER_MS);
      request(endpoint, data, controller.signal).then(
        (elements) => {
          finish();
          resolve(elements);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          const reason =
            error instanceof Error ? (error.name === 'TimeoutError' ? 'neodpovídá' : error.message) : String(error);
          errors.push(`${new URL(endpoint).host}: ${reason}`);
          if (errors.length < ENDPOINTS.length) {
            startNext();
            return;
          }
          finish();
          reject(new Error(`servery Overpass API jsou nedostupné (${errors.join(', ')})`));
        },
      );
    };
    startNext();
  });
}

/** Roads and tram tracks along the route from the Overpass API. */
export async function fetchOsm(route: Route, signal?: AbortSignal): Promise<OsmData> {
  const boxes = boxesAlong(route);
  const nodes = new Map<number, OsmNode>();
  const ways = new Map<number, OsmWay>();
  for (let i = 0; i < boxes.length; i += BOXES_PER_QUERY) {
    for (const element of await query(overpassQuery(boxes.slice(i, i + BOXES_PER_QUERY)), signal)) {
      if (element.type === 'node') nodes.set(element.id, element);
      else if (element.type === 'way') ways.set(element.id, element);
    }
  }
  return { nodes, ways: [...ways.values()] };
}
