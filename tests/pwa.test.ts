import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/manifest.webmanifest'), 'utf8')) as Record<string, unknown>;

describe('web app manifest', () => {
  it('has the fields browsers require for installability', () => {
    expect(typeof manifest.name).toBe('string');
    expect(typeof manifest.short_name).toBe('string');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(String(manifest.theme_color)).toMatch(/^#/);
    expect(String(manifest.background_color)).toMatch(/^#/);
  });

  it('ships 192px and 512px icons plus a maskable one', () => {
    const icons = manifest.icons as Array<{ sizes: string; purpose?: string; src: string }>;
    expect(icons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of icons) expect(icon.src.startsWith('./')).toBe(true);
  });

  it('declares shortcuts that point at real routes', () => {
    const shortcuts = manifest.shortcuts as Array<{ url: string; name: string }>;
    expect(shortcuts.length).toBeGreaterThanOrEqual(2);
    for (const shortcut of shortcuts) {
      expect(shortcut.url.startsWith('./#/')).toBe(true);
      expect(shortcut.name.length).toBeGreaterThan(2);
    }
  });

  it('does not rely on absolute paths (works from a sub-path)', () => {
    const serialised = JSON.stringify(manifest);
    expect(serialised).not.toContain('"/omniplay');
    expect(serialised.includes('"src":"/')).toBe(false);
  });
});
