import { describe, expect, it } from 'vitest';
import { parseDanmaku, randomDanmakuColor, DEFAULT_DANMAKU_SETTINGS } from '../src/danmaku/engine';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<i>
  <d p="12.5,1,25,16777215,1700000000,0,abc,1">First comment</d>
  <d p="3.2,5,25,16711680,1700000000,0,def,2">Top &amp; centre</d>
  <d p="20,4,18,65280,1700000000,0,ghi,3">Bottom one</d>
  <d p="bad,1,25,0,0,0,x,4">invalid time</d>
  <d p="7,1,25,0,0,0,x,5"></d>
</i>`;

const JSON_INPUT = JSON.stringify([
  { time: 5, text: 'json one', color: '#ff0000', mode: 'scroll' },
  { time: 1, text: 'json two', color: '#00ff00', mode: 'top', size: 30 },
  { time: -1, text: 'dropped', color: '#fff' },
  { text: 'no time', color: '#fff' },
]);

describe('danmaku parsing', () => {
  it('reads Bilibili XML and sorts by time', () => {
    const items = parseDanmaku(XML);
    expect(items.map((item) => item.text)).toEqual(['Top & centre', 'First comment', 'Bottom one']);
    expect(items[0].mode).toBe('top');
    expect(items[1].mode).toBe('scroll');
    expect(items[2].mode).toBe('bottom');
    // 16777215 = white, 16711680 = red, 65280 = green
    expect(items[1].color).toBe('#ffffff');
    expect(items[0].color).toBe('#ff0000');
    expect(items[2].color).toBe('#00ff00');
    expect(items[2].size).toBe(18);
  });

  it('reads ArtPlayer-style JSON and drops invalid entries', () => {
    const items = parseDanmaku(JSON_INPUT);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ time: 1, text: 'json two', mode: 'top', size: 30 });
    expect(items[1]).toMatchObject({ time: 5, text: 'json one', color: '#ff0000' });
  });

  it('returns nothing for junk', () => {
    expect(parseDanmaku('')).toEqual([]);
    expect(parseDanmaku('not xml or json')).toEqual([]);
    expect(parseDanmaku('{bad json')).toEqual([]);
  });

  it('caps very long comments', () => {
    const long = `<d p="1,1,25,0,0,0,x,1">${'a'.repeat(500)}</d>`;
    expect(parseDanmaku(long)[0].text.length).toBe(200);
  });

  it('has sane defaults and a palette', () => {
    expect(DEFAULT_DANMAKU_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_DANMAKU_SETTINGS.opacity).toBeGreaterThan(0.5);
    expect(randomDanmakuColor()).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
