import type { Cue, Settings } from '../types';
import { decodeSubtitleBuffer, parseSubtitle, type SubtitleDocument, type SubtitleFormat } from './parser';
import { renderAssCue, renderPlainCue, updateAssCue, type AssRenderedCue } from './assRenderer';
import { AppError } from '../core/errors';
import { decodePgs, looksLikePgs, splitSupFile, type PgsCue } from './pgs';

export interface SubtitleTrack {
  id: string;
  label: string;
  language?: string;
  format: SubtitleFormat;
  doc: SubtitleDocument;
  source: 'external' | 'embedded' | 'engine';
  offsetMs: number;
  fileName?: string;
  /** Bitmap cues (PGS/DVD) — rendered on a canvas layer, not as text. */
  images?: PgsCue[];
}

let trackCounter = 0;

/**
 * Owns every subtitle track: external files, embedded text tracks and cues the
 * engine exposes. Renders into a DOM overlay above the video, so styling,
 * delays and positioning are under the user's control.
 */
export class SubtitleManager {
  private tracksValue: SubtitleTrack[] = [];
  private activeId: string | null = null;
  private renderedPlain: HTMLElement[] = [];
  private renderedAss: AssRenderedCue[] = [];
  private lastSignature = '';
  private settings: Settings | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastScaleUpdate = 0;

  private bitmapLayer: HTMLCanvasElement | null = null;
  private proxy: ((url: string) => string) | null = null;
  private mediaWidth = 0;
  private mediaHeight = 0;
  private lastImageSignature = '';

