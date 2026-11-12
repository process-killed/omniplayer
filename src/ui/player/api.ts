import type { Chapter, EngineKind } from '../../types';
import type { PlaybackManager } from '../../core/playbackManager';
import type { Store } from '../../app/store';
import type { SubtitleManager } from '../../subtitles/subtitleManager';
import type { VideoAdjustments } from '../../video/adjustments';
import type { MkvSubtitleTrack } from '../../subtitles/matroska';

export type PanelKind = 'tracks' | 'audio' | 'subtitles' | 'danmaku' | 'video' | 'playback' | 'info';

export interface AbLoop {
  a: number | null;
  b: number | null;
}

/** Everything the panels need from the player page. */
export interface PlayerApi {
  readonly pm: PlaybackManager;
  readonly store: Store;
  readonly subtitles: SubtitleManager;
  readonly chapters: Chapter[];
  readonly abLoop: AbLoop;
  readonly adjustments: VideoAdjustments;
  readonly brightness: number;
  readonly rate: number;
  readonly sleepRemaining: number | null;
  setAdjustments(next: VideoAdjustments): void;
  setRate(rate: number): void;
  setBrightness(value: number): void;
  setAbLoop(next: AbLoop): void;
  setSleepTimer(minutes: number | null): void;
  seek(time: number): void;
  openPanel(kind: PanelKind): void;
  closePanel(): void;
  addBookmark(label: string): void;
  /** Danmaku (bullet comments) surface used by the panel. */
  danmakuCount: number;
  addDanmaku(text: string): boolean;
  importDanmaku(text: string, fileName?: string): number;
  clearDanmaku(): void;

  /** Reload the current media with a specific engine, keeping the position. */
  reloadWithEngine(engine: EngineKind, audioLanguage?: string): Promise<void>;
  /** Subtitle tracks found inside the container (MKV/WebM). */
  readonly embeddedTracks: MkvSubtitleTrack[];
  /** True once a container subtitle track has been extracted. */
  isEmbeddedLoaded(trackNumber: number): boolean;
  /** Extract and select an embedded subtitle track. */
  loadEmbeddedSubtitle(track: MkvSubtitleTrack): Promise<void>;
  notify(message: string, kind?: 'ok' | 'warn' | 'err' | 'info'): void;
  refreshPanel(): void;
}
