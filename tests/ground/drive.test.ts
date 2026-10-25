import { describe, expect, it, vi } from 'vitest';
import { wrapAngle } from '../../src/core/math';
import { MAT } from '../../src/ground/sim/terrain';
import { emptyGround, put, registerMap, run } from './helpers';

// Every test here builds a whole map; under a full parallel run that outgrows the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const DEG = Math.PI / 180;

/** Flat to z = -20, then a ramp rising northward at `deg`. */
function ramp(deg: number): string {
  return registerMap(`ramp${deg}`, (_x, z) => (z < -20 ? (-20 - z) * Math.tan(deg * DEG) : 0));
}

describe('ground drive', () => {
  it('climbs slopes up to its limit and refuses steeper ones', () => {
    const climbs = emptyGround(ramp(20));
    const a = put(climbs, 'tiger2', 0, 0, 0, 0);
    a.control.drive = 1;
    run(climbs, 20);
    expect(a.z).toBeLessThan(-60);
    expect(a.y).toBeGreaterThan(10);

    const wall = emptyGround(ramp(42));
    const b = put(wall, 'tiger2', 0, 0, 0, 0);
    b.control.drive = 1;
    run(wall, 20);
    expect(b.z).toBeGreaterThan(-28);
  });

  it('tracks pivot on the spot; wheels need way on to turn', () => {
    const g = emptyGround(registerMap('flat'));
    const t = put(g, 't34_85', 0, 0, 0, 0);
    const k = put(g, 'katyusha', 0, 100, 0, 0);
    t.control.steer = 1;
    k.control.steer = 1;
    run(g, 2);
    expect(wrapAngle(t.heading) / DEG).toBeGreaterThan(t.spec.drive.turnRate * 1.5);
    expect(Math.hypot(t.x, t.z)).toBeLessThan(0.5);
    expect(Math.abs(wrapAngle(k.heading))).toBeLessThan(0.01);
    k.control.drive = 1;
    run(g, 3);
    expect(Math.abs(wrapAngle(k.heading))).toBeGreaterThan(0.3);
  });

  it('ice takes the grip away: a hull slides far further before it stops', () => {
    const stop = (mat: number) => {
      const g = emptyGround(registerMap(`flat-${mat}`, () => 0, mat as never));
      const v = put(g, 't34_85', 0, 0, 150, 0);
      v.speed = 14;
      const z0 = v.z;
      run(g, 10);
      return z0 - v.z;
    };
    expect(stop(MAT.ice)).toBeGreaterThan(stop(MAT.dirt) * 2.5);
  });

  it('the map edge holds', () => {
    const g = emptyGround(registerMap('flat'));
    const v = put(g, 'm24', 0, 300, 0, Math.PI / 2);
    v.control.drive = 1;
    run(g, 30);
    expect(v.x).toBeLessThanOrEqual(g.terrain.half - 24 + 1e-9);
    expect(v.alive).toBe(true);
  });

  it('heavy hulls flatten fences and trees but are stopped by houses; titans plough through', () => {
    const g = emptyGround(registerMap('flat'));
    const fence = g.props.add({ kind: 'fence', x: 0, z: -40, y: 0, hw: 10, hd: 0.3, h: 1.2, rot: 0, style: 0 });
    const house = g.props.add({ kind: 'building', x: 60, z: -40, y: 0, hw: 10, hd: 6, h: 12, rot: 0, style: 0 });
    const tank = put(g, 't34_85', 0, 0, 0, 0);
    const blocked = put(g, 'tiger2', 0, 60, 0, 0);
    tank.control.drive = 1;
    blocked.control.drive = 1;
    run(g, 12);
    expect(fence.state).toBe(2);
    expect(tank.z).toBeLessThan(-50);
    expect(house.state).toBe(0);
    expect(blocked.z).toBeGreaterThan(-40 + 6);

    const r = emptyGround(registerMap('flat'));
    const block = r.props.add({ kind: 'building', x: 0, z: -60, y: 0, hw: 10, hd: 6, h: 12, rot: 0, style: 0 });
    const ratte = put(r, 'ratte', 0, 0, 0, 0);
    ratte.control.drive = 1;
    run(r, 20);
    expect(block.state).toBe(2);
    expect(ratte.z).toBeLessThan(-70);
  });
});
