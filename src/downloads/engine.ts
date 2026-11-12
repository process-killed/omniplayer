/**
 * Range downloader.
 *
 * One job = a sequence of `Range` requests. Every completed chunk is handed to a
 * sink immediately, so a 4 GB file never sits in RAM. Resume works from the byte
 * count the sink confirmed, and only when the origin proved it supports ranges
 * (a 206 with a matching `Content-Range`).
 *
 * When the origin refuses ranges the job is marked non-resumable: pausing it is
 * a cancel, and the UI says so instead of pretending.
 */
import { CHUNK_SIZE, type DownloadJob } from './types';

export interface ProbeResult {
  size: number | null;
  resumable: boolean;
  contentType: string;
  name: string;
  checksum: { algo: string; value: string } | null;
}

export interface Sink {
  /** Persist bytes; resolve once they are safely stored. */
  write(chunk: Uint8Array): Promise<void>;
  /** Finish and return something the browser can save. */
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface RunOptions {
  job: DownloadJob;
  sink: Sink;
  signal: AbortSignal;
  onProgress: (received: number, speed: number) => void;
  retries?: number;
}

/** Parse `Content-Range: bytes 0-1023/4096`. */
export function parseContentRange(header: string | null): { start: number; end: number; total: number | null } | null {
  if (!header) return null;
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

/** Filename from Content-Disposition, else the URL path. */
export function filenameFrom(disposition: string | null, url: string): string {
  if (disposition) {
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    const raw = star?.[1] ?? plain?.[1];
    if (raw) {
      try {
        return decodeURIComponent(raw.trim());
      } catch {
        return raw.trim();
      }
    }
  }
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(path) || 'download';
  } catch {
    return 'download';
  }
}

/** Ask the origin what it supports before any bytes move. */
export async function probe(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    void response.body?.cancel().catch(() => undefined);
    const range = parseContentRange(response.headers.get('content-range'));
    const length = Number(response.headers.get('content-length'));
    const checksumHeader =
      response.headers.get('content-md5') ??
      response.headers.get('x-amz-checksum-sha256') ??
      response.headers.get('digest');
    return {
      size: range?.total ?? (Number.isFinite(length) && response.status === 200 ? length : null),
      // Only a real 206 with a range header proves resume support.
      resumable: response.status === 206 && !!range,
      contentType: response.headers.get('content-type')?.split(';')[0] ?? '',
      name: filenameFrom(response.headers.get('content-disposition'), url),
      checksum: checksumHeader
        ? { algo: response.headers.get('content-md5') ? 'md5' : 'sha256', value: checksumHeader.replace(/^sha-256=/i, '') }
        : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Download one job into a sink, resuming from `job.received`. */
export async function runDownload(options: RunOptions): Promise<number> {
  const { job, sink, signal, onProgress } = options;
  const retries = options.retries ?? 3;
  let received = job.received;
  let attempt = 0;
  let lastTick = performance.now();
  let lastBytes = received;

  while (job.size === null || received < job.size) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = job.size !== null ? Math.min(received + CHUNK_SIZE - 1, job.size - 1) : received + CHUNK_SIZE - 1;

    try {
      const response = await fetch(job.url, {
        headers: job.resumable ? { Range: `bytes=${received}-${end}` } : {},
        signal,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}`);
      }
      // A server that ignores Range answers 200 with the whole file: restart
      // cleanly rather than appending a duplicate copy.
      if (job.resumable && response.status !== 206) {
        throw new Error('RANGE_IGNORED');
      }

      // A 206 must answer the range we asked for. Anything else would silently
      // append the wrong bytes and corrupt the file.
      if (response.status === 206) {
        const range = parseContentRange(response.headers.get('content-range'));
        if (!range || range.start !== received) {
          throw new Error(
            `The server returned an unexpected range (asked for ${received}, got ${range ? range.start : 'no Content-Range'}) — download stopped to avoid corrupting the file.`,
          );
        }
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('The response has no body to read.');

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await sink.write(value);
          received += value.byteLength;
          const now = performance.now();
          if (now - lastTick > 400) {
            const speed = ((received - lastBytes) / (now - lastTick)) * 1000;
            onProgress(received, speed);
            lastTick = now;
            lastBytes = received;
          }
        }
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      }

      attempt = 0;
      if (!job.resumable) break; // no ranges: one pass is all we get
      if (job.size !== null && received >= job.size) break;
      if (response.status === 200) break;
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'AbortError') throw error;
      if ((error as Error).message === 'RANGE_IGNORED') {
        throw new Error('The server ignored the Range request, so this download cannot resume.');
      }
      attempt += 1;
      if (attempt > retries) throw error;
      await sleep(Math.min(8000, 500 * 2 ** attempt));
    }
  }

  onProgress(received, 0);
  await sink.close();
  return received;
}
