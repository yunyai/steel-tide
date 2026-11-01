import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import type { ArchitectType } from '../src/data/architectLoadout';
import { ARCHETYPES } from '../src/data/architectLoadout';
import { architectGunReloadScale, setArchitectLoadout, vectorTuning } from '../src/skills/misc/ArchitectRuntime';
import { DOCKED, dockedHit, dockedHitMul, dockedType } from '../src/skills/misc/ArchitectDocked';
import { canTrack } from '../src/core/Targeting';
import { stateHash } from '../src/net/hash';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';

// Every Architect turret type grants a passive while it sits docked on the hull, and none while
// it is out on the water.

function architect(types: ArchitectType | ArchitectType[]) {
  const g = emptyGame('open', 713, 'freeplay');
  const s = place(g, 'architect', 0, 0, 2000);
  const list = Array.isArray(types) ? types : [types];
  setArchitectLoadout(s, Array.from({ length: 10 }, (_, i) => ({ type: list[i % list.length], skill: 0 as const })));
  s.secondaries.length = 0;
  s.refreshModifiers();
  return { g, s };
}

/** Sends every platform out onto the water, a pair at a time. */
function deployAll(g: Game, s: Ship): void {
  for (const [x, z] of [[-1200, 2000], [1200, 2000], [-1200, 1000], [1200, 1000], [0, 3200]]) {
    s.control.aimX = x;
    s.control.aimZ = z;
    s.skills[0].cooldown = 0;
    expect(s.activateSkill(0)).toBe(true);
    run(g, 2);
  }
  expect(s.architect!.slots.every((a) => a.state !== 'docked')).toBe(true);
  s.refreshModifiers();
}

/** A tough, idle enemy lying broadside to the Architect's bow. */
function target(g: Game, x: number, z: number, id = 'iowa'): Ship {
  const t = place(g, id, 1, x, z, Math.PI / 2);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 0;
  return t;
}

/** Turret 4 faces the bow, where every target in these tests lies. */
const BOW = 4;

/** One docked gun fires at `t`; runs until its shells are spent. */
function volley(g: Game, s: Ship, t: Ship, index = BOW): void {
  s.control.aimX = t.pos.x;
  s.control.aimZ = t.pos.z;
  for (let i = 0; i < 120 && !s.turrets[index].canBear; i++) run(g, 1 / 60);
  expect(s.fireTurret(index, 'AP', true)).toBe(true);
  for (let i = 0; i < 600 && g.shells.shells.some((x) => x.alive); i++) run(g, 1 / 60);
}

describe('Architect docked guns', () => {
  it('reload at the base rate when docked, still faster under Hunt and when deployed', () => {
    const { g, s } = architect('furnace');
    expect(architectGunReloadScale(s, 'docked')).toBe(1);
    expect(architectGunReloadScale(s, 'deployed')).toBe(0.5);
    s.architect!.huntUntil = g.time + 10;
    expect(architectGunReloadScale(s, 'docked')).toBeCloseTo(1 / 1.25);
  });

  it('name their type only while the platform is docked and whole', () => {
    const { g, s } = architect('prism');
    expect(dockedType(s, 3)).toBe('prism');
    expect(dockedType(s, 3)).toBe(s.architect!.slots[3].type);
    s.architect!.slots[3].hp = 0;
    expect(dockedType(s, 3)).toBe(null);
    s.architect!.slots[3].hp = 1;
    deployAll(g, s);
    expect(dockedType(s, 3)).toBe(null);
  });

  it('describe a docked passive for every type', () => {
    for (const a of Object.values(ARCHETYPES)) expect(a.docked, a.name).toMatch(/\w+: /);
  });
});

