import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Color, InstancedBufferAttribute, Mesh, Scene, Vector3, type MeshBasicMaterial, type Object3D, type ShaderMaterial } from 'three';
import { ShipView } from '../src/render/ShipModel';
import { DAIS, HORN_TIPS, TungstenModel } from '../src/render/TungstenModel';
import { TungstenCubeFx } from '../src/render/TungstenCubeFx';
import { dieFaceNormal, modeColor, storeLook } from '../src/render/TungstenLook';
import { CUBE, dockLift } from '../src/skills/misc/TungstenModes';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import type { Ship } from '../src/ships/Ship';
import type { Game } from '../src/core/Game';
import { emptyGame, place, run } from './helpers';

// Skill slots: Q Lunge, E Switch, Z Signature, X Die, C Dock, V Shield, R Collapse, T Meteor, B Overdrive.
const SWITCH = 1;
const SIGNATURE = 2;
const DIE = 3;
const DOCK = 4;
const SHIELD = 5;
const COLLAPSE = 6;
const METEOR = 7;
const OVERDRIVE = 8;
const CRUSH = 1;
const SHARD = 2;
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

/** Leaves the cube hovering out at sea. */
function park(s: Ship, x: number, z: number): void {
  const c = s.tungsten!.cubes[0];
  c.state = 'hover';
  c.path = null;
  c.x = c.px = x;
  c.z = c.pz = z;
  c.y = c.py = CUBE.hoverY;
}

