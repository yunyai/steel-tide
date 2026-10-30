import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID, SHIPS } from '../src/data/ships';
import { eraOf, FACTIONS } from '../src/data/factions';
import { emptyGame, place, run } from './helpers';
import { Game } from '../src/core/Game';
import { navalRules } from '../server/rules';
import { TurnApplier } from '../src/net/navalTurns';
import { stateHash } from '../src/net/hash';
import { CUBE, TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';
import { cubeIntercept, damageCube, type Cube } from '../src/skills/misc/TungstenRuntime';
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
      'Tungsten Shot',
      'Dock',
      'Tungsten Shield',
      'Collapse',
      'Tungsten Meteor',
      'Overdrive',
    ]);
    expect(s.skills.filter((k) => k.ult)).toHaveLength(3);
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

describe('Tungsten Shot', () => {
  it('ploughs through each hull once and hovers at the reticle', () => {
    const { g, me, foe, t } = duel();
    aim(me, 0, -3000);
    expect(me.activateSkill(X)).toBe(true);
    run(g, 2);
    expect(foe.stats.received).toBeGreaterThan(80000);
    expect(foe.stats.received).toBeLessThan(80000 * 1.6 + 1);
    const c = t.cubes[0];
    expect(c.state).toBe('hover');
    expect(c.z).toBeCloseTo(-3000, -1);
    expect(c.y).toBeCloseTo(CUBE.hoverY);
  });
  it('clamps its throw to 4 km', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    aim(me, 0, -10000);
    me.activateSkill(X);
    run(g, 3);
    expect(gap(t.cubes[0], { x: 0, z: 0 })).toBeCloseTo(4000, -1);
  });
  it('stops a Crush cube on the first hull with a heavy stunning blow', () => {
    const { g, me, foe, t } = duel();
    const back = extra(g, 'leviathan', 1, 0, -2600);
    setMode(me, 'crush');
    aim(me, 0, -3500);
    me.activateSkill(X);
    run(g, 1.2);
    expect(foe.stats.received).toBeGreaterThan(120000);
    expect(foe.stats.received).toBeLessThan(140000);
    expect(foe.mods.stunned).toBe(true);
    expect(foe.mods.marked).toBe(true);
    run(g, 2);
    expect(back.stats.received).toBe(0);
    expect(t.cubes[0].state).toBe('hover');
    expect(t.cubes[0].z).toBeGreaterThan(-1800);
  });
  it('hovers short of an island in its path', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 3000;
    g.map.heightAt = (_x, z) => (z < -2000 ? 20 : -50);
    aim(me, 0, -3500);
    expect(me.activateSkill(X)).toBe(true);
    run(g, 3);
    expect(t.cubes[0].state).toBe('hover');
    expect(t.cubes[0].z).toBeGreaterThan(-2000);
    expect(t.cubes[0].z).toBeLessThan(-1600);
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
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 2);
    const first = foe.stats.received;
    me.hp = me.maxHp * 0.5;
    expect(me.activateSkill(C)).toBe(true);
    run(g, 3);
    expect(t.cubes[0].state).toBe('docked');
    expect(foe.stats.received - first).toBeGreaterThanOrEqual(50000);
    expect(me.hp).toBeGreaterThan(me.maxHp * 0.56 + 0.2 * 50000 - 1);
  });
  it('drags tethered enemies home with the cube', () => {
    const { g, me, foe } = duel();
    setMode(me, 'tether');
    aim(me, 0, -3000);
    me.activateSkill(X);
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
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 2);
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
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 2);
    expect(side.stats.received).toBeGreaterThan(30000);
    expect(side.stats.received).toBeLessThan(80000);
    expect(foe.turrets.some((x) => x.disabled > 0)).toBe(true);
    expect(side.turrets.some((x) => x.disabled > 0)).toBe(true);
  });
  it('Repel knocks hulls aside', () => {
    const { g, me, foe } = duel();
    setMode(me, 'repel');
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 3);
    expect(gap(foe.pos, { x: 0, z: -1500 })).toBeGreaterThan(60);
  });
  it('Tether chains, slows and bleeds the target', () => {
    const { g, me, foe } = duel();
    setMode(me, 'tether');
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 1);
    const hit = foe.stats.received;
    expect(foe.mods.speedMul).toBeCloseTo(0.6);
    run(g, 3);
    expect(foe.stats.received - hit).toBeGreaterThan(15000);
  });
  it('Mend heals the ship from damage dealt and allies it passes', () => {
    const { g, me } = duel();
    const ally = extra(g, 'leviathan', 0, 0, -800);
    ally.hp = ally.maxHp * 0.5;
    setMode(me, 'mend');
    me.hp = me.maxHp * 0.5;
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 2);
    expect(me.hp - me.maxHp * 0.5).toBeGreaterThan(20000);
    expect(ally.hp / ally.maxHp).toBeGreaterThanOrEqual(0.55);
    expect(ally.hp / ally.maxHp).toBeLessThan(0.6);
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
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 2);
    expect(foe.stats.received).toBeGreaterThan(380000);
    expect(t.charge).toBe(0);
  });
  it('releases the store without refilling ultimate meters', () => {
    const { g, me, t } = duel();
    me.meter = 0;
    t.charge = 300000;
    aim(me, 0, -3000);
    me.activateSkill(X);
    run(g, 2);
    expect(me.skills[R].meter).toBeLessThan(0.7);
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
    // The AI holds every skill while an ultimate is active; Overdrive must leave the cube skills open.
    expect(me.ultActive).toBe(false);
    expect(t.cubes).toHaveLength(6);
    expect(new Set(t.cubes.map((c) => c.mode)).size).toBe(6);
    run(g, 0.05);
    expect(me.mods.speedMul).toBeCloseTo(1.15);
    expect(me.mods.damageTakenMul).toBeCloseTo(0.88);
    expect(me.activateSkill(E)).toBe(false);
  });
  it('throws every cube and sends the extras home when it ends', () => {
    const { g, me, foe, t } = duel();
    foe.pos.x = 4000;
    me.meter = 1;
    me.activateSkill(B);
    aim(me, 0, -2500);
    expect(me.activateSkill(X)).toBe(true);
    run(g, 3);
    expect(t.cubes.every((c) => c.state === 'hover')).toBe(true);
    run(g, 22);
    expect(t.cubes).toHaveLength(1);
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
    expect(foe.stats.received).toBeGreaterThanOrEqual(40000);
    expect(foe.pos.x).toBeGreaterThan(470);
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
          [0, [0, 0, -2500, 0, -1]],
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
    run(g, 120);
    expect(me.alive).toBe(true);
    for (const c of me.tungsten!.cubes) expect([c.x, c.y, c.z, c.hp, c.scale].every(Number.isFinite)).toBe(true);
    expect(used.size).toBeGreaterThanOrEqual(7);
  });
});
