import { describe, expect, it } from 'vitest';
import { hitVehicle, newPose, penAtRange, penetrate, poseAxes } from '../../src/ground/sim/armor';
import { VEHICLE_BY_ID } from '../../src/ground/sim/data';
import type { VehicleSpec } from '../../src/ground/sim/types';

const DEG = Math.PI / 180;

/** A hull at the origin facing north (-z), level. */
function pose() {
  const p = newPose();
  poseAxes(p, 0, 0, 0);
  return p;
}

/** A round toward a point on the hull from `dist` away, coming in `theta` off the side plate's normal. */
function sideShot(spec: VehicleSpec, theta: number, y = 1.0, dist = 100) {
  const W = spec.size.width / 2;
  const dx = -Math.cos(theta);
  const dz = Math.sin(theta);
  return hitVehicle(spec, pose(), W - dx * dist, y, -dz * dist, W + dx * 0.5, y, dz * 0.5);
}

describe('ground armour', () => {
  const tiger = VEHICLE_BY_ID.tiger2;
  const t34 = VEHICLE_BY_ID.t34_85;
  const m24 = VEHICLE_BY_ID.m24;

  it('a sloped glacis counts as thickness over the cosine of its lean', () => {
    const hit = hitVehicle(tiger, pose(), 0, 1.0, -100, 0, 1.0, 0)!;
    expect(hit.part).toBe('hull');
    expect(hit.face).toBe('front');
    expect(hit.angle / DEG).toBeCloseTo(50, 3);
    const ap = penetrate(hit, 'AP', 88, 1000);
    // Normalised 5 degrees: 150 / cos 45.
    expect(ap.effective).toBeCloseTo(150 / Math.cos(45 * DEG), 3);
    expect(penetrate(hit, 'AP', 88, 225).outcome).toBe('pen');
    expect(penetrate(hit, 'AP', 85, 145).outcome).toBe('block');
    expect(penetrate(hit, 'HEAT', 75, 220).effective).toBeCloseTo(150 / Math.cos(50 * DEG), 3);
  });

  it('a shallow hit glances off; a round three times the plate cannot', () => {
    const hit = sideShot(tiger, 75 * DEG)!;
    expect(hit.face).toBe('side');
    expect(hit.angle / DEG).toBeCloseTo(75, 3);
    expect(penetrate(hit, 'AP', 88, 500).outcome).toBe('ricochet');
    const thin = sideShot(m24, 75 * DEG)!;
    const over = penetrate(thin, 'AP', 283, 450);
    expect(over.outcome).toBe('pen');
    expect(penetrate(thin, 'HE', 88, 45).outcome).not.toBe('ricochet');
  });

  it('side shots get through what the front stops', () => {
    const hit = sideShot(tiger, 30 * DEG)!;
    expect(hit.face).toBe('side');
    expect(penetrate(hit, 'AP', 85, 145).outcome).toBe('pen');
  });

  it('plunging artillery lands on the roof', () => {
    // Down onto the engine deck behind the turret (local forward -2.5 m is world z +2.5).
    const hit = hitVehicle(t34, pose(), 0, 100, 2.5 - 30, 0, 1.0, 2.5)!;
    expect(hit.face).toBe('roof');
    expect(hit.part).toBe('hull');
    expect(penetrate(hit, 'HE', 150, 75).outcome).toBe('pen');
  });

  it('the turret turns with its yaw and takes its own plates', () => {
    const p = pose();
    const y = t34.size.height + 0.4;
    const front = hitVehicle(t34, p, 0, y, -100, 0, y, 0)!;
    expect(front.part).toBe('turret');
    expect(front.thickness).toBe(t34.armor.turret!.front);
    p.turretYaw = Math.PI / 2;
    const side = hitVehicle(t34, p, 0, y, -100, 0, y, 0)!;
    expect(side.part).toBe('turret');
    expect(side.thickness).toBe(t34.armor.turret!.side);
  });

  it('full-calibre rounds lose penetration with range; HEAT does not', () => {
    expect(penAtRange('AP', 200, 1000, 1000, 0.25)).toBeCloseTo(150, 6);
    expect(penAtRange('AP', 200, 0, 1000, 0.25)).toBe(200);
    expect(penAtRange('HEAT', 200, 1000, 1000, 0.25)).toBe(200);
  });
});
