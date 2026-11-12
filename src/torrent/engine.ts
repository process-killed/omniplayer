/**
 * Torrent playback in the browser.
 *
 * Two routes, because they have very different reach:
 *
 * 1. **WebTorrent (WebRTC)** — runs entirely in the page. A browser can only
 *    connect to WebRTC peers, so this works when the swarm has WebRTC peers or
 *    a web seed (`ws=`), and stalls on classic TCP swarms.
 * 2. **Gateway** — an HTTP service you point at (your own webtor-style proxy).
 *    It fetches the torrent server-side and serves the file with range support,
 *    so any magnet plays. Set it in Settings → Torrents.
 *
 * The client library is loaded lazily from /vendor/webtorrent.min.js, so it costs
 * nothing until someone actually opens a magnet.
 */

import { formatBytes, isPlayableName, parseMagnet, webtorrentTrackers, type MagnetInfo } from './magnet';

export interface TorrentFile {
  index: number;
  name: string;
  length: number;
  playable: boolean;
  label: string;
}

export interface TorrentStats {
  peers: number;
  progress: number;
  downloaded: number;
  downloadSpeed: number;
  timeRemaining: number;
  state: 'idle' | 'metadata' | 'downloading' | 'ready' | 'error';
  message?: string;
}

type WebTorrentFile = {
  name: string;
  length: number;
  progress: number;
  select?: () => void;
  deselect?: () => void;
  getBlobURL?: (cb: (error: Error | null, url?: string) => void) => void;
  streamURL?: string;
};

type WebTorrentTorrent = {
  infoHash: string;
  name: string;
  files: WebTorrentFile[];
  numPeers: number;
  progress: number;
  downloaded: number;
  downloadSpeed: number;
  timeRemaining: number;
  on(event: string, handler: (...args: never[]) => void): void;
  destroy(): void;
};

type WebTorrentClient = {
  add(torrentId: string, opts: Record<string, unknown>, cb?: (torrent: WebTorrentTorrent) => void): WebTorrentTorrent;
  destroy(): void;
  on(event: string, handler: (...args: never[]) => void): void;
};

let clientPromise: Promise<WebTorrentClient> | null = null;

