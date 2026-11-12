import { describe, expect, it } from 'vitest';
import { filenameFrom, parseContentRange, runDownload, type Sink } from '../src/downloads/engine';
import type { DownloadJob } from '../src/downloads/types';

const job = (overrides: Partial<DownloadJob> = {}): DownloadJob => ({
  id: 'x', url: 'https://cdn/a.bin', name: 'a.bin', size: 10, received: 0, state: 'downloading',
  resumable: true, checksum: null, speed: 0, createdAt: 0, updatedAt: 0, kind: 'file', ...overrides,
});

function memorySink(): Sink & { bytes: Uint8Array[] } {
  const bytes: Uint8Array[] = [];
  return {
    bytes,
    async write(chunk) {
      bytes.push(chunk);
    },
    async close() {},
    async abort() {},
  };
}

describe('range parsing', () => {
  it('reads Content-Range', () => {
    expect(parseContentRange('bytes 0-1023/4096')).toEqual({ start: 0, end: 1023, total: 4096 });
    expect(parseContentRange('bytes 5-9/*')).toEqual({ start: 5, end: 9, total: null });
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange('garbage')).toBeNull();
  });

  it('derives filenames', () => {
    expect(filenameFrom('attachment; filename="Episode 1.mkv"', 'https://x/y')).toBe('Episode 1.mkv');
    expect(filenameFrom("attachment; filename*=UTF-8''na%C3%AFve.mp4", 'https://x/y')).toBe('naïve.mp4');
    expect(filenameFrom(null, 'https://cdn/path/movie.mp4?sig=1')).toBe('movie.mp4');
    expect(filenameFrom(null, 'https://cdn/')).toBe('download');
  });
});

describe('runDownload', () => {
  it('downloads in ranges and reports progress', async () => {
    const payload = new Uint8Array(10).fill(7);
    const requests: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range ?? '';
      requests.push(range);
      const match = /bytes=(\d+)-(\d+)/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match ? Math.min(Number(match[2]), 9) : 9;
      return new Response(payload.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${payload.length}`, 'content-length': String(end - start + 1) },
      });
    }) as typeof fetch;

    const sink = memorySink();
    const received = await runDownload({ job: job(), sink, signal: new AbortController().signal, onProgress: () => undefined });
    expect(received).toBe(10);
    expect(requests[0]).toBe('bytes=0-9');
  });

  it('refuses to continue when the server ignores Range', async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': '10' } })) as typeof fetch;
    await expect(
      runDownload({ job: job({ received: 4 }), sink: memorySink(), signal: new AbortController().signal, onProgress: () => undefined }),
    ).rejects.toThrow(/ignored the Range/i);
  });

  it('stops on abort', async () => {
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }) as typeof fetch;
    await expect(
      runDownload({ job: job(), sink: memorySink(), signal: controller.signal, onProgress: () => undefined }),
    ).rejects.toThrow(/Abort/i);
  });
});

describe('range validation', () => {
  it('rejects a 206 that does not start where we asked', async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(10), {
        status: 206,
        headers: { 'content-range': 'bytes 50-59/100', 'content-length': '10' },
      })) as typeof fetch;
    await expect(
      runDownload({ job: job({ received: 0 }), sink: memorySink(), signal: new AbortController().signal, onProgress: () => undefined }),
    ).rejects.toThrow(/unexpected range/i);
  });

  it('rejects a 206 with no Content-Range at all', async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array(10), { status: 206 })) as typeof fetch;
    await expect(
      runDownload({ job: job(), sink: memorySink(), signal: new AbortController().signal, onProgress: () => undefined }),
    ).rejects.toThrow(/unexpected range/i);
  });
});
