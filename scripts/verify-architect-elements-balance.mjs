import { runnerImport } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
await runnerImport(`${process.cwd()}/src/core/installDetMath.ts`);
const {module:{Game}}=await runnerImport(`${process.cwd()}/src/core/Game.ts`);
const {module:{SHIP_BY_ID}}=await runnerImport(`${process.cwd()}/src/data/ships.ts`);
const out=process.env.ARCH_BALANCE_OUT??'docs/implementation/architect-elemental/balance.json';
const results=[];
for(const foe of ['stepper','leviathan','hadal','raijin','goku'])for(const seed of [713,901,1123]){
 const g=new Game({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});g.ships=[];g.ai.clear();g.fleet.length=0;
 const s=g.addShip(SHIP_BY_ID.architect,0,'Architect',0,1800,0),t=g.addShip(SHIP_BY_ID[foe],1,foe,0,-1000,Math.PI);
 g.fleet.push(s,t);s.humanIndex=0;t.humanIndex=-1;s.throttle=t.throttle=2;s.speed=t.speed=0;t.colossus=false;
 // Durable matching target: fixed 60-second output window, no respawn/invulnerability distortion.
 t.hp=t.maxHp=1e9;s.secondaries.length=t.secondaries.length=0;
 let losses=0,peak=0;const sources={};g.events.on('architectCommand',e=>{if(e.kind==='destroy')losses++;});g.events.on('skillHit',e=>{if(e.attacker===s||e.attacker.summonOwner===s)sources[e.skill.id]=(sources[e.skill.id]??0)+e.damage;});
 for(let tick=0;tick<3600;tick++){
  s.control.aimX=t.pos.x;s.control.aimZ=t.pos.z;s.control.targetId=t.id;s.control.fire=true;t.control.aimX=s.pos.x;t.control.aimZ=s.pos.z;t.control.fire=true;
  if(tick%60===0){s.activateSkill(0);s.activateSkill(1);s.activateSkill(2);s.activateSkill(5);}
  g.step();peak=Math.max(peak,s.architect?.slots.filter(a=>a.state==='deployed').length??0);
 }
 results.push({foe,seed,damage:s.stats.damage,skillDamage:s.stats.skill,hp:s.hp,alive:s.alive,losses,peak,sources});
}
mkdirSync(out.slice(0,out.lastIndexOf('/')),{recursive:true});writeFileSync(out,JSON.stringify(results,null,2));console.log(JSON.stringify({out,median:results.map(r=>r.damage).sort((a,b)=>a-b)[7],results:results.length}));
