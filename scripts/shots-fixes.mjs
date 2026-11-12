import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT=new URL('..',import.meta.url).pathname; const DIST=join(ROOT,'dist'); const WORK=join(ROOT,'smoke-tmp'); const OUT=join(ROOT,'shots'); const PORT=4360;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.mkv':'video/x-matroska'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  if(url.pathname==='/clip.mkv'){ const b=await readFile(join(WORK,'multi-audio.mkv')); res.writeHead(200,{'Content-Type':'video/x-matroska','Content-Length':String(b.length),'Accept-Ranges':'bytes'}); res.end(b); return; }
  let p=normalize(decodeURIComponent(url.pathname)); if(p==='/')p='/index.html';
  try{const b=await readFile(join(DIST,p)); res.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'}); res.end(b);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
// hostile origin: no CORS headers
const hostile=createServer((req,res)=>{ const b=Buffer.alloc(2048,7); res.writeHead(206,{'Content-Type':'video/x-matroska','Content-Length':String(b.length),'Content-Range':`bytes 0-2047/4096`,'Accept-Ranges':'bytes'}); res.end(b); });
await new Promise(r=>hostile.listen(PORT+1,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:'/usr/local/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required','--mute-audio']});
const page=await browser.newPage(); await page.setViewport({width:1440,height:900});
await page.goto(`http://127.0.0.1:${PORT}/#/open`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,500));
const input=await page.$('input[type=file][accept*="video"]'); await input.uploadFile(join(WORK,'multi-audio.mkv'));
await page.waitForSelector('.player canvas'); await new Promise(r=>setTimeout(r,2500));
await page.click('#btn-tracks'); await new Promise(r=>setTimeout(r,700));
await page.screenshot({path:join(OUT,'14-multiaudio-tracks.png')});
console.log('shot multiaudio');
await page.keyboard.press('Escape');
// CORS error card
await page.evaluate(()=>{ location.hash='#/url'; }); await new Promise(r=>setTimeout(r,500));
await page.type('input[type=url]', `http://127.0.0.1:${PORT+1}/episode.mkv`); await page.keyboard.press('Enter');
await page.waitForSelector('.player__error.is-visible',{timeout:15000}); await new Promise(r=>setTimeout(r,500));
await page.screenshot({path:join(OUT,'15-cors-error.png')});
console.log('shot cors error');
await browser.close(); server.close(); hostile.close();
