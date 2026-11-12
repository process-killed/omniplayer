/**
 * Records a short animated WebM with Chrome's MediaRecorder.
 * Used by the screenshot script and handy for manual testing (no ffmpeg needed).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'smoke-tmp', 'demo.webm');

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--mute-audio'],
});
const page = await browser.newPage();
await page.goto('data:text/html,<canvas id=c width=1280 height=720></canvas>');

const base64 = await page.evaluate(async () => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 3_000_000 });
  rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => (rec.onstop = resolve));
  rec.start(200);
  const started = performance.now();

  await new Promise((resolve) => {
    const draw = () => {
      const t = (performance.now() - started) / 1000;
      const g = ctx.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, `hsl(${(200 + t * 12) % 360} 60% 18%)`);
      g.addColorStop(1, `hsl(${(280 + t * 12) % 360} 65% 32%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 720);

      // soft moving orbs
      for (let i = 0; i < 3; i++) {
        const x = 640 + Math.cos(t * 0.6 + i * 2) * 320;
        const y = 360 + Math.sin(t * 0.8 + i * 1.7) * 200;
        const r = 180 + Math.sin(t + i) * 40;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, `hsla(${(160 + i * 60 + t * 20) % 360} 80% 60% / 0.35)`);
        rg.addColorStop(1, 'transparent');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.font = '700 84px sans-serif';
      ctx.fillText('OmniPlay', 90, 300);
      ctx.font = '500 34px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Universal browser media engine', 92, 360);
      ctx.font = '700 26px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`t = ${t.toFixed(1)}s`, 92, 430);

      // progress bar
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(90, 660, 1100, 6);
      ctx.fillStyle = '#8b7dff';
      ctx.fillRect(90, 660, (t / 20) * 1100, 6);

      if (t < 20) requestAnimationFrame(draw);
      else resolve();
    };
    draw();
  });

  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
});

await mkdir(join(ROOT, 'smoke-tmp'), { recursive: true });
const buffer = Buffer.from(base64, 'base64');
await writeFile(OUT, buffer);
console.log(`wrote ${OUT} (${(buffer.length / 1024).toFixed(0)} KB)`);
await browser.close();
