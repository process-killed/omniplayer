/**
 * Long-text layout test: signed links are hundreds of characters and must never
 * push the layout off-screen on a phone or a desktop.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const PORT = 4390;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (req, res) => {
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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const LONG = `https://5cf443a1e229c0b4715020b95fafcbc9.r2.cloudflarestorage.com/hub2/f2a8b19f020e491e09a6a7d78756296f?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=73154f7d03f398dbc4ecfff413ad3db3%2F20261107%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261107T031730Z&X-Amz-Expires=28800&response-content-disposition=attachment%3B%20filename%3D%22%5BAnimeDubHindi%5D%20Firefly%20Wedding%20S01E01%20480p%20x264%20WEB-DL%20Multi%20Audio%20ESub.mkv%22&X-Amz-Signature=20cacce55388d513ebbcc9bc6c7e7db5f4f6176b5a2ac4519924a89d86e0507a`;

// A real file with an absurd filename, to fill history/bookmarks.
const LONG_NAME = `${'[Group] Very Long Release Name '.repeat(6)}1080p Multi Audio ESub.mkv`;
const wavPath = join(ROOT, 'smoke-tmp', LONG_NAME);
function makeWav(seconds = 6) {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.sin((i / rate) * 440 * 2 * Math.PI) * 8000, 44 + i * 2);
  return buffer;
}

await writeFile(wavPath, makeWav());

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

const measure = (page) =>
  page.evaluate(() => {
    const viewport = window.innerWidth;
    const offenders = [];
    document.querySelectorAll('body *').forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.right > viewport + 1 || rect.left < -1) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed' || style.visibility === 'hidden') return;
        offenders.push({
          tag: node.tagName.toLowerCase(),
          cls: (node.className || '').toString().slice(0, 40),
          right: Math.round(rect.right),
        });
      }
    });
    // Element-level clipping: text that cannot fit its own box.
    const clipped = [];
    document.querySelectorAll('h1, h2, h3, p, span, div, code, td, li, .badge-soft, .chip').forEach((node) => {
      if (node.children.length > 0) return;
      if (!node.textContent || node.textContent.trim().length < 24) return;
      if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0) {
        const style = getComputedStyle(node);
        if (style.overflowX !== 'hidden' && style.textOverflow !== 'ellipsis') {
          clipped.push({
            tag: node.tagName.toLowerCase(),
            cls: (node.className || '').toString().slice(0, 32),
            scroll: node.scrollWidth,
            client: node.clientWidth,
          });
        }
      }
    });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewport,
      offenders: offenders.slice(0, 6),
      clipped: clipped.slice(0, 6),
    };
  });

try {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844, deviceScaleFactor: 2 }],
    ['desktop', { width: 1280, height: 800 }],
  ]) {
    console.log(`\n${name}`);
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(`http://127.0.0.1:${PORT}/#/url`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 500));

    // Long link typed into the URL page
    await page.evaluate((value) => {
      const input = document.querySelector('input[type=url]');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, LONG);
    await new Promise((r) => setTimeout(r, 300));
    let result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `url page stays inside the viewport (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `url page text is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    // Submit → player with a long title and a failing (blocked) link
    await page.keyboard.press('Enter');
    await page.waitForSelector('.player', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `player stays inside the viewport (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `player text is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    // The URL page now lists the recent link
    await page.evaluate(() => {
      location.hash = '#/url';
    });
    await new Promise((r) => setTimeout(r, 900));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `url page with recents fits (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `recent links are not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    // Diagnostics shows the last source
    await page.evaluate(() => {
      location.hash = '#/diagnostics';
    });
    await new Promise((r) => setTimeout(r, 900));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `diagnostics fits (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `diagnostics text is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    // Home shows the recent entry
    await page.evaluate(() => {
      location.hash = '#/home';
    });
    await new Promise((r) => setTimeout(r, 800));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `home stays inside the viewport (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `home text is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    // Embed builder with the same long link
    await page.evaluate((value) => {
      location.hash = `#/share?src=${encodeURIComponent(value)}`;
    }, LONG);
    await new Promise((r) => setTimeout(r, 900));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `embed builder stays inside the viewport (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `embed builder text is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    // Embed player itself
    await page.evaluate((value) => {
      location.hash = `#/embed?src=${encodeURIComponent(value)}&autoplay=0`;
    }, LONG);
    await new Promise((r) => setTimeout(r, 2500));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `embed player stays inside the viewport (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));

    // A file with an absurd name fills history, bookmarks and the player title.
    await page.evaluate(() => {
      location.hash = '#/open';
    });
    await new Promise((r) => setTimeout(r, 600));
    const input = await page.$('input[type=file][accept*="video"]');
    await input.uploadFile(wavPath);
    await page.waitForSelector('.player video', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    result = await measure(page);
    check(result.scrollWidth <= result.viewport + 1, `player with a long filename fits (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
    check(result.clipped.length === 0, `long filename is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));

    for (const route of ['home', 'history', 'bookmarks', 'diagnostics']) {
      await page.evaluate((name) => {
        location.hash = `#/${name}`;
      }, route);
      await new Promise((r) => setTimeout(r, 900));
      result = await measure(page);
      check(result.scrollWidth <= result.viewport + 1, `${route} fits with long names (${result.scrollWidth}/${result.viewport})`, JSON.stringify(result.offenders));
      check(result.clipped.length === 0, `${route} text is not clipped (${result.clipped.length})`, JSON.stringify(result.clipped));
    }

    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'LONGTEXT TEST PASSED' : `LONGTEXT TEST FAILED (${failures.length})`}`);
if (failures.length) process.exitCode = 1;
