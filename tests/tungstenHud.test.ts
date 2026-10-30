import { describe, expect, it } from 'vitest';
import { minimapCubes, tungstenPresentation } from '../src/ui/TungstenPresentation';
import { CUBE } from '../src/skills/misc/TungstenModes';
import { emptyGame, place } from './helpers';
import { TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';

function tungsten() {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'tungsten', 0, 0, 0);
  return { t: s.tungsten!, time: g.time };
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

  it("reports the cube only when there is something to say", () => {
    const { t, time } = tungsten();
    const c = t.cubes[0];
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual([]);

    c.hp = c.maxHp / 2;
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual(['Cube docked · 50%']);

    c.hp = c.maxHp;
    Object.assign(c, { state: 'hover', x: 1800, z: -1435 });
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual(['Cube out · 2.3 km']);

    Object.assign(c, { state: 'broken', reform: 7.2 });
    const broken = tungstenPresentation(t, time, 0, 0).status[0];
    expect(broken.text).toBe('Cube re-forming · 8s');
    expect(broken.buff).toBe(false);
  });

  it('shows the Shield and the damage it has stored', () => {
    const { t, time } = tungsten();
    t.guardUntil = time + 4.5;
    t.charge = 240000;
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual(['Shield 5s · 240k stored']);
    t.guardUntil = 0;
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual([`Charge 240k / ${CUBE.chargeCap / 1000}k`]);
  });

  it('counts live tethers', () => {
    const { t, time } = tungsten();
    t.tethers.push({ target: 5, cube: 0, skill: 3, until: time + 2, tick: 0 }, { target: 6, cube: 0, skill: 3, until: time + 1, tick: 0 }, { target: 7, cube: 0, skill: 3, until: time - 1, tick: 0 });
    expect(lines(tungstenPresentation(t, time, 0, 0))).toEqual(['Tethered ×2']);
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
