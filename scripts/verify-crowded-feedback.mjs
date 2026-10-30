import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';

const out=process.env.FEEDBACK_OUT??'docs/verification/architect-polish-feedback';mkdirSync(out,{recursive:true});
// The Graphics "Damage numbers" size; the layout must stay readable and unclipped at every offered scale.
const damageScale=Number(process.env.DAMAGE_SCALE??1);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(scale=>{window.requestAnimationFrame=()=>1;localStorage.setItem('steel-tide.display',JSON.stringify({damageScale:scale}));},damageScale);
  await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192/?q=ultralow');
  await page.waitForFunction(()=>window.steel);
  await page.evaluate(async()=>{
    const {loadoutPreset}=await import('/src/data/architectLoadout.ts'),{setArchitectLoadout}=await import('/src/skills/misc/ArchitectRuntime.ts'),{stateHash}=await import('/src/net/hash.ts');
    window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
    const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
    const owners=[s];s.pos.set(0,0,2600);for(let i=1;i<3;i++)owners.push(g.addShip(g.shipSpec('architect'),0,'Builder',i*350,2600,0));
    for(const a of owners){setArchitectLoadout(a,loadoutPreset('balanced'));a.effects=[];a.throttle=2;a.speed=0;a.secondaries=[];a.hp*=.8;a.control.aimX=0;a.control.aimZ=0;}
    for(let i=0;i<8;i++){const t=g.addShip(g.shipSpec('leviathan'),1,'Target',(i%4-1.5)*480,Math.floor(i/4)*500-250,0);t.hp=t.maxHp=1e9;t.colossus=false;t.throttle=2;t.speed=0;t.secondaries=[];}
    pc.camera.position.set(-2700,2300,3400);pc.camera.lookAt(0,60,0);pc.camera.updateMatrixWorld(true);
    const f=window.feedbackReview={b,g,pc,stateHash,pure:true};
    f.draw=()=>{const before=stateHash(g);g.interpolate();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
    for(let i=0;i<90;i++){g.step();f.draw();}
    for(const a of owners){a.meter=1;if(!a.activateSkill(7))throw Error(a.skillFailure);}
    f.started=g.time;f.draw();
  });
  for(let chunk=0;chunk<=16;chunk++)await page.evaluate(()=>{for(let i=0;i<30;i++){window.feedbackReview.g.step();window.feedbackReview.draw();}});
  const result=await page.evaluate(()=>{
    const f=window.feedbackReview,hud=f.b.huds[0],feedback=hud.fb;
    // The simulation fixture is exact; pin the independent CSS clock so this also exercises
    // the active Ultimate Ready guard and every number's largest entry footprint.
    hud.callout('Ultimate ready','Grand Battery: press T','#ffb547');
    for(const animation of hud.root.querySelector('.callout').getAnimations())animation.currentTime=400;
    for(const animation of document.getAnimations())if(animation.effect?.target?.closest('.pop'))animation.currentTime=0;
    const before=f.stateHash(f.g);hud.update(0);f.pure&&=before===f.stateHash(f.g);
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
    const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const union=(a,b)=>({left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)});
    const guards=[...hud.root.querySelectorAll('.top,.callout,.alert,.banner,.siren')].filter(node=>{
      const css=getComputedStyle(node);return node.textContent&&css.display!=='none'&&css.visibility!=='hidden'&&Number(css.opacity)>.01;
    }).map(node=>({name:node.className,...rect(node)}));
    const live=feedback.pops.filter(p=>p.live),shown=live.filter(p=>getComputedStyle(p.el).visibility!=='hidden'&&getComputedStyle(p.el).display!=='none');
    const entryVisual=shown.map(p=>{let box=rect(p.el);for(const node of p.el.children)box=union(box,rect(node));return box;});
    const entryOverflowed=entryVisual.filter(box=>box.left<0||box.top<0||box.right>innerWidth||box.bottom>innerHeight).length;
    const entryGuardOverlaps=entryVisual.reduce((n,box)=>n+guards.filter(g=>intersects(box,g)).length,0);
    for(const animation of document.getAnimations()){
      if(animation.effect?.target?.closest('.pop'))animation.finish();
      else animation.pause();
    }
    const popups=shown.map(p=>{
      let visual=rect(p.el);for(const node of p.el.children)visual=union(visual,rect(node));
      const exact=Math.round(p.damage).toLocaleString(),label=p.el.getAttribute('aria-label');
      return {text:p.el.textContent,number:p.num.textContent,exact,label,title:p.el.title,dense:p.el.classList.contains('dense'),bounds:rect(p.el),visual,accessible:p.damage<=0||!!label?.includes(exact),guardOverlaps:guards.filter(g=>intersects(visual,g)).map(g=>g.name)};
    });
    return {viewport:{width:innerWidth,height:innerHeight},simulationSeconds:f.g.time-f.started,pure:f.pure,controlledAlertPhaseMs:400,pool:feedback.pops.length,live:live.length,visible:shown.length,hidden:live.length-shown.length,expired:feedback.pops.length-live.length,entryOverflowed,entryGuardOverlaps,overflowed:popups.filter(p=>p.visual.left<0||p.visual.top<0||p.visual.right>innerWidth||p.visual.bottom>innerHeight).length,guardOverlaps:popups.reduce((n,p)=>n+p.guardOverlaps.length,0),allAccessible:popups.every(p=>p.accessible),guards,popups};
  });
  await page.screenshot({path:`${out}/after-1280.png`});
  writeFileSync(`${out}/results.json`,JSON.stringify({...result,errors},null,2));
  console.log(JSON.stringify({...result,popups:result.popups.map(({text,number,exact,accessible,guardOverlaps})=>({text,number,exact,accessible,guardOverlaps})),errors},null,2));
  if(errors.length||!result.pure||result.visible<4||result.overflowed||result.guardOverlaps||result.entryOverflowed||result.entryGuardOverlaps||!result.guards.some(g=>g.name.includes('callout'))||!result.allAccessible)throw Error('Crowded feedback browser acceptance failed; inspect results.json and after-1280.png');
}finally{await browser.close();}
