import { describe, expect, it } from 'vitest';
import { cubeReticle, cubeSlot, minimapCubes, tungstenPresentation } from '../src/ui/TungstenPresentation';
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
    expect(view.signatureLabel).toBe('STORM');
    expect(view.signatureTitle).toContain('Fragment Storm');
  });

  it('shows every mode at once during Overdrive', () => {
    const { t, time } = tungsten();
    t.overdriveUntil = time + 19.2;
    const view = tungstenPresentation(t, time, 0, 0);
    expect(view.switchLabel).toBe('ALL');
    expect(view.signatureLabel).toBe('ALL');
    expect(lines(view)).toContain('Overdrive · all modes · 20s');
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

  it("shows the Magnet Surge's overcharge", () => {
    const { t, time } = tungsten();
    t.surgeUntil = time + 3.2;
    const [line] = tungstenPresentation(t, time, 0, 0).status;
    expect(line).toEqual({ text: 'Surge · 4s', buff: true, icon: 'magnet' });
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

describe('Tungsten HUD panel', () => {
  it('shows a full magnet and a whole cube at rest', () => {
    const { t, time } = tungsten();
    expect(panel(t, time)).toEqual({
      where: 'Docked',
      energy: { frac: 1, text: '4 throws', low: false },
      cube: { frac: 1, text: '2.5M / 2.5M', low: false },
      store: null,
      cubes: [],
    });
  });

  it('counts the throws left and says where the cube is', () => {
    const { t, time } = tungsten();
    const c = t.cubes[0];
    Object.assign(c, { state: 'hover', x: 1800, z: -1435, hp: 1.9e6 });
    t.energy = 0.3;
    expect(panel(t, time).where).toBe('Out · 2.3 km');
    expect(panel(t, time).energy).toEqual({ frac: 0.3, text: '2 throws · recharging', low: false });
    expect(panel(t, time).cube).toEqual({ frac: 0.76, text: '1.9M / 2.5M', low: false });
    c.state = 'flying';
    expect(panel(t, time).where).toBe('In flight · 2.3 km');
    t.energy = 0.2;
    expect(panel(t, time).energy).toEqual({ frac: 0.2, text: '1 throw · recharging', low: true });
  });

  it('tells a spent cube how long it waits, docked or out', () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { state: 'hover', x: 900, z: 0 });
    t.spent = true;
    t.energy = 0.4;
    expect(panel(t, time).energy).toEqual({ frac: 0.4, text: 'Spent · dock or wait 20s', low: true });
    t.cubes[0].state = 'docked';
    expect(panel(t, time).energy.text).toBe('Spent · charging 2s');
  });

  it('marks free throws during Surge and Overdrive', () => {
    const { t, time } = tungsten();
    t.energy = 0.5;
    t.surgeUntil = time + 3.2;
    expect(panel(t, time).energy).toEqual({ frac: 0.5, text: 'Surge 4s · free throws', low: false });
    t.surgeUntil = 0;
    t.overdriveUntil = time + 10;
    expect(panel(t, time).energy.text).toBe('Overdrive · free throws');
  });

  it('counts down a shattered cube', () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { state: 'broken', reform: 9, hp: 0 });
    expect(panel(t, time).cube).toEqual({ frac: 1 - 9 / CUBE.reform, text: 'Re-forming 9s', low: true });
    expect(panel(t, time).where).toBe('Shattered');
  });

  it('fills the Shield store against its cap, doubled in Overdrive', () => {
    const { t, time } = tungsten();
    t.guardUntil = time + 3;
    expect(panel(t, time).store).toEqual({ frac: 0, text: '0k / 600k', low: false });
    t.charge = 240000;
    expect(panel(t, time).store).toEqual({ frac: 0.4, text: '240k / 600k', low: false });
    t.guardUntil = 0;
    t.overdriveUntil = time + 5;
    expect(panel(t, time).store).toEqual({ frac: 0.2, text: '240k / 1.2M', low: false });
  });

  it('shows a store kept from Overdrive as full, not over its cap', () => {
    const { t, time } = tungsten();
    t.charge = 1_100_000;
    expect(panel(t, time).store).toEqual({ frac: 1, text: '1.1M / 1.1M', low: false });
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

  it('gives every Overdrive cube a health bar in its own colour', () => {
    const { s, t } = tungsten();
    t.mode = t.cubes[0].mode = 2;
    overdrive(s);
    const shard = t.cubes.find((c) => c.mode === 2)!;
    shard.hp = shard.maxHp / 4;
    const bars = panel(t, s.game.time).cubes;
    expect(bars.map((b) => b.color)).toEqual(TUNGSTEN_MODES.map((m) => `#${m.color.toString(16).padStart(6, '0')}`));
    expect(bars.map((b) => b.frac)).toEqual([1, 1, 0.25, 1, 1, 1]);
  });
});

describe('Tungsten cube reticle', () => {
  it('times the throw from the cube to the reticle', () => {
    const { t, time } = tungsten();
    Object.assign(t.cubes[0], { x: 0, z: 0 });
    // Kinetic flies at 1.5 times the base speed.
    expect(cubeReticle(t, time, 0, -1800)).toEqual({ text: `Throw 1.8 km, ${(1800 / (CUBE.shot.speed * 1.5)).toFixed(1)} s`, out: false });
    t.surgeUntil = time + 2;
    expect(cubeReticle(t, time, 0, -1800).text).toBe(`Throw 1.8 km, ${(1800 / (CUBE.shot.speed * 1.5 * CUBE.surge.speed)).toFixed(1)} s`);
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
    expect(cubeReticle(t, time, 0, -900)).toEqual({ text: 'Spent: Dock or Surge to throw', out: true });
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
});