describe('docked passives that ride on the shells', () => {
  it('Kindling: a docked Furnace hit burns for three seconds, refreshed rather than stacked, harder per docked Furnace', () => {
    const { g, s } = architect('furnace');
    const t = target(g, 0, 500);
    dockedHit(s, 'furnace', t, 10000);
    run(g, 1);
    dockedHit(s, 'furnace', t, 10000);
    const before = t.stats.received;
    run(g, 5);
    // Stacked burns would add two more seconds of the first one on top. Ten Furnaces sit docked.
    expect(t.stats.received - before).toBeCloseTo(DOCKED.kindling.dps * 10 * DOCKED.kindling.time, -3);
  });

  it('Kindling comes from a real docked volley, and not from a deployed one', () => {
    const docked = architect('furnace');
    const t = target(docked.g, 0, 600);
    volley(docked.g, docked.s, t);
    expect(docked.s.architect!.kindling.some((k) => k.target === t.id)).toBe(true);

    // Deployed platforms fire their own shells, which carry no docked passive.
    const out = architect('furnace');
    const u = target(out.g, 0, 600);
    deployAll(out.g, out.s);
    run(out.g, 4);
    expect(u.stats.received).toBeGreaterThan(0);
    expect(out.s.architect!.kindling).toHaveLength(0);
  });

  it('Rime: a docked Cryo hit slows the target and its turrets for three seconds, to the cap with ten docked', () => {
    const { g, s } = architect('cryo');
    const t = target(g, 0, 500);
    const speed = t.mods.speedMul;
    const traverse = t.mods.traverseMul;
    dockedHit(s, 'cryo', t, 10000);
    run(g, 1 / 60);
    expect(t.mods.speedMul).toBeCloseTo(speed * (1 - DOCKED.rime.cap));
    expect(t.mods.traverseMul).toBeCloseTo(traverse * (1 - DOCKED.rime.cap));
    run(g, 3.1);
    expect(t.mods.speedMul).toBeCloseTo(speed);
  });

  it('Arc: a docked Storm hit arcs a quarter of its damage to the nearest other enemy within 600 m', () => {
    const { g, s } = architect('storm');
    const t = target(g, 0, 500);
    const near = target(g, 300, 500);
    const far = target(g, -900, 500);
    dockedHit(s, 'storm', t, 40000);
    expect(near.stats.received).toBeCloseTo(40000 * DOCKED.arc.share, -2);
    expect(far.stats.received).toBe(0);
  });

  it('Mass Driver: a docked Gravity gun fires faster shells that carry further', () => {
    const fast = architect('gravity');
    const slow = architect('furnace');
    for (const x of [fast, slow]) {
      const t = target(x.g, 0, -3000);
      x.s.control.aimX = t.pos.x;
      x.s.control.aimZ = t.pos.z;
      for (let i = 0; i < 120 && !x.s.turrets[BOW].canBear; i++) run(x.g, 1 / 60);
      expect(x.s.fireTurret(BOW, 'AP', true)).toBe(true);
    }
    const speed = (g: Game) => Math.hypot(g.shells.shells[0].vx, g.shells.shells[0].vy, g.shells.shells[0].vz);
    expect(speed(fast.g) / speed(slow.g)).toBeCloseTo(DOCKED.massDriver.velocity, 2);
    expect(fast.g.shells.shells[0].maxDist / slow.g.shells.shells[0].maxDist).toBeCloseTo(DOCKED.massDriver.reach, 2);
  });

  it('docked passives keep their timers in the battle hash', () => {
    const { g, s } = architect('furnace');
    const t = target(g, 0, 500);
    const before = stateHash(g);
    dockedHit(s, 'furnace', t, 1);
    const kindled = stateHash(g);
    expect(kindled).not.toBe(before);
    s.architect!.flakReadyAt += 1;
    expect(stateHash(g)).not.toBe(kindled);
  });

  it('Lens: a docked Prism gun hits a quarter harder, half again against a shield', () => {
    const prism = architect('prism');
    const plain = architect('furnace');
    const shells = [prism, plain].map((x) => {
      const t = target(x.g, 0, -3000);
      x.s.control.aimX = t.pos.x;
      x.s.control.aimZ = t.pos.z;
      for (let i = 0; i < 120 && !x.s.turrets[BOW].canBear; i++) run(x.g, 1 / 60);
      expect(x.s.fireTurret(BOW, 'AP', true)).toBe(true);
      return x.g.shells.shells[0];
    });
    expect(shells[0].dmgMul / shells[1].dmgMul).toBeCloseTo(DOCKED.lens.damage, 5);
    const t = target(prism.g, 0, 400);
    expect(dockedHitMul('prism', t)).toBe(1);
    t.addShield(50000, 5);
    expect(dockedHitMul('prism', t)).toBeCloseTo(DOCKED.lens.shield / DOCKED.lens.damage);
    expect(dockedHitMul('furnace', t)).toBe(1);
  });
});

