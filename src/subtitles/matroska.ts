/**
 * Matroska (MKV/WebM) subtitle extraction.
 *
 * mediabunny exposes video and audio tracks but not Matroska subtitle streams,
 * which is where most anime and movie releases keep their ASS or PGS subtitles.
 * This module reads the EBML container directly:
 *
 *   • lists subtitle tracks (codec, language, name, default/forced flags)
 *   • extracts text tracks (ASS/SSA/SRT/WebVTT) and image tracks (PGS)
 *
 * It streams the file in windows, so a 4 GB MKV never lands in memory at once.
 */

import type { Cue } from '../types';
import { decodePgs, type PgsCue } from './pgs';

export interface MkvSubtitleTrack {
  number: number;
  codecId: string;
  format: 'ass' | 'ssa' | 'srt' | 'vtt' | 'pgs' | 'unknown';
  language?: string;
  name?: string;
  isDefault: boolean;
  isForced: boolean;
  codecPrivate?: Uint8Array;
}

export interface MkvSource {
  /** Total bytes, or Infinity when unknown (streamed URL). */
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type ExtractedSubtitles =
  | { kind: 'text'; format: 'ass' | 'ssa' | 'srt' | 'vtt'; text: string }
  | { kind: 'pgs'; cues: PgsCue[] };

/* ------------------------------------------------------------------ EBML ids */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  Name: 0x536e,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  Cues: 0x1c53bb6b,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Attachments: 0x1941a469,
  SeekHead: 0x114d9b74,
  Void: 0xec,
  CRC32: 0xbf,
} as const;

/** Top-level elements that end a cluster with unknown size. */
const TOP_LEVEL = new Set<number>([
  ID.Cluster,
  ID.Cues,
  ID.Chapters,
  ID.Tags,
  ID.Attachments,
  ID.Tracks,
  ID.Info,
  ID.SeekHead,
]);

/* ------------------------------------------------------------- byte access */

class ByteReader {
  private buffer = new Uint8Array(0);
  private start = 0;
  private pos = 0;
  private eof = false;

  constructor(
    private readonly source: MkvSource,
    private readonly chunkSize = 2 * 1024 * 1024,
  ) {}

  get offset(): number {
    return this.pos;
  }

  get exhausted(): boolean {
    return this.eof && this.pos >= this.start + this.buffer.length;
  }

  private async fill(target: number): Promise<void> {
    if (this.pos < this.start || this.pos > this.start + this.buffer.length) {
      this.buffer = new Uint8Array(0);
      this.start = this.pos;
    }

    let available = this.start + this.buffer.length - this.pos;
    while (available < target && !this.eof) {
      // Always continue from the end of the buffered window, never from `pos`,
      // otherwise a partial read would be appended twice.
      const from = this.start + this.buffer.length;
      const remaining = Number.isFinite(this.source.size) ? this.source.size - from : Number.POSITIVE_INFINITY;
      if (remaining <= 0) {
        this.eof = true;
        break;
      }
      const want = Math.max(1, Math.min(this.chunkSize, remaining, target - available + this.chunkSize));
      const data = await this.source.read(from, want);
      if (data.length === 0) {
        this.eof = true;
        break;
      }
      const keep = this.buffer.subarray(this.pos - this.start);
      const merged = new Uint8Array(keep.length + data.length);
      merged.set(keep, 0);
      merged.set(data, keep.length);
      this.buffer = merged;
      this.start = this.pos;
      available = this.start + this.buffer.length - this.pos;
      if (Number.isFinite(this.source.size) && from + data.length >= this.source.size) this.eof = true;
    }
  }

  async read(length: number): Promise<Uint8Array | null> {
    if (length === 0) return new Uint8Array(0);
    await this.fill(length);
    const available = this.start + this.buffer.length - this.pos;
    if (available < length) return null;
    const offset = this.pos - this.start;
    const out = this.buffer.subarray(offset, offset + length);
    this.pos += length;
    return out;
  }

  skip(length: number): void {
    this.pos += length;
  }

