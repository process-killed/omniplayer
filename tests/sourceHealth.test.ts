import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSourceHealth, preferredSource, rankSources, recordAttempt, rememberSource, scoreOf } from '../src/core/sourceHealth';
import { loadPlaybackState, savePlaybackState, clearPlaybackState } from '../src/storage/playbackState';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('source health', () => {
  it('scores unknown sources neutrally', () => {
    expect(scoreOf(undefined)).toBe(0.5);
  });

  it('prefers fast, reliable sources', () => {
    recordAttempt('https://fast.example/a.mp4', { ok: true, startupMs: 300 });
    recordAttempt('https://slow.example/a.mp4', { ok: true, startupMs: 9000 });
    recordAttempt('https://dead.example/a.mp4', { ok: false });
    const ranked = rankSources(['https://dead.example/a.mp4', 'https://slow.example/a.mp4', 'https://fast.example/a.mp4']);
    expect(ranked[0]).toBe('https://fast.example/a.mp4');
    expect(ranked[2]).toBe('https://dead.example/a.mp4');
  });

  it('keeps the original order for equally unknown sources', () => {
    expect(rankSources(['https://a.example/1', 'https://b.example/2'])).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('remembers the preferred source per media', () => {
    rememberSource('media-1', 'https://mirror.example/b.mp4');
    expect(preferredSource('media-1')).toBe('https://mirror.example/b.mp4');
    expect(preferredSource('media-2')).toBeNull();
    clearSourceHealth();
    expect(preferredSource('media-1')).toBeNull();
  });
});

describe('smart resume state', () => {
  it('round-trips position, tracks and rate', () => {
    savePlaybackState('m1', { position: 120, duration: 1400, audioTrackId: 'a2', subtitleTrackId: 's1', rate: 1.25, updatedAt: Date.now() });
    const state = loadPlaybackState('m1');
    expect(state).toMatchObject({ position: 120, audioTrackId: 'a2', subtitleTrackId: 's1', rate: 1.25 });
  });

  it('clears one entry or everything', () => {
    savePlaybackState('m1', { position: 1, duration: 2, updatedAt: Date.now() });
    clearPlaybackState('m1');
    expect(loadPlaybackState('m1')).toBeNull();
  });
});
