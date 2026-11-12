/**
 * Subtitle parsing: SubRip, WebVTT, ASS/SSA and TTML/DFXP.
 *
 * The parser is deliberately forgiving — real-world subtitle files are full of
 * odd timestamps, BOMs, stray tags and mixed line endings.
 */

import type { Cue } from '../types';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa' | 'ttml' | 'pgs' | 'unknown';

export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColour: string;
  secondaryColour: string;
  outlineColour: string;
  backColour: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  encoding: number;
}

export interface SubtitleDocument {
  format: SubtitleFormat;
  cues: Cue[];
  styles: Record<string, AssStyle>;
  playResX: number;
  playResY: number;
  wrapped: boolean;
  warnings: string[];
}

export const DEFAULT_ASS_STYLE: AssStyle = {
  name: 'Default',
  fontName: 'Arial',
  fontSize: 48,
  primaryColour: '#ffffff',
  secondaryColour: '#ffe600',
  outlineColour: '#000000',
  backColour: '#000000',
  bold: false,
  italic: false,
  underline: false,
  strikeOut: false,
  scaleX: 100,
  scaleY: 100,
  spacing: 0,
  angle: 0,
  borderStyle: 1,
  outline: 2,
  shadow: 1,
  alignment: 2,
  marginL: 20,
  marginR: 20,
  marginV: 30,
  encoding: 1,
};

/* --------------------------------------------------------------- utilities */

/** ASS colour (&HAABBGGRR or &HBBGGRR) → #rrggbb */
export function assColorToHex(value: string): string {
  const match = /&?H([0-9a-fA-F]+)&?/.exec(value.trim());
  if (!match) return '#ffffff';
  let hex = match[1];
  if (hex.length === 3) hex = `00${hex}`;
  if (hex.length === 6) hex = `00${hex}`;
  if (hex.length < 8) hex = hex.padStart(8, '0');
  const bb = hex.slice(2, 4);
  const gg = hex.slice(4, 6);
  const rr = hex.slice(6, 8);
  return `#${rr}${gg}${bb}`.toLowerCase();
}

export function assAlpha(value: string): number {
  const match = /&?H([0-9a-fA-F]{2})&?/.exec(value.trim());
  if (!match) return 1;
  const alpha = Number.parseInt(match[1], 16);
  return 1 - alpha / 255;
}

