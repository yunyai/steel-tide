import { describe, expect, it } from 'vitest';
import { Mesh, Scene, type Group, type Material, type Object3D, type ShaderMaterial } from 'three';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { stateHash } from '../src/net/hash';
import { MiscTitanFx } from '../src/render/MiscTitanFx';
import { PHAROS_LAMP } from '../src/render/MiscTitanGeometry';
import type { PharosFxKind } from '../src/skills/misc/MiscEvents';
import { PHAROS } from '../src/skills/misc/PharosRuntime';
import { emptyGame, place, run } from './helpers';

// The Pharos's effects: each beam is a shaft of light posed from the lamp's state, buoys float
// where they were thrown, every event plays as a burst, and none of it writes to the simulation
// or gives a hidden ship away.

function lighthouse(): { g: Game; s: Ship; enemy: Ship; scene: Scene; fx: MiscTitanFx } {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'pharos', 0, 0, 0);
  s.throttle = 2;
  const enemy = place(g, 'iowa', 1, 1500, 0);
  enemy.throttle = 2;
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

function nodes(scene: Scene, prefix: string): Group[] {
  return scene.children.filter((o: Object3D) => o.name.startsWith(prefix)) as Group[];
}

const KINDS: PharosFxKind[] = ['lit', 'hold', 'lance', 'lanceHit', 'counter', 'scorch', 'dazzle', 'dazzled', 'buoy', 'buoyFlare', 'buoyGone', 'douse', 'relight', 'twin', 'daybreak', 'sear', 'falseLight', 'wreck'];

