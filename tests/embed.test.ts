import { describe, expect, it } from 'vitest';
import { buildEmbedUrl, buildIframeCode, extractSource, parseEmbedParams, DEFAULT_EMBED, type EmbedOptions } from '../src/app/embed';

const options = (overrides: Partial<EmbedOptions>): EmbedOptions => ({ ...DEFAULT_EMBED, ...overrides });

const MEDIA = 'https://bucket.example/hub/clip%20one.mkv?X-Amz-Signature=abc&X-Amz-Expires=60';

describe('embed parameter parsing', () => {
  it('reads src and options', () => {
    const options = parseEmbedParams({
      src: encodeURIComponent(MEDIA),
      start: '90',
      autoplay: '1',
      muted: '1',
      loop: '1',
      controls: '0',
      title: 'Episode 1',
    });
    expect(options?.src).toBe(MEDIA);
    expect(options?.start).toBe(90);
    expect(options?.autoplay).toBe(true);
    expect(options?.muted).toBe(true);
    expect(options?.loop).toBe(true);
    expect(options?.controls).toBe(false);
    expect(options?.title).toBe('Episode 1');
  });

  it('accepts url/file aliases and rejects missing sources', () => {
    expect(parseEmbedParams({ url: encodeURIComponent(MEDIA) })?.src).toBe(MEDIA);
    expect(parseEmbedParams({ file: encodeURIComponent(MEDIA) })?.src).toBe(MEDIA);
    expect(parseEmbedParams({})).toBeNull();
    expect(parseEmbedParams({ src: 'javascript:alert(1)' })).toBeNull();
  });

  it('defaults controls on and autoplay off', () => {
    const options = parseEmbedParams({ src: encodeURIComponent(MEDIA) });
    expect(options?.controls).toBe(true);
    expect(options?.autoplay).toBe(false);
    expect(options?.start).toBe(0);
  });
});

describe('embed url building', () => {
  it('round-trips through the URL', () => {
    const url = buildEmbedUrl('https://player.example/app/', options({ src: MEDIA, start: 42, autoplay: true, title: 'A & B' }));
    expect(url.startsWith('https://player.example/app/#/embed?')).toBe(true);
    const params = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
    const parsed = parseEmbedParams(params);
    expect(parsed?.src).toBe(MEDIA);
    expect(parsed?.start).toBe(42);
    expect(parsed?.autoplay).toBe(true);
    expect(parsed?.title).toBe('A & B');
  });

  it('omits false flags', () => {
    const url = buildEmbedUrl('https://player.example/', options({ src: MEDIA }));
    expect(url).not.toContain('autoplay');
    expect(url).not.toContain('muted');
    expect(url).toContain('src=');
  });
});

describe('iframe snippet', () => {
  it('is embeddable and allows fullscreen', () => {
    const opts = options({ src: MEDIA, title: 'My "video"' });
    const url = buildEmbedUrl('https://player.example/', opts);
    const snippet = buildIframeCode(url, opts);
    expect(snippet.startsWith('<iframe')).toBe(true);
    expect(snippet).toContain('allowfullscreen');
    expect(snippet).toContain('allow="autoplay; fullscreen; picture-in-picture; encrypted-media"');
    expect(snippet).toContain('referrerpolicy="no-referrer"');
    // Quotes in the title must not break the attribute.
    expect(snippet).toContain('title="My &quot;video&quot;"');
    expect(snippet).not.toContain('src=""');
  });
});

describe('source extraction', () => {
  it('pulls the media link out of an embed URL', () => {
    const embed = buildEmbedUrl('https://player.example/', options({ src: MEDIA }));
    expect(extractSource(embed)).toBe(MEDIA);
  });

  it('pulls it out of a ?src= link too', () => {
    expect(extractSource(`https://player.example/?src=${encodeURIComponent(MEDIA)}`)).toBe(MEDIA);
  });

  it('passes a plain media URL through unchanged', () => {
    expect(extractSource(MEDIA)).toBe(MEDIA);
    expect(extractSource('  https://x/y.mp4  ')).toBe('https://x/y.mp4');
  });
});
