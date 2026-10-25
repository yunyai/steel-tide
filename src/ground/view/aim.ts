import { hitVehicle, newPose, type Pose, penAtRange, penetrate, poseAxes } from '../sim/armor';
import { PEN_FALLOFF } from '../sim/config';
import type { GroundGame } from '../sim/GroundGame';
import type { Vehicle } from '../sim/Vehicle';

// The crosshair ray: from the camera through the screen centre, it stops at the first vehicle,
// building or slope it meets. That point is where the gun aims. On a vehicle, a second trace from
// the player's own gun tells how the round would fare against the plate under the crosshair.

/** Penetration odds on the plate under the crosshair. */
export type PenColour = 'none' | 'green' | 'yellow' | 'red' | 'grey';

export interface GroundAim {
  x: number;
  y: number;
  z: number;
  /** Metres from the ray's start. */
  dist: number;
  kind: 'vehicle' | 'prop' | 'ground' | 'sky';
  target: Vehicle | null;
  pen: PenColour;
}

/** The ray is cast this far, and props and terrain are walked in chunks of this length. */
export const AIM_REACH = 2200;
const CHUNK = 96;

const pose: Pose = newPose();

/** A vehicle's pose where it is drawn (between sim steps), so the crosshair meets what is on screen. */
function renderPose(v: Vehicle): Pose {
  poseAxes(pose, v.renderHeading, v.renderPitch, v.renderRoll);
  pose.x = v.renderX;
  pose.y = v.renderY;
  pose.z = v.renderZ;
  pose.turretYaw = v.renderTurret;
  return pose;
}

/** Cast the crosshair ray from `o` along the unit direction `d`. */
export function castAim(game: GroundGame, me: Vehicle, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach = AIM_REACH): GroundAim {
  const bx = ox + dx * reach;
  const by = oy + dy * reach;
  const bz = oz + dz * reach;
  let bestT = 1;
  let target: Vehicle | null = null;
  for (const v of game.vehicles) {
    if (v === me || !v.alive || v.withdrawn) continue;
    // Cheap reject: the vehicle's bounding sphere against the ray.
    const r = Math.max(v.spec.size.length, v.spec.size.width) * 0.6 + v.spec.size.height;
    const px = v.renderX - ox;
    const py = v.renderY - oy;
    const pz = v.renderZ - oz;
    const along = px * dx + py * dy + pz * dz;
    if (along < -r || along > reach * bestT + r) continue;
    const ex = px - dx * along;
    const ey = py - dy * along;
    const ez = pz - dz * along;
    if (ex * ex + ey * ey + ez * ez > r * r) continue;
    const hit = hitVehicle(v.spec, renderPose(v), ox, oy, oz, bx, by, bz);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      target = v;
    }
  }
  // Props and the ground, chunk by chunk, up to the vehicle hit if any.
  const stopAt = bestT * reach;
  let kind: GroundAim['kind'] = target ? 'vehicle' : 'sky';
  for (let s = 0; s < stopAt; s += CHUNK) {
    const e = Math.min(stopAt, s + CHUNK);
    const ax = ox + dx * s;
    const ay = oy + dy * s;
    const az = oz + dz * s;
    const cx = ox + dx * e;
    const cy = oy + dy * e;
    const cz = oz + dz * e;
    let t = 2;
    const ph = game.props.segment(ax, ay, az, cx, cy, cz);
    if (ph) t = ph.t;
    const th = game.terrain.segmentHit(ax, ay, az, cx, cy, cz);
    if (th >= 0 && th < t) {
      t = th;
      kind = 'ground';
    } else if (ph) kind = 'prop';
    if (t <= 1) {
      const d = s + (e - s) * t;
      return { x: ox + dx * d, y: oy + dy * d, z: oz + dz * d, dist: d, kind, target: null, pen: 'none' };
    }
  }
  const d = stopAt;
  const out: GroundAim = { x: ox + dx * d, y: oy + dy * d, z: oz + dz * d, dist: d, kind, target, pen: 'none' };
  if (target) out.pen = penColour(me, target, out.x, out.y, out.z);
  return out;
}

/** How a round from the player's gun would do against `t` at the point under the crosshair. */
export function penColour(me: Vehicle, t: Vehicle, hx: number, hy: number, hz: number): PenColour {
  const gun = me.spec.gun;
  const ammo = me.ammo;
  if (!gun || !ammo || gun.artillery) return 'none';
  if (t.team === me.team) return 'none';
  const p = me.pivot();
  const ddx = hx - p.x;
  const ddy = hy - p.y;
  const ddz = hz - p.z;
  const len = Math.hypot(ddx, ddy, ddz);
  if (len < 1) return 'none';
  // Trace from the gun through the aimed point, a little past it so the plate is always reached.
  const k = (len + 2) / len;
  const hit = hitVehicle(t.spec, renderPose(t), p.x, p.y, p.z, p.x + ddx * k, p.y + ddy * k, p.z + ddz * k);
  if (!hit) return 'none';
  const buff = me.shotBuff;
  const pen = penAtRange(ammo.kind, ammo.pen * (buff?.penMul ?? 1) * me.mods.penMul, len, gun.range, PEN_FALLOFF);
  const res = penetrate(hit, ammo.kind, gun.caliber, pen, (buff?.ignoreAngle ?? false) || t.mods.exposed);
  if (res.outcome === 'ricochet') return 'grey';
  if (pen >= res.effective * 1.1) return 'green';
  if (pen >= res.effective * 0.9) return 'yellow';
  return 'red';
}
