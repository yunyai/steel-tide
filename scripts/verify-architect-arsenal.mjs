import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.ARCH_OUT??'docs/verification/architect-arsenal';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[];
try{
const profiles=process.env.ARCH_MATRIX?[['ultralow',1280,720,false],['low',1280,720,false],['medium',1280,720,false],['high',1920,1080,false],['high',2560,1080,false],['high',1280,720,true]]:[['high',1280,720,false]];
for(const [quality,width,height,reduced] of profiles){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',...(process.env.ARCH_VIDEO?{recordVideo:{dir:out,size:{width,height}}}:{})}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>window.requestAnimationFrame=()=>1);await page.goto(`${process.env.STEEL_URL??'http://127.0.0.1:5184'}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=async()=>page.evaluate(async()=>{
 const data=await import('/src/data/architectLoadout.ts'),elements=await import('/src/skills/misc/ArchitectElements.ts'),{stateHash}=await import('/src/net/hash.ts');
 window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse',architectLoadout:data.loadoutPreset('unique')}]});
 const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
 s.pos.set(0,0,2500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;s.effects=[];
 const t=g.addShip(g.shipSpec('leviathan'),1,'Target',0,-1000,0);t.hp=t.maxHp=1e8;t.secondaries.length=0;t.throttle=2;t.speed=0;t.colossus=false;
 const f=window.arsenal={s,t,g,b,pc,data,elements,stateHash,pure:true};
 f.draw=(dt,present=true)=>{const h=stateHash(g);g.interpolate();window.steel.renderer.update(dt,[pc.camera]);b.huds[0].update(dt);if(present)window.steel.renderer.render(b.viewports);f.pure&&=h===stateHash(g);};
 f.run=n=>{for(let i=0;i<n;i++){g.step();f.draw(1/60,i===n-1);}};
 f.camera=(x,y,z,tx=0,ty=40,tz=2500)=>{pc.camera.position.set(x,y,z);pc.camera.lookAt(tx,ty,tz);pc.camera.updateMatrixWorld(true);f.draw(0);};
 s.control.aimX=s.control.aimZ=0;pc.aim.set(0,0,-1000);f.camera(-600,400,3000);
 });
 const snap=async label=>{const r=await page.evaluate(()=>{const f=window.arsenal;f.draw(0);return{hash:f.stateHash(f.g),pure:f.pure,calls:window.steel.renderer.gl.info.render.calls,triangles:window.steel.renderer.gl.info.render.triangles,instances:f.b.scene.elementFx.count,overflow:document.documentElement.scrollWidth>innerWidth};});if(!r.pure||r.overflow||errors.length)throw Error(JSON.stringify({label,r,errors}));rows.push({quality,width,reduced,label,...r});if(process.env.ARCH_CAPTURE!=='0')await page.screenshot({timeout:60000,path:`${out}/${quality}-${width}${reduced?'-reduced':''}-${label}.jpg`,quality:88});};
 await setup();await snap('docked');
 await page.evaluate(async()=>{const {architectLoadoutEditor}=await import('/src/ui/ArchitectLoadout.ts');const f=window.arsenal,wrap=document.createElement('div');wrap.className='overlay';const sheet=document.createElement('div');sheet.className='sheet panel';sheet.style.cssText='max-width:900px;max-height:90vh;overflow:auto';sheet.append(architectLoadoutEditor(f.s.architectLoadout,()=>({accepted:[],pending:[],skipped:[],rejected:[]})).el);wrap.append(sheet);f.b.setOverlay(wrap);});await snap('loadout');await page.evaluate(()=>window.arsenal.b.setOverlay(null));
 const types=await page.evaluate(()=>window.arsenal.data.ARCHITECT_TYPES);
 for(const type of (process.env.ARCH_BRIEF?[]:types)){
  await setup();await page.evaluate(type=>{const f=window.arsenal,a=f.s.architect.slots[0];a.type=type;a.element=f.data.ARCHETYPES[type].element;f.s.activateSkill(0);f.run(150);const m=a.entity;f.b.huds[0].root.style.visibility='hidden';for(const b of f.s.architect.slots){b.skillTimer=100;b.opening=false;}f.s.architect.elements.jobs=[];f.g.shells.shells=[];f.camera(m.pos.x-160,120,m.pos.z+180,m.pos.x,30,m.pos.z);},type);await snap(`${type}-platform`);
  for(const skill of [0,1]){await page.evaluate(skill=>{const f=window.arsenal,a=f.s.architect.slots[0];a.skill=skill;const t=['restoration','bastion','resonance'].includes(a.type)?a.entity:f.t;a.entity.hp=70000;f.elements.startElementAttack(f.s,a,t,'skill');f.run(32);f.camera(-700,450,300,0,30,-600);},skill);await snap(`${type}-skill-${skill}`);}
  await setup();await page.evaluate(type=>{const f=window.arsenal,a=f.s.architect.slots[0];a.type=type;a.element=f.data.ARCHETYPES[type].element;f.s.activateSkill(7);f.run(58);const m=a.entity;f.b.huds[0].root.style.visibility='hidden';f.camera(m.pos.x-240,m.pos.y+180,m.pos.z+280,m.pos.x,m.pos.y+50,m.pos.z);},type);await snap(`${type}-siege-build`);await page.evaluate(()=>{const f=window.arsenal;f.run(60);f.b.scene.elementFx.pulses=[];f.s.architect.elements.jobs=[];f.g.shells.shells=[];const m=f.s.architect.slots[0].entity;f.camera(m.pos.x-250,m.pos.y+185,m.pos.z+280,m.pos.x,m.pos.y+45,m.pos.z);});await snap(`${type}-siege`);
 }
 await setup();await page.evaluate(()=>{const f=window.arsenal;f.s.activateSkill(7);f.camera(-2700,2300,3200,0,50,0);});
 for(const [n,label] of [[55,'battery-build'],[65,'battery-opening'],[120,'battery-rolling'],[120,'battery-continuous'],[123,'battery-finale']]){await page.evaluate(n=>window.arsenal.run(n),n);await snap(label);}
 await setup();await page.evaluate(()=>{const f=window.arsenal;f.s.activateSkill(8);f.run(110);f.camera(-1400,750,3700,0,120,2500);});await snap('citadel');
 const perf=await page.evaluate(()=>{const f=window.arsenal,times=[];let calls=0,instances=0;for(let i=0;i<300;i++){const start=performance.now();f.run(1);times.push(performance.now()-start);calls=Math.max(calls,window.steel.renderer.gl.info.render.calls);instances=Math.max(instances,f.b.scene.elementFx.count);}times.sort((a,b)=>a-b);return{p50:times[150],p95:times[285],calls,instances};});rows.push({quality,width,reduced,label:'citadel-perf',...perf});
 await page.evaluate(()=>{const f=window.arsenal;f.s.architect.slots[0].entity.takeDamage(1e9,null,null,false,true);f.run(185);});await snap('wreck-cleanup');
 if(process.env.ARCH_VIDEO){await setup();await page.evaluate(()=>{const f=window.arsenal;f.s.activateSkill(7);f.camera(-2600,2100,3200,0,50,0);});for(let i=0;i<230;i++){await page.evaluate(()=>window.arsenal.run(2));await page.waitForTimeout(17);}}
 const video=page.video();await context.close();if(video){await video.saveAs(`${out}/${quality}-${width}-motion.webm`);await video.delete();}
 writeFileSync(`${out}/${quality}-${width}${reduced?'-reduced':''}-results.json`,JSON.stringify(rows.filter(r=>r.quality===quality&&r.width===width&&r.reduced===reduced),null,2));console.log(`${quality}-${width}: verified ${rows.length} scenarios`);
}
writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));
}finally{await browser.close();}
