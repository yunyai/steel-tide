import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID, SHIPS } from '../src/data/ships';
import { eraOf, FACTIONS } from '../src/data/factions';
import { emptyGame, place, run } from './helpers';
import { Game } from '../src/core/Game';
import { navalRules } from '../server/rules';
import { TurnApplier } from '../src/net/navalTurns';
import { stateHash } from '../src/net/hash';
import { CUBE, dockLift, HIT, SIGNATURE, TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';
import { absorbCube, cubeIntercept, damageCube, PATH_KINDS, type Cube } from '../src/skills/misc/TungstenRuntime';
import { aiWantsSkill } from '../src/skills/registry';
import { stun } from '../src/weapons/StrikeSystem';
import type { GameEventMap } from '../src/core/Events';
import { bearingTo, forwardX, forwardZ } from '../src/core/math';
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
      'Loaded Die',
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

/** One click of the fire button at (x, z). */
function hurl(g: Game, me: Ship, x: number, z: number) {
  aim(me, x, z);
  me.control.fire = true;
  g.step(1 / 60);
  me.control.fire = false;
}
/** Steps until `done` or `limit` seconds pass. */
function until(g: Game, done: () => boolean, limit = 10) {
  for (let k = 0; k < limit * 60 && !done(); k++) g.step(1 / 60);
}
const landed = (c: Cube) => () => c.state === 'hover';

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
  it('spins the docked cube and wheels the Overdrive halo slowly round the dais', () => {
    const { g, me, t } = duel();
    me.meter = 1;
    me.activateSkill(B);
    // The first cube lifts off the dais into the halo before it spins there.
    run(g, 1);
    // Angles in hull space, so the ship's own turning doesn't count.
    const yaw = () => t.cubes[0].yaw + me.heading;
    const halo = () => {
      const c = t.cubes.find((k) => k.slot === 1)!,
        h = me.heading;
      const dx = c.x - me.pos.x,
        dz = c.z - me.pos.z;
      return Math.atan2(dx * Math.cos(h) + dz * Math.sin(h), dx * Math.sin(h) - dz * Math.cos(h));
    };
    const y0 = yaw(),
      a0 = halo();
    run(g, 2);
    expect(t.cubes.every((c) => c.state === 'docked')).toBe(true);
    expect(yaw() - y0).toBeCloseTo(CUBE.spin * 2, 2);
    expect(halo() - a0).toBeCloseTo(CUBE.ringSpin * 2, 2);
  });
  it('keeps the Meteor at a 512 m impact', () => {
    expect(CUBE.edge * CUBE.meteor.scale).toBe(512);
  });
});

describe('throwing', () => {
  it('hurls the cube tumbling at the reticle on a click, fast, and it hovers there', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    let thrown = 0;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'throw') thrown++;
    });
    hurl(g, me, 0, -2000);
    expect(c.state).toBe('flying');
    expect(c.path?.kind).toBe('shot');
    expect(thrown).toBe(1);
    // Kinetic flies 1.5x: 2 km in about three quarters of a second.
    const t0 = g.time;
    until(g, landed(c));
    expect(g.time - t0).toBeLessThan(2000 / (CUBE.shot.speed * TUNGSTEN_MODES[0].speed) + 0.1);
    expect(gap(c, { x: 0, z: -2000 })).toBeLessThan(5);
    expect(c.y).toBeCloseTo(CUBE.hoverY);
  });
  it('reaches at most 4 km from where it was thrown', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    // Diagonally, so the 9 km map's edge does not stop it first, and clear of the island to the north-west.
    hurl(g, me, 4000, -4000);
    until(g, landed(c));
    expect(gap(c, me.pos)).toBeCloseTo(CUBE.shot.range, -1);
  });
  it('throws again while fire is held, once per reload, from wherever the cube is', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    let thrown = 0;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'throw') thrown++;
    });
    aim(me, 0, -1500);
    me.control.fire = true;
    until(g, landed(c));
    // It lands well inside the reload, and a new aim waits for it.
    aim(me, 1500, -1500);
    run(g, 0.3);
    expect(thrown).toBe(1);
    run(g, CUBE.shot.reload);
    expect(thrown).toBe(2);
    until(g, landed(c));
    expect(gap(c, { x: 1500, z: -1500 })).toBeLessThan(5);
    // Held on the spot it already hovers over, nothing more is thrown.
    run(g, CUBE.shot.reload + 0.5);
    expect(thrown).toBe(2);
  });
  it('spends a quarter of its energy per throw, recharging slowly out and fast on the magnet', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    expect(t.energy).toBe(1);
    hurl(g, me, 0, -2000);
    expect(t.energy).toBeCloseTo(1 - CUBE.shot.cost, 3);
    until(g, landed(t.cubes[0]));
    const e = t.energy;
    run(g, 2);
    expect(t.energy - e).toBeCloseTo(2 * CUBE.energy.regen, 3);
    me.activateSkill(C);
    until(g, () => t.cubes[0].state === 'docked');
    t.energy = 0.2;
    run(g, 1);
    expect(t.energy - 0.2).toBeCloseTo(CUBE.energy.dockRegen, 2);
  });
  it('goes dead after its last throw, sinking where it lands until it docks', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    t.energy = CUBE.shot.cost;
    hurl(g, me, 0, -2000);
    expect(t.spent).toBe(true);
    until(g, landed(c));
    run(g, 4);
    expect(c.y).toBeCloseTo(CUBE.edge / 2 - CUBE.energy.sink);
    // A spent cube does not answer the fire button.
    aim(me, 1500, -2000);
    me.control.fire = true;
    run(g, 2);
    expect(c.state).toBe('hover');
    expect(gap(c, { x: 0, z: -2000 })).toBeLessThan(5);
    me.control.fire = false;
    expect(me.activateSkill(C)).toBe(true);
    until(g, () => c.state === 'docked');
    expect(t.spent).toBe(false);
  });
  it('wakes a spent cube once its slow recharge is full', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    park(t.cubes[0], 0, -2000);
    t.energy = 0;
    t.spent = true;
    run(g, 1 / CUBE.energy.regen - 1);
    expect(t.spent).toBe(true);
    run(g, 1.5);
    expect(t.spent).toBe(false);
    hurl(g, me, 0, -3000);
    expect(t.cubes[0].state).toBe('flying');
  });
  it('cannot be thrown by a stunned ship', () => {
    const { g, me, t } = duel();
    stun(me, 5); // 2 s on a titan
    hurl(g, me, 0, -3000);
    run(g, 0.5);
    expect(t.cubes[0].state).toBe('docked');
  });
  it('rolls up and over an island to a reticle beyond it, never dipping into the ground', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    const ground = (x: number, z: number) => (z < -900 && z > -1300 && Math.abs(x) < 600 ? 40 : -50);
    g.map.heightAt = ground;
    hurl(g, me, 0, -2000);
    expect(c.state).toBe('flying');
    // The cube's base, under its whole footprint along the throw, stays on or above the ground.
    const H = CUBE.edge / 2;
    let clear = Infinity;
    for (let k = 0; k < 600 && c.state === 'flying'; k++) {
      g.step(1 / 60);
      for (let a = -H; a <= H; a += 16) clear = Math.min(clear, c.y - H - Math.max(0, ground(c.x, c.z + a)));
    }
    expect(c.state).toBe('hover');
    expect(gap(c, { x: 0, z: -2000 })).toBeLessThan(5);
    expect(clear).toBeGreaterThan(-0.5);
    expect(c.y).toBeCloseTo(CUBE.hoverY);
  });
  it('stops on an island when the reticle is on it, sitting on the ground', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    g.map.heightAt = (x, z) => (z < -1500 && Math.abs(x) < 900 ? 30 : -50);
    hurl(g, me, 0, -2000);
    until(g, landed(c));
    expect(gap(c, { x: 0, z: -2000 })).toBeLessThan(5);
    expect(c.y).toBeCloseTo(30 + CUBE.edge / 2);
  });
  it('rests a spent cube on the ground on land rather than sinking into it', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    const c = t.cubes[0];
    g.map.heightAt = (x, z) => (z < -1500 && Math.abs(x) < 900 ? 30 : -50);
    t.energy = CUBE.shot.cost;
    hurl(g, me, 0, -2000);
    expect(t.spent).toBe(true);
    until(g, landed(c));
    run(g, 4);
    expect(c.y).toBeCloseTo(30 + CUBE.edge / 2);
  });
});

