import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { ARCHETYPES, ARCHITECT_TYPES, loadoutPreset } from '../src/data/architectLoadout';
import { attachModule, materialize, preparePlatform, refitArchitect, setArchitectLoadout, updateArchitect } from '../src/skills/misc/ArchitectRuntime';
import { architectPool } from '../src/skills/misc/ArchitectHealth';
import { elementTarget } from '../src/skills/misc/ArchitectElements';

function arena(){
 const g=emptyGame('open',713,'freeplay');g.map.heightAt=()=>-100;
 const s=place(g,'architect',0,0,1500),t=place(g,'leviathan',1,0,-1500);
 for(const m of [s,t]){m.throttle=2;m.speed=0;m.secondaries=[];m.colossus=false;}
 s.addEffect({id:'test-no-passive',time:100,apply(m){m.regenMul=0;}});
 s.control.aimX=1000;s.control.aimZ=1500;t.hp=t.maxHp=1e7;
 return{g,s,t};
}
function fire(s:ReturnType<typeof arena>['s'],index=0,force=false){const t=s.turrets[index];t.reload=0;t.aligned=t.canBear=true;return s.fireTurret(index,'AP',force);}

describe('Architect command and gun polish',()=>{
 it.each([6,7,8])('allows Hunt/Fortify/Recall through every ultimate gate %i',index=>{
  const {g,s,t}=arena();s.control.aimX=t.pos.x;s.control.aimZ=t.pos.z;s.meter=1;expect(s.activateSkill(index)).toBe(true);
  expect(s.skillReady(1)).toBe(true);expect(s.skillReady(4)).toBe(true);expect(s.skillReady(5)).toBe(true);
  s.control.skill=1;run(g,1/60);expect(s.architect!.huntTarget).toBe(t.id);
  s.control.skill=4;run(g,1/60);expect(s.architect!.ultimate).toBeNull();
  expect(s.architect!.slots.every(a=>a.state==='returning'||a.state==='docked')).toBe(true);
  run(g,2);expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
 });
 it('keeps committed Battery flights after Recall and cancels later stages',()=>{
  const {g,s}=arena();s.meter=1;s.activateSkill(7);run(g,1.6);
  const flights=g.battery.pending.length;expect(flights).toBeGreaterThan(0);expect(s.activateSkill(4)).toBe(true);
  expect(g.battery.pending).toHaveLength(flights);const serial=g.battery.launchSerial;run(g,3);
  expect(g.battery.launchSerial).toBe(serial);expect(g.battery.pending).toHaveLength(0);
 });
 it('uses docked and Hunt firing rates while preserving reload fractions',()=>{
  const {g,s,t}=arena();fire(s);expect(s.turrets[0].reload).toBe(4);
  s.turrets[0].reload=2;s.control.aimX=t.pos.x;s.control.aimZ=t.pos.z;expect(s.activateSkill(1)).toBe(true);
  expect(s.turrets[0].reload).toBeCloseTo(1.6);fire(s);expect(s.turrets[0].reload).toBeCloseTo(3.2);
  const slot=s.architect!.slots[0],m=materialize(s,slot);slot.state='deployed';m.refreshModifiers();preparePlatform(m);
  expect(m.turrets[0].reload).toBeCloseTo(2.4);attachModule(s,slot);expect(s.turrets[0].reload).toBeCloseTo(3.2);
  s.architect!.huntUntil=g.time;updateArchitect(s,0);expect(s.turrets[0].reload).toBeCloseTo(4);
 });
 it('applies multiplicative capped docking protection only to living docked slots',()=>{
  const {s,t}=arena();s.mods.damageTakenMul=.5;expect(s.takeDamage(10000,t)).toBeCloseTo(4000);
  for(const a of s.architect!.slots.slice(0,5)){a.state='destroyed';a.hp=0;}
  expect(s.takeDamage(10000,t)).toBeCloseTo(4500);
 });
 it('repairs after two seconds using one modified shared health budget',()=>{
  const {s}=arena();s.hp=1250000;s.mods.regenMul=.5;
  const before=architectPool(s).hp;updateArchitect(s,2);expect(architectPool(s).hp).toBe(before);
  updateArchitect(s,1);expect(s.hp-before).toBeCloseTo(105000);
  const pool=architectPool(s).hp;const a=s.architect!.slots[0];materialize(s,a);attachModule(s,a);expect(architectPool(s).hp).toBeCloseTo(pool);
 });
 it('gives Siege protection only once its Battery emplacement unfolds',()=>{
  const {g,s}=arena();s.meter=1;s.activateSkill(7);const m=s.architect!.slots[0].entity!;m.colossus=false;m.refreshModifiers();
  expect(m.takeDamage(10000,null)).toBeCloseTo(10000);run(g,1.5);m.refreshModifiers();preparePlatform(m);
  expect(m.maxHp).toBe(200000);expect(m.takeDamage(10000,null)).toBeCloseTo(6000);
 });
});

