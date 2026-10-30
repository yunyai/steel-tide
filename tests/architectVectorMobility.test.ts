import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { defaultLoadout } from '../src/data/architectLoadout';
import { activateConsumable } from '../src/ships/Consumables';
import { clearArchitect, materialize, refitArchitect, setArchitectLoadout, updateArchitect } from '../src/skills/misc/ArchitectRuntime';
import { stateHash } from '../src/net/hash';

function arena(skill:0|1=0){
 const g=emptyGame('open',713,'freeplay');g.map.heightAt=()=>-100;
 const s=place(g,'architect',0,0,1500),t=place(g,'leviathan',1,0,-1500);
 for(const m of [s,t]){m.throttle=2;m.speed=0;m.secondaries=[];m.colossus=false;}
 t.hp=t.maxHp=1e8;const picks=defaultLoadout();picks[0]={type:'vector',skill};setArchitectLoadout(s,picks);
 s.control.aimX=2000;s.control.aimZ=1500;
 return {g,s,t};
}
function dash(s:ReturnType<typeof arena>['s']){s.control.architectHullDash=true;}
function mobile(s:ReturnType<typeof arena>['s']){s.control.architectMobileBattery=true;}
/** Deploy platforms after the docked Vector on open water around the hull. */
function escorts(s:ReturnType<typeof arena>['s'],count:number){
 return s.architect!.slots.slice(1,count+1).map((a,n)=>{const m=materialize(s,a);a.state='deployed';m.pos.set(Math.sin(n*2)*1500,0,1500-Math.cos(n*2)*1500);return a;});
}

