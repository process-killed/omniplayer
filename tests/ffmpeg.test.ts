import { describe, expect, it } from 'vitest';
import { PRESETS, limitsForDevice, mimeForExtension, presetById } from '../src/media/ffmpeg';

describe('ffmpeg presets', () => {
  it('every preset declares an output extension and args', () => {
    for (const preset of PRESETS) {
      expect(preset.extension).toMatch(/^[a-z0-9]+$/);
      const args = preset.args('input.mp4', `output.${preset.extension}`);
      expect(args.length).toBeGreaterThan(2);
      expect(args).toContain(`output.${preset.extension}`);
      // -i must appear before the output; some presets put flags ahead of it.
      expect(args.indexOf('-i')).toBeGreaterThanOrEqual(0);
      expect(args.indexOf('-i')).toBeLessThan(args.indexOf(`output.${preset.extension}`));
    }
  });

  it('stream-copy presets never re-encode video', () => {
    for (const preset of PRESETS.filter((entry) => entry.copyOnly)) {
      const args = preset.args('in.mkv', 'out.mp4').join(' ');
      expect(args).not.toContain('libx264');
      expect(args).not.toContain('scale=');
    }
  });

  it('looks presets up by id', () => {
    expect(presetById('audio-mp3')?.extension).toBe('mp3');
    expect(presetById('subtitles-srt')?.extension).toBe('srt');
  });
});

describe('device limits', () => {
  it('keeps low-memory devices on stream-copy only', () => {
    const limits = limitsForDevice(0, 'low');
    expect(limits.allowHeavy).toBe(false);
    expect(limits.maxInputBytes).toBeLessThan(512 * 1024 * 1024);
    expect(limits.reason).toContain('low memory');
  });

  it('allows re-encoding on capable devices with a larger cap', () => {
    const high = limitsForDevice(0, 'high');
    expect(high.allowHeavy).toBe(true);
    expect(high.maxInputBytes).toBeGreaterThan(limitsForDevice(0, 'low').maxInputBytes);
    expect(limitsForDevice(0, 'balanced').allowHeavy).toBe(true);
  });
});

describe('output mime types', () => {
  it('maps containers to the right type', () => {
    expect(mimeForExtension('mp4')).toBe('video/mp4');
    expect(mimeForExtension('mkv')).toBe('video/x-matroska');
    expect(mimeForExtension('srt')).toBe('text/plain');
    expect(mimeForExtension('unknown')).toBe('application/octet-stream');
  });
});
