import type { AppErrorInfo } from '../types';

export type ErrorCode =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'not-media'
  | 'cors'
  | 'cors-required'
  | 'http-403'
  | 'http-404'
  | 'http-410'
  | 'http-5xx'
  | 'timeout'
  | 'network'
  | 'offline'
  | 'unsupported-container'
  | 'unsupported-codec'
  | 'no-decoder'
  | 'decode-failed'
  | 'memory'
  | 'corrupt'
  | 'drm'
  | 'aborted'
  | 'engine-failed'
  | 'subtitle-failed'
  | 'storage'
  | 'unknown';

interface ErrorTemplate {
  title: string;
  message: string;
  suggestions: string[];
}

const TEMPLATES: Record<ErrorCode, ErrorTemplate> = {
  'invalid-url': {
    title: 'That link doesn’t look valid',
    message: 'The address could not be parsed as a URL.',
    suggestions: ['Check for missing characters or stray spaces.', 'Paste the full link, including https://'],
  },
  'unsupported-protocol': {
    title: 'Unsupported link type',
    message: 'Only http:// and https:// links can be played. Browser-internal and local-file links are blocked for safety.',
    suggestions: ['Use a direct http(s) media link.', 'For local files, use Open media instead.'],
  },
  'not-media': {
    title: 'This link is a web page, not a video',
    message:
      'The server returned an HTML page. Streaming sites rarely expose a direct media file, and OmniPlay cannot extract one from a page.',
    suggestions: [
      'Use the direct media link (it usually ends in .mp4, .m3u8, .mpd or .webm).',
      'Download the file locally, then open it with “Open media”.',
      'Right-click the video → “Copy video address” in the source site to get a direct link.',
    ],
  },
  cors: {
    title: 'The server blocked browser access (CORS)',
    message:
      'The file exists, but the server did not send the CORS headers a browser needs. This is a server-side restriction that JavaScript cannot bypass.',
    suggestions: [
      'Try the same link in a different tab: sometimes a direct <video> source still plays without CORS.',
      'Use a mirror or download the file and open it locally.',
      'If you control the server, add “Access-Control-Allow-Origin: *” and allow Range requests.',
    ],
  },
  'cors-required': {
    title: 'This host blocks the browser from reading the file',
    message:
      'The link works, but the server does not send Access-Control-Allow-Origin. MKV, AVI and similar containers can only play when the browser is allowed to read the bytes — a <video> tag alone cannot decode them.',
    suggestions: [
      'Download the file and use “Open media” — local files play fully, including every audio track and subtitle.',
      'Use a mirror or CDN that sends Access-Control-Allow-Origin for GET and HEAD and supports Range requests.',
      'If you own the bucket: allow your site’s origin, methods GET/HEAD, and expose Content-Length, Content-Range and Accept-Ranges.',
      'Or add a CORS proxy you control in Settings → Network — requests then go through a URL that adds the header.',
      'MP4 or WebM from the same host may still play through the native player — use “Try native playback”.',
    ],
  },
  'http-403': {
    title: 'Access denied (HTTP 403)',
    message: 'The server refused the request. The link may require a login, a referer header or may have expired.',
    suggestions: ['Open the page the link came from and copy a fresh link.', 'Check whether the source requires a subscription or token.'],
  },
  'http-404': {
    title: 'File not found (HTTP 404)',
    message: 'The server has no file at that address.',
    suggestions: ['Check the link for typos.', 'The file may have been moved or deleted.'],
  },
  'http-410': {
    title: 'This link has expired (HTTP 410)',
    message: 'The server reports the resource is gone — common with time-limited signed URLs.',
    suggestions: ['Regenerate the link from the original site.', 'Open the page again and copy a new address.'],
  },
  'http-5xx': {
    title: 'The server had a problem',
    message: 'The server returned an error while serving this file.',
    suggestions: ['Wait a moment and retry.', 'Try another mirror of the same file.'],
  },
  timeout: {
    title: 'The connection timed out',
    message: 'The server did not respond in time.',
    suggestions: ['Retry — the network may have been briefly unavailable.', 'Raise the request timeout in Settings → Network.'],
  },
  network: {
    title: 'Network request failed',
    message: 'The browser could not reach the server. This is often a DNS, proxy or offline problem.',
    suggestions: ['Check your connection and retry.', 'If the host is blocked on your network, use another source.'],
  },
  offline: {
    title: 'You appear to be offline',
    message: 'OmniPlay needs a connection for network sources. Local files keep working.',
    suggestions: ['Reconnect, then retry.', 'Local files can still be opened from the device.'],
  },
  'unsupported-container': {
    title: 'This container can’t be opened here',
    message: 'The file format is not readable by any engine available in this browser.',
    suggestions: [
      'Convert it to MP4 (H.264 + AAC) or WebM — those play everywhere.',
      'On desktop Chrome or Edge, MKV, AVI and MOV often work through the WebCodecs engine.',
    ],
  },
  'unsupported-codec': {
    title: 'Unsupported video or audio codec',
    message: 'The container is readable, but this browser cannot decode the codec inside it.',
    suggestions: [
      'Try Chrome or Edge on desktop, which decode more codecs in software.',
      'Re-encode the file to H.264 + AAC (MP4) for universal playback.',
    ],
  },
  'no-decoder': {
    title: 'No decoder available for this track',
    message: 'The browser exposes no decoder for the media’s codec, and software decoding is unavailable or disabled.',
    suggestions: ['Enable “Allow WebCodecs” in Settings → Decoder.', 'Try a different browser.', 'Re-encode to a widely supported codec.'],
  },
  'decode-failed': {
    title: 'Decoding failed',
    message: 'The media data could not be decoded. The file may be damaged or use an unusual profile.',
    suggestions: ['Try seeking to another position.', 'Re-download the file — it may be incomplete.', 'Try a different engine in Settings → Decoder.'],
  },
  memory: {
    title: 'Not enough memory',
    message: 'The browser ran out of memory while decoding. This is common with very large files on phones.',
    suggestions: ['Enable Low-memory mode in Settings → Performance.', 'Close other tabs and retry.', 'Play a smaller version of the file.'],
  },
  corrupt: {
    title: 'The media file looks damaged',
    message: 'The container could not be parsed — the download may be incomplete or the file corrupted.',
    suggestions: ['Re-download the file and compare its size with the source.', 'Try another copy of the same video.'],
  },
  drm: {
    title: 'This media is protected',
    message:
      'The stream is encrypted with DRM. OmniPlay never bypasses DRM, and browsers only decrypt DRM through their own certified modules.',
    suggestions: ['Use the service’s official app or site to watch protected content.'],
  },
  aborted: {
    title: 'Playback was cancelled',
    message: 'The load was interrupted before playback could start.',
    suggestions: ['Try again.'],
  },
  'engine-failed': {
    title: 'The playback engine stopped',
    message: 'The selected engine hit an unrecoverable error.',
    suggestions: ['Retry with another engine.', 'Copy the diagnostics report if the problem repeats.'],
  },
  'subtitle-failed': {
    title: 'Subtitle file could not be read',
    message: 'The subtitle file is not in a supported format or is damaged.',
    suggestions: ['Supported: SRT, VTT, ASS, SSA, TTML/DFXP.', 'Check the file opens in a text editor and starts with a cue or [Script Info].'],
  },
  storage: {
    title: 'Local storage is unavailable',
    message: 'The browser refused to store data (private mode or full quota). Playback still works, but history may not persist.',
    suggestions: ['Leave private/incognito mode to keep history.', 'Free up storage space.'],
  },
  unknown: {
    title: 'Something went wrong',
    message: 'An unexpected error stopped playback.',
    suggestions: ['Retry.', 'Copy the diagnostics report and check the browser console for details.'],
  },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly suggestions: string[];
  readonly fatal: boolean;
  readonly engine?: string;

  constructor(code: ErrorCode, options: { message?: string; detail?: string; suggestions?: string[]; fatal?: boolean; engine?: string; cause?: unknown } = {}) {
    const template = TEMPLATES[code] ?? TEMPLATES.unknown;
    super(options.message ?? template.message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.detail = options.detail;
    this.suggestions = options.suggestions ?? template.suggestions;
    this.fatal = options.fatal ?? true;
    this.engine = options.engine;
  }

  toInfo(): AppErrorInfo {
    const template = TEMPLATES[this.code] ?? TEMPLATES.unknown;
    return {
      code: this.code,
      title: template.title,
      message: this.message || template.message,
      detail: this.detail,
      suggestions: this.suggestions,
      fatal: this.fatal,
      engine: this.engine as AppErrorInfo['engine'],
    };
  }
}

export function httpErrorForStatus(status: number, url: string): AppError {
  const detail = `HTTP ${status} for ${redactUrl(url)}`;
  if (status === 403) return new AppError('http-403', { detail });
  if (status === 404) return new AppError('http-404', { detail });
  if (status === 410) return new AppError('http-410', { detail });
  if (status >= 500) return new AppError('http-5xx', { detail });
  return new AppError('network', { detail });
}

/** Strip query strings so signed tokens never reach logs or diagnostics. */
export function redactUrl(url?: string): string {
  if (!url) return '—';
  try {
    const parsed = new URL(url);
    const hasQuery = parsed.search.length > 1;
    return `${parsed.origin}${parsed.pathname}${hasQuery ? '?…' : ''}`;
  } catch {
    return url.split('?')[0];
  }
}

export function toAppError(error: unknown, fallback: ErrorCode = 'unknown'): AppError {
  if (error instanceof AppError) return error;
  const err = error as { name?: string; message?: string };
  if (err?.name === 'AbortError') return new AppError('aborted');
  if (err?.name === 'QuotaExceededError') return new AppError('memory');
  const message = err?.message ?? String(error ?? '');
  if (/out of memory|allocation failed|Array buffer allocation/i.test(message)) return new AppError('memory');
  if (/CORS|cross-origin|Failed to fetch|NetworkError when attempting to fetch/i.test(message)) return new AppError('cors', { detail: message });
  if (/timeout|timed out/i.test(message)) return new AppError('timeout', { detail: message });
  if (/no supported source|not supported|MEDIA_ERR_SRC_NOT_SUPPORTED/i.test(message)) return new AppError('unsupported-container', { detail: message });
  if (/decode|MEDIA_ERR_DECODE/i.test(message)) return new AppError('decode-failed', { detail: message });
  return new AppError(fallback, { detail: message || undefined });
}

/** Translate a <video> MediaError into something a person can act on. */
export function mediaElementError(video: HTMLVideoElement, url?: string): AppError {
  const err = video.error;
  if (!err) return new AppError('unknown');
  switch (err.code) {
    case 1:
      return new AppError('aborted', { detail: err.message });
    case 2:
      return new AppError('network', { detail: err.message || 'MEDIA_ERR_NETWORK', suggestions: ['Retry the source.', 'Check the connection.'] });
    case 3:
      return new AppError('decode-failed', {
        detail: err.message || 'MEDIA_ERR_DECODE',
        suggestions: ['Seek to another position and retry.', 'The file may be damaged.', 'Try the WebCodecs engine in Settings → Decoder.'],
      });
    case 4:
      return new AppError('unsupported-container', {
        detail: `${err.message || 'MEDIA_ERR_SRC_NOT_SUPPORTED'}${url ? ` — ${redactUrl(url)}` : ''}`,
        suggestions: [
          'The container or codec is not supported natively by this browser.',
          'If this is an MKV or AVI, the WebCodecs engine may handle it.',
          'Convert to MP4 (H.264 + AAC) for guaranteed playback.',
        ],
      });
    default:
      return new AppError('unknown', { detail: err.message });
  }
}
