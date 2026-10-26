import { describe, expect, it } from 'vitest';
import * as targeting from '../src/core/Targeting';
import { PlayerController } from '../src/player/PlayerController';
import { nearestEnemy } from '../src/skills/kit';
import { aiWantsSkill } from '../src/skills/registry';
import { dropLocks } from '../src/skills/modern/common';
import { stateHash } from '../src/net/hash';
import * as visibility from '../src/render/Visibility';
import { emptyGame, place, run } from './helpers';

const { canTrack, contactVisible, revealedTo } = targeting;

describe('surface proximity detection', () => {
  it.each(['smoke', 'cloak', 'lock restriction'] as const)('overrides %s at the inclusive 500m boundary, then expires immediately', kind => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const foe = place(g, 'zumwalt', 1, 0, -500);
    if (kind === 'smoke') g.smokes.push({ x: 0, z: -500, r: 300, life: 30, team: 1 });
    if (kind === 'cloak') foe.mods.untargetable = true;
    if (kind === 'lock restriction') foe.mods.lockRange = 1;
    for (const d of [499, 500]) {
      foe.pos.z = -d;
      expect(contactVisible(foe, 0)).toBe(true);
      expect(canTrack(me, foe)).toBe(true);
      expect(me.lockAt(0, -d, 100)).toBe(foe);
      expect(nearestEnemy(me, g, 1000)).toBe(foe);
    }
    foe.pos.z = -501;
    expect(canTrack(me, foe)).toBe(false);
  });

  it('shares a nearby ally’s detection but excludes sunk, banished, and withdrawn spotters', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'zumwalt', 1, 0, -2000);
    foe.mods.untargetable = true;
    foe.mods.lockRange = 1;
    const scout = place(g, 'gato', 0, 0, -1500);
    expect(canTrack(me, foe)).toBe(true);
    scout.mods.banished = true;
    expect(canTrack(me, foe)).toBe(false);
    scout.mods.banished = false;
    scout.withdrawn = true;
    expect(canTrack(me, foe)).toBe(false);
    scout.withdrawn = false;
    scout.alive = false;
    expect(canTrack(me, foe)).toBe(false);
  });

  it('guarantees ordinary nearby contacts without imposing a distant visibility cutoff', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 0, -1500);
    for (const d of [1499, 1500]) {
      foe.pos.z = -d;
      expect(targeting.proximityContact?.(foe, 0)).toBe('nearby');
      expect(canTrack(me, foe)).toBe(true);
    }
    foe.pos.z = -1501;
    expect(targeting.proximityContact?.(foe, 0)).toBe(null);
    expect(contactVisible(foe, 0)).toBe(true);
    foe.pos.z = -6000;
    expect(canTrack(me, foe)).toBe(true);
    foe.pos.z = -1000;
    foe.mods.untargetable = true;
    expect(canTrack(me, foe)).toBe(false);
    foe.mods.untargetable = false;
    g.smokes.push({ x: 0, z: -1000, r: 300, life: 30, team: 1 });
    expect(canTrack(me, foe)).toBe(false);
  });

  it('never reveals banishment or removes damage protection', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 0, -400);
    foe.mods.banished = true;
    foe.mods.revealed = true;
    expect(revealedTo(foe, 0)).toBe(false);
    expect(canTrack(me, foe)).toBe(false);
    foe.mods.banished = false;
    foe.mods.invulnerable = true;
    const hp = foe.hp;
    expect(canTrack(me, foe)).toBe(true);
    foe.takeDamage(1000, me);
    expect(foe.hp).toBe(hp);
  });

  it.each(['mouse', 'pad0'] as const)('%s acquires a cloaked point-blank surface ship', device => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const foe = place(g, 'zumwalt', 1, 0, -450);
    foe.mods.untargetable = true;
    foe.mods.lockRange = 1;
    const pc = new PlayerController(me, device, 0, g);
    const pick = () => (pc as unknown as { pickTarget(): unknown }).pickTarget();
    expect(pick()).toBe(foe);
    foe.pos.z = -501;
    expect(pick()).toBe(null);
  });

  it('lets SEAL Boarding AI use an eligible point-blank cloaked contact', () => {
    const g = emptyGame();
    const me = place(g, 'virginia', 0, 0, 0);
    const foe = place(g, 'zumwalt', 1, 0, -450);
    foe.mods.untargetable = true;
    me.meter = 1;
    const i = me.skills.findIndex(k => k.spec.id === 'sealBoarding');
    expect(aiWantsSkill(me, g, i, foe)).toBe(true);
    foe.pos.z = -700;
    expect(aiWantsSkill(me, g, i, foe)).toBe(false);
  });
});

