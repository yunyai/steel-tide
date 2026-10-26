import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base=process.env.STEEL_URL ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const results=[];
try {
 for(const q of (process.env.STEEL_AUDIO_ONLY === '1' ? [] : ['ultralow','low','medium','high'])) {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
  await page.goto(`${base}/?q=${q}`);await page.waitForFunction(()=>window.steel);
  const result=await page.evaluate(async()=>{
   const {stateHash}=await import('/src/net/hash.ts');
   const {quality,setQuality}=await import('/src/render/Quality.ts');
   const {SHIP_BY_ID}=await import('/src/data/ships.ts');
   window.steel.start({mode:'solo',type:'freeplay',mapId:'strait',teamSize:1,ai:[2,2],difficulty:'normal',seed:51,era:'mixed',players:[{shipId:'hadal',device:'mouse'}]});
   const b=window.steel.battle, renderer=window.steel.renderer;
   const me=b.game.humans()[0];
   b.game.shells.dropBomb(me,SHIP_BY_ID.iowa.main.he,me.pos.x+250,me.pos.z,1000);
   b.game.torps.launch(me,me.pos.x,me.pos.z,me.heading,me.spec.torpedoes);
   b.game.strikes.spawn(me,{kind:'rod',x:me.pos.x+300,z:me.pos.z-100,radius:150,delay:10,damage:0});
   const times=[];
   for(let i=0;i<90;i++) { const t=performance.now();b.tick(1/60);if(i>59)times.push(performance.now()-t); }
   const calls=renderer.gl.info.render.calls;
   const triangles=renderer.gl.info.render.triangles;
   const markers=[...document.querySelectorAll('.marker')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent);
   const before=renderer.gl.getPixelRatio();
   const chosen=quality().id;setQuality(chosen==='high'?'ultralow':'high');renderer.resize();
   const nextBattleOnly=before===renderer.gl.getPixelRatio();
   times.sort((a,b)=>a-b);
   return {hash:stateHash(b.game),calls,triangles,markers,projectiles:b.game.shells.shells.filter(s=>s.alive).length+b.game.torps.torps.filter(t=>t.alive).length,telegraphs:b.game.strikes.strikes.filter(s=>s.alive).length,nextBattleOnly,medianCpuFrameMs:times[Math.floor(times.length/2)]};
  });
  await page.screenshot({quality:82,path:`docs/verification/preset-${q}.jpg`});
  results.push({quality:q,...result,errors});await page.close();
 }
 const hashes=new Set(results.map(r=>r.hash));
 if(results.length && (hashes.size!==1 || results.some(r=>r.errors.length || !r.nextBattleOnly || r.projectiles<1 || r.telegraphs<1))) throw new Error(JSON.stringify(results));
 if(results.length){writeFileSync('docs/verification/preset-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
 const page=await browser.newPage();await page.goto(base);await page.waitForFunction(()=>window.steel);
 const audio=await page.evaluate(async()=>{
  const {audio,AudioEngine}=await import('/src/fx/Audio.ts');
  const {allAudioAssets}=await import('/src/fx/SoundCues.ts');
  audio.init();await audio.ctx.resume();audio.beginBattle();
  const assetUrls=allAudioAssets();
  await Promise.all(assetUrls.map(async url=>{const r=await fetch(url);if(!r.ok)throw new Error(url);await audio.ctx.decodeAudioData(await r.arrayBuffer());}));
  // Every scheduled voice counts toward the ceiling, including delayed distant salvos.
  for(let i=0;i<200;i++)audio.play('explosion',6000+i*500,0,6000,2,1);
  audio.cue('abyssalMaw','activate','impact',0,0,0,true);audio.ui('alarm');
  const bounded=audio.budget.size<=40;
  const admitted=audio.budget.size;
  audio.stopBattle();
  const cleaned=audio.sources.size===0&&audio.budget.size===0;
  const fetchOriginal=window.fetch;window.fetch=async()=>{throw new Error('Missing asset test')};
  const fallback=new AudioEngine();fallback.init();await fallback.ctx.resume();await fallback.ready();fallback.beginBattle();fallback.cue('test','activate','charge',0,0,0,true);
  const unavailableAssetsSilent=fallback.sources.size===0&&fallback.pending.length===0;fallback.stopBattle();window.fetch=fetchOriginal;
  audio.toggleMute();const muted=audio.master.gain.value===0;audio.toggleMute();
  return {decodedAssets:assetUrls.length,bounded,admitted,cleaned,unavailableAssetsSilent,muted};
 });
 if(!audio.bounded||!audio.cleaned||!audio.unavailableAssetsSilent||!audio.muted)throw new Error(JSON.stringify(audio));
 writeFileSync('docs/verification/audio-results.json',JSON.stringify(audio,null,2));console.log(JSON.stringify(audio));
 const shields=await page.evaluate(()=>{
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:3,era:'mixed',players:[{shipId:'hadal',device:'mouse'}]});
  const b=window.steel.battle,me=b.game.humans()[0];
  me.depthState=2;me.pos.y=me.renderPos.y=-60;me.addShield(100000,10);
  b.scene.skillFx.update(1/60);
  const bubble=b.scene.skillFx.bubbles.get(me);
  const followsDepth=Math.abs(bubble.mesh.position.y-(-60+me.spec.freeboard*.5))<.001;
  b.scene.visibility(1);const hiddenFromEnemy=!bubble.mesh.visible;
  me.mods.revealed=true;b.scene.visibility(1);const visibleWhenRevealed=bubble.mesh.visible;
  return {followsDepth,hiddenFromEnemy,visibleWhenRevealed};
 });
 if(Object.values(shields).some(v=>!v))throw new Error(JSON.stringify(shields));
 writeFileSync('docs/verification/shield-results.json',JSON.stringify(shields,null,2));console.log(JSON.stringify(shields));
 await page.close();
} finally {await browser.close();}
