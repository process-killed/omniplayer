import type { Settings } from '../types';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_PRESETS: Record<string, number[]> = {
  Normal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Classical: [3, 2, 0, 0, 0, 0, -2, -2, -1, 2],
  Dance: [5, 4, 1, 0, 0, -2, -3, -2, 0, 1],
  Electronic: [4, 3, 1, 0, -1, -2, -2, 1, 2, 3],
  'Hip-hop': [5, 3, 1, 2, -1, -1, 1, 2, 3, 4],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  Pop: [-1, 0, 2, 4, 4, 2, 0, -1, -1, -1],
  Rock: [5, 4, 2, 0, -1, -1, 1, 2, 3, 4],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Movie: [4, 3, 1, 0, -1, 0, 2, 3, 3, 2],
  'Bass boost': [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 3, 4, 5, 5],
  Custom: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  playPause: 'Space',
  seekForward: 'ArrowRight',
  seekBackward: 'ArrowLeft',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  mute: 'm',
  fullscreen: 'f',
  pip: 'p',
  subtitles: 'c',
  audioTrack: 'a',
  speedUp: ']',
  speedDown: '[',
  next: 'n',
  previous: 'b',
  frameForward: '.',
  frameBackward: ',',
  addBookmark: 'k',
  abLoop: 'l',
  diagnostics: 'i',
  screenshot: 's',
};

export const KEY_ACTION_LABELS: Record<string, string> = {
  playPause: 'Play / pause',
  seekForward: 'Seek forward',
  seekBackward: 'Seek backward',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  mute: 'Mute',
  fullscreen: 'Fullscreen',
  pip: 'Picture-in-Picture',
  subtitles: 'Toggle subtitles',
  audioTrack: 'Next audio track',
  speedUp: 'Increase speed',
  speedDown: 'Decrease speed',
  next: 'Next in queue',
  previous: 'Previous in queue',
  frameForward: 'Next frame',
  frameBackward: 'Previous frame',
  addBookmark: 'Add bookmark',
  abLoop: 'A-B loop',
  diagnostics: 'Diagnostics overlay',
  screenshot: 'Save frame as PNG',
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#6d5efc',
  density: 'comfortable',
  language: 'en',
  autoPlay: true,
  startMuted: false,
  rememberPosition: true,
  resumeThreshold: 15,

  defaultRate: 1,
  seekStep: 10,
  seekStepLarge: 30,
  pitchPreserved: true,
  autoNext: true,
  loopMode: 'off',
  shuffle: false,
  skipIntroSeconds: 85,
  skipOutroSeconds: 30,
  frameStepOnPause: true,

  preferredAudioLanguage: '',
  fallbackAudioLanguage: '',
  preferOriginalAudio: true,
  volume: 1,
  muted: false,
  normalizeVolume: false,
  eqEnabled: false,
  eqPreset: 'Normal',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bassBoost: 0,
  balance: 0,
  audioDelayMs: 0,
  mono: false,

  preferredSubtitleLanguage: '',
  autoLoadSubtitles: true,
  subtitleEnabled: true,
  subtitleFont: 'Inter',
  subtitleSize: 26,
  subtitleColor: '#ffffff',
  subtitleOutline: 2,
  subtitleShadow: 6,
  subtitleOpacity: 1,
  subtitleBackground: 0,
  subtitleWeight: 600,
  subtitlePosition: 8,
  subtitleWidth: 86,
  subtitleDelayMs: 0,

  gesturesEnabled: true,
  doubleTapSeek: true,
  doubleTapSeekSeconds: 10,
  swipeSeek: true,
  swipeSeekSensitivity: 1,
  verticalSwipe: 'volume-brightness',
  longPressSpeed: 2,
  pinchZoom: true,

  requestTimeout: 20,
  retryCount: 3,
  bufferAhead: 30,
  lowLatencyLive: true,
  customHeaders: '',
  danmakuEnabled: false,
  danmakuOpacity: 0.9,
  danmakuFontScale: 1,
  danmakuSpeed: 1,
  danmakuArea: 0.5,
  torrentGateway: '',
  torrentProvider: 'webtorrent',
  deviceProfile: 'auto',
  corsProxy: '',

  lowMemoryMode: 'auto',
  maxBufferMb: 220,
  thumbnailPreviews: true,
  thumbnailQuality: 'medium',

  enginePreference: 'auto',
  allowWebCodecs: true,
  preferHardware: true,

  playerChromeDelay: 2800,
  showDiagnosticsOverlay: false,
  reduceMotion: false,

  saveHistory: true,
  saveUrlHistory: true,
  persistVolume: true,

  keyboardEnabled: true,
  keyboardBindings: { ...DEFAULT_KEYBINDINGS },

  logLevel: 'warn',
};

