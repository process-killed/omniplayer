import { describe, expect, it } from 'vitest';
import { describeLink, resolveLink } from '../src/sources/registry';

describe('source registry', () => {
  it('recognises direct media', () => {
    expect(resolveLink('https://cdn.example/a.mkv').kind).toBe('media');
    expect(resolveLink('https://cdn.example/a.mp4?token=1').sources[0]).toContain('.mp4');
    expect(resolveLink('https://cdn.example/live.m3u8').kind).toBe('media');
  });

  it('routes magnets to the torrent path', () => {
    const result = resolveLink('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a');
    expect(result.kind).toBe('magnet');
    expect(result.sources[0]).toMatch(/^magnet:/);
  });

  it('builds provider embeds instead of pretending to play', () => {
    const yt = resolveLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(yt.kind).toBe('provider');
    expect(yt.provider?.name).toBe('YouTube');
    expect(yt.provider?.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');

    const short = resolveLink('https://youtu.be/dQw4w9WgXcQ');
    expect(short.provider?.embedUrl).toContain('dQw4w9WgXcQ');

    const vimeo = resolveLink('https://vimeo.com/123456789');
    expect(vimeo.provider?.embedUrl).toContain('player.vimeo.com/video/123456789');

    const twitch = resolveLink('https://twitch.tv/videos/123456');
    expect(twitch.provider?.embedUrl).toContain('player.twitch.tv/?video=123456');
  });

  it('turns ipfs paths into ordered gateways', () => {
    const result = resolveLink('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/video.mp4');
    expect(result.kind).toBe('media');
    expect(result.sources.length).toBeGreaterThan(2);
    expect(result.sources[0]).toContain('/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/video.mp4');
  });

  it('rewrites google drive and dropbox links', () => {
    const drive = resolveLink('https://drive.google.com/file/d/ABC123/view?usp=sharing');
    expect(drive.sources[0]).toBe('https://drive.google.com/uc?export=download&id=ABC123');
    const dropbox = resolveLink('https://www.dropbox.com/s/abc/video.mp4?dl=0');
    expect(dropbox.sources[0]).toContain('raw=1');
  });

  it('falls back to a generic network link', () => {
    const generic = resolveLink('https://example.com/stream');
    expect(generic.kind).toBe('media');
    expect(generic.note).toContain('sniff');
  });

  it('describes a link for the UI', () => {
    expect(describeLink('https://youtu.be/dQw4w9WgXcQ').adapter).toBe('Video provider');
    expect(describeLink('https://cdn.example/a.mp4').adapter).toBe('Direct media');
    expect(describeLink('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a').adapter).toBe('Torrent');
  });
});