  async skipChecked(length: number): Promise<void> {
    const available = this.start + this.buffer.length - this.pos;
    if (length <= available) {
      this.pos += length;
      return;
    }
    this.pos += length;
    this.buffer = new Uint8Array(0);
    this.start = this.pos;
  }
}

interface ElementHeader {
  id: number;
  size: number | null;
  headerSize: number;
}

async function readHeader(reader: ByteReader): Promise<ElementHeader | null> {
  const first = await reader.read(1);
  if (!first) return null;
  let idLength = 1;
  let mask = 0x80;
  while (idLength <= 8 && (first[0] & mask) === 0) {
    mask >>= 1;
    idLength++;
  }
  if (idLength > 8) return null;

  const idBytes = new Uint8Array(idLength);
  idBytes[0] = first[0];
  if (idLength > 1) {
    const rest = await reader.read(idLength - 1);
    if (!rest) return null;
    idBytes.set(rest, 1);
  }
  let id = 0;
  for (const byte of idBytes) id = id * 256 + byte;

  const sizeFirst = await reader.read(1);
  if (!sizeFirst) return null;
  let sizeLength = 1;
  let sizeMask = 0x80;
  while (sizeLength <= 8 && (sizeFirst[0] & sizeMask) === 0) {
    sizeMask >>= 1;
    sizeLength++;
  }
  if (sizeLength > 8) return null;

  let value = sizeFirst[0] & (sizeMask - 1);
  let allOnes = value === sizeMask - 1;
  if (sizeLength > 1) {
    const rest = await reader.read(sizeLength - 1);
    if (!rest) return null;
    for (const byte of rest) {
      value = value * 256 + byte;
      if (byte !== 0xff) allOnes = false;
    }
  }

  return { id, size: allOnes ? null : value, headerSize: idLength + sizeLength };
}

async function readUint(reader: ByteReader, size: number): Promise<number> {
  const bytes = await reader.read(size);
  if (!bytes) return 0;
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

async function readString(reader: ByteReader, size: number): Promise<string> {
  const bytes = await reader.read(size);
  if (!bytes) return '';
  return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '');
}

function formatForCodec(codecId: string): MkvSubtitleTrack['format'] {
  const id = codecId.toUpperCase();
  if (id === 'S_TEXT/ASS' || id === 'S_ASS') return 'ass';
  if (id === 'S_TEXT/SSA' || id === 'S_SSA') return 'ssa';
  if (id === 'S_TEXT/UTF8' || id === 'S_TEXT/ASCII') return 'srt';
  if (id === 'S_TEXT/WEBVTT') return 'vtt';
  if (id === 'S_HDMV/PGS') return 'pgs';
  return 'unknown';
}

/* ------------------------------------------------------------ track listing */

/**
 * Read just the header and the Tracks element. Stops as soon as tracks are
 * known, so this is fast even for huge files.
 */
export async function scanMatroskaTracks(source: MkvSource): Promise<MkvSubtitleTrack[]> {
  const reader = new ByteReader(source);
  const tracks: MkvSubtitleTrack[] = [];

  // EBML header
  const ebml = await readHeader(reader);
  if (!ebml || ebml.id !== ID.EBML) return tracks;
  if (ebml.size !== null) await reader.skipChecked(ebml.size);

  let segment = await readHeader(reader);
  while (segment && segment.id !== ID.Segment) {
    if (segment.size === null) break;
    await reader.skipChecked(segment.size);
    segment = await readHeader(reader);
  }
  if (!segment) return tracks;

  for (let guard = 0; guard < 64; guard++) {
    const header = await readHeader(reader);
    if (!header) break;
    if (header.id === ID.Tracks) {
      const end = header.size === null ? Number.POSITIVE_INFINITY : reader.offset + header.size;
      while (reader.offset < end) {
        const entry = await readHeader(reader);
        if (!entry) break;
        if (entry.id === ID.TrackEntry) {
          const trackEnd = entry.size === null ? Number.POSITIVE_INFINITY : reader.offset + entry.size;
          const track = await parseTrackEntry(reader, trackEnd);
          if (track) tracks.push(track);
          if (entry.size !== null) await reader.skipChecked(Math.max(0, trackEnd - reader.offset));
        } else if (entry.size !== null) {
          await reader.skipChecked(entry.size);
        } else {
          break;
        }
      }
      break;
    }
    if (header.size === null) break;
    await reader.skipChecked(header.size);
  }
  return tracks;
}