describe('independent Vector mobility',()=>{
 it('keeps Search charges, cooldown and active time independent from both mobility actions',()=>{
  const {g,s}=arena(),scan=s.consumables[1];scan.charges=8;scan.cooldown=30;scan.active=4;
  expect(activateConsumable(s,1)).toBe(false);expect(s.architect!.drive).toBeNull();
  scan.cooldown=0;expect(activateConsumable(s,1)).toBe(true);expect(scan.charges).toBe(7);
  const searchCooldown=scan.cooldown;dash(s);mobile(s);g.step();
  expect(s.pos.x).toBeGreaterThan(0);expect(scan.charges).toBe(7);expect(scan.cooldown).toBeCloseTo(searchCooldown-1/60);
 });
 it.each([[0,1100,10],[1,800,14]] as const)('one living specialization %i grants both actions with its own enhancement',(skill,distance,duration)=>{
  const {g,s}=arena(skill);escorts(s,1);mobile(s);g.step();const p=s.pos.clone();
  expect(s.pos.distanceTo(p)).toBe(0);expect(s.getVectorMobilityStatus()?.mobileBattery.activeRemaining).toBeCloseTo(duration);
  dash(s);run(g,.55);expect(s.pos.x).toBeCloseTo(distance);expect(s.architect!.drive).toBeNull();
  expect(s.control.architectHullDash).toBe(false);expect(s.control.architectMobileBattery).toBe(false);
 });
 it('spends two charges then restores them sequentially while rejected overlapping casts consume nothing',()=>{
  const {g,s}=arena();dash(s);g.step();const started=g.time;
  dash(s);g.step();expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);
  run(g,.55);s.control.aimX=3000;dash(s);run(g,.55);
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(0);const x=s.pos.x;dash(s);g.step();expect(s.pos.x).toBe(x);
  while(g.time<started+10-1e-8)g.step();expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);
  expect(s.getVectorMobilityStatus()?.hullDash.rechargeRemaining).toBeCloseTo(10,4);
  while(g.time<started+20-1e-8)g.step();expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);
 });
 it('caps at a closer reticle and never stacks duplicate distance or duration enhancements',()=>{
  const {g,s}=arena();const picks=defaultLoadout();for(let i=0;i<4;i++)picks[i]={type:'vector',skill:i%2 as 0|1};setArchitectLoadout(s,picks);escorts(s,1);
  s.control.aimX=150;dash(s);mobile(s);run(g,.55);expect(s.pos.x).toBeCloseTo(150);
  expect(s.getVectorMobilityStatus()?.mobileBattery.duration).toBe(14);expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);
 });
 it('rejects Mobile Battery without deployed platforms instead of spending the cooldown',()=>{
  const {g,s}=arena(1);expect(s.getVectorMobilityStatus()?.mobileBattery.blockedReason).toBe('No deployed platforms');
  mobile(s);g.step();expect(s.getVectorMobilityStatus()?.mobileBattery).toMatchObject({cooldownRemaining:0,activeRemaining:0});
  expect(s.skillFailure).toContain('No deployed platforms');
  escorts(s,1);expect(s.getVectorMobilityStatus()?.mobileBattery.blockedReason).toBe('');
 });
 it('applies 70 percent multiplicative protection only while the hull is moving',()=>{
  const {g,s,t}=arena();s.mods.damageTakenMul=.5;expect(s.takeDamage(10000,t)).toBeCloseTo(4000);
  dash(s);g.step();s.mods.damageTakenMul=.5;expect(s.takeDamage(10000,t)).toBeCloseTo(1200);
  run(g,.55);s.mods.damageTakenMul=.5;expect(s.takeDamage(10000,t)).toBeCloseTo(4000);
 });
 it.each(['stunned','rooted','feared','banished'] as const)('rejects and interrupts %s without extending protection',cc=>{
  const {g,s,t}=arena();
  // The lasting effect is needed because a simulation tick refreshes modifiers.
  s.addEffect({id:'debuff:test-cc',time:2,apply:m=>{m[cc]=true;}});s.refreshModifiers();
  const before=s.getVectorMobilityStatus()!;dash(s);mobile(s);g.step();
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(before.hullDash.charges);
  expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownRemaining).toBe(before.mobileBattery.cooldownRemaining);
  s.effects=[];s.refreshModifiers();dash(s);g.step();s.mods[cc]=true;updateArchitect(s,.1);
  expect(s.architect!.drive).toBeNull();s.mods.banished=false;s.mods.invulnerable=false;
  expect(s.takeDamage(10000,t)).toBeCloseTo(8000);
 });
 it('rejects Assembly, zero aim and an immediately blocked footprint without spending a charge',()=>{
  const {g,s}=arena();s.control.aimX=0;dash(s);g.step();expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);
  s.control.aimX=2000;g.map.heightAt=()=>20;dash(s);g.step();expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);
  g.map.heightAt=()=>-100;s.meter=1;s.activateSkill(6);dash(s);mobile(s);g.step();
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownRemaining).toBe(0);
 });
 it('sweeps narrow terrain, wall and same-height ship obstacles',()=>{
  for(const obstacle of ['terrain','wall','ship']){
   const {g,s}=arena();s.control.aimX=0;s.control.aimZ=3500;
   if(obstacle==='terrain')g.map.heightAt=(_x,z)=>z>=1900&&z<=1910?50:-100;
   if(obstacle==='wall')g.walls.push({team:1,x0:-500,z0:1900,x1:500,z1:1900,age:0,life:100} as typeof g.walls[number]);
   if(obstacle==='ship'){const block=place(g,'iowa',1,0,2000);block.throttle=2;block.secondaries=[];}
   dash(s);run(g,.55);expect(s.pos.z,obstacle).toBeGreaterThan(1500);expect(s.pos.z,obstacle).toBeLessThan(1900);
   expect(s.architect!.drive).toBeNull();
  }
 });
 it('keeps hull spans separated vertically while sweeping under a raised carrier',()=>{
  const {g,s}=arena(),slot=s.architect!.slots[0],block=materialize(s,slot);slot.state='deployed';block.pos.set(0,200,2000);
  s.control.aimX=0;s.control.aimZ=3500;dash(s);run(g,.55);expect(s.pos.z).toBeCloseTo(2600);
 });
 it('lifts deployed platforms into a loose hovering escort without an enemy or hull dash',()=>{
  const {g,s,t}=arena(1);t.withdraw();const slots=escorts(s,4);
  mobile(s);g.step();expect(s.pos.x).toBe(0);expect(slots.every(a=>a.follow)).toBe(true);run(g,4);
  const radii=new Set<number>(),heights=new Set<number>();
  for(const a of slots){const m=a.entity!;expect(a.state).toBe('deployed');expect(m.pos.y).toBeGreaterThan(80);
   const r=Math.hypot(m.pos.x-s.pos.x,m.pos.z-s.pos.z);expect(r).toBeGreaterThan(300);expect(r).toBeLessThan(1100);
   radii.add(Math.round(a.follow!.radius));heights.add(Math.round(a.follow!.height));}
  expect(radii.size).toBe(4);expect(heights.size).toBe(4);expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);
 });
 it('chases a dashing hull at no more than 1200 m/s and clears terrain below the orbit',()=>{
  const {g,s,t}=arena(1);t.withdraw();const slots=escorts(s,3);g.map.heightAt=(x,z)=>Math.hypot(x-2500,z-1500)<600?150:-100;
  mobile(s);g.step();run(g,2);s.pos.x=2500;
  for(let i=0;i<300;i++){const before=slots.map(a=>a.entity!.pos.clone());g.step();
   slots.forEach((a,n)=>{const m=a.entity!;expect(m.pos.distanceTo(before[n])).toBeLessThanOrEqual(1200/60+1e-6);expect(m.pos.y).toBeGreaterThan(g.map.heightAt(m.pos.x,m.pos.z)+19);});}
  for(const a of slots)expect(Math.hypot(a.entity!.pos.x-s.pos.x,a.entity!.pos.z-s.pos.z)).toBeLessThan(1100);
 });
 it('settles every escort on reserved water when the window ends, or docks it quietly',()=>{
  for(const blocked of [false,true]){
   const {g,s,t}=arena(1);t.withdraw();const slots=escorts(s,4);let blasts=0;g.events.on('explosion',()=>blasts++);
   mobile(s);g.step();run(g,13);if(blocked)g.map.heightAt=()=>100;run(g,1.2);
   expect(slots.every(a=>!a.follow&&a.path?.settling)).toBe(true);
   if(!blocked){const spots=slots.map(a=>a.path!);for(let i=0;i<spots.length;i++)for(let j=i+1;j<spots.length;j++)expect(Math.hypot(spots[i].tx-spots[j].tx,spots[i].tz-spots[j].tz)).toBeGreaterThan(1);}
   run(g,4);
   for(const a of slots){expect(a.state).toBe(blocked?'docked':'deployed');if(!blocked)expect(a.entity!.pos.y).toBe(0);}
   expect(blasts).toBe(0);
  }
 });
 it('lets Recall and Reconfigure take escorts out of the orbit',()=>{
  const {g,s,t}=arena(1);t.withdraw();const slots=escorts(s,3);let blasts=0;g.events.on('explosion',()=>blasts++);
  mobile(s);g.step();run(g,2);s.control.aimX=-2000;s.control.aimZ=0;expect(s.activateSkill(3)).toBe(true);
  expect(slots.every(a=>!a.follow&&a.state==='moving')).toBe(true);run(g,4);
  expect(slots.every(a=>a.state==='deployed'&&!a.follow&&a.entity!.pos.y===0)).toBe(true);
  expect(s.activateSkill(4)).toBe(true);run(g,6);expect(slots.every(a=>a.state==='docked')).toBe(true);expect(blasts).toBe(0);
 });
 it('keeps shooting and elemental skills available during following movement',()=>{
  const {g,s}=arena(1);s.control.aimX=0;s.control.aimZ=500;s.activateSkill(0);run(g,1);
  const a=s.architect!.slots[1],m=a.entity!;let casts=0;g.events.on('architectElement',e=>{if(e.attack==='skill'&&e.phase==='cast')casts++;});
  a.skillTimer=0;mobile(s);g.step();s.pos.x+=1000;run(g,3);
  expect(m.stats.shotsFired).toBeGreaterThan(0);expect(casts).toBeGreaterThan(0);expect(m.control.fire).toBe(true);
 });
 it('keeps Mobile Battery independent from Battery anchoring and Citadel orbit',()=>{
  for(const skill of [7,8]){const {g,s}=arena(1);s.control.aimX=0;s.control.aimZ=0;s.meter=1;s.activateSkill(skill);run(g,1.5);
   const a=s.architect!.slots[0],p=a.entity!.pos.clone();mobile(s);g.step();s.pos.x=1000;run(g,.5);
   if(skill===7)expect(a.entity!.pos.distanceTo(p)).toBeCloseTo(0);else expect(a.state).toBe('citadel');
  }
 });
 it('preserves charges and clocks across refits, clear/rebuild, and hull forms',()=>{
  const {g,s}=arena(1);escorts(s,2);dash(s);mobile(s);run(g,.55);const cooldown=s.getVectorMobilityStatus()!.mobileBattery.cooldownRemaining;
  expect(refitArchitect(s,0,{type:'storm',skill:0})).toBe(true);expect(s.getVectorMobilityStatus()?.unlocked).toBe(false);
  expect(refitArchitect(s,0,{type:'vector',skill:1})).toBe(true);clearArchitect(s);
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownRemaining).toBe(cooldown);
  s.queueShift(g.shipSpec('stepper'),.5,[6,7,8]);run(g,1);expect(s.architect).not.toBeNull();
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownRemaining).toBeCloseTo(cooldown-1);
 });
 it('stops movement benefits immediately when the last Vector dies while recharge clocks continue',()=>{
  const {g,s,t}=arena(1),a=s.architect!.slots[0],m=materialize(s,a);a.state='deployed';m.pos.set(1000,0,0);
  dash(s);mobile(s);g.step();m.takeDamage(1e9,t,null,false,true);const p=s.pos.clone();run(g,.2);
  expect(s.pos.distanceTo(p)).toBeCloseTo(0);expect(s.architect!.drive).toBeNull();expect(a.follow).toBeNull();
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownRemaining).toBeGreaterThan(13);
 });
 it('hashes persistent charges, recharge, cooldown and activity as well as current movement',()=>{
  const {g,s}=arena();dash(s);mobile(s);g.step();
  for(const key of ['dashCharges','dashRechargeAt','mobileReadyAt','mobileUntil','mobileDuration'] as const){const h=stateHash(g),value=s.vectorMobility[key];s.vectorMobility[key]++;expect(stateHash(g),key).not.toBe(h);s.vectorMobility[key]=value;}
  const h=stateHash(g);s.architect!.drive!.elapsed+=.1;expect(stateHash(g)).not.toBe(h);
 });
});
