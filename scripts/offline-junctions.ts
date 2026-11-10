// stahne silnice a tramvajove trate mesta z Overpass API a ulozi jeho krizovatky pro hru bez Overpass:
// npm run junctions:brno -> data/junctions-brno.json (bbox souboru prepsat do src/route/offline.ts)
import fs from 'node:fs';
import path from 'node:path';
import { findSites } from '../src/route/junctions';
import { ENDPOINTS, ROADS, type OsmData, type OsmNode, type OsmWay } from '../src/route/osm';

const AREA = process.argv[2] ?? 'Brno';
const OUTPUT = path.resolve(`data/junctions-${AREA.toLowerCase()}.json`);
const QUERY =
  `[out:json][timeout:300];area["name"="${AREA}"]["admin_level"="8"]->.a;` +
  `(way(area.a)["highway"~"${ROADS}"];way(area.a)["railway"="tram"];);(._;>;);out body;`;

type Element = ({ type: 'node' } & OsmNode) | ({ type: 'way' } & OsmWay);

async function download(): Promise<Element[]> {
  for (const endpoint of ENDPOINTS) {
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        // node's default User-Agent is refused by overpass-api.de
        headers: { 'User-Agent': 'crossroads-junctions/1.0 (https://app.makuderovi.cz/crossroads/)' },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(330_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { elements } = (await response.json()) as { elements: Element[] };
      console.log(
        `${new URL(endpoint).host}: ${elements.length} prvků za ${Math.round((Date.now() - started) / 1000)} s`,
      );
      return elements;
    } catch (error) {
      console.warn(`${new URL(endpoint).host}: ${error instanceof Error ? error.message : error}`);
    }
  }
  throw new Error('Žádný server Overpass API neodpověděl.');
}

async function main(): Promise<void> {
  const elements = await download();
  const data: OsmData = { nodes: new Map(), ways: [] };
  for (const element of elements) {
    if (element.type === 'node') data.nodes.set(element.id, element);
    else if (element.type === 'way') data.ways.push(element);
  }
  const started = Date.now();
  const sites = findSites(data);
  const lons = sites.map((s) => s.center[0]);
  const lats = sites.map((s) => s.center[1]);
  const bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  const file = {
    area: AREA,
    generated: new Date().toISOString(),
    source: '© OpenStreetMap contributors, ODbL',
    bbox,
    sites,
  };
  const round = (_key: string, value: unknown): unknown =>
    typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e6) / 1e6 : value;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(file, round));
  console.log(
    `${sites.length} křižovatek za ${Date.now() - started} ms, ${Math.round(fs.statSync(OUTPUT).size / 1024)} kB -> ${OUTPUT}`,
  );
  console.log(`bbox [západ, jih, východ, sever]: ${JSON.stringify(bbox.map((v) => Math.round(v * 1e4) / 1e4))}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
