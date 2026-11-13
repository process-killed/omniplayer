/**
 * =============================================================================
 * AnimeEdge / AniFrame App Orchestrator — v48.1 (Luffy TV Production Edition)
 * =============================================================================
 * - Self-contained URL resolvers & proxy detectors (Fixes SyntaxError import bug)
 * - Strict One-by-One Client-Side Stream Verifier
 * - Luffy TV Multi-Subserver Core + AnimeSalt Indian Multi-Audio Engine
 * - Cloudflare Gateway Session Recovery & Non-Blocking Token Handlers
 * - Universal Aspect-Ratio Drawer & Responsive Floating Action HUD
 * - Legacy Purged: Completely removed hindi-anime.com & standalone anikoto
 * =============================================================================
 */

import { CONFIG, SERVERS } from '/providers.js';

import {
  fetchIndianStreams,
  fetchAnirakuStreams,
  fetchLuffyStreams,
  fetchAnikotoStreams,
  fetchKuromiFlixcloudStreams,
  getAnimeTitle
} from '/thirdpartyapi.js';

import {
  fetchAdvancedAnimeDetails,
  buildProxiedUrl,
  showPlayerToast
} from '/script.js';

import { Player } from '/player/player.js';
import { Comments } from '/comments/comments.js';
import { Downloader } from '/download/download.js';

if (!Array.isArray(SERVERS) || !SERVERS.length) {
  throw new Error('[AnimeEdge] SERVERS configuration is missing.');
}

const APP_VERSION = '50.0';
const LUFFY_ORIGIN = 'https://luffytv.live';

const LANGUAGES = [
  { id: '', label: 'All Audio', icon: '🌐' },
  { id: 'hindi', label: 'Hindi Dub', icon: '🇮🇳' },
  { id: 'english', label: 'English Dub', icon: '🇬🇧' },
  { id: 'japanese', label: 'Japanese Sub', icon: '🇯🇵' },
  { id: 'dual-audio', label: 'Dual Audio', icon: '🎧' },
  { id: 'telugu', label: 'Telugu', icon: '🇮🇳' },
  { id: 'tamil', label: 'Tamil', icon: '🇮🇳' },
  { id: 'kannada', label: 'Kannada', icon: '🇮🇳' },
  { id: 'malayalam', label: 'Malayalam', icon: '🇮🇳' }
];

const TRUSTED_EMBED_DOMAINS = Object.freeze([
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
  'flixcloud.com',
  'luffytv.live'
]);

const SESSION_KEY = 'animeedge_session_token';
const SESSION_EXP_KEY = 'animeedge_session_exp';
const SESSION_TTL = 3.5 * 60 * 60 * 1000;
const SINGLE_LINK_TIMEOUT_MS = 5500;

const PROGRESS_STAGES = [
  ['request', 'Request received', 'Preparing episode request…'],
  ['connect', 'Connecting to server', 'Contacting the provider…'],
  ['resolve', 'Resolving streams', 'Waiting for source links…'],
  ['verify', 'Verifying sources (1 by 1)', 'Testing each link on your device…'],
  ['prepare', 'Preparing player', 'Preparing verified sources…']
];

const $ = (id) => document.getElementById(id);
const q = (selector, root = document) => root.querySelector(selector);

const text = (el, value) => {
  if (el) el.textContent = String(value ?? '');
};

const safeName = (value, max = 100) =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

// -----------------------------------------------------------------------------
// Local Safe URL & Proxy Detectors
// -----------------------------------------------------------------------------

function safeParseUrl(val, base) {
  try {
    return new URL(val, base);
  } catch {
    return null;
  }
}

function resolveLuffyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `${LUFFY_ORIGIN}${trimmed}`;
  }
  return `${LUFFY_ORIGIN}/${trimmed}`;
}

function isProxyEndpoint(urlStr) {
  const u = safeParseUrl(urlStr);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  return (
    path.includes('/api/v1/media-proxy') ||
    path.includes('/api/v1/proxy') ||
    path.includes('/hls-proxy') ||
    host === 'api.aniraku.tech' ||
    host.includes('workers.dev') ||
    host === 'luffytv.live'
  );
}

const sessionStore = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      sessionStorage.setItem(key, String(value));
    } catch {}
  },

  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }
};

function withTimeout(promise, ms, message = 'The request timed out.') {
  let timer;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

const defaultServer =
  SERVERS.find((server) => server.id === 'server_2') ||
  SERVERS[1] ||
  SERVERS[0];

const state = {
  activeServer: defaultServer,
  previewServer: defaultServer,
  activeSubServer:
    defaultServer?.subServers?.[0] ||
    SERVERS[0]?.subServers?.[0] ||
    null,

  anilistId: 113415,
  idMal: null,
  episode: 1,
  season: 1,

  torrentioLanguage: '',
  thirdpartyAudioType: 'dub',
  kuromiProvider: 'all',
  luffyServer: '',
  anikotoServer: '',

  animeTitle: 'Anime',
  posterUrl: '',
  animeDetails: null,
  metadataPromise: null,

  sources: [],
  currentStream: null,

  isFetching: false,
  requestId: 0,
  requestKey: '',
  requestController: null,
  usedTokenInLastFetch: false,

  appInitialized: false,
  hudInitialized: false,
  hudLocked: false,
  hudTimer: null,

  pendingDrawerAfterFetch: null
};

const dom = {};

const IDS = {
  container: 'embedContainer',
  heroBackdrop: 'heroBackdrop',
  playerTopBar: 'playerTopBar',
  mediaTitle: 'mediaTitle',
  epBadge: 'epBadge',
  epIndicator: 'epIndicator',

  btnToggleMediaHub: 'btnToggleMediaHub',
  hubEpLabel: 'hubEpLabel',
  btnPrevEp: 'btnPrevEp',
  btnNextEp: 'btnNextEp',
  btnToggleInfo: 'btnToggleInfo',
  btnToggleEpisodes: 'btnToggleEpisodes',

  btnToggleServerHub: 'btnToggleServerHub',
  serverHubSummary: 'serverHubSummary',
  btnToggleServers: 'btnToggleServers',
  currentServerLabel: 'currentServerLabel',

  torrentioLangContainer: 'torrentioLangContainer',
  torrentioLangSelect: 'torrentioLangSelect',
  kuromiAudioToggle: 'kuromiAudioToggle',

  btnSub: 'btnSub',
  btnDub: 'btnDub',
  drawerBtnSub: 'drawerBtnSub',
  drawerBtnDub: 'drawerBtnDub',

  drawerKuromiSection: 'drawerKuromiSection',
  kuromiProviderSelect: 'kuromiProviderSelect',
  btnToggleSources: 'btnToggleSources',
  sourceCountBadge: 'sourceCountBadge',

  btnToggleComments: 'btnToggleComments',
  btnMobileComments: 'btnMobileComments',
  commentsDrawer: 'commentsDrawer',
  btnCloseComments: 'btnCloseComments',
  commentsStageContainer: 'commentsStageContainer',

  btnDownloadStream: 'btnDownloadStream',
  btnMobileDownload: 'btnMobileDownload',

  playerSplash: 'playerSplash',
  splashBackdrop: 'splashBackdrop',
  splashPosterImg: 'splashPosterImg',
  splashTitle: 'splashTitle',
  splashScore: 'splashScore',
  splashScoreVal: 'splashScoreVal',
  splashEpIndicator: 'splashEpIndicator',
  splashFormat: 'splashFormat',
  splashYear: 'splashYear',
  splashTotalEp: 'splashTotalEp',
  splashGenres: 'splashGenres',
  splashSynopsis: 'splashSynopsis',
  splashPlayBtn: 'btnSplashPlay',
  splashSpinner: 'splashSpinner',
  splashStatus: 'splashStatus',

  playerError: 'playerError',
  errTitle: 'errTitle',
  errDesc: 'errDesc',
  btnRetry: 'btnRetry',

  serversDrawer: 'serversDrawer',
  btnCloseServers: 'btnCloseServers',
  clusterTabs: 'clusterTabs',
  addonsHeader: 'addonsHeader',
  addonsGrid: 'addonsGrid',
  drawerLangSection: 'drawerLangSection',
  langChipsGrid: 'langChipsGrid',

  sourcesDrawer: 'sourcesDrawer',
  btnCloseSources: 'btnCloseSources',
  torrentAlert: 'torrentAlert',
  sourcesList: 'sourcesList',

  episodesDrawer: 'episodesDrawer',
  btnCloseEpisodes: 'btnCloseEpisodes',
  episodesGridContainer: 'episodesGridContainer',

  infoDrawer: 'infoDrawer',
  btnCloseInfo: 'btnCloseInfo',
  metaPoster: 'metaPoster',
  metaTitleHeader: 'metaTitleHeader',
  metaScore: 'metaScore',
  metaGenres: 'metaGenres',
  metaSynopsis: 'metaSynopsis'
};

function initDom() {
  for (const [key, id] of Object.entries(IDS)) {
    dom[key] = $(id);
  }
}

// =============================================================================
// 1. Layering & Mobile HUD Safeguards
// =============================================================================

function injectStyles() {
  if ($('animeedge-layering-fix')) return;

  const style = document.createElement('style');
  style.id = 'animeedge-layering-fix';

  style.textContent = `
    .player-topbar {
      z-index: 10000 !important;
      pointer-events: auto !important;
      transition: transform .25s ease, opacity .25s ease !important;
    }

    .player-topbar * {
      pointer-events: auto !important;
    }

    .player-topbar.hidden {
      transform: translateY(-115%) !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    .glass-drawer:not(.open) {
      right: -460px !important;
      transform: translateX(105%) !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    .glass-drawer.open {
      right: 0 !important;
      transform: translateX(0) !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      z-index: 20005 !important;
    }

    .glass-drawer.open * {
      pointer-events: auto !important;
    }

    .drawer-close {
      cursor: pointer !important;
      pointer-events: auto !important;
      z-index: 20010 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    /* Suppress obsolete full-screen radar spinner overlays */
    #playerLoading,
    .overlay-screen.active,
    .loading-spinner,
    .splash-spinner,
    #splashSpinner {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    @media (max-width: 768px) {
      .glass-drawer.comments-drawer:not(.open) {
        right: 0 !important;
        bottom: -100% !important;
        transform: translateY(105%) !important;
      }

      .glass-drawer.comments-drawer.open {
        right: 0 !important;
        bottom: 0 !important;
        transform: translateY(0) !important;
      }

      .mobile-touch-actions.ae-mobile-actions-row {
        display: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function placeMobileActions() {
  const actions = document.querySelector('.mobile-touch-actions');
  const stage = document.querySelector('.player-stage');

  if (!actions || !stage) return;

  if (stage.contains(actions)) {
    stage.insertAdjacentElement('afterend', actions);
  }

  actions.classList.add('ae-mobile-actions-row');
  actions.setAttribute('role', actions.getAttribute('role') || 'group');
  actions.setAttribute(
    'aria-label',
    actions.getAttribute('aria-label') || 'Player actions'
  );
}

// =============================================================================
// 2. Session Token (Turnstile Auto-Recovery)
// =============================================================================

let sessionResolver = null;
let sessionExchangePromise = null;

let sessionPromise = new Promise((resolve) => {
  sessionResolver = resolve;
});

const cachedToken = sessionStore.get(SESSION_KEY);
const cachedExpiry = Number(sessionStore.get(SESSION_EXP_KEY) || 0);

if (cachedToken && cachedExpiry > Date.now()) {
  window.API_SESSION_TOKEN = cachedToken;
  sessionResolver?.(cachedToken);
  sessionResolver = null;
} else {
  sessionStore.remove(SESSION_KEY);
  sessionStore.remove(SESSION_EXP_KEY);
}

async function exchangeTurnstileToken(token) {
  if (!token) return null;
  if (sessionExchangePromise) return sessionExchangePromise;

  sessionExchangePromise = (async () => {
    try {
      const response = await withTimeout(
        fetch(`${CONFIG.API_BASE_URL}/api/v1/auth/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ turnstileToken: token })
        }),
        8000,
        'Session verification timed out.'
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success || !data?.token) {
        throw new Error(
          data?.error?.message ||
          `Session exchange failed (${response.status}).`
        );
      }

      window.API_SESSION_TOKEN = data.token;
      sessionStore.set(SESSION_KEY, data.token);
      sessionStore.set(SESSION_EXP_KEY, Date.now() + SESSION_TTL);

      sessionResolver?.(data.token);
      sessionResolver = null;

      if (
        state.appInitialized &&
        state.sources.length === 0 &&
        (!state.isFetching || !state.usedTokenInLastFetch)
      ) {
        state.requestKey = '';
        void loadStreams();
      }

      return data.token;
    } catch (error) {
      console.warn(
        '[AnimeEdge] Session exchange:',
        error?.message || error
      );

      sessionResolver?.(null);
      sessionResolver = null;

      return null;
    } finally {
      sessionExchangePromise = null;
    }
  })();

  return sessionExchangePromise;
}

