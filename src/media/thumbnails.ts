import type { MediaSourceSpec } from '../types';
import { dbGet, dbPut } from '../storage/db';
import type { Settings } from '../types';
import { proxiedUrl } from '../core/net';

export interface StoryboardFrame {
  time: number;
  dataUrl: string;
}

const posterCache = new Map<string, string | null>();
const storyboardCache = new Map<string, StoryboardFrame[]>();
/** Keep at most a few storyboards in memory; data URLs are the expensive part. */
const MAX_STORYBOARDS = 3;
/** Hosts that refused CORS: never retry them for posters or storyboards. */
const blockedHosts = new Set<string>();

/**
 * Thumbnails and timeline previews.
 *
 * Frames are decoded at a small size (never full resolution) so a 4 GB file
 * costs a few hundred kilobytes of memory, not gigabytes.
 */
class ThumbnailService {
  private settingsProvider: (() => Settings) | null = null;

  /** The player wires this so thumbnails honour the CORS proxy too. */
  setSettingsProvider(provider: () => Settings): void {
    this.settingsProvider = provider;
  }

  private sourceUrl(url: string): string {
    return proxiedUrl(url, this.settingsProvider?.() ?? null);
  }
  private inFlight = new Map<string, Promise<string | null>>();

  private isBlocked(spec: MediaSourceSpec): boolean {
    if (spec.corsBlocked) return true;
    if (spec.kind === 'url' && spec.url) {
      try {
        if (blockedHosts.has(new URL(spec.url).origin)) return true;
      } catch {
        /* ignore malformed URLs */
      }
    }
    return false;
  }

  private markBlocked(spec: MediaSourceSpec): void {
    if (spec.kind !== 'url' || !spec.url) return;
    try {
      blockedHosts.add(new URL(spec.url).origin);
    } catch {
      /* ignore */
    }
    spec.corsBlocked = true;
  }

  async getPoster(spec: MediaSourceSpec, at = 1.5): Promise<string | null> {
    const key = `poster:${spec.id}`;
    if (posterCache.has(key)) return posterCache.get(key) ?? null;
    if (this.isBlocked(spec)) {
      posterCache.set(key, null);
      return null;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = (async () => {
      const cached = await dbGet<{ id: string; dataUrl: string }>('thumbs', key).catch(() => undefined);
      if (cached?.dataUrl) {
        posterCache.set(key, cached.dataUrl);
        return cached.dataUrl;
      }
      const dataUrl = await this.captureFrame(spec, at, 480);
      if (!dataUrl && spec.kind === 'url') this.markBlocked(spec);
      posterCache.set(key, dataUrl);
      if (dataUrl) void dbPut('thumbs', { id: key, dataUrl }).catch(() => undefined);
      return dataUrl;
    })();

    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async getStoryboard(spec: MediaSourceSpec, duration: number, count = 12): Promise<StoryboardFrame[]> {
    // Evict the oldest storyboard when the cache is full.
    while (storyboardCache.size >= MAX_STORYBOARDS) {
      const oldest = storyboardCache.keys().next().value;
      if (oldest === undefined) break;
      storyboardCache.delete(oldest);
    }
    const key = `board:${spec.id}:${Math.round(duration)}`;
    const cached = storyboardCache.get(key);
    if (cached) return cached;
    if (!Number.isFinite(duration) || duration <= 5) return [];
    if (this.isBlocked(spec)) {
      storyboardCache.set(key, []);
      return [];
    }

    const frames: StoryboardFrame[] = [];
    try {
      const mb = await import('mediabunny');
      const source = spec.file
        ? new mb.BlobSource(spec.file)
        : new mb.UrlSource(this.sourceUrl(spec.url ?? ''), { requestInit: spec.headers ? { headers: spec.headers } : undefined });
      const input = new mb.Input({ formats: mb.ALL_FORMATS, source });
      try {
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) return [];
        const sink = new mb.CanvasSink(videoTrack, { width: 200 });
        for (let i = 0; i < count; i++) {
          const time = (duration * (i + 0.5)) / count;
          const frame = await sink.getCanvas(time);
          if (!frame) continue;
          const dataUrl = canvasToDataUrl(frame.canvas as HTMLCanvasElement | OffscreenCanvas, 200);
          if (dataUrl) frames.push({ time, dataUrl });
        }
      } finally {
        input.dispose();
      }
    } catch {
      if (spec.kind === 'url') this.markBlocked(spec);
      storyboardCache.set(key, []);
      return [];
    }
    storyboardCache.set(key, frames);
    return frames;
  }

  private async captureFrame(spec: MediaSourceSpec, at: number, width: number): Promise<string | null> {
    try {
      const mb = await import('mediabunny');
      const source = spec.file
        ? new mb.BlobSource(spec.file)
        : new mb.UrlSource(this.sourceUrl(spec.url ?? ''), { requestInit: spec.headers ? { headers: spec.headers } : undefined });
      const input = new mb.Input({ formats: mb.ALL_FORMATS, source });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) return null;
        const sink = new mb.CanvasSink(track, { width });
        const frame = await sink.getCanvas(at);
        if (!frame) return null;
        return canvasToDataUrl(frame.canvas as HTMLCanvasElement | OffscreenCanvas, width);
      } finally {
        input.dispose();
      }
    } catch {
      return null;
    }
  }
}

function canvasToDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas, width: number): string | null {
  try {
    if ('convertToBlob' in canvas) return null; // OffscreenCanvas handled by caller path
    const source = canvas as HTMLCanvasElement;
    if (!source.width || !source.height) return null;
    const target = document.createElement('canvas');
    target.width = width;
    target.height = Math.round((source.height / source.width) * width) || 1;
    const ctx = target.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return target.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

export const thumbnails = new ThumbnailService();
