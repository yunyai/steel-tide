import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/Game';
import type { GameEventMap } from '../src/core/Events';
import { NEW_MISC } from '../src/data/miscTitans';
import { stateHash } from '../src/net/hash';
import type { Ship } from '../src/ships/Ship';
import { hurt } from '../src/skills/kit';
import { miscBattery } from '../src/skills/misc/MiscBattery';
import { dollOf, effigyLure, HEX, hexMul, pinCharges, pinDoll } from '../src/skills/misc/HexweaverRuntime';
import { emptyGame, place, run } from './helpers';

// The Hexweaver: needle volleys that prick bound enemies until their dolls take free pins, pins
// that make every Hexweaver hit land harder, and skills that cash those pins out.

/** A sturdy enemy that holds still. */
function dummy(g: Game, x: number, z: number): Ship {
  const t = place(g, 'iowa', 1, x, z, Math.PI / 2);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 0;
  return t;
}

function aim(s: Ship, x: number, z: number): void {
  s.control.aimX = x;
  s.control.aimZ = z;
}

const lost = (t: Ship) => t.maxHp - t.hp;

function events(g: Game): GameEventMap['miscTitan'][] {
  const seen: GameEventMap['miscTitan'][] = [];
  g.events.on('miscTitan', (e) => seen.push(e));
  return seen;
}

describe('Hexweaver needle battery', () => {
  it('fires flat, fast 20k needles every 4 s', () => {
    const main = NEW_MISC.find((s) => s.id === 'hexweaver')!.main!;
    expect(main.look).toBe('needle');
    expect(main.ap!.damage).toBe(HEX.battery.damage);
    expect(main.reload).toBe(HEX.battery.reload);
    expect(main.ap!.velocity).toBeGreaterThan(1400);
  });

  it('turns every four needle hits on a bound enemy into a free pin, up to three', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    const free = dummy(g, 600, -2000);
    const rider = miscBattery(s, 0)!;
    pinDoll(s, t, true);
    const seen = events(g);
    for (let i = 0; i < 3; i++) rider.onHit(t, 0, -2000);
    expect(dollOf(s, t)).toMatchObject({ pins: 1, pricks: 3 });
    rider.onHit(t, 0, -2000);
    expect(dollOf(s, t)).toMatchObject({ pins: 2, pricks: 0 });
    expect(seen.filter((e) => e.kind === 'pin')).toHaveLength(1);
    for (let i = 0; i < 12; i++) rider.onHit(t, 0, -2000);
    expect(dollOf(s, t)!.pins).toBe(HEX.pin.max);
    rider.onHit(free, 600, -2000);
    expect(dollOf(s, free)).toBeUndefined();
  });

  it('makes a pinned enemy take 15% more per pin from the Hexweaver, and from no one else', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const other = place(g, 'iowa', 0, 0, 900);
    const t = dummy(g, 0, -2000);
    const rider = miscBattery(s, 0)!;
    expect(rider.hitMul!(t)).toBeCloseTo(1);
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    expect(hexMul(s, t)).toBeCloseTo(1.3);
    expect(rider.hitMul!(t)).toBeCloseTo(1.3);
    hurt(other, t, 100000, other.skills[0].spec);
    expect(lost(t)).toBeCloseTo(100000, 0);
  });
});

