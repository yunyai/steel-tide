import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.ARCH_UI_OUT??'docs/verification/architect-visual-control-polish';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),rows=[];
try{
 for(const [width,height] of [[1280,720],[1920,1080],[2560,1080]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>callback.name==='frame'?1:raf(callback);});
  await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192');await page.waitForFunction(()=>window.steel);
  const docked=await page.evaluate(async()=>{
   const {refitArchitect}=await import('/src/skills/misc/ArchitectRuntime.ts');
   window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
   const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0],input=b.shell.input;g.ai.clear();input.capture=false;input.fallback=true;input.onLockChange=null;b.paused=false;b.setOverlay(null);
   s.pos.set(0,0,3000);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.throttle=2;s.speed=0;s.secondaries=[];s.control.aimX=500;s.control.aimZ=2000;
   refitArchitect(s,0,{type:'vector',skill:0});refitArchitect(s,1,{type:'vector',skill:1});
   const search=s.consumables.find(c=>c.spec.type==='search');search.cooldown=50;search.charges=0;
   for(const a of s.architect.slots)a.dockedFor=3;s.architect.slots[0].capacitorCharged=true;s.architect.slots[1].capacitorCycles=1;
   const f=window.uiReview={b,g,s,pc,input};f.draw=()=>{g.interpolate();pc.camera.position.set(-700,700,3500);pc.camera.lookAt(200,40,2300);pc.camera.updateMatrixWorld(true);window.steel.renderer.update(0,[pc.camera]);b.huds[0].update(0);window.steel.renderer.render(b.viewports);};f.draw();
   const utility=document.querySelector('[data-utility="drive"]');
   return{summary:document.querySelector('.architect-docking').textContent,utility:utility.title,ready:utility.classList.contains('ready'),buttons:b.huds[0].skillEls.length,storedSearch:{charges:search.charges,cooldown:search.cooldown},overflow:document.documentElement.scrollWidth>innerWidth};
  });
  if(!docked.ready||!docked.summary.includes('DR 20%')||!docked.summary.includes('CAP 1 ready / 1 half')||!docked.utility.includes('Hull Dash + Mobile Battery')||docked.buttons!==9||docked.overflow)throw Error(JSON.stringify(docked));
  await page.screenshot({path:`${out}/docked-drive-${width}.jpg`,quality:88});
  const drive=await page.evaluate(async()=>{
   const f=window.uiReview,{s,g,pc,input,b}=f;
   window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyG'}));pc.control(1/60,input);const command=pc.out.consumable;g.step();input.endFrame();window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyG'}));f.draw();
   const active=document.querySelector('[data-utility="drive"]'),started=!!s.architect.drive;
   s.architect.drive=null;s.architect.mobileUntil=0;s.architectDriveReadyAt=g.time+8;s.mods.rooted=true;f.draw();
   const blocked={title:active.title,cool:active.classList.contains('cool'),text:active.querySelector('.t').textContent};
   s.mods.rooted=false;s.architectDriveReadyAt=0;s.control.aimZ=1500;s.activateSkill(0);for(let i=0;i<240;i++)g.step();f.draw();
   return{command,started,blocked,rings:[...document.querySelectorAll('.module-cooldowns')].map(e=>e.children.length),manual:[...document.querySelectorAll('.module-skill-cooldown')].map(e=>e.getAttribute('aria-label')||e.title).filter(s=>s.includes('manual')),summary:document.querySelector('.architect-docking').textContent,search:{charges:s.consumables[1].charges,cooldown:s.consumables[1].cooldown}};
  });
  if(drive.command!==1||!drive.started||!drive.blocked.title.includes('Rooted')||drive.blocked.text!=='8'||!drive.blocked.cool||drive.rings.some(n=>n!==1)||drive.rings.length!==2||drive.manual.length!==2)throw Error(JSON.stringify(drive));
  await page.screenshot({path:`${out}/deployed-drive-${width}.jpg`,quality:88});
  const controls=width===1280?await page.evaluate(async()=>{
   const {PlayerController}=await import('/src/player/PlayerController.ts'),{SHIP_BY_ID}=await import('/src/data/ships.ts');
   const f=window.uiReview,{g,input}=f,result=[];
   const key=(pc,code)=>{window.dispatchEvent(new KeyboardEvent('keydown',{code}));pc.control(1/60,input);input.endFrame();window.dispatchEvent(new KeyboardEvent('keyup',{code}));};
   for(const id of ['architect','stepper','yamato']){const s=g.addShip(SHIP_BY_ID[id],0,id,0,3000,0),pc=new PlayerController(s,'mouse',0,g);let lock=0,follow=0;pc.toggleLock=()=>lock++;pc.followShot=()=>follow++;key(pc,'Space');key(pc,'KeyU');document.querySelector('#view').dispatchEvent(new MouseEvent('mousedown',{button:1}));pc.control(1/60,input);input.endFrame();window.dispatchEvent(new MouseEvent('mouseup',{button:1}));result.push({id,lock,follow,keys:pc.layout});}
   const {GroundGame}=await import('/src/ground/sim/GroundGame.ts'),{VEHICLE_BY_ID}=await import('/src/ground/sim/data/index.ts'),{TankController}=await import('/src/ground/view/TankController.ts');
   const ground=new GroundGame({kind:'ground',mode:'solo',type:'freeplay',mapId:'city',teamSize:1,difficulty:'normal',players:[{vehicleId:'t34_85',device:'mouse'}],seed:7}),v=ground.addVehicle(VEHICLE_BY_ID.t34_85,0,'test',0,0,0),pc=new TankController(v,'mouse',0,ground);let lock=0;pc.toggleLock=()=>lock++;key(pc,'Space');result.push({id:'t34_85',lock,keys:pc.layout});return result;
  }):null;
  if(controls?.some(c=>c.lock!==(c.id==='t34_85'?1:2)||c.id!=='t34_85'&&c.follow!==1))throw Error(JSON.stringify(controls));
  if(errors.length)throw Error(errors.join('\n'));rows.push({width,docked,drive,controls,errors});await page.close();console.log(`HUD${width}: Drive/Search separation, blocked reason, dock/capacitors and single rings pass`);
 }
 writeFileSync(`${out}/hud-controls-results.json`,JSON.stringify(rows,null,2));
}finally{await browser.close();}
