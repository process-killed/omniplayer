/**
 * Device profiles.
 *
 * The browser's hints are approximate by design (Firefox reports no deviceMemory,
 * Safari caps hardwareConcurrency), so unknown values lead to a *conservative*
 * profile rather than an optimistic one. A device is never assumed powerful just
 * because it reports many cores.
 */

export type ProfileId = 'low' | 'balanced' | 'high' | 'tv';

export interface DeviceBudgets {
  /** Cap for decoded output height (WebCodecs canvas). */
  maxDecodeHeight: number;
  /** Decoded video frames kept in flight. */
  frameQueue: number;
  /** Seconds of audio scheduled ahead. */
  audioAhead: number;
  /** Buffer target in MB for demuxed bytes. */
  cacheMb: number;
  /** Picture filters, blur and heavy CSS effects. */
  effects: boolean;
  /** Danmaku spawn rate per second (0 disables throttling). */
  danmakuPerSecond: number;
  /** Timeline thumbnails and storyboards. */
  thumbnails: boolean;
  /** Subtitle effects (blur, shadows, karaoke timing). */
  subtitleEffects: boolean;
}

export const PROFILES: Record<ProfileId, DeviceBudgets> = {
  low: {
    maxDecodeHeight: 720,
    frameQueue: 3,
    audioAhead: 0.8,
    cacheMb: 24,
    effects: false,
    danmakuPerSecond: 4,
    thumbnails: false,
    subtitleEffects: false,
  },
  balanced: {
    maxDecodeHeight: 1080,
    frameQueue: 5,
    audioAhead: 1.5,
    cacheMb: 64,
    effects: true,
    danmakuPerSecond: 10,
    thumbnails: true,
    subtitleEffects: true,
  },
  high: {
    maxDecodeHeight: 2160,
    frameQueue: 8,
    audioAhead: 2.5,
    cacheMb: 128,
    effects: true,
    danmakuPerSecond: 0,
    thumbnails: true,
    subtitleEffects: true,
  },
  tv: {
    maxDecodeHeight: 2160,
    frameQueue: 6,
    audioAhead: 2,
    cacheMb: 96,
    effects: true,
    danmakuPerSecond: 8,
    thumbnails: true,
    subtitleEffects: true,
  },
};

export interface DeviceSignals {
  memoryGb: number | null;
  cores: number | null;
  mobile: boolean;
  tv: boolean;
  webCodecs: boolean;
  mse: boolean;
  saveData: boolean;
  effectiveType: string | null;
}

export interface DeviceReport extends DeviceSignals {
  profile: ProfileId;
  reasons: string[];
}

function readNavigator(): Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
} {
  return navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
}

export function detectSignals(): DeviceSignals {
  const nav = typeof navigator === 'undefined' ? null : readNavigator();
  const ua = nav?.userAgent ?? '';
  const tv = /smart-?tv|googletv|android tv|appletv|hbbtv|netcast|web0s|bravia|aft[bmst]/i.test(ua);
  return {
    memoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    mobile: /android|iphone|ipad|ipod|mobile/i.test(ua) && !tv,
    tv,
    webCodecs: typeof window !== 'undefined' && 'VideoDecoder' in window,
    mse: typeof window !== 'undefined' && 'MediaSource' in window,
    saveData: nav?.connection?.saveData === true,
    effectiveType: nav?.connection?.effectiveType ?? null,
  };
}

/** Pick a profile from what we can actually observe. */
export function pickProfile(signals: DeviceSignals): { profile: ProfileId; reasons: string[] } {
  const reasons: string[] = [];

  if (signals.tv) {
    reasons.push('TV user agent — big-screen profile');
    return { profile: 'tv', reasons };
  }
  if (signals.saveData || signals.effectiveType === 'slow-2g' || signals.effectiveType === '2g') {
    reasons.push('Data-saver or a very slow connection');
    return { profile: 'low', reasons };
  }

  const memory = signals.memoryGb;
  const cores = signals.cores;

  // Unknown memory is common (Firefox, Safari). Stay conservative.
  if (memory === null) {
    reasons.push('Memory not reported — conservative default');
    if (signals.mobile) return { profile: 'low', reasons };
    if (cores !== null && cores >= 8) return { profile: 'balanced', reasons };
    return { profile: 'low', reasons };
  }
  if (memory <= 2) {
    reasons.push(`${memory} GB device memory`);
    return { profile: 'low', reasons };
  }
  if (memory <= 4) {
    reasons.push(`${memory} GB device memory`);
    return { profile: 'balanced', reasons };
  }
  if (signals.mobile) {
    reasons.push('Mobile with plenty of memory');
    return { profile: 'balanced', reasons };
  }
  reasons.push(`${memory} GB device memory, ${cores ?? 'unknown'} cores`);
  return { profile: 'high', reasons };
}

export function deviceReport(): DeviceReport {
  const signals = detectSignals();
  const { profile, reasons } = pickProfile(signals);
  return { ...signals, profile, reasons };
}

export function budgetsFor(profile: ProfileId): DeviceBudgets {
  return { ...PROFILES[profile] };
}

/** Apply the profile to the document so CSS can react (TV sizing, effects). */
export function applyProfileToDocument(profile: ProfileId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.profile = profile;
  const budgets = budgetsFor(profile);
  document.documentElement.classList.toggle('reduce-effects', !budgets.effects);
}
