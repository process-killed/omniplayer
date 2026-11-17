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
