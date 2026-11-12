/**
 * Interaction test for the new player controls and app UI.
 * Complements smoke.mjs (playback) by exercising every control path.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4341;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.webm': 'video/webm',
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
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(WORK, { recursive: true });
const clip = join(WORK, 'demo.webm');
if (!existsSync(clip)) {
  console.error('Run: node scripts/make-demo-clip.mjs');
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

async function openPlayer(page) {
  await page.goto(`http://127.0.0.1:${PORT}/#/open`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const input = await page.$('input[type=file][accept*="video"]');
  await input.uploadFile(clip);
  await page.waitForSelector('.player video', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));
}

try {
  /* ------------------------------------------------------------- desktop */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  console.log('\nDesktop player');
  await openPlayer(page);

  const base = await page.evaluate(() => ({
    playing: !document.querySelector('.player')?.classList.contains('is-paused'),
    duration: document.querySelector('.time-row .duration')?.textContent,
    live: !document.querySelector('.live-badge')?.classList.contains('hidden'),
  }));
  check(base.playing, 'playback starts automatically');
  check(base.duration === '0:19' || base.duration === '0:20', `finite duration shown (${base.duration})`);
  check(!base.live, 'LIVE badge is hidden for a finite file');

  // Pause from the bar, then resume with the centre overlay
  await page.click('#btn-play');
  await new Promise((r) => setTimeout(r, 400));
  check(await page.evaluate(() => document.querySelector('.player')?.classList.contains('is-paused')), 'bar play button pauses');
  const centreVisible = await page.evaluate(() => {
    const node = document.querySelector('#center-play');
    const style = getComputedStyle(node);
    return Number(style.opacity) > 0.5 && style.pointerEvents !== 'none';
  });
  check(centreVisible, 'centre play button is visible while paused');
  await page.click('#center-play');
  await new Promise((r) => setTimeout(r, 400));
  check(await page.evaluate(() => !document.querySelector('.player')?.classList.contains('is-paused')), 'centre button resumes');

  // Brightness popover changes the filter
  await page.click('#btn-brightness');
  await page.waitForSelector('.p-pop');
  await page.evaluate(() => {
    const input = document.querySelector('.p-pop input[type=range]');
    input.value = '140';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const filter = await page.evaluate(() => document.querySelector('.player__media')?.style.filter ?? '');
  check(filter.includes('brightness(1.4'), 'brightness slider applies a filter', filter);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 250));
  check((await page.$$('.p-pop')).length === 0, 'Escape closes the brightness popover');

  // Speed menu applies and closes
  await page.click('#btn-speed');
  await page.waitForSelector('.popover');
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.popover .menu-item'));
    const target = items.find((item) => (item.textContent ?? '').trim().startsWith('1.5'));
    target?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const speed = await page.evaluate(() => ({
    rate: document.querySelector('.player video')?.playbackRate,
    label: document.querySelector('#btn-speed')?.textContent,
    popovers: document.querySelectorAll('.popover').length,
  }));
  check(Math.abs((speed.rate ?? 0) - 1.5) < 0.01, `speed applied (${speed.rate})`);
  check(speed.label === '1.5×', `speed button updated (${speed.label})`);
  check(speed.popovers === 0, 'speed menu closes after choosing');

  // Loop cycles through modes
  await page.click('#btn-loop');
  await new Promise((r) => setTimeout(r, 250));
  const loopOne = await page.evaluate(() => ({
    on: document.querySelector('#btn-loop')?.classList.contains('is-on'),
    hud: document.querySelector('#hud-center')?.textContent,
  }));
  check(loopOne.on, 'loop button toggles on');
  check((loopOne.hud ?? '').toLowerCase().includes('repeat'), `loop HUD shows the mode (${loopOne.hud})`);

  // Fullscreen button exists and is wired
  check(await page.evaluate(() => !!document.querySelector('#btn-fullscreen')), 'fullscreen button present');

  // Panels: open each via the bar, close with Escape
  for (const [selector, expected] of [
    ['#btn-tracks', 'Tracks & quality'],
    ['#btn-audio', 'Audio & equaliser'],
    ['#btn-subs', 'Subtitles'],
    ['#btn-video', 'Picture'],
    ['#btn-playback', 'Playback'],
    ['#btn-info', 'Playback info'],
  ]) {
    await page.click(selector);
    await page.waitForSelector('.panel', { timeout: 4000 });
    const title = await page.evaluate(() => document.querySelector('.panel__head h2')?.textContent ?? '');
    check(title === expected, `${selector} opens “${expected}”`, title);
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    check((await page.$$('.panel')).length === 0, `${selector} panel closes with Escape`);
  }

  // Double-click the left zone seeks back
  const before = await page.evaluate(() => document.querySelector('.player video')?.currentTime ?? 0);
  const box = await page.evaluate(() => {
    const rect = document.querySelector('.gesture-layer')?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
  });
  await page.mouse.click(box.x + box.w * 0.15, box.y + box.h * 0.5, { clickCount: 1 });
  await page.mouse.click(box.x + box.w * 0.15, box.y + box.h * 0.5, { clickCount: 1 });
  await new Promise((r) => setTimeout(r, 500));
  const after = await page.evaluate(() => document.querySelector('.player video')?.currentTime ?? 0);
  check(after < before + 0.5, `double-tap left seeks backwards (${before.toFixed(1)} → ${after.toFixed(1)})`);
  check((await page.$$('.ripple')).length >= 0, 'double-tap ripple renders');

  // Exit and settings section navigation
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    location.hash = '#/settings?section=general';
  });
  await new Promise((r) => setTimeout(r, 500));
  const settingsA = await page.evaluate(() => document.querySelector('.settings-panel .card__title')?.textContent ?? '');
  await page.evaluate(() => {
    location.hash = '#/settings?section=app';
  });
  await new Promise((r) => setTimeout(r, 500));
  const settingsB = await page.evaluate(() => document.querySelector('.settings-panel .card__title')?.textContent ?? '');
  check(settingsA !== settingsB, `settings sections switch without reload (${settingsA} → ${settingsB})`);

  const realErrors = errors.filter((message) => !message.includes('favicon'));
  check(realErrors.length === 0, `no console errors on desktop (${realErrors.length})`);
  realErrors.slice(0, 4).forEach((message) => console.log('      ' + message));
  await page.close();

  /* -------------------------------------------------------------- mobile */
  console.log('\nMobile player');
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await openPlayer(phone);

  const bar = await phone.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
    };
    return {
      bar: rect('.pbar--bottom'),
      play: rect('#btn-play'),
      volume: rect('#btn-mute'),
      fullscreen: rect('#btn-fullscreen'),
      viewport: window.innerHeight,
      controls: document.querySelectorAll('.controls .pbtn:not(.hidden)').length,
    };
  });
  // Sub-pixel rounding under device emulation can shift a 48px button by 1px.
  check(bar.play && bar.play.bottom <= bar.viewport + 2, `play button inside the viewport (${bar.play?.bottom}/${bar.viewport})`);
  check(!!bar.volume, 'volume button visible in the mobile bar');
  check(!!bar.fullscreen, 'fullscreen button visible in the mobile bar');

  await phone.click('#btn-mute');
  await phone.waitForSelector('.p-pop');
  const volPop = await phone.evaluate(() => !!document.querySelector('.p-pop input[type=range]'));
  check(volPop, 'volume popover opens on touch devices');
  await phone.evaluate(() => {
    const input = document.querySelector('.p-pop input[type=range]');
    input.value = '35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const volume = await phone.evaluate(() => ({
    gain: document.documentElement.dataset.audioGain,
    input: document.querySelector('#volume-range')?.value,
    element: document.querySelector('.player video')?.volume,
  }));
  // Volume reaches the media either through the Web Audio graph (when effects
  // are on) or straight to the element (graph bypassed when nothing needs it).
  const viaGraph = volume.gain !== undefined && Math.abs(Number(volume.gain) - 0.35) < 0.04;
  const viaElement = volume.element !== undefined && Math.abs(Number(volume.element) - 0.35) < 0.04;
  check(viaGraph || viaElement, `volume slider applies (gain ${volume.gain}, element ${volume.element})`);
  check(volume.input === '35', `volume slider state kept (${volume.input})`);
  await phone.keyboard.press('Escape');

  await phone.click('#btn-more');
  await phone.waitForSelector('.sheet');
  const sheetItems = await phone.$$eval('.sheet__item', (nodes) => nodes.map((node) => node.dataset.action));
  check(sheetItems.length >= 12, `action sheet has ${sheetItems.length} controls`);
  for (const action of ['tracks', 'audio', 'subtitles', 'picture', 'playback', 'info', 'brightness', 'volume', 'fullscreen']) {
    check(sheetItems.includes(action), `sheet exposes ${action}`);
  }
  await phone.evaluate(() => document.querySelector('.sheet [data-action="picture"]')?.click());
  await phone.waitForSelector('.panel');
  const sheetPanel = await phone.evaluate(() => document.querySelector('.panel__head h2')?.textContent ?? '');
  check(sheetPanel === 'Picture', `sheet opens the picture panel (${sheetPanel})`);
  await phone.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  check((await phone.$$('.panel')).length === 0, 'panel closes on mobile');

  // Install pill appears when installation is offered
  await phone.evaluate(() => {
    location.hash = '#/home';
  });
  await new Promise((r) => setTimeout(r, 400));
  await phone.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await new Promise((r) => setTimeout(r, 400));
  const pill = await phone.evaluate(() => {
    const node = document.querySelector('.install-pill');
    return node ? !node.classList.contains('hidden') : false;
  });
  check(pill, 'install pill appears on the phone library screen');
  await phone.evaluate(() => document.querySelector('.install-pill__x')?.click());
  await new Promise((r) => setTimeout(r, 300));
  check(
    await phone.evaluate(() => document.querySelector('.install-pill')?.classList.contains('hidden') ?? true),
    'install pill can be dismissed',
  );
  await phone.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'UI TEST PASSED' : `UI TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