if (window.__turnstileToken) {
  void exchangeTurnstileToken(window.__turnstileToken);
} else if (Array.isArray(window.__turnstileHandlers)) {
  window.__turnstileHandlers.push(exchangeTurnstileToken);
}

async function waitForSessionToken(timeoutMs = 3500) {
  if (window.API_SESSION_TOKEN) return window.API_SESSION_TOKEN;

  let timer;

  try {
    const token = await Promise.race([
      sessionPromise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
    return token || window.API_SESSION_TOKEN || null;
  } finally {
    clearTimeout(timer);
  }
}

function resetTurnstileWidget() {
  window.API_SESSION_TOKEN = null;
  sessionStore.remove(SESSION_KEY);
  sessionStore.remove(SESSION_EXP_KEY);

  sessionPromise = new Promise((resolve) => {
    sessionResolver = resolve;
  });

  try {
    window.turnstile?.reset?.();
  } catch (error) {
    console.warn(
      '[AnimeEdge] Turnstile reset:',
      error?.message || error
    );
  }
}

// =============================================================================
// 3. Routes, Drawers and HUD Controls
// =============================================================================

function parseRoute() {
  const url = new URL(location.href);
  const params = url.searchParams;

  const id = Number.parseInt(
    params.get('id') || params.get('anilistId') || '',
    10
  );

  const ep = Number.parseInt(
    params.get('ep') || params.get('episode') || '',
    10
  );

  const season = Number.parseInt(
    params.get('season') || params.get('s') || '',
    10
  );

  if (id > 0) state.anilistId = id;
  if (ep > 0) state.episode = ep;
  if (season > 0) state.season = season;

  state.torrentioLanguage =
    (params.get('lang') || params.get('language') || '')
      .trim()
      .toLowerCase();

  const type = params.get('type');

  if (type === 'sub' || type === 'dub') {
    state.thirdpartyAudioType = type;
  }

  const serverId = (params.get('server') || '').toLowerCase();

  const server = SERVERS.find(
    (item) => item.id === serverId && item.isAvailable
  );

  if (server) {
    state.activeServer = state.previewServer = server;
    state.activeSubServer = server.subServers?.[0] || null;
  }

  const addonId = (params.get('addon') || '').toLowerCase();

  if (addonId) {
    for (const item of SERVERS) {
      const sub = item.subServers?.find(
        (provider) => provider.id === addonId
      );

      if (sub) {
        state.activeServer = state.previewServer = item;
        state.activeSubServer = sub;
        break;
      }
    }
  }

  const parts = location.pathname.split('/').filter(Boolean);

  if (parts[0] && /^\d+$/.test(parts[0])) {
    state.anilistId = Number(parts[0]);
  }

  if (parts[1] && /^\d+$/.test(parts[1])) {
    state.episode = Number(parts[1]);
  }

  syncAudioButtons();
  updateServerLabel();
}

const DRAWERS = [
  'serversDrawer',
  'sourcesDrawer',
  'episodesDrawer',
  'infoDrawer',
  'commentsDrawer'
];

function allDrawers() {
  return DRAWERS.map((id) => dom[id]).filter(Boolean);
}

function activeDrawer() {
  return allDrawers().find(
    (drawer) => drawer.classList.contains('open')
  ) || null;
}

function anyDrawerOpen() {
  return Boolean(activeDrawer());
}

function syncDrawerControls() {
  const pairs = [
    [dom.btnToggleServerHub, dom.serversDrawer],
    [dom.btnToggleServers, dom.serversDrawer],
    [dom.btnToggleSources, dom.sourcesDrawer],
    [dom.btnToggleMediaHub, dom.episodesDrawer],
    [dom.btnToggleEpisodes, dom.episodesDrawer],
    [dom.btnToggleInfo, dom.infoDrawer],
    [dom.btnToggleComments, dom.commentsDrawer],
    [dom.btnMobileComments, dom.commentsDrawer]
  ];

  for (const [button, drawer] of pairs) {
    if (button && drawer) {
      button.setAttribute(
        'aria-expanded',
        String(drawer.classList.contains('open'))
      );
    }
  }
}

function closeDrawers(except = null, manual = false) {
  if (manual || !except) {
    state.pendingDrawerAfterFetch = null;
  }

  for (const drawer of allDrawers()) {
    const open = drawer === except;

    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
  }

  clearTimeout(state.hudTimer);
  state.hudTimer = null;

  dom.playerTopBar?.classList.remove('hidden');
  dom.playerTopBar?.removeAttribute('aria-hidden');

  syncDrawerControls();

  if (!except) showHUD();
}

function toggleDrawer(drawer) {
  if (!drawer) return;

  closeDrawers(
    drawer.classList.contains('open') ? null : drawer,
    true
  );
}

function initDrawers() {
  allDrawers().forEach((drawer) => {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  });

  syncDrawerControls();
}

function isEditable(target) {
  return target instanceof Element &&
    Boolean(target.closest(
      'input,textarea,select,[contenteditable="true"],[role="textbox"]'
    ));
}

function touchMode() {
  return navigator.maxTouchPoints > 0 ||
    Boolean(window.matchMedia?.('(pointer: coarse)').matches);
}

function isPlaying() {
  if (document.hidden || !dom.playerSplash?.classList.contains('hidden')) {
    return false;
  }

  return Array.from(document.querySelectorAll('video')).some(
    (video) =>
      !video.paused &&
      !video.ended &&
      video.readyState >= 2
  );
}

function showHUD(ms = 8000) {
  const bar = dom.playerTopBar;

  if (!bar) return;

  clearTimeout(state.hudTimer);
  state.hudTimer = null;

  bar.classList.remove('hidden');
  bar.removeAttribute('aria-hidden');

  if (
    touchMode() ||
    !isPlaying() ||
    anyDrawerOpen() ||
    state.hudLocked ||
    document.hidden
  ) {
    return;
  }

  state.hudTimer = setTimeout(() => {
    if (
      isPlaying() &&
      !anyDrawerOpen() &&
      !state.hudLocked
    ) {
      bar.classList.add('hidden');
    }
  }, ms);
}

function initHUD() {
  if (state.hudInitialized) return;
  state.hudInitialized = true;

  const bar = dom.playerTopBar;

  if (!bar) return;

  bar.classList.remove('hidden');

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' && event.clientY < 100) {
      showHUD();
    }
  }, { passive: true });

  document.addEventListener('keydown', (event) => {
    if (!isEditable(event.target)) showHUD();
  }, { passive: true });

  window.addEventListener('touchstart', () => showHUD(), {
    passive: true
  });

  document.querySelector('.player-stage')?.addEventListener('click', (event) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest(
        'button,input,select,textarea,a,[role="button"],' +
        '.art-control,.art-layer,.glass-drawer,.player-topbar,' +
        '.mobile-touch-actions,#aeStreamProgress,#aeInlineStreamProgress'
      )
    ) {
      return;
    }

    if (touchMode() || anyDrawerOpen() || !isPlaying()) {
      showHUD();
      return;
    }

    if (bar.classList.contains('hidden')) {
      showHUD();
    } else {
      clearTimeout(state.hudTimer);
      state.hudTimer = null;
      bar.classList.add('hidden');
    }
  });

  bar.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;

    state.hudLocked = true;
    clearTimeout(state.hudTimer);
    bar.classList.remove('hidden');
  });

  bar.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;

    state.hudLocked = false;
    showHUD();
  });

  document.addEventListener('visibilitychange', () => {
    clearTimeout(state.hudTimer);
    state.hudTimer = null;

    if (!document.hidden) showHUD();
  });

  showHUD();
}

