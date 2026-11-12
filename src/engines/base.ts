import type {
  EngineCapabilities,
  EngineEventHandler,
  EngineEvents,
  EngineKind,
  PlaybackEngine,
  QualityLevel,
  ResolvedSource,
  TrackInfo,
} from '../types';
import { Emitter } from '../utils/emitter';

/** Shared plumbing for every engine: events, track bookkeeping, lifecycle. */
export abstract class BaseEngine implements PlaybackEngine {
  abstract readonly kind: EngineKind;
  abstract readonly capabilities: EngineCapabilities;
  readonly video: HTMLVideoElement | null = null;
  readonly canvas: HTMLCanvasElement | null = null;

  protected readonly emitter = new Emitter<EngineEvents>();
  protected tracks: TrackInfo[] = [];
  protected destroyed = false;
  protected volumeValue = 1;
  protected mutedValue = false;
  protected rateValue = 1;

  on<K extends keyof EngineEvents>(event: K, handler: EngineEventHandler<K>): () => void {
    return this.emitter.on(event, handler);
  }

  protected emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    if (this.destroyed && event !== 'error') return;
    this.emitter.emit(event, payload);
  }

  abstract attach(container: HTMLElement): void;
  abstract load(source: ResolvedSource, startAt: number): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): void;
  abstract seek(time: number): void;
  abstract get currentTime(): number;
  abstract get duration(): number;
  abstract get paused(): boolean;
  abstract get buffered(): Array<[number, number]>;
  abstract get live(): boolean;

  getTracks(): TrackInfo[] {
    return this.tracks;
  }

  async selectAudioTrack(_id: string): Promise<void> {
    throw new Error('This engine cannot switch audio tracks');
  }

  async selectSubtitleTrack(_id: string): Promise<void> {
    throw new Error('This engine cannot switch subtitle tracks');
  }

  setQuality(_id: string): void {
    /* single-quality engines ignore this */
  }

  getQualities(): QualityLevel[] {
    return [];
  }

  setVolume(volume: number): void {
    this.volumeValue = Math.min(1, Math.max(0, volume));
    this.emit('volume', { volume: this.volumeValue, muted: this.mutedValue });
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    this.emit('volume', { volume: this.volumeValue, muted });
  }

  setRate(rate: number): void {
    this.rateValue = rate;
    this.emit('rate', { rate });
  }

  destroy(): void {
    this.destroyed = true;
    this.emitter.clear();
    this.tracks = [];
  }

  protected setTracks(tracks: TrackInfo[]): void {
    this.tracks = tracks;
    this.emit('tracks', { tracks });
  }
}
