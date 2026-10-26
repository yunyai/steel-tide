// Requires the Vite dev server. Checks the actual new audio route and recorded asset sources.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const manifest=JSON.parse(readFileSync('public/audio/manifest.json','utf8'));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage();await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5173');await page.waitForFunction(()=>window.steel);
 const results=await page.evaluate(async()=>{
  const {WORLD_ASSETS}=await import('/src/fx/SoundCues.ts');
  const {audio}=await import('/src/fx/Audio.ts');
  const required=['explosion','hit','splash','depth'];
  const mapped=required.every(kind=>WORLD_ASSETS[kind]?.includes('sonniss-'));
  if(!mapped)return {mapped};
  audio.init();await audio.ctx.resume();audio.beginBattle();
  const urls=[...new Set(required.map(kind=>WORLD_ASSETS[kind]))];
  const decoded=[];
  for(const url of urls){const response=await fetch(url);if(!response.ok)throw new Error(url);const buffer=await audio.ctx.decodeAudioData(await response.arrayBuffer());audio.buffers.set(url,buffer);decoded.push({url,seconds:buffer.duration});}
  // Capturing the actual playback source distinguishes samples from procedural fallback.
  const played=[];const original=audio.ctx.createBufferSource.bind(audio.ctx);
  audio.ctx.createBufferSource=()=>{const source=original();const start=source.start.bind(source);source.start=(...args)=>{played.push(source.buffer);return start(...args)};return source};
  for(const kind of required)audio.play(kind,0,0,0,1,.5);
  const playedSamples=required.every(kind=>played.includes(audio.buffers.get(WORLD_ASSETS[kind])));
  const voices=audio.budget.size;
  audio.stopBattle();const cleaned=audio.sources.size===0;
  return {mapped,decoded,playedSamples,voices,cleaned};
 });
 const provenance=['sonniss-explosion.m4a','sonniss-hit.m4a','sonniss-splash.m4a','sonniss-depth.m4a'].every(file=>manifest.some(x=>x.file===file&&x.source.includes('sonniss')&&x.sourceCrc32));
 console.log(JSON.stringify({...results,provenance}));
 if(!results.mapped||!results.playedSamples||!results.cleaned||!provenance)throw new Error('Sonniss integration failed');
 writeFileSync('docs/verification/sonniss-results.json',JSON.stringify({...results,provenance},null,2));
}finally{await browser.close()}
