import type { Cue, EngineCapabilities, EngineKind, ResolvedSource, TrackInfo } from '../types';
import { BaseEngine } from './base';
import { AppError, mediaElementError } from '../core/errors';

interface AudioTrackListLike {
  length: number;
  [index: number]: { id: string; label: string; language: string; enabled: boolean; kind: string };
  addEventListener?: (type: string, listener: () => void) => void;
}

/** Plain HTML5 <video> playback — the fastest, most compatible path. */
export class NativeEngine extends BaseEngine {
  readonly kind: EngineKind = 'native';
  readonly capabilities: EngineCapabilities = {
    seek: true,
    audioTracks: false,
    subtitleTracks: true,
    qualityLevels: false,
    live: false,
    audioGraph: true,
    pitchPreserved: true,
    frameStep: false,
  };

  override readonly video: HTMLVideoElement;
  private loadReject: ((error: Error) => void) | null = null;
  private loadTimer: number | null = null;
  private lastTimeEmit = 0;

  constructor(private readonly pitchPreserved = true) {
    super();
    const video = document.createElement('video');
    video.className = 'player__video';
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = false;
    video.disablePictureInPicture = false;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('aria-label', 'Video');
    this.video = video;
    this.wire();
  }

  private wire(): void {
    const v = this.video;
    v.addEventListener('loadedmetadata', () => {
      this.clearLoadTimer();
      this.emit('meta', {
        duration: v.duration,
        width: v.videoWidth || undefined,
        height: v.videoHeight || undefined,
        live: !Number.isFinite(v.duration),
      });
      this.emit('duration', { duration: v.duration });
      this.collectTracks();
      this.emit('chapters', { chapters: this.readChapters() });
    });
    v.addEventListener('durationchange', () => this.emit('duration', { duration: v.duration }));
    v.addEventListener('timeupdate', () => {
      const now = performance.now();
      if (now - this.lastTimeEmit < 120) return;
      this.lastTimeEmit = now;
      this.emit('time', { currentTime: v.currentTime, duration: v.duration });
    });
    v.addEventListener('seeking', () => this.emit('state', { paused: v.paused, ended: v.ended, buffering: true }));
    v.addEventListener('seeked', () => {
      this.emit('seeked', { currentTime: v.currentTime });
      this.emit('state', { paused: v.paused, ended: v.ended, buffering: false });
    });
    v.addEventListener('waiting', () => this.emit('state', { paused: v.paused, ended: v.ended, buffering: true }));
    v.addEventListener('playing', () => this.emit('state', { paused: false, ended: false, buffering: false }));
    v.addEventListener('play', () => this.emit('state', { paused: false, ended: false, buffering: false }));
    v.addEventListener('pause', () => this.emit('state', { paused: true, ended: v.ended, buffering: false }));
    v.addEventListener('ended', () => this.emit('state', { paused: true, ended: true, buffering: false }));
    v.addEventListener('canplay', () => this.emit('state', { paused: v.paused, ended: false, buffering: false }));
    v.addEventListener('progress', () => this.emit('buffered', { ranges: this.buffered }));
    v.addEventListener('ratechange', () => {
      this.rateValue = v.playbackRate;
      this.emit('rate', { rate: v.playbackRate });
    });
    v.addEventListener('volumechange', () => {
      this.volumeValue = v.volume;
      this.mutedValue = v.muted;
      this.emit('volume', { volume: v.volume, muted: v.muted });
    });
    v.addEventListener('error', () => {
      const error = mediaElementError(v, v.currentSrc);
      this.clearLoadTimer();
      this.loadReject?.(error);
      this.loadReject = null;
      this.emit('error', { error, fatal: true });
    });
    v.addEventListener('resize', () => {
      this.emit('meta', { duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    });
  }

  attach(container: HTMLElement): void {
    if (this.video.parentElement !== container) container.append(this.video);
  }

  /** Shorten the metadata deadline (used when the host blocks byte access). */
  setLoadTimeout(ms: number): void {
    this.loadTimeoutMs = ms;
  }

  private loadTimeoutMs = 30_000;

  override async load(source: ResolvedSource, startAt: number): Promise<void> {
    const v = this.video;
    v.pause();
    v.removeAttribute('src');
    v.load();

    const ready = new Promise<void>((resolve, reject) => {
      this.loadReject = reject;
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(mediaElementError(v, source.playbackUrl));
      };
      const cleanup = () => {
        v.removeEventListener('loadedmetadata', onReady);
        v.removeEventListener('error', onError);
        this.clearLoadTimer();
      };
      v.addEventListener('loadedmetadata', onReady, { once: true });
      v.addEventListener('error', onError, { once: true });
      this.loadTimer = window.setTimeout(() => {
        cleanup();
        reject(new AppError('timeout', { detail: 'The browser did not load media metadata in time.' }));
      }, this.loadTimeoutMs);
    });

    v.src = source.playbackUrl;
    v.load();
    await ready;
    this.loadReject = null;

    // WebM files written by MediaRecorder (and some live captures) report
    // duration === Infinity even though they are finite. Seeking past the end
    // forces the browser to resolve the real duration; without this the player
    // would wrongly show a LIVE badge and a dead timeline.
    if (!Number.isFinite(v.duration) && (source.kind === 'file' || source.kind === 'progressive')) {
      await this.resolveUnknownDuration(v, startAt);
    }

    v.volume = this.volumeValue;
    v.muted = this.mutedValue;
    v.playbackRate = this.rateValue;
    this.applyPitchSetting();

    if (startAt > 0 && Number.isFinite(startAt)) {
      try {
        v.currentTime = startAt;
      } catch {
        /* seeking before metadata settles can throw; playback still starts */
      }
    }
  }

  /** Force duration resolution for containers without a duration header. */
  private async resolveUnknownDuration(video: HTMLVideoElement, restoreTo: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('durationchange', onChange);
        window.clearTimeout(timer);
        resolve();
      };
      const onChange = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) finish();
      };
      const timer = window.setTimeout(finish, 2500);
      video.addEventListener('durationchange', onChange);
      try {
        video.currentTime = 1e101;
      } catch {
        finish();
      }
    });
    try {
      video.currentTime = restoreTo > 0 && Number.isFinite(video.duration) ? Math.min(restoreTo, video.duration - 0.1) : 0;
    } catch {
      /* ignore */
    }
    if (Number.isFinite(video.duration)) {
      this.emit('duration', { duration: video.duration });
      this.emit('meta', { duration: video.duration, width: video.videoWidth, height: video.videoHeight, live: false });
    }
  }

  private applyPitchSetting(): void {
    const anyVideo = this.video as HTMLVideoElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    if ('preservesPitch' in anyVideo) anyVideo.preservesPitch = this.pitchPreserved;
    if ('mozPreservesPitch' in anyVideo) anyVideo.mozPreservesPitch = this.pitchPreserved;
    if ('webkitPreservesPitch' in anyVideo) anyVideo.webkitPreservesPitch = this.pitchPreserved;
  }

  private clearLoadTimer(): void {
    if (this.loadTimer) {
      window.clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  private collectTracks(): void {
    const tracks: TrackInfo[] = [];
    const video = this.video as HTMLVideoElement & { audioTracks?: AudioTrackListLike };
    const audioList = video.audioTracks;
    if (audioList && audioList.length > 0) {
      for (let i = 0; i < audioList.length; i++) {
        const track = audioList[i];
        tracks.push({
          id: `native-audio-${track.id ?? i}`,
          kind: 'audio',
          index: i,
          label: track.label || track.language || `Audio ${i + 1}`,
          language: track.language || undefined,
          languageCode: track.language || undefined,
          isDefault: track.enabled || (i === 0 && !audioList[0]?.enabled),
        });
      }
      this.capabilities.audioTracks = audioList.length > 1;
    } else if (this.hasAudio()) {
      tracks.push({
        id: 'native-audio-default',
        kind: 'audio',
        index: 0,
        label: 'Default audio (browser-managed)',
        isDefault: true,
      });
    }

    const textTracks = this.video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      const track = textTracks[i];
      if (track.kind === 'chapters') continue;
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      tracks.push({
        id: `native-sub-${i}`,
        kind: 'subtitle',
        index: i,
        label: track.label || track.language || `Subtitle ${i + 1}`,
        language: track.language || undefined,
        languageCode: track.language || undefined,
      });
    }
    this.setTracks(tracks);
  }

  private hasAudio(): boolean {
    const v = this.video as HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: AudioTrackListLike;
    };
    if (v.mozHasAudio !== undefined) return v.mozHasAudio;
    if (v.webkitAudioDecodedByteCount !== undefined) return v.webkitAudioDecodedByteCount > 0 || true;
    return true;
  }

  private readChapters(): Array<{ start: number; end: number; title: string }> {
    const chapters: Array<{ start: number; end: number; title: string }> = [];
    const textTracks = this.video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      const track = textTracks[i];
      if (track.kind !== 'chapters' || !track.cues) continue;
      for (let c = 0; c < track.cues.length; c++) {
        const cue = track.cues[c] as VTTCue;
        chapters.push({ start: cue.startTime, end: cue.endTime, title: (cue.text || `Chapter ${c + 1}`).trim() });
      }
    }
    return chapters;
  }

  /** Pull embedded text-track cues (MP4/WebVTT in-file subtitles). */
  async extractSubtitleCues(trackId: string): Promise<Cue[]> {
    const match = /^native-sub-(\d+)$/.exec(trackId);
    if (!match) return [];
    const track = this.video.textTracks[Number(match[1])];
    if (!track) return [];
    track.mode = 'hidden';
    const start = performance.now();
    while ((!track.cues || track.cues.length === 0) && performance.now() - start < 4000) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    const cues: Cue[] = [];
    if (track.cues) {
      for (let i = 0; i < track.cues.length; i++) {
        const cue = track.cues[i] as VTTCue;
        cues.push({
          start: cue.startTime,
          end: cue.endTime,
          text: (cue as unknown as { text: string }).text ?? '',
        });
      }
    }
    track.mode = 'disabled';
    return cues;
  }

  override async selectAudioTrack(id: string): Promise<void> {
    const video = this.video as HTMLVideoElement & { audioTracks?: AudioTrackListLike };
    const list = video.audioTracks;
    if (!list) throw new AppError('unsupported-codec', { message: 'This browser does not expose audio track switching.' });
    for (let i = 0; i < list.length; i++) {
      list[i].enabled = `native-audio-${list[i].id ?? i}` === id;
    }
  }

  override async play(): Promise<void> {
    try {
      await this.video.play();
    } catch (error) {
      const err = error as DOMException;
      if (err.name === 'NotAllowedError') {
        throw new AppError('decode-failed', {
          message: 'The browser blocked autoplay. Press play to start.',
          suggestions: ['Tap the play button.', 'Enable autoplay for this site in your browser settings.'],
        });
      }
      if (err.name === 'NotSupportedError') throw mediaElementError(this.video, this.video.currentSrc);
      if (err.name === 'AbortError') return;
      throw err;
    }
  }

  override pause(): void {
    this.video.pause();
  }

  override seek(time: number): void {
    if (!Number.isFinite(time)) return;
    const max = Number.isFinite(this.video.duration) ? this.video.duration : time;
    this.video.currentTime = Math.min(Math.max(0, time), Math.max(0, max - 0.05));
  }

  override setVolume(volume: number): void {
    super.setVolume(volume);
    this.video.volume = this.volumeValue;
  }

  override setMuted(muted: boolean): void {
    super.setMuted(muted);
    this.video.muted = muted;
  }

  override setRate(rate: number): void {
    super.setRate(rate);
    try {
      this.video.playbackRate = rate;
      this.applyPitchSetting();
    } catch {
      /* some browsers clamp extreme rates */
    }
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  get duration(): number {
    return this.video.duration;
  }

  get paused(): boolean {
    return this.video.paused;
  }

  get live(): boolean {
    return !Number.isFinite(this.video.duration) || this.video.duration === Infinity;
  }

  get buffered(): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const b = this.video.buffered;
    for (let i = 0; i < b.length; i++) ranges.push([b.start(i), b.end(i)]);
    return ranges;
  }

  override destroy(): void {
    this.clearLoadTimer();
    this.video.pause();
    this.video.removeAttribute('src');
    try {
      this.video.load();
    } catch {
      /* ignore */
    }
    this.video.remove();
    super.destroy();
  }
}
