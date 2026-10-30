import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID, SHIPS } from '../src/data/ships';
import { eraOf, FACTIONS } from '../src/data/factions';
import { emptyGame, place, run } from './helpers';
import { Game } from '../src/core/Game';
import { navalRules } from '../server/rules';
import { TurnApplier } from '../src/net/navalTurns';
import { stateHash } from '../src/net/hash';
import { CUBE, dockLift, HIT, TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';
import { absorbCube, cubeIntercept, damageCube, type Cube } from '../src/skills/misc/TungstenRuntime';
import { aiWantsSkill } from '../src/skills/registry';
import { stun } from '../src/weapons/StrikeSystem';
import { AIController } from '../src/ai/AIController';
import type { Ship } from '../src/ships/Ship';

const Q = 0, E = 1, Z = 2, X = 3, C = 4, V = 5, R = 6, T = 7, B = 8;

function duel(foeAt = -1500) {
  const g = emptyGame();
  const me = place(g, 'tungsten', 0, 0, 0);
  const foe = place(g, 'leviathan', 1, 0, foeAt);
  for (const s of [me, foe]) {
    s.throttle = 2;
    s.speed = 0;
    s.colossus = false;
    s.refreshModifiers();
  }
  me.control.aimX = foe.pos.x;
  me.control.aimZ = foe.pos.z;
  return { g, me, foe, t: me.tungsten! };
}
function extra(g: Game, id: string, team: 0 | 1, x: number, z: number): Ship {
  const s = place(g, id, team, x, z);
  s.throttle = 2;
  s.speed = 0;
  s.colossus = false;
  s.refreshModifiers();
  return s;
}
const modeIndex = (id: string) => TUNGSTEN_MODES.findIndex((m) => m.id === id);
function setMode(me: Ship, id: string) {
  const t = me.tungsten!;
  t.mode = modeIndex(id);
  t.cubes[0].mode = t.mode;
  me.refreshModifiers();
}
function park(c: Cube, x: number, z: number) {
  c.state = 'hover';
  c.path = null;
  c.x = c.px = x;
  c.z = c.pz = z;
  c.y = c.py = CUBE.hoverY;
}
const aim = (me: Ship, x: number, z: number) => {
  me.control.aimX = x;
  me.control.aimZ = z;
};
const gap = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('Tungsten roster', () => {
  it('offers a Misc titan of the Lodestone with a cube kit and three ultimates', () => {
    const s = SHIP_BY_ID.tungsten;
    expect(s).toBeDefined();
    expect(SHIPS).toContain(s);
    expect(eraOf(s)).toBe('misc');
    expect(s.nation).toBe('lodestone');
    expect(FACTIONS.lodestone.era).toBe('misc');
    expect(s.hp).toBe(1600000);
    expect(s.skills.map((k) => k.name)).toEqual([
      'Magnet Lunge',
      'Switch',
      'Signature',
      'Magnet Surge',
      'Dock',
      'Tungsten Shield',
      'Collapse',
      'Tungsten Meteor',
      'Overdrive',
    ]);
    expect(s.skills.filter((k) => k.ult)).toHaveLength(3);
  });
  it('carries no guns: the cube is its only weapon', () => {
    expect(SHIP_BY_ID.tungsten.main).toBeUndefined();
    const { me } = duel();
    expect(me.turrets).toHaveLength(0);
    expect(me.slots).toEqual([{ kind: 'cube', label: 'Tungsten cube' }]);
    // The reticle must reach every cube skill, out to Meteor's 5 km.
    expect(me.maxAimRange()).toBeGreaterThanOrEqual(CUBE.meteor.range);
  });
  it('starts with one docked Kinetic cube and six modes', () => {
    const { t } = duel();
    expect(TUNGSTEN_MODES.map((m) => m.id)).toEqual(['kinetic', 'crush', 'shard', 'repel', 'tether', 'mend']);
    expect(TUNGSTEN_MODES.map((m) => m.color)).toEqual([0x3ff0ff, 0xffae2b, 0xff3b3b, 0x3d6bff, 0xb46bff, 0x3dff8a]);
    expect(t.mode).toBe(0);
    expect(t.cubes).toHaveLength(1);
    expect(t.cubes[0].state).toBe('docked');
    expect(t.cubes[0].hp).toBe(CUBE.hp);
  });
});

const steer = (me: Ship, x: number, z: number) => {
  aim(me, x, z);
  me.control.fire = true;
};
const speedOf = (c: Cube) => Math.hypot(c.vx, c.vz);
/** Steps until `done` or `limit` seconds pass. */
function until(g: Game, done: () => boolean, limit = 10) {
  for (let k = 0; k < limit * 60 && !done(); k++) g.step(1 / 60);
}

describe('cube size', () => {
  it('is a 128 m cube floating clear of the dais', () => {
    const { g, me, t } = duel();
    run(g, 0.05);
    expect(CUBE.edge).toBe(128);
    expect(t.cubes[0].y).toBeCloseTo(dockLift(me.spec));
    expect(dockLift(me.spec) - CUBE.edge / 2).toBeCloseTo(me.spec.freeboard + CUBE.float);
  });
  it('blocks a shell that passes 50 m off its centre', () => {
    const { g, t } = duel();
    park(t.cubes[0], 0, -300);
    expect(cubeIntercept(g, 1, 50, 40, -1500, 50, 40, 0, 'shell')?.cube).toBe(t.cubes[0]);
  });
  it('keeps the Meteor at a 512 m impact', () => {
    expect(CUBE.edge * CUBE.meteor.scale).toBe(512);
  });
});

describe('steering', () => {
  it('follows the reticle while fire is held, gathering speed like a heavy weight', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    steer(me, 0, -2000);
    run(g, 0.5);
    expect(c.state).toBe('driven');
    // Kinetic flies 1.5x; the magnet takes time to bring that mass up to speed.
    expect(speedOf(c)).toBeCloseTo(CUBE.drive.accel * 0.5, -1);
    run(g, 5);
    expect(gap(c, { x: 0, z: -2000 })).toBeLessThan(40);
    expect(c.y).toBeCloseTo(CUBE.hoverY);
    aim(me, 1500, -2000);
    run(g, 4);
    expect(gap(c, { x: 1500, z: -2000 })).toBeLessThan(40);
  });
  it('holds the cube within the magnet leash', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    // Diagonally, so the 9 km map's edge does not stop it first.
    park(t.cubes[0], -2800, -2800);
    steer(me, -10000, -10000);
    run(g, 2);
    expect(gap(t.cubes[0], me.pos)).toBeCloseTo(CUBE.drive.leash, -1);
  });
  it('glides to a stop and hovers when fire is released', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    steer(me, 0, -4000);
    run(g, 2);
    me.control.fire = false;
    const z = c.z;
    run(g, 0.05);
    expect(c.state).toBe('hover');
    run(g, 3);
    expect(c.z).toBeLessThan(z - 100);
    expect(speedOf(c)).toBe(0);
    expect(c.y).toBeCloseTo(CUBE.hoverY);
  });
  it('drains energy while steered and recharges slowly when not', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    expect(t.energy).toBe(1);
    steer(me, 0, -3000);
    run(g, 2);
    expect(t.energy).toBeCloseTo(1 - 2 * CUBE.drive.drain, 2);
    me.control.fire = false;
    run(g, 2);
    expect(t.energy).toBeCloseTo(1 - 2 * CUBE.drive.drain + 2 * CUBE.drive.regen, 2);
  });
  it('goes dead when its energy runs out, sinking low until it docks', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    t.energy = 0.1;
    steer(me, 0, -3000);
    run(g, 1);
    expect(t.spent).toBe(true);
    expect(c.state).toBe('hover');
    run(g, 3);
    const at = { x: c.x, z: c.z };
    run(g, 2);
    // Fire is still held, but a spent cube does not answer.
    expect(gap(c, at)).toBeLessThan(1);
    expect(c.y).toBeCloseTo(CUBE.edge / 2 - CUBE.drive.sink);
    me.control.fire = false;
    expect(me.activateSkill(C)).toBe(true);
    until(g, () => c.state === 'docked');
    expect(t.spent).toBe(false);
    const e = t.energy;
    run(g, 1);
    expect(t.energy - e).toBeCloseTo(CUBE.drive.dockRegen, 2);
  });
  it('wakes a spent cube once its slow recharge is full', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    park(t.cubes[0], 0, -2000);
    t.energy = 0;
    t.spent = true;
    run(g, 1 / CUBE.drive.regen - 1);
    expect(t.spent).toBe(true);
    run(g, 1.5);
    expect(t.spent).toBe(false);
    steer(me, 0, -3000);
    run(g, 0.5);
    expect(t.cubes[0].state).toBe('driven');
  });
  it('cannot be steered by a stunned ship', () => {
    const { g, me, t } = duel();
    stun(me, 5); // 2 s on a titan
    steer(me, 0, -3000);
    run(g, 1);
    expect(t.cubes[0].state).toBe('docked');
  });
});

