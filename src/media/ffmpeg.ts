/**
 * FFmpeg.wasm — on-device conversion, remuxing, audio and subtitle extraction.
 *
 * Design rules, learned from the size and memory cost of a 30 MB WASM core:
 *
 *  - Nothing is downloaded until the user actually runs a job. The core comes
 *    from a CDN, so the app stays small for people who never open this page.
 *  - Single-threaded core by default. The multi-threaded build needs
 *    SharedArrayBuffer, which needs COOP/COEP headers this app cannot assume.
 *  - Jobs are bounded per device profile: a 4 GB file will not be pulled into
 *    WASM memory on a phone. Stream-copy presets are offered instead, since they
 *    never decode video.
 *  - Every job is cancellable and always terminates the worker, so a failed run
 *    cannot leave 200 MB of WASM memory allocated.
 */
import { budgetsFor, deviceReport } from '../core/deviceProfile';

const CORE_VERSION = '0.12.6';
const CDN = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

export type FfmpegPresetId =
  | 'remux-mp4'
  | 'remux-mkv'
  | 'compress-720'
  | 'compress-480'
  | 'audio-mp3'
  | 'audio-m4a'
  | 'subtitles-srt'
  | 'gif-preview';

export interface FfmpegPreset {
  id: FfmpegPresetId;
  label: string;
  description: string;
  /** Stream copy never decodes video — safe on weak devices and fast. */
  copyOnly: boolean;
  /** Rough relative cost, used to warn before a heavy job. */
  weight: 'light' | 'medium' | 'heavy';
  extension: string;
  args: (input: string, output: string) => string[];
}

export const PRESETS: FfmpegPreset[] = [
  {
    id: 'remux-mp4',
    label: 'Remux to MP4',
    description: 'Changes the container only — no re-encoding, seconds even for large files.',
    copyOnly: true,
    weight: 'light',
    extension: 'mp4',
    args: (input, output) => ['-i', input, '-c', 'copy', '-movflags', '+faststart', output],
  },
  {
    id: 'remux-mkv',
    label: 'Remux to MKV',
    description: 'Repackages every track into MKV without touching the codecs.',
    copyOnly: true,
    weight: 'light',
    extension: 'mkv',
    args: (input, output) => ['-i', input, '-c', 'copy', output],
  },
  {
    id: 'compress-720',
    label: 'Compress to 720p',
    description: 'Re-encodes to H.264 720p — smaller file, slower, heavy on phones.',
    copyOnly: false,
    weight: 'heavy',
    extension: 'mp4',
    args: (input, output) => ['-i', input, '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', output],
  },
  {
    id: 'compress-480',
    label: 'Compress to 480p',
    description: 'Smallest useful output; the option to pick on a low-memory device.',
    copyOnly: false,
    weight: 'heavy',
    extension: 'mp4',
    args: (input, output) => ['-i', input, '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', output],
  },
  {
    id: 'audio-mp3',
    label: 'Extract audio (MP3)',
    description: 'Drops the video and keeps a 192 kbps MP3.',
    copyOnly: false,
    weight: 'medium',
    extension: 'mp3',
    args: (input, output) => ['-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', output],
  },
  {
    id: 'audio-m4a',
    label: 'Extract audio (M4A)',
    description: 'Keeps the original audio stream when it is already AAC.',
    copyOnly: true,
    weight: 'light',
    extension: 'm4a',
    args: (input, output) => ['-i', input, '-vn', '-c:a', 'copy', output],
  },
  {
    id: 'subtitles-srt',
    label: 'Extract subtitles (SRT)',
    description: 'Pulls the first text subtitle track out as SRT. Bitmap tracks (PGS) are not text and are skipped.',
    copyOnly: true,
    weight: 'light',
    extension: 'srt',
    args: (input, output) => ['-i', input, '-map', '0:s:0?', '-c:s', 'srt', output],
  },
  {
    id: 'gif-preview',
    label: 'Make a GIF preview',
    description: 'A 5-second GIF from the start — handy for sharing.',
    copyOnly: false,
    weight: 'medium',
    extension: 'gif',
    args: (input, output) => ['-t', '5', '-i', input, '-vf', 'fps=12,scale=480:-1:flags=lanczos', output],
  },
];

export function presetById(id: FfmpegPresetId): FfmpegPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

