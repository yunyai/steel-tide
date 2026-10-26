import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { safeStep } from '../src/skills/misc/StepperRuntime';
import { forwardX, forwardZ } from '../src/core/math';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';

function arena() {
  const g = emptyGame('open', 713, 'freeplay');
  const s = place(g, 'stepper', 0, 0, 1500);
  const t = place(g, 'leviathan', 1, 0, 0);
  for (const ship of [s, t]) {
    ship.throttle = 2; ship.speed = 0; ship.secondaries.length = 0;
  }
  t.colossus = false;
  t.hp = t.maxHp = 10000000;
  s.control.aimX = s.control.aimZ = 0;
  s.meter = 1;
  return { g, s, t };
}

describe('Cross-step', () => {
  it('replaces Explosion-step with sixty 6k area cuts and a 150k finisher', () => {
    const { g, s, t } = arena();
    const hits: number[] = [];
    g.events.on('skillHit', e => { if (e.skill.id === 'crossStep') hits.push(e.damage); });
    expect(s.skills[7].spec.name).toBe('Cross-step');
    expect(s.activateSkill(7)).toBe(true);
    expect(t.stats.received).toBe(0);
    run(g, 1.5);
    expect(hits).toHaveLength(30);
    expect(t.stats.received).toBe(180000);
    run(g, 1.5);
    expect(hits.slice(0, 60)).toEqual(Array(60).fill(6000));
    expect(hits[60]).toBe(150000);
    expect(t.stats.received).toBe(510000);
    expect(s.stepper?.cross).toBeNull();
    expect(s.skills[7].active).toBe(false);
  });
  it('keeps a fixed zone, checks positions per cut, excludes allies and deep subs', () => {
    const { g, s, t } = arena();
    const ally = place(g, 'iowa', 0, 500, 0);
    const sub = place(g, 'gato', 1, -500, 0);
    ally.secondaries.length = 0;
    sub.depthState = 2; sub.pos.y = -30;
    s.activateSkill(7);
    s.control.aimX = 3000;
    run(g, 0.5);
    expect(t.stats.received).toBe(60000);
    t.pos.x = 1100;
    run(g, 0.5);
    expect(t.stats.received).toBe(60000);
    t.pos.x = 0;
    run(g, 2);
    expect(t.stats.received).toBe(450000);
    expect(ally.stats.received).toBe(0);
    expect(sub.stats.received).toBe(0);
  });
  it('jumps around safe perimeter points facing tangent and blocks other actions', () => {
    const { g, s, t } = arena();
    const points: { x:number; z:number; heading:number }[] = [];
    g.events.on('blink', e => { if (e.ship === s) points.push({ x:s.pos.x, z:s.pos.z, heading:s.heading }); });
    s.activateSkill(7);
    expect(s.takeDamage(10000, t)).toBe(0);
    expect(s.activateSkill(0)).toBe(false);
    s.control.fire = true; s.control.throttleUp = true;
    run(g, 2.95);
    expect(points).toHaveLength(10);
    expect(new Set(points.map(p => `${p.x.toFixed(0)},${p.z.toFixed(0)}`)).size).toBeGreaterThan(4);
    for (const p of points) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(1000);
      expect(p.x * forwardX(p.heading) + p.z * forwardZ(p.heading)).toBeCloseTo(0);
      expect(safeStep(s, p.x, p.z, p.heading)).toBe(true);
    }
    expect(g.shells.shells.filter(p => p.owner === s)).toHaveLength(0);
    expect(g.torps.torps.filter(p => p.owner === s)).toHaveLength(0);
    run(g, 0.05);
    expect(Math.hypot(s.pos.x, s.pos.z)).toBeLessThan(1000);
    expect(safeStep(s, s.pos.x, s.pos.z, s.heading)).toBe(true);
  });
  it('preserves charge on impossible landings and remains safe if the map changes', () => {
    const { g, s, t } = arena();
    const water = g.map.heightAt;
    g.map.heightAt = () => 10;
    expect(s.activateSkill(7)).toBe(false);
    expect(s.skills[7].meter).toBe(1);
    expect(s.skillFailure).toMatch(/safe|water|blocked/i);
    g.map.heightAt = water;
    expect(s.activateSkill(7)).toBe(true);
    const p = s.pos.clone();
    g.map.heightAt = () => 10;
    run(g, 3);
    expect(t.stats.received).toBe(510000);
    expect(s.pos.x).toBeCloseTo(p.x);
    expect(s.pos.z).toBeCloseTo(p.z);
    expect(s.stepper?.cross).toBeNull();
  });
  it('mirrors the same zone at 75% per copy with no recursive summons', () => {
    const { g, s, t } = arena();
    expect(s.activateSkill(8)).toBe(true);
    expect(s.activateSkill(7)).toBe(true);
    const copies = g.ships.filter(c => c.summonOwner === s);
    expect(copies).toHaveLength(4);
    expect(copies.every(c => c.stepper?.cross?.x === 0 && c.stepper.cross.z === 0)).toBe(true);
    run(g, 3);
    expect(t.stats.received).toBeCloseTo(510000 * 4);
    expect(copies.every(c => !c.stepper?.cross)).toBe(true);
  });
  it('mirrors the owner resolved zone when only the owner has a reach buff', () => {
    const { g, s } = arena();
    s.addEffect({ id:'satellite-range', time:10, apply(m) { m.reachMul = 1.3; } });
    s.refreshModifiers();
    s.control.aimZ = -2800;
    s.activateSkill(8);
    expect(s.activateSkill(7)).toBe(true);
    expect(s.stepper!.cross!.z).toBe(-2800);
    const copies = g.ships.filter(c => c.summonOwner === s);
    expect(copies.every(c => c.stepper?.cross?.z === s.stepper!.cross!.z)).toBe(true);
  });
  it('suppresses aircraft AA and missile interception immediately during the sequence', () => {
    const { g, s } = arena();
    const carrier = place(g, 'akagi', 1, 3500, 3000);
    s.activateSkill(7);
    const sq = g.air.launch(carrier, 'fighter', s.pos.x, s.pos.z)!;
    sq.x = s.pos.x + 200; sq.z = s.pos.z; sq.y = 300; sq.state = 'patrol';
    const hp = sq.planeHp;
    g.air.update(1/60);
    expect(sq.planeHp).toBe(hp);
    const missile = g.missiles.launch(carrier, s.pos.x + 3000, s.pos.z, 0, 100, { from:{x:s.pos.x + 200,y:200,z:s.pos.z} });
    const missileHp = missile.hp;
    g.missiles.update(1/60);
    expect(missile.hp).toBe(missileHp);
    // AA resumes once the sequence finishes.
    run(g, 3);
    sq.x=s.pos.x+200; sq.z=s.pos.z;
    g.air.update(1/60);
    expect(sq.planeHp).toBeLessThan(hp);
  });
  it('consumes locked control edges without changing helm, weapons or consumable charges', () => {
    const { g, s } = arena();
    s.activateSkill(7);
    const search = s.consumables.findIndex(c => c.spec.type === 'search');
    const charges = s.consumables[search].charges;
    s.control.throttleSet=5;s.control.rudder=1;s.control.slot=2;s.control.consumable=search;s.control.skill=0;
    run(g, 0.1);
    expect(s.throttle).toBe(2);expect(s.rudderTarget).toBe(0);expect(s.slot).toBe(0);
    expect(s.consumables[search].active).toBe(0);expect(s.consumables[search].charges).toBe(charges);
    expect(s.control.slot).toBeNull();expect(s.control.skill).toBe(-1);expect(s.control.consumable).toBe(-1);
    s.control.rudder=0;
    run(g, 3);
    expect(s.throttle).toBe(2);expect(s.slot).toBe(0);expect(s.consumables[search].active).toBe(0);
  });
  it('clears sequence and protection on death', () => {
    const { g, s, t } = arena();
    s.activateSkill(7);
    s.takeDamage(s.maxHp * 100, t, null, false, true);
    run(g, 0.1);
    expect(s.stepper?.cross).toBeNull();
    expect(t.stats.received).toBe(0);
    expect(s.stepper?.phaseUntil ?? 0).toBe(0);
  });
  it('ends the choreography and phase effect when transformed', () => {
    const { g, s, t } = arena();
    s.activateSkill(7);
    expect(s.queueShift(SHIP_BY_ID.leviathan, 10, [6,7,8])).toBe(true);
    run(g, 0.1);
    expect(s.stepper?.cross).toBeNull();
    expect(s.effects.some(e => e.id === 'crossStep:phase')).toBe(false);
    expect(t.stats.received).toBe(0);
  });
  it('includes pending sequence state in hashes and replays seeded random steps', () => {
    const play = () => {
      const { g, s } = arena();
      s.activateSkill(7);
      run(g, 1);
      const h = stateHash(g);
      s.stepper!.cross!.count++;
      expect(stateHash(g)).not.toBe(h);
      s.stepper!.cross!.count--;
      run(g, 2);
      return [stateHash(g), g.rng()];
    };
    expect(play()).toEqual(play());
  });
});