async function parseTrackEntry(reader: ByteReader, end: number): Promise<MkvSubtitleTrack | null> {
  let number = 0;
  let type = 0;
  let codecId = '';
  let language: string | undefined;
  let name: string | undefined;
  let isDefault = false;
  let isForced = false;
  let codecPrivate: Uint8Array | undefined;

  while (reader.offset < end) {
    const header = await readHeader(reader);
    if (!header) break;
    const size = header.size ?? 0;
    if (header.id === ID.TrackNumber) number = await readUint(reader, size);
    else if (header.id === ID.TrackType) type = await readUint(reader, size);
    else if (header.id === ID.CodecID) codecId = await readString(reader, size);
    else if (header.id === ID.Language || header.id === ID.LanguageBCP47) language = (await readString(reader, size)) || language;
    else if (header.id === ID.Name) name = (await readString(reader, size)) || undefined;
    else if (header.id === ID.FlagDefault) isDefault = (await readUint(reader, size)) === 1;
    else if (header.id === ID.FlagForced) isForced = (await readUint(reader, size)) === 1;
    else if (header.id === ID.CodecPrivate) {
      const bytes = await reader.read(size);
      if (bytes) codecPrivate = new Uint8Array(bytes);
    } else await reader.skipChecked(size);
    if (header.size === null) break;
  }

  if (type !== 17 || !codecId) return null;
  const format = formatForCodec(codecId);
  if (format === 'unknown' && !codecId.startsWith('S_')) return null;
  return {
    number,
    codecId,
    format,
    language: language === 'und' ? undefined : language,
    name,
    isDefault,
    isForced,
    codecPrivate,
  };
}

/* --------------------------------------------------------------- extraction */

interface RawPacket {
  data: Uint8Array;
  start: number;
  duration?: number;
}

/** Decode the block lacing structure into frames. */
function splitLacing(payload: Uint8Array, offset: number, flags: number): Uint8Array[] {
  const lacing = (flags >> 1) & 0x03;
  if (lacing === 0) return [payload.subarray(offset)];

  if (offset >= payload.length) return [];
  const frameCount = payload[offset] + 1;
  offset += 1;
  const frames: Uint8Array[] = [];

  if (lacing === 2) {
    // Fixed-size lacing: equal parts.
    const total = payload.length - offset;
    const each = Math.floor(total / frameCount);
    for (let i = 0; i < frameCount; i++) {
      const begin = offset + i * each;
      frames.push(payload.subarray(begin, i === frameCount - 1 ? payload.length : begin + each));
    }
    return frames;
  }

  const sizes: number[] = [];
  if (lacing === 1) {
    // Xiph lacing: bytes of 255 accumulate.
    for (let i = 0; i < frameCount - 1; i++) {
      let size = 0;
      let byte = 255;
      while (byte === 255 && offset < payload.length) {
        byte = payload[offset++];
        size += byte;
      }
      sizes.push(size);
    }
  } else {
    // EBML lacing: first size is a vint, then signed deltas.
    const readVint = (): number => {
      if (offset >= payload.length) return 0;
      const first = payload[offset++];
      let length = 1;
      let mask = 0x80;
      while (length <= 8 && (first & mask) === 0) {
        mask >>= 1;
        length++;
      }
      let value = first & (mask - 1);
      for (let i = 1; i < length; i++) value = value * 256 + payload[offset++];
      return value;
    };
    let previous = readVint();
    sizes.push(previous);
    for (let i = 1; i < frameCount - 1; i++) {
      const raw = readVint();
      const bias = Math.pow(2, 7 * (1 + Math.floor(Math.log2(raw || 1)))) - 1;
      const delta = raw - bias;
      previous += delta;
      sizes.push(previous);
    }
  }

  let position = offset;
  for (const size of sizes) {
    frames.push(payload.subarray(position, position + size));
    position += size;
  }
  frames.push(payload.subarray(position));
  return frames;
}

