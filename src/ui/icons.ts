/**
 * Inline SVG icon set. Stroke icons use `currentColor`; a few solid glyphs
 * (play/pause) set `fill` so they read correctly at small sizes.
 */

type IconDef = { body: string; fill?: boolean; viewBox?: string };

const S = 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"';

const ICONS: Record<string, IconDef> = {
  play: { body: '<path d="M7.5 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L9.03 3.95A1 1 0 0 0 7.5 4.8Z"/>', fill: true },
  pause: { body: '<rect x="6.5" y="4" width="4" height="16" rx="1.2"/><rect x="13.5" y="4" width="4" height="16" rx="1.2"/>', fill: true },
  stop: { body: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>', fill: true },
  prev: { body: `<path d="M19 5v14l-9-7 9-7Z" fill="currentColor"/><path d="M5 5v14" ${S}/>` },
  next: { body: `<path d="M5 5v14l9-7-9-7Z" fill="currentColor"/><path d="M19 5v14" ${S}/>` },
  rewind: { body: `<path d="M3 12a9 9 0 1 0 3.5-7.1" ${S}/><path d="M3 4v5h5" ${S}/>` },
  forward: { body: `<path d="M21 12a9 9 0 1 1-3.5-7.1" ${S}/><path d="M21 4v5h-5" ${S}/>` },
  seekBack: { body: `<path d="M11 4 4 11l7 7" ${S}/><path d="M20 5v12a2 2 0 0 1-2 2H8" ${S}/>` },
  seekForward: { body: `<path d="m13 4 7 7-7 7" ${S}/><path d="M4 5v12a2 2 0 0 0 2 2h10" ${S}/>` },
  volume: { body: `<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" ${S}/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" ${S}/>` },
  volumeLow: { body: `<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" ${S}/><path d="M15 9.5a3.5 3.5 0 0 1 0 5" ${S}/>` },
  volumeMute: { body: `<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" ${S}/><path d="m16 9.5 5 5m0-5-5 5" ${S}/>` },
  maximize: { body: `<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" ${S}/>` },
  minimize: { body: `<path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M21 16h-3a2 2 0 0 0-2 2v3M3 16h3a2 2 0 0 1 2 2v3" ${S}/>` },
  settings: { body: `<circle cx="12" cy="12" r="3" ${S}/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7h.09A1.7 1.7 0 0 0 10.1 3.15V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" ${S}/>` },
  sliders: { body: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" ${S}/><circle cx="16" cy="6" r="2" ${S}/><circle cx="10" cy="12" r="2" ${S}/><circle cx="18" cy="18" r="2" ${S}/>` },
  subtitles: { body: `<rect x="3" y="5" width="18" height="14" rx="2.5" ${S}/><path d="M7 15h4M13 15h4M7 11h2M11 11h6" ${S}/>` },
  audio: { body: `<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" ${S}/>` },
  music: { body: `<path d="M9 18V5l11-2v13" ${S}/><circle cx="6" cy="18" r="3" ${S}/><circle cx="17" cy="16" r="3" ${S}/>` },
  list: { body: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" ${S}/>` },
  listVideo: { body: `<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13" ${S}/>` },
  clock: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="M12 7v5l3.5 2" ${S}/>` },
  timer: { body: `<circle cx="12" cy="13" r="8" ${S}/><path d="M12 9v4l2.5 1.5M9 2h6" ${S}/>` },
  bookmark: { body: `<path d="M19 21l-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" ${S}/>` },
  bookmarkPlus: { body: `<path d="M19 21l-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" ${S}/><path d="M12 7v6M9 10h6" ${S}/>` },
  folder: { body: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" ${S}/>` },
  folderOpen: { body: `<path d="M3 8V6a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V10" ${S}/><path d="M3 10h18l-2.2 8.2a2 2 0 0 1-1.93 1.5H6.13a2 2 0 0 1-1.93-1.5L3 10Z" ${S}/>` },
  link: { body: `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11.6 5" ${S}/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.4 19" ${S}/>` },
  home: { body: `<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2v-9Z" ${S}/>` },
  info: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="M12 11v5M12 8h.01" ${S}/>` },
  activity: { body: `<path d="M3 12h4l3-8 4 16 3-8h4" ${S}/>` },
  chevronLeft: { body: `<path d="m15 5-7 7 7 7" ${S}/>` },
  chevronRight: { body: `<path d="m9 5 7 7-7 7" ${S}/>` },
  chevronDown: { body: `<path d="m5 9 7 7 7-7" ${S}/>` },
  chevronUp: { body: `<path d="m5 15 7-7 7 7" ${S}/>` },
  arrowLeft: { body: `<path d="M19 12H5M11 6l-6 6 6 6" ${S}/>` },
  arrowRight: { body: `<path d="M5 12h14M13 6l6 6-6 6" ${S}/>` },
  check: { body: `<path d="m4 12.5 5 5L20 6.5" ${S}/>` },
  x: { body: `<path d="M6 6l12 12M18 6 6 18" ${S}/>` },
  plus: { body: `<path d="M12 5v14M5 12h14" ${S}/>` },
  minus: { body: `<path d="M5 12h14" ${S}/>` },
  trash: { body: `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" ${S}/>` },
  search: { body: `<circle cx="11" cy="11" r="7" ${S}/><path d="m20 20-3.5-3.5" ${S}/>` },
  upload: { body: `<path d="M12 16V4M7 9l5-5 5 5" ${S}/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" ${S}/>` },
  film: { body: `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" ${S}/>` },
  fileVideo: { body: `<path d="M14 3v5h5" ${S}/><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5Z" ${S}/><path d="m10 12 5 3-5 3v-6Z" ${S}/>` },
  pip: { body: `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><rect x="12" y="12" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>` },
  rotate: { body: `<path d="M4 12a8 8 0 1 1 2.4 5.7" ${S}/><path d="M4 20v-5h5" ${S}/>` },
  crop: { body: `<path d="M6 3v13a2 2 0 0 0 2 2h13M3 6h13a2 2 0 0 1 2 2v13" ${S}/>` },
  zap: { body: `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" ${S}/>` },
  layers: { body: `<path d="m12 3 9 5-9 5-9-5 9-5Z" ${S}/><path d="m3 13 9 5 9-5" ${S}/>` },
  gauge: { body: `<path d="M4 18a9 9 0 1 1 16 0" ${S}/><path d="m12 14 4-4" ${S}/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/>` },
  repeat: { body: `<path d="m17 2 4 4-4 4" ${S}/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" ${S}/><path d="M21 13v2a4 4 0 0 1-4 4H3" ${S}/>` },
  repeatOne: { body: `<path d="m17 2 4 4-4 4" ${S}/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" ${S}/><path d="M21 13v2a4 4 0 0 1-4 4H3" ${S}/><path d="M12 9v6M10 11l2-2" ${S}/>` },
  shuffle: { body: `<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" ${S}/>` },
  sun: { body: `<circle cx="12" cy="12" r="4" ${S}/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" ${S}/>` },
  cloud: { body: `<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 10.5 4 4 0 0 0 7 19h10.5Z" ${S}/><path d="M12 12v6M9.5 15.5 12 18l2.5-2.5" ${S}/>` },
  message: { body: `<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" ${S}/><path d="M8.5 11h7M8.5 14.5h4" ${S}/>` },
  lock: { body: `<rect x="4" y="10" width="16" height="11" rx="2" ${S}/><path d="M8 10V7a4 4 0 0 1 8 0v3" ${S}/>` },
  download: { body: `<path d="M12 4v12M7 11l5 5 5-5" ${S}/><path d="M4 20h16" ${S}/>` },
  share: { body: `<circle cx="18" cy="5" r="3" ${S}/><circle cx="6" cy="12" r="3" ${S}/><circle cx="18" cy="19" r="3" ${S}/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" ${S}/>` },
  copy: { body: `<rect x="9" y="9" width="12" height="12" rx="2" ${S}/><path d="M5 15V5a2 2 0 0 1 2-2h8" ${S}/>` },
  keyboard: { body: `<rect x="2" y="6" width="20" height="12" rx="2" ${S}/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" ${S}/>` },
  code: { body: `<path d="m9 8-5 4 5 4M15 8l5 4-5 4" ${S}/>` },
  monitor: { body: `<rect x="2" y="4" width="20" height="13" rx="2" ${S}/><path d="M8 21h8M12 17v4" ${S}/>` },
  palette: { body: `<path d="M12 21a9 9 0 1 1 0-18c4.5 0 8 3 8 6.5 0 2.2-1.8 3.5-3.6 3.5H15a2 2 0 0 0-1.4 3.4c.4.4.6.9.6 1.4 0 1.2-1 1.7-2.2 1.7Z" ${S}/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7.5" r="1" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor"/>` },
  shield: { body: `<path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z" ${S}/><path d="m9 12 2 2 4-4" ${S}/>` },
  database: { body: `<ellipse cx="12" cy="6" rx="8" ry="3" ${S}/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" ${S}/>` },
  cast: { body: `<path d="M2 17a5 5 0 0 1 5 5M2 13a9 9 0 0 1 9 9M2 9a13 13 0 0 1 13 13" ${S}/><path d="M8 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" ${S}/>` },
  more: { body: `<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>` },
  moreH: { body: `<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>` },
  grid: { body: `<rect x="3" y="3" width="7" height="7" rx="1.5" ${S}/><rect x="14" y="3" width="7" height="7" rx="1.5" ${S}/><rect x="3" y="14" width="7" height="7" rx="1.5" ${S}/><rect x="14" y="14" width="7" height="7" rx="1.5" ${S}/>` },
  star: { body: `<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.2-.9L12 3Z" ${S}/>` },
  wifi: { body: `<path d="M5 12.5a10 10 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01" ${S}/>` },
  alert: { body: `<path d="M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" ${S}/><path d="M12 9v4M12 17h.01" ${S}/>` },
  checkCircle: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="m8 12.5 2.5 2.5L16 9.5" ${S}/>` },
  alertCircle: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="M12 8v4M12 16h.01" ${S}/>` },
  eye: { body: `<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" ${S}/><circle cx="12" cy="12" r="2.6" ${S}/>` },
  eyeOff: { body: `<path d="M10.7 6.1A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.3 4M6.4 7.9A17 17 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4.2-.9" ${S}/><path d="m3 3 18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" ${S}/>` },
  type: { body: `<path d="M4 6V4h16v2M12 4v16M9 20h6" ${S}/>` },
  scissors: { body: `<circle cx="6" cy="6" r="3" ${S}/><circle cx="6" cy="18" r="3" ${S}/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" ${S}/>` },
  move: { body: `<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" ${S}/>` },
  aspect: { body: `<rect x="2" y="6" width="20" height="12" rx="2" ${S}/><path d="M6 10v4M18 10v4" ${S}/>` },
  flipH: { body: `<path d="M12 3v18M8 7 3 12l5 5V7ZM16 7l5 5-5 5V7Z" ${S}/>` },
  flipV: { body: `<path d="M3 12h18M7 8l5-5 5 5H7ZM7 16l5 5 5-5H7Z" ${S}/>` },
  sparkles: { body: `<path d="m12 3 1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3Z" ${S}/><path d="M18.5 15.5l.9 2.2 2.1.8-2.1.8-.9 2.2-.9-2.2-2.1-.8 2.1-.8.9-2.2Z" ${S}/>` },
  refresh: { body: `<path d="M21 12a9 9 0 1 1-2.6-6.4" ${S}/><path d="M21 4v5h-5" ${S}/>` },
  external: { body: `<path d="M14 4h6v6M20 4l-9 9" ${S}/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" ${S}/>` },
  save: { body: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" ${S}/><path d="M8 3v6h8M8 21v-7h8v7" ${S}/>` },
  edit: { body: `<path d="M12 20h9" ${S}/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" ${S}/>` },
  tag: { body: `<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z" ${S}/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>` },
  minusCircle: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="M8 12h8" ${S}/>` },
  headphone: { body: `<path d="M4 14v-2a8 8 0 0 1 16 0v2" ${S}/><rect x="2" y="14" width="4" height="7" rx="1.5" ${S}/><rect x="18" y="14" width="4" height="7" rx="1.5" ${S}/>` },
  mic: { body: `<rect x="9" y="2" width="6" height="12" rx="3" ${S}/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" ${S}/>` },
  languages: { body: `<path d="M3 5h10M8 3v2c0 4-2 7-5 9M5 10c0 3 2 5 5 6" ${S}/><path d="m13 21 4-10 4 10M14.5 17h5" ${S}/>` },
  scan: { body: `<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" ${S}/>` },
  hand: { body: `<path d="M8 13V5a2 2 0 1 1 4 0v6M12 11V4a2 2 0 1 1 4 0v7M16 11V6a2 2 0 1 1 4 0v9a6 6 0 0 1-6 6h-2a6 6 0 0 1-4.5-2L4 15a2 2 0 0 1 3-2.6L8 13" ${S}/>` },
  bookOpen: { body: `<path d="M12 7c-2-2-5-2.5-9-2.5V19c4 0 7 .5 9 2.5 2-2 5-2.5 9-2.5V4.5C17 4.5 14 5 12 7Z" ${S}/><path d="M12 7v14.5" ${S}/>` },
  help: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4M12 17h.01" ${S}/>` },
  hourglass: { body: `<path d="M7 2h10M7 22h10M6 2v4c0 3 6 6 6 6s-6 3-6 6v4M18 2v4c0 3-6 6-6 6s6 3 6 6v4" ${S}/>` },
  scanLine: { body: `<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" ${S}/>` },
  logOut: { body: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" ${S}/>` },
  compass: { body: `<circle cx="12" cy="12" r="9" ${S}/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" ${S}/>` },
};

export function icon(name: string, size = 18, extraClass = ''): string {
  const def = ICONS[name] ?? ICONS.help;
  const vb = def.viewBox ?? '0 0 24 24';
  const attrs = def.fill
    ? 'fill="currentColor" stroke="none"'
    : `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  return `<svg viewBox="${vb}" width="${size}" height="${size}" ${attrs} aria-hidden="true" focusable="false"${
    extraClass ? ` class="${extraClass}"` : ''
  }>${def.body}</svg>`;
}

export function hasIcon(name: string): boolean {
  return name in ICONS;
}
