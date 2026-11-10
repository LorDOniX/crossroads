/** Results kept in the browser (localStorage). */
export type Mode = 'test' | 'exam' | 'practice';

export interface TypeStat {
  played: number;
  correct: number;
}

export interface GameRecord {
  date: string;
  mode: Mode;
  percent: number;
  seed: number;
}

export interface Stats {
  byType: Record<string, TypeStat>;
  best: Partial<Record<Mode, number>>;
  history: GameRecord[];
}

const STORAGE_KEY = 'crossroads-stats-v1';
const HISTORY_SIZE = 10;

const empty = (): Stats => ({ byType: {}, best: {}, history: [] });

export function loadStats(): Stats {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<Stats>;
    return {
      byType: parsed.byType ?? {},
      best: parsed.best ?? {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return empty();
  }
}

function save(stats: Stats): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function recordRound(type: string, correct: boolean): void {
  const stats = loadStats();
  const stat = stats.byType[type] ?? { played: 0, correct: 0 };
  stats.byType[type] = { played: stat.played + 1, correct: stat.correct + (correct ? 1 : 0) };
  save(stats);
}

export function recordGame(record: GameRecord): void {
  const stats = loadStats();
  stats.best[record.mode] = Math.max(stats.best[record.mode] ?? 0, record.percent);
  stats.history = [record, ...stats.history].slice(0, HISTORY_SIZE);
  save(stats);
}

export function resetStats(): void {
  save(empty());
}

const SETTINGS_KEY = 'crossroads-settings-v1';

export interface Settings {
  /** Select everybody who may go at once and confirm, instead of clicking road users one by one. */
  multiSelect: boolean;
}

export function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '') as Partial<Settings>;
    return { multiSelect: parsed.multiSelect === true };
  } catch {
    return { multiSelect: false };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// bump the version when the junction detection changes
const ROUTES_KEY = 'crossroads-routes-v2';
const ROUTES_SIZE = 10;

/** Short key of a route string (FNV-1a). */
export function routeCacheKey(route: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < route.length; i++) h = Math.imul(h ^ route.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}-${route.length}`;
}

function loadRoutes(): Record<string, unknown> {
  try {
    return (JSON.parse(localStorage.getItem(ROUTES_KEY) ?? '') as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** Data computed for a route (its junctions), so that OpenStreetMap is asked only once. */
export function loadRouteData<T>(key: string): T | null {
  return (loadRoutes()[key] as T | undefined) ?? null;
}

export function saveRouteData(key: string, data: unknown): void {
  const routes = loadRoutes();
  delete routes[key];
  routes[key] = data;
  for (const old of Object.keys(routes).slice(0, -ROUTES_SIZE)) delete routes[old];
  try {
    localStorage.setItem(ROUTES_KEY, JSON.stringify(routes));
  } catch {
    // full storage only costs another download next time
  }
}