/** Sends the cube flying home from out at sea. */
function recall(s: Ship, x: number, z: number): void {
  park(s, x, z);
  cast(s, DOCK);
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

  it("floats the cube over a dais, with nothing above the cube's base", () => {
    const spec = SHIP_BY_ID.tungsten;
    expect(DAIS.deck).toBe(spec.freeboard);
    const m = new TungstenModel((geo, mat) => new Mesh(geo, mat), SHIP_BY_ID.tungsten);
    m.pose(1);
    const base = dockLift(spec) - CUBE.edge / 2;
    expect(Math.abs(m.cubes[0].mesh.position.y - dockLift(spec))).toBeLessThanOrEqual(2.5);
    m.root.updateMatrixWorld(true);
    const box = new Box3();
    for (const o of m.root.children) if (!m.cubes.some((c) => c.mesh === o)) box.expandByObject(o);
    expect(box.max.y).toBeLessThan(base);
    expect(box.max.y).toBeGreaterThan(DAIS.deck);
    expect(HORN_TIPS).toHaveLength(4);
    for (const tip of HORN_TIPS) expect(tip.y).toBeLessThan(base - 5);
    m.dispose();
  });

  it('runs a mass-driver spine bow to stern, merged into a few meshes, all under the cube', () => {
    const spec = SHIP_BY_ID.tungsten;
    const m = new TungstenModel((geo, mat) => new Mesh(geo, mat), spec);
    m.pose(1);
    m.root.updateMatrixWorld(true);
    const spine = m.root.getObjectByName('tungsten-spine') as Mesh;
    expect(spine).toBeTruthy();
    const box = new Box3().setFromObject(spine);
    expect(box.min.x).toBeLessThan(-spec.length * 0.4);
    expect(box.max.x).toBeGreaterThan(spec.length * 0.4);
    expect(box.max.y).toBeLessThan(dockLift(spec) - CUBE.edge / 2);
    // Every steel part is one draw, every glowing part another.
    const meshes: Mesh[] = [];
    m.root.traverse((o) => {
      if (o instanceof Mesh && !m.cubes.some((c) => c.mesh === o)) meshes.push(o);
    });
    expect(meshes.length).toBeLessThanOrEqual(8);
    m.dispose();
  });

  it('leaves the hit box to blocks matched to the bridge and reactor, with no generic fittings', () => {
    const model = SHIP_BY_ID.tungsten.model;
    expect(model.fins).toBeUndefined();
    expect(model.domes).toBeUndefined();
    expect(model.panels).toBeUndefined();
    expect(model.blocks.every((b) => b.y !== undefined)).toBe(true);
    expect(Math.max(...model.blocks.map((b) => (b.y ?? 0) + b.h))).toBeLessThan(CUBE.float);
  });

  it('lights the deck-edge veins in the mode colour, and walks them round the six in Overdrive', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const m = new TungstenModel((geo, mat) => new Mesh(geo, mat), s.spec);
    const veins = (m.root.getObjectByName('tungsten-veins') as Mesh).material as MeshBasicMaterial;
    const hue = (c: Color) => c.getHSL({ h: 0, s: 0, l: 0 }).h;
    s.tungsten!.mode = 3;
    g.interpolate();
    m.pose(1, s);
    // Once the mode's colour wipe has run.
    run(g, 1);
    g.interpolate();
    m.pose(2, s);
    expect(hue(veins.color)).toBeCloseTo(hue(modeColor(3)), 2);
    cast(s, OVERDRIVE);
    run(g, 0.5);
    g.interpolate();
    m.pose(1, s);
    const first = veins.color.clone();
    m.pose(2.3, s);
    expect(veins.color.equals(first)).toBe(false);
    m.dispose();
  });

  it('heats the docked cube with the Shield store', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const m = new TungstenModel((geo, mat) => new Mesh(geo, mat), s.spec);
    g.interpolate();
    m.pose(1, s);
    expect(m.cubes[0].u.uStore.value).toBe(0);
    s.tungsten!.charge = CUBE.chargeCap / 2;
    m.pose(1, s);
    expect(m.cubes[0].u.uStore.value).toBeCloseTo(storeLook(0.5).heat);
    m.dispose();
  });

  it('spins and bobs the docked cube, and holds it still under reduced motion', () => {
    const moving = new TungstenModel((geo, m) => new Mesh(geo, m), SHIP_BY_ID.tungsten);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const still = new TungstenModel((geo, m) => new Mesh(geo, m), SHIP_BY_ID.tungsten);
    const pose = (m: TungstenModel, time: number) => {
      m.pose(time);
      const c = m.cubes[0].mesh;
      return [c.position.y, c.rotation.x, c.rotation.y, c.rotation.z];
    };
    expect(pose(moving, 3)).not.toEqual(pose(moving, 1));
    expect(pose(still, 3)).toEqual(pose(still, 1));
    moving.dispose();
    still.dispose();
  });

  it("turns the docked cube with the sim's yaw, so it leaves the dais without a snap", () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const m = new TungstenModel((geo, mat) => new Mesh(geo, mat), SHIP_BY_ID.tungsten);
    run(g, 3);
    g.interpolate();
    m.pose(g.renderTime, s);
    const c = s.tungsten!.cubes[0];
    const d = m.cubes[0].mesh.rotation.y - (c.yaw + s.heading);
    expect(Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))).toBeLessThan(0.02);
    m.dispose();
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
    const moving = new TungstenModel((geo, m) => new Mesh(geo, m), SHIP_BY_ID.tungsten);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const still = new TungstenModel((geo, m) => new Mesh(geo, m), SHIP_BY_ID.tungsten);
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
  it('heats a cube from its mode colour toward white as the store fills, with more and longer arcs', () => {
    expect(storeLook(0)).toEqual({ heat: 0, arcs: 0, reach: 0, strike: false });
    const half = storeLook(0.5),
      full = storeLook(1);
    expect(half.heat).toBeGreaterThan(0);
    expect(full.heat).toBeGreaterThan(half.heat);
    expect(half.arcs).toBeGreaterThan(0);
    expect(full.arcs).toBeGreaterThan(half.arcs);
    expect(full.reach).toBeGreaterThan(half.reach);
    expect(storeLook(0.89).strike).toBe(false);
    expect(storeLook(0.9).strike).toBe(true);
  });

  it('crackles over a shielding cube that holds a store, and strikes the sea when nearly full', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const t = s.tungsten!;
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    park(s, 0, -900);
    play(g, fx, 0.2, [s]);
    t.cubes[0].state = 'guard';
    const look = (charge: number) => {
      t.charge = charge;
      const before = stateHash(g);
      fx.prepare(0, 720);
      expect(stateHash(g)).toBe(before);
      return { lines: fx.lines.count, heat: fx.skin(s, t.cubes[0].id)!.uStore.value };
    };
    const empty = look(0);
    expect(empty.heat).toBe(0);
    const most = look(CUBE.chargeCap * 0.89);
    expect(most.heat).toBeGreaterThan(0.5);
    expect(most.lines).toBeGreaterThan(empty.lines);
    expect(look(CUBE.chargeCap * 0.9).lines).toBeGreaterThan(most.lines);
    // A hovering cube shows its store too; with none it stays cool.
    t.cubes[0].state = 'hover';
    expect(look(CUBE.chargeCap * 0.5).heat).toBeGreaterThan(0);
    expect(look(0).heat).toBe(0);
    fx.dispose();
  });

  it('draws a flying cube with its trail, then dissolves its view once the cube docks', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    recall(s, 0, -3500);
    play(g, fx, 0.4, [s]);
    expect(s.tungsten!.cubes[0].state).toBe('flying');

    const before = stateHash(g);
    fx.prepare(0, 720);
    expect(freeCubes(scene)).toHaveLength(1);
    expect(fx.trails.count).toBeGreaterThan(0);
    expect(fx.particles.count).toBeGreaterThan(0);
    expectFiniteFx(fx, scene);
    expect(stateHash(g)).toBe(before);

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
    recall(s, 0, -3500);
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

    recall(s, 0, 4500);
    play(g, fx, 0.4);
    s.mods.untargetable = true;
    fx.prepare(0, 720);
    expect(fx.trails.count).toBeGreaterThan(0);
    fx.dispose();
  });

  it("keeps a concealed enemy's docked-cube moves and Sanctuary off its hidden hull", () => {
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
    // Sanctuary and Shrapnel Cone fired from the dais: nothing for the enemy to see.
    for (const mode of [MEND, SHARD]) {
      const { g, s, fx } = hidden(mode);
      cast(s, SIGNATURE);
      play(g, fx, 0.3);
      expect(look(s, fx, 1)).toBeGreaterThan(0);
      expect(look(s, fx, 0)).toBe(0);
      fx.dispose();
    }
    // Sanctuary from a cube out at sea: its dome shows to both sides.
    const { g, s, fx } = hidden(MEND);
    park(s, 0, 4000);
    play(g, fx, 0.1);
    expect(s.tungsten!.cubes[0].state).toBe('hover');
    const before = look(s, fx, 0);
    cast(s, SIGNATURE);
    play(g, fx, 0.3);
    expect(look(s, fx, 0)).toBeGreaterThan(before);
    fx.dispose();
  });
});

