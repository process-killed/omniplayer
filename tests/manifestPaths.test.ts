import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A PWA installed from a subpath (GitHub Pages, /player/ behind a proxy) breaks
 * in ways that are invisible locally when these are absolute: the installed app
 * opens the domain root, and the icons 404. This locks the relative form in.
 */
const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('installability paths', () => {
  it('uses relative start_url, scope and id', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.id).toBe('./');
  });

  it('never links an absolute app asset from index.html', () => {
    const absolute = html.match(/href="\/[a-z]/g) ?? [];
    expect(absolute).toEqual([]);
  });

  it('keeps every icon and shortcut relative', () => {
    for (const icon of manifest.icons) expect(icon.src.startsWith('./')).toBe(true);
    for (const shortcut of manifest.shortcuts ?? []) expect(shortcut.url.startsWith('./')).toBe(true);
  });
});