// =============================================================================
// 4. Metadata and Episode Lists
// =============================================================================

function updateHeader() {
  text(
    dom.mediaTitle,
    state.animeTitle && state.animeTitle !== 'Anime'
      ? `${state.animeTitle} (#${state.anilistId})`
      : `AniList #${state.anilistId}`
  );

  text(dom.epBadge, `EP ${state.episode}`);
  text(dom.epIndicator, state.episode);
  text(dom.hubEpLabel, `EP ${state.episode} • Details`);

  document.title =
    `Watch ${state.animeTitle} - EP ${state.episode} | AniFrame`;
}

function renderChips(container, values, className) {
  if (!container) return;

  container.replaceChildren();

  for (const value of values) {
    const chip = document.createElement('span');
    chip.className = className;
    chip.textContent = value;
    container.appendChild(chip);
  }
}

function updateSplash(details = null, poster = '', backdrop = '') {
  text(dom.splashTitle, state.animeTitle);

  if (dom.splashBackdrop && backdrop) {
    dom.splashBackdrop.style.backgroundImage =
      `url(${JSON.stringify(backdrop)})`;
  }

  if (dom.splashPosterImg && poster) {
    dom.splashPosterImg.src = poster;
  }

  text(dom.splashEpIndicator, `EP ${state.episode}`);

  if (dom.splashScore && dom.splashScoreVal) {
    dom.splashScore.style.display =
      details?.averageScore ? 'inline-flex' : 'none';

    text(
      dom.splashScoreVal,
      details?.averageScore ? `${details.averageScore}%` : '--'
    );
  }

  if (!details) return;

  text(
    dom.splashFormat,
    (details.format || 'TV Series').replaceAll('_', ' ')
  );

  text(
    dom.splashYear,
    details.seasonYear || details.startDate?.year || '—'
  );

  text(
    dom.splashTotalEp,
    details.episodes ? `${details.episodes} Episodes` : '-- Episodes'
  );

  renderChips(
    dom.splashGenres,
    (details.genres || []).slice(0, 4),
    'genre-tag'
  );

  text(
    dom.splashSynopsis,
    details.description?.replace(/<[^>]*>/g, '').trim() ||
      'No description available.'
  );
}

function renderEpisodeGrid(details) {
  if (!dom.episodesGridContainer) return;

  const total = Math.min(
    1000,
    Number(details.episodes) || Math.max(state.episode, 12)
  );

  const episodes = Array.isArray(details.streamingEpisodes)
    ? details.streamingEpisodes
    : [];

  const fragment = document.createDocumentFragment();

  for (let number = 1; number <= total; number++) {
    const meta = episodes[number - 1];

    const card = document.createElement('div');
    card.className =
      `ep-card${number === state.episode ? ' active' : ''}`;
    card.dataset.ep = String(number);

    const wrapper = document.createElement('div');
    wrapper.className = 'ep-thumb-wrapper';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = `Episode ${number}`;
    img.src =
      meta?.thumbnail ||
      state.animeDetails?.coverImage?.large ||
      '';

    const badge = document.createElement('span');
    badge.className = 'ep-num-pill';
    badge.textContent = `EP ${number}`;

    wrapper.append(img, badge);

    const title = document.createElement('div');
    title.className = 'ep-card-title';
    title.textContent =
      meta?.title?.replace(/^Episode \d+ - /i, '') ||
      `Episode ${number}`;

    card.append(wrapper, title);
    fragment.appendChild(card);
  }

  dom.episodesGridContainer.replaceChildren(fragment);
}

async function loadMetadata() {
  const id = state.anilistId;
  const episode = state.episode;

  try {
    const details = await withTimeout(
      fetchAdvancedAnimeDetails(id),
      9000,
      'Metadata request timed out.'
    );

    if (id !== state.anilistId || episode !== state.episode) return;

    state.animeDetails = details || null;

    if (details) {
      state.idMal = details.idMal || null;

      state.animeTitle =
        details.title?.english ||
        details.title?.romaji ||
        details.title?.userPreferred ||
        'Anime';

      const poster =
        details.coverImage?.extraLarge ||
        details.coverImage?.large ||
        details.coverImage?.medium ||
        '';

      const backdrop = details.bannerImage || poster;

      state.posterUrl = backdrop || poster;

      updateSplash(details, poster, backdrop);

      if (dom.metaPoster && poster) dom.metaPoster.src = poster;
      text(dom.metaTitleHeader, state.animeTitle);

      const score = details.averageScore
        ? `${details.averageScore}%`
        : '--';

      const scoreSpan = dom.metaScore?.querySelector('span');

      if (scoreSpan) {
        text(scoreSpan, score);
      } else if (dom.metaScore) {
        text(dom.metaScore, `⭐ ${score}`);
      }

      text(
        dom.metaSynopsis,
        details.description?.replace(/<[^>]*>/g, '') ||
          'No synopsis available.'
      );

      renderChips(dom.metaGenres, details.genres || [], 'genre-chip');
      renderEpisodeGrid(details);
    } else {
      state.animeTitle = await getAnimeTitle(id).catch(() => 'Anime');

      if (id !== state.anilistId || episode !== state.episode) return;

      updateSplash();
    }

    updateHeader();

    if (dom.commentsStageContainer) {
      await Comments.mount(
        'commentsStageContainer',
        state.anilistId,
        state.episode
      );

      if (id !== state.anilistId || episode !== state.episode) return;

      dom.commentsDrawer?.classList.remove('open');
      dom.commentsDrawer?.setAttribute('aria-hidden', 'true');
      syncDrawerControls();
    }
  } catch (error) {
    console.warn('[AnimeEdge] Metadata:', error?.message || error);
  }
}

// =============================================================================
// 5. Server, Language and Drawer Rendering
// =============================================================================

function populateLanguages() {
  if (!dom.torrentioLangSelect) return;

  dom.torrentioLangSelect.replaceChildren();

  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.id;
    option.textContent = `${language.icon} ${language.label}`;
    dom.torrentioLangSelect.appendChild(option);
  }

  dom.torrentioLangSelect.value = state.torrentioLanguage;
  renderLanguageChips();
}

function renderLanguageChips() {
  if (!dom.langChipsGrid) return;

  dom.langChipsGrid.replaceChildren();

  for (const item of LANGUAGES) {
    const chip = document.createElement('div');
    chip.className =
      `lang-chip${item.id === state.torrentioLanguage ? ' active' : ''}`;
    chip.dataset.lang = item.id;

    const icon = document.createElement('span');
    icon.textContent = item.icon;

    chip.append(icon, document.createTextNode(` ${item.label}`));
    dom.langChipsGrid.appendChild(chip);
  }
}

function updateServerLabel() {
  const subName = state.activeSubServer?.name || 'Standard';

  const summary =
    state.activeServer?.id === 'server_1' &&
    state.activeSubServer?.id === 'torrentio'
      ? `Torrentio (${
          state.torrentioLanguage
            ? state.torrentioLanguage[0].toUpperCase() +
              state.torrentioLanguage.slice(1)
            : 'All'
        })`
      : `${subName} (${(state.thirdpartyAudioType || 'dub').toUpperCase()})`;

  text(dom.serverHubSummary, summary);
  text(dom.currentServerLabel, summary);
}