describe('thrown cube hits', () => {
  it('ploughs through every hull in its path once, for 80k with the mode effect', () => {
    const { g, me, foe, t } = duel();
    const behind = extra(g, 'leviathan', 1, 0, -2600);
    hurl(g, me, 0, -3200);
    until(g, landed(t.cubes[0]));
    // Kinetic gains with the distance flown.
    for (const o of [foe, behind]) {
      expect(o.stats.received).toBeGreaterThanOrEqual(CUBE.shot.damage);
      expect(o.stats.received).toBeLessThanOrEqual(CUBE.shot.damage * (1 + HIT.kinetic.bonus) + 1);
    }
    expect(gap(t.cubes[0], { x: 0, z: -3200 })).toBeLessThan(5);
  });
  it('stops a Crush cube on the first hull it strikes, stunning it', () => {
    const { g, me, foe, t } = duel();
    const behind = extra(g, 'leviathan', 1, 0, -2600);
    setMode(me, 'crush');
    hurl(g, me, 0, -3200);
    until(g, landed(t.cubes[0]));
    expect(foe.stats.received).toBeCloseTo(CUBE.shot.damage * TUNGSTEN_MODES[modeIndex('crush')].damage, -2);
    expect(behind.stats.received).toBe(0);
    expect(gap(t.cubes[0], foe.pos)).toBeLessThan(400);
    expect(foe.mods.stunned).toBe(true);
    expect(foe.mods.marked).toBe(true);
  });
});

