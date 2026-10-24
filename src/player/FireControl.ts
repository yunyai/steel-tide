import type { Vector3 } from 'three';
import { KNOT, SPEED_SCALE } from '../config';
import type { Game } from '../core/Game';
import { dist2D, rayBox } from '../core/math';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';
import { solve } from '../weapons/Ballistics';

// Fire control for human captains: what the crosshair is on, and where a moving
// target will be once the shells (or torpedoes) get there.

export type AimKind = 'ship' | 'land' | 'water' | 'sky';

export interface AimHit {
  x: number;
  y: number;
  z: number;
  /** Distance along the ray. */
  dist: number;
  kind: AimKind;
  /** Enemy hull under the crosshair. */
  ship: Ship | null;
}

/** Land is marched in steps this long, then refined by bisection. */
const MARCH_STEP = 24;
/** No island is taller than this. */
const PEAK = 260;

/** Height of a ship's box for crosshair picking: superstructure top, else freeboard plus a little. */
function boxTop(s: Ship): number {
  return s.superBox?.top ?? s.spec.freeboard + 6;
}

/**
 * Cast the crosshair ray and return the first enemy hull, island or sea surface it meets.
 * When it meets nothing within `maxDist` (looking at the sky), the point is `maxDist` out along
 * the ray's compass bearing, at sea level.
 */
export function raycast(game: Game, team: Team, o: Vector3, d: Vector3, maxDist: number, skip: Ship | null = null): AimHit {
  let best: AimHit | null = null;

  // Enemy hulls, as boxes in each ship's own frame (x forward, z starboard).
  for (const s of game.ships) {
    if (s === skip || !s.alive || s.team === team || s.deep) continue;
    const p = s.renderPos;
    const reach = s.spec.length / 2 + 20;
    // Cheap reject: the ray must pass near the ship's position in plan view.
    const ax = p.x - o.x;
    const az = p.z - o.z;
    const hl = Math.hypot(d.x, d.z) || 1e-9;
    const along = (ax * d.x + az * d.z) / hl;
    if (along < -reach) continue;
    const perp = Math.abs(ax * d.z - az * d.x) / hl;
    if (perp > reach) continue;
    const h = s.renderHeading;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    const lo: [number, number, number] = [(o.x - p.x) * fx + (o.z - p.z) * fz, o.y - p.y, (o.x - p.x) * rx + (o.z - p.z) * rz];
    const ld: [number, number, number] = [d.x * fx + d.z * fz, d.y, d.x * rx + d.z * rz];
    const half = s.spec.length / 2;
    const hb = s.spec.beam / 2;
    const hit = rayBox(lo, ld, [-half, -s.spec.draft, -hb], [half, boxTop(s), hb]);
    if (!hit || hit.t0 <= 0 || hit.t0 > maxDist) continue;
    if (best && hit.t0 >= best.dist) continue;
    best = { x: o.x + d.x * hit.t0, y: o.y + d.y * hit.t0, z: o.z + d.z * hit.t0, dist: hit.t0, kind: 'ship', ship: s };
  }

  // Sea surface.
  let end = best ? best.dist : maxDist;
  let water: AimHit | null = null;
  if (d.y < -1e-6) {
    const t = -o.y / d.y;
    if (t > 0 && t < end) {
      water = { x: o.x + d.x * t, y: 0, z: o.z + d.z * t, dist: t, kind: 'water', ship: null };
      end = t;
    }
  }

  // Islands: march to the first sample below ground, then bisect.
  const map = game.map;
  let prev = 0;
  for (let t = MARCH_STEP; t <= end + MARCH_STEP; t += MARCH_STEP) {
    const tt = Math.min(t, end);
    const y = o.y + d.y * tt;
    // Above the tallest peak and climbing: nothing left to hit.
    if (y > PEAK && d.y >= 0) break;
    if (y <= PEAK && map.heightAt(o.x + d.x * tt, o.z + d.z * tt) > y) {
      let a = prev;
      let b = tt;
      for (let i = 0; i < 8; i++) {
        const m = (a + b) / 2;
        if (map.heightAt(o.x + d.x * m, o.z + d.z * m) > o.y + d.y * m) b = m;
        else a = m;
      }
      return { x: o.x + d.x * b, y: o.y + d.y * b, z: o.z + d.z * b, dist: b, kind: 'land', ship: null };
    }
    prev = tt;
    if (tt >= end) break;
  }
  if (best && (!water || best.dist <= water.dist)) return best;
  if (water) return water;
  const hl = Math.hypot(d.x, d.z) || 1;
  return { x: o.x + (d.x / hl) * maxDist, y: 0, z: o.z + (d.z / hl) * maxDist, dist: maxDist, kind: 'sky', ship: null };
}

/** Time for the current weapon to reach a point `d` metres away, or null when it has no flight model. */
export function flightTimeFn(ship: Ship): ((d: number) => number) | null {
  const slot = ship.currentSlot;
  if (slot?.kind === 'gun') {
    const table = ship.tableFor(slot.ammo);
    return table ? (d) => solve(table, Math.min(d, table.maxRange)).time : null;
  }
  if (slot?.kind === 'torp' && ship.spec.torpedoes) {
    const sp = ship.spec.torpedoes.speed * KNOT * SPEED_SCALE;
    return (d) => d / sp;
  }
  return null;
}

/** Where `target` will be when a shot fired now from `shooter` arrives (target holds course and speed). */
export function leadPoint(shooter: Ship, target: Ship, flightTime: (d: number) => number): { x: number; z: number } {
  const vx = Math.sin(target.heading) * target.speed;
  const vz = -Math.cos(target.heading) * target.speed;
  let px = target.renderPos.x;
  let pz = target.renderPos.z;
  for (let i = 0; i < 4; i++) {
    const time = flightTime(dist2D(shooter.pos.x, shooter.pos.z, px, pz));
    px = target.renderPos.x + vx * time;
    pz = target.renderPos.z + vz * time;
  }
  return { x: px, z: pz };
}

/** Share of the remaining error the assist removes once the lead is applied. */
export const ASSIST_PULL = 0.6;

/**
 * Assisted aim point. The target's movement over the flight time is added for you, keeping the
 * spot on the hull you chose; if you were already leading by hand it is not added twice. The rest
 * of the error is then pulled part of the way toward the lead point. Spread is never tightened.
 */
export function assistAim(rawX: number, rawZ: number, cx: number, cz: number, lx: number, lz: number): { x: number; z: number } {
  const mx = lx - cx;
  const mz = lz - cz;
  const m2 = mx * mx + mz * mz;
  const u = m2 > 1 ? Math.max(0, Math.min(1, ((rawX - cx) * mx + (rawZ - cz) * mz) / m2)) : 1;
  const sx = rawX + mx * (1 - u);
  const sz = rawZ + mz * (1 - u);
  return { x: sx + (lx - sx) * ASSIST_PULL, z: sz + (lz - sz) * ASSIST_PULL };
}