export interface JobLimits {
  maxInputBytes: number;
  allowHeavy: boolean;
  reason?: string;
}

/** Decide what this device may attempt before anything is loaded. */
export function limitsForDevice(_inputBytes: number, profile?: string): JobLimits {
  const id = (profile ?? deviceReport().profile) as 'low' | 'balanced' | 'high' | 'tv';
  const budgets = budgetsFor(id);
  const maxInputBytes =
    id === 'low' ? 350 * 1024 * 1024 : id === 'balanced' ? 1.5 * 1024 * 1024 * 1024 : 4 * 1024 * 1024 * 1024;
  const allowHeavy = budgets.maxDecodeHeight >= 720 && id !== 'low';
  return {
    maxInputBytes,
    allowHeavy,
    reason: allowHeavy ? undefined : 'This device reports low memory — only stream-copy jobs are offered.',
  };
}

export interface FfmpegRunOptions {
  file: File;
  preset: FfmpegPreset;
  onProgress?: (ratio: number, seconds: number) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface FfmpegRunResult {
  blob: Blob;
  name: string;
  seconds: number;
}

type FFmpegLike = {
  load: (config: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  exec: (args: string[]) => Promise<number>;
  terminate: () => void;
  on: (event: string, handler: (payload: { progress?: number; time?: number; message?: string }) => void) => void;
};

let instance: FFmpegLike | null = null;
let loading: Promise<FFmpegLike> | null = null;

/** Load the wrapper and the 30 MB core once, on first use. */
export async function loadFfmpeg(onLog?: (line: string) => void): Promise<FFmpegLike> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg() as unknown as FFmpegLike;
    ffmpeg.on('log', ({ message }) => {
      if (message) onLog?.(message);
    });
    onLog?.('Downloading the FFmpeg core (~30 MB, cached by the browser after the first run)…');
    await ffmpeg.load({
      coreURL: `${CDN}/ffmpeg-core.js`,
      wasmURL: `${CDN}/ffmpeg-core.wasm`,
    });
    onLog?.('FFmpeg ready');
    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

export function isFfmpegLoaded(): boolean {
  return instance !== null;
}

/** Release the WASM heap — call when the user leaves the tools page. */
export function unloadFfmpeg(): void {
  try {
    instance?.terminate();
  } catch {
    /* ignore */
  }
  instance = null;
  loading = null;
}

function safeBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'output';
}

/** Run one job. Always terminates the worker, whatever happens. */
export async function runFfmpegJob(options: FfmpegRunOptions): Promise<FfmpegRunResult> {
  const { file, preset, onProgress, onLog, signal } = options;
  const limits = limitsForDevice(file.size);
  if (file.size > limits.maxInputBytes) {
    throw new Error(
      `This file is ${(file.size / 1024 / 1024).toFixed(0)} MB, above the ${(limits.maxInputBytes / 1024 / 1024).toFixed(0)} MB limit for this device. Stream-copy presets on a computer can handle it.`,
    );
  }
  if (!preset.copyOnly && !limits.allowHeavy) {
    throw new Error(limits.reason ?? 'This device cannot re-encode video.');
  }

  const ffmpeg = await loadFfmpeg(onLog);
  const inputName = `input.${(file.name.split('.').pop() ?? 'bin').toLowerCase()}`;
  const outputName = `output.${preset.extension}`;
  const started = performance.now();

  const onProgressEvent = (payload: { progress?: number; time?: number }) => {
    if (typeof payload.progress === 'number') {
      onProgress?.(Math.min(1, Math.max(0, payload.progress)), (payload.time ?? 0) / 1_000_000);
    }
  };
  ffmpeg.on('progress', onProgressEvent);

  const abort = () => {
    unloadFfmpeg();
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    onLog?.(`Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    onLog?.(`Running: ${preset.label}`);
    await ffmpeg.exec(preset.args(inputName, outputName));
    const data = await ffmpeg.readFile(outputName);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeForExtension(preset.extension) });
    onLog?.(`Done — ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    return {
      blob,
      name: `${safeBaseName(file.name)}.${preset.extension}`,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    // Free the heap: a failed job must not leave WASM memory allocated.
    unloadFfmpeg();
  }
}

export function mimeForExtension(extension: string): string {
  switch (extension) {
    case 'mp4':
      return 'video/mp4';
    case 'mkv':
      return 'video/x-matroska';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'srt':
      return 'text/plain';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}
