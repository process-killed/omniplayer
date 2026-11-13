/**
 * =============================================================================
 * Third-Party Media Extraction API Engine (Cloudflare Gateway Edition v31.0)
 * =============================================================================
 * - All requests route through Cloudflare Worker API (CONFIG.API_BASE_URL)
 * - Zero direct client-side external API calls (Bypasses CORS & WAF restrictions)
 * - Luffy TV Subserver Gateway & AnimeSalt Multi-Audio Integration
 * - Legacy purged: hindi-anime.com & standalone anikoto
 * =============================================================================
 */

import { CONFIG } from '/providers.js';

const DIRECT_KUROMI_WORKER_BASE = 'https://anime-api.neelofficial0812.workers.dev';
const LUFFY_UPSTREAM_ORIGIN = 'https://luffytv.live';

// -----------------------------------------------------------------------------
// 1. Helper: Token-Injecting Request Builders & URL Proxies
// -----------------------------------------------------------------------------
function getAuthHeaders(extraHeaders = {}) {
  const headers = {
    'Accept': 'application/json',
    ...extraHeaders
  };
  if (window.API_SESSION_TOKEN) {
    headers['x-session-token'] = window.API_SESSION_TOKEN;
  }
  return headers;
}

/**
 * Normalizes relative Luffy TV paths (/p/..., /api/...) into absolute upstream URLs
 */
function resolveUpstreamUrl(rawUrl) {
  if (!rawTargetValid(rawUrl)) return '';
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `${LUFFY_UPSTREAM_ORIGIN}${trimmed}`;
  }
  return `${LUFFY_UPSTREAM_ORIGIN}/${trimmed}`;
}

function rawTargetValid(url) {
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * Always routes video streams and subtitles through the Cloudflare media proxy
 */
export function buildProxiedMediaUrl(rawTargetUrl, customReferer = '') {
  if (!rawTargetValid(rawTargetUrl)) return '';
  const resolved = resolveUpstreamUrl(rawTargetUrl);

  // If already proxied by worker, return as is
  if (
    resolved.includes(`${CONFIG.API_BASE_URL}/api/v1/media-proxy`) ||
    resolved.includes('api.aniframe.workers.dev/api/v1/media-proxy')
  ) {
    return resolved;
  }

  const isRawIp = /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(resolved);
  const cleanUrl = isRawIp ? resolved.replace(/^https:\/\//i, 'http://') : resolved;

  const encUrl = encodeURIComponent(cleanUrl);
  let proxyUrl = `${CONFIG.API_BASE_URL}/api/v1/media-proxy?url=${encUrl}`;
  if (customReferer) {
    proxyUrl += `&referer=${encodeURIComponent(customReferer)}`;
  }
  if (window.API_SESSION_TOKEN) {
    proxyUrl += `&token=${encodeURIComponent(window.API_SESSION_TOKEN)}`;
  }
  return proxyUrl;
}

// -----------------------------------------------------------------------------
// 2. AniList Metadata Cache & Slug Generators
// -----------------------------------------------------------------------------
const titleCache = new Map();

export async function getAnimeTitle(anilistId) {
  const id = parseInt(anilistId, 10);
  if (!id || id <= 0) return 'Anime';

  if (titleCache.has(id)) {
    return titleCache.get(id);
  }

  // Probe Cloudflare Worker meta cache first, fallback to GraphQL
  const cfMetaUrl = `${CONFIG.API_BASE_URL}/api/v1/meta/title?id=${id}`;
  try {
    const cfRes = await fetch(cfMetaUrl, { headers: getAuthHeaders() });
    if (cfRes.ok) {
      const data = await cfRes.json();
      if (data?.title) {
        titleCache.set(id, data.title);
        return data.title;
      }
    }
  } catch {
    // Continue to direct GraphQL fallback
  }

  const query = `
    query ($id: Int) {
      Media (id: $id, type: ANIME) {
        title {
          english
          romaji
          userPreferred
        }
      }
    }
  `;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query, variables: { id } })
    });

    if (res.ok) {
      const json = await res.json();
      const titleObj = json?.data?.Media?.title;
      const title = titleObj?.english || titleObj?.romaji || titleObj?.userPreferred || 'Anime';
      titleCache.set(id, title);
      return title;
    }
  } catch (err) {
    console.warn('[ThirdPartyAPI/AniListTitle] Fallback title:', err.message);
  }

  return 'Anime';
}