describe('Loaded Die', () => {
  /** Forces the die to land on `face`. */
  const loaded = (g: Game, face: number) => ((g as unknown as { rng: () => number }).rng = () => (face + 0.5) / 6);
  function roll(face: number | null, mode: string, foeAt = { x: 0, z: -2500 }) {
    const { g, me, foe, t } = duel();
    setMode(me, mode);
    if (face !== null) loaded(g, face);
    foe.pos.x = foeAt.x;
    foe.pos.z = foeAt.z;
    aim(me, 0, -2500);
    const rolls: GameEventMap['tungsten'][] = [];
    g.events.on('tungsten', (e) => {
      if (e.kind === 'die') rolls.push(e);
    });
    return { g, me, foe, t, rolls };
  }
  const cast = (g: Game, me: Ship, rolls: unknown[], n = 1) => {
    expect(me.activateSkill(X), me.skillFailure).toBe(true);
    until(g, () => rolls.length >= n, 6);
    expect(rolls).toHaveLength(n);
  };

  it('replaces Magnet Surge on X with a free 16 s roll', () => {
    const { me } = duel();
    expect(me.skills[X].spec.id).toBe('tungstenDie');
    expect(me.skills[X].spec.cooldown).toBe(16);
    expect(me.skills.some((k) => k.spec.id === 'tungstenSurge')).toBe(false);
    expect('surgeUntil' in me.tungsten!).toBe(false);
  });
  it('rolls the cube to the reticle through anything in the way and blasts every foe within 600 m', () => {
    const { g, me, foe, t, rolls } = roll(0, 'repel');
    const inWay = extra(g, 'leviathan', 1, 0, -1200);
    const near = extra(g, 'leviathan', 1, 450, -2500);
    const far = extra(g, 'leviathan', 1, 1300, -2500);
    expect(me.activateSkill(X), me.skillFailure).toBe(true);
    expect(t.cubes[0].path?.kind).toBe('die');
    until(g, () => rolls.length > 0, 6);
    expect(gap(t.cubes[0], { x: 0, z: -2500 })).toBeLessThan(5);
    expect(t.cubes[0].state).toBe('hover');
    expect(inWay.stats.received).toBe(0);
    expect(far.stats.received).toBe(0);
    expect(near.stats.received).toBeGreaterThan(CUBE.die.damage - 1);
    expect(foe.stats.received).toBeGreaterThan(CUBE.die.damage - 1);
  });
  it('rolls its face from the seeded RNG, so the same seed rolls the same face', () => {
    const face = () => {
      const { g, me, rolls } = roll(null, 'kinetic');
      cast(g, me, rolls);
      return rolls[0].face!;
    };
    const a = face();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(6);
    expect(face()).toBe(a);
  });
  it('Kinetic face: the blast grows with the distance rolled, at double the Kinetic bonus', () => {
    const { g, me, foe, t, rolls } = roll(0, 'repel');
    cast(g, me, rolls);
    expect(rolls[0].face).toBe(0);
    expect(rolls[0].jackpot).toBe(false);
    const gain = 1 + 2 * HIT.kinetic.bonus * Math.min(1, t.cubes[0].flown / HIT.kinetic.full);
    expect(gain).toBeGreaterThan(1.5);
    expect(foe.stats.received).toBeCloseTo(CUBE.die.damage * gain, -3);
  });
  it('Crush face: a 2 s stun and a mark', () => {
    const { g, me, foe, rolls } = roll(1, 'repel');
    cast(g, me, rolls);
    expect(foe.mods.stunned).toBe(true);
    expect(foe.mods.marked).toBe(true);
    expect(foe.stats.received).toBeCloseTo(CUBE.die.damage, -3);
  });
  it('Shard face: knocks out two turrets for 8 s', () => {
    const { g, me, foe, rolls } = roll(2, 'repel');
    cast(g, me, rolls);
    expect(foe.turrets.filter((k) => k.disabled > 7.5)).toHaveLength(2);
  });
  it('Repel face: flings hulls 500 m out and tears up fire near it', () => {
    const { g, me, foe, rolls } = roll(3, 'kinetic', { x: 4000, z: 0 });
    // A destroyer, short enough to take the full knock.
    const dd = extra(g, 'fletcher', 1, 300, -2500);
    g.torps.launch(foe, 300, -2300, Math.PI, SHIP_BY_ID.stepper.torpedoes!);
    expect(g.torps.torps.some((p) => p.alive)).toBe(true);
    cast(g, me, rolls);
    expect(g.torps.torps.some((p) => p.alive)).toBe(false);
    run(g, 4);
    expect(dd.pos.x).toBeGreaterThan(300 + 400);
  });
  it('Tether face: chains every hull it blasts for 8 s', () => {
    const { g, me, foe, t, rolls } = roll(4, 'kinetic');
    cast(g, me, rolls);
    const chain = t.tethers.find((k) => k.target === foe.id);
    expect(chain?.until).toBeCloseTo(g.time + 2 * HIT.tether.time, 1);
  });
  it('Mend face: the ship heals half the damage dealt', () => {
    const { g, me, foe, rolls } = roll(5, 'kinetic');
    me.hp = me.maxHp / 2;
    expect(me.activateSkill(X)).toBe(true);
    // The heal is the jump in the tick the die lands.
    let jump = 0;
    for (let k = 0; k < 360 && !rolls.length; k++) {
      const hp = me.hp;
      g.step(1 / 60);
      if (rolls.length) jump = me.hp - hp;
    }
    expect(jump).toBeCloseTo(foe.stats.received * 0.5, -3);
  });
  it('rolls a jackpot when the face matches the cube, firing every face at once', () => {
    const { g, me, foe, t, rolls } = roll(1, 'crush', { x: 300, z: -2500 });
    me.hp = me.maxHp / 2;
    cast(g, me, rolls);
    expect(rolls[0].jackpot).toBe(true);
    expect(foe.mods.stunned).toBe(true);
    expect(foe.turrets.filter((k) => k.disabled > 7.5)).toHaveLength(2);
    expect(t.tethers.some((k) => k.target === foe.id)).toBe(true);
    expect(me.hp).toBeGreaterThan(me.maxHp / 2 + foe.stats.received * 0.4);
    expect(foe.stats.received).toBeGreaterThan(CUBE.die.damage * 1.5);
  });
  it('leaves the cube in the mode it rolled', () => {
    const { g, me, t, rolls } = roll(2, 'kinetic');
    cast(g, me, rolls);
    expect(t.cubes[0].mode).toBe(2);
    expect(t.mode).toBe(2);
  });
  it('keeps every Overdrive cube in its own mode whatever they roll', () => {
    const { g, me, t, rolls } = roll(0, 'repel', { x: 4000, z: 0 });
    me.meter = 1;
    me.activateSkill(B);
    run(g, 1);
    const modes = t.cubes.map((c) => c.mode);
    cast(g, me, rolls, 6);
    expect(t.cubes.map((c) => c.mode)).toEqual(modes);
    expect(t.mode).toBe(3);
  });
  it('rolls a spent cube without waking it', () => {
    const { g, me, t, rolls } = roll(0, 'repel');
    park(t.cubes[0], 0, -1000);
    t.energy = 0;
    t.spent = true;
    cast(g, me, rolls);
    expect(t.spent).toBe(true);
    expect(t.energy).toBeLessThan(0.5);
  });
  it('spends the store on its first hit', () => {
    const { g, me, foe, t, rolls } = roll(1, 'repel');
    t.charge = 300000;
    cast(g, me, rolls);
    expect(t.charge).toBe(0);
    expect(foe.stats.received).toBeCloseTo(CUBE.die.damage + 300000, -3);
  });
  it('rolls all six into a 300 m ring round the reticle in Overdrive', () => {
    const { g, me, t, rolls } = roll(0, 'repel', { x: 4000, z: 0 });
    me.meter = 1;
    me.activateSkill(B);
    run(g, 1);
    cast(g, me, rolls, 6);
    for (const c of t.cubes) expect(gap(c, { x: 0, z: -2500 })).toBeCloseTo(CUBE.die.ring, -1);
    const angles = t.cubes.map((c) => Math.atan2(c.z + 2500, c.x)).sort((a, b) => a - b);
    for (let i = 1; i < 6; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 3, 1);
  });
  it('fails while the cube is re-forming', () => {
    const { me, t } = duel();
    damageCube(me, t.cubes[0], CUBE.hp * 2, null);
    expect(me.activateSkill(X)).toBe(false);
    expect(me.skillFailure).toMatch(/re-forming/);
    expect(me.skills[X].cooldown).toBe(0);
  });
  it('is cast by the AI when a foe stands within reach', () => {
    const { g, me, foe } = duel(-2500);
    expect(aiWantsSkill(me, g, X, foe)).toBe(true);
    foe.pos.z = -6000;
    expect(aiWantsSkill(me, g, X, foe)).toBe(false);
  });
});

