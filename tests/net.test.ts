import { describe, expect, it } from 'vitest';
import { buildProxyUrl, hasProxy, isValidProxyTemplate, proxiedUrl, proxyCandidates, rememberProxyShape } from '../src/core/net';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import type { Settings } from '../src/types';

const settings = (corsProxy: string): Settings => ({ ...DEFAULT_SETTINGS, corsProxy });

describe('CORS proxy templates', () => {
  it('returns the target untouched when no proxy is configured', () => {
    expect(buildProxyUrl('https://host/a.mkv', '')).toBe('https://host/a.mkv');
    expect(proxiedUrl('https://host/a.mkv', settings(''))).toBe('https://host/a.mkv');
    expect(hasProxy(settings(''))).toBe(false);
  });

  it('substitutes {url} with the encoded target', () => {
    const target = 'https://bucket.example/a.mkv?X-Amz-Signature=abc&X-Amz-Expires=60';
    const out = buildProxyUrl(target, 'https://worker.dev/?url={url}');
    expect(out.startsWith('https://worker.dev/?url=')).toBe(true);
    expect(out).toContain(encodeURIComponent(target));
    expect(out).not.toContain('{url}');
  });

  it('defaults to ?url= when the template has no placeholder', () => {
    // Most workers take ?url=; the resolver negotiates other shapes if that 400s.
    expect(buildProxyUrl('https://h/a.mkv', 'https://worker.dev/proxy/')).toBe(
      `https://worker.dev/proxy/?url=${encodeURIComponent('https://h/a.mkv')}`,
    );
    expect(buildProxyUrl('https://h/a.mkv', 'https://worker.dev/p')).toBe(
      `https://worker.dev/p?url=${encodeURIComponent('https://h/a.mkv')}`,
    );
  });

  it('keeps query strings intact through encoding', () => {
    const target = 'https://h/v.mkv?token=a%2Fb&x=1';
    const out = buildProxyUrl(target, 'https://p/?u={url}');
    const parsed = new URL(out);
    expect(parsed.searchParams.get('u')).toBe(target);
  });

  it('offers the shapes workers actually use', () => {
    const target = 'https://h/a.mkv?x=1';
    const encoded = encodeURIComponent(target);
    expect(proxyCandidates(target, 'https://w.dev/proxy')).toEqual([
      `https://w.dev/proxy?url=${encoded}`,
      `https://w.dev/proxy?u=${encoded}`,
      `https://w.dev/proxy/${encoded}`,
    ]);
    expect(proxyCandidates(target, 'https://w.dev/p?token=1')).toEqual([
      `https://w.dev/p?token=1&url=${encoded}`,
      `https://w.dev/p?token=1&u=${encoded}`,
    ]);
    expect(proxyCandidates(target, 'https://w.dev/?u={url}')).toEqual([`https://w.dev/?u=${encoded}`]);
  });

  it('remembers the shape a proxy accepted', () => {
    const template = 'https://w.dev/other';
    const target = 'https://h/b.mp4';
    expect(proxiedUrl(target, settings(template))).toContain('?url=');
    rememberProxyShape(template, 2);
    expect(proxiedUrl(target, settings(template))).toContain(`/other/${encodeURIComponent(target)}`);
  });

  it('validates templates', () => {
    expect(isValidProxyTemplate('')).toBe(true);
    expect(isValidProxyTemplate('https://w.dev/?url={url}')).toBe(true);
    expect(isValidProxyTemplate('https://w.dev/proxy/')).toBe(true);
    expect(isValidProxyTemplate('ftp://w.dev/')).toBe(false);
    expect(isValidProxyTemplate('w.dev')).toBe(false);
  });
});
