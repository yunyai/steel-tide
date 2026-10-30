import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';

const source=process.env.STEEL_URL??'http://127.0.0.1:5198',out=process.env.NEON_OUT??'docs/verification/vector-neon-battery/current';
const quality=process.env.NEON_QUALITY??'high',reduced=process.env.NEON_REDUCED==='1';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
 await page.goto(`${source}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=async(type='balanced',terrain=false)=>page.evaluate(async({type,terrain})=>{
  const {setArchitectLoadout}=await import('/src/skills/misc/ArchitectRuntime.ts'),{loadoutPreset}=await import('/src/data/architectLoadout.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:terrain?'strait':'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  setArchitectLoadout(s,type==='balanced'?loadoutPreset('balanced'):Array.from({length:10},()=>({type,skill:0})));
  s.pos.set(0,0,2800);s.prevPos.copy(s.pos);s.throttle=2;s.speed=0;s.secondaries=[];s.control.aimX=0;s.control.aimZ=0;
  if(terrain){const island=g.map.islands?.[0];if(island){s.control.aimX=island.x;s.control.aimZ=island.z+1500;}}
  const aim={x:s.control.aimX,z:s.control.aimZ};pc.camera.position.set(aim.x-2700,2300,aim.z+3400);pc.camera.lookAt(aim.x,80,aim.z);pc.camera.updateMatrixWorld(true);
  const f=window.neonReview={b,g,s,pc,stateHash,pure:true,started:0,aim,carriers:[]};
  f.draw=()=>{const before=stateHash(g);g.interpolate();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
  f.step=seconds=>{for(let i=0;i<Math.round(seconds*60);i++)g.step();f.draw();};
  f.step(.2);s.meter=1;if(!s.activateSkill(7))throw Error(s.skillFailure);f.started=g.time;f.carriers=s.architect.ultimate.battery.members.map(m=>m.carrier);f.draw();
 },{type,terrain});
 const capture=async(name,time)=>{
  if(time!==undefined)await page.evaluate(time=>{const f=window.neonReview;f.step(time-(f.g.time-f.started));},time);
  await page.screenshot({path:`${out}/${name}.jpg`,quality:94});
  const result=await page.evaluate(()=>{const f=window.neonReview;return{elapsed:f.g.time-f.started,pure:f.pure,stats:f.b.scene.batteryFx.stats,carriers:f.carriers,platforms:f.s.architect.slots.map(a=>({state:a.state,position:a.entity?.pos.toArray(),path:a.path})),hash:f.stateHash(f.g),drawCalls:window.steel.renderer.gl.info.render.calls,triangles:window.steel.renderer.gl.info.render.triangles};});
  rows.push({name,...result});console.log(name,result.elapsed,result.stats.machinery.heads);
 };
 await setup();
 for(const [name,time] of [['waterline-ready',1.5],['battery-flight',1.78],['battery-impact',2.22],['battery-finale',8.12],['waterline-recovered',9.4]])await capture(name,time);
 for(const type of ['furnace','cryo','storm','gravity','prism']){await setup(type);await capture(`element-${type}`,2.22);}
 await setup('balanced',true);await capture('obstacle-hover',1.5);
 await page.evaluate(()=>{const f=window.neonReview,m=f.s.architect.slots.reduce((a,b)=>(b.entity?.pos.y??-1)>(a.entity?.pos.y??-1)?b:a).entity;f.pc.camera.position.set(m.pos.x-650,m.pos.y+500,m.pos.z+700);f.pc.camera.lookAt(m.pos.x,m.pos.y+45,m.pos.z);f.pc.camera.updateMatrixWorld(true);f.draw();});
 await capture('obstacle-closeup');await capture('obstacle-fold',7.82);await capture('obstacle-descent',8.65);await capture('obstacle-landed',9.4);
 await setup();await capture('recall-committed',1.65);await page.evaluate(()=>{const f=window.neonReview;if(!f.s.activateSkill(4))throw Error(f.s.skillFailure);});await capture('recall-fold',1.8);
 await page.evaluate(()=>{const f=window.neonReview;f.g.finish(-1,'neon verification');f.draw();});await capture('lifecycle-clean');
 if(errors.length||rows.some(r=>!r.pure))throw Error(JSON.stringify({errors,impure:rows.filter(r=>!r.pure)}));
 writeFileSync(`${out}/results.json`,JSON.stringify({source,quality,reduced,viewport:[1920,1080],camera:'fixed identical world camera and simulation times',rows,errors},null,2));
 await context.close();
}finally{await browser.close();}
