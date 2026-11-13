/**
 * =============================================================================
 * ANIFRAME PLAYER — v4.0
 * =============================================================================
 * A self-contained video player with a YouTube-style control bar and a
 * VLC / MX Player depth of features tucked behind the gear.
 *
 * Design rules
 *   • One control bar. Nine buttons. Everything else lives in the menu,
 *     organised as YouTube does it: main list → submenu → back.
 *   • Familiar behaviour: tap to play, double-tap to skip, drag to scrub,
 *     swipe for volume/brightness, pinch to zoom, long-press for 2×.
 *   • Quiet chrome: controls fade, cursor hides, gradients only.
 *
 * What's inside
 *   Playback   speed presets + fine slider, quality, audio tracks, loop modes,
 *              A→B repeat, sleep timer, auto-next, auto-skip openings
 *   Display    aspect, zoom, brightness, contrast, colour, night mode, flip,
 *              picture reset
 *   Captions   track list, size, colour, backdrop, position, delay
 *   Controls   double-tap seconds, auto-hide delay, gesture switch, speed memory
 *   Tools      stats for nerds, frame capture, theatre mode, cast, PiP, mini
 *
 * Public API (unchanged)
 *   Player.play({ stream, anilistId, malId, episode, animeTitle, poster, ... })
 *   Player.bindVideoHotkeys(onSplashPlay)
 *   Player.destroy()
 *   Player.mount({ ... })
 *
 * No ArtPlayer dependency: this file owns the whole player surface.
 * =============================================================================
 */

import { buildProxiedMediaUrl } from '/thirdpartyapi.js';
import { ProgressTracker, showPlayerToast } from '/script.js';

/* --------------------------------------------------------------------------
 * 01. Constants
 * ------------------------------------------------------------------------ */

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const SUB_SIZES = [
  ['small', 'Small', '15px'],
  ['medium', 'Medium', '19px'],
  ['large', 'Large', '24px'],
  ['huge', 'Huge', '30px']
];

const SUB_COLORS = [
  ['white', 'White', '#ffffff'],
  ['yellow', 'Yellow', '#ffd94a'],
  ['cyan', 'Cyan', '#8ff0ff'],
  ['green', 'Green', '#a6f36b'],
  ['pink', 'Pink', '#ffa8d4']
];

const SUB_BACKDROPS = [
  ['none', 'None', 'transparent'],
  ['soft', 'Soft', 'rgba(0,0,0,.45)'],
  ['strong', 'Strong', 'rgba(0,0,0,.82)']
];

const SUB_POSITIONS = [
  ['low', 'Low', '14px'],
  ['normal', 'Normal', '0px'],
  ['high', 'High', '-34px']
];

const ASPECTS = [
  ['fit', 'Fit to screen'],
  ['fill', 'Stretch'],
  ['crop', 'Crop to fill'],
  ['16:9', '16:9'],
  ['4:3', '4:3']
];

const LOOP_MODES = [
  ['off', 'Off'],
  ['one', 'Repeat this episode'],
  ['ab', 'Repeat a section (A→B)']
];

const STORE = {
  rate: 'afp_rate',
  volume: 'afp_volume',
  muted: 'afp_muted',
  subSize: 'afp_sub_size',
  subColor: 'afp_sub_color',
  subBg: 'afp_sub_bg',
  subPos: 'afp_sub_pos',
  subDelay: 'afp_sub_delay',
  subTrack: 'afp_sub_track',
  doubleTap: 'afp_double_tap',
  hideDelay: 'afp_hide_delay',
  gestures: 'afp_gestures',
  rememberSpeed: 'afp_remember_speed',
  aspect: 'afp_aspect'
};

/* --------------------------------------------------------------------------
 * 02. Helpers
 * ------------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);

function storageGet(key, fallback = null) {
  try {
    const value = window.localStorage?.getItem(key);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage?.setItem(key, String(value));
  } catch {
    /* private mode */
  }
}

function storageRemove(key) {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    /* noop */
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function fmtTime(seconds, forceHours = false) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0 || forceHours) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function editableTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    )
  );
}

function isLowMemoryDevice() {
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  return (
    (memory > 0 && memory <= 4) ||
    (cores > 0 && cores <= 4) ||
    !!conn?.saveData ||
    /(^|-)2g$|slow-2g/i.test(conn?.effectiveType || '')
  );
}

