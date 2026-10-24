import { describe, expect, it } from 'vitest';
import { eraOf } from '../src/data/factions';
import { SHIPS } from '../src/data/ships';
import type { Ship } from '../src/ships/Ship';
import { emptyGame, place, run } from './helpers';

const kitIndex = (s: Ship, id: string) => s.skills.findIndex((k) => k.spec.id === id);

/** Cast a ship's skill by id, with the reticle on `at`. */
function cast(s: Ship, id: string, at?: Ship): boolean {
  if (at) {
    s.control.aimX = at.pos.x;
    s.control.aimZ = at.pos.z;
  }
  s.meter = 1;
  return s.activateSkill(kitIndex(s, id));
}

const summonsOf = (g: ReturnType<typeof emptyGame>, owner: Ship, specId: string) => g.ships.filter((s) => s.alive && s.isSummon && s.team === owner.team && s.spec.id === specId);

describe('modern roster', () => {
  it('fields four navies, each with one ship per hangar tab, and most of them carry cells', () => {
    const modern = SHIPS.filter((s) => eraOf(s) === 'modern');
    expect(modern.length).toBe(24);
    for (const nation of ['us_mod', 'ru_mod', 'cn_mod', 'uk_mod']) {
      expect(modern.filter((s) => s.nation === nation && s.cls !== 'TT').length, nation).toBe(5);
    }
    for (const s of modern) expect(s.main?.look ?? 'shell', s.id).toBe('shell');
    expect(modern.filter((s) => s.missiles).length).toBeGreaterThanOrEqual(14);
  });
});

describe('modern skills', () => {
  it('Ripple Fire reloads the cells and doubles the next salvo', () => {
    const g = emptyGame();
    const me = place(g, 'arsenal', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 3000, 0, 0);
    run(g, 0.1);
    me.vls!.reload = 20;
    expect(cast(me, 'rippleFire', foe)).toBe(true);
    me.control.slot = me.slots.findIndex((sl) => sl.kind === 'vls');
    me.control.fire = true;
    run(g, 0.2);
    const salvo = me.spec.missiles!.salvo;
    expect(g.missiles.missiles.filter((m) => m.owner === me).length).toBe(salvo * 2);
  });

  it('Tumblehome drops every lock on the Zumwalt and widens the guns aimed at it', () => {
    const g = emptyGame();
    const me = place(g, 'zumwalt', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'burke', 1, 4000, 0, -Math.PI / 2);
    run(g, 0.1);
    g.missiles.launch(foe, me.pos.x, me.pos.z, 0, 5000, { profile: 'cruise', target: me });
    expect(cast(me, 'stealthProfile')).toBe(true);
    run(g, 0.1);
    expect(g.missiles.missiles.some((m) => m.alive && m.target === me)).toBe(false);
    expect(me.mods.scatterTakenMul).toBeGreaterThan(1);
    expect(me.mods.lockRange).toBeGreaterThan(0);
  });

  it('Poseidon runs to the mark and goes off: a nuclear blast that guts a battleship', () => {
    const g = emptyGame();
    const me = place(g, 'belgorod', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 2000, 0, 0);
    run(g, 0.1);
    const hp = foe.hp;
    expect(cast(me, 'poseidon', foe)).toBe(true);
    run(g, 10);
    expect(hp - foe.hp).toBeGreaterThan(80000);
  });

  it('Carrier Killer hits a big hull for 85k, nothing intercepts it', () => {
    const g = emptyGame();
    const me = place(g, 'nanchang', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 4000, 0, 0);
    const guard = place(g, 'daring', 1, 3700, 200, 0);
    run(g, 0.1);
    const hp = foe.hp;
    expect(cast(me, 'carrierKiller', foe)).toBe(true);
    // The Daring throws up Sea Viper over the battleship the whole way in.
    guard.meter = 1;
    guard.activateSkill(kitIndex(guard, 'seaViper'));
    run(g, 8);
    expect(hp - foe.hp).toBeGreaterThan(80000);
  });

  it('summoning ultimates call up their hidden and line hulls on the caster\'s side', () => {
    const g = emptyGame();
    const sov = place(g, 'sovremenny', 0, 0, 0);
    const qe = place(g, 'queenElizabeth', 0, 1500, 0);
    const mt = place(g, 'montana', 0, -2500, 0);
    place(g, 'iowa', 1, 0, 3500, Math.PI);
    run(g, 0.1);
    expect(cast(sov, 'mosquitoFleet')).toBe(true);
    expect(cast(qe, 'carrierStrikeGroup')).toBe(true);
    expect(cast(mt, 'battleGroup')).toBe(true);
    run(g, 0.2);
    expect(summonsOf(g, sov, 'tarantul').length).toBe(6);
    expect(summonsOf(g, qe, 'daring').length).toBe(1);
    expect(summonsOf(g, qe, 'glasgow').length).toBe(1);
    expect(summonsOf(g, mt, 'ford').length).toBe(1);
    expect(summonsOf(g, mt, 'burke').length).toBe(2);
  });

  it('Sonar 2087 drives a deep submarine up to periscope depth and marks it', () => {
    const g = emptyGame();
    const me = place(g, 'glasgow', 0, 0, 0);
    const sub = place(g, 'virginia', 1, 1500, 0);
    sub.depthState = 2;
    run(g, 6);
    expect(sub.deep).toBe(true);
    expect(cast(me, 'sonar2087')).toBe(true);
    run(g, 0.5);
    expect(sub.depthState).toBeLessThanOrEqual(1);
    expect(sub.mods.marked).toBe(true);
  });

  it('Sky Cracker lifts the Lun out of reach, then slams it down on the reticle', () => {
    const g = emptyGame();
    const me = place(g, 'lun', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 1600, 0, 0);
    run(g, 0.1);
    const hp = foe.hp;
    expect(cast(me, 'skyCracker', foe)).toBe(true);
    run(g, 0.5);
    expect(me.mods.invulnerable).toBe(true);
    run(g, 2);
    expect(me.pos.x).toBeGreaterThan(1000);
    expect(hp - foe.hp).toBeGreaterThan(60000);
  });

  it('Silent Service: British hulls take less from missiles and torpedoes', () => {
    const g = emptyGame();
    const uk = place(g, 'glasgow', 0, 0, 0);
    const us = place(g, 'burke', 0, 0, 1500);
    run(g, 0.1);
    expect(uk.mods.missileTakenMul).toBeLessThan(1);
    expect(uk.mods.torpTakenMul).toBeLessThan(1);
    expect(us.mods.missileTakenMul).toBe(1);
  });
});