const STORAGE_KEY = 'omniplay:settings:v1';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function coerce<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  const def = DEFAULT_SETTINGS[key];
  if (typeof def === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    return (Number.isFinite(num) ? (num as Settings[K]) : undefined);
  }
  if (typeof def === 'boolean') {
    return (typeof value === 'boolean' ? (value as Settings[K]) : undefined);
  }
  if (typeof def === 'string') {
    return (typeof value === 'string' ? (value as Settings[K]) : undefined);
  }
  if (Array.isArray(def)) {
    return (Array.isArray(value) ? (value as Settings[K]) : undefined);
  }
  if (def && typeof def === 'object') {
    return (value && typeof value === 'object' ? (value as Settings[K]) : undefined);
  }
  return undefined;
}

export function loadSettings(): Settings {
  const settings = clone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return settings;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
      if (!(key in parsed)) continue;
      const value = coerce(key, parsed[key]);
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (settings as any)[key] = value;
      }
    }
    if (!Array.isArray(settings.eqGains) || settings.eqGains.length !== 10) {
      settings.eqGains = [...DEFAULT_SETTINGS.eqGains];
    }
    settings.keyboardBindings = { ...DEFAULT_KEYBINDINGS, ...(settings.keyboardBindings ?? {}) };
  } catch {
    /* corrupted settings — fall back to defaults */
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota or private mode — settings simply won't persist */
  }
}

export function exportSettings(settings: Settings): string {
  return JSON.stringify({ app: 'omniplay', version: 1, exportedAt: new Date().toISOString(), settings }, null, 2);
}

export function importSettings(text: string): { settings: Settings; count: number } {
  const parsed = JSON.parse(text) as { settings?: Record<string, unknown> } | Record<string, unknown>;
  const incoming = ('settings' in parsed ? parsed.settings : parsed) as Record<string, unknown> | undefined;
  if (!incoming || typeof incoming !== 'object') throw new Error('No settings object found in this file.');
  const merged = clone(DEFAULT_SETTINGS);
  let count = 0;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!(key in incoming)) continue;
    const value = coerce(key, incoming[key]);
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = value;
      count++;
    }
  }
  merged.keyboardBindings = { ...DEFAULT_KEYBINDINGS, ...(merged.keyboardBindings ?? {}) };
  if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== 10) merged.eqGains = [...DEFAULT_SETTINGS.eqGains];
  return { settings: merged, count };
}

export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--accent-strong', lighten(settings.accent, 18));
  root.style.setProperty('--accent-soft', hexToRgba(settings.accent, 0.16));
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = settings.theme === 'light' ? '#f4f5f9' : settings.theme === 'amoled' ? '#000000' : '#0a0b0f';
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(109, 94, 252, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lighten(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const clamp = (n: number) => Math.min(255, Math.max(0, n));
  const r = clamp(((num >> 16) & 255) + amount);
  const g = clamp(((num >> 8) & 255) + amount);
  const b = clamp((num & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const ACCENT_CHOICES = [
  '#6d5efc',
  '#22d3ee',
  '#34d399',
  '#f59e0b',
  '#f472b6',
  '#ef4444',
  '#a3e635',
  '#818cf8',
];
