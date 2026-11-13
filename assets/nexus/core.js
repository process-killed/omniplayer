/**
 * =============================================================================
 * ANIFRAME NEXUS — Kernel v2.0
 * =============================================================================
 * A tiny runtime that makes the player trivially extendable.
 *
 * Everything advanced in this build is a *feature module*: one file, one
 * `Nexus.defineFeature({...})` call. The kernel owns:
 *
 *   store      → persisted settings (localStorage, dotted paths)
 *   bus        → pub/sub events
 *   registry   → feature lifecycle (mount / unmount / enable / disable)
 *   hotkeys    → combo registry with one global listener
 *   commands   → the action list consumed by the Command Palette
 *   ui         → toast stack, icons, element helpers
 *   theme      → accent + motion + glass + density tokens
 *   viewport   → phone / tablet / laptop / desktop / ultrawide classes
 *   player     → live ArtPlayer reference, published by the player module
 *
 * Adding a feature (see README "Vibe-coding a new feature"):
 *
 *   import { Nexus } from '../core.js';
 *   Nexus.defineFeature({
 *     id: 'my-feature', name: 'My Feature', icon: 'sparkles',
 *     category: 'Player', description: 'What it does.',
 *     mount(ctx) { ... }, unmount() { ... }
 *   });
 *
 * A throwing module is contained: it is caught, logged, marked failed in the
 * Nexus Lab, and the rest of the app keeps running.
 * =============================================================================
 */

export const VERSION = '2.0.0';
export const BUILD = '50.0';

const STORE_KEY = 'aniframe.nexus.v2';

/* --------------------------------------------------------------------------
 * 01. Settings store
 * ------------------------------------------------------------------------ */

const DEFAULTS = Object.freeze({
  theme: {
    accent: 'rose',
    motion: 'full', // full | reduced | off
    glass: 'medium', // high | medium | low
    density: 'comfortable' // comfortable | compact
  },
  flags: {}, // feature-id → boolean
  player: {
    autoplayNext: true,
    defaultRate: 1,
    subtitleScale: 100,
    skipIntro: false,
    ambient: false,
    gestures: true,
    volumeBoost: 1,
    rememberSpeed: true
  },
  ui: {
    hudAutoHide: 7000,
    seenIntro: false,
    paletteRecent: [],
    lastTab: 'appearance'
  }
});

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return clone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base?.[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readDisk() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const data = deepMerge(DEFAULTS, readDisk());

const storeListeners = new Set();
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota — settings simply stay in memory */
    }
  }, 180);
}

function walk(path, create = false) {
  const parts = String(path).split('.').filter(Boolean);
  let node = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (node[key] == null || typeof node[key] !== 'object') {
      if (!create) return null;
      node[key] = {};
    }
    node = node[key];
  }
  return { node, key: parts[parts.length - 1] };
}

export const store = {
  get(path, fallback = null) {
    const ref = walk(path);
    if (!ref) return fallback;
    const value = ref.node[ref.key];
    return value === undefined ? fallback : value;
  },

  set(path, value, { silent = false } = {}) {
    const ref = walk(path, true);
    if (!ref) return value;
    const before = ref.node[ref.key];
    ref.node[ref.key] = value;
    persist();
    if (!silent && before !== value) emit('store', { path, value, before });
    return value;
  },

  toggle(path, fallback = false) {
    const next = !this.get(path, fallback);
    this.set(path, next);
    return next;
  },

  all() {
    return data;
  },

  defaults() {
    return clone(DEFAULTS);
  },

  reset(section = null) {
    if (!section) {
      const fresh = clone(DEFAULTS);
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, fresh);
    } else {
      data[section] = clone(DEFAULTS[section] ?? {});
    }
    persist();
    emit('store', { path: section || '*', value: data });
    emit('theme');
  },

  subscribe(fn) {
    storeListeners.add(fn);
    return () => storeListeners.delete(fn);
  }
};

/* --------------------------------------------------------------------------
 * 02. Event bus
 * ------------------------------------------------------------------------ */

const busMap = new Map();

export function on(event, fn) {
  if (!busMap.has(event)) busMap.set(event, new Set());
  busMap.get(event).add(fn);
  return () => busMap.get(event)?.delete(fn);
}

export function once(event, fn) {
  const off = on(event, (payload) => {
    off();
    fn(payload);
  });
  return off;
}