describe('Architect docked capacitors',()=>{
 it('filters revealed submarines before ranking Abyss capacitor surface targets',()=>{
  const {g,s,t}=arena();expect(refitArchitect(s,0,{type:'abyss',skill:0})).toBe(true);const a=s.architect!.slots[0];
  const sub=place(g,'virginia',1,0,1000);sub.pos.y=-50;sub.depthState=2;sub.architectReveal[0]=100;s.control.targetId=sub.id;
  let target=-1;g.events.on('architectElement',e=>{if(e.attack==='salvo'&&e.phase==='cast')target=e.target??-1;});
  expect(elementTarget(s,a)).toBe(sub);a.capacitorCharged=true;g.shells.shells=[];updateArchitect(s,0);
  expect(g.shells.shells).toHaveLength(1);expect(g.shells.shells[0].element?.slot).toBe(0);expect(a.capacitorCharged).toBe(false);
  expect(target).toBe(t.id);expect(elementTarget(s,a)).toBe(sub);
 });
 it('counts ordinary firing cycles once per twin turret and retains a single charge',()=>{
  const {g,s}=arena(),a=s.architect!.slots[0];fire(s,0,true);expect(a.capacitorCycles).toBe(0);
  fire(s);expect(a.capacitorCycles).toBe(1);fire(s);expect(a.capacitorCharged).toBe(true);fire(s);expect(a.capacitorCycles).toBe(0);
  g.shells.shells=[];updateArchitect(s,0);const bolts=g.shells.shells.filter(p=>p.spec.damage===18000);
  expect(bolts).toHaveLength(1);expect(a.capacitorCharged).toBe(false);expect(a.capacitorCycles).toBe(0);
  updateArchitect(s,0);expect(g.shells.shells.filter(p=>p.spec.damage===18000)).toHaveLength(1);
 });
 it('launches in deterministic slot order with a shared cadence and legal target checks',()=>{
  const {g,s,t}=arena();for(const index of [1,0]){fire(s,index);fire(s,index);}
  t.mods.untargetable=true;g.shells.shells=[];updateArchitect(s,0);expect(g.shells.shells).toHaveLength(0);
  t.mods.untargetable=false;updateArchitect(s,0);expect(g.shells.shells[0].element?.slot).toBe(0);
  updateArchitect(s,.3);expect(g.shells.shells).toHaveLength(1);g.time+=.6;updateArchitect(s,0);
  expect(g.shells.shells).toHaveLength(2);expect(g.shells.shells[1].element?.slot).toBe(1);
 });
 it('preserves progress through transfers but clears it on actual refit and destruction',()=>{
  const {s}=arena(),a=s.architect!.slots[0];fire(s);materialize(s,a);attachModule(s,a);expect(a.capacitorCycles).toBe(1);
  expect(refitArchitect(s,0,{type:'furnace',skill:0})).toBe(true);expect(a.capacitorCycles).toBe(1);
  expect(refitArchitect(s,0,{type:'cryo',skill:1})).toBe(true);expect(a.capacitorCycles).toBe(0);
  fire(s);const m=materialize(s,a);a.state='deployed';m.takeDamage(1e9,null,null,false,true);expect(a.capacitorCycles).toBe(0);expect(a.capacitorCharged).toBe(false);
 });
});

describe('Vector manual utility',()=>{
 it('adds Vector after all existing type indices and allows two omitted unique choices',()=>{
  expect(ARCHITECT_TYPES.slice(0,11)).toEqual(['furnace','cryo','storm','gravity','prism','sentinel','abyss','restoration','bastion','resonance','swarm']);
  expect(ARCHETYPES.vector.element).toBe('storm');expect(loadoutPreset('shuffle','swarm',()=>.999)[0].type).toBe('vector');
  const picks=loadoutPreset('unique',['furnace','cryo']);expect(new Set(picks.map(p=>p.type)).size).toBe(10);expect(picks.some(p=>p.type==='vector')).toBe(true);
 });
 it('never automatically activates a selected ability for a complete Vector arsenal',()=>{
  const {g,s}=arena();setArchitectLoadout(s,Array.from({length:10},(_,i)=>({type:'vector',skill:i%2 as 0|1})));
  const casts:string[]=[];g.events.on('architectElement',e=>{if(e.attack==='skill'&&e.phase==='cast')casts.push(e.type??'');});
  const p=s.pos.clone();s.meter=1;expect(s.activateSkill(8)).toBe(true);run(g,2);
  expect(casts).toEqual([]);expect(s.vectorMobility.dashRecharge).toEqual([]);expect(s.pos.distanceTo(p)).toBeCloseTo(0);
  expect(s.architect!.slots.some(a=>a.entity!.stats.shotsFired>0)).toBe(true);
 });
 it('does not let its own Brood drones push the source platform',()=>{
  const {g,s}=arena(),a=s.architect!.slots[0],m=materialize(s,a);a.state='deployed';m.pos.set(1000,0,0);
  const d=place(g,'architectPlatform',0,1020,0);d.architectDrone={owner:s,slot:0};d.summonOwner=s;d.isSummon=true;d.pos.y=50;
  const before=m.pos.clone();run(g,1/60);expect(m.pos.distanceTo(before)).toBeCloseTo(0);
 });
});
