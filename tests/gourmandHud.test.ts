import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { GOURMAND } from '../src/skills/misc/GourmandRuntime';
import { gourmandPanel, miscMarkerChip, miscVictimBanner } from '../src/ui/MiscTitanPresentation';
import { emptyGame, place, run } from './helpers';

// What the Gourmand's HUD shows: its three jars, the next salvo's flavour, what the cooker and
// Comfort Food would do now, a digestion bar and the Banquet timer; and what its victims see.

function kitchen(): { g: Game; s: Ship; t: Ship } {
  const g = emptyGame();
  const s = place(g, 'gourmand', 0, 0, 0);
  const t = place(g, 'stepper', 1, 0, -700);
  s.control.aimX = t.pos.x;
  s.control.aimZ = t.pos.z;
  return { g, s, t };
}

describe('Gourmand panel', () => {
  it('fills three jars to the pantry’s capacity and names the next salvo’s flavour', () => {
    const { s } = kitchen();
    expect(gourmandPanel(s).next).toMatchObject({ kind: null, label: 'PLAIN' });
    s.gourmand!.pantry = { shells: 2, explosives: 5, wreckage: 1 };
    const p = gourmandPanel(s);
    expect(p.jars.map((j) => [j.label, j.n])).toEqual([
      ['SHELL', 2],
      ['EXPLOSIVE', 5],
      ['SCRAP', 1],
    ]);
    expect(p.cap).toBe(GOURMAND.capacity);
    expect(p.next).toMatchObject({ kind: 'explosives', label: 'EXPLOSIVE' });
    expect(p.next.effect).toMatch(/fire/i);
  });

  it('previews the Pressure Cooker and Comfort Food on the current pantry', () => {
    const { s } = kitchen();
    s.gourmand!.pantry = { shells: 0, explosives: 4, wreckage: 8 };
    const p = gourmandPanel(s).previews;
    expect(p.cooker).toBe(GOURMAND.cooker.damage + 10 * GOURMAND.cooker.perIngredient);
    expect(p.heal).toBeCloseTo(s.maxHp * GOURMAND.comfort.heal + 12 * GOURMAND.comfort.perHeal);
    expect(p.shield).toBe(GOURMAND.comfort.shield + 12 * GOURMAND.comfort.perShield);
  });

  it('shows the swallowed ship digesting, and Banquet’s timer and wider pantry', () => {
    const { g, s, t } = kitchen();
    s.meter = 1;
    expect(s.activateSkill(7)).toBe(true);
    run(g, GOURMAND.swallow.warning + 0.1);
    const d = gourmandPanel(s).digest!;
    expect(d.name).toBe(t.name);
    expect(d.left).toBeCloseTo(GOURMAND.swallow.time - 0.1, 1);
    s.meter = 1;
    expect(s.activateSkill(6)).toBe(true);
    const p = gourmandPanel(s);
    expect(p.banquet).toBeCloseTo(GOURMAND.banquet.time);
    expect(p.cap).toBe(GOURMAND.banquetCapacity);
  });
});

describe('Gourmand victims', () => {
  it('warns the bitten ship to move, then counts down its time swallowed', () => {
    const { g, s, t } = kitchen();
    expect(miscVictimBanner(t)).toBeNull();
    s.meter = 1;
    s.activateSkill(7);
    expect(miscVictimBanner(t)).toMatchObject({ kind: 'gourmand', title: 'Bite incoming – move!', alert: true });
    run(g, GOURMAND.swallow.warning + 0.1);
    const b = miscVictimBanner(t)!;
    expect(b.title).toMatch(/^Swallowed \d\.\d s$/);
    expect(b.alert).toBe(true);
    expect(miscVictimBanner(s)).toBeNull();
  });

  it('chips a skewered, bitten or swallowed enemy on the Gourmand’s side', () => {
    const { g, s, t } = kitchen();
    const ally = place(g, 'iowa', 0, 0, 900);
    expect(miscMarkerChip(ally, t)).toBeNull();
    s.activateSkill(3);
    expect(miscMarkerChip(ally, t)).toMatchObject({ kind: 'gourmand', text: 'SKEWERED', alert: false });
    s.gourmand!.reel = null;
    s.meter = 1;
    s.activateSkill(7);
    expect(miscMarkerChip(ally, t)).toMatchObject({ kind: 'gourmand', text: 'BITE', alert: true });
    run(g, GOURMAND.swallow.warning + 0.1);
    expect(miscMarkerChip(s, t)).toMatchObject({ kind: 'gourmand', text: 'SWALLOWED', alert: true });
    expect(miscMarkerChip(t, s)).toBeNull();
  });
});
