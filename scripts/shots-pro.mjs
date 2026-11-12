import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT=new URL('..',import.meta.url).pathname; const DIST=join(ROOT,'dist'); const WORK=join(ROOT,'smoke-tmp'); const OUT=join(ROOT,'shots'); const PORT=4412;
const clip = await readFile(join(WORK,'demo.webm'));
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.webm':'video/webm'};
const xml = `<?xml version="1.0"?><i>
<d p="0.3,1,25,16777215,0,0,a,1">This opening is gorgeous</d>
<d p="0.5,1,25,255,0,0,b,2">Wait for the drop</d>
<d p="0.8,5,25,16711680,0,0,c,3">EPISODE 1 — SUBBED</d>
<d p="1.0,1,25,65280,0,0,d,4">goosebumps every time</d>
<d p="1.2,1,25,16776960,0,0,e,5">the animation budget is unreal</d>
<d p="1.5,4,25,16777215,0,0,f,6">subs by the community</d>
<d p="1.8,1,25,16711935,0,0,g,7">rewatching for the 5th time</d>
<d p="2.1,1,25,16777215,0,0,h,8">that soundtrack though</d>
</i>`;
const xmlPath=join(WORK,'shots-danmaku.xml'); await writeFile(xmlPath, xml);
const server=createServer(async(req,res)=>{ const u=new URL(req.url,'http://x');
  if(u.pathname==='/demo.webm'){ const r=req.headers.range; let s=0,e=clip.length-1; if(r){const m=/bytes=(\d*)-(\d*)/.exec(r); if(m){s=Number(m[1]||0); e=m[2]?Math.min(Number(m[2]),clip.length-1):clip.length-1;}} const b=clip.subarray(s,e+1); res.writeHead(r?206:200,{'Content-Type':'video/webm','Content-Length':String(b.length),'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*',...(r?{'Content-Range':`bytes ${s}-${e}/${clip.length}`}:{})}); res.end(req.method==='HEAD'?undefined:b); return; }
  let p=normalize(decodeURIComponent(u.pathname)); if(p==='/')p='/index.html';
  try{const b=await readFile(join(DIST,p));res.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/local/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required','--mute-audio']});
const page=await browser.newPage(); await page.setViewport({width:1280,height:760});
await page.goto(`http://127.0.0.1:${PORT}/#/open`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,400));
const input=await page.$('input[type=file][accept*="video"]'); await input.uploadFile(join(WORK,'demo.webm'));
await page.waitForSelector('.player video'); await new Promise(r=>setTimeout(r,1200));
await page.click('#btn-danmaku'); await new Promise(r=>setTimeout(r,700));
await page.evaluate(()=>{ const v=document.querySelector('video'); if(v) v.currentTime=0; });
const fi=await page.$('.panel input[type=file][accept*="xml"]'); await fi.uploadFile(xmlPath);
await page.keyboard.press('Escape');
await page.waitForFunction(()=>document.querySelectorAll('.danmaku').length>=4,{timeout:12000}).catch(()=>undefined);
await new Promise(r=>setTimeout(r,600));
await page.screenshot({path:join(OUT,'23-danmaku.png')});
console.log('shot danmaku');
await page.keyboard.press('i'); await new Promise(r=>setTimeout(r,900));
await page.screenshot({path:join(OUT,'24-stats.png')});
console.log('shot stats');
await page.evaluate(()=>{ document.querySelector('.player__stage')?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:640,clientY:380})); });
await new Promise(r=>setTimeout(r,400));
await page.screenshot({path:join(OUT,'25-context-menu.png')});
console.log('shot context');
await page.keyboard.press('Escape');
await page.keyboard.press('?'); await new Promise(r=>setTimeout(r,500));
await page.screenshot({path:join(OUT,'26-shortcuts.png')});
console.log('shot shortcuts');
await browser.close(); server.close();
