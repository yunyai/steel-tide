import { describe, expect, it } from 'vitest';
import { Mesh, Scene, type BufferAttribute, type BufferGeometry, type Object3D } from 'three';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { MiscTitanFx } from '../src/render/MiscTitanFx';
import { FAULTLINE } from '../src/skills/misc/FaultlineRuntime';
import type { FaultFxKind } from '../src/skills/misc/MiscEvents';
import type { DynamicRidge } from '../src/world/GameMap';
import { emptyGame, place, run } from './helpers';

// The Faultline's effects: every event it emits plays as a burst, its fractures, warnings and
// ridges are public terrain, and each ridge is a basalt mesh that rises, stands and sinks without
// leaking its geometry.

function rift(): { g: Game; s: Ship; enemy: Ship; scene: Scene; fx: MiscTitanFx } {
  const g = emptyGame();
  const s = place(g, 'faultline', 0, 0, 0);
  const enemy = place(g, 'stepper', 1, 0, -1500);
  const scene = new Scene();
  const fx = new MiscTitanFx(scene, g);
  return { g, s, enemy, scene, fx };
}

/** What one viewport draws: ribbon segments of both batches plus particles. */
function drawn(fx: MiscTitanFx, team: 0 | 1 | -1 = -1): number {
  fx.update(1, 1 / 60);
  fx.prepare(team, 720);
  return fx.ribbons.count + fx.kit.dark.count + fx.kit.particles.count;
}

function ridge(s: Ship, o: Partial<DynamicRidge> = {}): DynamicRidge {
  return { id: 77, owner: s.id, x0: -450, z0: -800, x1: 450, z1: -800, width: FAULTLINE.ridgeWidth, height: FAULTLINE.ridgeHeight, expiresAt: s.game.time + FAULTLINE.ridgeLife, ...o };
}

function rocks(scene: Scene): Mesh[] {
  const out: Mesh[] = [];
  scene.traverse((o: Object3D) => {
    if (o instanceof Mesh && o.parent?.name.startsWith('misc-ridge')) out.push(o);
  });
  return out;
}

const KINDS: FaultFxKind[] = ['fracture', 'rupture', 'uplift', 'subduct', 'crush', 'slip', 'boulder', 'bedrock', 'rebound', 'caldera', 'eruption', 'worldbreaker', 'collapse', 'crumble'];

