import { chromium } from 'playwright';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
const source=process.env.STEEL_URL??'http://127.0.0.1:5192',out=process.env.ARCH_VIS_OUT??'docs/verification/architect-control-visual';
mkdirSync(out,{recursive:true});
const detailsOnly=process.env.ARCH_VIS_DETAILS_ONLY==='1',previous=detailsOnly&&existsSync(`${out}/results.json`)?JSON.parse(readFileSync(`${out}/results.json`,'utf8')):null;
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=previous?.rows??[];
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
 await page.goto(source);await page.waitForFunction(()=>window.steel);
 const setup=async(type='balanced',terrain=false,battery=true)=>page.evaluate(async({type,terrain,battery})=>{
  const {setArchitectLoadout}=await import('/src/skills/misc/ArchitectRuntime.ts'),{loadoutPreset}=await import('/src/data/architectLoadout.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:terrain?'strait':'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  setArchitectLoadout(s,type==='balanced'?loadoutPreset('balanced'):Array.from({length:10},()=>({type,skill:0})));
  s.pos.set(0,0,2800);s.prevPos.copy(s.pos);s.throttle=2;s.speed=0;s.secondaries=[];s.control.aimX=0;s.control.aimZ=0;
  if(terrain){const islands=g.map.islands;const island=islands?.[0];if(island){s.control.aimX=island.x;s.control.aimZ=island.z+1500;}}
  const aim={x:s.control.aimX,z:s.control.aimZ};
  pc.camera.position.set(aim.x-2700,2300,aim.z+3400);pc.camera.lookAt(aim.x,80,aim.z);pc.camera.updateMatrixWorld(true);
  const f=window.archVisual={b,g,s,pc,stateHash,pure:true,started:0,aim};
  f.draw=()=>{const before=stateHash(g);g.interpolate();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
  f.step=seconds=>{for(let i=0;i<Math.round(seconds*60);i++){g.step();f.draw();}};
  f.step(.2);if(battery){s.meter=1;if(!s.activateSkill(7))throw Error(s.skillFailure);}f.started=g.time;f.draw();
 },{type,terrain,battery});
 const capture=async(name)=>{await page.screenshot({path:`${out}/${name}.jpg`,quality:92});const r=await page.evaluate(()=>{const f=window.archVisual;return{elapsed:f.g.time-f.started,pure:f.pure,stats:f.b.scene.batteryFx.stats,carriers:f.s.architect?.ultimate?.battery?.members.map(m=>m.carrier),hash:f.stateHash(f.g),storedCapacitors:f.s.architect?.slots.filter(a=>a.capacitorCharged).length,capacitorBolts:f.g.shells.shells.filter(s=>s.alive&&s.element&&s.spec.damage===18000).map(s=>({x:s.x,y:s.y,z:s.z,element:s.element.kind})),drive:f.s.architect?.drive,ownerPosition:f.s.pos.toArray(),elementInstances:f.b.scene.elementFx.count};});const existing=rows.findIndex(r=>r.name===name);if(existing>=0)rows.splice(existing,1);rows.push({name,...r});console.log(name,r.elapsed,r.stats.machinery.heads);};
 if(!detailsOnly){
 await setup();
 for(const [name,time] of [['ordinary-transport',.5],['machinery-build',1.13],['machinery-ready',1.5],['grand-battery-impact',2.22],['grand-battery-finale',8.12]]){
  await page.evaluate(time=>{const f=window.archVisual;f.step(time-(f.g.time-f.started));},time);await capture(name);
 }
 for(const type of ['furnace','cryo','storm','gravity','prism','vector']){
  await setup(type);await page.evaluate(()=>{const f=window.archVisual;f.step(2.22);});await capture(`element-${type}`);
 }
 await setup('balanced',true);await page.evaluate(()=>window.archVisual.step(1.5));await capture('island-hover-ready');
 await page.evaluate(()=>{const f=window.archVisual;const m=f.s.architect.slots[0].entity;f.pc.camera.position.set(m.pos.x-650,m.pos.y+500,m.pos.z+700);f.pc.camera.lookAt(m.pos.x,m.pos.y+60,m.pos.z);f.pc.camera.updateMatrixWorld(true);f.draw();});await capture('machinery-closeup');
 await page.evaluate(()=>{const f=window.archVisual;f.s.architect.slots[0].entity.takeDamage(1e9,null,null,false,true);f.step(.2);});await capture('true-loss-rupture');
 await setup();await page.evaluate(()=>{const f=window.archVisual;f.step(1.65);if(!f.s.activateSkill(4))throw Error(f.s.skillFailure);f.step(.13);});await capture('recall-fold');
 await page.evaluate(()=>window.archVisual.step(.25));await capture('recall-hubs');
 await page.evaluate(()=>{const f=window.archVisual;f.g.finish(-1,'visual audit');f.draw();});await capture('lifecycle-clean');
 }
 // Supplement the wide Battery gallery with actual docked energy and manual-drive states.
 await setup('balanced',false,false);
 await page.evaluate(()=>{
  const f=window.archVisual,s=f.s;
  // Execute two ordinary successful cycles per turret, accelerating only the test reloads.
  for(let cycle=0;cycle<2;cycle++)for(let i=0;i<10;i++){const turret=s.turrets[i];turret.reload=0;turret.aligned=turret.canBear=true;s.fireTurret(i,'AP',false);}
  f.step(.5);if(s.architect.slots.filter(a=>a.capacitorCharged).length!==10)throw Error('Expected ten charged capacitor chambers after two ordinary cycles');
  f.pc.camera.position.set(-430,360,3120);f.pc.camera.lookAt(0,40,2800);f.pc.camera.updateMatrixWorld(true);f.draw();
 });await capture('docked-capacitors-charged');
 await page.evaluate(()=>{
  const f=window.archVisual,t=f.g.addShip(f.g.shipSpec('leviathan'),1,'Capacitor target',0,1400,0);t.hp=t.maxHp=1e9;t.throttle=2;t.speed=0;t.secondaries=[];t.colossus=false;
  f.s.control.aimX=0;f.s.control.aimZ=1400;f.s.control.targetId=t.id;f.step(5/60);
  const bolts=f.g.shells.shells.filter(s=>s.alive&&s.element&&s.spec.damage===18000);if(bolts.length!==1||f.s.architect.slots.filter(a=>a.capacitorCharged).length!==9)throw Error('Expected one actual capacitor discharge and nine stored charges');
  f.pc.camera.position.set(-520,430,3070);f.pc.camera.lookAt(0,40,2640);f.pc.camera.updateMatrixWorld(true);f.draw();
 });await capture('docked-capacitor-discharge');
 await setup('vector',false,false);
 await page.evaluate(async()=>{
  const f=window.archVisual,{activateArchitectHullDash}=await import('/src/skills/misc/ArchitectRuntime.ts');f.s.control.aimX=0;f.s.control.aimZ=1600;
  if(!activateArchitectHullDash(f.s))throw Error(f.s.skillFailure);f.step(.2);
  if(!f.s.architect.drive||f.s.pos.z>=2700)throw Error('Expected active Vector drive and actual hull movement');
  f.pc.camera.position.set(-460,360,f.s.pos.z+440);f.pc.camera.lookAt(0,35,f.s.pos.z+40);f.pc.camera.updateMatrixWorld(true);f.draw();
 });await capture('vector-drive-active');
 if(errors.length||rows.some(r=>!r.pure))throw Error(JSON.stringify({errors,impure:rows.filter(r=>!r.pure).map(r=>r.name)}));
 writeFileSync(`${out}/results.json`,JSON.stringify({source,rows,errors},null,2));await context.close();
}finally{await browser.close();}