describe('Tungsten throw effects', () => {
  it('dims a spent cube to a sputter where it sank', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    const id = s.tungsten!.cubes[0].id;
    park(s, 0, -1500);
    play(g, fx, 0.2, [s]);
    fx.prepare(0, 720);
    const lit = fx.skin(s, id)!.uPower.value;
    s.tungsten!.spent = true;
    s.tungsten!.energy = 0;
    play(g, fx, 0.5, [s]);
    fx.prepare(0, 720);
    expect(fx.skin(s, id)!.uPower.value).toBeLessThan(lit * 0.35);
    expectFiniteFx(fx, scene);
    fx.dispose();
  });

  it('throws a bow wave off a thrown cube', () => {
    const flat = (thrown: boolean) => {
      const g = emptyGame('open', 7, 'freeplay');
      const s = place(g, 'tungsten', 0, 0, 0);
      const fx = new TungstenCubeFx(new Scene(), g);
      s.control.aimX = 0;
      s.control.aimZ = -3000;
      s.control.fire = true;
      play(g, fx, 1 / 60, [s]);
      s.control.fire = false;
      play(g, fx, 0.3, [s]);
      const c = s.tungsten!.cubes[0];
      expect(c.path?.kind).toBe('shot');
      // The same flight home instead: trail and rooster tail alike, no bow wave.
      if (!thrown) c.path!.kind = 'dock';
      fx.prepare(0, 720);
      const n = fx.particles.stats.flat.count;
      fx.dispose();
      return n;
    };
    expect(flat(true)).toBeGreaterThan(flat(false));
  });

  it('settles a thrown cube flat on a face, and keeps it flat as it turns', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    const c = s.tungsten!.cubes[0];
    // Off the cube's axes and about 2 km, so it comes to rest five quarter-turns over, on a side face.
    s.control.aimX = 900;
    s.control.aimZ = -1830;
    s.control.fire = true;
    play(g, fx, 1 / 60, [s]);
    s.control.fire = false;
    play(g, fx, 3, [s]);
    expect(c.state).toBe('hover');
    fx.prepare(0, 720);
    const mesh = scene.getObjectByName(`tungsten-free-cube-${s.id}:${c.id}`)!;
    // One of the cube's own axes stands straight up.
    const up = Math.max(...[new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((e) => Math.abs(e.applyQuaternion(mesh.quaternion).y)));
    expect(up).toBeGreaterThan(0.999);
    fx.dispose();
  });

  it('keeps a thrown cube flat on a face while it guards', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    const c = s.tungsten!.cubes[0];
    // Settles five quarter-turns over, as above; the Shield then carries it off across its roll.
    s.control.aimX = 900;
    s.control.aimZ = -1830;
    s.control.fire = true;
    play(g, fx, 1 / 60, [s]);
    s.control.fire = false;
    play(g, fx, 3, [s]);
    s.control.aimX = -1500;
    s.control.aimZ = 400;
    cast(s, SHIELD);
    const mesh = scene.getObjectByName(`tungsten-free-cube-${s.id}:${c.id}`)!;
    let worst = 1;
    for (let i = 0; i < 8; i++) {
      play(g, fx, 0.5, [s]);
      fx.prepare(0, 720);
      worst = Math.min(worst, Math.max(...[new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((e) => Math.abs(e.applyQuaternion(mesh.quaternion).y))));
    }
    expect(c.state).toBe('guard');
    expect(worst).toBeGreaterThan(0.999);
    fx.dispose();
  });

  it('flies the throw that empties the magnet lit, and dims it only once it settles', () => {
    const flight = (last: boolean) => {
      const g = emptyGame('open', 7, 'freeplay');
      const s = place(g, 'tungsten', 0, 0, 0);
      const fx = new TungstenCubeFx(new Scene(), g);
      const t = s.tungsten!;
      if (last) t.energy = CUBE.shot.cost;
      s.control.aimX = 0;
      s.control.aimZ = -3000;
      s.control.fire = true;
      play(g, fx, 1 / 60, [s]);
      s.control.fire = false;
      play(g, fx, 0.3, [s]);
      expect(t.spent).toBe(last);
      expect(t.cubes[0].state).toBe('flying');
      fx.prepare(0, 720);
      const look = { power: fx.skin(s, t.cubes[0].id)!.uPower.value, flat: fx.particles.stats.flat.count };
      fx.dispose();
      return look;
    };
    const spent = flight(true),
      lit = flight(false);
    expect(spent.power).toBeGreaterThan(1);
    expect(spent.flat).toBe(lit.flat);
  });

  it('shows the face the Loaded Die rolled, keeps its colour, and erupts where it lands', () => {
    const landing = (die: boolean) => {
      const g = emptyGame('open', 7, 'freeplay');
      const s = place(g, 'tungsten', 0, 0, 0);
      // Rolls the Repel face on a Kinetic cube.
      (g as unknown as { rng: () => number }).rng = () => 3.5 / 6;
      const fx = new TungstenCubeFx(new Scene(), g);
      const t = s.tungsten!;
      s.control.aimX = 0;
      s.control.aimZ = -2000;
      let down = false;
      g.events.on('tungsten', (e) => {
        if (e.kind === 'land') down = true;
      });
      if (die) cast(s, DIE);
      else {
        s.control.fire = true;
        play(g, fx, 1 / 60, [s]);
        s.control.fire = false;
      }
      for (let i = 0; i < 300 && !down; i++) play(g, fx, 1 / 60, [s]);
      expect(down).toBe(true);
      play(g, fx, 0.4, [s]);
      fx.prepare(0, 720);
      const glow = fx.skin(s, t.cubes[0].id)!.uGlow.value.getHex();
      const additive = fx.particles.stats.additive.count;
      play(g, fx, 2.5, [s]);
      fx.prepare(0, 720);
      const after = fx.skin(s, t.cubes[0].id)!.uGlow.value.getHex();
      fx.dispose();
      return { glow, additive, after };
    };
    const rolled = landing(true),
      thrown = landing(false);
    expect(rolled.glow).toBe(modeColor(3).getHex());
    expect(thrown.glow).toBe(modeColor(0).getHex());
    expect(rolled.after).toBe(modeColor(3).getHex());
    expect(rolled.additive).toBeGreaterThan(thrown.additive);
  });

  it('rolls the die as a die: six coloured faces, hopping and tumbling, settling with the rolled face up', () => {
    const roll = (die: boolean) => {
      const g = emptyGame('open', 7, 'freeplay');
      const s = place(g, 'tungsten', 0, 0, 0);
      (g as unknown as { rng: () => number }).rng = () => 3.5 / 6;
      const scene = new Scene();
      const fx = new TungstenCubeFx(scene, g);
      const t = s.tungsten!;
      const c = t.cubes[0];
      s.control.aimX = 0;
      s.control.aimZ = -3000;
      let down = false;
      g.events.on('tungsten', (e) => {
        if (e.kind === 'land') down = true;
      });
      if (die) cast(s, DIE);
      else {
        s.control.fire = true;
        play(g, fx, 1 / 60, [s]);
        s.control.fire = false;
      }
      let faces = 0,
        hop = 0;
      for (let i = 0; i < 300 && !down; i++) {
        play(g, fx, 1 / 60, [s]);
        fx.prepare(0, 720);
        const mesh = freeCubes(scene)[0];
        if (c.state !== 'flying' || !mesh) continue;
        faces = Math.max(faces, fx.skin(s, c.id)!.uDie.value);
        hop = Math.max(hop, mesh.position.y - c.y);
      }
      expect(down).toBe(true);
      play(g, fx, 0.8, [s]);
      fx.prepare(0, 720);
      const up = dieFaceNormal(3).applyQuaternion(freeCubes(scene)[0].quaternion);
      const settled = fx.skin(s, c.id)!.uDie.value;
      play(g, fx, 2, [s]);
      fx.prepare(0, 720);
      const later = fx.skin(s, c.id)!.uDie.value;
      fx.dispose();
      return { faces, hop, up, settled, later };
    };
    const die = roll(true),
      thrown = roll(false);
    expect(die.faces).toBe(1);
    expect(thrown.faces).toBe(0);
    expect(die.hop).toBeGreaterThan(30);
    expect(thrown.hop).toBeLessThan(5);
    // Repel was rolled: its face ends on top, the six colours still showing, then the cube wipes to Repel.
    expect(die.up.y).toBeGreaterThan(0.99);
    expect(die.settled).toBeGreaterThan(0.5);
    expect(die.later).toBe(0);
  });

  it('lays the die faces out like a die: six directions, opposite faces summing to five', () => {
    for (let f = 0; f < 6; f++) expect(dieFaceNormal(f).dot(dieFaceNormal(5 - f))).toBe(-1);
    expect(new Set([0, 1, 2, 3, 4, 5].map((f) => dieFaceNormal(f).toArray().join())).size).toBe(6);
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

  it("traces the Kinetic meteor's hop onto the next hull", () => {
    const hop = (nextX: number) => {
      const g = emptyGame('open', 7, 'freeplay');
      const s = place(g, 'tungsten', 0, 0, 0);
      place(g, 'leviathan', 1, 0, -2000);
      // Inside the blast the second hull is no target for the hop.
      place(g, 'leviathan', 1, nextX, -2000);
      const fx = new TungstenCubeFx(new Scene(), g);
      s.control.aimX = 0;
      s.control.aimZ = -2000;
      cast(s, METEOR);
      const M = CUBE.meteor;
      play(g, fx, M.rise + M.grow + M.fall + M.bounce.hop / 2);
      fx.prepare(0, 720);
      const n = fx.count;
      fx.dispose();
      return { n, ult: s.tungsten!.ult };
    };
    const bounced = hop(1300),
      still = hop(500);
    expect(bounced.ult!.bounce).toHaveLength(6);
    expect(still.ult!.bounce).toHaveLength(0);
    expect(bounced.n).toBeGreaterThan(still.n);
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

  const disk = (scene: Scene) => ((scene.getObjectByName('tungsten-disk') as Mesh).material as ShaderMaterial).uniforms;

  it("colours the hole by the collapsing cube's own mode, not the ship's", () => {
    const { g, s, scene, fx } = collapsing();
    const t = s.tungsten!;
    t.cubes[0].mode = CRUSH;
    t.mode = MEND;
    play(g, fx, CUBE.collapse.travel + 1, [s]);
    fx.prepare(0, 720);
    expect(disk(scene).uColor.value.getHex()).toBe(modeColor(CRUSH).getHex());
    expect(disk(scene).uRainbow.value).toBe(0);
    fx.dispose();
  });

  it('turns the Overdrive singularity through all six mode colours', () => {
    const g = emptyGame('open', 7, 'freeplay');
    const s = place(g, 'tungsten', 0, 0, 0);
    place(g, 'yamato', 1, 300, -2000);
    const scene = new Scene();
    const fx = new TungstenCubeFx(scene, g);
    cast(s, OVERDRIVE);
    play(g, fx, 0.5, [s]);
    s.control.aimX = 0;
    s.control.aimZ = -2000;
    cast(s, COLLAPSE);
    expect(s.tungsten!.ult?.merged).toBe(true);
    play(g, fx, CUBE.collapse.travel + 1, [s]);
    fx.prepare(0, 720);
    expect(disk(scene).uRainbow.value).toBe(1);
    fx.dispose();
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
