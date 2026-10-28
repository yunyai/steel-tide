import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { ARCHETYPES, ARCHITECT_TYPES, defaultLoadout, loadoutPreset } from '../src/data/architectLoadout';
import { activateConsumable } from '../src/ships/Consumables';
import { attachModule, materialize, preparePlatform, refitArchitect, setArchitectLoadout, updateArchitect } from '../src/skills/misc/ArchitectRuntime';
import { architectPool } from '../src/skills/misc/ArchitectHealth';
import { elementTarget } from '../src/skills/misc/ArchitectElements';
import { stateHash } from '../src/net/hash';

function arena(){
 const g=emptyGame('open',713,'freeplay');g.map.heightAt=()=>-100;
 const s=place(g,'architect',0,0,1500),t=place(g,'leviathan',1,0,-1500);
 for(const m of [s,t]){m.throttle=2;m.speed=0;m.secondaries=[];m.colossus=false;}
 s.addEffect({id:'test-no-passive',time:100,apply(m){m.regenMul=0;}});
 s.control.aimX=1000;s.control.aimZ=1500;t.hp=t.maxHp=1e7;
 return{g,s,t};
}
function vector(s:ReturnType<typeof arena>['s'],skills:(0|1)[]){
 const picks=defaultLoadout();skills.forEach((skill,i)=>picks[i]={type:'vector',skill});setArchitectLoadout(s,picks);
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
 it.each([[0,650],[1,400]] as const)('replaces Search for specialization %i and retains Search state', (skill,distance)=>{
  const {g,s}=arena();vector(s,[skill,skill]);const scan=s.consumables[1];scan.charges=8;scan.cooldown=30;scan.active=4;
  expect(activateConsumable(s,1)).toBe(true);expect(scan.charges).toBe(8);expect(scan.cooldown).toBe(30);expect(scan.active).toBe(4);
  run(g,.65);expect(s.pos.x).toBeCloseTo(distance);expect(activateConsumable(s,1)).toBe(false);
  refitArchitect(s,0,{type:'storm',skill:0});refitArchitect(s,1,{type:'storm',skill:0});scan.cooldown=0;
  expect(activateConsumable(s,1)).toBe(true);expect(scan.charges).toBe(7);vector(s,[0]);expect(activateConsumable(s,1)).toBe(false);
 });
 it('combines variants without stacking duplicates and never autocasts Vector',()=>{
  const {g,s}=arena();vector(s,[0,1,0,1]);expect(s.activateSkill(0)).toBe(true);run(g,2);
  const a=s.architect!.slots[0],m=a.entity!;s.control.aimX=1000;s.control.aimZ=1500;const before=m.pos.clone();expect(activateConsumable(s,1)).toBe(true);run(g,.65);
  expect(s.pos.x).toBeCloseTo(650);expect(a.state).toBe('deployed');expect(m.pos.distanceTo(before)).toBeGreaterThan(0);
  expect(m.control.fire).toBe(true);expect(s.architect!.elements.jobs.some(j=>j.type==='vector'&&j.attack==='skill')).toBe(false);
 });
 it('rejects Assembly and movement control effects while destroyed Vectors restore Search',()=>{
  const {s}=arena();vector(s,[0]);s.mods.rooted=true;expect(activateConsumable(s,1)).toBe(false);s.mods.rooted=false;
  s.meter=1;s.activateSkill(6);expect(activateConsumable(s,1)).toBe(false);
  s.architect!.ultimate=null;s.architect!.slots[0].hp=0;s.architect!.slots[0].state='destroyed';expect(activateConsumable(s,1)).toBe(true);
 });
 it('keeps drive cooldown through a hull form change and return',()=>{
  const {g,s}=arena();vector(s,[0]);expect(activateConsumable(s,1)).toBe(true);const readyAt=s.architectDriveReadyAt;
  s.queueShift(g.shipSpec('stepper'),.5,[6,7,8]);run(g,1);expect(s.architect).not.toBeNull();expect(s.architectDriveReadyAt).toBe(readyAt);
  expect(activateConsumable(s,1)).toBe(false);expect(s.architect!.drive).toBeNull();
 });
 it('never automatically activates a selected ability for a complete Vector arsenal',()=>{
  const {g,s}=arena();setArchitectLoadout(s,Array.from({length:10},(_,i)=>({type:'vector',skill:i%2 as 0|1})));
  const casts:string[]=[];g.events.on('architectElement',e=>{if(e.attack==='skill'&&e.phase==='cast')casts.push(e.type??'');});
  const p=s.pos.clone();s.meter=1;expect(s.activateSkill(8)).toBe(true);run(g,2);
  expect(casts).toEqual([]);expect(s.architectDriveReadyAt).toBe(0);expect(s.pos.distanceTo(p)).toBeCloseTo(0);
  expect(s.architect!.slots.some(a=>a.entity!.stats.shotsFired>0)).toBe(true);
 });
 it('sweeps the whole hull through narrow terrain and stops before an island',()=>{
  const {g,s}=arena();vector(s,[0]);g.map.heightAt=(x)=>x>=300&&x<=315?50:-100;
  expect(activateConsumable(s,1)).toBe(true);run(g,.65);expect(s.pos.x).toBeGreaterThan(0);expect(s.pos.x).toBeLessThan(250);
 });
 it('stops at a closer reticle rather than overshooting it',()=>{
  const {g,s}=arena();vector(s,[0]);s.control.aimX=150;expect(activateConsumable(s,1)).toBe(true);run(g,.65);expect(s.pos.x).toBeCloseTo(150);
 });
 it('retains a following formation target when platform speed limits its progress',()=>{
  const {g,s}=arena();vector(s,[1]);const a=s.architect!.slots[0],m=materialize(s,a);a.state='deployed';m.pos.set(1000,0,0);
  expect(activateConsumable(s,1)).toBe(true);s.architect!.drive=null;s.pos.x=2000;
  updateArchitect(s,.1);expect(m.pos.x).toBeCloseTo(1120);updateArchitect(s,.1);expect(m.pos.x).toBeCloseTo(1240);
  expect(g.ships.includes(m)).toBe(true);
 });
 it('keeps anchored Battery and orbiting Citadel independent from Mobile Battery follow',()=>{
  const {g,s}=arena();vector(s,[1]);s.meter=1;s.activateSkill(7);run(g,1.5);const a=s.architect!.slots[0],p=a.entity!.pos.clone();
  expect(activateConsumable(s,1)).toBe(true);run(g,.65);expect(a.entity!.pos.distanceTo(p)).toBeCloseTo(0);
 });
 it('drives the full distance below a Battery carrier when vertical hull spans do not overlap',()=>{
  const {g,s}=arena();vector(s,[0]);s.control.aimX=0;s.control.aimZ=500;s.meter=1;expect(s.activateSkill(7)).toBe(true);run(g,1.5);
  const rear=s.architect!.slots.find(a=>Math.abs(a.entity!.pos.x)<1&&Math.abs(a.entity!.pos.z-2000)<1)!.entity!;
  expect(rear.pos.y-rear.spec.draft).toBeGreaterThan(s.pos.y+s.spec.freeboard+30);
  s.control.aimZ=2500;expect(activateConsumable(s,1)).toBe(true);run(g,.65);expect(s.pos.z).toBeCloseTo(2150);
 });
 it('keeps same-height enemy ships as physical obstacles during a drive',()=>{
  const {g,s}=arena();vector(s,[0]);const block=place(g,'iowa',1,0,2000);block.throttle=2;block.speed=0;block.secondaries=[];
  s.control.aimX=0;s.control.aimZ=2500;expect(activateConsumable(s,1)).toBe(true);run(g,.65);
  expect(s.pos.z).toBeGreaterThan(1500);expect(s.pos.z).toBeLessThan(1800);expect(block.alive).toBe(true);
 });
 it('hashes every new charge and drive state that can change future simulation',()=>{
  const {g,s}=arena();const a=s.architect!.slots[0],h=stateHash(g);a.capacitorCycles=1;expect(stateHash(g)).not.toBe(h);
  const h2=stateHash(g);s.architect!.mobileUntil=4;expect(stateHash(g)).not.toBe(h2);
 });
 it('does not let its own Brood drones push the source platform',()=>{
  const {g,s}=arena(),a=s.architect!.slots[0],m=materialize(s,a);a.state='deployed';m.pos.set(1000,0,0);
  const d=place(g,'architectPlatform',0,1020,0);d.architectDrone={owner:s,slot:0};d.summonOwner=s;d.isSummon=true;d.pos.y=50;
  const before=m.pos.clone();run(g,1/60);expect(m.pos.distanceTo(before)).toBeCloseTo(0);
 });
});
