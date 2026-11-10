import type { JunctionSite } from './junctions';
import type { Route } from './route';

interface OfflineFile {
  area: string;
  generated: string;
  sites: JunctionSite[];
}

/** Areas prepared by scripts/offline-junctions.ts; bbox [west, south, east, north] printed by the script. */
const AREAS = [
  {
    bbox: [16.4493, 49.1239, 16.7174, 49.2927],
    url: new URL('../../data/junctions-brno.json', import.meta.url),
  },
];

/** Junctions of a prepared area containing the whole route, or null when there is none. */
export async function loadOfflineSites(route: Route, signal?: AbortSignal): Promise<JunctionSite[] | null> {
  const area = AREAS.find(({ bbox: [west, south, east, north] }) =>
    route.points.every(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north),
  );
  if (!area) return null;
  const response = await fetch(area.url, { signal });
  if (!response.ok) throw new Error(`offline data nejdou načíst (chyba ${response.status})`);
  return ((await response.json()) as OfflineFile).sites;
}