function syncAudioButtons() {
  const isSub = state.thirdpartyAudioType === 'sub';

  [dom.btnSub, dom.drawerBtnSub].forEach((el) =>
    el?.classList.toggle('active', isSub)
  );

  [dom.btnDub, dom.drawerBtnDub].forEach((el) =>
    el?.classList.toggle('active', !isSub)
  );

  updateServerLabel();
}

function updateControlVisibility() {
  const torrentio = state.activeSubServer?.id === 'torrentio';
  const thirdParty = state.activeServer?.id === 'server_2';
  const kuromi = state.activeSubServer?.id === 'kuromi';

  if (dom.torrentioLangContainer) {
    dom.torrentioLangContainer.style.display =
      torrentio ? 'flex' : 'none';
  }

  if (dom.drawerLangSection) {
    dom.drawerLangSection.style.display =
      torrentio ? 'block' : 'none';
  }

  if (dom.kuromiAudioToggle) {
    dom.kuromiAudioToggle.style.display =
      thirdParty ? 'flex' : 'none';
  }

  if (dom.drawerKuromiSection) {
    dom.drawerKuromiSection.style.display =
      thirdParty ? 'block' : 'none';
  }

  if (dom.kuromiProviderSelect) {
    dom.kuromiProviderSelect.style.display =
      kuromi ? 'block' : 'none';
  }

  updateServerLabel();
}

function renderDrawers(preview = state.previewServer || state.activeServer) {
  if (!preview) return;

  if (dom.clusterTabs) {
    dom.clusterTabs.replaceChildren();

    for (const server of SERVERS) {
      const tab = document.createElement('div');

      tab.className =
        `cluster-pill${server.id === preview.id ? ' active' : ''}` +
        `${!server.isAvailable ? ' disabled' : ''}`;

      tab.dataset.clusterId = server.id;

      const title = document.createElement('h5');
      title.textContent = server.name;

      const badge = document.createElement('span');
      badge.textContent = server.badge || '';

      tab.append(title, badge);
      dom.clusterTabs.appendChild(tab);
    }
  }

  text(dom.addonsHeader, `${preview.name.toUpperCase()} PROVIDERS`);

  if (dom.addonsGrid) {
    dom.addonsGrid.replaceChildren();

    for (const sub of preview.subServers || []) {
      const selected =
        preview.id === state.activeServer?.id &&
        sub.id === state.activeSubServer?.id;

      const item = document.createElement('div');
      item.className = `addon-item${selected ? ' active' : ''}`;
      item.dataset.clusterId = preview.id;
      item.dataset.addonId = sub.id;

      const top = document.createElement('div');
      top.className = 'addon-top';

      const icon = document.createElement('span');
      icon.textContent = sub.icon || '▶';

      const tag = document.createElement('span');
      tag.className = 'addon-tag';
      tag.textContent = sub.badge || '';

      top.append(icon, tag);

      const name = document.createElement('div');
      name.className = 'addon-name';
      name.textContent = sub.name || sub.id;

      item.append(top, name);
      dom.addonsGrid.appendChild(item);
    }
  }

  updateServerLabel();
}

// =============================================================================
// 6. Inline Stream Progress Tracker
// =============================================================================

let activeProgress = null;
let progressTimer = null;

function ensureProgressUI() {
  let root = $('aeInlineStreamProgress');

  if (!root) {
    root = document.createElement('section');
    root.id = 'aeInlineStreamProgress';
    root.className = 'ae-inline-progress';
    root.hidden = true;
    root.dataset.state = 'loading';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'ae-ip-header';

    const title = document.createElement('span');
    title.className = 'ae-ip-title';

    const step = document.createElement('span');
    step.className = 'ae-ip-step';

    header.append(title, step);

    const provider = document.createElement('div');
    provider.className = 'ae-ip-provider';

    const detail = document.createElement('div');
    detail.className = 'ae-ip-detail';

    const track = document.createElement('div');
    track.className = 'ae-ip-track';

    const fill = document.createElement('div');
    fill.className = 'ae-ip-fill';

    track.appendChild(fill);
    root.append(header, provider, detail, track);

    const style = document.createElement('style');
    style.id = 'ae-inline-progress-styles';

    style.textContent = `
      .ae-inline-progress {
        display: block;
        width: min(100%, 340px);
        box-sizing: border-box;
        margin: 9px auto 0;
        padding: 9px 11px;
        border: 1px solid rgba(138,180,255,.2);
        border-radius: 11px;
        background: rgba(13,18,29,.88);
        color: #eaf0fa;
        font: 12px/1.4 system-ui, sans-serif;
        text-align: left;
        overflow-wrap: anywhere;
      }

      .ae-inline-progress[hidden] {
        display: none !important;
      }

      .ae-ip-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .ae-ip-title {
        min-width: 0;
        font-size: 12px;
        font-weight: 750;
        color: #fff;
      }

      .ae-ip-step {
        flex: 0 0 auto;
        color: #8ab4ff;
        font-size: 10px;
        font-weight: 700;
      }

      .ae-ip-provider {
        margin-top: 4px;
        color: #8ab4ff;
        font-size: 10px;
      }

      .ae-ip-detail {
        margin-top: 3px;
        color: #b9c4d6;
        font-size: 11px;
        line-height: 1.45;
      }

      .ae-ip-track {
        height: 3px;
        margin-top: 8px;
        overflow: hidden;
        border-radius: 6px;
        background: rgba(255,255,255,.1);
      }

      .ae-ip-fill {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: #60a5fa;
        transition: width .25s ease;
      }

      .ae-inline-progress[data-state="error"] {
        border-color: rgba(255,100,100,.35);
      }

      .ae-inline-progress[data-state="error"] .ae-ip-title,
      .ae-inline-progress[data-state="error"] .ae-ip-detail {
        color: #ffaaaa;
      }

      .ae-inline-progress[data-state="error"] .ae-ip-fill {
        background: #ff7373;
      }

      .ae-inline-progress[data-state="success"] .ae-ip-fill {
        background: #5ee5a0;
      }

      @media (prefers-reduced-motion: reduce) {
        .ae-ip-fill {
          transition: none;
        }
      }
    `;

    if (!$('ae-inline-progress-styles')) {
      document.head.appendChild(style);
    }

    if (dom.splashPlayBtn?.isConnected) {
      dom.splashPlayBtn.insertAdjacentElement('afterend', root);
    } else {
      dom.splashStatus?.insertAdjacentElement('afterend', root);
    }
  }

  if (!root.isConnected) {
    if (dom.splashPlayBtn?.isConnected) {
      dom.splashPlayBtn.insertAdjacentElement('afterend', root);
    } else {
      document.body.appendChild(root);
    }
  }

  return root;
}

function hideProgress() {
  clearTimeout(progressTimer);
  progressTimer = null;

  const root = $('aeInlineStreamProgress');

  if (root) {
    root.hidden = true;
    root.dataset.state = 'idle';
  }

  activeProgress = null;
}

function startProgress(providerName = 'Selected server') {
  clearTimeout(progressTimer);
  progressTimer = null;

  const root = ensureProgressUI();

  const title = q('.ae-ip-title', root);
  const step = q('.ae-ip-step', root);
  const provider = q('.ae-ip-provider', root);
  const detail = q('.ae-ip-detail', root);
  const fill = q('.ae-ip-fill', root);

  const cleanProvider = safeName(providerName, 80);

  let currentIndex = 0;
  let settled = false;

  const panel = {
    update(stageId, message, customProgressRatio = null) {
      if (activeProgress !== panel || settled) return;

      const index = PROGRESS_STAGES.findIndex(
        (stage) => stage[0] === stageId
      );

      if (index < 0) return;

      currentIndex = Math.max(currentIndex, index);

      const stage = PROGRESS_STAGES[currentIndex];

      root.hidden = false;
      root.dataset.state = 'loading';

      text(title, stage[1]);
      text(step, `Step ${currentIndex + 1}/${PROGRESS_STAGES.length}`);
      text(provider, `Provider: ${cleanProvider}`);
      text(detail, message || stage[2]);

      if (typeof customProgressRatio === 'number' && Number.isFinite(customProgressRatio)) {
        fill.style.width = `${Math.min(100, Math.max(5, Math.round(customProgressRatio * 100)))}%`;
      } else {
        fill.style.width =
          `${((currentIndex + 1) / PROGRESS_STAGES.length) * 100}%`;
      }

      setSplashLoading(true, '');
    },

    succeed() {
      if (activeProgress !== panel || settled) return;

      settled = true;
      hideProgress();
    },

    fail(message = 'Could not load this source. Try another server.') {
      if (activeProgress !== panel || settled) return;

      settled = true;

      root.hidden = false;
      root.dataset.state = 'error';

      text(title, 'Stream resolution failed');
      text(step, 'Failed');
      text(provider, `Provider: ${cleanProvider}`);
      text(detail, message);

      fill.style.width = '100%';

      setSplashLoading(false, message);

      progressTimer = setTimeout(() => {
        if (activeProgress === panel) {
          hideProgress();
        }
      }, 6000);
    }
  };

  activeProgress = panel;

  text(dom.splashStatus, '');

  root.hidden = false;

  panel.update(
    'request',
    `Preparing Episode ${state.episode}…`
  );

  return panel;
}

