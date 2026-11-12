import type HlsType from 'hls.js';
import type { EngineCapabilities, EngineEvents, EngineKind, QualityLevel, ResolvedSource, Settings, TrackInfo } from '../types';
import { BaseEngine } from './base';
import { NativeEngine } from './native';
import { AppError } from '../core/errors';
import { hasProxy, proxiedUrl } from '../core/net';
import { budgetsFor, deviceReport } from '../core/deviceProfile';
import { languageName } from '../utils/format';

/**
 * HLS playback through hls.js (MSE), with the browser's own HLS support as a
 * fallback on Safari/iOS. Quality, audio renditions and subtitle renditions are
 * exposed only when the manifest actually provides them.
 */
export class HlsEngine extends BaseEngine {
  readonly kind: EngineKind = 'hls';
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
  private hls: HlsType | null = null;
  private levels: QualityLevel[] = [];
  private activeLevel = 'auto';
  private nativeHls = false;
  private recoveryAttempts = 0;

  constructor(private readonly settings: Settings) {
    super();
    this.inner = new NativeEngine(true);
    this.video = this.inner.video;
    // Re-emit media element events from the shared native plumbing.
    this.forward('meta');
    this.forward('duration');
    this.forward('time');
    this.forward('state');
    this.forward('volume');
    this.forward('rate');
    this.forward('buffered');
    this.forward('seeked');
    this.forward('chapters');
    this.forward('error');
  }

  private forward<K extends keyof EngineEvents>(event: K): void {
    this.inner.on(event, (payload) => this.emit(event, payload));
  }

  attach(container: HTMLElement): void {
    this.inner.attach(container);
  }

  async load(source: ResolvedSource, startAt: number): Promise<void> {
    // With a proxy configured, playbackUrl is already rewritten; hls.js needs
    // the real manifest URL so relative URIs resolve to the origin, and the
    // custom loader proxies each request instead.
    const url = hasProxy(this.settings) && source.spec.url ? source.spec.url : source.playbackUrl;
    let mod: typeof import('hls.js') | null = null;
    try {
      mod = await import('hls.js');
    } catch {
      /* hls.js could not be loaded; the native HLS path is tried below */
    }

    const Hls = mod?.default;
    if (Hls && Hls.isSupported()) {
      await this.loadWithHls(Hls, url, source, startAt);
      return;
    }

    // Native HLS (Safari, iOS, some smart TVs).
    if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.nativeHls = true;
      this.emit('notice', { message: 'Using the browser’s built-in HLS support.', level: 'info' });
      await this.inner.load(source, startAt);
      this.collectTracks();
      return;
    }

