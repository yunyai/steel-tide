import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const out=process.env.BATT_OUT??'docs/verification/architect-polish-battery';mkdirSync(out,{recursive:true});
const source=process.env.STEEL_URL??'http://127.0.0.1:5192',camera=process.env.BATT_CAMERA??'wide',stagger=process.env.BATT_STAGGER==='1',video=process.env.BATT_VIDEO==='1',realtime=!!process.env.BATT_REALTIME;
if(!['wide','normal','scoped'].includes(camera))throw Error('BATT_CAMERA must be wide, normal or scoped');
if(video&&!realtime)throw Error('BATT_VIDEO=1 requires BATT_REALTIME=1 to record motion');
const select=(value,name,allowed)=>{if(value===undefined)return allowed;const values=[...new Set(value.split(',').map(Number))];if(!values.length||values.some(n=>!allowed.includes(n)))throw Error(`${name} must select from ${allowed.join(', ')}`);return values;};
const allProfiles=process.env.BATT_MATRIX?[['ultralow',1280,720,false],['low',1280,720,false],['medium',1280,720,false],['high',1920,1080,false],['high',2560,1080,false],['high',1280,720,true]]:[['high',1920,1080,false],['high',2560,1080,false]];
const widths=select(process.env.BATT_WIDTH,'BATT_WIDTH',[...new Set(allProfiles.map(p=>p[1]))]),owners=select(process.env.BATT_OWNERS,'BATT_OWNERS',[1,3]),profiles=allProfiles.filter(p=>widths.includes(p[1]));
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[];
try{for(const [quality,width,height,reduced] of profiles)for(const count of owners){
 const staggered=stagger&&count===3,chunks=staggered?24:20,name=`${quality}-${width}-${count}${reduced?'-reduced':''}${camera!=='wide'?`-${camera}`:''}${staggered?'-staggered':''}`,videoPath=video?`${out}/${name}-motion.webm`:null;
 const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference',...(video?{recordVideo:{dir:out,size:{width,height}}}:{})}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.reviewRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>1;});
 await page.goto(`${source}/?q=${quality}`);await page.waitForFunction(()=>window.steel);
 await page.evaluate(async({count,build,camera,staggered})=>{
  const data=await import('/src/data/architectLoadout.ts'),{setArchitectLoadout}=await import('/src/skills/misc/ArchitectRuntime.ts'),{stateHash}=await import('/src/net/hash.ts');
  window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
  const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.shell.input.fallback=true;b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
  const owners=[s];s.pos.set(0,0,2600);for(let i=1;i<count;i++)owners.push(g.addShip(g.shipSpec('architect'),0,'Builder',i*350,2600,0));
  for(const a of owners){setArchitectLoadout(a,build==='brood'?Array.from({length:10},()=>({type:'swarm',skill:1})):data.loadoutPreset('balanced'));a.effects=[];a.throttle=2;a.speed=0;a.secondaries=[];a.hp*=.8;a.control.aimX=0;a.control.aimZ=0;}
  for(let i=0;i<8;i++){const t=g.addShip(g.shipSpec('leviathan'),1,'Target',(i%4-1.5)*480,Math.floor(i/4)*500-250,0);t.hp=t.maxHp=1e9;t.colossus=false;t.throttle=2;t.speed=0;t.secondaries=[];}
  pc.camera.position.set(-2700,2300,3400);pc.camera.lookAt(0,60,0);pc.camera.updateMatrixWorld(true);
  const f=window.batteryReview={g,b,pc,owners,stateHash,pure:true,damage:0};g.events.on('skillHit',e=>{if(e.skill.id==='architectKillbox')f.damage+=e.damage;});
  f.draw=()=>{const before=stateHash(g);g.interpolate();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
  if(camera!=='wide'){
   pc.yaw=0;pc.range=2600;pc.holdRange=2600;pc.zoomToggle=camera==='scoped';
   f.draw=()=>{const before=stateHash(g);g.interpolate();pc.updateCamera(1/60);window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);f.pure&&=before===stateHash(g);};
   f.draw();
  }
  for(let i=0;i<90;i++){g.step();f.draw();}
  const activate=a=>{a.meter=1;if(!a.activateSkill(7))throw Error(a.skillFailure);};
  if(staggered){
   f.scheduled=owners.slice(1).map((owner,i)=>({owner,at:g.time+(i+1)*.9}));
   f.activateDue=()=>{while(f.scheduled.length&&g.time+1e-8>=f.scheduled[0].at)activate(f.scheduled.shift().owner);};
   activate(owners[0]);
  }else for(const a of owners)activate(a);
  f.staggered=staggered;f.started=g.time;f.draw();
 },{count,build:process.env.BATT_BUILD??'balanced',camera,staggered});
 const times=[],delivery=[];let calls=0,triangles=0,instances=0,pending=0,lastDelivery=0,peaks={};
 for(let chunk=0;chunk<chunks;chunk++){
  const r=await page.evaluate(({real})=>new Promise(resolve=>{
   const f=window.batteryReview,times=[],delivery=[];let frames=0,calls=0,triangles=0,instances=0,pending=0,last=0;
   const run=now=>{if(last)delivery.push(now-last);last=now;if(f.staggered)f.activateDue();const start=performance.now();f.g.step();f.draw();times.push(performance.now()-start);const info=window.steel.renderer.gl.info.render;calls=Math.max(calls,info.calls);triangles=Math.max(triangles,info.triangles);instances=Math.max(instances,f.b.scene.elementFx.count);pending=Math.max(pending,f.g.battery?.pending?.length??0);if(++frames<30){if(real)window.reviewRAF(run);else run(performance.now());}else resolve({times,delivery,calls,triangles,instances,pending,stats:f.b.scene.batteryFx?.stats??f.b.scene.battery?.stats??null});};if(real)window.reviewRAF(run);else run(performance.now());
  }),{real:realtime});
  times.push(...r.times);if(realtime)delivery.push(...r.delivery);calls=Math.max(calls,r.calls);triangles=Math.max(triangles,r.triangles);instances=Math.max(instances,r.instances);pending=Math.max(pending,r.pending);if(r.stats)peaks=r.stats;
  if(process.env.BATT_CAPTURE&&[2,6,14,16,chunks-1].includes(chunk))await page.screenshot({path:`${out}/${name}-${chunk}.jpg`,quality:88});
 }
 const end=await page.evaluate(()=>{const f=window.batteryReview,stats=f.b.scene.batteryFx?.stats??f.b.scene.battery?.stats??null;return{pure:f.pure,hash:f.stateHash(f.g),damage:f.damage,ships:f.g.ships.length,drones:f.g.ships.filter(s=>s.alive&&s.architectDrone).length,pending:f.g.battery?.pending?.length??0,activeJobs:stats?Object.fromEntries(Object.entries(stats).filter(([key,value])=>key.startsWith('active')&&typeof value==='number')):null,contactDrops:stats?.contactDrops??null,scheduled:f.scheduled?.length??0,simulationSeconds:f.g.time-f.started,overflow:document.documentElement.scrollWidth>innerWidth};});
 if(!end.pure||end.overflow||end.pending||end.scheduled||Object.values(end.activeJobs??{}).some(n=>n!==0)||(end.contactDrops??0)!==0||errors.length)throw Error(JSON.stringify({errors,end}));
 const pct=(a,p)=>a.length?[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)]:null;
 rows.push({quality,width,height,reduced,count,camera,staggered,source,frames:times.length,deliverySamples:delivery.length,video:videoPath,build:process.env.BATT_BUILD??'balanced',cpuP50:pct(times,.5),cpuP95:pct(times,.95),deliveryP50:pct(delivery,.5),deliveryP95:pct(delivery,.95),calls,triangles,instances,pendingPeak:pending,peaks,...end});console.log(JSON.stringify(rows.at(-1)));
 const recording=page.video();await context.close();if(video){await recording.saveAs(videoPath);await recording.delete();}
 writeFileSync(`${out}/results.json`,JSON.stringify({commit:process.env.BATT_SOURCE_COMMIT??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source,realtime,metric:'CPU simulation/presentation/submission; delivery is rAF intervals when requested; GPU timestamps not measured',rows},null,2));
}}finally{await browser.close();}
