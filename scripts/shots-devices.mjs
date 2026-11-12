import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';
const ROOT=new URL('..',import.meta.url).pathname; const DIST=join(ROOT,'dist'); const WORK=join(ROOT,'smoke-tmp'); const OUT=join(ROOT,'shots'); const PORT=4340;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.webm':'video/webm'};
const server=createServer(async(req,res)=>{let p=normalize(decodeURIComponent(new URL(req.url,'http://x').pathname));if(p==='/')p='/index.html';try{const b=await readFile(join(DIST,p));res.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
await mkdir(OUT,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/local/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required','--mute-audio']});
const clip=join(WORK,'demo.webm');
for (const [name, vp] of [
  ['dev-phone-390',{width:390,height:844,deviceScaleFactor:2}],
  ['dev-phone-landscape',{width:844,height:390,deviceScaleFactor:2}],
  ['dev-tablet-820',{width:820,height:1180,deviceScaleFactor:1}],
  ['dev-small-360',{width:360,height:740,deviceScaleFactor:2}],
]) {
  const page=await browser.newPage(); await page.setViewport(vp);
  await page.goto(`http://127.0.0.1:${PORT}/#/open`,{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,400));
  const input=await page.$('input[type=file][accept*="video"]'); await input.uploadFile(clip);
  await page.waitForSelector('.player video'); await new Promise(r=>setTimeout(r,2200));
  await page.evaluate(()=>{const v=document.querySelector('.player video'); if(v) v.currentTime=6; document.querySelector('#btn-play')?.click();});
  await new Promise(r=>setTimeout(r,700));
  await page.screenshot({path: join(OUT, `${name}.png`)});
  console.log('shot', name);
  await page.close();
}
// settings app section
const page=await browser.newPage(); await page.setViewport({width:1280,height:900});
await page.goto(`http://127.0.0.1:${PORT}/#/settings?section=general`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,600));
await page.evaluate(()=>{location.hash='#/settings?section=app';});
await new Promise(r=>setTimeout(r,700));
await page.screenshot({path: join(OUT,'dev-settings-app.png')});
console.log('shot dev-settings-app', await page.evaluate(()=>document.querySelector('.settings-panel .card__title')?.textContent));
await browser.close(); server.close();
