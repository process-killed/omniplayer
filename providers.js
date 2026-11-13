/**
 * =============================================================================
 * Anime Stream Gateway Client Provider Configuration — v5.2 (Production)
 * =============================================================================
 * Server 1: Cloudflare Edge Gateway (Stremio / Addons / P2P)
 * Server 2: Third-Party Aggregators (LuffyTV, Aniraku, Kuromi)
 *
 * Changes in v5.2:
 *  - Server 2: Removed deprecated 'hindi-anime.com' and 'anikoto'.
 *  - Server 2: Added 'luffytv' multi-cluster aggregator.
 *  - Server 2: Retained 'aniraku' (via api.aniraku.tech) and 'kuromi' (Flixcloud).
 *  - Configuration: Deep-frozen structures (Object.freeze) and lookup helpers.
 * =============================================================================
 */

export const CONFIG = Object.freeze({
  API_BASE_URL: 'https://api.aniframe.workers.dev',
  LUFFYTV_BASE_URL: 'https://luffytv.live',
  ANIRAKU_BASE_URL: 'https://api.aniraku.tech',

  // Maximum allowed torrent size for in-browser client playback (500 MB)
  TORRENT_MAX_BYTES: 500 * 1024 * 1024,

  // High-reliability WebTorrent WebSocket trackers for browser WebRTC swarms
  WEBTORRENT_TRACKERS: Object.freeze([
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz',
    'wss://tracker.webtorrent.dev'
  ]),

  // Torrents play in-page with WebTorrent; no external embed host is used.
  PLAYERS: Object.freeze({})
});

export const SERVERS = Object.freeze([
  {
    id: 'server_1',
    name: 'Server 1 (Cloudflare Edge)',
    status: 'online',
    isAvailable: true,
    badge: 'EDGE STREMIO',
    description: 'High-speed Cloudflare Worker Edge Gateway with distributed Stremio resolvers',

    subServers: Object.freeze([
      {
        id: 'torrentio',
        name: 'Tor',
        category: 'torrent',
        badge: 'P2P (<500MB)',
        icon: '⚡',
        description: 'P2P torrent streams filtered strictly under 500 MB for buffer-free playback.'
      },
      {
        id: 'raretoons',
        name: 'Rare',
        category: 'hls',
        badge: 'HLS DUB',
        icon: '🇮🇳',
        description: 'HLS video streams with dedicated regional dubbing and audio tracks.'
      },
      {
        id: 'flixstream',
        name: 'Flix',
        category: 'direct',
        badge: 'FAST CDN',
        icon: '🚀',
        description: 'Direct MP4 and HLS streams delivered over high-speed edge nodes.'
      },
      {
        id: 'hdhub',
        name: 'Hub',
        category: 'direct',
        badge: 'DESI / DUAL',
        icon: '🎬',
        description: 'Multi-audio releases with integrated regional audio options.'
      },
      {
        id: 'penguplay',
        name: 'Pengu',
        category: 'direct',
        badge: 'ULTRA HD',
        icon: '🐧',
        description: 'High-definition video streams with token-authenticated CDN delivery.'
      },
      {
        id: 'fenixflix',
        name: 'Fenix',
        category: 'direct',
        badge: 'MULTI-AUDIO',
        icon: '🔥',
        description: 'Direct anime releases featuring selectable multi-audio tracks.'
      },
      {
        id: 'mediafusion',
        name: 'Fusion',
        category: 'direct',
        badge: 'SCRAPER',
        icon: '🔮',
        description: 'Multi-source stream discovery aggregator across edge indexes.'
      },
      {
        id: 'cncverse',
        name: 'Verse',
        category: 'torrent',
        badge: 'TORRENT (<500MB)',
        icon: '🌐',
        description: 'Debrid-compatible P2P streams restricted under 500 MB.'
      },
      {
        id: 'muvibox',
        name: 'Muvi',
        category: 'direct',
        badge: 'LITE 720P',
        icon: '📱',
        description: 'Lightweight, low-bitrate streams optimized for mobile data.'
      }
    ])
  },

  {
    id: 'server_2',
    name: 'Server 2 (Third-Party Aggregators)',
    status: 'online',
    isAvailable: true,
    badge: 'ACTIVE PROXIES',
    description: 'Third-party scrapers, cluster aggregators, and extraction networks',

    subServers: Object.freeze([
      {
        id: 'luffytv',
        name: 'LuffyTV Multi',
        category: 'hls',
        badge: 'SALT / KOTO / KAA',
        icon: '🏴‍☠️',
        description: 'Unified aggregator resolving AnimeSalt (multi-lang dubs), KotoTV, KAA, and ANV clusters.'
      },
      {
        id: 'aniraku',
        name: 'Aniraku',
        category: 'hls',
        badge: 'MULTI-CDN HLS',
        icon: '⛩️',
        description: 'Multi-source aggregator with high-speed direct edge streaming and embed fallbacks.'
      },
      {
        id: 'kuromi',
        name: 'Kuromi',
        category: 'embed',
        badge: 'FLIXCLOUD',
        icon: '🌸',
        description: 'Multi-provider stream extraction and sandbox embed playback.'
      }
    ])
  }
]);

export const LANGUAGES = Object.freeze([
  { id: '', label: 'All Audio', icon: '🌐' },
  { id: 'hindi', label: 'Hindi Dub', icon: '🇮🇳' },
  { id: 'english', label: 'English Dub', icon: '🇬🇧' },
  { id: 'japanese', label: 'Japanese Sub', icon: '🇯🇵' },
  { id: 'dual-audio', label: 'Dual Audio', icon: '🎧' },
  { id: 'telugu', label: 'Telugu', icon: '🇮🇳' },
  { id: 'tamil', label: 'Tamil', icon: '🇮🇳' },
  { id: 'malayalam', label: 'Malayalam', icon: '🇮🇳' }
]);

// -----------------------------------------------------------------------------
// Lookup & Validation Helpers
// -----------------------------------------------------------------------------

/**
 * Retrieves a server cluster by its identifier.
 * @param {string} serverId 
 * @returns {object|null}
 */
export function getServerById(serverId) {
  if (!serverId) return null;
  const targetId = String(serverId).toLowerCase().trim();
  return SERVERS.find((s) => s.id === targetId) || null;
}

/**
 * Retrieves a sub-server definition across available server clusters.
 * @param {string} subServerId 
 * @param {string} [clusterId] Optional cluster ID hint for faster lookup
 * @returns {object|null}
 */
export function getSubServer(subServerId, clusterId = null) {
  if (!subServerId) return null;
  const targetSubId = String(subServerId).toLowerCase().trim();

  if (clusterId) {
    const cluster = getServerById(clusterId);
    if (cluster) {
      const matched = cluster.subServers.find((sub) => sub.id === targetSubId);
      if (matched) return matched;
    }
  }

  for (const cluster of SERVERS) {
    const matched = cluster.subServers.find((sub) => sub.id === targetSubId);
    if (matched) return matched;
  }

  return null;
}

/**
 * Checks whether a language identifier exists in the supported language list.
 * @param {string} langId 
 * @returns {boolean}
 */
export function isValidLanguage(langId) {
  const targetLang = String(langId ?? '').toLowerCase().trim();
  return LANGUAGES.some((l) => l.id === targetLang);
}

export default {
  CONFIG,
  SERVERS,
  LANGUAGES,
  getServerById,
  getSubServer,
  isValidLanguage
};
