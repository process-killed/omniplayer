/**
 * Shared types for OmniPlay.
 *
 * Everything here is intentionally plain data — no classes — so the same
 * shapes can cross module, worker and storage boundaries unchanged.
 */

export type EngineKind = 'native' | 'hls' | 'dash' | 'webcodecs';

export type TrackKind = 'video' | 'audio' | 'subtitle';

export interface Cue {
  start: number;
  end: number;
  text: string;
  /** ASS style name, when the cue comes from an ASS/SSA script. */
  style?: string;
  /** ASS layer (higher draws on top). */
  layer?: number;
}

export interface TrackInfo {
  id: string;
  kind: TrackKind;
  label: string;
  language?: string;
  languageCode?: string;
  codec?: string;
  channels?: number;
  sampleRate?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  isDefault?: boolean;
  isForced?: boolean;
  isCommentary?: boolean;
  isHearingImpaired?: boolean;
  /** Engine-specific index (native textTracks / MSE index / WebCodecs track id). */
  index: number;
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface QualityLevel {
  id: string;
  label: string;
  height?: number;
  width?: number;
  bitrate?: number;
}

/** Where media comes from. Exactly one of `file` / `url` is set. */
export interface MediaSourceSpec {
  /** Stable id used by history/bookmarks. */
  id: string;
  kind: 'file' | 'url';
  name: string;
  url?: string;
  file?: File;
  mime?: string;
  size?: number;
  /** Extra request headers for engines that can apply them (hls.js, dash.js, mediabunny). */
  headers?: Record<string, string>;
  /** Optional poster / thumbnail data URL. */
  poster?: string;
  /** Backup URLs, tried in order when the primary fails. */
  sources?: string[];
  /** When set, the media is played by the provider's own embed. */
  provider?: { name: string; embedUrl: string; reason?: string };
  /** Origin of the entry, for history display. */
  addedAt?: number;
  /** Preferred start position in seconds. */
  startAt?: number;
  /** Language hints carried from the library. */
  audioLanguage?: string;
  subtitleLanguage?: string;
  /** Set when the host refused browser access; avoids doomed fetches. */
  corsBlocked?: boolean;
}

export interface ProbeInfo {
  container?: string;
  containerLabel?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  duration?: number;
  bitrate?: number;
  frameRate?: number;
  videoTracks: TrackInfo[];
  audioTracks: TrackInfo[];
  subtitleTracks: TrackInfo[];
  chapters: Chapter[];
  isLive?: boolean;
  /** Which detector produced this: 'bytes' | 'mediabunny' | 'http' | 'manifest'. */
  method: 'bytes' | 'mediabunny' | 'http' | 'manifest' | 'element';
  /** Raw notes for diagnostics. */
  notes?: string[];
}

export interface NetworkInfo {
  finalUrl?: string;
  contentType?: string;
  contentLength?: number;
  acceptRanges?: boolean;
  status?: number;
  redirects?: string[];
  corsOk?: boolean;
  /** True when requests were routed through the configured CORS proxy. */
  proxied?: boolean;
  /** Which probe step failed, for diagnostics. */
  failure?: 'cors' | 'http' | 'timeout' | 'offline';
  /** True when the host answered a ranged GET. */
  rangeOk?: boolean;
  probedRange?: boolean;
  error?: string;
}

export interface ResolvedSource {
  spec: MediaSourceSpec;
  /** The URL the browser will actually use (blob: for local files). */
  playbackUrl: string;
  /** Object URL to revoke on teardown. */
  objectUrl?: string;
  kind: 'progressive' | 'hls' | 'dash' | 'file';
  network?: NetworkInfo;
  probe?: ProbeInfo;
}

export interface EngineCapabilities {
  seek: boolean;
  audioTracks: boolean;
  subtitleTracks: boolean;
  qualityLevels: boolean;
  live: boolean;
  /** Audio graph (Web Audio) can process this engine's output. */
  audioGraph: boolean;
  /** Speed changes preserve pitch. */
  pitchPreserved: boolean;
  frameStep: boolean;
}

export interface EngineEvents {
  time: { currentTime: number; duration: number };
  duration: { duration: number };
  state: { paused: boolean; ended: boolean; buffering: boolean };
  volume: { volume: number; muted: boolean };
  rate: { rate: number };
  tracks: { tracks: TrackInfo[] };
  quality: { levels: QualityLevel[]; active: string };
  chapters: { chapters: Chapter[] };
  buffered: { ranges: Array<[number, number]> };
  error: { error: Error; fatal: boolean };
  seeked: { currentTime: number };
  meta: { duration: number; width?: number; height?: number; live?: boolean };
  notice: { message: string; level?: 'info' | 'warn' };
}

export type EngineEventHandler<K extends keyof EngineEvents> = (payload: EngineEvents[K]) => void;

export interface PlaybackEngine {
  readonly kind: EngineKind;
  readonly capabilities: EngineCapabilities;
  /** Element used for rendering, if the engine renders into a <video>. */
  readonly video: HTMLVideoElement | null;
  /** Canvas used for rendering, if the engine draws frames itself. */
  readonly canvas: HTMLCanvasElement | null;

