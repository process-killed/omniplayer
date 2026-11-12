/**
 * Embeddable player.
 *
 * A site can drop a direct media link into an iframe:
 *
 *   <iframe src="https://player.example/#/embed?src=ENCODED_URL&autoplay=1" ...>
 *
 * or simply append it to the player URL:
 *
 *   https://player.example/?src=ENCODED_URL
 *
 * Everything is parsed from the query string so a host page never needs script.
 */

export interface EmbedOptions {
  src: string;
  /** Extra URLs tried in order when the primary fails. */
  fallbacks: string[];
  /** Stop playback at this many seconds. */
  end: number;
  /** Loaded when the current media ends (autoplay if it was playing). */
  next: string;
  aspect: string;
  theme: string;
  audioLang: string;
  subLang: string;
  quality: string;
  pip: boolean;
  keyboard: boolean;
  download: boolean;
  /** Origins allowed to send postMessage commands; empty means "any parent". */
  origins: string[];
  start: number;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  title: string;
  poster: string;
  subtitle: string;
  accent: string;
}

export const DEFAULT_EMBED: EmbedOptions = {
  src: '',
  fallbacks: [],
  end: 0,
  next: '',
  aspect: '',
  theme: '',
  audioLang: '',
  subLang: '',
  quality: '',
  pip: true,
  keyboard: true,
  download: true,
  origins: [],
  start: 0,
  autoplay: false,
  muted: false,
  loop: false,
  controls: true,
  title: '',
  poster: '',
  subtitle: '',
  accent: '',
};

function truthy(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * URLSearchParams already decodes once. Only undo an extra layer when the value
 * is fully encoded (an encoded scheme), so `%20` inside a real URL survives.
 */
function maybeDecode(value: string): string {
  if (!value.includes('%')) return value;
  const decoded = safeDecode(value);
  const encodedScheme = /^[a-z][a-z0-9+.-]*%3a/i.test(value);
  return encodedScheme && /^[a-z][a-z0-9+.-]*:\/\//i.test(decoded) ? decoded : value;
}

/** Accepts `src`, `url`, `file` and `video` as aliases for the media link. */
export function parseEmbedParams(params: Record<string, string>): EmbedOptions | null {
  const raw = params.src ?? params.url ?? params.file ?? params.video ?? '';
  const src = maybeDecode(raw).trim();
  // http(s) files and manifests, blob URLs from local/torrent sources, and
  // magnet links (resolved through a gateway or WebTorrent inside the player).
  if (!/^https?:\/\//i.test(src) && !/^blob:/i.test(src) && !/^magnet:\?/i.test(src)) return null;

  const start = Number(params.start ?? params.t ?? 0);
  const end = Number(params.end ?? 0);
  return {
    ...DEFAULT_EMBED,
    src,
    fallbacks: (params.sources ?? params.fallback ?? '')
      .split(',')
      .map((entry) => safeDecode(entry).trim())
      .filter((entry) => /^https?:\/\//i.test(entry))
      .slice(0, 6),
    end: Number.isFinite(end) && end > 0 ? end : 0,
    next: safeDecode(params.next ?? ''),
    aspect: (params.aspect ?? '').slice(0, 12),
    theme: (params.theme ?? '').slice(0, 16),
    audioLang: (params.audio ?? params.audioLang ?? '').slice(0, 12),
    subLang: (params.subtitle ?? params.subLang ?? '').slice(0, 12),
    quality: (params.quality ?? '').slice(0, 16),
    pip: truthy(params.pip, true),
    keyboard: truthy(params.keyboard, true),
    download: truthy(params.download, true),
    origins: (params.origins ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 10),
    start: Number.isFinite(start) && start > 0 ? start : 0,
    autoplay: truthy(params.autoplay, false),
    muted: truthy(params.muted, false),
    loop: truthy(params.loop, false),
    controls: truthy(params.controls, true),
    title: (params.title ?? '').slice(0, 160),
    poster: maybeDecode(params.poster ?? ''),
    subtitle: maybeDecode(params.sub ?? params.subtitle ?? ''),
    accent: params.accent ?? '',
  };
}

/** Build the hash URL for a given app base (works from any sub-path). */
export function buildEmbedUrl(baseHref: string, options: EmbedOptions): string {
  const url = new URL(baseHref);
  const params = new URLSearchParams();
  params.set('src', options.src);
  if (options.start > 0) params.set('start', String(Math.round(options.start)));
  if (options.autoplay) params.set('autoplay', '1');
  if (options.muted) params.set('muted', '1');
  if (options.loop) params.set('loop', '1');
  if (!options.controls) params.set('controls', '0');
  if (options.title) params.set('title', options.title);
  if (options.poster) params.set('poster', options.poster);
  if (options.subtitle) params.set('sub', options.subtitle);
  if (options.accent) params.set('accent', options.accent);
  if (options.fallbacks.length) params.set('sources', options.fallbacks.map((url) => encodeURIComponent(url)).join(','));
  if (options.end > 0) params.set('end', String(Math.round(options.end)));
  if (options.next) params.set('next', options.next);
  if (options.aspect) params.set('aspect', options.aspect);
  if (options.theme) params.set('theme', options.theme);
  if (options.audioLang) params.set('audio', options.audioLang);
  if (options.subLang) params.set('subtitle', options.subLang);
  if (options.quality) params.set('quality', options.quality);
  if (!options.pip) params.set('pip', '0');
  if (!options.keyboard) params.set('keyboard', '0');
  if (!options.download) params.set('download', '0');
  if (options.origins.length) params.set('origins', options.origins.join(','));
  url.hash = `#/embed?${params.toString()}`;
  return url.toString();
}

/** The snippet a site owner pastes into their page. */
export function buildIframeCode(embedUrl: string, options: EmbedOptions, size = { width: '100%', height: '100%' }): string {
  const title = (options.title || 'Video player').replace(/"/g, '&quot;');
  return [
    `<iframe`,
    `  src="${embedUrl}"`,
    `  width="${size.width}"`,
    `  height="${size.height}"`,
    `  style="border:0;display:block;aspect-ratio:16/9;max-width:100%"`,
    `  title="${title}"`,
    `  loading="lazy"`,
    `  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"`,
    `  allowfullscreen`,
    `  referrerpolicy="no-referrer"`,
    `></iframe>`,
  ].join('\n');
}

/** Plain link for sharing / opening in a tab. */
export function buildShareUrl(baseHref: string, options: EmbedOptions): string {
  return buildEmbedUrl(baseHref, options);
}

/** Pull an embed link out of text the user pasted (embed URL or plain media URL). */
export function extractSource(input: string): string {
  const text = input.trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
    if (hashQuery) {
      const params = new URLSearchParams(hashQuery);
      const src = params.get('src') ?? params.get('url');
      if (src) return maybeDecode(src);
    }
    const search = url.searchParams;
    const fromSearch = search.get('src') ?? search.get('url') ?? search.get('file');
    if (fromSearch) return maybeDecode(fromSearch);
  } catch {
    /* not a URL — fall through */
  }
  return text;
}
