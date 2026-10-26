import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { TurnApplier } from '../src/net/navalTurns';
import { TURN_TICKS, DEFAULT_SETTINGS, type Turn, type Continuous } from '../src/net/protocol';
import { navalRules } from '../server/rules';
import type { BattleConfig } from '../src/core/BattleSetup';
it('replays Architect module deployments and Citadel identically across LAN peers',()=>{
  const config:BattleConfig={mode:'lan',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse',team:0},{shipId:'iowa',device:'mouse',team:1}]};
  const a=new Game(config),b=new Game(structuredClone(config)),x=new TurnApplier(a),y=new TurnApplier(b);
  for(const g of [a,b])for(const s of g.fleet){s.throttle=2;s.speed=0;s.meter=1;}
  let maxModules=0;
  for(let k=0;k<400;k++){
    const angle=k/20,controls:Continuous=[0,Math.sin(angle)*1200,Math.cos(angle)*1200,0,-1];
    if(k%2)controls.push(150);
    const turn:Turn={k,p:[[0,controls]]};
    if([0,20,40,60,80].includes(k))turn.e=[[0,0,{sk:0}]];
    if(k===100)turn.e=[[0,0,{sk:8}]];
    const copy=JSON.parse(JSON.stringify(turn)) as Turn;
    for(let i=0;i<TURN_TICKS;i++){x.applyTick(turn,i);y.applyTick(copy,i);}
    expect(x.hash()).toBe(y.hash());maxModules=Math.max(maxModules,a.ships.filter(s=>s.architectPlatform&&s.alive).length);
  }
  expect(maxModules).toBe(10);
});
it('allows Architect under titan rules and rejects the hidden module as a player pick',()=>{
  const settings={...DEFAULT_SETTINGS,era:'mixed' as const,titans:true};
  expect(navalRules.pickAllowed('architect',settings)).toBe(true);
  expect(navalRules.pickAllowed('architect',{...settings,titans:false})).toBe(false);
  expect(navalRules.pickAllowed('architectPlatform',settings)).toBe(false);
});
