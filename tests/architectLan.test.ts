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
import {loadoutPreset} from '../src/data/architectLoadout';
it('shares custom loadouts and synchronized docked refits without divergence',()=>{
 const settings={...DEFAULT_SETTINGS,type:'freeplay' as const,era:'mixed' as const};
 const config=navalRules.config(settings,[{pick:'architect',team:0,name:'Builder',architectLoadout:loadoutPreset('unique')}],713);config.ai=[0,0];
 const a=new Game(config),b=new Game(structuredClone(config)),x=new TurnApplier(a),y=new TurnApplier(b);
 const valid=navalRules.cleanEdge({ar:{index:0,pick:{type:'resonance',skill:1}}},settings)!;
 expect(valid.ar?.pick.type).toBe('resonance');expect(navalRules.cleanEdge({ar:{index:10,pick:{type:'swarm',skill:0}}},settings)).toBeNull();expect(navalRules.cleanEdge({ar:{index:0,pick:{type:'swarm',skill:3}}},settings)).toBeNull();
 for(let k=0;k<100;k++){const t:Turn={k,e:k===0?[[0,0,valid]]:k===5?[[0,0,{sk:0}]]:undefined};for(let i=0;i<2;i++){x.applyTick(t,i);y.applyTick(JSON.parse(JSON.stringify(t)),i);}expect(x.hash()).toBe(y.hash());}
 expect(a.humans()[0].architect!.slots[0].type).toBe('resonance');
});
it('replays Battery flight while a new Assembly takes control without peer divergence',()=>{
 const config:BattleConfig={mode:'lan',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse',team:0},{shipId:'iowa',device:'mouse',team:1}]};
 const a=new Game(config),b=new Game(structuredClone(config)),x=new TurnApplier(a),y=new TurnApplier(b);let flight=false,handoff=false;
 for(const g of [a,b])for(const s of g.fleet){s.throttle=2;s.speed=0;s.meter=1;}
 for(let k=0;k<250;k++){
  const turn:Turn={k,p:k===0?[[0,[0,0,0,0,-1]]]:undefined,e:k===0?[[0,0,{sk:7}]]:k===225?[[0,0,{sk:6}]]:undefined};
  for(let i=0;i<TURN_TICKS;i++){x.applyTick(turn,i);y.applyTick(structuredClone(turn),i);expect(x.hash()).toBe(y.hash());}
  flight ||= a.battery.pending.length>0;
  handoff ||= a.battery.pending.length>0&&a.humans()[0].architect?.ultimate?.kind==='assembly';
 }
 expect(flight).toBe(true);expect(handoff).toBe(true);expect(a.battery.pending).toHaveLength(0);
});
it('replays Vector drive, following offsets, Recall and ordinary capacitor cycles without divergence',()=>{
 const config:BattleConfig={mode:'lan',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',seed:713,era:'mixed',players:[{shipId:'architect',device:'mouse',team:0,architectLoadout:Array.from({length:10},(_,i)=>({type:'vector',skill:i%2 as 0|1}))},{shipId:'iowa',device:'mouse',team:1}]};
 const a=new Game(config),b=new Game(structuredClone(config)),x=new TurnApplier(a),y=new TurnApplier(b);let followed=false,charged=false;
 for(const g of [a,b]){g.map.heightAt=()=>-100;const [s,t]=g.fleet;s.pos.set(0,0,1500);t.pos.set(0,0,-1500);t.hp=t.maxHp=1e8;for(const m of g.fleet){m.throttle=2;m.speed=0;m.secondaries=[];}}
 for(let k=0;k<240;k++){
  const turn:Turn={k,p:[[0,[0,k===0?1000:0,k===0?1500:-1500,k===0?0:1,-1]]],e:k===0?[[0,0,{sk:0}]]:k===60?[[0,0,{hd:1,mb:1}]]:k===100?[[0,0,{sk:4}]]:undefined};
  for(let tick=0;tick<TURN_TICKS;tick++){x.applyTick(turn,tick);y.applyTick(structuredClone(turn),tick);expect(x.hash()).toBe(y.hash());}
  const ar=a.humans()[0].architect!;followed ||= ar.slots.some(slot=>!!slot.follow);charged ||= ar.slots.some(slot=>slot.capacitorCycles>0||slot.capacitorCharged);
 }
 expect(followed).toBe(true);expect(charged).toBe(true);expect(a.humans()[0].vectorMobility.dashRechargeAt).toBeCloseTo(12+1/60);
});
