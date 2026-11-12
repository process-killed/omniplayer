import type { EngineCapabilities, EngineEvents, EngineKind, QualityLevel, ResolvedSource, Settings, TrackInfo } from '../types';
import { BaseEngine } from './base';
import { NativeEngine } from './native';
import { AppError } from '../core/errors';
import { hasProxy, proxiedUrl } from '../core/net';
import { installXhrProxy } from '../core/xhrProxy';
import { budgetsFor, deviceReport } from '../core/deviceProfile';
import { isFatalDashError } from '../core/errorPolicy';
import { languageName } from '../utils/format';

/**
 * dash.js ships generated typings that omit several long-standing public
 * methods, so the player is described structurally here instead of trusting
 * the package types. Only the methods OmniPlay calls are declared.
 */

interface DashTrack {
  index: number;
  lang?: string;
  codec?: string;
  labels?: Array<{ text: string; lang?: string }>;
  roles?: Array<{ schemeIdUri: string; value: string }>;
}

interface BitrateInfo {
  qualityIndex: number;
  bitrate: number;
  width?: number;
  height?: number;
}

interface DashPlayer {
  initialize(view: HTMLMediaElement, source: string, autoPlay?: boolean, startTime?: number): void;
  updateSettings(settings: Record<string, unknown>): void;
  on(type: string, listener: (event: Record<string, unknown>) => void): void;
  off(type: string, listener: (event: Record<string, unknown>) => void): void;
  reset(): void;
  isDynamic(): boolean;
  getBitrateInfoListFor(type: string): BitrateInfo[];
  getQualityFor(type: string): number;
  setQualityFor(type: string, index: number): void;
  getAutoSwitchQualityFor(type: string): boolean;
  setAutoSwitchQualityFor(type: string, value: boolean): void;
  getTracksFor(type: string): DashTrack[];
  getCurrentTrackFor(type: string): DashTrack | null;
  setCurrentTrack(track: DashTrack): void;
  setTextTrack(index: number): void;
}

interface DashModule {
  MediaPlayer: (() => { create: () => DashPlayer }) & { events: Record<string, string> };
}

const EVENTS = {
  streamInitialized: 'streamInitialized',
  qualityChangeRendered: 'qualityChangeRendered',
  error: 'error',
};

/** MPEG-DASH playback through dash.js. */
export class DashEngine extends BaseEngine {
  readonly kind: EngineKind = 'dash';
  readonly capabilities: EngineCapabilities = {
    seek: true,
    audioTracks: true,
    subtitleTracks: true,
    qualityLevels: true,
    live: true,
    audioGraph: true,
    pitchPreserved: true,
    frameStep: false,
  };

  override readonly video: HTMLVideoElement;
  private readonly inner: NativeEngine;
  private player: DashPlayer | null = null;
  private levels: QualityLevel[] = [];
  private activeQuality = 'auto';

  constructor(private readonly settings: Settings) {
    super();
    this.inner = new NativeEngine(true);
    this.video = this.inner.video;
    this.forward('meta');
    this.forward('duration');
    this.forward('time');
    this.forward('state');
    this.forward('volume');
    this.forward('rate');
    this.forward('buffered');
    this.forward('seeked');
    this.forward('error');
  }

  private forward<K extends keyof EngineEvents>(event: K): void {
    this.inner.on(event, (payload) => this.emit(event, payload));
  }

  attach(container: HTMLElement): void {
    this.inner.attach(container);
  }

