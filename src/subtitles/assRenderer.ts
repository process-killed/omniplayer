/**
 * A styled ASS/SSA renderer.
 *
 * Anime subtitles rely on positioning, per-line colours, outlines, fonts and
 * karaoke. This renderer keeps those instead of flattening ASS into plain text:
 * it maps the script's 384×288 (or PlayRes) coordinate space onto the video box
 * with CSS, so it stays sharp at any size.
 *
 * Supported overrides: \b \i \u \s \c \1c \2c \3c \4c \alpha \1a \fs \fscx
 * \fscy \an \a \pos \move \fad \fade \bord \shad \blur \k \K \kf \ko \r \N \n \h
 * Unsupported tags are ignored safely (never printed as text).
 */

import type { Cue } from '../types';
import type { AssStyle, SubtitleDocument } from './parser';
import { DEFAULT_ASS_STYLE } from './parser';

interface RunState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  fontSize: number;
  alpha: number;
  scaleX: number;
}

interface Run {
  text: string;
  state: RunState;
  karaokeStart?: number;
  karaokeDuration?: number;
}

interface CueLayout {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  fontSize: number;
  color: string;
  outlineColor: string;
  outline: number;
  shadow: number;
  backColor: string;
  borderStyle: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  alpha: number;
  fadeIn: number;
  fadeOut: number;
  moveTo?: { x: number; y: number; start: number; end: number };
  align: number;
  blur: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseColorTag(value: string, fallback: string): string {
  const match = /&?H([0-9a-fA-F]+)&?/.exec(value);
  if (!match) return fallback;
  let hex = match[1];
  if (hex.length <= 6) hex = hex.padStart(6, '0');
  const bb = hex.slice(-2);
  const gg = hex.slice(-4, -2);
  const rr = hex.slice(-6, -4);
  return `#${rr}${gg}${bb}`.toLowerCase();
}

function parseAlphaTag(value: string): number | null {
  const match = /&?H([0-9a-fA-F]{2})&?/.exec(value.trim());
  if (!match) return null;
  return 1 - Number.parseInt(match[1], 16) / 255;
}

function parseTagList(content: string): Array<{ name: string; value: string; args: string | null }> {
  const tags: Array<{ name: string; value: string; args: string | null }> = [];
  for (const chunk of content.split('\\')) {
    if (!chunk) continue;
    const match = /^(\d?[a-zA-Z]+)(.*)$/.exec(chunk);
    if (!match) continue;
    const name = match[1];
    let rest = match[2] ?? '';
    let args: string | null = null;
    if (rest.startsWith('(')) {
      const close = rest.lastIndexOf(')');
      args = close > 0 ? rest.slice(1, close) : rest.slice(1);
      rest = close > 0 ? rest.slice(close + 1) : '';
    }
    tags.push({ name, value: rest.trim(), args });
  }
  return tags;
}

function alignmentAnchors(alignment: number): { anchorX: number; anchorY: number; align: number } {
  const col = (alignment - 1) % 3;
  const row = Math.floor((alignment - 1) / 3);
  const anchorX = col === 0 ? 0 : col === 1 ? 0.5 : 1;
  const anchorY = row === 0 ? 1 : row === 1 ? 0.5 : 0;
  return { anchorX, anchorY, align: col === 0 ? 0 : col === 1 ? 1 : 2 };
}

/** Split ASS dialogue text into styled runs, collecting layout overrides. */
function buildRuns(cue: Cue, style: AssStyle, playResX: number, playResY: number): { runs: Run[]; layout: CueLayout } {
  const base: RunState = {
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strike: style.strikeOut,
    color: style.primaryColour,
    fontSize: style.fontSize,
    alpha: 1,
    scaleX: style.scaleX,
  };

  let state: RunState = { ...base };
  const runs: Run[] = [];
  let buffer = '';
  let pendingKaraoke: number | null = null;
  let karaokeCursor = 0;

  let posX: number | null = null;
  let posY: number | null = null;
  let alignment = style.alignment || 2;
  let fadeIn = 0;
  let fadeOut = 0;
  let moveTo: CueLayout['moveTo'];
  let outline = style.outline;
  let shadow = style.shadow;
  let outlineColor = style.outlineColour;
  let blur = 0;
  let alpha = 1;
  let fontSizeOverride: number | null = null;

  const flush = (withKaraoke: boolean) => {
    if (!buffer) return;
    const run: Run = { text: buffer, state: { ...state } };
    if (withKaraoke && pendingKaraoke !== null) {
      run.karaokeStart = karaokeCursor;
      run.karaokeDuration = pendingKaraoke;
      karaokeCursor += pendingKaraoke;
    }
    runs.push(run);
    buffer = '';
  };

  let i = 0;
  while (i < cue.text.length) {
    const char = cue.text[i];
    if (char === '{') {
      const close = cue.text.indexOf('}', i);
      if (close === -1) {
        i++;
        continue;
      }
      const content = cue.text.slice(i + 1, close);
      flush(true);
      for (const tag of parseTagList(content)) {
        const name = tag.name.toLowerCase();
        const num = Number.parseFloat(tag.value);
        switch (name) {
          case 'b':
            state.bold = tag.value === '' ? !state.bold : num !== 0;
            break;
          case 'i':
            state.italic = tag.value === '' ? !state.italic : num !== 0;
            break;
          case 'u':
            state.underline = tag.value === '' ? !state.underline : num !== 0;
            break;
          case 's':
            state.strike = tag.value === '' ? !state.strike : num !== 0;
            break;
          case 'c':
          case '1c':
            state.color = parseColorTag(tag.value, state.color);
            break;
          case '3c':
            outlineColor = parseColorTag(tag.value, outlineColor);
            break;
          case 'alpha':
            alpha = parseAlphaTag(tag.value) ?? alpha;
            state.alpha = alpha;
            break;
          case '1a':
            alpha = parseAlphaTag(tag.value) ?? alpha;
            state.alpha = alpha;
            break;
          case 'fs':
            if (Number.isFinite(num) && num > 0) {
              state.fontSize = num;
              fontSizeOverride = num;
            }
            break;
          case 'fscx':
            if (Number.isFinite(num) && num > 0) state.scaleX = num;
            break;
          case 'an':
          case 'a':
            if (Number.isFinite(num) && num >= 1 && num <= 9) alignment = num;
            break;
          case 'pos':
            if (tag.args) {
              const [x, y] = tag.args.split(',').map((value) => Number.parseFloat(value));
              if (Number.isFinite(x) && Number.isFinite(y)) {
                posX = x;
                posY = y;
              }
            }
            break;
          case 'move':
            if (tag.args) {
              const parts = tag.args.split(',').map((value) => Number.parseFloat(value));
              if (parts.length >= 4 && parts.every((value) => Number.isFinite(value))) {
                posX = parts[0];
                posY = parts[1];
                moveTo = {
                  x: parts[2],
                  y: parts[3],
                  start: parts[4] ?? 0,
                  end: parts[5] ?? (parts[4] ?? 0) + 500,
                };
              }
            }
            break;
          case 'fad':
            if (tag.args) {
              const [inMs, outMs] = tag.args.split(',').map((value) => Number.parseFloat(value));
              fadeIn = Number.isFinite(inMs) ? inMs : 0;
              fadeOut = Number.isFinite(outMs) ? outMs : 0;
            }
            break;
          case 'fade':
            if (tag.args) {
              const parts = tag.args.split(',').map((value) => Number.parseFloat(value));
              if (parts.length >= 3) {
                fadeIn = Math.max(0, parts[1] - parts[0]);
                fadeOut = Math.max(0, parts[2] - parts[1]);
              }
            }
            break;
          case 'bord':
            if (Number.isFinite(num)) outline = num;
            break;
          case 'shad':
            if (Number.isFinite(num)) shadow = num;
            break;
          case 'blur':
            if (Number.isFinite(num)) blur = num;
            break;
          case 'k':
          case 'kf':
          case 'ko':
            if (Number.isFinite(num)) {
              pendingKaraoke = num * 10;
              karaokeCursor += 0;
            }
            break;
          case 'r':
            state = { ...base };
            outline = style.outline;
            shadow = style.shadow;
            outlineColor = style.outlineColour;
            alpha = 1;
            fontSizeOverride = null;
            break;
          case 'q':
          case 'p':
          case 't':
            break;
          default:
            break;
        }
      }
      i = close + 1;
      continue;
    }
    if (char === '\\') {
      const next = cue.text[i + 1];
      if (next === 'N' || next === 'n') {
        buffer += next === 'N' ? '\n' : ' ';
        i += 2;
        continue;
      }
      if (next === 'h') {
        buffer += '\u00a0';
        i += 2;
        continue;
      }
      buffer += char;
      i++;
      continue;
    }
    buffer += char;
    i++;
  }
  flush(true);

  const { anchorX, anchorY, align } = alignmentAnchors(alignment);
  let x: number;
  let y: number;
  if (posX !== null && posY !== null) {
    x = posX;
    y = posY;
  } else {
    const col = (alignment - 1) % 3;
    const row = Math.floor((alignment - 1) / 3);
    x = col === 0 ? style.marginL : col === 1 ? playResX / 2 : playResX - style.marginR;
    y = row === 0 ? playResY - style.marginV : row === 1 ? playResY / 2 : style.marginV;
  }

  const layout: CueLayout = {
    x,
    y,
    anchorX,
    anchorY,
    fontSize: fontSizeOverride ?? style.fontSize,
    color: style.primaryColour,
    outlineColor,
    outline,
    shadow,
    backColor: style.backColour,
    borderStyle: style.borderStyle,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strike: style.strikeOut,
    alpha,
    fadeIn,
    fadeOut,
    moveTo,
    align,
    blur,
  };
  return { runs, layout };
}

export interface AssRenderedCue {
  element: HTMLElement;
  cue: Cue;
  karaoke: Array<{ element: HTMLElement; start: number; duration: number; primary: string; secondary: string }>;
  layout: CueLayout;
}

/** Build the DOM for one ASS cue. */
export function renderAssCue(cue: Cue, doc: SubtitleDocument): AssRenderedCue {
  const style = doc.styles[cue.style ?? 'Default'] ?? doc.styles.Default ?? DEFAULT_ASS_STYLE;
  const { runs, layout } = buildRuns(cue, style, doc.playResX, doc.playResY);

  const element = document.createElement('div');
  element.className = 'ass-cue';
  element.dataset.start = String(cue.start);
  element.dataset.end = String(cue.end);
  element.style.left = `${(layout.x / doc.playResX) * 100}%`;
  element.style.top = `${(layout.y / doc.playResY) * 100}%`;
  // Bottom-anchored cues lift above the transport bar while it is visible;
  // --ass-lift is 0px otherwise, so this is a no-op in normal playback.
  const lift = layout.anchorY > 0.5 ? ' - var(--ass-lift, 0px)' : '';
  element.style.transform = `translate(${-layout.anchorX * 100}%, calc(${-layout.anchorY * 100}%${lift}))`;
  element.style.fontFamily = `'${style.fontName.replace(/'/g, '')}', 'Inter', sans-serif`;
  element.style.fontSize = `calc(${layout.fontSize} * var(--ass-scale, 1) * 1px)`;
  element.style.textAlign = layout.align === 0 ? 'left' : layout.align === 1 ? 'center' : 'right';
  element.style.maxWidth = `${Math.max(20, 100 - ((style.marginL + style.marginR) / doc.playResX) * 100)}%`;
  element.style.color = layout.color;
  element.style.opacity = String(layout.alpha);
  if (layout.bold) element.style.fontWeight = '700';
  if (layout.italic) element.style.fontStyle = 'italic';
  const decorations: string[] = [];
  if (layout.underline) decorations.push('underline');
  if (layout.strike) decorations.push('line-through');
  if (decorations.length) element.style.textDecoration = decorations.join(' ');

  if (layout.outline > 0) {
    element.style.webkitTextStroke = `calc(${layout.outline} * var(--ass-scale, 1) * 1px) ${layout.outlineColor}`;
    element.style.paintOrder = 'stroke fill';
  }
  if (layout.shadow > 0) {
    element.style.textShadow = `calc(${layout.shadow} * var(--ass-scale, 1) * 1px) calc(${layout.shadow} * var(--ass-scale, 1) * 1px) calc(${Math.max(1, layout.shadow)} * var(--ass-scale, 1) * 1px) rgba(0,0,0,0.85)`;
  }
  if (layout.blur > 0) {
    element.style.filter = `blur(calc(${layout.blur} * var(--ass-scale, 1) * 0.5px))`;
  }
  if (layout.borderStyle === 3) {
    element.style.background = layout.backColor;
    element.style.padding = `calc(${Math.max(2, layout.outline)} * var(--ass-scale, 1) * 1px)`;
    element.style.borderRadius = '2px';
  }

  const karaoke: AssRenderedCue['karaoke'] = [];
  const hasKaraoke = runs.some((run) => run.karaokeDuration !== undefined);

  for (const run of runs) {
    const span = document.createElement('span');
    const pieces = run.text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) span.append(document.createElement('br'));
      if (piece) span.append(document.createTextNode(piece));
    });
    if (run.state.bold) span.style.fontWeight = '700';
    if (run.state.italic) span.style.fontStyle = 'italic';
    if (run.state.underline) span.style.textDecoration = 'underline';
    if (run.state.strike) span.style.textDecoration = 'line-through';
    if (run.state.color !== layout.color) span.style.color = run.state.color;
    if (run.state.fontSize !== layout.fontSize) span.style.fontSize = `calc(${run.state.fontSize} * var(--ass-scale, 1) * 1px)`;
    if (run.state.scaleX !== 100) span.style.display = 'inline-block';
    if (run.state.scaleX !== 100) span.style.transform = `scaleX(${run.state.scaleX / 100})`;
    if (run.state.alpha < 1) span.style.opacity = String(run.state.alpha);

    if (run.karaokeDuration !== undefined) {
      span.dataset.kStart = String(run.karaokeStart ?? 0);
      span.dataset.kDur = String(run.karaokeDuration);
      span.style.color = style.secondaryColour;
      karaoke.push({
        element: span,
        start: run.karaokeStart ?? 0,
        duration: run.karaokeDuration,
        primary: run.state.color,
        secondary: style.secondaryColour,
      });
    } else if (hasKaraoke) {
      // Text outside a karaoke block keeps the primary colour.
      span.style.color = run.state.color;
    }
    element.append(span);
  }

  if (layout.fadeIn || layout.fadeOut) {
    element.dataset.fadeIn = String(layout.fadeIn);
    element.dataset.fadeOut = String(layout.fadeOut);
    element.style.opacity = layout.fadeIn > 0 ? '0' : String(layout.alpha);
  }

  if (layout.moveTo) {
    const target = layout.moveTo;
    element.dataset.moveX = String((target.x / doc.playResX) * 100);
    element.dataset.moveY = String((target.y / doc.playResY) * 100);
    element.dataset.moveStart = String(target.start);
    element.dataset.moveEnd = String(target.end);
  }

  return { element, cue, karaoke, layout };
}

