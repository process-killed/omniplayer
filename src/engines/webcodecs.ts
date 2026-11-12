import type * as MB from 'mediabunny';
import type { EngineCapabilities, EngineKind, ResolvedSource, Settings, TrackInfo } from '../types';
import { BaseEngine } from './base';
import { AppError } from '../core/errors';
import { budgetsFor, deviceReport } from '../core/deviceProfile';
import { codecLabel, languageName } from '../utils/format';
import { log } from '../utils/log';

interface WrappedCanvasLike {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  timestamp: number;
  duration: number;
}

interface WrappedAudioLike {
  buffer: AudioBuffer;
  timestamp: number;
  duration: number;
}

export interface WebCodecsEngineOptions {
  settings: Settings;
  audioContext: AudioContext;
  audioDestination: AudioNode;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Software path for containers the browser cannot play natively (MKV, AVI,
 * MOV variants, TS with odd codecs…). mediabunny demuxes, WebCodecs decodes,
 * a canvas paints frames and Web Audio plays the sound.
 *
 * Everything runs locally; nothing is uploaded.
 */
export class WebCodecsEngine extends BaseEngine {
  readonly kind: EngineKind = 'webcodecs';
  readonly capabilities: EngineCapabilities = {
    seek: true,
    audioTracks: true,
    subtitleTracks: false,
    qualityLevels: false,
    live: false,
    audioGraph: true,
    pitchPreserved: false,
    frameStep: true,
  };

  override readonly canvas: HTMLCanvasElement;

  private ctx2d: CanvasRenderingContext2D;
  private mb: typeof import('mediabunny') | null = null;
  private input: MB.Input | null = null;
  private videoTrackRef: MB.InputVideoTrack | null = null;
  private audioTrack: MB.InputAudioTrack | null = null;
  private videoSink: MB.CanvasSink | null = null;
  private audioSink: MB.AudioBufferSink | null = null;
  private videoIter: AsyncGenerator<WrappedCanvasLike> | null = null;
  private audioIter: AsyncGenerator<WrappedAudioLike> | null = null;

  private queue: WrappedCanvasLike[] = [];
  private lastDrawn: WrappedCanvasLike | null = null;
  private lastTimestamp = 0;
  private durationValue = 0;
  private fps = 25;

  private anchorMedia = 0;
  private anchorClock = 0;
  private pausedValue = true;
  private ended = false;
  private buffering = false;
  private streamEnded = false;

  private rafId = 0;
  private audioPumping = false;
  private videoPumping = false;
  private activeNodes = new Set<AudioBufferSourceNode>();
  private scheduledUntil = 0;
  private seekToken = 0;
  private destroyedFlag = false;
  private lastEmit = 0;
  private budget = budgetsFor('balanced');

  /** Live budget update from the resource governor. */
  setBudget(budget: Partial<{ maxDecodeHeight: number; frameQueue: number; cacheMb: number }>): void {
    this.budget = {
      ...this.budget,
      maxDecodeHeight: budget.maxDecodeHeight ?? this.budget.maxDecodeHeight,
      frameQueue: budget.frameQueue ?? this.budget.frameQueue,
      cacheMb: budget.cacheMb ?? this.budget.cacheMb,
    };
  }
  private starting = false;
  private hardwareHint: 'prefer-hardware' | 'no-preference' = 'no-preference';
  private retriedInSoftware = false;
  private loggedFirstFrame = false;
  private sinkOptions: { width: number; height: number } | null = null;

  constructor(private readonly options: WebCodecsEngineOptions) {
    super();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'player__canvas';
    this.canvas.setAttribute('aria-label', 'Video');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new AppError('no-decoder', { message: 'Canvas rendering is unavailable in this browser.' });
    this.ctx2d = ctx;
  }

  attach(container: HTMLElement): void {
    if (this.canvas.parentElement !== container) container.append(this.canvas);
  }

  /* ------------------------------------------------------------------ load */

