import { HEAT_RICOCHET_DEG, OVERMATCH, RICOCHET_DEG } from './config';
import type { AmmoKind, VehicleSpec } from './types';

// Armour in the World of Tanks manner: the round meets a plate at some angle, the plate counts as
// thickness / cos(angle), shallow hits skid off unless the round is far wider than the plate.
// A vehicle is two boxes in its posed frame: the hull, and the turret turned on top of it.

/** A vehicle's frame: origin on the ground under its centre, right / up / forward unit axes. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  r: [number, number, number];
  u: [number, number, number];
  f: [number, number, number];
  /** Turret yaw relative to the hull (clockwise from above). */
  turretYaw: number;
}

/** Fill a pose's axes from heading (compass), pitch (nose up) and roll (right side down). */
export function poseAxes(p: Pose, heading: number, pitch: number, roll: number): void {
  const sh = Math.sin(heading);
  const ch = Math.cos(heading);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  // Yaw only, then pitch about the right axis, then roll about the forward axis.
  const f0x = sh;
  const f0z = -ch;
  const r0x = ch;
  const r0z = sh;
  const fx = f0x * cp;
  const fy = sp;
  const fz = f0z * cp;
  const u1x = -f0x * sp;
  const u1y = cp;
  const u1z = -f0z * sp;
  p.f[0] = fx;
  p.f[1] = fy;
  p.f[2] = fz;
  p.u[0] = u1x * cr + r0x * sr;
  p.u[1] = u1y * cr;
  p.u[2] = u1z * cr + r0z * sr;
  p.r[0] = r0x * cr - u1x * sr;
  p.r[1] = -u1y * sr;
  p.r[2] = r0z * cr - u1z * sr;
}

export function newPose(): Pose {
  return { x: 0, y: 0, z: 0, r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1], turretYaw: 0 };
}

/** A world point (or direction, with `dir`) in the pose's frame: [right, up, forward]. */
export function toLocal(p: Pose, x: number, y: number, z: number, dir = false): [number, number, number] {
  const dx = dir ? x : x - p.x;
  const dy = dir ? y : y - p.y;
  const dz = dir ? z : z - p.z;
  return [
    dx * p.r[0] + dy * p.r[1] + dz * p.r[2],
    dx * p.u[0] + dy * p.u[1] + dz * p.u[2],
    dx * p.f[0] + dy * p.f[1] + dz * p.f[2],
  ];
}

/** A point in the pose's frame back to the world. */
export function toWorld(p: Pose, lx: number, ly: number, lf: number): { x: number; y: number; z: number } {
  return {
    x: p.x + p.r[0] * lx + p.u[0] * ly + p.f[0] * lf,
    y: p.y + p.r[1] * lx + p.u[1] * ly + p.f[1] * lf,
    z: p.z + p.r[2] * lx + p.u[2] * ly + p.f[2] * lf,
  };
}

interface Slab {
  t: number;
  axis: number;
  sign: number;
}

/** Segment o + d·t, t in 0..1, against a box: entry fraction and the face's axis and side. */
function slab(o: number[], d: number[], lo: number[], hi: number[]): Slab | null {
  let t0 = 0;
  let t1 = 1;
  let axis = -1;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let ta = (lo[i] - o[i]) / d[i];
    let tb = (hi[i] - o[i]) / d[i];
    let sg = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      sg = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = i;
      sign = sg;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return axis < 0 ? { t: 0, axis: 1, sign: 1 } : { t: t0, axis, sign };
}

export type Face = 'front' | 'side' | 'rear' | 'roof';

export interface ArmorHit {
  /** Fraction along the segment. */
  t: number;
  part: 'hull' | 'turret';
  face: Face;
  /** Nominal plate thickness (mm). */
  thickness: number;
  /** Angle between the round's path and the plate's normal (radians). */
  angle: number;
  /** Hit point in the hull frame: right, up, forward. */
  lx: number;
  ly: number;
  lf: number;
}

/** Ground clearance under the hull box. */
const CLEARANCE = 0.35;

