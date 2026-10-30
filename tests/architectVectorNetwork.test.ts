import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { defaultLoadout } from '../src/data/architectLoadout';
import { emptyControl } from '../src/ships/Ship';
import { draftOrders, TurnApplier } from '../src/net/navalTurns';
import { DEFAULT_SETTINGS, TURN_TICKS, type Turn } from '../src/net/protocol';
import { materialize } from '../src/skills/misc/ArchitectRuntime';
import { navalRules } from '../server/rules';

it('roundtrips each independent Vector edge once alongside ordinary Search',()=>{
 const c=emptyControl();c.architectHullDash=c.architectMobileBattery=true;c.consumable=1;
 expect(draftOrders(c)[1]).toEqual({hd:1,mb:1,co:1});expect(draftOrders(c)[1]).toBeNull();
 expect(navalRules.cleanEdge({hd:1,mb:1,co:1},DEFAULT_SETTINGS)).toEqual({hd:1,mb:1,co:1});
 expect(navalRules.cleanEdge({hd:true,mb:2},DEFAULT_SETTINGS)).toBeNull();
});

it('replays both mobility clocks, charge depletion, refits and Search identically on two peers',()=>{
 const picks=defaultLoadout();picks[0]={type:'vector',skill:0};
 const config=navalRules.config({...DEFAULT_SETTINGS,type:'freeplay',era:'mixed'},[{pick:'architect',team:0,name:'Builder',architectLoadout:picks}],713);config.ai=[0,0];
 const a=new Game(config),b=new Game(structuredClone(config)),x=new TurnApplier(a),y=new TurnApplier(b);
 for(const g of [a,b]){g.map.heightAt=()=>-100;const s=g.humans()[0];s.pos.set(0,0,1500);s.throttle=2;s.speed=0;s.secondaries=[];
  // One deployed escort so both Mobile Battery casts lift, orbit and land on each peer.
  const slot=s.architect!.slots[1],m=materialize(s,slot);slot.state='deployed';m.pos.set(-1500,0,1500);}
 let peak=0,between:unknown[]=[];
 for(let k=0;k<620;k++){
  const edge=k===0?{hd:1 as const,mb:1 as const,co:1}:k===20||k===40||k===310?{hd:1 as const}:k===100?{ar:{index:0,pick:{type:'storm' as const,skill:0 as const}}}:k===110?{ar:{index:0,pick:{type:'vector' as const,skill:1 as const}}}:k===450?{mb:1 as const}:null;
  const turn:Turn={k,p:k===0?[[0,[0,4000,1500,0,-1]]]:undefined,e:edge?[[0,0,edge]]:undefined};
  for(let tick=0;tick<TURN_TICKS;tick++){x.applyTick(turn,tick);y.applyTick(JSON.parse(JSON.stringify(turn)),tick);expect(x.hash()).toBe(y.hash());peak=Math.max(peak,a.humans()[0].architect!.slots[1].entity?.pos.y??0);}
  if(k===420){const e=a.humans()[0].architect!.slots[1];between=[e.state,e.follow,e.entity?.pos.y,e.path];}
 }
 const s=a.humans()[0];expect(s.pos.x).toBeCloseTo(3000); // 1100 + 1100 + the base 800 after the refit.
 // Spent charges recharge in parallel, so both are back 10 s after the last dash.
 expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);expect(s.vectorMobility.dashRecharge).toEqual([]);expect(s.vectorMobility.mobileReadyAt).toBeCloseTo(29+1/60);
 expect(s.consumables[1].charges).toBe(s.consumables[1].spec.charges-1);
 // The escort flew, settled on the water between windows, and lifts again for the second cast.
 expect(peak).toBeGreaterThan(80);expect(between).toEqual(['deployed',null,0,null]);expect(s.architect!.slots[1].follow).not.toBeNull();
});

it('keeps stacked Vector thrusters, Hull Dash impacts and an ultimate refund identical on two peers',()=>{
 const picks=defaultLoadout();for(let i=0;i<6;i++)picks[i]={type:'vector',skill:(i%2) as 0|1};
 const config=navalRules.config({...DEFAULT_SETTINGS,type:'freeplay',era:'mixed'},[{pick:'architect',team:0,name:'Builder',architectLoadout:picks},{pick:'iowa',team:1,name:'Target'}],713);config.ai=[0,0];
 const a=new Game(config),b=new Game(structuredClone(config)),x=new TurnApplier(a),y=new TurnApplier(b);
 for(const g of [a,b]){g.map.heightAt=()=>-100;const [s,t]=g.humans();s.pos.set(0,0,1500);s.throttle=2;s.speed=0;s.secondaries=[];
  t.pos.set(600,0,1540);t.hp=t.maxHp=1e8;t.throttle=2;t.speed=0;t.secondaries=[];}
 let landed=0;a.events.on('architectDash',e=>{if(e.phase==='land')landed++;});
 for(let k=0;k<200;k++){
  const edge=k===0||k===30||k===60?{hd:1 as const}:k===90?{sk:7}:k===120?{sk:4}:null;
  const turn:Turn={k,p:k===0?[[0,[0,4000,1500,0,-1]],[1,[0,0,0,0,-1]]]:k===90?[[0,[0,600,1500,0,-1]]]:undefined,e:edge?[[0,0,edge]]:undefined};
  if(k===90)for(const g of [a,b])g.humans()[0].meter=1;
  for(let tick=0;tick<TURN_TICKS;tick++){x.applyTick(turn,tick);y.applyTick(JSON.parse(JSON.stringify(turn)),tick);expect(x.hash()).toBe(y.hash());}
 }
 const [s,t]=a.humans();expect(landed).toBe(3);expect(t.hp).toBeLessThan(1e8);expect(s.mods.speedMul).toBeGreaterThan(1.3);
 expect(s.architect!.ultimate).toBeNull();expect(s.skills[7].meter).toBeGreaterThan(.2);
});
