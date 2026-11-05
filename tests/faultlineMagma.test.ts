import { describe, expect, it, vi } from 'vitest';
import { NEW_MISC } from '../src/data/miscTitans';
import { stateHash } from '../src/net/hash';
import type { Ship } from '../src/ships/Ship';
import { FAULTLINE_SKILLS } from '../src/skills/misc/faultline';
import { FAULTLINE, faultlineRider, updateFaultline } from '../src/skills/misc/FaultlineRuntime';
import { faultlinePanel } from '../src/ui/MiscTitanPresentation';
import type { DynamicRidge } from '../src/world/GameMap';
import { emptyGame, place, run } from './helpers';

// The reworked Faultline: magma mortars that build pressure and open fractures, Uplift's eruption,
// Slip's wake, Aftershock's boulders, Bedrock's Rebound and the ultimates' numbers.

function arena() {
  const g = emptyGame('open', 411, 'freeplay');
  const s = place(g, 'faultline', 0, 0, 2500, Math.PI / 2);
  s.speed = 0;
  aim(s, 500, 2500);
  return { g, s };
}

function aim(s: Ship, x: number, z: number): void {
  s.control.aimX = x;
  s.control.aimZ = z;
}

/** An enemy too big to sink, so every hit shows in full. */
function dummy(g: Ship['game'], x: number, z: number, heading = 0): Ship {
  const v = place(g, 'yamato', 1, x, z, heading);
  v.maxHp = v.hp = 1e8;
  return v;
}

function cast(s: Ship, index: number): boolean {
  s.meter = 1;
  return s.activateSkill(index);
}

/** Runs only the Faultline's own update, so nothing else moves or hurts anyone. */
function tick(s: Ship, seconds: number): void {
  const n = Math.ceil(seconds * 60);
  for (let i = 0; i < n; i++) {
    s.game.time += seconds / n;
    updateFaultline(s, seconds / n);
  }
}

/** The damage each of `vs` took, one entry per tick it was hurt. */
function hits(s: Ship, vs: Ship[], seconds: number): number[][] {
  const out = vs.map(() => [] as number[]);
  const n = Math.ceil(seconds * 60);
  for (let i = 0; i < n; i++) {
    const before = vs.map((v) => v.hp);
    s.game.time += 1 / 60;
    updateFaultline(s, 1 / 60);
    vs.forEach((v, k) => {
      if (v.hp < before[k]) out[k].push(Math.round(before[k] - v.hp));
    });
  }
  return out;
}

function ridge(owner: number, o: Partial<DynamicRidge> = {}): DynamicRidge {
  return { id: 900, owner, x0: 1500, z0: 2000, x1: 1500, z1: 3000, width: 150, height: 75, expiresAt: 30, ...o };
}

describe('Faultline magma mortar', () => {
  it('lobs ember rocks of 38k AP and 24k HE every 8 s, half of them setting hulls alight', () => {
    const main = NEW_MISC.find((s) => s.id === 'faultline')!.main!;
    expect(main.look).toBe('magma');
    expect(main.ap!.damage).toBe(38000);
    expect(main.he!.damage).toBe(24000);
    expect(main.reload).toBe(8);
    expect(FAULTLINE.battery.fire).toBe(0.5);
  });

  it('adds a point of pressure for every round that strikes a hull, and sets about half of them alight', () => {
    const { g, s } = arena();
    const v = dummy(g, 1500, 2500);
    const fire = vi.spyOn(v, 'startFire').mockImplementation(() => undefined as never);
    for (let i = 0; i < 40; i++) faultlineRider(s).onHit!(v, v.pos.x, v.pos.z);
    expect(s.faultline!.pressure).toBe(40);
    expect(fire.mock.calls.length).toBeGreaterThan(8);
    expect(fire.mock.calls.length).toBeLessThan(32);
  });

  it('opens a 450 m fracture where the first round of every fourth salvo falls, pointing back at the Faultline', () => {
    const { s } = arena();
    for (let i = 0; i < 3; i++) faultlineRider(s).onLand!(1000, 2500);
    expect(s.faultline!.fractures).toHaveLength(0);
    const fourth = faultlineRider(s);
    fourth.onLand!(1200, 2500);
    fourth.onLand!(1300, 2700);
    expect(s.faultline!.fractures).toHaveLength(1);
    const f = s.faultline!.fractures[0];
    expect(Math.hypot(f.x1 - f.x0, f.z1 - f.z0)).toBeCloseTo(FAULTLINE.battery.fracture);
    expect((f.x0 + f.x1) / 2).toBeCloseTo(1200);
    expect((f.z0 + f.z1) / 2).toBeCloseTo(2500);
    expect(f.z1 - f.z0).toBeCloseTo(0);
    for (let i = 0; i < 3; i++) faultlineRider(s).onLand!(1000, 2500);
    expect(s.faultline!.fractures).toHaveLength(1);
    faultlineRider(s).onHit!(dummy(s.game, 900, 2500), 900, 2500);
    expect(s.faultline!.fractures).toHaveLength(2);
  });
});