describe('Faultline effects', () => {
  it.each(KINDS)('play a %s burst', (kind) => {
    const { g, s, enemy, fx } = rift();
    expect(drawn(fx)).toBe(0);
    g.events.emit('miscTitan', { ship: s, kind, x: enemy.pos.x - 400, z: enemy.pos.z, tx: enemy.pos.x + 400, tz: enemy.pos.z, target: enemy, radius: 500, n: 2 });
    run(g, 0.2);
    expect(drawn(fx)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('splash lava where its ember rocks land or strike', () => {
    for (const kind of ['gunLand', 'gunHit'] as const) {
      const { g, s, enemy, fx } = rift();
      g.events.emit('miscTitan', { ship: s, kind, x: enemy.pos.x, z: enemy.pos.z, target: enemy, n: 1 });
      run(g, 0.1);
      expect(drawn(fx)).toBeGreaterThan(0);
      fx.dispose();
    }
  });

  it('build one basalt mesh per ridge that rises out of the sea and stands', () => {
    const { g, s, scene, fx } = rift();
    g.map.dynamicRidges.push(ridge(s));
    drawn(fx);
    expect(fx.faultline.rocks).toBe(1);
    const [mesh] = rocks(scene);
    expect(mesh).toBeTruthy();
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    expect(pos.count).toBeGreaterThan(100);
    expect(Array.from(pos.array).every(Number.isFinite)).toBe(true);
    const rising = mesh.parent!.position.y;
    expect(rising).toBeLessThan(-10);
    g.time += 1.5;
    drawn(fx);
    expect(mesh.parent!.position.y).toBeCloseTo(0, 0);
    expect(mesh.parent!.visible).toBe(true);
    fx.dispose();
  });

  it('give each ridge its own jagged shape', () => {
    const { g, s, scene, fx } = rift();
    g.map.dynamicRidges.push(ridge(s), ridge(s, { id: 78, z0: 800, z1: 800 }));
    drawn(fx);
    const meshes = rocks(scene);
    expect(meshes).toHaveLength(2);
    const [a, b] = meshes.map((m) => Array.from((m.geometry.getAttribute('position') as BufferAttribute).array));
    expect(a).not.toEqual(b);
    fx.dispose();
  });

  it('keep a crumbling ridge sinking after it leaves the map, then free its geometry', () => {
    const { g, s, scene, fx } = rift();
    const r = ridge(s, { expiresAt: g.time - FAULTLINE.ridgeLife + 5 });
    g.map.dynamicRidges.push(r);
    drawn(fx);
    const geometry: BufferGeometry = rocks(scene)[0].geometry;
    let freed = 0;
    geometry.addEventListener('dispose', () => freed++);
    g.map.dynamicRidges.length = 0;
    g.events.emit('miscTitan', { ship: s, kind: 'crumble', x: r.x0, z: r.z0, tx: r.x1, tz: r.z1, radius: r.width, n: r.id });
    drawn(fx);
    expect(fx.faultline.rocks).toBe(1);
    const sinking = rocks(scene)[0];
    expect(sinking.geometry).toBe(geometry);
    const y = sinking.parent!.position.y;
    g.time += 0.8;
    drawn(fx);
    expect(sinking.parent!.position.y).toBeLessThan(y);
    g.time += 3;
    drawn(fx);
    expect(fx.faultline.rocks).toBe(0);
    expect(rocks(scene)).toHaveLength(0);
    expect(freed).toBe(1);
    fx.dispose();
  });

  it('free a ridge that vanishes without crumbling, and everything on dispose', () => {
    const { g, s, scene, fx } = rift();
    g.map.dynamicRidges.push(ridge(s), ridge(s, { id: 78, z0: 800, z1: 800 }));
    drawn(fx);
    const geometries = rocks(scene).map((m) => m.geometry);
    let freed = 0;
    for (const geo of geometries) geo.addEventListener('dispose', () => freed++);
    g.map.dynamicRidges.pop();
    drawn(fx);
    expect(fx.faultline.rocks).toBe(1);
    expect(freed).toBe(1);
    fx.dispose();
    expect(freed).toBe(2);
    expect(fx.faultline.rocks).toBe(0);
  });

  it('show fractures, warnings and ridges even to a team that cannot see the Faultline', () => {
    const { g, s, fx } = rift();
    s.faultline!.fractures.push({ id: 1, x0: -500, z0: -900, x1: 500, z1: -900, expiresAt: g.time + 10 });
    s.meter = 1;
    s.control.aimX = 0;
    s.control.aimZ = -1500;
    expect(s.activateSkill(0)).not.toBe(false);
    g.map.dynamicRidges.push(ridge(s));
    run(g, 0.2);
    s.mods.untargetable = true;
    expect(s.faultline!.pending.length).toBeGreaterThan(0);
    expect(drawn(fx, 1)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('hide Slip, Bedrock and the Rebound from a team that cannot see the Faultline', () => {
    const { g, s, fx } = rift();
    for (const kind of ['slip', 'bedrock', 'rebound'] as const) g.events.emit('miscTitan', { ship: s, kind, x: 0, z: 0, tx: 0, tz: -600, radius: 600 });
    run(g, 0.1);
    s.mods.untargetable = true;
    expect(drawn(fx, 1)).toBe(0);
    fx.dispose();
  });

  it('draw Bedrock’s plates, Slip’s magma wake and a hot hull for as long as they last', () => {
    const { g, s, fx } = rift();
    const idle = drawn(fx);
    s.faultline!.bedrockUntil = g.time + 3;
    const braced = drawn(fx);
    expect(braced).toBeGreaterThan(idle);
    s.faultline!.wakes.push({ x0: 0, z0: 0, x1: 0, z1: -700, until: g.time + 2, next: g.time + 0.5 });
    const wake = drawn(fx);
    expect(wake).toBeGreaterThan(braced);
    s.faultline!.pressure = 90;
    expect(drawn(fx)).toBeGreaterThan(wake);
    fx.dispose();
  });

  it('flash the sky and shake the camera when the world breaks and the caldera erupts', () => {
    const { g, s, fx } = rift();
    const flashes: number[] = [];
    const shakes: string[] = [];
    fx.onFlash = (_x, _z, amount) => flashes.push(amount);
    fx.onShake = () => shakes.push('shake');
    g.events.emit('miscTitan', { ship: s, kind: 'worldbreaker', x: 0, z: 0, n: 3 });
    g.events.emit('miscTitan', { ship: s, kind: 'eruption', x: 0, z: -1500, radius: FAULTLINE.caldera.radius, n: 50 });
    expect(flashes).toHaveLength(2);
    if (!fx.kit.reduce) expect(shakes).toHaveLength(2);
    drawn(fx);
    if (!fx.kit.reduce) expect(fx.distortions.length).toBeGreaterThan(0);
    fx.dispose();
  });
});
