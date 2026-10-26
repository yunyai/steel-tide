import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='docs/verification/architect';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const results=[];const check=(v,m)=>{if(!v)throw new Error(m);};
const base=process.env.STEEL_URL??'http://127.0.0.1:5184';
try{
for(const [q,width,height] of [['ultralow',1280,720],['low',1280,720],['medium',1280,720],['high',1280,720],['high',1920,1080],['high',2560,1080]]){
  const record=q==='high'&&width===1280;
  const context=await browser.newContext({viewport:{width,height},...(record?{recordVideo:{dir:out,size:{width:1280,height:720}}}:{})});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.testFrame=cb;return 1;};});
  await page.goto(`${base}/?q=${q}`);await page.waitForFunction(()=>window.steel);
  const shot=async name=>{await page.screenshot({path:`${out}/${q}-${width}-${name}.jpg`,quality:90});};
  if(q==='high'){
    await page.getByRole('button',{name:/Hangar/}).first().click();await page.getByRole('button',{name:'Misc',exact:true}).click();await page.getByRole('button',{name:/^Architect/}).click();
    await page.evaluate(()=>window.testFrame(performance.now()));await shot('hangar');
    check(await page.locator('.skill-card').count()===9,'Nine Architect skills');await page.locator('.skill-card').nth(8).scrollIntoViewIfNeeded();await shot('hangar-ultimates');
  }
  const setup=async()=>page.evaluate(async()=>{
    const {SHIP_BY_ID}=await import('/src/data/ships.ts');const {audio}=await import('/src/fx/Audio.ts');
    audio.init();await audio.ctx?.resume();await audio.ready();
    window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
    const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();
    b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
    s.pos.set(0,0,2500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;
    const t=g.addShip(SHIP_BY_ID.leviathan,1,'Test target',0,-1800,Math.PI/2);t.hp=t.maxHp=10000000;t.colossus=false;t.throttle=2;t.speed=0;t.secondaries.length=0;t.spec={...t.spec,aa:{range:0,dps:0}};
    s.control.aimX=0;s.control.aimZ=-1800;pc.aim.set(0,0,-1800);
    pc.camera.position.set(-1700,1000,3700);pc.camera.lookAt(0,40,1400);pc.camera.updateMatrixWorld(true);
    window.archTest={b,g,s,t,pc,audio};
    window.drawArch=dt=>{g.interpolate();window.steel.renderer.update(dt,[pc.camera]);b.huds[0].update(dt);window.steel.renderer.render(b.viewports);};
    window.runArch=frames=>{for(let i=0;i<frames;i++)g.step();window.drawArch(frames/60);};
    b.huds[0].update(0);document.querySelector('.callout')?.getAnimations().forEach(a=>a.finish());window.drawArch(0);
  });
  await setup();await shot('deck');
  const deployed=await page.evaluate(()=>{
    const {s,g,b,pc}=window.archTest;
    for(const [x,z] of [[0,0],[0,-1100],[1300,-600],[-1300,-600],[0,1200]]){
      s.control.aimX=x;s.control.aimZ=z;s.skills[0].cooldown=0;if(!s.activateSkill(0))throw Error(s.skillFailure);for(let i=0;i<80;i++)g.step();
    }
    for(let i=0;i<240;i++)g.step();s.activateSkill(2);
    pc.camera.position.set(-2300,1800,4000);pc.camera.lookAt(0,0,200);pc.camera.updateMatrixWorld(true);window.drawArch(0);
    return {count:s.architect.slots.filter(a=>a.state==='deployed').length,hp:s.hp,maxHp:s.maxHp,slots:document.querySelectorAll('.architect-slot').length,hiddenDockTurrets:s.turrets.every((_,i)=>!b.scene.views.get(s).root.getObjectByName(`architect-turret-${i}`).visible)};
  });
  check(deployed.count===10&&deployed.hp===1000000&&deployed.maxHp===1000000&&deployed.slots===10&&deployed.hiddenDockTurrets,JSON.stringify(deployed));await shot('network');
  await page.evaluate(()=>{const{s,pc}=window.archTest;s.control.aimX=0;s.control.aimZ=-1800;pc.aim.set(0,0,-1800);s.activateSkill(1);window.runArch(2);});await shot('command-burst');
  await setup();
  await page.evaluate(()=>{const{s}=window.archTest;s.activateSkill(6);window.runArch(42);});await shot('assembly-build');
  await page.evaluate(()=>window.runArch(90));await shot('assembly-charge');
  const assembly=await page.evaluate(()=>{window.runArch(78);const{s,t,b}=window.archTest;return{damage:t.stats.received,hp:s.hp,maxHp:s.maxHp,cannon:b.scene.views.get(s).root.getObjectByName('architect-final-assembly').visible};});
  check(assembly.damage===1200000&&assembly.cannon,JSON.stringify(assembly));await shot('assembly-fire');
  await setup();await page.evaluate(()=>{const{s,pc}=window.archTest;s.activateSkill(7);pc.camera.position.set(-2500,2300,2500);pc.camera.lookAt(0,0,-900);pc.camera.updateMatrixWorld(true);window.runArch(90);});await shot('killbox-build');
  await page.evaluate(()=>window.runArch(125));await shot('killbox-crossfire');
  const killbox=await page.evaluate(()=>{window.runArch(355);return{damage:window.archTest.t.stats.received,ended:!window.archTest.s.architect.ultimate};});
  check(killbox.damage===960000&&killbox.ended,JSON.stringify(killbox));
  await setup();await page.evaluate(()=>{const{s}=window.archTest;s.activateSkill(8);window.runArch(90);});
  const times=[];let voices=0,calls=0;
  for(let frame=0;frame<120;frame++){
    const r=await page.evaluate(()=>{
      const {s,g,pc,audio}=window.archTest;const start=performance.now();g.step();g.step();
      pc.camera.position.set(-1800,1100,4100);pc.camera.lookAt(s.pos.x,130,s.pos.z);pc.camera.updateMatrixWorld(true);window.drawArch(1/30);
      return{ms:performance.now()-start,voices:audio.budget.size,calls:window.steel.renderer.gl.info.render.calls};
    });times.push(r.ms);voices=Math.max(voices,r.voices);calls=Math.max(calls,r.calls);
    if(frame===20)await shot('citadel');if(frame===85)await shot('citadel-fire');if(record)await page.waitForTimeout(15);
  }
  const citadel=await page.evaluate(async()=>{
    const{s,g,b}=window.archTest,{stateHash}=await import('/src/net/hash.ts');const hash=stateHash(g);
    window.drawArch(0);const pure=stateHash(g)===hash;
    const elevated=s.architect.slots.every(a=>a.entity&&a.entity.pos.y>=150),panels=b.scene.architectFx.panels.count;
    const moduleHealth=[...document.querySelectorAll('.architect-slot')].map(e=>getComputedStyle(e.querySelector('i')).transform);
    window.runArch(560);const landed=s.architect.slots.every(a=>a.state==='docked'||a.state==='deployed'||a.state==='returning');
    g.finish(-1,'verification');window.drawArch(0);return{hash,pure,elevated,panels,landed,cleanup:b.scene.architectFx.panels.count===0&&s.architect.slots.every(a=>!a.entity?.alive),moduleHealth,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  check(citadel.pure&&citadel.elevated&&citadel.panels===10&&citadel.landed&&citadel.cleanup&&!citadel.overflow&&!errors.length,JSON.stringify({citadel,errors}));await shot('citadel-ended');
  times.sort((a,b)=>a-b);results.push({q,width,height,deployed,assembly,killbox,citadel,voices,calls,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],errors});
  await context.close();if(record)await page.video().saveAs(`${out}/architect-motion.webm`);console.log(`${q} ${width}: full battery,1.2M Assembly,960k Killbox,10 airborne platforms verified`);
}
check(new Set(results.map(r=>r.citadel.hash)).size===1,'Preset rendering must not alter simulation');writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log('Verification passed:66 battle captures +6 hangar screenshots and motion video.');
}finally{await browser.close();}
