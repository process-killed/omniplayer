/**
 * AnimeEdge Universal Core Engine — v36.0 Cold-Start Resilient & Third-Party Proxy Aware
 * Stable stream validation, torrent normalization, HLS probing,
 * metadata, skip times, progress tracking and safe notifications.
 *
 * Key Upgrades:
 *  1. Third-Party Proxy Awareness: Recognizes api.aniraku.tech, indian.anikoto.workers.dev,
 *     and cloud.hindi-anime.com as external proxy gateways and delegates fallback proxying
 *     to third-party endpoints (0% local Cloudflare media bandwidth).
 *  2. Fast Manifest Verification (Cold-Start Fix): Validates HLS streams as soon as a
 *     valid #EXTM3U manifest is returned instead of recursively downloading child variants
 *     and .ts segments, eliminating 3.4s cold-cache timeouts on the first click.
 *  3. Cold-Cache Fallback Preservation: Never drops valid upstream streams to 0 if
 *     browser CORS or cold-start proxy spin-up aborts the preflight probe.
 *  4. Preserves all exports: buildProxiedUrl, resolveHlsRelativeUrl, validateStreamLinks,
 *     fetchAdvancedAnimeDetails, fetchSkipTimes, ProgressTracker, formatTime, showPlayerToast.
 */

import { CONFIG } from '/providers.js';

const PROBE_CONCURRENCY = 4;
const MAX_HLS_DEPTH = 2;
const MAX_HLS_VARIANTS = 2;
const MAX_HLS_AUDIO_TRACKS = 2;
const MAX_PLAYLIST_CHARS = 1_000_000;
const DEFAULT_PROBE_TIMEOUT = 6500;

const EMBED_HOSTS = Object.freeze([
  'vidmoly.net',
  'abyssplayer.com',
  'rubystm.com',
  'upns.pro',
  'megaplay.buzz',
  '4anime.com.ro',
  'ansembed.net',
  'sendvid.com',
  'flixcloud.cc',
  'flixcloud.co',
  'flixcloud.com'
]);

// External Third-Party Proxy Gateways (Zero Local CF Bandwidth)
const EXTERNAL_HLS_PROXIES = Object.freeze({
  ANIRAKU: 'https://api.aniraku.tech/api/v1/proxy',
  ANIKOTO: 'https://indian.anikoto.workers.dev/'
});

// -----------------------------------------------------------------------------
// 1. URL and proxy helpers
// -----------------------------------------------------------------------------

function safeURL(value, base) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isMediaProxyUrl(value) {
  const url = safeURL(value);
  if (!url) return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (
    path.includes('/api/v1/media-proxy') ||
    path.includes('/api/v1/proxy') ||
    path.includes('/hls-proxy') ||
    host === 'api.aniraku.tech' ||
    host === 'indian.anikoto.workers.dev' ||
    host === 'cloud.hindi-anime.com'
  );
}

function getUnderlyingUrl(value) {
  const url = safeURL(value);
  if (!url) return String(value || '');

  if (isMediaProxyUrl(value)) {
    const inner = url.searchParams.get('url') || url.searchParams.get('src');
    if (inner) return inner;
  }

  return value;
}

function inferredReferer(url, headers = {}) {
  const supplied =
    headers.Referer ||
    headers.referer ||
    headers.Origin ||
    headers.origin;

  if (supplied) return String(supplied);

  const host = safeURL(url)?.hostname.toLowerCase() || '';

  if (host.includes('hakunaymatata')) {
    return 'https://mzfi.me/';
  }

  if (host.includes('vid-cdn')) {
    return 'https://anizone.to/';
  }

  if (host.endsWith('drama1.cfd') || host.includes('dramahot')) {
    return 'https://anikoto.cz/';
  }

  if (host.includes('nexabloom') || host.includes('megaplay')) {
    return 'https://megaplay.buzz/';
  }

  if (host.includes('krussdomi')) {
    return 'https://krussdomi.com/';
  }

  if (host.includes('megavid')) {
    return 'https://megavid.buzz/';
  }

  if (host.includes('anixo')) {
    return 'https://anixo.buzz/';
  }

  return '';
}

/**
 * Builds a Third-Party proxy URL without proxying an existing proxy twice
 * and without routing heavy video traffic through local Cloudflare bandwidth.
 */