/** Where a segment first strikes a vehicle's hull or turret, or null. */
export function hitVehicle(spec: VehicleSpec, p: Pose, ax: number, ay: number, az: number, bx: number, by: number, bz: number): ArmorHit | null {
  const o = toLocal(p, ax, ay, az);
  const d = toLocal(p, bx - ax, by - ay, bz - az, true);
  const s = spec.size;
  const W = s.width / 2;
  const L = s.length / 2;
  let best: ArmorHit | null = null;

  const hull = slab(o, d, [-W, CLEARANCE, -L], [W, s.height, L]);
  if (hull) best = faceHit(spec, 'hull', hull, d);

  const tu = s.turret;
  if (tu && spec.armor.turret) {
    // Into the turret's frame: about its centre, turned by its yaw.
    const c = Math.cos(p.turretYaw);
    const sn = Math.sin(p.turretYaw);
    const ox = o[0];
    const of = o[2] - tu.offset;
    const to = [ox * c - of * sn, o[1] - s.height, ox * sn + of * c];
    const td = [d[0] * c - d[2] * sn, d[1], d[0] * sn + d[2] * c];
    const tw = tu.width / 2;
    const tl = tu.length / 2;
    const hit = slab(to, td, [-tw, 0, -tl], [tw, tu.height, tl]);
    if (hit && (!best || hit.t < best.t)) best = faceHit(spec, 'turret', hit, td);
  }
  if (best) {
    best.lx = o[0] + d[0] * best.t;
    best.ly = o[1] + d[1] * best.t;
    best.lf = o[2] + d[2] * best.t;
  }
  return best;
}

function faceHit(spec: VehicleSpec, part: 'hull' | 'turret', h: Slab, d: number[]): ArmorHit {
  const plates = part === 'hull' ? spec.armor.hull : spec.armor.turret!;
  let face: Face;
  let n: [number, number, number];
  if (h.axis === 1) {
    face = 'roof';
    n = [0, h.sign, 0];
  } else if (h.axis === 0) {
    face = 'side';
    n = [h.sign, 0, 0];
  } else if (h.sign > 0) {
    face = 'front';
    // The upper plate leans back: its normal tips up.
    const slope = ((part === 'hull' ? spec.armor.hull.slope : (spec.armor.turret?.slope ?? 0)) * Math.PI) / 180;
    n = [0, Math.sin(slope), Math.cos(slope)];
  } else {
    face = 'rear';
    n = [0, 0, -1];
  }
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const cos = -(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / len;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  return { t: h.t, part, face, thickness: plates[face], angle, lx: 0, ly: 0, lf: 0 };
}

export type PenOutcome = 'pen' | 'ricochet' | 'block';

export interface PenResult {
  outcome: PenOutcome;
  /** Thickness the round had to beat along its path (mm). */
  effective: number;
}

/** Degrees a round turns toward the plate's normal on impact. */
const NORMALISE: Record<AmmoKind, number> = { AP: 5, APDS: 2, HEAT: 0, HE: 0 };

/**
 * Does a round get through? `ignoreAngle` treats every plate as flat on (APDS Sabot and kin);
 * `pen` is the round's penetration after range falloff.
 */
export function penetrate(hit: ArmorHit, kind: AmmoKind, caliber: number, pen: number, ignoreAngle = false): PenResult {
  const t = Math.max(1, hit.thickness);
  if (ignoreAngle) return { outcome: pen >= t ? 'pen' : 'block', effective: t };
  const deg = (hit.angle * 180) / Math.PI;
  const limit = kind === 'HEAT' ? HEAT_RICOCHET_DEG : RICOCHET_DEG;
  const overmatch = caliber > OVERMATCH * t;
  if (kind !== 'HE' && deg > limit && !overmatch) return { outcome: 'ricochet', effective: Infinity };
  const eff = Math.max(0, deg - (overmatch ? 0 : NORMALISE[kind]));
  const effective = t / Math.max(0.08, Math.cos((eff * Math.PI) / 180));
  return { outcome: pen >= effective ? 'pen' : 'block', effective };
}

/** Penetration of a round after flying `dist` of its gun's `range`. */
export function penAtRange(kind: AmmoKind, pen: number, dist: number, range: number, falloff: number): number {
  if (kind === 'HEAT' || kind === 'HE') return pen;
  return pen * (1 - falloff * Math.min(1, dist / Math.max(1, range)));
}
