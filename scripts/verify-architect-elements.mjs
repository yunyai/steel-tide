import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.ARCH_ELEMENT_OUT??'docs/verification/architect-elemental';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[];
try{
 const profiles=process.env.ARCH_MATRIX?[['ultralow',1280,720,false],['low',1280,720,false],['medium',1280,720,false],['high',1920,1080,false],['high',2560,1080,false],['high',1280,720,true]]:[['high',1280,720,false]];
 for(const [quality,width,height,reduced] of profiles){
 if(process.env.ARCH_PROFILE&&process.env.ARCH_PROFILE!==`${quality}-${width}${reduced?'-reduced':''}`)continue;
 const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',...(process.env.ARCH_VIDEO?{recordVideo:{dir:out,size:{width,height}}}:{})}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.addInitScript(()=>window.requestAnimationFrame=()=>1);await page.goto(`${process.env.STEEL_URL??'http://127.0.0.1:5184'}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=async()=>page.evaluate(async mapId=>{
 const {SHIP_BY_ID}=await import('/src/data/ships.ts'),elements=await import('/src/skills/misc/ArchitectElements.ts'),{stateHash}=await import('/src/net/hash.ts');
 window.steel.start({mode:'solo',type:'freeplay',mapId,teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
 const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
 s.pos.set(0,0,1800);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;
 const t=g.addShip(SHIP_BY_ID.leviathan,1,'Target',0,-800,0);t.hp=t.maxHp=1e8;t.secondaries.length=0;t.throttle=2;t.speed=0;t.colossus=false;
 const f=window.elementTest={s,t,g,b,pc,elements,stateHash,pure:true};
 f.draw=(dt,present=true)=>{const h=stateHash(g);g.interpolate();window.steel.renderer.update(dt,[pc.camera]);b.huds[0].update(dt);if(present)window.steel.renderer.render(b.viewports);f.pure&&=stateHash(g)===h;};
 f.run=n=>{for(let i=0;i<n;i++){g.step();f.draw(1/60,i===n-1);}};
 f.camera=(x,y,z,tx=0,ty=40,tz=1800)=>{pc.camera.position.set(x,y,z);pc.camera.lookAt(tx,ty,tz);pc.camera.updateMatrixWorld(true);f.draw(0);};
 s.control.aimX=0;s.control.aimZ=0;pc.aim.set(0,0,-800);f.camera(-500,320,2200);
 },process.env.ARCH_MAP??'open');
 const snap=async label=>{const r=await page.evaluate(()=>{const f=window.elementTest;f.draw(0);return{hash:f.stateHash(f.g),pure:f.pure,calls:window.steel.renderer.gl.info.render.calls,triangles:window.steel.renderer.gl.info.render.triangles,instances:f.b.scene.elementFx.count,overflow:document.documentElement.scrollWidth>innerWidth};});if(!r.pure||r.overflow||errors.length)throw Error(JSON.stringify({r,errors}));rows.push({quality,width,reduced,label,...r});if(process.env.ARCH_CAPTURE!=='0')await page.screenshot({timeout:60000,path:`${out}/${quality}-${width}${reduced?'-reduced':''}-${label}.jpg`,quality:87});};
 await setup();await snap('docked');
 for(const element of ['furnace','cryo','storm','gravity','prism']){
  await setup();await page.evaluate(element=>{const f=window.elementTest;f.s.architect.slots[0].element=element;f.s.activateSkill(0);f.run(120);const a=f.s.architect.slots[0],m=a.entity;f.b.huds[0].root.style.visibility='hidden';f.s.architect.elements.jobs=[];for(const b of f.s.architect.slots){b.skillTimer=b.miniTimer=100;b.opening=false;}f.g.shells.shells=[];f.camera(m.pos.x-150,95,m.pos.z+160,m.pos.x,25,m.pos.z);},element);await snap(`${element}-model`);
  for(const attack of ['skill','mini']){await page.evaluate(attack=>{const f=window.elementTest;f.s.architect.elements.jobs=[];f.elements.startElementAttack(f.s,f.s.architect.slots[0],f.t,attack);f.camera(-750,550,350,0,40,-650);f.run(8);},attack);await snap(`${element}-${attack}-charge`);await page.evaluate(()=>window.elementTest.run(18));await snap(`${element}-${attack}-hit`);await page.evaluate(()=>window.elementTest.run(150));}
 }
 for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){await setup();await page.evaluate(([i,j])=>{const f=window.elementTest,[a,b]=f.s.architect.slots;a.element=f.elements.ELEMENTS[i];b.element=f.elements.ELEMENTS[j];f.elements.applyElementMark(f.s,a,f.t);f.elements.applyElementMark(f.s,b,f.t);f.camera(-600,430,200,0,30,-800);f.draw(.18);},[i,j]);await snap(`reaction-${i}-${j}`);}
 for(const index of [6,7,8]){await setup();await page.evaluate(index=>{const f=window.elementTest;f.s.control.aimZ=-800;f.s.activateSkill(index);f.camera(-2000,1700,2800,0,70,300);f.run(index===6?214:index===7?573:110);},index);await snap(`ultimate-${index}`);}
 await setup();await page.evaluate(()=>{const f=window.elementTest;for(let i=0;i<5;i++){f.s.control.aimX=(i-2)*450;f.s.skills[0].cooldown=0;f.s.activateSkill(0);f.run(70);}f.s.control.aimX=0;f.s.control.aimZ=-800;f.s.activateSkill(1);f.s.activateSkill(2);f.camera(-1800,1500,2200,0,30,200);});
 const perf=await page.evaluate(()=>{const f=window.elementTest,times=[];let calls=0,instances=0;for(let i=0;i<600;i++){const start=performance.now();f.run(1);times.push(performance.now()-start);calls=Math.max(calls,window.steel.renderer.gl.info.render.calls);instances=Math.max(instances,f.b.scene.elementFx.count);}times.sort((a,b)=>a-b);return {p50:times[300],p95:times[570],calls,instances};});await snap('crowded');rows.push({quality,width,reduced,label:'perf',...perf});
 if(process.env.ARCH_VIDEO)for(let n=0;n<120;n++){await page.evaluate(()=>window.elementTest.run(2));await page.waitForTimeout(17);}
 const video=page.video();await context.close();if(video){await video.saveAs(`${out}/${quality}-${width}-motion.webm`);await video.delete();}writeFileSync(`${out}/${quality}-${width}${reduced?'-reduced':''}-results.json`,JSON.stringify(rows.filter(r=>r.quality===quality&&r.width===width&&r.reduced===reduced),null,2));console.log(`${quality}-${width}: ${rows.length} captures/measurements`);
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));
}finally{await browser.close();}