export function buildProxiedUrl(rawUrl, headers = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';

  const clean = rawUrl.trim();

  if (isMediaProxyUrl(clean)) return clean;

  const target = safeURL(clean);

  if (
    !target ||
    !['http:', 'https:'].includes(target.protocol)
  ) {
    return '';
  }

  // Known HTTP-only origin safeguard
  if (
    target.hostname === '140.238.244.130' &&
    target.protocol === 'https:'
  ) {
    target.protocol = 'http:';
  }

  const referer = inferredReferer(target.toString(), headers);
  const proxyHeaders = { ...headers };
  if (referer && !proxyHeaders.Referer && !proxyHeaders.referer) {
    proxyHeaders.Referer = referer;
  }

  // Delegate to external third-party proxy (api.aniraku.tech) when headers are needed
  if (Object.keys(proxyHeaders).length > 0) {
    const proxy = safeURL(EXTERNAL_HLS_PROXIES.ANIRAKU);
    if (proxy) {
      proxy.searchParams.set('url', target.toString());
      proxy.searchParams.set('headers', JSON.stringify(proxyHeaders));
      return proxy.toString();
    }
  }

  // Fallback to external Anikoto proxy
  return `${EXTERNAL_HLS_PROXIES.ANIKOTO}?url=${encodeURIComponent(target.toString())}`;
}

function isTrustedEmbedHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');

  return EMBED_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  ) || /(^|\.)[a-z0-9-]*flixcloud[a-z0-9-]*\.[a-z]{2,}$/i.test(host);
}

function parseHlsAttributes(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return {};

  const input = line.slice(colon + 1);
  const result = {};
  const regex = /([A-Z0-9-]+)=((?:"[^"]*")|(?:[^,]*))/g;

  let match;

  while ((match = regex.exec(input))) {
    result[match[1]] = match[2]
      .replace(/^"|"$/g, '')
      .trim();
  }

  return result;
}

/**
 * Resolves HLS-relative URLs against their real upstream manifest.
 */
export function resolveHlsRelativeUrl(
  baseManifestUrl,
  relativeOrAbsoluteUri
) {
  const uri = String(relativeOrAbsoluteUri || '').trim();
  if (!uri) return '';

  // If the line inside the manifest is already a full proxy URL, return it directly
  if (isMediaProxyUrl(uri)) return uri;

  const isProxy = isMediaProxyUrl(baseManifestUrl);
  const parsedProxy = isProxy ? safeURL(baseManifestUrl) : null;

  let inheritedHeaders = {};
  const rawHeadersParam = parsedProxy?.searchParams.get('headers');
  if (rawHeadersParam) {
    try {
      inheritedHeaders = JSON.parse(rawHeadersParam);
    } catch {}
  } else {
    const ref = parsedProxy?.searchParams.get('referer');
    if (ref) inheritedHeaders = { Referer: ref };
  }

  const realBase = isProxy
    ? getUnderlyingUrl(baseManifestUrl)
    : baseManifestUrl;

  const absolute = safeURL(uri, realBase);

  if (
    !absolute ||
    !['http:', 'https:'].includes(absolute.protocol)
  ) {
    return '';
  }

  return isProxy
    ? buildProxiedUrl(absolute.toString(), inheritedHeaders)
    : absolute.toString();
}

// -----------------------------------------------------------------------------
// 2. Fetch and probe utilities
// -----------------------------------------------------------------------------

function errorPayload(bytes, contentType = '') {
  if (!bytes?.length) return true;
  if (/text\/html/i.test(contentType)) return true;

  const text = new TextDecoder()
    .decode(bytes.slice(0, 160))
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();

  return (
    text.startsWith('<!doctype') ||
    text.startsWith('<html') ||
    text.startsWith('{"error') ||
    text.startsWith('{"success":false') ||
    text.startsWith('{"message":"error') ||
    text.startsWith('access denied') ||
    text.startsWith('forbidden') ||
    text.startsWith('error 403') ||
    text.startsWith('error 404')
  );
}

async function readProbeBytes(response, minBytes = 4) {
  const reader = response.body?.getReader();

  if (!reader) return response.ok;

  const chunks = [];
  let size = 0;

  try {
    while (size < minBytes) {
      const { value, done } = await reader.read();

      if (done || !value?.length) break;

      chunks.push(value);
      size += value.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed.
    }
  }

  if (size < minBytes) return false;

  const merged = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return !errorPayload(
    merged,
    response.headers.get('content-type') || ''
  );
}

/**
 * Some media hosts permit HTML5 video playback but block JavaScript fetch().
 * This fallback only checks whether browser metadata can be obtained.
 */
function probeWithNativeVideoElement(
  videoUrl,
  timeoutMs = DEFAULT_PROBE_TIMEOUT,
  signal = null
) {
  return new Promise((resolve) => {
    const video = document.createElement('video');

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-hidden', 'true');

    video.style.cssText =
      'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;' +
      'opacity:0;pointer-events:none;';

    let settled = false;
    let timer = null;

    const cleanup = (valid) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);

      signal?.removeEventListener('abort', onAbort);

      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      } catch {
        // Best-effort cleanup.
      }

      resolve(valid);
    };

    const onReady = () => {
      if (video.readyState >= 1) {
        cleanup(true);
      }
    };

    const onError = () => cleanup(false);
    const onAbort = () => cleanup(false);

    timer = setTimeout(() => cleanup(false), timeoutMs);

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);

    signal?.addEventListener('abort', onAbort, { once: true });

    if (signal?.aborted) {
      cleanup(false);
      return;
    }

    document.body?.appendChild(video);
    video.src = videoUrl;

    try {
      video.load();
    } catch {
      cleanup(false);
    }
  });
}

