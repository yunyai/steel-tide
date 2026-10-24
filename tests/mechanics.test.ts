import { describe, expect, it } from 'vitest';
import type { MissileBatterySpec } from '../src/core/types';
import { FACTIONS } from '../src/data/factions';
import { SHIP_BY_ID } from '../src/data/ships';
import { banish, buff, disarm, fear, root, silence, swapPlaces } from '../src/skills/kit';
import { activateConsumable } from '../src/ships/Consumables';
import type { Ship } from '../src/ships/Ship';
import { emptyGame, place, run } from './helpers';

const VLS: MissileBatterySpec = { name: 'Test cells', salvo: 4, reload: 20, damage: 5000, range: 6000, profile: 'cruise' };

describe('crowd control', () => {
  it('a silenced ship cannot use skills until it wears off', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0);
    silence(w, 2);
    run(g, 0.1);
    expect(w.activateSkill(0)).toBe(false);
    run(g, 2);
    expect(w.activateSkill(0)).toBe(true);
  });

  it('a disarmed ship sails on but its guns stay silent', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0, Math.PI / 2);
    place(g, 'iowa', 1, 6000, 0, -Math.PI / 2);
    w.throttle = 4;
    w.control.aimX = 6000;
    w.control.aimZ = 0;
    run(g, 5);
    disarm(w, 4);
    const fired = w.stats.shotsFired;
    w.control.fire = true;
    run(g, 3);
    expect(w.stats.shotsFired).toBe(fired);
    expect(w.speed).toBeGreaterThan(1);
  });

  it('a rooted ship stops dead; a feared one runs from the source', () => {
    const g = emptyGame();
    const a = place(g, 'fletcher', 0, 0, 0, Math.PI / 2);
    const b = place(g, 'fletcher', 0, 0, 3000, Math.PI / 2);
    a.throttle = 4;
    run(g, 6);
    root(a, 3);
    run(g, 0.1);
    expect(a.speed).toBe(0);
    const x = a.pos.x;
    run(g, 2);
    expect(a.pos.x).toBeCloseTo(x, 0);
    // Fear: the source lies 1 km toward -z of b, so b turns to +z and goes to full speed.
    fear(b, 0, 2000, 10);
    run(g, 10);
    expect(b.speed).toBeGreaterThan(5);
    expect(b.pos.z).toBeGreaterThan(3000);
  });

  it('a banished ship is out of the fight: no damage, no lock, no movement', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    banish(foe, 3);
    run(g, 0.1);
    expect(foe.takeDamage(20000, me)).toBe(0);
    expect(me.lockAt(2000, 0, 500)).toBeNull();
    expect(foe.mods.stunned).toBe(true);
    run(g, 3.2);
    expect(foe.mods.banished).toBe(false);
    expect(foe.takeDamage(1000, me)).toBeGreaterThan(0);
  });

  it('titans shake control off faster', () => {
    const g = emptyGame();
    const t = place(g, 'leviathan', 0, 0, 0);
    silence(t, 5);
    run(g, 2.1);
    expect(t.mods.silenced).toBe(false);
  });

  it('the repair kit cleanses debuffs', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0);
    silence(w, 10);
    root(w, 10);
    run(g, 0.1);
    w.hp *= 0.5;
    activateConsumable(w, 0);
    run(g, 0.1);
    expect(w.mods.silenced).toBe(false);
    expect(w.mods.rooted).toBe(false);
  });
});

