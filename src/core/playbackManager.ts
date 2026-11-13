import type {
  Chapter,
  EngineKind,
  MediaSourceSpec,
  NetworkInfo,
  PlaybackDiagnostics,
  PlaybackEngine,
  ProbeInfo,
  QualityLevel,
  ResolvedSource,
  Settings,
  TrackInfo,
} from '../types';
import { Emitter } from '../utils/emitter';
import { SourceResolver } from './sourceResolver';
import { probeMedia } from './probe';
import { detectCapabilities, decodingInfo } from './capabilities';
import { canPlayNatively, isNativelyPlayableContainer, selectEngineChain } from './engineSelector';
import { NativeEngine } from '../engines/native';
import { HlsEngine } from '../engines/hls';
import { DashEngine } from '../engines/dash';
import { WebCodecsEngine } from '../engines/webcodecs';
import { audioProcessor } from '../audio/audioProcessor';
import { AppError, toAppError } from './errors';
import { extOf } from '../media/formats';
import { buildMimeType } from './engineSelector';
import { redactUrl } from './errors';
import { log } from '../utils/log';

export interface PlaybackEvents {
  engine: { engine: PlaybackEngine; kind: EngineKind };
  tracks: { tracks: TrackInfo[] };
  state: { paused: boolean; ended: boolean; buffering: boolean };
  time: { currentTime: number; duration: number };
  duration: { duration: number };
  meta: { duration: number; width?: number; height?: number; live?: boolean };
  quality: { levels: QualityLevel[]; active: string };
  buffered: { ranges: Array<[number, number]> };
  chapters: { chapters: Chapter[] };
  error: { error: AppError; fatal: boolean };
  notice: { message: string; level?: 'info' | 'warn' };
  diagnostics: { diagnostics: PlaybackDiagnostics };
  probe: { probe: ProbeInfo | null };
  network: { network: NetworkInfo | undefined };
  seeked: { currentTime: number };
}

interface OpenOptions {
  startAt?: number;
  autoplay?: boolean;
  probe?: ProbeInfo | null;
  /** Try one engine first, ignoring the preference (used by “switch engine”). */
  forceEngine?: EngineKind;
  /** Preferred audio language for this load, overriding settings. */
  audioLanguage?: string;
  /** Attempt native playback even when the host blocks byte access. */
  ignoreCorsBlock?: boolean;
  /** Start muted (embeds need this for autoplay to be allowed). */
  startMuted?: boolean;
}

/**
 * Owns the media pipeline: resolves the source, inspects it, chooses an engine,
 * runs the fallback chain and normalises every engine's events.
 */
export class PlaybackManager extends Emitter<PlaybackEvents> {
  private readonly resolver: SourceResolver;
  private container: HTMLElement | null = null;
  private engine: PlaybackEngine | null = null;
  private unsubs: Array<() => void> = [];
  private resolved: ResolvedSource | null = null;
  private chain: EngineKind[] = [];
  private attempt = 0;
  private spec: MediaSourceSpec | null = null;
  private probeInfo: ProbeInfo | null = null;
  private lastPosition = 0;
  private loadToken = 0;
  private destroyed = false;
  private noticeQueue: string[] = [];
  private volume = 1;
  private muted = false;
  private rate = 1;
  private reason = '';
  private usingAudioGraph = false;
  private fallbackLock = false;
  private corsBlocked = false;
  private pendingAudioLanguage: string | null = null;

  constructor(private readonly getSettings: () => Settings) {
    super();
    this.resolver = new SourceResolver(getSettings);
  }

  attachContainer(container: HTMLElement): void {
    this.container = container;
    this.engine?.attach(container);
  }

  get currentEngine(): PlaybackEngine | null {
    return this.engine;
  }

  get source(): ResolvedSource | null {
    return this.resolved;
  }

  get probe(): ProbeInfo | null {
    return this.probeInfo;
  }

  get engineChain(): EngineKind[] {
    return this.chain;
  }

  get selectionReason(): string {
    return this.reason;
  }