describe('cube contact', () => {
  it('rams hulls harder the faster it moves', () => {
    const ram = (from: number) => {
      const { g, me, foe, t } = duel();
      park(t.cubes[0], 0, from);
      steer(me, 0, -3000);
      run(g, 3);
      return foe.stats.received;
    };
    const slow = ram(-1300),
      fast = ram(-200);
    expect(slow).toBeGreaterThanOrEqual(CUBE.drive.damage * 0.3 - 1);
    expect(fast).toBeGreaterThan(slow * 2);
    expect(fast).toBeLessThanOrEqual(CUBE.drive.damage * 1.6 + 1);
  });
  it('strikes each hull at most once per interval', () => {
    const { g, me, foe, t } = duel();
    let hits = 0;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'hit' && e.target === foe) hits++;
    });
    park(t.cubes[0], 0, -900);
    for (let k = 0; k < 8; k++) {
      steer(me, 0, k % 2 ? -900 : -2100);
      run(g, 0.75);
    }
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(hits).toBeLessThanOrEqual(Math.ceil(6 / CUBE.drive.every) + 1);
  });
  it('stops a Crush cube dead on the hull it strikes, stunning it', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'crush');
    steer(me, 0, -3000);
    until(g, () => foe.stats.received > 0);
    expect(speedOf(t.cubes[0])).toBe(0);
    expect(foe.mods.stunned).toBe(true);
    expect(foe.mods.marked).toBe(true);
  });
});