describe('survival', () => {
  it('an undying hull floors at 1 HP', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    buff(foe, 'undying', 5, (m) => {
      m.undying = true;
    });
    run(g, 0.1);
    foe.takeDamage(foe.hp * 5, me);
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBeCloseTo(1, 0);
  });

  it('a hit guard swallows its hits whole, then lets the rest through', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'warspite', 1, 2000, 0);
    let blocked = 0;
    foe.guard = { left: 2, min: 100, until: g.time + 10, skill: null, onBlock: () => blocked++ };
    const hp = foe.hp;
    foe.takeDamage(10000, me);
    foe.takeDamage(10000, me);
    expect(foe.hp).toBe(hp);
    expect(blocked).toBe(2);
    foe.takeDamage(10000, me);
    expect(foe.hp).toBeLessThan(hp);
    expect(foe.guard).toBeNull();
  });

  it('a last stand cancels one sinking', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    foe.lastStand = { until: g.time + 20, hpFrac: 0.5, skill: SHIP_BY_ID.iowa.skills[0] };
    foe.takeDamage(foe.hp + 10, me);
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBeCloseTo(foe.maxHp * 0.5);
    run(g, 2.5);
    foe.takeDamage(foe.hp + 10, me);
    expect(foe.alive).toBe(false);
  });

  it('a sunk ship can be raised again where its wreck lies', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    me.takeDamage(me.hp + 10, foe);
    expect(me.alive).toBe(false);
    g.revive(me, 100, 100, 0.5);
    expect(me.alive).toBe(true);
    expect(me.hp).toBeCloseTo(me.maxHp * 0.5);
    run(g, 1);
    expect(g.ships).toContain(me);
  });

  it('a rewind restores pose, hull and cooldowns from seconds ago', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'fletcher', 1, 6000, 0);
    w.throttle = 4;
    run(g, 8);
    const x = w.pos.x;
    const hp = w.hp;
    run(g, 4);
    w.takeDamage(30000, foe);
    w.activateSkill(0);
    expect(w.skills[0].cooldown).toBeGreaterThan(5);
    expect(w.rewind(4)).toBe(true);
    expect(w.pos.x).toBeCloseTo(x, -1);
    expect(w.hp).toBeCloseTo(hp, -2);
  });

  it('two ships can trade places', () => {
    const g = emptyGame();
    const a = place(g, 'fletcher', 0, 0, 0);
    const b = place(g, 'fletcher', 1, 1500, 400);
    swapPlaces(a, b, g);
    expect([a.pos.x, a.pos.z]).toEqual([1500, 400]);
    expect([b.pos.x, b.pos.z]).toEqual([0, 0]);
  });
});

describe('fields', () => {
  it('a time warp slows enemy torpedoes passing through it', () => {
    const speedThrough = (warp: boolean): number => {
      const g = emptyGame();
      const me = place(g, 'warspite', 0, 0, 0);
      const foe = place(g, 'fletcher', 1, -3000, 0);
      if (warp) g.fields.add(me, { x: -1500, z: 0, r: 700, life: 10, timeScale: 0.2, look: 'time' });
      const t = g.torps.launch(foe, -2200, 0, Math.PI / 2, SHIP_BY_ID.fletcher.torpedoes!);
      run(g, 4);
      return t.travelled;
    };
    expect(speedThrough(true)).toBeLessThan(speedThrough(false) * 0.6);
  });

  it('a cage holds an enemy hull inside', () => {
    const g = emptyGame();
    const me = place(g, 'warspite', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 1000, 0, Math.PI / 2);
    g.fields.add(me, { x: 1000, z: 0, r: 500, life: 12, cage: true, look: 'storm' });
    foe.throttle = 4;
    run(g, 12);
    expect(Math.hypot(foe.pos.x - 1000, foe.pos.z)).toBeLessThan(520);
  });

  it('a damage field hurts enemies and heals allies', () => {
    const g = emptyGame();
    const me = place(g, 'warspite', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 200, 0);
    const foe = place(g, 'fletcher', 1, -200, 0);
    ally.hp *= 0.5;
    const ah = ally.hp;
    const fh = foe.hp;
    g.fields.add(me, { x: 0, z: 0, r: 600, life: 4, dps: 2000, heal: 0.02 });
    run(g, 4);
    expect(foe.hp).toBeLessThan(fh - 5000);
    expect(ally.hp).toBeGreaterThan(ah);
  });

  it('a tripwire goes off once on each enemy that crosses it', () => {
    const g = emptyGame();
    const me = place(g, 'warspite', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 1000, -300, Math.PI);
    const hits: Ship[] = [];
    g.fields.addWire(me, 0, 0, 2000, 0, 20, (s) => hits.push(s));
    foe.throttle = 4;
    run(g, 20);
    expect(hits).toEqual([foe]);
  });
});

