/**
 * Embed end-to-end test: a third-party page on another origin puts the player in
 * an iframe and expects it to just play.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const APP = 4395;
const SITE = 4396;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.webm': 'video/webm', '.wav': 'audio/wav',
};

const clipPath = join(WORK, 'demo.webm');
if (!existsSync(clipPath)) {
  console.error('Missing demo.webm. Run: node scripts/make-demo-clip.mjs');
  process.exit(1);
}
const clip = await readFile(clipPath);

const app = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
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

// The "other site": a plain page with an iframe, plus the media it points at.
const site = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/video.webm') {
    const range = req.headers.range;
    let start = 0;
    let end = clip.length - 1;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        start = Number(match[1] || 0);
        end = match[2] ? Math.min(Number(match[2]), clip.length - 1) : clip.length - 1;
      }
    }
    const body = clip.subarray(start, end + 1);
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/webm',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const embed = url.searchParams.get('embed') ?? '';
  const extra = url.searchParams.get('extra') ?? '';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><html><body style="margin:0;background:#111">
    <h1 id="host-title">Host page</h1>
    <iframe id="player" src="${embed}${extra}" width="100%" height="480"
      style="border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
      referrerpolicy="no-referrer"></iframe>
  </body></html>`);
});

await new Promise((r) => app.listen(APP, '127.0.0.1', r));
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

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

const embedUrl = (params) => `http://127.0.0.1:${APP}/#/embed?${params.toString()}`;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  console.log('\nIframe on another origin');
  const params = new URLSearchParams({
    src: `http://127.0.0.1:${SITE}/video.webm`,
    autoplay: '1',
    muted: '1',
    title: 'Embedded test video',
  });
  await page.goto(`http://127.0.0.1:${SITE}/?embed=${encodeURIComponent(embedUrl(params))}`, { waitUntil: 'load' });

  const frameHandle = await page.waitForSelector('#player');
  const frame = await frameHandle.contentFrame();
  check(!!frame, 'iframe loaded');

  await frame.waitForSelector('.player', { timeout: 20000 });
  await frame
    .waitForFunction(() => {
      const label = document.querySelector('.time-row b')?.textContent ?? '0:00';
      return Number(label.split(':')[1] ?? 0) > 0;
    }, { timeout: 20000 })
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 400));

  const state = await frame.evaluate(() => ({
    hasPlayer: !!document.querySelector('.player'),
    shell: (() => {
      const node = document.querySelector('.shell');
      return node ? getComputedStyle(node).display !== 'none' : false;
    })(),
    back: (() => {
      const node = document.querySelector('#btn-back');
      return node ? getComputedStyle(node).display === 'none' || node.classList.contains('hidden') : true;
    })(),
    title: document.querySelector('.pbar__title h1')?.textContent ?? '',
    time: document.querySelector('.time-row b')?.textContent ?? '0:00',
    video: !!document.querySelector('video'),
    muted: document.querySelector('video')?.muted ?? null,
    gain: document.documentElement.dataset.audioGain,
    poster: !!document.querySelector('.player__poster'),
  }));
  check(state.hasPlayer, 'player mounted inside the iframe');
  check(!state.shell, 'no app navigation inside the embed');
  check(state.back, 'back button hidden in the embed');
  check(state.title.includes('Embedded test video'), `caption from the URL (${state.title})`);
  check(state.time !== '0:00', `autoplay started (${state.time})`);
  check(state.muted === true || state.gain === '0.00', `started muted as requested (element=${state.muted}, gain=${state.gain})`);
  check(!state.poster, 'poster removed once playback starts');

  console.log('\nFullscreen from inside the iframe');
  const fullscreen = await frame.evaluate(() => {
    const root = document.querySelector('.player');
    return !!(root?.requestFullscreen || root?.webkitRequestFullscreen);
  });
  check(fullscreen, 'player can request fullscreen (allow="fullscreen")');

  console.log('\n?src= form on the site root');
  const rootPage = await browser.newPage();
  await rootPage.setViewport({ width: 1000, height: 700 });
  await rootPage.goto(
    `http://127.0.0.1:${APP}/?src=${encodeURIComponent(`http://127.0.0.1:${SITE}/video.webm`)}&muted=1&title=Root%20form`,
    { waitUntil: 'load' },
  );
  await rootPage.waitForSelector('.player', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const rootState = await rootPage.evaluate(() => ({
    hash: location.hash,
    title: document.querySelector('.pbar__title h1')?.textContent ?? '',
    shell: (() => {
      // A child of display:none still reports its own display, so test .shell.
      const node = document.querySelector('.shell');
      return node ? getComputedStyle(node).display !== 'none' : false;
    })(),
  }));
  check(rootState.hash.startsWith('#/embed'), `rewritten to the embed route (${rootState.hash.slice(0, 40)})`);
  check(rootState.title.includes('Root form'), 'title applied');
  check(!rootState.shell, 'no shell on the root embed form');
  await rootPage.close();

  console.log('\ncontrols=0');
  const bare = await browser.newPage();
  await bare.setViewport({ width: 900, height: 600 });
  await bare.goto(embedUrl(new URLSearchParams({
    src: `http://127.0.0.1:${SITE}/video.webm`,
    controls: '0',
    muted: '1',
    autoplay: '1',
  })), { waitUntil: 'load' });
  await bare.waitForSelector('.player', { timeout: 20000 });
  await bare
    .waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.2, { timeout: 20000 })
    .catch(() => undefined);
  const bareState = await bare.evaluate(() => ({
    barsHidden: Array.from(document.querySelectorAll('.pbar')).every((node) => getComputedStyle(node).display === 'none'),
    playing: (document.querySelector('video')?.currentTime ?? 0) > 0.2,
    gestures: !!document.querySelector('.gesture-layer'),
  }));
  check(bareState.barsHidden, 'transport bars hidden with controls=0');
  check(bareState.playing, 'playback still works without bars');
  check(bareState.gestures, 'tap-to-pause still available');
  await bare.close();

  console.log('\nEmbed builder');
  const builder = await browser.newPage();
  await builder.setViewport({ width: 1280, height: 900 });
  await builder.goto(`http://127.0.0.1:${APP}/#/share`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 700));
  await builder.type('input[type=url]', `http://127.0.0.1:${SITE}/video.webm`);
  await new Promise((r) => setTimeout(r, 700));
  const code = await builder.evaluate(() => ({
    snippet: document.querySelector('.code-area')?.value ?? '',
    link: document.querySelector('.mono-input')?.value ?? '',
    preview: !!document.querySelector('.embed-preview iframe'),
  }));
  check(code.snippet.includes('<iframe') && code.snippet.includes('#/embed?src='), 'iframe snippet generated');
  check(code.snippet.includes('allowfullscreen'), 'snippet allows fullscreen');
  check(code.link.includes('#/embed?src='), `shareable player link generated (${code.link.slice(0, 60)})`);
  check(code.preview, 'live preview renders');
  await builder.close();

  console.log('\nMissing src');
  const empty = await browser.newPage();
  await empty.goto(`http://127.0.0.1:${APP}/#/embed`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  const emptyState = await empty.evaluate(() => ({
    message: document.querySelector('.embed-error h1')?.textContent ?? '',
  }));
  check(emptyState.message.toLowerCase().includes('nothing'), `helpful empty state (${emptyState.message})`);
  await empty.close();

  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  app.close();
  site.close();
}

console.log(`\n${failures.length === 0 ? 'EMBED TEST PASSED' : `EMBED TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
