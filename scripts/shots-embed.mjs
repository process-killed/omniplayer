import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT=new URL('..',import.meta.url).pathname; const DIST=join(ROOT,'dist'); const WORK=join(ROOT,'smoke-tmp'); const OUT=join(ROOT,'shots');
const APP=4400, SITE=4401;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.webm':'video/webm'};
const clip = await readFile(join(WORK,'demo.webm'));
const app=createServer(async(req,res)=>{let p=normalize(decodeURIComponent(new URL(req.url,'http://x').pathname));if(p==='/')p='/index.html';try{const b=await readFile(join(DIST,p));res.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}});
const site=createServer(async(req,res)=>{ const u=new URL(req.url,'http://x');
  if(u.pathname==='/video.webm'){
    const range = req.headers.range;
    let start = 0, end = clip.length - 1;
    if (range) { const m = /bytes=(\d*)-(\d*)/.exec(range); if (m) { start = Number(m[1] || 0); end = m[2] ? Math.min(Number(m[2]), clip.length - 1) : clip.length - 1; } }
    const body = clip.subarray(start, end + 1);
    res.writeHead(range ? 206 : 200, {'Content-Type':'video/webm','Content-Length':String(body.length),'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges', ...(range ? {'Content-Range': `bytes ${start}-${end}/${clip.length}`} : {})});
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const embed=u.searchParams.get('embed')??'';
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end(`<!doctype html><html><body style="margin:0;background:#0b0d12;font-family:system-ui;color:#fff">
    <div style="padding:18px 22px;font-size:13px;color:#8b93a7">My streaming site — player embedded below</div>
    <iframe src="${embed}" style="width:100%;height:640px;border:0" allow="autoplay; fullscreen" allowfullscreen></iframe>
  </body></html>`);
});
await new Promise(r=>app.listen(APP,'127.0.0.1',r)); await new Promise(r=>site.listen(SITE,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/local/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required','--mute-audio']});

const desktop=await browser.newPage(); await desktop.setViewport({width:1280,height:900});
await desktop.goto(`http://127.0.0.1:${APP}/#/share?src=${encodeURIComponent(`http://127.0.0.1:${SITE}/video.webm`)}`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500));
await desktop.screenshot({path:join(OUT,'20-share-desktop.png')});
console.log('shot share desktop');

const mobile=await browser.newPage(); await mobile.setViewport({width:390,height:844,deviceScaleFactor:2});
await mobile.goto(`http://127.0.0.1:${APP}/#/share?src=${encodeURIComponent(`http://127.0.0.1:${SITE}/video.webm`)}`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500));
await mobile.screenshot({path:join(OUT,'21-share-mobile.png')});
console.log('shot share mobile');

const host=await browser.newPage(); await host.setViewport({width:1100,height:760});
host.on('console', m => { const t = m.text(); if (t.includes('DBG') || m.type() === 'error') console.log('embed console:', t.slice(0, 120)); });
const embed=`http://127.0.0.1:${APP}/#/embed?src=${encodeURIComponent(`http://127.0.0.1:${SITE}/video.webm`)}&autoplay=1&muted=1&title=Firefly%20Wedding%20S01E01`;
await host.goto(`http://127.0.0.1:${SITE}/?embed=${encodeURIComponent(embed)}`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,7000));
const fr = (await (await host.$('#none')) ? null : null);
for (const frame of host.frames()) {
  if (frame.url().includes('/#/embed')) {
    console.log('frame state', await frame.evaluate(() => {
      const canvas = document.querySelector('.player canvas');
      let painted = 0;
      try {
        const probe = document.createElement('canvas');
        probe.width = 16; probe.height = 16;
        const ctx = probe.getContext('2d');
        ctx.drawImage(canvas, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        for (let i = 0; i < data.length; i += 4) painted += data[i] + data[i + 1] + data[i + 2];
      } catch (e) { painted = -1; }
      const rect = canvas?.getBoundingClientRect();
      return {
        time: document.querySelector('.time-row b')?.textContent,
        dur: document.querySelector('.time-row .duration')?.textContent,
        engine: document.querySelector('#engine-badge')?.textContent,
        canvas: canvas ? `${canvas.width}x${canvas.height} css ${Math.round(rect.width)}x${Math.round(rect.height)}` : 'none',
        painted,
      };
    }));
  }
}
await host.screenshot({path:join(OUT,'22-embed-iframe.png')});
console.log('shot embed iframe');

await browser.close(); app.close(); site.close();
