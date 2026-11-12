/**
 * Source adapters.
 *
 * A link is not always a file. The registry turns whatever a user pastes into
 * something the player can actually do:
 *
 *   media    — a direct file/manifest URL the engines can open
 *   provider — a site whose own embed must play it (YouTube, Vimeo, …)
 *   magnet   — a torrent (gateway or WebTorrent)
 *   ipfs     — an IPFS CID/path, fetched through a public gateway
 *
 * Adapters are tried in order; the first one that recognises the input wins.
 */

export type LinkKind = 'media' | 'provider' | 'magnet' | 'ipfs';

export interface ProviderEmbed {
  name: string;
  embedUrl: string;
  /** Why the link cannot be played as a file. */
  reason: string;
}

export interface ResolvedLink {
  kind: LinkKind;
  /** URLs to try, best first. */
  sources: string[];
  title?: string;
  poster?: string;
  provider?: ProviderEmbed;
  /** Human explanation shown in the UI before playback. */
  note?: string;
}

export interface SourceAdapter {
  id: string;
  name: string;
  canHandle(input: string): boolean;
  resolve(input: string): ResolvedLink | Promise<ResolvedLink>;
}

const MEDIA_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|flv|ts|m2ts|mts|mpg|mpeg|wmv|ogv|3gp|mp3|m4a|aac|flac|opus|ogg|wav|m3u8|mpd)(\?|#|$)/i;

/* ------------------------------------------------------------------ media */

export const directMediaAdapter: SourceAdapter = {
  id: 'media',
  name: 'Direct media',
  canHandle: (input) => {
    if (/^blob:/i.test(input) || /^data:/i.test(input)) return true;
    try {
      const url = new URL(input);
      if (!/^https?:$/.test(url.protocol)) return false;
      return MEDIA_EXT.test(url.pathname) || MEDIA_EXT.test(url.search);
    } catch {
      return false;
    }
  },
  resolve: (input) => ({ kind: 'media', sources: [input] }),
};

/* ----------------------------------------------------------------- magnet */

export const magnetAdapter: SourceAdapter = {
  id: 'magnet',
  name: 'Torrent',
  canHandle: (input) => /^magnet:\?/i.test(input.trim()),
  resolve: (input) => ({
    kind: 'magnet',
    sources: [input.trim()],
    note: 'Torrents play through your gateway, or through WebTorrent when the swarm has WebRTC peers.',
  }),
};

/* ------------------------------------------------------------------- ipfs */

const IPFS_HOSTS = ['ipfs.io', 'cloudflare-ipfs.com', 'dweb.link', 'gateway.pinata.cloud', 'w3s.link'];

export const ipfsAdapter: SourceAdapter = {
  id: 'ipfs',
  name: 'IPFS',
  canHandle: (input) => /^(ipfs|ipns):\/\//i.test(input.trim()) || /\/ipfs\/[a-zA-Z0-9]{40,}/.test(input),
  resolve: (input) => {
    const trimmed = input.trim();
    const subdomain = /^https?:\/\/([a-z0-9]+)\.ipfs\.([^/]+)\//i.exec(trimmed);
    if (subdomain) {
      return { kind: 'media', sources: [trimmed], note: 'Served through an IPFS gateway.' };
    }
    const direct = /^(ipfs|ipns):\/\/(.+)$/i.exec(trimmed);
    const path = direct ? direct[2] : (/\/ip(f|n)s\/(.+)$/.exec(trimmed)?.[2] ?? '');
    if (!path) return { kind: 'ipfs', sources: [trimmed] };
    // Several gateways, tried in order — public ones rate-limit.
    const sources = IPFS_HOSTS.map((host) => `https://${host}/ipfs/${path.replace(/^ipfs\//, '')}`);
    return {
      kind: 'media',
      sources,
      note: 'Fetched from a public IPFS gateway; if one is slow the player tries the next.',
    };
  },
};

/* --------------------------------------------------------------- providers */

interface ProviderRule {
  id: string;
  name: string;
  match: RegExp;
  embed: (match: RegExpExecArray) => string;
  reason: string;
}

/** Twitch requires the embedding hostname; fall back outside a browser. */
function parentHost(): string {
  return typeof location !== 'undefined' && location.hostname ? location.hostname : 'localhost';
}

const PROVIDERS: ProviderRule[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    match: /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i,
    embed: (match) => `https://www.youtube-nocookie.com/embed/${match[1]}?rel=0&modestbranding=1`,
    reason: 'YouTube streams are protected; the official embed plays it.',
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    match: /vimeo\.com\/(?:video\/)?(\d{6,})/i,
    embed: (match) => `https://player.vimeo.com/video/${match[1]}?dnt=1`,
    reason: 'Vimeo serves signed streams; the official player handles them.',
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    match: /dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/i,
    embed: (match) => `https://www.dailymotion.com/embed/video/${match[1]}`,
    reason: 'Dailymotion requires its own player.',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    match: /twitch\.tv\/(?:videos\/(\d+)|([a-zA-Z0-9_]+))$/i,
    embed: (match) =>
      match[1]
        ? `https://player.twitch.tv/?video=${match[1]}&parent=${parentHost()}&autoplay=false`
        : `https://player.twitch.tv/?channel=${match[2]}&parent=${parentHost()}&autoplay=false`,
    reason: 'Twitch live streams are DRM-protected; the official embed is required.',
  },
  {
    id: 'streamable',
    name: 'Streamable',
    match: /streamable\.com\/(?:e\/)?([a-zA-Z0-9]+)/i,
    embed: (match) => `https://streamable.com/e/${match[1]}`,
    reason: 'Streamable only exposes its embed.',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    match: /facebook\.com\/.+\/videos\/(?:\d+)/i,
    embed: (match) =>
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(match[0])}&show_text=false`,
    reason: 'Facebook video must use its plugin.',
  },
];

export const providerAdapter: SourceAdapter = {
  id: 'provider',
  name: 'Video provider',
  canHandle: (input) => PROVIDERS.some((rule) => rule.match.test(input)),
  resolve: (input) => {
    for (const rule of PROVIDERS) {
      const match = rule.match.exec(input);
      if (!match) continue;
      return {
        kind: 'provider',
        sources: [],
        provider: { name: rule.name, embedUrl: rule.embed(match), reason: rule.reason },
        note: rule.reason,
      };
    }
    return { kind: 'provider', sources: [] };
  },
};

/* ----------------------------------------------------------- cloud storage */

export const cloudStorageAdapter: SourceAdapter = {
  id: 'cloud',
  name: 'Cloud storage',
  canHandle: (input) =>
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.test(input) ||
    /dropbox\.com\/(s|scl)\//.test(input) ||
    /1drv\.ms\//.test(input) ||
    /onedrive\.live\.com\//.test(input),
  resolve: (input) => {
    const drive = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(input);
    if (drive) {
      // The public download endpoint works for "anyone with the link" files.
      return {
        kind: 'media',
        sources: [`https://drive.google.com/uc?export=download&id=${drive[1]}`],
        note: 'Google Drive: only files shared as “anyone with the link” can be fetched. Large files may ask for a confirmation page.',
      };
    }
    if (/dropbox\.com\//.test(input)) {
      return {
        kind: 'media',
        sources: [input.replace(/\?.*$/, '').replace(/\/?$/, '') + '?raw=1'],
        note: 'Dropbox: converted to a direct download link.',
      };
    }
    return {
      kind: 'media',
      sources: [input],
      note: 'OneDrive links usually need to be converted to a direct download link first.',
    };
  },
};

