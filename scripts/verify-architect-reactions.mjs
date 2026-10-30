import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
// All ten elemental reactions at three ages, chain arcs, and the mark glyph seen by each side.
const source=process.env.STEEL_URL??'http://127.0.0.1:5198',out=process.env.REACTION_OUT??'docs/verification/architect-reactions';
const quality=process.env.REACTION_QUALITY??'high',reduced=process.env.REACTION_REDUCED==='1';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],rows=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
 await page.goto(`${source}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 const setup=()=>page.evaluate(async()=>{
  const {SHIP_BY_ID}=await import('/src/data/ships.ts'),elements=await import('/src/skills/misc/ArchitectElements.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  s.pos.set(0,0,1800);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.throttle=2;s.speed=0;s.secondaries.length=0;
  const add=(id,x,z)=>{const t=g.addShip(SHIP_BY_ID[id],1,id,x,z,0);t.hp=t.maxHp=1e8;t.secondaries.length=0;t.throttle=2;t.speed=0;t.colossus=false;return t;};
  const t=add('leviathan',0,-800);add('iowa',380,-640);add('iowa',-420,-560);
  const f=window.reactionShot={b,g,s,t,pc,elements,stateHash,pure:true};
  f.draw=()=>{const h=stateHash(g);g.interpolate();pc.camera.position.set(t.pos.x-520,t.pos.y+300,t.pos.z+480);pc.camera.lookAt(t.pos.x,70,t.pos.z);pc.camera.updateMatrixWorld(true);window.steel.renderer.update(1/60,[pc.camera]);window.steel.renderer.render(b.viewports);f.pure&&=stateHash(g)===h;};
  b.huds[0].root.style.visibility='hidden';
 });
 const shot=async name=>{await page.screenshot({path:`${out}/${name}.jpg`,quality:85});};
 const keys=['cryo+furnace','furnace+storm','furnace+gravity','furnace+prism','cryo+storm','cryo+gravity','cryo+prism','gravity+storm','prism+storm','gravity+prism'];
 for(const key of keys){
  await setup();
  await page.evaluate(key=>{const f=window.reactionShot,[a,b]=f.s.architect.slots,[x,y]=key.split('+');a.element=x;b.element=y;f.elements.applyElementMark(f.s,a,f.t);f.draw();},key);
  if(key==='cryo+furnace'){
   const seen=await page.evaluate(()=>{const f=window.reactionShot,fx=f.b.scene.elementFx;fx.prepare(f.s.team);const own=fx.reactions.marks;fx.prepare(f.t.team);const enemy=fx.reactions.marks;f.draw();return{own,enemy};});
   if(seen.own!==1||seen.enemy!==0)throw Error(`mark glyph visibility ${JSON.stringify(seen)}`);
   await shot('mark');
  }
  await page.evaluate(()=>{const f=window.reactionShot;f.start=f.g.time;f.elements.applyElementMark(f.s,f.s.architect.slots[1],f.t);});
  for(const age of [.1,.4,.8]){
   const r=await page.evaluate(age=>{const f=window.reactionShot;while(f.g.time-f.start<age)f.g.step();f.draw();const fx=f.b.scene.elementFx.reactions;return{drawn:[...fx.drawn],count:fx.count,streaks:fx.streaks.count,calls:window.steel.renderer.gl.info.render.calls,pure:f.pure};},age);
   rows.push({key,age,...r});if(!r.pure)throw Error(`sim changed during ${key}`);
   await shot(`${key.replace('+','-')}-${String(age).replace('.','')}`);
  }
 }
 writeFileSync(`${out}/rows.json`,JSON.stringify(rows,null,1));
 for(const key of keys){const mine=rows.filter(r=>r.key===key);if(!mine.slice(0,2).every(r=>r.drawn.includes(key)&&r.count>0))throw Error(`${key} did not draw`);}
 const chained=['furnace+storm','cryo+storm','gravity+storm','prism+storm'];if(!chained.every(k=>rows.find(r=>r.key===k&&r.age===.1).streaks>0))throw Error('a storm reaction drew no chain arcs');
 if(errors.length)throw Error(errors.join('\n'));
 console.log(rows.map(r=>`${r.key} ${r.age} drawn=${r.drawn.join(',')} count=${r.count} streaks=${r.streaks}`).join('\n'));
}finally{await browser.close();}
