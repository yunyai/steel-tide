import { expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { attachModule, materialize } from '../src/skills/misc/ArchitectRuntime';
import { architectPool, ensureArchitectHealth } from '../src/skills/misc/ArchitectHealth';
function setup(){const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1500);s.addEffect({id:'test-no-passive',time:100,apply(m){m.regenMul=0;}});s.throttle=2;s.speed=0;s.control.aimX=800;s.control.aimZ=0;return{g,s};}
it('reserves 100k hull HP for each 200k combat platform',()=>{
  const {g,s}=setup();expect(s.maxHp).toBe(2500000);s.activateSkill(0);
  expect(s.hp).toBe(2300000);expect(s.maxHp).toBe(2300000);
  run(g,2);expect(s.architect!.slots[0].entity!.maxHp).toBe(200000);
  s.heal(1e6);expect(s.hp).toBe(2300000);
  expect(architectPool(s)).toEqual({hp:2500000,maxHp:2500000});
});
it('leaves 1.5M hull HP with all ten platforms deployed',()=>{
  const {g,s}=setup();
  for(const [x,z] of [[800,0],[-800,0],[1600,-1000],[-1600,-1000],[0,-2000]]){
    s.control.aimX=x;s.control.aimZ=z;s.skills[0].cooldown=0;expect(s.activateSkill(0)).toBe(true);run(g,4);
  }
  expect(s.architect!.slots.filter(a=>a.state==='deployed')).toHaveLength(10);
  expect(s.hp).toBe(1500000);expect(s.maxHp).toBe(1500000);
});
it('returns half the surviving combat HP and repairs docked modules at a 2:1 ratio',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  const slot=s.architect!.slots[0];slot.entity!.hp=100000;s.activateSkill(4);run(g,2);
  expect(s.maxHp).toBe(2500000);expect(s.hp).toBe(2450000);expect(slot.hp).toBe(100000);
  s.heal(50000);expect(s.hp).toBe(2500000);expect(slot.hp).toBe(200000);
  s.skills[0].cooldown=0;s.activateSkill(0);expect(slot.entity!.hp).toBe(200000);expect(s.hp).toBe(2300000);
});
it('does not create hull-equivalent health through repeated damaged recall and deployment',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  const slot=s.architect!.slots[0];slot.entity!.hp=50000;const before=architectPool(s).hp;
  for(let i=0;i<4;i++){
    for(const a of s.architect!.slots.filter(a=>a.entity))attachModule(s,a);
    expect(architectPool(s).hp).toBeCloseTo(before);
    materialize(s,slot);
    expect(architectPool(s).hp).toBeCloseTo(before);
  }
});
it('rebuilding redistributes hull-equivalent health without adding current HP',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  const slot=s.architect!.slots[0];slot.entity!.takeDamage(1e9,null,null,false,true);
  const before=s.hp,pool=architectPool(s).hp;run(g,12);
  expect(slot.state).toBe('docked');expect(s.hp).toBe(before);expect(s.maxHp).toBe(2400000);
  expect(architectPool(s).hp).toBe(pool);
  expect(slot.hp).toBeGreaterThan(0);expect(slot.hp).toBeLessThanOrEqual(200000);
});
it('hull damage scales resident combat HP and cannot create negative health on deployment',()=>{
  const {g,s}=setup();s.colossus=false;s.takeDamage(2000000,null);
  expect(s.hp).toBe(500000);s.activateSkill(0);expect(s.hp).toBe(460000);
  expect(s.architect!.slots[0].entity!.hp).toBeCloseTo(40000);
  expect(s.maxHp).toBe(2300000);run(g,.1);expect(s.hp).toBeGreaterThan(0);
});
it('reconciles rewind and direct restoration with docked component combat HP',()=>{
  const {g,s}=setup();run(g,1);s.takeDamage(1250000,null);
  expect(s.rewind(1,'hull')).toBe(true);expect(s.hp).toBe(2500000);
  expect(s.architect!.slots.every(a=>a.hp===200000)).toBe(true);
  s.takeDamage(300000,null);s.hp=s.maxHp;
  expect(s.architect!.slots.every(a=>a.hp===200000)).toBe(true);
});
it('uses hull-equivalent platform health for transformations rather than doubled combat HP',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  s.architect!.slots[0].entity!.hp=100000;
  expect(architectPool(s)).toEqual({hp:2450000,maxHp:2500000});
  s.queueShift(g.shipSpec('stepper'),10,[6,7,8]);run(g,.1);
  expect(s.maxHp).toBe(1100000);expect(s.hp).toBeLessThanOrEqual(s.maxHp);
});
it('scales both platform combat HP and hull share and preserves capacity through respawn',()=>{
  const {s}=setup();s.maxHp=5000000;s.hp=5000000;s.activateSkill(0);
  expect(s.maxHp).toBe(4600000);expect(s.architect!.slots[0].entity!.maxHp).toBe(400000);
  s.takeDamage(1e9,null,null,false,true);s.respawn(0,1500,0);
  expect(s.maxHp).toBe(5000000);expect(s.hp).toBe(5000000);
  ensureArchitectHealth(s);expect(s.architect!.moduleHp).toBe(400000);
  expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
});
it('scales live detached platforms when active hull capacity changes',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);s.maxHp*=2;s.hp*=2;ensureArchitectHealth(s);
  expect(s.architect!.fullHp).toBe(5000000);expect(s.architect!.moduleHp).toBe(400000);
  expect(s.architect!.slots[0].entity!.hp).toBe(400000);
  expect(architectPool(s)).toEqual({hp:5000000,maxHp:5000000});
});
it('does not create HP when a damaged and repaired hull receives a reinforced-hull refit',()=>{
  const {s}=setup();ensureArchitectHealth(s);s.hp=100000;s.heal(500000);
  s.maxHp*=1.2;s.hp+=s.maxHp*(.2/1.2);
  const before=architectPool(s).hp;
  const resident=s.architect!.slots.reduce((n,a)=>n+a.hp/2,0);
  expect(resident).toBeLessThanOrEqual(s.hp);
  for(const slot of s.architect!.slots)materialize(s,slot);
  expect(architectPool(s).hp).toBeCloseTo(before);expect(s.hp).toBeGreaterThan(0);
});
it('keeps module shares within hull HP when a capacity-only refit precedes deployment',()=>{
  const {s}=setup();ensureArchitectHealth(s);s.hp=100000;s.heal(500000);
  s.maxHp*=3;const before=s.hp;
  for(const slot of s.architect!.slots)materialize(s,slot);
  expect(architectPool(s).hp).toBeCloseTo(before);
});
