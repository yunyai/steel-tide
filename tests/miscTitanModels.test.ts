import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, type BufferAttribute, type BufferGeometry, type Material, type Object3D } from 'three';
import { SHIP_BY_ID } from '../src/data/ships';
import type { ShipSpec } from '../src/core/types';
import type { Ship } from '../src/ships/Ship';
import { isMiscTitan, MiscTitanModel } from '../src/render/MiscTitanModels';
import { volume } from '../src/render/MiscTitanGeometry';

const dimensions = [
  ['judge', 400, 76, 14, 16],
  ['hexweaver', 370, 64, 13, 13],
  ['gourmand', 440, 100, 16, 17],
  ['faultline', 420, 88, 16, 15],
] as const;

function spec(id: string, length = 400, beam = 80, draft = 15, freeboard = 14): ShipSpec {
  return { ...SHIP_BY_ID.tungsten, id, length, beam, draft, freeboard };
}

function ship(active = false): Ship {
  return Object.freeze({
    alive: true, withdrawn: false,
    skills: Object.freeze(SHIP_BY_ID.tungsten.skills.map((s, index) => Object.freeze({
      spec: s, index, cooldown: active ? 4 : 0, active, time: active ? 2 : 0, meter: 0, data: {},
    }))),
  }) as unknown as Ship;
}

