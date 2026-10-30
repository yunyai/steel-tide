import { Color, type Scene } from 'three';
import type { Game } from '../core/Game';
import { waveHeight } from '../world/Waves';
import { reducedMotion } from './ArchitectPose';
import { BK, BurstParticles, hash01 } from './BurstParticles';
import { Ribbons } from './Projectiles';
import { quality } from './Quality';

export const TAU = Math.PI * 2;
export const WHITE = new Color(0xffffff);
export const SPRAY = new Color(0xdfeef3);
export const FOAM = new Color(0xe9f4f7);

const tint = new Color();
/** A scratch copy of `c` brightened by `k`; valid until the next call. */
export const hot = (c: Color, k: number) => tint.copy(c).multiplyScalar(k);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Ease-out cubic over 0..1. */
export const ease = (v: number) => 1 - (1 - clamp01(v)) ** 3;
/** Smoothstep over 0..1. */
export const smooth = (v: number) => {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
};

/**
 * The Tungsten's immediate-mode drawing kit: particles, even-width lines and tapered trails, rebuilt every
 * prepare, plus the shapes its effects are made of (rings on the water, arcs, field lines, chains).
 */
export class TungstenPaint {
  readonly particles: BurstParticles;
  /** Arcs, chains and rings that keep an even width. */
  readonly lines = new Ribbons(2800, true, false);
  /** Motion trails that fade toward their tails. */
  readonly trails = new Ribbons(700, true, true);
  readonly reduce = reducedMotion();
  /** Particle density for the quality preset. */
  readonly detail = quality().particles;

  constructor(
    private scene: Scene,
    private game: Game,
  ) {
    this.particles = new BurstParticles(scene, { additive: 4200, alpha: 1300, flat: 480 }, 'tungsten-cube-fx');
    this.lines.mesh.name = 'tungsten-arcs';
    this.trails.mesh.name = 'tungsten-trails';
    scene.add(this.lines.mesh, this.trails.mesh);
  }

  /** Scales a particle count by the quality preset, and halves it under reduced motion. */
  n(count: number): number {
    return Math.max(1, Math.round(count * this.detail * (this.reduce ? 0.5 : 1)));
  }

  begin(heightPx = 720): void {
    this.particles.begin(heightPx);
    this.lines.begin();
    this.trails.begin();
    this.lines.material.uniforms.uViewportH.value = this.trails.material.uniforms.uViewportH.value = heightPx;
  }

  end(): void {
    this.particles.end();
    this.lines.end();
    this.trails.end();
  }

  get count(): number {
    return this.particles.count + this.lines.count + this.trails.count;
  }

  setFog(color: Color, density: number): void {
    this.particles.setFog(color, density);
    this.lines.setFog(color, density);
    this.trails.setFog(color, density);
  }

  dispose(): void {
    this.particles.dispose();
    this.lines.dispose();
    this.trails.dispose();
    this.scene.remove(this.lines.mesh, this.trails.mesh);
  }

  /** The water (or land) height under a point, plus a hair so decals sit on top. */
  surface(x: number, z: number): number {
    return Math.max(waveHeight(x, z, this.game.renderTime), this.game.map.heightAt(x, z)) + 0.6;
  }

