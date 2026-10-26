// Requires Vite and Chrome. Every route must play a decoded recording; generators are forbidden.
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const base=process.env.STEEL_URL??'http://127.0.0.1:5173';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const check=(value,message)=>{if(!value)throw new Error(message)};
const results={};
async function open(route){
 const page=await browser.newPage();if(route)await route(page);
 await page.goto(base);await page.waitForFunction(()=>window.steel);
 return page;
}
try{
 const page=await open();
 results.coverage=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');
  const cues=await import('/src/fx/SoundCues.ts');
  const {setSound}=await import('/src/input/Settings.ts');
  let generated=0;
  AudioContext.prototype.createOscillator=()=>{generated++;throw new Error('Synthesized oscillator')};
  AudioContext.prototype.createBuffer=()=>{generated++;throw new Error('Generated waveform')};
  const e=new AudioEngine();e.init();await e.ctx.resume();await e.ready();
  const played=[];const create=e.ctx.createBufferSource.bind(e.ctx);
  e.ctx.createBufferSource=()=>{const s=create();const start=s.start.bind(s);s.start=(...args)=>{played.push({url:[...e.buffers].find(([,b])=>b===s.buffer)?.[0],loop:s.loop});return start(...args)};return s};
  const events=[];
  const expect=(label,url,run)=>{e.budget.clear();const n=played.length;run();events.push({label,url,actual:played[n]?.url,recorded:played.length===n+1&&played[n].url===url})};
  e.beginBattle();
  for(const kind of cues.SOUND_KINDS)expect(`world:${kind}`,cues.worldAsset(kind,406),()=>e.play(kind,0,0,0,406));
  for(const size of [100,200,460])expect(`gun:${size}`,cues.worldAsset('gun',size),()=>e.play('gun',0,0,0,size));
  for(const kind of cues.UI_SOUNDS)expect(`ui:${kind}`,cues.UI_ASSETS[kind],()=>e.ui(kind));
  for(const family of ['charge','impact','beam','slash','transform'])expect(`family:${family}`,cues.cueAsset('test','activate',family),()=>e.cue('test','activate',family,0,0,0,true));
  e.budget.clear();
  const waitAudio=async seconds=>{const target=e.ctx.currentTime+seconds,deadline=performance.now()+5000;while(e.ctx.currentTime<target){if(performance.now()>deadline)throw new Error(`Audio clock stalled: ${e.ctx.state} at ${e.ctx.currentTime}`);if(e.ctx.state==='suspended')await e.ctx.resume();await new Promise(r=>setTimeout(r,25));}};
  e.engine(0);await waitAudio(.45);const idle=e.loops.get('navalEngine').source.playbackRate.value;const idleTime=e.ctx.currentTime;
  e.engine(1);await waitAudio(.45);const full=e.loops.get('navalEngine').source.playbackRate.value;
  const naval=[...e.loops.keys()].sort();e.beginBattle('ground');const ground=[...e.loops.keys()].sort();
  setSound({weapons:.2,abilities:.3,ambience:.4,ui:.5});e.applySound();
  const volumes=Math.abs(e.weapons.gain.value-.2)<1e-6&&Math.abs(e.abilities.gain.value-.3)<1e-6&&Math.abs(e.uiBus.gain.value-.5)<1e-6;
  e.toggleMute();const muted=e.master.gain.value===0;e.toggleMute();
  for(let i=0;i<200;i++)e.play('explosion',i*501,0,0,2,.6);
  e.cue('abyssalMaw','activate','impact',0,0,0,true);e.ui('alarm');
  const bounded=e.budget.size<=40&&e.sources.size<=42;
  const admitted=e.budget.size;e.stopBattle();
  const cleaned=e.sources.size===0&&e.pending.length===0&&e.loops.size===0&&e.budget.size===0;
  setSound({weapons:1,abilities:1,ambience:1,ui:1});
  return {assets:e.buffers.size,expectedAssets:cues.allAudioAssets().length,events,generated,naval,ground,engineResponds:full>idle,engineTiming:{idle,full,idleTime,fullTime:e.ctx.currentTime,state:e.ctx.state},volumes,muted,bounded,admitted,cleaned};
 });
 const c=results.coverage;
 check(c.assets===c.expectedAssets&&c.events.every(e=>e.recorded)&&c.generated===0,'Every audible event must use its mapped recording');
 check(c.naval.join(',')==='navalEngine,sea'&&c.ground.join(',')==='groundEngine,wind','Both modes need their own loop recordings');
 check(c.engineResponds&&c.volumes&&c.muted&&c.bounded&&c.cleaned,`Volumes, engine response, limits or cleanup failed: ${JSON.stringify(c)}`);
 await page.close();
 const suspended=await open();
 results.suspension=await suspended.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');const e=new AudioEngine();e.init();await e.ctx.resume();await e.ready();e.beginBattle();e.ui('ability');
  await new Promise(r=>setTimeout(r,150));await e.ctx.suspend();await new Promise(r=>setTimeout(r,2100));await e.ctx.resume();await new Promise(r=>setTimeout(r,2100));
  const gain=e.ambience.gain.value;const restored=gain>.9&&e.ctx.currentTime>e.duckUntil;e.stopBattle();return {restored,gain};
 });
 check(results.suspension.restored,'Ambience must recover after the context is suspended during a major cue');await suspended.close();
 const clickPage=await open(p=>p.route('**/audio/ui-click.m4a',async r=>{await new Promise(resolve=>setTimeout(resolve,500));await r.continue().catch(()=>{})}));
 results.loadingClick=await clickPage.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');const {UI_ASSETS}=await import('/src/fx/SoundCues.ts');
  const e=new AudioEngine();e.init();await e.ctx.resume();let used;
  const create=e.ctx.createBufferSource.bind(e.ctx);e.ctx.createBufferSource=()=>{const s=create();const start=s.start.bind(s);s.start=(...args)=>{used=[...e.buffers].find(([,b])=>b===s.buffer)?.[0];return start(...args)};return s};
  e.ui('click');await e.ready();const primary=used===UI_ASSETS.click;e.stopBattle();return {primary,used};
 });
 check(results.loadingClick.primary,'A loading click must wait briefly for its recording instead of becoming an unrelated warning');await clickPage.close();
 const reordered=await open(p=>p.route('**/audio/engine-ground.wav',async r=>{await new Promise(resolve=>setTimeout(resolve,900));await r.continue().catch(()=>{})}));
 results.primaryLoop=await reordered.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');const {LOOP_ASSETS}=await import('/src/fx/SoundCues.ts');
  const e=new AudioEngine();e.init();await e.ctx.resume();e.beginBattle('ground');await e.ready();
  const primary=e.loops.get('groundEngine')?.source.buffer===e.buffers.get(LOOP_ASSETS.groundEngine);e.stopBattle();return {primary};
 });
 check(results.primaryLoop.primary,'A later primary engine recording must not be shadowed by an earlier fallback');await reordered.close();
 const missing=await open(p=>p.route('**/audio/gun-heavy.m4a',r=>r.fulfill({status:404,body:''})));
 results.missingFile=await missing.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');const {GUN_ASSETS}=await import('/src/fx/SoundCues.ts');
  const e=new AudioEngine();e.init();await e.ctx.resume();await e.ready();let used;
  const create=e.ctx.createBufferSource.bind(e.ctx);e.ctx.createBufferSource=()=>{const s=create();const start=s.start.bind(s);s.start=(...args)=>{if(!s.loop)used=[...e.buffers].find(([,b])=>b===s.buffer)?.[0];return start(...args)};return s};
  e.beginBattle();e.play('gun',0,0,0,460);const recordedFallback=used!==GUN_ASSETS[2]&&GUN_ASSETS.includes(used);e.stopBattle();return {recordedFallback,used};
 });
 check(results.missingFile.recordedFallback,'Missing primary must use another recording');await missing.close();
 const delayed=await open(p=>p.route('**/audio/**',async r=>{await new Promise(resolve=>setTimeout(resolve,650));await r.continue().catch(()=>{})}));
 results.loading=await delayed.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');const e=new AudioEngine();e.init();await e.ctx.resume();
  let starts=0;const create=e.ctx.createBufferSource.bind(e.ctx);e.ctx.createBufferSource=()=>{const s=create();const start=s.start.bind(s);s.start=(...args)=>{starts++;return start(...args)};return s};
  e.beginBattle();for(let i=0;i<100;i++){e.ui(i%2?'alarm':'click');e.play('gun',i,0,0,406)}
  const pendingBounded=e.pending.length<=12;e.stopBattle();await e.ready();
  const noLatePlayback=starts===0&&e.pending.length===0&&e.sources.size===0;
  e.beginBattle('ground');const restarted=[...e.loops.keys()].sort();e.stopBattle();
  return {pendingBounded,noLatePlayback,restarted};
 });
 check(results.loading.pendingBounded&&results.loading.noLatePlayback&&results.loading.restarted.join(',')==='groundEngine,wind','Loading/end/restart race failed');await delayed.close();
 const failed=await open(p=>p.route('**/audio/**',r=>r.fulfill({status:404,body:''})));
 results.allMissing=await failed.evaluate(async()=>{
  const {AudioEngine}=await import('/src/fx/Audio.ts');let generated=0;
  AudioContext.prototype.createOscillator=()=>{generated++;throw new Error('Synthesized fallback')};
  AudioContext.prototype.createBuffer=()=>{generated++;throw new Error('Generated fallback')};
  const e=new AudioEngine();e.init();await e.ctx.resume();await e.ready();e.beginBattle();e.play('gun',0,0,0,406);e.ui('alarm');
  const silent=e.sources.size===0&&e.pending.length===0;e.stopBattle();return {silent,generated};
 });
 check(results.allMissing.silent&&results.allMissing.generated===0,'No recording available must never recreate procedural sound');await failed.close();
 writeFileSync('docs/verification/all-audio-results.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({assets:c.assets,events:c.events.length,generated:c.generated,engineResponds:c.engineResponds,volumes:c.volumes,muted:c.muted,bounded:c.bounded,cleaned:c.cleaned,missingFile:results.missingFile,loading:results.loading,allMissing:results.allMissing}));
}finally{await browser.close()}
