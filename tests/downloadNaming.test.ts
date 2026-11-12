import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  isDownloadableSubtitle,
  preferOriginalName,
  sanitizeName,
  subtitleFileName,
} from '../src/downloads/naming';

describe('download filenames', () => {
  it('sanitises hostile names', () => {
    expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeName('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeName('')).toBe('download');
    expect(sanitizeName('...hidden')).toBe('hidden');
    expect(sanitizeName('x'.repeat(200)).length).toBe(120);
  });

  it('reads extensions from URLs', () => {
    expect(extensionOf('https://cdn/a.SRT?x=1')).toBe('srt');
    expect(extensionOf('https://cdn/no-ext')).toBe('');
  });

  it('refuses bitmap subtitles', () => {
    expect(isDownloadableSubtitle('https://cdn/subs.srt')).toBe(true);
    expect(isDownloadableSubtitle('https://cdn/subs.ass')).toBe(true);
    expect(isDownloadableSubtitle('https://cdn/track.sup')).toBe(false);
  });

  it('builds language-aware names', () => {
    expect(subtitleFileName('Show S01E01.mkv', 'Hindi', 'https://cdn/x.srt')).toBe('Show S01E01 · Hindi.srt');
    expect(subtitleFileName('Show.mkv', undefined, 'https://cdn/x.vtt')).toBe('Show.vtt');
    expect(subtitleFileName(undefined, undefined, 'https://cdn/weird')).toBe('subtitle.srt');
  });

  it('prefers a sane original name', () => {
    expect(preferOriginalName('Episode 1.srt', 'fallback.srt')).toBe('Episode 1.srt');
    expect(preferOriginalName('no-extension', 'fallback.srt')).toBe('fallback.srt');
    expect(preferOriginalName(undefined, 'fallback.srt')).toBe('fallback.srt');
  });
});
