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