/** Per-frame update: karaoke colours, fades and \move interpolation. */
export function updateAssCue(rendered: AssRenderedCue, time: number, baseOpacity = 1): void {
  const elapsedMs = (time - rendered.cue.start) * 1000;
  const durationMs = (rendered.cue.end - rendered.cue.start) * 1000;
  const element = rendered.element;

  for (const part of rendered.karaoke) {
    const active = elapsedMs >= part.start + part.duration;
    part.element.style.color = active ? part.primary : part.secondary;
  }

  let opacity = rendered.layout.alpha * baseOpacity;
  const fadeIn = Number(element.dataset.fadeIn ?? 0);
  const fadeOut = Number(element.dataset.fadeOut ?? 0);
  if (fadeIn > 0 && elapsedMs < fadeIn) opacity *= Math.max(0, elapsedMs / fadeIn);
  if (fadeOut > 0 && durationMs - elapsedMs < fadeOut) opacity *= Math.max(0, (durationMs - elapsedMs) / fadeOut);
  element.style.opacity = String(Math.min(1, Math.max(0, opacity)));

  const moveX = element.dataset.moveX;
  if (moveX) {
    const moveStart = Number(element.dataset.moveStart ?? 0);
    const moveEnd = Number(element.dataset.moveEnd ?? 0);
    const span = Math.max(1, moveEnd - moveStart);
    const progress = Math.min(1, Math.max(0, (elapsedMs - moveStart) / span));
    const startX = Number.parseFloat(element.style.left);
    const startY = Number.parseFloat(element.style.top);
    const endX = Number.parseFloat(moveX);
    const endY = Number.parseFloat(element.dataset.moveY ?? '0');
    element.style.left = `${startX + (endX - startX) * progress}%`;
    element.style.top = `${startY + (endY - startY) * progress}%`;
  }
}

