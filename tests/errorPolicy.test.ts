import { describe, expect, it } from 'vitest';
import { isFatalDashError } from '../src/core/errorPolicy';

describe('dash error severity', () => {
  it('keeps network hiccups recoverable', () => {
    expect(isFatalDashError({ message: 'Network request failed' })).toBe(false);
    expect(isFatalDashError({ message: 'XHR error' })).toBe(false);
    expect(isFatalDashError({ message: 'timeout' })).toBe(false);
    expect(isFatalDashError({ error: { code: 200 } }, '')).toBe(false);
  });

  it('escalates manifest, segment and decoder failures', () => {
    expect(isFatalDashError({ message: 'Failed to parse MPD manifest' })).toBe(true);
    expect(isFatalDashError({ message: 'Codec not supported' })).toBe(true);
    expect(isFatalDashError({ message: 'segment missing' })).toBe(true);
    expect(isFatalDashError({ message: 'DRM key error' })).toBe(true);
  });

  it('escalates unknown errors rather than stranding the user', () => {
    expect(isFatalDashError({ message: 'something odd happened' })).toBe(true);
    expect(isFatalDashError({})).toBe(true);
  });
});