export function emit(event, payload) {
  for (const fn of busMap.get(event) || []) {
    try {
      fn(payload);
    } catch (error) {
      console.warn(`[Nexus] listener error on "${event}"`, error);
    }
  }
  if (event !== 'store') {
    for (const fn of storeListeners) {
      try {
        fn({ event, payload });
      } catch {
        /* noop */
      }
    }
  }
}

/* --------------------------------------------------------------------------
 * 03. Icons
 * ------------------------------------------------------------------------ */

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  command:
    '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 3-3z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  'skip-forward':
    '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  'skip-back':
    '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  volume:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  mute:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
  gauge: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="16.5" y2="8"/>',
  subtitles:
    '<rect x="2" y="5" width="20" height="14" rx="2.5"/><line x1="6" y1="12" x2="12" y2="12"/><line x1="14" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="10" y2="16"/>',
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="8" height="6" rx="1"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="6.5" y2="6.5"/><line x1="17.5" y1="17.5" x2="19" y2="19"/><line x1="19" y1="5" x2="17.5" y2="6.5"/><line x1="6.5" y1="17.5" x2="5" y2="19"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  timer:
    '<circle cx="12" cy="13" r="8"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="9" y1="2" x2="15" y2="2"/>',
  repeat:
    '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  grid:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  wifi: '<path d="M5 12.6a11 11 0 0 1 14 0"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>',
  'wifi-off':
    '<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/><path d="M5 12.6a11 11 0 0 1 5-2.7"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  message:
    '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  maximize:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M16 3v3a2 2 0 0 0 2 2h3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><line x1="2" y1="12" x2="22" y2="12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/>',
  keyboard:
    '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9.5" cy="15" r="1.2"/>',
  sparkles:
    '<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  eye: '<path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/>',
  'chevron-right': '<polyline points="9 6 15 12 9 18"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  brightness:
    '<circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  rocket:
    '<path d="M5 15c-1.5 1.5-2 6-2 6s4.5-.5 6-2"/><path d="M9 19l-3-3"/><path d="M14.5 4.5C18 1 22 2 22 2s1 4-2.5 7.5L14 15l-5-5z"/><circle cx="16" cy="8" r="1.4"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/>',
  tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><polyline points="7 3 12 7 17 3"/>'
};

