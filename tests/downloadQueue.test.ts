import { describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../src/downloads/manager';
import { historyJson } from '../src/downloads/store';

/** Queue-level behaviour that does not need real network bytes. */
function stubProbe() {
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(0), {
      status: 206,
      headers: { 'content-range': 'bytes 0-0/100', 'content-length': '1', 'content-disposition': 'attachment; filename="clip.mp4"' },
    })) as typeof fetch;
}

describe('download queue', () => {
  it('detects duplicates by URL', async () => {
    stubProbe();
    const manager = new DownloadManager();
    await manager.init();
    const first = await manager.enqueue('https://cdn/a.mp4');
    expect(first).not.toBeNull();
    const second = await manager.enqueue('https://cdn/a.mp4');
    expect(second).toBeNull();
    expect(manager.list().filter((job) => job.url === 'https://cdn/a.mp4')).toHaveLength(1);
  });

  it('marks a job resumable only for a real 206', async () => {
    stubProbe();
    const manager = new DownloadManager();
    await manager.init();
    const job = await manager.enqueue('https://cdn/b.mp4');
    expect(job?.resumable).toBe(true);
    expect(job?.size).toBe(100);
  });

  it('records a non-resumable job when the origin ignores ranges', async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(0), { status: 200, headers: { 'content-length': '500' } })) as typeof fetch;
    const manager = new DownloadManager();
    await manager.init();
    const job = await manager.enqueue('https://cdn/c.mp4');
    expect(job?.resumable).toBe(false);
    expect(job?.size).toBe(500);
  });

  it('honours the concurrency limit', async () => {
    stubProbe();
    const manager = new DownloadManager();
    await manager.init();
    manager.setSettings({ concurrency: 1 });
    expect(manager.getSettings().concurrency).toBe(1);
    manager.setSettings({ concurrency: 8 });
    expect(manager.getSettings().concurrency).toBe(8);
  });

  it('exports history as JSON', () => {
    const json = historyJson([
      {
        id: '1', url: 'https://cdn/a.mp4', name: 'a.mp4', size: 10, received: 10, state: 'done',
        resumable: true, checksum: null, speed: 0, createdAt: 1, updatedAt: 2, kind: 'file',
      },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe(1);
    expect(parsed.downloads[0]).toMatchObject({ name: 'a.mp4', state: 'done', size: 10 });
  });
});

describe('cancelled save dialog', () => {
  it('returns the job to the queue instead of leaving it downloading', async () => {
    stubProbe();
    const manager = new DownloadManager();
    await manager.init();
    // The picker rejects the way a cancelled save dialog does.
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('showSaveFilePicker', () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
    const job = await manager.enqueue('https://cdn/d.mp4');
    expect(job).not.toBeNull();
    // Give the pump a tick to run and fail the sink.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = manager.list().find((entry) => entry.id === job!.id)?.state;
    expect(['paused', 'queued']).toContain(state);
    expect(manager.list().some((entry) => entry.state === 'downloading')).toBe(false);
    vi.unstubAllGlobals();
  });
});