describe('Dock', () => {
  it('comes back every 10 s', () => {
    const { me } = duel();
    expect(me.skills[C].spec.cooldown).toBe(10);
  });
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
    hurl(g, me, 0, -3000);
    run(g, 2);
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
    hurl(g, me, 0, -3000);
    until(g, () => foe.stats.received > 0);
    expect(foe.stats.received).toBeGreaterThan(0);
    expect(side.stats.received).toBeCloseTo(foe.stats.received * HIT.shard.splash, -2);
    expect(foe.turrets.some((x) => x.disabled > 0)).toBe(true);
    expect(side.turrets.some((x) => x.disabled > 0)).toBe(true);
  });
  it('Repel knocks hulls aside', () => {
    const { g, me, foe } = duel();
    setMode(me, 'repel');
    hurl(g, me, 0, -3000);
    run(g, 5);
    expect(foe.stats.received).toBeGreaterThan(0);
    expect(gap(foe.pos, { x: 0, z: -1500 })).toBeGreaterThan(60);
  });
  it('Tether chains, slows and bleeds the target', () => {
    const { g, me, foe, t } = duel();
    setMode(me, 'tether');
    park(t.cubes[0], 0, -900);
    hurl(g, me, 0, -3000);
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
    hurl(g, me, 0, -3000);
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
  it('Kinetic: Ricochet+ bounces six times for 90k, each leg 15% faster', () => {
    const { g, me, foe, t } = duel();
    const two = extra(g, 'leviathan', 1, 800, -1500);
    const c = t.cubes[0];
    let hits = 0;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'hit' && e.ship === me) hits++;
    });
    expect(me.activateSkill(Z)).toBe(true);
    const speeds: number[] = [];
    for (let k = 0; k < 900 && c.state === 'flying'; k++) {
      if (c.path && c.path.speed !== speeds[speeds.length - 1]) speeds.push(c.path.speed);
      g.step(1 / 60);
    }
    expect(hits).toBe(SIGNATURE.ricochet.bounces);
    expect(SIGNATURE.ricochet.bounces).toBe(6);
    expect(speeds).toHaveLength(6);
    for (let i = 1; i < 6; i++) expect(speeds[i] / speeds[i - 1]).toBeCloseTo(1.15);
    expect(foe.stats.received + two.stats.received).toBeGreaterThanOrEqual(6 * 90000);
  });
  it('Ricochet+ needs an enemy within 2 km of the cube', () => {
    const { me } = duel(-3000);
    expect(me.activateSkill(Z)).toBe(false);
    expect(me.skills[Z].cooldown).toBe(0);
  });
  it('Crush: Pile Driver leaps onto the enemy nearest the reticle, pins it and drops beside it', () => {
    const { g, me, foe, t } = duel(-1500);
    setMode(me, 'crush');
    const c = t.cubes[0];
    park(c, 0, -500);
    // Nearer the cube, but farther from the reticle.
    const near = extra(g, 'leviathan', 1, -800, -600);
    expect(me.activateSkill(Z), me.skillFailure).toBe(true);
    until(g, () => c.state === 'pin', 3);
    expect(c.state).toBe('pin');
    expect(near.stats.received).toBe(0);
    expect(foe.stats.received).toBeCloseTo(SIGNATURE.pile.damage, -3);
    expect(SIGNATURE.pile.damage).toBe(200000);
    expect(foe.mods.stunned).toBe(true);
    expect(foe.mods.rooted).toBe(true);
    // Perched on the hull, which cannot move under it.
    expect(gap(c, foe.pos)).toBeLessThan(5);
    expect(c.y).toBeGreaterThan(foe.spec.freeboard + CUBE.edge / 2 - 1);
    const at = { x: foe.pos.x, z: foe.pos.z };
    run(g, SIGNATURE.pile.root - 0.2);
    expect(gap(foe.pos, at)).toBeLessThan(5);
    expect(c.state).toBe('pin');
    run(g, 0.5);
    expect(c.state).toBe('hover');
    expect(gap(c, foe.pos)).toBeGreaterThan(foe.spec.beam / 2 + CUBE.edge / 2);
    expect(c.y).toBeCloseTo(CUBE.hoverY);
  });
  it('Pile Driver needs an enemy within 2.5 km of the cube', () => {
    const { me, t } = duel(-4000);
    setMode(me, 'crush');
    park(t.cubes[0], 0, -1000);
    expect(me.activateSkill(Z)).toBe(false);
    expect(me.skillFailure).toMatch(/2\.5 km/);
  });
  it('Shard: Shrapnel Cone sprays 24 shards in a 40° cone, each striking the first hull on its ray for 25k', () => {
    const { g, me, foe, t } = duel(-1200);
    setMode(me, 'shard');
    park(t.cubes[0], 0, -500);
    // Broadside to the cone, with a second hull hidden right behind it and a third well off its edge.
    foe.heading = Math.PI / 2;
    const behind = extra(g, 'leviathan', 1, 0, -1900);
    behind.heading = Math.PI / 2;
    const wide = extra(g, 'leviathan', 1, 1500, -1000);
    aim(me, 0, -2500);
    expect(me.activateSkill(Z)).toBe(true);
    run(g, 0.05);
    const shards = foe.stats.received / SIGNATURE.cone.damage;
    expect(shards).toBeGreaterThan(4);
    expect(shards).toBeLessThanOrEqual(SIGNATURE.cone.shards);
    expect(Math.abs(shards - Math.round(shards))).toBeLessThan(0.05);
    expect(behind.stats.received).toBe(0);
    expect(wide.stats.received).toBe(0);
    // The cube stays where it was, a wall.
    expect(t.cubes[0].state).toBe('hover');
    expect(gap(t.cubes[0], { x: 0, z: -500 })).toBeLessThan(1);
  });
  it('Repel: Polarity Dash drives the ship 1.5 km away from the cube, through hulls for 100k', () => {
    const { g, me, t } = duel(-3000);
    setMode(me, 'repel');
    park(t.cubes[0], 0, -1500);
    const inWay = extra(g, 'leviathan', 1, 0, 800);
    inWay.heading = Math.PI / 2;
    expect(me.activateSkill(Z), me.skillFailure).toBe(true);
    expect(t.lunge).not.toBeNull();
    until(g, () => !t.lunge, 3);
    expect(me.pos.z).toBeCloseTo(SIGNATURE.dash.distance, -1);
    expect(Math.abs(me.pos.x)).toBeLessThan(5);
    expect(inWay.stats.received).toBeCloseTo(SIGNATURE.dash.damage, -3);
    expect(t.cubes[0].state).toBe('hover');
  });
  it('Polarity Dash heads for the reticle when the cube is docked', () => {
    const { g, me, t } = duel(-3000);
    setMode(me, 'repel');
    aim(me, 3000, 0);
    expect(me.activateSkill(Z), me.skillFailure).toBe(true);
    until(g, () => !t.lunge, 3);
    expect(me.pos.x).toBeCloseTo(SIGNATURE.dash.distance, -1);
  });
  it('Tether: Collide reels the two nearest hulls into each other for 150k and a stun each', () => {
    const { g, me, foe, t } = duel(-1500);
    setMode(me, 'tether');
    park(t.cubes[0], 0, -1200);
    foe.pos.x = -500;
    const two = extra(g, 'leviathan', 1, 500, -1500);
    const third = extra(g, 'leviathan', 1, 0, -2300);
    expect(me.activateSkill(Z), me.skillFailure).toBe(true);
    run(g, SIGNATURE.collide.time + 0.1);
    expect(gap(foe.pos, two.pos)).toBeLessThan(450);
    for (const o of [foe, two]) {
      expect(o.stats.received).toBeGreaterThanOrEqual(SIGNATURE.collide.damage - 1);
      expect(o.stats.received).toBeLessThan(SIGNATURE.collide.damage + 20000);
      expect(o.mods.stunned).toBe(true);
    }
    expect(third.stats.received).toBe(0);
    expect(gap(third.pos, { x: 0, z: -2300 })).toBeLessThan(30);
  });
  it('Collide reels a lone hull into the cube', () => {
    const { g, me, foe, t } = duel(-1500);
    setMode(me, 'tether');
    park(t.cubes[0], 900, -1500);
    expect(me.activateSkill(Z), me.skillFailure).toBe(true);
    run(g, SIGNATURE.collide.time + 0.1);
    expect(gap(foe.pos, t.cubes[0])).toBeLessThan(300);
    expect(foe.stats.received).toBeGreaterThanOrEqual(SIGNATURE.collide.damage - 1);
  });
  it('Mend: Sanctuary raises a 6 s, 900 m dome: allies inside heal 3% a second and take 40% less damage', () => {
    const { g, me, foe, t } = duel(-4000);
    setMode(me, 'mend');
    park(t.cubes[0], 0, -300);
    const ally = extra(g, 'leviathan', 0, 500, -300);
    const out = extra(g, 'leviathan', 0, 2500, 0);
    ally.hp = ally.maxHp / 2;
    out.hp = out.maxHp / 2;
    expect(me.activateSkill(Z)).toBe(true);
    run(g, 1);
    // Both hulls repair on their own as well; the dome adds 3% a second.
    expect(ally.hp / ally.maxHp - out.hp / out.maxHp).toBeCloseTo(SIGNATURE.sanctuary.heal, 3);
    const spec = foe.skills[0].spec;
    expect(ally.takeDamage(100000, foe, spec) / out.takeDamage(100000, foe, spec)).toBeCloseTo(0.6);
    run(g, SIGNATURE.sanctuary.time - 1 + 0.2);
    expect(ally.takeDamage(100000, foe, spec) / out.takeDamage(100000, foe, spec)).toBeCloseTo(1);
  });
  it('fires all six moves at once in Overdrive', () => {
    const { g, me, t } = duel(-1000);
    me.meter = 1;
    me.activateSkill(B);
    run(g, 1);
    extra(g, 'leviathan', 1, 600, -900);
    const fired: string[] = [];
    g.events.on('tungsten', (e) => {
      if (e.kind === 'signature') fired.push(TUNGSTEN_MODES[e.mode].signature.id);
    });
    expect(me.activateSkill(Z), me.skillFailure).toBe(true);
    expect(fired.sort()).toEqual(TUNGSTEN_MODES.map((m) => m.signature.id).sort());
    expect(t.cubes).toHaveLength(6);
  });
  it('lets the AI weigh each move on its own terms', () => {
    const { g, me, foe, t } = duel(-1500);
    setMode(me, 'tether');
    park(t.cubes[0], 0, -1200);
    expect(aiWantsSkill(me, g, Z, foe)).toBe(true);
    foe.pos.z = -4000;
    expect(aiWantsSkill(me, g, Z, foe)).toBe(false);
    setMode(me, 'mend');
    me.hp = me.maxHp * 0.5;
    // Sanctuary only helps when the ship is under the dome.
    expect(aiWantsSkill(me, g, Z, foe)).toBe(false);
    park(t.cubes[0], 0, -400);
    expect(aiWantsSkill(me, g, Z, foe)).toBe(true);
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
    t.charge = 990000;
    g.missiles.launch(foe, 0, 0, 0, 50000, { uninterceptable: true });
    run(g, 5);
    expect(t.charge).toBe(CUBE.chargeCap);
  });
  it('stores up to 1M, and 3M in Overdrive', () => {
    expect(CUBE.chargeCap).toBe(1_000_000);
    expect(CUBE.chargeCap * CUBE.orbit.cap).toBe(3_000_000);
  });
  it('squares the guarding cube up on its nearest face, turning no faster than the guard turn', () => {
    const { g, me, t } = duel();
    const c = t.cubes[0];
    expect(me.activateSkill(V)).toBe(true);
    run(g, 1);
    // Swing the reticle 100° round the ship: the nearest face is 10° away, not 100°.
    const b = bearingTo(me.pos.x, me.pos.z, 0, -1500) + (100 * Math.PI) / 180;
    aim(me, me.pos.x + forwardX(b) * 1500, me.pos.z + forwardZ(b) * 1500);
    const y0 = c.yaw;
    let most = 0;
    for (let k = 0; k < 60; k++) {
      const y = c.yaw;
      g.step(1 / 60);
      most = Math.max(most, Math.abs(c.yaw - y));
    }
    expect(most).toBeLessThanOrEqual(CUBE.guard.turn / 60 + 1e-9);
    expect(Math.abs(c.yaw - y0)).toBeLessThanOrEqual(Math.PI / 4 + 1e-6);
    // A face points straight at the reticle.
    const q = Math.PI / 2,
      off = (((c.yaw + bearingTo(me.pos.x, me.pos.z, me.control.aimX, me.control.aimZ)) % q) + q) % q;
    expect(Math.min(off, q - off)).toBeLessThan(1e-3);
  });
  it('strikes a hull it touches with the store behind it, once per interval, keeping the store', () => {
    const strike = (store: number) => {
      const { g, me, foe, t } = duel();
      expect(me.activateSkill(V)).toBe(true);
      run(g, 1);
      const c = t.cubes[0];
      t.charge = store;
      const hits: number[] = [];
      let last = foe.stats.received;
      // Hold the foe against the cube for just over two intervals.
      for (let k = 0; k < 100; k++) {
        foe.pos.x = c.x;
        foe.pos.z = c.z - 100;
        g.step(1 / 60);
        if (foe.stats.received > last) hits.push(foe.stats.received - last);
        last = foe.stats.received;
      }
      expect(t.charge).toBe(store);
      return hits;
    };
    const empty = strike(0),
      full = strike(1_000_000);
    expect(empty).toHaveLength(3);
    expect(empty[0]).toBeCloseTo(40000, -2);
    expect(full[0]).toBeCloseTo(140000, -2);
  });
  it('spends the store on the next cube hit', () => {
    const { g, me, foe, t } = duel();
    t.charge = 300000;
    hurl(g, me, 0, -3000);
    run(g, 5);
    expect(foe.stats.received).toBeGreaterThan(300000 + CUBE.shot.damage);
    expect(t.charge).toBe(0);
  });
  it('refills ultimate meters with the released store', () => {
    const gain = (charge: number) => {
      const { g, me, foe, t } = duel();
      me.meter = 0;
      t.charge = charge;
      hurl(g, me, 0, -3000);
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
  it('batters hulls from the orbit with 5% of the store behind each strike', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 1);
    expect(me.activateSkill(V)).toBe(true);
    run(g, 2);
    t.charge = 3_000_000;
    const c = t.cubes[0];
    let hit = 0;
    for (let k = 0; k < 60 && !hit; k++) {
      // Just outside the cube, away from the ship and the rest of the ring.
      const d = Math.max(1, gap(c, me.pos));
      foe.pos.x = c.x + ((c.x - me.pos.x) / d) * 100;
      foe.pos.z = c.z + ((c.z - me.pos.z) / d) * 100;
      g.step(1 / 60);
      hit = foe.stats.received;
    }
    expect(hit).toBeCloseTo(230000, -2);
    expect(t.charge).toBe(3_000_000);
  });
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
  });
  it('throws every cube abreast for free, and sends the extras home when it ends', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    t.energy = 0.5;
    me.activateSkill(B);
    expect(t.energy).toBe(1);
    // Let the first cube finish its lift into the halo.
    run(g, 0.5);
    hurl(g, me, 0, -2500);
    expect(t.cubes.every((c) => c.state === 'flying')).toBe(true);
    until(g, () => t.cubes.every((c) => c.state === 'hover'));
    // A line across the throw, one spread apart, centred on the reticle.
    const xs = t.cubes.map((c) => c.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(CUBE.shot.spread, 0);
    expect((xs[0] + xs[5]) / 2).toBeCloseTo(0, 0);
    for (const c of t.cubes) expect(c.z).toBeCloseTo(-2500, 0);
    expect(t.energy).toBe(1);
    run(g, CUBE.overdrive.time + 5);
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
    // Watch for casts rather than cooldowns left at the end: a kill cuts cooldowns short.
    let cast = false;
    for (let k = 0; k < 600; k++) {
      const before = me.skills.map((st) => st.cooldown);
      g.step(1 / 60);
      if (me.skills.some((st, i) => !st.spec.ult && st.cooldown > before[i] + 0.5)) cast = true;
    }
    expect(cast).toBe(true);
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
    expect(t.charge).toBe(CUBE.chargeCap * 3);
    run(g, CUBE.orbit.time - 3);
    expect(t.cubes.every((c) => c.state === 'orbit')).toBe(true);
    run(g, 3);
    expect(t.cubes.some((c) => c.state === 'orbit')).toBe(false);
  });
  it('keeps the central cube on the dais and floats the five in a pentagon round it', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    g.step(1 / 60);
    // The central cube never leaves the dais for the halo.
    expect(t.cubes[0].state).toBe('docked');
    run(g, 0.5);
    expect(t.cubes.every((c) => c.state === 'docked')).toBe(true);
    expect(gap(t.cubes[0], me.pos)).toBeLessThan(1);
    expect(t.cubes[0].y).toBeCloseTo(dockLift(me.spec), 0);
    const ring = t.cubes.slice(1);
    for (const c of ring) {
      expect(gap(c, me.pos)).toBeCloseTo(CUBE.ringRadius, 0);
      expect(c.y).toBeCloseTo(dockLift(me.spec) + CUBE.ringLift, 0);
    }
    // A pentagon: neighbours one fifth of the ring apart.
    const angles = ring.map((c) => Math.atan2(c.z - me.pos.z, c.x - me.pos.x)).sort((a, b) => a - b);
    for (let i = 1; i < 5; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo((Math.PI * 2) / 5, 2);
  });
  it('swaps the central cube with the next docked ring cube on Switch', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 0.5);
    const old = t.cubes[0],
      crush = t.cubes.find((c) => c.mode === modeIndex('crush'))!;
    const slot = crush.slot;
    expect(me.activateSkill(E), me.skillFailure).toBe(true);
    expect(t.cubes[0]).toBe(crush);
    expect(t.mode).toBe(modeIndex('crush'));
    expect([crush.slot, crush.extra, old.slot, old.extra]).toEqual([0, false, slot, true]);
    expect(t.cubes).toHaveLength(6);
    // They fly to each other's places rather than snapping.
    expect([crush.state, old.state]).toEqual(['flying', 'flying']);
    run(g, 1);
    expect([crush.state, old.state]).toEqual(['docked', 'docked']);
    expect(gap(crush, me.pos)).toBeLessThan(1);
    expect(gap(old, me.pos)).toBeCloseTo(CUBE.ringRadius, 0);
  });
  it('swaps past a ring cube that is out, and needs the central cube and a ring cube docked', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 0.5);
    park(t.cubes.find((c) => c.mode === modeIndex('crush'))!, 600, -400);
    expect(me.activateSkill(E), me.skillFailure).toBe(true);
    expect(t.mode).toBe(modeIndex('shard'));
    run(g, 1);
    park(t.cubes[0], -600, -400);
    expect(me.activateSkill(E)).toBe(false);
    expect(me.skillFailure).toBe('Switch: dock the central cube to swap it');
    Object.assign(t.cubes[0], { state: 'docked' });
    for (const c of t.cubes.slice(1)) park(c, 600, -800);
    expect(me.activateSkill(E)).toBe(false);
    expect(me.skillFailure).toBe('Switch: no other cube is docked');
    Object.assign(t.cubes[0], { state: 'broken', reform: 5 });
    expect(me.activateSkill(E)).toBe(false);
    expect(me.skillFailure).toBe('Switch: the cube is re-forming');
  });
  it('keeps the swapped-in central cube on the dais in its mode when Overdrive ends', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 0.5);
    expect(me.activateSkill(E)).toBe(true);
    const keeper = t.cubes[0];
    until(g, () => g.time >= t.overdriveUntil, 30);
    run(g, 2);
    expect(t.cubes).toEqual([keeper]);
    expect([keeper.state, keeper.slot, keeper.extra, keeper.mode, t.mode]).toEqual(['docked', 0, false, modeIndex('crush'), modeIndex('crush')]);
    expect(gap(keeper, me.pos)).toBeLessThan(1);
    expect(keeper.y).toBeCloseTo(dockLift(me.spec), 0);
  });
  it('lets the AI swap toward the mode it wants in Overdrive', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    me.activateSkill(B);
    run(g, 0.5);
    // Badly hurt, the AI wants Mend.
    me.hp = me.maxHp * 0.3;
    expect(aiWantsSkill(me, g, E, foe)).toBe(true);
  });
  it('throws the six abreast without any path crossing another', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    // Several halo angles, and throws at several bearings.
    for (const [wait, x, z] of [[1, 0, -2500], [3.3, 1800, -1600], [2.1, -2200, 900]]) {
      run(g, wait);
      for (const c of t.cubes) if (c.state === 'hover') Object.assign(c, { state: 'docked' });
      run(g, 0.05);
      const from = t.cubes.map((c) => ({ x: c.x, z: c.z }));
      t.reload = 0;
      hurl(g, me, x, z);
      const to = t.cubes.map((c) => ({ x: c.path!.tx, z: c.path!.tz }));
      const cross = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      for (let i = 0; i < 6; i++)
        for (let j = i + 1; j < 6; j++) {
          const meet = cross(from[i], to[i], from[j]) * cross(from[i], to[i], to[j]) < 0 && cross(from[j], to[j], from[i]) * cross(from[j], to[j], to[i]) < 0;
          expect(meet, `paths ${i} and ${j} cross throwing at ${x}, ${z}`).toBe(false);
        }
      until(g, () => t.cubes.every((c) => c.state === 'hover'));
    }
  });
  it('lunges to the central cube first in Overdrive, else to the hovering cube nearest the reticle', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 1);
    park(t.cubes[0], 0, -2500);
    park(t.cubes[3], 2400, 0);
    park(t.cubes[4], -2400, 0);
    aim(me, 2300, 100);
    expect(me.activateSkill(Q), me.skillFailure).toBe(true);
    expect(t.lunge!.cube).toBe(t.cubes[0].id);
    t.lunge = null;
    me.pos.set(0, 0, 0);
    Object.assign(t.cubes[0], { state: 'docked' });
    me.skills[Q].cooldown = 0;
    expect(me.activateSkill(Q), me.skillFailure).toBe(true);
    expect(t.lunge!.cube).toBe(t.cubes[3].id);
  });
  it('heals the ship once per Dock in Overdrive, whichever cube arrives first', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 1);
    Object.assign(t.cubes[0], { state: 'broken', reform: 30, hp: 0 });
    t.cubes.slice(1).forEach((c, i) => park(c, 600 + i * 100, -400));
    me.hp = me.maxHp / 2;
    expect(me.activateSkill(C), me.skillFailure).toBe(true);
    // Regeneration trickles in every tick; the Dock heal is the one big jump.
    const jumps: number[] = [];
    for (let k = 0; k < 600 && !t.cubes.slice(1).every((c) => c.state === 'docked'); k++) {
      const before = me.hp;
      g.step(1 / 60);
      if (me.hp - before > me.maxHp * 0.03) jumps.push(me.hp - before);
    }
    expect(t.cubes.slice(1).every((c) => c.state === 'docked')).toBe(true);
    expect(jumps).toHaveLength(1);
    expect(jumps[0] / me.maxHp).toBeCloseTo(CUBE.dock.heal, 2);
  });
  it('keeps a store built in Overdrive when the Shield captures fire after it ends', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 15);
    expect(me.activateSkill(V)).toBe(true);
    t.charge = 1_100_000;
    run(g, 6);
    expect(t.overdriveUntil).toBeLessThan(g.time);
    expect(t.cubes[0].state).toBe('orbit');
    const before = t.charge;
    absorbCube({ owner: me, cube: t.cubes[0], t: 0, capture: true }, 5000, null, 0, 0, 0);
    expect(t.charge).toBe(before);
  });
});

