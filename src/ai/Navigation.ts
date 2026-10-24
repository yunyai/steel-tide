import { MAP_HALF } from '../config';
import type { Game } from '../core/Game';
import { DEG, bearingTo, dist2D, forwardX, forwardZ, wrapAngle } from '../core/math';
import type { Ship } from '../ships/Ship';

const PROBES = [180, 400, 700, 1050];
const OFFSETS = [0, 20, -20, 40, -40, 65, -65, 90, -90, 120, -120, 160, -160];

/** True if the path along `heading` is clear of land for the probe distances. */
export function headingClear(game: Game, ship: Ship, heading: number): boolean {
  const fx = forwardX(heading);
  const fz = forwardZ(heading);
  const half = ship.spec.length / 2;
  const keel = -Math.max(6, ship.spec.draft + 2);
  for (const d of PROBES) {
    const x = ship.pos.x + fx * (d + half);
    const z = ship.pos.z + fz * (d + half);
    if (Math.abs(x) > MAP_HALF - 250 || Math.abs(z) > MAP_HALF - 250) return false;
    if (game.map.heightAt(x, z) > keel) return false;
  }
  return true;
}

/** Adjust a desired heading so the ship steers around islands and map edges. */
export function avoid(game: Game, ship: Ship, desired: number): number {
  // Near the edge, head back toward the centre.
  const edge = MAP_HALF - 500;
  if (Math.abs(ship.pos.x) > edge || Math.abs(ship.pos.z) > edge) {
    const toCentre = bearingTo(ship.pos.x, ship.pos.z, 0, 0);
    if (Math.abs(wrapAngle(desired - toCentre)) > 80 * DEG) desired = toCentre;
  }
  for (const o of OFFSETS) {
    const h = wrapAngle(desired + o * DEG);
    if (headingClear(game, ship, h)) return h;
  }
  return wrapAngle(desired + Math.PI);
}

/** Rudder command to reach a heading, with damping by current turn rate. */
export function rudderFor(ship: Ship, heading: number): number {
  const err = wrapAngle(heading - ship.heading);
  const lead = ship.turnRate * ship.spec.rudderTime * 0.6;
  const v = (err - lead) * 2.5;
  return Math.max(-1, Math.min(1, v));
}

/** Steer away from friendly ships that are close ahead. */
export function separate(game: Game, ship: Ship, desired: number): number {
  for (const o of game.ships) {
    if (o === ship || !o.alive || o.team !== ship.team || o.deep) continue;
    const d = Math.hypot(o.pos.x - ship.pos.x, o.pos.z - ship.pos.z);
    const clear = (ship.spec.length + o.spec.length) / 2 + 250;
    if (d > clear) continue;
    const rel = wrapAngle(bearingTo(ship.pos.x, ship.pos.z, o.pos.x, o.pos.z) - ship.heading);
    if (Math.abs(rel) > 70 * DEG) continue;
    // Turn away from the side the friendly is on.
    return wrapAngle(ship.heading - Math.sign(rel || 1) * 50 * DEG);
  }
  return desired;
}

/**
 * A heading out of danger: away from the middle of a telegraphed strike about to land on the ship,
 * or along the track of a spotted torpedo that would hit it. Null when nothing threatens.
 */
export function evasion(game: Game, ship: Ship): number | null {
  const px = ship.pos.x;
  const pz = ship.pos.z;
  const half = ship.spec.length / 2;
  for (const st of game.strikes.strikes) {
    if (!st.alive || st.landed || st.team === ship.team || st.kind === 'mine' || st.kind === 'shock') continue;
    if (dist2D(px, pz, st.x, st.z) < st.radius + half + 40) return bearingTo(st.x, st.z, px, pz);
  }
  if (ship.deep) return null;
  // Closest approach of each torpedo, in the ship's frame of motion, over the next few seconds.
  const vx = forwardX(ship.heading) * ship.speed;
  const vz = forwardZ(ship.heading) * ship.speed;
  const reach = half + 40;
  for (const t of game.torps.torps) {
    if (!t.alive || t.team === ship.team || !t.seen || (ship.submerged && !t.deep)) continue;
    const rx = t.x - px;
    const rz = t.z - pz;
    if (rx * rx + rz * rz > 2500 * 2500) continue;
    const wx = forwardX(t.heading) * t.speed - vx;
    const wz = forwardZ(t.heading) * t.speed - vz;
    const w2 = wx * wx + wz * wz;
    if (w2 < 1e-6) continue;
    const tc = -(rx * wx + rz * wz) / w2;
    if (tc < 0 || tc > 14) continue;
    const cx = rx + wx * tc;
    const cz = rz + wz * tc;
    if (cx * cx + cz * cz > reach * reach) continue;
    // Comb the track: turn parallel to it, whichever way is the shorter turn.
    const back = wrapAngle(t.heading + Math.PI);
    return Math.abs(wrapAngle(t.heading - ship.heading)) < Math.abs(wrapAngle(back - ship.heading)) ? t.heading : back;
  }
  return null;
}