describe('Magnet Surge', () => {
  it('refills the energy and wakes a spent cube where it lies', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    park(t.cubes[0], 0, -2000);
    t.energy = 0;
    t.spent = true;
    expect(me.activateSkill(X)).toBe(true);
    expect(t.energy).toBe(1);
    expect(t.spent).toBe(false);
    steer(me, 0, -3000);
    run(g, 0.5);
    expect(t.cubes[0].state).toBe('driven');
  });
  it('overcharges steering: faster, harder and free while it lasts', () => {
    const ram = (surge: boolean) => {
      const { g, me, foe, t } = duel();
      park(t.cubes[0], 0, 0);
      if (surge) me.activateSkill(X);
      steer(me, 0, -3000);
      let top = 0;
      for (let k = 0; k < 180; k++) {
        g.step(1 / 60);
        top = Math.max(top, speedOf(t.cubes[0]));
      }
      return { top, dealt: foe.stats.received, energy: t.energy };
    };
    const plain = ram(false),
      surged = ram(true);
    const top = CUBE.drive.speed * TUNGSTEN_MODES[0].speed;
    expect(plain.top).toBeCloseTo(top, 0);
    expect(surged.top).toBeCloseTo(top * CUBE.surge.speed, 0);
    expect(surged.energy).toBe(1);
    expect(plain.energy).toBeLessThan(1);
    expect(surged.dealt).toBeGreaterThan(plain.dealt * 1.3);
  });
  it('fails while the cube is re-forming', () => {
    const { me, t } = duel();
    damageCube(me, t.cubes[0], CUBE.hp * 2, null);
    expect(me.activateSkill(X)).toBe(false);
    expect(me.skillFailure).toMatch(/re-forming/);
    expect(me.skills[X].cooldown).toBe(0);
  });
});

describe('Dock', () => {
  it('needs the cube out', () => {
    const { me } = duel();
    expect(me.activateSkill(C)).toBe(false);
    expect(me.skills[C].cooldown).toBe(0);
    expect(me.skillFailure).toMatch(/docked/i);
  });
  it('flies home through enemies and repairs the ship', () => {
    const { g, me, foe, t } = duel();
    park(t.cubes[0], 0, -3000);
    me.hp = me.maxHp * 0.5;
    expect(me.activateSkill(C)).toBe(true);
    run(g, 3);
    expect(t.cubes[0].state).toBe('docked');
    expect(foe.stats.received).toBeGreaterThanOrEqual(50000);
    expect(me.hp).toBeGreaterThan(me.maxHp * 0.56 + 0.2 * 50000 - 1);
  });
  it('drags tethered enemies home with the cube', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'tether');
    park(t.cubes[0], 0, -900);
    steer(me, 0, -3000);
    run(g, 2);
    me.control.fire = false;
    expect(foe.effects.some((e) => e.id === 'debuff:tungstenChain')).toBe(true);
    const z0 = foe.pos.z;
    me.activateSkill(C);
    run(g, 3);
    expect(foe.pos.z - z0).toBeGreaterThan(150);
  });
});

describe('Magnet Lunge', () => {
  it('fails while the cube is docked', () => {
    const { me } = duel();
    expect(me.activateSkill(Q)).toBe(false);
    expect(me.skills[Q].cooldown).toBe(0);
    expect(me.skillFailure).toMatch(/throw/i);
  });
  it('reels the ship to its cube, through enemy hulls, and docks it', () => {
    const { g, me, foe, t } = duel();
    park(t.cubes[0], 0, -3000);
    const before = foe.stats.received;
    expect(me.activateSkill(Q)).toBe(true);
    expect(t.lunge).not.toBeNull();
    expect(me.takeDamage(100000, foe)).toBeCloseTo(60000, -2);
    run(g, 2.5);
    expect(t.lunge).toBeNull();
    expect(me.pos.z).toBeLessThan(-2500);
    expect(me.pos.z).toBeGreaterThan(-2900);
    expect(foe.stats.received - before).toBeGreaterThan(60000 - 1);
    expect(t.cubes[0].state).toBe('docked');
  });
  it('lands short when the water by the cube is blocked', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    park(t.cubes[0], 0, -3000);
    g.map.heightAt = (x, z) => (z < -1000 && Math.abs(x) < 900 ? 20 : -50);
    expect(me.activateSkill(Q)).toBe(true);
    run(g, 4);
    expect(me.pos.z).toBeLessThan(-600);
    expect(me.pos.z).toBeGreaterThan(-1000);
    expect(t.cubes[0].state).toBe('docked');
  });
  it('fails when there is no clear water along the way', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    park(t.cubes[0], 0, -3000);
    g.map.heightAt = (_x, z) => (z < -300 ? 20 : -50);
    expect(me.activateSkill(Q)).toBe(false);
    expect(me.skills[Q].cooldown).toBe(0);
  });
});

