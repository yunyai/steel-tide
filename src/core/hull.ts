import type { Ship } from '../ships/Ship';

// Plan-view (top-down) tests against a ship's hull rectangle, for beams and area effects.

/** A world point in the ship's frame: x forward, z starboard. */
export function toLocal(s: Ship, x: number, z: number): { lx: number; lz: number } {
  const dx = x - s.pos.x;
  const dz = z - s.pos.z;
  const h = s.heading;
  return { lx: dx * Math.sin(h) - dz * Math.cos(h), lz: dx * Math.cos(h) + dz * Math.sin(h) };
}

/** Distance from a world point to the hull rectangle (0 inside). */
export function distToHull(s: Ship, x: number, z: number): number {
  const { lx, lz } = toLocal(s, x, z);
  const ex = Math.max(0, Math.abs(lx) - s.spec.length / 2);
  const ez = Math.max(0, Math.abs(lz) - s.spec.beam / 2);
  return Math.hypot(ex, ez);
}

/**
 * Where the segment (x0, z0)-(x1, z1), widened by `pad` metres, first meets the hull rectangle:
 * a fraction 0..1 along the segment, or -1 when it misses.
 */
export function segmentHitsHull(s: Ship, x0: number, z0: number, x1: number, z1: number, pad = 0): number {
  const a = toLocal(s, x0, z0);
  const b = toLocal(s, x1, z1);
  const dx = b.lx - a.lx;
  const dz = b.lz - a.lz;
  const hx = s.spec.length / 2 + pad;
  const hz = s.spec.beam / 2 + pad;
  let t0 = 0;
  let t1 = 1;
  for (const [p, d, h] of [
    [a.lx, dx, hx],
    [a.lz, dz, hz],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p) > h) return -1;
      continue;
    }
    let ta = (-h - p) / d;
    let tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