function safeLabel(value, max = 80) {
  return String(value ?? '')
    .replace(/[<>"'`]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function getUrl(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return ['http:', 'https:', 'blob:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isHlsUrl(url, stream = {}) {
  const value = String(url || '').toLowerCase();
  let path = value;

  try {
    path = new URL(url, location.href).pathname.toLowerCase();
  } catch {
    /* relative */
  }

  return (
    /\.m3u8$/i.test(path) ||
    /hls-proxy|proxy_m3u8|\.m3u8(?:\?|$)/i.test(value) ||
    String(stream.format || '').toLowerCase() === 'm3u8' ||
    String(stream.type || '').toLowerCase() === 'hls'
  );
}

function parseTimestamp(value) {
  const parts = String(value || '')
    .trim()
    .replace(',', '.')
    .split(':')
    .map(Number);

  if (parts.some((part) => Number.isNaN(part))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function parseVtt(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n');
  const cues = [];

  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (!lines.length) continue;

    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;

    const [rawStart, rawEnd] = lines[timeIndex].split('-->');
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(String(rawEnd || '').trim().split(' ')[0]);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const body = lines
      .slice(timeIndex + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .trim();

    if (body) cues.push({ start, end, text: body });
  }

  return cues.sort((a, b) => a.start - b.start);
}

/* --------------------------------------------------------------------------
 * 03. Icons
 * ------------------------------------------------------------------------ */

const ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  next: '<path d="M6 5l9 7-9 7z"/><path d="M17 5h2v14h-2z"/>',
  replay: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
  volume:
    '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  cc: '<rect x="2.5" y="5" width="19" height="14" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 10.2a2.6 2.6 0 1 0 0 3.6M17 10.2a2.6 2.6 0 1 0 0 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  gear: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l1.7-1.3-1.8-3.1-2 .8a7.7 7.7 0 0 0-1.7-1l-.3-2.1h-3.6l-.3 2.1a7.7 7.7 0 0 0-1.7 1l-2-.8L4.9 9.7 6.6 11a7.6 7.6 0 0 0 0 2l-1.7 1.3 1.8 3.1 2-.8a7.7 7.7 0 0 0 1.7 1l.3 2.1h3.6l.3-2.1a7.7 7.7 0 0 0 1.7-1l2 .8 1.8-3.1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  mini: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="12" y="11.5" width="7" height="5.5" rx="1.4" fill="currentColor"/>',
  pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="12.5" y="11" width="7.5" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  full: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  exitFull:
    '<path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  chevron: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M4.5 12.5l4.5 4.5L19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  forward:
    '<path d="M5 12h11M12 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  backward:
    '<path d="M19 12H8M12 7l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  audio:
    '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9.5h5M16 13h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  loop: '<path d="M17 2.5l3.5 3.5L17 9.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M7 21.5L3.5 18 7 14.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  timer: '<circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v4.2l2.8 1.8M9.5 2.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5L9 3h6l2.5 3H21a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  stats: '<path d="M3 17l4.5-5 3.5 3L20 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 21h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  theatre: '<rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 21h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  cast: '<path d="M2 16.5a5.5 5.5 0 0 1 5.5 5.5M2 11.5a10.5 10.5 0 0 1 10.5 10.5M2 6.5A15.5 15.5 0 0 1 17.5 22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><rect x="16" y="3" width="6" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  flip: '<path d="M12 3v18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 3" stroke-linecap="round"/><path d="M9 6.5L3.5 17H9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 6.5L20.5 17H15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  keyboard:
    '<rect x="2" y="6" width="20" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M3 4v5h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  speed: '<path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  screen: '<rect x="2.5" y="4" width="19" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  contrast: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.7-2-.7-2.6c0-.9.8-1.4 1.7-1.4H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8.5" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor"/>'
};

function icon(name, size = 22) {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ` +
    `focusable="false" fill="currentColor">${ICON[name] || ''}</svg>`
  );
}

/* --------------------------------------------------------------------------
 * 04. Engine
 * ------------------------------------------------------------------------ */

const SKIP_CACHE = new Map();

export class VideoPlayerEngine {
  constructor() {
    this.root = null;
    this.video = null;
    this.hls = null;
    this.el = null;

    this.stream = null;
    this.meta = {};
    this.subtitles = [];
    this.cues = [];
    this.baseCues = [];
    this.activeCue = null;
    this.subIndex = -1;
    this.subEnabled = false;

    this.hideTimer = null;
    this.nextCountdown = null;
    this.sleepTimer = null;
    this.flashTimer = null;
    this.holdTimer = null;

    this.skipIntervals = [];
    this.activeSkip = null;
    this.lastSkippedAt = -1;
    this.autoSkip = storageGet('afp_auto_skip', 'false') === 'true';

    this.loopMode = 'off';
    this.ab = { a: null, b: null };
    this.sleepLeft = 0;
    this.nextCancelled = false;

    this.menuOpen = false;
    this.menuView = 'main';

    this.dragging = false;
    this.dragValue = 0;
    this.lastTapAt = 0;
    this.lastTapX = 0;
    this.gesture = null;
    this.pointers = new Map();
    this.pinch = null;
    this.rateBeforeHold = null;

    this.recoveryAttempts = 0;
    this.lastHealthyAt = 0;
    this.lastStatsAt = 0;
    this.lastSavedAt = 0;
    this.lastSavedSecond = -1;

    this.session = 0;
    this.lowMemory = isLowMemoryDevice();

    // Performance profile: auto / smooth / quality
    this.perfSetting = storageGet('afp_perf', 'auto') || 'auto';
    this.perfProfile =
      this.perfSetting === 'auto' ? (this.lowMemory ? 'smooth' : 'quality') : this.perfSetting;
    this.perfSample = null;
    this.perfDowngraded = false;
    this.lastPerfCheck = 0;

    // Torrent embed
    this.torrentId = null;
    this.torrentMagnet = '';
    this.torrentTimer = null;
    this.fullscreen = false;
    this.mini = false;
    this.theater = false;
    this.statsOpen = false;
    this.audioBoost = 1;

    // Picture state
    this.aspect = storageGet(STORE.aspect, 'fit') || 'fit';
    this.zoom = 1;
    this.flip = false;
    this.fx = { brightness: 100, contrast: 100, saturation: 100, night: 0 };

    // Caption state
    this.subSize = storageGet(STORE.subSize, 'medium');
    this.subColor = storageGet(STORE.subColor, 'white');
    this.subBg = storageGet(STORE.subBg, 'soft');
    this.subPos = storageGet(STORE.subPos, 'normal');
    this.subDelay = Number(storageGet(STORE.subDelay, 0)) || 0;

    // Control state
    this.doubleTapSeconds = Number(storageGet(STORE.doubleTap, 10)) || 10;
    this.hideDelay = Number(storageGet(STORE.hideDelay, 3000)) || 3000;
    this.gesturesOn = storageGet(STORE.gestures, 'true') !== 'false';
    this.rememberSpeed = storageGet(STORE.rememberSpeed, 'true') !== 'false';

    this._bound = {};
  }

  /* ------------------------------------------------------------------ play */

  async play({
    stream,
    anilistId,
    malId = null,
    episode = 1,
    animeTitle = 'Anime',
    poster = '',
    episodeDurationSec = 1440,
    onNextEpisode = null,
    onPreviousEpisode = null,
    onError = null
  } = {}) {
    if (!stream || typeof stream !== 'object') return;

    this.destroy();

    const host = $('#artplayerContainer');
    const torrentHost = $('#torrentPlayerContainer');
    const iframe = $('#torrentIframe');

    const isTorrent = !!(
      stream.isTorrent ||
      stream.type === 'torrent' ||
      stream.delivery === 'p2p' ||
      stream.infoHash ||
      stream.magnetUri ||
      /^magnet:/i.test(stream.url || '')
    );

    let rawUrl = String(
      stream.directUrl ||
      stream.fileUrl ||
      stream.url ||
      stream.originalUrl ||
      stream.downloadUrl ||
      stream.magnetUri ||
      ''
    ).trim();

    if (!rawUrl && !isTorrent) {
      onError?.('Playback error', 'This source has no playable link.');
      return;
    }

    const urlObj = getUrl(rawUrl);
    const hostName = urlObj?.hostname?.toLowerCase() || '';

    const isEmbed = !isTorrent && !!(
      stream.isEmbed ||
      stream.type === 'embed' ||
      stream.format === 'embed' ||
      /(^|\.)(flixcloud|vidmoly|abyssplayer|rubystm|upns\.pro|megaplay|4anime|ansembed|sendvid)/i.test(hostName)
    );

    /* ---- embed ---- */
    if (isEmbed) {
      if (!urlObj || !['http:', 'https:'].includes(urlObj.protocol)) {
        onError?.('Playback error', 'Invalid embed link.');
        return;
      }

      if (host) host.style.display = 'none';
      if (torrentHost) {
        torrentHost.style.display = 'none';
        torrentHost.replaceChildren();
      }

      if (!iframe) {
        onError?.('Playback error', 'The player frame is missing.');
        return;
      }

      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads allow-popups'
      );
      iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
      iframe.style.display = 'block';
      iframe.src = urlObj.href;
      return;
    }

    /* ---- torrent ---- */
    if (isTorrent) {
      if (host) host.style.display = 'none';
      if (iframe) {
        iframe.style.display = 'none';
        iframe.src = 'about:blank';
      }

      if (!torrentHost) {
        onError?.('Playback error', 'The torrent player is missing.');
        return;
      }

      torrentHost.style.display = 'block';
      torrentHost.replaceChildren();

      const infoHash = String(stream.infoHash || '').trim();
      const magnet = String(
        stream.magnetUri || rawUrl || (infoHash ? `magnet:?xt=urn:btih:${infoHash}` : '')
      ).trim();

      if (!/^magnet:\?xt=urn:btih:[a-z0-9]{32,40}/i.test(magnet)) {
        onError?.('Playback error', 'This torrent has no valid magnet link.');
        torrentHost.style.display = 'none';
        return;
      }

      this.mountTorrent(magnet, stream);
      return;
    }

    /* ---- direct / HLS ---- */
    if (!urlObj || !['http:', 'https:', 'blob:'].includes(urlObj.protocol)) {
      onError?.('Playback error', 'This link is not playable.');
      return;
    }

    if (iframe) {
      iframe.style.display = 'none';
      iframe.src = 'about:blank';
    }

    if (torrentHost) {
      torrentHost.style.display = 'none';
      torrentHost.replaceChildren();
    }

    if (host) host.style.display = 'block';

    // IP-host compatibility workaround.
    if (
      /^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/|$)/i.test(rawUrl) &&
      !rawUrl.includes('/api/v1/media-proxy')
    ) {
      rawUrl = buildProxiedMediaUrl(rawUrl.replace(/^https:\/\//i, 'http://'));
    }

    const proxyHosts = [
      'hakunaymatata.com',
      'nexabloom.top',
      'dramahot.top',
      'drama1.cfd',
      'startupmomentumengine.site',
      'harborstatic.lol',
      'vid-cdn.xyz'
    ];

    if (
      !rawUrl.includes('/api/v1/media-proxy') &&
      proxyHosts.some((domain) => rawUrl.toLowerCase().includes(domain))
    ) {
      let referer = stream.headers?.Referer || stream.serverHeaders?.Referer || '';

      if (!referer && rawUrl.includes('hakunaymatata')) referer = 'https://mzfi.me/';
      else if (!referer && rawUrl.includes('vid-cdn')) referer = 'https://anizone.to/';
      else if (!referer && /drama1\.cfd|dramahot/.test(rawUrl)) referer = 'https://anikoto.cz/';

      rawUrl = buildProxiedMediaUrl(rawUrl, referer);
    }

    let saved = null;
    try {
      saved = anilistId ? ProgressTracker.get(anilistId) : null;
    } catch {
      /* storage blocked */
    }

    const initialTime =
      saved && String(saved.episode) === String(episode)
        ? Math.max(0, Number(saved.time) || 0)
        : 0;

    try {
      await this.mount({
        url: rawUrl,
        poster,
        isM3u8: isHlsUrl(rawUrl, stream),
        subtitles: stream.subtitles,
        initialTime,
        malId,
        episode,
        episodeDurationSec,
        onNextEpisode,
        onPreviousEpisode,
        animeTitle,
        anilistId,
        onError
      });
    } catch (error) {
      console.error('[Player] mount failed', error);
      try {
        onError?.('Playback error', error?.message || 'The player could not start.');
      } catch {
        /* noop */
      }
      showPlayerToast('Could not start this stream. Try another server.', 'error', 2600);
      this.destroy();
    }
  }

  /* ----------------------------------------------------------------- mount */

  async mount({
    url,
    poster = '',
    isM3u8 = false,
    subtitles = [],
    initialTime = 0,
    malId = null,
    episode = 1,
    episodeDurationSec = 1440,
    onNextEpisode = null,
    onPreviousEpisode = null,
    animeTitle = 'Anime',
    anilistId = null,
    onError = null,
    onTimeUpdate = null,
    onEnded = null
  } = {}) {
    if (!url) throw new Error('A playable link is required.');

    const host = $('#artplayerContainer');
    if (!host) throw new Error('Player container is missing.');

    // A torrent session hides this host; a direct stream must bring it back.
    host.style.display = 'block';

    this.clearTorrent();

    this.session += 1;
    const session = this.session;

    this.meta = {
      animeTitle,
      episode,
      poster,
      anilistId,
      malId,
      duration: episodeDurationSec,
      onNextEpisode,
      onPreviousEpisode,
      onError,
      onTimeUpdate,
      onEnded
    };

    // Park the other two engines so nothing paints over the video.
    const iframe = $('#torrentIframe');
    if (iframe) {
      iframe.style.display = 'none';
      if (iframe.src && iframe.src !== 'about:blank') iframe.src = 'about:blank';
    }

    const torrentHost = $('#torrentPlayerContainer');
    if (torrentHost) {
      torrentHost.style.display = 'none';
      torrentHost.replaceChildren();
    }

    document.body.classList.add('afp-playing');

    host.replaceChildren();
    this.buildShell(host, poster, animeTitle, episode);

    // Remove any legacy enhancement overlays so this player owns the surface.
    host
      .querySelectorAll('[data-nxp], .nx-guard-veil, .art-video-player')
      .forEach((node) => node.remove());

    try {
      this.surfaceGuard?.disconnect();
      this.surfaceGuard = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && !node.classList.contains('afp')) node.remove();
          }
        }
      });
      this.surfaceGuard.observe(host, { childList: true });
    } catch {
      /* observer unsupported */
    }

    this.applyPicture();
    this.applySubtitleStyle();

    this.loadSource(url, isM3u8);
    this.bindEverything();

    this.subtitles = Array.isArray(subtitles) ? subtitles.filter((item) => item?.url) : [];
    this.loadSubtitleTrack();

    if (malId) {
      this.fetchSkipTimes(malId, episode, episodeDurationSec).then((items) => {
        if (session === this.session) this.skipIntervals = items;
      });
    }

    const video = this.video;

    video.addEventListener('loadedmetadata', () => {
      if (session !== this.session) return;

      if (
        initialTime > 10 &&
        Number.isFinite(video.duration) &&
        initialTime < video.duration - 10
      ) {
        video.currentTime = initialTime;
        this.flash('forward', `Resumed at ${fmtTime(initialTime)}`);
      }

      this.updateTime();
      this.updateQualityChip();
    });

    this.setupMediaSession();
    this.updateControlsState();

    return this;
  }

  /* ------------------------------------------------------------- build UI */

  buildShell(host, poster, title, episode) {
    const root = document.createElement('div');
    root.className = 'afp';
    root.dataset.state = 'paused';
    root.dataset.aspect = this.aspect;
    root.dataset.perf = this.perfProfile;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Video player');

    root.innerHTML = `
      <video class="afp-video" playsinline webkit-playsinline preload="auto"
             ${poster ? `poster="${safeLabel(poster, 500)}"` : ''}
             aria-label="${safeLabel(`${title} episode ${episode}`, 120)}"></video>

      <div class="afp-captions" aria-live="polite"></div>

      <div class="afp-scrim afp-scrim--top"></div>
      <div class="afp-scrim afp-scrim--bottom"></div>

      <div class="afp-top">
        <div class="afp-top__text">
          <span class="afp-top__title">${safeLabel(title, 90)}</span>
          <span class="afp-top__ep">Episode ${episode}</span>
        </div>
        <span class="afp-chip" data-quality hidden></span>
      </div>

      <button class="afp-bigplay" type="button" aria-label="Play">${icon('play', 30)}</button>

      <div class="afp-spinner" aria-hidden="true"><span></span></div>

      <div class="afp-flash" aria-hidden="true">
        <div class="afp-flash__icon"></div>
        <div class="afp-flash__text"></div>
      </div>

      <div class="afp-ripple afp-ripple--l" aria-hidden="true">${icon('backward', 26)}</div>
      <div class="afp-ripple afp-ripple--r" aria-hidden="true">${icon('forward', 26)}</div>

      <button class="afp-skip" type="button" hidden>Skip intro</button>

      <div class="afp-next" hidden>
        <div class="afp-next__body">
          <span class="afp-next__label">Up next</span>
          <span class="afp-next__title">Episode ${Number(episode) + 1}</span>
          <span class="afp-next__timer">Starting in <b>10</b>s</span>
        </div>
        <div class="afp-next__actions">
          <button class="afp-next__cancel" type="button">Cancel</button>
          <button class="afp-next__go" type="button">Play now</button>
        </div>
      </div>

      <div class="afp-error" hidden>
        <span class="afp-error__title">Something went wrong</span>
        <span class="afp-error__text">This video could not be played.</span>
        <button class="afp-error__retry" type="button">Try again</button>
      </div>

      <div class="afp-stats" hidden>
        <div class="afp-stats__head"><span>Stats for nerds</span>
          <button class="afp-stats__close" type="button" aria-label="Close">${icon('close', 16)}</button>
        </div>
        <div class="afp-stats__grid"></div>
      </div>

      <div class="afp-badges">
        <span class="afp-badge" data-badge="speed" hidden></span>
        <span class="afp-badge" data-badge="loop" hidden></span>
        <span class="afp-badge" data-badge="sleep" hidden></span>
      </div>

      <div class="afp-bottom">
        <div class="afp-progress" role="slider" tabindex="0"
             aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="afp-progress__track">
            <div class="afp-progress__buffer"></div>
            <div class="afp-progress__played"></div>
            <div class="afp-progress__marks"></div>
            <div class="afp-progress__ab"></div>
            <div class="afp-progress__thumb"></div>
          </div>
          <div class="afp-progress__tip"><span></span></div>
        </div>

        <div class="afp-bar">
          <div class="afp-bar__left">
            <button class="afp-btn afp-btn--play" data-act="play" type="button" aria-label="Play">${icon('play')}</button>
            <button class="afp-btn afp-btn--next" data-act="next" type="button" aria-label="Next episode">${icon('next')}</button>

            <div class="afp-vol">
              <button class="afp-btn" data-act="mute" type="button" aria-label="Mute">${icon('volume')}</button>
              <div class="afp-vol__slider">
                <input type="range" min="0" max="100" step="1" value="100" aria-label="Volume" />
              </div>
            </div>

            <div class="afp-time">
              <span class="afp-time__cur">0:00</span>
              <span class="afp-time__sep">/</span>
              <span class="afp-time__dur">0:00</span>
            </div>
          </div>

          <div class="afp-bar__right">
            <button class="afp-btn afp-btn--cc" data-act="cc" type="button" aria-label="Subtitles" hidden>${icon('cc')}</button>
            <button class="afp-btn" data-act="settings" type="button" aria-label="Settings">${icon('gear')}</button>
            <button class="afp-btn afp-btn--mini" data-act="mini" type="button" aria-label="Mini player">${icon('mini')}</button>
            <button class="afp-btn afp-btn--pip" data-act="pip" type="button" aria-label="Picture in picture">${icon('pip')}</button>
            <button class="afp-btn" data-act="full" type="button" aria-label="Full screen">${icon('full')}</button>
          </div>
        </div>
      </div>

      <div class="afp-menu" hidden>
        <div class="afp-menu__head">
          <button class="afp-menu__back" type="button" aria-label="Back">${icon('back', 20)}</button>
          <span class="afp-menu__title">Settings</span>
          <button class="afp-menu__close" type="button" aria-label="Close">${icon('close', 18)}</button>
        </div>
        <div class="afp-menu__body" role="menu"></div>
      </div>
    `;

    host.appendChild(root);

    this.root = root;
    this.video = $('.afp-video', root);

    // On weak hardware, fetching the whole file up front costs more than it saves.
    this.video.preload = this.perfProfile === 'smooth' ? 'metadata' : 'auto';
    this.el = {
      bigPlay: $('.afp-bigplay', root),
      spinner: $('.afp-spinner', root),
      flash: $('.afp-flash', root),
      flashIcon: $('.afp-flash__icon', root),
      flashText: $('.afp-flash__text', root),
      rippleL: $('.afp-ripple--l', root),
      rippleR: $('.afp-ripple--r', root),
      skip: $('.afp-skip', root),
      next: $('.afp-next', root),
      nextTimer: $('.afp-next__timer b', root),
      error: $('.afp-error', root),
      errorText: $('.afp-error__text', root),
      stats: $('.afp-stats', root),
      statsGrid: $('.afp-stats__grid', root),
      progress: $('.afp-progress', root),
      track: $('.afp-progress__track', root),
      buffer: $('.afp-progress__buffer', root),
      played: $('.afp-progress__played', root),
      marks: $('.afp-progress__marks', root),
      ab: $('.afp-progress__ab', root),
      thumb: $('.afp-progress__thumb', root),
      tip: $('.afp-progress__tip', root),
      tipText: $('.afp-progress__tip span', root),
      cur: $('.afp-time__cur', root),
      dur: $('.afp-time__dur', root),
      play: $('[data-act="play"]', root),
      nextBtn: $('[data-act="next"]', root),
      mute: $('[data-act="mute"]', root),
      volume: $('.afp-vol__slider input', root),
      cc: $('[data-act="cc"]', root),
      settings: $('[data-act="settings"]', root),
      mini: $('[data-act="mini"]', root),
      pip: $('[data-act="pip"]', root),
      full: $('[data-act="full"]', root),
      menu: $('.afp-menu', root),
      menuBody: $('.afp-menu__body', root),
      menuTitle: $('.afp-menu__title', root),
      menuBack: $('.afp-menu__back', root),
      captions: $('.afp-captions', root),
      quality: $('[data-quality]', root),
      top: $('.afp-top', root),
      badgeSpeed: $('[data-badge="speed"]', root),
      badgeLoop: $('[data-badge="loop"]', root),
      badgeSleep: $('[data-badge="sleep"]', root)
    };

    const savedVolume = clamp(storageGet(STORE.volume, 1), 0, 1);
    const savedMuted = storageGet(STORE.muted, 'false') === 'true';
    const savedRate = Number(storageGet(STORE.rate, 1)) || 1;

    this.video.volume = savedVolume;
    this.video.muted = savedMuted;

    if (this.rememberSpeed && savedRate !== 1) {
      this.video.playbackRate = clamp(savedRate, 0.25, 3);
    }

    this.el.volume.value = String(Math.round(savedVolume * 100));
    this.updateVolumeIcon();

    if (this.el.cc) this.el.cc.hidden = true;
    if (this.el.nextBtn) this.el.nextBtn.hidden = !this.meta.onNextEpisode;
    this.updateBadges();
  }

  /* -------------------------------------------------------------- torrent */

  /**
   * Torrent playback runs inside WebTor's own player.
   *
   * The magnet goes straight into the URL — that is WebTor's documented
   * "direct link" form (`/show?magnet=…`). We deliberately do NOT add an
   * `?id=` session parameter: with an id present the site switches into SDK
   * mode, waits for a postMessage handshake, and renders its marketing home
   * page if that handshake never arrives (which is exactly the bug this
   * replaces).
   *
   * The frame is sandboxed without `allow-top-navigation`, so the site can
   * never replace the page you are watching on, and there is always a manual
   * "Open on WebTor" pill if a torrent genuinely has no peers.
   */
  mountTorrent(magnet, stream = {}) {
    const host = $('#torrentPlayerContainer');
    if (!host) return;

    this.clearTorrent();

    document.body.classList.remove('afp-playing');

    const artHost = $('#artplayerContainer');
    if (artHost) artHost.style.display = 'none';

    const embedFrame = $('#torrentIframe');
    if (embedFrame) {
      embedFrame.style.display = 'none';
      if (embedFrame.src && embedFrame.src !== 'about:blank') embedFrame.src = 'about:blank';
    }

    host.style.display = 'block';
    host.classList.add('afp-torrent');
    host.replaceChildren();

    const encoded = encodeURIComponent(magnet);

    // 1) player view with the magnet in the query, 2) WebTor's direct link.
    this.torrentSources = [
      `https://webtor.io/show?magnet=${encoded}&mode=video&pwd=%2F`,
      `https://webtor.io/${encoded}`
    ];
    this.torrentIndex = 0;
    this.torrentLoaded = false;
    this.torrentMagnet = magnet;

    const frame = document.createElement('iframe');
    frame.className = 'afp-torrent__frame';
    frame.title = 'Torrent player';
    frame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('webkitallowfullscreen', '');
    frame.setAttribute('mozallowfullscreen', '');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('referrerpolicy', 'origin');
    // No allow-top-navigation: the frame can never take over this tab.
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups allow-downloads'
    );

    const status = document.createElement('div');
    status.className = 'afp-torrent__status';
    status.innerHTML = `
      <span class="afp-torrent__spin"></span>
      <b>Connecting to peers…</b>
      <em>Streaming the torrent inside your browser</em>
    `;

    const pill = document.createElement('a');
    pill.className = 'afp-torrent__pill';
    pill.href = `https://webtor.io/show?magnet=${encoded}&mode=default`;
    pill.target = '_blank';
    pill.rel = 'noopener noreferrer';
    pill.textContent = 'Open on WebTor';

    const fallback = document.createElement('div');
    fallback.className = 'afp-torrent__fallback';
    fallback.hidden = true;
    fallback.innerHTML = `
      <b>The torrent player did not load</b>
      <p>Check your connection, then try again. Torrents also need at least one peer online.</p>
      <div class="afp-torrent__actions">
        <button type="button" data-retry>Try again</button>
        <a href="https://webtor.io/show?magnet=${encoded}&mode=default"
           target="_blank" rel="noopener noreferrer">Open on WebTor</a>
      </div>
    `;

    host.append(frame, status, pill, fallback);

    frame.addEventListener('load', () => {
      this.torrentLoaded = true;
      status.classList.add('is-hidden');
      fallback.hidden = true;
    });

    frame.addEventListener('error', () => this.tryNextTorrentSource());

    fallback.querySelector('[data-retry]')?.addEventListener('click', () => {
      this.mountTorrent(magnet, stream);
    });

    frame.src = this.torrentSources[0];

    // Only cover the frame if it never loaded at all.
    this.torrentTimer = setTimeout(() => {
      if (!this.torrentLoaded) this.tryNextTorrentSource();
    }, 15000);

    this.torrentFrame = frame;
    this.torrentStatus = status;
    this.torrentFallback = fallback;
  }

  tryNextTorrentSource() {
    if (!this.torrentFrame) return;

    this.torrentIndex += 1;

    if (this.torrentIndex < (this.torrentSources?.length || 0)) {
      this.torrentLoaded = false;
      this.torrentStatus?.classList.remove('is-hidden');
      this.torrentFrame.src = this.torrentSources[this.torrentIndex];
      return;
    }

    this.torrentStatus?.classList.add('is-hidden');
    if (this.torrentFallback) this.torrentFallback.hidden = false;
  }

  clearTorrent() {
    clearTimeout(this.torrentTimer);
    this.torrentTimer = null;
    this.torrentFrame = null;
    this.torrentStatus = null;
    this.torrentFallback = null;
    this.torrentLoaded = false;

    const host = $('#torrentPlayerContainer');
    if (host) {
      host.replaceChildren();
      host.classList.remove('afp-torrent');
    }
  }

  /* --------------------------------------------------------------- source */
  /* --------------------------------------------------------------- source */

  loadSource(url, isM3u8) {
    const video = this.video;
    const HlsClass = window.Hls;

    this.root.dataset.state = 'loading';
    this.showSpinner(true);

    if (isM3u8 && HlsClass && typeof HlsClass.isSupported === 'function' && HlsClass.isSupported()) {
      const compact = this.lowMemory;
      const smooth = this.perfProfile === 'smooth';

      const hls = new HlsClass({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        startLevel: -1,
        maxBufferLength: smooth ? 12 : compact ? 18 : 30,
        maxMaxBufferLength: smooth ? 20 : compact ? 30 : 48,
        maxBufferSize: smooth ? 12e6 : compact ? 20e6 : 40e6,
        backBufferLength: smooth ? 8 : compact ? 12 : 30,
        abrEwmaDefaultEstimate: smooth ? 800000 : 500000,
        startFragPrefetch: true
      });

      this.hls = hls;

      hls.on(HlsClass.Events.ERROR, (_event, data) => this.onHlsError(data, HlsClass));

      hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
        // Smooth profile: never let a weak GPU decode above 720p on its own.
        if (smooth && hls.levels?.length) {
          const cap = hls.levels.reduce(
            (best, level, index) => (level.height && level.height <= 720 ? index : best),
            0
          );
          hls.autoLevelCapping = cap;
        }

        this.updateQualityChip();
        if (this.menuOpen) this.renderMenu();
      });

      hls.on(HlsClass.Events.LEVEL_SWITCHED, () => {
        this.updateQualityChip();
        if (this.menuOpen && this.menuView === 'quality') this.renderMenu();
      });

      hls.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => {
        if (this.menuOpen) this.renderMenu();
      });

      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isM3u8 && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      video.src = url;
    }

    const attempt = video.play();

    if (attempt?.catch) {
      attempt.catch(() => {
        this.root.dataset.state = 'paused';
        this.showSpinner(false);
        this.showControls(true);
      });
    }
  }

  onHlsError(data, HlsClass) {
    if (!data?.fatal) return;

    if (this.recoveryAttempts >= 3) {
      this.showError('This stream keeps failing. Try another server.');
      return;
    }

    this.recoveryAttempts += 1;
    const delay = Math.min(700 * this.recoveryAttempts, 2200);

    setTimeout(() => {
      try {
        if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) this.hls?.startLoad();
        else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) this.hls?.recoverMediaError();
        else this.showError('This video format is not supported.');
      } catch {
        this.showError('Playback stopped unexpectedly.');
      }
    }, delay);
  }

  /* ---------------------------------------------------------- subtitles */

  async loadSubtitleTrack() {
    const list = this.subtitles;
    if (!this.el.cc) return;

    if (!list.length) {
      this.el.cc.hidden = true;
      return;
    }

    this.el.cc.hidden = false;

    const saved = storageGet(STORE.subTrack, 'off');
    const index = saved === 'off' ? -1 : Number(saved);
    const chosen = Number.isInteger(index) && list[index] ? index : -1;

    this.subIndex = chosen;
    this.subEnabled = chosen >= 0;

    if (chosen >= 0) await this.activateSubtitle(chosen);
    this.el.cc.classList.toggle('is-on', this.subEnabled);
  }

  async activateSubtitle(index) {
    const track = this.subtitles[index];
    if (!track?.url) return false;

    const target = getUrl(track.url);
    if (!target) return false;

    try {
      const response = await fetch(target.href, { credentials: 'omit' });
      if (!response.ok) throw new Error('bad response');
      const text = await response.text();
      const cues = parseVtt(text);

      if (!cues.length) throw new Error('no cues');

      this.baseCues = cues;
      this.applySubtitleDelay();
      this.activeCue = null;
      this.subIndex = index;
      this.subEnabled = true;
      storageSet(STORE.subTrack, index);
      this.el.cc?.classList.add('is-on');
      return true;
    } catch {
      // Fall back to a native track element (no styling, but it plays).
      const video = this.video;
      video.querySelector('track')?.remove();

      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = safeLabel(track.label || track.lang || `Track ${index + 1}`, 40);
      el.srclang = safeLabel(track.lang || 'en', 8);
      el.src = target.href;
      el.default = true;
      video.appendChild(el);

      this.baseCues = [];
      this.cues = [];
      this.subIndex = index;
      this.subEnabled = true;
      storageSet(STORE.subTrack, index);
      this.el.cc?.classList.add('is-on');
      showPlayerToast('Subtitles loaded in basic mode.', 'info', 1800);
      return true;
    }
  }

  disableSubtitles() {
    this.subEnabled = false;
    this.cues = [];
    this.baseCues = [];
    this.activeCue = null;
    if (this.el?.captions) this.el.captions.textContent = '';
    this.video?.querySelector('track')?.remove();
    if (this.video?.textTracks?.[0]) this.video.textTracks[0].mode = 'disabled';
    storageSet(STORE.subTrack, 'off');
    this.el?.cc?.classList.remove('is-on');
  }

  applySubtitleDelay() {
    const offset = Number(this.subDelay) || 0;
    this.cues = this.baseCues
      .map((cue) => ({
        start: Math.max(0, cue.start + offset),
        end: Math.max(0.1, cue.end + offset),
        text: cue.text
      }))
      .sort((a, b) => a.start - b.start);
    this.activeCue = null;
    if (this.el?.captions) this.el.captions.textContent = '';
  }

  renderCue(time) {
    if (!this.subEnabled || !this.cues.length || !this.el?.captions) return;

    let active = null;
    for (const cue of this.cues) {
      if (time >= cue.start && time < cue.end) {
        active = cue;
        break;
      }
      if (cue.start > time) break;
    }

    if (active === this.activeCue) return;
    this.activeCue = active;
    this.el.captions.textContent = active ? active.text : '';
  }

  applySubtitleStyle() {
    if (!this.root) return;

    const size = SUB_SIZES.find((item) => item[0] === this.subSize) || SUB_SIZES[1];
    const color = SUB_COLORS.find((item) => item[0] === this.subColor) || SUB_COLORS[0];
    const bg = SUB_BACKDROPS.find((item) => item[0] === this.subBg) || SUB_BACKDROPS[1];
    const pos = SUB_POSITIONS.find((item) => item[0] === this.subPos) || SUB_POSITIONS[1];

    this.root.style.setProperty('--afp-cue-size', size[2]);
    this.root.style.setProperty('--afp-cue-color', color[2]);
    this.root.style.setProperty('--afp-cue-bg', bg[2]);
    this.root.style.setProperty('--afp-cue-offset', pos[2]);
  }

  /* -------------------------------------------------------------- AniSkip */

  async fetchSkipTimes(malId, episode, episodeLengthSec) {
    const id = Number.parseInt(malId, 10);
    const ep = Number.parseInt(episode, 10);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(ep) || ep <= 0) return [];

    const key = `${id}_${ep}`;
    if (SKIP_CACHE.has(key)) return SKIP_CACHE.get(key);

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), 5000);

    try {
      const url = new URL(`https://api.aniskip.com/v2/skip-times/${id}/${ep}`);
      for (const type of ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed']) {
        url.searchParams.append('types', type);
      }
      url.searchParams.set('episodeLength', String(clamp(episodeLengthSec, 60, 7200)));

      const response = await fetch(url, {
        signal: controller?.signal,
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) return [];

      const data = await response.json();
      const intervals =
        data?.found && Array.isArray(data.results)
          ? data.results
              .map((item) => ({
                type: safeLabel(item?.skipType, 24),
                startTime: Number(item?.interval?.startTime),
                endTime: Number(item?.interval?.endTime)
              }))
              .filter(
                (item) =>
                  Number.isFinite(item.startTime) &&
                  Number.isFinite(item.endTime) &&
                  item.startTime >= 0 &&
                  item.endTime > item.startTime
              )
          : [];

      if (SKIP_CACHE.size > 200) SKIP_CACHE.clear();
      SKIP_CACHE.set(key, intervals);
      return intervals;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /* -------------------------------------------------------------- binding */

  bindEverything() {
    const root = this.root;
    const video = this.video;
    const b = this._bound;

    b.rootPointerMove = () => {
      if (this._moveFrame) return;
      this._moveFrame = requestAnimationFrame(() => {
        this._moveFrame = 0;
        this.showControls();
      });
    };
    b.rootPointerLeave = () => {
      if (!video.paused) this.scheduleHide(700);
    };

    root.addEventListener('pointermove', b.rootPointerMove, { passive: true });
    root.addEventListener('pointerleave', b.rootPointerLeave, { passive: true });

    /* ---- centre tap / double tap ---- */
    b.stageTap = (event) => {
      if (event.target.closest('button, input, .afp-menu, .afp-progress, .afp-next')) return;
      if (this.dragging) return;

      event.stopPropagation();

      if (this.menuOpen) {
        this.closeMenu();
        return;
      }

      const rect = root.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const now = Date.now();

      if (now - this.lastTapAt < 300 && Math.abs(x - this.lastTapX) < 80) {
        const ratio = x / Math.max(1, rect.width);
        if (ratio > 0.62) this.seekBy(this.doubleTapSeconds, true);
        else if (ratio < 0.38) this.seekBy(-this.doubleTapSeconds, true);
        else this.togglePlay();
        this.lastTapAt = 0;
        return;
      }

      this.lastTapAt = now;
      this.lastTapX = x;

      clearTimeout(b.singleTapTimer);
      b.singleTapTimer = setTimeout(() => this.togglePlay(), 230);
    };

    root.addEventListener('click', b.stageTap);

    /* ---- play / pause ---- */
    this.el.play.addEventListener('click', () => this.togglePlay());
    this.el.bigPlay.addEventListener('click', () => this.togglePlay());

    /* ---- next ---- */
    this.el.nextBtn?.addEventListener('click', () => this.meta.onNextEpisode?.());

    /* ---- volume ---- */
    this.el.mute.addEventListener('click', () => {
      this.video.muted = !this.video.muted;
      storageSet(STORE.muted, this.video.muted);
      this.updateVolumeIcon();
      this.flash(
        this.video.muted ? 'mute' : 'volume',
        this.video.muted ? 'Muted' : `${Math.round(this.video.volume * 100)}%`
      );
    });

    this.el.volume.addEventListener('input', () => {
      const value = clamp(Number(this.el.volume.value) / 100, 0, 1);
      this.video.volume = value;
      this.video.muted = value === 0;
      storageSet(STORE.volume, value);
      storageSet(STORE.muted, this.video.muted);
      this.updateVolumeIcon();
    });

    /* ---- captions ---- */
    this.el.cc.addEventListener('click', () => {
      if (this.subEnabled) {
        this.disableSubtitles();
        showPlayerToast('Subtitles off', 'info', 1200);
      } else if (this.subtitles.length) {
        this.activateSubtitle(0).then((ok) => {
          if (ok) showPlayerToast('Subtitles on', 'success', 1200);
        });
      }
    });

    /* ---- settings ---- */
    this.el.settings.addEventListener('click', () => this.toggleMenu());

    /* ---- mini / pip / fullscreen ---- */
    this.el.mini.addEventListener('click', () => this.toggleMini());
    this.el.pip.addEventListener('click', () => this.togglePip());
    this.el.full.addEventListener('click', () => this.toggleFullscreen());

    /* ---- progress ---- */
    this.bindProgress();

    /* ---- menu ---- */
    this.el.menuBack.addEventListener('click', () => {
      if (this.menuView === 'main') this.closeMenu();
      else this.setMenuView('main');
    });

    $('.afp-menu__close', root).addEventListener('click', () => this.closeMenu());

    /* ---- skip ---- */
    this.el.skip.addEventListener('click', () => this.applySkip());

    /* ---- next episode card ---- */
    $('.afp-next__cancel', root).addEventListener('click', () => {
      this.nextCancelled = true;
      this.el.next.hidden = true;
      clearInterval(this.nextCountdown);
    });

    $('.afp-next__go', root).addEventListener('click', () => {
      this.nextCancelled = true;
      this.el.next.hidden = true;
      clearInterval(this.nextCountdown);
      this.meta.onNextEpisode?.();
    });

    /* ---- error retry ---- */
    $('.afp-error__retry', root).addEventListener('click', () => {
      this.el.error.hidden = true;
      this.recoveryAttempts = 0;
      this.hls?.startLoad();
      this.video.load();
      this.video.play().catch(() => {});
    });

    /* ---- stats close ---- */
    $('.afp-stats__close', root).addEventListener('click', () => this.toggleStats(false));

    /* ---- video events ---- */
    b.timeUpdate = () => this.onTimeUpdate();
    b.progress = () => this.updateBuffer();
    b.playing = () => {
      this.root.dataset.state = 'playing';
      this.showSpinner(false);
      this.updateControlsState();
      this.scheduleHide();
      this.recoveryAttempts = 0;
    };
    b.pause = () => {
      this.root.dataset.state = 'paused';
      this.showControls(true);
      this.updateControlsState();
    };
    b.waiting = () => {
      this.showSpinner(true);
      this.showControls(true);
    };
    b.canplay = () => this.showSpinner(false);
    b.volume = () => {
      this.el.volume.value = String(Math.round((this.video.muted ? 0 : this.video.volume) * 100));
      this.updateVolumeIcon();
    };
    b.rate = () => {
      this.updateBadges();
      if (this.menuOpen) this.renderMenu();
    };
    b.ended = () => this.onEnded();
    b.error = () => {
      if (!this.video.src) return;
      this.showError('This video could not be played.');
    };
    b.fullscreen = () => {
      this.fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      this.el.full.innerHTML = icon(this.fullscreen ? 'exitFull' : 'full');
      this.el.full.setAttribute('aria-label', this.fullscreen ? 'Exit full screen' : 'Full screen');
      this.root.classList.toggle('is-fullscreen', this.fullscreen);
    };
    b.keydown = (event) => this.onKeydown(event);

    video.addEventListener('timeupdate', b.timeUpdate);
    video.addEventListener('progress', b.progress);
    video.addEventListener('playing', b.playing);
    video.addEventListener('play', b.playing);
    video.addEventListener('pause', b.pause);
    video.addEventListener('waiting', b.waiting);
    video.addEventListener('canplay', b.canplay);
    video.addEventListener('volumechange', b.volume);
    video.addEventListener('ratechange', b.rate);
    video.addEventListener('ended', b.ended);
    video.addEventListener('error', b.error);
    document.addEventListener('fullscreenchange', b.fullscreen);
    document.addEventListener('webkitfullscreenchange', b.fullscreen);
    document.addEventListener('keydown', b.keydown);

    this.bindGestures();
    this.bindDragAndDrop();

    this.showControls(true);
    this.updateControlsState();
  }

  /* -------------------------------------------------------------- progress */

  bindProgress() {
    const bar = this.el.progress;

    const ratioFromEvent = (event) => {
      const rect = bar.getBoundingClientRect();
      return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    };

    const preview = (ratio) => {
      const duration = this.video.duration || 0;
      this.el.tip.style.left = `${ratio * 100}%`;
      this.el.tipText.textContent = fmtTime(ratio * duration, duration >= 3600);
      bar.classList.add('is-hover');
    };

    bar.addEventListener('pointerenter', () => bar.classList.add('is-hover'));
    bar.addEventListener('pointerleave', () => {
      if (!this.dragging) bar.classList.remove('is-hover');
    });

    bar.addEventListener('pointermove', (event) => {
      const ratio = ratioFromEvent(event);
      preview(ratio);

      if (!this.dragging) return;

      this.dragValue = ratio;
      const duration = this.video.duration || 0;
      this.el.played.style.width = `${ratio * 100}%`;
      this.el.thumb.style.left = `${ratio * 100}%`;
      this.el.cur.textContent = fmtTime(ratio * duration, duration >= 3600);
    });

    bar.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dragging = true;
      bar.classList.add('is-dragging');
      bar.setPointerCapture?.(event.pointerId);
      this.dragValue = ratioFromEvent(event);
      preview(this.dragValue);
      this.showControls(true);
    });

    const finish = (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      bar.classList.remove('is-dragging');

      const ratio = event ? ratioFromEvent(event) : this.dragValue;
      const duration = this.video.duration || 0;

      if (duration) {
        this.video.currentTime = clamp(ratio * duration, 0, duration - 0.1);
        this.updateTime();
      }

      this.scheduleHide(2200);
    };

    bar.addEventListener('pointerup', finish);
    bar.addEventListener('pointercancel', () => finish(null));

    bar.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.seekBy(5);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.seekBy(-5);
      }
    });
  }

  bindDragAndDrop() {
    const root = this.root;

    root.addEventListener('dragover', (event) => event.preventDefault());
    root.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      this.loadSource(url, /\.m3u8$/i.test(file.name));
      showPlayerToast(`Playing ${safeLabel(file.name, 40)}`, 'success', 1800);
    });
  }

  /* -------------------------------------------------------------- gestures */

  bindGestures() {
    const root = this.root;
    const video = this.video;
    const b = this._bound;

    const ignore = (target) =>
      Boolean(target?.closest?.('button, input, .afp-menu, .afp-progress, .afp-next, .afp-error'));

    b.gestureDown = (event) => {
      if (!this.gesturesOn) return;
      if (ignore(event.target)) return;

      if (event.pointerType === 'mouse') return;

      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.pointers.size === 2) {
        const [a, c] = [...this.pointers.values()];
        this.pinch = {
          distance: Math.hypot(a.x - c.x, a.y - c.y),
          zoom: this.zoom
        };
        clearTimeout(this.holdTimer);
        this.gesture = null;
        return;
      }

      if (this.pointers.size > 2) return;

      this.gesture = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        time: video.currentTime,
        volume: video.volume,
        brightness: this.fx.brightness,
        axis: null,
        moved: false
      };

      this.holdTimer = setTimeout(() => {
        if (!this.gesture || this.gesture.moved) return;
        this.rateBeforeHold = video.playbackRate;
        video.playbackRate = Math.min(2, this.rateBeforeHold * 2);
        this.flash('speed', '2× speed');
      }, 500);
    };

    b.gestureMove = (event) => {
      if (this.pointers.has(event.pointerId)) {
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      /* pinch to zoom */
      if (this.pinch && this.pointers.size === 2) {
        const [a, c] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - c.x, a.y - c.y);
        if (this.pinch.distance > 0) {
          const scale = clamp(this.pinch.zoom * (distance / this.pinch.distance), 1, 2.5);
          this.setZoom(scale, false);
          this.flash('screen', `${Math.round(scale * 100)}%`);
        }
        return;
      }

      const g = this.gesture;
      if (!g || g.id !== event.pointerId) return;

      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      if (!g.moved && Math.hypot(dx, dy) > 12) {
        g.moved = true;
        clearTimeout(this.holdTimer);
      }
      if (!g.moved) return;

      if (!g.axis) g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';

      const rect = root.getBoundingClientRect();

      if (g.axis === 'x') {
        const duration = video.duration || 0;
        const perPixel = duration / Math.max(240, rect.width);
        const target = clamp(g.time + dx * perPixel, 0, duration || 0);
        g.pending = target;
        this.flash(dx > 0 ? 'forward' : 'backward', `${fmtTime(target)} / ${fmtTime(duration)}`);
      } else {
        const right = g.startX - rect.left > rect.width / 2;
        const delta = -dy / Math.max(160, rect.height);

        if (right) {
          const volume = clamp(g.volume + delta, 0, 1);
          video.volume = volume;
          video.muted = volume === 0;
          this.flash(volume === 0 ? 'mute' : 'volume', `${Math.round(volume * 100)}%`);
        } else {
          const value = clamp(g.brightness + delta * 100, 35, 160);
          this.fx.brightness = value;
          this.applyPicture();
          this.flash('sun', `${Math.round(value)}%`);
        }
      }
    };

    b.gestureUp = (event) => {
      this.pointers.delete(event.pointerId);

      if (this.pointers.size < 2 && this.pinch) {
        this.pinch = null;
      }

      const g = this.gesture;
      if (!g || g.id !== event.pointerId) return;

      clearTimeout(this.holdTimer);

      if (g.pending != null && g.axis === 'x') {
        video.currentTime = g.pending;
        this.updateTime();
      }

      if (this.rateBeforeHold != null) {
        video.playbackRate = this.rateBeforeHold;
        this.rateBeforeHold = null;
      }

      this.gesture = null;
    };

    root.addEventListener('pointerdown', b.gestureDown, { passive: true });
    root.addEventListener('pointermove', b.gestureMove, { passive: true });
    root.addEventListener('pointerup', b.gestureUp, { passive: true });
    root.addEventListener('pointercancel', b.gestureUp, { passive: true });
  }

  /* -------------------------------------------------------------- keyboard */

  onKeydown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (editableTarget(event.target)) return;

    const video = this.video;
    if (!video) return;

    const splash = $('#playerSplash');
    const splashVisible =
      splash && !splash.classList.contains('hidden') && getComputedStyle(splash).display !== 'none';
    if (splashVisible) return;

    const key = event.key.toLowerCase();
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (key === ' ' || key === 'k') {
      handled();
      this.togglePlay();
    } else if (key === 'arrowright') {
      handled();
      this.seekBy(event.shiftKey ? 30 : this.doubleTapSeconds, true);
    } else if (key === 'arrowleft') {
      handled();
      this.seekBy(event.shiftKey ? -30 : -this.doubleTapSeconds, true);
    } else if (key === 'arrowup') {
      handled();
      this.changeVolume(0.05);
    } else if (key === 'arrowdown') {
      handled();
      this.changeVolume(-0.05);
    } else if (key === 'm') {
      handled();
      video.muted = !video.muted;
      this.flash(video.muted ? 'mute' : 'volume', video.muted ? 'Muted' : 'Sound on');
    } else if (key === 'f') {
      handled();
      this.toggleFullscreen();
    } else if (key === 'j') {
      handled();
      this.seekBy(-10, true);
    } else if (key === 'l') {
      handled();
      this.seekBy(10, true);
    } else if (key === 'c') {
      handled();
      if (this.subEnabled) this.disableSubtitles();
      else if (this.subtitles.length) this.activateSubtitle(0);
    } else if (key === 'p') {
      handled();
      this.togglePip();
    } else if (key === 's') {
      handled();
      this.captureFrame();
    } else if (key === 't') {
      handled();
      this.toggleTheater();
    } else if (key === 'b') {
      handled();
      this.markAB();
    } else if (key === 'r') {
      handled();
      this.setLoop(this.loopMode === 'one' ? 'off' : 'one');
    } else if (key === 'n' && this.meta.onNextEpisode) {
      handled();
      this.meta.onNextEpisode();
    } else if (key === '[') {
      handled();
      this.frameStep(-1);
    } else if (key === ']') {
      handled();
      this.frameStep(1);
    } else if (key === 'escape') {
      if (this.menuOpen) {
        handled();
        this.closeMenu();
      } else if (this.theater) {
        handled();
        this.toggleTheater();
      } else if (this.mini) {
        handled();
        this.toggleMini();
      }
    } else if (key === '>' || key === '.') {
      handled();
      this.setRate(clamp(video.playbackRate + 0.25, 0.25, 2));
    } else if (key === '<' || key === ',') {
      handled();
      this.setRate(clamp(video.playbackRate - 0.25, 0.25, 2));
    } else if (/^[0-9]$/.test(key) && video.duration) {
      handled();
      video.currentTime = (Number(key) / 10) * video.duration;
      this.updateTime();
    } else if (key === 'home' && video.duration) {
      handled();
      video.currentTime = 0;
    } else if (key === 'end' && video.duration) {
      handled();
      video.currentTime = video.duration - 1;
    }
  }

  bindVideoHotkeys(onSplashPlay) {
    if (this._hotkeysBound) return;
    this._hotkeysBound = true;

    this._splashHotkey = (event) => {
      const splash = $('#playerSplash');
      const visible =
        splash && !splash.classList.contains('hidden') && getComputedStyle(splash).display !== 'none';

      if (!visible) return;
      if (event.key !== ' ' && event.code !== 'Space') return;
      if (editableTarget(event.target)) return;

      event.preventDefault();
      onSplashPlay?.();
    };

    document.addEventListener('keydown', this._splashHotkey);
  }

  /* --------------------------------------------------------------- helpers */

  togglePlay() {
    const video = this.video;
    if (!video) return;

    if (video.paused) {
      const attempt = video.play();
      attempt?.catch?.(() => this.showError('Tap play to start.'));
    } else {
      video.pause();
    }
    this.showControls(true);
  }

  seekBy(seconds, flash = false) {
    const video = this.video;
    if (!video) return;

    const target = clamp(video.currentTime + seconds, 0, (video.duration || 0) - 0.2);
    video.currentTime = target;
    this.updateTime();

    if (flash) {
      this.pulseRipple(seconds > 0 ? 'r' : 'l');
      this.flash(seconds > 0 ? 'forward' : 'backward', `${seconds > 0 ? '+' : ''}${Math.round(seconds)}s`);
    }
  }

  changeVolume(delta) {
    const video = this.video;
    video.volume = clamp(video.volume + delta, 0, 1);
    video.muted = video.volume === 0;
    storageSet(STORE.volume, video.volume);
    storageSet(STORE.muted, video.muted);
    this.flash(video.muted ? 'mute' : 'volume', `${Math.round(video.volume * 100)}%`);
  }

  setRate(rate, announce = true) {
    const value = clamp(rate, 0.25, 3);
    this.video.playbackRate = value;
    this.video.preservesPitch = true;
    this.video.mozPreservesPitch = true;
    this.video.webkitPreservesPitch = true;
    if (this.rememberSpeed) storageSet(STORE.rate, value);
    this.updateBadges();
    if (announce) this.flash('speed', `${Number(value.toFixed(2))}×`);
  }

  frameStep(direction) {
    const video = this.video;
    if (!video) return;
    video.pause();
    const fps = 24;
    video.currentTime = clamp(video.currentTime + direction / fps, 0, (video.duration || 0) - 0.02);
    this.updateTime();
    this.flash(direction > 0 ? 'forward' : 'backward', '1 frame');
  }

  updateVolumeIcon() {
    const muted = this.video.muted || this.video.volume === 0;
    this.el.mute.innerHTML = icon(muted ? 'mute' : 'volume');
    this.el.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  updateControlsState() {
    const paused = this.video.paused;
    const ended = this.video.ended;

    this.el.play.innerHTML = icon(ended ? 'replay' : paused ? 'play' : 'pause');
    this.el.play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    this.el.bigPlay.innerHTML = icon(ended ? 'replay' : 'play');
    this.el.bigPlay.classList.toggle('is-visible', paused || ended);
    this.root.classList.toggle('is-paused', paused);
    this.root.classList.toggle('is-playing', !paused);
    this.root.dataset.state = paused ? 'paused' : 'playing';

    const duration = this.video.duration || 0;
    this.el.dur.textContent = fmtTime(duration, duration >= 3600);
  }

  updateBadges() {
    if (!this.el) return;

    const rate = Number(this.video.playbackRate) || 1;
    if (this.el.badgeSpeed) {
      this.el.badgeSpeed.hidden = Math.abs(rate - 1) < 0.01;
      this.el.badgeSpeed.textContent = `${Number(rate.toFixed(2))}×`;
    }

    if (this.el.badgeLoop) {
      const on = this.loopMode !== 'off';
      this.el.badgeLoop.hidden = !on;
      this.el.badgeLoop.textContent =
        this.loopMode === 'ab' && this.ab.a != null && this.ab.b != null
          ? `A→B ${fmtTime(this.ab.a)}–${fmtTime(this.ab.b)}`
          : this.loopMode === 'one'
            ? 'Repeat'
            : 'A→B';
    }

    if (this.el.badgeSleep) {
      this.el.badgeSleep.hidden = !this.sleepLeft;
      this.el.badgeSleep.textContent = this.sleepLeft ? `Sleep ${this.sleepLeft}m` : '';
    }
  }

  updateTime() {
    const video = this.video;
    if (!video || !this.el) return;

    const duration = video.duration || 0;
    const time = video.currentTime || 0;

    const ratio = duration ? clamp(time / duration, 0, 1) : 0;
    this.el.played.style.width = `${ratio * 100}%`;
    this.el.thumb.style.left = `${ratio * 100}%`;
    this.el.cur.textContent = fmtTime(time, duration >= 3600);
    this.el.dur.textContent = fmtTime(duration, duration >= 3600);
    this.el.progress.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));

    this.renderCue(time);
    this.updateSkipButton(time, duration);
    this.updateNextCard(time, duration);
    this.applyABLoop(time);
    this.updateMediaSessionPosition();
    this.saveProgress(time, duration);
    this.meta.onTimeUpdate?.(time, duration);
  }

  updateBuffer() {
    const video = this.video;
    if (!video || !this.el) return;

    try {
      if (!video.buffered.length) return;
      let end = 0;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.buffered.start(i) <= video.currentTime + 0.5) end = video.buffered.end(i);
      }
      const duration = video.duration || 0;
      if (duration) this.el.buffer.style.width = `${clamp((end / duration) * 100, 0, 100)}%`;
    } catch {
      /* noop */
    }
  }

  onTimeUpdate() {
    this.updateTime();
    this.updateBuffer();

    if (!this.video.paused) {
      const now = Date.now();
      if (now - this.lastHealthyAt > 15000) {
        this.lastHealthyAt = now;
        this.recoveryAttempts = 0;
      }
    }

    if (this.statsOpen && Date.now() - this.lastStatsAt > 900) {
      this.lastStatsAt = Date.now();
      this.renderStats();
    }

    if (Date.now() - this.lastPerfCheck > 2500) {
      this.lastPerfCheck = Date.now();
      this.monitorPlayback();
    }
  }

  /**
   * Watch real frame health instead of guessing from device specs: if more
   * than 12% of frames are being dropped, step the rendition down once, and
   * if there are no renditions, drop the cosmetic picture effects.
   */
  monitorPlayback() {
    const video = this.video;
    if (!video || video.paused || document.hidden) return;

    let quality;
    try {
      quality = video.getVideoPlaybackQuality?.();
    } catch {
      return;
    }
    if (!quality) return;

    const dropped = Number(quality.droppedVideoFrames) || 0;
    const total = Number(quality.totalVideoFrames) || 0;
    const previous = this.perfSample;
    this.perfSample = { dropped, total };

    if (!previous || this.perfDowngraded) return;

    const deltaDropped = dropped - previous.dropped;
    const deltaTotal = total - previous.total;
    if (deltaTotal < 40 || deltaDropped < 0) return;

    if (deltaDropped / deltaTotal > 0.12) this.degradeQuality();
  }

  degradeQuality() {
    const hls = this.hls;

    if (hls?.levels?.length > 1) {
      const current = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
      if (current > 0) {
        hls.autoLevelCapping = Math.max(0, current - 1);
        hls.currentLevel = -1;
        this.perfDowngraded = true;
        this.flash('screen', 'Lowering quality to stay smooth');
        return;
      }
    }

    const fx = this.fx;
    if (fx.brightness !== 100 || fx.contrast !== 100 || fx.saturation !== 100 || fx.night) {
      this.fx = { brightness: 100, contrast: 100, saturation: 100, night: 0 };
      this.applyPicture();
      this.flash('screen', 'Picture effects off for speed');
    }

    // Nothing left to trade away — stop sampling.
    this.perfDowngraded = true;
  }

  setPerfProfile(value) {
    this.perfSetting = value;
    storageSet('afp_perf', value);

    this.perfProfile =
      value === 'auto' ? (this.lowMemory ? 'smooth' : 'quality') : value;

    if (this.root) this.root.dataset.perf = this.perfProfile;
    if (this.video) {
      this.video.preload = this.perfProfile === 'smooth' ? 'metadata' : 'auto';
    }

    const smooth = this.perfProfile === 'smooth';

    if (this.hls) {
      const config = this.hls.config || {};
      config.maxBufferLength = smooth ? 12 : 30;
      config.maxMaxBufferLength = smooth ? 20 : 48;
      config.maxBufferSize = smooth ? 12e6 : 40e6;
      config.backBufferLength = smooth ? 8 : 30;

      if (smooth && this.hls.levels?.length) {
        const cap = this.hls.levels.reduce(
          (best, level, index) => (level.height && level.height <= 720 ? index : best),
          0
        );
        this.hls.autoLevelCapping = cap;
      } else {
        this.hls.autoLevelCapping = -1;
      }
    }

    this.perfDowngraded = false;
    this.flash('speed', `Performance: ${value === 'auto' ? 'Auto' : value === 'smooth' ? 'Smooth' : 'Quality'}`);
    if (this.menuOpen) this.renderMenu();
  }

  saveProgress(time, duration) {
    const { anilistId, episode, animeTitle, poster } = this.meta;
    if (!anilistId) return;

    const second = Math.floor(time);
    if (second === this.lastSavedSecond) return;
    if (Date.now() - this.lastSavedAt < 5000) return;

    this.lastSavedAt = Date.now();
    this.lastSavedSecond = second;

    try {
      ProgressTracker.save(anilistId, episode, time, duration, animeTitle, poster || '');
    } catch {
      /* noop */
    }
  }

  /* ------------------------------------------------------------ skip intro */

  updateSkipButton(time, duration) {
    if (!this.el?.skip) return;

    const active = this.skipIntervals.find(
      (item) => time >= item.startTime && time < item.endTime - 0.4
    );

    if (!active || this.lastSkippedAt === active.endTime) {
      this.activeSkip = active || null;
      this.el.skip.hidden = true;
      return;
    }

    this.activeSkip = active;

    if (this.autoSkip) {
      this.video.currentTime = active.endTime;
      this.lastSkippedAt = active.endTime;
      this.el.skip.hidden = true;
      this.flash('forward', 'Skipped');
      return;
    }

    const label =
      active.type === 'op'
        ? 'Skip opening'
        : active.type === 'ed'
          ? 'Skip ending'
          : 'Skip recap';

    this.el.skip.textContent = label;
    this.el.skip.hidden = false;
  }

  applySkip() {
    if (!this.activeSkip) return;
    this.video.currentTime = this.activeSkip.endTime;
    this.lastSkippedAt = this.activeSkip.endTime;
    this.el.skip.hidden = true;
    this.updateTime();
  }

  /* ---------------------------------------------------------- next episode */

  updateNextCard(time, duration) {
    if (!this.el?.next) return;

    const hasNext = Boolean(this.meta.onNextEpisode);
    if (!hasNext || this.nextCancelled || duration < 60) {
      if (!this.nextCancelled) this.el.next.hidden = true;
      return;
    }

    const left = duration - time;

    if (left <= 12 && left > 0) {
      if (this.el.next.hidden) {
        this.el.next.hidden = false;
        clearInterval(this.nextCountdown);
        this.nextCountdown = setInterval(() => {
          const remaining = Math.max(0, Math.ceil(this.video.duration - this.video.currentTime));
          if (this.el.nextTimer) this.el.nextTimer.textContent = String(remaining);
          if (remaining <= 0) clearInterval(this.nextCountdown);
        }, 500);
      }
      if (this.el.nextTimer) this.el.nextTimer.textContent = String(Math.max(0, Math.ceil(left)));
    } else {
      this.el.next.hidden = true;
    }
  }

  onEnded() {
    clearInterval(this.nextCountdown);
    this.updateControlsState();
    this.showControls(true);

    try {
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none';
    } catch {
      /* noop */
    }

    if (this.loopMode === 'one') {
      this.video.currentTime = 0;
      this.video.play().catch(() => {});
      return;
    }

    if (!this.nextCancelled) this.meta.onEnded?.();
  }

  /* ----------------------------------------------------------- A→B / loop */

  setLoop(mode) {
    this.loopMode = mode;
    this.video.loop = mode === 'one';

    if (mode !== 'ab') {
      this.ab = { a: null, b: null };
      this.renderAB();
    }

    this.updateBadges();
    this.flash('loop', LOOP_MODES.find((item) => item[0] === mode)?.[1] || 'Loop off');
    if (this.menuOpen) this.renderMenu();
  }

  markAB() {
    const time = this.video.currentTime || 0;

    if (this.ab.a == null) {
      this.ab.a = time;
      this.loopMode = 'ab';
      this.video.loop = false;
      this.flash('loop', `Start ${fmtTime(time)}`);
    } else if (this.ab.b == null) {
      this.ab.b = Math.max(time, this.ab.a + 0.5);
      this.loopMode = 'ab';
      this.video.loop = false;
      this.flash('loop', `Loop ${fmtTime(this.ab.a)}–${fmtTime(this.ab.b)}`);
    } else {
      this.ab = { a: null, b: null };
      this.flash('loop', 'Section cleared');
    }

    this.renderAB();
    this.updateBadges();
    if (this.menuOpen) this.renderMenu();
  }

  applyABLoop(time) {
    const { a, b } = this.ab;
    if (this.loopMode !== 'ab' || a == null || b == null) return;

    if (time >= b - 0.05 || time < a - 0.4) {
      this.video.currentTime = a;
    }
  }

  renderAB() {
    const node = this.el?.ab;
    if (!node) return;

    const duration = this.video?.duration || 0;
    const { a, b } = this.ab;

    if (this.loopMode !== 'ab' || a == null || b == null || !duration) {
      node.style.opacity = '0';
      return;
    }

    node.style.opacity = '1';
    node.style.left = `${clamp((a / duration) * 100, 0, 100)}%`;
    node.style.width = `${clamp(((b - a) / duration) * 100, 0.4, 100)}%`;
  }

  /* --------------------------------------------------------------- chrome */

  showControls(sticky = false) {
    if (!this.root) return;
    this.root.classList.add('controls-on');
    this.root.classList.remove('cursor-hidden');
    clearTimeout(this.hideTimer);
    this.scheduleHide(sticky ? 4500 : this.hideDelay || 3000);
  }

  scheduleHide(delay) {
    clearTimeout(this.hideTimer);
    if (this.hideDelay === 0 && !delay) return;

    this.hideTimer = setTimeout(() => {
      if (!this.root) return;
      if (this.video.paused || this.menuOpen || this.dragging) return;
      this.root.classList.remove('controls-on');
      this.root.classList.add('cursor-hidden');
    }, delay || this.hideDelay || 3000);
  }

  showSpinner(show) {
    this.root?.classList.toggle('is-loading', Boolean(show));
  }

  flash(kind, text) {
    const el = this.el?.flash;
    if (!el) return;

    const glyph = { speed: 'speed', sun: 'sun', screen: 'screen', loop: 'loop' }[kind] || kind;
    this.el.flashIcon.innerHTML = icon(ICON[glyph] ? glyph : 'forward', 22);
    this.el.flashText.textContent = text;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');

    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => el.classList.remove('is-on'), 900);
  }

  pulseRipple(side) {
    const node = side === 'r' ? this.el.rippleR : this.el.rippleL;
    if (!node) return;
    node.classList.remove('is-on');
    void node.offsetWidth;
    node.classList.add('is-on');
  }

  showError(message) {
    if (!this.el?.error) return;
    this.el.errorText.textContent = message || 'This video could not be played.';
    this.el.error.hidden = false;
    this.showSpinner(false);
    this.showControls(true);
    this.meta.onError?.('Playback error', message);
  }

  /* --------------------------------------------------------------- picture */

  applyPicture() {
    const video = this.video;
    if (!video) return;

    const { brightness, contrast, saturation, night } = this.fx;

    // A CSS filter on the video element forces a full-frame pass on every
    // single frame. At default values it must be removed, not neutralised.
    const isDefault =
      brightness === 100 && contrast === 100 && saturation === 100 && night === 0;

    if (isDefault) {
      if (video.style.filter) video.style.filter = '';
    } else {
      let filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
      if (night > 0) {
        filter += ` sepia(${night}%) saturate(${100 + night * 0.5}%) hue-rotate(-12deg)`;
      }
      video.style.filter = filter;
    }

    const parts = [];
    if (this.zoom !== 1) parts.push(`scale(${this.zoom})`);
    if (this.flip) parts.push('scaleX(-1)');
    video.style.transform = parts.join(' ') || '';
    video.style.transformOrigin = 'center center';

    if (this.root) this.root.dataset.aspect = this.aspect;
  }

  setAspect(value) {
    this.aspect = value;
    storageSet(STORE.aspect, value);
    this.applyPicture();
    this.flash('screen', ASPECTS.find((item) => item[0] === value)?.[1] || 'Fit');
    if (this.menuOpen) this.renderMenu();
  }

  setZoom(value, announce = true) {
    this.zoom = clamp(value, 1, 2.5);
    this.applyPicture();
    if (announce) this.flash('screen', `${Math.round(this.zoom * 100)}%`);
  }

  setFilter(key, value) {
    this.fx[key] = clamp(value, 0, 200);
    this.applyPicture();
  }

  toggleFlip() {
    this.flip = !this.flip;
    this.applyPicture();
    this.flash('flip', this.flip ? 'Mirrored' : 'Normal');
    if (this.menuOpen) this.renderMenu();
  }

  resetPicture() {
    this.fx = { brightness: 100, contrast: 100, saturation: 100, night: 0 };
    this.zoom = 1;
    this.flip = false;
    this.aspect = 'fit';
    storageSet(STORE.aspect, 'fit');
    this.applyPicture();
    this.flash('screen', 'Picture reset');
    if (this.menuOpen) this.renderMenu();
  }

  /* ------------------------------------------------------------------ audio */

  setAudioTrack(index) {
    if (!this.hls?.audioTracks) return;
    this.hls.audioTrack = Number(index);
    this.flash('audio', `Audio ${index + 1}`);
    if (this.menuOpen) this.renderMenu();
  }

  /**
   * Volume above 100% needs a Web Audio gain stage. Cross-origin media without
   * CORS headers can go silent when routed through Web Audio, so this is
   * opt-in and can be undone (resetAudioGraph) without reloading the page.
   */
  setAudioBoost(value) {
    const boost = clamp(value, 1, 3);

    if (boost === 1 && !this.audioCtx) {
      this.audioBoost = 1;
      return;
    }

    try {
      if (!this.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('no audio context');

        this.audioCtx = new Ctx();
        this.audioSource = this.audioCtx.createMediaElementSource(this.video);
        this.audioGain = this.audioCtx.createGain();
        this.audioSource.connect(this.audioGain).connect(this.audioCtx.destination);
      }

      this.audioCtx.resume?.();
      this.audioGain.gain.value = boost;
      this.audioBoost = boost;
      this.flash('audio', `Volume ${Math.round(boost * 100)}%`);

      if (boost > 1) {
        showPlayerToast('Boosted audio. If sound stops, set it back to Normal.', 'info', 2600);
      }
    } catch {
      this.audioBoost = 1;
      showPlayerToast('Volume boost is not available for this stream.', 'error', 2200);
    }

    if (this.menuOpen) this.renderMenu();
  }

  resetAudioGraph() {
    try {
      this.audioSource?.disconnect();
      this.audioGain?.disconnect();
      this.audioCtx?.close();
    } catch {
      /* noop */
    }

    this.audioCtx = null;
    this.audioSource = null;
    this.audioGain = null;
    this.audioBoost = 1;

    // Re-attach the media so native audio routing comes back.
    const video = this.video;
    if (video?.src) {
      const time = video.currentTime;
      const wasPlaying = !video.paused;
      video.load();
      video.currentTime = time;
      if (wasPlaying) video.play().catch(() => {});
    }

    showPlayerToast('Audio restored to normal.', 'success', 1600);
    if (this.menuOpen) this.renderMenu();
  }

  /* ----------------------------------------------------------------- tools */

  setSleep(minutes) {
    clearTimeout(this.sleepTimer);

    if (!minutes) {
      this.sleepLeft = 0;
      this.updateBadges();
      this.flash('timer', 'Sleep timer off');
      if (this.menuOpen) this.renderMenu();
      return;
    }

    this.sleepLeft = Number(minutes);
    this.sleepTimer = setTimeout(() => this.fadeOut(), this.sleepLeft * 60000);
    this.updateBadges();
    this.flash('timer', `Sleep in ${this.sleepLeft} min`);
    if (this.menuOpen) this.renderMenu();
  }

  fadeOut() {
    const video = this.video;
    const start = video.volume;
    const began = performance.now();

    const step = () => {
      const progress = clamp((performance.now() - began) / 2400, 0, 1);
      video.volume = start * (1 - progress);
      if (progress < 1) requestAnimationFrame(step);
      else {
        video.pause();
        video.volume = start;
        this.sleepLeft = 0;
        this.updateBadges();
        this.flash('timer', 'Sleep timer finished');
      }
    };

    requestAnimationFrame(step);
  }

  captureFrame() {
    const video = this.video;
    if (!video) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) {
          showPlayerToast('Could not capture this frame.', 'error', 2000);
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.href = url;
        link.download = `aniframe-${this.meta.anilistId || 'frame'}-ep${this.meta.episode || 1}-${stamp}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        this.flash('camera', 'Frame saved');
      }, 'image/png');
    } catch {
      showPlayerToast('This stream blocks frame capture.', 'error', 2400);
    }
  }

  toggleTheater() {
    this.theater = !this.theater;
    document.body.classList.toggle('afp-theater', this.theater);
    this.flash('theatre', this.theater ? 'Theatre mode' : 'Theatre off');
    if (this.menuOpen) this.renderMenu();
  }

  async castToDevice() {
    const video = this.video;
    try {
      if (video?.remote?.prompt) {
        await video.remote.prompt();
      } else {
        showPlayerToast('Casting is not available in this browser.', 'info', 2000);
      }
    } catch {
      /* user dismissed the picker */
    }
  }

  toggleStats(force) {
    this.statsOpen = typeof force === 'boolean' ? force : !this.statsOpen;
    this.el.stats.hidden = !this.statsOpen;
    if (this.statsOpen) this.renderStats();
    if (this.menuOpen) this.renderMenu();
  }

  renderStats() {
    const video = this.video;
    if (!video || !this.el?.statsGrid) return;

    let buffer = 0;
    try {
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) {
          buffer = video.buffered.end(i) - video.currentTime;
        }
      }
    } catch {
      /* noop */
    }

    let dropped = 0;
    try {
      dropped = video.getVideoPlaybackQuality?.()?.droppedVideoFrames ?? 0;
    } catch {
      /* noop */
    }

    const level = this.hls?.levels?.[this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel];

    const rows = [
      ['Resolution', `${video.videoWidth || 0}×${video.videoHeight || 0}`],
      ['Quality', level?.height ? `${level.height}p` : 'Native'],
      ['Bitrate', level?.bitrate ? `${(level.bitrate / 1e6).toFixed(2)} Mbps` : '—'],
      ['Buffer', `${buffer.toFixed(1)}s`],
      ['Dropped', String(dropped)],
      ['Engine', this.hls ? 'HLS.js' : 'Native'],
      ['Speed', `${(video.playbackRate || 1).toFixed(2)}×`],
      ['Volume', `${Math.round(video.volume * 100)}%`]
    ];

    this.el.statsGrid.innerHTML = rows
      .map(
        ([key, value]) =>
          `<div class="afp-stats__cell"><span>${key}</span><strong>${value}</strong></div>`
      )
      .join('');
  }

  toggleMini() {
    const shell = document.getElementById('embedContainer');
    if (!shell) return;
    this.mini = !this.mini;
    shell.classList.toggle('afp-mini', this.mini);
    this.flash('mini', this.mini ? 'Mini player on' : 'Mini player off');
  }

  async togglePip() {
    const video = this.video;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else {
        showPlayerToast('Picture in picture is not supported here.', 'info', 1800);
      }
    } catch {
      showPlayerToast('Picture in picture was blocked.', 'error', 1800);
    }
  }

  async toggleFullscreen() {
    const root = this.root;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
      } else if (root.requestFullscreen) {
        await root.requestFullscreen();
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      } else if (this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      }
    } catch {
      showPlayerToast('Full screen was blocked.', 'info', 1600);
    }
  }

  /* ----------------------------------------------------------------- menu */

  toggleMenu() {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  openMenu() {
    this.menuOpen = true;
    this.menuView = 'main';
    this.renderMenu();
    this.el.menu.hidden = false;
    requestAnimationFrame(() => this.el.menu.classList.add('is-open'));
    this.showControls(true);
    clearTimeout(this.hideTimer);
  }

  closeMenu() {
    this.menuOpen = false;
    this.el.menu.classList.remove('is-open');
    setTimeout(() => {
      if (!this.menuOpen) this.el.menu.hidden = true;
    }, 180);
    this.scheduleHide(1200);
  }

  setMenuView(view) {
    this.menuView = view;
    this.renderMenu();
    this.el.menuBody.scrollTop = 0;
  }

  /* --- row builders --- */

  makeRow(tag = 'button') {
    const row = document.createElement(tag);
    row.className = 'afp-row';
    if (tag === 'button') row.type = 'button';
    row.setAttribute('role', 'menuitem');
    return row;
  }

  rowLink({ label, value = '', action }) {
    const row = this.makeRow();
    row.innerHTML = `
      <span class="afp-row__label">${label}</span>
      ${value ? `<span class="afp-row__value">${value}</span>` : ''}
      <span class="afp-row__icon">${icon('chevron', 18)}</span>
    `;
    row.addEventListener('click', action);
    return row;
  }

  rowChoice({ label, checked, action }) {
    const row = this.makeRow();
    row.classList.toggle('is-checked', Boolean(checked));
    row.innerHTML = `
      <span class="afp-row__label">${label}</span>
      <span class="afp-row__icon">${checked ? icon('check', 18) : ''}</span>
    `;
    row.addEventListener('click', action);
    return row;
  }

  rowToggle({ label, checked, action }) {
    const row = this.makeRow();
    row.classList.toggle('is-checked', Boolean(checked));
    row.innerHTML = `
      <span class="afp-row__label">${label}</span>
      <span class="afp-row__switch${checked ? ' is-on' : ''}"><i></i></span>
    `;
    row.addEventListener('click', action);
    return row;
  }

  rowAction({ label, iconName = '', action }) {
    const row = this.makeRow();
    row.innerHTML = `
      <span class="afp-row__label">${label}</span>
      <span class="afp-row__icon">${iconName ? icon(iconName, 17) : ''}</span>
    `;
    row.addEventListener('click', action);
    return row;
  }

  rowSlider({ label, min, max, step, value, format, onInput }) {
    const row = this.makeRow('div');
    row.classList.add('afp-row--slider');
    row.innerHTML = `
      <span class="afp-row__label">${label}</span>
      <span class="afp-row__value">${format(value)}</span>
      <input class="afp-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
             aria-label="${label}" />
    `;
    const input = row.querySelector('input');
    const out = row.querySelector('.afp-row__value');

    input.addEventListener('input', () => {
      const next = Number(input.value);
      out.textContent = format(next);
      onInput(next);
    });

    return row;
  }

  section(label) {
    const node = document.createElement('div');
    node.className = 'afp-menu__section';
    node.textContent = label;
    return node;
  }

  /* --- views --- */

  renderMenu() {
    const body = this.el.menuBody;
    if (!body) return;

    const view = this.menuView;
    const titles = {
      main: 'Settings',
      speed: 'Playback speed',
      quality: 'Quality',
      audio: 'Audio',
      subtitles: 'Subtitles',
      loop: 'Loop',
      sleep: 'Sleep timer',
      picture: 'Picture',
      controls: 'Gestures & controls',
      performance: 'Performance',
      shortcuts: 'Keyboard shortcuts'
    };

    this.el.menuTitle.textContent = titles[view] || 'Settings';
    this.el.menuBack.style.visibility = view === 'main' ? 'hidden' : 'visible';

    body.replaceChildren();

    if (view === 'main') this.viewMain(body);
    else if (view === 'speed') this.viewSpeed(body);
    else if (view === 'quality') this.viewQuality(body);
    else if (view === 'audio') this.viewAudio(body);
    else if (view === 'subtitles') this.viewSubtitles(body);
    else if (view === 'loop') this.viewLoop(body);
    else if (view === 'sleep') this.viewSleep(body);
    else if (view === 'picture') this.viewPicture(body);
    else if (view === 'controls') this.viewControls(body);
    else if (view === 'performance') this.viewPerformance(body);
    else if (view === 'shortcuts') this.viewShortcuts(body);
  }

  viewMain(body) {
    const rate = this.video.playbackRate || 1;
    const levels = this.qualityOptions();
    const audioTracks = this.hls?.audioTracks?.length || 0;

    body.appendChild(this.section('Playback'));

    body.appendChild(
      this.rowLink({
        label: 'Playback speed',
        value: Math.abs(rate - 1) < 0.01 ? 'Normal' : `${Number(rate.toFixed(2))}×`,
        action: () => this.setMenuView('speed')
      })
    );

    if (levels.length > 1) {
      body.appendChild(
        this.rowLink({
          label: 'Quality',
          value: levels.find((level) => level.active)?.label || 'Auto',
          action: () => this.setMenuView('quality')
        })
      );
    }

    if (audioTracks > 1 || this.audioBoost > 1) {
      body.appendChild(
        this.rowLink({
          label: 'Audio',
          value:
            audioTracks > 1
              ? safeLabel(this.hls.audioTracks[this.hls.audioTrack]?.name || `Track ${this.hls.audioTrack + 1}`, 14)
              : `${Math.round(this.audioBoost * 100)}%`,
          action: () => this.setMenuView('audio')
        })
      );
    }

    if (this.subtitles.length) {
      body.appendChild(
        this.rowLink({
          label: 'Subtitles',
          value: this.subEnabled
            ? safeLabel(this.subtitles[this.subIndex]?.label || 'On', 16)
            : 'Off',
          action: () => this.setMenuView('subtitles')
        })
      );
    }

    body.appendChild(
      this.rowLink({
        label: 'Loop',
        value: { off: 'Off', one: 'Repeat', ab: 'A→B' }[this.loopMode] || 'Off',
        action: () => this.setMenuView('loop')
      })
    );

    body.appendChild(
      this.rowLink({
        label: 'Sleep timer',
        value: this.sleepLeft ? `${this.sleepLeft} min` : 'Off',
        action: () => this.setMenuView('sleep')
      })
    );

    body.appendChild(this.section('Display'));
    body.appendChild(
      this.rowLink({
        label: 'Picture',
        value: ASPECTS.find((item) => item[0] === this.aspect)?.[1] || 'Fit',
        action: () => this.setMenuView('picture')
      })
    );

    body.appendChild(this.section('Controls'));
    body.appendChild(
      this.rowLink({
        label: 'Gestures & timing',
        value: `${this.doubleTapSeconds}s skip`,
        action: () => this.setMenuView('controls')
      })
    );

    body.appendChild(this.section('Tools'));

    body.appendChild(
      this.rowLink({
        label: 'Performance',
        value:
          this.perfSetting === 'auto'
            ? `Auto · ${this.perfProfile === 'smooth' ? 'smooth' : 'quality'}`
            : this.perfSetting === 'smooth'
              ? 'Smooth'
              : 'Quality',
        action: () => this.setMenuView('performance')
      })
    );

    body.appendChild(
      this.rowToggle({
        label: 'Stats for nerds',
        checked: this.statsOpen,
        action: () => this.toggleStats(!this.statsOpen)
      })
    );

    body.appendChild(
      this.rowAction({
        label: 'Save frame',
        iconName: 'camera',
        action: () => {
          this.captureFrame();
          this.closeMenu();
        }
      })
    );

    body.appendChild(
      this.rowToggle({
        label: 'Theatre mode',
        checked: this.theater,
        action: () => this.toggleTheater()
      })
    );

    if (this.video?.remote?.prompt) {
      body.appendChild(
        this.rowAction({
          label: 'Cast to device',
          iconName: 'cast',
          action: () => this.castToDevice()
        })
      );
    }

    body.appendChild(
      this.rowLink({
        label: 'Keyboard shortcuts',
        action: () => this.setMenuView('shortcuts')
      })
    );

    body.appendChild(
      this.rowAction({
        label: 'Reset player settings',
        iconName: 'reset',
        action: () => this.resetSettings()
      })
    );
  }

  viewSpeed(body) {
    const current = this.video.playbackRate || 1;

    for (const rate of SPEEDS) {
      body.appendChild(
        this.rowChoice({
          label: rate === 1 ? 'Normal' : `${rate}×`,
          checked: Math.abs(current - rate) < 0.01,
          action: () => {
            this.setRate(rate);
            this.renderMenu();
          }
        })
      );
    }

    body.appendChild(
      this.rowSlider({
        label: 'Fine tune',
        min: 0.25,
        max: 3,
        step: 0.05,
        value: current,
        format: (value) => `${Number(value.toFixed(2))}×`,
        onInput: (value) => this.setRate(value, false)
      })
    );

    body.appendChild(
      this.rowToggle({
        label: 'Remember my speed',
        checked: this.rememberSpeed,
        action: () => {
          this.rememberSpeed = !this.rememberSpeed;
          storageSet(STORE.rememberSpeed, this.rememberSpeed);
          if (!this.rememberSpeed) storageRemove(STORE.rate);
          this.renderMenu();
        }
      })
    );
  }

  viewQuality(body) {
    const levels = this.qualityOptions();

    if (!levels.length) {
      body.appendChild(this.rowAction({ label: 'This stream has one quality' }));
      return;
    }

    for (const level of levels) {
      body.appendChild(
        this.rowChoice({
          label: level.label,
          checked: level.active,
          action: () => {
            this.setQuality(level.value);
            this.renderMenu();
          }
        })
      );
    }
  }

  viewAudio(body) {
    const tracks = this.hls?.audioTracks || [];

    if (tracks.length > 1) {
      body.appendChild(this.section('Audio track'));
      tracks.forEach((track, index) => {
        body.appendChild(
          this.rowChoice({
            label: safeLabel(track.name || track.lang || `Track ${index + 1}`, 30),
            checked: this.hls.audioTrack === index,
            action: () => {
              this.setAudioTrack(index);
              this.renderMenu();
            }
          })
        );
      });
    }

    body.appendChild(this.section('Volume'));

    for (const boost of [1, 1.5, 2]) {
      body.appendChild(
        this.rowChoice({
          label: boost === 1 ? 'Normal (100%)' : `Boost ${Math.round(boost * 100)}%`,
          checked: Math.abs(this.audioBoost - boost) < 0.01,
          action: () => {
            this.setAudioBoost(boost);
            this.renderMenu();
          }
        })
      );
    }

    if (this.audioBoost > 1) {
      body.appendChild(
        this.rowAction({
          label: 'Restore normal audio',
          iconName: 'reset',
          action: () => this.resetAudioGraph()
        })
      );
    }

    const note = document.createElement('p');
    note.className = 'afp-menu__note';
    note.textContent = 'Boost above 100% routes sound through Web Audio. If a stream goes silent, pick Normal.';
    body.appendChild(note);
  }

  viewSubtitles(body) {
    body.appendChild(
      this.rowChoice({
        label: 'Off',
        checked: !this.subEnabled,
        action: () => {
          this.disableSubtitles();
          this.renderMenu();
        }
      })
    );

    this.subtitles.forEach((track, index) => {
      body.appendChild(
        this.rowChoice({
          label: safeLabel(track.label || track.lang || `Track ${index + 1}`, 32),
          checked: this.subEnabled && this.subIndex === index,
          action: async () => {
            await this.activateSubtitle(index);
            this.renderMenu();
          }
        })
      );
    });

    body.appendChild(this.section('Style'));

    body.appendChild(
      this.rowLink({
        label: 'Text size',
        value: SUB_SIZES.find((item) => item[0] === this.subSize)?.[1] || 'Medium',
        action: () => {
          const index = SUB_SIZES.findIndex((item) => item[0] === this.subSize);
          this.subSize = SUB_SIZES[(index + 1) % SUB_SIZES.length][0];
          storageSet(STORE.subSize, this.subSize);
          this.applySubtitleStyle();
          this.renderMenu();
        }
      })
    );

    body.appendChild(
      this.rowLink({
        label: 'Colour',
        value: SUB_COLORS.find((item) => item[0] === this.subColor)?.[1] || 'White',
        action: () => {
          const index = SUB_COLORS.findIndex((item) => item[0] === this.subColor);
          this.subColor = SUB_COLORS[(index + 1) % SUB_COLORS.length][0];
          storageSet(STORE.subColor, this.subColor);
          this.applySubtitleStyle();
          this.renderMenu();
        }
      })
    );

    body.appendChild(
      this.rowLink({
        label: 'Backdrop',
        value: SUB_BACKDROPS.find((item) => item[0] === this.subBg)?.[1] || 'Soft',
        action: () => {
          const index = SUB_BACKDROPS.findIndex((item) => item[0] === this.subBg);
          this.subBg = SUB_BACKDROPS[(index + 1) % SUB_BACKDROPS.length][0];
          storageSet(STORE.subBg, this.subBg);
          this.applySubtitleStyle();
          this.renderMenu();
        }
      })
    );

    body.appendChild(
      this.rowLink({
        label: 'Position',
        value: SUB_POSITIONS.find((item) => item[0] === this.subPos)?.[1] || 'Normal',
        action: () => {
          const index = SUB_POSITIONS.findIndex((item) => item[0] === this.subPos);
          this.subPos = SUB_POSITIONS[(index + 1) % SUB_POSITIONS.length][0];
          storageSet(STORE.subPos, this.subPos);
          this.applySubtitleStyle();
          this.renderMenu();
        }
      })
    );

    body.appendChild(
      this.rowSlider({
        label: 'Delay',
        min: -5,
        max: 5,
        step: 0.25,
        value: this.subDelay,
        format: (value) => `${value > 0 ? '+' : ''}${Number(value).toFixed(2)}s`,
        onInput: (value) => {
          this.subDelay = value;
          storageSet(STORE.subDelay, value);
          this.applySubtitleDelay();
        }
      })
    );
  }

  viewLoop(body) {
    for (const [mode, label] of LOOP_MODES) {
      body.appendChild(
        this.rowChoice({
          label,
          checked: this.loopMode === mode,
          action: () => {
            this.setLoop(mode);
            this.renderMenu();
          }
        })
      );
    }

    body.appendChild(this.section('Section markers'));

    body.appendChild(
      this.rowAction({
        label: this.ab.a == null ? 'Set start point (A)' : `Start: ${fmtTime(this.ab.a)}`,
        iconName: 'backward',
        action: () => {
          this.ab.a = this.video.currentTime;
          this.ab.b = null;
          this.loopMode = 'ab';
          this.renderAB();
          this.updateBadges();
          this.renderMenu();
        }
      })
    );

    body.appendChild(
      this.rowAction({
        label: this.ab.b == null ? 'Set end point (B)' : `End: ${fmtTime(this.ab.b)}`,
        iconName: 'forward',
        action: () => {
          if (this.ab.a == null) {
            this.ab.a = 0;
          }
          this.ab.b = Math.max(this.video.currentTime, this.ab.a + 0.5);
          this.loopMode = 'ab';
          this.renderAB();
          this.updateBadges();
          this.renderMenu();
        }
      })
    );

    if (this.ab.a != null || this.ab.b != null) {
      body.appendChild(
        this.rowAction({
          label: 'Clear markers',
          iconName: 'reset',
          action: () => {
            this.ab = { a: null, b: null };
            this.loopMode = 'off';
            this.video.loop = false;
            this.renderAB();
            this.updateBadges();
            this.renderMenu();
          }
        })
      );
    }
  }

  viewSleep(body) {
    for (const minutes of [0, 15, 30, 45, 60]) {
      body.appendChild(
        this.rowChoice({
          label: minutes === 0 ? 'Off' : `${minutes} minutes`,
          checked: minutes === 0 ? !this.sleepLeft : this.sleepLeft === minutes,
          action: () => {
            this.setSleep(minutes);
            this.renderMenu();
          }
        })
      );
    }
  }

  viewPicture(body) {
    body.appendChild(this.section('Framing'));

    for (const [value, label] of ASPECTS) {
      body.appendChild(
        this.rowChoice({
          label,
          checked: this.aspect === value,
          action: () => {
            this.setAspect(value);
            this.renderMenu();
          }
        })
      );
    }

    body.appendChild(
      this.rowSlider({
        label: 'Zoom',
        min: 100,
        max: 250,
        step: 5,
        value: Math.round(this.zoom * 100),
        format: (value) => `${value}%`,
        onInput: (value) => this.setZoom(value / 100, false)
      })
    );

    body.appendChild(this.section('Image'));

    body.appendChild(
      this.rowSlider({
        label: 'Brightness',
        min: 50,
        max: 150,
        step: 1,
        value: this.fx.brightness,
        format: (value) => `${value}%`,
        onInput: (value) => this.setFilter('brightness', value)
      })
    );

    body.appendChild(
      this.rowSlider({
        label: 'Contrast',
        min: 50,
        max: 150,
        step: 1,
        value: this.fx.contrast,
        format: (value) => `${value}%`,
        onInput: (value) => this.setFilter('contrast', value)
      })
    );

    body.appendChild(
      this.rowSlider({
        label: 'Colour',
        min: 0,
        max: 200,
        step: 1,
        value: this.fx.saturation,
        format: (value) => `${value}%`,
        onInput: (value) => this.setFilter('saturation', value)
      })
    );

    body.appendChild(
      this.rowSlider({
        label: 'Night mode',
        min: 0,
        max: 100,
        step: 1,
        value: this.fx.night,
        format: (value) => `${value}%`,
        onInput: (value) => this.setFilter('night', value)
      })
    );

    body.appendChild(
      this.rowToggle({
        label: 'Mirror picture',
        checked: this.flip,
        action: () => this.toggleFlip()
      })
    );

    body.appendChild(
      this.rowAction({
        label: 'Reset picture',
        iconName: 'reset',
        action: () => this.resetPicture()
      })
    );
  }

  viewControls(body) {
    body.appendChild(this.section('Double tap'));

    for (const seconds of [5, 10, 30]) {
      body.appendChild(
        this.rowChoice({
          label: `${seconds} seconds`,
          checked: this.doubleTapSeconds === seconds,
          action: () => {
            this.doubleTapSeconds = seconds;
            storageSet(STORE.doubleTap, seconds);
            this.renderMenu();
          }
        })
      );
    }

    body.appendChild(this.section('Controls hide after'));

    for (const [value, label] of [
      [2000, '2 seconds'],
      [3000, '3 seconds'],
      [5000, '5 seconds'],
      [0, 'Never']
    ]) {
      body.appendChild(
        this.rowChoice({
          label,
          checked: this.hideDelay === value,
          action: () => {
            this.hideDelay = value;
            storageSet(STORE.hideDelay, value);
            this.renderMenu();
          }
        })
      );
    }

    body.appendChild(this.section('Touch'));

    body.appendChild(
      this.rowToggle({
        label: 'Swipe gestures',
        checked: this.gesturesOn,
        action: () => {
          this.gesturesOn = !this.gesturesOn;
          storageSet(STORE.gestures, this.gesturesOn);
          this.renderMenu();
        }
      })
    );

    body.appendChild(
      this.rowToggle({
        label: 'Skip openings automatically',
        checked: this.autoSkip,
        action: () => {
          this.autoSkip = !this.autoSkip;
          storageSet('afp_auto_skip', this.autoSkip);
          this.renderMenu();
        }
      })
    );
  }

  viewPerformance(body) {
    const choices = [
      ['auto', 'Auto', 'Adapt to this device'],
      ['smooth', 'Smooth', 'Best on low-RAM phones'],
      ['quality', 'Quality', 'Best on laptops and TVs']
    ];

    for (const [value, label, hint] of choices) {
      body.appendChild(
        this.rowChoice({
          label: `${label} — ${hint}`,
          checked: this.perfSetting === value,
          action: () => this.setPerfProfile(value)
        })
      );
    }

    const note = document.createElement('p');
    note.className = 'afp-menu__note';
    note.textContent =
      'Smooth keeps the buffer short, caps the stream at 720p and trims animations. ' +
      'If frames start dropping, the player steps the quality down on its own.';
    body.appendChild(note);

    const row = this.makeRow('div');
    row.classList.add('afp-row--keys');
    row.innerHTML = `<span class="afp-row__label">Device</span><kbd>${
      this.lowMemory ? 'Low memory' : 'Standard'
    }</kbd>`;
    body.appendChild(row);
  }

  viewShortcuts(body) {
    const rows = [
      ['Play / pause', 'Space, K'],
      ['Seek back / forward', '← →'],
      ['Seek 10 seconds', 'J, L'],
      ['Volume', '↑ ↓'],
      ['Mute', 'M'],
      ['Full screen', 'F'],
      ['Picture in picture', 'P'],
      ['Subtitles', 'C'],
      ['Save frame', 'S'],
      ['Theatre mode', 'T'],
      ['A→B marker', 'B'],
      ['Repeat episode', 'R'],
      ['Frame step', '[  ]'],
      ['Speed down / up', ', .'],
      ['Jump to 0–90%', '0 – 9'],
      ['Next episode', 'N'],
      ['Close menu', 'Esc']
    ];

    for (const [label, keys] of rows) {
      const row = this.makeRow('div');
      row.classList.add('afp-row--keys');
      row.innerHTML = `<span class="afp-row__label">${label}</span><kbd>${keys}</kbd>`;
      body.appendChild(row);
    }
  }

  resetSettings() {
    for (const key of Object.values(STORE)) storageRemove(key);
    storageRemove('afp_auto_skip');

    this.subSize = 'medium';
    this.subColor = 'white';
    this.subBg = 'soft';
    this.subPos = 'normal';
    this.subDelay = 0;
    this.doubleTapSeconds = 10;
    this.hideDelay = 3000;
    this.gesturesOn = true;
    this.rememberSpeed = true;
    this.aspect = 'fit';
    this.zoom = 1;
    this.flip = false;
    this.fx = { brightness: 100, contrast: 100, saturation: 100, night: 0 };

    this.applyPicture();
    this.applySubtitleStyle();
    this.setRate(1, false);
    this.flash('reset', 'Settings reset');
    this.renderMenu();
  }

  /* --------------------------------------------------------------- quality */

  qualityOptions() {
    const hls = this.hls;
    if (!hls?.levels?.length) return [];

    const options = [{ label: 'Auto', value: -1, active: hls.autoLevelEnabled }];

    hls.levels.forEach((level, index) => {
      options.push({
        label: level.height ? `${level.height}p` : `${Math.round((level.bitrate || 0) / 1000)}k`,
        value: index,
        active: !hls.autoLevelEnabled && hls.currentLevel === index
      });
    });

    return options;
  }

  setQuality(value) {
    if (!this.hls) return;
    this.hls.currentLevel = Number(value);
    this.updateQualityChip();
    this.flash('gear', Number(value) < 0 ? 'Auto quality' : 'Quality changed');
  }

  updateQualityChip() {
    const chip = this.el?.quality;
    if (!chip) return;

    const level = this.hls?.levels?.length
      ? this.hls.levels[this.hls.currentLevel >= 0 ? this.hls.currentLevel : this.hls.loadLevel]
      : null;

    const height = level?.height || this.video.videoHeight || 0;
    if (!height) {
      chip.hidden = true;
      return;
    }

    chip.hidden = false;
    chip.textContent = `${height}p`;
  }

  /* ------------------------------------------------------------ media keys */

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const { animeTitle, episode, poster } = this.meta;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${animeTitle} — Episode ${episode}`,
        artist: 'AniFrame',
        album: animeTitle,
        artwork: poster ? [{ src: poster, sizes: '512x512', type: 'image/jpeg' }] : []
      });

      const handlers = {
        play: () => this.video.play(),
        pause: () => this.video.pause(),
        seekbackward: () => this.seekBy(-this.doubleTapSeconds),
        seekforward: () => this.seekBy(this.doubleTapSeconds),
        seekto: (details) => {
          if (details.seekTime != null) this.video.currentTime = details.seekTime;
        },
        nexttrack: () => this.meta.onNextEpisode?.(),
        previoustrack: () => this.meta.onPreviousEpisode?.()
      };

      for (const [action, handler] of Object.entries(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch {
          /* unsupported action */
        }
      }
    } catch {
      /* metadata unsupported */
    }
  }

  updateMediaSessionPosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;

    const duration = this.video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.video.playbackRate || 1,
        position: clamp(this.video.currentTime, 0, duration)
      });
    } catch {
      /* noop */
    }
  }

  /* --------------------------------------------------------------- cleanup */

  destroy() {
    this.session += 1;

    clearTimeout(this.hideTimer);
    clearInterval(this.nextCountdown);
    clearTimeout(this.sleepTimer);
    clearTimeout(this.flashTimer);
    clearTimeout(this.holdTimer);

    const video = this.video;
    const b = this._bound;

    if (video) {
      try {
        video.pause();
      } catch {
        /* noop */
      }

      video.removeEventListener('timeupdate', b.timeUpdate);
      video.removeEventListener('progress', b.progress);
      video.removeEventListener('playing', b.playing);
      video.removeEventListener('play', b.playing);
      video.removeEventListener('pause', b.pause);
      video.removeEventListener('waiting', b.waiting);
      video.removeEventListener('canplay', b.canplay);
      video.removeEventListener('volumechange', b.volume);
      video.removeEventListener('ratechange', b.rate);
      video.removeEventListener('ended', b.ended);
      video.removeEventListener('error', b.error);

      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* noop */
      }
    }

    if (this.root) {
      this.root.removeEventListener('pointermove', b.rootPointerMove);
      this.root.removeEventListener('pointerleave', b.rootPointerLeave);
      this.root.removeEventListener('click', b.stageTap);
      this.root.removeEventListener('pointerdown', b.gestureDown);
      this.root.removeEventListener('pointermove', b.gestureMove);
      this.root.removeEventListener('pointerup', b.gestureUp);
      this.root.removeEventListener('pointercancel', b.gestureUp);
    }

    document.removeEventListener('keydown', b.keydown);
    document.removeEventListener('fullscreenchange', b.fullscreen);
    document.removeEventListener('webkitfullscreenchange', b.fullscreen);
    document.removeEventListener('keydown', this._splashHotkey);

    try {
      this.surfaceGuard?.disconnect();
    } catch {
      /* noop */
    }
    this.surfaceGuard = null;

    try {
      this.audioSource?.disconnect();
      this.audioGain?.disconnect();
      this.audioCtx?.close();
    } catch {
      /* noop */
    }
    this.audioCtx = null;
    this.audioSource = null;
    this.audioGain = null;
    this.audioBoost = 1;

    try {
      this.hls?.destroy();
    } catch {
      /* noop */
    }

    this.clearTorrent();
    document.body.classList.remove('afp-playing', 'afp-theater');

    this.hls = null;
    this.video = null;
    this.root?.remove();
    this.root = null;
    this.el = null;
    this.cues = [];
    this.baseCues = [];
    this.activeCue = null;
    this.skipIntervals = [];
    this.menuOpen = false;
    this.statsOpen = false;
    this.theater = false;
    this.mini = false;
    this.pointers.clear();
    this.pinch = null;

    try {
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    } catch {
      /* noop */
    }
  }
}

export const Player = new VideoPlayerEngine();
