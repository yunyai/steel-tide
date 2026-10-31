import { describe, expect, it } from 'vitest';
import { cubeMarkers, cubeReticle, cubeSlot, minimapCubes, tungstenPresentation } from '../src/ui/TungstenPresentation';
import { CUBE } from '../src/skills/misc/TungstenModes';
import { overdrive } from '../src/skills/misc/TungstenRuntime';
import { emptyGame, place } from './helpers';
import { TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';

function tungsten() {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'tungsten', 0, 0, 0);
  return { s, t: s.tungsten!, time: g.time };
}

const lines = (view: ReturnType<typeof tungstenPresentation>) => view.status.map((l) => l.text);

describe('Tungsten HUD presentation', () => {
  it('labels Switch and Signature with the current mode', () => {
    const { t, time } = tungsten();
    let view = tungstenPresentation(t, time, 0, 0);
    expect(view.switchLabel).toBe('KINETIC');
    expect(view.signatureLabel).toBe('RICOCHET');
    expect(view.accent).toBe('#3ff0ff');

    t.mode = 2;
    view = tungstenPresentation(t, time, 0, 0);
    expect(view.switchLabel).toBe('SHARD');
    expect(view.signatureLabel).toBe('CONE');
    expect(view.signatureTitle).toBe('Now Shrapnel Cone: 2.0 km toward the reticle.');
    t.mode = 3;
    expect(tungstenPresentation(t, time, 0, 0).signatureTitle).toBe('Now Polarity Dash: 1.5 km away from the cube.');
  });

  it('says where a pinning cube is', () => {
    const { t, time } = tungsten();
    t.cubes[0].state = 'pin';
    expect(tungstenPresentation(t, time, 0, 0).panel.where).toBe('Pinning a hull');
  });

  it('labels Switch with the central cube during Overdrive, and Signature with every mode', () => {
    const { s, t } = tungsten();
    overdrive(s);
    const time = s.game.time;
    t.overdriveUntil = time + 19.2;
    let view = tungstenPresentation(t, time, 0, 0);
    expect(view.switchLabel).toBe('KINETIC');
    expect(view.switchTitle).toBe('Central: Kinetic. Tap to swap in the Crush cube.');
    expect(view.signatureLabel).toBe('ALL');
    expect(lines(view)).toContain('Overdrive · all modes · 20s');
    // Swaps skip a cube that is out.
    Object.assign(t.cubes.find((c) => c.mode === 1)!, { state: 'hover' });
    expect(tungstenPresentation(t, time, 0, 0).switchTitle).toBe('Central: Kinetic. Tap to swap in the Shard cube.');
    t.cubes[0].state = 'hover';
    view = tungstenPresentation(t, time, 0, 0);
    expect(view.switchTitle).toBe('Central: Kinetic. Dock the central cube to swap it.');
  });

  it('leaves the cube and the store to the panel', () => {
    const { t, time } = tungsten();
    const c = t.cubes[0];
    Object.assign(c, { state: 'hover', x: 1800, z: -1435, hp: c.maxHp / 2 });
    t.charge = 240000;
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual([]);
    Object.assign(c, { state: 'broken', reform: 7.2 });
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual([]);
  });

  it('shows the Shield while it is up', () => {
    const { t, time } = tungsten();
    t.guardUntil = time + 4.5;
    t.charge = 240000;
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual(['Shield 5s']);
  });

  it("puts the mode's throw hit and passive in the Switch tooltip", () => {
    const { t, time } = tungsten();
    t.mode = 3;
    const title = tungstenPresentation(t, time, 0, 0).switchTitle;
    expect(title).toContain(`Throw: ${TUNGSTEN_MODES[3].hit}`);
    expect(title).toContain(`Passive: ${TUNGSTEN_MODES[3].passive}`);
  });

  it('counts live tethers', () => {
    const { t, time } = tungsten();
    t.tethers.push({ target: 5, cube: 0, skill: 3, until: time + 2, tick: 0 }, { target: 6, cube: 0, skill: 3, until: time + 1, tick: 0 }, { target: 7, cube: 0, skill: 3, until: time - 1, tick: 0 });
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual(['Tethered ×2']);
  });
});

const panel = (t: ReturnType<typeof tungsten>['t'], time: number) => tungstenPresentation(t, time, 0, 0).panel;