describe('Backstep repair', () => {
  it('heals 20% immediately then repairs 20% over eight seconds', () => {
    const { g, s } = arena();
    s.hp = s.maxHp * 0.3;
    s.addEffect({ id:'no-passive-regen', time:20, apply(m) { m.regenMul = 0; } });
    expect(s.activateSkill(4)).toBe(true);
    expect(s.hp).toBeCloseTo(s.maxHp * 0.5);
    run(g, 4);
    expect(s.hp).toBeCloseTo(s.maxHp * 0.6);
    run(g, 4);
    expect(s.hp).toBeCloseTo(s.maxHp * 0.7);
    expect(s.stepper?.repair).toBeNull();
  });
  it('permanently cancels remaining repair on positive hull damage including periodic damage', () => {
    const { g, s, t } = arena();
    s.hp = s.maxHp * 0.3;
    s.addEffect({ id:'no-passive-regen', time:20, apply(m) { m.regenMul = 0; } });
    s.activateSkill(4);
    run(g, 2.1);
    s.takeDamage(1000, t, null, false, false, true);
    const hp = s.hp;
    run(g, 6);
    expect(s.hp).toBe(hp);
    expect(s.stepper?.repair).toBeNull();
    expect(s.stepper?.repairInterruptedUntil ?? 0).toBeGreaterThan(0);
  });
  it('clears repair on death, respawn and transformation without a delayed heal', () => {
    const { g, s, t } = arena();
    s.hp=s.maxHp*0.3;s.activateSkill(4);
    s.takeDamage(s.maxHp*10,t,null,false,true);
    expect(s.stepper?.repair).toBeNull();
    s.respawn(0,1500,0);s.hp=s.maxHp*0.3;
    s.addEffect({id:'no-passive',time:20,apply(m){m.regenMul=0;}});
    const hp=s.hp;run(g,1);
    expect(s.hp).toBe(hp);
    s.skills[4].cooldown=0;s.activateSkill(4);
    s.queueShift(SHIP_BY_ID.leviathan,10,[6,7,8]);run(g,0.1);
    expect(s.stepper?.repair).toBeNull();
  });
  it('keeps repair through blocked hits and shield absorption, and respects heal block', () => {
    const { g, s, t } = arena();
    s.hp = s.maxHp * 0.3;
    s.addEffect({ id:'no-passive-regen', time:20, apply(m) { m.regenMul = 0; } });
    s.activateSkill(4);
    expect(s.takeDamage(1000, t)).toBe(0);
    run(g, 2.1);
    s.shield = s.shieldMax = 100000; s.shieldTime = 20;
    expect(s.takeDamage(1000, t)).toBe(0);
    expect(s.stepper?.repair).not.toBeNull();
    s.addEffect({ id:'heal-block', time:2, apply(m) { m.healBlock = true; } });
    const before = s.hp;
    run(g, 1);
    expect(s.hp).toBe(before);
    run(g, 1.5);
    expect(s.hp).toBeGreaterThan(before);
  });
});
