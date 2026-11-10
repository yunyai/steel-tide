import { Color, FogExp2, type Group, type Scene } from 'three';
import type { Game } from '../../core/Game';
import type { Team } from '../../core/types';
import { contactVisible } from '../../core/Targeting';
import type { Ship } from '../../ships/Ship';
import { waveHeight } from '../../world/Waves';
import { reducedMotion } from '../ArchitectPose';
import { BK, BurstParticles } from '../BurstParticles';
import { Ribbons } from '../Projectiles';
import { quality } from '../Quality';
import type { SpatialDistortion } from '../SpatialDistortion';

// Drawing kit shared by the misc titans' effects: one set of particles, a light and a dark
// ribbon batch, a pool of named scene groups and the line, ring, arc and helix helpers they draw
// with. Every draw is rebuilt each viewport from simulation state and event time, never stored.

export const TAU = Math.PI * 2;
/** Scene groups the misc titans may hold at once (dolls, ridges, columns, gavels...). */
export const MAX_NODES = 512;

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Fast start, soft landing. */
export const easeOut = (v: number): number => 1 - (1 - clamp01(v)) ** 3;
/** 0 → 1 → 0 over `v` in [0, 1]. */
export const bump = (v: number): number => Math.sin(Math.PI * clamp01(v));

const scratch = [new Color(), new Color(), new Color(), new Color()];
let next = 0;
/** A scratch HDR colour, good until four more are asked for. Ribbons and particles copy it on push. */
export function hot(hex: number, k = 1): Color {
  const c = scratch[next++ & 3];
  return c.setHex(hex).multiplyScalar(k);
}
/** `a` blended toward `b` by `f`, scaled by `k`. */
export function mix(a: number, b: number, f: number, k = 1): Color {
  const c = scratch[next++ & 3];
  const d = scratch[next++ & 3];
  return c.setHex(a).lerp(d.setHex(b), clamp01(f)).multiplyScalar(k);
}

export class MiscFxKit {
  /** Additive light: rings, arcs, beams and glyphs. */
  readonly light = new Ribbons(24000, true, false);
  /** Alpha-blended mass: chains, threads, rock outlines. */
  readonly dark = new Ribbons(6000, false, false);
  readonly particles: BurstParticles;
  readonly distortions: SpatialDistortion[] = [];
  readonly reduce = reducedMotion();
  readonly detail = quality().particles;
  /** Render clock, held at zero under reduced motion so idle loops stand still. */
  t = 0;
  /** Asked to kick a captain's camera: `ship` is whose moment it is, `amount` as for `PlayerController.shake`. */
  onShake: ((ship: Ship, x: number, z: number, amount: number) => void) | null = null;
  /** Asked to light the sea and sky for a big impact. */
  onFlash: ((x: number, z: number, amount: number, color: number) => void) | null = null;
  private nodes = new Map<string, Group>();

  constructor(
    readonly scene: Scene,
    readonly game: Game,
  ) {
    this.light.mesh.name = 'misc-titan-energy';
    this.dark.mesh.name = 'misc-titan-matter';
    this.particles = new BurstParticles(scene, { additive: 4096, alpha: 2048, flat: 512 }, 'misc-titan-fx');
    scene.add(this.light.mesh, this.dark.mesh);
    if (scene.fog instanceof FogExp2) this.setFog(scene.fog.color, scene.fog.density);
  }

  /** Particle budget multiplier for quality and reduced motion. */
  get k(): number {
    return this.detail * (this.reduce ? 0.6 : 1);
  }

  setFog(color: Color, density: number): void {
    this.light.setFog(color, density);
    this.dark.setFog(color, density);
    this.particles.setFog(color, density);
  }

  begin(heightPx: number): void {
    this.light.begin();
    this.dark.begin();
    this.light.material.uniforms.uViewportH.value = heightPx;
    this.dark.material.uniforms.uViewportH.value = heightPx;
    this.particles.begin(heightPx);
    this.distortions.length = 0;
  }

  end(): void {
    this.light.end();
    this.dark.end();
    this.particles.end();
  }

  /** Whether `team`'s view may show `s` (-1: everything). */
  visible(s: Ship, team: Team | -1): boolean {
    return s.alive && !s.withdrawn && !s.mods.banished && (team === -1 || s.team === team || contactVisible(s, team));
  }

