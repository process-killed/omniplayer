import { beforeEach, describe, expect, it } from 'vitest';
import { decodePgs, looksLikePgs, splitSupFile } from '../src/subtitles/pgs';
import { buildPgsDisplaySet } from './fixtures/matroska';

/** Minimal canvas shim so the compositor can be tested without a browser. */
interface FakeImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const created: Array<{ width: number; height: number; image: FakeImageData | null }> = [];

beforeEach(() => {
  created.length = 0;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const record = { width: 0, height: 0, image: null as FakeImageData | null };
      created.push(record);
      const canvas = {
        get width() {
          return record.width;
        },
        set width(value: number) {
          record.width = value;
        },
        get height() {
          return record.height;
        },
        set height(value: number) {
          record.height = value;
        },
        getContext: () => ({
          createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: (image: FakeImageData) => {
            record.image = image;
          },
        }),
      };
      return canvas;
    },
  };
});

describe('PGS decoder', () => {
  it('decodes a display set into a bitmap with palette colours', () => {
    const set = buildPgsDisplaySet();
    const cues = decodePgs([{ data: set, start: 3 }]);
    expect(cues).toHaveLength(1);
    const cue = cues[0];
    expect(cue.start).toBe(3);
    expect(cue.width).toBe(4);
    expect(cue.height).toBe(2);
    expect(cue.x).toBe(100);
    expect(cue.y).toBe(900);
    expect(cue.screenWidth).toBe(1920);
    expect(cue.screenHeight).toBe(1080);

    const image = created.find((record) => record.width === 4 && record.height === 2)?.image;
    expect(image).toBeTruthy();
    // Palette entry 1 is red-ish and fully opaque.
    expect(image!.data[3]).toBe(255);
    expect(image!.data[0]).toBeGreaterThan(200);
    expect(image!.data[1]).toBeLessThan(80);
    expect(image!.data[2]).toBeLessThan(80);
    // Every pixel of the 4×2 object is painted.
    for (let i = 3; i < image!.data.length; i += 4) expect(image!.data[i]).toBe(255);
  });

  it('ends a cue when the next composition arrives', () => {
    const cues = decodePgs([
      { data: buildPgsDisplaySet(), start: 1 },
      { data: buildPgsDisplaySet(), start: 4 },
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(4);
    expect(cues[1].start).toBe(4);
  });

  it('splits .sup files into display sets', () => {
    const bytes = new Uint8Array([...buildPgsDisplaySet(), ...buildPgsDisplaySet()]);
    expect(looksLikePgs(bytes)).toBe(true);
    expect(splitSupFile(bytes)).toHaveLength(2);
  });
});