describe('Switch', () => {
  it('cycles all six modes on the cube', () => {
    const { g, me, t } = duel();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      expect(me.activateSkill(E)).toBe(true);
      seen.push(t.mode);
      expect(t.cubes[0].mode).toBe(t.mode);
      run(g, 0.6);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 0]);
  });
  it('keeps a cube in flight in the mode it was sent with', () => {
    const { g, me, foe, t } = duel();
    park(t.cubes[0], 0, -3000);
    expect(me.activateSkill(C)).toBe(true);
    run(g, 0.1);
    expect(me.activateSkill(E)).toBe(false);
    expect(me.skillFailure).toBe('Switch: the cube is in flight');
    expect(t.cubes[0].mode).toBe(modeIndex('kinetic'));
    // Badly hurt, the AI wants Mend, but not while the cube flies.
    me.hp = me.maxHp * 0.3;
    expect(aiWantsSkill(me, g, E, foe)).toBe(false);
    run(g, 3);
    expect(t.cubes[0].state).toBe('docked');
    expect(aiWantsSkill(me, g, E, foe)).toBe(true);
    expect(me.activateSkill(E)).toBe(true);
  });
  it('holds the mode while the cube rises and falls as a meteor', () => {
    const { g, me } = duel();
    me.meter = 1;
    expect(me.activateSkill(T)).toBe(true);
    run(g, 0.5);
    expect(me.activateSkill(E)).toBe(false);
    expect(me.skillFailure).toBe('Switch: the cube is in flight');
  });
});

describe('mode passives', () => {
  it('Kinetic speeds the ship and its cooldowns', () => {
    const { g, me } = duel();
    run(g, 0.05);
    expect(me.mods.speedMul).toBeCloseTo(1.15);
    expect(me.mods.cooldownMul).toBeCloseTo(0.85);
  });
  it('Repel hardens the hull', () => {
    const { g, me } = duel();
    setMode(me, 'repel');
    run(g, 0.05);
    expect(me.mods.damageTakenMul).toBeCloseTo(0.88);
  });
  it('Mend regenerates 0.3% a second', () => {
    const heal = (mode: string) => {
      const { g, me } = duel();
      setMode(me, mode);
      me.hp = me.maxHp * 0.5;
      run(g, 10);
      return me.hp / me.maxHp - 0.5;
    };
    expect(heal('mend') - heal('kinetic')).toBeCloseTo(0.03, 2);
  });
  it('Shard and Tether auras weaken enemies near the cube', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'shard');
    park(t.cubes[0], 300, -1500);
    run(g, 0.3);
    expect(foe.mods.dispersionMul).toBeCloseTo(1.25);
    setMode(me, 'tether');
    run(g, 0.6);
    expect(foe.mods.dispersionMul).toBeCloseTo(1);
    expect(foe.mods.speedMul).toBeCloseTo(0.85);
  });
  it('goes quiet while the cube is broken', () => {
    const { g, me, t } = duel();
    park(t.cubes[0], 0, -800);
    damageCube(me, t.cubes[0], CUBE.hp * 2, null);
    run(g, 0.05);
    expect(t.cubes[0].state).toBe('broken');
    expect(me.mods.speedMul).toBeCloseTo(1);
  });
});

describe('mode hits', () => {
  it('Shard bursts shrapnel onto nearby hulls and knocks out turrets', () => {
    const { g, me, foe } = duel();
    const side = extra(g, 'leviathan', 1, 300, -1500);
    setMode(me, 'shard');
    steer(me, 0, -3000);
    until(g, () => foe.stats.received > 0);
    expect(foe.stats.received).toBeGreaterThan(0);
    expect(side.stats.received).toBeCloseTo(foe.stats.received * HIT.shard.splash, -2);
    expect(foe.turrets.some((x) => x.disabled > 0)).toBe(true);
    expect(side.turrets.some((x) => x.disabled > 0)).toBe(true);
  });
  it('Repel knocks hulls aside', () => {
    const { g, me, foe } = duel();
    setMode(me, 'repel');
    steer(me, 0, -3000);
    run(g, 5);
    expect(foe.stats.received).toBeGreaterThan(0);
    expect(gap(foe.pos, { x: 0, z: -1500 })).toBeGreaterThan(60);
  });
  it('Tether chains, slows and bleeds the target', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'tether');
    park(t.cubes[0], 0, -900);
    steer(me, 0, -3000);
    until(g, () => foe.stats.received > 0);
    run(g, 0.05);
    const hit = foe.stats.received;
    expect(foe.mods.speedMul).toBeCloseTo(0.6);
    run(g, 3);
    expect(foe.stats.received - hit).toBeGreaterThan(15000);
  });
  it('Mend heals the ship from damage dealt and allies it passes', () => {
    const { g, me, foe } = duel();
    const ally = extra(g, 'leviathan', 0, 0, -800);
    ally.hp = ally.maxHp * 0.5;
    setMode(me, 'mend');
    me.hp = me.maxHp * 0.5;
    steer(me, 0, -3000);
    // Per-step jumps, so the titans' own slow repair doesn't blur the cube's heals.
    let healed = 0;
    const passes: number[] = [];
    for (let k = 0; k < 600 && !foe.stats.received; k++) {
      const hp = me.hp,
        was = ally.hp;
      g.step(1 / 60);
      healed = me.hp - hp;
      if (ally.hp - was > ally.maxHp * 0.01) passes.push((ally.hp - was) / ally.maxHp);
    }
    expect(foe.stats.received).toBeGreaterThan(0);
    expect(healed).toBeCloseTo(foe.stats.received * HIT.mend.lifesteal, -3);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toBeCloseTo(HIT.mend.ally, 2);
  });
});

