// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { platformReport, supportsFileHandlers } from '../src/app/intake';

describe('platform intake', () => {
  it('reports the platform from the user agent', () => {
    // jsdom has no matchMedia; the module reads it for the standalone flag.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14; Pixel)', configurable: true });
    expect(platformReport().platform).toBe('android');

    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', configurable: true });
    const ios = platformReport();
    expect(ios.platform).toBe('ios');
    // iOS has no share target — the report must say so, not pretend.
    expect(ios.shareTarget).toBe(false);

    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });
    expect(platformReport().platform).toBe('windows');

    Object.defineProperty(navigator, 'userAgent', { value: original, configurable: true });
  });

  it('detects launchQueue support without throwing', () => {
    expect(typeof supportsFileHandlers()).toBe('boolean');
  });
});
