import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstancedBufferAttribute, Mesh, Scene, type Object3D } from 'three';
import { ShipView } from '../src/render/ShipModel';
import { TungstenModel } from '../src/render/TungstenModel';
import { TungstenCubeFx } from '../src/render/TungstenCubeFx';
import { modeColor } from '../src/render/TungstenLook';
import { CUBE } from '../src/skills/misc/TungstenModes';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import type { Ship } from '../src/ships/Ship';
import type { Game } from '../src/core/Game';
import { emptyGame, place, run } from './helpers';

// Skill slots: Q Lunge, E Switch, Z Signature, X Shot, C Dock, V Shield, R Collapse, T Meteor, B Overdrive.
const SWITCH = 1;
const SIGNATURE = 2;
const SHOT = 3;
const DOCK = 4;
const COLLAPSE = 6;
const METEOR = 7;
const OVERDRIVE = 8;
const CRUSH = 1;
const MEND = 5;

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

  it('shows the cube docked in its first mode in the ship preview', () => {
    const view = new ShipView(SHIP_BY_ID.tungsten);
    view.pose(1);
    const [cradle, ...ring] = view.tungstenModel!.cubes;
    expect(cradle.mesh.visible).toBe(true);
    expect(cradle.u.uAssemble.value).toBe(1);
    expect(cradle.u.uGlow.value.equals(modeColor(0))).toBe(true);
    expect(ring.every((c) => !c.mesh.visible)).toBe(true);
    view.dispose();
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

  it("keeps a concealed enemy's docked-cube moves and Restore pulse off its hidden hull", () => {
    const hidden = (mode: number) => {
      const g = emptyGame('open', 7, 'freeplay');
      const s = place(g, 'tungsten', 1, 0, 1500);
      place(g, 'yamato', 0, 0, -4000);
      const fx = new TungstenCubeFx(new Scene(), g);
      s.tungsten!.mode = s.tungsten!.cubes[0].mode = mode;
      return { g, s, fx };
    };
    const look = (s: Ship, fx: TungstenCubeFx, team: 0 | 1) => {
      s.mods.untargetable = true;
      fx.prepare(team, 720);
      return fx.count;
    };
    // Restore and Slam fired from the magnet: nothing for the enemy to see.
    for (const mode of [MEND, CRUSH]) {
      const { g, s, fx } = hidden(mode);
      cast(s, SIGNATURE);
      play(g, fx, 0.3);
      expect(look(s, fx, 1)).toBeGreaterThan(0);
      expect(look(s, fx, 0)).toBe(0);
      fx.dispose();
    }
    // Restore from a cube out at sea: its tide shows, but not the pulse on the hull.
    const { g, s, fx } = hidden(MEND);
    s.control.aimX = 0;
    s.control.aimZ = 4000;
    cast(s, SHOT);
    play(g, fx, 3);
    expect(s.tungsten!.cubes[0].state).toBe('hover');
    cast(s, SIGNATURE);
    play(g, fx, 0.3);
    expect(look(s, fx, 0)).toBeGreaterThan(0);
    expect(look(s, fx, 0)).toBeLessThan(look(s, fx, 1));
    fx.dispose();
  });
});

