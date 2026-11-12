/**
 * Builds a playable MKV that also carries an ASS and a PGS subtitle track.
 *
 * 1. Chrome + mediabunny encode a real VP8 video + Opus audio into an MKV.
 * 2. Node rewrites the Tracks element to append two subtitle tracks and appends
 *    clusters containing their packets.
 *
 * This is the fixture used by the embedded-subtitle end-to-end test.
 */
import { createServer } from 'node:http';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'smoke-tmp', 'embedded-subs.mkv');
const MB = join(ROOT, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs');

/* ------------------------------------------------------- 1. base video file */

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/mediabunny.mjs')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(await readFile(MB));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><canvas id="c" width="640" height="360"></canvas>');
});
await new Promise((r) => server.listen(4352, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));
await page.goto('http://127.0.0.1:4352/');

const base64 = await page.evaluate(async () => {
  const mb = await import('/mediabunny.mjs');
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const output = new mb.Output({ format: new mb.MkvOutputFormat(), target: new mb.BufferTarget() });
  const video = new mb.CanvasSource(canvas, { codec: 'vp8', bitrate: 900_000 });
  const audio = new mb.AudioBufferSource({ codec: 'opus', bitrate: 64_000 });
  output.addVideoTrack(video, { frameRate: 25 });
  output.addAudioTrack(audio, { languageCode: 'eng', name: 'English' });
  await output.start();

  const seconds = 10;
  const fps = 25;
  const rate = 48000;
  const audioCtx = new OfflineAudioContext(1, rate, rate);
  const buffer = audioCtx.createBuffer(1, rate, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < rate; i++) data[i] = Math.sin((2 * Math.PI * 300 * i) / rate) * 0.2;

  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const g = ctx.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, `hsl(${(210 + t * 8) % 360} 55% 20%)`);
    g.addColorStop(1, `hsl(${(290 + t * 8) % 360} 60% 36%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '700 40px sans-serif';
    ctx.fillText('Embedded subtitle test', 36, 150);
    ctx.font = '600 26px monospace';
    ctx.fillText(`t=${t.toFixed(1)}s`, 36, 200);
    await video.add(t, 1 / fps);
  }
  for (let i = 0; i < seconds; i++) await audio.add(buffer);

  video.close();
  audio.close();
  await output.finalize();

  const bytes = new Uint8Array(output.target.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
});

await browser.close();
server.close();

/* ------------------------------------------------------ 2. rewrite the file */

const base = Buffer.from(base64, 'base64');
if (process.env.KEEP_BASE) {
  await mkdir(join(ROOT, 'smoke-tmp'), { recursive: true });
  await writeFile(join(ROOT, 'smoke-tmp', 'base-only.mkv'), base);
  console.log('kept base-only.mkv');
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
const idBytes = (id) => {
  const bytes = [];
  let value = id;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return new Uint8Array(bytes);
};
const sizeBytes = (size) => {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let value = size;
  for (let i = 7; i >= 1; i--) {
    out[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return out;
};
const element = (id, payload) => concat(idBytes(id), sizeBytes(payload.length), payload);
const uintElement = (id, value) => {
  const bytes = [];
  let rest = value;
  do {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  return element(id, new Uint8Array(bytes));
};
const stringElement = (id, value) => element(id, new TextEncoder().encode(value));

function readHeader(bytes, offset) {
  const first = bytes[offset];
  let idLength = 1;
  let mask = 0x80;
  while (idLength <= 8 && (first & mask) === 0) {
    mask >>= 1;
    idLength++;
  }
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[offset + i];

  const sizeFirst = bytes[offset + idLength];
  let sizeLength = 1;
  let sizeMask = 0x80;
  while (sizeLength <= 8 && (sizeFirst & sizeMask) === 0) {
    sizeMask >>= 1;
    sizeLength++;
  }
  let size = sizeFirst & (sizeMask - 1);
  let allOnes = size === sizeMask - 1;
  for (let i = 1; i < sizeLength; i++) {
    const byte = bytes[offset + idLength + i];
    size = size * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  const headerSize = idLength + sizeLength;
  return { id, size: allOnes ? null : size, headerSize, start: offset, payloadStart: offset + headerSize };
}

// Walk the segment children.
const ebml = readHeader(base, 0);
const segment = readHeader(base, ebml.payloadStart + (ebml.size ?? 0));
const segmentEnd = segment.payloadStart + segment.size;

let info = null;
let tracks = null;
let tracksHeader = null;
const clusters = [];
let offset = segment.payloadStart;
while (offset < segmentEnd) {
  const header = readHeader(base, offset);
  if (!header || header.size === null) break;
  const raw = base.subarray(offset, offset + header.headerSize + header.size);
  if (header.id === 0x1549a966) info = raw;
  else if (header.id === 0x1654ae6b) {
    tracks = raw;
    tracksHeader = header;
  }
  else if (header.id === 0x1f43b675) clusters.push(raw);
  offset += header.headerSize + header.size;
}
if (!info || !tracks) throw new Error('Could not find Info/Tracks in the base file');

// Split the existing Tracks payload into raw TrackEntry elements.
const trackEntries = [];
let cursor = tracksHeader.headerSize;
const tracksEnd = tracksHeader.headerSize + tracksHeader.size;
while (cursor < tracksEnd) {
  const entry = readHeader(tracks, cursor);
  if (!entry || entry.size === null) break;
  trackEntries.push(tracks.subarray(cursor, cursor + entry.headerSize + entry.size));
  cursor += entry.headerSize + entry.size;
}

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,58,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

const assTrack = element(
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
);

const pgsTrack = element(
  0xae,
  concat(
    uintElement(0xd7, 4),
    uintElement(0x83, 17),
    stringElement(0x86, 'S_HDMV/PGS'),
    stringElement(0x22b59c, 'jpn'),
    stringElement(0x536e, 'Japanese [PGS]'),
    uintElement(0x55aa, 1),
  ),
);

const newTracks = element(0x1654ae6b, concat(...trackEntries, assTrack, pgsTrack));

const simpleBlock = (track, relative, payload) =>
  element(0xa3, concat(new Uint8Array([0x80 | track, (relative >> 8) & 0xff, relative & 0xff, 0x80]), payload));
const cluster = (time, blocks) => element(0x1f43b675, concat(uintElement(0xe7, time), ...blocks));

// A PGS display set: palette + 8×3 bar at (560, 900) + composition.
function pgsSet(timeMs, text) {
  const segment = (type, payload) => {
    const header = new Uint8Array(14);
    header[0] = 0x50;
    header[1] = 0x47;
    header[10] = type;
    header[11] = (payload.length >> 16) & 0xff;
    header[12] = (payload.length >> 8) & 0xff;
    header[13] = payload.length & 0xff;
    return concat(header, payload);
  };
  const width = 240;
  const height = 60;
  const pds = new Uint8Array([0, 0, 1, 81, 240, 90, 255]);
  const rle = [];
  for (let y = 0; y < height; y++) rle.push(1, width);
  const ods = new Uint8Array([0, 1, 0, 0xc0, 0, 0, 4 + rle.length, 0, width, 0, height, ...rle]);
  const pcs = new Uint8Array([0x07, 0x80, 0x04, 0x38, 0x10, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x03, 0x48, 0x03, 0x84]);
  return concat(segment(0x16, pds), segment(0x17, ods), segment(0x14, pcs), segment(0x80, new Uint8Array(0)));
}

const subtitleClusters = [
  cluster(1000, [simpleBlock(3, 0, new TextEncoder().encode('0,0,Default,,0,0,0,,Embedded ASS subtitle line one'))]),
  cluster(4000, [simpleBlock(3, 0, new TextEncoder().encode('0,0,Default,,0,0,0,,{\\i1}Styled{\\i0} second ASS line'))]),
  cluster(7000, [simpleBlock(4, 0, pgsSet(7000))]),
  cluster(9000, [simpleBlock(4, 0, pgsSet(9000))]),
];

const newSegment = element(0x18538067, concat(info, newTracks, ...clusters, ...subtitleClusters));
const output = concat(base.subarray(0, ebml.headerSize + ebml.size), newSegment);

await mkdir(join(ROOT, 'smoke-tmp'), { recursive: true });
await writeFile(OUT, output);
console.log(`wrote ${OUT} (${(output.length / 1024).toFixed(0)} KB) with ASS + PGS tracks`);