describe('signatures', () => {
  it('Kinetic ricochets five times between enemies', () => {
    const { g, me, foe } = duel();
    const two = extra(g, 'leviathan', 1, 800, -1500);
    expect(me.activateSkill(Z)).toBe(true);
    run(g, 6);
    expect(foe.stats.received).toBeGreaterThan(0);
    expect(two.stats.received).toBeGreaterThan(0);
    expect(foe.stats.received + two.stats.received).toBeGreaterThanOrEqual(5 * 55000);
  });
  it('Ricochet needs an enemy within 2 km of the cube', () => {
    const { me } = duel(-3000);
    expect(me.activateSkill(Z)).toBe(false);
    expect(me.skills[Z].cooldown).toBe(0);
  });
  it('Crush slams and stuns', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'crush');
    park(t.cubes[0], 200, -1500);
    expect(me.activateSkill(Z)).toBe(true);
    run(g, 0.8);
    expect(foe.stats.received).toBeCloseTo(120000, -3);
    expect(foe.mods.stunned).toBe(true);
  });
  it('Shard storms hulls and knocks out two turrets', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'shard');
    park(t.cubes[0], 500, -1500);
    expect(me.activateSkill(Z)).toBe(true);
    run(g, 0.05);
    expect(foe.stats.received).toBeCloseTo(70000, -3);
    expect(foe.turrets.filter((x) => x.disabled > 0)).toHaveLength(2);
  });
  it('Repel repulses hulls and destroys missiles near the cube', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'repel');
    park(t.cubes[0], 300, -1500);
    const m = g.missiles.launch(foe, 0, 0, 0, 8000, { uninterceptable: true });
    expect(me.activateSkill(Z)).toBe(true);
    expect(m.alive).toBe(false);
    run(g, 2);
    expect(foe.stats.received).toBeCloseTo(40000, -3);
    expect(gap(foe.pos, { x: 0, z: -1500 })).toBeGreaterThan(60);
  });
  it('Tether reels enemies to the cube, then strikes', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'tether');
    park(t.cubes[0], 1000, -1500);
    expect(me.activateSkill(Z)).toBe(true);
    run(g, 1.2);
    expect(foe.pos.x).toBeGreaterThan(150);
    expect(foe.stats.received).toBeGreaterThanOrEqual(80000);
  });
  it('Mend restores allies near the cube and the ship', () => {
    const { g, me, t } = duel();
    const ally = extra(g, 'leviathan', 0, 2000, 0);
    ally.hp = ally.maxHp * 0.5;
    me.hp = me.maxHp * 0.5;
    setMode(me, 'mend');
    park(t.cubes[0], 2000, -500);
    expect(me.activateSkill(Z)).toBe(true);
    expect(ally.hp / ally.maxHp).toBeCloseTo(0.6);
    expect(me.hp / me.maxHp).toBeCloseTo(0.58);
  });
});

