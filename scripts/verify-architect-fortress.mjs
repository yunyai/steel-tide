import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.STEEL_ARCH_OUT??'docs/verification/architect-fortress';mkdirSync(out,{recursive:true});
const base=process.env.STEEL_URL??'http://127.0.0.1:5184',results=[];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
try{
  for(const [quality,width,height,reduced] of [['ultralow',1280,720,false],['low',1280,720,false],['medium',1280,720,false],['high',1280,720,false],['high',1920,1080,false],['high',2560,1080,false],['high',1280,720,true]]){
    if(process.env.STEEL_ARCH_PROFILE&&process.env.STEEL_ARCH_PROFILE!==`${quality}-${width}${reduced?'-reduced':''}`)continue;
    const name=`${quality}-${width}${reduced?'-reduced':''}`,record=quality==='high'&&width===1280&&!reduced;
    const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',...(record?{recordVideo:{dir:out,size:{width,height}}}:{})});
    const page=await context.newPage(),errors=[],states=[];
    page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.testFrame=cb;return 1;};});
    await page.goto(`${base}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
    const setup=async()=>page.evaluate(async()=>{
      const {stateHash}=await import('/src/net/hash.ts'),{setControls}=await import('/src/input/Settings.ts');
      setControls({shake:0});
      window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
      const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();
      b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
      s.pos.set(0,0,2500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;
      s.control.aimX=0;s.control.aimZ=-1800;pc.aim.set(0,0,-1800);
      const draw=dt=>{g.interpolate();window.steel.renderer.update(dt,[pc.camera]);b.huds[0].update(dt);window.steel.renderer.render(b.viewports);};
      const camera=(x,y,z,tx=0,ty=40,tz=2500)=>{pc.camera.position.set(x,y,z);pc.camera.lookAt(tx,ty,tz);pc.camera.updateMatrixWorld(true);};
      const run=frames=>{for(let i=0;i<frames;i++){g.step();g.interpolate();window.steel.renderer.update(1/60,[pc.camera]);}b.huds[0].update(frames/60);window.steel.renderer.render(b.viewports);};
      window.fort={b,g,s,pc,draw,run,camera,stateHash};camera(-570,360,2900);draw(0);
    });
    const shot=async label=>{
      const state=await page.evaluate(()=>{
        const {s,g,b,draw,stateHash}=window.fort,hash=stateHash(g);draw(0);
        const root=b.scene.views.get(s).root,heights=b.scene.architectFx.panels.geometry.getAttribute('iHeights');
        const panels=Array.from({length:b.scene.architectFx.panels.count},(_,i)=>heights?[heights.getX(i),heights.getY(i),heights.getZ(i),heights.getW(i)]:[]);
        const renderer=window.steel.renderer.gl,gl=renderer.getContext(),pixels=new Uint8Array(renderer.domElement.width*renderer.domElement.height*4);gl.readPixels(0,0,renderer.domElement.width,renderer.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let blue=0,samples=0;for(let i=0;i<pixels.length;i+=64){samples++;if(pixels[i+2]>pixels[i]+10&&pixels[i+2]>pixels[i+1]+3)blue++;}
        return{blueFraction:blue/samples,hash,pure:hash===stateHash(g),panels,satellites:Array.from({length:10},(_,i)=>root.getObjectByName(`architect-satellite-${i}`)?.visible??false).filter(Boolean).length,assembly:root.getObjectByName('architect-final-assembly').visible,calls:window.steel.renderer.gl.info.render.calls,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      check(state.pure&&!state.overflow&&!errors.length,`${name} ${label}: ${JSON.stringify({state,errors})}`);
      if(label==='assembly-lock')check(state.blueFraction>.05,`${name}: Assembly charge blacked out the scene (${state.blueFraction})`);
      states.push({label,...state});await page.screenshot({path:`${out}/${name}-${label}.jpg`,quality:90});return state;
    };
    await setup();await shot('turrets-close');
    await page.evaluate(()=>{const {pc,draw}=window.fort;for(let i=0;i<90;i++)pc.updateCamera(1/60);draw(0);});await shot('normal-chase');
    await page.evaluate(()=>{const {s,camera,run}=window.fort;s.control.aimX=650;s.control.aimZ=2100;s.activateSkill(0);run(12);camera(-450,360,2900,250,60,2300);});await shot('launch');
    await page.evaluate(()=>{const {run,camera}=window.fort;run(120);camera(300,160,2350,650,20,2100);});await shot('platform-close');
    await page.evaluate(()=>{const {s,camera,draw}=window.fort;camera(-570,360,2900);draw(0);s.activateSkill(4);});await shot('empty-sockets');
    await page.evaluate(()=>window.fort.run(120));await shot('recalled');
    await setup();await page.evaluate(()=>window.fort.s.activateSkill(6));
    for(const [frames,label] of [[48,'assembly-build'],[78,'assembly-charge'],[60,'assembly-lock'],[24,'assembly-fire'],[6,'assembly-flash'],[6,'assembly-recoil'],[18,'assembly-return']]){
      await page.evaluate(frames=>window.fort.run(frames),frames);const state=await shot(label);
      if(label==='assembly-charge')check(state.satellites===10,'Ten surviving satellites must surround the cannon');
      if(label==='assembly-return')check(!state.assembly,'Assembly must finish at its existing four seconds');
      if(label==='assembly-fire'){await page.evaluate(()=>{const{camera,draw}=window.fort;camera(-3800,2100,2800,0,80,-200);draw(0);});await shot('assembly-beam-wide');await page.evaluate(()=>window.fort.camera(-570,360,2900));}
    }
    await setup();await page.evaluate(()=>{const{s,run}=window.fort;s.activateSkill(6);s.architect.slots[3].entity.takeDamage(1e9,null,null,false,true);run(130);});
    check((await shot('assembly-missing-module')).satellites===9,'Destroyed participant must not become a satellite');
    await setup();await page.evaluate(()=>{const {s,run,camera}=window.fort;s.control.aimZ=1200;s.activateSkill(7);run(130);camera(-1600,1600,3200,0,0,1600);});await shot('killbox');
    await setup();await page.evaluate(()=>{const {s,run,camera}=window.fort;s.activateSkill(8);run(120);camera(-1100,650,3600,0,80,2500);});
    const citadel=await shot('citadel');check(citadel.panels.length===10&&citadel.panels.every(p=>Math.max(p[0],p[1])<5&&Math.min(p[2],p[3])>200),'Walls must reach water from the airborne ring');
    await page.evaluate(()=>{const{camera,draw}=window.fort;camera(-1000,55,3350,0,80,2500);draw(0);});await shot('citadel-waterline');
    await page.evaluate(()=>{const {b,pc,draw}=window.fort;b.viewports[0].team=1;pc.camera.position.y=550;pc.camera.lookAt(0,80,2500);pc.camera.updateMatrixWorld(true);draw(0);});await shot('enemy-citadel');
    await page.evaluate(()=>{const {s,b,draw}=window.fort;b.viewports[0].team=0;for(const slot of s.architect.slots.slice(2))slot.entity.takeDamage(1e9,null,null,false,true);draw(0);});
    check((await shot('citadel-two-modules')).panels.length===1,'Two survivors form one wall, not overlapping closed panels');
    await page.evaluate(()=>{const{s,draw}=window.fort;s.architect.slots[1].entity.takeDamage(1e9,null,null,false,true);draw(0);});check((await shot('citadel-one-module')).panels.length===0,'One survivor must not imply a protective enclosure');
    await page.evaluate(()=>{window.fort.g.finish(-1,'cleanup');window.fort.draw(0);});check((await shot('ended')).panels.length===0,'Battle cleanup removes walls');
    if(record){
      await setup();await page.evaluate(()=>window.fort.s.activateSkill(6));
      for(let f=0;f<126;f++){await page.evaluate(()=>window.fort.run(2));await page.waitForTimeout(17);}
      // Terrain and unequal heights: preserve the edge heights, let solid terrain occlude interiors.
      await setup();const terrain=await page.evaluate(()=>{
        const {s,g,run,draw,b}=window.fort;s.activateSkill(8);run(120);
        const original=g.map.heightAt.bind(g.map);g.map.heightAt=(x,z)=>Math.abs(x-s.pos.x)<750&&Math.abs(z-s.pos.z)<750?60:original(x,z);
        s.architect.slots[0].entity.pos.y+=80;s.architect.slots[0].entity.prevPos.y+=80;draw(0);
        const heights=b.scene.architectFx.panels.geometry.getAttribute('iHeights');
        return{bottom:heights.getX(0),uneven:Math.abs(heights.getZ(0)-heights.getW(0)),count:b.scene.architectFx.panels.count};
      });check(terrain.bottom<5&&terrain.uneven>50&&terrain.count===10,'Shield edges follow terrain and unequal platform heights');await shot('citadel-terrain-height');
    }
    check(errors.length===0,JSON.stringify(errors));results.push({name,states,errors});
    const video=page.video();await context.close();if(record){await video.saveAs(`${out}/architect-fortress-motion.webm`);await video.delete();}
    console.log(`${name}: ${states.length} views, waterline/partial-loss/cleanup/hash checks passed`);
  }
  for(const label of ['assembly-charge','assembly-return','citadel','ended'])check(new Set(results.map(r=>r.states.find(s=>s.label===label).hash)).size===1,`${label}: preset changed simulation`);
  writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