// -----------------------------------------------------------------------------
// 7. Strict Client-Side One-by-One Stream Verifier
// -----------------------------------------------------------------------------

function extractUnderlyingUrl(urlStr) {
  const u = safeParseUrl(urlStr);
  if (!u) return String(urlStr || '');
  if (isProxyEndpoint(urlStr)) {
    return u.searchParams.get('url') || u.searchParams.get('src') || urlStr;
  }
  return urlStr;
}

function isAllowedEmbedDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return (
    TRUSTED_EMBED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ||
    /(^|\.)[a-z0-9-]*flixcloud[a-z0-9-]*\.[a-z]{2,}$/i.test(host)
  );
}

function getLanguagePriorityScore(source) {
  const values = [
    source.language,
    source.audioLanguage,
    ...(Array.isArray(source.languages) ? source.languages : [])
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  const combined = values.join(' ');
  if (/hindi|\bhin\b|\bhi\b/.test(combined)) return 1;
  if (/dual[\s-]*audio|english|\beng\b|\ben\b/.test(combined)) return 2;
  if (/japanese|\bjpn\b|\bsub(?:bed)?\b|\bja\b/.test(combined)) return 3;

  const num = Number(source.priorityScore);
  return Number.isFinite(num) && source.priorityScore !== '' && source.priorityScore != null
    ? num
    : 5;
}

function probeDirectVideoViaElement(videoUrl, timeoutMs, parentSignal) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';

    let settled = false;
    let timer = null;

    const finish = (isValid) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('error', onError);
      parentSignal?.removeEventListener('abort', onAbort);

      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      } catch {}

      resolve(isValid);
    };

    const onLoaded = () => {
      if (video.readyState >= 1) finish(true);
    };
    const onError = () => finish(false);
    const onAbort = () => finish(false);

    timer = setTimeout(() => finish(false), timeoutMs);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('canplay', onLoaded);
    video.addEventListener('error', onError);
    parentSignal?.addEventListener('abort', onAbort, { once: true });

    if (parentSignal?.aborted) {
      finish(false);
      return;
    }

    document.body?.appendChild(video);
    video.src = videoUrl;
    try {
      video.load();
    } catch {
      finish(false);
    }
  });
}

async function checkHlsManifestOnClient(url, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
      },
      signal: controller.signal
    });

    if (!res.ok) return false;

    const bodyText = await res.text();
    if (!bodyText || bodyText.length > 1_000_000) return false;

    const clean = bodyText.replace(/^\uFEFF/, '').trim();
    if (
      clean.startsWith('<!DOCTYPE') ||
      clean.startsWith('<html') ||
      clean.startsWith('{"error') ||
      clean.startsWith('{"success":false')
    ) {
      return false;
    }

    if (!clean.includes('#EXTM3U')) return false;

    const lines = clean
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.some(
      (line) =>
        !line.startsWith('#') ||
        line.startsWith('#EXT-X-STREAM-INF:') ||
        line.startsWith('#EXTINF:')
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function checkDirectVideoOnClient(url, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-64' },
      signal: controller.signal
    });

    if (res.status === 404 || res.status === 410 || res.status === 403 || res.status >= 500) {
      return false;
    }

    if (!(res.ok || res.status === 206)) {
      return false;
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return false;
    }

    const reader = res.body?.getReader();
    if (!reader) return true;

    const { value } = await reader.read();
    try { await reader.cancel(); } catch {}

    if (!value || value.length < 4) return false;

    const preview = new TextDecoder().decode(value.slice(0, 64)).trim().toLowerCase();
    if (
      preview.startsWith('<!doctype') ||
      preview.startsWith('<html') ||
      preview.startsWith('{"error') ||
      preview.startsWith('access denied')
    ) {
      return false;
    }

    return true;
  } catch {
    if (parentSignal?.aborted) return false;
    return await probeDirectVideoViaElement(url, Math.min(timeoutMs, 4000), parentSignal);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function verifySingleStreamOnClient(candidate, index, parentSignal) {
  if (!candidate || parentSignal?.aborted) return null;

  const source = typeof candidate === 'string' ? { url: candidate } : candidate;
  if (!source || typeof source !== 'object') return null;

  const startedAt = performance.now();

  // 1. P2P Torrents / Magnet Links
  const rawUrlValue = resolveLuffyUrl(String(source.url || source.embed || source.hlsProxyUrl || source.originalUrl || '').trim());
  const magnetCandidate = [source.magnetUri, source.magnet, rawUrlValue].find(
    (v) => typeof v === 'string' && /^magnet:\?/i.test(v.trim())
  );
  const infoHash = String(source.infoHash || '').trim();
  const isTorrent =
    source.isTorrent === true ||
    String(source.type || '').toLowerCase() === 'torrent' ||
    Boolean(magnetCandidate) ||
    /^[a-f0-9]{40}$/i.test(infoHash);

  if (isTorrent) {
    if (!magnetCandidate && !/^[a-f0-9]{40}$/i.test(infoHash)) return null;
    const finalMagnet = magnetCandidate || `magnet:?xt=urn:btih:${infoHash}`;
    return {
      ...source,
      type: 'torrent',
      isTorrent: true,
      magnetUri: finalMagnet,
      url: finalMagnet,
      priorityScore: getLanguagePriorityScore(source),
      latencyMs: 5,
      validationStatus: 'verified-torrent',
      _idx: index
    };
  }

  // 2. HTTP/HTTPS URL Structure Check
  const parsedUrl = safeParseUrl(rawUrlValue);
  if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) {
    return null;
  }

  const underlyingUrlObj = safeParseUrl(extractUnderlyingUrl(rawUrlValue));

  // 3. Embed / Iframe Sources
  const isEmbed =
    source.isEmbed === true ||
    String(source.type || '').toLowerCase() === 'embed' ||
    String(source.format || '').toLowerCase() === 'embed' ||
    String(source.verification || '').toLowerCase() === 'embed' ||
    /\/(?:embed|e|v)\b/i.test(underlyingUrlObj?.pathname || rawUrlValue);

  if (isEmbed) {
    const targetHost = underlyingUrlObj?.hostname || parsedUrl.hostname;
    if (isAllowedEmbedDomain(targetHost) || source.verification === 'embed') {
      return {
        ...source,
        url: rawUrlValue,
        originalUrl: source.originalUrl || rawUrlValue,
        type: 'embed',
        isEmbed: true,
        priorityScore: getLanguagePriorityScore(source),
        latencyMs: 10,
        validationStatus: 'verified-embed',
        _idx: index
      };
    }
    return null;
  }

  // 4. HLS (.m3u8) or Direct Video (.mp4)
  const underlyingStr = extractUnderlyingUrl(rawUrlValue);
  const isHls =
    Boolean(source.isM3U8) ||
    String(source.type || '').toLowerCase() === 'hls' ||
    String(source.format || '').toLowerCase() === 'm3u8' ||
    /\.m3u8(?:\?|$|#)/i.test(underlyingStr) ||
    /stream\/m3u8|hls-proxy|proxy_m3u8|api\/v1\/proxy|\/p\//i.test(rawUrlValue);

  const hasHeaders =
    (source.headers && Object.keys(source.headers).length > 0) ||
    (source.serverHeaders && Object.keys(source.serverHeaders).length > 0);

  const needsProxyFirst =
    !isProxyEndpoint(rawUrlValue) &&
    (
      (window.location.protocol === 'https:' && parsedUrl.protocol === 'http:') ||
      (isHls && hasHeaders) ||
      rawUrlValue.includes('luffytv.live')
    );

  const primaryProbeUrl = needsProxyFirst
    ? buildProxiedUrl(rawUrlValue, source.headers || source.serverHeaders || {})
    : rawUrlValue;

  if (!primaryProbeUrl) return null;

  // 5. Test Primary URL
  const primaryAlive = isHls
    ? await checkHlsManifestOnClient(primaryProbeUrl, SINGLE_LINK_TIMEOUT_MS, parentSignal)
    : await checkDirectVideoOnClient(primaryProbeUrl, SINGLE_LINK_TIMEOUT_MS, parentSignal);

  if (primaryAlive) {
    return {
      ...source,
      url: primaryProbeUrl,
      originalUrl: source.originalUrl || rawUrlValue,
      priorityScore: getLanguagePriorityScore(source),
      latencyMs: Math.round(performance.now() - startedAt),
      validationStatus: 'verified-direct',
      _idx: index
    };
  }

  // 6. Test Third-Party Proxy Fallback
  if (!needsProxyFirst && !isProxyEndpoint(primaryProbeUrl)) {
    const fallbackProxyUrl = buildProxiedUrl(
      rawUrlValue,
      source.headers || source.serverHeaders || {}
    );

    if (fallbackProxyUrl && fallbackProxyUrl !== primaryProbeUrl) {
      const proxyAlive = isHls
        ? await checkHlsManifestOnClient(fallbackProxyUrl, SINGLE_LINK_TIMEOUT_MS, parentSignal)
        : await checkDirectVideoOnClient(fallbackProxyUrl, SINGLE_LINK_TIMEOUT_MS, parentSignal);

      if (proxyAlive) {
        return {
          ...source,
          url: fallbackProxyUrl,
          originalUrl: source.originalUrl || rawUrlValue,
          priorityScore: getLanguagePriorityScore(source),
          latencyMs: Math.round(performance.now() - startedAt),
          validationStatus: 'verified-via-proxy',
          _idx: index
        };
      }
    }
  }

  return null;
}

async function verifyCandidateStreamsOneByOne(candidates, parentSignal, onStepProgress) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const verifiedList = [];
  const total = candidates.length;

  for (let i = 0; i < total; i++) {
    if (parentSignal?.aborted) break;

    const candidate = candidates[i];
    const candidateName = safeName(
      candidate?.title || candidate?.releaseName || candidate?.quality || `Source #${i + 1}`,
      42
    );

    if (typeof onStepProgress === 'function') {
      onStepProgress({
        current: i + 1,
        total,
        verifiedCount: verifiedList.length,
        candidateName,
        phase: 'checking',
        verifiedList
      });
    }

    const verifiedItem = await verifySingleStreamOnClient(candidate, i, parentSignal);

    if (parentSignal?.aborted) break;

    if (verifiedItem) {
      verifiedList.push(verifiedItem);
    }

    if (typeof onStepProgress === 'function') {
      onStepProgress({
        current: i + 1,
        total,
        verifiedCount: verifiedList.length,
        candidateName,
        phase: verifiedItem ? 'passed' : 'failed',
        verifiedList
      });
    }
  }

  return verifiedList.sort((a, b) => {
    const pA = Number.isFinite(Number(a.priorityScore)) ? Number(a.priorityScore) : 99;
    const pB = Number.isFinite(Number(b.priorityScore)) ? Number(b.priorityScore) : 99;
    if (pA !== pB) return pA - pB;

    const lA = Number.isFinite(Number(a.latencyMs)) ? Number(a.latencyMs) : Number.MAX_SAFE_INTEGER;
    const lB = Number.isFinite(Number(b.latencyMs)) ? Number(b.latencyMs) : Number.MAX_SAFE_INTEGER;
    return lA - lB;
  });
}

