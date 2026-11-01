import { describe, expect, it } from 'vitest';
import { QUALITIES } from '../src/render/Quality';
import { fetchCount, oceanFragment, oceanLayers, tierLayers, type OceanTier } from '../src/render/OceanLayers';

const TIERS: OceanTier[] = [0, 1, 2];

/** The ripple layers the sea drew before anti-tiling, per tier (lite is tier 0). */
const TODAY = {
  fine: { scale: 13.7, angle: 0.37, drift: [0.021, 0.013], weight: 0.07, fade: 'fine' },
  mid: { scale: 61.0, angle: 1.93, drift: [-0.009, 0.014], weight: 0.08, fade: 'mid' },
  broad: { scale: 237.0, angle: 2.71, drift: [0.003, -0.005], weight: 0.07, fade: 'broad' },
};

/** Distance between two angles once a quarter turn is folded away (a square tile looks the same turned 90°). */
function quarterGap(a: number, b: number): number {
  const q = Math.PI / 2;
  const d = (((a - b) % q) + q) % q;
  return Math.min(d, q - d);
}

/** The closest small ratio p/q (p, q up to 4) to `r` ≥ 1, as a relative miss. */
function smallRatioMiss(r: number): number {
  let best = Infinity;
  for (let p = 1; p <= 4; p++) for (let q = 1; q <= p; q++) best = Math.min(best, Math.abs(r - p / q) / (p / q));
  return best;
}

