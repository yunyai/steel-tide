import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.STEEL_STEP_OUT??'docs/verification/stepper-dimensional';mkdirSync(out,{recursive:true});
const base=process.env.STEEL_URL??'http://127.0.0.1:5184',results=[];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
try{
  for(const [quality,width,height,reduced] of [['ultralow',1280,720,false],['low',1280,720,false],['medium',1280,720,false],['high',1280,720,false],['high',1920,1080,false],['high',2560,1080,false],['high',1280,720,true]]){
    const name=`${quality}-${width}${reduced?'-reduced':''}`;
    if(process.env.STEEL_STEP_PROFILE&&process.env.STEEL_STEP_PROFILE!==name)continue;
    const record=name==='high-1280'&&!process.env.STEEL_STEP_BASELINE;
    const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',...(record?{recordVideo:{dir:out,size:{width,height}}}:{})});
    const page=await context.newPage(),errors=[],states=[];
    page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});
    await page.goto(`${base}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
    const setup=async()=>page.evaluate(async mapId=>{
      const {stateHash}=await import('/src/net/hash.ts'),{setControls}=await import('/src/input/Settings.ts'),{SHIP_BY_ID}=await import('/src/data/ships.ts');
      setControls({shake:0});
      window.steel.start({mode:'solo',type:'freeplay',mapId,teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'stepper',device:'mouse'}]});
      const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();
      b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
      s.pos.set(0,0,1500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;
      const foe=g.addShip(SHIP_BY_ID.leviathan,1,'Target',0,0,0);foe.hp=foe.maxHp=10000000;foe.colossus=false;foe.throttle=2;foe.speed=0;foe.secondaries.length=0;
      s.control.aimX=0;s.control.aimZ=0;pc.aim.set(0,0,0);
      const t=window.stepVisual={b,g,s,pc,foe,stateHash,pure:true};
      t.draw=dt=>{const h=stateHash(g);g.interpolate();window.steel.renderer.update(dt,[pc.camera]);b.huds[0].update(dt);window.steel.renderer.render(b.viewports);t.pure&&=h===stateHash(g);};
      t.camera=(wide=false)=>{pc.camera.position.set(s.pos.x-(wide?2200:420),wide?1750:210,s.pos.z+(wide?1800:420));pc.camera.lookAt(s.pos.x,35,s.pos.z-(wide?600:0));pc.camera.updateMatrixWorld(true);};
      t.run=(frames,cinematic=false)=>{for(let i=0;i<frames;i++){g.step();g.interpolate();if(cinematic)pc.updateCamera(1/60);t.draw(1/60);}};
      t.camera();t.draw(0);
    },process.env.STEEL_STEP_MAP??'open');
    const shot=async label=>{
      const state=await page.evaluate(()=>{const {s,g,b,draw,pure,stateHash}=window.stepVisual;draw(0);return{hash:stateHash(g),pure,calls:window.steel.renderer.gl.info.render.calls,overflow:document.documentElement.scrollWidth>innerWidth,light:b.scene.stepperFx?.light.count??0,ghosts:b.scene.stepperFx?.ghosts.count??0};});
      check(state.pure&&!state.overflow&&!errors.length,`${name} ${label}: ${JSON.stringify({state,errors})}`);
      states.push({label,...state});await page.screenshot({path:`${out}/${name}-${label}.jpg`,quality:90});return state;
    };
    await setup();await shot('hull-close');
    await page.evaluate(()=>{const{pc,draw}=window.stepVisual;for(let i=0;i<90;i++)pc.updateCamera(1/60);draw(0);});await shot('chase');
    for(const [index,label,frames] of [[0,'flash',6],[1,'ram',9],[2,'broad',24],[3,'over',6],[4,'back',90],[5,'side',6]]){
      await setup();const ok=await page.evaluate(({index,frames})=>{const t=window.stepVisual,{s,g}=t;s.hp*=.5;const ok=s.activateSkill(index);
        if(index===5){s.pos.x+=100;s.prevPos.copy(s.pos);g.events.emit('blink',{ship:s,fromX:0,fromZ:s.pos.z,fromHeading:0,dodge:true});}
        if(index===2)s.control.fire=true;t.run(frames);t.camera();t.draw(0);return ok;
      },{index,frames});check(ok,`${label} activation failed`);await shot(label);
    }
    for(const [index,label] of [[6,'flicker'],[7,'cross'],[8,'copies']]){
      await setup();check(await page.evaluate(index=>window.stepVisual.s.activateSkill(index),index),`${label} activation failed`);
      for(const [frames,suffix] of [[18,'start'],[84,'peak'],[73,'climax'],[20,'end']]){
        await page.evaluate(({frames,index})=>{const t=window.stepVisual;t.run(frames,index!==8);if(index===8)t.camera(true);t.draw(0);},{frames,index});await shot(`${label}-${suffix}`);
      }
      if(index===8){
        await page.evaluate(()=>{const t=window.stepVisual,c=t.g.ships.find(s=>s.summonOwner===t.s);t.pc.camera.position.set(c.pos.x-420,210,c.pos.z+420);t.pc.camera.lookAt(c.pos.x,35,c.pos.z);t.pc.camera.updateMatrixWorld(true);t.draw(0);});await shot('copy-close');
        await page.evaluate(()=>{const t=window.stepVisual;t.s.meter=1;t.s.activateSkill(7);t.run(120,true);});await shot('copies-cross');
      }
    }
    await setup();const perf=await page.evaluate(()=>{
      const t=window.stepVisual,{s,g,pc}=t;s.activateSkill(8);s.activateSkill(6);const times=[];let calls=0;
      for(let i=0;i<190;i++){const start=performance.now();t.run(1,true);times.push(performance.now()-start);calls=Math.max(calls,window.steel.renderer.gl.info.render.calls);}
      times.sort((a,b)=>a-b);return{p50:times[95],p95:times[180],calls,hash:t.stateHash(g),pure:t.pure};
    });check(perf.pure,'Performance path mutated state');
    if(record){for(const index of [6,7,8]){await setup();await page.evaluate(index=>window.stepVisual.s.activateSkill(index),index);for(let i=0;i<110;i++){await page.evaluate(index=>{const t=window.stepVisual;t.run(2,index!==8);if(index===8)t.camera(true);t.draw(0);},index);await page.waitForTimeout(17);}}}
    if(process.env.STEEL_STEP_EXTRA){
      await setup();await page.evaluate(()=>{const t=window.stepVisual;t.s.activateSkill(7);t.run(100,true);t.b.viewports[0].team=1;t.draw(0);});await shot('enemy-cross');
      await setup();await page.evaluate(()=>{const t=window.stepVisual;t.s.activateSkill(8);t.run(60);t.camera(true);const copies=t.g.ships.filter(s=>s.summonOwner===t.s);copies[0].takeDamage(1e9,null,null,false,true);copies[1].withdraw();t.draw(.08);});await shot('copies-dissolve');
      check(await page.evaluate(()=>{const t=window.stepVisual;return t.g.ships.filter(s=>s.summonOwner===t.s&&!s.alive).every(s=>!t.b.scene.views.get(s).root.visible)&&t.b.scene.stepperFx.ghosts.count>0;}),'Destroyed copies must dissolve without a sinking hull');
      await setup();await page.evaluate(()=>{const t=window.stepVisual;t.s.pos.set(-1500,0,700);t.s.prevPos.copy(t.s.pos);t.s.control.aimX=-1500;t.s.control.aimZ=-500;t.s.activateSkill(7);t.run(100,true);});await shot('shoreline-cross');
      await setup();await page.evaluate(()=>{const t=window.stepVisual;t.s.meter=0;t.pc.camera.position.set(-270,145,1780);t.pc.camera.lookAt(0,30,1500);t.pc.camera.updateMatrixWorld(true);t.draw(0);t.b.huds[0].root.style.visibility='hidden';});await shot('model-detail');
      await page.evaluate(()=>{const t=window.stepVisual;t.s.meter=1;t.s.activateSkill(8);t.run(45);});await shot('model-expanded');
    }
    await page.evaluate(()=>{const t=window.stepVisual;t.g.finish(-1,'cleanup');t.draw(0);});await shot('ended');
    check(!errors.length,JSON.stringify(errors));results.push({name,states,perf,errors});
    const video=page.video();await context.close();if(record){await video.saveAs(`${out}/stepper-dimensional-motion.webm`);await video.delete();}
    console.log(`${name}: ${states.length} views, p50 ${perf.p50.toFixed(2)}ms, p95 ${perf.p95.toFixed(2)}ms, max ${perf.calls} calls`);
  }
  for(const label of ['flicker-end','cross-end','copies-end'])check(new Set(results.map(r=>r.states.find(s=>s.label===label).hash)).size===1,`${label} differs across presets`);
  writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
