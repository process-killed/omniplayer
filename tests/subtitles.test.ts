// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  assAlpha,
  assColorToHex,
  cueAt,
  decodeSubtitleBuffer,
  detectSubtitleFormat,
  parseAss,
  parseSrt,
  parseSubtitle,
  parseTtml,
  parseVtt,
} from '../src/subtitles/parser';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello <i>world</i>

2
00:00:04,000 --> 00:00:06,000
Second line
continues here
`;

const VTT = `WEBVTT

NOTE this is a comment

intro
00:00:00.500 --> 00:00:02.000
<v Speaker>Welcome back</v>

00:02.000 --> 00:04.500 align:center
Second cue
`;

const ASS = `[Script Info]
Title: Test
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,20,20,40,1
Style: Sign,Comic Sans MS,48,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\pos(960,900)}Hello {\\i1}anime{\\i0} world
Dialogue: 1,0:00:05.00,0:00:07.50,Sign,,0,0,0,,{\\fad(200,200)}Sign text
Dialogue: 0,0:00:08.00,0:00:10.00,Default,,0,0,0,,{\\k30}ka{\\k40}ra{\\k30}oke
`;

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><div>
    <p begin="00:00:01.000" end="00:00:03.000">First <span>styled</span> line<br/>next</p>
    <p begin="4s" dur="2s">Second</p>
  </div></body>
</tt>`;

describe('SRT parsing', () => {
  it('reads cues with millisecond timestamps', () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(1);
    expect(cues[0].end).toBeCloseTo(3.5);
    expect(cues[0].text).toContain('<i>world</i>');
    expect(cues[1].text).toContain('continues here');
  });

  it('handles CRLF and missing index numbers', () => {
    const cues = parseSrt('00:00:01,000 --> 00:00:02,000\r\nHi\r\n');
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Hi');
  });

  it('drops malformed blocks instead of throwing', () => {
    expect(parseSrt('not a subtitle at all')).toHaveLength(0);
  });
});

describe('WebVTT parsing', () => {
  it('skips headers, notes and cue identifiers', () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toContain('Welcome back');
    expect(cues[0].start).toBeCloseTo(0.5);
    expect(cues[1].start).toBeCloseTo(2);
    expect(cues[1].end).toBeCloseTo(4.5);
  });
});

describe('ASS parsing', () => {
  it('reads script info, styles and dialogue', () => {
    const doc = parseAss(ASS);
    expect(doc.playResX).toBe(1920);
    expect(doc.playResY).toBe(1080);
    expect(doc.cues).toHaveLength(3);
    expect(doc.styles.Default.fontSize).toBe(64);
    expect(doc.styles.Default.alignment).toBe(2);
    expect(doc.styles.Sign.bold).toBe(true);
    expect(doc.cues[0].text).toContain('\\pos(960,900)');
    expect(doc.cues[2].text).toContain('\\k30');
  });

  it('converts ASS colours to CSS hex', () => {
    expect(assColorToHex('&H00FFFFFF')).toBe('#ffffff');
    expect(assColorToHex('&H0000FFFF')).toBe('#ffff00');
    expect(assColorToHex('&HFF0000FF')).toBe('#ff0000');
  });

  it('converts ASS alpha to opacity', () => {
    expect(assAlpha('&H00&')).toBeCloseTo(1);
    expect(assAlpha('&H80&')).toBeCloseTo(0.5, 1);
  });

  it('warns when a file has no dialogue', () => {
    const doc = parseAss('[Script Info]\nTitle: empty\n');
    expect(doc.cues).toHaveLength(0);
    expect(doc.warnings.length).toBeGreaterThan(0);
  });
});

describe('TTML parsing', () => {
  it('reads clock and offset timings', () => {
    const cues = parseTtml(TTML);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(1);
    expect(cues[0].text).toContain('First');
    expect(cues[0].text).toContain('\n');
    expect(cues[1].start).toBeCloseTo(4);
    expect(cues[1].end).toBeCloseTo(6);
  });
});

describe('format detection', () => {
  it('detects each supported format', () => {
    expect(detectSubtitleFormat(SRT)).toBe('srt');
    expect(detectSubtitleFormat(VTT)).toBe('vtt');
    expect(detectSubtitleFormat(ASS)).toBe('ass');
    expect(detectSubtitleFormat(TTML)).toBe('ttml');
  });

  it('falls back gracefully for unknown text', () => {
    const doc = parseSubtitle('random text with no cues');
    expect(doc.cues).toHaveLength(0);
    expect(doc.warnings.length).toBeGreaterThan(0);
  });
});

describe('decoding', () => {
  it('honours UTF-16 BOMs', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nनमस्ते\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[2 + i * 2] = code & 0xff;
      bytes[3 + i * 2] = code >> 8;
    }
    const decoded = decodeSubtitleBuffer(bytes.buffer);
    expect(decoded).toContain('नमस्ते');
  });
});

describe('cue lookup', () => {
  it('returns cues active at a time', () => {
    const cues = parseSrt(SRT);
    expect(cueAt(cues, 2)).toHaveLength(1);
    expect(cueAt(cues, 3.6)).toHaveLength(0);
    expect(cueAt(cues, 5)).toHaveLength(1);
  });
});
