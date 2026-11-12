/**
 * CORS behaviour test.
 *
 * Two hosts: one that refuses browser access (like the signed R2 bucket in the
 * bug report) and one that is a 302 download gateway pointing at it. Then the
 * same file through a CORS proxy, which must play end to end.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const APP = 4370;
const HOSTILE = 4371;
const PROXY = 4372;
const STRICT_PROXY = 4374;
const GATEWAY = 4373;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.mkv': 'video/x-matroska',
};

const clipPath = join(WORK, 'embedded-subs.mkv');
if (!existsSync(clipPath)) {
  console.error('Missing fixture. Run: node scripts/make-embedded-subs-clip.mjs');
  process.exit(1);
}
const clip = await readFile(clipPath);

// A playable WebM served under a .mkv name: this is what a gateway that
// re-packages or mislabels a file looks like, and what movi-player plays via
// its native fallback.
const webmPath = join(WORK, 'demo.webm');
const playable = existsSync(webmPath) ? await readFile(webmPath) : clip;

function rangeOf(req, total) {
  const header = req.headers.range;
  if (!header) return { start: 0, end: total - 1, partial: false };
  const match = /bytes=(\d*)-(\d*)/.exec(header);
  if (!match) return { start: 0, end: total - 1, partial: false };
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  return { start, end, partial: true };
}

/* --------------------------------------------------------------- app server */
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

/* ------------------------------------------- storage host with no CORS headers */
const hostileHits = [];
const hostile = createServer((req, res) => {
  hostileHits.push(`${req.method} ${req.url}`);

  if ((req.url ?? '').includes('stream.m3u8')) {
    const body = Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\nmedia.m3u8\n');
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': String(body.length) });
    res.end(body);
    return;
  }
  if ((req.url ?? '').includes('media.m3u8')) {
    const body = Buffer.from(
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.0,\nseg0.ts\n#EXT-X-ENDLIST\n',
    );
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': String(body.length) });
    res.end(body);
    return;
  }
  if ((req.url ?? '').includes('seg0.ts')) {
    const body = Buffer.alloc(2048, 3);
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  if ((req.url ?? '').includes('no-preflight')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(405, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.headers.range) {
      res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'video/x-matroska',
      'Content-Length': String(clip.length),
      'Access-Control-Allow-Origin': '*',
    });
    res.end(clip);
    return;
  }

  if ((req.url ?? '').includes('unplayable')) {
    const junk = Buffer.alloc(4096, 7);
    res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(junk.length) });
    res.end(req.method === 'HEAD' ? undefined : junk);
    return;
  }

  if ((req.url ?? '').includes('actually-playable')) {
    const range = rangeOf(req, playable.length);
    const body = playable.subarray(range.start, range.end + 1);
    res.writeHead(range.partial ? 206 : 200, {
      'Content-Type': 'video/webm',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      ...(range.partial ? { 'Content-Range': `bytes ${range.start}-${range.end}/${playable.length}` } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  const { start, end, partial } = rangeOf(req, clip.length);
  const body = clip.subarray(start, end + 1);
  res.writeHead(partial ? 206 : 200, {
    'Content-Type': 'video/x-matroska',
    'Content-Length': String(body.length),
    'Accept-Ranges': 'bytes',
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
});

/* ------------------------------------------------------- 302 download gateway */
const gateway = createServer((req, res) => {
  res.writeHead(302, { Location: `http://127.0.0.1:${HOSTILE}/unplayable.mkv` });
  res.end();
});

/* --------------------------------------------------------------- CORS proxy */
const proxyLog = [];
const proxy = createServer(async (req, res) => {
  // A Range header makes the browser send a preflight; a real proxy must answer it.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }
  const target = new URL(req.url ?? '/', 'http://x').searchParams.get('url');
  if (target) proxyLog.push(target);
  if (!target) {
    res.writeHead(400);
    res.end('missing url');
    return;
  }
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers['Content-Range'] = contentRange;
    res.writeHead(upstream.status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(502);
    res.end(String(error));
  }
});

// A worker that only accepts ?url= and answers 400 otherwise — the shape the
// user's Cloudflare Worker expects.
const strictLog = [];
const strictProxy = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    });
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  const target = url.searchParams.get('url');
  strictLog.push(url.search);
  if (!target) {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    res.end('missing ?url=');
    return;
  }
  try {
    const upstream = await fetch(target, { method: req.method, headers: req.headers.range ? { Range: req.headers.range } : {} });
    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };
    const range = upstream.headers.get('content-range');
    if (range) headers['Content-Range'] = range;
    res.writeHead(upstream.status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
    res.end(String(error));
  }
});