describe('Pharos effects', () => {
  it.each(KINDS)('play a %s burst', (kind) => {
    const { g, s, enemy, fx } = lighthouse();
    // Shutter the lamp, so only the burst is drawn.
    s.pharos!.darkUntil = 1e9;
    const idle = drawn(fx);
    g.events.emit('miscTitan', { ship: s, kind, x: s.pos.x, z: s.pos.z, tx: enemy.pos.x, tz: enemy.pos.z, target: enemy, radius: 500, n: 1 });
    g.time += 0.2;
    expect(drawn(fx)).toBeGreaterThan(idle);
    g.time += 5;
    expect(drawn(fx)).toBe(idle);
    fx.dispose();
  });

  it('pose one shaft per beam from the lantern down to the sea at the beam’s end', () => {
    const { g, s, scene, fx } = lighthouse();
    s.pharos!.bearing = Math.PI / 2;
    drawn(fx);
    const [shaft] = nodes(scene, 'misc-pharos-beam');
    expect(nodes(scene, 'misc-pharos-beam')).toHaveLength(1);
    expect(shaft.visible).toBe(true);
    expect(shaft.position.y).toBeCloseTo(s.renderPos.y + s.spec.freeboard + PHAROS_LAMP, 3);
    // Its far end: the unit cone's base centre, a beam's length to the east.
    shaft.updateMatrixWorld(true);
    const end = (shaft.children[0] as Mesh).localToWorld((shaft.children[0] as Mesh).position.clone().setX(1));
    expect(end.x).toBeCloseTo(PHAROS.range, 0);
    expect(end.z).toBeCloseTo(0, 0);
    // Its underside rests just clear of the water there.
    expect(end.y - shaft.scale.y).toBeCloseTo(4, 3);
    expect(shaft.scale.z).toBeCloseTo(PHAROS.range * Math.tan(PHAROS.halfWidth), 0);
    s.pharos!.twinUntil = g.time + 5;
    drawn(fx);
    expect(nodes(scene, 'misc-pharos-beam')).toHaveLength(2);
    fx.dispose();
  });

  it('stop a shaft where land stands in the beam', () => {
    const { g, s, scene, fx } = lighthouse();
    s.pharos!.bearing = Math.PI / 2;
    g.map.addDynamicRidge({ id: 1, owner: 99, x0: 700, z0: -300, x1: 700, z1: 300, width: 60, height: 75, expiresAt: 1e9 });
    drawn(fx);
    const [shaft] = nodes(scene, 'misc-pharos-beam');
    expect(shaft.scale.x).toBeLessThan(720);
    fx.dispose();
  });

  it('whiten and strengthen the shaft for Daybreak, and free it when the lamp is shuttered', () => {
    const { g, s, scene, fx } = lighthouse();
    drawn(fx);
    const m = (nodes(scene, 'misc-pharos-beam')[0].children[0] as Mesh).material as ShaderMaterial;
    const sweep = m.uniforms.uAlpha.value as number;
    s.pharos!.daybreak = { startAt: g.time - 1, until: g.time + 3, started: true, seared: [] };
    drawn(fx);
    expect(m.uniforms.uAlpha.value).toBeGreaterThan(sweep);
    // Driven past white, so it blooms.
    expect(m.uniforms.uColor.value.r).toBeGreaterThan(2);
    expect(m.uniforms.uColor.value.r).toBe(m.uniforms.uColor.value.b);
    let freed = 0;
    m.addEventListener('dispose', () => freed++);
    s.pharos!.daybreak = null;
    s.pharos!.darkUntil = g.time + 5;
    drawn(fx);
    expect(nodes(scene, 'misc-pharos-beam')).toHaveLength(0);
    expect(freed).toBe(1);
    fx.dispose();
    expect(freed).toBe(1);
  });

  it('float a buoy once its throw has landed and sink it with its life', () => {
    const { g, s, scene, fx } = lighthouse();
    s.pharos!.buoys.push({ id: 4, x: 600, z: 600, expiresAt: g.time + PHAROS.buoy.life, flaredAt: -1e9 });
    drawn(fx);
    expect(nodes(scene, 'misc-pharos-buoy')).toHaveLength(0);
    g.time += 0.6;
    drawn(fx);
    const [buoy] = nodes(scene, 'misc-pharos-buoy');
    expect(buoy.visible).toBe(true);
    expect(buoy.position.x).toBe(600);
    s.pharos!.buoys.length = 0;
    drawn(fx);
    expect(nodes(scene, 'misc-pharos-buoy')).toHaveLength(0);
    fx.dispose();
  });

  it('hide the beam of a Pharos the viewer cannot see, but not its public warnings', () => {
    const { g, s, scene, fx } = lighthouse();
    s.mods.untargetable = true;
    drawn(fx, 1);
    expect(nodes(scene, 'misc-pharos-beam')[0].visible).toBe(false);
    const hidden = fx.ribbons.count + fx.kit.particles.count;
    expect(hidden).toBe(0);
    drawn(fx, 0);
    expect(nodes(scene, 'misc-pharos-beam')[0].visible).toBe(true);
    s.pharos!.beacon = { x: 1500, z: 600, until: g.time + 3, lured: [] };
    expect(drawn(fx, 1)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('mark Exposure only on ships the viewer can see', () => {
    const { g, s, enemy, fx } = lighthouse();
    s.pharos!.darkUntil = 1e9;
    s.pharos!.lit.push({ target: enemy.id, stacks: 3, until: g.time + 3, inBeam: false, gainedAt: 0, decayAt: 1e9, dazzledUntil: g.time + 2 });
    const idle = (() => {
      enemy.mods.untargetable = true;
      return drawn(fx, 0);
    })();
    enemy.mods.untargetable = false;
    expect(drawn(fx, 0)).toBeGreaterThan(idle);
    fx.dispose();
  });

  it('never write to the simulation, through a whole kit', () => {
    const { g, s, enemy, fx } = lighthouse();
    s.control.aimX = enemy.pos.x;
    s.control.aimZ = enemy.pos.z;
    for (let i = 0; i < 9; i++) {
      s.skills[i].cooldown = 0;
      s.skills[i].meter = 1;
      s.activateSkill(i);
      run(g, 0.4);
      const before = stateHash(g);
      drawn(fx, 0);
      drawn(fx, 1);
      expect(stateHash(g)).toBe(before);
    }
    fx.dispose();
  });

  it('release every material and geometry it made', () => {
    const { s, scene, fx } = lighthouse();
    s.pharos!.buoys.push({ id: 4, x: 600, z: 600, expiresAt: s.game.time + PHAROS.buoy.life, flaredAt: -1e9 });
    s.game.time += 1;
    drawn(fx);
    const made = new Set<Material | Mesh['geometry']>();
    for (const g of [...nodes(scene, 'misc-pharos-beam'), ...nodes(scene, 'misc-pharos-buoy')])
      g.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        made.add(o.geometry);
        made.add(o.material as Material);
      });
    expect(made.size).toBeGreaterThanOrEqual(6);
    let freed = 0;
    for (const r of made) r.addEventListener('dispose', () => freed++);
    fx.dispose();
    expect(freed).toBe(made.size);
    expect(nodes(scene, 'misc-pharos')).toHaveLength(0);
  });
});
