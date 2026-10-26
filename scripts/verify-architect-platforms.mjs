import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
const out='docs/verification/architect-platform-buff';mkdirSync(out,{recursive:true});
const base=process.env.STEEL_URL??'http://127.0.0.1:5184',results=[];
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
const check=(v,m)=>{if(!v)throw Error(m);};
try{
  for(const [quality,width,height] of [['ultralow',1280,720],['low',1280,720],['medium',1280,720],['high',1280,720],['high',1920,1080],['high',2560,1080]]){
    const page=await browser.newPage({viewport:{width,height}}),errors=[],states=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.testFrame=cb;return 1;};});
    await page.goto(`${base}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
    await page.evaluate(()=>{
      window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
      const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();
      b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
      s.pos.set(0,0,2500);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.heading=s.prevHeading=s.renderHeading=0;s.throttle=2;s.speed=0;s.meter=1;s.secondaries.length=0;
      s.addEffect({id:'no-passive',time:1000,apply(m){m.regenMul=0;}});
      s.control.aimX=0;s.control.aimZ=0;pc.aim.set(0,0,0);
      pc.camera.position.set(-2400,2200,4200);pc.camera.lookAt(0,0,600);pc.camera.updateMatrixWorld(true);
      window.archBuff={b,g,s,pc};
      window.drawBuff=dt=>{g.interpolate();window.steel.renderer.update(dt,[pc.camera]);b.huds[0].update(dt);window.steel.renderer.render(b.viewports);};
      window.runBuff=seconds=>{for(let i=0;i<Math.round(seconds*60);i++)g.step();window.drawBuff(seconds);};
      window.drawBuff(0);
    });
    const capture=async name=>{
      const state=await page.evaluate(async()=>{
        const{s,g}=window.archBuff,{stateHash}=await import('/src/net/hash.ts'),before=stateHash(g);
        window.drawBuff(1);const after=stateHash(g),bar=document.querySelector('.cockpit .hpbar'),reserved=bar.querySelector('.reserved'),fill=bar.querySelector('.fill');
        const markers=[...document.querySelectorAll('.module-contact')].filter(e=>getComputedStyle(e).display!=='none');
        const bars=markers.map(e=>({label:e.getAttribute('aria-label'),width:e.querySelector('.hp i').style.width,display:getComputedStyle(e.querySelector('.hp')).display}));
        return{hp:s.hp,activeMax:s.maxHp,maximum:document.querySelector('.cockpit .hpnum').textContent,reserved:reserved.style.width,reservedDisplay:getComputedStyle(reserved).display,fill:fill.style.width,hit:bar.classList.contains('hit'),bars,hash:after,pure:before===after,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      check(state.pure&&!state.overflow&&!errors.length,JSON.stringify({state,errors}));
      check(state.maximum.includes('2,500,000'),'Full maximum stays fixed');
      check(state.bars.every(b=>b.display!=='none'&&b.label),'Every visible module has a health bar');
      states.push({name,...state});await page.screenshot({path:`${out}/${quality}-${width}-${name}.jpg`,quality:90});return state;
    };
    await capture('deck');
    await page.evaluate(()=>{
      const{s,g}=window.archBuff;
      for(const [x,z] of [[0,0],[0,-1100],[1300,-600],[-1300,-600],[0,1200]]){
        s.control.aimX=x;s.control.aimZ=z;s.skills[0].cooldown=0;if(!s.activateSkill(0))throw Error(s.skillFailure);for(let i=0;i<240;i++)g.step();
      }
      window.drawBuff(0);
    });
    const deployed=await capture('deployed');check(deployed.hp===1500000&&deployed.activeMax===1500000&&deployed.reserved==='40%'&&deployed.fill==='60%'&&!deployed.hit,'Full deployment bar');
    check(deployed.bars.length===10,'Ten visible health bars');
    if(quality==='high'){
      await page.evaluate(()=>{const{s}=window.archBuff;s.hp-=300000;s.architect.slots[0].entity.hp=100000;s.architect.slots[1].entity.hp=40000;window.runBuff(.1);});
      const damaged=await capture('damaged');check(damaged.reserved==='40%'&&damaged.fill==='48%','Damage distinct from reservation');
      check(damaged.bars.some(b=>b.width==='20%')&&damaged.bars.some(b=>b.width==='50%'),'Platform damage shown');
      await page.evaluate(()=>{const{s}=window.archBuff;s.architect.slots[2].entity.takeDamage(1e9,null,null,false,true);window.runBuff(.1);});
      const destroyed=await capture('destroyed');check(destroyed.reserved==='40%'&&destroyed.bars.length===9,'Destroyed module stays reserved');
      await page.evaluate(()=>window.runBuff(12));const rebuilt=await capture('rebuilt');check(rebuilt.reserved==='36%'&&rebuilt.activeMax===1600000,'Rebuild restores capacity');
      await page.evaluate(()=>{const{s}=window.archBuff;s.activateSkill(4);window.runBuff(5);});
      const recalled=await capture('recalled');check(recalled.reservedDisplay==='none'&&recalled.activeMax===2500000&&!recalled.bars.length,'Recall returns capacity');
      await page.evaluate(()=>{const{s}=window.archBuff;s.meter=1;s.activateSkill(8);window.runBuff(2);const{pc}=window.archBuff;pc.camera.position.set(-1700,1100,4100);pc.camera.lookAt(0,150,2500);pc.camera.updateMatrixWorld(true);window.drawBuff(0);});
      const citadel=await capture('citadel');check(citadel.bars.length===10,'Airborne turret health bars');
    }
    results.push({quality,width,height,states,errors});await page.close();console.log(`${quality} ${width}x${height}: ${states.length} states verified`);
  }
  check(new Set(results.map(r=>r.states.find(s=>s.name==='deployed').hash)).size===1,'Presets preserve simulation');
  writeFileSync(`${out}/ui-results.json`,JSON.stringify(results,null,2));console.log('Platform HUD screenshots and health bars verified.');
}finally{await browser.close();}