function transforms(root: Object3D): number[] {
  root.updateMatrixWorld(true);
  const values: number[] = [];
  root.traverse(o => values.push(...o.matrix.elements));
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe('misc titan models', () => {
  it('winds custom cloth and pressure-vessel surfaces outward so front-face culling cannot expose their interiors', () => {
    const geometry = volume([[0, 5, 5], [10, 5, 5]], 12);
    const normal = geometry.getAttribute('normal');
    expect(normal.getX(0)).toBeGreaterThan(.8);
    expect(normal.getY(26)).toBeCloseTo(-1, 4);
    expect(normal.getY(27)).toBeCloseTo(1, 4);
    geometry.dispose();
  });

  it('selects only the four complete replacement hulls', () => {
    for (const [id] of dimensions) expect(isMiscTitan(id)).toBe(true);
    for (const id of ['tungsten', 'stepper', 'hadal', 'yamato', 'judge-copy', '']) expect(isMiscTitan(id)).toBe(false);
  });

  it.each(dimensions)('%s preserves the simulation hull dimensions and builds finite, bounded geometry', (id, length, beam, draft, freeboard) => {
    const model = new MiscTitanModel(spec(id, length, beam, draft, freeboard));
    const hull = model.group.getObjectByName(`${id}-hull`)!;
    expect(hull).toBeTruthy();
    const box = new Box3().setFromObject(hull);
    expect(box.min.x).toBeCloseTo(-length / 2, 4);
    expect(box.max.x).toBeCloseTo(length / 2, 4);
    expect(box.min.y).toBeCloseTo(-draft, 4);
    expect(box.max.z - box.min.z).toBeCloseTo(beam, 4);
    const bounds = new Box3().setFromObject(model.group);
    expect(bounds.max.y).toBeGreaterThan(freeboard + 50);
    expect(bounds.max.y).toBeLessThan(240);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(length * 1.4);
    let draws = 0;
    model.group.traverse(o => {
      if (!(o instanceof Mesh)) return;
      draws++;
      expect(o.geometry.getAttribute('position').count).toBeGreaterThan(0);
      for (const attr of Object.values(o.geometry.attributes) as BufferAttribute[]) expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
    });
    expect(draws).toBeLessThan(100);
    for (const i of [0, 1]) expect(model.group.getObjectByName(`${id}-battery-${i}`)).toBeTruthy();
    model.dispose();
  });

  it.each(dimensions)('%s animates at rest and changes its machinery pose on skill activation without writing simulation state', (id) => {
    const model = new MiscTitanModel(spec(id));
    const idle = ship(), active = ship(true);
    model.update(idle, 0, 1 / 60);
    const atRest = transforms(model.group);
    model.update(idle, 1.7, 1 / 60);
    const moving = transforms(model.group);
    expect(moving).not.toEqual(atRest);
    model.update(active, 1.7, 0.25);
    const casting = transforms(model.group);
    expect(casting).not.toEqual(moving);
    expect(casting.every(Number.isFinite)).toBe(true);
    model.dispose();
  });

  it.each(dimensions)('%s responds to instant skills even when they never become active', (id) => {
    const model = new MiscTitanModel(spec(id));
    const idle = ship();
    model.update(idle, 1, .25);
    const before = transforms(model.group);
    const cast = { ...idle, skills: idle.skills.map((state, index) => ({ ...state, cooldown: index === 0 ? 6 : 0 })) } as Ship;
    model.update(cast, 1, .25);
    expect(transforms(model.group)).not.toEqual(before);
    model.dispose();
  });

  it('animates a charged Pin use without relying on the ordinary skill cooldown', () => {
    const model = new MiscTitanModel(spec('hexweaver'));
    model.update(ship(), 1, .25);
    const before = transforms(model.group);
    const pin = { ...ship(), hexweaver: { recharge: [6], dolls: [], decoy: null, needles: [] } } as unknown as Ship;
    model.update(pin, 1, .25);
    expect(transforms(model.group)).not.toEqual(before);
    model.dispose();
  });

  it('mirrors the aimed enemy’s doll on the Hexweaver’s effigy: its pins, flinches and twist', () => {
    const doll = (o: Record<string, number>) => ({ target: 7, pins: 0, pricks: 0, until: 99, stitchedUntil: 0, burnUntil: 0, burnNext: 1e9, struck: -1e9, pinnedAt: -1e9, twistedAt: -1e9, ...o });
    const hexed = (o: Record<string, number>) =>
      ({ ...ship(), game: { time: 10 }, control: { targetId: 7 }, hexweaver: { recharge: [], dolls: [doll(o)], decoy: null, needles: [] } }) as unknown as Ship;
    const pose = (o: Record<string, number>) => {
      const model = new MiscTitanModel(spec('hexweaver'));
      model.update(hexed(o), 1, .25);
      const t = transforms(model.group);
      model.dispose();
      return t;
    };
    const calm = pose({});
    expect(pose({ pins: 2 })).not.toEqual(calm);
    expect(pose({ struck: 10 })).not.toEqual(calm);
    expect(pose({ twistedAt: 10 })).not.toEqual(calm);
    expect(pose({ target: 8, pins: 2, struck: 10 })).not.toEqual(calm);
    expect(pose({ struck: 8 })).toEqual(calm);
  });

  it('gapes the Gourmand’s jaws while its mouth is open and snaps them on each chomp', () => {
    const kitchen = (o: Record<string, unknown>) =>
      ({ ...ship(), game: { time: 10 }, gourmand: { mouthUntil: 0, banquetUntil: 0, chompNext: 0, bite: null, swallow: null, ...o } }) as unknown as Ship;
    const pose = (o: Record<string, unknown>) => {
      const model = new MiscTitanModel(spec('gourmand'));
      model.update(kitchen(o), 1, .25);
      const t = transforms(model.group);
      model.dispose();
      return t;
    };
    const shut = pose({});
    // The last chomp was a while ago: the jaws simply hang open.
    const gaping = pose({ mouthUntil: 12, chompNext: 10.1 });
    expect(gaping).not.toEqual(shut);
    // A chomp this instant snaps them.
    expect(pose({ mouthUntil: 12, chompNext: 10.25 })).not.toEqual(gaping);
    expect(pose({ banquetUntil: 12 })).not.toEqual(shut);
    expect(pose({ bite: { target: 7, at: 10.5, x: 0, z: 0 } })).not.toEqual(shut);
    expect(pose({ swallow: { target: 7, until: 12, nextTick: 10.5, originX: 0, originZ: 0, heldX: 0, heldZ: 0 } })).not.toEqual(shut);
  });

  it('animates instant ultimates when their meter is spent', () => {
    const model = new MiscTitanModel(spec('judge'));
    const ready = { ...ship(), skills: ship().skills.map((state, index) => ({ ...state, spec: { ...state.spec, ult: index === 6 }, meter: 1 })) } as Ship;
    model.update(ready, 1, .25);
    const before = transforms(model.group);
    const spent = { ...ready, skills: ready.skills.map((state, index) => ({ ...state, meter: index === 6 ? 0 : 1 })) } as Ship;
    model.update(spent, 1, .25);
    expect(transforms(model.group)).not.toEqual(before);
    model.dispose();
  });

  it.each(dimensions)('%s releases every owned geometry and material once, even if disposed twice', (id) => {
    const model = new MiscTitanModel(spec(id));
    const resources = new Set<BufferGeometry | Material>();
    model.group.traverse(o => {
      if (!(o instanceof Mesh)) return;
      resources.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) resources.add(mat);
    });
    const counts = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource)! + 1));
    model.dispose();
    model.dispose();
    expect([...counts.values()].every(count => count === 1)).toBe(true);
  });

  it('keeps the hangar still when reduced motion is requested while showing active machinery states', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const model = new MiscTitanModel(spec('hexweaver'));
    model.update(ship(), 0, 1 / 60);
    const a = transforms(model.group);
    model.update(ship(), 20, 1 / 60);
    expect(transforms(model.group)).toEqual(a);
    model.update(ship(true), 20, 0.5);
    expect(transforms(model.group)).not.toEqual(a);
    model.dispose();
  });
});
