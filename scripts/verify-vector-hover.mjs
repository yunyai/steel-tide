import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';

// Mobile Battery escort: liftoff, varied orbits, a Hull Dash chase, terrain clearance and the final water landing.
const source=process.env.STEEL_URL??'http://127.0.0.1:5198',out=process.env.HOVER_OUT??'docs/verification/vector-neon-battery/hover';
const quality=process.env.HOVER_QUALITY??'high',reduced=process.env.HOVER_REDUCED==='1';
const width=Number(process.env.HOVER_WIDTH??1920),height=Number(process.env.HOVER_HEIGHT??1080);
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
 await page.goto(`${source}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=async(terrain=false)=>page.evaluate(async({terrain})=>{
  const {setArchitectLoadout,materialize}=await import('/src/skills/misc/ArchitectRuntime.ts'),{loadoutPreset}=await import('/src/data/architectLoadout.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:terrain?'strait':'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  const picks=loadoutPreset('balanced');picks[9]={type:'vector',skill:1};setArchitectLoadout(s,picks);
  let x=0,z=2800;
  if(terrain){const island=g.map.islands?.[0];if(island){x=island.x;z=island.z+island.r+900;}}
  s.pos.set(x,0,z);s.prevPos.copy(s.pos);s.throttle=2;s.speed=0;s.secondaries=[];s.control.aimX=x;s.control.aimZ=z-1200;
  const escorts=s.architect.slots.slice(0,6).map((a,n)=>{const m=materialize(s,a),angle=n*Math.PI/3;a.state='deployed';m.pos.set(x+Math.sin(angle)*1400,0,z-Math.cos(angle)*1400);m.prevPos.copy(m.pos);m.renderPos.copy(m.pos);return a;});
  const f=window.hoverReview={b,g,s,pc,stateHash,pure:true,started:0,escorts};
  f.frame=()=>{const p=s.renderPos;pc.camera.position.set(p.x-1500,1250,p.z+1900);pc.camera.lookAt(p.x,120,p.z);pc.camera.updateMatrixWorld(true);};
  f.draw=()=>{const before=stateHash(g);g.interpolate();f.frame();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
  f.step=seconds=>{for(let i=0;i<Math.round(seconds*60);i++){g.step();f.frame();}f.draw();};
  f.step(.2);s.control.architectMobileBattery=true;f.step(1/60);f.started=g.time;
  if(!escorts.every(a=>a.follow))throw Error('Mobile Battery did not enrol the deployed escorts');
 },{terrain});
 const capture=async(name,time)=>{
  if(time!==undefined)await page.evaluate(time=>{const f=window.hoverReview;f.step(time-(f.g.time-f.started));},time);
  await page.screenshot({path:`${out}/${name}.jpg`,quality:92});
  const result=await page.evaluate(()=>{const f=window.hoverReview,s=f.s;return{elapsed:f.g.time-f.started,pure:f.pure,hash:f.stateHash(f.g),
   owner:s.pos.toArray(),escorts:f.escorts.map(a=>({state:a.state,orbit:a.follow,position:a.entity?.pos.toArray(),ground:a.entity?f.g.map.heightAt(a.entity.pos.x,a.entity.pos.z):null,range:a.entity?Math.hypot(a.entity.pos.x-s.pos.x,a.entity.pos.z-s.pos.z):null,path:a.path})),
   chips:[...document.querySelectorAll('.module-strip span, [data-state] span')].map(e=>e.textContent).slice(0,10),
   drawCalls:window.steel.renderer.gl.info.render.calls,triangles:window.steel.renderer.gl.info.render.triangles};});
  rows.push({name,...result});console.log(name,result.elapsed.toFixed(2),result.escorts.map(e=>`${e.state}@${e.position?.[1]?.toFixed(0)}`).join(' '));
 };
 await setup();
 for(const [name,time] of [['hover-liftoff',.45],['hover-orbit',3.5],['hover-orbit-late',6]])await capture(name,time);
 await page.evaluate(()=>{const f=window.hoverReview;f.s.control.aimX=f.s.pos.x+1100;f.s.control.aimZ=f.s.pos.z;f.s.control.architectHullDash=true;});
 await capture('hover-dash',6.3);await capture('hover-dash-caught-up',8.5);
 await capture('hover-landing',14.4);await capture('hover-landed',16.5);
 await setup(true);await capture('hover-terrain',4);
 const flying=rows.filter(r=>r.name.startsWith('hover-orbit')||r.name==='hover-terrain');
 const problems=[...rows.filter(r=>!r.pure).map(r=>`${r.name}: render changed the state hash`),
  ...flying.flatMap(r=>r.escorts.filter(e=>e.position&&e.position[1]<Math.max(80,e.ground+20)).map(e=>`${r.name}: escort too low at ${e.position[1]}`)),
  ...rows.find(r=>r.name==='hover-landed').escorts.filter(e=>e.state!=='docked'&&(e.position?.[1]!==0||e.orbit)).map(e=>`landed: escort airborne ${JSON.stringify(e)}`)];
 writeFileSync(`${out}/results.json`,JSON.stringify({source,quality,reduced,viewport:[width,height],rows,errors,problems},null,2));
 if(errors.length||problems.length)throw Error(JSON.stringify({errors,problems}));
 await context.close();
}finally{await browser.close();}
