import {runnerImport} from 'vite';import {mkdirSync,writeFileSync} from 'node:fs';
await runnerImport(`${process.cwd()}/src/core/installDetMath.ts`);
const {module:{Game}}=await runnerImport(`${process.cwd()}/src/core/Game.ts`),{module:{loadoutPreset}}=await runnerImport(`${process.cwd()}/src/data/architectLoadout.ts`),{module:{endArchitectUltimate}}=await runnerImport(`${process.cwd()}/src/skills/misc/ArchitectUltimates.ts`);
const out=process.env.BATT_BALANCE_OUT??'docs/verification/architect-polish-balance',rows=[];
for(const preset of ['elemental','balanced','support'])for(const seed of [713,901,1123]){
 const pair=[];for(const active of [false,true]){
  const g=new Game({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed,era:'mixed',players:[{shipId:'architect',device:'mouse',architectLoadout:loadoutPreset(preset)}]});g.ai.clear();const s=g.humans()[0];s.effects=[];s.pos.set(0,0,3000);s.throttle=2;s.speed=0;s.meter=1;s.control.aimX=s.control.aimZ=0;s.activateSkill(7);
  const t=g.addShip(g.shipSpec('leviathan'),1,'Target',0,0,0);t.hp=t.maxHp=1e9;t.colossus=false;t.throttle=2;t.secondaries=[];
  for(let i=0;i<89;i++)g.step();if(!active){g.step();endArchitectUltimate(s);g.battery?.cancelOwner(s);}else g.step();
  // Both cases receive the same post-gather window, including the final .42 s of committed flight.
  const start=s.stats.damage;for(let i=0;i<386;i++)g.step();pair.push(s.stats.damage-start);
 }
 rows.push({preset,seed,ordinary:pair[0],battery:pair[1],ratio:pair[1]/pair[0]});
}
mkdirSync(out,{recursive:true});writeFileSync(`${out}/battery-comparison.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));if(rows.some(r=>r.ratio<1.25))throw Error('Battery advantage below 25%');
