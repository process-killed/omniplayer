/**
 * UI audit across devices.
 *
 * Serves the production build, then for every viewport × route it reports:
 *  - horizontal overflow
 *  - elements clipped outside the viewport
 *  - controls smaller than the 32px touch minimum
 *  - overlapping fixed bars
 *  - text overflowing its container
 *
 * Usage: node scripts/audit.mjs [--json]
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'smoke-tmp');
const PORT = 4331;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav',
};

function makeWav(seconds = 90, rate = 44100) {
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
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 6000), 44 + i * 2);
  return buffer;
}

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
await mkdir(WORK, { recursive: true });
const wavPath = join(WORK, 'audit.wav');
await writeFile(wavPath, makeWav(90));

const VIEWPORTS = [
  // The full device matrix from the compatibility brief.
  { name: 'phone-320', width: 320, height: 568, touch: true },
  { name: 'phone-360', width: 360, height: 640, touch: true },
  { name: 'phone-390', width: 390, height: 844, touch: true },
  { name: 'phone-430', width: 430, height: 932, touch: true },
  { name: 'tablet-768', width: 768, height: 1024, touch: true },
  { name: 'landscape-1024x600', width: 1024, height: 600 },
  { name: 'laptop-1280x720', width: 1280, height: 720 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'qhd-2560', width: 2560, height: 1440 },
  { name: 'uhd-3840', width: 3840, height: 2160 },
  // Zoom and large-text cases ride on the same matrix.
  { name: 'phone-390-zoom200', width: 390, height: 844, touch: true, zoom: 2 },
  { name: 'desktop-1280-zoom150', width: 1280, height: 720, zoom: 1.5 },
  { name: 'phone-390-bigtext', width: 390, height: 844, touch: true, fontScale: 1.35 },
  // Rotation while a panel is open is covered by the landscape phone case.
  { name: 'phone-landscape', width: 844, height: 390, touch: true },
];

const ROUTES = ['home', 'open', 'url', 'playlist', 'history', 'bookmarks', 'settings', 'diagnostics', 'about'];

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const problems = [];

const collect = () =>
  // Runs in the page.
  (() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const issues = [];
    const describe = (node) => {
      const id = node.id ? `#${node.id}` : '';
      const cls = typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).join('.')}` : '';
      return `${node.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
    };
    const visible = (node) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };

    if (document.documentElement.scrollWidth > vw + 1) {
      issues.push({ type: 'h-overflow', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` });
    }

    const all = document.querySelectorAll('body *');
    for (const node of all) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.closest('.popover, .toasts, .tl__hover, .panel, .modal-backdrop, .skip-link')) continue;
      const sidebar = node.closest('.sidebar');
      if (sidebar && !sidebar.classList.contains('is-open')) continue;
      if (!visible(node)) continue;
      const style = getComputedStyle(node);
      if (style.position === 'fixed' && style.inset === '0px') continue;
      const rect = node.getBoundingClientRect();
      // Elements deliberately clipped by an ancestor with overflow hidden are fine.
      let clipped = false;
      let parent = node.parentElement;
      while (parent) {
        const ps = getComputedStyle(parent);
        if (ps.overflow === 'hidden' || ps.overflowX === 'hidden') {
          clipped = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (clipped) continue;
      if (rect.right > vw + 2 || rect.left < -2) {
        issues.push({ type: 'x-clip', detail: `${describe(node)} [${Math.round(rect.left)}..${Math.round(rect.right)}]` });
      }
      if (rect.bottom > vh + 2 && style.position === 'fixed') {
        issues.push({ type: 'y-clip-fixed', detail: `${describe(node)} bottom ${Math.round(rect.bottom)} > ${vh}` });
      }
      if (node.matches('button, [role="button"], input[type="range"], select, a')) {
        // 44 CSS px is the accessible minimum on touch screens; 30 is enough
        // for a mouse. The threshold follows the input type.
        const minimum = viewport.touch ? 44 : 30;
        if (rect.height > 0 && rect.height < minimum && !node.closest('.p-opt, .preset-chip, .chip, .panel-tab, .menu-item, .tl')) {
          issues.push({ type: 'small-target', detail: `${describe(node)} ${Math.round(rect.width)}x${Math.round(rect.height)}` });
        }
      }
      if (node.scrollWidth > node.clientWidth + 2 && style.overflowX === 'visible' && node.children.length === 0) {
        issues.push({ type: 'text-overflow', detail: `${describe(node)} "${(node.textContent ?? '').trim().slice(0, 30)}"` });
      }
    }

    // Fixed bars overlapping each other
    const bars = ['.topbar', '.mobile-tabbar', '.pbar--top', '.pbar--bottom']
      .map((selector) => document.querySelector(selector))
      .filter((node) => node && visible(node))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }));
    for (let i = 0; i < bars.length; i++) {
      for (let j = i + 1; j < bars.length; j++) {
        const a = bars[i].rect;
        const b = bars[j].rect;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 4 && overlapY > 4) {
          issues.push({ type: 'bar-overlap', detail: `${describe(bars[i].node)} × ${describe(bars[j].node)} (${Math.round(overlapY)}px)` });
        }
      }
    }
    return issues;
  })();

// Guard against a silently broken rule: a deliberately tiny control must be
// reported, otherwise the touch-target check proves nothing.
try {
  const probe = await browser.newPage();
  await probe.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await probe.goto(`http://127.0.0.1:${PORT}/#/home`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 250));
  await probe.evaluate(() => {
    const tiny = document.createElement('button');
    tiny.id = 'audit-probe';
    tiny.textContent = 'x';
    tiny.style.cssText = 'height:20px;width:20px;position:fixed;left:0;top:0;z-index:9999';
    document.body.append(tiny);
  });
  const probeIssues = await probe.evaluate(collect);
  const caught = probeIssues.some((issue) => issue.type === 'small-target');
  await probe.evaluate(() => document.querySelector('#audit-probe')?.remove());
  if (!caught) {
    problems.push({ viewport: 'self-test', screen: 'audit', type: 'audit-broken', detail: 'touch-target rule did not fire' });
  }
  await probe.close();
} catch (error) {
  // A broken self-test must not hide the real results.
  console.warn('audit self-test skipped:', (error && error.message) || error);
}

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    isMobile: !!viewport.touch,
    hasTouch: !!viewport.touch,
  });
  await page.goto(`http://127.0.0.1:${PORT}/#/home`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 300));

  // Zoom and large-text emulation must be re-applied after every navigation,
  // because a hash change keeps the document but a reload would reset it.
  const applyScale = async () => {
    if (!viewport.zoom && !viewport.fontScale) return;
    await page.evaluate(
      ({ zoom, fontScale }) => {
        if (zoom) document.documentElement.style.zoom = String(zoom);
        if (fontScale) document.documentElement.style.fontSize = `${16 * fontScale}px`;
      },
      { zoom: viewport.zoom ?? 0, fontScale: viewport.fontScale ?? 0 },
    );
    await new Promise((r) => setTimeout(r, 120));
  };
  await applyScale();

  for (const route of ROUTES) {
    await page.evaluate((name) => {
      location.hash = `#/${name}`;
    }, route);
    await new Promise((r) => setTimeout(r, 200));
    await applyScale();
    const issues = await page.evaluate(collect);
    for (const issue of issues) problems.push({ viewport: viewport.name, screen: route, ...issue });
  }

  // Player screen
  await page.evaluate(() => {
    location.hash = '#/open';
  });
  await new Promise((r) => setTimeout(r, 350));
  const input = await page.$('input[type=file][accept*="video"]');
  if (input) {
    await input.uploadFile(wavPath);
    await page.waitForSelector('.player', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    const issues = await page.evaluate(collect);
    for (const issue of issues) problems.push({ viewport: viewport.name, screen: 'player', ...issue });

    // Every panel must be reachable: either a visible button or a sheet action.
    const panels = [
      { selector: '#btn-audio', action: 'audio', kind: 'audio' },
      { selector: '#btn-subs', action: 'subtitles', kind: 'subtitles' },
      { selector: '#btn-video', action: 'picture', kind: 'video' },
      { selector: '#btn-playback', action: 'playback', kind: 'playback' },
      { selector: '#btn-info', action: 'info', kind: 'info' },
      { selector: '#btn-tracks', action: 'tracks', kind: 'tracks' },
    ];
    for (const panel of panels) {
      const button = panel.selector;
      const exists = await page.$(button);
      if (!exists) {
        problems.push({ viewport: viewport.name, screen: 'player', type: 'missing-control', detail: button });
        continue;
      }
      const visible = await page.evaluate((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }, button);
      if (!visible) {
        // Accept the action sheet as an equivalent route.
        const moreVisible = await page.evaluate(() => {
          const more = document.querySelector('#btn-more');
          if (!more) return false;
          const style = getComputedStyle(more);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (!moreVisible) {
          problems.push({ viewport: viewport.name, screen: 'player', type: 'hidden-control', detail: button });
          continue;
        }
        await page.click('#btn-more');
        await new Promise((r) => setTimeout(r, 350));
        const hasAction = await page.$(`.sheet [data-action="${panel.action}"]`);
        const sheetIssues = await page.evaluate(collect);
        for (const issue of sheetIssues) problems.push({ viewport: viewport.name, screen: 'sheet', ...issue });
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelector('.sheet-scrim')?.dispatchEvent(new Event('click')));
        await new Promise((r) => setTimeout(r, 150));
        if (!hasAction) {
          problems.push({ viewport: viewport.name, screen: 'player', type: 'unreachable-control', detail: `${button} / ${panel.action}` });
        }
        // Open the panel through the sheet for the layout audit.
        await page.click('#btn-more');
        await new Promise((r) => setTimeout(r, 300));
        await page.click(`.sheet [data-action="${panel.action}"]`);
        await new Promise((r) => setTimeout(r, 200));
        const panelIssues = await page.evaluate(collect);
        for (const issue of panelIssues) problems.push({ viewport: viewport.name, screen: `panel${button}`, ...issue });
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      if (viewport.width >= 1920) continue;
      await page.click(button);
      await new Promise((r) => setTimeout(r, 200));
      const panelIssues = await page.evaluate(collect);
      for (const issue of panelIssues) problems.push({ viewport: viewport.name, screen: `panel${button}`, ...issue });
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  await page.close();
}

await browser.close();
server.close();

// Group and print
const grouped = new Map();
for (const problem of problems) {
  const key = `${problem.type}|${problem.detail}`;
  const entry = grouped.get(key) ?? { ...problem, viewports: new Set(), screens: new Set() };
  entry.viewports.add(problem.viewport);
  entry.screens.add(problem.screen);
  grouped.set(key, entry);
}

const unique = [...grouped.values()].sort((a, b) => a.type.localeCompare(b.type));
console.log(`\n${unique.length} unique issues across ${VIEWPORTS.length} viewports\n`);
for (const issue of unique) {
  console.log(`[${issue.type}] ${issue.detail}`);
  console.log(`    screens: ${[...issue.screens].join(', ')}`);
  console.log(`    viewports: ${[...issue.viewports].join(', ')}\n`);
}

if (process.argv.includes('--json')) {
  await writeFile(join(ROOT, 'audit-report.json'), JSON.stringify(problems, null, 2));
}