    throw new AppError('unsupported-container', {
      message: 'This browser cannot play HLS streams.',
      detail: 'hls.js requires Media Source Extensions, which are unavailable here.',
      suggestions: ['Try Chrome, Edge, Firefox or Safari.', 'Use an MP4 version of the stream if one exists.'],
    });
  }

  private get budget() {
    const stored = this.settings.deviceProfile;
    return budgetsFor(stored === 'auto' ? deviceReport().profile : stored);
  }

  private async loadWithHls(Hls: typeof import('hls.js').default, url: string, source: ResolvedSource, startAt: number): Promise<void> {
    /**
     * hls.js resolves segment URLs against the manifest, so the manifest must
     * keep its real URL; we rewrite each request (manifest, levels, segments,
     * keys) through the proxy at load time instead.
     */
    const proxyTemplate = this.settings.corsProxy;
    const useProxy = hasProxy(this.settings);
    const BaseLoader = Hls.DefaultConfig.loader as unknown as new (cfg: unknown) => {
      load(
        context: { url: string },
        config: unknown,
        callbacks: { onSuccess?: (response: { data?: unknown }, ...rest: unknown[]) => void },
      ): void;
    };

    /**
     * hls.js resolves relative URIs against the URL it *fetched*, which is the
     * proxy URL — that would nest a second proxy call. Rewriting every URI in
     * the playlist to an absolute original URL keeps one hop per request.
     */
    const absolutize = (text: string, base: string): string => {
      const resolve = (uri: string): string => {
        try {
          return new URL(uri, base).toString();
        } catch {
          return uri;
        }
      };
      return text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (!trimmed.startsWith('#')) return resolve(trimmed);
          return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${resolve(uri)}"`);
        })
        .join('\n');
    };

    class ProxyLoader extends BaseLoader {
      override load(context: { url: string }, cfg: unknown, callbacks: never): void {
        const original = context?.url ?? '';
        if (useProxy && original && !original.startsWith(proxyTemplate.replace('{url}', ''))) {
          context.url = proxiedUrl(original, { corsProxy: proxyTemplate } as never);
        }
        const wrapped = useProxy
          ? {
              ...(callbacks as unknown as Record<string, unknown>),
              onSuccess: (response: { data?: unknown }, ...rest: unknown[]) => {
                if (typeof response?.data === 'string' && response.data.includes('#EXTM3U')) {
                  response.data = absolutize(response.data, original);
                }
                (callbacks as unknown as { onSuccess?: (r: unknown, ...a: unknown[]) => void }).onSuccess?.(response, ...rest);
              },
            }
          : callbacks;
        super.load(context, cfg, wrapped as never);
      }
    }

    const config: Record<string, unknown> = {
      ...(useProxy ? { loader: ProxyLoader } : {}),
      enableWorker: true,
      lowLatencyMode: this.settings.lowLatencyLive,
      backBufferLength: this.settings.lowMemoryMode === 'on' ? 30 : 90,
      maxBufferLength: Math.min(this.settings.bufferAhead, this.budget.cacheMb > 48 ? 60 : 25),
      maxMaxBufferLength: Math.max(60, this.settings.bufferAhead * 2),
      manifestLoadingTimeOut: this.settings.requestTimeout * 1000,
      manifestLoadingMaxRetry: this.settings.retryCount,
      levelLoadingMaxRetry: this.settings.retryCount,
      fragLoadingMaxRetry: this.settings.retryCount,
      fragLoadingRetryDelay: 800,
      startLevel: -1,
      // Never fetch a level bigger than the element on screen, and keep the
      // memory budget in mind for the forward buffer.
      capLevelToPlayerSize: true,
      maxBufferSize: Math.max(20 * 1024 * 1024, this.budget.cacheMb * 1024 * 1024),
      renderTextTracksNatively: true,
      xhrSetup: (xhr: XMLHttpRequest) => {
        const headers = source.spec.headers;
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            try {
              xhr.setRequestHeader(key, value);
            } catch {
              /* forbidden header — browsers refuse these silently */
            }
          }
        }
      },
    };

    const hls = new Hls(config as never);
    this.hls = hls;

    const ready = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new AppError('timeout', { detail: 'The HLS manifest did not load in time.' }));
      }, Math.max(15_000, this.settings.requestTimeout * 1000 + 10_000));

      const cleanup = () => {
        window.clearTimeout(timer);
        hls.off(Hls.Events.MANIFEST_PARSED, onParsed);
        hls.off(Hls.Events.ERROR, onError);
      };
      const onParsed = () => {
        cleanup();
        resolve();
      };
      const onError = (_event: unknown, data: { fatal: boolean; type: string; details: string; reason?: string; response?: { code?: number } }) => {
        if (!data.fatal) return;
        cleanup();
        reject(this.mapHlsError(data));
      };
      hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
      hls.on(Hls.Events.ERROR, onError);
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      this.activeLevel = hls.autoLevelEnabled ? 'auto' : String(data.level);
      this.emit('quality', { levels: this.levels, active: this.activeLevel });
      if (level) {
        this.emit('meta', {
          duration: hls.media?.duration ?? 0,
          width: level.width,
          height: level.height,
        });
      }
    });

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.collectTracks());
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => this.collectTracks());
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.collectTracks());
    hls.on(Hls.Events.ERROR, (_event, data) => this.handleRuntimeError(data));

    hls.attachMedia(this.video);
    hls.loadSource(url);

    await ready;

    this.levels = (hls.levels ?? [])
      .map((level, index) => ({
        id: String(index),
        label: level.height ? `${level.height}p` : `${Math.round((level.bitrate ?? 0) / 1000)}k`,
        height: level.height,
        width: level.width,
        bitrate: level.bitrate,
      }))
      .filter((level) => level.label !== '0p');

    this.emit('quality', { levels: this.levels, active: 'auto' });
    this.collectTracks();
    this.emit('meta', {
      duration: this.video.duration,
      width: hls.levels[0]?.width,
      height: hls.levels[0]?.height,
      live: hls.levels.some((level) => level.details?.live) || !Number.isFinite(this.video.duration),
    });

    this.video.volume = this.volumeValue;
    this.video.muted = this.mutedValue;
    this.video.playbackRate = this.rateValue;

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

  private mapHlsError(data: { type: string; details: string; reason?: string; response?: { code?: number } }): AppError {
    const code = data.response?.code;
    if (code === 403) return new AppError('http-403', { detail: data.details, engine: 'hls' });
    if (code === 404) return new AppError('http-404', { detail: data.details, engine: 'hls' });
    if (data.type === 'networkError') {
      return new AppError('cors', {
        detail: `${data.details}${data.reason ? ` — ${data.reason}` : ''}`,
        engine: 'hls',
      });
    }
    if (data.type === 'mediaError') return new AppError('decode-failed', { detail: data.details, engine: 'hls' });
    if (data.details === 'manifestParsingError' || data.details === 'manifestIncompatibleCodecsError') {
      return new AppError('unsupported-container', {
        message: 'This HLS manifest could not be used',
        detail: data.details,
        engine: 'hls',
      });
    }
    return new AppError('engine-failed', { detail: `${data.type}: ${data.details}`, engine: 'hls' });
  }

  private handleRuntimeError(data: { fatal: boolean; type: string; details: string; reason?: string; response?: { code?: number } }): void {
    if (!data.fatal) return;
    if (this.recoveryAttempts < 2) {
      this.recoveryAttempts++;
      this.emit('notice', { message: 'Stream interrupted — recovering…', level: 'warn' });
      try {
        if (data.type === 'networkError') this.hls?.startLoad();
        else this.hls?.recoverMediaError();
        return;
      } catch {
        /* fall through to fatal */
      }
    }
    this.emit('error', { error: this.mapHlsError(data), fatal: true });
  }

  private collectTracks(): void {
    const tracks: TrackInfo[] = [];
    const hls = this.hls;
    if (hls) {
      (hls.audioTracks ?? []).forEach((track, index) => {
        tracks.push({
          id: `hls-audio-${index}`,
          kind: 'audio',
          index,
          label: track.name || languageName(track.lang) || `Audio ${index + 1}`,
          language: languageName(track.lang),
          languageCode: track.lang,
          channels: (track as unknown as { channels?: number }).channels,
          isDefault: hls.audioTrack === index || track.default,
          isForced: track.forced,
        });
      });
      (hls.subtitleTracks ?? []).forEach((track, index) => {
        tracks.push({
          id: `hls-sub-${index}`,
          kind: 'subtitle',
          index,
          label: track.name || languageName(track.lang) || `Subtitle ${index + 1}`,
          language: languageName(track.lang),
          languageCode: track.lang,
          isForced: track.forced,
        });
      });
    }
    // Native text tracks (Safari HLS, or hls.js native rendering).
    const textTracks = this.video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      const track = textTracks[i];
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      if (tracks.some((t) => t.kind === 'subtitle' && t.languageCode && t.languageCode === track.language)) continue;
      tracks.push({
        id: `native-sub-${i}`,
        kind: 'subtitle',
        index: i,
        label: track.label || languageName(track.language) || `Subtitle ${i + 1}`,
        language: languageName(track.language),
        languageCode: track.language,
      });
    }
    if (!tracks.some((t) => t.kind === 'audio')) {
      tracks.push({ id: 'hls-audio-0', kind: 'audio', index: 0, label: 'Default audio', isDefault: true });
    }
    this.setTracks(tracks);
  }

  override getQualities(): QualityLevel[] {
    return this.levels;
  }

  override setQuality(id: string): void {
    if (!this.hls) return;
    if (id === 'auto') {
      this.hls.currentLevel = -1;
      this.activeLevel = 'auto';
    } else {
      const index = Number(id);
      if (!Number.isFinite(index) || index < 0 || index >= this.hls.levels.length) return;
      this.hls.currentLevel = index;
      this.activeLevel = id;
    }
    this.emit('quality', { levels: this.levels, active: this.activeLevel });
  }

  override async selectAudioTrack(id: string): Promise<void> {
    if (!this.hls) return;
    const match = /^hls-audio-(\d+)$/.exec(id);
    if (!match) return;
    this.hls.audioTrack = Number(match[1]);
    this.collectTracks();
  }

  override async selectSubtitleTrack(id: string): Promise<void> {
    if (!this.hls) return;
    const match = /^hls-sub-(\d+)$/.exec(id);
    if (match) {
      const index = Number(match[1]);
      this.hls.subtitleTrack = index;
      this.hls.subtitleDisplay = true;
      return;
    }
    const nativeMatch = /^native-sub-(\d+)$/.exec(id);
    if (nativeMatch) {
      const textTracks = this.video.textTracks;
      for (let i = 0; i < textTracks.length; i++) textTracks[i].mode = i === Number(nativeMatch[1]) ? 'showing' : 'disabled';
    }
  }

  async play(): Promise<void> {
    await this.inner.play();
  }

  pause(): void {
    this.inner.pause();
  }

  seek(time: number): void {
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
    return this.nativeHls ? this.inner.live : this.levels.length > 0 && !Number.isFinite(this.duration);
  }

  get buffered(): Array<[number, number]> {
    return this.inner.buffered;
  }

  override destroy(): void {
    try {
      this.hls?.destroy();
    } catch {
      /* ignore */
    }
    this.hls = null;
    this.inner.destroy();
    super.destroy();
  }
}
