/**
 * Source health and preference memory.
 *
 * Every attempt records how long the source took to start and whether it failed.
 * Mirrors are then ranked by a score that blends past success with startup time,
 * and the winner per media id is remembered so the next visit starts there.
 */

export interface HealthRecord {
  url: string;
  host: string;
  attempts: number;
  failures: number;
  /** Exponential moving average of startup time, ms. */
  startupMs: number;
  lastUsed: number;
}

const STORAGE_KEY = 'omniplay:source-health:v1';
const PREF_KEY = 'omniplay:source-pref:v1';
const MAX_RECORDS = 120;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'local';
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

export function healthRecords(): HealthRecord[] {
  return read<HealthRecord[]>(STORAGE_KEY, []);
}

/** 0 (bad) … 1 (perfect): success rate weighted against startup time. */
export function scoreOf(record: HealthRecord | undefined, now = Date.now()): number {
  if (!record || record.attempts === 0) return 0.5; // unknown sources start neutral
  const success = 1 - record.failures / record.attempts;
  const speed = 1 / (1 + record.startupMs / 4000);
  const ageDays = (now - record.lastUsed) / 86_400_000;
  const freshness = 1 / (1 + Math.max(0, ageDays) / 14);
  return success * 0.55 + speed * 0.3 + freshness * 0.15;
}

export function recordAttempt(url: string, outcome: { ok: boolean; startupMs?: number }): void {
  const records = healthRecords();
  const host = hostOf(url);
  let record = records.find((entry) => entry.url === url);
  if (!record) {
    record = { url, host, attempts: 0, failures: 0, startupMs: 0, lastUsed: 0 };
    records.push(record);
  }
  record.attempts += 1;
  if (!outcome.ok) record.failures += 1;
  if (outcome.startupMs && outcome.startupMs > 0) {
    record.startupMs = record.startupMs === 0 ? outcome.startupMs : record.startupMs * 0.7 + outcome.startupMs * 0.3;
  }
  record.lastUsed = Date.now();
  write(STORAGE_KEY, records.slice(-MAX_RECORDS));
}

/** Order mirrors best-first; unknown sources keep their original order after known ones. */
export function rankSources(urls: string[]): string[] {
  const records = healthRecords();
  const scored = urls.map((url, index) => ({
    url,
    index,
    score: scoreOf(records.find((entry) => entry.url === url)),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.url);
}

export function rememberSource(mediaId: string, url: string): void {
  const prefs = read<Record<string, string>>(PREF_KEY, {});
  prefs[mediaId] = url;
  write(PREF_KEY, prefs);
}

export function preferredSource(mediaId: string): string | null {
  return read<Record<string, string>>(PREF_KEY, {})[mediaId] ?? null;
}

/** Reset everything (Settings → Advanced). */
export function clearSourceHealth(): void {
  write(STORAGE_KEY, []);
  write(PREF_KEY, {});
}
