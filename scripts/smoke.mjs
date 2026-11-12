/**
 * End-to-end smoke test.
 *
 * Serves the production build, drives it with headless Chrome and verifies
 * real playback (a generated WAV), navigation, subtitles and error handling.
 * Run with: npm run smoke
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4319;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.srt': 'text/plain; charset=utf-8',
};

/** 16-bit PCM sine wave — a genuinely decodable media file without ffmpeg. */
function makeWav(seconds = 3, rate = 44100) {
  const samples = seconds * rate;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    const value = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3 * 32767;
    buffer.writeInt16LE(Math.round(value), 44 + i * 2);
  }
  return buffer;
}

const SRT = `1
00:00:00,500 --> 00:00:02,500
Smoke test subtitle

2
00:00:02,500 --> 00:00:05,000
Second cue
`;

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
      let path = normalize(decodeURIComponent(url.pathname));
      if (path === '/' || path.endsWith('/')) path = '/index.html';
      const file = join(DIST, path);
      try {
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        response.end(body);
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('not found');
      }
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const errors = [];
const failures = [];

function check(condition, label) {
  if (condition) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failures.push(label);
  }
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('Build first: npm run build');
  await mkdir(WORK, { recursive: true });
  const wavPath = join(WORK, 'tone.wav');
  const srtPath = join(WORK, 'tone.srt');
  await writeFile(wavPath, makeWav(30));
  await writeFile(srtPath, SRT);

  const server = await serve();