export function icon(name, size = 16, extraClass = '') {
  const body = ICONS[name] || ICONS.sparkles;
  return (
    `<svg class="nx-ico ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/* --------------------------------------------------------------------------
 * 04. DOM helpers
 * ------------------------------------------------------------------------ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  if (html != null) node.innerHTML = html;
  return node;
}

export function isTyping(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable="true"],[role="textbox"]'
      )
    )
  );
}

export function fmtTime(seconds, { forceHours = false } = {}) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0 || forceHours) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const left = wait - (now - last);
    if (left <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, left);
    }
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* --------------------------------------------------------------------------
 * 05. Toasts
 * ------------------------------------------------------------------------ */

let toastStack = null;

function ensureToastStack() {
  if (toastStack?.isConnected) return toastStack;
  toastStack = el('div', {
    id: 'nxToastStack',
    class: 'nx-toast-stack',
    role: 'status',
    'aria-live': 'polite'
  });
  document.body.appendChild(toastStack);
  return toastStack;
}

export function toast(message, options = {}) {
  const {
    type = 'info',
    duration = 2600,
    iconName = null,
    action = null
  } = typeof options === 'string' ? { type: options } : options;

  const stack = ensureToastStack();
  const glyph =
    iconName ||
    (type === 'success' ? 'check' : type === 'error' ? 'info' : 'sparkles');

  const node = el('div', { class: `nx-toast nx-toast--${type}` });
  node.innerHTML =
    `<span class="nx-toast__icon">${icon(glyph, 15)}</span>` +
    `<span class="nx-toast__text"></span>` +
    (action ? '<button class="nx-toast__action" type="button"></button>' : '');

  node.querySelector('.nx-toast__text').textContent = String(message);

  if (action) {
    const btn = node.querySelector('.nx-toast__action');
    btn.textContent = action.label || 'Do it';
    btn.addEventListener('click', () => {
      try {
        action.run?.();
      } finally {
        dismiss();
      }
    });
  }

  const dismiss = () => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  };

  stack.appendChild(node);
  while (stack.children.length > 4) stack.firstElementChild?.remove();

  requestAnimationFrame(() => node.classList.add('is-in'));

  const timer = setTimeout(dismiss, clamp(duration, 900, 12000));
  node.addEventListener('pointerenter', () => clearTimeout(timer), { once: true });
  return dismiss;
}

/* --------------------------------------------------------------------------
 * 06. Theme
 * ------------------------------------------------------------------------ */

export const ACCENTS = Object.freeze([
  { id: 'rose', name: 'Rose', hex: '#f2545b', rgb: '242, 84, 91' },
  { id: 'blue', name: 'Blue', hex: '#4a8cff', rgb: '74, 140, 255' },
  { id: 'green', name: 'Green', hex: '#2fa971', rgb: '47, 169, 113' },
  { id: 'amber', name: 'Amber', hex: '#e09b3d', rgb: '224, 155, 61' },
  { id: 'lavender', name: 'Lavender', hex: '#9b8cf5', rgb: '155, 140, 245' },
  { id: 'graphite', name: 'Graphite', hex: '#c9cdd4', rgb: '201, 205, 212' }
]);

export function applyTheme() {
  const root = document.documentElement;
  const theme = store.get('theme', DEFAULTS.theme);
  const accent =
    ACCENTS.find((item) => item.id === theme.accent) || ACCENTS[0];

  root.style.setProperty('--nx-accent', accent.hex);
  root.style.setProperty('--nx-accent-rgb', accent.rgb);
  root.style.setProperty('--nx-accent-soft', `rgba(${accent.rgb}, .12)`);
  root.style.setProperty('--nx-accent-line', `rgba(${accent.rgb}, .38)`);
  root.style.setProperty('--nx-accent-glow', `rgba(${accent.rgb}, .22)`);

  // Keep the media engine in the same colour family as the chrome.
  root.style.setProperty('--player-theme', accent.hex);
  root.style.setProperty('--player-theme-rgb', accent.rgb);
  root.style.setProperty('--player-theme-glow', `rgba(${accent.rgb}, .32)`);
  root.style.setProperty('--player-theme-soft', `rgba(${accent.rgb}, .12)`);
  root.style.setProperty('--art-theme', accent.hex);

  root.dataset.nxAccent = accent.id;
  root.dataset.nxMotion = theme.motion;
  root.dataset.nxGlass = theme.glass;
  root.dataset.nxDensity = theme.density;
  root.dataset.nxTheme = 'dark';

  emit('theme', accent);
}

export function setAccent(id) {
  store.set('theme.accent', id);
  applyTheme();
}

/* --------------------------------------------------------------------------
 * 07. Viewport intelligence
 * ------------------------------------------------------------------------ */

export const viewport = {
  width: 0,
  height: 0,
  mode: 'desktop',
  orientation: 'landscape',
  ratio: 16 / 9,
  touch: false,
  listeners: new Set()
};

function computeViewport() {
  const w = window.innerWidth || document.documentElement.clientWidth || 1280;
  const h = window.innerHeight || document.documentElement.clientHeight || 720;
  const ratio = h > 0 ? w / h : 1.78;

  let mode = 'desktop';
  if (w < 560) mode = 'phone';
  else if (w < 900) mode = 'tablet';
  else if (w < 1360) mode = 'laptop';
  if (ratio > 2.1 && w > 1200) mode = 'ultrawide';

  viewport.width = w;
  viewport.height = h;
  viewport.ratio = ratio;
  viewport.mode = mode;
  viewport.orientation = h >= w ? 'portrait' : 'landscape';
  viewport.touch =
    navigator.maxTouchPoints > 0 ||
    Boolean(window.matchMedia?.('(pointer: coarse)').matches);

  const root = document.documentElement;
  root.dataset.nxView = mode;
  root.dataset.nxOrient = viewport.orientation;
  root.dataset.nxTouch = viewport.touch ? 'true' : 'false';
  root.style.setProperty('--nx-vh', `${h * 0.01}px`);
  root.style.setProperty('--nx-vw', `${w * 0.01}px`);

  for (const fn of viewport.listeners) {
    try {
      fn(viewport);
    } catch (error) {
      console.warn('[Nexus] viewport listener', error);
    }
  }
  emit('viewport', viewport);
}

export function onViewport(fn) {
  viewport.listeners.add(fn);
  fn(viewport);
  return () => viewport.listeners.delete(fn);
}

/* --------------------------------------------------------------------------
 * 08. Hotkeys
 * ------------------------------------------------------------------------ */

const hotkeyList = [];

function normalizeCombo(combo) {
  const parts = String(combo)
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    key: parts[parts.length - 1],
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift')
  };
}

export function registerHotkey(combo, handler, meta = {}) {
  const entry = {
    combo: String(combo).toLowerCase(),
    parsed: normalizeCombo(combo),
    handler,
    label: meta.label || '',
    group: meta.group || 'General',
    scope: meta.scope || 'global',
    feature: meta.feature || null
  };
  hotkeyList.push(entry);
  return () => {
    const index = hotkeyList.indexOf(entry);
    if (index >= 0) hotkeyList.splice(index, 1);
  };
}

const docHotkeys = [];

export function hotkeys() {
  const seen = new Set();
  const out = [];
  for (const entry of [...hotkeyList, ...docHotkeys]) {
    const key = `${entry.combo}|${entry.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function comboMatches(parsed, event) {
  const key = String(event.key || '').toLowerCase();
  const code = String(event.code || '').toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (parsed.mod !== mod) return false;
  if (parsed.ctrl && !event.ctrlKey) return false;
  if (parsed.meta && !event.metaKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;

  const wanted = parsed.key;
  if (wanted === key) return true;
  if (wanted === code) return true;
  // "?" arrives as shift+/ on most layouts.
  if (wanted === '?' && (key === '?' || (code === 'slash' && event.shiftKey))) {
    return true;
  }
  return false;
}

function hotkeyDispatcher(event) {
  if (event.defaultPrevented) return;

  for (const entry of hotkeyList) {
    if (!comboMatches(entry.parsed, event)) continue;

    const typing = isTyping(event.target);
    if (typing && !entry.parsed.mod && entry.parsed.key !== 'escape') return;

    try {
      const handled = entry.handler(event);
      if (handled !== false) {
        event.preventDefault();
        event.stopPropagation();
      }
    } catch (error) {
      console.warn(`[Nexus] hotkey "${entry.combo}" failed`, error);
    }
    return;
  }
}

/* --------------------------------------------------------------------------
 * 09. Commands
 * ------------------------------------------------------------------------ */

const commandList = new Map();

export function addCommand(command) {
  if (!command?.id || typeof command.run !== 'function') return () => {};
  commandList.set(command.id, {
    group: 'Actions',
    icon: 'sparkles',
    keywords: '',
    ...command
  });
  return () => commandList.delete(command.id);
}

export function commands() {
  return Array.from(commandList.values());
}

export function runCommand(id) {
  const command = commandList.get(id);
  if (!command) return false;
  try {
    command.run();
    return true;
  } catch (error) {
    console.warn(`[Nexus] command "${id}" failed`, error);
    toast(`That action failed: ${error?.message || 'unknown error'}`, 'error');
    return false;
  }
}

/* --------------------------------------------------------------------------
 * 10. Feature registry
 * ------------------------------------------------------------------------ */

const features = new Map();
const mounted = new Map();

export function defineFeature(spec) {
  if (!spec?.id) throw new Error('[Nexus] defineFeature requires an id');

  const feature = {
    id: spec.id,
    name: spec.name || spec.id,
    icon: spec.icon || 'sparkles',
    category: spec.category || 'Core',
    description: spec.description || '',
    tags: spec.tags || [],
    order: spec.order ?? 100,
    default: spec.default !== false,
    hotkeys: spec.hotkeys || [],
    commands: spec.commands || [],
    experimental: Boolean(spec.experimental),
    mount: spec.mount || null,
    unmount: spec.unmount || null,
    status: 'idle',
    error: null,
    spec
  };

  features.set(feature.id, feature);

  for (const hotkey of feature.hotkeys) {
    // Only bind combos that carry their own handler. A label-only entry is
    // documentation: it shows up in the shortcut sheet, but the feature
    // itself owns the binding (so two modules can share a combo safely).
    if (typeof hotkey.run !== 'function') {
      docHotkeys.push({
        combo: String(hotkey.combo).toLowerCase(),
        label: hotkey.label || hotkey.combo,
        group: hotkey.group || feature.name,
        feature: feature.id,
        doc: true
      });
      continue;
    }
    registerHotkey(hotkey.combo, (event) => hotkey.run(event), {
      label: hotkey.label,
      group: hotkey.group || feature.name,
      feature: feature.id,
      scope: hotkey.scope || 'global'
    });
  }

  for (const command of feature.commands) {
    addCommand({ ...command, id: `${feature.id}:${command.id}`, feature: feature.id });
  }

  return feature;
}

export function listFeatures() {
  return Array.from(features.values()).sort((a, b) => a.order - b.order);
}

export function getFeature(id) {
  return features.get(id) || null;
}

export function isEnabled(id) {
  const feature = features.get(id);
  if (!feature) return false;
  return store.get(`flags.${id}`, feature.default) !== false;
}

function mountFeature(feature) {
  if (!feature.mount) {
    feature.status = 'active';
    return;
  }
  try {
    const cleanup = feature.mount({
      Nexus,
      feature,
      store,
      bus: { on, emit },
      toast,
      icon,
      el,
      player: () => Nexus.player
    });
    mounted.set(feature.id, typeof cleanup === 'function' ? cleanup : null);
    feature.status = 'active';
    feature.error = null;
  } catch (error) {
    feature.status = 'failed';
    feature.error = error?.message || String(error);
    console.warn(`[Nexus] feature "${feature.id}" failed to mount`, error);
  }
}

function unmountFeature(feature) {
  try {
    mounted.get(feature.id)?.();
  } catch (error) {
    console.warn(`[Nexus] feature "${feature.id}" cleanup failed`, error);
  }
  mounted.delete(feature.id);
  try {
    feature.unmount?.();
  } catch (error) {
    console.warn(`[Nexus] feature "${feature.id}" unmount failed`, error);
  }
  feature.status = 'idle';
}

export function enableFeature(id, enabled) {
  const feature = features.get(id);
  if (!feature) return false;

  store.set(`flags.${id}`, !!enabled);

  if (enabled) {
    if (!mounted.has(id) && feature.status !== 'active') mountFeature(feature);
  } else {
    unmountFeature(feature);
  }

  emit('features', { id, enabled: !!enabled });
  return true;
}

export function toggleFeature(id) {
  return enableFeature(id, !isEnabled(id));
}

/* --------------------------------------------------------------------------
 * 11. The kernel object
 * ------------------------------------------------------------------------ */

export const Nexus = {
  version: VERSION,
  build: BUILD,
  store,
  on,
  once,
  emit,
  icon,
  el,
  $,
  $$,
  toast,
  fmtTime,
  fmtBytes,
  debounce,
  throttle,
  clamp,
  isTyping,
  hotkeys,
  registerHotkey,
  commands,
  addCommand,
  runCommand,
  defineFeature,
  listFeatures,
  getFeature,
  isEnabled,
  enableFeature,
  toggleFeature,
  applyTheme,
  setAccent,
  ACCENTS,
  viewport,
  onViewport,
  player: null,

  /** Live bridge published by assets/app.js once the shell boots. */
  get bridge() {
    return window.AniFrameBridge || null;
  },

  ready(callback) {
    if (this._ready) callback(this);
    else this._readyQueue.push(callback);
  },

  _ready: false,
  _readyQueue: [],

  start() {
    if (this._started) return;
    this._started = true;

    applyTheme();
    computeViewport();

    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(computeViewport);
    };
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onResize, { passive: true });

    document.addEventListener('keydown', hotkeyDispatcher, true);

    store.subscribe(({ event }) => {
      if (event === 'theme') applyTheme();
    });

    for (const feature of listFeatures()) {
      if (isEnabled(feature.id)) mountFeature(feature);
    }

    document.documentElement.dataset.nxBooted = 'true';
    this._ready = true;

    for (const callback of this._readyQueue.splice(0)) {
      try {
        callback(this);
      } catch (error) {
        console.warn('[Nexus] ready callback failed', error);
      }
    }

    emit('ready', this);
    console.info(
      `%c NEXUS %c v${VERSION} · ${listFeatures().length} features loaded `,
      'background:#00e5ff;color:#030407;font-weight:700;border-radius:3px',
      'color:#00e5ff'
    );
  }
};

// Keep a global handle so console tinkering / rapid prototyping is trivial:
//   Nexus.toggleFeature('ambient-engine')
window.Nexus = Nexus;
