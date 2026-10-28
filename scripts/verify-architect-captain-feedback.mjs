import{chromium}from'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const out=process.env.ARCH_UI_OUT??'docs/verification/architect-visual-control-polish';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192');await page.waitForFunction(()=>window.steel);
 const result=await page.evaluate(async()=>{
  const{SHIP_BY_ID}=await import('/src/data/ships.ts'),{audio}=await import('/src/fx/Audio.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'yamato',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,me=g.humans()[0],hud=b.huds[0];g.ai.clear();
  me.pos.set(0,0,3000);me.throttle=2;me.speed=0;me.secondaries=[];
  const architect=g.addShip(SHIP_BY_ID.architect,1,'Enemy architect',0,1500,0);architect.throttle=2;architect.speed=0;architect.secondaries=[];architect.control.aimX=0;architect.control.aimZ=2200;
  architect.activateSkill(0);for(let i=0;i<180;i++)g.step();
  const modules=architect.architect.slots.map(s=>s.entity).filter(s=>s?.alive).slice(0,2);if(modules.length!==2)throw Error('Fixture did not deploy two platforms');
  const ui=[],ruptures=[],play=audio.play,uiPlay=audio.ui;audio.ui=kind=>ui.push(kind);audio.play=(...args)=>{if(args[6]?.key?.startsWith('death:'))ruptures.push(args[6].key);};
  let moduleEvents=0;const off=g.events.on('shipSunk',e=>{if(e.ship.architectPlatform)moduleEvents++;});
  b.slow=0;const snapshot=()=>({feed:hud.feed.length,streak:hud.fb.streak,killmark:hud.fb.killmark.classList.contains('on'),banner:hud.bannerUntil>g.time,callout:hud.e.callout.textContent,slow:b.slow,kills:me.stats.kills,streakSounds:ui.filter(s=>s==='streak').length});
  for(const module of modules)module.sink(me);const afterModules=snapshot();
  // Drones currently emit no shipSunk event; a future/synthetic auxiliary event must
  // also remain harmless to captain-facing consumers without changing simulation.
  const drone=g.addShip(SHIP_BY_ID.yamato,1,'Auxiliary',100,1500,0);drone.architectDrone={owner:architect,slot:0};g.events.emit('shipSunk',{ship:drone,killer:me});const afterAuxiliary=snapshot();
  const first=g.addShip(SHIP_BY_ID.yamato,1,'First captain',1000,1000,0),second=g.addShip(SHIP_BY_ID.yamato,1,'Second captain',-1000,1000,0);first.sink(me);second.sink(me);const afterCaptains=snapshot();
  off();audio.play=play;audio.ui=uiPlay;return{moduleEvents,ruptureCues:ruptures.length,afterModules,afterAuxiliary,afterCaptains};
 });
 const quiet=s=>s.feed===0&&s.streak===0&&!s.killmark&&!s.banner&&!s.callout&&s.slow===0&&s.kills===0&&s.streakSounds===0;
 const c=result.afterCaptains;
 if(!quiet(result.afterModules)||!quiet(result.afterAuxiliary)||result.moduleEvents!==2||result.ruptureCues!==2||c.feed!==2||c.streak!==2||!c.killmark||!c.banner||!c.callout||c.slow<=0||c.kills!==2||c.streakSounds!==1||errors.length)throw Error(JSON.stringify({result,errors}));
 writeFileSync(`${out}/captain-feedback-results.json`,JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({...result,errors}));
}finally{await browser.close();}