// =============================================================================
// 8. Stream Resolution Coordinator (Luffy TV & Multi-Server Dispatcher)
// =============================================================================

function makeRequestKey(server, sub) {
  return [
    state.anilistId,
    state.episode,
    state.season,
    server?.id,
    sub?.id,
    state.thirdpartyAudioType,
    state.torrentioLanguage,
    state.kuromiProvider,
    state.luffyServer || state.anikotoServer
  ].join('|');
}

function setSplashLoading(loading, message = '') {
  const button = dom.splashPlayBtn;
  const label = button?.querySelector('span');

  if (label) {
    text(label, loading ? 'Verifying…' : 'Play Episode');
  }

  if (button) {
    button.disabled = loading;
    button.style.opacity = loading ? '.85' : '1';
    button.style.cursor = loading ? 'wait' : 'pointer';
  }

  if (dom.splashSpinner) {
    dom.splashSpinner.style.display = 'none';
  }

  if (message) text(dom.splashStatus, message);
}

function showError(show, title = '', description = '') {
  if (!dom.playerError) return;

  dom.playerError.style.display = show ? 'flex' : 'none';

  if (show) {
    text(dom.errTitle, title);
    text(dom.errDesc, description);
  }
}

function torrentWithinLimit(stream) {
  const max = Number(CONFIG.TORRENT_MAX_BYTES);
  const bytes = Number(stream?.size?.bytes);

  if (
    Number.isFinite(max) &&
    max > 0 &&
    Number.isFinite(bytes) &&
    bytes > 0
  ) {
    return bytes <= max;
  }

  const size = String(
    stream?.size?.humanReadable || stream?.size || ''
  ).toLowerCase().trim();

  const match = size.match(/([\d.]+)\s*(kb|mb|gb|tb)/i);

  if (!match) return true;

  const value = Number(match[1]);

  const multiplier = {
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4
  }[match[2].toLowerCase()];

  return !Number.isFinite(max) || max <= 0 ||
    value * multiplier <= max;
}