/* --------------------------------------------------------------- registry */

export const ADAPTERS: SourceAdapter[] = [
  magnetAdapter,
  ipfsAdapter,
  providerAdapter,
  cloudStorageAdapter,
  directMediaAdapter,
];

/** Fallback for anything that looks like a URL but no adapter claimed. */
const genericAdapter: SourceAdapter = {
  id: 'generic',
  name: 'Network link',
  canHandle: () => true,
  resolve: (input): ResolvedLink => ({
    kind: 'media',
    sources: [input],
    note: 'No extension detected — the player will sniff the content type before choosing an engine.',
  }),
};

export function resolveLink(input: string): ResolvedLink {
  const value = input.trim();
  if (!value) return { kind: 'media', sources: [] };
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.canHandle(value)) {
        const result = adapter.resolve(value);
        if (result instanceof Promise) {
          // The registry stays synchronous; async adapters are not used yet.
          continue;
        }
        return { ...result, sources: result.sources.filter(Boolean) };
      }
    } catch {
      /* a broken adapter must not break the others */
    }
  }
  return genericAdapter.resolve(value) as ResolvedLink;
}

/** Short label for the URL preview, e.g. "YouTube · provider". */
export function describeLink(input: string): { adapter: string; kind: LinkKind; note?: string } {
  const value = input.trim();
  for (const adapter of ADAPTERS) {
    if (adapter.canHandle(value)) {
      const resolved = resolveLink(value);
      return { adapter: adapter.name, kind: resolved.kind, note: resolved.note };
    }
  }
  return { adapter: 'Network link', kind: 'media' };
}