async function probeDirectVideoHybrid(
  videoUrl,
  signal,
  timeoutMs = DEFAULT_PROBE_TIMEOUT
) {
  try {
    const response = await fetch(videoUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-64' },
      signal
    });

    if (response.status === 404 || response.status === 410) {
      return false;
    }

    if (!(response.ok || response.status === 206)) {
      return false;
    }

    return await readProbeBytes(response, 4);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return true; // Preserve on cold-start timeout
    }

    // Try native media metadata when CORS prevents fetch access.
    return probeWithNativeVideoElement(videoUrl, timeoutMs, signal);
  }
}

/**
 * Fast, Cold-Start Resilient HLS Validator:
 * Verifies the top-level master/media playlist contains valid HLS tags (#EXTM3U)
 * and non-comment stream/segment entries without recursively downloading
 * multiple child variants and segments (which caused 1st-try timeouts on cold proxies).
 */
async function probeHlsStreamCore(
  manifestUrl,
  signal,
  maxDepth = MAX_HLS_DEPTH
) {
  if (!manifestUrl || maxDepth <= 0 || signal?.aborted) {
    return false;
  }

  const parsed = safeURL(manifestUrl);

  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return false;
  }

  const isTrustedProxy = isMediaProxyUrl(manifestUrl);

  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*' },
      signal
    });

    // Definitive dead link codes
    if (response.status === 404 || response.status === 410) {
      return false;
    }

    if (!response.ok) {
      // If a known third-party proxy returns 403/429/503 on preflight burst,
      // keep the stream so ArtPlayer can load it directly.
      return isTrustedProxy && response.status !== 500;
    }

    const text = await response.text();

    if (!text || text.length > MAX_PLAYLIST_CHARS) {
      return false;
    }

    const trimmed = text.replace(/^\uFEFF/, '').trim();

    // Check for explicit JSON error payloads returned with HTTP 200
    if (
      trimmed.startsWith('{"error') ||
      trimmed.startsWith('{"success":false') ||
      trimmed.toLowerCase().startsWith('<!doctype html')
    ) {
      return false;
    }

    if (!trimmed.includes('#EXTM3U')) {
      return false;
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Confirm the manifest actually has variant or segment URIs
    const hasMediaOrVariantEntries = lines.some(
      (line) => !line.startsWith('#') || line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXTINF:')
    );

    return hasMediaOrVariantEntries;
  } catch (err) {
    // If aborted due to cold-start latency on a valid proxy URL, keep the stream
    if (isTrustedProxy && (signal?.aborted || err?.name === 'AbortError')) {
      return true;
    }
    return isTrustedProxy;
  }
}

// -----------------------------------------------------------------------------
// 3. Torrent recognition and priority
// -----------------------------------------------------------------------------

function isMagnetUrl(value) {
  return typeof value === 'string' &&
    /^magnet:\?/i.test(value.trim());
}

