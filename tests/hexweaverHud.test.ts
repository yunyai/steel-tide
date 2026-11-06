import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { dollOf, HEX, pinDoll, prick, substitute } from '../src/skills/misc/HexweaverRuntime';
import { hexPanel, miscMarkerChip, miscVictimBanner } from '../src/ui/MiscTitanPresentation';
import { emptyGame, place, run } from './helpers';

// What the Hexweaver's HUD shows: its pins and doll shelf, the previews on the aimed doll, the chip
// on each bound enemy's marker and the banner a hexed captain sees.

function dummy(g: Game, x: number, z: number): Ship {
  const t = place(g, 'iowa', 1, x, z, Math.PI / 2);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 0;
  return t;
}

describe('Hexweaver panel', () => {
  it('keeps a doll on the shelf but hides its ship’s name and health while that ship is out of sight', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    pinDoll(s, t);
    expect(hexPanel(s, null).slots[0]).toMatchObject({ seen: true, name: t.name, hp: 1, pins: 1 });
    for (let i = 0; i < 4; i++) g.addSmoke(t.pos.x, t.pos.z, 1);
    const slot = hexPanel(s, null).slots[0];
    expect(slot.seen).toBe(false);
    expect(slot.name).not.toBe(t.name);
    expect(slot.hp).toBe(0);
    expect(slot.pins).toBe(1);
  });

  it('fills a pip per Pin charge as each one recovers', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    expect(hexPanel(s, null).pins).toEqual([1, 1, 1, 1]);
    pinDoll(s, t);
    pinDoll(s, t);
    run(g, HEX.pin.recharge / 2);
    const pins = hexPanel(s, null).pins;
    expect(pins.slice(0, 2)).toEqual([1, 1]);
    expect(pins[2]).toBeCloseTo(0.5, 1);
    expect(pins[3]).toBeCloseTo(0.5, 1);
  });

  it('shelves each doll with its ship, pins, pricks, life, fire and stitches', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const a = dummy(g, 0, -2000);
    const b = dummy(g, 900, -2000);
    pinDoll(s, a, true);
    pinDoll(s, a, true);
    pinDoll(s, b, true);
    prick(s, a);
    a.hp = a.maxHp / 2;
    const da = dollOf(s, a)!;
    da.burnUntil = g.time + 3;
    for (const d of s.hexweaver!.dolls) d.stitchedUntil = g.time + 8;
    const p = hexPanel(s, a);
    expect(p.slots).toHaveLength(2);
    expect(p.slots[0]).toMatchObject({ name: a.name, hp: 0.5, pins: 2, pricks: 1, burning: true, stitched: true, aimed: true });
    expect(p.slots[0].life).toBeCloseTo(1, 1);
    expect(p.slots[1]).toMatchObject({ name: b.name, pins: 1, aimed: false });
    expect(p.links).toEqual([[0, 1]]);
  });

  it('previews Twist, Rip and Unmaking on the aimed doll', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    dollOf(s, t)!.burnUntil = g.time + 2;
    const p = hexPanel(s, t).previews!;
    const pinned = 1 + 2 * HEX.pinBonus;
    expect(p.twist).toBeCloseTo((HEX.twist.damage + 2 * HEX.twist.perPin + HEX.twist.consume) * pinned);
    expect(p.rip).toBeCloseTo((HEX.rip.damage + 2 * HEX.fire.burn * (1 + 2 * HEX.fire.perPin) + 2 * HEX.rip.perPin) * pinned);
    expect(p.unmaking).toBeCloseTo((HEX.unmaking.damage + 2 * HEX.unmaking.perPin) * pinned);
    expect(hexPanel(s, null).previews).toBeNull();
  });

  it('flinches a slot for a moment after its ship is hurt, and twists it after a Twist', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    pinDoll(s, t, true);
    run(g, 1);
    expect(hexPanel(s, t).slots[0].flinch).toBe(0);
    s.control.aimX = 0;
    s.control.aimZ = -2000;
    expect(s.activateSkill(2)).toBe(true);
    const now = hexPanel(s, t).slots[0];
    expect(now.flinch).toBeCloseTo(1);
    expect(now.twist).toBeCloseTo(1);
    run(g, 1);
    expect(hexPanel(s, t).slots[0].flinch).toBe(0);
  });
});

describe('Hexweaver marks', () => {
  it('chips each bound enemy with its pins, alert at three', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 0, 800);
    const t = dummy(g, 0, -2000);
    expect(miscMarkerChip(ally, t)).toBeNull();
    pinDoll(s, t, true);
    expect(miscMarkerChip(ally, t)).toMatchObject({ kind: 'hexweaver', text: '✂ 1', alert: false });
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    expect(miscMarkerChip(s, t)).toMatchObject({ text: '✂ 3', alert: true });
    expect(miscMarkerChip(t, s)).toBeNull();
  });

  it('tells a hexed captain their pins, stitches and burn', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    expect(miscVictimBanner(t)).toBeNull();
    pinDoll(s, t, true);
    pinDoll(s, t, true);
    const b = miscVictimBanner(t)!;
    expect(b).toMatchObject({ kind: 'hexweaver', title: 'Hexed', alert: false, meter: { n: 2, cap: 3, mark: 3 } });
    expect(b.detail).toContain('+30%');
    const d = dollOf(s, t)!;
    d.stitchedUntil = g.time + 5;
    d.burnUntil = g.time + 5;
    const hot = miscVictimBanner(t)!;
    expect(hot.alert).toBe(true);
    expect(hot.detail).toContain('STITCHED');
    expect(hot.detail).toContain('BURNING');
    expect(miscVictimBanner(s)).toBeNull();
  });
});

describe('Hexweaver taunt banner', () => {
  it('tells a captain near the effigy that their guns are locked on it, and for how long', () => {
    const g = emptyGame();
    const s = place(g, 'hexweaver', 0, 0, 0);
    const near = place(g, 'iowa', 1, 0, 1200);
    const far = place(g, 'iowa', 1, 0, 4000);
    pinDoll(s, near, true);
    expect(substitute(s, 0, -800)).toBe(true);
    const b = miscVictimBanner(near)!;
    expect(b.kind).toBe('hexweaver');
    expect(b.title).toBe(`Taunted ${HEX.substitute.time.toFixed(1)} s`);
    expect(b.alert).toBe(true);
    expect(miscVictimBanner(far)).toBeNull();
  });
});
