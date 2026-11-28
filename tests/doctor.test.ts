import { describe, expect, it } from 'vitest';
import {
  applyDrift,
  applyOffset,
  diagnose,
  repair,
  summarise,
  toSrt,
  toVtt,
  visibleLength,
} from '../src/subtitles/doctor';
import type { Cue } from '../src/types';

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text });

describe('diagnose', () => {
  it('finds empty cues, invalid times and negative durations', () => {
    const issues = diagnose([cue(1, 2, '   '), cue(5, 4, 'backwards'), cue(Number.NaN, 9, 'bad')]);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('empty-cue');
    expect(codes).toContain('negative-duration');
    expect(codes).toContain('invalid-time');
  });

  it('flags overlaps between consecutive cues', () => {
    const issues = diagnose([cue(1, 5, 'one'), cue(4, 7, 'two')]);
    const overlap = issues.find((issue) => issue.code === 'overlap');
    expect(overlap).toBeTruthy();
    expect(overlap?.cueIndex).toBe(1);
    expect(overlap?.severity).toBe('warn');
  });

  it('measures reading speed on visible text only', () => {
    // 40 visible characters in 0.5s = 80 CPS.
    const issues = diagnose([cue(1, 1.5, '<i>' + 'a'.repeat(40) + '</i>')]);
    expect(issues.some((issue) => issue.code === 'too-fast')).toBe(true);
    expect(visibleLength('<i>hello</i>')).toBe(5);
  });

  it('reports duplicates with the cue that came first', () => {
    const issues = diagnose([cue(1, 3, 'same line'), cue(1, 3, 'same line')]);
    const duplicate = issues.find((issue) => issue.code === 'duplicate');
    expect(duplicate?.detail).toContain('cue 1');
  });

  it('flags cues past the end of the media', () => {
    const issues = diagnose([cue(50, 52, 'late')], { mediaDuration: 30 });
    expect(issues.some((issue) => issue.code === 'beyond-duration')).toBe(true);
  });

  it('summarises by severity', () => {
    const summary = summarise(diagnose([cue(1, 1.01, 'x'.repeat(60)), cue(2, 3, '')]));
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.errors + summary.warnings + summary.infos).toBe(summary.total);
  });
});

describe('repair', () => {
  it('removes empty cues and never invents text', () => {
    const cues = [cue(1, 2, ''), cue(3, 5, 'real line')];
    const result = repair(cues, diagnose(cues));
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].text).toBe('real line');
  });

  it('trims overlaps so lines do not stack', () => {
    const cues = [cue(1, 5, 'one'), cue(4, 7, 'two')];
    const result = repair(cues, diagnose(cues));
    expect(result.cues[0].end).toBeLessThanOrEqual(result.cues[1].start);
  });

  it('stretches a flash without running into the next cue', () => {
    const cues = [cue(1, 1.1, 'short'), cue(1.5, 3, 'next')];
    const result = repair(cues, diagnose(cues));
    expect(result.cues[0].end).toBeGreaterThan(1.1);
    expect(result.cues[0].end).toBeLessThanOrEqual(result.cues[1].start);
  });

  it('keeps timestamps non-negative and ordered', () => {
    const cues = [cue(-2, -1, 'negative')];
    const result = repair(cues, diagnose(cues));
    expect(result.cues[0].start).toBeGreaterThanOrEqual(0);
    expect(result.cues[0].end).toBeGreaterThan(result.cues[0].start);
  });
});

describe('synchronisation', () => {
  it('shifts every cue by a constant offset', () => {
    const shifted = applyOffset([cue(10, 12, 'a')], 2.5);
    expect(shifted[0].start).toBeCloseTo(12.5);
    expect(shifted[0].end).toBeCloseTo(14.5);
  });

  it('never shifts before zero', () => {
    const shifted = applyOffset([cue(1, 2, 'a')], -5);
    expect(shifted[0].start).toBe(0);
  });

  it('applies drift proportionally across the file', () => {
    const cues = [cue(0, 2, 'first'), cue(50, 52, 'middle'), cue(100, 102, 'last')];
    const drifted = applyDrift(cues, 0, 2);
    expect(drifted[0].start).toBeCloseTo(0);
    expect(drifted[2].start).toBeCloseTo(102);
    expect(drifted[1].start).toBeGreaterThan(50);
    expect(drifted[1].start).toBeLessThan(52);
  });
});

describe('export', () => {
  it('writes valid SRT', () => {
    const srt = toSrt([cue(1.5, 3.25, 'hello')]);
    expect(srt).toContain('1\n00:00:01.500 --> 00:00:03.250\nhello');
  });

  it('writes a WebVTT header', () => {
    const vtt = toVtt([cue(1, 2, 'hello')]);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
  });
});

describe('repair does not create new problems', () => {
  it('never leaves an overlap after stretching durations', () => {
    // A flash followed immediately by a long line that is also too fast.
    const cues = [cue(1, 1.1, 'flash'), cue(1.15, 1.4, 'a'.repeat(40)), cue(2, 4, 'end')];
    const result = repair(cues, diagnose(cues));
    for (let index = 1; index < result.cues.length; index += 1) {
      expect(result.cues[index - 1].end).toBeLessThanOrEqual(result.cues[index].start);
    }
  });

  it('reports each issue id once', () => {
    const cues = [cue(1, 1.1, 'short'), cue(1.2, 1.3, 'also short')];
    const result = repair(cues, diagnose(cues));
    expect(new Set(result.applied).size).toBe(result.applied.length);
  });
});
