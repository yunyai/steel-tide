import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID } from '../src/data/ships';
import { DEFAULT_BINDINGS, layoutFor } from '../src/input/Keybinds';
import { emptyGame, place, run } from './helpers';

describe('the Hadal', () => {
  it('is a titan submarine with drone wings, torpedoes and no guns', () => {
    const s = SHIP_BY_ID.hadal;
    expect(s.cls).toBe('TT');
    expect(s.sub).toBeDefined();
    expect(s.air).toBeDefined();
    expect(s.torpedoes).toBeDefined();
    expect(s.main).toBeUndefined();
    expect(s.skills.length).toBe(9);
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    expect(me.isSub).toBe(true);
  });

  it('dives deep, and depth charges still find it there', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    const dd = place(g, 'fletcher', 1, 0, 0, Math.PI);
    me.depthState = 2;
    run(g, 12);
    expect(me.deep).toBe(true);
    expect(me.submerged).toBe(true);
    const hp = me.hp;
    g.depth.drop(dd);
    run(g, 5);
    expect(me.hp).toBeLessThan(hp);
  });

  it('launches its drone wings only when not deep', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    place(g, 'iowa', 1, 6000, 0);
    run(g, 0.1);
    const air = me.slots.findIndex((sl) => sl.kind === 'air');
    expect(air).toBeGreaterThanOrEqual(0);
    me.slot = air;
    me.depthState = 2;
    run(g, 12);
    expect(me.deep).toBe(true);
    me.control.aimX = 6000;
    me.control.aimZ = 0;
    me.control.fire = true;
    run(g, 0.5);
    expect(g.air.squadrons.filter((q) => q.owner === me).length).toBe(0);
    me.control.fire = false;
    me.depthState = 1;
    run(g, 12);
    expect(me.deep).toBe(false);
    me.control.fire = true;
    run(g, 0.5);
    expect(g.air.squadrons.filter((q) => q.owner === me).length).toBeGreaterThan(0);
  });

  it('Drone Wing launches straight from the deep', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 6000, 0);
    me.depthState = 2;
    run(g, 12);
    expect(me.deep).toBe(true);
    me.control.aimX = foe.pos.x;
    me.control.aimZ = foe.pos.z;
    expect(me.activateSkill(me.skills.findIndex((k) => k.spec.id === 'droneWing'))).toBe(true);
  });

  it('Abyssal Veil refills the oxygen and holds it', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    me.depthState = 2;
    run(g, 20);
    const full = me.spec.sub!.battery;
    expect(me.battery).toBeLessThan(full);
    expect(me.activateSkill(me.skills.findIndex((k) => k.spec.id === 'abyssalVeil'))).toBe(true);
    expect(me.battery).toBe(full);
    run(g, 6);
    expect(me.battery).toBe(full);
    expect(me.deep).toBe(true);
  });

  it('Breach surfaces at once', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    place(g, 'iowa', 1, 600, 0);
    me.depthState = 2;
    run(g, 12);
    expect(me.deep).toBe(true);
    expect(me.activateSkill(me.skills.findIndex((k) => k.spec.id === 'breach'))).toBe(true);
    expect(me.pos.y).toBe(0);
    expect(me.depthState).toBe(0);
    expect(me.submerged).toBe(false);
  });

  it('the titan layout gives a titan submarine its own dive keys, clear of its skills', () => {
    const t = layoutFor(SHIP_BY_ID.hadal, DEFAULT_BINDINGS);
    expect(t.skills.length).toBe(9);
    expect(t.diveUp).toBe('KeyY');
    expect(t.diveDown).toBe('KeyH');
    expect(t.skills).not.toContain(t.diveUp);
    expect(t.skills).not.toContain(t.diveDown);
    // Other titans never dive.
    const leviathan = layoutFor(SHIP_BY_ID.leviathan, DEFAULT_BINDINGS);
    expect(leviathan.diveUp).toBe('');
    expect(leviathan.diveDown).toBe('');
  });
});