describe('submarine proximity highlights', () => {
  it('uses a stronger nearby silhouette per viewing team, without changing contact eligibility', () => {
    const g = emptyGame();
    place(g, 'gato', 0, 0, 0);
    const sub = place(g, 'gato', 1, 0, -500);
    sub.pos.y = -80;
    expect(visibility.shipViewMode?.(sub, 0)).toBe('nearbySub');
    expect(visibility.shipViewMode?.(sub, 1)).toBe('ally');
    expect(contactVisible(sub, 0)).toBe(false);
    sub.pos.z = -501;
    expect(visibility.shipViewMode?.(sub, 0)).toBe('enemy');
    sub.mods.banished = true;
    expect(visibility.shipViewMode?.(sub, 0)).toBe('hidden');
    expect(visibility.shipViewMode?.(sub, -1)).toBe('hidden');
  });

  it('shows a forced surface contact through cloak and restores cloak outside proximity', () => {
    const g = emptyGame();
    place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'zumwalt', 1, 0, -500);
    foe.mods.untargetable = true;
    expect(visibility.shipViewMode?.(foe, 0)).toBe('normal');
    foe.pos.z = -501;
    expect(visibility.shipViewMode?.(foe, 0)).toBe('cloak');
  });

  it.each([-8, -80])('highlights at depth %im without granting contacts, and accepts sonar until expiry', depth => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const sub = place(g, 'gato', 1, 0, -500);
    sub.pos.y = depth;
    sub.mods.untargetable = true;
    for (const d of [499, 500]) {
      sub.pos.z = -d;
      expect(targeting.proximityContact?.(sub, 0)).toBe('submarine');
      expect(contactVisible(sub, 0)).toBe(false);
      expect(revealedTo(sub, 0)).toBe(false);
      expect(canTrack(me, sub)).toBe(false);
    }
    sub.pos.z = -501;
    expect(targeting.proximityContact?.(sub, 0)).toBe(null);
    sub.pos.z = -500;
    const search = me.consumables.find(c => c.spec.type === 'search')!;
    search.active = 10;
    expect(contactVisible(sub, 0)).toBe(true);
    expect(canTrack(me, sub)).toBe(true);
    expect(targeting.revealSource?.(sub, 0)).toBe('sonar');
    search.active = 0;
    expect(canTrack(me, sub)).toBe(false);
    expect(targeting.proximityContact?.(sub, 0)).toBe('submarine');
    sub.mods.banished = true;
    expect(targeting.proximityContact?.(sub, 0)).toBe(null);
  });

  it('treats a surfaced submarine as a surface contact', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const sub = place(g, 'gato', 1, 0, -400);
    sub.mods.untargetable = true;
    expect(canTrack(me, sub)).toBe(true);
    sub.pos.y = -8;
    expect(canTrack(me, sub)).toBe(false);
  });
});

describe('proximity and lock-breaking skills', () => {
  it('retains AI and homing locks through nearby smoke, then drops them outside 500m', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0, 0, true);
    const foe = place(g, 'iowa', 1, 0, -450);
    g.smokes.push({ x: 0, z: -450, r: 500, life: 50, team: 1 });
    g.ai.get(me)!.update(1);
    const missile = g.missiles.launch(me, 0, -450, 0, 100, { target: foe });
    const torp = g.torps.launch(me, 0, 0, 0, me.spec.torpedoes!, foe);
    g.step();
    expect(g.ai.get(me)!.target).toBe(foe);
    expect(missile.target).toBe(foe);
    expect(torp.homing).toBe(foe);
    foe.pos.z = -900;
    g.smokes[0].z = foe.pos.z;
    g.step();
    expect(g.ai.get(me)!.target).toBe(null);
    expect(missile.target).toBe(null);
    expect(torp.homing).toBe(null);
  });

  it('Stealth Profile cannot repeatedly drop a team’s forced proximity locks', () => {
    const g = emptyGame();
    const foe = place(g, 'zumwalt', 1, 0, -450);
    const me = place(g, 'gato', 0, 0, 0);
    const missile = g.missiles.launch(me, 0, -450, 10, 100, { target: foe });
    const torp = g.torps.launch(me, 0, 1000, 0, me.spec.torpedoes!, foe);
    expect(foe.activateSkill(foe.skills.findIndex(k => k.spec.id === 'stealthProfile'))).toBe(true);
    run(g, 0.6);
    expect(missile.target).toBe(foe);
    expect(torp.homing).toBe(foe);
    foe.pos.z = -1000;
    run(g, 0.6);
    expect(missile.target).toBe(null);
    expect(torp.homing).toBe(null);
  });

  it('dedicated chaff and decoys still break locks at point blank', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const foe = place(g, 'zumwalt', 1, 0, -400);
    const missile = g.missiles.launch(me, 0, -400, 10, 100, { target: foe });
    const torp = g.torps.launch(me, 0, 0, 0, me.spec.torpedoes!, foe);
    dropLocks(foe, g);
    expect(missile.target).toBe(null);
    expect(torp.homing).toBe(null);
  });

  it('produces identical hashes across proximity transitions and consumes no detection RNG', () => {
    const play = (probe: boolean) => {
      const g = emptyGame();
      const me = place(g, 'gato', 0, 0, 0, 0, true);
      const foe = place(g, 'zumwalt', 1, 0, -450);
      foe.activateSkill(foe.skills.findIndex(k => k.spec.id === 'stealthProfile'));
      const hashes = [];
      for (const d of [450, 501, 1500, 1501, 499]) {
        foe.pos.z = -d;
        const before = stateHash(g);
        if (probe) for (let i = 0; i < 5; i++) canTrack(me, foe);
        expect(stateHash(g)).toBe(before);
        run(g, 0.2);
        hashes.push(stateHash(g));
      }
      return { hashes, nextRandom: g.rng() };
    };
    expect(play(true)).toEqual(play(false));
  });
});
