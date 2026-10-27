import {runnerImport} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
await runnerImport(`${process.cwd()}/src/core/installDetMath.ts`);
const {module:{Game}}=await runnerImport(`${process.cwd()}/src/core/Game.ts`);
const {module:{ARCHETYPES}}=await runnerImport(`${process.cwd()}/src/data/architectLoadout.ts`);
const {module:{setArchitectLoadout}}=await runnerImport(`${process.cwd()}/src/skills/misc/ArchitectRuntime.ts`);
const out=process.env.ARCH_OUT??'docs/implementation/architect-grand-battery',rows=[];mkdirSync(out,{recursive:true});
for(const type of (process.env.ARCH_SUPPORT_ONLY?['restoration','bastion']:['storm','swarm','restoration','bastion']))for(const skill of [0,1])for(const owners of [1,3]){
 const g=new Game({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse'}]});g.ships=[];g.fleet.length=0;g.ai.clear();
 const architects=[];for(let n=0;n<owners;n++){const s=g.addShip(g.shipSpec('architect'),0,'Architect',n*300,2000,0);setArchitectLoadout(s,Array.from({length:10},()=>({type,skill})));s.throttle=2;s.colossus=false;s.hp*=.7;s.meter=1;s.control.aimZ=500;s.control.aimX=0;s.activateSkill(8);architects.push(s);}
 const targets=[];for(let n=0;n<16;n++){const t=g.addShip(g.shipSpec('iowa'),1,'Target',(n%4-2)*650,-Math.floor(n/4)*700,0);t.hp=t.maxHp=1e8;t.throttle=2;t.colossus=false;t.control.fire=true;targets.push(t);}
 const samples=[];let maxJobs=0,maxDrones=0,maxShips=0,healed=0,incoming=0;const first=architects[0];
 for(let i=0;i<1800;i++){
  for(const s of architects){s.control.targetId=targets[0].id;if(i%60===0){s.activateSkill(1);s.activateSkill(5);if(i>900){s.meter=1;s.activateSkill(8);}}}
  // Concentrated sustained pressure, plus ordinary hostile gunfire. Each source is independent.
  if(i%6===0){const before=first.hp;first.takeDamage(Number(process.env.ARCH_PRESSURE??20000),targets[0]);incoming+=before-first.hp;}
  for(const t of targets){t.control.aimX=first.pos.x;t.control.aimZ=first.pos.z;}
  const hp=first.hp,wasAlive=first.alive,start=performance.now();g.step();samples.push(performance.now()-start);if(wasAlive&&first.alive)healed+=Math.max(0,first.hp-hp);
  maxJobs=Math.max(maxJobs,...architects.map(s=>s.architect?.elements.jobs.length??0));maxDrones=Math.max(maxDrones,g.ships.filter(s=>s.alive&&s.architectDrone).length);maxShips=Math.max(maxShips,g.ships.length);
  if(g.ships.some(s=>![s.hp,s.pos.x,s.pos.y,s.pos.z].every(Number.isFinite)))throw Error('Nonfinite state');
 }
 samples.sort((a,b)=>a-b);rows.push({type,skill:ARCHETYPES[type].skills[skill].name,owners,p50:samples[900],p95:samples[1710],max:samples.at(-1),maxJobs,maxDrones,maxShips,hp:first.hp,alive:first.alive,deaths:first.stats.deaths,survived:first.stats.deaths===0,incoming,healed,damage:architects.reduce((n,s)=>n+s.stats.damage,0)});
}
writeFileSync(`${out}/stress.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