  async open(spec: MediaSourceSpec, options: OpenOptions = {}): Promise<void> {
    const token = ++this.loadToken;
    this.destroyed = false;
    this.spec = spec;
    this.lastPosition = options.startAt ?? spec.startAt ?? 0;
    this.attempt = 0;
    this.fallbackLock = false;
    this.teardownEngine();
    this.releaseResolved();

    const settings = this.getSettings();
    this.volume = settings.persistVolume ? settings.volume : 1;
    // Mute before the first play() so browsers permit autoplay.
    this.muted = options.startMuted ?? settings.startMuted;
    this.rate = settings.defaultRate;

    let resolved: ResolvedSource;
    try {
      resolved = await this.resolver.resolve(spec);
    } catch (error) {
      this.emit('error', { error: toAppError(error), fatal: true });
      throw error;
    }
    if (token !== this.loadToken) return;
    this.resolved = resolved;
    this.emit('network', { network: resolved.network });

    const corsUnavailable = resolved.network?.corsOk === false;
    this.corsBlocked = corsUnavailable;
    this.pendingAudioLanguage = options.audioLanguage ?? null;
    if (corsUnavailable) {
      // Remember it so thumbnails and later reloads do not retry the same host.
      spec.corsBlocked = true;
      const container = extOf(spec.name) || extOf(spec.url ?? '');
      const nativePossible = isNativelyPlayableContainer(container);
      if (!options.ignoreCorsBlock) {
        // Always give the browser's own element a chance. A filename can lie
        // (gateways routinely serve MP4 under an .mkv name) and <video> fetches
        // the bytes opaquely, so it may still play even though we cannot read
        // them. Only report the CORS wall after that attempt fails.
        this.noticeQueue.push(
          nativePossible || !container
            ? 'Host blocks browser access (CORS): trying the native element.'
            : `Host blocks byte access (CORS). Trying native playback — this only works if the file is really MP4/WebM.`,
        );
      }
    } else {
      spec.corsBlocked = false;
      if (resolved.network?.rangeOk === false) {
        this.noticeQueue.push(
          'This host refuses range requests — playback may be slow and seeking unreliable. Allow the Range header in the bucket policy.',
        );
      }
    }

    // Deep inspection: immediate for local files, background for URLs so the
    // first frame is not delayed by network probing.
    if (spec.file) {
      this.probeInfo = options.probe ?? (await probeMedia(spec, resolved.playbackUrl, []));
      if (token !== this.loadToken) return;
      this.emit('probe', { probe: this.probeInfo });
    } else {
      this.probeInfo = options.probe ?? null;
      if (!this.corsBlocked) void this.probeInBackground(spec, resolved, token);
    }

    const caps = detectCapabilities();
    const selection = selectEngineChain({ source: resolved, probe: this.probeInfo, settings, caps });
    const baseChain = corsUnavailable ? (['native'] as EngineKind[]) : selection.chain;
    if (corsUnavailable && options.forceEngine === 'webcodecs') {
      const error = new AppError('cors-required', {
        message: 'The WebCodecs engine must read the file, and this host blocks that (CORS).',
      });
      this.emit('error', { error, fatal: true });
      throw error;
    }
    this.chain = options.forceEngine
      ? [options.forceEngine, ...baseChain.filter((kind) => kind !== options.forceEngine)]
      : baseChain;
    this.reason = options.forceEngine
      ? `${selection.reason} · forced ${options.forceEngine}`
      : selection.reason;
    log.info('engine chain', selection.chain.join(' → '), '|', selection.reason);
    selection.notes.forEach((note) => this.noticeQueue.push(note));

    await this.startAttempt(0, this.lastPosition, options.autoplay ?? settings.autoPlay);
  }

  private async probeInBackground(spec: MediaSourceSpec, resolved: ResolvedSource, token: number): Promise<void> {
    try {
      const probe = await probeMedia(spec, resolved.playbackUrl, []);
      if (token !== this.loadToken || !probe) return;
      this.probeInfo = probe;
      this.emit('probe', { probe });
      if (probe.audioTracks.length > 1) {
        this.emit('notice', {
          message: `This file has ${probe.audioTracks.length} audio tracks. The WebCodecs engine can switch between them.`,
          level: 'info',
        });
      }
    } catch {
      /* probing is optional */
    }
  }