describe('Tungsten HUD cube card', () => {
  const hex = (i: number) => `#${TUNGSTEN_MODES[i].color.toString(16).padStart(6, '0')}`;

  it('shows a whole cube, four full pips and an empty store at rest', () => {
    const { t, time } = tungsten();
    expect(panel(t, time)).toEqual({
      where: 'Docked',
      glyph: { color: hex(0), hp: 1, store: 0 },
      glyphs: [],
      throws: { pips: 4, full: 4, partial: 0, text: '4 throws', low: false },
      cube: { frac: 1, text: '2.5M / 2.5M', low: false },
      store: { frac: 0, text: '0 / 1M' },
    });
  });

  it('counts the throws left in pips and says where the cube is', () => {
    const { t, time } = tungsten();
    const c = t.cubes[0];
    Object.assign(c, { state: 'hover', x: 1800, z: -1435, hp: 1.9e6, mode: 2 });
    t.mode = 2;
    t.energy = 0.3;
    const p = panel(t, time);
    expect(p.where).toBe('Out · 2.3 km');
    expect(p.glyph).toEqual({ color: hex(2), hp: 0.76, store: 0 });
    expect(p.throws).toMatchObject({ pips: 4, full: 1, text: '2 throws · recharging', low: false });
    expect(p.throws.partial).toBeCloseTo(0.2);
    expect(p.cube).toEqual({ frac: 0.76, text: '1.9M / 2.5M', low: false });
    c.state = 'flying';
    expect(panel(t, time).where).toBe('In flight · 2.3 km');
    t.energy = 0.2;
    expect(panel(t, time).throws).toMatchObject({ full: 0, text: '1 throw · recharging', low: true });
  });

  it('tells a spent cube how long it waits', () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { state: 'hover', x: 900, z: 0 });
    t.spent = true;
    t.energy = 0.4;
    const p = panel(t, time).throws;
    expect(p).toMatchObject({ pips: 4, full: 1, text: 'Spent · dock or wait 20s', low: true });
    expect(p.partial).toBeCloseTo(0.6);
  });

  it('counts down a shattered cube and empties its glyph', () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { state: 'broken', reform: 9, hp: 0 });
    const p = panel(t, time);
    expect(p.cube).toEqual({ frac: 1 - 9 / CUBE.reform, text: 'Re-forming 9s', low: true });
    expect(p.where).toBe('Shattered');
    expect(p.glyph.hp).toBe(0);
  });

  it('times the Shield on the store row and rings the glyph with the store', () => {
    const { t, time } = tungsten();
    t.guardUntil = time + 5.5;
    t.charge = 400000;
    const p = panel(t, time);
    expect(p.store).toEqual({ frac: 0.4, text: 'Shield 6s · 400k / 1M' });
    expect(p.glyph.store).toBe(0.4);
    t.guardUntil = 0;
    expect(panel(t, time).store).toEqual({ frac: 0.4, text: '400k / 1M' });
  });

  it('shows a store kept from Overdrive as full, not over its cap', () => {
    const { t, time } = tungsten();
    t.charge = 1_100_000;
    expect(panel(t, time).store).toEqual({ frac: 1, text: '1.1M / 1.1M' });
  });

  it('never leaves the store row empty', () => {
    const { s, t } = tungsten();
    const time = s.game.time;
    for (const state of ['docked', 'hover', 'flying', 'guard', 'broken', 'meteor', 'collapse', 'pin'] as const) {
      t.cubes[0].state = state;
      expect(panel(t, time).store.text).toMatch(/\/ 1M$/);
    }
    overdrive(s);
    expect(panel(t, time).store.text).toBe('0 / 3M');
  });

  it('shows the central cube big and the five round it in Overdrive, with free throws', () => {
    const { s, t } = tungsten();
    t.mode = t.cubes[0].mode = 2;
    overdrive(s);
    const time = s.game.time;
    const shard = t.cubes.find((c) => c.mode === 2)!;
    shard.hp = shard.maxHp / 4;
    Object.assign(t.cubes.find((c) => c.mode === 4)!, { state: 'broken', reform: 5 });
    t.charge = 1_500_000;
    t.energy = 0.1;
    const p = panel(t, time);
    expect(p.glyph).toEqual({ color: hex(2), hp: 0.25, store: 0.5 });
    // The ring in mode order, after the central cube's mode.
    expect(p.glyphs.map((g) => g.color)).toEqual([3, 4, 5, 0, 1].map(hex));
    expect(p.glyphs.map((g) => g.hp)).toEqual([1, 0, 1, 1, 1]);
    expect(p.glyphs.every((g) => g.store === 0.5)).toBe(true);
    expect(p.throws).toEqual({ pips: 4, full: 4, partial: 0, text: 'Overdrive · free throws', low: false });
    expect(p.store).toEqual({ frac: 0.5, text: '1.5M / 3M' });
  });

  it('counts the Overdrive cubes out and home rather than following one of them', () => {
    const { s, t } = tungsten();
    overdrive(s);
    const time = s.game.time;
    t.cubes.forEach((c) => (c.state = 'docked'));
    Object.assign(t.cubes[2], { state: 'hover', x: 900, z: 0 });
    Object.assign(t.cubes[4], { state: 'flying', x: 400, z: 0 });
    expect(panel(t, time).where).toBe('Overdrive · 2 out · 4 home');
    Object.assign(t.cubes[0], { state: 'broken', reform: 5 });
    expect(panel(t, time).where).toBe('Overdrive · 2 out · 3 home · 1 shattered');
  });
});

