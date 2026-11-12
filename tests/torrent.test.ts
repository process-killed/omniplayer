import { describe, expect, it } from 'vitest';
import { base32ToHex, formatBytes, isMagnet, isPlayableName, parseMagnet, webtorrentTrackers } from '../src/torrent/magnet';
import { gatewayUrl } from '../src/torrent/engine';

const HEX = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';
const MAGNET = `magnet:?xt=urn:btih:${HEX}&dn=Big+Buck+Bunny&tr=wss%3A%2F%2Ftracker.example&tr=udp%3A%2F%2Ftracker.other&ws=https%3A%2F%2Fseed.example%2Ffile&xl=123456`;

describe('magnet parsing', () => {
  it('reads hash, name, trackers and web seeds', () => {
    const info = parseMagnet(MAGNET);
    expect(info?.infoHash).toBe(HEX);
    // URLSearchParams turns '+' into a space, which is what a magnet dn means.
    expect(info?.name).toBe('Big Buck Bunny');
    expect(info?.trackers).toEqual(['wss://tracker.example', 'udp://tracker.other']);
    expect(info?.webSeeds).toEqual(['https://seed.example/file']);
    expect(info?.size).toBe(123456);
    expect(info?.hasWebSeed).toBe(true);
  });

  it('converts base32 info hashes', () => {
    const base32 = 'YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK';
    expect(base32ToHex(base32)).toBe('c12fe1c06bba254a9dc9f519b335aa7c1367a88a');
    const info = parseMagnet(`magnet:?xt=urn:btih:${base32}&dn=Base32`);
    expect(info?.infoHash).toBe(HEX);
  });

  it('rejects non-magnets and broken hashes', () => {
    expect(isMagnet('https://example.com/a.mp4')).toBe(false);
    expect(parseMagnet('https://example.com/a.mp4')).toBeNull();
    expect(parseMagnet('magnet:?dn=no-hash')).toBeNull();
    expect(parseMagnet('magnet:?xt=urn:btih:short')).toBeNull();
  });

  it('only offers WebSocket trackers plus defaults', () => {
    const list = webtorrentTrackers(['wss://a', 'udp://b', 'https://c']);
    expect(list).toContain('wss://a');
    expect(list).not.toContain('udp://b');
    expect(list.some((entry) => entry.includes('openwebtorrent'))).toBe(true);
  });

  it('knows which files are media', () => {
    expect(isPlayableName('movie.mkv')).toBe(true);
    expect(isPlayableName('EP01.MP4')).toBe(true);
    expect(isPlayableName('cover.jpg')).toBe(false);
    expect(isPlayableName('readme')).toBe(false);
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});

describe('gateway urls', () => {
  it('substitutes {magnet} and {hash}', () => {
    expect(gatewayUrl(MAGNET, 'https://g.example/{magnet}')).toContain(encodeURIComponent('magnet:?xt='));
    expect(gatewayUrl(MAGNET, 'https://g.example/{hash}')).toBe(`https://g.example/${HEX}`);
  });

  it('appends when there is no placeholder', () => {
    expect(gatewayUrl(MAGNET, 'https://g.example/play')).toMatch(/^https:\/\/g\.example\/play\/magnet%3A/);
  });

  it('returns null without a template', () => {
    expect(gatewayUrl(MAGNET, '')).toBeNull();
  });
});
