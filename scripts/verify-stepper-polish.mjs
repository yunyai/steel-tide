import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';

// Battle-distance frames of every Stepper skill, plus the polish checks: random Sidestep sides,
// Flicker approach angles that face the target, and Overstep hits on a crossing target.
// STEPPER_CHECK=1 enforces the polish expectations; without it the run only captures (baseline frames).
const source=process.env.STEEL_URL??'http://127.0.0.1:5198',out=process.env.STEPPER_OUT??'docs/verification/stepper-polish';
const quality=process.env.STEPPER_QUALITY??'high',strict=process.env.STEPPER_CHECK==='1';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
 await page.goto(`${source}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=(skill,opts={})=>page.evaluate(async({skill,opts})=>{
  const {SHIP_BY_ID}=await import('/src/data/ships.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:118,era:'mixed',players:[{shipId:'stepper',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  b.huds[0].root.style.visibility='hidden';
  s.pos.set(0,0,0);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.speed=0;s.throttle=2;s.meter=1;s.secondaries.length=0;
  const foe=g.addShip(SHIP_BY_ID.leviathan,1,'Target',0,-1500,opts.crossing?Math.PI/2:0);foe.maxHp=foe.hp=1e8;foe.colossus=false;foe.secondaries.length=0;foe.throttle=opts.crossing?6:2;foe.speed=opts.crossing?foe.maxSpeed:0;
  if(opts.crossing)for(let i=0;i<240;i++)g.step();
  s.control.aimX=foe.pos.x;s.control.aimZ=foe.pos.z;
  const f=window.polish={b,g,s,foe,pc,stateHash,pure:true,start:0,dodges:[],landings:[],focus:opts.focus??'foe',lift:opts.lift??1};
  g.events.on('blink',e=>{if(e.ship!==s)return;if(e.dodge)f.dodges.push({dx:s.pos.x-e.fromX,dz:s.pos.z-e.fromZ,heading:s.heading,from:e.fromHeading});if(s.stepper?.flicker)f.landings.push({x:s.pos.x,z:s.pos.z,heading:s.heading,tx:foe.pos.x,tz:foe.pos.z});});
  f.hits=0;g.events.on('skillHit',e=>{if(e.skill.id==='overStep'&&e.ship===foe)f.hits++;});
  f.view=()=>{
   const c=f.focus==='self'?s.renderPos:f.focus==='zone'&&s.stepper?.cross?{x:s.stepper.cross.x,z:s.stepper.cross.z}:f.focus==='mid'?{x:(s.renderPos.x+foe.renderPos.x)/2,z:(s.renderPos.z+foe.renderPos.z)/2}:foe.renderPos;
   const k=f.lift;pc.camera.position.set(c.x-900*k,650*k,c.z+950*k);pc.camera.lookAt(c.x,30,c.z);pc.camera.updateMatrixWorld(true);
  };
  f.tick=()=>{g.step();g.interpolate();f.view();window.steel.renderer.update(1/60,[pc.camera]);};
  f.draw=()=>{const h=stateHash(g);g.interpolate();f.view();window.steel.renderer.update(0,[pc.camera]);window.steel.renderer.render(b.viewports);f.pure&&=h===stateHash(g);};
  f.until=t=>{while(g.time-f.start<t-1e-9)f.tick();f.draw();};
  for(let i=0;i<6;i++)f.tick();
  if(skill===8){f.ok=s.activateSkill(8);}
  else if(skill>=0){f.ok=s.activateSkill(skill);if(!f.ok)f.fail=s.skillFailure;}
  f.start=g.time;
 },{skill,opts});
 const capture=async(name,age,extra)=>{
  await page.evaluate(age=>window.polish.until(age),age);
  await page.screenshot({path:`${out}/${name}.jpg`,quality:86});
  const r=await page.evaluate(()=>{const f=window.polish,fx=f.b.scene.stepperFx,cx=f.b.scene.crossFx;return{age:+(f.g.time-f.start).toFixed(3),ok:f.ok,fail:f.fail,pure:f.pure,ghosts:fx.ghosts.count,light:fx.light.count,tears:fx.spatial.tears.count,crossLight:cx.light.count,calls:window.steel.renderer.gl.info.render.calls};});
  rows.push({name,...r,...extra});console.log(name,JSON.stringify(r));return r;
 };
 // Flash, Ram, Broad, Over, Back: one arrival frame and one settled frame each.
 for(const [skill,name,ages] of [[0,'flash',[.08,.3]],[1,'ram',[.12,.3]],[2,'broad',[.1,.6]],[4,'back',[.1,1]]]){
  await setup(skill,{focus:skill===0||skill===4?'self':'foe'});
  for(const a of ages)await capture(`${name}-${String(a).replace('.','')}`,a);
 }
 await setup(-1,{focus:'self'});
 await page.evaluate(()=>{const f=window.polish;f.s.control.aimX=2000;f.s.control.aimZ=-600;f.ok=f.s.activateSkill(0);f.start=f.g.time;});
 await capture('flash-far-008',.08);await capture('flash-far-03',.3);
 // Overstep against a target crossing broadside at speed.
 await setup(3,{crossing:true,focus:'mid',lift:1.5});
 for(const a of [.1,.6,1.4,2.6])await capture(`over-${String(a).replace('.','')}`,a);
 const over=await page.evaluate(()=>{const f=window.polish;f.until(5);return{hits:f.hits,speed:Math.max(0,...f.g.torps.torps.filter(t=>t.skill?.id==='overStep').map(t=>t.speed)),dist:Math.round(Math.hypot(f.s.pos.x-f.foe.pos.x,f.s.pos.z-f.foe.pos.z))};});
 rows.push({name:'over-summary',...over});console.log('over',JSON.stringify(over));
 // Sidestep: shells dropped on the hull every few ticks.
 await setup(5,{focus:'self',lift:.8});
 await page.evaluate(()=>{const f=window.polish,{g,s,foe}=f;f.until=t=>{let i=0;while(g.time-f.start<t-1e-9){if(i++%9===0)g.shells.dropBomb(foe,foe.spec.main.he,s.pos.x,s.pos.z,25);f.tick();}f.draw();};});
 for(const a of [.3,.9,1.6])await capture(`side-${String(a).replace('.','')}`,a);
 const side=await page.evaluate(()=>{const f=window.polish;f.until(4);return{dodges:f.dodges.length,left:f.dodges.filter(d=>d.dx<0).length,right:f.dodges.filter(d=>d.dx>0).length,turned:f.dodges.filter(d=>Math.abs(d.heading-d.from)>1e-9).length,received:f.s.stats.received};});
 rows.push({name:'side-summary',...side});console.log('side',JSON.stringify(side));
 // Flicker and Cross from the battle camera.
 await setup(6,{focus:'foe',lift:1.2});
 for(const a of [.2,.65,1.5,2.95])await capture(`flicker-${String(a).replace('.','')}`,a);
 const flick=await page.evaluate(()=>{const f=window.polish;f.until(3.1);const L=f.landings;const bear=L.map(p=>Math.atan2(p.x-p.tx,-(p.z-p.tz)));const face=L.map(p=>{const dx=p.tx-p.x,dz=p.tz-p.z,d=Math.hypot(dx,dz);return(Math.sin(p.heading)*dx-Math.cos(p.heading)*dz)/d;});const sectors=new Set(bear.map(b=>Math.floor(((b+Math.PI*2)%(Math.PI*2))/(Math.PI/4))));let minStep=9;for(let i=1;i<bear.length;i++){let d=Math.abs(bear[i]-bear[i-1])%(Math.PI*2);d=Math.min(d,Math.PI*2-d);minStep=Math.min(minStep,d);}return{landings:L.length,sectors:sectors.size,minFacing:+Math.min(...face).toFixed(3),minStepDeg:Math.round(minStep*180/Math.PI),received:f.foe.stats.received};});
 rows.push({name:'flicker-summary',...flick});console.log('flicker',JSON.stringify(flick));
 await setup(7,{focus:'zone',lift:1.8});
 for(const a of [.5,1.5,2.7,3.05,3.3])await capture(`cross-${String(a).replace('.','')}`,a);
 await setup(8,{focus:'self',lift:1.3});
 for(const a of [.15,.6])await capture(`afterimage-${String(a).replace('.','')}`,a);
 writeFileSync(`${out}/rows.json`,JSON.stringify(rows,null,1));
 if(rows.some(r=>r.pure===false))throw Error('presentation changed the simulation');
 if(rows.some(r=>r.ok===false))throw Error(`a skill failed to start: ${JSON.stringify(rows.filter(r=>r.ok===false))}`);
 if(strict){
  if(!(side.left>=2&&side.right>=2))throw Error(`Sidestep should land on both sides: ${JSON.stringify(side)}`);
  if(side.turned)throw Error('Sidestep changed the heading');
  if(!(flick.landings===20&&flick.sectors>=4&&flick.minFacing>.99&&flick.minStepDeg>=55))throw Error(`Flicker approaches: ${JSON.stringify(flick)}`);
  if(!(over.hits>=6))throw Error(`Overstep hit ${over.hits}/8 on a crossing target`);
 }
 if(errors.length)throw Error(errors.join('\n'));
 console.log('OK',out);
}finally{await browser.close();}
