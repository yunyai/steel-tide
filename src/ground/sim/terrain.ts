import { TERRAIN_CELL } from './config';

// The ground: a heightfield on a square vertex grid with a material per cell. The sim and the
// render read the same arrays, so what you see is what you drive on. Heights are stored as
// float32, which every peer rounds alike.

/** Surface materials, by cell. */
export const MAT = {
  dirt: 0,
  grass: 1,
  road: 2,
  rubble: 3,
  snow: 4,
  deepSnow: 5,
  ice: 6,
  water: 7,
  mud: 8,
  rail: 9,
} as const;
export type Material = (typeof MAT)[keyof typeof MAT];

/** Top-speed multiplier per material (water is impassable). */
export const MAT_SPEED: readonly number[] = [1, 1, 1.1, 0.6, 0.85, 0.7, 1, 0, 0.8, 1];
/** Grip per material: below 1 the hull slides through turns. */
export const MAT_GRIP: readonly number[] = [1, 1, 1, 0.9, 0.85, 0.8, 0.22, 0, 0.8, 0.95];

/** Integer hash of a lattice point into 0..1 (no Math.random: every peer builds the same map). */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in 0..1 at (x, z) with lattice spacing `scale`. */
export function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smooth(fx - ix);
  const tz = smooth(fz - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Fractal value noise, -1..1. */
export function fbm(x: number, z: number, scale: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let s = scale;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x, z, s, seed + o * 31) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    s *= 0.5;
  }
  return sum / norm;
}

export class Terrain {
  readonly cell = TERRAIN_CELL;
  /** Vertices per side. */
  readonly n: number;
  /** Heights at the vertices, row-major by z then x. */
  readonly h: Float32Array;
  /** Material per cell ((n-1)²), row-major by z then x. */
  readonly mat: Uint8Array;
  /** Surface of standing water (canals, rivers); vehicles cannot enter it. */
  waterLevel = -Infinity;
  /** Bumped whenever materials change after the map is built (the render re-tints). */
  version = 0;
  /** Set by the view: changed areas are queued as [x0, z0, x1, z1] for it to redraw. */
  trackDirty = false;
  readonly dirty: [number, number, number, number][] = [];

  constructor(readonly half: number) {
    this.n = Math.round((half * 2) / this.cell) + 1;
    this.h = new Float32Array(this.n * this.n);
    this.mat = new Uint8Array((this.n - 1) * (this.n - 1));
  }

  /** World x of vertex column i (and z of row j). */
  vx(i: number): number {
    return -this.half + i * this.cell;
  }

  /** Fill every vertex from a height function. */
  shape(f: (x: number, z: number) => number): void {
    const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.h[j * n + i] = f(this.vx(i), this.vx(j));
  }

  /** Fill every cell's material from its centre. */
  paint(f: (x: number, z: number, h: number) => Material): void {
    const m = this.n - 1;
    const c = this.cell;
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const x = this.vx(i) + c / 2;
        const z = this.vx(j) + c / 2;
        this.mat[j * m + i] = f(x, z, this.heightAt(x, z));
      }
    }
  }

  heightAt(x: number, z: number): number {
    const n = this.n;
    const fx = Math.min(n - 1.001, Math.max(0, (x + this.half) / this.cell));
    const fz = Math.min(n - 1.001, Math.max(0, (z + this.half) / this.cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    const a = this.h[k];
    const b = this.h[k + 1];
    const c = this.h[k + n];
    const d = this.h[k + n + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** Ground or water surface, whichever is higher (what a shell lands on). */
  surfaceAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), this.waterLevel);
  }

  /** Cell index under a point, or -1 off the map. */
  cellAt(x: number, z: number): number {
    const m = this.n - 1;
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= m || j >= m) return -1;
    return j * m + i;
  }

  materialAt(x: number, z: number): Material {
    const k = this.cellAt(x, z);
    if (k < 0) return MAT.dirt;
    if (this.heightAt(x, z) < this.waterLevel - 0.6) return MAT.water;
    return this.mat[k] as Material;
  }

  /** Queue an area for the view to redraw (only while one is watching). */
  markDirty(x0: number, z0: number, x1: number, z1: number): void {
    if (!this.trackDirty) return;
    // A view that falls behind redraws everything at once.
    if (this.dirty.length >= 64) this.dirty.splice(0, this.dirty.length, [-this.half, -this.half, this.half, this.half]);
    else this.dirty.push([x0, z0, x1, z1]);
  }

  setMaterial(x: number, z: number, m: Material): void {
    const k = this.cellAt(x, z);
    if (k >= 0) this.mat[k] = m;
  }

  /** Paint a material over a rotated rectangle (rubble where a house stood). */
  paintBox(x: number, z: number, hw: number, hd: number, rot: number, m: Material): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const r = Math.hypot(hw, hd);
    const step = this.cell / 2;
    for (let lz = -r; lz <= r; lz += step) {
      for (let lx = -r; lx <= r; lx += step) {
        const px = c * lx + s * lz;
        const pz = -s * lx + c * lz;
        if (Math.abs(px) > hw || Math.abs(pz) > hd) continue;
        this.setMaterial(x + lx, z + lz, m);
      }
    }
    this.markDirty(x - r, z - r, x + r, z + r);
    this.version++;
  }

  /** Gradient (dh/dx, dh/dz) by central differences. */
  gradient(x: number, z: number): { gx: number; gz: number } {
    const e = this.cell * 0.5;
    return {
      gx: (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e),
      gz: (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e),
    };
  }

  /** Steepest slope at a point, degrees. */
  slopeDeg(x: number, z: number): number {
    const g = this.gradient(x, z);
    return (Math.atan(Math.hypot(g.gx, g.gz)) * 180) / Math.PI;
  }

  /**
   * Where a segment first passes under the ground, as a fraction along it, or -1. Sampled every
   * couple of metres and refined by bisection.
   */
  segmentHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 2));
    let prev = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const y = ay + (by - ay) * t;
      if (y < this.surfaceAt(x, z)) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          const my = ay + (by - ay) * mid;
          if (my < this.surfaceAt(ax + (bx - ax) * mid, az + (bz - az) * mid)) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = t;
    }
    return -1;
  }
}