  /** The sea (or land) surface under a point, for decals and splashes. */
  surface(x: number, z: number): number {
    return Math.max(waveHeight(x, z, this.game.renderTime) + 1, this.game.map.heightAt(x, z) + 1);
  }

  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: Color, a = 0.7, w = 3, dark = false): void {
    (dark ? this.dark : this.light).push(ax, ay, az, bx, by, bz, c, a, w, 1.1);
  }

  /** A flat ring at height `y`; `phase` turns it, `dash` leaves every other segment out. */
  ring(x: number, z: number, r: number, y: number, c: Color, a = 0.55, w = 4, phase = 0, segments = 80, dash = false, dark = false): void {
    for (let i = 0; i < segments; i++) {
      if (dash && i % 2) continue;
      const b = phase + (i * TAU) / segments;
      const e = phase + ((i + 1) * TAU) / segments;
      this.line(x + Math.cos(b) * r, y, z + Math.sin(b) * r, x + Math.cos(e) * r, y, z + Math.sin(e) * r, c, a, w, dark);
    }
  }

  /** A parabolic arc from a to b peaking `lift` above the straight line, drawn up to fraction `upTo`. */
  arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, lift: number, c: Color, a = 0.7, w = 3, segments = 18, upTo = 1, dark = false): void {
    let px = ax;
    let py = ay;
    let pz = az;
    const n = Math.max(1, Math.ceil(segments * clamp01(upTo)));
    for (let i = 1; i <= n; i++) {
      const f = (i / segments) * (i === n ? clamp01(upTo) * segments / n : 1);
      const x = ax + (bx - ax) * f;
      const y = ay + (by - ay) * f + Math.sin(Math.PI * f) * lift;
      const z = az + (bz - az) * f;
      this.line(px, py, pz, x, y, z, c, a, w, dark);
      px = x;
      py = y;
      pz = z;
    }
  }

  /** A point `f` of the way along the same arc. */
  arcAt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, lift: number, f: number): { x: number; y: number; z: number } {
    return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f + Math.sin(Math.PI * f) * lift, z: az + (bz - az) * f };
  }

  /** A helix of radius `r` climbing `height` from `y0` in `turns` turns. */
  helix(x: number, y0: number, z: number, r: number, height: number, turns: number, phase: number, c: Color, a = 0.7, w = 3, segments = 48): void {
    let px = x + Math.cos(phase) * r;
    let py = y0;
    let pz = z + Math.sin(phase) * r;
    for (let i = 1; i <= segments; i++) {
      const f = i / segments;
      const ang = phase + f * turns * TAU;
      const nx = x + Math.cos(ang) * r;
      const ny = y0 + f * height;
      const nz = z + Math.sin(ang) * r;
      this.line(px, py, pz, nx, ny, nz, c, a, w);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  /** A soft light at a point. */
  glow(x: number, y: number, z: number, size: number, c: Color, a = 0.6): void {
    this.particles.push(BK.Glow, x, y, z, size, c, a);
  }

  /** A flat decal ring on the water (expanding shock fronts). */
  shock(x: number, z: number, r: number, c: Color, a = 0.7, kind: BK = BK.Ring, rot = 0): void {
    this.particles.push(kind, x, this.surface(x, z) + 1, z, r / 0.43, c, a, rot);
  }

  /** A named scene group, built once by `build` and kept until `sweep` finds it unused. */
  node(key: string, build: () => Group): Group | null {
    const old = this.nodes.get(key);
    if (old) return old;
    if (this.nodes.size >= MAX_NODES) return null;
    const g = build();
    g.name = key;
    g.visible = false;
    this.scene.add(g);
    this.nodes.set(key, g);
    return g;
  }

  peek(key: string): Group | undefined {
    return this.nodes.get(key);
  }

  /** Removes every group whose key is not in `live`. */
  sweep(live: Set<string>): void {
    for (const [key, g] of this.nodes)
      if (!live.has(key)) {
        this.scene.remove(g);
        this.nodes.delete(key);
      }
  }

  /** Hides every pooled group before a viewport decides which to show. */
  hideAll(): void {
    for (const g of this.nodes.values()) g.visible = false;
  }

  dispose(): void {
    for (const g of this.nodes.values()) this.scene.remove(g);
    this.nodes.clear();
    this.scene.remove(this.light.mesh, this.dark.mesh);
    this.light.dispose();
    this.dark.dispose();
    this.particles.dispose();
  }
}
