import { runnerImport } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
const out=process.env.STEEL_ARCH_OUT??'docs/verification/architect';mkdirSync(out,{recursive:true});
await runnerImport(`${process.cwd()}/src/core/installDetMath.ts`);
const {module:{Game}}=await runnerImport(`${process.cwd()}/src/core/Game.ts`);
const {module:{AIController}}=await runnerImport(`${process.cwd()}/src/ai/AIController.ts`);
const {module:{SHIP_BY_ID}}=await runnerImport(`${process.cwd()}/src/data/ships.ts`);
const results=[];
for(const foe of ['stepper','leviathan','hadal'])for(let seed=0;seed<Number(process.env.ARCH_SEEDS??10);seed++)for(const side of [0,1]){
  const g=new Game({mode:'solo',type:'annihilation',mapId:'open',teamSize:1,ai:[0,0],difficulty:'hard',era:'mixed',seed:900+seed,players:[{shipId:'architect',device:'mouse'}]});
  g.ships=[];g.ai.clear();g.fleet.length=0;
  const add=(id,team)=>{const sign=team?1:-1,s=g.addShip(SHIP_BY_ID[id],team,id,sign*1900,seed%2?400:-400,team?-Math.PI/2:Math.PI/2);s.throttle=4;s.speed=s.maxSpeed*.5;s.humanIndex=-1;g.fleet.push(s);g.ai.set(s,new AIController(s,g));return s;};
  const a=add('architect',side),b=add(foe,1-side);let peakModules=0;const skills=new Set();
  g.events.on('skill',e=>{if(e.ship===a)skills.add(e.index);});
  for(let i=0;i<120*60&&!g.over;i++){
    g.step();peakModules=Math.max(peakModules,g.ships.filter(s=>s.architectPlatform&&s.alive).length);
    if(g.ships.some(s=>![s.hp,s.maxHp,s.pos.x,s.pos.y,s.pos.z].every(Number.isFinite)))throw Error('Non-finite battle state');
    if(a.hp>a.maxHp+.01)throw Error('Hull above shared capacity');
  }
  results.push({foe,seed,side,time:g.time,winner:g.winner,architectWon:g.winner===side,architectHp:a.hp,foeHp:b.hp,damage:a.stats.damage,skillDamage:a.stats.skill,peakModules,skills:[...skills].sort()});
}
const summaries=['stepper','leviathan','hadal'].map(foe=>{const r=results.filter(r=>r.foe===foe);return{foe,wins:r.filter(r=>r.architectWon).length,battles:r.length,averageDamage:Math.round(r.reduce((n,r)=>n+r.damage,0)/r.length),peakModules:Math.max(...r.map(r=>r.peakModules)),skills:[...new Set(r.flatMap(r=>r.skills))].sort()};});
if(!results.some(r=>r.peakModules>=4))throw Error('AI never built a battery');
writeFileSync(`${out}/combat-results.json`,JSON.stringify({summaries,results},null,2));console.log(JSON.stringify(summaries,null,2));
