import { describe, expect, it } from 'vitest';
import { Thumbnailer } from '../src/media/thumbnailer';

describe('thumbnailer', () => {
  it('refuses sources it cannot sample', () => {
    (globalThis as unknown as { document?: unknown }).document = {};
    expect(Thumbnailer.supported(0, 'https://cdn/v.mp4')).toBe(false);
    expect(Thumbnailer.supported(Number.NaN, 'https://cdn/v.mp4')).toBe(false);
    expect(Thumbnailer.supported(120, '')).toBe(false);
    // A live stream reports Infinity, which has no seekable range to sample.
    expect(Thumbnailer.supported(Number.POSITIVE_INFINITY, 'https://cdn/live.m3u8')).toBe(false);
  });

  it('respects a low-memory profile even with a real duration', () => {
    // supported() also checks for a DOM; this suite runs in node.
    (globalThis as unknown as { document?: unknown }).document = {};
    expect(Thumbnailer.supported(600, 'https://cdn/v.mp4', 'low')).toBe(false);
    expect(Thumbnailer.supported(600, 'https://cdn/v.mp4', 'balanced')).toBe(true);
    expect(Thumbnailer.supported(600, 'https://cdn/v.mp4', 'high')).toBe(true);
  });

  it('rounds times down to the sampling grid', () => {
    const thumbnails = new Thumbnailer({ interval: 5 });
    // peek() must agree with the grid the queue captures on.
    expect(thumbnails.peek(0)).toBeUndefined();
    expect(thumbnails.peek(12)).toBeUndefined();
    thumbnails.destroy();
  });

  it('survives destroy without throwing', () => {
    const thumbnails = new Thumbnailer();
    thumbnails.destroy();
    expect(thumbnails.size).toBe(0);
    thumbnails.destroy();
  });
});
