/**
 * Developer surface test: torrents (gateway + validation), the developers page,
 * OmniPlay.mount() and the postMessage protocol.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4420;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.webm': 'video/webm',
};

const clipPath = join(WORK, 'demo.webm');
if (!existsSync(clipPath)) {
  console.error('Missing demo.webm. Run: node scripts/make-demo-clip.mjs');
  process.exit(1);
}
const clip = await readFile(clipPath);
const gatewayHits = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');

  // The "gateway": any path under /gw/ serves the video, with ranges + CORS.
  if (url.pathname.startsWith('/gw/')) {
    gatewayHits.push(url.pathname.slice(0, 60));
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

const failures = [];
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(label);
};

const MAGNET = 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Test%20File&tr=wss%3A%2F%2Ftracker.example';

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  console.log('\nTorrents: validation');
  await page.goto(`http://127.0.0.1:${PORT}/#/torrents`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  await page.type('input[type=text]', 'https://not-a-magnet.example/file.mp4');
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Load magnet'))?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const invalid = await page.evaluate(() => document.body.textContent ?? '');
  check(invalid.includes('not a magnet'), 'rejects a non-magnet link');
  check(invalid.includes('gateway'), 'explains the gateway option');

  console.log('\nTorrents: gateway playback');
  await page.evaluate((gateway) => {
    const key = 'omniplay:settings:v1';
    const current = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...current, torrentGateway: gateway, autoPlay: true }));
  }, `http://127.0.0.1:${PORT}/gw/{magnet}`);
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input[type=text]', MAGNET);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Load magnet'))?.click();
  });
  await page.waitForSelector('.player', { timeout: 20000 });
  await page
    .waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.1, { timeout: 20000 })
    .catch(() => undefined);
  const played = await page.evaluate(() => ({
    time: document.querySelector('.time-row b')?.textContent ?? '0:00',
    title: document.querySelector('.pbar__title h1')?.textContent ?? '',
  }));
  check(gatewayHits.length > 0, `gateway received the magnet (${gatewayHits.length} requests)`);
  check(played.time !== '0:00', `plays through the gateway (${played.time})`);
  check(played.title.includes('Test File'), `torrent name used as the title (${played.title})`);

  console.log('\nProvider links');
  await page.goto(`http://127.0.0.1:${PORT}/#/url`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input[type=url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await new Promise((r) => setTimeout(r, 400));
  const previewText = await page.evaluate(() => document.querySelector('.link-preview')?.textContent ?? '');
  check(previewText.includes('Video provider'), `link preview names the adapter (${previewText.slice(0, 40)})`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.player', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  const provider = await page.evaluate(() => ({
    frame: document.querySelector('.provider-frame')?.getAttribute('src') ?? '',
    chromeHidden: (() => {
      const bar = document.querySelector('.pbar--bottom');
      return bar ? getComputedStyle(bar).display === 'none' : false;
    })(),
    subtitle: document.querySelector('.pbar__title p')?.textContent ?? '',
  }));
  check(provider.frame.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'), `YouTube embed rendered (${provider.frame.slice(0, 48)})`);
  check(provider.chromeHidden, 'transport controls hidden for provider playback');
  check(provider.subtitle.toLowerCase().includes('youtube'), `explains the provider (${provider.subtitle})`);

  console.log('\nMagnet inside an embed');
  await page.evaluate((gateway) => {
    const key = 'omniplay:settings:v1';
    const current = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...current, torrentGateway: gateway, autoPlay: true }));
  }, `http://127.0.0.1:${PORT}/gw/{magnet}`);
  const embedMagnet = `http://127.0.0.1:${PORT}/#/embed?src=${encodeURIComponent(MAGNET)}&autoplay=1&muted=1`;
  await page.goto(embedMagnet, { waitUntil: 'load' });
  await page.waitForSelector('.player', { timeout: 20000 });
  await page
    .waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.1, { timeout: 20000 })
    .catch(() => undefined);
  const magnetEmbed = await page.evaluate(() => ({
    time: document.querySelector('.time-row b')?.textContent ?? '0:00',
    title: document.querySelector('.pbar__title h1')?.textContent ?? '',
  }));
  check(magnetEmbed.time !== '0:00', `magnet plays in embed mode (${magnetEmbed.time})`);
  check(magnetEmbed.title.includes('Test File'), `torrent name shown (${magnetEmbed.title})`);

  console.log('\nWebTorrent bundle');
  const webtorrent = await page.evaluate(async () => {
    try {
      const mod = await import('/vendor/webtorrent.min.js');
      const Ctor = mod.default;
      if (typeof Ctor !== 'function') return { ok: false, reason: 'no constructor' };
      const client = new Ctor();
      const hasAdd = typeof client.add === 'function';
      client.destroy();
      return { ok: true, hasAdd };
    } catch (error) {
      return { ok: false, reason: String(error).slice(0, 120) };
    }
  });
  check(webtorrent.ok, `vendored WebTorrent loads (${webtorrent.reason ?? 'ok'})`);
  check(webtorrent.hasAdd, 'client exposes add()');

  console.log('\nDevelopers page');
  await page.goto(`http://127.0.0.1:${PORT}/#/developers`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 700));
  const dev = await page.evaluate(() => ({
    hasIframeCode: (document.body.textContent ?? '').includes('<iframe'),
    hasProtocol: (document.body.textContent ?? '').includes('omniplay'),
    params: document.querySelectorAll('.dev-table__row').length,
  }));
  check(dev.hasIframeCode, 'documents the iframe snippet');
  check(dev.hasProtocol, 'documents the postMessage protocol');
  check(dev.params >= 10, `${dev.params} parameters documented`);

  console.log('\nOmniPlay.mount + protocol');
  const mounted = await page.evaluate(async () => {
    const api = window.OmniPlay;
    if (!api) return { error: 'window.OmniPlay missing' };
    const host = document.createElement('div');
    host.id = 'test-host';
    document.body.append(host);
    const player = api.mount('#test-host', {
      src: `http://127.0.0.1:${location.port}/gw/video.webm`,
      muted: true,
      autoplay: false,
      title: 'Mounted test',
    });
    const events = [];
    player.on((event) => events.push(event.type));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    player.play();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    player.getState();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      version: api.version,
      protocolVersion: api.protocolVersion,
      hasIframe: !!document.querySelector('#test-host iframe'),
      events: Array.from(new Set(events)),
    };
  });
  check(!mounted.error, `window.OmniPlay available (${mounted.error ?? 'yes'})`);
  check(mounted.hasIframe, 'mount() created the iframe');
  check((mounted.events ?? []).includes('ready'), `player emitted ready (${(mounted.events ?? []).join(',')})`);
  check((mounted.events ?? []).includes('timeupdate'), 'player emitted timeupdate after play()');
  check((mounted.events ?? []).includes('state-reply'), 'getState() answered');

  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'DEV TEST PASSED' : `DEV TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
