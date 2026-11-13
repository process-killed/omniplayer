/**
 * Danmaku (bullet comments) — the feature anime sites expect, in the spirit of
 * ArtPlayer's danmaku plugin but dependency-free.
 *
 * Comments fly across the video in lanes, or sit at the top/bottom. Lanes are
 * assigned so two comments never overlap: each lane remembers when its tail
 * clears the right edge, and a new comment only enters a free lane.
 *
 * Sources: Bilibili XML (`<d p="time,mode,size,color,...">text</d>`), ArtPlayer
 * JSON (`[{time, text, color, mode}]`) and the local composer.
 */

export type DanmakuMode = 'scroll' | 'top' | 'bottom';

export interface DanmakuItem {
  time: number;
  text: string;
  color: string;
  mode: DanmakuMode;
  size: number;
}

export interface DanmakuSettings {
  enabled: boolean;
  opacity: number;
  fontScale: number;
  speed: number;
  area: number;
}

export const DEFAULT_DANMAKU_SETTINGS: DanmakuSettings = {
  enabled: false,
  opacity: 0.9,
  fontScale: 1,
  speed: 1,
  area: 0.5,
};

const COLORS = ['#ffffff', '#ff5c5c', '#ffd166', '#4ade80', '#60a5fa', '#c084fc', '#f472b6'];

/** Bilibili packs colour as a decimal RGB integer. */
function colorFromInt(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '#ffffff';
  const hex = value.toString(16).padStart(6, '0');
  return `#${hex.slice(-6)}`;
}

function normalizeMode(value: string | number | undefined): DanmakuMode {
  const raw = String(value ?? '').toLowerCase();
  if (raw === '4' || raw === 'bottom') return 'bottom';
  if (raw === '5' || raw === 'top') return 'top';
  return 'scroll';
}

/** Parse Bilibili XML or ArtPlayer-style JSON. Returns a time-sorted list. */
export function parseDanmaku(input: string): DanmakuItem[] {
  const text = input.trim();
  if (!text) return [];
  const items: DanmakuItem[] = [];

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed) ? parsed : (parsed as { danmaku?: unknown[] }).danmaku ?? [];
      for (const entry of list as Array<Record<string, unknown>>) {
        const rawTime = entry.time ?? entry.t;
        if (rawTime === undefined) continue; // an entry without a timestamp cannot be placed
        const time = Number(rawTime);
        const content = String(entry.text ?? entry.content ?? '').trim();
        if (!content || !Number.isFinite(time) || time < 0) continue;
        items.push({
          time,
          text: content.slice(0, 200),
          color: typeof entry.color === 'string' ? entry.color : colorFromInt(Number(entry.color ?? 0)),
          mode: normalizeMode(entry.mode as string | number | undefined),
          size: Number(entry.size ?? 25) || 25,
        });
      }
    } catch {
      return [];
    }
    return items.sort((a, b) => a.time - b.time);
  }

  // Bilibili XML
  const pattern = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [time, mode, size, color] = match[1].split(',');
    const content = decodeXml(match[2]).trim();
    const seconds = Number(time);
    if (!content || !Number.isFinite(seconds) || seconds < 0) continue;
    items.push({
      time: seconds,
      text: content.slice(0, 200),
      color: colorFromInt(Number(color)),
      mode: normalizeMode(mode),
      size: Number(size) || 25,
    });
  }
  return items.sort((a, b) => a.time - b.time);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function randomDanmakuColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

/**
 * Renders the comments into a layer above the video.
 *
 * The engine is driven by `tick(time)` from the player's animation loop, so it
 * stays in sync with seeking and speed changes without owning a timer.
 */
export class DanmakuEngine {
  private items: DanmakuItem[] = [];
  private pointer = 0;
  private laneFree: number[] = [];
  private active = new Map<HTMLElement, number>();
  private settings: DanmakuSettings = { ...DEFAULT_DANMAKU_SETTINGS };
  private lastTime = -1;
  /** Hard cap so a dense comment track cannot exhaust memory. */
  private maxActive = 120;
  private spawnedThisSecond = 0;
  private spawnWindow = 0;
  private perSecondCap = 0;
  private readonly layer: HTMLElement;

  constructor(host: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'danmaku-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    host.append(this.layer);
  }

  setItems(items: DanmakuItem[]): void {
    this.items = [...items].sort((a, b) => a.time - b.time);
    this.clear();
    this.pointer = 0;
  }

  add(item: DanmakuItem): void {
    this.items.push(item);
    this.items.sort((a, b) => a.time - b.time);
    this.pointer = this.items.findIndex((entry) => entry.time >= this.lastTime);
    if (this.pointer < 0) this.pointer = this.items.length;
  }

  get count(): number {
    return this.items.length;
  }