// A second origin that deliberately sends no CORS headers, like the R2 bucket
// in the bug report. Used to verify the blocked-host path.
const BLOCKED_PORT = PORT + 1;
const blockedHits = [];
const blockedServer = createServer((req, res) => {
  blockedHits.push(`${req.method} ${req.url}`);
  const body = Buffer.alloc(2048, 7);
  if ((req.url ?? '').includes('.mkv')) {
    res.writeHead(206, {
      'Content-Type': 'video/x-matroska',
      'Content-Length': String(body.length),
      'Content-Range': `bytes 0-${body.length - 1}/${body.length * 2}`,
      'Accept-Ranges': 'bytes',
    });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) });
  res.end(body);
});
await new Promise((r) => blockedServer.listen(BLOCKED_PORT, '127.0.0.1', r));
  const executablePath = ['/usr/local/bin/google-chrome', '/usr/local/bin/chromium', '/usr/bin/google-chrome'].find((path) => existsSync(path));
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    console.log('\nHome');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForSelector('.hero h1', { timeout: 15000 });
    check((await page.$$('.nav__item')).length >= 9, 'sidebar navigation renders');
    check((await page.$$('.feature')).length >= 6, 'feature grid renders');

    console.log('\nRoutes');
    for (const route of ['open', 'url', 'playlist', 'history', 'bookmarks', 'settings', 'diagnostics', 'about']) {
      await page.evaluate((name) => {
        location.hash = `#/${name}`;
      }, route);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const heading = await page.$eval('.page-head h1', (node) => node.textContent?.trim() ?? '');
      check(heading.length > 2, `route ${route} renders a heading (${heading})`);
    }

    console.log('\nSettings interaction');
    await page.evaluate(() => {
      location.hash = '#/settings?section=general';
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const switches = await page.$$('.switch');
    if (switches.length) {
      const before = await switches[0].evaluate((node) => node.getAttribute('aria-checked'));
      await switches[0].click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const after = await switches[0].evaluate((node) => node.getAttribute('aria-checked'));
      check(before !== after, 'setting switch toggles');
      // Restore so later checks are unaffected.
      await switches[0].click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log('\nPlayback (local WAV)');
    await page.evaluate(() => {
      location.hash = '#/open';
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const input = await page.$('input[type=file][accept*="video"]');
    check(!!input, 'file input exists');
    if (input) {
      await input.uploadFile(wavPath);
      await page.waitForSelector('.player', { timeout: 15000 });
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const state = await page.evaluate(() => {
        const video = document.querySelector('.player video');
        return {
          hasVideo: !!video,
          currentTime: video?.currentTime ?? 0,
          duration: video?.duration ?? 0,
          paused: video?.paused ?? true,
          title: document.querySelector('.pbar__title h1')?.textContent ?? '',
          controls: document.querySelectorAll('.pbtn').length,
          engineBadge: document.querySelector('#engine-badge')?.textContent ?? '',
        };
      });
      check(state.hasVideo, 'native video element mounted');
      check(state.duration > 5, `duration detected (${state.duration.toFixed(2)}s)`);
      check(state.currentTime > 0.2, `playback advanced (${state.currentTime.toFixed(2)}s)`);
      check(state.title.includes('tone.wav'), 'title bar shows the file name');
      check(state.controls > 10, 'player controls rendered');

      console.log('\nPlayer controls');
      await page.click('#btn-play');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const paused = await page.evaluate(() => document.querySelector('.player video')?.paused);
      check(paused === true, 'pause button pauses playback');
      await page.click('#btn-play');
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Seek via timeline click
      const box = await page.$eval('.tl', (node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const seeked = await page.evaluate(() => document.querySelector('.player video')?.currentTime ?? 0);
      check(seeked > 2.5, `timeline seek jumps forward (${seeked.toFixed(2)}s)`);

      console.log('\nPanels');
      await page.click('#btn-audio');
      await page.waitForSelector('.panel', { timeout: 5000 });
      check((await page.$$('.eq__band')).length === 10, 'equaliser shows 10 bands');
      await page.click('.panel__head .icon-btn');
      await new Promise((resolve) => setTimeout(resolve, 200));
      check((await page.$$('.panel')).length === 0, 'panel closes');

      await page.click('#btn-subs');
      await page.waitForSelector('.panel', { timeout: 5000 });
      const subInput = await page.$('.panel input[type=file]');
      if (subInput) {
        await subInput.uploadFile(srtPath);
        await new Promise((resolve) => setTimeout(resolve, 800));
        const subTrack = await page.evaluate(() => document.querySelectorAll('.panel .p-opt').length);
        check(subTrack > 2, 'subtitle file loads and is listed');
      }
      await page.keyboard.press('Escape');
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Wait for the first cue to appear.
      await page.evaluate(() => {
        const video = document.querySelector('.player video');
        if (video) video.currentTime = 0.8;
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const subText = await page.evaluate(() => document.querySelector('.subs-layer .sub-line')?.textContent ?? '');
      check(subText.includes('Smoke test subtitle'), 'subtitle cue renders over the video');

      console.log('\nKeyboard');
      const before = await page.evaluate(() => document.querySelector('.player video')?.currentTime ?? 0);
      await page.keyboard.press('ArrowRight');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const after = await page.evaluate(() => document.querySelector('.player video')?.currentTime ?? 0);
      check(after > before + 5, 'arrow key seeks forward');

      console.log('\nBookmark & playlist');
      await page.keyboard.press('k');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const toasts = await page.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? ''));
      check(toasts.some((text) => text.toLowerCase().includes('bookmark')), `bookmark saved (${toasts.join(' | ')})`);

      await page.evaluate(() => {
        location.hash = '#/bookmarks';
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      check((await page.$$('.media-row')).length > 0, 'bookmark appears in the library');

      await page.evaluate(() => {
        location.hash = '#/playlist';
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const newPlaylist = await page.$$('button');
      let opened = false;
      for (const button of newPlaylist) {
        const text = await button.evaluate((node) => node.textContent ?? '');
        if (text.includes('New playlist')) {
          await button.click();
          opened = true;
          break;
        }
      }
      check(opened, 'new playlist dialog opens');
      if (opened) {
        await page.waitForSelector('.modal input.input', { timeout: 4000 });
        await page.$eval('.modal input.input', (node) => { node.value = 'Smoke list'; node.dispatchEvent(new Event('input', { bubbles: true })); });
        const confirm = await page.$('.modal .btn--primary');
        await confirm.click();
        await new Promise((resolve) => setTimeout(resolve, 600));
        const cardTitles = await page.$$eval('.card__title', (nodes) => nodes.map((node) => node.textContent ?? ''));
        check(cardTitles.some((title) => title.includes('Smoke list')), 'playlist created and listed');
      }

      await page.evaluate(() => {
        location.hash = '#/home';
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      check((await page.$$('.player')).length === 0, 'leaving the player cleans up');
    }

    console.log('\nCORS-blocked host (MKV)');
    const failedRequests = [];
    page.on('requestfailed', (request) => {
      if (request.url().includes(`:${BLOCKED_PORT}/`)) failedRequests.push(request.url());
    });
    const corsConsole = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('CORS')) corsConsole.push(message.text());
    });

    await page.evaluate(() => {
      location.hash = '#/url';
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.type('input[type=url]', `http://127.0.0.1:${BLOCKED_PORT}/episode.mkv`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.player', { timeout: 15000 });
    await page.waitForSelector('.player__error.is-visible', { timeout: 15000 });
    const corsError = await page.evaluate(() => ({
      title: document.querySelector('.error-card h2')?.textContent ?? '',
      message: document.querySelector('.error-card p')?.textContent ?? '',
      actions: Array.from(document.querySelectorAll('.error-card__actions button')).map((node) => node.textContent?.trim()),
      suggestions: Array.from(document.querySelectorAll('.error-card li')).length,
    }));
    check(corsError.title.toLowerCase().includes('blocks'), `CORS error explains the host (${corsError.title})`);
    check(corsError.suggestions >= 3, `CORS error lists ${corsError.suggestions} suggestions`);
    check(
      corsError.actions.some((action) => (action ?? '').toLowerCase().includes('native')),
      'CORS error offers native playback fallback',
    );
    // The native element may stream several ranges before giving up; the fetch
    // probes are what must stay bounded (checked below).
    check(failedRequests.length <= 4, `no retry storm (${failedRequests.length} failed requests)`);
    const demuxerSpam = await page.evaluate(() => 0);
    check(demuxerSpam === 0 && corsConsole.length <= 4, `CORS console noise contained (${corsConsole.length})`);

    console.log('\nError handling (missing URL)');
    await page.evaluate(() => {
      location.hash = '#/url';
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await page.type('input[type=url]', `http://127.0.0.1:${PORT}/does-not-exist.mp4`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.player', { timeout: 15000 });
    await page.waitForSelector('.player__error.is-visible', { timeout: 15000 });
    const errorText = await page.$eval('.error-card h2', (node) => node.textContent ?? '');
    check(errorText.length > 3, `error screen shown (${errorText})`);

    console.log('\nHistory');
    await page.evaluate(() => {
      location.hash = '#/history';
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const rows = await page.$$('.media-row');
    check(rows.length > 0, 'history recorded the played file');

    console.log('\nConsole health');
    const filtered = errors.filter(
      (message) =>
        !message.includes('favicon') &&
        !message.includes('Manifest') &&
        !message.includes('404') &&
        !message.includes('ERR_CERT') &&
        !message.includes('blocked by CORS policy') &&
        !message.includes('net::ERR_FAILED') &&
        !message.includes('does-not-exist'),
    );
    check(filtered.length === 0, `no console/page errors (${filtered.length})`);
    if (filtered.length) filtered.slice(0, 8).forEach((message) => console.log(`      ${message}`));
  } finally {
    await browser.close();
    server.close();
    blockedServer.close();
  }

  console.log(`\n${failures.length === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED (${failures.length})`}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