function parseInfoHash(magnet) {
  if (!isMagnetUrl(magnet)) return '';

  try {
    const xt = new URL(magnet).searchParams.get('xt') || '';
    const match = xt.match(/urn:btih:([a-z0-9]{32,40})/i);

    return match ? match[1] : '';
  } catch {
    const match = magnet.match(
      /[?&]xt=urn:btih:([a-z0-9]{32,40})/i
    );

    return match ? match[1] : '';
  }
}

function validInfoHash(value) {
  return (
    /^[a-f0-9]{40}$/i.test(value) ||
    /^[a-z2-7]{32}$/i.test(value)
  );
}

function languagePriority(source) {
  const values = [
    source.language,
    ...(Array.isArray(source.languages) ? source.languages : [])
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  const all = values.join(' ');

  if (/hindi|\bhin\b|\bhi\b/.test(all)) return 1;

  if (/dual[\s-]*audio|english|\beng\b|\ben\b/.test(all)) {
    return 2;
  }

  if (/japanese|\bjpn\b|\bsub(?:bed)?\b|\bja\b/.test(all)) {
    return 3;
  }

  const provided = source.priorityScore;

  return (
    provided !== null &&
    provided !== undefined &&
    provided !== '' &&
    Number.isFinite(Number(provided))
  )
    ? Number(provided)
    : 5;
}

function normalizeTorrentSource(source, index) {
  const urlValue =
    typeof source.url === 'string' ? source.url.trim() : '';

  const existingMagnet = [
    source.magnetUri,
    source.magnet,
    urlValue
  ].find(isMagnetUrl) || '';

  const infoHash = String(
    source.infoHash ||
    parseInfoHash(existingMagnet) ||
    ''
  ).trim();

  const explicitP2P =
    source.isTorrent === true ||
    String(source.type || '').toLowerCase() === 'torrent' ||
    String(source.delivery || '').toLowerCase() === 'p2p' ||
    Boolean(existingMagnet) ||
    Boolean(infoHash);

  if (!explicitP2P) return null;

  if (!existingMagnet && !validInfoHash(infoHash)) {
    return null;
  }

  let magnetUri = existingMagnet;

  if (!magnetUri && validInfoHash(infoHash)) {
    const magnet = new URL('magnet:?');

    magnet.searchParams.set('xt', `urn:btih:${infoHash}`);

    if (source.title || source.name) {
      magnet.searchParams.set(
        'dn',
        String(source.title || source.name).slice(0, 200)
      );
    }

    const configuredTrackers =
      Array.isArray(CONFIG?.WEBTORRENT_TRACKERS) &&
      CONFIG.WEBTORRENT_TRACKERS.length
        ? CONFIG.WEBTORRENT_TRACKERS
        : Array.isArray(source.trackers)
          ? source.trackers
          : [];

    for (const tracker of configuredTrackers.slice(0, 8)) {
      if (
        typeof tracker === 'string' &&
        /^wss?:\/\//i.test(tracker)
      ) {
        magnet.searchParams.append('tr', tracker);
      }
    }

    magnetUri = magnet.toString();
  }

  return {
    ...source,
    type: 'torrent',
    isTorrent: true,
    infoHash: infoHash || undefined,
    magnetUri,
    url: magnetUri,
    priorityScore: languagePriority(source),
    validationStatus: 'p2p-link-accepted-not-peer-verified',
    _idx: index
  };
}

function sourceUnderlyingUrl(source) {
  return String(
    source.url ||
    source.embed ||
    source.hlsProxyUrl ||
    source.originalUrl ||
    ''
  ).trim();
}

function isHlsSource(source, rawUrl) {
  const candidates = [
    rawUrl,
    source.originalUrl,
    source.hlsProxyUrl
  ].filter((value) => typeof value === 'string' && value);

  return (
    String(source.type || '').toLowerCase() === 'hls' ||
    String(source.format || '').toLowerCase() === 'm3u8' ||
    String(source.verification || '').toLowerCase() === 'proxy' ||
    candidates.some((candidate) => {
      const underlying = getUnderlyingUrl(candidate);
      const parsed = safeURL(underlying);
      const path = parsed?.pathname || underlying;

      return (
        /\.m3u8?$/i.test(path) ||
        /stream\/m3u8|hls-proxy|proxy_m3u8|api\/v1\/proxy/i.test(candidate)
      );
    })
  );
}

function isDirectVideoSource(source, rawUrl) {
  if (isHlsSource(source, rawUrl)) return false;

  if (
    ['direct', 'mp4', 'video'].includes(
      String(source.type || '').toLowerCase()
    )
  ) {
    return true;
  }

  if (
    ['mp4', 'mkv', 'webm', 'mov'].includes(
      String(source.format || '').toLowerCase()
    )
  ) {
    return true;
  }

  const underlying = getUnderlyingUrl(rawUrl);
  const parsed = safeURL(underlying);
  const path = parsed?.pathname || underlying;
  const host = parsed?.hostname || '';

  return (
    /\.(mp4|mkv|webm|mov)$/i.test(path) ||
    /(^|\.)sweetpixel\.org$/i.test(host) ||
    /(^|\.)r2\.dev$/i.test(host) ||
    /(^|\.)r2\.cloudflarestorage\.com$/i.test(host)
  );
}

// -----------------------------------------------------------------------------
// 4. Smart stream validation coordinator (Cold-Start & First-Try Resilient)
// -----------------------------------------------------------------------------

export async function validateStreamLinks(
  sources,
  timeoutMs = DEFAULT_PROBE_TIMEOUT,
  onProgress = null
) {
  if (!Array.isArray(sources) || !sources.length) {
    return [];
  }

  // Enforce at least 6000ms timeout so cold-starting third-party proxies do not abort on 1st try
  const duration = Math.max(
    6000,
    Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT
  );

  async function probeSingleStream(input, index) {
    if (!input) return null;

    // Slight stagger between parallel workers to avoid triggering burst rate limits on api.aniraku.tech
    if (index > 0) {
      await new Promise((r) => setTimeout(r, (index % PROBE_CONCURRENCY) * 65));
    }

    const source = typeof input === 'string'
      ? { url: input }
      : input;

    if (!source || typeof source !== 'object') return null;

    // 1. P2P Torrents & Magnets
    const torrent = normalizeTorrentSource(source, index);
    if (torrent) {
      return torrent;
    }

    const rawUrl = sourceUnderlyingUrl(source);
    const parsed = safeURL(rawUrl);

    if (
      !parsed ||
      !['http:', 'https:'].includes(parsed.protocol)
    ) {
      return null;
    }

    const underlying = safeURL(getUnderlyingUrl(rawUrl));

    // Reject only an empty root-domain URL without query/hash data.
    if (
      underlying &&
      (underlying.pathname === '/' || underlying.pathname === '') &&
      !underlying.hash &&
      !underlying.search
    ) {
      return null;
    }

    // 2. Embeds & Iframes
    const explicitEmbed =
      source.isEmbed === true ||
      String(source.type || '').toLowerCase() === 'embed' ||
      String(source.format || '').toLowerCase() === 'embed' ||
      String(source.verification || '').toLowerCase() === 'embed' ||
      Boolean(
        source.embed &&
        !source.hlsProxyUrl &&
        !isHlsSource(source, rawUrl)
      ) ||
      /\/(?:embed|e|v)\b/i.test(
        underlying?.pathname || rawUrl
      );

    if (
      explicitEmbed &&
      (isTrustedEmbedHost(underlying?.hostname || parsed.hostname) || source.verification === 'embed')
    ) {
      return {
        ...source,
        url: rawUrl,
        originalUrl: source.originalUrl || rawUrl,
        type: 'embed',
        isEmbed: true,
        latencyMs: 0,
        validationStatus: 'trusted-embed-not-network-probed',
        _idx: index
      };
    }

    if (explicitEmbed) return null;

    // 3. HLS & Direct Media Probing
    const host = parsed.hostname;
    const isRawIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    const hasRequiredHeaders =
      (source.headers && Object.keys(source.headers).length > 0) ||
      (source.serverHeaders && Object.keys(source.serverHeaders).length > 0);

    const mustProxyFirst =
      !isMediaProxyUrl(rawUrl) &&
      (
        (window.location.protocol === 'https:' && parsed.protocol === 'http:') ||
        (isRawIp && host === '140.238.244.130') ||
        (hasRequiredHeaders && isHlsSource(source, rawUrl))
      );

    const probeUrl = mustProxyFirst
      ? buildProxiedUrl(
          rawUrl,
          source.headers || source.serverHeaders || {}
        )
      : rawUrl;

    if (!probeUrl) return null;

    const isHls = isHlsSource(source, rawUrl);
    const isDirectVideo = isDirectVideoSource(source, rawUrl);
    const started = performance.now();

    async function probe(url) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        duration
      );

      try {
        if (isHls) {
          return await probeHlsStreamCore(
            url,
            controller.signal
          );
        }

        if (isDirectVideo) {
          return await probeDirectVideoHybrid(
            url,
            controller.signal,
            duration
          );
        }

        return await probeDirectVideoHybrid(
          url,
          controller.signal,
          duration
        );
      } finally {
        clearTimeout(timer);
      }
    }

    try {
      if (await probe(probeUrl)) {
        return {
          ...source,
          url: probeUrl,
          originalUrl: source.originalUrl || rawUrl,
          priorityScore:
            source.priorityScore != null &&
            Number.isFinite(Number(source.priorityScore))
              ? Number(source.priorityScore)
              : languagePriority(source),
          latencyMs: Math.round(performance.now() - started),
          validationStatus: 'probe-passed',
          _idx: index
        };
      }
    } catch {
      // Continue to proxy fallback if allowed.
    }

    // Avoid proxying an existing proxy again
    if (mustProxyFirst || isMediaProxyUrl(probeUrl)) {
      return null;
    }

    const proxyUrl = buildProxiedUrl(
      rawUrl,
      source.headers || source.serverHeaders || {}
    );

    if (!proxyUrl || proxyUrl === rawUrl) return null;

    try {
      if (await probe(proxyUrl)) {
        return {
          ...source,
          url: proxyUrl,
          originalUrl: source.originalUrl || rawUrl,
          priorityScore:
            source.priorityScore != null &&
            Number.isFinite(Number(source.priorityScore))
              ? Number(source.priorityScore)
              : languagePriority(source),
          latencyMs: Math.round(performance.now() - started),
          validationStatus: 'proxy-probe-passed',
          _idx: index
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  // Rolling worker pool: keeps available slots busy without unbounded fetches.
  const results = [];
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= sources.length) return;

      try {
        const result = await probeSingleStream(
          sources[index],
          index
        );

        if (result) results.push(result);
      } catch {
        // A bad candidate must not fail the entire source list.
      } finally {
        completed++;

        if (typeof onProgress === 'function') {
          try {
            onProgress(completed, sources.length, results.length);
          } catch {
            // Progress callback is optional.
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(PROBE_CONCURRENCY, sources.length) },
      () => worker()
    )
  );

  // Ultimate Cold-Start Safeguard:
  // If the upstream provider returned valid stream objects, but every single validation
  // timed out on the first click due to cold edge cache spin-up, preserve the streams
  // rather than returning 0 sources.
  if (results.length === 0 && sources.length > 0) {
    return sources.map((s, idx) => {
      const sObj = typeof s === 'string' ? { url: s } : s;
      const raw = sourceUnderlyingUrl(sObj);
      return {
        ...sObj,
        url: raw,
        originalUrl: sObj.originalUrl || raw,
        priorityScore: languagePriority(sObj),
        latencyMs: duration,
        validationStatus: 'cold-start-fallback-preserved',
        _idx: idx
      };
    });
  }

  return results.sort((a, b) => {
    const priorityA =
      Number.isFinite(Number(a.priorityScore))
        ? Number(a.priorityScore)
        : 99;

    const priorityB =
      Number.isFinite(Number(b.priorityScore))
        ? Number(b.priorityScore)
        : 99;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    const latencyA =
      Number.isFinite(Number(a.latencyMs))
        ? Number(a.latencyMs)
        : Number.MAX_SAFE_INTEGER;

    const latencyB =
      Number.isFinite(Number(b.latencyMs))
        ? Number(b.latencyMs)
        : Number.MAX_SAFE_INTEGER;

    return latencyA - latencyB;
  });
}

// -----------------------------------------------------------------------------
// 5. AniList metadata
// -----------------------------------------------------------------------------

const animeDetailsCache = new Map();

const ANILIST_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      idMal
      title { romaji english native userPreferred }
      description(asHtml: false)
      bannerImage
      coverImage { extraLarge large medium color }
      genres synonyms format status season seasonYear episodes duration
      averageScore popularity
      trailer { id site thumbnail }
      studios(isMain: true) { nodes { name } }
      nextAiringEpisode { episode timeUntilAiring }
      streamingEpisodes { title thumbnail url }
      characters(sort: ROLE, perPage: 6) {
        nodes { name { userPreferred } image { medium } }
      }
    }
  }