  constructor(
    private readonly overlay: HTMLElement,
    private readonly assLayer: HTMLElement,
    bitmapLayer?: HTMLCanvasElement | null,
  ) {
    this.bitmapLayer = bitmapLayer ?? null;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.applyScale());
      this.resizeObserver.observe(this.overlay);
    }
  }

  get tracks(): SubtitleTrack[] {
    return this.tracksValue;
  }

  get active(): SubtitleTrack | null {
    return this.tracksValue.find((track) => track.id === this.activeId) ?? null;
  }

  /** Let the player apply its CORS proxy to subtitle downloads too. */
  setProxyResolver(resolve: (url: string) => string): void {
    this.proxy = resolve;
  }

  private proxyUrl(url: string): string {
    return this.proxy ? this.proxy(url) : url;
  }

  /** Native size of the picture, used to place bitmap subtitles. */
  setMediaDimensions(width: number, height: number): void {
    if (width === this.mediaWidth && height === this.mediaHeight) return;
    this.mediaWidth = width;
    this.mediaHeight = height;
    this.lastImageSignature = '';
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.applyStyle();
    this.applyScale();
  }

  applyStyle(): void {
    const settings = this.settings;
    if (!settings) return;
    const style = this.overlay.style;
    style.setProperty('--sub-font', `'${settings.subtitleFont}', 'Inter', sans-serif`);
    style.setProperty('--sub-color', settings.subtitleColor);
    style.setProperty('--sub-outline', `${settings.subtitleOutline}px`);
    style.setProperty('--sub-shadow', `${settings.subtitleShadow}px`);
    style.setProperty('--sub-opacity', String(settings.subtitleOpacity));
    style.setProperty('--sub-weight', String(settings.subtitleWeight));
    style.setProperty('--sub-bottom', `${settings.subtitlePosition}%`);
    style.setProperty('--sub-width', `${settings.subtitleWidth}%`);
    this.applyScale();
  }

  private applyScale(): void {
    const height = this.overlay.clientHeight || 720;
    const settings = this.settings;
    const base = settings?.subtitleSize ?? 26;
    // 26px is tuned for a 720p-tall viewport; scale with the player.
    const size = Math.max(10, (base * height) / 720);
    this.overlay.style.setProperty('--sub-size', `${size}px`);
    const active = this.active;
    const resY = active?.doc.playResY || 288;
    this.assLayer.style.setProperty('--ass-scale', String(height / resY));
  }

  /* ---------------------------------------------------------------- loading */

  async loadFile(file: File, options: { language?: string } = {}): Promise<SubtitleTrack> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // PGS bitmap subtitles (.sup) are binary, not text.
    if (/\.sup$/i.test(file.name) || looksLikePgs(bytes)) {
      const cues = decodePgs(splitSupFile(bytes));
      const track = this.addImageCues(cues, file.name.replace(/\.[^.]+$/, ''), `sup_${++trackCounter}`, options.language);
      if (!track) {
        throw new AppError('subtitle-failed', {
          message: 'No bitmap subtitles were found',
          detail: 'The .sup file contains no display sets this decoder understands.',
        });
      }
      this.select(track.id);
      return track;
    }

    const text = decodeSubtitleBuffer(buffer, detectEncodingFromName(file.name));
    return this.loadText(text, file.name, { language: options.language, fileName: file.name });
  }

  async loadUrl(url: string, options: { language?: string; headers?: Record<string, string> } = {}): Promise<SubtitleTrack> {
    let response: Response;
    try {
      response = await fetch(this.proxyUrl(url), { headers: options.headers, credentials: 'omit' });
    } catch (error) {
      throw new AppError('cors', {
        message: 'The subtitle file could not be fetched',
        detail: (error as Error).message,
      });
    }
    if (!response.ok) {
      throw new AppError('network', { detail: `HTTP ${response.status} for subtitle URL` });
    }
    const buffer = await response.arrayBuffer();
    const text = decodeSubtitleBuffer(buffer);
    const name = url.split('/').pop()?.split('?')[0] ?? 'Subtitles';
    return this.loadText(text, name, { language: options.language });
  }

  loadText(text: string, name: string, options: { language?: string; fileName?: string; source?: SubtitleTrack['source'] } = {}): SubtitleTrack {
    const doc = parseSubtitle(text, name);
    return this.addDocument(doc, name, options);
  }

  /** Register an already-parsed document (embedded tracks, engine cues). */
  addDocument(
    doc: SubtitleDocument,
    name: string,
    options: { id?: string; language?: string; fileName?: string; source?: SubtitleTrack['source'] } = {},
  ): SubtitleTrack {
    if (doc.cues.length === 0) {
      throw new AppError('subtitle-failed', {
        message: `“${name}” has no readable cues`,
        detail: doc.warnings.join(' ') || 'The file did not contain any timed text.',
      });
    }
    const existing = options.id ? this.tracksValue.find((track) => track.id === options.id) : undefined;
    if (existing) {
      existing.doc = doc;
      return existing;
    }
    const track: SubtitleTrack = {
      id: options.id ?? `sub_${++trackCounter}`,
      label: name.replace(/\.[^.]+$/, ''),
      language: options.language,
      format: doc.format,
      doc,
      source: options.source ?? 'external',
      offsetMs: this.settings?.subtitleDelayMs ?? 0,
      fileName: options.fileName,
    };
    this.tracksValue.push(track);
    this.select(track.id);
    return track;
  }

  addEmbeddedCues(cues: Cue[], label: string, id: string, language?: string): SubtitleTrack | null {
    if (cues.length === 0) return null;
    const existing = this.tracksValue.find((track) => track.id === id);
    if (existing) return existing;
    const track: SubtitleTrack = {
      id,
      label,
      language,
      format: 'srt',
      doc: {
        format: 'srt',
        cues,
        styles: {},
        playResX: 384,
        playResY: 288,
        wrapped: true,
        warnings: [],
      },
      source: 'embedded',
      offsetMs: 0,
    };
    this.tracksValue.push(track);
    return track;
  }

  /** Register decoded bitmap subtitles (PGS, DVD). */
  addImageCues(cues: PgsCue[], label: string, id: string, language?: string): SubtitleTrack | null {
    if (cues.length === 0) return null;
    const existing = this.tracksValue.find((track) => track.id === id);
    if (existing) {
      existing.images = cues;
      this.select(existing.id);
      return existing;
    }
    const track: SubtitleTrack = {
      id,
      label,
      language,
      format: 'pgs',
      doc: { format: 'unknown', cues: [], styles: {}, playResX: 1920, playResY: 1080, wrapped: true, warnings: [] },
      source: 'embedded',
      offsetMs: 0,
      images: cues,
    };
    this.tracksValue.push(track);
    this.select(track.id);
    return track;
  }

  /* -------------------------------------------------------------- selection */

  select(id: string | null): void {
    this.activeId = id;
    this.clearRendered();
    this.lastSignature = '';
    this.lastImageSignature = '';
    this.applyScale();
  }

  setOffset(id: string, offsetMs: number): void {
    const track = this.tracksValue.find((item) => item.id === id);
    if (!track) return;
    track.offsetMs = offsetMs;
    this.lastSignature = '';
  }

  nudgeOffset(deltaMs: number): number {
    const track = this.active;
    if (!track) return 0;
    track.offsetMs = Math.max(-60000, Math.min(60000, track.offsetMs + deltaMs));
    this.lastSignature = '';
    return track.offsetMs;
  }

  remove(id: string): void {
    this.tracksValue = this.tracksValue.filter((track) => track.id !== id);
    if (this.activeId === id) this.select(null);
  }

  clearAll(): void {
    this.tracksValue = [];
    this.select(null);
  }

  private clearRendered(): void {
    for (const node of this.renderedPlain) node.remove();
    this.renderedPlain = [];
    for (const rendered of this.renderedAss) rendered.element.remove();
    this.renderedAss = [];
    this.overlay.innerHTML = '';
    this.assLayer.innerHTML = '';
    this.clearBitmap();
  }

  private clearBitmap(): void {
    const canvas = this.bitmapLayer;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.lastImageSignature = '';
  }

  /**
   * The bitmap canvas lives in the stage, not in the text overlay (which is
   * hidden while images are showing), so measure the stage instead.
   */
  private stageBox(): { width: number; height: number } {
    const host = this.bitmapLayer?.parentElement ?? this.overlay;
    return {
      width: host.clientWidth || this.overlay.clientWidth || 1,
      height: host.clientHeight || this.overlay.clientHeight || 1,
    };
  }

  /** The area the picture actually occupies inside the stage (letterbox aware). */
  private contentRect(): { x: number; y: number; width: number; height: number } {
    const { width, height } = this.stageBox();
    if (!this.mediaWidth || !this.mediaHeight) return { x: 0, y: 0, width, height };
    const scale = Math.min(width / this.mediaWidth, height / this.mediaHeight);
    const w = this.mediaWidth * scale;
    const h = this.mediaHeight * scale;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
  }

  /** Paint active bitmap cues; PGS coordinates are authored against a fixed canvas. */
  private renderImages(images: PgsCue[], time: number): void {
    const canvas = this.bitmapLayer;
    if (!canvas) return;

    let low = 0;
    let high = images.length - 1;
    let last = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (images[mid].start <= time) {
        last = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const active: PgsCue[] = [];
    for (let index = last; index >= 0 && index > last - 8; index--) {
      if (images[index].end >= time) active.push(images[index]);
    }

    const signature = active.map((cue) => `${cue.start}-${cue.end}-${cue.canvas.width}`).join('|');
    if (signature === this.lastImageSignature) return;
    this.lastImageSignature = signature;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { width: cssWidth, height: cssHeight } = this.stageBox();
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (active.length === 0) return;
    const rect = this.contentRect();
    this.overlay.classList.add('hidden');
    this.assLayer.classList.add('hidden');

    for (const cue of active) {
      const scaleX = rect.width / cue.screenWidth;
      const scaleY = rect.height / cue.screenHeight;
      ctx.drawImage(
        cue.canvas,
        rect.x + cue.x * scaleX,
        rect.y + cue.y * scaleY,
        cue.width * scaleX,
        cue.height * scaleY,
      );
    }
  }

  /* ----------------------------------------------------------------- render */

  tick(currentTime: number): void {
    const settings = this.settings;
    const track = this.active;
    if (!settings || !track || !settings.subtitleEnabled) {
      if (this.renderedPlain.length || this.renderedAss.length) this.clearRendered();
      return;
    }

    const now = performance.now();
    if (now - this.lastScaleUpdate > 500) {
      this.lastScaleUpdate = now;
      this.applyScale();
    }

    const time = currentTime + track.offsetMs / 1000;

    if (track.images && track.images.length > 0) {
      this.renderImages(track.images, time);
      return;
    }

    const active = activeCues(track.doc.cues, time);
    const signature = `${track.id}:${active.map((cue) => `${cue.start}-${cue.end}-${cue.text.length}`).join('|')}`;

    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.clearRendered();
      if (active.length > 0) {
        if (track.format === 'ass' || track.format === 'ssa') {
          this.assLayer.classList.remove('hidden');
          this.overlay.classList.add('hidden');
          for (const cue of active) {
            const rendered = renderAssCue(cue, track.doc);
            this.assLayer.append(rendered.element);
            this.renderedAss.push(rendered);
          }
        } else {
          this.assLayer.classList.add('hidden');
          this.overlay.classList.remove('hidden');
          active.forEach((cue, index) => {
            const node = renderPlainCue(cue);
            if (index > 0) {
              node.style.bottom = `calc(var(--sub-bottom) + ${index * 1.45}em)`;
            }
            if (settings.subtitleBackground > 0) {
              node.style.background = `rgba(0, 0, 0, ${settings.subtitleBackground})`;
              node.style.padding = '0.08em 0.35em';
              node.style.borderRadius = '4px';
              node.style.boxDecorationBreak = 'clone';
            }
            this.overlay.append(node);
            this.renderedPlain.push(node);
          });
        }
      }
    }

    for (const rendered of this.renderedAss) {
      updateAssCue(rendered, time, settings.subtitleOpacity);
    }
  }

  /** Hide everything (e.g. when the player is not visible). */
  hide(): void {
    this.clearRendered();
    this.lastSignature = '';
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.clearAll();
    this.tracksValue = [];
  }
}

/**
 * Cues are sorted by start time, so a binary search finds the last candidate and
 * a short backward scan collects overlaps. This runs every frame, so it must not
 * iterate a thousand cues each time.
 */
function activeCues(cues: Cue[], time: number): Cue[] {
  let low = 0;
  let high = cues.length - 1;
  let last = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= time) {
      last = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (last < 0) return [];
  const active: Cue[] = [];
  for (let index = last; index >= 0 && index > last - 80; index--) {
    const cue = cues[index];
    if (cue.end >= time) active.push(cue);
  }
  return active.sort((a, b) => a.start - b.start);
}

function detectEncodingFromName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.includes('utf16') || lower.includes('utf-16')) return 'utf-16le';
  if (lower.includes('1251') || lower.includes('cp1251')) return 'windows-1251';
  if (lower.includes('1252')) return 'windows-1252';
  return undefined;
}