describe('Tungsten Shield', () => {
  it('guards on the reticle side of the hull', () => {
    const { g, me, t } = duel();
    expect(me.activateSkill(V)).toBe(true);
    run(g, 1);
    expect(t.cubes[0].state).toBe('guard');
    expect(t.cubes[0].z).toBeCloseTo(-(SHIP_BY_ID.tungsten.length / 2 + 150), -1);
  });
  it('captures missiles and torpedoes and stores their damage', () => {
    const { g, me, foe, t } = duel();
    me.activateSkill(V);
    run(g, 1);
    g.missiles.launch(foe, 0, 0, 0, 50000, { uninterceptable: true });
    g.torps.launch(foe, 0, -900, Math.PI, SHIP_BY_ID.stepper.torpedoes!);
    run(g, 6);
    expect(me.stats.received).toBe(0);
    expect(t.charge).toBeCloseTo(50000 + SHIP_BY_ID.stepper.torpedoes!.damage);
    expect(t.cubes[0].hp).toBeCloseTo(CUBE.hp - 0.25 * t.charge);
  });
  it('caps stored damage', () => {
    const { g, me, foe, t } = duel();
    me.activateSkill(V);
    run(g, 1);
    t.charge = 590000;
    g.missiles.launch(foe, 0, 0, 0, 50000, { uninterceptable: true });
    run(g, 5);
    expect(t.charge).toBe(CUBE.chargeCap);
  });
  it('spends the store on the next cube hit', () => {
    const { g, me, foe, t } = duel();
    t.charge = 300000;
    steer(me, 0, -3000);
    run(g, 5);
    expect(foe.stats.received).toBeGreaterThan(300000 + CUBE.drive.damage * 0.3);
    expect(t.charge).toBe(0);
  });
  it('refills ultimate meters with the released store', () => {
    const gain = (charge: number) => {
      const { g, me, foe, t } = duel();
      me.meter = 0;
      t.charge = charge;
      steer(me, 0, -3000);
      until(g, () => foe.stats.received > 0);
      return me.skills[R].meter;
    };
    expect(gain(100000)).toBeGreaterThan(gain(0) + 0.3);
  });
  it('blocks shells with the cube body, not when docked', () => {
    const { g, me, foe, t } = duel();
    expect(cubeIntercept(g, 1, 0, 40, -1500, 0, 40, 0, 'shell')).toBeNull();
    park(t.cubes[0], 0, -300);
    expect(cubeIntercept(g, 1, 0, 40, -1500, 0, 40, 0, 'shell')?.cube).toBe(t.cubes[0]);
    expect(cubeIntercept(g, 0, 0, 40, -1500, 0, 40, 0, 'shell')).toBeNull();
    expect(cubeIntercept(g, 1, 0, 40, -1500, 0, 40, 0, 'torpedo')).toBeNull();
    g.shells.fire(foe, {
      ammo: 'AP',
      spec: foe.spec.main!.ap!,
      table: foe.tableFor('AP')!,
      fromX: 0,
      fromY: 40,
      fromZ: -1300,
      toX: 0,
      toY: 40,
      toZ: 0,
      dmgMul: 1,
      guaranteedFire: false,
      railgun: false,
      flat: 1,
    });
    run(g, 3);
    expect(me.stats.received).toBe(0);
    expect(t.cubes[0].hp).toBeLessThan(CUBE.hp);
  });
});

describe('cube health', () => {
  it('shatters and re-forms on the magnet after 12 s', () => {
    const { g, me, t } = duel();
    park(t.cubes[0], 0, -800);
    damageCube(me, t.cubes[0], CUBE.hp * 2, null);
    expect(t.cubes[0].state).toBe('broken');
    expect(me.activateSkill(X)).toBe(false);
    run(g, 11.8);
    expect(t.cubes[0].state).toBe('broken');
    run(g, 0.4);
    expect(t.cubes[0].state).toBe('docked');
    expect(t.cubes[0].hp).toBe(CUBE.hp);
  });
  it('repairs 2% a second on the magnet', () => {
    const { g, t } = duel();
    t.cubes[0].hp = CUBE.hp * 0.5;
    run(g, 5);
    expect(t.cubes[0].hp / CUBE.hp).toBeCloseTo(0.6, 2);
  });
});