async function fetchCandidateStreamsFromProvider(sub, token, signal, isCurrent) {
  switch (sub.id) {
    case 'luffy':
      return await withTimeout(
        fetchLuffyStreams({
          anilistId: state.anilistId,
          episode: state.episode,
          type: state.thirdpartyAudioType,
          title: state.animeTitle
        }),
        25000,
        'Luffy TV provider timed out.'
      );

    case 'anikoto':
      // Backward-compatible fallback
      return await withTimeout(
        fetchAnikotoStreams({
          anilistId: state.anilistId,
          episode: state.episode,
          type: state.thirdpartyAudioType,
          title: state.animeTitle
        }),
        25000,
        'Luffy TV / Inazuma provider timed out.'
      );

    case 'indian':
      return await withTimeout(
        fetchIndianStreams({
          anilistId: state.anilistId,
          episode: state.episode,
          season: state.season || 1,
          type: state.thirdpartyAudioType,
          title: state.animeTitle
        }),
        25000,
        'Indian provider timed out.'
      );

    case 'aniraku':
      return await withTimeout(
        fetchAnirakuStreams({
          anilistId: state.anilistId,
          episode: state.episode,
          type: state.thirdpartyAudioType
        }),
        25000,
        'Aniraku timed out.'
      );

    case 'kuromi':
      return await withTimeout(
        fetchKuromiFlixcloudStreams({
          anilistId: state.anilistId,
          episode: state.episode,
          type: state.thirdpartyAudioType,
          provider: state.kuromiProvider,
          title: state.animeTitle
        }),
        25000,
        'Kuromi provider timed out.'
      );

    default: {
      const url = new URL(
        `${CONFIG.API_BASE_URL}/api/v1/anime/anilist/${state.anilistId}/episode/${state.episode}`
      );

      url.searchParams.set('addon', sub.id);

      if (
        sub.id === 'torrentio' &&
        state.torrentioLanguage
      ) {
        url.searchParams.set(
          'language',
          state.torrentioLanguage
        );
      }

      const headers = { Accept: 'application/json' };
      const activeToken = token || window.API_SESSION_TOKEN;

      if (activeToken) {
        headers['x-session-token'] = activeToken;
      }

      const response = await withTimeout(
        fetch(url, { headers, signal }),
        25000,
        'Stream gateway timed out.'
      );

      if (!isCurrent()) return [];

      if (response.status === 401) {
        resetTurnstileWidget();

        throw new Error(
          'Security session expired. Refresh the page and verify again.'
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(
          errorData?.error?.message ||
          `Gateway returned HTTP ${response.status}.`
        );
      }

      const data = await response.json();

      if (
        !data?.success ||
        !Array.isArray(data.results)
      ) {
        return [];
      }

      let results = data.results;

      if (sub.category === 'torrent') {
        results = results.filter(torrentWithinLimit);
      }

      return results;
    }
  }
}

async function loadStreams() {
  const server = state.activeServer;

  const sub =
    state.activeSubServer ||
    server?.subServers?.[0];

  if (!sub) {
    hideProgress();
    showError(
      true,
      'No Server Selected',
      'Choose an available server and try again.'
    );
    return;
  }

  const key = makeRequestKey(server, sub);

  if (state.isFetching && state.requestKey === key) return;

  const requestId = ++state.requestId;

  state.requestKey = key;
  state.isFetching = true;

  state.requestController?.abort();
  state.requestController = new AbortController();

  const signal = state.requestController.signal;
  const isCurrent = () =>
    requestId === state.requestId && !signal.aborted;

  const progress = startProgress(sub.name || sub.id || 'Selected server');

  try {
    Player.destroy();

    progress.update(
      'request',
      `Request received for ${state.animeTitle || 'this anime'}, Episode ${state.episode}.`
    );

    dom.playerSplash?.classList.remove('hidden');

    setSplashLoading(true, `Contacting ${sub.name || 'server'}…`);
    showError(false);

    state.sources = [];
    state.currentStream = null;

    text(dom.sourceCountBadge, '0');
    dom.sourcesList?.replaceChildren();
    Downloader.updateButtonState(null);

    if (dom.torrentAlert) {
      dom.torrentAlert.style.display =
        sub.category === 'torrent' ? 'block' : 'none';
    }

    progress.update(
      'connect',
      'Checking session and preparing provider access…'
    );

    const token = await waitForSessionToken(3500);
    state.usedTokenInLastFetch = Boolean(token || window.API_SESSION_TOKEN);

    if (!isCurrent()) return;

    if (!state.animeTitle || state.animeTitle === 'Anime') {
      if (state.metadataPromise) {
        try {
          await withTimeout(state.metadataPromise, 3500);
        } catch {}
      }

      if (!isCurrent()) return;

      if (!state.animeTitle || state.animeTitle === 'Anime') {
        state.animeTitle = await getAnimeTitle(state.anilistId)
          .catch(() => 'Anime');

        if (!isCurrent()) return;

        updateHeader();
        updateSplash();
      }
    }

    let raw = [];
    let firstFetchError = null;

    progress.update(
      'resolve',
      `Requesting candidate links from ${sub.name || sub.id}…`
    );

    try {
      raw = await fetchCandidateStreamsFromProvider(sub, token, signal, isCurrent);
    } catch (err) {
      firstFetchError = err;
      console.warn(`[AnimeEdge] First attempt on ${sub.id}:`, err?.message || err);
    }

    if (!isCurrent()) return;

    // Warm retry if the provider returned 0 candidate links on cold start
    if (!Array.isArray(raw) || raw.length === 0) {
      progress.update(
        'resolve',
        `Warming ${sub.name || sub.id} node (retrying)…`
      );
      setSplashLoading(true, `Warming ${sub.name || 'server'}…`);

      await new Promise((r) => setTimeout(r, 650));
      if (!isCurrent()) return;

      const refreshedToken = window.API_SESSION_TOKEN || token;
      state.usedTokenInLastFetch = Boolean(refreshedToken);

      try {
        raw = await fetchCandidateStreamsFromProvider(sub, refreshedToken, signal, isCurrent);
        firstFetchError = null;
      } catch (retryErr) {
        firstFetchError = retryErr;
      }
    }

    if (!isCurrent()) return;

    if ((!Array.isArray(raw) || raw.length === 0) && firstFetchError) {
      throw firstFetchError;
    }

    if (!Array.isArray(raw)) raw = [];

    if (raw.length === 0) {
      setSplashLoading(false, 'No candidate links returned');
      Downloader.updateButtonState(null);
      const emptyMsg = `No links returned by ${sub.name || sub.id} for Episode ${state.episode}. Try another server.`;
      showError(true, 'No Streams Found', emptyMsg);
      progress.fail(emptyMsg);
      return;
    }

    progress.update(
      'verify',
      `Found ${raw.length} link(s). Testing one by one on your device…`,
      0.65
    );

    const verifiedStreams = await verifyCandidateStreamsOneByOne(
      raw,
      signal,
      ({ current, total, verifiedCount, candidateName, phase, verifiedList }) => {
        if (!isCurrent()) return;

        const statusMsg =
          phase === 'checking'
            ? `Testing link ${current}/${total} (${candidateName}) — ${verifiedCount} working…`
            : `Checked ${current}/${total} — ${verifiedCount} working source(s) verified`;

        const ratio = 0.65 + (current / Math.max(1, total)) * 0.30;
        setSplashLoading(true, statusMsg);
        progress.update('verify', statusMsg, ratio);

        state.sources = [...verifiedList];
        text(dom.sourceCountBadge, state.sources.length);
        renderSources(state.sources);
      }
    );

    if (!isCurrent()) return;

    state.sources = verifiedStreams;
    text(dom.sourceCountBadge, state.sources.length);
    renderSources(state.sources);

    if (state.sources.length > 0) {
      state.currentStream = state.sources[0];

      Downloader.updateButtonState(state.currentStream);
      setSplashLoading(
        false,
        `${state.sources.length} verified working source(s) ready`
      );

      showPlayerToast(
        `${sub.name || sub.id}: ${state.sources.length} working source(s) verified`,
        'success',
        2000
      );

      progress.succeed();
    } else {
      setSplashLoading(false, 'All candidate links failed verification');
      Downloader.updateButtonState(null);

      const message =
        `Tested ${raw.length} link(s) on ${sub.name || sub.id} for Episode ${state.episode}, ` +
        'but none are currently working. Please select another provider.';

      showError(true, 'No Working Streams Found', message);
      progress.fail(message);
    }
  } catch (error) {
    if (!isCurrent()) return;

    const message =
      error?.message ||
      'Could not access this provider. Try another server.';

    setSplashLoading(false, 'Stream request failed');
    Downloader.updateButtonState(null);

    showError(true, 'Stream Resolution Error', message);
    progress.fail(message);
  } finally {
    if (requestId === state.requestId) {
      state.isFetching = false;
      state.requestKey = '';
      state.requestController = null;
    }
  }
}

function renderSources(sources) {
  if (!dom.sourcesList) return;

  const fragment = document.createDocumentFragment();

  sources.forEach((source, index) => {
    const url = String(source.url || source.magnetUri || '');

    const torrent = Boolean(
      source.infoHash ||
      source.magnetUri ||
      source.type === 'torrent' ||
      source.isTorrent
    );

    const embed = Boolean(
      source.isEmbed ||
      source.type === 'embed' ||
      source.format === 'embed'
    );

    let label = 'DIRECT';

    if (torrent) {
      label = 'TORRENT P2P';
    } else if (embed) {
      label = 'EMBED';
    } else if (source.addon === 'luffy') {
      label = 'LUFFY HLS';
    } else if (/\.m3u8(?:\?|$)/i.test(url) || source.type === 'hls') {
      label = 'HLS VERIFIED';
    } else if (/googleusercontent|drive\.google/i.test(url)) {
      label = 'DIRECT DL';
    } else if (/\.mp4(?:\?|$)/i.test(url)) {
      label = 'DIRECT MP4';
    }

    const card = document.createElement('div');
    card.className = `source-card${index === 0 ? ' active' : ''}`;
    card.dataset.idx = String(index);

    const top = document.createElement('div');
    top.className = 'sc-top';

    const quality = document.createElement('span');
    quality.className = 'sc-quality';
    quality.textContent = String(source.quality || 'HD').toUpperCase();

    const size = document.createElement('span');
    size.className = 'sc-size';
    const latencyBadge =
      Number.isFinite(source.latencyMs) && source.latencyMs > 0
        ? ` • ${source.latencyMs}ms`
        : '';
    size.textContent =
      (source.size?.humanReadable || (embed ? 'Embed' : 'Verified')) + latencyBadge;

    top.append(quality, size);

    const title = document.createElement('div');
    title.className = 'sc-title';
    title.textContent =
      source.title || source.releaseName || 'Verified Stream Source';

    const meta = document.createElement('div');
    meta.className = 'sc-meta';

    const type = document.createElement('span');
    type.style.color = '#00e5ff';
    type.style.fontWeight = '700';
    type.textContent = `⚡ ${label}`;
    meta.appendChild(type);

    if (source.seeders != null) {
      const seeders = document.createElement('span');
      seeders.textContent = `👤 ${source.seeders}`;
      meta.appendChild(seeders);
    }

    const language = document.createElement('span');
    language.textContent =
      `🌐 ${String(source.language || source.audioLanguage || 'Unknown').toUpperCase()}`;

    meta.appendChild(language);
    card.append(top, title, meta);
    fragment.appendChild(card);
  });

  dom.sourcesList.replaceChildren(fragment);
}

// =============================================================================
// 9. Playback and Downloads
// =============================================================================

async function playStream(stream) {
  if (!stream) return;

  state.currentStream = stream;
  Downloader.updateButtonState(stream);

  hideProgress();
  dom.playerSplash?.classList.add('hidden');

  let reportedError = false;

  try {
    await Player.play({
      stream,
      anilistId: state.anilistId,
      malId: state.idMal,
      episode: state.episode,
      animeTitle: state.animeTitle,
      poster: state.posterUrl,

      episodeDurationSec:
        (Number(state.animeDetails?.duration) || 24) * 60,

      onNextEpisode: () => {
        state.episode++;
        void updateUrlAndReload();
      },

      onError: (title, description) => {
        reportedError = true;
        hideProgress();

        showError(
          true,
          title || 'Playback Error',
          description ||
            'Could not play this source. Try another one.'
        );
      }
    });

    if (!reportedError) hideProgress();
    showHUD();
  } catch (error) {
    const message =
      error?.message ||
      'Could not play this source. Try another one.';

    showError(true, 'Playback Error', message);
    showPlayerToast(message, 'error', 2600);
    hideProgress();
  }
}

function startDownload(event) {
  event?.stopPropagation?.();

  const stream =
    state.currentStream ||
    state.sources[0] ||
    null;

  Promise.resolve(
    Downloader.startDownload({
      stream,
      anilistId: state.anilistId,
      episode: state.episode,
      animeTitle: state.animeTitle,
      serverName: state.activeSubServer?.name
    })
  ).catch((error) => {
    showPlayerToast(
      error?.message || 'Download could not be started.',
      'error',
      2600
    );
  });
}

// =============================================================================
// 10. UI Event Handlers
// =============================================================================

function bindEvents() {
  dom.splashPlayBtn?.addEventListener('click', () => {
    if (state.isFetching) return;

    if (state.currentStream) {
      void playStream(state.currentStream);
    } else if (state.sources.length) {
      void playStream(state.sources[0]);
    } else {
      void loadStreams();
    }
  });

  const toggle = (button, drawer) => {
    button?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleDrawer(drawer);
    });
  };

  toggle(dom.btnToggleMediaHub, dom.episodesDrawer);
  toggle(dom.btnToggleEpisodes, dom.episodesDrawer);
  toggle(dom.btnToggleInfo, dom.infoDrawer);
  toggle(dom.btnToggleSources, dom.sourcesDrawer);
  toggle(dom.btnToggleComments, dom.commentsDrawer);
  toggle(dom.btnMobileComments, dom.commentsDrawer);

  const showServers = (event) => {
    event.stopPropagation();

    state.previewServer = state.activeServer;
    renderDrawers(state.activeServer);
    toggleDrawer(dom.serversDrawer);
  };

  dom.btnToggleServerHub?.addEventListener('click', showServers);
  dom.btnToggleServers?.addEventListener('click', showServers);

  [
    dom.btnCloseServers,
    dom.btnCloseSources,
    dom.btnCloseEpisodes,
    dom.btnCloseInfo,
    dom.btnCloseComments
  ].forEach((button) => {
    button?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeDrawers(null, true);
    });
  });

  dom.btnDownloadStream?.addEventListener('click', startDownload);
  dom.btnMobileDownload?.addEventListener('click', startDownload);

  dom.clusterTabs?.addEventListener('click', (event) => {
    event.stopPropagation();

    if (!(event.target instanceof Element)) return;

    const tab = event.target.closest('.cluster-pill');
    if (!tab) return;

    const server = SERVERS.find(
      (item) =>
        item.id === tab.dataset.clusterId &&
        item.isAvailable
    );

    if (!server) return;

    state.previewServer = server;
    renderDrawers(server);

    if (dom.drawerLangSection) {
      dom.drawerLangSection.style.display =
        server.id === 'server_1' &&
        state.activeSubServer?.id === 'torrentio'
          ? 'block'
          : 'none';
    }

    if (dom.drawerKuromiSection) {
      dom.drawerKuromiSection.style.display =
        server.id === 'server_2' ? 'block' : 'none';
    }

    dom.serversDrawer?.classList.add('open');
    dom.serversDrawer?.setAttribute('aria-hidden', 'false');
    syncDrawerControls();
  });

  dom.addonsGrid?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const card = event.target.closest('.addon-item');
    if (!card) return;

    const server = SERVERS.find(
      (item) =>
        item.id === card.dataset.clusterId &&
        item.isAvailable
    );

    const sub = server?.subServers?.find(
      (item) => item.id === card.dataset.addonId
    );

    if (!server || !sub) return;

    state.activeServer = state.previewServer = server;
    state.activeSubServer = sub;
    state.luffyServer = '';
    state.anikotoServer = '';

    renderDrawers(server);
    updateControlVisibility();

    closeDrawers(null, true);
    void loadStreams();
  });

  const changeAudio = (type) => {
    if (state.thirdpartyAudioType === type) return;

    state.thirdpartyAudioType = type;
    syncAudioButtons();
    void loadStreams();
  };

  dom.btnSub?.addEventListener('click', () => changeAudio('sub'));
  dom.drawerBtnSub?.addEventListener('click', () => changeAudio('sub'));
  dom.btnDub?.addEventListener('click', () => changeAudio('dub'));
  dom.drawerBtnDub?.addEventListener('click', () => changeAudio('dub'));

  dom.kuromiProviderSelect?.addEventListener('change', () => {
    state.kuromiProvider = dom.kuromiProviderSelect.value;
    void loadStreams();
  });

  dom.torrentioLangSelect?.addEventListener('change', () => {
    state.torrentioLanguage = dom.torrentioLangSelect.value;
    renderLanguageChips();
    updateServerLabel();
    void loadStreams();
  });

  dom.langChipsGrid?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const chip = event.target.closest('.lang-chip');
    if (!chip) return;

    state.torrentioLanguage = chip.dataset.lang ?? '';

    if (dom.torrentioLangSelect) {
      dom.torrentioLangSelect.value = state.torrentioLanguage;
    }

    renderLanguageChips();
    updateServerLabel();
    void loadStreams();
  });

  dom.sourcesList?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const card = event.target.closest('.source-card');
    if (!card) return;

    const index = Number(card.dataset.idx);

    if (!Number.isInteger(index) || !state.sources[index]) {
      return;
    }

    dom.sourcesList.querySelectorAll('.source-card').forEach((item) => {
      item.classList.toggle('active', item === card);
    });

    closeDrawers(null, true);
    void playStream(state.sources[index]);
  });

  dom.episodesGridContainer?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const card = event.target.closest('.ep-card');
    if (!card) return;

    const episode = Number(card.dataset.ep);

    if (episode > 0 && episode !== state.episode) {
      state.episode = episode;
      closeDrawers(null, true);
      void updateUrlAndReload();
    }
  });

  dom.btnPrevEp?.addEventListener('click', (event) => {
    event.stopPropagation();

    if (state.episode > 1) {
      state.episode--;
      void updateUrlAndReload();
    }
  });

  dom.btnNextEp?.addEventListener('click', (event) => {
    event.stopPropagation();
    state.episode++;
    void updateUrlAndReload();
  });

  dom.btnRetry?.addEventListener('click', (event) => {
    event.stopPropagation();

    state.previewServer = state.activeServer;
    renderDrawers(state.activeServer);
    toggleDrawer(dom.serversDrawer);
  });

  document.addEventListener('click', (event) => {
    const selector =
      '.glass-drawer,.pill-btn,.mobile-touch-actions,' +
      '.drawer-close,.player-topbar,#aeStreamProgress,#aeInlineStreamProgress';

    const path = event.composedPath?.() || [];

    const inPath = path.some(
      (node) => node instanceof Element && node.matches(selector)
    );

    const target = event.target;

    const nearTarget =
      target instanceof Element &&
      Boolean(target.closest(selector));

    if (!inPath && !nearTarget && anyDrawerOpen()) {
      closeDrawers(null, true);
    }
  });
}

