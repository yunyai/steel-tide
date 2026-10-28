// Exercise the built site through real controls; no dev-only window.steel handle.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const url=process.env.PAGES_URL??'http://127.0.0.1:5194/steel-tide/';
const out=process.env.PAGES_OUT??'docs/verification/pages-runtime';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const rows=[];
try{
 for(const mode of ['naval','ground']){
  const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage();
  const errors=[],failedAssets=[],sockets=[],audioUrls=new Set();
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('websocket',ws=>sockets.push(ws.url()));
  page.on('response',r=>{if(r.url().includes('/audio/'))audioUrls.add(r.url());if(r.status()>=400)failedAssets.push({url:r.url(),status:r.status()});});
  await page.addInitScript(()=>{
   window.pagesAudio={decoded:0,played:0};
   const decode=AudioContext.prototype.decodeAudioData;
   AudioContext.prototype.decodeAudioData=function(...args){const result=decode.apply(this,args);result?.then(()=>window.pagesAudio.decoded++);return result;};
   const start=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(...args){window.pagesAudio.played++;return start.apply(this,args);};
  });
  const response=await page.goto(url);assert.equal(response.status(),200);
  await page.getByRole('button',{name:/^Naval battle/}).waitFor();
  const lan=page.getByRole('button',{name:/^LAN battle/});
  assert(await lan.isDisabled(),'Static site must explain that LAN requires a local host');
  assert.match(await lan.innerText(),/local|server|host/i);
  await page.screenshot({path:`${out}/${mode}-title.png`});
  await page.getByRole('button',{name:mode==='naval'?/^Naval battle/:/^Ground battle/}).click();
  if(mode==='naval')await page.getByRole('button',{name:'Free play',exact:true}).click();
  await page.getByRole('button',{name:mode==='naval'?'Choose ship':'Choose vehicle',exact:true}).click();
  await page.getByRole('button',{name:mode==='naval'?'Set sail':'Roll out',exact:true}).click();
  await page.locator('.timer').first().waitFor();
  await page.waitForFunction(()=>window.pagesAudio.decoded>=50&&window.pagesAudio.played>0,{},{timeout:20000});
  // Headless browsers may deny pointer lock; resume using the game's supported fallback.
  const resume=page.getByRole('button',{name:/^Resume/});
  if(await resume.isVisible())await resume.click();
  const before=await page.locator('.timer').first().innerText();
  await page.waitForFunction(t=>document.querySelector('.timer')?.textContent!==t,before,{timeout:20000});
  await page.screenshot({path:`${out}/${mode}-battle.png`});
  const audio=await page.evaluate(()=>window.pagesAudio);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(failedAssets.length,0,JSON.stringify(failedAssets));
  assert.equal(sockets.length,0,'Static Pages must not attempt LAN sockets');
  assert(audioUrls.size>=50,'Packaged recordings were not loaded');
  assert([...audioUrls].every(u=>new URL(u).pathname.startsWith(new URL(url).pathname+'audio/')),'Audio escaped the Pages subdirectory');
  rows.push({mode,url,status:response.status(),audioAssets:audioUrls.size,audio,...{errors,failedAssets,sockets},running:true});
  await context.close();
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
}finally{await browser.close();}
