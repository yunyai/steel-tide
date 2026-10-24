import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID } from '../src/data/ships';
import { resolvePlate, resolveShellHit, type HitGeometry } from '../src/ships/Armor';

const never = () => 0.999;

describe('armor model', () => {
  it('460 mm AP overmatches 32 mm plating even at extreme angles', () => {
    expect(resolvePlate('AP', 460, 800, 32, 75, never).result).toBe('pen');
  });

  it('406 mm AP ricochets off 32 mm at 70 degrees (no overmatch)', () => {
    expect(resolvePlate('AP', 406, 800, 32, 70, never).result).toBe('ricochet');
  });

  it('small HE shatters on a battleship belt', () => {
    expect(resolvePlate('HE', 155, 26, 410, 0, never).result).toBe('shatter');
  });

  it('AP shatters when effective thickness exceeds penetration', () => {
    expect(resolvePlate('AP', 203, 250, 307, 20, never).result).toBe('shatter');
  });

  const broadside = (x: number, y: number): HitGeometry => ({ x, y, z: 0, dx: 0, dy: -0.1, dz: -1, axis: 2, part: 'hull' });

  it('battleship AP over-penetrates a destroyer', () => {
    const fletcher = SHIP_BY_ID.fletcher;
    const g = { ...broadside(0, 1), z: fletcher.beam / 2 };
    const r = resolveShellHit(fletcher, g, 'AP', SHIP_BY_ID.yamato.main!.ap!, 700, 600, never);
    expect(r.outcome).toBe('overpen');
  });

  it('battleship AP into a broadside battleship belt citadels', () => {
    const iowa = SHIP_BY_ID.iowa;
    const g = { ...broadside(10, 1), z: iowa.beam / 2 };
    const r = resolveShellHit(iowa, g, 'AP', SHIP_BY_ID.yamato.main!.ap!, 650, 550, never);
    expect(r.outcome).toBe('citadel');
  });

  it("Bismarck's turtleback stops a shell that barely defeats the belt", () => {
    const bis = SHIP_BY_ID.bismarck;
    const g = { ...broadside(10, 1), z: bis.beam / 2 };
    const r = resolveShellHit(bis, g, 'AP', SHIP_BY_ID.iowa.main!.ap!, 340, 450, never);
    expect(r.outcome).toBe('penetration');
  });

  it('angled bow plating bounces shells fired from dead ahead', () => {
    const iowa = SHIP_BY_ID.iowa;
    const g: HitGeometry = { x: iowa.length / 2 - 1, y: 2, z: 1, dx: -1, dy: -0.05, dz: 0, axis: 0, part: 'hull' };
    const r = resolveShellHit(iowa, g, 'AP', SHIP_BY_ID.bismarck.main!.ap!, 600, 600, never);
    expect(r.outcome).toBe('ricochet');
  });
});
