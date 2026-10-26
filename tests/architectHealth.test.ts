import { expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
function setup(){const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1500);s.addEffect({id:'test-no-passive',time:100,apply(m){m.regenMul=0;}});s.throttle=2;s.speed=0;s.control.aimX=800;s.control.aimZ=0;return{g,s};}
it('transfers 50k per deployed turret from hull capacity and current HP',()=>{
  const {g,s}=setup();s.activateSkill(0);
  expect(s.hp).toBe(1400000);expect(s.maxHp).toBe(1400000);
  run(g,2);expect(s.architect!.slots[0].entity!.maxHp).toBe(50000);
  s.heal(1e6);expect(s.hp).toBe(1400000);
});
it('returns surviving health and allocates actual hull healing to damaged docked turrets',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  const slot=s.architect!.slots[0];slot.entity!.hp=25000;s.activateSkill(4);run(g,2);
  expect(s.maxHp).toBe(1500000);expect(s.hp).toBe(1475000);expect(slot.hp).toBe(25000);
  s.heal(25000);expect(s.hp).toBe(1500000);expect(slot.hp).toBe(50000);
  s.skills[0].cooldown=0;s.activateSkill(0);expect(slot.entity!.hp).toBe(50000);expect(s.hp).toBe(1400000);
});
it('rebuilding redistributes health without adding current HP',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  s.addEffect({id:'no-regen',time:30,apply(m){m.regenMul=0;}});
  const slot=s.architect!.slots[0];slot.entity!.takeDamage(1e9,null,null,false,true);
  const before=s.hp;run(g,12);
  expect(slot.state).toBe('docked');expect(s.hp).toBe(before);expect(s.maxHp).toBe(1450000);
  expect(slot.hp).toBeGreaterThan(0);expect(slot.hp).toBeLessThanOrEqual(50000);
});
it('hull damage also damages its resident modules and cannot create negative health on deployment',()=>{
  const {g,s}=setup();s.colossus=false;s.takeDamage(1200000,null);
  expect(s.hp).toBe(300000);s.activateSkill(0);expect(s.hp).toBe(280000);
  expect(s.architect!.slots[0].entity!.hp).toBeCloseTo(10000);
  expect(s.maxHp).toBe(1400000);
  run(g,.1);expect(s.hp).toBeGreaterThan(0);
});
it('reconciles rewind and direct restoration with docked component HP',()=>{
  const {g,s}=setup();run(g,1);s.takeDamage(750000,null);
  expect(s.rewind(1,'hull')).toBe(true);expect(s.hp).toBe(1500000);
  expect(s.architect!.slots.every(a=>a.hp===50000)).toBe(true);
  s.takeDamage(300000,null);s.hp=s.maxHp;
  expect(s.architect!.slots.every(a=>a.hp===50000)).toBe(true);
});
it('uses the complete pool for transformation scaling and surviving health fractions',()=>{
  const {g,s}=setup();s.activateSkill(0);run(g,2);
  const full=s.architect!.fullHp;s.architect!.slots[0].entity!.hp=25000;
  const pool=s.hp+s.architect!.slots.filter(a=>a.entity).reduce((n,a)=>n+a.entity!.hp,0);
  s.queueShift(g.shipSpec('stepper'),10,[6,7,8]);run(g,.1);
  expect(s.maxHp).toBe(1100000);
  // Transformations retain their normal surge, bounded by the full health ratio.
  expect(s.hp/s.maxHp).toBeGreaterThanOrEqual(pool/full);
});
it('preserves scaled full capacity through death and respawn',()=>{
  const {s}=setup();s.maxHp=3000000;s.hp=3000000;s.activateSkill(0);
  expect(s.maxHp).toBe(2800000);
  s.takeDamage(1e9,null,null,false,true);s.respawn(0,1500,0);
  expect(s.maxHp).toBe(3000000);expect(s.hp).toBe(3000000);
  expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
});
