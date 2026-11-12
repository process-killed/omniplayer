/** Small formatting helpers shared by UI and diagnostics. */

export function formatTime(seconds: number, opts: { forceHours?: boolean } = {}): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0 || opts.forceHours) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function formatTimePrecise(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const total = Math.floor(abs);
  const tenths = Math.floor((abs - total) * 10);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${sign}${h}:${pad(m)}:${pad(s)}.${tenths}` : `${sign}${m}:${pad(s)}.${tenths}`;
}

export function formatDurationLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatBitrate(bps?: number): string {
  if (!bps || !Number.isFinite(bps)) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(n?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pct(value: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0;
  return clamp((value / total) * 100, 0, 100);
}

export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** Language codes → human labels. Falls back to the raw code. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', eng: 'English',
  hi: 'Hindi', hin: 'Hindi',
  ja: 'Japanese', jpn: 'Japanese',
  ko: 'Korean', kor: 'Korean',
  ta: 'Tamil', tam: 'Tamil',
  te: 'Telugu', tel: 'Telugu',
  ml: 'Malayalam', mal: 'Malayalam',
  kn: 'Kannada', kan: 'Kannada',
  bn: 'Bengali', ben: 'Bengali',
  mr: 'Marathi', mar: 'Marathi',
  gu: 'Gujarati', guj: 'Gujarati',
  pa: 'Punjabi', pan: 'Punjabi',
  ur: 'Urdu', urd: 'Urdu',
  ar: 'Arabic', ara: 'Arabic',
  es: 'Spanish', spa: 'Spanish',
  fr: 'French', fre: 'French', fra: 'French',
  de: 'German', ger: 'German', deu: 'German',
  it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese',
  ru: 'Russian', rus: 'Russian',
  zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
  th: 'Thai', tha: 'Thai',
  vi: 'Vietnamese', vie: 'Vietnamese',
  id: 'Indonesian', ind: 'Indonesian',
  tr: 'Turkish', tur: 'Turkish',
  nl: 'Dutch', dut: 'Dutch', nld: 'Dutch',
  pl: 'Polish', pol: 'Polish',
  sv: 'Swedish', swe: 'Swedish',
  no: 'Norwegian', nor: 'Norwegian',
  da: 'Danish', dan: 'Danish',
  fi: 'Finnish', fin: 'Finnish',
  he: 'Hebrew', heb: 'Hebrew',
  fa: 'Persian', per: 'Persian', fas: 'Persian',
  uk: 'Ukrainian', ukr: 'Ukrainian',
  ro: 'Romanian', rum: 'Romanian', ron: 'Romanian',
  cs: 'Czech', cze: 'Czech', ces: 'Czech',
  el: 'Greek', gre: 'Greek', ell: 'Greek',
  hu: 'Hungarian', hun: 'Hungarian',
  sw: 'Swahili', swa: 'Swahili',
  or: 'Odia', ori: 'Odia', ory: 'Odia',
  as: 'Assamese', asm: 'Assamese',
  sa: 'Sanskrit', san: 'Sanskrit',
  ne: 'Nepali', nep: 'Nepali',
  si: 'Sinhala', sin: 'Sinhala',
  my: 'Burmese', bur: 'Burmese', mya: 'Burmese',
  km: 'Khmer', khm: 'Khmer',
  lo: 'Lao', lao: 'Lao',
  fil: 'Filipino', tl: 'Filipino',
  und: 'Unknown',
};

export function languageName(code?: string): string | undefined {
  if (!code) return undefined;
  const key = code.toLowerCase().split(/[-_]/)[0];
  const full = code.toLowerCase();
  const name = LANGUAGE_NAMES[full] ?? LANGUAGE_NAMES[key];
  if (!name) return code.toUpperCase();
  return name;
}

/** Human label for a container extension. */
export function containerLabel(ext?: string): string {
  if (!ext) return 'Unknown';
  const map: Record<string, string> = {
    mp4: 'MP4', m4v: 'M4V', mov: 'QuickTime', mkv: 'Matroska', webm: 'WebM',
    avi: 'AVI', flv: 'Flash Video', ts: 'MPEG-TS', m2ts: 'M2TS', mts: 'MTS',
    ogv: 'Ogg Video', ogg: 'Ogg', '3gp': '3GP', wmv: 'WMV', asf: 'ASF',
    vob: 'VOB', mxf: 'MXF', f4v: 'F4V', mpg: 'MPEG-PS', mpeg: 'MPEG-PS',
    m3u8: 'HLS', mpd: 'DASH', m3u: 'Playlist', mp3: 'MP3', m4a: 'M4A',
    flac: 'FLAC', wav: 'WAV', opus: 'Opus', aac: 'AAC', srt: 'SRT', ass: 'ASS',
  };
  return map[ext.toLowerCase()] ?? ext.toUpperCase();
}

/** Friendly label for a codec id. */
export function codecLabel(codec?: string): string {
  if (!codec) return '—';
  const c = codec.toLowerCase();
  const map: Record<string, string> = {
    avc: 'H.264 / AVC', avc1: 'H.264 / AVC', h264: 'H.264 / AVC',
    hevc: 'H.265 / HEVC', hvc1: 'H.265 / HEVC', hev1: 'H.265 / HEVC', h265: 'H.265 / HEVC',
    av01: 'AV1', av1: 'AV1',
    vp8: 'VP8', vp09: 'VP9', vp9: 'VP9',
    'mpeg4-part2': 'MPEG-4 Part 2', mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1',
    theora: 'Theora', prores: 'ProRes', dnxhd: 'DNxHD', mjpeg: 'MJPEG', vc1: 'VC-1',
    aac: 'AAC', mp3: 'MP3', mp4a: 'AAC', flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis',
    ac3: 'Dolby AC-3', eac3: 'Dolby E-AC-3', ec3: 'Dolby E-AC-3', dts: 'DTS',
    truehd: 'Dolby TrueHD', alac: 'ALAC', wma: 'WMA', pcm: 'PCM', 'pcm-s16': 'PCM 16-bit',
    'pcm-f32': 'PCM 32-bit float', amr: 'AMR', ape: 'Monkey’s Audio', speex: 'Speex',
    webvtt: 'WebVTT', subrip: 'SubRip', ass: 'ASS', ssa: 'SSA', mov_text: 'MP4 Text',
  };
  if (map[c]) return map[c];
  const base = c.split('.')[0];
  return map[base] ?? codec.toUpperCase();
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 150): (...args: Parameters<T>) => void {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export function throttle<T extends (...args: never[]) => void>(fn: T, wait = 100): (...args: Parameters<T>) => void {
  let last = 0;
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    const now = performance.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = window.setTimeout(() => {
        last = performance.now();
        timer = undefined;
        fn(...args);
      }, remaining);
    }
  };
}


/**
 * Compact, human-readable form of a long URL: host + last path segment, with a
 * middle ellipsis when it still does not fit. Query strings are dropped.
 */
export function shortUrl(url: string, max = 48): string {
  let host = '';
  let tail = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, '');
    const parts = parsed.pathname.split('/').filter(Boolean);
    tail = parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : '';
    if (tail.length > 24) tail = `${tail.slice(0, 12)}…${tail.slice(-8)}`;
  } catch {
    return url.length > max ? `${url.slice(0, max - 1)}…` : url;
  }
  const combined = tail ? `${host}/${tail}` : host;
  return combined.length > max ? `${combined.slice(0, max - 1)}…` : combined;
}
