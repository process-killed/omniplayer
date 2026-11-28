/**
 * OmniSubtitle Doctor — diagnosis and repair for subtitle files.
 *
 * Pure functions only: given cues in, issues and repaired cues out. No DOM, no
 * player, so the whole engine is unit-testable and can run in a worker later.
 *
 * Severity is deliberate:
 *   error → the cue cannot display correctly (bad timing, empty text)
 *   warn  → it displays, but badly (too fast to read, overlapping)
 *   info  → cosmetic (long line, trailing space)
 *
 * Only issues with a `fix` are repaired automatically, and every fix is
 * conservative — it never invents dialogue, never deletes a cue that has text,
 * and never moves a cue past its neighbour.
 */
import type { Cue } from '../types';

export type IssueCode =
  | 'empty-cue'
  | 'invalid-time'
  | 'negative-duration'
  | 'zero-duration'
  | 'overlap'
  | 'duplicate'
  | 'too-fast'
  | 'too-short'
  | 'long-line'
  | 'too-many-lines'
  | 'trailing-space'
  | 'odd-characters'
  | 'beyond-duration'
  | 'long-gap';

export type IssueSeverity = 'error' | 'warn' | 'info';

export interface SubtitleIssue {
  id: string;
  code: IssueCode;
  severity: IssueSeverity;
  /** Index in the original cue array, -1 for file-level issues. */
  cueIndex: number;
  start: number;
  end: number;
  title: string;
  detail: string;
  /** True when `fixIssues` can repair this without judgement. */
  fixable: boolean;
}

export interface DoctorOptions {
  /** Characters per second that are comfortable to read. */
  maxCps?: number;
  /** A cue shorter than this is a flash. */
  minDuration?: number;
  /** Longest a single line should be. */
  maxLineLength?: number;
  maxLines?: number;
  /** Media duration, when known, so cues past the end can be flagged. */
  mediaDuration?: number;
  /** Gap in seconds that suggests dialogue was dropped. */
  longGap?: number;
}

const DEFAULTS: Required<Omit<DoctorOptions, 'mediaDuration'>> = {
  maxCps: 21,
  minDuration: 0.7,
  maxLineLength: 42,
  maxLines: 2,
  longGap: 12,
};

const stripTags = (text: string) => text.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '');

/** Visible characters, ignoring markup — CPS is about what the eye reads. */
export function visibleLength(text: string): number {
  return stripTags(text).replace(/\s+/g, ' ').trim().length;
}

