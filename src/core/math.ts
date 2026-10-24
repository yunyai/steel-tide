import { Vector3 } from 'three';

// Headings are compass bearings in radians: 0 = north (-Z), clockwise positive (east = +X).

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Wrap degrees into (-180, 180]. */
export function wrapDeg(a: number): number {
  a = (a + 180) % 360;
  if (a < 0) a += 360;
  return a - 180;
}

export function forwardX(b: number): number {
  return Math.sin(b);
}
export function forwardZ(b: number): number {
  return -Math.cos(b);
}

export function forward(b: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(b), 0, -Math.cos(b));
}

export function rightOf(b: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(b), 0, Math.sin(b));
}

/** Bearing from point a to point b (xz plane). */
export function bearingTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, -(bz - az));
}

export function dist2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function approachAngle(current: number, target: number, maxDelta: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxDelta) return target;
  return wrapAngle(current + Math.sign(d) * maxDelta);
}

/** Mulberry32 seeded PRNG. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box-Muller. */
export function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

/** Gaussian truncated to +-limit sigmas. */
export function truncGaussian(rng: () => number, limit = 2): number {
  for (let i = 0; i < 8; i++) {
    const g = gaussian(rng);
    if (Math.abs(g) <= limit) return g;
  }
  return 0;
}

/** True if segment a->b passes within r of circle centre c (xz plane). */
export function segmentHitsCircle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - cx;
  const fz = az - cz;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? -(fx * dx + fz * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = fx + dx * t;
  const pz = fz + dz * t;
  return px * px + pz * pz <= r * r;
}

/** Where segment a crosses segment b (xz plane): a fraction 0..1 along a, or -1 when they miss. */
export function segmentsCross(
  ax0: number,
  az0: number,
  ax1: number,
  az1: number,
  bx0: number,
  bz0: number,
  bx1: number,
  bz1: number,
): number {
  const rx = ax1 - ax0;
  const rz = az1 - az0;
  const sx = bx1 - bx0;
  const sz = bz1 - bz0;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qx = bx0 - ax0;
  const qz = bz0 - az0;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

export interface BoxHit {
  t: number;
  /** Axis of the face that was hit: 0 = x (bow/stern faces), 1 = y (deck/bottom), 2 = z (sides). */
  axis: 0 | 1 | 2;
  /** Exit distance along the segment parameter. */
  tExit: number;
}

/**
 * Slab test of segment p0 + d*t, t in [0,1], against an axis-aligned box.
 * Returns entry information or null.
 */
export function segmentBox(
  p0x: number,
  p0y: number,
  p0z: number,
  dx: number,
  dy: number,
  dz: number,
  min: [number, number, number],
  max: [number, number, number],
): BoxHit | null {
  let tMin = 0;
  let tMax = 1;
  let axis: 0 | 1 | 2 = 0;
  const p = [p0x, p0y, p0z];
  const d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (p[i] < min[i] || p[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - p[i]) / d[i];
    let t2 = (max[i] - p[i]) / d[i];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) {
      tMin = t1;
      axis = i as 0 | 1 | 2;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return { t: tMin, axis, tExit: tMax };
}

/** Ray (unbounded) against an AABB, returns entry distance and exit distance. */
export function rayBox(
  o: [number, number, number],
  d: [number, number, number],
  min: [number, number, number],
  max: [number, number, number],
): { t0: number; t1: number } | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    let a = (min[i] - o[i]) / d[i];
    let b = (max[i] - o[i]) / d[i];
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return { t0, t1 };
}

export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
