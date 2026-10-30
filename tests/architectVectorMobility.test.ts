import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { defaultLoadout } from '../src/data/architectLoadout';
import { activateConsumable } from '../src/ships/Consumables';
import { clearArchitect, dashLift, materialize, refitArchitect, setArchitectLoadout, updateArchitect, vectorTuning, VECTOR_THRUST } from '../src/skills/misc/ArchitectRuntime';
import type { ArchitectSelection } from '../src/data/architectLoadout';
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
 it('caps at a closer reticle and stacks duplicate specializations without a cap',()=>{
  const {g,s}=arena();const picks=defaultLoadout();for(let i=0;i<4;i++)picks[i]={type:'vector',skill:i%2 as 0|1};setArchitectLoadout(s,picks);escorts(s,1);
  expect(s.getVectorMobilityStatus()?.hullDash).toMatchObject({charges:3,maxCharges:3,distance:1250});
  s.control.aimX=150;dash(s);mobile(s);run(g,.55);expect(s.pos.x).toBeCloseTo(150);
  expect(s.getVectorMobilityStatus()?.mobileBattery.duration).toBe(17);expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownDuration).toBeCloseTo(14*.85);
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(2);
 });
 it.each([0,1,5,10])('adds the uncapped thruster passive for %i living Vectors',n=>{
  const {s}=arena();const picks:ArchitectSelection[]=defaultLoadout().map((p,i)=>i<n?{type:'vector',skill:(i%2) as 0|1}:p.type==='vector'?{type:'storm',skill:0}:p);
  setArchitectLoadout(s,picks);s.refreshModifiers();const m=s.mods;
  expect(m.speedMul).toBeCloseTo(1+VECTOR_THRUST.speed*n);expect(m.accelMul).toBeCloseTo(1+VECTOR_THRUST.accel*n);
  expect(m.turnMul).toBeCloseTo(1+VECTOR_THRUST.turn*n);expect(m.rudderMul).toBeCloseTo(1+VECTOR_THRUST.rudder*n);expect(m.traverseMul).toBeCloseTo(1+VECTOR_THRUST.traverse*n);
  const t=vectorTuning(s),dashes=Math.ceil(n/2),mobiles=Math.floor(n/2);
  expect(t.dashCharges).toBe(2+Math.max(0,dashes-1));expect(t.dashDistance).toBe(dashes?1100+150*(dashes-1):800);
  expect(t.mobileDuration).toBe(mobiles?14+3*(mobiles-1):10);expect(t.escortSpeed).toBeCloseTo(1200*(1+.15*n));
  expect(t.pathDamage).toBe(15000+3000*Math.max(0,n-1));expect(t.landDamage).toBe(25000+5000*Math.max(0,n-1));expect(t.landRadius).toBe(450+50*Math.max(0,n-1));
 });
 it('drops a destroyed Vector from the passive and clamps spare charges until it is rebuilt',()=>{
  const {g,s}=arena();const picks=defaultLoadout();picks[0]={type:'vector',skill:0};picks[1]={type:'vector',skill:0};setArchitectLoadout(s,picks);
  expect(s.vectorMobility.dashCharges).toBe(3);s.refreshModifiers();expect(s.mods.speedMul).toBeCloseTo(1.12);
  const lost=s.architect!.slots[1];lost.state='destroyed';lost.hp=0;lost.rebuild=60;g.step();
  expect(s.mods.speedMul).toBeCloseTo(1.06);expect(s.vectorMobility.dashCharges).toBe(2);expect(s.vectorMobility.dashRechargeAt).toBe(0);
  lost.state='docked';lost.hp=5000;g.step();
  expect(s.getVectorMobilityStatus()?.hullDash).toMatchObject({charges:2,maxCharges:3});expect(s.getVectorMobilityStatus()?.hullDash.rechargeRemaining).toBeGreaterThan(9.9);
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
   if(obstacle==='ship'){const block=place(g,'iowa',0,0,2000);block.throttle=2;block.secondaries=[];}
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
 it('chases a dashing hull at the stacked escort speed and clears terrain below the orbit',()=>{
  const {g,s,t}=arena(1);t.withdraw();const slots=escorts(s,3);g.map.heightAt=(x,z)=>Math.hypot(x-2500,z-1500)<600?150:-100;
  mobile(s);g.step();run(g,2);s.pos.x=2500;
  for(let i=0;i<300;i++){const before=slots.map(a=>a.entity!.pos.clone());g.step();
   slots.forEach((a,n)=>{const m=a.entity!;expect(m.pos.distanceTo(before[n])).toBeLessThanOrEqual(1200*(1+VECTOR_THRUST.escort)/60+1e-6);expect(m.pos.y).toBeGreaterThan(g.map.heightAt(m.pos.x,m.pos.z)+19);});}
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
  dash(s);mobile(s);g.step();expect(s.pos.y).toBeGreaterThan(0);m.takeDamage(1e9,t,null,false,true);const p=s.pos.clone();run(g,.2);
  expect(Math.hypot(s.pos.x-p.x,s.pos.z-p.z)).toBeCloseTo(0);expect(s.pos.y).toBe(0);expect(s.architect!.drive).toBeNull();expect(a.follow).toBeNull();
  expect(s.getVectorMobilityStatus()?.hullDash.charges).toBe(1);expect(s.getVectorMobilityStatus()?.mobileBattery.cooldownRemaining).toBeGreaterThan(13);
 });
 it('turns bow-first onto the dash bearing and lifts clear of the water before setting down',()=>{
  const {g,s}=arena();s.heading=0;const heights:number[]=[];dash(s);
  for(let i=0;i<Math.round(.55*60);i++){g.step();heights.push(s.pos.y);}
  expect(Math.max(...heights)).toBeCloseTo(50);expect(s.pos.y).toBe(0);expect(s.heading).toBeCloseTo(Math.PI/2);
  expect(dashLift(0)).toBe(0);expect(dashLift(.275)).toBeCloseTo(50);expect(dashLift(.55)).toBeCloseTo(0);
 });
 it('barrels through enemy hulls once each, shoving them aside, and lands with a shockwave',()=>{
  const {g,s,t}=arena();t.withdraw();const events:string[]=[];g.events.on('architectDash',e=>events.push(e.phase));
  const path=place(g,'iowa',1,500,1540),near=place(g,'iowa',1,1400,1500);
  for(const e of [path,near]){e.hp=e.maxHp=1e7;e.throttle=2;e.speed=0;e.secondaries=[];}
  dash(s);run(g,.6);
  expect(s.pos.x).toBeCloseTo(1100);expect(events).toEqual(['launch','land']);
  expect(path.hp).toBeLessThan(1e7);expect(path.pos.z).toBeGreaterThan(1600);
  expect(near.hp).toBeLessThan(1e7);expect(near.pos.x).toBeGreaterThan(1400);
  const once=path.hp;run(g,.5);expect(path.hp).toBe(once);
 });
 it('scales dash impact damage with every living Vector',()=>{
  const dealt=(n:number)=>{
   const {g,s,t}=arena();t.withdraw();const picks:ArchitectSelection[]=defaultLoadout().map((p,i)=>i<n?{type:'vector',skill:1}:p.type==='vector'?{type:'storm',skill:0}:p);setArchitectLoadout(s,picks);
   const e=place(g,'iowa',1,950,1500);e.hp=e.maxHp=1e7;e.throttle=2;e.secondaries=[];s.control.aimX=800;dash(s);run(g,.6);return 1e7-e.hp;
  };
  expect(dealt(5)).toBeGreaterThan(dealt(1)*1.4);
 });
 it('hashes persistent charges, recharge, cooldown and activity as well as current movement',()=>{
  const {g,s}=arena();dash(s);mobile(s);g.step();
  for(const key of ['dashCharges','dashRechargeAt','mobileReadyAt','mobileUntil','mobileDuration'] as const){const h=stateHash(g),value=s.vectorMobility[key];s.vectorMobility[key]++;expect(stateHash(g),key).not.toBe(h);s.vectorMobility[key]=value;}
  const h=stateHash(g);s.architect!.drive!.elapsed+=.1;expect(stateHash(g)).not.toBe(h);
  const h2=stateHash(g);s.architect!.drive!.hit.push(99);expect(stateHash(g)).not.toBe(h2);
 });
});
