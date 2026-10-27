import {chromium} from 'playwright';import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.FLEET_OUT??'docs/verification/fleet-refresh/effects';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{
 const profiles=process.env.FLEET_MATRIX?[['ultralow',1280,720,false],['low',1280,720,false],['medium',1280,720,false],['high',1920,1080,false],['high',2560,1080,false],['high',1280,720,true]]:[['high',1280,720,false]];
 for(const [quality,width,height,reduced] of profiles){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',recordVideo:process.env.FLEET_VIDEO?{dir:out,size:{width,height}}:undefined}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>window.requestAnimationFrame=()=>1);await page.goto(`${process.env.STEEL_URL??'http://127.0.0.1:5184'}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
  const ids=await page.evaluate(async()=>{const {ALL}=await import('/src/data/ships.ts');return ALL.filter(s=>!['stepper','architect','architectPlatform'].includes(s.id)&&(s.cls==='TT'||['yamato','gojo','tsurugi','virginia','anvilheart','ford','tanjiro','goku','windrunner'].includes(s.id))).map(s=>s.id);});
  for(const id of ids){
   if(process.env.FLEET_IDS&&!process.env.FLEET_IDS.split(',').includes(id))continue;
   const indices=await page.evaluate(async id=>{const {SHIP_BY_ID}=await import('/src/data/ships.ts');const s=SHIP_BY_ID[id];return s.skills.map((k,i)=>i).filter(i=>s.cls!=='TT'||s.skills[i].ult);},id);
   for(const index of indices){
    const row=await page.evaluate(async({id,index,detail,mapId})=>{
     const {SHIP_BY_ID}=await import('/src/data/ships.ts'),{stateHash}=await import('/src/net/hash.ts');
     window.steel.start({mode:'solo',type:'freeplay',mapId,teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:id,device:'mouse'}]});
     const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);b.huds[0].root.style.visibility='hidden';
     s.pos.set(0,0,1500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.hp*=.65;s.secondaries.length=0;
     const foe=g.addShip(SHIP_BY_ID.leviathan,1,'Target',0,500,0);foe.hp=foe.maxHp=1e8;foe.secondaries.length=0;foe.throttle=2;
     s.control.aimX=0;s.control.aimZ=500;s.control.target=foe;pc.aim.set(0,0,500);
     const activated=s.activateSkill(index);const skill=s.skills[index].spec;
     const t=window.fleetVisual={b,g,s,pc,stateHash,pure:true};
     t.draw=(dt)=>{const h=stateHash(g);g.interpolate();window.steel.renderer.update(dt,[pc.camera]);window.steel.renderer.render(b.viewports);t.pure&&=h===stateHash(g);};
     t.run=n=>{for(let i=0;i<n;i++){g.step();t.draw(1/60);}};
     pc.camera.position.set(detail?-420:-850,detail?230:520,detail?1920:2250);pc.camera.lookAt(0,25,detail?1350:1100);pc.camera.updateMatrixWorld(true);t.run(12);
     return {id,index,skill:skill.id,activated};
    },{id,index,detail:!!process.env.FLEET_DETAIL,mapId:process.env.FLEET_MAP??'open'});
    const label=`${quality}-${width}${reduced?'-reduced':''}-${id}-${index}`;
    await page.screenshot({path:`${out}/${label}-cast.jpg`,quality:80});
    if(process.env.FLEET_VIDEO){for(let i=0;i<90;i++){await page.evaluate(()=>window.fleetVisual.run(2));await page.waitForTimeout(17);if(i===30)await page.screenshot({path:`${out}/${label}-release.jpg`,quality:85});}}
    const stats=await page.evaluate(()=>{const t=window.fleetVisual,times=[];for(let i=0;i<180;i++){const a=performance.now();t.run(1);if(i>120)times.push(performance.now()-a);}times.sort((a,b)=>a-b);return{pure:t.pure,hash:t.stateHash(t.g),p50:times[30],p95:times[56],calls:window.steel.renderer.gl.info.render.calls,triangles:window.steel.renderer.gl.info.render.triangles,instances:t.b.scene.fleetFx?.count??0};});
    await page.screenshot({path:`${out}/${label}-active.jpg`,quality:80});

    if(!stats.pure)throw Error('Rendering changed simulation '+label);results.push({...row,...stats,quality,width,reduced});
   }
   console.log(`${quality} ${id}: ${indices.length} abilities`);
  }
  if(errors.length)throw Error(errors.slice(0,8).join('\n'));const video=page.video();await context.close();if(video){await video.saveAs(`${out}/${quality}-${width}-motion.webm`);await video.delete();}
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(`Captured ${results.length*2} views; ${results.filter(r=>!r.activated).length} setup activation failures`);
}finally{await browser.close();}