/** Simple text renderer used for SRT/VTT/TTML and for ASS without styling. */
export function renderPlainCue(cue: Cue): HTMLElement {
  const element = document.createElement('div');
  element.className = 'sub-line';
  element.innerHTML = sanitizeCueHtml(cue.text);
  return element;
}

/** Allow only the tiny HTML subset subtitles legitimately use. */
export function sanitizeCueHtml(raw: string): string {
  let text = escapeHtml(raw);
  text = text.replace(/\\N/gi, '\n');
  // Whitelisted inline tags.
  text = text.replace(/&lt;(\/?)(b|i|u|s)&gt;/gi, '<$1$2>');
  text = text.replace(/&lt;br\s*\/?&gt;/gi, '\n');
  text = text.replace(/&lt;font\s+color\s*=\s*(?:&quot;|["'])?([#\w(),.%\s]+?)(?:&quot;|["'])?\s*&gt;/gi, (_m, color: string) => {
    const safe = color.replace(/[^#\w(),.%\s]/g, '');
    return `<span style="color:${safe}">`;
  });
  text = text.replace(/&lt;\/font&gt;/gi, '</span>');
  // Strip any remaining tags that survived escaping (e.g. VTT voice/class spans).
  text = text.replace(/&lt;[^&]*?&gt;/g, '');
  return text;
}
