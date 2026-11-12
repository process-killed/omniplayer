/**
 * Embedded subtitle end-to-end test.
 *
 * Plays a real MKV (VP8 + Opus) that carries an ASS track and a PGS bitmap
 * track, then verifies: track discovery, on-demand extraction, styled ASS
 * rendering and bitmap painting onto the subtitle canvas.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4353;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.mkv': 'video/x-matroska',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/embedded.mkv') {
    const body = await readFile(join(WORK, 'embedded-subs.mkv'));
    res.writeHead(200, {
      'Content-Type': 'video/x-matroska',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
    });
    res.end(body);
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname));
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

const clip = join(WORK, 'embedded-subs.mkv');
if (!existsSync(clip)) {
  console.error('Missing fixture. Run: node scripts/make-embedded-subs-clip.mjs');
  process.exit(1);
}

const failures = [];
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  console.log('\nPlay the MKV');
  await page.goto(`http://127.0.0.1:${PORT}/#/open`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const input = await page.$('input[type=file][accept*="video"]');
  await input.uploadFile(clip);
  await page.waitForSelector('.player canvas', { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2500));
  const firstState = await page.evaluate(() => ({
    error: document.querySelector('.player__error.is-visible')
      ? document.querySelector('.error-card h2')?.textContent + ' :: ' + (document.querySelector('.error-card p')?.textContent ?? '')
      : null,
    badge: document.querySelector('#engine-badge')?.textContent,
    canvas: !!document.querySelector('.player canvas'),
  }));
  check(!firstState.error, `file plays without an error${firstState.error ? ` (${firstState.error})` : ''}`, `engine=${firstState.badge}`);

  console.log('\nTrack discovery');
  await page.click('#btn-subs');
  await page.waitForSelector('.panel');
  await new Promise((r) => setTimeout(r, 1200));
  const embedded = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item'));
    return rows.map((row) => ({
      badge: row.querySelector('.track-item__badge')?.textContent?.trim() ?? '',
      title: row.querySelector('.track-item__title')?.textContent?.trim() ?? '',
      meta: row.querySelector('.track-item__meta')?.textContent?.trim() ?? '',
    }));
  });
  check(embedded.length >= 2, `lists ${embedded.length} embedded tracks`, embedded.map((row) => `${row.badge}:${row.title}`).join(' | '));
  check(embedded.some((row) => row.badge === 'ASS'), 'ASS track listed');
  check(embedded.some((row) => row.badge === 'PGS'), 'PGS track listed');
  check(
    embedded.some((row) => /japanese|jpn/i.test(row.meta)),
    `language metadata shown (${embedded.map((row) => row.meta).join(' | ')})`,
  );

  console.log('\nASS extraction');
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item'));
    rows.find((row) => row.querySelector('.track-item__badge')?.textContent?.trim() === 'ASS')?.click();
  });
  await page.waitForFunction(
    () => (document.querySelector('.ass-layer')?.textContent ?? '').length > 0,
    { timeout: 20000 },
  );
  await page.evaluate(() => {
    const player = document.querySelector('.player');
    const video = document.querySelector('.player video');
    if (video) video.currentTime = 1.2;
    else player?.dispatchEvent(new Event('seek'));
  });
  // Canvas engine: seek through the timeline instead.
  await page.evaluate(() => {
    const tl = document.querySelector('.tl');
    const rect = tl.getBoundingClientRect();
    const ratio = 0.12;
    tl.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.x + rect.width * ratio, clientY: rect.y + 6, bubbles: true, pointerId: 1 }));
    tl.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.x + rect.width * ratio, clientY: rect.y + 6, bubbles: true, pointerId: 1 }));
  });
  await new Promise((r) => setTimeout(r, 1200));
  const assCue = await page.evaluate(() => ({
    text: document.querySelector('.ass-layer')?.textContent ?? '',
    cues: document.querySelectorAll('.ass-layer .ass-cue').length,
    font: document.querySelector('.ass-layer .ass-cue')?.style?.fontFamily ?? '',
  }));
  check(assCue.cues > 0, `ASS cue rendered (${assCue.cues})`);
  check(assCue.text.includes('Embedded ASS subtitle line one'), `cue text is correct (${assCue.text.slice(0, 40)})`);
  check(assCue.font.length > 0, `style applied from the script (${assCue.font})`);

  console.log('\nPGS extraction');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#btn-subs');
  await page.waitForSelector('.panel');
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item'));
    rows.find((row) => row.querySelector('.track-item__badge')?.textContent?.trim() === 'PGS')?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  // Pause first so the cue cannot expire between seeking and sampling.
  await page.click('#btn-play');
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const tl = document.querySelector('.tl');
    const rect = tl.getBoundingClientRect();
    const ratio = 0.72;
    tl.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.x + rect.width * ratio, clientY: rect.y + 6, bubbles: true, pointerId: 1 }));
    tl.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.x + rect.width * ratio, clientY: rect.y + 6, bubbles: true, pointerId: 1 }));
  });
  await new Promise((r) => setTimeout(r, 1000));
  const pgs = await page.evaluate(() => {
    const timeLabel = document.querySelector('.time-row b')?.textContent ?? '?';
    const canvas = document.querySelector('.subs-canvas');
    if (!canvas) return { exists: false, painted: 0, size: '' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { exists: true, painted: 0, size: `${canvas.width}x${canvas.height}` };
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { exists: true, painted, size: `${canvas.width}x${canvas.height}`, timeLabel };
  });
  check(pgs.exists, 'bitmap subtitle canvas present');
  check(pgs.painted > 50, `bitmap pixels painted (${pgs.painted} on ${pgs.size}, t=${pgs.timeLabel})`);

  const realErrors = errors.filter((message) => !message.includes('favicon'));
  check(realErrors.length === 0, `no console errors (${realErrors.length})`);
  realErrors.slice(0, 4).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'EMBEDDED SUBTITLE TEST PASSED' : `EMBEDDED SUBTITLE TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