describe('Overdrive', () => {
  it('raises five more cubes in the other modes with every passive live', () => {
    const { g, me, t } = duel();
    me.meter = 1;
    expect(me.activateSkill(B)).toBe(true);
    expect(me.skills[B].active).toBe(true);
    expect(me.skills[B].time).toBeCloseTo(CUBE.overdrive.time);
    // Overdrive powers the rest of the kit, so it doesn't count as an ultimate the AI waits out.
    expect(me.ultActive).toBe(false);
    expect(t.cubes).toHaveLength(6);
    expect(new Set(t.cubes.map((c) => c.mode)).size).toBe(6);
    run(g, 0.05);
    expect(me.mods.speedMul).toBeCloseTo(1.15);
    expect(me.mods.damageTakenMul).toBeCloseTo(0.88);
    expect(me.activateSkill(E)).toBe(false);
  });
  it('steers every cube in formation for free, and sends the extras home when it ends', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    t.energy = 0.5;
    me.activateSkill(B);
    expect(t.energy).toBe(1);
    steer(me, 0, -2500);
    run(g, 10);
    expect(t.cubes.every((c) => c.state === 'driven')).toBe(true);
    expect(gap(t.cubes[0], { x: 0, z: -2500 })).toBeLessThan(40);
    for (const c of t.cubes.slice(1)) expect(gap(c, { x: 0, z: -2500 })).toBeCloseTo(CUBE.drive.formation, -1);
    expect(t.energy).toBe(1);
    me.control.fire = false;
    run(g, 20);
    expect(t.cubes).toHaveLength(1);
  });
  it('cannot be renewed while it runs, and charges again only once it ends', () => {
    const { g, me } = duel();
    me.meter = 1;
    me.activateSkill(B);
    me.charge(1e9);
    run(g, 0.05);
    expect(me.skills[B].meter).toBe(0);
    expect(me.skills[R].meter).toBe(1);
    me.skills[B].meter = 1;
    expect(me.activateSkill(B)).toBe(false);
    expect(me.skillFailure).toBe('Ability already active');
    run(g, CUBE.overdrive.time);
    expect(me.skills[B].active).toBe(false);
    me.charge(1e9);
    expect(me.skills[B].meter).toBe(1);
  });
  it('leaves the AI casting cube skills while it runs', () => {
    const { g, me } = duel(-700);
    g.ai.set(me, new AIController(me, g));
    me.meter = 1;
    me.activateSkill(B);
    run(g, 10);
    expect(me.skills.some((st) => !st.spec.ult && st.cooldown > 0)).toBe(true);
  });
  it('orbits the cubes as a shield that batters hulls', () => {
    const { g, me, foe, t } = duel();
    foe.pos.set(420, 0, 0);
    foe.heading = Math.PI / 2;
    me.meter = 1;
    me.activateSkill(B);
    expect(me.activateSkill(V)).toBe(true);
    run(g, 2);
    expect(t.cubes.every((c) => c.state === 'orbit')).toBe(true);
    for (const c of t.cubes) expect(gap(c, me.pos)).toBeCloseTo(420, -1);
    expect(foe.stats.received).toBeGreaterThanOrEqual(CUBE.orbit.damage);
    expect(foe.pos.x).toBeGreaterThan(470);
  });
  it('makes the orbit a stronger Shield: capture fields, a lighter hull, a double store and a longer hold', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 0.05);
    const taken = me.mods.damageTakenMul;
    expect(me.activateSkill(V)).toBe(true);
    run(g, 0.05);
    expect(me.skills[V].time).toBeCloseTo(CUBE.orbit.time - 0.05, 1);
    run(g, 1.95);
    expect(me.mods.damageTakenMul).toBeCloseTo(taken * CUBE.orbit.taken);
    for (const c of t.cubes) {
      // A shell passing 200 m outside each cube, clear of the cube's body and of the rest of the ring.
      const d = Math.max(1, gap(c, me.pos));
      const ux = (c.x - me.pos.x) / d,
        uz = (c.z - me.pos.z) / d;
      const x = c.x + ux * 200,
        z = c.z + uz * 200;
      const hit = cubeIntercept(g, 1, x - uz * 60, 40, z + ux * 60, x + uz * 60, 40, z - ux * 60, 'shell');
      expect(hit?.capture).toBe(true);
    }
    absorbCube({ owner: me, cube: t.cubes[0], t: 0, capture: true }, 5e6, null, 0, 0, 0);
    expect(t.charge).toBe(CUBE.chargeCap * 2);
    run(g, CUBE.orbit.time - 3);
    expect(t.cubes.every((c) => c.state === 'orbit')).toBe(true);
    run(g, 3);
    expect(t.cubes.some((c) => c.state === 'orbit')).toBe(false);
  });
});

describe('Collapse', () => {
  it('drags enemies in, bursts with falloff and leaves the cube at the centre', () => {
    const { g, me, foe, t } = duel();
    const far = extra(g, 'leviathan', 1, 1100, -1500);
    foe.pos.x = 100;
    aim(me, 0, -1500);
    me.meter = 1;
    expect(me.activateSkill(R)).toBe(true);
    run(g, 2);
    expect(far.pos.x).toBeLessThan(1050);
    run(g, 2);
    expect(foe.stats.received).toBeGreaterThan(far.stats.received);
    expect(far.stats.received).toBeGreaterThan(120000);
    expect(foe.stats.received).toBeLessThan(400000 + 45000 + 1);
    expect(t.ult).toBeNull();
    expect(t.cubes[0].state).toBe('hover');
    expect(gap(t.cubes[0], { x: 0, z: -1500 })).toBeLessThan(50);
  });
});

describe('Tungsten Meteor', () => {
  it('falls on the reticle with falloff and the mode effect', () => {
    const { g, me, foe, t } = duel(-2000);
    const side = extra(g, 'leviathan', 1, 600, -2000);
    setMode(me, 'crush');
    aim(me, 0, -2000);
    me.meter = 1;
    expect(me.activateSkill(T)).toBe(true);
    run(g, 3.05);
    expect(foe.stats.received).toBeGreaterThan(690000);
    expect(foe.stats.received).toBeLessThan(700001);
    expect(side.stats.received).toBeCloseTo(350000, -4);
    expect(foe.mods.stunned).toBe(true);
    run(g, 0.7);
    expect(t.ult).toBeNull();
    expect(t.cubes[0].scale).toBeCloseTo(1);
    expect(t.cubes[0].state).toBe('hover');
  });
  it('falls as six smaller meteors during Overdrive', () => {
    const { g, me, t } = duel(-2000);
    me.meter = 1;
    me.activateSkill(B);
    aim(me, 0, -2000);
    me.skills[T].meter = 1;
    let impacts = 0;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'meteorImpact') impacts++;
    });
    expect(me.activateSkill(T)).toBe(true);
    run(g, 3.05);
    expect(impacts).toBe(6);
    expect(t.cubes.every((c) => c.scale > 1)).toBe(true);
  });
});

