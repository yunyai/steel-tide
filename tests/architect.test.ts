import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';

function arena() {
  const g=emptyGame('open',713,'freeplay');
  const s=place(g,'architect',0,0,1500);const t=place(g,'leviathan',1,0,-1000);
  s.throttle=t.throttle=2;s.speed=t.speed=0;t.colossus=false;t.hp=t.maxHp=10000000;
  s.secondaries.length=t.secondaries.length=0;s.control.aimX=800;s.control.aimZ=0;
  return {g,s,t};
}
function deploy() {const a=arena();a.s.activateSkill(0);run(a.g,2);return a;}
describe('Architect arsenal',()=>{
  it('has ten actual twin turrets, nine skills, and the chosen titan hull',()=>{
    expect(SHIP_BY_ID.architect.hp).toBe(1500000);expect(SHIP_BY_ID.architect.maxSpeed).toBe(30);
    const {s}=arena();expect(s.turrets).toHaveLength(10);expect(s.skills).toHaveLength(9);
    expect(s.architect!.slots).toHaveLength(10);
    expect(s.spec.main!.ap!.damage).toBe(10800);expect(s.spec.main!.reload).toBe(6);
  });
  it('deploys a pair without duplicating the docked guns or resetting reloads',()=>{
    const {g,s}=arena();s.turrets[0].reload=4;s.turrets[1].reload=3;
    expect(s.activateSkill(0)).toBe(true);
    expect(s.architect!.slots.filter(a=>a.state==='launching')).toHaveLength(2);
    expect(s.turrets[0].disabled).toBe(Infinity);
    run(g,2);
    const slots=s.architect!.slots.slice(0,2);
    expect(slots.every(a=>a.state==='deployed')).toBe(true);
    expect(slots.every(a=>a.entity?.maxHp===50000)).toBe(true);
    expect(slots[0].entity!.turrets[0].reload).toBeGreaterThan(1.9);
    expect(slots[1].entity!.turrets[0].reload).toBeGreaterThan(0.9);
    expect(g.ai.has(slots[0].entity!)).toBe(false);
  });
  it('fails blocked placement atomically without spending cooldown',()=>{
    const {g,s}=arena();g.map.heightAt=()=>10;
    expect(s.activateSkill(0)).toBe(false);expect(s.skills[0].cooldown).toBe(0);
    expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
    expect(s.skillFailure).toMatch(/water|blocked|safe/i);
  });
  it('recalls damaged platforms preserving reload and repairs them after docking',()=>{
    const {g,s}=deploy();s.addEffect({id:'test-no-passive',time:100,apply(m){m.regenMul=0;}});const slot=s.architect!.slots[0],m=slot.entity!;
    m.hp=20000;m.turrets[0].reload=5;
    expect(s.activateSkill(4)).toBe(true);run(g,2);
    expect(slot.state).toBe('docked');expect(slot.hp).toBe(20000);
    expect(s.turrets[0].disabled).toBe(0);expect(s.turrets[0].reload).toBeGreaterThan(2.9);
    run(g,3);expect(slot.hp).toBeGreaterThan(20000);expect(slot.hp).toBeLessThanOrEqual(50000);
  });
  it('rebuilds destroyed platforms after twelve seconds without kill or score rewards',()=>{
    const {g,s,t}=deploy();const slot=s.architect!.slots[0],m=slot.entity!;
    t.hp=t.maxHp*0.5;const hp=t.hp,meter=t.meter;
    m.takeDamage(10000000,t,null,false,true);
    expect(slot.state).toBe('destroyed');expect(t.stats.kills).toBe(0);expect(t.hp).toBe(hp);expect(g.score).toEqual([0,0]);
    expect(t.meter).toBeGreaterThanOrEqual(meter);
    run(g,11.9);expect(slot.state).toBe('destroyed');
    run(g,0.1);expect(slot.state).toBe('docked');expect(slot.hp).toBeGreaterThan(0);expect(slot.hp).toBeLessThanOrEqual(50000);
  });
  it('credits actual platform damage once to the owner and charges its ultimate',()=>{
    const {g,s,t}=deploy();const m=s.architect!.slots[0].entity!;
    s.meter=0;const before=s.stats.damage;
    expect(t.takeDamage(10000,m)).toBe(10000);
    expect(s.stats.damage-before).toBe(10000);expect(s.meter).toBeGreaterThan(0);
    g.finish(-1,'test');expect(m.alive).toBe(false);
  });
  it('auto-fires from deployed platforms and respects concealment',()=>{
    const {g,s,t}=deploy();t.pos.set(1000,0,-1500);t.prevPos.copy(t.pos);t.renderPos.copy(t.pos);
    run(g,5);expect(g.shells.shells.some(p=>p.owner.summonOwner===s)).toBe(true);
    t.addEffect({id:'test-cloak',time:20,apply(m){m.untargetable=true;}});t.refreshModifiers();
    g.shells.shells=[];run(g,7);
    expect(g.shells.shells.some(p=>p.owner.summonOwner===s)).toBe(false);
  });
  it('cleans platforms on owner death, respawn, transformation and battle end',()=>{
    const {g,s,t}=deploy();const modules=s.architect!.slots.map(a=>a.entity).filter(Boolean);
    s.takeDamage(s.maxHp*10,t,null,false,true);expect(modules.every(m=>!m!.alive)).toBe(true);
    s.respawn(0,1500,0);expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
    s.control.aimX=800;s.control.aimZ=0;s.activateSkill(0);run(g,2);
    const more=s.architect!.slots.map(a=>a.entity).filter(Boolean);
    s.queueShift(SHIP_BY_ID.stepper,10,[6,7,8]);run(g,.1);
    expect(more.every(m=>!m!.alive)).toBe(true);
  });
});
describe('Architect normal skills',()=>{
  it('commands two fixed-damage shells per available module with a shared reload',()=>{
    const {g,s}=arena();expect(s.activateSkill(1)).toBe(true);
    expect(g.shells.shells).toHaveLength(20);
    expect(g.shells.shells.every(p=>p.spec.damage===20000&&p.skill?.id==='architectBurst')).toBe(true);
    expect(s.turrets.every(t=>t.reload===6)).toBe(true);
  });
  it('connects modules without multiplying damage where links overlap',()=>{
    const {g,s,t}=deploy();t.pos.set(800,0,0);t.heading=Math.PI/2;t.prevPos.copy(t.pos);
    expect(s.activateSkill(2)).toBe(true);run(g,.5);
    expect(t.stats.received).toBeCloseTo(6000);
    const slot=s.architect!.slots[0];slot.entity!.takeDamage(1e9,t,null,false,true);
    const before=t.stats.received;run(g,.5);expect(t.stats.received).toBe(before);
  });
  it('reconfigures into a safe ring and returns them with Recall',()=>{
    const {g,s,t}=deploy();t.pos.set(3000,0,-3000);s.control.aimX=0;s.control.aimZ=0;
    expect(s.activateSkill(3)).toBe(true);run(g,3);
    for(const a of s.architect!.slots.filter(a=>a.entity))expect(Math.hypot(a.entity!.pos.x,a.entity!.pos.z)).toBeCloseTo(900);
    expect(s.activateSkill(4)).toBe(true);run(g,3);
    expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
  });
  it('fortifies hull and deployed modules without additive shield stacking',()=>{
    const {s}=deploy();expect(s.activateSkill(5)).toBe(true);expect(s.shield).toBe(75000);
    expect(s.architect!.slots[0].entity!.shield).toBe(25000);
    s.skills[5].cooldown=0;s.skills[5].active=false;s.activateSkill(5);expect(s.shield).toBe(75000);
  });
});
describe('Architect ultimates',()=>{
  it('assembles all ten turrets and fires a 1.2M piercing shot at 3.5 seconds',()=>{
    const {g,s,t}=arena();s.control.aimX=0;s.control.aimZ=-1000;s.meter=1;
    expect(s.activateSkill(6)).toBe(true);expect(s.activateSkill(0)).toBe(false);
    run(g,3.45);expect(t.stats.received).toBe(0);
    run(g,.05);expect(t.stats.received).toBeCloseTo(1200000);
    run(g,.5);expect(s.architect!.ultimate).toBeNull();expect(s.architect!.slots.every(a=>a.state==='docked')).toBe(true);
  });
  it('locks aim in the last .4 seconds and blocks hull movement without granting immunity',()=>{
    const {g,s,t}=arena();s.control.aimX=0;s.control.aimZ=-1000;s.meter=1;s.activateSkill(6);
    const p=s.pos.clone();s.control.throttleSet=6;s.control.fire=true;
    run(g,3.1);s.control.aimX=3000;s.control.aimZ=1500;
    expect(s.takeDamage(10000,t)).toBeGreaterThan(0);
    run(g,.4);expect(t.stats.received).toBeCloseTo(1200000);expect(s.pos.distanceTo(p)).toBeCloseTo(0);
  });
  it('requires two available modules and preserves charge on invalid ultimates',()=>{
    const {g,s}=arena();s.meter=1;
    g.map.heightAt=()=>10;
    expect(s.activateSkill(7)).toBe(false);expect(s.skills[7].meter).toBe(1);
    for(const a of s.architect!.slots.slice(0,9)){a.state='destroyed';a.hp=0;a.rebuild=12;}
    expect(s.activateSkill(6)).toBe(false);expect(s.skills[6].meter).toBe(1);
  });
  it('fires eight Killbox waves for 960k total at its fixed center',()=>{
    const {g,s,t}=arena();s.control.aimX=0;s.control.aimZ=-1000;s.meter=1;
    expect(s.activateSkill(7)).toBe(true);run(g,9.5);
    expect(t.stats.received).toBeCloseTo(960000);expect(s.architect!.ultimate).toBeNull();
    expect(s.architect!.slots.every(a=>a.state==='deployed')).toBe(true);
  });
  it('raises Citadel above terrain, grants nonstacking protection and lands safely',()=>{
    const {g,s,t}=arena();s.meter=1;expect(s.activateSkill(8)).toBe(true);run(g,1.5);
    expect(s.architect!.slots.every(a=>a.entity!.pos.y>=150)).toBe(true);
    expect(s.shield).toBe(150000);
    s.shield=0;s.colossus=false;s.refreshModifiers();
    const before=s.hp;s.takeDamage(10000,t);expect(before-s.hp).toBeCloseTo(6000);
    run(g,12);
    expect(s.architect!.ultimate).toBeNull();
    expect(s.architect!.slots.every(a=>a.state==='docked'||a.state==='deployed'||a.state==='moving')).toBe(true);
  });
  it('hashes pending module state and replays deterministically',()=>{
    const play=()=>{const {g,s}=deploy();const h=stateHash(g);s.architect!.slots[0].hp--;expect(stateHash(g)).not.toBe(h);s.meter=1;s.activateSkill(8);run(g,3);return [stateHash(g),g.rng()];};
    expect(play()).toEqual(play());
  });
});