  override async load(source: ResolvedSource, startAt: number): Promise<void> {
    let dashjs: DashModule | null = null;
    try {
      const mod = (await import('dashjs')) as unknown as { default?: DashModule } & DashModule;
      dashjs = mod.default ?? mod;
    } catch (error) {
      throw new AppError('engine-failed', {
        message: 'The DASH engine could not be loaded',
        detail: (error as Error).message,
        engine: 'dash',
      });
    }

    const factory = dashjs.MediaPlayer;
    const player = factory().create();
    this.player = player;

    // dash.js v5 has no URL-rewrite hook, so while this engine is alive every
    // same-origin XHR (MPD, init and media segments) is routed through the
    // configured proxy. Without this a CORS-blocked DASH stream cannot play.
    if (hasProxy(this.settings)) {
      this.releaseProxy = installXhrProxy(source.spec.url ?? source.playbackUrl, (url) =>
        proxiedUrl(url, this.settings),
      );
    }

    player.updateSettings({
      streaming: {
        abr: { autoSwitchBitrate: { video: true, audio: true } },
        buffer: {
          fastSwitchEnabled: true,
          bufferTimeAtTopQuality: Math.min(this.budget.cacheMb > 48 ? 30 : 12, this.settings.bufferAhead),
          stableBufferTime: Math.min(this.budget.cacheMb > 48 ? 20 : 8, this.settings.bufferAhead),
        },
        retryAttempts: {
          MPD: this.settings.retryCount,
          MediaSegment: this.settings.retryCount,
          InitializationSegment: this.settings.retryCount,
        },
        retryIntervals: { MPD: 1000, MediaSegment: 1000 },
        delay: { liveDelay: this.settings.lowLatencyLive ? 4 : 8 },
      },
    });

    const initialized = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new AppError('timeout', { detail: 'The DASH manifest did not load in time.' }));
      }, Math.max(15_000, this.settings.requestTimeout * 1000 + 10_000));

      const cleanup = () => {
        window.clearTimeout(timer);
        player.off(EVENTS.streamInitialized, onInit);
        player.off(EVENTS.error, onError);
      };
      const onInit = () => {
        cleanup();
        resolve();
      };
      const onError = (event: Record<string, unknown>) => {
        cleanup();
        reject(
          new AppError('engine-failed', {
            message: 'The DASH stream could not be initialised',
            detail: `${String(event.error ?? '')} ${String(event.message ?? '')}`.trim(),
            engine: 'dash',
            suggestions: ['Check that the manifest URL is reachable and CORS-enabled.', 'Try another DASH source.'],
          }),
        );
      };
      player.on(EVENTS.streamInitialized, onInit);
      player.on(EVENTS.error, onError);
    });

    player.on(EVENTS.qualityChangeRendered, () => {
      if (!this.player) return;
      try {
        const auto = this.player.getAutoSwitchQualityFor('video');
        this.activeQuality = auto ? 'auto' : String(this.player.getQualityFor('video'));
        this.emit('quality', { levels: this.levels, active: this.activeQuality });
      } catch {
        /* stream may not expose quality info yet */
      }
    });

    player.on(EVENTS.error, (event) => {
      const detail = `${String(event.error ?? '')} ${String(event.message ?? '')}`.trim();
      const fatal = isFatalDashError(event, detail);
      // Recoverable network blips stay non-fatal (dash.js retries them); a
      // manifest/segment/decoder failure must reach the fallback chain.
      this.emit('error', {
        error: new AppError('engine-failed', {
          detail: detail || 'The DASH stream reported an error.',
          engine: 'dash',
        }),
        fatal,
      });
    });

    player.initialize(this.video, source.playbackUrl, false);
    await initialized;

    this.video.volume = this.volumeValue;
    this.video.muted = this.mutedValue;
    this.readQualities();
    this.collectTracks();
    this.emit('meta', {
      duration: this.video.duration,
      width: this.video.videoWidth || undefined,
      height: this.video.videoHeight || undefined,
      live: !Number.isFinite(this.video.duration),
    });

    if (startAt > 0) {
      const seekTo = () => {
        try {
          this.video.currentTime = startAt;
        } catch {
          /* ignore */
        }
      };
      if (this.video.readyState >= 1) seekTo();
      else this.video.addEventListener('loadedmetadata', seekTo, { once: true });
    }
  }

  private readQualities(): void {
    if (!this.player) return;
    try {
      const list = this.player.getBitrateInfoListFor('video');
      this.levels = list
        .filter((info) => info.height || info.bitrate)
        .map((info) => ({
          id: String(info.qualityIndex),
          label: info.height ? `${info.height}p` : `${Math.round(info.bitrate / 1000)}k`,
          height: info.height,
          width: info.width,
          bitrate: info.bitrate,
        }))
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      this.emit('quality', { levels: this.levels, active: this.activeQuality });
    } catch {
      /* stream may not expose bitrates */
    }
  }

  private collectTracks(): void {
    if (!this.player) return;
    const tracks: TrackInfo[] = [];
    const audioTracks = this.player.getTracksFor('audio') ?? [];
    const currentAudio = this.player.getCurrentTrackFor('audio');
    audioTracks.forEach((track, index) => {
      tracks.push({
        id: `dash-audio-${track.index}`,
        kind: 'audio',
        index,
        label: track.labels?.[0]?.text || languageName(track.lang) || `Audio ${index + 1}`,
        language: languageName(track.lang),
        languageCode: track.lang,
        codec: track.codec,
        isDefault: currentAudio?.index === track.index || index === 0,
      });
    });
    const textTracks = this.player.getTracksFor('text') ?? [];
    const currentText = this.player.getCurrentTrackFor('text');
    textTracks.forEach((track, index) => {
      tracks.push({
        id: `dash-sub-${track.index}`,
        kind: 'subtitle',
        index,
        label: track.labels?.[0]?.text || languageName(track.lang) || `Subtitle ${index + 1}`,
        language: languageName(track.lang),
        languageCode: track.lang,
        isDefault: currentText?.index === track.index,
      });
    });
    if (!tracks.some((track) => track.kind === 'audio')) {
      tracks.push({ id: 'dash-audio-0', kind: 'audio', index: 0, label: 'Default audio', isDefault: true });
    }
    this.setTracks(tracks);
  }

  override getQualities(): QualityLevel[] {
    return this.levels;
  }

  override setQuality(id: string): void {
    if (!this.player) return;
    if (id === 'auto') {
      this.player.setAutoSwitchQualityFor('video', true);
      this.activeQuality = 'auto';
    } else {
      const index = Number(id);
      if (!Number.isFinite(index)) return;
      this.player.setAutoSwitchQualityFor('video', false);
      this.player.setQualityFor('video', index);
      this.activeQuality = id;
    }
    this.emit('quality', { levels: this.levels, active: this.activeQuality });
  }

  override async selectAudioTrack(id: string): Promise<void> {
    if (!this.player) return;
    const index = Number(id.replace('dash-audio-', ''));
    const track = (this.player.getTracksFor('audio') ?? []).find((item) => item.index === index);
    if (track) {
      this.player.setCurrentTrack(track);
      this.collectTracks();
    }
  }

  override async selectSubtitleTrack(id: string): Promise<void> {
    if (!this.player) return;
    const index = Number(id.replace('dash-sub-', ''));
    const track = (this.player.getTracksFor('text') ?? []).find((item) => item.index === index);
    if (track) {
      this.player.setCurrentTrack(track);
      this.collectTracks();
    }
  }

  override async play(): Promise<void> {
    await this.inner.play();
  }

  override pause(): void {
    this.inner.pause();
  }

  override seek(time: number): void {
    this.inner.seek(time);
  }

  override setVolume(volume: number): void {
    super.setVolume(volume);
    this.inner.setVolume(volume);
  }

  override setMuted(muted: boolean): void {
    super.setMuted(muted);
    this.inner.setMuted(muted);
  }

  override setRate(rate: number): void {
    super.setRate(rate);
    this.inner.setRate(rate);
  }

  get currentTime(): number {
    return this.inner.currentTime;
  }

  get duration(): number {
    return this.inner.duration;
  }

  get paused(): boolean {
    return this.inner.paused;
  }

  get live(): boolean {
    try {
      return this.player?.isDynamic() ?? false;
    } catch {
      return false;
    }
  }

  get buffered(): Array<[number, number]> {
    return this.inner.buffered;
  }

  private releaseProxy: (() => void) | null = null;

  private get budget() {
    const stored = this.settings.deviceProfile;
    return budgetsFor(stored === 'auto' ? deviceReport().profile : stored);
  }

  override destroy(): void {
    this.releaseProxy?.();
    this.releaseProxy = null;
    try {
      this.player?.reset();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.inner.destroy();
    super.destroy();
  }
}