describe('Tungsten sync', () => {
  const script = (me: Ship, k: number) => {
    me.control.fire = k > 20 && k < 200;
    const at = [X, E, Z, V, B, T, R, C, Q];
    if (k % 40 === 0 && at[k / 40] !== undefined) {
      me.meter = 1;
      me.activateSkill(at[k / 40]);
    }
  };
  it('hashes identically for the same seed and differently when the cube state differs', () => {
    const hashes = [0, 1].map(() => {
      const { g, me } = duel();
      for (let k = 0; k < 400; k++) {
        script(me, k);
        g.step(1 / 60);
      }
      return stateHash(g);
    });
    expect(hashes[0]).toBe(hashes[1]);
    const { g, me, t } = duel();
    const h = stateHash(g);
    t.charge = 1;
    expect(stateHash(g)).not.toBe(h);
    setMode(me, 'mend');
    t.charge = 0;
    expect(stateHash(g)).not.toBe(h);
    setMode(me, 'kinetic');
    expect(stateHash(g)).toBe(h);
    const c = t.cubes[0];
    const fields: [() => void, () => void][] = [
      [() => (t.energy = 0.5), () => (t.energy = 1)],
      [() => (t.spent = true), () => (t.spent = false)],
      [() => (t.surgeUntil = 5), () => (t.surgeUntil = 0)],
      [() => (c.vx = 3), () => (c.vx = 0)],
      [() => (c.vz = 3), () => (c.vz = 0)],
    ];
    for (const [set, reset] of fields) {
      set();
      expect(stateHash(g)).not.toBe(h);
      reset();
      expect(stateHash(g)).toBe(h);
    }
  });
  it('replays Tungsten LAN turns in lockstep', () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { era: 'mixed', titans: true, ai: [0, 0], type: 'freeplay' });
    expect(navalRules.pickAllowed('tungsten', st)).toBe(true);
    const c = navalRules.config(
      st,
      [
        { pick: 'tungsten', team: 0, name: 'A' },
        { pick: 'tungsten', team: 1, name: 'B' },
      ],
      211,
    );
    const games = [new Game(c), new Game(structuredClone(c))];
    for (const g of games) {
      g.ai.clear();
      for (const s of g.humans()) {
        s.pos.set(0, 0, s.team ? -2500 : 0);
        s.speed = 0;
        s.throttle = 2;
        s.hp = s.maxHp = 10000000;
        s.meter = 1;
      }
    }
    const sims = games.map((g) => new TurnApplier(g));
    const order = [8, 3, 1, 2, 5, 7, 4, 6, 3, 0];
    for (let k = 0; k < 240; k++) {
      const skill = k % 20 === 0 ? order[k / 20] : undefined;
      const turn = {
        k,
        p: [
          [0, [0, 0, -2500, k >= 20 && k < 140 ? 1 : 0, -1]],
          [1, [0, 0, 0, 0, -1]],
        ] as [number, [number, number, number, number, number]][],
        e:
          skill === undefined
            ? undefined
            : ([
                [0, 0, { sk: skill }],
                [1, 0, { sk: skill }],
              ] as [number, number, { sk: number }][]),
      };
      for (let tick = 0; tick < 2; tick++) for (const sim of sims) sim.applyTick(turn, tick);
      expect(sims[0].hash()).toBe(sims[1].hash());
    }
  });
});

describe('Tungsten AI', () => {
  it('steers its cube through the target and lets go before the cube is spent', () => {
    const g = emptyGame();
    const me = place(g, 'tungsten', 0, 0, 0, 0, true);
    const foe = place(g, 'leviathan', 1, 0, -2000, Math.PI);
    for (const st of me.skills) {
      st.cooldown = 1e9;
      st.meter = 0;
    }
    const t = me.tungsten!;
    let drove = false,
      spent = false;
    for (let k = 0; k < 20 * 60; k++) {
      g.step(1 / 60);
      drove ||= t.cubes[0].state === 'driven';
      spent ||= t.spent;
    }
    expect(drove).toBe(true);
    expect(foe.stats.received).toBeGreaterThanOrEqual(CUBE.drive.damage);
    expect(spent).toBe(false);
  });
  it('docks a spent cube', () => {
    const { g, me, foe, t } = duel();
    park(t.cubes[0], 0, -1000);
    expect(aiWantsSkill(me, g, C, foe)).toBe(false);
    t.spent = true;
    t.energy = 0;
    expect(aiWantsSkill(me, g, C, foe)).toBe(true);
  });
  it('fights an AI skirmish with most of its kit and finite cube state', () => {
    const g = emptyGame();
    const me = place(g, 'tungsten', 0, 0, 0, 0, true);
    place(g, 'leviathan', 0, 600, 300, 0, true);
    place(g, 'leviathan', 1, 0, -4000, Math.PI, true);
    place(g, 'hadal', 1, 2500, -3500, Math.PI, true);
    me.meter = 1;
    const used = new Set<number>();
    g.events.on('skill', (e) => {
      if (e.ship === me) used.add(e.index);
    });
    // It holds the line for a minute; in this fight it sinks at about 95 s, as Stepper does.
    run(g, 60);
    expect(me.alive).toBe(true);
    run(g, 60);
    for (const c of me.tungsten!.cubes) expect([c.x, c.y, c.z, c.hp, c.scale].every(Number.isFinite)).toBe(true);
    expect(used.size).toBeGreaterThanOrEqual(7);
  });
});
