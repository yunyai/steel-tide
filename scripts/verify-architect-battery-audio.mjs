import{chromium}from'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const out=process.env.ARCH_UI_OUT??'docs/verification/architect-visual-control-polish';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage();await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192');await page.waitForFunction(()=>window.steel);
 const result=await page.evaluate(async()=>{
  const{AudioEngine}=await import('/src/fx/Audio.ts'),{ArchitectBatteryAudio}=await import('/src/fx/ArchitectBatteryAudio.ts'),{SHIP_BY_ID}=await import('/src/data/ships.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0];g.ai.clear();b.batteryAudio.dispose();
  const e=new AudioEngine();e.init();await e.ctx.resume();await e.ready();e.beginBattle();
  let peak=0,abilityPeak=0,generated=0;const urls=[],create=e.ctx.createBufferSource.bind(e.ctx);
  e.ctx.createOscillator=()=>{generated++;throw Error('No synthetic waveform allowed');};
  e.ctx.createBufferSource=()=>{const source=create(),start=source.start.bind(source);source.start=(...a)=>{urls.push([...e.buffers].find(([,v])=>v===source.buffer)?.[0]);return start(...a);};return source;};
  const sample=e.sample.bind(e);e.sample=(...args)=>{sample(...args);peak=Math.max(peak,e.sources.size);abilityPeak=Math.max(abilityPeak,e.budget.voices.filter(v=>v.category==='ability').length);};
  const binder=new ArchitectBatteryAudio(g,e);binder.update([s]);
  const owners=[s,g.addShip(SHIP_BY_ID.architect,0,'Second',300,3000,0),g.addShip(SHIP_BY_ID.architect,0,'Third',-300,3000,0)];
  for(const owner of owners){owner.pos.set(owner.pos.x,0,3000);owner.throttle=2;owner.speed=0;owner.secondaries=[];owner.control.aimX=0;owner.control.aimZ=1000;owner.meter=1;owner.activateSkill(7);}
  for(let i=0;i<485;i++)g.step();
  const recordings=[...new Set(urls)],pending=e.pending.length,admitted=e.budget.size;
  const noPlops=recordings.every(url=>!url.includes('mechanical-hit')&&!url.includes('sonniss-explosion'));
  const expected=['energy-charge','energy-heavy','plasma-shot','blast-shock','blast-heavy','energy-pulse','phase-arrival','zap','beam'];
  const complete=expected.every(name=>recordings.some(url=>url.endsWith(`/${name}.m4a`)));
  // Removing decoded buffers exercises the transient route while a primary is still loading.
  const buffers=e.buffers;e.buffers=new Map();e.loaded=false;const before=e.pending.length;
  for(let i=0;i<200;i++)e.play('gun',0,0,0,500,.5,{category:'ability',priority:3,asset:'/audio/energy-heavy.m4a',transient:true});
  const noBacklog=e.pending.length===before;e.buffers=buffers;e.loaded=true;
  binder.dispose();e.stopBattle();const cleaned=e.sources.size===0&&e.pending.length===0&&e.loops.size===0&&e.budget.size===0;
  return{owners:3,recordings,complete,noPlops,generated,peak,abilityPeak,admitted,pending,noBacklog,cleaned};
 });
 if(!result.complete||!result.noPlops||result.generated||result.abilityPeak>12||result.peak>14||result.pending||!result.noBacklog||!result.cleaned)throw Error(JSON.stringify(result));
 writeFileSync(`${out}/audio-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