  private async startAttempt(index: number, position: number, autoplay: boolean): Promise<void> {
    const kind = this.chain[index];
    if (!kind || !this.resolved) {
      throw new AppError('engine-failed', { message: 'No playback engine is available for this source.' });
    }
    this.attempt = index;
    const token = this.loadToken;

    this.teardownEngine(false);
    let engine: PlaybackEngine;
    try {
      engine = this.createEngine(kind);
    } catch (error) {
      const next = index + 1;
      if (next < this.chain.length) {
        this.emit('notice', { message: `Engine ${kind} unavailable — trying ${this.chain[next]}.`, level: 'warn' });
        await this.startAttempt(next, position, autoplay);
        return;
      }
      throw error;
    }

    // When the host blocks byte access the native element is our only hope; do
    // not leave the user staring at a spinner for 30 s if it cannot decode.
    if (kind === 'native' && this.corsBlocked && engine instanceof NativeEngine) {
      engine.setLoadTimeout(9000);
    }

    this.engine = engine;
    if (this.container) engine.attach(this.container);
    this.wireEngine(engine);
    this.emit('engine', { engine, kind });

    try {
      // A configured proxy can itself be the problem (wrong URL shape, down).
      // The native element does not need it, so give it the real source URL.
      const loadSource =
        kind === 'native' && this.resolved.spec.url && this.resolved.playbackUrl !== this.resolved.spec.url
          ? { ...this.resolved, playbackUrl: this.resolved.spec.url }
          : this.resolved;
      await this.loadWithWatchdog(engine, loadSource, position);
    } catch (error) {
      if (token !== this.loadToken) return;
      const appError = toAppError(error);
      const next = index + 1;
      if (next < this.chain.length) {
        this.emit('notice', {
          message: `${labelFor(kind)} could not open this file — switching to ${labelFor(this.chain[next])}.`,
          level: 'warn',
        });
        await this.startAttempt(next, position, autoplay);
        return;
      }
      // On a CORS-blocked host the real reason is almost always the blocked
      // bytes, not the decoder. Say that instead of "container not supported".
      if (this.corsBlocked) {
        const manifest = this.resolved?.kind === 'hls' || this.resolved?.kind === 'dash';
        const container = extOf(this.spec?.name ?? '') || extOf(this.spec?.url ?? '');
        const corsError = new AppError('cors-required', {
          detail: manifest
            ? `The ${(this.resolved?.kind ?? 'stream').toUpperCase()} manifest could not be read: this host does not allow browser access (CORS). A CORS proxy in Settings → Network fixes it for HLS too.`
            : `Native playback of ${container ? container.toUpperCase() : 'this file'} failed too — the browser cannot decode it without reading the bytes.`,
        });
        this.emit('error', { error: corsError, fatal: true });
        throw corsError;
      }
      this.emit('error', { error: appError, fatal: true });
      throw appError;
    }

    if (token !== this.loadToken) return;

    this.applyVolumeAndRate(engine);
    this.emitTracks();
    this.emitDiagnostics();

    if (autoplay) {
      try {
        await engine.play();
      } catch (error) {
        const appError = toAppError(error);
        if (appError.message.includes('autoplay') || appError.message.includes('Press play')) {
          this.emit('notice', { message: appError.message, level: 'info' });
        } else {
          this.emit('error', { error: appError, fatal: false });
        }
      }
    }
  }

  private createEngine(kind: EngineKind): PlaybackEngine {
    const settings = this.getSettings();
    switch (kind) {
      case 'native':
        return new NativeEngine(settings.pitchPreserved);
      case 'hls':
        return new HlsEngine(settings);
      case 'dash':
        return new DashEngine(settings);
      case 'webcodecs': {
        const ctx = audioProcessor.ensureContext();
        const destination = audioProcessor.input;
        if (!ctx || !destination) {
          throw new AppError('no-decoder', { message: 'Web Audio is required for the WebCodecs engine but is unavailable.' });
        }
        return new WebCodecsEngine({ settings, audioContext: ctx, audioDestination: destination });
      }
      default:
        throw new AppError('engine-failed');
    }
  }