  async load(source: ResolvedSource, startAt: number): Promise<void> {
    this.mb = await import('mediabunny');
    const mb = this.mb;

    // Explicit budgets: a quarter of the user's buffer setting for demuxed
    // bytes, with a floor so seeking stays usable. Applied to local *and*
    // remote sources — the limit used to be local-only.
    // Device budget: the profile caps decode resolution, queue depth and cache.
    const storedProfile = this.options.settings.deviceProfile;
    const profile = storedProfile === 'auto' ? deviceReport().profile : storedProfile;
    const budget = budgetsFor(profile);
    this.budget = budget;
    const cacheBytes = Math.max(8, Math.min(Math.round(this.options.settings.maxBufferMb / 4), budget.cacheMb)) * 1024 * 1024;
    const src = source.spec.file
      ? new mb.BlobSource(source.spec.file, { maxCacheSize: cacheBytes })
      : new mb.UrlSource(source.playbackUrl, {
          maxCacheSize: cacheBytes,
          requestInit: source.spec.headers ? { headers: source.spec.headers } : undefined,
        });

    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: src });
    this.input = input;

    let videoTracks: MB.InputVideoTrack[] = [];
    let audioTracks: MB.InputAudioTrack[] = [];
    try {
      [videoTracks, audioTracks] = await Promise.all([input.getVideoTracks(), input.getAudioTracks()]);
    } catch (error) {
      throw new AppError('corrupt', {
        message: 'This file could not be demuxed',
        detail: (error as Error).message,
        engine: 'webcodecs',
        suggestions: ['The container may be damaged or partially downloaded.', 'Try the native engine or convert the file to MP4.'],
      });
    }

    if (videoTracks.length === 0) {
      throw new AppError('unsupported-container', {
        message: 'No video track found in this file',
        detail: 'The demuxer read the container but found no video stream.',
        engine: 'webcodecs',
      });
    }

    const videoTrack = videoTracks[0];
    const canDecodeVideo = await videoTrack.canDecode().catch(() => false);
    if (!canDecodeVideo) {
      const codec = (await videoTrack.getCodec().catch(() => null)) ?? 'unknown';
      throw new AppError('unsupported-codec', {
        message: `This browser cannot decode ${codecLabel(codec)} video`,
        detail: `WebCodecs reports no decoder for ${codec} on this device.`,
        engine: 'webcodecs',
        suggestions: [
          'Chrome or Edge on desktop decode more codecs in software.',
          'Convert the file to H.264 + AAC (MP4).',
        ],
      });
    }

    this.videoTrackRef = videoTrack;
    this.audioTrack = await this.pickAudioTrack(audioTracks);

    const width = await videoTrack.getDisplayWidth().catch(() => 1280);
    const height = await videoTrack.getDisplayHeight().catch(() => 720);
    // The profile cap wins over the legacy low-memory toggle.
    const cap = Math.min(
      this.budget.maxDecodeHeight,
      this.options.settings.lowMemoryMode === 'on' ? 720 : 1440,
    );
    const scale = Math.min(1, cap / Math.max(width, height));
    const outWidth = Math.max(2, Math.round(width * scale));
    const outHeight = Math.max(2, Math.round(height * scale));

    this.canvas.width = outWidth;
    this.canvas.height = outHeight;
    this.canvas.style.aspectRatio = `${outWidth} / ${outHeight}`;

    this.sinkOptions = { width: outWidth, height: outHeight };
    this.hardwareHint = this.options.settings.preferHardware ? 'prefer-hardware' : 'no-preference';
    this.videoSink = this.buildSink();
    this.audioSink = this.audioTrack ? new mb.AudioBufferSink(this.audioTrack) : null;

    try {
      const stats = await videoTrack.computePacketStats(40);
      if (stats.averagePacketRate > 1 && stats.averagePacketRate < 240) this.fps = stats.averagePacketRate;
    } catch {
      this.fps = 25;
    }

    try {
      const meta = await input.getDurationFromMetadata();
      this.durationValue = meta ?? 0;
    } catch {
      this.durationValue = 0;
    }
    if (!this.durationValue) {
      try {
        this.durationValue = await input.computeDuration();
      } catch {
        this.durationValue = 0;
      }
    }

