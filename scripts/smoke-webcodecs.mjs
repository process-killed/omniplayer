/**
 * Verifies the WebCodecs engine end-to-end without needing ffmpeg:
 * Chrome records a short VP8/WebM clip, then the app is forced onto the
 * WebCodecs engine and must demux, decode and paint it.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4323;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.webm': 'video/webm' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(WORK, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const failures = [];
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

try {
  // 1. Record a short clip with Chrome's MediaRecorder.
  const recorder = await browser.newPage();
  await recorder.goto('data:text/html,<canvas id=c width=640 height=360></canvas>');
  const base64 = await recorder.evaluate(async () => {
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1_500_000 });
    rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const done = new Promise((resolve) => (rec.onstop = resolve));
    rec.start(200);
    const started = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const t = (performance.now() - started) / 1000;
        ctx.fillStyle = `hsl(${(t * 90) % 360} 70% 45%)`;
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 56px sans-serif';
        ctx.fillText(`t=${t.toFixed(1)}s`, 40, 200);
        if (t < 3) requestAnimationFrame(draw); else resolve();
      };
      draw();
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
  const clip = Buffer.from(base64, 'base64');
  const clipPath = join(WORK, 'recorded.webm');
  await writeFile(clipPath, clip);
  console.log(`recorded ${(clip.length / 1024).toFixed(0)} KB WebM/VP8`);
  await recorder.close();

  // 2. Force the WebCodecs engine, then open the clip.
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('omniplay:settings:v1', JSON.stringify({ enginePreference: 'webcodecs', autoPlay: true, saveHistory: false }));
  });
  await page.goto(`http://127.0.0.1:${PORT}/#/open`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const input = await page.$('input[type=file][accept*="video"]');
  await input.uploadFile(clipPath);
  await page.waitForSelector('.player canvas', { timeout: 20000 });
  await page
    .waitForFunction(() => {
      const label = document.querySelector('.time-row b')?.textContent ?? '0:00';
      return Number(label.split(':')[1] ?? 0) > 0;
    }, { timeout: 15000 })
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 700));

  const state = await page.evaluate(() => {
    const canvas = document.querySelector('.player canvas');
    let painted = false;
    try {
      const probe = document.createElement('canvas');
      probe.width = 32; probe.height = 32;
      const ctx = probe.getContext('2d');
      ctx.drawImage(canvas, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      painted = sum > 2000;
    } catch { painted = false; }
    return {
      hasCanvas: !!canvas,
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
      painted,
      time: document.querySelector('.time-row b')?.textContent ?? '',
      badge: document.querySelector('#engine-badge')?.textContent ?? '',
      errorVisible: !!document.querySelector('.player__error.is-visible'),
      errorTitle: document.querySelector('.error-card h2')?.textContent ?? '',
    };
  });

  check(state.hasCanvas, 'WebCodecs canvas mounted');
  check(state.width > 100 && state.height > 60, `decoded frame size ${state.width}x${state.height}`);
  check(state.painted, 'frames painted onto the canvas');
  check(state.badge.toLowerCase().includes('webcodecs'), `engine badge shows WebCodecs (${state.badge})`);
  check(!state.errorVisible, `no error screen${state.errorTitle ? ` (${state.errorTitle})` : ''}`);
  const seconds = Number((state.time.split(':')[1] ?? '0').replace(',', '.'));
  check(seconds > 0.4, `playback advanced (${state.time})`);

  // Seek near the end and confirm the pipeline re-anchored.
  const box = await page.$eval('.tl', (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await new Promise((r) => setTimeout(r, 900));
  const afterSeek = await page.evaluate(() => ({
    time: document.querySelector('.time-row b')?.textContent ?? '0:00',
    played: document.querySelector('.tl__played')?.style.width ?? '0%',
  }));
  const playedPercent = Number.parseFloat(afterSeek.played);
  check(playedPercent > 70, `seek re-anchored the pipeline (${state.time} → ${afterSeek.time}, ${afterSeek.played})`);

  const realErrors = errors.filter((message) => !message.includes('favicon') && !message.includes('404'));
  check(realErrors.length === 0, `no console errors (${realErrors.length})`);
  realErrors.slice(0, 5).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'WEBCODECS TEST PASSED' : `WEBCODECS TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
