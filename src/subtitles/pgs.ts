/**
 * PGS (Blu-ray presentation graphic stream) decoder.
 *
 * PGS is a bitmap subtitle format: a stream of segments that describe a
 * palette, one or more bitmaps and where they sit on a 1920×1080 canvas.
 * movi-player decodes these inside FFmpeg/WASM; this is a dependency-free
 * TypeScript implementation so OmniPlay can render them without a 20 MB wasm.
 *
 * Segment layout (13-byte header):
 *   "PG" | PTS (u32, 90 kHz) | DTS (u32) | type (u8) | size (u24) | payload
 *
 * Types: 0x14 PCS (composition), 0x15 WDS (window), 0x16 PDS (palette),
 *        0x17 ODS (object bitmap), 0x80 END.
 */

export const PGS_SEGMENT = {
  PCS: 0x14,
  WDS: 0x15,
  PDS: 0x16,
  ODS: 0x17,
  END: 0x80,
} as const;

export interface PgsCue {
  start: number;
  end: number;
  /** Cropped bitmap for this composition. */
  canvas: HTMLCanvasElement;
  /** Position of the crop on the authored canvas, in authored pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Authored canvas size (usually 1920×1080). */
  screenWidth: number;
  screenHeight: number;
}

interface Palette {
  [index: number]: [number, number, number, number];
}

interface CompositionObject {
  objectId: number;
  x: number;
  y: number;
}

interface Composition {
  width: number;
  height: number;
  objects: CompositionObject[];
}

interface PgsObject {
  width: number;
  height: number;
  pixels: Uint8Array; // palette indices, 0 = transparent
}

interface DisplaySet {
  pts: number;
  composition: Composition | null;
  palettes: Map<number, Palette>;
  objects: Map<number, PgsObject>;
  paletteId: number;
}

/** YCbCr (BT.601) + alpha → RGBA, as stored in PGS palettes. */
function ycbcrToRgba(y: number, cr: number, cb: number, alpha: number): [number, number, number, number] {
  const r = Math.max(0, Math.min(255, Math.round(y + 1.402 * (cr - 128))));
  const g = Math.max(0, Math.min(255, Math.round(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128))));
  const b = Math.max(0, Math.min(255, Math.round(y + 1.772 * (cb - 128))));
  return [r, g, b, alpha];
}

/** Parse a palette definition segment into index → RGBA. */
function parsePalette(payload: Uint8Array): { id: number; palette: Palette } {
  const id = payload[0] ?? 0;
  const palette: Palette = {};
  let offset = 2; // skip palette id + version
  while (offset + 5 <= payload.length) {
    const index = payload[offset];
    const y = payload[offset + 1];
    const cr = payload[offset + 2];
    const cb = payload[offset + 3];
    const alpha = payload[offset + 4];
    palette[index] = ycbcrToRgba(y, cr, cb, alpha);
    offset += 5;
  }
  return { id, palette };
}

/** RLE-decode one object's bitmap into palette indices. */
function decodeObject(payload: Uint8Array): PgsObject | null {
  if (payload.length < 4) return null;
  const width = (payload[0] << 8) | payload[1];
  const height = (payload[2] << 8) | payload[3];
  if (!width || !height) return null;

  const pixels = new Uint8Array(width * height);
  let src = 4;
  for (let y = 0; y < height; y++) {
    let x = 0;
    const row = y * width;
    while (x < width) {
      if (src >= payload.length) return { width, height, pixels };
      const colour = payload[src++];
      if (colour === 0) break; // rest of the line is transparent
      if (src >= payload.length) return { width, height, pixels };
      const runLength = payload[src++];
      const length = runLength === 0 ? 1 : runLength;
      const end = Math.min(width, x + length);
      for (let i = x; i < end; i++) pixels[row + i] = colour;
      x = end;
    }
  }
  return { width, height, pixels };
}

/** Parse the composition segment (canvas size + object placement). */
function parseComposition(payload: Uint8Array): { composition: Composition; paletteId: number } | null {
  if (payload.length < 11) return null;
  const width = (payload[0] << 8) | payload[1];
  const height = (payload[2] << 8) | payload[3];
  const paletteId = payload[9] ?? 0;
  const objectCount = payload[10] ?? 0;
  const objects: CompositionObject[] = [];
  let offset = 11;
  for (let i = 0; i < objectCount; i++) {
    if (offset + 8 > payload.length) break;
    const objectId = (payload[offset] << 8) | payload[offset + 1];
    const x = (payload[offset + 4] << 8) | payload[offset + 5];
    const y = (payload[offset + 6] << 8) | payload[offset + 7];
    objects.push({ objectId, x, y });
    offset += 8;
  }
  return { composition: { width, height, objects }, paletteId };
}