/** Load the vendored browser build once, on demand. */
export async function loadWebTorrent(): Promise<WebTorrentClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const base = new URL(import.meta.env.BASE_URL ?? './', window.location.href);
    const url = new URL('vendor/webtorrent.min.js', base).toString();
    const mod = (await import(/* @vite-ignore */ url)) as { default: new () => WebTorrentClient };
    const Ctor = mod.default;
    if (typeof Ctor !== 'function') throw new Error('WebTorrent failed to load');
    return new Ctor();
  })().catch((error) => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

export function describeFiles(torrent: { files: Array<{ name: string; length: number }> }): TorrentFile[] {
  return torrent.files
    .map((file, index) => ({
      index,
      name: file.name,
      length: file.length,
      playable: isPlayableName(file.name),
      label: `${file.name} · ${formatBytes(file.length)}`,
    }))
    .sort((a, b) => Number(b.playable) - Number(a.playable) || b.length - a.length);
}

export class TorrentSession {
  private torrent: WebTorrentTorrent | null = null;
  private client: WebTorrentClient | null = null;
  private blobUrl: string | null = null;
  private statsHandler: ((stats: TorrentStats) => void) | null = null;
  private timer = 0;
  private message = '';

  get magnet(): MagnetInfo | null {
    return this.info;
  }

  private info: MagnetInfo | null = null;

  onStats(handler: (stats: TorrentStats) => void): void {
    this.statsHandler = handler;
  }

  /** Add a magnet and resolve as soon as metadata (the file list) is known. */
  async add(magnet: string, options: { timeout?: number } = {}): Promise<TorrentFile[]> {
    const info = parseMagnet(magnet);
    if (!info) throw new Error('That does not look like a magnet link.');
    this.info = info;
    this.emit({ state: 'metadata', message: 'Connecting to the swarm…' });

    this.client = await loadWebTorrent();
    const timeout = options.timeout ?? 25_000;

    const torrent = await new Promise<WebTorrentTorrent>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(
          new Error(
            'No peers answered. Browsers can only reach WebRTC peers, so most classic swarms need a gateway (Settings → Torrents).',
          ),
        );
      }, timeout);

      let settled = false;
      try {
        const added = this.client!.add(magnet, { announce: webtorrentTrackers(info.trackers) }, (ready) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(ready);
        });
        added.on('error', (error: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        });
      } catch (error) {
        window.clearTimeout(timer);
        reject(error as Error);
      }
    });

    this.torrent = torrent;
    this.startStatsLoop();
    return describeFiles(torrent);
  }

  /** Download the chosen file and hand back a blob URL the player can open. */
  async download(index: number, onProgress?: (stats: TorrentStats) => void): Promise<string> {
    const torrent = this.torrent;
    if (!torrent) throw new Error('No torrent loaded.');
    const file = torrent.files[index];
    if (!file) throw new Error('That file is not in the torrent.');

    // Prioritise this file; browsers download sequentially from the start.
    torrent.files.forEach((entry, entryIndex) => {
      if (entryIndex === index) entry.select?.();
      else entry.deselect?.();
    });

    this.emit({ state: 'downloading', message: 'Downloading…' });

    return new Promise<string>((resolve, reject) => {
      let last = 0;
      const tick = window.setInterval(() => {
        const stats = this.snapshot();
        onProgress?.(stats);
        if (stats.progress >= 1) {
          window.clearInterval(tick);
          // Give WebTorrent a moment to flush the last pieces.
          window.setTimeout(() => finish(), 300);
        }
        last = stats.progress;
      }, 500);

      const finish = () => {
        try {
          const blob = (file as unknown as { getBlob?: (cb: (error: Error | null, blob?: Blob) => void) => void }).getBlob;
          if (typeof blob === 'function') {
            blob((error, result) => {
              if (error || !result) {
                reject(error ?? new Error('Could not assemble the file.'));
                return;
              }
              this.blobUrl = URL.createObjectURL(result);
              this.emit({ state: 'ready', message: 'Ready' });
              resolve(this.blobUrl);
            });
            return;
          }
          // Fallback: WebTorrent exposes a stream URL in some builds.
          if (file.streamURL) {
            resolve(file.streamURL);
            return;
          }
          reject(new Error('This WebTorrent build cannot export the file.'));
        } catch (error) {
          reject(error as Error);
        } finally {
          void last;
        }
      };
    });
  }

  /** One-shot stats snapshot for the UI. */
  snapshot(): TorrentStats {
    const torrent = this.torrent;
    if (!torrent) {
      return { peers: 0, progress: 0, downloaded: 0, downloadSpeed: 0, timeRemaining: 0, state: 'idle', message: this.message };
    }
    return {
      peers: torrent.numPeers,
      progress: Math.min(1, torrent.progress ?? 0),
      downloaded: torrent.downloaded ?? 0,
      downloadSpeed: torrent.downloadSpeed ?? 0,
      timeRemaining: torrent.timeRemaining ?? 0,
      state: (torrent.progress ?? 0) >= 1 ? 'ready' : 'downloading',
      message: this.message,
    };
  }

  private emit(partial: Partial<TorrentStats>): void {
    this.message = partial.message ?? this.message;
    this.statsHandler?.({ ...this.snapshot(), ...partial });
  }

  private startStatsLoop(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.statsHandler?.(this.snapshot()), 800);
  }

  destroy(): void {
    window.clearInterval(this.timer);
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    try {
      this.torrent?.destroy();
    } catch {
      /* already gone */
    }
    this.torrent = null;
  }
}

/** A gateway turns any magnet into an HTTP URL — the reliable path. */
export function gatewayUrl(magnet: string, template: string): string | null {
  const trimmed = template.trim();
  if (!trimmed) return null;
  if (trimmed.includes('{magnet}')) return trimmed.replace(/\{magnet\}/g, encodeURIComponent(magnet));
  if (trimmed.includes('{hash}')) {
    const info = parseMagnet(magnet);
    if (!info) return null;
    return trimmed.replace(/\{hash\}/g, info.infoHash);
  }
  const separator = trimmed.includes('?') ? '' : '/';
  return `${trimmed}${separator}${encodeURIComponent(magnet)}`;
}
