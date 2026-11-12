/**
 * M3U / M3U8 playlist support (roadmap: playlist import & export).
 *
 * Handles the simple IPTV-style playlist: `#EXTINF:<seconds>,<title>` followed
 * by a URL. HLS media playlists are *not* playlists in this sense — they are
 * detected by their `#EXT-X-` tags and rejected so they keep playing as streams.
 */

export interface PlaylistEntry {
  url: string;
  title: string;
  duration: number;
}

export function isHlsPlaylist(text: string): boolean {
  return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION)/i.test(text);
}

export function parsePlaylist(text: string): PlaylistEntry[] {
  if (isHlsPlaylist(text)) return [];
  const lines = text.split(/\r?\n/);
  const entries: PlaylistEntry[] = [];
  let pendingTitle = '';
  let pendingDuration = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      const body = line.slice(8);
      const comma = body.indexOf(',');
      const seconds = Number((comma >= 0 ? body.slice(0, comma) : body).trim());
      pendingDuration = Number.isFinite(seconds) ? seconds : 0;
      pendingTitle = comma >= 0 ? body.slice(comma + 1).trim() : '';
      continue;
    }
    if (line.startsWith('#')) continue; // #EXTM3U, #EXTVLCOPT, comments
    entries.push({ url: line, title: pendingTitle, duration: pendingDuration });
    pendingTitle = '';
    pendingDuration = 0;
  }
  return entries;
}

export function buildPlaylist(entries: Array<{ url: string; name?: string; duration?: number }>): string {
  const lines = ['#EXTM3U'];
  for (const entry of entries) {
    const seconds = Math.max(0, Math.round(entry.duration ?? -1));
    lines.push(`#EXTINF:${seconds >= 0 ? seconds : -1},${entry.name ?? entry.url}`);
    lines.push(entry.url);
  }
  return `${lines.join('\n')}\n`;
}

/** Filename that keeps a playlist recognisable. */
export function playlistFileName(name = 'omniplay'): string {
  return `${name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'omniplay'}.m3u`;
}
