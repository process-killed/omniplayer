/**
 * Magnet link parsing.
 *
 * `magnet:?xt=urn:btih:<hash>&dn=<name>&tr=<tracker>&ws=<web seed>&xl=<size>`
 *
 * Browsers can only talk to WebRTC peers, so the trackers and web seeds in the
 * link decide whether a swarm is reachable at all — the UI reports exactly that.
 */

export interface MagnetInfo {
  infoHash: string;
  rawHash: string;
  name: string;
  trackers: string[];
  webSeeds: string[];
  size: number | null;
  hasWebSeed: boolean;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (32 chars) → lowercase hex (40 chars). */
export function base32ToHex(value: string): string {
  let bits = '';
  for (const char of value.toUpperCase().replace(/=+$/, '')) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function isMagnet(input: string): boolean {
  return /^magnet:\?/i.test(input.trim());
}

export function parseMagnet(input: string): MagnetInfo | null {
  const text = input.trim();
  if (!isMagnet(text)) return null;

  const params = new URLSearchParams(text.slice(text.indexOf('?') + 1));
  const btih = params
    .getAll('xt')
    .map((xt) => /urn:btih:([a-z0-9]+)/i.exec(xt))
    .find(Boolean);
  if (!btih) return null;

  const rawHash = btih[1];
  let infoHash = rawHash.toLowerCase();
  if (rawHash.length === 32) infoHash = base32ToHex(rawHash);
  if (!/^[0-9a-f]{40}$/.test(infoHash)) return null;

  const trackers = params.getAll('tr').map((value) => safeDecode(value)).filter(Boolean);
  const webSeeds = params.getAll('ws').map((value) => safeDecode(value)).filter(Boolean);
  const sizeRaw = params.get('xl');
  const size = sizeRaw && Number.isFinite(Number(sizeRaw)) ? Number(sizeRaw) : null;

  return {
    infoHash,
    rawHash,
    name: params.get('dn') ?? `Torrent ${infoHash.slice(0, 8)}`,
    trackers,
    webSeeds,
    size,
    hasWebSeed: webSeeds.length > 0,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Trackers that speak WebSocket — the only kind a browser can use. */
export function webtorrentTrackers(trackers: string[]): string[] {
  const defaults = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.files.fm:7073/announce',
  ];
  const usable = trackers.filter((tracker) => /^wss:\/\//i.test(tracker));
  return Array.from(new Set([...usable, ...defaults]));
}

export const PLAYABLE_EXTENSIONS = [
  'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'flv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg',
  'wmv', 'ogv', '3gp', 'mp3', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'wav',
];

export function isPlayableName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return PLAYABLE_EXTENSIONS.includes(ext);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}