describe('Tungsten cube reticle', () => {
  it('times the throw from the cube to the reticle', () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { x: 0, z: 0 });
    // Kinetic flies at 1.5 times the base speed.
    expect(cubeReticle(t, time, 0, -1800)).toEqual({ text: `Throw 1.8 km, ${(1800 / (CUBE.shot.speed * 1.5)).toFixed(1)} s`, out: false });
  });

  it("flags a reticle past the cube's throw", () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { state: 'hover', x: 1000, z: 0 });
    expect(cubeReticle(t, time, 1000, -4100)).toEqual({ text: 'Beyond the 4 km throw: it lands short', out: true });
  });

  it('says why the cube cannot be thrown', () => {
    const { t, time } = tungsten();
    const c = t.cubes[0];
    t.spent = true;
    expect(cubeReticle(t, time, 0, -900)).toEqual({ text: 'Spent: Dock to throw', out: true });
    t.spent = false;
    Object.assign(c, { state: 'flying' });
    expect(cubeReticle(t, time, 0, -900)).toEqual({ text: 'Cube in flight', out: true });
    Object.assign(c, { state: 'broken', reform: 4.5 });
    expect(cubeReticle(t, time, 0, -900)).toEqual({ text: 'Cube re-forming · 5s', out: true });
  });

  it('times the other cubes in Overdrive while the main cube re-forms', () => {
    const { s, t } = tungsten();
    overdrive(s);
    Object.assign(t.cubes[0], { state: 'broken', reform: 9 });
    const { text, out } = cubeReticle(t, s.game.time, 0, -1800);
    expect(out).toBe(false);
    expect(text).toMatch(/^Throw /);
  });
});

describe('Tungsten fire button slot', () => {
  it('shows the throw reload, and why a throw is not ready', () => {
    const { t, time } = tungsten();
    expect(cubeSlot(t, time)).toEqual({ frac: 1, info: 'Ready' });
    t.reload = CUBE.shot.reload / 2;
    expect(cubeSlot(t, time)).toEqual({ frac: 0.5, info: `${(CUBE.shot.reload / 2).toFixed(1)}s` });
    t.reload = 0;
    t.spent = true;
    expect(cubeSlot(t, time)).toEqual({ frac: 0, info: 'Spent' });
    t.spent = false;
    t.cubes[0].state = 'broken';
    expect(cubeSlot(t, time)).toEqual({ frac: 0, info: 'Re-forming' });
  });

  it('stays ready in Overdrive while the main cube re-forms', () => {
    const { s, t } = tungsten();
    overdrive(s);
    t.cubes[0].state = 'broken';
    expect(cubeSlot(t, s.game.time)).toEqual({ frac: 1, info: 'Ready' });
  });
});

