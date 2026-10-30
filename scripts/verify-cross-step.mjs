import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'docs/verification/cross-step';
mkdirSync(out, { recursive:true });
const browser = await chromium.launch({ channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless:true, args:['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const check = (ok,message) => { if (!ok) throw new Error(message); };
const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5184';
try {
  for (const [q,width,height] of [['ultralow',1280,720],['low',1280,720],['medium',1280,720],['high',1280,720],['high',1920,1080],['high',2560,1080]]) {
    const record = q === 'high' && width === 1280;
    const context = await browser.newContext({ viewport:{width,height}, ...(record?{recordVideo:{dir:out,size:{width:1280,height:720}}}:{}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',e => errors.push(String(e)));
    await page.addInitScript(() => { window.requestAnimationFrame = cb => { window.testFrame = cb; return 1; }; });
    await page.goto(`${base}/?q=${q}`);
    await page.waitForFunction(() => window.steel);
    if (q === 'high') {
      await page.getByRole('button',{name:/Hangar/}).first().click();
      await page.getByRole('button',{name:'Misc',exact:true}).click();
      await page.getByRole('button',{name:/^Stepper/}).click();
      check((await page.locator('.skill-card').count())===9,'Nine Stepper skills in hangar');
      check((await page.locator('.skill-card').allTextContents()).some(t=>t.includes('Cross-step')),'Cross-step hangar description');
      await page.evaluate(() => window.testFrame(performance.now()));
      await page.screenshot({path:`${out}/${q}-${width}-hangar.jpg`,quality:90});
      await page.locator('.skill-card').nth(7).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${out}/${q}-${width}-hangar-skills.jpg`,quality:90});
    }
    const setup = async id => page.evaluate(async id => {
      const { SHIP_BY_ID } = await import('/src/data/ships.ts');
      const { audio } = await import('/src/fx/Audio.ts');
      audio.init(); await audio.ctx?.resume(); await audio.ready();
      window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:id,device:'mouse'}]});
      const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];
      g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
      s.pos.set(0,0,1500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;
      s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;
      const t=g.addShip(SHIP_BY_ID.leviathan,1,'Test target',0,0,0);
      t.maxHp=t.hp=10000000;t.colossus=false;t.speed=0;t.throttle=2;t.secondaries.length=0;
      pc.aim.set(0,0,0);s.control.aimX=s.control.aimZ=0;
      window.crossTest={b,g,s,pc,t,audio};
      window.drawTest = dt => {
        g.interpolate();
        window.steel.renderer.update(dt,[pc.camera]);
        b.huds[0].update(dt);
        window.steel.renderer.render(b.viewports);
      };
    },id);
    const snap = async name => page.screenshot({path:`${out}/${q}-${width}-${name}.jpg`,quality:90});
    const fixtures = [];
    for (const id of ['stepper','shimakaze','gato']) {
      await setup(id);
      const r=await page.evaluate(async id => {
        const {b,g,s,pc}=window.crossTest;
        const {stateHash}=await import('/src/net/hash.ts');
        s.slot=s.slots.findIndex(p=>p.kind==='torp');
        if(id==='shimakaze')s.launchers[s.launchers.length-1].reload=10;
        if(id==='gato'){s.depthState=2;s.pos.y=-30;s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);}
        const x=id==='gato'?0:6000,z=id==='gato'?-6000:1500;
        pc.aim.set(x,0,z);s.control.aimX=x;s.control.aimZ=z;
        pc.camera.position.set(-850,950,2900);pc.camera.lookAt(id==='gato'?0:1300,0,id==='gato'?-1200:1200);
        pc.camera.updateProjectionMatrix();pc.camera.updateMatrixWorld(true);
        const before=stateHash(g);
        window.drawTest(0);
        document.querySelector('.callout').getAnimations().forEach(a=>a.finish());
        const overlay=b.scene.torpedoAim;
        const visible=overlay.root.visible,segments=overlay.ribbons.count;
        b.scene.prepare({...b.viewports[0],camera:pc.camera.clone()},720);
        const hiddenForOtherViewport=!overlay.root.visible;
        window.drawTest(0);
        return {id,visible,segments,hiddenForOtherViewport,unpaused:!b.paused&&!document.querySelector('.pause'),pure:before===stateHash(g),states:s.launchers.map(l=>s.torpedoReadiness(l,x,z))};
      },id);
      check(r.visible&&r.segments>40&&r.hiddenForOtherViewport&&r.unpaused&&r.pure,JSON.stringify(r));
      await snap(`torpedoes-${id}`);fixtures.push(r);
    }
    await setup('stepper');
    await page.evaluate(() => {
      const {s,pc}=window.crossTest;
      s.hp=s.maxHp*0.3;s.addEffect({id:'no-passive',time:20,apply(m){m.regenMul=0;}});
      s.activateSkill(4);pc.updateCamera(0);window.drawTest(0);
    });
    await snap('backstep-repair');
    const repair=await page.evaluate(() => {
      const {s,g,t}=window.crossTest;
      for(let i=0;i<150;i++)g.step();
      s.takeDamage(1000,t);
      window.drawTest(0);
      return {remaining:s.stepper.repair,status:document.querySelector('.status-row').textContent};
    });
    check(!repair.remaining&&repair.status.includes('repair interrupted'),JSON.stringify(repair));
    await snap('backstep-interrupted');
    await setup('stepper');
    await page.evaluate(() => {
      const {s,b,pc}=window.crossTest;
      b.huds[0].update(0);s.activateSkill(8);s.activateSkill(7);pc.updateCamera(0);
      b.shell.renderer.resize();window.drawTest(0);
    });
    const times=[],frames=[];
    let voices=0,drawCalls=0,segments=0;
    for(let frame=0;frame<96;frame++) {
      const r=await page.evaluate(async () => {
        const {b,g,pc,audio}=window.crossTest;
        const start=performance.now();
        g.step();g.step();pc.updateCamera(1/30);window.drawTest(1/30);
        return {ms:performance.now()-start,voices:audio.budget.size,calls:window.steel.renderer.gl.info.render.calls,segments:b.scene.crossFx.light.count};
      });
      times.push(r.ms);voices=Math.max(voices,r.voices);drawCalls=Math.max(drawCalls,r.calls);segments=Math.max(segments,r.segments);
      if([7,29,59,89,95].includes(frame)){await snap(`storm-${frame}`);frames.push(frame);}
      if(record)await page.waitForTimeout(18);
    }
    const combat=await page.evaluate(async () => {
      const {s,g,t,b,audio}=window.crossTest;
      const {stateHash}=await import('/src/net/hash.ts');
      const hash=stateHash(g);
      window.drawTest(0);
      const pure=hash===stateHash(g);
      const r={damage:t.stats.received,copies:g.ships.filter(c=>c.summonOwner===s).length,ended:!s.stepper.cross,hash,pure,overflow:document.documentElement.scrollWidth>innerWidth};
      for(let i=0;i<60;i++){g.step();window.drawTest(1/60);}
      r.cleaned=b.scene.crossFx.light.count===0&&b.scene.crossFx.dark.count===0;
      audio.stopBattle();r.audioClean=audio.budget.size===0&&audio.pending.length===0;
      return r;
    });
    check(combat.damage===2200000&&combat.ended&&combat.pure&&!combat.overflow&&combat.cleaned&&combat.audioClean,JSON.stringify(combat));
    check(voices<=42&&!errors.length,JSON.stringify({voices,errors}));
    times.sort((a,b)=>a-b);
    results.push({q,width,height,fixtures,repair,...combat,voices,drawCalls,segments,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],frames,errors});
    await context.close();
    if(record)await page.video().saveAs(`${out}/cross-step-motion.webm`);
    console.log(`${q} ${width}: damage=${combat.damage}, segments=${segments}, voices=${voices}`);
  }
  check(new Set(results.map(r=>r.hash)).size===1,'Same fixed-seed hash across all presets and viewports');
  writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
  console.log(`${results.length*10+6} screenshots; preset simulation hashes match.`);
} finally { await browser.close(); }
