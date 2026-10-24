import { describe, expect, it } from 'vitest';
import * as D from '../src/core/detMath';
import { makeRng } from '../src/core/math';

// The ports must agree with a good libm (V8's) to within an ulp; their point is that every
// engine then gets the same bits.

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
function ulps(a: number, b: number): number {
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const bits = (x: number) => {
    f64[0] = x;
    const v = i64[0];
    return v < 0n ? -(v & 0x7fffffffffffffffn) : v;
  };
  const d = bits(a) - bits(b);
  return Number(d < 0n ? -d : d);
}

const rng = makeRng(7);
const sample = (lo: number, hi: number) => lo + (hi - lo) * rng();
const N = 200000;

type Fn1 = (x: number) => number;
const unary: [keyof typeof D.native & keyof typeof D, number, number][] = [
  ['sin', -60, 60],
  ['cos', -60, 60],
  ['tan', -6, 6],
  ['asin', -1, 1],
  ['acos', -1, 1],
  ['atan', -40, 40],
  ['exp', -700, 700],
  ['log', 1e-300, 1e6],
];

describe('deterministic math', () => {
  for (const [name, lo, hi] of unary) {
    it(`${name} is within 1 ulp of the engine`, () => {
      const mine = D[name] as Fn1;
      const ref = D.native[name] as Fn1;
      let worst = 0;
      let at = 0;
      for (let i = 0; i < N; i++) {
        // Mix uniform samples with small magnitudes, where most of the branches live.
        const x = i % 3 === 0 ? sample(lo, hi) : i % 3 === 1 ? sample(-1, 1) * Math.min(Math.abs(lo), Math.abs(hi), 4) : sample(lo, hi) * 1e-6;
        if (name === 'log' && x <= 0) continue;
        const u = ulps(mine(x), ref(x));
        if (u > worst) {
          worst = u;
          at = x;
        }
      }
      expect(worst, `${name}(${at}) off by ${worst} ulp`).toBeLessThanOrEqual(1);
    });
  }

  it('atan2 is within 1 ulp of the engine in every quadrant', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const y = sample(-5000, 5000) * (i % 4 === 0 ? 1e-9 : 1);
      const x = sample(-5000, 5000);
      worst = Math.max(worst, ulps(D.atan2(y, x), D.native.atan2(y, x)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('pow is within 1 ulp of the engine', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const x = sample(0, 50);
      const y = sample(-8, 8);
      worst = Math.max(worst, ulps(D.pow(x, y), D.native.pow(x, y)));
      const n = Math.floor(sample(-20, 20));
      worst = Math.max(worst, ulps(D.pow(-x, n), D.native.pow(-x, n)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('hypot matches the summed squares', () => {
    expect(D.hypot(3, 4)).toBe(5);
    expect(D.hypot(1, 2, 2)).toBe(3);
    expect(D.hypot()).toBe(0);
    expect(D.hypot(-7)).toBe(7);
    expect(D.hypot(NaN, Infinity)).toBe(Infinity);
    expect(D.hypot(NaN, 1)).toBeNaN();
  });

  it('handles the special values like the spec', () => {
    const specials = [0, -0, NaN, Infinity, -Infinity, 1, -1, 5e-324, 2.2250738585072014e-308, 1e300, -1e300, Math.PI / 2, Math.PI, 709.78, -745.2];
    for (const name of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log'] as const) {
      for (const x of specials) {
        if (Math.abs(x) >= 1e300 && (name === 'sin' || name === 'cos' || name === 'tan')) continue;
        const a = (D[name] as Fn1)(x);
        const b = (D.native[name] as Fn1)(x);
        expect(ulps(a, b), `${name}(${x}) = ${a}, engine ${b}`).toBeLessThanOrEqual(1);
        if (a === 0) expect(Object.is(a, b), `${name}(${x}) sign of zero`).toBe(true);
      }
    }
    for (const x of specials) {
      for (const y of [0, -0, NaN, Infinity, -Infinity, 1, -1, 2, 0.5, 3, -3, 1e10, 2.5]) {
        const a = D.pow(x, y);
        const b = D.native.pow(x, y);
        expect(ulps(a, b), `pow(${x}, ${y}) = ${a}, engine ${b}`).toBeLessThanOrEqual(1);
      }
      for (const y of specials) {
        const a = D.atan2(x, y);
        const b = D.native.atan2(x, y);
        expect(ulps(a, b), `atan2(${x}, ${y}) = ${a}, engine ${b}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('huge trig arguments stay finite and repeatable', () => {
    for (const x of [1e7, -3e9, 1e15, 1e300]) {
      expect(Number.isFinite(D.sin(x))).toBe(true);
      expect(D.sin(x)).toBe(D.sin(x));
    }
  });
});
