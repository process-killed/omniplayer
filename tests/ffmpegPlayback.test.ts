import { describe, expect, it } from 'vitest';
import { planFfmpegPlayback } from '../src/media/ffmpegPlayback';

const MB = 1024 * 1024;

describe('ffmpeg playback planning', () => {
  it('picks a stream copy for containers a remux can rescue', () => {
    expect(planFfmpegPlayback('movie.mkv', 200 * MB, 'high').strategy).toBe('remux');
    expect(planFfmpegPlayback('clip.avi', 50 * MB, 'high').strategy).toBe('remux');
    expect(planFfmpegPlayback('old.flv', 50 * MB, 'high').strategy).toBe('remux');
  });

  it('transcodes unknown containers', () => {
    expect(planFfmpegPlayback('weird.xyz', 50 * MB, 'high').strategy).toBe('transcode');
  });

  it('refuses files above the device limit', () => {
    const low = planFfmpegPlayback('big.mkv', 900 * MB, 'low');
    expect(low.strategy).toBe('refuse');
    expect(low.reason).toContain('MB');
    expect(planFfmpegPlayback('big.mkv', 900 * MB, 'high').strategy).toBe('remux');
  });

  it('explains what it will do', () => {
    expect(planFfmpegPlayback('a.mkv', 10 * MB, 'balanced').reason).toContain('Stream copy');
  });
});

describe('blob url redaction', () => {
  it('does not merge a blob origin with its path', async () => {
    const { redactUrl } = await import('../src/core/errors');
    const url = 'blob:https://omniplayz.pages.dev/dd236d0c-2b1c-403f-9d1a-198d2b4faf8b';
    const redacted = redactUrl(url);
    expect(redacted.startsWith('blob:')).toBe(true);
    expect(redacted).not.toContain('https://omniplayz.pages.devhttps://');
    expect(redactUrl('https://host/path?token=secret')).toBe('https://host/path?…');
  });
});

describe('ffmpeg core mirrors', () => {
  it('tries the ESM core before the UMD core', async () => {
    const { CORE_MIRRORS } = await import('../src/media/ffmpeg');
    const esmFirst = CORE_MIRRORS.findIndex((url) => url.includes('/dist/esm'));
    const umdFirst = CORE_MIRRORS.findIndex((url) => url.includes('/dist/umd'));
    expect(esmFirst).toBe(0);
    expect(umdFirst).toBeGreaterThan(esmFirst);
    // A module worker cannot use importScripts, so ESM must be attempted first.
    expect(CORE_MIRRORS.every((url) => url.startsWith('https://'))).toBe(true);
  });
});
