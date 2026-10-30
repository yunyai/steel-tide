import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';

// Hull Dash presentation: launch spray, airborne downwash, landing shockwave and the island crossing, with one and five Vectors.
const source=process.env.STEEL_URL??'http://127.0.0.1:5198',out=process.env.DASH_OUT??'docs/verification/vector-dash';
const quality=process.env.DASH_QUALITY??'high',reduced=process.env.DASH_REDUCED==='1';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
 await page.goto(`${source}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=(vectors,island)=>page.evaluate(async({vectors,island})=>{
  const {setArchitectLoadout}=await import('/src/skills/misc/ArchitectRuntime.ts'),{loadoutPreset}=await import('/src/data/architectLoadout.ts'),{SHIP_BY_ID}=await import('/src/data/ships.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  const picks=loadoutPreset('balanced');for(let i=0;i<vectors;i++)picks[i]={type:'vector',skill:0};setArchitectLoadout(s,picks);
  // The island run starts south of the open sea's eastern island and crosses it bow-first.
  const rock=g.map.islands.reduce((a,b)=>b.x>a.x?b:a),x=island?rock.x:0,z=island?rock.z+rock.r+700:2900;s.pos.set(x,0,z);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.secondaries=[];
  s.control.aimX=island?x:x+500;s.control.aimZ=island?rock.z-rock.r-500:z-900;
  if(!island){const t=g.addShip(SHIP_BY_ID.iowa,1,'Target',x+250,z-450,0);t.hp=t.maxHp=1e8;t.secondaries.length=0;t.throttle=2;t.speed=0;}
  const events=[];g.events.on('architectDash',e=>events.push({phase:e.phase,x:e.x,z:e.z,radius:e.radius,vectors:e.vectors,time:g.time}));
  const ground=Math.max(...Array.from({length:61},(_,i)=>g.map.heightAt(s.control.aimX,z+(s.control.aimZ-z)*i/60)));
  const f=window.dashReview={b,g,s,pc,stateHash,events,pure:true,start:0,peak:0,x,z,ground};
  f.frame=()=>{pc.camera.position.set(x-1300,620,z-500);pc.camera.lookAt(x+(island?0:250),40,z-(island?600:500));pc.camera.updateMatrixWorld(true);};
  f.draw=()=>{const before=stateHash(g);g.interpolate();f.frame();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
  f.until=t=>{while(g.time-f.start<t){g.step();f.peak=Math.max(f.peak,s.pos.y);}f.draw();};
  f.until(.1);s.control.architectHullDash=true;g.step();s.control.architectHullDash=false;f.start=g.time;
 },{vectors,island});
 const capture=async(name,age)=>{
  await page.evaluate(age=>window.dashReview.until(age),age);
  await page.screenshot({path:`${out}/${name}.jpg`,quality:88});
  const r=await page.evaluate(()=>{const f=window.dashReview,s=f.s,fx=f.b.scene.dashFx;return{age:f.g.time-f.start,pure:f.pure,pos:s.pos.toArray().map(v=>Math.round(v)),heading:+s.heading.toFixed(3),peak:Math.round(f.peak),ground:Math.round(f.ground),moving:!!s.architect.drive?.moving,events:f.events.map(e=>`${e.phase}:${Math.round(e.radius)}`),fx:fx.count,batches:fx.particles.drawn,water:f.g.map.heightAt(s.pos.x,s.pos.z)<=0,calls:window.steel.renderer.gl.info.render.calls};});
  rows.push({name,...r});console.log(name,JSON.stringify(r));return r;
 };
 for(const vectors of [1,5]){
  await setup(vectors,false);
  const launch=await capture(`open-${vectors}v-launch`,.06),flight=await capture(`open-${vectors}v-flight`,.3),land=await capture(`open-${vectors}v-land`,.62),after=await capture(`open-${vectors}v-after`,1.1);
  if(!launch.fx||!flight.moving||!land.events.some(e=>e.startsWith('land'))||!land.fx)throw Error(`dash ${vectors}v missing a stage`);
  if(after.fx>land.fx)throw Error('dash effects grew after landing');
 }
 const [one,five]=[rows.find(r=>r.name==='open-1v-land'),rows.find(r=>r.name==='open-5v-land')].map(r=>Number(r.events.find(e=>e.startsWith('land')).split(':')[1]));
 if(!(five>one))throw Error(`landing radius should grow with Vectors: ${one} vs ${five}`);
 await setup(5,true);
 await capture('island-5v-launch',.06);const over=await capture('island-5v-over',.28);const land=await capture('island-5v-land',.7);
 if(!(over.ground>0&&over.peak>over.ground))throw Error(`hull did not climb over the island (peak ${over.peak}, ground ${over.ground})`);
 if(!land.water||land.pos[1]!==0)throw Error('dash did not set down on open water beyond the island');
 if(rows.some(r=>!r.pure))throw Error('presentation changed the simulation');
 writeFileSync(`${out}/rows.json`,JSON.stringify(rows,null,1));
 if(errors.length)throw Error(errors.join('\n'));
 console.log(`OK radius 1v=${one} 5v=${five}`);
}finally{await browser.close();}
