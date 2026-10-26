import { chromium } from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='docs/verification/architect';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
try{
const p=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];p.on('pageerror',e=>errors.push(String(e)));
await p.addInitScript(()=>{window.requestAnimationFrame=()=>1;});await p.goto(`${process.env.STEEL_URL??'http://127.0.0.1:5184'}/?q=ultralow`);await p.waitForFunction(()=>window.steel);
const input=await p.evaluate(async()=>{
 const {PlayerController}=await import('/src/player/PlayerController.ts');
 window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
 const b=window.steel.battle,g=b.game,s=g.humans()[0],input=b.shell.input,pc=b.pcs[0];input.fallback=true;input.onLockChange=null;b.setOverlay(null);b.paused=false;
 const keyboard=[];
 for(const code of ['KeyQ','KeyE','KeyZ','KeyX','KeyC','KeyV','KeyR','KeyT','KeyB']){s.control.skill=-1;window.dispatchEvent(new KeyboardEvent('keydown',{code}));pc.control(1/60,input);keyboard.push(pc.out.skill);input.endFrame();window.dispatchEvent(new KeyboardEvent('keyup',{code}));}
 let down=[];Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{index:0,id:'Test',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:down.includes(i),value:down.includes(i)?1:0}))}]});
 const pad=new PlayerController(s,'pad0',0,g),gamepad=[];
 for(let bank=0;bank<3;bank++)for(const button of [2,1,3]){down=[];input.pollPads();input.endFrame();down=[button,...(bank?[bank===1?4:5]:[])];input.pollPads();s.control.skill=-1;pad.control(1/60,input);gamepad.push(pad.out.skill);input.endFrame();}
 // Live mouse aiming during assembly: camera ray changes the next aim point while the hull stays braced.
 s.control.skill=-1;s.control.aimX=0;s.control.aimZ=0;s.meter=1;s.activateSkill(6);pc.yaw=0;pc.updateCamera(.5);const before=pc.aim.clone();pc.yaw+=.4;pc.updateCamera(.5);
 const aiming=pc.aim.distanceTo(before)>100;
 return {keyboard,gamepad,aiming};
});
if(JSON.stringify(input.keyboard)!=='[0,1,2,3,4,5,6,7,8]'||JSON.stringify(input.gamepad)!=='[0,1,6,2,3,7,4,5,8]'||!input.aiming)throw Error(JSON.stringify(input));
const stress=await p.evaluate(async()=>{
 const {SHIP_BY_ID}=await import('/src/data/ships.ts');const {stateHash}=await import('/src/net/hash.ts');
 window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});
 const b=window.steel.battle,g=b.game,s=g.humans()[0],pc=b.pcs[0];g.ai.clear();b.shell.input.onLockChange=null;b.paused=false;b.setOverlay(null);
 const owners=[s];for(let i=1;i<32;i++)owners.push(g.addShip(SHIP_BY_ID.architect,0,`Architect ${i+1}`,0,0,0));
 owners.forEach((s,i)=>{s.pos.set((i%8-3.5)*1000,0,(Math.floor(i/8)-1.5)*1000);s.prevPos.copy(s.pos);s.renderPos.copy(s.pos);s.throttle=2;s.speed=0;s.meter=1;s.activateSkill(8);});
 for(let i=0;i<120;i++)g.step();g.interpolate();pc.camera.position.set(-5500,4500,6500);pc.camera.lookAt(0,100,0);pc.camera.far=42000;pc.camera.updateMatrixWorld();
 const times=[];let calls=0;for(let i=0;i<8;i++){const before=performance.now();window.steel.renderer.update(1/60,[pc.camera]);window.steel.renderer.render(b.viewports);times.push(performance.now()-before);calls=Math.max(calls,window.steel.renderer.gl.info.render.calls);}
 const hash=stateHash(g);b.huds[0].update(0);window.steel.renderer.render(b.viewports);
 return {owners:owners.length,platforms:g.ships.filter(s=>s.architectPlatform&&s.alive).length,panels:b.scene.architectFx.panels.count,calls,times,pure:hash===stateHash(g)};
});
if(stress.platforms!==320||!stress.pure||errors.length)throw Error(JSON.stringify({stress,errors}));
await p.screenshot({path:`${out}/stress-32-architects.jpg`,quality:85});writeFileSync(`${out}/input-stress-results.json`,JSON.stringify({input,stress,errors},null,2));console.log(JSON.stringify({input,stress,errors}));
}finally{await browser.close();}
