import type { AmmoType, ArmorZone, HitOutcome, ShellSpec, ShipSpec } from '../core/types';
import { rayBox } from '../core/math';
import { hullHalfWidthSlope } from './HullShape';

// Simplified WoWS-style armour model: plate angle -> ricochet/overmatch -> penetration
// -> fuse travel -> citadel / penetration / over-penetration.

export const DAMAGE_FACTOR: Record<HitOutcome, number> = {
  citadel: 1,
  penetration: 0.33,
  overpen: 0.1,
  ricochet: 0,
  shatter: 0,
  he: 1,
  torpedo: 1,
  bomb: 1,
  missile: 1,
  secondary: 1,
};

export const RICOCHET_START = 45;
export const RICOCHET_ALWAYS = 60;
/** Shells overmatch plates thinner than caliber / 14.3. */
export const OVERMATCH = 14.3;
/** AP fuse delay in real seconds. */
export const FUSE_TIME = 0.033;

export interface PlateResult {
  result: 'ricochet' | 'shatter' | 'pen';
  effective: number;
}

/** Resolve a single plate interaction. angleDeg is measured from the plate normal. */
export function resolvePlate(
  ammo: AmmoType,
  caliber: number,
  pen: number,
  plate: number,
  angleDeg: number,
  rng: () => number,
): PlateResult {
  if (ammo === 'HE') {
    return { result: pen >= plate ? 'pen' : 'shatter', effective: plate };
  }
  const overmatch = caliber > OVERMATCH * plate;
  if (!overmatch) {
    if (angleDeg >= RICOCHET_ALWAYS) return { result: 'ricochet', effective: Infinity };
    if (angleDeg >= RICOCHET_START) {
      const chance = (angleDeg - RICOCHET_START) / (RICOCHET_ALWAYS - RICOCHET_START);
      if (rng() < chance) return { result: 'ricochet', effective: Infinity };
    }
  }
  const effective = plate / Math.max(0.05, Math.cos((angleDeg * Math.PI) / 180));
  return { result: pen >= effective ? 'pen' : 'shatter', effective };
}

export interface HitGeometry {
  /** Local entry point. */
  x: number;
  y: number;
  z: number;
  /** Local direction (normalised). */
  dx: number;
  dy: number;
  dz: number;
  /** Face axis hit on the box (0 = bow/stern face, 1 = top, 2 = side). */
  axis: 0 | 1 | 2;
  part: 'hull' | 'super';
}

export interface HitResolution {
  outcome: HitOutcome;
  zone: ArmorZone;
  factor: number;
  angle: number;
  turretIndex: number;
}

/** Map an entry point on the hull to an armour zone. */
export function zoneFor(spec: ShipSpec, g: HitGeometry): { zone: ArmorZone; turretIndex: number } {
  if (g.part === 'super') return { zone: 'superstructure', turretIndex: -1 };
  const half = spec.length / 2;
  if (spec.main && g.y > spec.freeboard - 1.5) {
    const tr = Math.max(4, spec.beam * 0.2);
    for (let i = 0; i < spec.main.turrets.length; i++) {
      const t = spec.main.turrets[i];
      const dx = g.x - t.x;
      const dz = g.z - (t.z ?? 0);
      if (dx * dx + dz * dz < tr * tr) return { zone: 'turret', turretIndex: i };
    }
  }
  if (g.x > half - spec.length * 0.17) return { zone: 'bow', turretIndex: -1 };
  if (g.x < -half + spec.length * 0.14) return { zone: 'stern', turretIndex: -1 };
  return { zone: g.axis === 1 ? 'deck' : 'belt', turretIndex: -1 };
}

/** Angle (deg) between incoming direction and plate normal at the entry point. */
export function impactAngle(spec: ShipSpec, g: HitGeometry): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (g.axis === 1) {
    ny = 1;
  } else {
    // Curved hull: the side normal leans forward where the bow narrows.
    const side = g.z >= 0 ? 1 : -1;
    nx = -hullHalfWidthSlope(spec, g.x);
    nz = side;
    if (g.axis === 0) {
      // Hitting the nose: plating meets the shell at the bow's half-angle.
      nx = g.x > 0 ? 0.42 : -0.6;
      nz = side;
    }
    const len = Math.hypot(nx, nz);
    nx /= len;
    nz /= len;
  }
  const c = Math.abs(nx * g.dx + ny * g.dy + nz * g.dz);
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

export function plateFor(spec: ShipSpec, zone: ArmorZone): number {
  const a = spec.armor;
  switch (zone) {
    case 'bow':
      return a.bow;
    case 'stern':
      return a.stern;
    case 'belt':
      return a.belt;
    case 'deck':
      return a.deck;
    case 'superstructure':
      return a.superstructure;
    case 'turret':
      return a.turret;
  }
}

/** Full shell-vs-ship resolution. `pen` is penetration at impact velocity. */
export function resolveShellHit(
  spec: ShipSpec,
  g: HitGeometry,
  ammo: AmmoType,
  shell: ShellSpec,
  pen: number,
  impactSpeed: number,
  rng: () => number,
): HitResolution {
  const { zone, turretIndex } = zoneFor(spec, g);
  const plate = plateFor(spec, zone);
  const angle = impactAngle(spec, g);
  const plateRes = resolvePlate(ammo, shell.caliber, pen, plate, angle, rng);
  if (plateRes.result !== 'pen') {
    const outcome: HitOutcome = plateRes.result;
    return { outcome, zone, factor: 0, angle, turretIndex };
  }
  if (ammo === 'HE') return { outcome: 'he', zone, factor: DAMAGE_FACTOR.he, angle, turretIndex };

  // AP: check fuse arming and travel through the hull.
  const armed = plate >= shell.caliber / 6;
  const fuseDist = FUSE_TIME * impactSpeed;
  const half = spec.length / 2;
  const hb = spec.beam / 2;
  const origin: [number, number, number] = [g.x, g.y, g.z];
  const dir: [number, number, number] = [g.dx, g.dy, g.dz];
  const hullTop = g.part === 'super' ? 1e3 : spec.freeboard * 1.5;
  const hullBox = rayBox(origin, dir, [-half, -spec.draft, -hb], [half, hullTop, hb]);
  const exitDist = hullBox ? Math.max(0, hullBox.t1) : 0;

  if (spec.citadel.length > 0 && zone !== 'turret' && zone !== 'superstructure') {
    const cl = (spec.length * spec.citadel.length) / 2;
    const cw = hb * spec.citadel.width;
    const cit = rayBox(origin, dir, [-cl, -spec.draft * 0.85, -cw], [cl, spec.citadel.top, cw]);
    if (cit && cit.t0 >= 0 && (!armed || cit.t0 <= fuseDist)) {
      const remaining = pen - plateRes.effective;
      const inner = spec.armor.citadelInner;
      if (inner <= 0 || remaining >= inner * 1.3) {
        return { outcome: 'citadel', zone, factor: DAMAGE_FACTOR.citadel, angle, turretIndex };
      }
      return { outcome: 'penetration', zone, factor: DAMAGE_FACTOR.penetration, angle, turretIndex };
    }
  }
  if (armed && fuseDist < exitDist) {
    return { outcome: 'penetration', zone, factor: DAMAGE_FACTOR.penetration, angle, turretIndex };
  }
  return { outcome: 'overpen', zone, factor: DAMAGE_FACTOR.overpen, angle, turretIndex };
}