await new Promise((r) => app.listen(APP, '127.0.0.1', r));
await new Promise((r) => strictProxy.listen(STRICT_PROXY, '127.0.0.1', r));
await new Promise((r) => hostile.listen(HOSTILE, '127.0.0.1', r));
await new Promise((r) => gateway.listen(GATEWAY, '127.0.0.1', r));
await new Promise((r) => proxy.listen(PROXY, '127.0.0.1', r));

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
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() === 400) console.log('      400 →', response.url().slice(0, 110));
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const openUrl = async (url) => {
    await page.goto(`http://127.0.0.1:${APP}/#/url`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 400));
    await page.type('input[type=url]', url);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.player', { timeout: 15000 });
  };

  console.log('\nBlocked host, WebM-compatible MKV (Chrome can decode it natively)');
  hostileHits.length = 0;
  await openUrl(`http://127.0.0.1:${HOSTILE}/episode.mkv`);
  await page.waitForSelector('.player video', { timeout: 20000 });
  await page
    .waitForFunction(() => {
      const label = document.querySelector('.time-row b')?.textContent ?? '0:00';
      return Number(label.split(':')[1] ?? 0) > 0;
    }, { timeout: 20000 })
    .catch(() => undefined);
  const native = await page.evaluate(() => ({
    error: document.querySelector('.player__error.is-visible')?.textContent?.slice(0, 60) ?? null,
    time: document.querySelector('.time-row b')?.textContent,
    badge: document.querySelector('#engine-badge')?.textContent,
    toasts: Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent?.trim() ?? ''),
  }));
  check(!native.error, `native fallback plays the file${native.error ? ` (${native.error})` : ''}`);
  check(native.time !== '0:00', `playback advanced (${native.time})`);
  check((native.badge ?? '').toLowerCase().includes('cors'), `badge marks the degraded mode (${native.badge})`);
  check(native.toasts.some((text) => text.toLowerCase().includes('limited mode')), 'limited-mode notice shown');
  check(hostileHits.length <= 6, `${hostileHits.length} requests to the blocked host`);

  console.log('\nBlocked host, bytes the browser cannot decode (H.264 MKV case)');
  hostileHits.length = 0;
  await openUrl(`http://127.0.0.1:${HOSTILE}/unplayable.mkv`);
  await page.waitForSelector('.player__error.is-visible', { timeout: 25000 });
  const blocked = await page.evaluate(() => ({
    title: document.querySelector('.error-card h2')?.textContent ?? '',
    detail: document.querySelector('.error-card__detail')?.textContent ?? '',
    actions: Array.from(document.querySelectorAll('.error-card__actions button')).map((n) => n.textContent?.trim()),
    suggestions: document.querySelectorAll('.error-card li').length,
  }));
  check(blocked.title.toLowerCase().includes('blocks'), `explains the host (${blocked.title})`);
  check(blocked.actions.some((a) => (a ?? '').toLowerCase().includes('proxy')), 'offers the proxy route');
  check(blocked.suggestions >= 4, `${blocked.suggestions} suggestions`);
  check(hostileHits.length <= 5, `${hostileHits.length} requests to the blocked host`);

  console.log('\nLink checker (bucket that refuses HEAD and preflight but allows GET)');
  await page.evaluate(() => {
    location.hash = '#/diagnostics';
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate((url) => {
    const input = document.querySelector('.card input[type=url]');
    input.value = url;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, `http://127.0.0.1:${HOSTILE}/no-preflight.mkv`);
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.card button'));
    buttons.find((node) => node.textContent?.includes('Check'))?.click();
  });
  await page.waitForSelector('.link-check__verdict', { timeout: 20000 });
  const checkResult = await page.evaluate(() => ({
    verdict: document.querySelector('.link-check__verdict')?.textContent ?? '',
    rows: Array.from(document.querySelectorAll('.link-check__row')).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  }));
  check(checkResult.rows.length >= 3, `checker ran ${checkResult.rows.length} probes`);
  check(
    checkResult.rows.some((row) => row.includes('GET, no Range') && row.toLowerCase().includes('allowed')),
    'recognises that a plain GET is allowed',
  );
  check(
    checkResult.verdict.toLowerCase().includes('range'),
    `verdict names the range problem (${checkResult.verdict.slice(0, 70)})`,
  );

  console.log('\n302 gateway (no extension, redirects to the blocked host)');
  hostileHits.length = 0;
  await openUrl(`http://127.0.0.1:${GATEWAY}/?id=17a2e45`);
  await page.waitForSelector('.player__error.is-visible', { timeout: 25000 });
  const viaGateway = await page.evaluate(() => ({
    title: document.querySelector('.error-card h2')?.textContent ?? '',
  }));
  check(
    viaGateway.title.toLowerCase().includes('blocks') || viaGateway.title.toLowerCase().includes('container'),
    `gateway failure is explained (${viaGateway.title})`,
  );
  check(hostileHits.length <= 6, `gateway did not cause a retry storm (${hostileHits.length} hits)`);

  console.log('\nProxy that only accepts ?url= (path-style guess returns 400)');
  await page.evaluate((template) => {
    localStorage.setItem('omniplay:settings:v1', JSON.stringify({ corsProxy: template, autoPlay: true, preferHardware: false }));
  }, `http://127.0.0.1:${STRICT_PROXY}/proxy`);
  await page.goto(`http://127.0.0.1:${APP}/#/url`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input[type=url]', `http://127.0.0.1:${HOSTILE}/episode.mkv`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.player canvas', { timeout: 30000 }).catch(() => undefined);
  await page
    .waitForFunction(() => {
      const label = document.querySelector('.time-row b')?.textContent ?? '0:00';
      return Number(label.split(':')[1] ?? 0) > 0;
    }, { timeout: 25000 })
    .catch(() => undefined);
  const negotiated = await page.evaluate(() => ({
    time: document.querySelector('.time-row b')?.textContent ?? '0:00',
    error: document.querySelector('.player__error.is-visible')?.textContent?.slice(0, 60) ?? null,
  }));
  check(!negotiated.error, `plays after shape negotiation${negotiated.error ? ` (${negotiated.error})` : ''}`);
  check(negotiated.time !== '0:00', `playback advanced (${negotiated.time})`);
  check(strictLog.some((search) => search.includes('url=')), `worker received ?url= (${strictLog.length} requests)`);

  console.log('\nHLS through the proxy');
  await page.evaluate((template) => {
    localStorage.setItem('omniplay:settings:v1', JSON.stringify({ corsProxy: template, autoPlay: true, preferHardware: false }));
  }, `http://127.0.0.1:${PROXY}/?url={url}`);
  await page.goto(`http://127.0.0.1:${APP}/#/url`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  proxyLog.length = 0;
  await page.type('input[type=url]', `http://127.0.0.1:${HOSTILE}/stream.m3u8`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.player', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 4000));
  const hlsRequests = proxyLog.filter((entry) => entry.includes('.m3u8') || entry.includes('.ts'));
  check(hlsRequests.some((entry) => entry.includes('stream.m3u8')), `manifest fetched through the proxy (${hlsRequests.length} HLS requests)`);
  check(hlsRequests.some((entry) => entry.includes('media.m3u8')), 'variant playlist fetched through the proxy');
  check(hlsRequests.some((entry) => entry.includes('seg0.ts')), 'segment fetched through the proxy');

  console.log('\nSame file through a CORS proxy');
  const proxyTemplate = `http://127.0.0.1:${PROXY}/?url={url}`;
  await page.evaluate((template) => {
    localStorage.setItem('omniplay:settings:v1', JSON.stringify({ corsProxy: template, autoPlay: true, preferHardware: false }));
  }, proxyTemplate);
  // A hash-only navigation does not reload the app, so force a real reload
  // after writing the setting.
  await page.goto(`http://127.0.0.1:${APP}/#/url`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const savedProxy = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('omniplay:settings:v1') ?? '{}').corsProxy ?? '';
    } catch {
      return '';
    }
  });
  check(savedProxy.includes('{url}'), 'proxy template persisted');

  await page.type('input[type=url]', `http://127.0.0.1:${HOSTILE}/episode.mkv`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.player canvas', { timeout: 30000 });
  await page
    .waitForFunction(() => {
      const label = document.querySelector('.time-row b')?.textContent ?? '0:00';
      return Number(label.split(':')[1] ?? 0) > 0;
    }, { timeout: 20000 })
    .catch(() => undefined);
  const proxied = await page.evaluate(() => ({
    error: document.querySelector('.player__error.is-visible')?.textContent?.slice(0, 80) ?? null,
    time: document.querySelector('.time-row b')?.textContent,
    engine: document.querySelector('#engine-badge')?.textContent,
  }));
  check(!proxied.error, `plays through the proxy${proxied.error ? ` (${proxied.error})` : ''}`);
  check(proxied.time !== '0:00', `playback advanced (${proxied.time})`);
  check((proxied.engine ?? '').toLowerCase().includes('webcodecs'), `demuxed with WebCodecs (${proxied.engine})`);

  console.log('\nEmbedded subtitles survive the proxy');
  await page.click('#btn-subs');
  await page.waitForSelector('.panel');
  await new Promise((r) => setTimeout(r, 1200));
  const embedded = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.panel .track-item')).map((node) => node.querySelector('.track-item__badge')?.textContent?.trim()),
  );
  check(embedded.includes('ASS') && embedded.includes('PGS'), `MKV subtitle tracks found (${embedded.join(', ')})`);

  const realErrors = errors.filter(
    (message) =>
      !message.includes('favicon') &&
      !message.includes('blocked by CORS') &&
      !message.includes('ERR_FAILED') &&
      !message.includes('400 (Bad Request)') &&
      // The link checker deliberately probes a bucket that refuses HEAD/Range.
      !message.includes('403 (Forbidden)'),
  );
  check(realErrors.length === 0, `no console errors (${realErrors.length})`);
  realErrors.slice(0, 4).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  app.close();
  hostile.close();
  gateway.close();
  proxy.close();
  strictProxy.close();
}

console.log(`\n${failures.length === 0 ? 'CORS TEST PASSED' : `CORS TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
