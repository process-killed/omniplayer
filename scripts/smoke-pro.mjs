/**
 * Pro features test: danmaku, stats overlay, context menu, shortcuts, lock.
 * Uses a real video so the danmaku layer has something to fly over.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4410;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.webm': 'video/webm', '.xml': 'application/xml',
};

const clipPath = join(WORK, 'demo.webm');
if (!existsSync(clipPath)) {
  console.error('Missing demo.webm. Run: node scripts/make-demo-clip.mjs');
  process.exit(1);
}
const clip = await readFile(clipPath);

const DANMAKU_XML = `<?xml version="1.0" encoding="UTF-8"?>
<i>
  <d p="0.5,1,25,16777215,0,0,a,1">First bullet</d>
  <d p="0.8,1,25,16711680,0,0,b,2">Second bullet</d>
  <d p="1.1,5,25,65280,0,0,c,3">Top comment</d>
  <d p="1.4,4,25,255,0,0,d,4">Bottom comment</d>
  <d p="1.7,1,25,16777215,0,0,e,5">Third bullet</d>
</i>`;
const xmlPath = join(WORK, 'danmaku.xml');
await writeFile(xmlPath, DANMAKU_XML);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/demo.webm') {
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

  const openPlayer = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/#/open`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 400));
    const input = await page.$('input[type=file][accept*="video"]');
    await input.uploadFile(clipPath);
    await page.waitForSelector('.player video', { timeout: 20000 });
    await page
      .waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.1, { timeout: 20000 })
      .catch(() => undefined);
  };

  console.log('\nDanmaku');
  await openPlayer();
  await page.click('#btn-danmaku');
  await page.waitForSelector('.panel', { timeout: 10000 });
  // Rewind so the imported comments actually fly past.
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (video) video.currentTime = 0;
  });
  const fileInput = await page.$('.panel input[type=file][accept*="xml"]');
  await fileInput.uploadFile(xmlPath);
  // Wait until the top-mode comment (1.1 s) has actually been spawned.
  await page
    .waitForFunction(() => document.querySelectorAll('.danmaku--top').length > 0, { timeout: 12000 })
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  const danmakuState = await page.evaluate(() => ({
    debugTime: document.querySelector('.time-row b')?.textContent,
    panel: document.querySelector('.panel__head h2')?.textContent,
    inputs: Array.from(document.querySelectorAll('.panel input[type=file]')).map((node) => node.accept),
    enabled: document.querySelector('#btn-danmaku')?.getAttribute('aria-pressed'),
    nodes: document.querySelectorAll('.danmaku').length,
    modes: Array.from(document.querySelectorAll('.danmaku')).map((node) => node.className),
    panelText: document.querySelector('.panel')?.textContent?.slice(0, 60),
  }));
  console.log('      state:', JSON.stringify(danmakuState).slice(0, 300));
  check(danmakuState.enabled === 'true', 'danmaku button reports pressed');
  check(danmakuState.nodes > 0, `comments rendered (${danmakuState.nodes})`);
  check(danmakuState.modes.some((cls) => cls.includes('danmaku--top')), 'top-mode comment rendered');

  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await new Promise((r) => setTimeout(r, 400));
  const off = await page.evaluate(() => ({
    pressed: document.querySelector('#btn-danmaku')?.getAttribute('aria-pressed'),
    nodes: document.querySelectorAll('.danmaku').length,
  }));
  check(off.pressed === 'false', 'D toggles danmaku off');
  check(off.nodes === 0, 'comments cleared when disabled');
  await page.keyboard.press('d');
  await new Promise((r) => setTimeout(r, 300));

  console.log('\nStats overlay');
  await page.keyboard.press('i');
  await new Promise((r) => setTimeout(r, 900));
  const stats = await page.evaluate(() => ({
    visible: !document.querySelector('#stats-overlay')?.classList.contains('hidden'),
    text: document.querySelector('#stats-overlay')?.textContent ?? '',
  }));
  check(stats.visible, 'stats overlay shown with I');
  check(stats.text.includes('engine') && stats.text.includes('buffer'), 'stats overlay has live data');
  await page.keyboard.press('i');
  await new Promise((r) => setTimeout(r, 300));
  check(
    await page.evaluate(() => document.querySelector('#stats-overlay')?.classList.contains('hidden')),
    'stats overlay hides again',
  );

  console.log('\nContext menu');
  const box = await page.$eval('.player__stage', (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForSelector('.ctx-menu', { timeout: 5000 });
  const menu = await page.evaluate(() => ({
    items: Array.from(document.querySelectorAll('.ctx-item')).map((node) => node.textContent?.trim() ?? ''),
  }));
  check(menu.items.length >= 8, `context menu has ${menu.items.length} entries`);
  check(menu.items.some((item) => item.includes('Screenshot')), 'screenshot entry present');
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.ctx-item')).find((node) => node.textContent?.includes('Stats for nerds'));
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 700));
  check(
    await page.evaluate(() => !document.querySelector('#stats-overlay')?.classList.contains('hidden')),
    'context menu opens the stats overlay',
  );
  await page.keyboard.press('i');

  console.log('\nShortcuts sheet');
  await page.keyboard.press('?');
  await page.waitForSelector('.shortcuts', { timeout: 5000 });
  const shortcuts = await page.evaluate(() => ({
    rows: document.querySelectorAll('.shortcuts__grid span').length,
    first: document.querySelector('.shortcuts__grid span')?.textContent ?? '',
  }));
  check(shortcuts.rows >= 10, `${shortcuts.rows} shortcuts listed`);
  check(shortcuts.first.length > 0, `first shortcut: ${shortcuts.first}`);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  check((await page.$('.shortcuts')) === null, 'Escape closes the sheet');

  console.log('\nLock screen');
  await page.evaluate((point) => {
    document.querySelector('.player__stage')?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y }),
    );
  }, box);
  await page.waitForSelector('.ctx-menu', { timeout: 5000 });
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.ctx-item')).find((node) => node.textContent?.includes('Lock screen'));
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 500));
  const locked = await page.evaluate(() => ({
    locked: document.querySelector('.player')?.classList.contains('is-locked'),
    badge: !!document.querySelector('.lock-badge'),
    barsHidden: Array.from(document.querySelectorAll('.pbar')).every((node) => Number(getComputedStyle(node).opacity) < 0.1),
  }));
  check(locked.locked, 'player locked');
  check(locked.badge, 'unlock badge shown');
  check(locked.barsHidden, 'controls hidden while locked');
  await page.click('.lock-badge');
  await new Promise((r) => setTimeout(r, 400));
  check(
    await page.evaluate(() => !document.querySelector('.player')?.classList.contains('is-locked')),
    'unlock restores the controls',
  );

  check(errors.length === 0, `no page errors (${errors.length})`);
  errors.slice(0, 4).forEach((message) => console.log('      ' + message));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'PRO TEST PASSED' : `PRO TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
