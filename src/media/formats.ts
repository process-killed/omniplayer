/** Container / codec knowledge: extensions, MIME types and byte sniffing. */

export const VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts',
  'ogv', '3gp', '3g2', 'wmv', 'asf', 'vob', 'mxf', 'f4v', 'ogm', 'divx', 'rm', 'rmvb',
] as const;

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'weba', 'wma', 'mka', 'alac', 'ape', 'amr'] as const;

export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa', 'ttml', 'dfxp', 'smi', 'sami', 'sub', 'idx', 'lrc'] as const;

export const MANIFEST_EXTENSIONS = ['m3u8', 'mpd', 'ism', 'f4m'] as const;

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  webm: 'video/webm', avi: 'video/x-msvideo', flv: 'video/x-flv', mpg: 'video/mpeg',
  mpeg: 'video/mpeg', ts: 'video/mp2t', m2ts: 'video/mp2t', mts: 'video/mp2t',
  ogv: 'video/ogg', '3gp': 'video/3gpp', wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf',
  vob: 'video/dvd', mxf: 'application/mxf', f4v: 'video/mp4',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  weba: 'audio/webm', wma: 'audio/x-ms-wma', mka: 'audio/x-matroska',
  m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml',
};

export type MediaCategory = 'video' | 'audio' | 'subtitle' | 'manifest' | 'image' | 'unknown';

export function extOf(nameOrUrl: string): string {
  const clean = nameOrUrl.split(/[?#]/)[0];
  const match = /\.([a-z0-9]{1,5})$/i.exec(clean);
  return match ? match[1].toLowerCase() : '';
}

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function categoryOf(nameOrUrl: string, mime?: string): MediaCategory {
  const ext = extOf(nameOrUrl);
  if ((MANIFEST_EXTENSIONS as readonly string[]).includes(ext)) return 'manifest';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  if ((SUBTITLE_EXTENSIONS as readonly string[]).includes(ext)) return 'subtitle';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return 'image';
  if (mime) {
    if (mime.includes('mpegurl') || mime.includes('dash+xml')) return 'manifest';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.includes('subtitle') || mime.includes('ttml')) return 'subtitle';
  }
  return 'unknown';
}

export function isSubtitleFile(name: string): boolean {
  return (SUBTITLE_EXTENSIONS as readonly string[]).includes(extOf(name));
}

export function isMediaFile(name: string, mime?: string): boolean {
  const cat = categoryOf(name, mime);
  return cat === 'video' || cat === 'audio' || cat === 'manifest';
}

export function manifestKindFromUrl(url: string): 'hls' | 'dash' | null {
  const ext = extOf(url);
  if (ext === 'm3u8') return 'hls';
  if (ext === 'mpd') return 'dash';
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  return null;
}

/* ------------------------------------------------------------- byte sniffing */

export interface ContainerGuess {
  id: string;
  label: string;
  mime: string;
  /** Extra note, e.g. the MP4 major brand. */
  detail?: string;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < Math.min(bytes.length, start + length); i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((value, index) => bytes[offset + index] === value);
}

/**
 * Identify a container from its first bytes. This is what lets us say
 * "MKV containing H.264" instead of guessing from a file extension.
 */
export function detectContainer(bytes: Uint8Array): ContainerGuess | null {
  if (!bytes || bytes.length < 12) return null;

  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    const compatible = ascii(bytes, 16, Math.min(24, bytes.length - 16));
    if (brand === 'qt  ') return { id: 'mov', label: 'QuickTime (MOV)', mime: 'video/quicktime', detail: brand };
    if (brand.startsWith('3g')) return { id: '3gp', label: '3GPP', mime: 'video/3gpp', detail: brand };
    if (brand === 'M4V ' || brand === 'M4VH') return { id: 'm4v', label: 'M4V', mime: 'video/mp4', detail: brand };
    if (brand === 'avif' || brand === 'avis') return { id: 'avif', label: 'AVIF image', mime: 'image/avif', detail: brand };
    if (brand === 'crx ') return { id: 'crx', label: 'Canon CRX', mime: 'video/mp4', detail: brand };
    if (brand === 'f4v ') return { id: 'f4v', label: 'F4V', mime: 'video/mp4', detail: brand };
    return {
      id: 'mp4',
      label: compatible.includes('isom') || brand === 'isom' ? 'MP4 (ISO BMFF)' : 'MP4',
      mime: 'video/mp4',
      detail: brand,
    };
  }

  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = ascii(bytes, 0, Math.min(256, bytes.length));
    if (head.includes('webm')) return { id: 'webm', label: 'WebM (Matroska)', mime: 'video/webm' };
    return { id: 'mkv', label: 'Matroska (MKV)', mime: 'video/x-matroska' };
  }

  if (ascii(bytes, 0, 4) === 'RIFF') {
    const form = ascii(bytes, 8, 4);
    if (form === 'AVI ') return { id: 'avi', label: 'AVI', mime: 'video/x-msvideo' };
    if (form === 'WAVE') return { id: 'wav', label: 'WAV', mime: 'audio/wav' };
    if (form === 'WEBP') return { id: 'webp', label: 'WebP image', mime: 'image/webp' };
  }

  if (startsWith(bytes, [0x46, 0x4c, 0x56, 0x01])) return { id: 'flv', label: 'Flash Video (FLV)', mime: 'video/x-flv' };
  if (ascii(bytes, 0, 4) === 'OggS') {
    const head = ascii(bytes, 0, Math.min(256, bytes.length));
    if (head.includes('theora')) return { id: 'ogv', label: 'Ogg (Theora)', mime: 'video/ogg' };
    if (head.includes('OpusHead')) return { id: 'opus', label: 'Ogg Opus', mime: 'audio/ogg' };
    if (head.includes('vorbis')) return { id: 'ogg', label: 'Ogg Vorbis', mime: 'audio/ogg' };
    return { id: 'ogg', label: 'Ogg', mime: 'audio/ogg' };
  }

  if (startsWith(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWith(bytes, [0x00, 0x00, 0x01, 0xb3])) {
    return { id: 'mpg', label: 'MPEG program stream', mime: 'video/mpeg' };
  }

  if (bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47)) {
    return { id: 'ts', label: 'MPEG transport stream', mime: 'video/mp2t' };
  }

  if (startsWith(bytes, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) {
    return { id: 'asf', label: 'ASF / WMV', mime: 'video/x-ms-asf' };
  }

  if (startsWith(bytes, [0x06, 0x0e, 0x2b, 0x34])) return { id: 'mxf', label: 'MXF', mime: 'application/mxf' };

  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { id: 'aac', label: 'AAC (ADTS)', mime: 'audio/aac' };
    return { id: 'mp3', label: 'MP3', mime: 'audio/mpeg' };
  }

  if (ascii(bytes, 0, 4) === 'fLaC') return { id: 'flac', label: 'FLAC', mime: 'audio/flac' };

  const head = ascii(bytes, 0, 512).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return { id: 'html', label: 'HTML page (not a media file)', mime: 'text/html' };
  }
  if (head.startsWith('<?xml')) {
    if (head.includes('<mpd')) return { id: 'mpd', label: 'DASH manifest', mime: 'application/dash+xml' };
    if (head.includes('<tt')) return { id: 'ttml', label: 'TTML subtitles', mime: 'application/ttml+xml' };
    return { id: 'xml', label: 'XML document', mime: 'application/xml' };
  }
  if (head.startsWith('#extm3u')) return { id: 'm3u8', label: 'HLS playlist', mime: 'application/vnd.apple.mpegurl' };

  return null;
}