describe('Hexweaver skills', () => {
  it('pins for 70k from four charges, each back 5 s after it is spent', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 500, 0);
    aim(s, 500, 0);
    expect(s.activateSkill(0)).toBe(true);
    expect(lost(t)).toBeCloseTo(HEX.pin.damage, 0);
    for (let i = 0; i < 3; i++) expect(s.activateSkill(0)).toBe(true);
    expect(s.activateSkill(0)).toBe(false);
    expect(dollOf(s, t)!.pins).toBe(3);
    run(g, HEX.pin.recharge + 0.1);
    expect(pinCharges(s)).toBe(4);
  });

  it('keeps four dolls, dropping the oldest, and lets them expire', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const enemies = [0, 1, 2, 3, 4].map((i) => dummy(g, 500 + i * 400, 0));
    for (const t of enemies) pinDoll(s, t, true);
    expect(s.hexweaver!.dolls).toHaveLength(4);
    expect(dollOf(s, enemies[0])).toBeUndefined();
    run(g, HEX.pin.life + 0.1);
    expect(s.hexweaver!.dolls).toHaveLength(0);
  });

  it('stitches enemies within 1.2 km of the reticle: 100k, a 35% slow and their dolls stitched', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const a = dummy(g, 0, -2000);
    const b = dummy(g, 800, -2000);
    const out = dummy(g, 0, -3500);
    pinDoll(s, a, true);
    aim(s, 0, -2000);
    const speed = b.mods.speedMul;
    expect(s.activateSkill(1)).toBe(true);
    expect(lost(a)).toBeCloseTo(HEX.stitch.damage * hexMul(s, a), 0);
    expect(lost(b)).toBeCloseTo(HEX.stitch.damage, 0);
    expect(out.hp).toBe(out.maxHp);
    run(g, 1 / 60);
    expect(b.mods.speedMul).toBeCloseTo(speed * (1 - HEX.stitch.slow));
    expect(dollOf(s, a)!.stitchedUntil).toBeGreaterThan(g.time + 7);
  });

  it('echoes damage on a stitched doll to the others at 35%, at most 150k each', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const a = dummy(g, 0, -2000);
    const b = dummy(g, 800, -2000);
    for (const t of [a, b]) pinDoll(s, t, true);
    for (const d of s.hexweaver!.dolls) d.stitchedUntil = g.time + 8;
    aim(s, 0, -2000);
    s.skills[2].cooldown = 0;
    expect(s.activateSkill(2)).toBe(true);
    const dealt = lost(a);
    expect(lost(b)).toBeCloseTo(Math.min(HEX.stitch.echoCap, dealt * HEX.stitch.echo), 0);
  });

  it('twists for 160k + 45k per pin, spends a pin for 130k more, wrenches the heading 90° and slows', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    const bare = dummy(g, 0, 2000);
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    const heading = t.heading;
    aim(s, 0, -2000);
    expect(s.activateSkill(2)).toBe(true);
    expect(lost(t)).toBeCloseTo(HEX.twist.damage + 2 * HEX.twist.perPin + HEX.twist.consume, 0);
    expect(dollOf(s, t)!.pins).toBe(1);
    expect(Math.abs(Math.abs(t.heading - heading) - Math.PI / 2)).toBeLessThan(1e-6);
    run(g, 1 / 60);
    expect(t.mods.speedMul).toBeLessThan(0.51);
    s.skills[2].cooldown = 0;
    aim(s, 0, 2000);
    expect(s.activateSkill(2)).toBe(true);
    expect(lost(bare)).toBeCloseTo(HEX.twist.damage, 0);
  });

  it('burns dolls in the patch at 30k/s (+25% per pin) for 6 s, spreading through stitches', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const a = dummy(g, 0, -2000);
    const b = dummy(g, 3000, -2000);
    pinDoll(s, a, true);
    pinDoll(s, b, true);
    pinDoll(s, b, true);
    for (const d of s.hexweaver!.dolls) d.stitchedUntil = g.time + 8;
    aim(s, 0, -2000);
    expect(s.activateSkill(3)).toBe(true);
    const hit = lost(b);
    expect(hit).toBe(0);
    run(g, HEX.fire.time + 0.5);
    const burn = HEX.fire.burn * HEX.fire.time;
    expect(lost(b)).toBeCloseTo(burn * (1 + 2 * HEX.fire.perPin), -3);
    expect(lost(a)).toBeGreaterThan(HEX.fire.damage + burn);
  });

  it('rips for 150k, cashing out the burn left and 80k per pin, and erupts stitched dolls', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    const near = dummy(g, 300, -2000);
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    const d = dollOf(s, t)!;
    d.burnUntil = g.time + 4;
    d.burnNext = g.time + 10;
    d.stitchedUntil = g.time + 8;
    aim(s, 0, -2000);
    const seen = events(g);
    expect(s.activateSkill(4)).toBe(true);
    const cash = 4 * HEX.fire.burn * (1 + 2 * HEX.fire.perPin) + 2 * HEX.rip.perPin;
    expect(lost(t)).toBeCloseTo(HEX.rip.damage + cash + HEX.rip.erupt, 0);
    expect(lost(near)).toBeCloseTo(HEX.rip.damage + HEX.rip.erupt, 0);
    expect(d.pins).toBe(0);
    expect(d.burnUntil).toBeLessThanOrEqual(g.time);
    expect(seen.some((e) => e.kind === 'erupt')).toBe(true);
  });

  it('leaves a 300k effigy that draws AI fire within 2 km, then bursts for 150k in 600 m', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const near = place(g, 'stepper', 1, 1200, 0, 0, true);
    const far = place(g, 'stepper', 1, -3000, 0, 0, true);
    const close = dummy(g, 400, 0);
    aim(s, 0, -800);
    expect(s.activateSkill(5)).toBe(true);
    expect(s.pos.z).toBeLessThan(-700);
    expect(s.hexweaver!.decoy).toMatchObject({ x: 0, z: 0, hp: HEX.substitute.hp });
    expect(effigyLure(near)).toEqual({ x: 0, z: 0 });
    expect(effigyLure(far)).toBeNull();
    run(g, 0.5);
    expect(near.control.aimX).toBeCloseTo(0, 0);
    expect(near.control.aimZ).toBeCloseTo(0, 0);
    const before = lost(close);
    run(g, HEX.substitute.time);
    expect(s.hexweaver!.decoy).toBeNull();
    expect(lost(close) - before).toBeCloseTo(HEX.substitute.burst, 0);
  });

  it('opens a coven: a pin on every enemy within 1.8 km, all stitched 10 s, 50k/s for 6 s', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const a = dummy(g, 0, -2000);
    const b = dummy(g, 1200, -2000);
    const out = dummy(g, 0, -4200);
    aim(s, 0, -2000);
    s.meter = 1;
    expect(s.activateSkill(6)).toBe(true);
    for (const t of [a, b]) {
      expect(dollOf(s, t)).toMatchObject({ pins: 1 });
      expect(dollOf(s, t)!.stitchedUntil).toBeCloseTo(g.time + HEX.coven.stitch);
    }
    expect(dollOf(s, out)).toBeUndefined();
    run(g, HEX.coven.time + 0.5);
    expect(lost(b)).toBeGreaterThan(HEX.coven.dps * HEX.coven.time * 0.9);
    expect(out.hp).toBe(out.maxHp);
  });

  it('rains 24 needles of 40k over 3 s on the aimed enemy, +30% per pin', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    pinDoll(s, t, true);
    aim(s, 0, -2000);
    s.meter = 1;
    expect(s.activateSkill(7)).toBe(true);
    run(g, HEX.needles.time + 0.3);
    expect(lost(t)).toBeCloseTo(HEX.needles.count * HEX.needles.damage * (1 + HEX.needles.perPin), -3);
  });

  it('unmakes every doll for 300k + 150k per pin; stitched dolls blast 150k in 650 m; empty Unmaking fails', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    const near = dummy(g, 400, -2000);
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    dollOf(s, t)!.stitchedUntil = g.time + 8;
    s.meter = 1;
    expect(s.activateSkill(8)).toBe(true);
    run(g, 0.5);
    expect(lost(t)).toBeCloseTo(HEX.unmaking.damage + 2 * HEX.unmaking.perPin + HEX.unmaking.blast, 0);
    expect(lost(near)).toBeCloseTo(HEX.unmaking.blast, 0);
    expect(s.hexweaver!.dolls).toHaveLength(0);
    s.meter = 1;
    expect(s.activateSkill(8)).toBe(false);
  });
});

describe('Hexweaver state', () => {
  it('hashes pricks, the effigy and the needle rain', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    pinDoll(s, t, true);
    const h0 = stateHash(g);
    dollOf(s, t)!.pricks = 2;
    const h1 = stateHash(g);
    expect(h1).not.toBe(h0);
    s.hexweaver!.decoy = { x: 0, z: 0, hp: 1, until: 9 };
    expect(stateHash(g)).not.toBe(h1);
  });
});