`;

export async function fetchAdvancedAnimeDetails(anilistId) {
  const id = Number.parseInt(anilistId, 10);

  if (!Number.isInteger(id) || id <= 0) return null;

  if (animeDetailsCache.has(id)) {
    return await animeDetailsCache.get(id);
  }

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      8000
    );

    try {
      const response = await fetch(
        'https://graphql.anilist.co',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            query: ANILIST_QUERY,
            variables: { id }
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) return null;

      const json = await response.json();
      return json?.data?.Media || null;
    } catch (error) {
      console.warn(
        '[AniList/DetailsError]:',
        error?.message || error
      );

      return null;
    } finally {
      clearTimeout(timer);
    }
  })();

  animeDetailsCache.set(id, request);

  const result = await request;

  if (result) {
    animeDetailsCache.set(id, result);

    if (animeDetailsCache.size > 100) {
      const oldest = animeDetailsCache.keys().next().value;

      if (oldest !== id) {
        animeDetailsCache.delete(oldest);
      }
    }
  } else {
    animeDetailsCache.delete(id);
  }

  return result;
}

// -----------------------------------------------------------------------------
// 6. AniSkip intro/outro/recap times
// -----------------------------------------------------------------------------

const skipCache = new Map();

export async function fetchSkipTimes(
  malId,
  episode,
  episodeLengthSec = 1440
) {
  const id = Number.parseInt(malId, 10);
  const ep = Number.parseInt(episode, 10);

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !Number.isInteger(ep) ||
    ep <= 0
  ) {
    return null;
  }

  const length =
    Number.isFinite(Number(episodeLengthSec)) &&
    Number(episodeLengthSec) > 0
      ? Number(episodeLengthSec)
      : 1440;

  const cacheKey = `${id}_${ep}_${length}`;

  if (skipCache.has(cacheKey)) {
    return skipCache.get(cacheKey);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    5000
  );

  try {
    const url = new URL(
      `https://api.aniskip.com/v2/skip-times/${id}/${ep}`
    );

    for (const type of [
      'op',
      'ed',
      'recap',
      'mixed-op',
      'mixed-ed'
    ]) {
      url.searchParams.append('types', type);
    }

    url.searchParams.set('episodeLength', String(length));

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) return null;

    const data = await response.json();

    if (data?.found && Array.isArray(data.results)) {
      const intervals = data.results
        .map((result) => ({
          type: result.skipType,
          startTime: Number(result.interval?.startTime ?? 0),
          endTime: Number(result.interval?.endTime ?? 0)
        }))
        .filter((item) =>
          Number.isFinite(item.startTime) &&
          Number.isFinite(item.endTime) &&
          item.endTime > item.startTime
        );

      skipCache.set(cacheKey, intervals);

      if (skipCache.size > 300) {
        skipCache.delete(skipCache.keys().next().value);
      }

      return intervals;
    }
  } catch (error) {
    console.warn(
      '[AniSkip/IntervalError]:',
      error?.message || error
    );
  } finally {
    clearTimeout(timer);
  }

  return null;
}

