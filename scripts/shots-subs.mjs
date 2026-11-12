import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT=new URL('..',import.meta.url).pathname; const DIST=join(ROOT,'dist'); const WORK=join(ROOT,'smoke-tmp'); const OUT=join(ROOT,'shots'); const PORT=4361;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.mkv':'video/x-matroska'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  if(url.pathname==='/embedded.mkv'){const b=await readFile(join(WORK,'embedded-subs.mkv'));res.writeHead(200,{'Content-Type':'video/x-matroska','Content-Length':String(b.length),'Accept-Ranges':'bytes'});res.end(b);return;}
  let p=normalize(decodeURIComponent(url.pathname)); if(p==='/')p='/index.html';
  try{const b=await readFile(join(DIST,p));res.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/local/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required','--mute-audio']});
const page=await browser.newPage(); await page.setViewport({width:1440,height:900});
await page.goto(`http://127.0.0.1:${PORT}/#/open`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,500));
const input=await page.$('input[type=file][accept*="video"]'); await input.uploadFile(join(WORK,'embedded-subs.mkv'));
await page.waitForSelector('.player canvas'); await new Promise(r=>setTimeout(r,2500));
await page.click('#btn-subs'); await new Promise(r=>setTimeout(r,1200));
await page.screenshot({path:join(OUT,'16-embedded-tracks.png')});
console.log('shot 16-embedded-tracks');
// load ASS, seek into a cue, pause for a clean frame
await page.evaluate(()=>{const rows=[...document.querySelectorAll('.panel .track-item')]; rows.find(r=>r.textContent.includes('ASS'))?.click();});
await new Promise(r=>setTimeout(r,1800));
await page.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,300));
await page.click('#btn-play'); await new Promise(r=>setTimeout(r,300));
await page.evaluate(()=>{const tl=document.querySelector('.tl'); const r=tl.getBoundingClientRect(); const x=r.x+r.width*0.15; tl.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:r.y+6,bubbles:true,pointerId:1})); tl.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:r.y+6,bubbles:true,pointerId:1}));});
await new Promise(r=>setTimeout(r,900));
await page.screenshot({path:join(OUT,'17-ass-embedded.png')});
console.log('shot 17-ass-embedded');
// PGS
await page.click('#btn-subs'); await new Promise(r=>setTimeout(r,600));
await page.evaluate(()=>{const rows=[...document.querySelectorAll('.panel .track-item')]; rows.find(r=>r.textContent.includes('PGS'))?.click();});
await new Promise(r=>setTimeout(r,2200));
await page.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,300));
await page.evaluate(()=>{const tl=document.querySelector('.tl'); const r=tl.getBoundingClientRect(); const x=r.x+r.width*0.72; tl.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:r.y+6,bubbles:true,pointerId:1})); tl.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:r.y+6,bubbles:true,pointerId:1}));});
await new Promise(r=>setTimeout(r,900));
await page.screenshot({path:join(OUT,'18-pgs-embedded.png')});
console.log('shot 18-pgs-embedded');
await browser.close(); server.close();