/** Container → the MSE MIME prefix used for support checks. */
export function mseMimeForContainer(containerId: string): string {
  switch (containerId) {
    case 'mp4':
    case 'm4v':
    case 'mov':
    case '3gp':
    case 'f4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'ts':
    case 'm2ts':
      return 'video/mp2t';
    case 'mkv':
      return 'video/x-matroska';
    case 'ogv':
    case 'ogg':
      return 'video/ogg';
    default:
      return 'video/mp4';
  }
}

/** Map a Matroska/MP4 codec id to an RFC 6381 codec string when possible. */
export function codecStringFor(codec: string | undefined, kind: 'video' | 'audio'): string | null {
  if (!codec) return null;
  const c = codec.toLowerCase();
  if (kind === 'video') {
    if (c.startsWith('avc') || c === 'h264') return 'avc1.640028';
    if (c === 'hevc' || c === 'h265' || c.startsWith('hvc1') || c.startsWith('hev1')) return 'hvc1.1.6.L120.90';
    if (c === 'av1' || c.startsWith('av01')) return 'av01.0.08M.08';
    if (c === 'vp9' || c.startsWith('vp09')) return 'vp09.00.10.08';
    if (c === 'vp8') return 'vp8';
  } else {
    if (c === 'aac' || c.startsWith('mp4a')) return 'mp4a.40.2';
    if (c === 'mp3') return 'mp4a.40.34';
    if (c === 'opus') return 'opus';
    if (c === 'flac') return 'flac';
    if (c === 'ac3' || c === 'ac-3') return 'ac-3';
    if (c === 'eac3' || c === 'ec-3') return 'ec-3';
    if (c === 'vorbis') return 'vorbis';
  }
  return null;
}
