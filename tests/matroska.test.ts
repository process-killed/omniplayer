import { describe, expect, it } from 'vitest';
import { buildTestMkv, buildPgsDisplaySet } from './fixtures/matroska';
import {
  blobSource,
  extractMatroskaSubtitles,
  looksLikeMatroska,
  scanMatroskaTracks,
  type MkvSource,
} from '../src/subtitles/matroska';
import { looksLikePgs, splitSupFile } from '../src/subtitles/pgs';

const bytes = buildTestMkv();
const source: MkvSource = blobSource(new Blob([bytes.slice().buffer]));

describe('Matroska detection', () => {
  it('recognises the EBML magic', () => {
    expect(looksLikeMatroska(bytes)).toBe(true);
    expect(looksLikeMatroska(new Uint8Array([0, 1, 2, 3]))).toBe(false);
  });
});

describe('track scanning', () => {
  it('lists every subtitle track with codec, language and flags', async () => {
    const tracks = await scanMatroskaTracks(source);
    expect(tracks).toHaveLength(3);

    const ass = tracks.find((track) => track.codecId === 'S_TEXT/ASS');
    expect(ass).toBeDefined();
    expect(ass?.format).toBe('ass');
    expect(ass?.language).toBe('eng');
    expect(ass?.name).toBe('English [ASS]');
    expect(ass?.isDefault).toBe(true);
    expect(ass?.codecPrivate?.length).toBeGreaterThan(100);

    const pgs = tracks.find((track) => track.codecId === 'S_HDMV/PGS');
    expect(pgs?.format).toBe('pgs');
    expect(pgs?.language).toBe('jpn');
    expect(pgs?.isForced).toBe(true);

    const srt = tracks.find((track) => track.codecId === 'S_TEXT/UTF8');
    expect(srt?.format).toBe('srt');
    expect(srt?.language).toBe('hin');
  });

  it('ignores video and audio tracks', async () => {
    const tracks = await scanMatroskaTracks(source);
    expect(tracks.every((track) => track.number >= 3)).toBe(true);
  });

  it('reads through a source that returns small chunks', async () => {
    const tiny: MkvSource = {
      size: bytes.length,
      async read(offset, length) {
        return bytes.subarray(offset, Math.min(offset + Math.min(length, 64), bytes.length));
      },
    };
    const tracks = await scanMatroskaTracks(tiny);
    expect(tracks).toHaveLength(3);
  });
});

describe('ASS extraction', () => {
  it('rebuilds a full ASS script with styles and dialogue', async () => {
    const tracks = await scanMatroskaTracks(source);
    const ass = tracks.find((track) => track.codecId === 'S_TEXT/ASS')!;
    const result = await extractMatroskaSubtitles(source, ass);
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;

    expect(result.format).toBe('ass');
    expect(result.text).toContain('[Script Info]');
    expect(result.text).toContain('[V4+ Styles]');
    expect(result.text).toContain('Style: Default,Arial,64');
    expect(result.text).toContain('Dialogue: 0,0:00:00.00');
    expect(result.text).toContain('Hello from ASS');
    expect(result.text).toContain('Second line');
    // The second cue starts at 1.5s.
    expect(result.text).toContain('0:00:01.50');
  });
});

describe('plain text extraction', () => {
  it('emits SRT with sequential indices and millisecond times', async () => {
    const tracks = await scanMatroskaTracks(source);
    const srt = tracks.find((track) => track.codecId === 'S_TEXT/UTF8')!;
    const result = await extractMatroskaSubtitles(source, srt);
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;
    expect(result.text).toMatch(/^1\r?\n00:00:00,000 --> /);
    expect(result.text).toContain('Hindi line');
  });
});

describe('PGS extraction', () => {
  it('collects bitmap display sets without throwing', async () => {
    const tracks = await scanMatroskaTracks(source);
    const pgs = tracks.find((track) => track.codecId === 'S_HDMV/PGS')!;
    const result = await extractMatroskaSubtitles(source, pgs);
    expect(result.kind).toBe('pgs');
  });

  it('detects .sup files and splits them into display sets', () => {
    const sup = new Uint8Array([...buildPgsDisplaySet(), ...buildPgsDisplaySet()]);
    expect(looksLikePgs(sup)).toBe(true);
    const chunks = splitSupFile(sup);
    expect(chunks.length).toBe(2);
    expect(chunks[0].data[0]).toBe(0x50);
  });
});

describe('robustness', () => {
  it('rejects a non-Matroska blob instead of hanging', async () => {
    const junk = blobSource(new Blob([new Uint8Array(64).fill(9).buffer]));
    await expect(scanMatroskaTracks(junk)).resolves.toEqual([]);
  });

  it('stops at the end of a truncated file', async () => {
    const truncated = blobSource(new Blob([bytes.subarray(0, 120).slice().buffer]));
    await expect(scanMatroskaTracks(truncated)).resolves.toEqual([]);
  });

  it('reports progress while extracting', async () => {
    const tracks = await scanMatroskaTracks(source);
    const ass = tracks.find((track) => track.codecId === 'S_TEXT/ASS')!;
    const seen: number[] = [];
    await extractMatroskaSubtitles(source, ass, (fraction) => seen.push(fraction));
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });
});
