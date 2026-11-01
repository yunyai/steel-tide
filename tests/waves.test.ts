import { describe, expect, it } from 'vitest';
import { oceanFragment, oceanVertex, type OceanTier } from '../src/render/OceanLayers';
import { WAVES, waveHeight, type Wave } from '../src/world/Waves';

/** The four swells the sea had before it was given more. */
const FOUR: Wave[] = [
  { dir: 0.35, length: 140, amp: 1.1, steep: 0.35 },
  { dir: -0.6, length: 90, amp: 0.65, steep: 0.35 },
  { dir: 1.3, length: 55, amp: 0.35, steep: 0.3 },
  { dir: 2.4, length: 31, amp: 0.18, steep: 0.3 },
];

/**
 * How close the swells' slope field comes to repeating itself at any shift between `min` and `max`
 * metres: the peak of its normalized autocorrelation, where 1 is an exact repeat. A sum of plane
 * waves has autocorrelation Σ vᵢ·cos(kᵢ·r) / Σ vᵢ, vᵢ being each wave's slope variance.
 */
function nearRepeat(waves: Wave[], min: number, max: number, step = 2): number {
  const ws = waves.map((w) => {
    const k = (2 * Math.PI) / w.length;
    return { kx: k * Math.cos(w.dir), kz: k * Math.sin(w.dir), v: (w.amp * k) ** 2 };
  });
  const total = ws.reduce((s, w) => s + w.v, 0);
  let best = -Infinity;
  for (let x = -max; x <= max; x += step) {
    for (let z = 0; z <= max; z += step) {
      const r2 = x * x + z * z;
      if (r2 < min * min || r2 > max * max) continue;
      let s = 0;
      for (const w of ws) s += w.v * Math.cos(w.kx * x + w.kz * z);
      best = Math.max(best, s / total);
    }
  }
  return best;
}

const rmsHeight = (ws: Wave[]) => Math.sqrt(ws.reduce((s, w) => s + w.amp ** 2 / 2, 0));
const rmsSlope = (ws: Wave[]) => Math.sqrt(ws.reduce((s, w) => s + ((w.amp * 2 * Math.PI) / w.length) ** 2 / 2, 0));

describe('swells', () => {
  it('never come close to repeating within a view of the sea', () => {
    // The four swells all but repeat: the same egg-crate lies every few hundred metres.
    expect(nearRepeat(FOUR, 60, 900)).toBeGreaterThan(0.99);
    expect(nearRepeat(WAVES, 60, 400)).toBeLessThan(0.75);
    expect(nearRepeat(WAVES, 150, 900)).toBeLessThan(0.75);
  });

  it('keep the sea state: wave height and roughness within 10% of the four swells', () => {
    expect(rmsHeight(WAVES) / rmsHeight(FOUR)).toBeGreaterThan(0.9);
    expect(rmsHeight(WAVES) / rmsHeight(FOUR)).toBeLessThan(1.1);
    expect(rmsSlope(WAVES) / rmsSlope(FOUR)).toBeGreaterThan(0.9);
    expect(rmsSlope(WAVES) / rmsSlope(FOUR)).toBeLessThan(1.1);
  });

  it('are all drawn by the ocean shaders, but for the shortest normals on the lite sea', () => {
    const n = WAVES.length;
    const vs = oceanVertex();
    expect(vs).toContain(`uniform vec4 uWaves[${n}];`);
    expect(vs).toContain(`uniform float uSteep[${n}];`);
    expect(vs).toContain(`for (int i = 0; i < ${n}; i++)`);
    // Longest first, so a shader that draws fewer keeps the ones that shape the sea.
    for (let i = 1; i < n; i++) expect(WAVES[i].length).toBeLessThan(WAVES[i - 1].length);
    for (const tier of [0, 1, 2] as OceanTier[]) {
      for (const antiTile of [false, true]) {
        const fs = oceanFragment({ tier, antiTile });
        expect(fs).toContain(`uniform vec4 uWaves[${n}];`);
        expect(fs).toContain(`for (int i = 0; i < ${tier === 0 ? 8 : n}; i++) {\n    vec2 d = uWaves[i].xy;`);
      }
    }
    // The lite sea's eight still never come close to repeating.
    expect(nearRepeat(WAVES.slice(0, 8), 60, 900)).toBeLessThan(0.82);
  });

  it('leave the swell band to the swells: short wind waves stay shorter than the shortest swell', () => {
    const shortest = WAVES[WAVES.length - 1].length;
    const lengths = (glsl: string, set: string) => {
      const m = glsl.match(new RegExp(`const vec4 ${set}\\[(\\d+)\\] = vec4\\[\\1\\]\\(([\\s\\S]*?)\\);`));
      if (!m) return [];
      return [...m[2].matchAll(/vec4\(([^)]*)\)/g)].map((v) => Number(v[1].split(',')[2]));
    };
    for (const tier of [1, 2] as OceanTier[]) {
      const anti = oceanFragment({ tier, antiTile: true });
      const short = [...lengths(anti, 'SMALL'), ...lengths(anti, 'SMALL2')];
      expect(short.length).toBe(tier === 2 ? 4 : 2);
      for (const l of short) expect(l).toBeLessThan(shortest);
      // Without anti-tiling the short waves are as they were.
      expect(lengths(oceanFragment({ tier, antiTile: false }), 'SMALL')).toEqual([14, 21, 33, 45]);
    }
  });

  it('give the hulls the same height the shader draws', () => {
    for (const [x, z, t] of [[0, 0, 0], [123.4, -567.8, 9.1], [-4321, 2789, 100]]) {
      let h = 0;
      for (const w of WAVES) {
        const k = (2 * Math.PI) / w.length;
        h += w.amp * Math.sin(k * (Math.cos(w.dir) * x + Math.sin(w.dir) * z - Math.sqrt(9.81 / k) * t));
      }
      expect(waveHeight(x, z, t)).toBeCloseTo(h, 9);
    }
  });
});