describe('Tungsten ultimate effects', () => {
  const lenses = (fx: TungstenCubeFx) => fx.distortions.filter((d) => d.kind === 'lens');
  const hole = (scene: Scene) => scene.getObjectByName('tungsten-singularity');

  function collapsing(): { g: Game; s: Ship; scene: Scene; fx: TungstenCubeFx } {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    place(g, 'yamato', 1, 300, -2000);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    s.control.aimX = 0;
    s.control.aimZ = -2000;
    cast(s, COLLAPSE);
    return { g, s, scene, fx };
  }

  it('opens a lensing black hole while Collapse holds, without touching game state', () => {
    const { g, s, scene, fx } = collapsing();
    play(g, fx, CUBE.collapse.travel / 2, [s]);
    fx.prepare(0, 720);
    expect(fx.singularities.count).toBe(0);

    play(g, fx, CUBE.collapse.travel / 2 + 1, [s]);
    const before = stateHash(g);
    fx.prepare(0, 720);
    expect(s.tungsten!.ult?.kind).toBe('collapse');
    expect(fx.singularities.count).toBe(1);
    expect(hole(scene)).toBeTruthy();
    expect(lenses(fx)).toHaveLength(1);
    expectFiniteFx(fx, scene);
    expect(stateHash(g)).toBe(before);
    fx.dispose();
  });

  it('closes the hole after the burst and when the battle ends', () => {
    const { g, s, scene, fx } = collapsing();
    play(g, fx, CUBE.collapse.travel + CUBE.collapse.pull + 0.6, [s]);
    fx.prepare(0, 720);
    expect(s.tungsten!.ult).toBeNull();
    expect(fx.singularities.count).toBe(0);
    expect(hole(scene)).toBeUndefined();
    expect(lenses(fx)).toHaveLength(0);
    fx.dispose();

    const again = collapsing();
    play(again.g, again.fx, CUBE.collapse.travel + 1, [again.s]);
    again.fx.prepare(0, 720);
    expect(again.fx.singularities.count).toBe(1);
    again.g.finish(-1, 'test');
    again.fx.update(0.016, [again.s]);
    again.fx.prepare(0, 720);
    expect(again.fx.singularities.count).toBe(0);
    expect(hole(again.scene)).toBeUndefined();
    again.fx.dispose();
    expect(again.scene.children).toHaveLength(0);
  });

  it('keeps the hole but drops its lens under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { g, s, fx } = collapsing();
    play(g, fx, CUBE.collapse.travel + 1, [s]);
    fx.prepare(0, 720);
    expect(fx.singularities.count).toBe(1);
    expect(lenses(fx)).toHaveLength(0);
    fx.dispose();
  });

  it('drops the Collapse and Meteor shock warps under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { g, s, fx } = collapsing();
    play(g, fx, CUBE.collapse.travel + CUBE.collapse.pull + 0.2, [s]);
    fx.prepare(0, 720);
    expect(fx.particles.count).toBeGreaterThan(0);
    expect(fx.distortions).toHaveLength(0);
    fx.dispose();

    const g2 = emptyGame('open', 7, 'freeplay');
    const s2 = place(g2, 'tungsten', 0, 0, 0);
    place(g2, 'yamato', 1, 0, -2000);
    const fx2 = new TungstenCubeFx(new Scene(), g2);
    s2.control.aimX = 0;
    s2.control.aimZ = -2000;
    cast(s2, METEOR);
    const M = CUBE.meteor;
    play(g2, fx2, M.rise + M.grow + M.fall + 0.2, [s2]);
    fx2.prepare(0, 720);
    expect(fx2.particles.count).toBeGreaterThan(0);
    expect(fx2.distortions).toHaveLength(0);
    fx2.dispose();
  });

  it('heats the meteor through its fall and draws its strike within bounds', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    place(g, 'yamato', 1, 0, -2000);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    s.tungsten!.mode = 1;
    s.tungsten!.cubes[0].mode = 1;
    s.control.aimX = 0;
    s.control.aimZ = -2000;
    cast(s, METEOR);
    const M = CUBE.meteor;
    const heat = () => fx.ult.cubeLook(s, s.tungsten!.cubes[0])!.heat;

    play(g, fx, M.rise + M.grow - 0.1, [s]);
    expect(heat()).toBe(0);
    play(g, fx, 0.3, [s]);
    const early = heat();
    play(g, fx, 0.4, [s]);
    expect(early).toBeGreaterThan(0);
    expect(heat()).toBeGreaterThan(early);

    play(g, fx, 0.3, [s]);
    const before = stateHash(g);
    fx.prepare(0, 720);
    expect(fx.particles.count).toBeGreaterThan(0);
    expectFiniteFx(fx, scene);
    expect(stateHash(g)).toBe(before);
    fx.dispose();
  });
});
