import { describe, expect, it } from 'vitest';
import { buildIframeCode, buildMountCode, buildReactCode, buildWebComponentCode, buildEmbedUrl, parseEmbedParams, DEFAULT_EMBED } from '../src/app/embed';

const base = buildEmbedUrl('https://player.example/', { ...DEFAULT_EMBED, src: 'https://cdn.example/v.mp4' });

describe('embed snippets', () => {
  it('iframe snippet is responsive and allowed to go fullscreen', () => {
    const code = buildIframeCode(base, { ...DEFAULT_EMBED, src: 'https://cdn.example/v.mp4', title: 'Ep 1' });
    expect(code).toContain('aspect-ratio:16/9');
    expect(code).toContain('allow="autoplay; fullscreen; picture-in-picture; encrypted-media"');
    expect(code).toContain('allowfullscreen');
    expect(code).toContain('loading="lazy"');
    expect(code).toContain('title="Ep 1"');
  });

  it('web component snippet points at the built bundle', () => {
    const code = buildWebComponentCode(base, { ...DEFAULT_EMBED, src: 'https://cdn.example/v.mp4', muted: true });
    expect(code).toContain('omni-play');
    expect(code).toContain('src="https://cdn.example/v.mp4"');
    expect(code).toContain('muted');
  });

  it('mount snippet produces valid JS', () => {
    const code = buildMountCode(base, { ...DEFAULT_EMBED, src: 'https://cdn.example/v.mp4', title: 'Ep 1' });
    expect(code).toContain('OmniPlay.mount');
    expect(code).toMatch(/title: ["']Ep 1["']/);
  });

  it('react snippet is a component with an encoded src', () => {
    const code = buildReactCode(base);
    expect(code).toContain('export function Player');
    expect(code).toContain('encodeURIComponent(src)');
    expect(code).toContain('aspectRatio');
  });
});

describe('new embed parameters', () => {
  it('round-trips playlist, chromeless, branding and remember', () => {
    const url = buildEmbedUrl('https://player.example/', {
      ...DEFAULT_EMBED,
      src: 'https://cdn.example/v.mp4',
      playlist: ['https://cdn.example/2.mp4', 'https://cdn.example/3.mp4'],
      chromeless: true,
      branding: false,
      remember: true,
    });
    const parsed = parseEmbedParams(Object.fromEntries(new URLSearchParams(url.split('?')[1])));
    expect(parsed?.playlist).toHaveLength(2);
    expect(parsed?.chromeless).toBe(true);
    expect(parsed?.branding).toBe(false);
    expect(parsed?.remember).toBe(true);
  });

  it('accepts t= as an alias for start', () => {
    const parsed = parseEmbedParams({ src: 'https://cdn.example/v.mp4', t: '90' });
    expect(parsed?.start).toBe(90);
  });
});