function readVintAt(payload: Uint8Array, offset: number): { value: number; length: number } {
  const first = payload[offset];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) value = value * 256 + payload[offset + i];
  return { value, length };
}

/** Extract every subtitle packet for one track, streaming through the file. */
export async function extractMatroskaSubtitles(
  source: MkvSource,
  track: MkvSubtitleTrack,
  onProgress?: (fraction: number) => void,
): Promise<ExtractedSubtitles> {
  const reader = new ByteReader(source);
  const packets: RawPacket[] = [];
  let timestampScale = 1_000_000; // nanoseconds per tick

  const ebml = await readHeader(reader);
  if (!ebml || ebml.id !== ID.EBML) throw new Error('Not a Matroska file');
  if (ebml.size !== null) await reader.skipChecked(ebml.size);

  let segment = await readHeader(reader);
  while (segment && segment.id !== ID.Segment) {
    if (segment.size === null) break;
    await reader.skipChecked(segment.size);
    segment = await readHeader(reader);
  }
  if (!segment) throw new Error('Missing Matroska segment');

  const report = () => {
    if (!onProgress || !Number.isFinite(source.size) || source.size <= 0) return;
    onProgress(Math.min(1, reader.offset / source.size));
  };

  let guard = 0;
  while (guard++ < 2_000_000) {
    const header = await readHeader(reader);
    if (!header) break;

    if (header.id === ID.Info && header.size !== null) {
      const end = reader.offset + header.size;
      while (reader.offset < end) {
        const child = await readHeader(reader);
        if (!child) break;
        if (child.id === ID.TimestampScale) timestampScale = await readUint(reader, child.size ?? 0);
        else if (child.size !== null) await reader.skipChecked(child.size);
        else break;
      }
      continue;
    }

    if (header.id === ID.Cluster) {
      const clusterEnd = header.size === null ? Number.POSITIVE_INFINITY : reader.offset + header.size;
      let clusterTime = 0;

      while (reader.offset < clusterEnd) {
        const child = await readHeader(reader);
        if (!child) break;
        if (child.size === null && TOP_LEVEL.has(child.id)) break;

        if (child.id === ID.Timestamp) {
          clusterTime = await readUint(reader, child.size ?? 0);
          continue;
        }
        if (child.id === ID.SimpleBlock && child.size !== null) {
          const payload = await reader.read(child.size);
          if (payload) collectBlock(payload, clusterTime, undefined);
          continue;
        }
        if (child.id === ID.BlockGroup && child.size !== null) {
          const groupEnd = reader.offset + child.size;
          let duration: number | undefined;
          let blockPayload: Uint8Array | null = null;
          while (reader.offset < groupEnd) {
            const inner = await readHeader(reader);
            if (!inner) break;
            if (inner.id === ID.Block && inner.size !== null) blockPayload = await reader.read(inner.size);
            else if (inner.id === ID.BlockDuration) duration = await readUint(reader, inner.size ?? 0);
            else if (inner.size !== null) await reader.skipChecked(inner.size);
            else break;
          }
          if (blockPayload) collectBlock(blockPayload, clusterTime, duration);
          continue;
        }
        if (child.size !== null) await reader.skipChecked(child.size);
        else break;
      }
      report();
      continue;
    }

    if (header.id === ID.Cues || header.id === ID.Tags || header.id === ID.Attachments || header.id === ID.Chapters) {
      if (header.size === null) break;
      await reader.skipChecked(header.size);
      continue;
    }
    if (header.size === null) break;
    await reader.skipChecked(header.size);
  }
  report();

  function collectBlock(payload: Uint8Array, clusterTime: number, blockDuration?: number): void {
    const trackNumber = readVintAt(payload, 0);
    if (trackNumber.value !== track.number) return;
    const offset = trackNumber.length;
    if (payload.length < offset + 3) return;
    const relative = (payload[offset] << 8) | payload[offset + 1];
    const signedRelative = relative & 0x8000 ? relative - 0x10000 : relative;
    const flags = payload[offset + 2];
    // Bit 0x80 marks a keyframe. Subtitle blocks are always keyframes; skip
    // anything else rather than risk emitting a partial cue.
    if ((flags & 0x80) === 0) return;
    const frames = splitLacing(payload, offset + 3, flags);
    const start = ((clusterTime + signedRelative) * timestampScale) / 1e9;
    for (const frame of frames) {
      if (frame.length === 0) continue;
      packets.push({
        data: new Uint8Array(frame),
        start,
        duration: blockDuration ? (blockDuration * timestampScale) / 1e9 : undefined,
      });
    }
  }

  if (track.format === 'pgs') {
    return { kind: 'pgs', cues: decodePgs(packets) };
  }

  return { kind: 'text', format: track.format === 'unknown' ? 'srt' : track.format, text: buildText(track, packets) };
}