export function slugifyTitle(title) {
  if (!title || typeof title !== 'string') return 'anime';
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getSlugCandidates(title, defaultSeason = 1) {
  const candidates = [];
  if (!title) return [{ slug: 'anime', season: defaultSeason }];

  let detectedSeason = parseInt(defaultSeason, 10) || 1;
  let baseTitle = title;

  const seasonMatch = title.match(/(?:season|s)\s*(\d+)/i) || title.match(/(\d+)(?:nd|rd|th|st)\s*season/i);
  if (seasonMatch) {
    detectedSeason = parseInt(seasonMatch[1], 10);
    baseTitle = title
      .replace(/(?:season|s)\s*\d+/gi, '')
      .replace(/\d+(?:nd|rd|th|st)\s*season/gi, '')
      .replace(/part\s*\d+/gi, '')
      .trim();
  }

  const baseSlug = slugifyTitle(baseTitle);
  const fullSlug = slugifyTitle(title);

  candidates.push({ slug: baseSlug, season: detectedSeason });
  if (fullSlug !== baseSlug) {
    candidates.push({ slug: fullSlug, season: 1 });
  }
  if (detectedSeason !== 1) {
    candidates.push({ slug: baseSlug, season: 1 });
  }

  return candidates;
}

// -----------------------------------------------------------------------------
// 3. Indian Anime Stream Engine (Cloudflare Gateway + AnimeSalt Multi-Audio)
// -----------------------------------------------------------------------------
export async function fetchIndianStreams({
  anilistId,
  episode = 1,
  season = 1,
  type = 'dub',
  title = ''
}) {
  const animeTitle = title && title !== 'Anime' ? title : await getAnimeTitle(anilistId);
  const cleanType = (type || 'dub').toLowerCase();
  const encTitle = encodeURIComponent(animeTitle);

  // All endpoints query your Cloudflare Worker Gateway
  const cfEndpoints = [
    // 1. Worker Luffy AnimeSalt Route (Multi-Audio: Hindi, Tamil, Telugu, Kannada, Eng, Jap)
    `${CONFIG.API_BASE_URL}/api/v1/luffy/animesalt?id=${anilistId}&ep=${episode}&title=${encTitle}`,
    // 2. Worker Indian Resolver Route
    `${CONFIG.API_BASE_URL}/api/v1/indian/stream?id=${anilistId}&season=${season}&ep=${episode}&type=${cleanType}&title=${encTitle}`,
    // 3. Worker Gateway Upstream Pass-Through Route for AnimeSalt
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/animesalt-servers/${anilistId}/${episode}?title=${encTitle}`)}`
  ];

  if (CONFIG.INDIAN_API_BASE) {
    cfEndpoints.push(
      `${CONFIG.INDIAN_API_BASE}/api/stream?anilistId=${anilistId}&episode=${episode}&season=${season}&type=${cleanType}&title=${encTitle}`
    );
  }

  const settled = await Promise.allSettled(
    cfEndpoints.map((epUrl) =>
      fetch(epUrl, { headers: getAuthHeaders() })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    )
  );

  const streams = [];
  const seenUrls = new Set();

  for (const item of settled) {
    if (item.status !== 'fulfilled' || !item.value) continue;
    const data = item.value;

    // A. Parse Luffy TV AnimeSalt Multi-Language Schema
    if (Array.isArray(data.servers)) {
      for (const srv of data.servers) {
        const rawUrl = srv.streamUrl || srv.url;
        if (!rawUrl) continue;
        const proxiedUrl = buildProxiedMediaUrl(rawUrl);
        if (seenUrls.has(proxiedUrl)) continue;
        seenUrls.add(proxiedUrl);

        const langRaw = (srv.provider || srv.source || srv.name || '').toLowerCase();
        let langCode = 'hi';
        let langLabel = '🇮🇳 Hindi Dub';

        if (langRaw.includes('hindi')) { langCode = 'hi'; langLabel = '🇮🇳 Hindi Dub'; }
        else if (langRaw.includes('tamil')) { langCode = 'ta'; langLabel = '🇮🇳 Tamil Dub'; }
        else if (langRaw.includes('telugu')) { langCode = 'te'; langLabel = '🇮🇳 Telugu Dub'; }
        else if (langRaw.includes('kannada')) { langCode = 'kn'; langLabel = '🇮🇳 Kannada Dub'; }
        else if (langRaw.includes('english')) { langCode = 'en'; langLabel = '🇬🇧 English Dub'; }
        else if (langRaw.includes('japanese') || srv.type === 'sub') { langCode = 'ja'; langLabel = '🇯🇵 Japanese'; }

        const isTargetMatch = cleanType === 'dub' ? (srv.type === 'dub' || langCode !== 'ja') : (srv.type === 'sub' || langCode === 'ja');
        const priorityScore = (langCode === 'hi') ? 1 : (langCode === 'en' ? 2 : (langCode === 'ja' ? 3 : 4));

        streams.push({
          id: `cf_luffy_animesalt_${langCode}_${srv.id || Math.random().toString(36).slice(2, 6)}`,
          addon: 'indian',
          provider: 'Luffy TV (AnimeSalt)',
          providerSource: srv.name || `AnimeSalt ${langLabel}`,
          releaseName: `${srv.name || 'AnimeSalt'} · ${langLabel}`,
          title: `${srv.name || 'AnimeSalt'} · ${langLabel}`,
          type: 'hls',
          isEmbed: false,
          isM3U8: true,
          delivery: 'direct',
          quality: srv.quality || '1080p',
          language: langCode,
          languages: [langCode],
          audioLanguage: langCode,
          size: { humanReadable: 'HLS CDN Stream' },
          url: proxiedUrl,
          originalUrl: rawUrl,
          format: 'm3u8',
          subtitles: [],
          intro: srv.intro || null,
          outro: srv.outro || null,
          priorityScore: isTargetMatch ? priorityScore : priorityScore + 10,
          behaviorHints: { notWebReady: false }
        });
      }
    }

    // B. Parse Standard Gateway Results
    if (data.byLanguage || data.results) {
      const parsedStandard = normalizeStandardIndianResponse(data, cleanType);
      parsedStandard.forEach((s) => {
        if (!seenUrls.has(s.url)) {
          seenUrls.add(s.url);
          streams.push(s);
        }
      });
    }
  }

  return streams.sort((a, b) => a.priorityScore - b.priorityScore);
}

function normalizeStandardIndianResponse(data, activeAudioType) {
  const normalized = [];
  const sources = [];

  if (data.byLanguage && typeof data.byLanguage === 'object') {
    Object.keys(data.byLanguage).forEach((k) => {
      const grp = data.byLanguage[k];
      if (Array.isArray(grp.sources)) {
        grp.sources.forEach((s) => sources.push({ ...s, langCode: k }));
      }
    });
  } else if (Array.isArray(data.results)) {
    data.results.forEach((r) => sources.push(r));
  }

  sources.forEach((item, idx) => {
    const rawUrl = item.hlsProxyUrl || item.url || item.embed;
    if (!rawUrl) return;

    const isEmbed = item.type === 'embed' || Boolean(item.embed);
    const playUrl = isEmbed ? rawUrl : buildProxiedMediaUrl(rawUrl);
    const audioCode = (item.langCode || item.audioLanguage || 'hi').toLowerCase();

    normalized.push({
      id: `cf_indian_${audioCode}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      addon: 'indian',
      provider: item.server || 'Indian Stream',
      providerSource: item.server || 'Indian Stream',
      releaseName: `${item.server || 'Indian'} · ${audioCode.toUpperCase()}`,
      title: `${item.server || 'Indian'} · ${audioCode.toUpperCase()}`,
      type: isEmbed ? 'embed' : 'hls',
      isEmbed,
      isM3U8: !isEmbed,
      delivery: isEmbed ? 'iframe_embed' : 'direct',
      quality: item.quality || '720p',
      language: audioCode,
      languages: [audioCode],
      audioLanguage: audioCode,
      size: { humanReadable: isEmbed ? 'Embed Link' : 'HLS Stream' },
      url: playUrl,
      originalUrl: rawUrl,
      format: isEmbed ? 'embed' : 'm3u8',
      subtitles: [],
      priorityScore: audioCode === 'hi' ? 1 : 5
    });
  });

  return normalized;
}

// -----------------------------------------------------------------------------
// 4. Luffy TV Stream Engine (Routed Exclusively Through Cloudflare Worker)
// -----------------------------------------------------------------------------
export async function fetchLuffyStreams({ anilistId, episode = 1, type = 'sub', title = '' }) {
  const cleanType = (type || 'sub').toLowerCase();
  const animeTitle = title && title !== 'Anime' ? title : await getAnimeTitle(anilistId);
  const encTitle = encodeURIComponent(animeTitle);

  // Cloudflare API endpoints proxying Luffy TV subservers
  const cfLuffyEndpoints = [
    // Consolidated Worker resolver for Luffy
    `${CONFIG.API_BASE_URL}/api/v1/luffy/servers?id=${anilistId}&ep=${episode}&type=${cleanType}&title=${encTitle}`,
    `${CONFIG.API_BASE_URL}/api/v1/luffy/watch?id=${anilistId}&episode=${episode}&translation=${cleanType}`,

    // Gateway pass-through queries to individual Luffy subservers
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/anikoto-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/anv-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/kototv-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/anipm-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/shonen-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/aniwaves-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/kaa-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/anineko-to-servers/${anilistId}/${episode}?title=${encTitle}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/anibd-servers/${anilistId}/${episode}`)}`,
    `${CONFIG.API_BASE_URL}/api/v1/proxy?url=${encodeURIComponent(`${LUFFY_UPSTREAM_ORIGIN}/api/anime/xanime-servers/${anilistId}/${episode}`)}`
  ];

  const settled = await Promise.allSettled(
    cfLuffyEndpoints.map((url) =>
      fetch(url, { headers: getAuthHeaders() })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    )
  );

  const streams = [];
  const seenUrls = new Set();

  for (const item of settled) {
    if (item.status !== 'fulfilled' || !item.value) continue;
    const payload = item.value;

    const rawList = Array.isArray(payload.servers)
      ? payload.servers
      : Array.isArray(payload.sources)
      ? payload.sources
      : payload.streamUrl ? [payload] : [];

    for (const srv of rawList) {
      const normalized = normalizeLuffyServerItem(srv, cleanType);
      if (normalized && !seenUrls.has(normalized.url)) {
        seenUrls.add(normalized.url);
        streams.push(normalized);
      }
    }
  }

  return streams.sort((a, b) => a.priorityScore - b.priorityScore);
}

function normalizeLuffyServerItem(srv, targetAudioType) {
  if (!srv) return null;
  const rawStreamUrl = srv.streamUrl || srv.url || srv.embed || '';
  if (!rawStreamUrl) return null;

  const isEmbed = Boolean(srv.isEmbed) || rawStreamUrl.includes('/embed') || rawStreamUrl.includes('/e/');
  const isM3U8 = Boolean(srv.isM3U8) || rawStreamUrl.includes('.m3u8') || rawStreamUrl.includes('/p/');
  const isMP4 = Boolean(srv.isMP4);

  // Proxies stream URL through the Cloudflare Worker media-proxy
  const playUrl = isEmbed ? resolveUpstreamUrl(rawStreamUrl) : buildProxiedMediaUrl(rawStreamUrl);

  const serverName = srv.name || srv.source || srv.provider || 'Luffy Server';
  const providerTag = (srv.provider || srv.source || 'luffytv').toUpperCase();
  const srvType = (srv.type || targetAudioType || 'sub').toLowerCase();

  // Normalize Subtitles via Cloudflare Media Proxy
  const rawSubs = Array.isArray(srv.subtitleTracks) ? srv.subtitleTracks : Array.isArray(srv.tracks) ? srv.tracks : [];
  const subtitles = rawSubs
    .filter((sub) => {
      const u = sub.url || sub.file || '';
      return (
        u &&
        sub.kind !== 'thumbnails' &&
        !u.includes('thumbnails.vtt') &&
        !u.includes('/preview/')
      );
    })
    .map((sub, sIdx) => ({
      url: buildProxiedMediaUrl(sub.url || sub.file),
      label: sub.label || `Subtitle ${sIdx + 1}`,
      lang: sub.lang || 'en',
      default: Boolean(sub.default) || sub.lang === 'en' || sIdx === 0
    }));

  const isExactType = srvType === targetAudioType;
  let priorityScore = srv.priority ? Math.round(srv.priority * 10) : 5;
  if (!isExactType) priorityScore += 10;

  return {
    id: `cf_luffy_${srv.id || Math.random().toString(36).slice(2, 7)}`,
    addon: 'luffy',
    provider: 'Luffy TV',
    providerSource: `${serverName} [${providerTag}]`,
    releaseName: `${serverName} - ${srvType.toUpperCase()}`,
    title: `${serverName} - ${srvType.toUpperCase()}`,
    type: isEmbed ? 'embed' : (isMP4 ? 'mp4' : 'hls'),
    isEmbed,
    isM3U8,
    delivery: isEmbed ? 'iframe_embed' : 'direct',
    quality: srv.quality || '1080p',
    language: srvType,
    languages: [srvType],
    audioLanguage: srvType,
    size: { humanReadable: isEmbed ? 'Iframe Player' : (isM3U8 ? 'HLS Stream' : 'Direct MP4') },
    url: playUrl,
    originalUrl: rawStreamUrl,
    embed: isEmbed ? playUrl : null,
    format: isEmbed ? 'embed' : (isMP4 ? 'mp4' : 'm3u8'),
    subtitles,
    hardsub: Boolean(srv.hardsub),
    intro: srv.intro || null,
    outro: srv.outro || null,
    priorityScore,
    behaviorHints: { notWebReady: false }
  };
}

// Backward-Compatibility Alias
export const fetchAnikotoStreams = fetchLuffyStreams;

// -----------------------------------------------------------------------------
// 5. Aniraku Stream Engine (Worker Gateway)
// -----------------------------------------------------------------------------
export async function fetchAnirakuStreams({ anilistId, episode = 1, type = 'sub' }) {
  const cleanType = (type || 'sub').toLowerCase();
  const workerProxyUrl = `${CONFIG.API_BASE_URL}/api/v1/aniraku/servers?animeId=${anilistId}&episode=${episode}`;

  let rawList = null;
  try {
    const res = await fetch(workerProxyUrl, { headers: getAuthHeaders() });
    if (res.ok) {
      rawList = await res.json();
    }
  } catch (err) {
    console.warn('[Aniraku/FetchError] Proxy request failed:', err.message);
    return [];
  }

  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  const normalized = [];
  const filtered = rawList.filter((srv) => (srv.lang ? srv.lang.toLowerCase() === cleanType : true));
  const listToProcess = filtered.length > 0 ? filtered : rawList;

  for (let i = 0; i < listToProcess.length; i++) {
    const srv = listToProcess[i];
    const serverName = srv.name || `Server ${i + 1}`;
    const providerName = (srv.provider || 'aniraku').toUpperCase();
    const audio = (srv.lang || cleanType).toLowerCase();
    const sources = Array.isArray(srv.sources) ? srv.sources : [];

    for (let j = 0; j < sources.length; j++) {
      const src = sources[j];
      const rawStreamUrl = (src.url || '').trim();
      if (!rawStreamUrl) continue;

      const isEmbed = src.type === 'embed' || rawStreamUrl.includes('/embed') || rawStreamUrl.includes('/e/');
      const playableUrl = isEmbed ? rawStreamUrl : buildProxiedMediaUrl(rawStreamUrl, srv.headers?.Referer || '');

      normalized.push({
        id: `cf_aniraku_${i}_${j}_${Math.random().toString(36).slice(2, 6)}`,
        addon: 'aniraku',
        provider: 'Aniraku',
        providerSource: `${serverName} [${providerName}]`,
        releaseName: `${serverName} (${providerName}) - ${audio.toUpperCase()}`,
        title: `${serverName} (${providerName}) - ${audio.toUpperCase()}`,
        type: isEmbed ? 'embed' : 'hls',
        isEmbed,
        delivery: isEmbed ? 'iframe_embed' : 'direct',
        quality: src.quality || '1080P HD',
        language: audio,
        languages: [audio],
        size: { humanReadable: isEmbed ? 'Cloud Embed' : 'HLS Stream' },
        url: playableUrl,
        originalUrl: rawStreamUrl,
        format: isEmbed ? 'embed' : 'm3u8',
        subtitles: [],
        serverHeaders: srv.headers || {}
      });
    }
  }

  return normalized;
}

// -----------------------------------------------------------------------------
// 6. Kuromi Extraction Engine (Updated with Luffy TV)
// -----------------------------------------------------------------------------
export const KUROMI_PROVIDERS = [
  { id: 'anibd', name: 'AniBD' },
  { id: 'luffy', name: 'Luffy TV' },
  { id: 'animegg', name: 'Animegg' },
  { id: 'animeonsen', name: 'AnimeOnsen' },
  { id: 'anineko', name: 'Anineko' },
  { id: 'aniwaves', name: 'Aniwaves' }
];

async function fetchProviderStream(anilistId, episode, type, providerId, title) {
  if (providerId === 'luffy') {
    return fetchLuffyStreams({ anilistId, episode, type, title });
  }

  const cleanTitle = encodeURIComponent(title || 'Anime');
  const params = `e=${episode}&type=${type}&provider=${providerId}&title=${cleanTitle}`;

  const endpoints = [
    `${CONFIG.API_BASE_URL}/api/v1/kuromi/extract/${anilistId}?${params}`,
    `${DIRECT_KUROMI_WORKER_BASE}/api/v1/extract/${anilistId}?${params}`
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { headers: getAuthHeaders() });
      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      if (data && (data.success || Array.isArray(data.streams) || Array.isArray(data.sources))) {
        const parsed = extractKuromiStreams(data, providerId, type);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // Continue next candidate
    }
  }

  return [];
}

function extractKuromiStreams(data, providerId, fallbackType) {
  const streams = [];
  const rawList = Array.isArray(data.streams)
    ? data.streams
    : Array.isArray(data.sources)
    ? data.sources
    : [];

  const providerMeta = KUROMI_PROVIDERS.find((p) => p.id === providerId);
  const providerName = providerMeta?.name || data.provider || providerId.toUpperCase();

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item) continue;

    const serverName = (item.server || '').trim();
    let streamUrl = (item.embed || item.url || '').trim();
    if (!streamUrl || !streamUrl.startsWith('http')) continue;

    const isHls = item.type === 'hls' || item.format === 'm3u8' || streamUrl.includes('.m3u8');
    const isEmbed = !isHls && (item.type === 'embed' || streamUrl.includes('/embed') || streamUrl.includes('/e/'));
    const audio = (item.audio || data.type || fallbackType || 'sub').toLowerCase();
    const cleanServer = serverName || `Server ${i + 1}`;

    const playableUrl = isEmbed ? streamUrl : buildProxiedMediaUrl(streamUrl);

    streams.push({
      id: `cf_kuromi_${providerId}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      addon: 'kuromi',
      provider: providerName,
      providerSource: `${cleanServer} [${providerName}]`,
      releaseName: `${cleanServer} - ${audio.toUpperCase()} (${providerName})`,
      title: `${cleanServer} - ${audio.toUpperCase()} (${providerName})`,
      type: isEmbed ? 'embed' : 'hls',
      isEmbed,
      delivery: isEmbed ? 'iframe_embed' : 'direct',
      quality: item.quality || '1080P HD',
      language: audio,
      languages: [audio],
      size: { humanReadable: isEmbed ? 'Embed Link' : 'HLS Stream' },
      url: playableUrl,
      originalUrl: streamUrl,
      embed: isEmbed ? streamUrl : null,
      subtitles: [],
      format: isEmbed ? 'embed' : 'm3u8'
    });
  }

  return streams;
}

export async function fetchKuromiFlixcloudStreams({
  anilistId,
  episode = 1,
  type = 'sub',
  provider = 'all',
  title = ''
}) {
  const animeTitle = title || (await getAnimeTitle(anilistId));
  const providersToProbe = provider === 'all' ? KUROMI_PROVIDERS.map((p) => p.id) : [provider];

  const results = await Promise.allSettled(
    providersToProbe.map((pId) => fetchProviderStream(anilistId, episode, type, pId, animeTitle))
  );

  const streams = [];
  const seenUrls = new Set();

  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      for (const stream of res.value) {
        if (stream.url && !seenUrls.has(stream.url)) {
          seenUrls.add(stream.url);
          streams.push(stream);
        }
      }
    }
  }

  return streams;
}