describe('Architect formation stability',()=>{
  it('holds a smoothly rotating airborne ring when the owner is stationary',()=>{
    const {g,s}=arena();s.meter=1;s.activateSkill(8);run(g,1.6);
    const positions=s.architect!.slots.map(a=>a.entity!.pos.clone());run(g,1/60);
    s.architect!.slots.forEach((a,i)=>expect(a.entity!.pos.distanceTo(positions[i])).toBeLessThan(5));
  });
});
it('rejects Connect with only one survivor without spending cooldown',()=>{
  const {s,t}=deploy();s.architect!.slots[0].entity!.takeDamage(1e9,t,null,false,true);
  expect(s.activateSkill(2)).toBe(false);expect(s.skills[2].cooldown).toBe(0);expect(s.architect!.links).toHaveLength(0);
});
it('prefers a valid owner lock even when an unlocked enemy is closer',()=>{
  const {g,s,t}=deploy();const m=s.architect!.slots[0].entity!;
  t.pos.set(m.pos.x,0,m.pos.z-4500);const near=place(g,'iowa',1,m.pos.x+300,m.pos.z);
  near.secondaries.length=0;near.throttle=2;near.speed=0;s.control.targetId=t.id;
  run(g,1/60);expect(m.control.aimX).toBe(t.pos.x);expect(m.control.aimZ).toBe(t.pos.z);
});