  /** A crackling arc from a to b, re-struck about twenty times a second. */
  arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, seed: number, color: Color, alpha: number, width: number, jitter: number, segs = 8): void {
    const strike = this.reduce ? 0 : Math.floor(this.game.renderTime * 20);
    let px = ax,
      py = ay,
      pz = az;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs,
        bend = i === segs ? 0 : Math.sin(Math.PI * t) * jitter;
      const x = ax + (bx - ax) * t + (hash01(seed + strike * 31, i * 3) - 0.5) * 2 * bend;
      const y = ay + (by - ay) * t + (hash01(seed + strike * 31, i * 3 + 1) - 0.5) * 2 * bend;
      const z = az + (bz - az) * t + (hash01(seed + strike * 31, i * 3 + 2) - 0.5) * 2 * bend;
      this.lines.push(px, py, pz, x, y, z, color, alpha, width, 1.2);
      px = x;
      py = y;
      pz = z;
    }
  }

  /** A level ring of light at height y. */
  loop(x: number, y: number, z: number, r: number, c: Color, alpha: number, width = Math.max(1.5, r * 0.025)): void {
    if (alpha < 0.01 || r < 1) return;
    const n = Math.max(16, Math.min(48, Math.round(r / 10)));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU,
        a1 = ((i + 1) / n) * TAU;
      this.lines.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, c, alpha, width, 1.5);
    }
  }

  /** Dipole field lines looping out of the top of a point and back into its base: the Shield's capture zone. */
  field(x: number, y: number, z: number, reach: number, c: Color, alpha: number, spin: number, count = 8): void {
    const steps = 18,
      floor = this.surface(x, z) + 2;
    for (let k = 0; k < count; k++) {
      const phi = (k / count) * TAU + spin;
      let px = 0,
        py = 0,
        pz = 0;
      for (let i = 0; i <= steps; i++) {
        const th = 0.22 + (i / steps) * (Math.PI - 0.44);
        const r = reach * Math.sin(th) ** 2;
        const nx = x + r * Math.sin(th) * Math.cos(phi),
          ny = Math.max(floor, y + r * Math.cos(th) * 0.8),
          nz = z + r * Math.sin(th) * Math.sin(phi);
        if (i) {
          // Charge runs along each line from the north pole to the south.
          const run = this.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(th * 5 - this.game.renderTime * 7 + k);
          this.lines.push(px, py, pz, nx, ny, nz, c, alpha * (0.45 + 0.55 * run), 2, 1.2);
        }
        px = nx;
        py = ny;
        pz = nz;
      }
    }
  }

  /**
   * A ring on the water. Plain rings are a crisp line riding the waves over a faint halo, so a
   * kilometre-wide shock front stays a thin edge; other kinds are painted as one flat decal.
   */
  ring(x: number, z: number, r: number, c: Color, alpha: number, kind: BK = BK.Ring, rot = 0): void {
    if (alpha < 0.01 || r < 1) return;
    if (kind !== BK.Ring) {
      this.particles.push(kind, x, this.surface(x, z) + 0.4, z, r / 0.43, c, alpha, rot);
      return;
    }
    this.particles.push(BK.Ring, x, this.surface(x, z) + 0.4, z, r / 0.43, c, alpha * 0.3, rot);
    const n = Math.max(16, Math.min(64, Math.round(r / 12)));
    const width = Math.max(2, Math.min(9, r * 0.012));
    let px = x + r,
      pz = z,
      py = this.surface(px, pz) + 1.5;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * TAU;
      const nx = x + Math.cos(a) * r,
        nz = z + Math.sin(a) * r,
        ny = this.surface(nx, nz) + 1.5;
      this.lines.push(px, py, pz, nx, ny, nz, c, alpha, width, 1.5);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  /** Churned water along a circle: foam patches laid round the circumference, each on its own wave. */
  foamRing(x: number, z: number, r: number, alpha: number, seed: number): void {
    if (alpha < 0.01 || r < 1) return;
    const patch = Math.max(25, Math.min(70, r * 0.12));
    const n = Math.max(6, Math.min(36, Math.round((r * TAU) / (patch * 1.4))));
    for (let i = 0; i < n; i++) {
      const a = ((i + hash01(seed, i) * 0.4) / n) * TAU,
        d = r * (0.96 + 0.08 * hash01(seed, i + 50));
      const px = x + Math.cos(a) * d,
        pz = z + Math.sin(a) * d;
      this.particles.push(BK.Foam, px, this.surface(px, pz) + 0.4, pz, patch * 2, FOAM, alpha, a, hash01(seed, i + 99));
    }
  }

  /** A chain of links from a to b, sagging toward the water, with a pulse of light running down it. */
  chain(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: Color, alpha: number, sag: number, flow: number): void {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(6, Math.min(80, Math.round(d / 16)));
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.12) / n,
        t1 = (i + 0.88) / n;
      const y0 = ay + (by - ay) * t0 - sag * 4 * t0 * (1 - t0),
        y1 = ay + (by - ay) * t1 - sag * 4 * t1 * (1 - t1);
      const sx = ax + (bx - ax) * t0,
        sz = az + (bz - az) * t0;
      const ex = ax + (bx - ax) * t1,
        ez = az + (bz - az) * t1;
      const pulse = this.reduce ? 0 : Math.max(0, Math.sin((i / n + this.game.renderTime * flow) * TAU * 2)) ** 6;
      this.lines.push(sx, Math.max(this.surface(sx, sz) + 1, y0), sz, ex, Math.max(this.surface(ex, ez) + 1, y1), ez, c, alpha * (0.75 + pulse * 0.6), i % 2 ? 3 : 6, 2);
    }
  }
}