function parseAssTime(value: string): number {
  const match = /(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(value.trim());
  if (!match) return 0;
  const [, h, m, s, frac] = match;
  const ms = Number(frac.padEnd(3, '0'));
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + ms / 1000;
}

function parseSrtTime(value: string): number {
  const cleaned = value.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number(cleaned) || 0;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Decode a subtitle file, respecting BOMs and falling back to windows-1252. */
export function decodeSubtitleBuffer(buffer: ArrayBuffer, encoding?: string): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (encoding) {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      /* fall through */
    }
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/* -------------------------------------------------------------------- SRT */

export function parseSrt(input: string): Cue[] {
  const text = normalizeNewlines(input).replace(/^\uFEFF/, '');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    let timeIndex = 0;
    if (/^\d+$/.test(lines[0].trim()) && lines.length > 1) timeIndex = 1;
    const timeLine = lines[timeIndex];
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [rawStart, rawEnd] = timeLine.split('-->');
    const start = parseSrtTime(rawStart);
    const end = parseSrtTime((rawEnd ?? '').trim().split(/\s+/)[0] ?? '');
    const body = lines.slice(timeIndex + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start, end: end > start ? end : start + 2, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/* -------------------------------------------------------------------- VTT */

export function parseVtt(input: string): Cue[] {
  const text = normalizeNewlines(input).replace(/^\uFEFF/, '');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^WEBVTT/.test(lines[0]) || /^NOTE\b/.test(lines[0]) || /^STYLE\b/.test(lines[0]) || /^REGION\b/.test(lines[0])) continue;
    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex === -1) continue;
    const [rawStart, rest] = lines[timeIndex].split('-->');
    const rawEnd = (rest ?? '').trim().split(/\s+/)[0];
    const start = parseSrtTime(rawStart);
    const end = parseSrtTime(rawEnd);
    const body = lines.slice(timeIndex + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start, end: end > start ? end : start + 2, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------------- ASS/SSA */

function splitAssLine(line: string, fields: number): string[] {
  // The final field (Text) may contain commas, so split with a limit.
  const parts: string[] = [];
  let current = '';
  let count = 0;
  for (const char of line) {
    if (char === ',' && count < fields - 1) {
      parts.push(current);
      current = '';
      count++;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function parseAssStyleLine(line: string, fields: string[], isV4Plus: boolean): AssStyle {
  const values = splitAssLine(line, fields.length);
  const get = (name: string) => {
    const index = fields.indexOf(name.trim().toLowerCase());
    return index >= 0 ? (values[index] ?? '').trim() : '';
  };
  const num = (name: string, fallback: number) => {
    const value = Number.parseFloat(get(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const style: AssStyle = {
    ...DEFAULT_ASS_STYLE,
    name: get('name') || 'Default',
    fontName: get('fontname') || 'Arial',
    fontSize: num('fontsize', isV4Plus ? 48 : 24),
    primaryColour: assColorToHex(get('primarycolour') || '&H00FFFFFF'),
    secondaryColour: assColorToHex(get('secondarycolour') || '&H000000FF'),
    outlineColour: assColorToHex(get('outlinecolour') || '&H00000000'),
    backColour: assColorToHex(get('backcolour') || '&H00000000'),
    bold: num('bold', 0) !== 0,
    italic: num('italic', 0) !== 0,
    underline: num('underline', 0) !== 0,
    strikeOut: num('strikeout', 0) !== 0,
    scaleX: num('scalex', 100),
    scaleY: num('scaley', 100),
    spacing: num('spacing', 0),
    angle: num('angle', 0),
    borderStyle: num('borderstyle', 1),
    outline: num('outline', 2),
    shadow: num('shadow', 1),
    alignment: num('alignment', 2),
    marginL: num('marginl', 20),
    marginR: num('marginr', 20),
    marginV: num('marginv', 30),
    encoding: num('encoding', 1),
  };
  return style;
}

export function parseAss(input: string): SubtitleDocument {
  const text = normalizeNewlines(input).replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const styles: Record<string, AssStyle> = {};
  let playResX = 384;
  let playResY = 288;
  let wrapped = true;
  let section = '';
  let styleFields: string[] = [];
  let eventFields: string[] = [];
  const cues: Cue[] = [];
  const warnings: string[] = [];
  let isV4Plus = true;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).toLowerCase();
      if (section.startsWith('v4+')) isV4Plus = true;
      if (section === 'v4 styles') isV4Plus = false;
      continue;
    }
    if (section === 'script info') {
      const [key, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      if (key.toLowerCase() === 'playresx') playResX = Number(value) || playResX;
      if (key.toLowerCase() === 'playresy') playResY = Number(value) || playResY;
      if (key.toLowerCase() === 'wrapstyle') wrapped = value !== '2';
      continue;
    }
    if (section.startsWith('v4')) {
      if (line.toLowerCase().startsWith('format:')) {
        styleFields = line
          .slice(7)
          .split(',')
          .map((field) => field.trim().toLowerCase());
        continue;
      }
      if (line.toLowerCase().startsWith('style:')) {
        if (styleFields.length === 0) {
          styleFields = [
            'name', 'fontname', 'fontsize', 'primarycolour', 'secondarycolour', 'outlinecolour', 'backcolour',
            'bold', 'italic', 'underline', 'strikeout', 'scalex', 'scaley', 'spacing', 'angle', 'borderstyle',
            'outline', 'shadow', 'alignment', 'marginl', 'marginr', 'marginv', 'encoding',
          ];
        }
        const style = parseAssStyleLine(line.slice(6).trim(), styleFields, isV4Plus);
        styles[style.name] = style;
      }
      continue;
    }
    if (section === 'events') {
      if (line.toLowerCase().startsWith('format:')) {
        eventFields = line
          .slice(7)
          .split(',')
          .map((field) => field.trim().toLowerCase());
        continue;
      }
      if (!/^dialogue:/i.test(line)) continue;
      if (eventFields.length === 0) {
        eventFields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      }
      const values = splitAssLine(line.slice(9).trim(), eventFields.length);
      const get = (name: string) => {
        const index = eventFields.indexOf(name);
        return index >= 0 ? (values[index] ?? '') : '';
      };
      const start = parseAssTime(get('start'));
      const end = parseAssTime(get('end'));
      const body = get('text').trim();
      if (!body || !(end > start)) continue;
      cues.push({
        start,
        end,
        text: body,
        style: get('style').trim() || 'Default',
        layer: Number(get('layer')) || 0,
      });
    }
  }

  if (cues.length === 0) warnings.push('No dialogue lines were found in this ASS/SSA file.');
  if (Object.keys(styles).length === 0) styles.Default = { ...DEFAULT_ASS_STYLE };

  return {
    format: 'ass',
    cues: cues.sort((a, b) => a.start - b.start || (a.layer ?? 0) - (b.layer ?? 0)),
    styles,
    playResX,
    playResY,
    wrapped,
    warnings,
  };
}

/* ------------------------------------------------------------------- TTML */

export function parseTtml(input: string): Cue[] {
  const cues: Cue[] = [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(input, 'application/xml');
  } catch {
    return cues;
  }
  const parserError = doc.querySelector('parsererror');
  if (parserError) return cues;

  const paragraphs = Array.from(doc.getElementsByTagName('p'));
  for (const node of paragraphs) {
    const begin = node.getAttribute('begin') ?? '';
    const end = node.getAttribute('end') ?? '';
    const dur = node.getAttribute('dur') ?? '';
    const start = parseTtmlTime(begin);
    let finish = end ? parseTtmlTime(end) : dur ? start + parseTtmlTime(dur) : start + 3;
    if (!Number.isFinite(start)) continue;
    if (!Number.isFinite(finish) || finish <= start) finish = start + 3;
    const text = extractTtmlText(node);
    if (!text.trim()) continue;
    cues.push({ start, end: finish, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function extractTtmlText(node: Element): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? '';
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (tag === 'br') out += '\n';
      else out += extractTtmlText(element);
    }
  });
  return out.replace(/[ \t]+/g, ' ').trim();
}

function parseTtmlTime(value: string): number {
  if (!value) return Number.NaN;
  const clock = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/.exec(value.trim());
  if (clock) {
    const [, h, m, s, frac] = clock;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0);
  }
  const offset = /^([\d.]+)(h|m|s|ms|f|t)$/.exec(value.trim());
  if (offset) {
    const amount = Number(offset[1]);
    switch (offset[2]) {
      case 'h':
        return amount * 3600;
      case 'm':
        return amount * 60;
      case 'ms':
        return amount / 1000;
      case 'f':
        return amount / 25;
      case 't':
        return amount;
      default:
        return amount;
    }
  }
  return Number(value) || Number.NaN;
}

/* ------------------------------------------------------------------ entry */

export function detectSubtitleFormat(text: string, filename?: string): SubtitleFormat {
  const head = text.slice(0, 4096);
  if (/^\uFEFF?\[Script Info\]/i.test(head) || /\[Events\]/i.test(head)) {
    return /ScriptType:\s*v4\.00\+/i.test(head) || /^Style:\s*[^,]+,[^,]+,[^,]+,/i.test(head) ? 'ass' : 'ssa';
  }
  if (/^\uFEFF?WEBVTT/.test(head)) return 'vtt';
  if (/<tt[\s>]/i.test(head)) return 'ttml';
  if (/-->/.test(head)) {
    if (/^\s*WEBVTT/i.test(head)) return 'vtt';
    const ext = filename?.split('.').pop()?.toLowerCase();
    if (ext === 'vtt') return 'vtt';
    return 'srt';
  }
  return 'unknown';
}

export function parseSubtitle(text: string, filename?: string): SubtitleDocument {
  const format = detectSubtitleFormat(text, filename);
  const warnings: string[] = [];
  let cues: Cue[] = [];
  let styles: Record<string, AssStyle> = {};
  let playResX = 384;
  let playResY = 288;
  let wrapped = true;

  if (format === 'ass' || format === 'ssa') {
    const doc = parseAss(text);
    return doc;
  }
  if (format === 'vtt') {
    cues = parseVtt(text);
    if (cues.length === 0) warnings.push('No cues were found in this WebVTT file.');
  } else if (format === 'ttml') {
    cues = parseTtml(text);
    if (cues.length === 0) warnings.push('No timed paragraphs were found in this TTML file.');
  } else if (format === 'srt') {
    cues = parseSrt(text);
    if (cues.length === 0) warnings.push('No cues were found — check the timestamps.');
  } else {
    // Last resort: try SRT, then VTT.
    cues = parseSrt(text);
    if (cues.length === 0) cues = parseVtt(text);
    if (cues.length === 0) warnings.push('The subtitle format could not be recognised.');
  }
  styles = { Default: { ...DEFAULT_ASS_STYLE } };
  return { format: format === 'unknown' ? (cues.length ? 'srt' : 'unknown') : format, cues, styles, playResX, playResY, wrapped, warnings };
}

export function cueAt(cues: Cue[], time: number): Cue[] {
  const active: Cue[] = [];
  for (const cue of cues) {
    if (cue.start > time) break;
    if (cue.end >= time) active.push(cue);
  }
  return active;
}
