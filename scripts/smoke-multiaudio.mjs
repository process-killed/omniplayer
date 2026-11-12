/**
 * Multi-audio end-to-end test.
 *
 * Uses a real MKV with two Opus audio tracks (English + Hindi) built by
 * scripts/make-multiaudio-clip.mjs, plays it with the WebCodecs engine and
 * switches languages the way a user would.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4351;
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
  if (url.pathname === '/clip.mkv') {
    try {
      const body = await readFile(join(WORK, 'multi-audio.mkv'));
      res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes' });
      res.end(body);
      return;
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
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

const clip = join(WORK, 'multi-audio.mkv');
if (!existsSync(clip)) {
  console.error('Missing fixture. Run: node scripts/make-multiaudio-clip.mjs');
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

  console.log('\nOpen the two-track file');
  await page.goto(`http://127.0.0.1:${PORT}/#/open`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const input = await page.$('input[type=file][accept*="video"]');
  await input.uploadFile(clip);
  await page.waitForSelector('.player canvas', { timeout: 25000 });
  // Wait for real progress instead of a fixed delay (start-up varies by machine).
  await page
    .waitForFunction(() => {
      const label = document.querySelector('.time-row b')?.textContent ?? '0:00';
      const [, seconds] = label.split(':');
      return Number(seconds) > 0;
    }, { timeout: 15000 })
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 600));

  const start = await page.evaluate(() => ({
    engine: document.querySelector('#engine-badge')?.textContent ?? '',
    time: document.querySelector('.time-row b')?.textContent ?? '0:00',
    error: document.querySelector('.player__error.is-visible') ? document.querySelector('.error-card h2')?.textContent : null,
    gain: document.documentElement.dataset.audioGain,
  }));
  check(!start.error, `plays without an error${start.error ? ` (${start.error})` : ''}`);
  check(start.engine.toLowerCase().includes('webcodecs'), `WebCodecs engine selected (${start.engine})`);
  check(Number((start.time.split(':')[1] ?? '0')) > 0, `playback advanced (${start.time})`);
  check(start.gain !== undefined, `audio graph running (gain ${start.gain})`);

  console.log('\nAudio track list');
  await page.click('#btn-tracks');
  await page.waitForSelector('.panel');
  await new Promise((r) => setTimeout(r, 500));
  const tracks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.panel .track-item')).map((node) => ({
      label: node.querySelector('.track-item__title')?.textContent?.trim() ?? '',
      meta: node.querySelector('.track-item__meta')?.textContent?.trim() ?? '',
      active: node.classList.contains('is-active'),
    })),
  );
  const audioTracks = tracks.filter((track) => !track.label.toLowerCase().includes('primary video'));
  check(audioTracks.length >= 2, `lists ${audioTracks.length} audio tracks`, audioTracks.map((t) => t.label).join(' | '));
  check(audioTracks.some((track) => track.label.toLowerCase().includes('english')), 'English track listed');
  check(audioTracks.some((track) => track.label.toLowerCase().includes('hindi')), 'Hindi track listed');
  check(audioTracks.filter((track) => track.active).length === 1, 'exactly one track is active');

  console.log('\nSwitch language');
  const before = await page.evaluate(() => document.querySelector('.time-row b')?.textContent ?? '0:00');
  const clicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item'));
    const hindi = rows.find((node) => (node.textContent ?? '').toLowerCase().includes('hindi'));
    if (!hindi) return false;
    hindi.click();
    return true;
  });
  check(clicked, 'Hindi row is clickable');
  await new Promise((r) => setTimeout(r, 1800));

  const after = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item')).map((node) => ({
      label: node.querySelector('.track-item__title')?.textContent?.trim() ?? '',
      active: node.classList.contains('is-active'),
    }));
    return {
      rows,
      time: document.querySelector('.time-row b')?.textContent ?? '0:00',
      error: document.querySelector('.player__error.is-visible') ? document.querySelector('.error-card h2')?.textContent : null,
      gain: document.documentElement.dataset.audioGain,
    };
  });
  const activeAfter = after.rows.filter((row) => row.active).map((row) => row.label);
  check(!after.error, `no error after switching${after.error ? ` (${after.error})` : ''}`);
  check(
    activeAfter.some((label) => label.toLowerCase().includes('hindi')),
    `Hindi is now the active track (${activeAfter.join(', ') || 'none'})`,
  );
  check(after.time !== before, `playback continued after the switch (${before} → ${after.time})`);
  check(after.gain !== undefined, `audio still routed through the graph (gain ${after.gain})`);

  console.log('\nSwitch back');
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item'));
    const english = rows.find((node) => (node.textContent ?? '').toLowerCase().includes('english'));
    english?.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  const back = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.panel .track-item')).map((node) => ({
      label: node.querySelector('.track-item__title')?.textContent?.trim() ?? '',
      active: node.classList.contains('is-active'),
    })),
    error: document.querySelector('.player__error.is-visible'),
  }));
  check(
    back.rows.some((row) => row.active && row.label.toLowerCase().includes('english')),
    'English is active again',
  );
  check(!back.error, 'no error switching back');

  console.log('\nPaused switching');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#btn-play');
  await new Promise((r) => setTimeout(r, 400));
  const pausedTime = await page.evaluate(() => document.querySelector('.time-row b')?.textContent);
  await page.click('#btn-tracks');
  await page.waitForSelector('.panel');
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.panel .track-item'));
    rows.find((node) => (node.textContent ?? '').toLowerCase().includes('hindi'))?.click();
  });
  await new Promise((r) => setTimeout(r, 900));
  const pausedAfter = await page.evaluate(() => ({
    time: document.querySelector('.time-row b')?.textContent,
    error: document.querySelector('.player__error.is-visible'),
  }));
  check(pausedAfter.time === pausedTime, `position preserved while paused (${pausedTime} → ${pausedAfter.time})`);
  check(!pausedAfter.error, 'switching while paused does not error');

  const realErrors = errors.filter((message) => !message.includes('favicon'));
  check(realErrors.length === 0, `no console errors (${realErrors.length})`);
  realErrors.slice(0, 4).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'MULTI-AUDIO TEST PASSED' : `MULTI-AUDIO TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