/* ------------------------------------------------------------- text assembly */

function formatAssTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.round((total - Math.floor(total)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function buildText(track: MkvSubtitleTrack, packets: RawPacket[]): string {
  const decoder = new TextDecoder('utf-8');

  if (track.format === 'ass' || track.format === 'ssa') {
    let header = track.codecPrivate ? decoder.decode(track.codecPrivate) : '';
    header = header.replace(/\0+$/, '').trim();
    if (!/\[Events\]/i.test(header)) {
      header += `${header ? '\n\n' : ''}[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
    }
    const lines: string[] = [];
    for (let i = 0; i < packets.length; i++) {
      const packet = packets[i];
      const text = decoder.decode(packet.data).replace(/\0+$/, '');
      // MKV stores: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const parts = text.split(',');
      if (parts.length < 9) continue;
      const layer = parts[1] || '0';
      const style = parts[2] || 'Default';
      const name = parts[3] || '';
      const marginL = parts[4] || '0';
      const marginR = parts[5] || '0';
      const marginV = parts[6] || '0';
      const effect = parts[7] || '';
      const body = parts.slice(8).join(',');
      const end = packet.duration
        ? packet.start + packet.duration
        : (packets[i + 1]?.start ?? packet.start + 4);
      lines.push(
        `Dialogue: ${layer},${formatAssTime(packet.start)},${formatAssTime(end)},${style},${name},${marginL},${marginR},${marginV},${effect},${body}`,
      );
    }
    return `${header}\n${lines.join('\n')}\n`;
  }

  const blocks: string[] = [];
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    const text = decoder.decode(packet.data).replace(/\0+$/, '').trim();
    if (!text) continue;
    const end = packet.duration ? packet.start + packet.duration : (packets[i + 1]?.start ?? packet.start + 4);
    blocks.push(`${blocks.length + 1}\n${srtTime(packet.start)} --> ${srtTime(end)}\n${text}\n`);
  }
  return blocks.join('\n');
}

function srtTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/* ------------------------------------------------------------------- helpers */

/** Build a source backed by a File or Blob. */
export function blobSource(blob: Blob): MkvSource {
  return {
    size: blob.size,
    async read(offset, length) {
      const slice = blob.slice(offset, offset + length);
      return new Uint8Array(await slice.arrayBuffer());
    },
  };
}

/** Build a source backed by a URL (requires CORS, like any byte access). */
export function urlSource(url: string, headers?: Record<string, string>, size = Number.POSITIVE_INFINITY): MkvSource {
  return {
    size,
    async read(offset, length) {
      const end = offset + length - 1;
      const response = await fetch(url, {
        headers: { ...(headers ?? {}), Range: `bytes=${offset}-${end}` },
        credentials: 'omit',
      });
      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** Quick check for a Matroska header (used to avoid pointless parsing). */
export function looksLikeMatroska(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/** Convert decoded text subtitles into cues without re-parsing the string. */
export function cuesFromPackets(packets: RawPacket[]): Cue[] {
  const decoder = new TextDecoder('utf-8');
  return packets.map((packet, index) => ({
    start: packet.start,
    end: packet.duration ? packet.start + packet.duration : (packets[index + 1]?.start ?? packet.start + 4),
    text: decoder.decode(packet.data).replace(/\0+$/, ''),
  }));
}