describe('Collapse', () => {
  it('drags enemies in, bursts with falloff and leaves the cube at the centre', () => {
    const { g, me, foe, t } = duel();
    // Repel's twist leaves the pull and the burst damage alone.
    setMode(me, 'repel');
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

describe('Collapse twists', () => {
  const TW = CUBE.collapse.twist;
  /** A Collapse on (0, -1500) in `mode`, with the duel's foe moved to (fx, fz). */
  function collapseIn(mode: string, fx = 100, fz = -1500) {
    const { g, me, foe, t } = duel();
    setMode(me, mode);
    foe.pos.x = fx;
    foe.pos.z = fz;
    aim(me, 0, -1500);
    const events: GameEventMap['tungsten'][] = [];
    g.events.on('tungsten', (e) => events.push(e));
    me.meter = 1;
    expect(me.activateSkill(R), me.skillFailure).toBe(true);
    return { g, me, foe, t, events };
  }
  const C = CUBE.collapse;
  const burstAt = C.travel + C.pull;
  const shell = (g: Game, from: Ship, x: number, z: number, tx: number, tz: number) =>
    g.shells.fire(from, { ammo: 'AP', spec: from.spec.main!.ap!, table: from.tableFor('AP')!, fromX: x, fromY: 40, fromZ: z, toX: tx, toY: 40, toZ: tz, dmgMul: 1, guaranteedFire: false, railgun: false, flat: 1 });

  it('Kinetic: the hole drifts toward the nearest enemy, and the cube with it', () => {
    const { g, t } = collapseIn('kinetic', 900, -1500);
    run(g, C.travel + 1);
    const u = t.ult!;
    expect(u.x).toBeGreaterThan(TW.kinetic.drift * 0.9 - 5);
    expect(u.x).toBeLessThan(TW.kinetic.drift * 1 + 5);
    expect(t.cubes[0].x).toBeCloseTo(u.x, 0);
  });

  it('Crush: pulls harder, disarms hulls in the core and bursts a quarter harder', () => {
    const pulled = (mode: string) => {
      const { g, foe } = collapseIn(mode);
      const far = extra(g, 'leviathan', 1, 1100, -1500);
      run(g, C.travel + 1.4);
      return { g, foe, far, x: far.pos.x };
    };
    const crush = pulled('crush'),
      repel = pulled('repel');
    expect(crush.x).toBeLessThan(repel.x - 40);
    expect(crush.foe.mods.disarmed).toBe(true);
    expect(repel.foe.mods.disarmed).toBe(false);
    run(crush.g, 2);
    expect(crush.foe.stats.received).toBeGreaterThan(C.burst * TW.crush.burst * 0.95);
  });

  it('Shard: swallows enemy shells in the pull and bursts into sixteen 40k fragments', () => {
    const { g, foe, events } = collapseIn('shard');
    run(g, C.travel + 0.5);
    shell(g, foe, 800, -1500, 800, 1500);
    run(g, 0.1);
    expect(g.shells.shells.filter((p) => p.alive)).toHaveLength(0);
    expect(events.some((e) => e.kind === 'capture')).toBe(true);
    run(g, 3);
    const frags = events.filter((e) => e.kind === 'fragment');
    expect(frags).toHaveLength(TW.shard.fragments);
    for (const f of frags) expect(Math.hypot(f.x, f.z + 1500)).toBeLessThanOrEqual(C.burstRadius + 1);
  });

  it('Repel: the burst flings survivors 900 m out and tears up fire within 2 km', () => {
    const { g, foe } = collapseIn('repel', 300, -1500);
    run(g, burstAt - 0.05);
    const d0 = Math.hypot(foe.pos.x, foe.pos.z + 1500);
    shell(g, foe, 1800, -1500, 1800, 1500);
    run(g, 0.1);
    expect(g.shells.shells.filter((p) => p.alive)).toHaveLength(0);
    run(g, 3);
    // Like every knockback, a long hull is flung less far.
    const fling = TW.repel.fling * Math.min(1, 180 / foe.spec.length);
    expect(Math.hypot(foe.pos.x, foe.pos.z + 1500) - d0).toBeGreaterThan(fling * 0.75);
  });

  it('Tether: hauls a fleeing hull in faster than it runs, and chains it for 4 s past the burst', () => {
    const { g, foe, t } = collapseIn('tether', 1000, -1500);
    foe.heading = Math.PI / 2;
    foe.throttle = 4;
    run(g, C.travel);
    foe.speed = 120;
    const x0 = foe.pos.x;
    run(g, 1);
    expect(foe.pos.x).toBeLessThan(x0 - 20);
    run(g, C.pull - 1 + 0.05);
    const chain = t.tethers.find((k) => k.target === foe.id);
    expect(chain).toBeDefined();
    expect(chain!.until - g.time).toBeCloseTo(TW.tether.time - 0.05, 1);
  });

  it("Mend: half the core's damage heals allies within 2 km, split evenly, and the burst heals the ship 10%", () => {
    const { g, me, foe } = collapseIn('mend');
    const near = extra(g, 'leviathan', 0, 800, -800);
    const far = extra(g, 'leviathan', 0, 3000, 1500);
    near.hp = near.maxHp / 2;
    far.hp = far.maxHp / 2;
    me.hp = me.maxHp / 2;
    run(g, burstAt - 0.1);
    const core = foe.stats.received;
    expect(core).toBeGreaterThan(0);
    // Both allies repair on their own; the near one also takes its share of the core.
    expect(near.hp - far.hp).toBeCloseTo((core * TW.mend.share) / 2, -3);
    const before = me.hp;
    run(g, 0.2);
    expect(me.hp - before).toBeGreaterThan(me.maxHp * TW.mend.burst);
  });

  it('merges all six twists in an Overdrive Collapse', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 600;
    me.meter = 1;
    me.activateSkill(B);
    run(g, 0.5);
    aim(me, 0, -1500);
    const events: GameEventMap['tungsten'][] = [];
    g.events.on('tungsten', (e) => events.push(e));
    me.skills[R].meter = 1;
    expect(me.activateSkill(R), me.skillFailure).toBe(true);
    run(g, C.travel + 1);
    expect(t.ult!.x).toBeGreaterThan(50);
    run(g, C.pull);
    expect(events.filter((e) => e.kind === 'fragment')).toHaveLength(TW.shard.fragments);
    expect(t.tethers.some((k) => k.target === foe.id)).toBe(true);
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
  it('drops every mode at the same pace', () => {
    const { g, me } = duel(-2000);
    me.meter = 1;
    me.activateSkill(B);
    aim(me, 0, -2000);
    me.skills[T].meter = 1;
    const at: number[] = [];
    g.events.on('tungsten', (e) => {
      if (e.kind === 'meteorImpact' && e.radius === CUBE.meteor.radius) at.push(g.time);
    });
    const t0 = g.time;
    expect(me.activateSkill(T)).toBe(true);
    run(g, 3.2);
    expect(at).toHaveLength(6);
    for (const k of at) expect(k - t0).toBeCloseTo(CUBE.meteor.rise + CUBE.meteor.grow + CUBE.meteor.fall, 1);
  });
  it('Kinetic: the meteor bounces onto the nearest enemy it missed for 40%', () => {
    const M = CUBE.meteor,
      B2 = M.bounce;
    const { g, me, t } = duel(-2000);
    const next = extra(g, 'leviathan', 1, 1300, -2000);
    aim(me, 0, -2000);
    const hits: GameEventMap['tungsten'][] = [];
    g.events.on('tungsten', (e) => {
      if (e.kind === 'meteorImpact') hits.push(e);
    });
    me.meter = 1;
    expect(me.activateSkill(T)).toBe(true);
    run(g, M.rise + M.grow + M.fall + 0.05);
    expect(hits).toHaveLength(1);
    const ring = next.stats.received;
    // The wider 30% ring reaches it first.
    expect(ring).toBeGreaterThan(0);
    run(g, B2.hop);
    expect(hits).toHaveLength(2);
    expect(hits[1].radius).toBeCloseTo(M.radius * B2.radius);
    expect(Math.hypot(hits[1].x - 1300, hits[1].z + 2000)).toBeLessThan(5);
    expect(next.stats.received - ring).toBeCloseTo(M.damage * B2.share, -4);
    run(g, M.shrink + 0.1);
    expect(t.ult).toBeNull();
    expect(t.cubes[0].scale).toBeCloseTo(1);
    expect(gap(t.cubes[0], { x: 1300, z: -2000 })).toBeLessThan(300);
  });
  it('Kinetic: with nothing else in reach the meteor stays where it fell', () => {
    const { g, me, t } = duel(-2000);
    aim(me, 0, -2000);
    let impacts = 0;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'meteorImpact') impacts++;
    });
    me.meter = 1;
    me.activateSkill(T);
    run(g, 5);
    expect(impacts).toBe(1);
    expect(gap(t.cubes[0], { x: 0, z: -2000 })).toBeLessThan(50);
  });
});

describe('Tungsten sync', () => {
  const script = (me: Ship, k: number) => {
    me.control.fire = k > 20 && k < 200;
    const at = [X, E, Z, V, B, E, T, R, C, Q];
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
    const fields: [() => void, () => void][] = [
      [() => (t.energy = 0.5), () => (t.energy = 1)],
      [() => (t.spent = true), () => (t.spent = false)],
      [() => (t.reload = 1), () => (t.reload = 0)],
      [() => (t.dockHeal = true), () => (t.dockHeal = false)],
    ];
    for (const [set, reset] of fields) {
      set();
      expect(stateHash(g)).not.toBe(h);
      reset();
      expect(stateHash(g)).toBe(h);
    }
    // A die roll hashes apart from a throw to the same spot.
    const path = (kind: 'shot' | 'die') => ({ kind, skill: X, tx: 0, ty: CUBE.hoverY, tz: -2000, speed: 1, hit: [], healed: [], dealt: 0, target: 0, bounces: 0 });
    expect(PATH_KINDS).toContain('die');
    t.cubes[0].path = path('shot');
    const shot = stateHash(g);
    t.cubes[0].path = path('die');
    expect(stateHash(g)).not.toBe(shot);
    t.cubes[0].path = null;
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
  it('throws its cube through the target, keeping a throw in reserve', () => {
    const g = emptyGame();
    const me = place(g, 'tungsten', 0, 0, 0, 0, true);
    const foe = place(g, 'leviathan', 1, 0, -2000, Math.PI);
    for (const st of me.skills) {
      st.cooldown = 1e9;
      st.meter = 0;
    }
    const t = me.tungsten!;
    let thrown = 0,
      spent = false;
    g.events.on('tungsten', (e) => {
      if (e.kind === 'throw' && e.ship === me) thrown++;
    });
    for (let k = 0; k < 20 * 60; k++) {
      g.step(1 / 60);
      spent ||= t.spent;
    }
    expect(thrown).toBeGreaterThanOrEqual(2);
    expect(foe.stats.received).toBeGreaterThanOrEqual(CUBE.shot.damage);
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