  private wireEngine(engine: PlaybackEngine): void {
    this.unsubs.push(
      engine.on('time', (payload) => {
        this.lastPosition = payload.currentTime;
        this.emit('time', payload);
      }),
      engine.on('duration', (payload) => this.emit('duration', payload)),
      engine.on('state', (payload) => {
        this.bufferingValue = payload.buffering;
        this.emit('state', payload);
      }),
      engine.on('meta', (payload) => {
        this.emit('meta', payload);
        this.emitDiagnostics();
      }),
      engine.on('tracks', (payload) => {
        this.emit('tracks', { tracks: payload.tracks });
        this.applyLanguagePreference(payload.tracks);
      }),
      engine.on('quality', (payload) => {
        this.qualityValue = payload.active;
        this.emit('quality', payload);
      }),
      engine.on('buffered', (payload) => this.emit('buffered', payload)),
      engine.on('chapters', (payload) => this.emit('chapters', payload)),
      engine.on('seeked', (payload) => this.emit('seeked', payload)),
      engine.on('notice', (payload) => this.emit('notice', payload)),
      engine.on('error', (payload) => {
        if (payload.fatal) this.handleEngineFailure(toAppError(payload.error));
        else this.emit('error', { error: toAppError(payload.error), fatal: false });
      }),
    );

    const video = engine.video;
    // With no EQ, no balance/delay and no normalisation there is nothing for the
    // graph to do: attaching it would cost CPU and break native audio routing.
    const settings = this.getSettings();
    const effectsNeeded =
      settings.eqEnabled ||
      (settings.balance ?? 0) !== 0 ||
      (settings.audioDelayMs ?? 0) !== 0 ||
      settings.normalizeVolume === true;
    if (video && effectsNeeded && this.canUseAudioGraph()) {
      this.usingAudioGraph = audioProcessor.attachMediaElement(video);
      if (this.usingAudioGraph) {
        audioProcessor.setVolume(this.volume, this.muted);
        audioProcessor.setEqGains(this.getSettings().eqGains, this.getSettings().eqEnabled);
      }
    } else {
      this.usingAudioGraph = false;
    }
  }

  private canUseAudioGraph(): boolean {
    if (!this.resolved) return false;
    if (this.resolved.spec.file) return true;
    if (this.resolved.kind === 'hls' || this.resolved.kind === 'dash') return true;
    // Cross-origin progressive media taints Web Audio and would play silence.
    try {
      const url = new URL(this.resolved.playbackUrl);
      return url.origin === location.origin;
    } catch {
      return false;
    }
  }

