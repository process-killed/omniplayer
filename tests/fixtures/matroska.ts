/**
 * Builds tiny but valid Matroska files for tests: EBML header, segment, info,
 * four tracks (video, audio, ASS, PGS) and two clusters with real blocks.
 */

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function idBytes(id: number): Uint8Array {
  const bytes: number[] = [];
  let value = id;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return new Uint8Array(bytes);
}

function sizeBytes(size: number): Uint8Array {
  // Always use the 8-byte form: 0x01 followed by a 56-bit length.
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let value = size;
  for (let i = 7; i >= 1; i--) {
    out[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return out;
}

function element(id: number, payload: Uint8Array): Uint8Array {
  return concat(idBytes(id), sizeBytes(payload.length), payload);
}

function uintElement(id: number, value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value;
  do {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  return element(id, new Uint8Array(bytes));
}

function stringElement(id: number, value: string): Uint8Array {
  return element(id, new TextEncoder().encode(value));
}

export interface TestMkvOptions {
  /** Extra ASS dialogue lines. */
  assLines?: string[];
  /** Raw PGS display sets, in presentation order. */
  pgsSets?: Array<{ time: number; data: Uint8Array }>;
  /** Plain SRT-style subtitle packets. */
  srtLines?: Array<{ time: number; text: string }>;
}

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

function simpleBlock(track: number, relative: number, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array([
    0x80 | track,
    (relative >> 8) & 0xff,
    relative & 0xff,
    0x80, // keyframe, no lacing
  ]);
  return element(0xa3, concat(header, payload));
}

/** Minimal PGS display set: a 4×2 red rectangle at (100, 900). */
export function buildPgsDisplaySet(objectId = 1, colourIndex = 1): Uint8Array {
  const segment = (type: number, pts: number, payload: Uint8Array): Uint8Array => {
    const header = new Uint8Array(14);
    header[0] = 0x50;
    header[1] = 0x47;
    header[2] = (pts >> 24) & 0xff;
    header[3] = (pts >> 16) & 0xff;
    header[4] = (pts >> 8) & 0xff;
    header[5] = pts & 0xff;
    header[10] = type;
    header[11] = (payload.length >> 16) & 0xff;
    header[12] = (payload.length >> 8) & 0xff;
    header[13] = payload.length & 0xff;
    return concat(header, payload);
  };

  // Palette: index 1 = red (Y=81, Cr=90, Cb=240), index 2 = white.
  const pds = new Uint8Array([0, 0, 1, 81, 240, 90, 255, 2, 235, 128, 128, 255]);
  // Object: 4×2, every pixel colour 1.
  const ods = new Uint8Array([0, objectId, 0, 0xc0, 0, 0, 8, 0, 4, 0, 2, colourIndex, 4, colourIndex, 4]);
  // Composition: 1920×1080, one object at (100, 900).
  const pcs = new Uint8Array([
    0x07, 0x80, 0x04, 0x38, 0x10, 0, 0, 0, 0, 0, 1, 0, objectId, 0, 0, 0, 100, 0x03, 0x84,
  ]);
  const end = new Uint8Array(0);

  return concat(segment(0x16, 0, pds), segment(0x17, 0, ods), segment(0x14, 0, pcs), segment(0x80, 0, end));
}

/** A PCS with zero objects — clears the screen. */
export function buildPgsClear(): Uint8Array {
  const payload = new Uint8Array([0x07, 0x80, 0x04, 0x38, 0x10, 0, 1, 0, 0, 1, 0]);
  const header = new Uint8Array(14);
  header[0] = 0x50;
  header[1] = 0x47;
  header[10] = 0x14;
  header[13] = payload.length;
  const endHeader = new Uint8Array(14);
  endHeader[0] = 0x50;
  endHeader[1] = 0x47;
  endHeader[10] = 0x80;
  return concat(header, payload, endHeader);
}

export function buildTestMkv(options: TestMkvOptions = {}): Uint8Array {
  const tracks = element(
    0x1654ae6b,
    concat(
      // 1: video
      element(
        0xae,
        concat(
          uintElement(0xd7, 1),
          uintElement(0x83, 1),
          stringElement(0x86, 'V_MPEG4/ISO/AVC'),
          stringElement(0x22b59c, 'und'),
          uintElement(0x88, 1),
        ),
      ),
      // 2: audio
      element(
        0xae,
        concat(
          uintElement(0xd7, 2),
          uintElement(0x83, 2),
          stringElement(0x86, 'A_AAC'),
          stringElement(0x22b59c, 'eng'),
          stringElement(0x536e, 'English 2.0'),
        ),
      ),
      // 3: ASS subtitles
      element(
        0xae,
        concat(
          uintElement(0xd7, 3),
          uintElement(0x83, 17),
          stringElement(0x86, 'S_TEXT/ASS'),
          stringElement(0x22b59c, 'eng'),
          stringElement(0x536e, 'English [ASS]'),
          uintElement(0x88, 1),
          element(0x63a2, new TextEncoder().encode(ASS_HEADER)),
        ),
      ),
      // 4: PGS subtitles
      element(
        0xae,
        concat(
          uintElement(0xd7, 4),
          uintElement(0x83, 17),
          stringElement(0x86, 'S_HDMV/PGS'),
          stringElement(0x22b59c, 'jpn'),
          stringElement(0x536e, 'Japanese [PGS]'),
          uintElement(0x55aa, 1),
        ),
      ),
      // 5: SRT subtitles
      element(
        0xae,
        concat(
          uintElement(0xd7, 5),
          uintElement(0x83, 17),
          stringElement(0x86, 'S_TEXT/UTF8'),
          stringElement(0x22b59c, 'hin'),
          stringElement(0x536e, 'Hindi'),
        ),
      ),
    ),
  );

  const info = element(0x1549a966, concat(uintElement(0x2ad7b1, 1_000_000), uintElement(0x4489, 0)));

  const assLines = options.assLines ?? ['0,0,Default,,0,0,0,,Hello from ASS', '0,0,Default,,0,0,0,,Second line'];
  const srtLines = options.srtLines ?? [{ time: 0, text: 'Hindi line' }];
  const pgsSets = options.pgsSets ?? [
    { time: 0, data: buildPgsDisplaySet() },
    { time: 2, data: buildPgsClear() },
  ];

  const cluster1Blocks = [
    simpleBlock(3, 0, new TextEncoder().encode(assLines[0])),
    simpleBlock(5, 0, new TextEncoder().encode(srtLines[0].text)),
    simpleBlock(4, 0, pgsSets[0].data),
  ];
  const cluster2Blocks = [
    simpleBlock(3, 0, new TextEncoder().encode(assLines[1] ?? 'Second line')),
    ...(pgsSets[1] ? [simpleBlock(4, 2000, pgsSets[1].data)] : []),
  ];

  const cluster1 = element(0x1f43b675, concat(uintElement(0xe7, 0), ...cluster1Blocks));
  const cluster2 = element(0x1f43b675, concat(uintElement(0xe7, 1500), ...cluster2Blocks));

  const ebmlHeader = element(
    0x1a45dfa3,
    concat(uintElement(0x4286, 1), uintElement(0x42f7, 1), uintElement(0x42f2, 4), uintElement(0x42f3, 8), stringElement(0x4282, 'matroska'), uintElement(0x4287, 4), uintElement(0x4285, 2)),
  );

  const segment = element(0x18538067, concat(info, tracks, cluster1, cluster2));
  return concat(ebmlHeader, segment);
}
