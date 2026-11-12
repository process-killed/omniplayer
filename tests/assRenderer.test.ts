// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAss } from '../src/subtitles/parser';
import { renderAssCue, sanitizeCueHtml, renderPlainCue } from '../src/subtitles/assRenderer';

const DOC = parseAss(`[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\pos(960,900)\\an5}Hello {\\i1}anime{\\i0} world
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,{\\k30}ka{\\k40}ra{\\k30}oke
`);

describe('ASS renderer', () => {
  it('positions cues in the script coordinate space', () => {
    const rendered = renderAssCue(DOC.cues[0], DOC);
    expect(rendered.element.style.left).toBe('50%');
    expect(Number.parseFloat(rendered.element.style.top)).toBeCloseTo(83.333, 2);
    expect(rendered.element.style.transform).toContain('translate(-50%');
  });

  it('keeps inline italics as spans', () => {
    const rendered = renderAssCue(DOC.cues[0], DOC);
    const spans = Array.from(rendered.element.querySelectorAll('span'));
    expect(spans.some((span) => span.style.fontStyle === 'italic')).toBe(true);
    expect(rendered.element.textContent).toContain('Hello anime world');
  });

  it('builds karaoke runs with timings', () => {
    const rendered = renderAssCue(DOC.cues[1], DOC);
    expect(rendered.karaoke).toHaveLength(3);
    expect(rendered.karaoke[0].duration).toBe(300);
    expect(rendered.karaoke[1].start).toBe(300);
    expect(rendered.karaoke[2].duration).toBe(300);
  });

  it('never emits raw override tags as text', () => {
    const rendered = renderAssCue(DOC.cues[0], DOC);
    expect(rendered.element.textContent).not.toContain('\\pos');
  });
});

describe('plain subtitle markup', () => {
  it('escapes scripts but keeps whitelisted tags', () => {
    const html = sanitizeCueHtml('<script>alert(1)</script><b>bold</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<b>bold</b>');
  });

  it('converts line breaks and font colours', () => {
    const html = sanitizeCueHtml('line one\\Nline two <font color="#ff0000">red</font>');
    expect(html).toContain('\n');
    expect(html).toContain('color:#ff0000');
  });

  it('renders a cue element', () => {
    const node = renderPlainCue({ start: 0, end: 1, text: 'Hi <i>there</i>' });
    expect(node.className).toBe('sub-line');
    expect(node.innerHTML).toContain('<i>there</i>');
  });
});
