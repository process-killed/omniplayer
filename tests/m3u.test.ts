import { describe, expect, it } from 'vitest';
import { buildPlaylist, isHlsPlaylist, parsePlaylist, playlistFileName } from '../src/utils/m3u';

describe('m3u playlists', () => {
  it('parses EXTINF entries', () => {
    const text = `#EXTM3U
#EXTINF:-1,Episode 1
https://cdn/1.mp4
#EXTINF:1320,Episode 2
https://cdn/2.mp4
#EXTVLCOPT:network-caching=1000
https://cdn/3.mp4`;
    const entries = parsePlaylist(text);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ url: 'https://cdn/1.mp4', title: 'Episode 1', duration: -1 });
    expect(entries[1].duration).toBe(1320);
    expect(entries[2].title).toBe('');
  });

  it('refuses HLS media playlists', () => {
    const hls = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts';
    expect(isHlsPlaylist(hls)).toBe(true);
    expect(parsePlaylist(hls)).toEqual([]);
  });

  it('round-trips through buildPlaylist', () => {
    const built = buildPlaylist([
      { url: 'https://cdn/a.mp4', name: 'A' },
      { url: 'https://cdn/b.mp4', name: 'B', duration: 90 },
    ]);
    const parsed = parsePlaylist(built);
    expect(parsed.map((entry) => entry.url)).toEqual(['https://cdn/a.mp4', 'https://cdn/b.mp4']);
    expect(parsed[1].duration).toBe(90);
    expect(parsed[0].title).toBe('A');
  });

  it('names the file sensibly', () => {
    expect(playlistFileName('My Show / S01')).toBe('My-Show-S01.m3u');
    expect(playlistFileName('')).toBe('omniplay.m3u');
  });
});