function bindNavigationHotkeys() {
  document.addEventListener('keydown', (event) => {
    if (
      isEditable(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    if (event.code === 'KeyN' && !event.shiftKey) {
      event.preventDefault();
      state.episode++;
      void updateUrlAndReload();
    } else if (
      event.code === 'KeyN' &&
      event.shiftKey &&
      state.episode > 1
    ) {
      event.preventDefault();
      state.episode--;
      void updateUrlAndReload();
    }
  });
}

async function updateUrlAndReload() {
  state.requestController?.abort();
  state.requestId++;
  state.isFetching = false;
  state.requestKey = '';

  hideProgress();

  history.pushState(
    null,
    '',
    `/${state.anilistId}/${state.episode}`
  );

  dom.playerSplash?.classList.remove('hidden');

  dom.episodesGridContainer?.querySelectorAll('.ep-card').forEach((card) => {
    card.classList.toggle(
      'active',
      Number(card.dataset.ep) === state.episode
    );
  });

  state.metadataPromise = loadMetadata();
  await loadStreams();
}

// =============================================================================
// 10b. Nexus bridge — the handle feature modules talk to
// =============================================================================

async function goToEpisode(nextEpisode) {
  const ep = Math.max(1, Math.floor(Number(nextEpisode) || 1));

  if (ep === state.episode) {
    if (state.sources.length) {
      void playStream(state.sources[0]);
    } else {
      void loadStreams();
    }
    return;
  }

  state.episode = ep;
  await updateUrlAndReload();
}

const DRAWER_ALIASES = {
  servers: 'serversDrawer',
  sources: 'sourcesDrawer',
  episodes: 'episodesDrawer',
  info: 'infoDrawer',
  comments: 'commentsDrawer'
};

function installBridge() {
  window.AniFrameBridge = {
    version: APP_VERSION,

    // Read-only snapshot for panels that want live context.
    get state() {
      return state;
    },

    currentAnilistId: () => state.anilistId,
    currentEpisode: () => state.episode,
    currentTitle: () => state.animeTitle,
    sourceCount: () => state.sources.length,
    servers: () => SERVERS.map((server) => ({ id: server.id, name: server.name })),

    openDrawer(key) {
      const id = DRAWER_ALIASES[key] || key;
      const drawer = dom[id];
      if (!drawer) return false;
      closeDrawers(drawer, true);
      return true;
    },

    closeDrawers: () => closeDrawers(),

    goToEpisode: (episode) => void goToEpisode(episode),

    nextEpisode: () => {
      state.episode++;
      void updateUrlAndReload();
    },

    prevEpisode: () => {
      if (state.episode <= 1) return;
      state.episode--;
      void updateUrlAndReload();
    },

    rescan: () => void loadStreams(),

    download: () => startDownload(),

    playFirst: () => {
      const stream = state.currentStream || state.sources[0];
      if (stream) void playStream(stream);
    },

    // Extra palette entries contributed by the shell itself.
    actions: () => []
  };
}

// =============================================================================
// 11. Bootstrap
// =============================================================================

async function initApp() {
  if (state.appInitialized) return;
  state.appInitialized = true;

  injectStyles();
  initDom();

  document.body.classList.add('embed-mode');

  placeMobileActions();

  window.addEventListener('resize', placeMobileActions, {
    passive: true
  });

  window.addEventListener('orientationchange', placeMobileActions, {
    passive: true
  });

  initDrawers();
  parseRoute();
  populateLanguages();
  renderDrawers();
  updateControlVisibility();

  bindEvents();
  bindNavigationHotkeys();

  Player.bindVideoHotkeys(() => dom.splashPlayBtn?.click());

  initHUD();

  installBridge();

  document.documentElement.dataset.animeedgeVersion = APP_VERSION;

  state.metadataPromise = loadMetadata();
  void loadStreams();
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => void initApp(),
    { once: true }
  );
} else {
  void initApp();
}
