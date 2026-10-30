import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { safeStep } from '../src/skills/misc/StepperRuntime';
import { stateHash } from '../src/net/hash';
import { BATTERY_FOLD_TIME } from '../src/skills/misc/ArchitectBatteryPose';

function battery(){
 const g=emptyGame('open',53,'freeplay');g.map.heightAt=()=>-100;
 const s=place(g,'architect',0,0,3000);s.throttle=2;s.secondaries=[];s.control.aimX=s.control.aimZ=0;s.meter=1;s.activateSkill(7);
 run(g,1.5);return{g,s};
}
describe('Grand Battery water recovery',()=>{
 it('reserves valid distinct water landings and folds before descending monotonically',()=>{
  const {g,s}=battery();const slots=s.architect!.slots;
  // Force terrain hover, then expose valid water so recovery must physically descend.
  for(const a of slots)a.entity!.pos.y=200;
  run(g,6);expect(s.architect!.ultimate).toBeNull();expect(g.battery.pending).toHaveLength(10);
  const reservations:{x:number;z:number;heading:number}[]=[];
  for(const a of slots){expect(a.state).toBe('moving');expect(a.path?.settling).toBe(true);expect(a.path?.ty).toBe(0);
   const p=a.path!;expect(safeStep(a.entity!,p.tx,p.tz,a.entity!.heading,false,reservations)).toBe(true);reservations.push({x:p.tx,z:p.tz,heading:a.entity!.heading});
  }
  run(g,.6);for(const a of slots)expect(a.entity!.pos.y).toBeCloseTo(200);
  run(g,.3);for(const a of slots){expect(a.entity!.pos.y).toBeGreaterThan(0);expect(a.entity!.pos.y).toBeLessThan(200);}
  run(g,.8);for(const a of slots){expect(a.state).toBe('deployed');expect(a.path).toBeNull();expect(a.entity!.pos.y).toBe(0);expect(a.entity!.alive).toBe(true);}
 });
 it('searches near the current formation and returns to owner if no legal landing exists',()=>{
  const {g,s}=battery();const a=s.architect!.slots[0],m=a.entity!,x=m.pos.x,z=m.pos.z;
  g.map.heightAt=(px,pz)=>Math.hypot(px-x,pz-z)<250?100:-100;run(g,6);
  expect(a.path?.settling).toBe(true);expect(a.state).toBe('moving');expect(Math.hypot(a.path!.tx-x,a.path!.tz-z)).toBeGreaterThan(250);
  const {g:blocked,s:owner}=battery();let blasts=0;blocked.events.on('explosion',e=>{if(e.size===.3)blasts++;});blocked.map.heightAt=()=>100;run(blocked,6);
  expect(owner.architect!.slots.every(v=>v.state==='returning'&&v.path?.settling)).toBe(true);
  run(blocked,6);expect(owner.architect!.slots.every(v=>v.state==='docked')).toBe(true);
  // Docking is not destruction: no withdrawal blast for any returning platform.
  expect(blasts).toBe(0);
 });
 it('preserves committed paths while Recall replaces recovery and never emits platform destruction',()=>{
  const {g,s}=battery();let destroyed=0,blasts=0;g.events.on('architectCommand',e=>{if(e.kind==='destroy')destroyed++;});g.events.on('explosion',e=>{if(e.size===.3)blasts++;});run(g,6);
  const flights=g.battery.pending.map(v=>JSON.stringify(v.paths));expect(flights).toHaveLength(10);expect(s.activateSkill(4)).toBe(true);
  expect(s.architect!.slots.every(a=>a.state==='returning'&&!a.path?.settling)).toBe(true);
  expect(g.battery.pending.map(v=>JSON.stringify(v.paths))).toEqual(flights);run(g,5);
  expect(destroyed).toBe(0);expect(blasts).toBe(0);expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);expect(g.battery.pending).toHaveLength(0);
 });
 it('lets Reconfigure replace natural settling while every final salvo retains its committed path',()=>{
  const {g,s}=battery();run(g,6);const flights=g.battery.pending.map(v=>JSON.stringify(v.paths));
  s.control.aimX=2000;s.control.aimZ=0;expect(s.activateSkill(3)).toBe(true);
  expect(s.architect!.slots.every(a=>a.state==='moving'&&!a.path?.settling)).toBe(true);
  expect(g.battery.pending.map(v=>JSON.stringify(v.paths))).toEqual(flights);run(g,4);
  expect(s.architect!.slots.every(a=>a.state==='deployed')).toBe(true);
 });
 it('never resurrects a destroyed member and cancels recovery on owner death',()=>{
  const {g,s}=battery();s.architect!.slots[0].entity!.takeDamage(1e9,null,null,false,true);run(g,6);
  // The five-second rebuild has elapsed; this contributor was never returned from the air.
  expect(s.architect!.slots[0].state).toBe('docked');expect(s.architect!.slots[0].entity).toBeNull();
  const live=s.architect!.slots[1].entity!;let blasts=0;g.events.on('explosion',()=>blasts++);s.takeDamage(1e9,null,null,false,true);expect(live.alive).toBe(false);expect(g.battery.pending).toHaveLength(0);
  // Owner loss is not a quiet dock: the withdrawn platforms still blow up.
  expect(blasts).toBeGreaterThan(0);
 });
 it('anchors waterline emplacements without shoving or ramming hulls beneath them',()=>{
  const {g,s}=battery();const member=s.architect!.ultimate!.battery!.members[0],hub=s.architect!.slots[member.slot].entity!;
  const ship=place(g,'iowa',1,member.carrier.x,member.carrier.z);ship.throttle=2;ship.speed=0;ship.secondaries=[];const hp=hub.hp,p=ship.pos.clone();
  run(g,.5);expect(hub.pos.x).toBeCloseTo(member.carrier.x);expect(hub.pos.z).toBeCloseTo(member.carrier.z);expect(ship.pos.distanceTo(p)).toBeCloseTo(0);expect(hub.hp).toBe(hp);
 });
 it('lets carriers already on open water fold in place without the extra travel second',()=>{
  const {g,s}=battery();run(g,6.05);const slots=s.architect!.slots;
  expect(slots.every(a=>a.state==='moving'&&a.path?.settling&&a.path.duration<.7)).toBe(true);
  run(g,.7);expect(slots.every(a=>a.state==='deployed'&&a.entity!.pos.y===0)).toBe(true);
 });
 it('keeps a settling descent above an island between the carrier and its water',()=>{
  const {g,s}=battery();const a=s.architect!.slots[0],m=a.entity!;run(g,6.05);m.pos.y=200;
  const p=a.path!,x0=m.pos.x,z0=m.pos.z;p.y=200;p.tx=x0+900;p.tz=z0;p.duration=BATTERY_FOLD_TIME+1;
  g.map.heightAt=(x,z)=>Math.abs(x-(x0+450))<120&&Math.abs(z-z0)<120?150:-100;
  let low=Infinity;for(let i=0;i<100&&a.path;i++){g.step();if(a.path)low=Math.min(low,m.pos.y-g.map.heightAt(m.pos.x,m.pos.z));}
  expect(low).toBeGreaterThanOrEqual(40-1e-6);
 });
 it('fingerprints the recovery marker because it changes future movement',()=>{
  const {g,s}=battery();run(g,6);const path=s.architect!.slots[0].path;expect(path).not.toBeNull();
  const before=stateHash(g);path!.settling=false;expect(stateHash(g)).not.toBe(before);
 });
});
