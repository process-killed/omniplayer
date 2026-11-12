/**
 * Builds a real multi-audio MKV in headless Chrome using mediabunny's encoders:
 * one video track (VP8) and two audio tracks (Opus, English + Hindi).
 * Used to verify multi-language switching end-to-end.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'smoke-tmp', 'multi-audio.mkv');

// Serve mediabunny locally (no network in the sandbox).
const MB = join(ROOT, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs');
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/mediabunny.mjs')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(await readFile(MB));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><canvas id="c" width="640" height="360"></canvas>');
});
await new Promise((r) => server.listen(4350, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('page error:', message.text().slice(0, 200));
});
page.on('pageerror', (error) => console.log('pageerror:', error.message));
await page.goto('http://127.0.0.1:4350/');

const base64 = await page.evaluate(async () => {
  const mb = await import('/mediabunny.mjs');
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const output = new mb.Output({ format: new mb.MkvOutputFormat(), target: new mb.BufferTarget() });
  const videoSource = new mb.CanvasSource(canvas, { codec: 'vp8', bitrate: 1_200_000 });
  const english = new mb.AudioBufferSource({ codec: 'opus', bitrate: 96_000 });
  const hindi = new mb.AudioBufferSource({ codec: 'opus', bitrate: 96_000 });

  output.addVideoTrack(videoSource, { frameRate: 25 });
  output.addAudioTrack(english, { languageCode: 'eng', name: 'English' });
  output.addAudioTrack(hindi, { languageCode: 'hin', name: 'Hindi' });

  await output.start();

  const seconds = 8;
  const fps = 25;
  const rate = 48000;
  const sampleCount = rate * 1; // 1s audio buffers
  const audioCtx = new OfflineAudioContext(1, sampleCount, rate);

  const makeBuffer = (frequency) => {
    const buffer = audioCtx.createBuffer(1, sampleCount, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) data[i] = Math.sin((2 * Math.PI * frequency * i) / rate) * 0.25;
    return buffer;
  };
  const englishBuffer = makeBuffer(440);
  const hindiBuffer = makeBuffer(660);

  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const g = ctx.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, `hsl(${(200 + t * 10) % 360} 55% 22%)`);
    g.addColorStop(1, `hsl(${(280 + t * 10) % 360} 60% 38%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 46px sans-serif';
    ctx.fillText('Multi-audio test', 40, 160);
    ctx.font = '600 30px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`t=${t.toFixed(1)}s`, 40, 220);
    await videoSource.add(t, 1 / fps);
  }

  for (let i = 0; i < seconds; i++) {
    await english.add(englishBuffer);
    await hindi.add(hindiBuffer);
  }

  videoSource.close();
  english.close();
  hindi.close();
  await output.finalize();

  const bytes = new Uint8Array(output.target.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
});

await mkdir(join(ROOT, 'smoke-tmp'), { recursive: true });
const buffer = Buffer.from(base64, 'base64');
await writeFile(OUT, buffer);
console.log(`wrote ${OUT} (${(buffer.length / 1024).toFixed(0)} KB)`);
await browser.close();
server.close();
