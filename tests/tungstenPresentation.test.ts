import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstancedBufferAttribute, Mesh, Scene, type Object3D } from 'three';
import { ShipView } from '../src/render/ShipModel';
import { TungstenModel } from '../src/render/TungstenModel';
import { TungstenCubeFx } from '../src/render/TungstenCubeFx';
import { modeColor } from '../src/render/TungstenLook';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import type { Ship } from '../src/ships/Ship';
import type { Game } from '../src/core/Game';
import { emptyGame, place, run } from './helpers';

// Skill slots: Q Lunge, E Switch, Z Signature, X Shot, C Dock, V Shield, R Collapse, T Meteor, B Overdrive.
const SWITCH = 1;
const SHOT = 3;
const DOCK = 4;
const OVERDRIVE = 8;

afterEach(() => vi.unstubAllGlobals());

function cast(s: Ship, slot: number): void {
  const skill = s.skills[slot];
  skill.cooldown = 0;
  if (skill.spec.ult) {
    skill.meter = 1;
    s.meter = 1;
  }
  expect(s.activateSkill(slot), s.skillFailure).toBe(true);
}

/** Steps the sim and the effects together, frame by frame, as the renderer does. */
function play(g: Game, fx: TungstenCubeFx, seconds: number, locals: Ship[] = []): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.step(1 / 60);
    g.interpolate();
    fx.update(1 / 60, locals);
  }
}

function freeCubes(scene: Scene): Object3D[] {
  return scene.children.filter((o) => o.name.startsWith('tungsten-free-cube-') && o.visible);
}

/** Every live instance in a batch has finite attributes, so nothing smears across the screen. */
function expectFinite(mesh: Mesh, count: number): void {
  for (const a of Object.values(mesh.geometry.attributes)) {
    if (!(a instanceof InstancedBufferAttribute)) continue;
    expect(Array.from(a.array).slice(0, count * a.itemSize).every(Number.isFinite)).toBe(true);
  }
}

function expectFiniteFx(fx: TungstenCubeFx, scene: Scene): void {
  expectFinite(fx.lines.mesh, fx.lines.count);
  expectFinite(fx.trails.mesh, fx.trails.count);
  for (const [name, batch] of Object.entries(fx.particles.stats)) {
    expect(batch.count).toBeLessThanOrEqual(batch.capacity);
    expectFinite(scene.getObjectByName(`tungsten-cube-fx-${name}`) as Mesh, batch.count);
  }
}

function transforms(root: Object3D): number[] {
  root.updateMatrixWorld(true);
  const out: number[] = [];
  root.traverse((o) => out.push(...o.matrix.elements));
  return out;
}

describe('Tungsten model', () => {
  it('fits the magnet only to the Tungsten', () => {
    const tungsten = new ShipView(SHIP_BY_ID.tungsten);
    const yamato = new ShipView(SHIP_BY_ID.yamato);
    expect(tungsten.tungstenModel).toBeInstanceOf(TungstenModel);
    expect(yamato.tungstenModel).toBeFalsy();
    tungsten.dispose();
    yamato.dispose();
  });

  it('sweeps the docked cube to the new mode colour after Switch, without touching game state', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const view = new ShipView(s.spec);
    const glow = view.tungstenModel!.cubes[0].u.uGlow.value;
    view.update(s, g.renderTime);
    expect(glow.equals(modeColor(0))).toBe(true);

    cast(s, SWITCH);
    run(g, 0.5);
    g.interpolate();
    const before = stateHash(g);
    view.update(s, g.renderTime);
    expect(s.tungsten!.mode).toBe(1);
    expect(glow.equals(modeColor(1))).toBe(true);
    expect(stateHash(g)).toBe(before);
    view.dispose();
  });

  it('freezes the Overdrive ring cubes under reduced motion', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    cast(s, OVERDRIVE);
    run(g, 1);
    g.interpolate();
    const moving = new TungstenModel((geo, m) => new Mesh(geo, m));
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const still = new TungstenModel((geo, m) => new Mesh(geo, m));
    // The ring cubes assemble over half a second after they first appear.
    moving.pose(0, s);
    still.pose(0, s);
    run(g, 0.6);
    g.interpolate();

    moving.pose(1, s);
    const a = transforms(moving.root);
    moving.pose(9, s);
    expect(transforms(moving.root)).not.toEqual(a);

    still.pose(1, s);
    const b = transforms(still.root);
    still.pose(9, s);
    expect(transforms(still.root)).toEqual(b);
    moving.dispose();
    still.dispose();
  });
});

describe('Tungsten cube effects', () => {
  it('draws a thrown cube with its trail, then dissolves its view once the cube docks', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    s.control.aimX = 0;
    s.control.aimZ = -2500;
    cast(s, SHOT);
    play(g, fx, 0.4, [s]);
    expect(s.tungsten!.cubes[0].state).toBe('flying');

    const before = stateHash(g);
    fx.prepare(0, 720);
    expect(freeCubes(scene)).toHaveLength(1);
    expect(fx.trails.count).toBeGreaterThan(0);
    expect(fx.particles.count).toBeGreaterThan(0);
    expectFiniteFx(fx, scene);
    expect(stateHash(g)).toBe(before);

    play(g, fx, 2, [s]);
    cast(s, DOCK);
    for (let i = 0; i < 10 && s.tungsten!.cubes[0].state !== 'docked'; i++) play(g, fx, 0.5, [s]);
    expect(s.tungsten!.cubes[0].state).toBe('docked');
    play(g, fx, 0.8, [s]);
    fx.prepare(0, 720);
    expect(freeCubes(scene)).toHaveLength(0);
    fx.dispose();
  });

  it('stays within its buffers under a flood of events', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    const kinds = ['break', 'hit', 'slam', 'signature', 'overdrive', 'shield', 'capture'] as const;
    for (let i = 0; i < 400; i++) {
      const kind = kinds[i % kinds.length];
      g.events.emit('tungsten', { ship: s, kind, cube: 0, x: i * 3, y: 40, z: -i * 2, radius: 600, mode: i % 6 });
    }
    fx.update(0.016, [s]);
    fx.prepare(0, 720);
    expect(fx.count).toBeGreaterThan(0);
    expect(fx.lines.count).toBeLessThanOrEqual(fx.lines.max);
    expect(fx.debris.count).toBeLessThanOrEqual(fx.debris.instanceMatrix.count);
    expectFiniteFx(fx, scene);
    fx.dispose();
  });

  it('clears every effect and free cube when the battle ends', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    s.control.aimX = 0;
    s.control.aimZ = -2500;
    cast(s, SHOT);
    play(g, fx, 0.4, [s]);
    fx.prepare(0, 720);
    expect(fx.count).toBeGreaterThan(0);

    g.finish(-1, 'test');
    fx.update(0.016, [s]);
    fx.prepare(0, 720);
    expect(fx.count).toBe(0);
    expect(freeCubes(scene)).toHaveLength(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("keeps a concealed enemy's magnet effects hidden but shows its free cube to everyone", () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 1, 0, 1500);
    place(g, 'yamato', 0, 0, -4000);
    const fx = new TungstenCubeFx(new Scene(), g);
    s.mods.untargetable = true;
    fx.prepare(0, 720);
    expect(fx.count).toBe(0);
    fx.prepare(1, 720);
    expect(fx.lines.count).toBeGreaterThan(0);

    s.control.aimX = 0;
    s.control.aimZ = 4000;
    cast(s, SHOT);
    play(g, fx, 0.4);
    s.mods.untargetable = true;
    fx.prepare(0, 720);
    expect(fx.trails.count).toBeGreaterThan(0);
    fx.dispose();
  });
});