/** Compose one display set into a cropped canvas. */
function compose(displaySet: DisplaySet): Omit<PgsCue, 'start' | 'end'> | null {
  // Bitmap composition needs a canvas; degrade instead of crashing off-DOM.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const composition = displaySet.composition;
  if (!composition || composition.objects.length === 0) return null;
  const palette = displaySet.palettes.get(displaySet.paletteId) ?? displaySet.palettes.values().next().value;
  if (!palette) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const object of composition.objects) {
    const bitmap = displaySet.objects.get(object.objectId);
    if (!bitmap) continue;
    minX = Math.min(minX, object.x);
    minY = Math.min(minY, object.y);
    maxX = Math.max(maxX, object.x + bitmap.width);
    maxY = Math.max(maxY, object.y + bitmap.height);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  const width = Math.min(composition.width - minX, maxX - minX);
  const height = Math.min(composition.height - minY, maxY - minY);
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);

  for (const object of composition.objects) {
    const bitmap = displaySet.objects.get(object.objectId);
    if (!bitmap) continue;
    const originX = object.x - minX;
    const originY = object.y - minY;
    for (let y = 0; y < bitmap.height; y++) {
      const targetY = originY + y;
      if (targetY < 0 || targetY >= height) continue;
      for (let x = 0; x < bitmap.width; x++) {
        const index = bitmap.pixels[y * bitmap.width + x];
        if (!index) continue; // palette index 0 is transparent
        const colour = palette[index];
        if (!colour || colour[3] === 0) continue;
        const targetX = originX + x;
        if (targetX < 0 || targetX >= width) continue;
        const pixel = (targetY * width + targetX) * 4;
        image.data[pixel] = colour[0];
        image.data[pixel + 1] = colour[1];
        image.data[pixel + 2] = colour[2];
        image.data[pixel + 3] = colour[3];
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return {
    canvas,
    x: minX,
    y: minY,
    width,
    height,
    screenWidth: composition.width,
    screenHeight: composition.height,
  };
}

/**
 * Decode a PGS byte stream into timed bitmap cues.
 *
 * @param chunks  Subtitle packets in presentation order. `duration` (when the
 *                container provides it) overrides the "until the next cue" rule.
 */
export function decodePgs(
  chunks: Array<{ data: Uint8Array; start: number; duration?: number }>,
  options: { endTime?: number } = {},
): PgsCue[] {
  const cues: PgsCue[] = [];
  let pending: DisplaySet | null = null;
  let paletteCache = new Map<number, Palette>();
  let objectCache = new Map<number, PgsObject>();

  const flush = (nextStart: number | null, explicitDuration?: number) => {
    if (!pending) return;
    const composed = compose(pending);
    if (composed) {
      const start = pending.pts;
      const end =
        explicitDuration && explicitDuration > 0
          ? start + explicitDuration
          : nextStart !== null && nextStart > start
            ? nextStart
            : start + 5;
      cues.push({ ...composed, start, end });
    }
    pending = null;
  };

  for (const chunk of chunks) {
    const data = chunk.data;
    let offset = 0;
    while (offset + 13 <= data.length) {
      if (data[offset] !== 0x50 || data[offset + 1] !== 0x47) {
        offset++;
        continue;
      }
      const type = data[offset + 10];
      const size = (data[offset + 11] << 16) | (data[offset + 12] << 8) | data[offset + 13];
      const payloadStart = offset + 14;
      const payloadEnd = payloadStart + size;
      if (payloadEnd > data.length) break;
      const payload = data.subarray(payloadStart, payloadEnd);
      offset = payloadEnd;

      if (type === PGS_SEGMENT.PCS) {
        // A new composition ends the previous one.
        flush(chunk.start, chunk.duration);
        const parsed = parseComposition(payload);
        if (parsed) {
          pending = {
            pts: chunk.start,
            composition: parsed.composition,
            palettes: new Map(paletteCache),
            objects: new Map(objectCache),
            paletteId: parsed.paletteId,
          };
        }
      } else if (type === PGS_SEGMENT.PDS) {
        const { id, palette } = parsePalette(payload);
        paletteCache.set(id, palette);
        if (pending) pending.palettes.set(id, palette);
      } else if (type === PGS_SEGMENT.ODS) {
        if (payload.length < 4) continue;
        const objectId = (payload[0] << 8) | payload[1];
        const flags = payload[3];
        if ((flags & 0x80) === 0) continue; // only the first fragment is decoded
        const bitmap = decodeObject(payload.subarray(7));
        if (!bitmap) continue;
        objectCache.set(objectId, bitmap);
        if (pending) pending.objects.set(objectId, bitmap);
      }
      // END marks the end of a display set, not of the picture: the composition
      // stays on screen until the next PCS (or an empty composition).
    }
  }
  flush(options.endTime ?? null);

  // Keep the palette/object caches small across long files.
  paletteCache = new Map();
  objectCache = new Map();
  return cues.filter((cue) => cue.end > cue.start);
}

/** Quick check that a buffer looks like a PGS stream (used for `.sup` files). */
export function looksLikePgs(bytes: Uint8Array): boolean {
  return bytes.length > 14 && bytes[0] === 0x50 && bytes[1] === 0x47 && bytes[10] <= 0x80;
}

/** Split a `.sup` file into per-display-set chunks for decodePgs(). */
export function splitSupFile(bytes: Uint8Array): Array<{ data: Uint8Array; start: number }> {
  const chunks: Array<{ data: Uint8Array; start: number }> = [];
  let offset = 0;
  let currentStart: number | null = null;
  let currentBegin = 0;

  while (offset + 14 <= bytes.length) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x47) {
      offset++;
      continue;
    }
    const pts = ((bytes[offset + 2] << 24) | (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]) / 90000;
    const type = bytes[offset + 10];
    const size = (bytes[offset + 11] << 16) | (bytes[offset + 12] << 8) | bytes[offset + 13];
    const end = offset + 14 + size;
    if (end > bytes.length) break;
    if (type === PGS_SEGMENT.PCS) {
      if (currentStart !== null) chunks.push({ data: bytes.subarray(currentBegin, offset), start: currentStart });
      currentStart = pts;
      currentBegin = offset;
    }
    offset = end;
  }
  if (currentStart !== null) chunks.push({ data: bytes.subarray(currentBegin, bytes.length), start: currentStart });
  return chunks;
}