// -----------------------------------------------------------------------------
// 7. Watch progress persistence
// -----------------------------------------------------------------------------

const STORAGE_WATCH_PROGRESS = 'animeedge_watch_progress';
const STORAGE_WATCH_HISTORY = 'animeedge_watch_history';

function safeReadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(
      '[ProgressTracker/StorageError]:',
      error?.message || error
    );

    return false;
  }
}

export const ProgressTracker = {
  save(
    anilistId,
    episode,
    currentTime,
    duration = 0,
    title = 'Anime',
    poster = ''
  ) {
    const id = Number.parseInt(anilistId, 10);
    const ep = Number.parseInt(episode, 10);
    const time = Number(currentTime);
    const total = Number(duration);

    if (
      !id || id <= 0 ||
      !ep || ep <= 0 ||
      !Number.isFinite(time) ||
      time < 4
    ) {
      return;
    }

    const curTime = Math.floor(time);
    const totalDur =
      Number.isFinite(total) && total > 0
        ? Math.floor(total)
        : 0;

    const percent = totalDur > 0
      ? Math.min(100, Math.round((curTime / totalDur) * 100))
      : 0;

    const updatedAt = Date.now();

    const store = safeReadJSON(STORAGE_WATCH_PROGRESS, {});

    store[id] = {
      episode: ep,
      time: curTime,
      duration: totalDur,
      percent,
      isCompleted: percent >= 90,
      updatedAt
    };

    safeWriteJSON(STORAGE_WATCH_PROGRESS, store);

    const history = safeReadJSON(STORAGE_WATCH_HISTORY, []);
    const list = Array.isArray(history) ? history : [];

    const next = list.filter(
      (item) => String(item.anilistId) !== String(id)
    );

    next.unshift({
      anilistId: id,
      title: String(title || 'Anime'),
      poster: String(poster || ''),
      episode: ep,
      time: curTime,
      duration: totalDur,
      percent,
      updatedAt
    });

    safeWriteJSON(
      STORAGE_WATCH_HISTORY,
      next.slice(0, 50)
    );
  },

  get(anilistId) {
    const store = safeReadJSON(STORAGE_WATCH_PROGRESS, {});
    return store?.[anilistId] || null;
  },

  getHistory() {
    const history = safeReadJSON(STORAGE_WATCH_HISTORY, []);
    return Array.isArray(history) ? history : [];
  },

  clear(anilistId) {
    const store = safeReadJSON(STORAGE_WATCH_PROGRESS, {});
    delete store[anilistId];

    safeWriteJSON(STORAGE_WATCH_PROGRESS, store);

    const history = safeReadJSON(STORAGE_WATCH_HISTORY, []);

    safeWriteJSON(
      STORAGE_WATCH_HISTORY,
      (Array.isArray(history) ? history : []).filter(
        (item) => String(item.anilistId) !== String(anilistId)
      )
    );
  }
};

