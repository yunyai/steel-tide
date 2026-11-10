import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { PHAROS, pharosDamage } from '../src/skills/misc/PharosRuntime';
import { miscMarkerChip, miscTitanKind, miscVictimBanner, pharosPanel } from '../src/ui/MiscTitanPresentation';
import { emptyGame, place, run } from './helpers';

// What the Pharos's HUD shows: where its beams point off the bow, the ships and buoys in reach,
// when the sweep next reaches the target and what the lamp would deal it; and what its victims see.

function lighthouse(): { g: Game; s: Ship; t: Ship } {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'pharos', 0, 0, 0);
  s.throttle = 2;
  const t = place(g, 'iowa', 1, 1500, 0);
  t.throttle = 2;
  t.hp = t.maxHp = 1e8;
  return { g, s, t };
}

const record = (t: Ship, o: Partial<{ stacks: number; until: number; dazzledUntil: number }> = {}) => ({ target: t.id, stacks: 0, until: 0, inBeam: false, gainedAt: 0, decayAt: 1e9, dazzledUntil: 0, ...o });

describe('Pharos panel', () => {
  it('is the Pharos’s kind of panel', () => {
    const { s, t } = lighthouse();
    expect(miscTitanKind(s)).toBe('pharos');
    expect(miscTitanKind(t)).toBeNull();
  });

  it('gives each beam’s bearing off the bow, and none while dark', () => {
    const { g, s } = lighthouse();
    s.heading = Math.PI / 2;
    s.pharos!.bearing = Math.PI;
    let p = pharosPanel(s, null);
    expect(p.beams).toHaveLength(1);
    expect(p.beams[0].rel).toBeCloseTo(Math.PI / 2, 6);
    expect(p.beams[0].half).toBeCloseTo(PHAROS.halfWidth, 6);
    s.pharos!.twinUntil = g.time + 5;
    p = pharosPanel(s, null);
    expect(p.beams).toHaveLength(2);
    expect(p.beams[1].rel).toBeCloseTo(-Math.PI / 2, 6);
    s.pharos!.darkUntil = g.time + 5;
    expect(pharosPanel(s, null).beams).toHaveLength(0);
  });

  it('marks buoys and seen enemy ships on the dial, the aimed one flagged', () => {
    const { g, s, t } = lighthouse();
    const far = place(g, 'iowa', 1, 0, 4200);
    const cloaked = place(g, 'iowa', 1, 0, -1500);
    cloaked.mods.untargetable = true;
    s.pharos!.buoys.push({ id: 1, x: 0, z: 1600, expiresAt: g.time + PHAROS.buoy.life / 2, flaredAt: 0 });
    s.pharos!.lit.push(record(t, { until: g.time + 2 }));
    const p = pharosPanel(s, t);
    expect(p.buoys).toHaveLength(1);
    expect(p.buoys[0]).toBeCloseTo(0.5, 2);
    expect(p.maxBuoys).toBe(PHAROS.buoy.max);
    expect(p.blips).toHaveLength(2);
    const buoy = p.blips.find((b) => b.kind === 'buoy')!;
    expect(Math.abs(buoy.rel)).toBeCloseTo(Math.PI, 6);
    expect(buoy.at).toBeCloseTo(0.5, 6);
    const ship = p.blips.find((b) => b.kind === 'lit')!;
    expect(ship.rel).toBeCloseTo(Math.PI / 2, 6);
    expect(ship.aimed).toBe(true);
    void far;
  });

  it('tells the target’s Exposure, light, next pass and what the lamp would deal it', () => {
    const { g, s, t } = lighthouse();
    let p = pharosPanel(s, t);
    expect(p.target).toMatchObject({ stacks: 0, cap: PHAROS.maxExposure, lit: false, inReach: true, shadowed: false });
    expect(p.target!.pass).toBeGreaterThan(2);
    expect(p.target!.pass).toBeLessThan(2.5);
    expect(p.previews!.lance).toBe(pharosDamage.lance(0) * s.mods.damageMul);
    s.pharos!.lit.push(record(t, { stacks: 4, until: g.time + 2 }));
    p = pharosPanel(s, t);
    expect(p.target).toMatchObject({ stacks: 4, lit: true });
    expect(p.previews!.daybreak).toBe(pharosDamage.daybreak(4) * s.mods.damageMul * s.mods.ultDamageMul);
    expect(p.previews!.daybreak).toBeGreaterThan(p.previews!.lance);
    g.map.addDynamicRidge({ id: 1, owner: 99, x0: 700, z0: -300, x1: 700, z1: 300, width: 60, height: 75, expiresAt: 1e9 });
    expect(pharosPanel(s, t).target!.shadowed).toBe(true);
    t.pos.x = 4000;
    expect(pharosPanel(s, t).target).toMatchObject({ inReach: false, pass: null });
    expect(pharosPanel(s, null)).toMatchObject({ target: null, previews: null });
    expect(pharosPanel(s, s).target).toBeNull();
  });
});

describe('what the Pharos’s victims and allies see', () => {
  it('chips an exposed ship for the Pharos’s side only', () => {
    const { g, s, t } = lighthouse();
    const friend = place(g, 'iowa', 0, -600, 0);
    expect(miscMarkerChip(friend, t)).toBeNull();
    s.pharos!.lit.push(record(t, { stacks: 3, until: g.time + 1 }));
    expect(miscMarkerChip(friend, t)).toEqual({ kind: 'pharos', text: '☀ 3', alert: false });
    expect(miscMarkerChip(t, s)).toBeNull();
    s.pharos!.lit[0].stacks = PHAROS.maxExposure;
    expect(miscMarkerChip(s, t)!.alert).toBe(true);
  });

  it('tells a lit ship its Exposure and how to shake the lamp', () => {
    const { g, s, t } = lighthouse();
    expect(miscVictimBanner(t)).toBeNull();
    s.pharos!.lit.push(record(t, { stacks: 5, until: g.time + 2 }));
    let b = miscVictimBanner(t)!;
    expect(b).toMatchObject({ kind: 'pharos', title: 'In the light', alert: false, meter: { n: 5, cap: PHAROS.maxExposure } });
    expect(b.detail).toMatch(/\+30%/);
    expect(b.detail).toMatch(/land/);
    s.pharos!.lit[0].until = 0;
    b = miscVictimBanner(t)!;
    expect(b.title).toBe('Exposed');
    expect(b.detail).toMatch(/fades/);
  });

  it('warns a dazzled ship, and a lured one above all', () => {
    const { g, s, t } = lighthouse();
    s.pharos!.lit.push(record(t, { stacks: 2, until: g.time + 2, dazzledUntil: g.time + 3.2 }));
    let b = miscVictimBanner(t)!;
    expect(b).toMatchObject({ kind: 'pharos', title: 'Dazzled 3.2 s', alert: true });
    s.pharos!.beacon = { x: 1500, z: 500, until: g.time + 3, lured: [{ target: t.id, until: g.time + 2.5 }] };
    b = miscVictimBanner(t)!;
    expect(b).toMatchObject({ kind: 'pharos', title: 'Lured 2.5 s', alert: true });
    expect(b.detail).toMatch(/false light/);
  });

  it('goes quiet once the Pharos is sunk', () => {
    const { g, s, t } = lighthouse();
    run(g, 2.6);
    expect(miscVictimBanner(t)).not.toBeNull();
    s.alive = false;
    expect(miscVictimBanner(t)).toBeNull();
  });
});