  attach(container: HTMLElement): void;
  load(source: ResolvedSource, startAt: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setRate(rate: number): void;

  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly buffered: Array<[number, number]>;
  readonly live: boolean;

  getTracks(): TrackInfo[];
  /** Optional: pull embedded text cues (native text tracks only). */
  extractSubtitleCues?(id: string): Promise<Cue[]>;
  selectAudioTrack(id: string): Promise<void>;
  selectSubtitleTrack(id: string): Promise<void>;
  setQuality(id: string): void;
  getQualities(): QualityLevel[];

  on<K extends keyof EngineEvents>(event: K, handler: EngineEventHandler<K>): () => void;
  destroy(): void;
}

export interface PlaybackDiagnostics {
  engine: EngineKind;
  engineChain: EngineKind[];
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  bitrate?: number;
  duration?: number;
  droppedFrames?: number;
  totalFrames?: number;
  decoderPath?: string;
  hardwareAcceleration?: string;
  buffering?: boolean;
  bufferHealth?: number;
  playbackRate?: number;
  url?: string;
  notes: string[];
}

export interface HistoryEntry {
  id: string;
  name: string;
  kind: 'file' | 'url';
  url?: string;
  size?: number;
  mime?: string;
  duration: number;
  position: number;
  updatedAt: number;
  completed: boolean;
  poster?: string;
  engine?: EngineKind;
  container?: string;
}

export interface BookmarkEntry {
  id: string;
  mediaId: string;
  mediaName: string;
  url?: string;
  kind: 'file' | 'url';
  time: number;
  label: string;
  note?: string;
  createdAt: number;
  thumbnail?: string;
}

export interface PlaylistEntry {
  id: string;
  name: string;
  items: PlaylistItem[];
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistItem {
  id: string;
  name: string;
  kind: 'file' | 'url';
  url?: string;
  duration?: number;
  poster?: string;
}

export interface UrlRecord {
  id: string;
  url: string;
  name: string;
  lastUsed: number;
}

export interface AppErrorInfo {
  code: string;
  title: string;
  message: string;
  detail?: string;
  suggestions: string[];
  fatal: boolean;
  engine?: EngineKind;
}

export type ThemeName = 'dark' | 'light' | 'amoled';
export type Density = 'comfortable' | 'compact';

export interface Settings {
  // General
  theme: ThemeName;
  accent: string;
  density: Density;
  language: string;
  autoPlay: boolean;
  startMuted: boolean;
  rememberPosition: boolean;
  resumeThreshold: number;
  // Playback
  defaultRate: number;
  seekStep: number;
  seekStepLarge: number;
  pitchPreserved: boolean;
  autoNext: boolean;
  loopMode: 'off' | 'one' | 'all';
  shuffle: boolean;
  skipIntroSeconds: number;
  skipOutroSeconds: number;
  frameStepOnPause: boolean;
  // Audio
  preferredAudioLanguage: string;
  fallbackAudioLanguage: string;
  preferOriginalAudio: boolean;
  volume: number;
  muted: boolean;
  normalizeVolume: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  bassBoost: number;
  balance: number;
  audioDelayMs: number;
  mono: boolean;
  // Subtitles
  preferredSubtitleLanguage: string;
  autoLoadSubtitles: boolean;
  subtitleEnabled: boolean;
  subtitleFont: string;
  subtitleSize: number;
  subtitleColor: string;
  subtitleOutline: number;
  subtitleShadow: number;
  subtitleOpacity: number;
  subtitleBackground: number;
  subtitleWeight: number;
  subtitlePosition: number;
  subtitleWidth: number;
  subtitleDelayMs: number;
  // Gestures
  gesturesEnabled: boolean;
  doubleTapSeek: boolean;
  doubleTapSeekSeconds: number;
  swipeSeek: boolean;
  swipeSeekSensitivity: number;
  verticalSwipe: 'volume-brightness' | 'volume' | 'off';
  longPressSpeed: number;
  pinchZoom: boolean;
  // Network
  requestTimeout: number;
  retryCount: number;
  bufferAhead: number;
  lowLatencyLive: boolean;
  customHeaders: string;
  danmakuEnabled: boolean;
  danmakuOpacity: number;
  danmakuFontScale: number;
  danmakuSpeed: number;
  danmakuArea: number;
  torrentGateway: string;
  /** 'auto' follows the detected device profile. */
  deviceProfile: 'auto' | 'low' | 'balanced' | 'high' | 'tv';
  /** Optional CORS proxy template, e.g. https://worker.dev/?url={url} */
  corsProxy: string;
  // Performance
  lowMemoryMode: 'auto' | 'on' | 'off';
  maxBufferMb: number;
  thumbnailPreviews: boolean;
  thumbnailQuality: 'low' | 'medium' | 'high';
  // Decoder
  enginePreference: 'auto' | 'native' | 'webcodecs';
  allowWebCodecs: boolean;
  preferHardware: boolean;
  // Appearance
  playerChromeDelay: number;
  showDiagnosticsOverlay: boolean;
  reduceMotion: boolean;
  // Privacy
  saveHistory: boolean;
  saveUrlHistory: boolean;
  persistVolume: boolean;
  // Keyboard
  keyboardEnabled: boolean;
  keyboardBindings: Record<string, string>;
  // Advanced
  logLevel: 'off' | 'error' | 'warn' | 'info' | 'debug';
}

export interface AppState {
  route: RouteName;
  params: Record<string, string>;
  current?: MediaSourceSpec;
  settings: Settings;
  engine?: EngineKind;
  error?: AppErrorInfo;
  notice?: string;
}

export type RouteName =
  | 'home'
  | 'open'
  | 'url'
  | 'player'
  | 'embed'
  | 'share'
  | 'torrents'
  | 'downloads'
  | 'developers'
  | 'playlist'
  | 'history'
  | 'bookmarks'
  | 'settings'
  | 'diagnostics'
  | 'about';