  /**
   * A demuxer that never gets its bytes (a server that advertises ranges and
   * then ignores them, a half-open connection) would otherwise spin forever.
   * Give every engine a deadline and fall through to the next one.
   */
  private async loadWithWatchdog(engine: PlaybackEngine, source: ResolvedSource, position: number): Promise<void> {
    const deadline = engine.kind === 'native' ? 30_000 : 20_000;
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => {
        reject(
          new AppError('timeout', {
            message: 'The stream did not start in time',
            detail: `${engine.kind} could not read enough of the file to begin playback.`,
          }),
        );
      }, deadline);
    });
    try {
      await Promise.race([engine.load(source, position), timeout]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  private handleEngineFailure(error: AppError): void {
    if (this.fallbackLock) {
      this.emit('error', { error, fatal: true });
      return;
    }
    const next = this.attempt + 1;
    if (next < this.chain.length) {
      this.fallbackLock = true;
      const position = this.engine?.currentTime ?? this.lastPosition;
      this.emit('notice', {
        message: `${labelFor(this.chain[this.attempt])} failed — retrying with ${labelFor(this.chain[next])}.`,
        level: 'warn',
      });
      void this.startAttempt(next, position, !this.engine?.paused).finally(() => {
        this.fallbackLock = false;
      });
      return;
    }
    // Nothing worked. If the host blocks byte access, that is almost always the
    // real reason — say so instead of surfacing a decoder error.
    if (this.corsBlocked) {
      const manifest = this.resolved?.kind === 'hls' || this.resolved?.kind === 'dash';
      const container = extOf(this.spec?.name ?? '') || extOf(this.spec?.url ?? '');
      this.emit('error', {
        error: new AppError('cors-required', {
          detail: manifest
            ? `The ${(this.resolved?.kind ?? 'stream').toUpperCase()} manifest was blocked by CORS. Add a CORS proxy in Settings → Network — HLS playlists and segments are proxied too.`
            : this.spec?.url
              ? `The browser was not allowed to read the bytes (no Access-Control-Allow-Origin), and native playback of ${container ? container.toUpperCase() : 'this file'} failed too.`
              : undefined,
        }),
        fatal: true,
      });
      return;
    }
    this.emit('error', { error, fatal: true });
  }

  private applyLanguagePreference(tracks: TrackInfo[]): void {
    const settings = this.getSettings();
    const engine = this.engine;
    if (!engine) return;
    const audioTracks = tracks.filter((track) => track.kind === 'audio');
    if (audioTracks.length < 2) return;
    const preferred = this.pendingAudioLanguage || settings.preferredAudioLanguage || settings.fallbackAudioLanguage;
    if (!preferred) return;
    const match = audioTracks.find(
      (track) => track.languageCode?.toLowerCase().startsWith(preferred.toLowerCase()) || track.language?.toLowerCase() === preferred.toLowerCase(),
    );
    const active = audioTracks.find((track) => track.isDefault);
    if (settings.preferOriginalAudio && active && match && match.id !== active.id && active.isDefault) {
      // Keep the original/default track unless the user explicitly picked one.
      return;
    }
    if (match && match.id !== active?.id) {
      void engine.selectAudioTrack(match.id).catch(() => undefined);
    }
  }

  private emitTracks(): void {
    if (this.engine) this.emit('tracks', { tracks: this.engine.getTracks() });
  }

  /* --------------------------------------------------------------- controls */

  async play(): Promise<void> {
    if (!this.engine) return;
    await audioProcessor.resume();
    await this.engine.play();
  }

  pause(): void {
    this.engine?.pause();
  }

  async toggle(): Promise<void> {
    if (!this.engine) return;
    if (this.engine.paused) await this.play();
    else this.pause();
  }

  seek(time: number): void {
    this.engine?.seek(time);
  }

  seekBy(delta: number): void {
    if (!this.engine) return;
    this.engine.seek(this.engine.currentTime + delta);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = this.volume === 0 ? true : this.muted;
    this.applyVolumeAndRate(this.engine);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumeAndRate(this.engine);
  }

  setRate(rate: number): void {
    this.rate = Math.min(4, Math.max(0.25, rate));
    this.applyVolumeAndRate(this.engine);
  }

  private applyVolumeAndRate(engine: PlaybackEngine | null): void {
    if (!engine) return;
    // The canvas engine renders no <video>, so its audio only exists inside the
    // Web Audio graph — the master gain is the volume control in that case.
    const graphOwnsAudio = this.usingAudioGraph || engine.kind === 'webcodecs';
    if (graphOwnsAudio) {
      audioProcessor.setVolume(this.volume, this.muted);
      // Keep the element in step as well: if the graph is suspended (mobile
      // autoplay policies, a detached sink) the gain change would not be heard
      // until the next resume, which is what made volume feel seconds late.
      engine.setVolume(this.muted ? 0 : this.volume);
      engine.setMuted(this.muted);
    } else {
      engine.setVolume(this.volume);
      engine.setMuted(this.muted);
    }
    engine.setRate(this.rate);
  }

  async selectAudioTrack(id: string): Promise<void> {
    await this.engine?.selectAudioTrack(id);
    this.emitTracks();
  }

  async selectSubtitleTrack(id: string): Promise<void> {
    await this.engine?.selectSubtitleTrack(id);
    this.emitTracks();
  }

  setQuality(id: string): void {
    this.engine?.setQuality(id);
  }

  /**
   * Apply a device budget at runtime: the engine gets the new decode cap and
   * queue depth, and HLS/DASH get a matching quality cap.
   */
  applyBudgets(budget: { maxDecodeHeight: number; frameQueue: number; cacheMb: number }): void {
    const engine = this.engine as unknown as { setBudget?: (b: unknown) => void } | null;
    engine?.setBudget?.(budget);
    if (this.resolved?.kind === 'hls') {
      const levels = this.getQualities();
      const allowed = levels.filter((level) => (level.height ?? 0) <= budget.maxDecodeHeight);
      if (allowed.length > 0) this.setQuality(allowed[allowed.length - 1].id);
    }
  }

  /** The canvas a screenshot should read from, when the engine draws to one. */
  captureCanvas(): HTMLCanvasElement | null {
    const engine = this.engine as unknown as { canvas?: HTMLCanvasElement } | null;
    return engine?.canvas ?? null;
  }

  /** Buffered time ranges, for the stats overlay and the timeline. */
  private bufferingValue = false;
  private qualityValue = 'auto';

  get bufferedRanges(): Array<[number, number]> {
    return this.engine?.buffered ?? [];
  }

  /** True while the player is waiting for data. */
  get buffering(): boolean {
    return this.bufferingValue;
  }

  get activeQuality(): string {
    return this.qualityValue;
  }

  getQualities(): QualityLevel[] {
    return this.engine?.getQualities() ?? [];
  }

  getTracks(): TrackInfo[] {
    return this.engine?.getTracks() ?? [];
  }

  get currentTime(): number {
    return this.engine?.currentTime ?? 0;
  }

  get duration(): number {
    return this.engine?.duration ?? 0;
  }

  get paused(): boolean {
    return this.engine?.paused ?? true;
  }

  get live(): boolean {
    return this.engine?.live ?? false;
  }

  get audioGraphActive(): boolean {
    return this.usingAudioGraph;
  }

  get volumeValue(): number {
    return this.volume;
  }

  get mutedValue(): number {
    return this.muted ? 1 : 0;
  }

  get rateValue(): number {
    return this.rate;
  }

  async stepFrame(direction: 1 | -1): Promise<boolean> {
    if (this.engine instanceof WebCodecsEngine) {
      await this.engine.stepFrame(direction);
      return true;
    }
    const engine = this.engine;
    if (!engine) return false;
    // Native engines cannot decode single frames; approximate with a frame-sized seek.
    const fps = 25;
    engine.pause();
    engine.seek(engine.currentTime + direction / fps);
    return false;
  }

  async captureFrame(): Promise<string | null> {
    const engine = this.engine;
    if (!engine) return null;
    const source: HTMLVideoElement | HTMLCanvasElement | null = engine.canvas ?? engine.video;
    if (!source) return null;
    try {
      const width = engine.canvas ? engine.canvas.width : (engine.video?.videoWidth ?? 0);
      const height = engine.canvas ? engine.canvas.height : (engine.video?.videoHeight ?? 0);
      if (!width || !height) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  /**
   * Re-open the current source with another engine (or another audio language)
   * while keeping the position. Used by “switch engine to change audio”.
   */
  async reloadWith(options: { engine?: EngineKind; audioLanguage?: string } = {}): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    if (options.engine === 'webcodecs' && this.corsBlocked) {
      const error = new AppError('cors-required', {
        message: 'Switching tracks needs the browser to read the file, and this host blocks that (CORS).',
      });
      this.emit('error', { error, fatal: false });
      throw error;
    }
    const position = this.engine?.currentTime ?? this.lastPosition;
    const wasPlaying = this.engine ? !this.engine.paused : true;
    this.emit('notice', {
      message: options.engine ? `Reloading with the ${options.engine} engine…` : 'Reloading…',
      level: 'info',
    });
    await this.open(spec, {
      startAt: position,
      autoplay: wasPlaying,
      forceEngine: options.engine,
      audioLanguage: options.audioLanguage,
      ignoreCorsBlock: this.corsBlocked,
    });
  }

  get isCorsBlocked(): boolean {
    return this.corsBlocked;
  }

  /** True when a CORS-blocked source is playing through the native element. */
  get isDegradedNative(): boolean {
    return this.corsBlocked && this.engine?.kind === 'native';
  }

  /* ----------------------------------------------------------- diagnostics */

  async getDiagnostics(): Promise<PlaybackDiagnostics> {
    const engine = this.engine;
    const caps = detectCapabilities();
    const notes = [...(this.probeInfo?.notes ?? [])];
    if (this.reason) notes.push(`Selection: ${this.reason}`);
    if (!this.usingAudioGraph && engine?.video) notes.push('Web Audio effects bypassed (cross-origin media).');
    if (this.corsBlocked) notes.push('Host blocks browser access (CORS): no demuxing, no track switching.');

    let droppedFrames: number | undefined;
    let totalFrames: number | undefined;
    const video = engine?.video;
    if (video && typeof video.getVideoPlaybackQuality === 'function') {
      const quality = video.getVideoPlaybackQuality();
      droppedFrames = quality.droppedVideoFrames;
      totalFrames = quality.totalVideoFrames;
    }

    let hardware = 'Unknown';
    const mime = buildMimeType(this.probeInfo);
    if (mime && caps.mediaCapabilities) {
      const info = await decodingInfo(mime, this.probeInfo?.width ?? 1920, this.probeInfo?.height ?? 1080);
      if (info) {
        hardware = info.powerEfficient ? 'Hardware-accelerated (browser reported)' : info.smooth ? 'Software decoding (smooth)' : 'Software decoding (may stutter)';
      }
    }

    const ranges = engine?.buffered ?? [];
    const ahead = ranges.reduce((best, [start, end]) => (engine && engine.currentTime >= start && end > engine.currentTime ? Math.max(best, end - engine.currentTime) : best), 0);

    return {
      engine: engine?.kind ?? 'native',
      engineChain: [...this.chain],
      container: this.probeInfo?.container,
      videoCodec: this.probeInfo?.videoCodec,
      audioCodec: this.probeInfo?.audioCodec,
      width: this.probeInfo?.width ?? video?.videoWidth,
      height: this.probeInfo?.height ?? video?.videoHeight,
      frameRate: this.probeInfo?.frameRate,
      bitrate: this.probeInfo?.bitrate,
      duration: engine?.duration,
      droppedFrames,
      totalFrames,
      decoderPath: engine?.kind === 'webcodecs' ? 'WebCodecs (software pipeline)' : engine?.kind === 'native' ? 'HTMLMediaElement (browser decoder)' : `${engine?.kind} + MSE`,
      hardwareAcceleration: hardware,
      buffering: false,
      bufferHealth: Math.round(ahead * 10) / 10,
      playbackRate: engine ? this.rate : undefined,
      url: redactUrl(this.spec?.url),
      notes,
    };
  }

  emitDiagnostics(): void {
    void this.getDiagnostics().then((diagnostics) => {
      this.emit('diagnostics', { diagnostics });
      try {
        sessionStorage.setItem('omniplay:last-diagnostics', JSON.stringify(diagnostics));
      } catch {
        /* session storage may be unavailable in private mode */
      }
    });
  }

  /* ---------------------------------------------------------------- cleanup */

  private teardownEngine(clearContainer = true): void {
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.unsubs = [];
    if (this.engine) {
      try {
        this.engine.destroy();
      } catch {
        /* ignore */
      }
      this.engine = null;
    }
    audioProcessor.detachMediaElement();
    this.usingAudioGraph = false;
    if (clearContainer && this.container) {
      this.container.querySelectorAll('video, canvas').forEach((node) => node.remove());
    }
  }

  private releaseResolved(): void {
    if (this.resolved?.objectUrl) {
      try {
        URL.revokeObjectURL(this.resolved.objectUrl);
      } catch {
        /* ignore */
      }
    }
    this.resolved = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.loadToken++;
    this.teardownEngine();
    this.releaseResolved();
    this.clear();
    this.probeInfo = null;
    this.chain = [];
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  canPlayNatively(): boolean {
    if (!this.resolved) return false;
    return canPlayNatively(this.resolved, this.probeInfo, detectCapabilities()).supported;
  }

  get pendingNotices(): string[] {
    const notices = [...this.noticeQueue];
    this.noticeQueue = [];
    return notices;
  }
}

function labelFor(kind: EngineKind): string {
  switch (kind) {
    case 'native':
      return 'Native engine';
    case 'hls':
      return 'HLS engine';
    case 'dash':
      return 'DASH engine';
    case 'webcodecs':
      return 'WebCodecs engine';
    default:
      return kind;
  }
}
