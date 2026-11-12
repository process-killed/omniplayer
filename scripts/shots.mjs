/**
 * Screenshots of the main screens, desktop and phone, using a real recorded clip.
 * Usage: npm run shots   (requires a build + scripts/make-demo-clip.mjs)
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const OUT = join(ROOT, 'shots');
const PORT = 4321;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
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
    res.end('nf');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });

const clip = join(WORK, 'demo.webm');
if (!existsSync(clip)) {
  console.error('Missing demo clip. Run: node scripts/make-demo-clip.mjs');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--font-render-hinting=none'],
});

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
};

async function openPlayer(page) {
  await page.evaluate(() => {
    location.hash = '#/open';
  });
  await new Promise((r) => setTimeout(r, 500));
  const input = await page.$('input[type=file][accept*="video"]');
  await input.uploadFile(clip);
  await page.waitForSelector('.player video, .player canvas', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2200));
  // Pause so the centre play button and full chrome are visible in the shot.
  await page.evaluate(() => {
    const video = document.querySelector('.player video');
    if (video) video.currentTime = 6;
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const button = document.querySelector('#btn-play');
    if (button) button.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

/* ---------------------------------------------------------------- desktop */
const desktop = await browser.newPage();
await desktop.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await desktop.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 900));
await shot(desktop, '01-home');

await desktop.evaluate(() => {
  location.hash = '#/settings?section=general';
});
await new Promise((r) => setTimeout(r, 600));
await shot(desktop, '02-settings');

await desktop.evaluate(() => {
  location.hash = '#/settings?section=app';
});
await new Promise((r) => setTimeout(r, 500));
await shot(desktop, '03-settings-app');

await desktop.evaluate(() => {
  location.hash = '#/open';
});
await new Promise((r) => setTimeout(r, 500));
await shot(desktop, '04-open');

await openPlayer(desktop);
await shot(desktop, '05-player-paused');

await desktop.click('#btn-audio');
await desktop.waitForSelector('.panel');
await new Promise((r) => setTimeout(r, 600));
await shot(desktop, '06-player-audio-panel');
await desktop.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));

await desktop.click('#btn-brightness');
await new Promise((r) => setTimeout(r, 400));
await shot(desktop, '07-player-brightness');
await desktop.keyboard.press('Escape');

await desktop.evaluate(() => {
  location.hash = '#/diagnostics';
});
await new Promise((r) => setTimeout(r, 1200));
await shot(desktop, '08-diagnostics');

/* ----------------------------------------------------------------- mobile */
const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await mobile.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 900));
await shot(mobile, '09-mobile-home');

await openPlayer(mobile);
await shot(mobile, '10-mobile-player');

await mobile.click('#btn-more');
await mobile.waitForSelector('.sheet');
await new Promise((r) => setTimeout(r, 500));
await shot(mobile, '11-mobile-sheet');
await mobile.evaluate(() => document.querySelector('.sheet-scrim')?.click());
await new Promise((r) => setTimeout(r, 400));

await mobile.click('#btn-more');
await mobile.waitForSelector('.sheet');
await mobile.click('.sheet [data-action="audio"]');
await new Promise((r) => setTimeout(r, 600));
await shot(mobile, '12-mobile-panel');

/* ------------------------------------------------------- webcodecs engine */
const context = await browser.createBrowserContext();
const wc = await context.newPage();
await wc.setViewport({ width: 1440, height: 900 });
await wc.evaluateOnNewDocument(() => {
  localStorage.setItem('omniplay:settings:v1', JSON.stringify({ enginePreference: 'webcodecs', autoPlay: true, preferHardware: false }));
});
await wc.goto(`http://127.0.0.1:${PORT}/#/open`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 500));
const winput = await wc.$('input[type=file][accept*="video"]');
await winput.uploadFile(clip);
await wc.waitForSelector('.player canvas', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1800));
await shot(wc, '13-player-webcodecs');
await context.close();

await browser.close();
server.close();
console.log('done');
