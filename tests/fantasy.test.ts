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

describe('fantasy roster', () => {
  it('fields four realms, each with one ship per hangar tab', () => {
    const fantasy = SHIPS.filter((s) => eraOf(s) === 'fantasy');
    expect(fantasy.length).toBe(24);
    for (const nation of ['silverwood', 'deepforge', 'drowned', 'conclave']) {
      expect(fantasy.filter((s) => s.nation === nation && s.cls !== 'TT').length, nation).toBe(5);
    }
    // Every fantasy gun fires a spell, never a shell.
    for (const s of fantasy) expect(s.main?.look ?? 'starbolt', s.id).not.toBe('shell');
  });
});

describe('fantasy skills', () => {
  it('Boiler Bomb blows on contact: 60k all round, and the boat pays 30% of its hull', () => {
    const g = emptyGame();
    const me = place(g, 'sparkrunner', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 200, 0, 0);
    run(g, 0.1);
    const foeHp = foe.hp;
    expect(cast(me, 'boilerBomb')).toBe(true);
    run(g, 0.5);
    expect(me.skills[kitIndex(me, 'boilerBomb')].active).toBe(false);
    expect(foeHp - foe.hp).toBeGreaterThan(40000);
    expect(me.hp).toBeLessThan(me.maxHp * 0.75);
  });

  it('Unmaking banishes the target, which comes back missing 40% of its hull', () => {
    const g = emptyGame();
    const me = place(g, 'voidpearl', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 1500, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'unmaking', foe)).toBe(true);
    run(g, 1);
    expect(foe.mods.banished).toBe(true);
    run(g, 6);
    expect(foe.mods.banished).toBe(false);
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBeLessThan(foe.maxHp * 0.65);
  });

  it('Raise the Drowned brings up the wrecks nearby, and at least two galleons', () => {
    const g = emptyGame();
    const me = place(g, 'gravewake', 0, 0, 0, Math.PI / 2);
    const victim = place(g, 'fletcher', 1, 800, 600, 0);
    place(g, 'iowa', 1, 2500, 0, 0);
    victim.takeDamage(victim.hp + 1, me, null);
    run(g, 0.5);
    expect(victim.alive).toBe(false);
    const before = g.ships.length;
    expect(cast(me, 'raiseTheDrowned')).toBe(true);
    const risen = g.ships.slice(before);
    expect(risen.length).toBeGreaterThanOrEqual(2);
    for (const s of risen) {
      expect(s.team).toBe(me.team);
      expect(s.isSummon).toBe(true);
      expect(s.spec.id).toBe('skeletalGalleon');
    }
  });

  it('summons call up their hidden hulls on the caster\'s side', () => {
    const cases: [string, string, string, number][] = [
      ['tidesinger', 'callOfTheDeep', 'seaSerpent', 1],
      ['aspidochelone', 'treantGuard', 'treant', 2],
      ['naglfar', 'helsGate', 'skeletalGalleon', 6],
    ];
    for (const [ship, skill, spec, n] of cases) {
      const g = emptyGame();
      const me = place(g, ship, 0, 0, 0, Math.PI / 2);
      place(g, 'iowa', 1, 3000, 0, 0);
      run(g, 0.1);
      const before = g.ships.length;
      expect(cast(me, skill), skill).toBe(true);
      const called = g.ships.slice(before);
      expect(called.map((s) => s.spec.id), skill).toEqual(Array(n).fill(spec));
      expect(called.every((s) => s.team === me.team && s.isSummon)).toBe(true);
    }
  });

  it('Sanctuary Grove keeps an ally afloat through a killing blow', () => {
    const g = emptyGame();
    const me = place(g, 'silverbough', 0, 0, 0, Math.PI / 2);
    const ally = place(g, 'iowa', 0, 300, 0, 0);
    const foe = place(g, 'iowa', 1, 3000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'sanctuaryGrove')).toBe(true);
    // Fields take hold on their next tick.
    run(g, 0.6);
    ally.takeDamage(ally.hp * 3, foe, null);
    expect(ally.alive).toBe(true);
    expect(ally.hp).toBeGreaterThanOrEqual(1);
  });

  it('Rune of Warding swallows whole hits until its runes are spent', () => {
    const g = emptyGame();
    const me = place(g, 'anvilheart', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 3000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'runeWarding')).toBe(true);
    const hp = me.hp;
    for (let i = 0; i < 4; i++) me.takeDamage(20000, foe, null);
    expect(me.hp).toBe(hp);
    me.takeDamage(20000, foe, null);
    expect(me.hp).toBeLessThan(hp);
  });

  it('a homing missile that strikes a long hull at the bow does its full damage', () => {
    const g = emptyGame();
    const me = place(g, 'windrunner', 0, 0, 0, Math.PI / 2);
    // End-on to the arrows: they meet the bow, 130 m from the centre.
    const foe = place(g, 'iowa', 1, 1500, 0, -Math.PI / 2);
    run(g, 0.1);
    const hp = foe.hp;
    g.missiles.launch(me, foe.pos.x, foe.pos.z, 0, 4000, { profile: 'skim', uninterceptable: true, blast: 40, target: foe });
    run(g, 8);
    expect(hp - foe.hp).toBeGreaterThan(3900);
  });
});
