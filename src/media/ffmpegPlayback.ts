/**
 * Optional FFmpeg-assisted playback.
 *
 * What this CAN do: take bytes the browser is already allowed to read (a local
 * file, a CORS-friendly URL, or anything going through the user's own proxy) and
 * remux or transcode them into something the browser can play — HEVC-in-MKV on a
 * device without HEVC support, AVI, FLV, MPEG-2, and so on.
 *
 * What this CANNOT do: bypass CORS. FFmpeg.wasm reads its input through the same
 * fetch() the player uses, so a bucket that sends no Access-Control-Allow-Origin
 * blocks it exactly as it blocks the player. Anyone claiming otherwise is wrong.
 */
import { loadFfmpeg, unloadFfmpeg, limitsForDevice } from './ffmpeg';

export type PlaybackStrategy = 'remux' | 'transcode' | 'refuse';

export interface PlaybackPlan {
  strategy: PlaybackStrategy;
  reason: string;
  /** Output container the browser is most likely to accept. */
  container: 'mp4';
}

/** Containers browsers decode natively when the codecs inside are supported. */
const NATIVE_SAFE = /\.(mp4|m4v|webm|mov)$/i;
/** Containers that are usually fine after a stream copy into MP4. */
const REMUX_FRIENDLY = /\.(mkv|ts|m2ts|flv|avi|wmv|mpg|mpeg)$/i;

/**
 * Decide what to attempt, from the filename and the device budget.
 * Pure function so the policy is testable without loading 30 MB of WASM.
 */
export function planFfmpegPlayback(name: string, sizeBytes: number, profile?: string): PlaybackPlan {
  const limits = limitsForDevice(sizeBytes, profile);

  if (sizeBytes > limits.maxInputBytes) {
    return {
      strategy: 'refuse',
      container: 'mp4',
      reason: `This file is ${(sizeBytes / 1024 / 1024).toFixed(0)} MB — above the ${(limits.maxInputBytes / 1024 / 1024).toFixed(0)} MB FFmpeg limit for this device.`,
    };
  }
  if (NATIVE_SAFE.test(name)) {
    return {
      strategy: 'remux',
      container: 'mp4',
      reason: 'The browser may already handle this container; a stream copy is a cheap retry.',
    };
  }
  if (REMUX_FRIENDLY.test(name)) {
    return {
      strategy: 'remux',
      container: 'mp4',
      reason: 'Stream copy into MP4 — no re-encoding, usually a few seconds.',
    };
  }
  return {
    strategy: 'transcode',
    container: 'mp4',
    reason: 'Unknown container: a 720p H.264 transcode is the safest bet.',
  };
}

export interface FixPlayOptions {
  file: File;
  name: string;
  onProgress?: (ratio: number, seconds: number) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

/**
 * Prepare a file for playback and return an object URL for the result.
 * The caller owns the URL and must revoke it when playback ends.
 */
export async function fixForPlayback(options: FixPlayOptions): Promise<{ url: string; blob: Blob; strategy: PlaybackStrategy }> {
  const { file, name, onProgress, onLog, signal } = options;
  const plan = planFfmpegPlayback(name, file.size);
  if (plan.strategy === 'refuse') throw new Error(plan.reason);

  const ffmpeg = await loadFfmpeg(onLog);
  const input = `in.${(name.split('.').pop() ?? 'bin').toLowerCase()}`;
  const output = 'out.mp4';

  const onEvent = (payload: { progress?: number; time?: number }) => {
    if (typeof payload.progress === 'number') onProgress?.(payload.progress, (payload.time ?? 0) / 1_000_000);
  };
  ffmpeg.on('progress', onEvent);

  const abort = () => unloadFfmpeg();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    onLog?.(plan.reason);
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    // Fast path: copy the streams. If the codecs themselves are the problem the
    // copy fails quickly, and we fall back to a 720p transcode.
    let strategy: PlaybackStrategy = plan.strategy;
    if (strategy === 'remux') {
      try {
        onLog?.('Trying a stream copy (no re-encode)…');
        await ffmpeg.exec(['-i', input, '-c', 'copy', '-movflags', '+faststart', output]);
      } catch {
        onLog?.('Stream copy failed — the codec itself needs converting.');
        strategy = 'transcode';
      }
    }
    if (strategy === 'transcode') {
      onLog?.('Transcoding to H.264 720p…');
      await ffmpeg.exec([
        '-i', input,
        '-vf', 'scale=-2:720',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output,
      ]);
    }

    const data = await ffmpeg.readFile(output);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'video/mp4' });
    onLog?.(`Ready — ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    return { url: URL.createObjectURL(blob), blob, strategy };
  } finally {
    signal?.removeEventListener('abort', abort);
    unloadFfmpeg();
  }
}
