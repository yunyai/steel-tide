import {chromium} from 'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const out=process.env.ARCH_UI_OUT??'docs/verification/architect-polish-ui';mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[];
try{for(const [width,height]of[[1280,720],[1920,1080],[2560,1080]]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>callback.name==='frame'?1:raf(callback);});await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192');await page.waitForFunction(()=>window.steel);
 const hud=await page.evaluate(()=>{
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  s.pos.set(0,0,3000);s.throttle=2;s.speed=0;s.secondaries=[];s.control.aimX=500;s.control.aimZ=2000;
  const t=g.addShip(g.shipSpec('leviathan'),1,'Target',0,2000,0);t.hp=t.maxHp=1e8;t.colossus=false;t.throttle=2;t.speed=0;t.secondaries=[];
  s.activateSkill(0);for(let i=0;i<240;i++)g.step();s.control.aimX=t.pos.x;s.control.aimZ=t.pos.z;s.control.targetId=t.id;
  for(const i of[1,2,5])if(!s.activateSkill(i))throw Error(s.skillFailure);for(let i=0;i<30;i++)g.step();
  const f=window.uiReview={b,g,s,pc,t};f.draw=()=>{g.interpolate();pc.camera.position.set(-700,700,3500);pc.camera.lookAt(200,40,2300);pc.camera.updateMatrixWorld(true);window.steel.renderer.update(0,[pc.camera]);b.huds[0].update(0);window.steel.renderer.render(b.viewports);b.pickerSync?.();};f.draw();
  return{skills:[1,2,5].map(i=>({index:i,active:b.huds[0].skillEls[i].root.classList.contains('active'),text:b.huds[0].skillEls[i].t.textContent})),rings:[...document.querySelectorAll('.module-cooldowns')].map(e=>e.children.length),gunLabels:document.querySelectorAll('[aria-label="Gun reload"]').length,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 if(hud.skills.some(s=>!s.active)||hud.rings.length<1||hud.rings.some(n=>n!==1)||hud.gunLabels||hud.overflow)throw Error(JSON.stringify(hud));
 await page.screenshot({path:`${out}/combat-${width}.jpg`,quality:88});
 await page.evaluate(()=>{window.uiReview.b.setPaused(true);window.uiReview.b.openShipPicker();window.uiReview.draw();});await page.waitForFunction(()=>!document.pointerLockElement);const editor=page.locator('.arsenal-editor');
 await page.screenshot({path:`${out}/refit-before-${width}.jpg`,quality:88});
 await editor.getByRole('button',{name:'Balanced',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.arsenal-result')?.textContent.includes('applied'));
 const preset=await page.evaluate(()=>{const f=window.uiReview;f.b.pickerSync?.();return{failure:f.s.skillFailure,locked:f.s.architect.slots.filter(a=>a.state!=='docked').map(a=>({type:a.type,skill:a.skill,timer:a.skillTimer})),result:document.querySelector('.arsenal-result')?.textContent};});
 if(preset.failure)throw Error(`Preset produced failure: ${preset.failure}`);
 await page.screenshot({path:`${out}/refit-${width}.jpg`,quality:88});
 const unlocked=await page.evaluate(()=>{const f=window.uiReview,slot=document.querySelector('[data-arsenal-key="slot-0"]');slot.click();const before=document.querySelector('.arsenal-detail select').disabled;f.s.activateSkill(4);for(let i=0;i<180;i++)f.g.step();f.draw();return{before,after:document.querySelector('.arsenal-detail select').disabled,focus:document.activeElement?.dataset.arsenalKey};});
 if(!unlocked.before||unlocked.after)throw Error(JSON.stringify(unlocked));
 rows.push({width,hud,preset,unlocked,errors});if(errors.length)throw Error(errors.join('\n'));await page.close();console.log(`Battle UI ${width}: passed active durations, single rings and refit synchronization`);
}writeFileSync(`${out}/battle-results.json`,JSON.stringify(rows,null,2));}finally{await browser.close();}
