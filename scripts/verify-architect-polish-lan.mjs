import {chromium} from 'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const out=process.env.ARCH_LAN_OUT??'docs/verification/architect-polish-lan';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),pages=[],errors=[];
const url=process.env.STEEL_URL??'http://127.0.0.1:5192';
try{
 for(let i=0;i<2;i++){const p=await browser.newPage({viewport:{width:1280,height:720}});pages.push(p);p.on('pageerror',e=>errors.push(String(e)));await p.goto(url);await p.waitForFunction(()=>window.steel);await p.getByRole('button',{name:/^LAN battle/}).click();await p.waitForFunction(()=>window.steel.net.client?.id);}
 const [host,guest]=pages;await host.getByRole('button',{name:'Create lobby',exact:true}).click();await host.waitForFunction(()=>window.steel.net.client?.lobby);
 const id=await host.evaluate(()=>window.steel.net.client.lobby.id);
 await host.evaluate(async()=>{const {loadoutPreset}=await import('/src/data/architectLoadout.ts'),{serializeArchitectLoadout,parseArchitectLoadout}=await import('/src/data/architectLoadoutTransfer.ts'),parsed=parseArchitectLoadout(serializeArchitectLoadout(loadoutPreset('unique')));if(!parsed.ok)throw Error(parsed.message);const c=window.steel.net.client;c.send({t:'settings',s:{era:'mixed',type:'freeplay',titans:true,ai:[0,0]}});c.send({t:'me',shipId:'architect',team:0,architectLoadout:parsed.loadout});});
 await guest.evaluate(id=>window.steel.net.client.send({t:'join',lobby:id}),id);await guest.waitForFunction(()=>window.steel.net.client?.lobby?.members.length===2);
 await guest.evaluate(()=>window.steel.net.client.send({t:'me',shipId:'iowa',team:1,ready:true}));await host.waitForFunction(()=>window.steel.net.client.lobby.members.some(m=>m.team===1&&m.ready));
 await host.getByRole('button',{name:'Start battle',exact:true}).click();await Promise.all(pages.map(p=>p.waitForFunction(()=>window.steel.net.lan?.lockstep.played>5)));
 for(const p of pages)await p.evaluate(()=>{window.lanReview={checkpoints:{}};const sim=window.steel.net.lan.sim,apply=sim.applyTick.bind(sim);sim.applyTick=(turn,tick)=>{apply(turn,tick);window.lanReview.checkpoints[turn.k*2+tick]=sim.hash();};});
 const shared=await Promise.all(pages.map(p=>p.evaluate(()=>({loadout:window.steel.battle.config.players[0].architectLoadout,tempo:window.steel.battle.config.shiftTempo}))));if(JSON.stringify(shared[0])!==JSON.stringify(shared[1]))throw Error('Resolved LAN loadout differs');
 await host.evaluate(()=>{const b=window.steel.battle;b.setPaused(true);b.openShipPicker();});await host.waitForFunction(()=>!document.pointerLockElement);
 const editor=host.locator('.arsenal-editor');await editor.getByRole('button',{name:'Import / export',exact:true}).click();
 const imported={format:'steel-tide.architect-loadout',version:1,slots:Array.from({length:10},(_,i)=>({type:i%2?'abyss':'swarm',skill:i%2}))};
 await editor.getByRole('textbox',{name:'Loadout JSON'}).fill(JSON.stringify(imported));await editor.getByRole('button',{name:'Apply import',exact:true}).click();
 await host.waitForFunction(()=>document.querySelector('.arsenal-result')?.textContent.includes('10 applied · 0 pending'));
 await Promise.all(pages.map(p=>p.waitForFunction(slots=>JSON.stringify(window.steel.battle.game.fleet.find(s=>s.humanIndex===0).architectLoadout)===JSON.stringify(slots),imported.slots)));
 await host.evaluate(()=>{const b=window.steel.battle,s=b.pcs[0].ship;b.link.lockstep.sendOrders([0,s.pos.x,s.pos.z-500,0,-1],{sk:0});});
 await host.waitForFunction(()=>window.steel.battle.pcs[0].ship.architect.slots.filter(a=>a.state==='deployed').length===2);
 await editor.getByRole('button',{name:'Balanced',exact:true}).click();await host.waitForFunction(()=>document.querySelector('.arsenal-result')?.textContent.includes('0 pending · 2 locked'));
 const accepted=await host.evaluate(()=>({loadout:window.steel.battle.pcs[0].ship.architectLoadout,result:document.querySelector('.arsenal-result').textContent,failure:window.steel.battle.pcs[0].ship.skillFailure}));if(accepted.failure)throw Error(accepted.failure);
 await host.screenshot({path:`${out}/pending-refit-confirmed.jpg`,quality:88});
 await host.evaluate(()=>{window.beforeReplay=window.steel.net.lan;window.steel.net.lan.awaitingLog=true;window.steel.net.client.send({t:'resync'});});
 await host.waitForFunction(()=>window.steel.net.lan!==window.beforeReplay&&!window.steel.net.lan.replaying&&window.steel.net.lan.view);
 const replay=await host.evaluate(()=>({loadout:window.steel.battle.pcs[0].ship.architectLoadout,turns:window.steel.net.lan.lockstep.played}));if(JSON.stringify(replay.loadout)!==JSON.stringify(accepted.loadout))throw Error('Refits lost on replay');
 await host.evaluate(()=>{window.lanReview={checkpoints:{}};const sim=window.steel.net.lan.sim,apply=sim.applyTick.bind(sim);sim.applyTick=(turn,tick)=>{apply(turn,tick);window.lanReview.checkpoints[turn.k*2+tick]=sim.hash();};});
 await host.waitForFunction(()=>Object.keys(window.lanReview.checkpoints).length>90);
 const hashes=await Promise.all(pages.map(p=>p.evaluate(()=>window.lanReview.checkpoints))),common=Object.keys(hashes[0]).filter(k=>hashes[1][k]!==undefined);if(common.length<30||common.some(k=>hashes[0][k]!==hashes[1][k]))throw Error(`LAN checkpoint mismatch: ${common.length} common`);
 if(errors.length)throw Error(errors.join('\n'));writeFileSync(`${out}/results.json`,JSON.stringify({shared,accepted,replay,matchingTicks:common.length,errors},null,2));console.log(JSON.stringify({matchingTicks:common.length,replayTurns:replay.turns,result:accepted.result,errors}));
 await host.evaluate(()=>window.steel.net.client.send({t:'end'}));
}finally{for(const p of pages){try{await p.evaluate(()=>window.steel?.net.client?.close());}catch{}}await browser.close();}