describe('docked passives on the hull', () => {
  it('Plating: each docked Bastion trims hull damage, with no cap, and none deployed', () => {
    const one = architect(['bastion', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace']);
    const base = architect('furnace').s.mods.damageTakenMul;
    expect(one.s.mods.damageTakenMul / base).toBeCloseTo(1 - DOCKED.plating.dr);
    const all = architect('bastion');
    expect(all.s.mods.damageTakenMul / base).toBeCloseTo(1 - DOCKED.plating.dr * 10);
    const plain = architect('furnace');
    deployAll(all.g, all.s);
    deployAll(plain.g, plain.s);
    expect(all.s.mods.damageTakenMul).toBeCloseTo(plain.s.mods.damageTakenMul);
  });

  it('Sonar Net: docked Abyss reveals submarines within 2.5 km and turns torpedo damage aside', () => {
    const { g, s } = architect('abyss');
    const sub = place(g, 'hadal', 1, 0, 2000 - 2200);
    const farSub = place(g, 'hadal', 1, 3500, 2000);
    for (const x of [sub, farSub]) {
      x.depthState = 2;
      x.throttle = 0;
    }
    run(g, 12);
    expect(sub.deep).toBe(true);
    expect(canTrack(s, sub)).toBe(true);
    expect(canTrack(s, farSub)).toBe(false);
    expect(s.mods.torpTakenMul).toBeCloseTo(1 - DOCKED.sonar.torpCap);
    deployAll(g, s);
    run(g, 1);
    expect(canTrack(s, sub)).toBe(false);
    expect(s.mods.torpTakenMul).toBeCloseTo(1);
  });

  it('Watch: docked Sentinels find hidden surface ships and periscope boats, further with each one', () => {
    const { g, s } = architect(['sentinel', 'furnace']);
    const cloaked = target(g, 0, 2000 - 5500);
    cloaked.addEffect({ id: 'cloak-test', time: 100, apply: (m) => (m.untargetable = true) });
    const boat = place(g, 'hadal', 1, 1500, 2000);
    boat.depthState = 1;
    boat.throttle = 0;
    run(g, 12);
    expect(boat.submerged && !boat.deep).toBe(true);
    // Five docked Sentinels: 4 km plus a kilometre for each extra, 8 km in all.
    expect(canTrack(s, cloaked)).toBe(true);
    expect(canTrack(s, boat)).toBe(true);
    const lone = architect(['sentinel', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace']);
    const far = target(lone.g, 0, 2000 - 5500);
    far.addEffect({ id: 'cloak-test', time: 100, apply: (m) => (m.untargetable = true) });
    run(lone.g, 1);
    expect(canTrack(lone.s, far)).toBe(false);
  });

  it('Field Repair: each docked Restoration repairs a share of the hull every second, with no cap', () => {
    const heal = (types: ArchitectType[]) => {
      const { g, s } = architect(types);
      run(g, 3);
      s.hp = s.maxHp / 2;
      const before = s.hp;
      run(g, 1);
      return { gained: s.hp - before, s };
    };
    const furnace = Array<ArchitectType>(10).fill('furnace');
    const plain = heal(furnace);
    const one = heal(['restoration', ...furnace.slice(1)]);
    const lots = heal(['restoration', 'restoration', 'restoration', 'restoration', 'restoration', ...furnace.slice(5)]);
    const mul = one.s.mods.regenMul, full = one.s.architect!.fullHp;
    expect(one.gained - plain.gained).toBeCloseTo(full * DOCKED.fieldRepair.perSecond * mul, -3);
    expect(lots.gained - plain.gained).toBeCloseTo(full * DOCKED.fieldRepair.perSecond * 5 * mul, -3);
  });

  it('Harmonic: docked Resonance speeds the other docked guns, with no cap, but not itself', () => {
    const { s } = architect(['resonance', 'furnace']);
    const furnace = s.architect!.slots[1];
    const resonance = s.architect!.slots[0];
    expect(architectGunReloadScale(s, 'docked', furnace)).toBeCloseTo(1 / (1 + DOCKED.harmonic.reload * 5));
    expect(architectGunReloadScale(s, 'docked', resonance)).toBe(1);
    const one = architect(['resonance', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace']);
    expect(architectGunReloadScale(one.s, 'docked', one.s.architect!.slots[1])).toBeCloseTo(1 / (1 + DOCKED.harmonic.reload));
  });

  it('Flak Nest: each docked Swarm downs one enemy missile or plane within 1.5 km every three seconds', () => {
    const { g, s } = architect(['swarm', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace']);
    const foe = target(g, -3000, -2000);
    // Two tough missiles flying past, out of the way of the hull, so only the flak can stop them.
    const fly = (z: number) => g.missiles.launch(foe, 4000, z, 0, 8000, { hp: 1e9, from: { x: -800, y: 40, z } });
    const missiles = [fly(2000 - 900), fly(2000 + 900)];
    const down = () => missiles.filter((m) => !m.alive).length;
    run(g, 1);
    expect(down()).toBe(1);
    run(g, 1.9);
    expect(down()).toBe(1);
    run(g, 0.2);
    expect(down()).toBe(2);
    expect(s.alive).toBe(true);
  });

  it('Flak Nest leaves the sky alone once the Swarm is deployed', () => {
    const { g, s } = architect('swarm');
    deployAll(g, s);
    const foe = target(g, -3000, -2000);
    const m = g.missiles.launch(foe, 4000, 2600, 0, 8000, { hp: 1e9, from: { x: -800, y: 40, z: 2600 } });
    run(g, 1);
    expect(m.alive).toBe(true);
  });

  it('Thrust Vanes: each docked Vector adds speed, rudder and a faster Hull Dash', () => {
    const docked = architect('vector');
    const out = architect('vector');
    const dash = vectorTuning(docked.s).dashRecharge;
    deployAll(out.g, out.s);
    const n = 10;
    expect(docked.s.mods.speedMul / out.s.mods.speedMul).toBeCloseTo(1 + DOCKED.vanes.speed * n);
    expect(docked.s.mods.rudderMul / out.s.mods.rudderMul).toBeCloseTo(1 + DOCKED.vanes.rudder * n);
    expect(vectorTuning(out.s).dashRecharge / dash).toBeCloseTo(1 + DOCKED.vanes.dash * n);
    const lone = architect(['vector', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace', 'furnace']);
    expect(vectorTuning(lone.s).dashRecharge).toBeCloseTo((dash * (1 + DOCKED.vanes.dash * n)) / (1 + DOCKED.vanes.dash));
  });
});