describe('Faultline skills', () => {
  it('keeps the reworked cooldowns', () => {
    expect(FAULTLINE_SKILLS.map((d) => d.spec.cooldown)).toEqual([7, 12, 13, 9, 11, 20, 100, 100, 130]);
  });

  it('ruptures a Fault for 140k a pulse, each repeat on one ship 40% weaker', () => {
    const { g, s } = arena();
    const v = dummy(g, 450, 2500);
    expect(cast(s, 0)).toBe(true);
    const [got] = hits(s, [v], 2);
    expect(got.slice(0, 2)).toEqual([140000, 84000]);
  });

  it('erupts under a rising Uplift ridge: 120k and a knock to ships within 200 m of its line', () => {
    const { g, s } = arena();
    // Bow-on to the ridge: its hull ends ~170 m from the line, outside the band that gets moved aside.
    const near = dummy(g, 800, 2500, Math.PI / 2);
    const far = dummy(g, 1100, 2500, Math.PI / 2);
    expect(cast(s, 1)).toBe(true);
    tick(s, FAULTLINE.warning + 0.05);
    expect(g.map.dynamicRidges).toHaveLength(1);
    expect(1e8 - near.hp).toBe(120000);
    expect(near.pushX).toBeGreaterThan(0);
    expect(far.hp).toBe(1e8);
  });

  it('crushes a Subduction basin for 260k after its 2 s pull', () => {
    const { g, s } = arena();
    const v = dummy(g, 500, 2500);
    cast(s, 0);
    tick(s, 2);
    expect(cast(s, 2)).toBe(true);
    const [got] = hits(s, [v], 2.2);
    expect(got).toEqual([260000]);
  });

  it('lets Slip hit each ship it touches for 160k, then leaves a 25k/s magma wake for 4 s', () => {
    const { g, s } = arena();
    const v = dummy(g, 300, 2500);
    cast(s, 0);
    tick(s, 2);
    const pressure = s.faultline!.pressure;
    expect(cast(s, 3)).toBe(true);
    expect(s.faultline!.pressure).toBe(Math.min(100, pressure + 15));
    const [got] = hits(s, [v], 4.9);
    expect(got[0]).toBe(160000);
    expect(got.slice(1)).toEqual(Array(8).fill(12500));
    expect(s.faultline!.wakes).toHaveLength(0);
  });

  it('drops 80k of boulders from every ridge on ships within 450 m when Aftershock pulses', () => {
    const { g, s } = arena();
    g.map.dynamicRidges.push(ridge(s.id));
    const under = dummy(g, 1800, 2500);
    const clear = dummy(g, 2200, 2500);
    expect(s.faultline!.fractures).toHaveLength(0);
    expect(cast(s, 4)).toBe(true);
    const [a, b] = hits(s, [under, clear], 3);
    expect(a).toEqual([80000]);
    expect(b).toEqual([]);
  });

  it('pulses every fracture in Aftershock for 110k, repeats on one ship 40% weaker, six hits at most', () => {
    const { g, s } = arena();
    const v = dummy(g, 500, 2500);
    s.faultline!.fractures = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, x0: 300, z0: 2500, x1: 700, z1: 2500, expiresAt: 30 }));
    expect(cast(s, 4)).toBe(true);
    const [got] = hits(s, [v], 5);
    expect(got.slice(0, 2)).toEqual([110000, 66000]);
    expect(got).toHaveLength(6);
  });

  it('ends Bedrock in a Rebound of 60k + 2k per pressure within 600 m, keeping the pressure', () => {
    const { g, s } = arena();
    const v = dummy(g, 400, 2500);
    const far = dummy(g, 1300, 2500);
    s.faultline!.pressure = 50;
    expect(cast(s, 5)).toBe(true);
    tick(s, 6 - 0.1);
    expect(v.hp).toBe(1e8);
    tick(s, 0.2);
    expect(1e8 - v.hp).toBe(60000 + 50 * 2000);
    expect(far.hp).toBe(1e8);
    expect(s.faultline!.pressure).toBe(50);
  });

  it('tears a 280k rupture down the Continental Divide corridor', () => {
    const { g, s } = arena();
    aim(s, 1500, 2500);
    const v = dummy(g, 1500, 2500);
    expect(cast(s, 6)).toBe(true);
    const [got] = hits(s, [v], 3);
    expect(got[0]).toBe(280000);
  });

  it('erupts Caldera for 400k plus 5k per pressure, 900k at most, spending the pressure', () => {
    const { g, s } = arena();
    const v = dummy(g, 500, 2500);
    s.faultline!.pressure = 80;
    expect(cast(s, 7)).toBe(true);
    expect(s.faultline!.pressure).toBe(0);
    const [got] = hits(s, [v], 2.5);
    expect(got).toEqual([800000]);
    expect(FAULTLINE.caldera.damage + FAULTLINE.maxPressure * FAULTLINE.caldera.perPressure).toBe(900000);
  });

  it('sends a 320k Worldbreaker rupture through the fractures, then collapses each ridge in a 300k shockwave', () => {
    const { g, s } = arena();
    g.map.dynamicRidges.push(ridge(s.id));
    s.faultline!.fractures.push({ id: 901, x0: 2400, z0: 1800, x1: 2400, z1: 2200, expiresAt: 30 });
    const crack = dummy(g, 2400, 2000);
    const shore = dummy(g, 1800, 2500);
    expect(cast(s, 8)).toBe(true);
    const [a, b] = hits(s, [crack, shore], 5);
    expect(a[0]).toBe(320000);
    expect(b).toEqual([300000]);
    expect(g.map.dynamicRidges).toHaveLength(0);
  });

  it('replays deterministically and hashes its wakes, salvo count and pending Rebound', () => {
    const games = [emptyGame('open', 411, 'freeplay'), emptyGame('open', 411, 'freeplay')];
    for (const g of games) {
      const s = place(g, 'faultline', 0, 0, 2500, Math.PI / 2);
      aim(s, 500, 2500);
      place(g, 'yamato', 1, 1500, 2500);
      s.activateSkill(0);
      s.activateSkill(5);
      run(g, 1.5);
      s.activateSkill(3);
      run(g, 1);
    }
    const [a, b] = games;
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.ships[0].faultline!.wakes.length).toBeGreaterThan(0);
    a.ships[0].faultline!.salvos++;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

describe('Faultline panel', () => {
  it('fills the pressure gauge, glows hot from 80 and previews Caldera', () => {
    const { s } = arena();
    s.faultline!.pressure = 85;
    const p = faultlinePanel(s);
    expect(p.pressure).toBe(85);
    expect(p.hot).toBe(true);
    expect(p.caldera).toBe(400000 + 85 * 5000);
    s.faultline!.pressure = 79;
    expect(faultlinePanel(s).hot).toBe(false);
  });

  it('drains a pip for each fracture and its own ridges with the life each has left, and counts down Bedrock', () => {
    const { g, s } = arena();
    g.time = 10;
    s.faultline!.fractures.push({ id: 1, x0: 0, z0: 0, x1: 100, z1: 0, expiresAt: 10 + FAULTLINE.fractureLife / 2 });
    g.map.dynamicRidges.push(ridge(s.id, { expiresAt: 10 + FAULTLINE.ridgeLife / 4 }), ridge(s.id + 99, { id: 901 }));
    s.faultline!.bedrockUntil = 13;
    const p = faultlinePanel(s);
    expect(p.fractures).toEqual([0.5]);
    expect(p.ridges).toEqual([0.25]);
    expect(p.maxFractures).toBe(8);
    expect(p.maxRidges).toBe(6);
    expect(p.bedrock).toBeCloseTo(3);
  });
});