describe('weapons', () => {
  it('a VLS salvo flies to its target and AA can thin it out', () => {
    const salvo = (aa: number): number => {
      const g = emptyGame();
      const me = g.addShip({ ...SHIP_BY_ID.fletcher, missiles: VLS }, 0, 'cells', 0, 0, Math.PI / 2);
      me.humanIndex = 0;
      const foe = place(g, 'atlanta', 1, 4000, 0);
      buff(foe, 'aa', 30, (m) => {
        m.aaMul *= aa;
      });
      run(g, 0.1);
      const hp = foe.hp;
      expect(me.fireVls(4, foe, null)).toHaveLength(4);
      run(g, 20);
      return hp - foe.hp;
    };
    const open = salvo(0);
    expect(open).toBeGreaterThan(10000);
    expect(salvo(30)).toBeLessThan(open);
  });

  it('the VLS slot fires at the ship under the reticle', () => {
    const g = emptyGame();
    const me = g.addShip({ ...SHIP_BY_ID.fletcher, missiles: VLS }, 0, 'cells', 0, 0, Math.PI / 2);
    me.humanIndex = 0;
    const foe = place(g, 'fletcher', 1, 3000, 0);
    const slot = me.slots.findIndex((s) => s.kind === 'vls');
    expect(slot).toBeGreaterThanOrEqual(0);
    me.control.slot = slot;
    me.control.aimX = 3050;
    me.control.aimZ = 0;
    run(g, 0.2);
    expect(me.vls!.lock).toBe(foe);
    me.control.fire = true;
    run(g, 0.2);
    me.control.fire = false;
    expect(g.missiles.missiles.filter((m) => m.alive).length).toBe(4);
    expect(me.vls!.reload).toBeGreaterThan(15);
  });

  it('a wire-guided torpedo turns to follow the reticle', () => {
    const g = emptyGame();
    const me = place(g, 'fletcher', 0, 0, 0, Math.PI / 2);
    const t = g.torps.launch(me, 0, 0, Math.PI / 2, SHIP_BY_ID.fletcher.torpedoes!);
    t.wire = true;
    me.control.aimX = 0;
    me.control.aimZ = 3000;
    run(g, 6);
    expect(t.z).toBeGreaterThan(150);
  });

  it('a wakeless torpedo stays unseen until close', () => {
    const seenAt = (wakeless: boolean): boolean => {
      const g = emptyGame();
      const me = place(g, 'fletcher', 0, 0, 0, Math.PI / 2);
      place(g, 'iowa', 1, 2000, 0);
      const t = g.torps.launch(me, 1200, 0, Math.PI / 2, { ...SHIP_BY_ID.fletcher.torpedoes!, detect: 1200 });
      t.travelled = 200;
      t.wakeless = wakeless;
      run(g, 0.1);
      return t.seen;
    };
    expect(seenAt(false)).toBe(true);
    expect(seenAt(true)).toBe(false);
  });

  it('a splitting torpedo forks into a fan near an enemy', () => {
    const g = emptyGame();
    const me = place(g, 'fletcher', 0, 0, 0, Math.PI / 2);
    place(g, 'iowa', 1, 1500, 0);
    const t = g.torps.launch(me, 1000, 0, Math.PI / 2, SHIP_BY_ID.fletcher.torpedoes!);
    t.travelled = 200;
    t.split = 3;
    run(g, 2);
    expect(t.alive).toBe(false);
    expect(g.torps.torps.filter((x) => x !== t && x.damage < t.damage * 0.7).length).toBe(3);
  });

  it('a search bubble breaks cloaks', () => {
    const g = emptyGame();
    const s = place(g, 'stalingrad', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    buff(foe, 'cloak', 20, (m) => {
      m.untargetable = true;
    });
    run(g, 0.1);
    expect(foe.mods.untargetable).toBe(true);
    const i = s.consumables.findIndex((c) => c.spec.type === 'search');
    expect(activateConsumable(s, i)).toBe(true);
    run(g, 0.5);
    expect(foe.mods.untargetable).toBe(false);
    expect(s.lockAt(2000, 0, 400)).toBe(foe);
  });
});

describe('faction traits', () => {
  it('apply through the modifiers every tick', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0);
    (w as { trait: unknown }).trait = { name: 'Test', description: '', damageMul: 1.2, damageTakenMul: 0.85 };
    run(g, 0.1);
    expect(w.mods.damageMul).toBeCloseTo(1.2);
    expect(w.mods.damageTakenMul).toBeCloseTo(0.85);
  });

  it('every non-historic faction carries a trait, and historic navies none', () => {
    for (const f of Object.values(FACTIONS)) {
      if (f.era === 'historic') expect(f.trait, f.id).toBeUndefined();
      else expect(f.trait?.name, f.id).toBeTruthy();
    }
  });
});