  get all(): DanmakuItem[] {
    return [...this.items];
  }

  clear(): void {
    for (const node of this.active.keys()) node.remove();
    this.active.clear();
    this.laneFree = [];
  }

  /** Adaptive rendering frequency (0 = no cap). */
  setRateCap(perSecond: number): void {
    this.perSecondCap = Math.max(0, perSecond);
  }

  /** Hard cap on live comment nodes — a phone should never hold 120. */
  setActiveLimit(limit: number): void {
    this.maxActive = Math.max(8, Math.min(120, limit));
  }

  setSettings(next: Partial<DanmakuSettings>): void {
    this.settings = { ...this.settings, ...next };
    this.layer.style.opacity = String(this.settings.enabled ? this.settings.opacity : 0);
    this.layer.classList.toggle('is-off', !this.settings.enabled);
    if (!this.settings.enabled) this.clear();
  }

  /** Called every frame with the media clock. */
  tick(time: number): void {
    if (!this.settings.enabled) return;
    // A jump backwards (seek) resets the cursor; a big jump forwards skips ahead.
    if (time < this.lastTime - 0.5) {
      this.clear();
      this.pointer = this.items.findIndex((item) => item.time >= time);
      if (this.pointer < 0) this.pointer = this.items.length;
    }
    this.lastTime = time;

    // Adaptive rate: at most N comments per second, and a hard cap on live nodes.
    const second = Math.floor(time);
    if (second !== this.spawnWindow) {
      this.spawnWindow = second;
      this.spawnedThisSecond = 0;
    }
    while (this.pointer < this.items.length && this.items[this.pointer].time <= time) {
      const item = this.items[this.pointer];
      this.pointer += 1;
      if (time - item.time > 1.5) continue; // too late after a jump
      if (this.active.size >= this.maxActive) continue;
      if (this.perSecondCap > 0 && this.spawnedThisSecond >= this.perSecondCap) continue;
      this.spawnedThisSecond += 1;
      this.spawn(item);
    }

    // Retire nodes whose animation finished (the animationend handler also
    // removes them; this catches reduced-motion and hidden tabs).
    const now = performance.now();
    for (const [node, expires] of this.active) {
      if (now > expires) {
        node.remove();
        this.active.delete(node);
      }
    }
  }

  private spawn(item: DanmakuItem): void {
    const host = this.layer;
    const height = host.clientHeight || 1;
    const width = host.clientWidth || 1;
    const fontSize = Math.round(Math.min(28, Math.max(14, item.size * 0.7 * this.settings.fontScale)));

    const node = document.createElement('div');
    node.className = `danmaku danmaku--${item.mode}`;
    node.textContent = item.text;
    node.style.color = item.color;
    node.style.fontSize = `${fontSize}px`;
    node.style.textShadow = '0 1px 2px rgba(0,0,0,.9), 0 0 4px rgba(0,0,0,.7)';

    if (item.mode === 'scroll') {
      const lanes = Math.max(1, Math.floor((height * this.settings.area) / (fontSize + 10)));
      const lane = this.pickLane(lanes, width);
      const top = lane * (fontSize + 10) + 6;
      const duration = Math.max(4, (width / (140 * this.settings.speed)) + item.text.length * 0.06);
      node.style.top = `${top}px`;
      node.style.animationDuration = `${duration}s`;
      node.style.setProperty('--danmaku-from', `${width}px`);
      node.style.setProperty('--danmaku-to', `${-Math.min(width, item.text.length * fontSize * 0.9 + 40)}px`);
      this.laneFree[lane] = performance.now() + duration * 1000 * 0.55;
      this.active.set(node, performance.now() + duration * 1000 + 500);
      host.append(node);
      return;
    }

    node.classList.add('danmaku--static');
    node.style.top = item.mode === 'top' ? `${6 + Math.random() * (height * this.settings.area * 0.3)}px` : '';
    if (item.mode === 'bottom') node.style.bottom = `${6 + Math.random() * (height * this.settings.area * 0.3)}px`;
    node.style.animationDuration = '4.5s';
    this.active.set(node, performance.now() + 5000);
    host.append(node);
  }

  private pickLane(lanes: number, width: number): number {
    const now = performance.now();
    let best = 0;
    let bestFree = Infinity;
    for (let lane = 0; lane < lanes; lane++) {
      const free = this.laneFree[lane] ?? 0;
      if (free <= now) return lane;
      if (free < bestFree) {
        bestFree = free;
        best = lane;
      }
    }
    // Every lane is busy: reuse the soonest one, accepting a small overlap.
    this.laneFree[best] = now + (width / 120) * 1000 * 0.2;
    return best;
  }

  destroy(): void {
    this.clear();
    this.layer.remove();
  }
}
