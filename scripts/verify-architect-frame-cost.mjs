import {chromium} from 'playwright';import {mkdirSync,writeFileSync} from 'node:fs';
const out='docs/implementation/architect-grand-battery',rows=[],browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:720}});await page.addInitScript(()=>window.requestAnimationFrame=()=>1);await page.goto('http://127.0.0.1:5184/?q=high');await page.waitForFunction(()=>window.steel);
for(const [type,skill] of [['storm',0],['swarm',0],['swarm',1],['restoration',0],['bastion',0]])for(const count of [1,3]){
 const r=await page.evaluate(async({type,skill,count})=>{
 const {setArchitectLoadout}=await import('/src/skills/misc/ArchitectRuntime.ts');window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
 const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.capture=false;b.paused=false;b.setOverlay(null);const owners=[s];s.pos.set(0,0,2000);
 for(let i=1;i<count;i++)owners.push(g.addShip(g.shipSpec('architect'),0,'Builder',i*350,2000,0));
 for(const a of owners){setArchitectLoadout(a,Array.from({length:10},()=>({type,skill})));a.effects=[];a.throttle=2;a.speed=0;a.meter=1;a.control.aimX=0;a.control.aimZ=-500;a.activateSkill(8);a.hp*=.8;}
 for(let i=0;i<8;i++){const t=g.addShip(g.shipSpec('iowa'),1,'Target',(i%4-2)*500,-500-Math.floor(i/4)*600,0);t.hp=t.maxHp=1e8;t.throttle=2;t.speed=0;t.secondaries=[];}
 pc.camera.position.set(-1800,1300,3400);pc.camera.lookAt(0,50,1500);pc.camera.updateMatrixWorld(true);const times=[];let calls=0,instances=0,triangles=0;
 for(let i=0;i<480;i++){const start=performance.now();g.step();g.interpolate();window.steel.renderer.update(1/60,[pc.camera]);b.huds[0].update(1/60);window.steel.renderer.render(b.viewports);if(i>120)times.push(performance.now()-start);calls=Math.max(calls,window.steel.renderer.gl.info.render.calls);instances=Math.max(instances,b.scene.elementFx.count);triangles=Math.max(triangles,window.steel.renderer.gl.info.render.triangles);}
 times.sort((a,b)=>a-b);return{p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],calls,instances,triangles,drones:g.ships.filter(s=>s.alive&&s.architectDrone).length};
 },{type,skill,count});rows.push({type,skill,count,...r});console.log(JSON.stringify(rows.at(-1)));}
mkdirSync(out,{recursive:true});writeFileSync(`${out}/frame-cost.json`,JSON.stringify(rows,null,2));}finally{await browser.close();}