// -----------------------------------------------------------------------------
// 8. Time formatting and safe toast notifications
// -----------------------------------------------------------------------------

export function formatTime(totalSeconds) {
  const value = Number(totalSeconds);

  const sec = Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;

  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;

  if (hours > 0) {
    return (
      `${hours}:` +
      `${String(minutes).padStart(2, '0')}:` +
      `${String(seconds).padStart(2, '0')}`
    );
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function showPlayerToast(
  message,
  type = 'info',
  durationMs = 2800
) {
  const container =
    document.getElementById('embedContainer') ||
    document.body;

  let wrapper = document.getElementById('animeedgeToastWrapper');

  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'animeedgeToastWrapper';

    wrapper.style.cssText = `
      position:absolute;
      top:76px;
      left:50%;
      transform:translateX(-50%);
      z-index:1000;
      display:flex;
      flex-direction:column;
      gap:8px;
      pointer-events:none;
      max-width:calc(100% - 24px);
    `;

    container.appendChild(wrapper);
  }

  const colors = {
    success: '#00e676',
    warning: '#ff9100',
    error: '#ff6b6b',
    info: '#00e5ff'
  };

  const border = colors[type] || colors.info;
  const toast = document.createElement('div');

  toast.style.cssText = `
    background:rgba(10,14,26,.94);
    backdrop-filter:blur(14px);
    -webkit-backdrop-filter:blur(14px);
    border:1px solid ${border};
    box-shadow:0 4px 20px rgba(0,0,0,.5);
    color:#f8fafc;
    padding:8px 18px;
    border-radius:9999px;
    font:700 12px/1.4 system-ui,sans-serif;
    letter-spacing:.2px;
    opacity:0;
    transform:translateY(-8px) scale(.96);
    transition:opacity .2s ease,transform .2s ease;
    display:flex;
    align-items:center;
    gap:8px;
    overflow-wrap:anywhere;
  `;

  const icon = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  );

  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '14');
  icon.setAttribute('height', '14');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', border);
  icon.setAttribute('stroke-width', '2.5');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');

  const path = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  );

  const paths = {
    success: 'M20 6 9 17l-5-5',
    warning: 'M12 9v4m0 4h.01M10.3 3.9 1.9 18.1A2 2 0 0 0 3.6 21h16.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z',
    error: 'M18 6 6 18M6 6l12 12',
    info: 'M12 8h.01M11 12h1v4h1'
  };

  path.setAttribute('d', paths[type] || paths.info);
  icon.appendChild(path);

  const text = document.createElement('span');
  text.textContent = String(message ?? '');

  toast.append(icon, text);
  wrapper.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  });

  const duration = Math.max(
    500,
    Number(durationMs) || 2800
  );

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(.96)';

    window.setTimeout(() => {
      toast.remove();

      if (wrapper && !wrapper.childElementCount) {
        wrapper.remove();
      }
    }, 250);
  }, duration);
}