    this.buildTracks(videoTracks, audioTracks);

    this.emit('meta', {
      duration: this.durationValue,
      width,
      height,
      live: false,
    });
    this.emit('duration', { duration: this.durationValue });

    this.anchorMedia = Math.min(Math.max(0, startAt), Math.max(0, this.durationValue - 0.1));
    this.anchorClock = this.clockNow;
    this.pausedValue = true;

    await this.restartPipelines(this.anchorMedia);
    await this.renderAt(this.anchorMedia);

    this.rafId = requestAnimationFrame(this.tick);
    this.emit('state', { paused: true, ended: false, buffering: false });
  }

  /** Primary/default track first, then the first one this device can decode. */
  private async pickAudioTrack(tracks: MB.InputAudioTrack[]): Promise<MB.InputAudioTrack | null> {
    if (tracks.length === 0) return null;
    let primary: MB.InputAudioTrack | null = null;
    try {
      primary = (await this.input?.getPrimaryAudioTrack()) ?? null;
    } catch {
      primary = null;
    }
    const ordered = [primary, ...tracks].filter((track): track is MB.InputAudioTrack => !!track);
    const seen = new Set<number>();
    for (const track of ordered) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      const decodable = await track.canDecode().catch(() => false);
      if (decodable) return track;
    }
    return null;
  }

  /** (Re)create the frame sink with the current hardware hint. */
  private buildSink(): MB.CanvasSink | null {
    if (!this.mb || !this.sinkOptions) return null;
    const track = this.videoTrackRef;
    if (!track) return null;
    return new this.mb.CanvasSink(track, {
      width: this.sinkOptions.width,
      height: this.sinkOptions.height,
      fit: 'contain',
      decoderOptions: { hardwareAcceleration: this.hardwareHint },
    });
  }

  private buildTracks(videoTracks: MB.InputVideoTrack[], audioTracks: MB.InputAudioTrack[]): void {
    const tracks: TrackInfo[] = [];
    videoTracks.forEach((track, index) => {
      tracks.push({
        id: `wc-video-${track.id}`,
        kind: 'video',
        index,
        label: index === 0 ? 'Primary video' : `Video ${index + 1}`,
        codec: track.codec ?? undefined,
        isDefault: index === 0,
      });
    });
    audioTracks.forEach((track, index) => {
      tracks.push({
        id: `wc-audio-${track.id}`,
        kind: 'audio',
        index,
        label: track.name || languageName(track.languageCode) || `Audio ${index + 1}`,
        language: languageName(track.languageCode),
        languageCode: track.languageCode === 'und' ? undefined : track.languageCode,
        codec: track.codec ?? undefined,
        channels: track.numberOfChannels,
        sampleRate: track.sampleRate,
        isDefault: this.audioTrack ? track.id === this.audioTrack.id : index === 0,
        isForced: track.disposition?.forced,
        isCommentary: track.disposition?.commentary,
      });
    });
    this.setTracks(tracks);
  }

  /* ------------------------------------------------------------- pipeline */

  private async cancelIterators(): Promise<void> {
    const video = this.videoIter;
    const audio = this.audioIter;
    this.videoIter = null;
    this.audioIter = null;
    try {
      await video?.return(undefined as never);
    } catch {
      /* ignore */
    }
    try {
      await audio?.return(undefined as never);
    } catch {
      /* ignore */
    }
  }

  private async restartPipelines(from: number): Promise<void> {
    await this.cancelIterators();
    // Invalidate any pump still waiting on the old iterator: without this a
    // decode retry (or a track switch) leaves videoPumping stuck at true and
    // no new frames are ever pulled.
    this.seekToken++;
    this.videoPumping = false;
    this.audioPumping = false;
    this.queue = [];
    this.streamEnded = false;
    this.scheduledUntil = from;
    if (this.videoSink) this.videoIter = this.videoSink.canvases(from) as unknown as AsyncGenerator<WrappedCanvasLike>;
    if (this.audioSink) this.audioIter = this.audioSink.buffers(from) as unknown as AsyncGenerator<WrappedAudioLike>;
  }

  private get clockNow(): number {
    return this.options.audioContext.currentTime;
  }

  /* --------------------------------------------------------------- render */

  private async renderAt(time: number): Promise<void> {
    if (!this.videoSink) return;
    const token = ++this.seekToken;
    try {
      const frame = await this.videoSink.getCanvas(time);
      if (!frame || token !== this.seekToken || this.destroyedFlag) return;
      this.drawFrame(frame as WrappedCanvasLike);
    } catch {
      /* a failed preview frame is not fatal */
    }
  }

  private drawFrame(frame: WrappedCanvasLike): void {
    if (this.lastDrawn === frame) return;
    try {
      if (!this.loggedFirstFrame) {
        this.loggedFirstFrame = true;
        log.debug('webcodecs first frame', { timestamp: frame.timestamp, width: (frame.canvas as HTMLCanvasElement).width });
      }
      const source = frame.canvas as CanvasImageSource;
      const width = 'width' in frame.canvas ? frame.canvas.width : this.canvas.width;
      const height = 'height' in frame.canvas ? frame.canvas.height : this.canvas.height;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.ctx2d.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
      this.lastDrawn = frame;
      this.lastTimestamp = Math.max(this.lastTimestamp, frame.timestamp + (frame.duration || 0));
    } catch {
      /* drawing a recycled canvas can fail; ignore */
    }
  }

  private tick = (): void => {
    if (this.destroyedFlag) return;
    this.rafId = requestAnimationFrame(this.tick);
    const now = this.currentTime;

    while (this.queue.length > 1 && this.queue[0].timestamp + this.queue[0].duration <= now) {
      this.queue.shift();
    }
    // Pick the newest queued frame that is due.
    let chosen: WrappedCanvasLike | null = null;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].timestamp <= now + 0.02) {
        chosen = this.queue[i];
        break;
      }
    }
    if (chosen) this.drawFrame(chosen);

    const starved = !this.pausedValue && !this.streamEnded && (this.queue.length === 0 || this.queue[0].timestamp > now + 0.75);
    if (starved !== this.buffering) {
      this.buffering = starved;
      this.emit('state', { paused: this.pausedValue, ended: this.ended, buffering: this.buffering });
    }

    if (this.streamEnded && this.queue.length === 0 && !this.ended) {
      const end = this.durationValue || this.lastTimestamp;
      if (now >= end - 0.05) {
        this.ended = true;
        this.pausedValue = true;
        this.flushAudio();
        this.emit('state', { paused: true, ended: true, buffering: false });
      }
    }

    const stamp = performance.now();
    if (stamp - this.lastEmit > 150) {
      this.lastEmit = stamp;
      this.emit('time', { currentTime: now, duration: this.durationValue });
    }
  };

  /** True while frames should be pulled — the loop idles when paused. */
  private get rendering(): boolean {
    return !this.pausedValue && !this.destroyedFlag;
  }

  private async pumpVideo(): Promise<void> {
    if (this.videoPumping || !this.videoIter) return;
    this.videoPumping = true;
    const token = this.seekToken;
    try {
      while (!this.destroyedFlag && !this.pausedValue && this.videoIter && token === this.seekToken) {
        if (this.queue.length >= Math.max(2, this.budget.frameQueue)) {
          await wait(20);
          continue;
        }
        if (!this.rendering) {
          await wait(80);
          continue;
        }
        const result = await this.videoIter.next();
        if (token !== this.seekToken) break;
        if (result.done) {
          this.streamEnded = true;
          break;
        }
        this.queue.push(result.value);
      }
    } catch (error) {
      const detail = (error as Error).message ?? String(error);
      if (this.destroyedFlag) return;
      // Some devices advertise hardware decoding and then fail on the first
      // frame. Retry once in software instead of giving up on the file.
      if (this.hardwareHint === 'prefer-hardware' && !this.retriedInSoftware) {
        log.warn('hardware decode unavailable, retrying in software:', detail);
        this.retriedInSoftware = true;
        this.hardwareHint = 'no-preference';
        const position = this.currentTime;
        this.emit('notice', {
          message: 'Hardware decoding failed — retrying this file in software.',
          level: 'warn',
        });
        this.videoSink = this.buildSink();
        this.queue = [];
        this.streamEnded = false;
        this.anchorMedia = position;
        this.anchorClock = this.clockNow;
        await this.restartPipelines(position);
        this.videoPumping = false;
        void this.pumpVideo();
        return;
      }
      log.error('webcodecs decode failed', detail);
      this.emit('error', {
        error: new AppError('decode-failed', { detail, engine: 'webcodecs' }),
        fatal: true,
      });
    } finally {
      this.videoPumping = false;
      log.debug('webcodecs video pump stopped', { queue: this.queue.length, ended: this.streamEnded });
    }
  }

  /* ---------------------------------------------------------------- audio */

  private async pumpAudio(): Promise<void> {
    if (this.audioPumping || !this.audioIter || !this.audioSink) return;
    this.audioPumping = true;
    const token = this.seekToken;
    const ahead = Math.min(2, Math.max(0.6, this.options.settings.bufferAhead / 20));
    try {
      while (!this.destroyedFlag && !this.pausedValue && this.audioIter && token === this.seekToken) {
        if (this.scheduledUntil > this.currentTime + ahead) {
          await wait(120);
          continue;
        }
        const result = await this.audioIter.next();
        if (token !== this.seekToken) break;
        if (result.done) break;
        this.scheduleBuffer(result.value);
      }
    } catch {
      /* audio decode failure: keep video playing silently */
      this.emit('notice', { message: 'Audio decoding failed for this track — video continues.', level: 'warn' });
    } finally {
      if (token === this.seekToken) this.audioPumping = false;
    }
  }

  private scheduleBuffer(item: WrappedAudioLike): void {
    const ctx = this.options.audioContext;
    const delay = this.options.settings.audioDelayMs / 1000;
    const when = this.anchorClock + (item.timestamp - this.anchorMedia) / this.rateValue + delay;
    const now = ctx.currentTime;
    if (when + item.duration < now) return; // already in the past
    try {
      const node = ctx.createBufferSource();
      node.buffer = item.buffer;
      node.playbackRate.value = this.rateValue;
      node.connect(this.options.audioDestination);
      node.start(Math.max(now + 0.01, when));
      this.activeNodes.add(node);
      node.onended = () => {
        this.activeNodes.delete(node);
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      };
      this.scheduledUntil = Math.max(this.scheduledUntil, item.timestamp + item.duration);
    } catch {
      /* ignore a single failed buffer */
    }
  }

  private flushAudio(): void {
    for (const node of this.activeNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.activeNodes.clear();
  }

  /* ------------------------------------------------------------ transport */

  async play(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      if (this.options.audioContext.state === 'suspended') await this.options.audioContext.resume();
      if (this.ended) {
        await this.seekInternal(0);
        this.ended = false;
      }
      this.pausedValue = false;
      this.anchorMedia = this.currentTime;
      this.anchorClock = this.clockNow;
      this.scheduledUntil = this.anchorMedia;
      this.flushAudio();
      await this.restartPipelines(this.anchorMedia);
      this.emit('state', { paused: false, ended: false, buffering: true });
      void this.pumpVideo();
      void this.pumpAudio();
      if (!this.rafId) this.rafId = requestAnimationFrame(this.tick);
    } finally {
      this.starting = false;
    }
  }

  pause(): void {
    if (this.pausedValue) return;
    const position = this.currentTime;
    this.pausedValue = true;
    this.anchorMedia = position;
    this.flushAudio();
    this.emit('state', { paused: true, ended: this.ended, buffering: false });
  }

  private async seekInternal(time: number): Promise<void> {
    const target = Math.min(Math.max(0, time), Math.max(0, (this.durationValue || Infinity) - 0.05));
    const wasPlaying = !this.pausedValue;
    this.flushAudio();
    this.anchorMedia = target;
    this.anchorClock = this.clockNow;
    this.lastDrawn = null;
    this.streamEnded = false;
    this.ended = false;
    await this.restartPipelines(target);
    await this.renderAt(target);
    this.emit('seeked', { currentTime: target });
    this.emit('time', { currentTime: target, duration: this.durationValue });
    if (wasPlaying) {
      void this.pumpVideo();
      void this.pumpAudio();
    }
  }

  seek(time: number): void {
    void this.seekInternal(time).catch(() => {
      /* seeking to an unreachable position should not kill playback */
    });
  }

  override setRate(rate: number): void {
    const position = this.currentTime;
    super.setRate(rate);
    this.anchorMedia = position;
    this.anchorClock = this.clockNow;
    this.scheduledUntil = position;
    if (!this.pausedValue) {
      this.flushAudio();
      void this.pumpAudio();
    }
  }

  /* -------------------------------------------------------------- tracks */

  override async selectAudioTrack(id: string): Promise<void> {
    if (!this.input || !this.mb) {
      throw new AppError('no-decoder', { message: 'This engine is not ready yet.', engine: 'webcodecs' });
    }
    const tracks = await this.input.getAudioTracks();
    const target = tracks.find((track) => `wc-audio-${track.id}` === id);
    if (!target) throw new AppError('unsupported-codec', { message: 'That audio track is no longer available.', engine: 'webcodecs' });
    if (target === this.audioTrack) return;

    const decodable = await target.canDecode().catch(() => false);
    if (!decodable) {
      const codec = (await target.getCodec().catch(() => null)) ?? 'this codec';
      throw new AppError('unsupported-codec', {
        message: `This device cannot decode the ${codecLabel(codec)} audio track`,
        engine: 'webcodecs',
        suggestions: ['Pick another language.', 'Use a file with AAC or Opus audio.'],
      });
    }

    const position = this.currentTime;
    const wasPlaying = !this.pausedValue;
    this.flushAudio();
    await this.cancelIterators();
    this.audioTrack = target;
    this.audioSink = new this.mb.AudioBufferSink(target);
    this.anchorMedia = position;
    this.anchorClock = this.clockNow;
    this.scheduledUntil = position;
    await this.restartPipelines(position);
    this.buildTracks(await this.input.getVideoTracks(), tracks);
    this.emit('notice', {
      message: `Audio track: ${target.name || languageName(target.languageCode) || 'selected'}`,
      level: 'info',
    });
    if (wasPlaying) {
      void this.pumpVideo();
      void this.pumpAudio();
    }
  }

  /* --------------------------------------------------------------- state */

  get currentTime(): number {
    if (this.pausedValue) return this.anchorMedia;
    const raw = this.anchorMedia + (this.clockNow - this.anchorClock) * this.rateValue;
    const max = this.durationValue || Number.POSITIVE_INFINITY;
    return Math.min(Math.max(0, raw), max);
  }

  get duration(): number {
    return this.durationValue;
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  get live(): boolean {
    return false;
  }

  get buffered(): Array<[number, number]> {
    if (!this.queue.length) return [];
    const start = this.queue[0].timestamp;
    const last = this.queue[this.queue.length - 1];
    return [[start, last.timestamp + last.duration]];
  }

  /** Frame-accurate stepping; only meaningful while paused. */
  async stepFrame(direction: 1 | -1): Promise<void> {
    const step = (1 / this.fps) * direction;
    await this.seekInternal(this.currentTime + step);
  }

  get frameRate(): number {
    return this.fps;
  }

  override destroy(): void {
    this.destroyedFlag = true;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.flushAudio();
    void this.cancelIterators();
    try {
      this.input?.dispose();
    } catch {
      /* ignore */
    }
    this.input = null;
    this.videoSink = null;
    this.audioSink = null;
    this.canvas.remove();
    super.destroy();
  }
}