describe('Tungsten minimap markers', () => {
  it('marks cubes away from the magnet, for both sides', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const c = s.tungsten!.cubes[0];
    expect(minimapCubes(g.ships, 0)).toEqual([]);

    Object.assign(c, { state: 'hover', x: 900, z: -1200, mode: 4 });
    const marks = minimapCubes(g.ships, 1);
    expect(marks).toEqual([{ x: 900, z: -1200, color: `#${TUNGSTEN_MODES[4].color.toString(16).padStart(6, '0')}`, ally: false, size: 1 }]);
    expect(minimapCubes(g.ships, 0)[0].ally).toBe(true);
  });

  it('drops broken cubes and cubes of sunk ships, and grows for the meteor', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const c = s.tungsten!.cubes[0];
    Object.assign(c, { state: 'broken' });
    expect(minimapCubes(g.ships, 1)).toEqual([]);

    Object.assign(c, { state: 'meteor', scale: 8 });
    expect(minimapCubes(g.ships, 1)[0].size).toBe(8);

    s.alive = false;
    expect(minimapCubes(g.ships, 1)).toEqual([]);
  });

  it('leaves out cubes merged into a die, counting them out of the magnet', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    overdrive(s);
    const c = s.tungsten!.cubes[1];
    Object.assign(c, { state: 'merged', x: 900, z: -1200 });
    expect(minimapCubes(g.ships, 1)).toEqual([]);
    expect(cubeMarkers(g.ships, s, 0)).toEqual([]);
    expect(tungstenPresentation(s.tungsten!, g.time, 0, 0).panel.where).toBe('Overdrive · 1 out · 5 home');
  });
});

describe('Tungsten cube markers', () => {
  function sides() {
    const g = emptyGame('open', 7, 'freeplay');
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'tungsten', 1, 0, -5000);
    const mate = place(g, 'tungsten', 0, 2000, 0);
    return { g, me, foe, mate };
  }
  const out = (c: { state: string; x: number; y: number; z: number }, x: number, z: number, state = 'hover') => Object.assign(c, { state, x, z, y: CUBE.hoverY });

  it('labels an enemy cube with its mode, range and health', () => {
    const { g, me, foe } = sides();
    const c = foe.tungsten!.cubes[0];
    expect(cubeMarkers(g.ships, me, 0)).toEqual([]);
    out(c, 0, -2100);
    c.hp = c.maxHp * 0.25;
    const marks = cubeMarkers(g.ships, me, 0);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ owner: foe, cube: c, x: 0, z: -2100, label: 'Cube · Kinetic 2.1 km', hp: 0.25, color: '#3ff0ff', ally: false });
    expect(marks[0].y).toBeGreaterThan(c.y + CUBE.edge / 2);
    c.mode = 2;
    expect(cubeMarkers(g.ships, me, 0)[0].label).toBe('Cube · Shard 2.1 km');
  });

  it('shows only enemy cubes that can be shot', () => {
    const { g, me, foe } = sides();
    const c = foe.tungsten!.cubes[0];
    for (const state of ['flying', 'guard', 'orbit', 'pin']) {
      out(c, 0, -2100, state);
      expect(cubeMarkers(g.ships, me, 0)).toHaveLength(1);
    }
    for (const state of ['meteor', 'collapse', 'broken']) {
      out(c, 0, -2100, state);
      expect(cubeMarkers(g.ships, me, 0)).toEqual([]);
    }
  });

  it('shows your own and allied cubes while out, without a range', () => {
    const { g, me, mate } = sides();
    const c = mate.tungsten!.cubes[0];
    out(c, 2000, -900, 'guard');
    expect(cubeMarkers(g.ships, me, 0)).toEqual([expect.objectContaining({ owner: mate, label: 'Cube · Kinetic', ally: true, hp: 1 })]);
    // Your own ship's cube too, out on the water.
    expect(cubeMarkers(g.ships, mate, 0)).toHaveLength(1);
    c.state = 'docked';
    expect(cubeMarkers(g.ships, me, 0)).toEqual([]);
    out(c, 2000, -900, 'broken');
    expect(cubeMarkers(g.ships, me, 0)).toEqual([]);
  });

  it('drops the cubes of sunk, withdrawn or banished ships', () => {
    const { g, me, foe } = sides();
    out(foe.tungsten!.cubes[0], 0, -2100);
    for (const k of ['alive', 'withdrawn', 'banished'] as const) {
      if (k === 'alive') foe.alive = false;
      else if (k === 'withdrawn') foe.withdrawn = true;
      else foe.mods.banished = true;
      expect(cubeMarkers(g.ships, me, 0)).toEqual([]);
      foe.alive = true;
      foe.withdrawn = false;
      foe.mods.banished = false;
    }
  });
});
