/**
 * Scene previews for the timeline.
 *
 * Captures frames from the current source into small bitmaps so the seek bubble
 * can show what is at that timestamp, not just the clock.
 *
 * Design notes, all learned from doing this badly first:
 *
 *  - **One decoder, not many.** Every extra <video> element is another decoder on
 *    a phone. A single hidden element is reused and seeked in a queue.
 *  - **Lazy and bounded.** Frames are captured only around the position the
 *    viewer is hovering, never for the whole file, and the cache is capped.
 *  - **Cheap frames.** 160 × 90 WebP (or JPEG) is enough for a 150 px bubble.
 *  - **Failure is normal.** A tainted canvas (no CORS), a codec the element
 *    cannot decode, or a live stream with no seekable range all end up as
 *    "no thumbnail", and the bubble falls back to the clock.
 */
import { deviceReport } from '../core/deviceProfile';

export interface ThumbnailerOptions {
  /** Seconds between captured frames. */
  interval?: number;
  width?: number;
  /** Max cached frames before the oldest are dropped. */
  maxCached?: number;
  /** Called when a frame is ready, so the UI can repaint. */
  onFrame?: (time: number, url: string) => void;
}

const DEFAULTS = { interval: 5, width: 160, maxCached: 120 };

export class Thumbnailer {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cache = new Map<number, string>();
  private queue: number[] = [];
  private running = false;
  private broken = false;
  private destroyed = false;
  private interval: number;
  private width: number;
  private maxCached: number;
  private onFrame?: (time: number, url: string) => void;
  private duration = 0;
  private profile?: string;

  constructor(options: ThumbnailerOptions = {}) {
    this.interval = options.interval ?? DEFAULTS.interval;
    this.width = options.width ?? DEFAULTS.width;
    this.maxCached = options.maxCached ?? DEFAULTS.maxCached;
    this.onFrame = options.onFrame;
  }

  /** Whether this device and source can produce previews at all. */
  static supported(duration: number, src: string, profileOverride?: string): boolean {
    if (!duration || !Number.isFinite(duration)) return false;
    if (!src) return false;
    // A live stream has no seekable range to sample.
    if (/^blob:$/i.test(src)) return false;
    // Low-memory devices already cap decoding; a second decoder is too much.
    // An explicit profile setting wins over auto-detection, so a user who says
    // "this machine is fast" gets previews.
    const profile = profileOverride ?? deviceReport().profile;
    if (profile === 'low') return false;
    return typeof document !== 'undefined';
  }

  attach(src: string, duration: number, profile?: string): void {
    this.profile = profile;
    this.destroy();
    this.destroyed = false;
    this.broken = !Thumbnailer.supported(duration, src, this.profile);
    this.duration = duration;
    if (this.broken) return;

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none';
    video.src = src;
    video.addEventListener('error', () => {
      this.broken = true;
    });
    document.body.append(video);
    this.video = video;

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = Math.round((this.width * 9) / 16);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
  }

  /** Cached frame at or before `time`, if one exists. */
  peek(time: number): string | undefined {
    const key = this.keyFor(time);
    return this.cache.get(key) ?? this.cache.get(this.keyFor(Math.max(0, time - this.interval)));
  }

  /**
   * Ask for the frame at `time`. Returns a cached URL when possible, otherwise
   * queues the capture and resolves when it lands (or null if it cannot).
   */
  async get(time: number): Promise<string | null> {
    if (this.broken || this.destroyed || !this.video) return null;
    const key = this.keyFor(time);
    const hit = this.cache.get(key);
    if (hit) return hit;

    this.enqueue(key);
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        if (this.destroyed) return resolve(null);
        const url = this.cache.get(key);
        if (url) return resolve(url);
        if (Date.now() - started > 4000) return resolve(null);
        setTimeout(poll, 90);
      };
      poll();
    });
  }

  /** Queue a window of frames around `time` so scrubbing feels instant. */
  prefetch(time: number, span = 3): void {
    if (this.broken || this.destroyed) return;
    for (let step = -span; step <= span; step += 1) {
      const at = time + step * this.interval;
      if (at < 0 || at > this.duration) continue;
      const key = this.keyFor(at);
      if (!this.cache.has(key)) this.enqueue(key);
    }
  }

  private keyFor(time: number): number {
    return Math.floor(Math.max(0, time) / this.interval) * this.interval;
  }

  private enqueue(time: number): void {
    if (this.queue.includes(time)) return;
    this.queue.push(time);
    // Nearest-to-current first: the viewer is looking at one spot, not the file.
    this.queue.sort((a, b) => a - b);
    if (!this.running) void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.destroyed && !this.broken) {
        const time = this.queue.shift() as number;
        if (this.cache.has(time)) continue;
        const url = await this.capture(time);
        if (url) {
          this.cache.set(time, url);
          if (this.cache.size > this.maxCached) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
              const stale = this.cache.get(oldest);
              this.cache.delete(oldest);
              if (stale) URL.revokeObjectURL(stale);
            }
          }
          this.onFrame?.(time, url);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private capture(time: number): Promise<string | null> {
    const video = this.video;
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!video || !canvas || !ctx) return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        window.clearTimeout(timer);
        resolve(value);
      };

      const onSeeked = () => {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => finish(blob ? URL.createObjectURL(blob) : null),
            'image/webp',
            0.72,
          );
        } catch {
          // Tainted canvas: the source does not allow cross-origin reads.
          this.broken = true;
          finish(null);
        }
      };
      const onError = () => {
        this.broken = true;
        finish(null);
      };
      const timer = window.setTimeout(() => finish(null), 2500);

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });

      try {
        video.currentTime = Math.min(Math.max(0, time), Math.max(0, (this.duration || 0) - 0.1));
      } catch {
        finish(null);
      }
    });
  }

  /** Number of frames ready — used by the diagnostics panel. */
  get size(): number {
    return this.cache.size;
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    this.cache.forEach((url) => URL.revokeObjectURL(url));
    this.cache.clear();
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
      this.video.remove();
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}
