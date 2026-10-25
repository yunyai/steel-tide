import type { ShipSpec } from '../core/types';

// Shared hull planform used both by the procedural mesh and the armour model,
// so shells meet the plating at the angle the player sees.

/** Half-beam at local x (metres forward of midships). */
export function hullHalfWidth(spec: ShipSpec, x: number): number {
  const half = spec.length / 2;
  const u = x / half;
  const hb = spec.beam / 2;
  if (spec.sub) {
    const t = Math.min(1, Math.abs(u));
    return hb * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4)), 0.5);
  }
  if (spec.model.hullStyle === 'block') {
    // Slab-sided ice: full width almost to the ends, then a short chamfer.
    const t = Math.max(0, (Math.abs(u) - 0.9) / 0.1);
    return hb * (1 - 0.35 * Math.min(1, t));
  }
  const bowStart = spec.model.bow === 'straight' ? 0.4 : 0.32;
  const sternStart = -0.55;
  if (u > bowStart) {
    const t = Math.min(1, (u - bowStart) / (1 - bowStart));
    return hb * Math.max(0, 1 - Math.pow(t, 1.8)) + (t >= 1 ? 0 : 0.05);
  }
  if (u < sternStart) {
    const t = Math.min(1, (sternStart - u) / (1 + sternStart));
    const transom = spec.model.stern === 'transom' ? 0.55 : 0.75;
    return hb * (1 - transom * Math.pow(t, 2.2));
  }
  return hb;
}

/** d(halfWidth)/dx, numeric. */
export function hullHalfWidthSlope(spec: ShipSpec, x: number): number {
  const h = 0.5;
  return (hullHalfWidth(spec, x + h) - hullHalfWidth(spec, x - h)) / (2 * h);
}

/** Deck height above waterline at local x (sheer line rises toward the bow). */
export function deckHeight(spec: ShipSpec, x: number): number {
  if (spec.sub || spec.model.hullStyle === 'block') return spec.freeboard;
  const u = x / (spec.length / 2);
  const sheer = spec.model.sheer ?? 0.3;
  const rise = u > 0.2 ? Math.pow((u - 0.2) / 0.8, 2) * sheer : 0;
  return spec.freeboard * (1 + rise);
}

/** Bounds of superstructure in local coordinates (x range, half width, top). */
export function superstructureBounds(spec: ShipSpec): { x0: number; x1: number; hw: number; top: number } | null {
  const blocks = spec.model.blocks;
  if (!blocks.length && !spec.model.tower && !spec.model.conningTower) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let hw = 0;
  let top = 0;
  let stack = 0;
  for (const b of blocks) {
    const base = b.y ?? stack;
    stack = base + b.h;
    x0 = Math.min(x0, b.x - b.len / 2);
    x1 = Math.max(x1, b.x + b.len / 2);
    hw = Math.max(hw, b.w / 2);
    top = Math.max(top, base + b.h);
  }
  if (spec.model.tower) {
    const t = spec.model.tower;
    x0 = Math.min(x0, t.x - t.len / 2);
    x1 = Math.max(x1, t.x + t.len / 2);
    hw = Math.max(hw, t.w / 2);
    top = Math.max(top, stack + t.h * 0.6);
  }
  if (spec.model.conningTower) {
    const c = spec.model.conningTower;
    x0 = Math.min(x0, c.x - c.len / 2);
    x1 = Math.max(x1, c.x + c.len / 2);
    hw = Math.max(hw, spec.beam * 0.25);
    top = Math.max(top, c.h);
  }
  return { x0, x1, hw, top: spec.freeboard + top };
}
