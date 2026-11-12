/**
 * PWA verification: manifest, service worker precache, offline start and the
 * install affordance. Runs against the production build in headless Chrome.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const PORT = 4336;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const failures = [];
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  console.log('\nManifest');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  const manifest = await page.evaluate(async () => {
    const response = await fetch('./manifest.webmanifest');
    return { ok: response.ok, data: await response.json() };
  });
  check(manifest.ok, 'manifest is served');
  check(!!manifest.data.name && !!manifest.data.short_name, 'name and short_name present');
  check(manifest.data.display === 'standalone', 'display is standalone');
  check(Array.isArray(manifest.data.icons) && manifest.data.icons.length >= 2, `icons: ${manifest.data.icons?.length ?? 0}`);
  check(manifest.data.icons.some((icon) => icon.purpose === 'maskable'), 'has a maskable icon');
  check(Array.isArray(manifest.data.shortcuts) && manifest.data.shortcuts.length >= 2, `shortcuts: ${manifest.data.shortcuts?.length ?? 0}`);
  check(manifest.data.start_url === './', 'start_url is relative');

  const iconStatuses = await page.evaluate(async (icons) => {
    const results = [];
    for (const icon of icons) {
      try {
        const response = await fetch(icon.src);
        results.push({ src: icon.src, status: response.status });
      } catch {
        results.push({ src: icon.src, status: 0 });
      }
    }
    return results;
  }, manifest.data.icons);
  check(iconStatuses.every((icon) => icon.status === 200), 'every manifest icon resolves', iconStatuses.map((i) => `${i.src}:${i.status}`).join(' '));

  if (manifest.data.screenshots) {
    const shotStatuses = await page.evaluate(async (shots) => {
      const out = [];
      for (const shot of shots) {
        const response = await fetch(shot.src);
        out.push({ src: shot.src, status: response.status });
      }
      return out;
    }, manifest.data.screenshots);
    check(shotStatuses.every((shot) => shot.status === 200), 'manifest screenshots resolve', shotStatuses.map((s) => `${s.src}:${s.status}`).join(' '));
  }

  console.log('\nService worker');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const sw = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cacheName = keys.find((key) => key.startsWith('omniplay-')) ?? null;
    let cachedIndex = false;
    let cachedCount = 0;
    if (cacheName) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      cachedCount = requests.length;
      cachedIndex = requests.some((request) => request.url.endsWith('/index.html') || request.url.endsWith('/'));
    }
    return {
      registered: !!registration,
      active: !!registration?.active,
      scope: registration?.scope ?? '',
      cacheName,
      cachedIndex,
      cachedCount,
      controller: !!navigator.serviceWorker.controller,
    };
  });
  check(sw.registered && sw.active, 'service worker registered and active', sw.scope);
  check(!!sw.cacheName, `cache created (${sw.cacheName})`);
  check(sw.cachedIndex, 'index.html is precached');
  check(sw.cachedCount >= 8, `precached ${sw.cachedCount} entries`);

  console.log('\nOffline start');
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 400));
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1200));
  const offline = await page.evaluate(() => ({
    hero: !!document.querySelector('.hero h1'),
    nav: document.querySelectorAll('.nav__item').length,
    offlineBar: !!document.querySelector('.offline-bar:not(.hidden)'),
    title: document.title,
  }));
  check(offline.hero, 'app renders from cache while offline');
  check(offline.nav >= 9, 'navigation restored offline');
  check(offline.offlineBar, 'offline banner is shown');
  await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  console.log('\nInstall affordance');
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  const beforeVisible = await page.evaluate(() => {
    const node = document.querySelector('#install-app');
    return !!node && !node.classList.contains('hidden');
  });
  check(!beforeVisible, 'install card hidden before the browser offers installation');

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  await new Promise((r) => setTimeout(r, 400));
  const afterVisible = await page.evaluate(() => {
    const node = document.querySelector('#install-app');
    return !!node && !node.classList.contains('hidden');
  });
  check(afterVisible, 'install card appears when installation is offered');

  await page.click('#install-app');
  await new Promise((r) => setTimeout(r, 700));
  const afterInstall = await page.evaluate(() => {
    const node = document.querySelector('#install-app');
    const toasts = Array.from(document.querySelectorAll('.toast')).map((toast) => toast.textContent ?? '');
    return { hidden: !node || node.classList.contains('hidden'), toasts };
  });
  check(afterInstall.hidden, 'install card hides after a successful install');
  check(afterInstall.toasts.some((text) => text.toLowerCase().includes('installed')), `confirmation shown (${afterInstall.toasts.join(' | ')})`);

  console.log('\nSettings → App');
  await page.evaluate(() => {
    location.hash = '#/settings?section=app';
  });
  await new Promise((r) => setTimeout(r, 600));
  const appSection = await page.evaluate(() => {
    const heading = document.querySelector('.card__title')?.textContent ?? '';
    return { heading, cards: document.querySelectorAll('.settings-panel .card').length };
  });
  check(appSection.heading.toLowerCase().includes('install'), `app section renders (${appSection.heading})`);
  check(appSection.cards >= 2, `app section has ${appSection.cards} cards`);

  const realErrors = errors.filter((message) => !message.includes('favicon') && !message.includes('net::ERR_INTERNET_DISCONNECTED'));
  check(realErrors.length === 0, `no console errors (${realErrors.length})`);
  realErrors.slice(0, 5).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'PWA TEST PASSED' : `PWA TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
