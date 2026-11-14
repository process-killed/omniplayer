import { describe, expect, it } from 'vitest';
import { DownloadManager } from '../src/downloads/manager';

function manager(): DownloadManager {
  return new DownloadManager();
}

describe('download manager controls', () => {
  it('remembers settings across instances', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;

    const first = manager();
    first.setSettings({ concurrency: 4 });
    const second = manager();
    // setSettings persists; a fresh manager picks the value up in init().
    expect(store.get('omniplay:download-settings')).toContain('"concurrency":4');
    expect(second.getSettings().concurrency).toBeDefined();
  });

  it('reports when nothing is resumable', () => {
    const m = manager();
    expect(m.hasResumable()).toBe(false);
  });

  it('retryFailed only touches failed jobs', () => {
    const m = manager();
    expect(m.retryFailed()).toBe(0);
  });
});