export function formatStamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped % 1) * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`;
}

/** Scan every cue and return the issues found, in timeline order. */
export function diagnose(cues: Cue[], options: DoctorOptions = {}): SubtitleIssue[] {
  const config = { ...DEFAULTS, ...options };
  const issues: SubtitleIssue[] = [];
  const seenText = new Map<string, number>();
  let previousEnd = 0;

  cues.forEach((cue, index) => {
    const push = (
      code: IssueCode,
      severity: IssueSeverity,
      title: string,
      detail: string,
      fixable = true,
    ) => {
      issues.push({
        id: `${code}:${index}`,
        code,
        severity,
        cueIndex: index,
        start: cue.start,
        end: cue.end,
        title,
        detail,
        fixable,
      });
    };

    const text = stripTags(cue.text).trim();

    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) {
      push('invalid-time', 'error', 'Invalid timestamp', 'Start or end is not a number.', false);
      return;
    }
    if (cue.start < 0 || cue.end < 0) {
      push('invalid-time', 'error', 'Negative timestamp', `Cue starts at ${formatStamp(cue.start)}.`);
    }
    if (!text) {
      push('empty-cue', 'error', 'Empty cue', 'No visible text — the subtitle shows nothing.');
    }
    if (cue.end < cue.start) {
      push('negative-duration', 'error', 'Ends before it starts', `${formatStamp(cue.start)} → ${formatStamp(cue.end)}`);
    } else if (cue.end - cue.start < 0.05) {
      push('zero-duration', 'error', 'Zero-length cue', 'Appears and disappears in the same instant.');
    }

    const duration = cue.end - cue.start;
    if (text && duration > 0) {
      const cps = visibleLength(cue.text) / duration;
      if (cps > config.maxCps) {
        push(
          'too-fast',
          'warn',
          'Too fast to read',
          `${Math.round(cps)} characters per second (comfortable is ${config.maxCps}).`,
        );
      }
      if (duration < config.minDuration && duration > 0) {
        push('too-short', 'warn', 'Flashes on screen', `Visible for only ${duration.toFixed(2)}s.`);
      }
    }

    if (cue.start < previousEnd - 0.001) {
      push('overlap', 'warn', 'Overlaps the previous cue', `Starts ${(previousEnd - cue.start).toFixed(2)}s before the previous line ends.`);
    }

    if (text) {
      const key = `${text}@${Math.round(cue.start * 10)}`;
      if (seenText.has(key)) {
        push('duplicate', 'warn', 'Duplicate cue', `Same text at ${formatStamp(cue.start)} as cue ${seenText.get(key)! + 1}.`);
      } else {
        seenText.set(key, index);
      }
    }

    const lines = cue.text.split('\n');
    const longest = Math.max(...lines.map((line) => visibleLength(line)), 0);
    if (longest > config.maxLineLength) {
      push('long-line', 'info', 'Line too long', `${longest} characters — over ${config.maxLineLength} wraps awkwardly.`);
    }
    if (lines.length > config.maxLines) {
      push('too-many-lines', 'info', 'Too many lines', `${lines.length} lines will cover the picture.`);
    }
    if (/\s$/.test(cue.text) || /^\s/.test(cue.text)) {
      push('trailing-space', 'info', 'Stray whitespace', 'Leading or trailing spaces shift the text off-centre.');
    }
    if (/[\uFFFD\u0000]/.test(cue.text)) {
      push('odd-characters', 'info', 'Broken characters', 'Contains replacement characters — the encoding was wrong somewhere.', false);
    }
    if (config.mediaDuration && cue.start > config.mediaDuration) {
      push('beyond-duration', 'warn', 'After the video ends', `Starts at ${formatStamp(cue.start)}, media is ${formatStamp(config.mediaDuration)}.`);
    }
    if (index > 0 && cue.start - previousEnd > config.longGap) {
      push('long-gap', 'info', 'Long silence', `${Math.round(cue.start - previousEnd)}s with no subtitle — dialogue may be missing.`, false);
    }

    previousEnd = Math.max(previousEnd, cue.end);
  });

  return issues.sort((a, b) => a.start - b.start || a.cueIndex - b.cueIndex);
}

export interface RepairResult {
  cues: Cue[];
  /** Issue ids that were applied. */
  applied: string[];
  /** Issue ids that could not be fixed safely. */
  skipped: string[];
}

/**
 * Apply every safe fix, in dependency order:
 * timestamps → overlaps → durations → text tidy.
 */
export function repair(cues: Cue[], issues: SubtitleIssue[], options: DoctorOptions = {}): RepairResult {
  const config = { ...DEFAULTS, ...options };
  const applied: string[] = [];
  const skipped: string[] = [];
  const byIndex = new Map<number, SubtitleIssue[]>();
  for (const issue of issues) {
    if (issue.cueIndex < 0) continue;
    byIndex.set(issue.cueIndex, [...(byIndex.get(issue.cueIndex) ?? []), issue]);
  }

  const next: Cue[] = cues.map((cue, index) => {
    const cueIssues = byIndex.get(index) ?? [];
    const codes = new Set(cueIssues.map((issue) => issue.code));
    const mark = (code: IssueCode) => {
      const issue = cueIssues.find((entry) => entry.code === code);
      if (issue) applied.push(issue.id);
    };
    const copy: Cue = { ...cue };

    if (codes.has('invalid-time') || codes.has('negative-duration')) {
      copy.start = Math.max(0, Number.isFinite(copy.start) ? copy.start : 0);
      copy.end = Number.isFinite(copy.end) ? copy.end : copy.start + config.minDuration;
      if (copy.end < copy.start) copy.end = copy.start + config.minDuration;
      mark('invalid-time');
      mark('negative-duration');
    }
    if (codes.has('trailing-space')) {
      copy.text = copy.text.replace(/^[ \t]+|[ \t]+$/gm, '');
      mark('trailing-space');
    }
    if (codes.has('empty-cue')) {
      // An empty cue is dropped rather than kept as a blank flash.
      copy.text = '';
      mark('empty-cue');
    }
    return copy;
  });

  // Drop cues that were empty to begin with.
  const kept = next.filter((cue, index) => {
    const cueIssues = byIndex.get(index) ?? [];
    const wasEmpty = cueIssues.some((issue) => issue.code === 'empty-cue');
    return !wasEmpty || cue.text.trim().length > 0;
  });

  // Overlaps: trim the earlier cue so lines never draw on top of each other.
  for (let index = 1; index < kept.length; index += 1) {
    const previous = kept[index - 1];
    const current = kept[index];
    if (current.start < previous.end - 0.001) {
      const gap = 0.04;
      previous.end = Math.max(previous.start + 0.2, current.start - gap);
      const issue = issues.find((entry) => entry.code === 'overlap' && entry.cueIndex === index);
      if (issue) applied.push(issue.id);
    }
  }

  // Durations: enforce a readable minimum, but never past the next cue.
  kept.forEach((cue, index) => {
    const cueIssues = byIndex.get(index) ?? [];
    const needsMinimum = cueIssues.some((issue) => issue.code === 'too-short' || issue.code === 'zero-duration');
    if (!needsMinimum) return;
    const nextStart = kept[index + 1]?.start ?? Infinity;
    const room = nextStart - cue.start - 0.04;
    // The room before the next cue caps the extension; never cross it.
    const target = Math.min(Math.max(config.minDuration, cue.end - cue.start), Math.max(0.05, room));
    if (target > cue.end - cue.start) {
      cue.end = cue.start + target;
      const issue = cueIssues.find((entry) => entry.code === 'too-short' || entry.code === 'zero-duration');
      if (issue) applied.push(issue.id);
    } else {
      const issue = cueIssues.find((entry) => entry.code === 'too-short' || entry.code === 'zero-duration');
      if (issue) skipped.push(issue.id);
    }
  });

  // Reading speed: extend into the following silence when there is room.
  kept.forEach((cue, index) => {
    const cueIssues = byIndex.get(index) ?? [];
    const issue = cueIssues.find((entry) => entry.code === 'too-fast');
    if (!issue) return;
    const length = visibleLength(cue.text);
    const needed = length / config.maxCps;
    const nextStart = kept[index + 1]?.start ?? Infinity;
    const room = nextStart - cue.start - 0.04;
    if (room >= needed) {
      cue.end = cue.start + needed;
      applied.push(issue.id);
    } else if (room > cue.end - cue.start) {
      cue.end = cue.start + room;
      applied.push(issue.id);
    } else {
      skipped.push(issue.id);
    }
  });

  // Extending durations above can push a cue into its neighbour. Trim once more
  // so a repair never *creates* the overlap it just removed.
  for (let index = 1; index < kept.length; index += 1) {
    const previous = kept[index - 1];
    const current = kept[index];
    if (previous.end > current.start - 0.02) {
      // Never exceed the next cue's start, even when the two are 50 ms apart:
      // a 0.2 s floor would push this back into an overlap.
      const trimmed = Math.min(current.start - 0.04, current.start);
      previous.end = Math.max(previous.start + 0.02, trimmed);
    }
  }

  return { cues: kept, applied: [...new Set(applied)], skipped: [...new Set(skipped)] };
}

/**
 * Shift every cue by a constant offset.
 * Positive moves subtitles later (they were early), negative moves them earlier.
 */
export function applyOffset(cues: Cue[], offsetSeconds: number): Cue[] {
  return cues.map((cue) => ({
    ...cue,
    start: Math.max(0, cue.start + offsetSeconds),
    end: Math.max(0, cue.end + offsetSeconds),
  }));
}

/**
 * Correct gradual drift: a constant offset plus a linear component, applied
 * proportionally across the file. `drift` is the extra seconds to add by the
 * final cue, which is how "subtitles get progressively later" is expressed.
 */
export function applyDrift(cues: Cue[], offsetSeconds: number, driftSeconds: number): Cue[] {
  if (!cues.length) return [];
  const first = cues[0].start;
  const last = cues[cues.length - 1].start;
  const span = Math.max(1, last - first);
  return cues.map((cue) => {
    const progress = (cue.start - first) / span;
    const shift = offsetSeconds + driftSeconds * progress;
    return {
      ...cue,
      start: Math.max(0, cue.start + shift),
      end: Math.max(0, cue.end + shift),
    };
  });
}

/** Serialise back to SRT, the safest interchange format. */
export function toSrt(cues: Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${formatStamp(cue.start)} --> ${formatStamp(cue.end)}\n${cue.text.trim()}\n`)
    .join('\n');
}

/** Serialise to WebVTT. */
export function toVtt(cues: Cue[]): string {
  const stamp = (seconds: number) => formatStamp(seconds).replace('.', '.');
  return ['WEBVTT', '', ...cues.map((cue) => `${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.trim()}\n`)].join('\n');
}

export interface DoctorSummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  fixable: number;
}

export function summarise(issues: SubtitleIssue[]): DoctorSummary {
  return {
    total: issues.length,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warn').length,
    infos: issues.filter((issue) => issue.severity === 'info').length,
    fixable: issues.filter((issue) => issue.fixable).length,
  };
}