describe('ocean layers', () => {
  it('maps the quality tiers onto ocean detail', () => {
    expect([QUALITIES.ultralow, QUALITIES.low, QUALITIES.medium, QUALITIES.high].map((q) => q.oceanDetail)).toEqual([0, 0, 1, 2]);
  });

  it('keeps today’s layers and fetches without anti-tiling', () => {
    const pick = (t: OceanTier) => oceanLayers({ tier: t, antiTile: false }).map(({ scale, angle, drift, weight, fade }) => ({ scale, angle, drift, weight, fade }));
    expect(pick(0)).toEqual([TODAY.broad]);
    expect(pick(1)).toEqual([TODAY.fine, TODAY.mid, TODAY.broad]);
    expect(pick(2)).toEqual([TODAY.fine, TODAY.mid, TODAY.broad]);
    expect(TIERS.map((t) => fetchCount({ tier: t, antiTile: false }))).toEqual([4, 8, 8]);
  });

  it('holds the fetch budget with anti-tiling: lite 5, medium 9, high 9', () => {
    expect(TIERS.map((t) => fetchCount({ tier: t, antiTile: true }))).toEqual([5, 9, 9]);
  });

  it('takes the foam ridge from the flowing layer on high instead of a fetch of its own', () => {
    const ridgeFetch = 'float ridge = texture2D(uDetail';
    expect(oceanFragment({ tier: 2, antiTile: true })).not.toContain(ridgeFetch);
    expect(oceanFragment({ tier: 2, antiTile: true })).toContain('float ridge = flowRidge;');
    for (const t of [0, 1] as OceanTier[]) expect(oceanFragment({ tier: t, antiTile: true })).toContain(ridgeFetch);
    for (const t of TIERS) expect(oceanFragment({ tier: t, antiTile: false })).toContain(ridgeFetch);
    expect(tierLayers({ tier: 2, antiTile: true }).some((l) => l.kind === 'ridge')).toBe(false);
  });

  it.each(TIERS)('gives each swell on tier %i its own patch straight from a patch-wave component', (t) => {
    const glsl = oceanFragment({ tier: t, antiTile: true });
    expect(glsl).toContain('* (1.0 + 0.2 * pb[i]);');
    expect(glsl).not.toContain('SWELL_PATCH');
  });

  it('writes today’s ripple lines without anti-tiling', () => {
    const glsl = oceanFragment({ tier: 1, antiTile: false });
    expect(glsl).toContain('slope += ripple(vWorld.xz, 13.7, 0.37, vec2(0.021, 0.013)) * 0.07 * fine * rough;');
    expect(glsl).toContain('slope += ripple(vWorld.xz, 61.0, 1.93, vec2(-0.009, 0.014)) * 0.08 * mid * rough;');
    expect(glsl).toContain('slope += ripple(vWorld.xz, 237.0, 2.71, vec2(0.003, -0.005)) * 0.07 * broad * rough;');
    expect(glsl).toContain('pow(sunAmt, 900.0)');
    expect(oceanFragment({ tier: 0, antiTile: false })).not.toContain('13.7');
  });

  it.each(TIERS)('draws one sample per layer on tier %i, a flowing layer twice', (t) => {
    const glsl = oceanFragment({ tier: t, antiTile: true });
    for (const l of oceanLayers({ tier: t, antiTile: true })) {
      const call = `${l.flow?.includes(t) ? 'rippleFlow' : 'ripple'}(P, ${l.scale.toFixed(1)}`;
      expect(glsl.split(call).length - 1, call).toBe(1);
    }
    expect(glsl.includes('/ 1130.0')).toBe(t > 0);
    expect(glsl.includes('SMALL2')).toBe(t === 2);
  });

  it.each(TIERS)('lines no two layers up on tier %i: no small scale ratio, no shared angle modulo a quarter turn', (t) => {
    const ls = tierLayers({ tier: t, antiTile: true });
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const [a, b] = ls[i].scale > ls[j].scale ? [ls[i], ls[j]] : [ls[j], ls[i]];
        expect(smallRatioMiss(a.scale / b.scale), `${a.scale} / ${b.scale}`).toBeGreaterThan(0.03);
        expect(quarterGap(a.angle, b.angle), `${a.angle} vs ${b.angle}`).toBeGreaterThan(0.2);
      }
    }
  });

  it('skips each short-wave set on high wherever the wind patch gives it no weight', () => {
    const glsl = oceanFragment({ tier: 2, antiTile: true });
    expect(glsl).toContain('if (sb < 1.0) {');
    expect(glsl).toContain('if (sb > 0.0) {');
  });

  it.each(TIERS)('takes every wind-patch mask on tier %i from two shared patch waves: one sine and one cosine on top of before', (t) => {
    const count = (glsl: string, fn: string) => glsl.slice(glsl.indexOf('void main()')).split(`${fn}(`).length - 1;
    const before = oceanFragment({ tier: t, antiTile: false });
    const anti = oceanFragment({ tier: t, antiTile: true });
    expect(anti).toContain('vec4 pb = vec4(sin(pa), cos(pa));');
    expect(anti).not.toContain('windPatch');
    expect(count(anti, 'sin')).toBe(count(before, 'sin') + 1);
    // High also adds the second short-wave set.
    expect(count(anti, 'cos')).toBe(count(before, 'cos') + (t === 2 ? 2 : 1));
  });

  it.each([1, 2] as OceanTier[])('bends the short wind waves on tier %i through the warp, but never the swells the hulls ride', (t) => {
    const glsl = oceanFragment({ tier: t, antiTile: true });
    const shortWaves = glsl.split('\n').filter((l) => /float ph = k \* \(dot\(d, /.test(l) && !l.includes('c * uTime'));
    expect(shortWaves.length).toBe(t === 2 ? 2 : 1);
    for (const l of shortWaves) expect(l).toContain('dot(d, P)');
    expect(glsl).toContain('float ph = k * (dot(d, vWorld.xz) - c * uTime);');
    expect(oceanFragment({ tier: t, antiTile: false })).not.toContain('dot(d, P)');
  });

  it.each(TIERS)('masks each ripple layer on tier %i with a patch-wave component no other layer there uses', (t) => {
    const glsl = oceanFragment({ tier: t, antiTile: true });
    const used = oceanLayers({ tier: t, antiTile: true }).map((l) => {
      const line = glsl.split('\n').find((x) => x.includes(`(P, ${l.scale.toFixed(1)},`)) ?? '';
      return /\* \(1\.0 \+ 0\.3 \* pb\.([xyzw])\)/.exec(line)?.[1];
    });
    expect(used.every(Boolean), used.join()).toBe(true);
    expect(new Set(used).size).toBe(used.length);
  });

  it('finds today’s medium layers lined up (the case the anti-tiling fixes)', () => {
    const ls = tierLayers({ tier: 1, antiTile: false });
    const bad = ls.some((a, i) => ls.some((b, j) => j > i && (quarterGap(a.angle, b.angle) <= 0.2 || smallRatioMiss(Math.max(a.scale, b.scale) / Math.min(a.scale, b.scale)) <= 0.03)));
    expect(bad).toBe(true);
  });
});
