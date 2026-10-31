import { describe, expect, it } from 'vitest';
import { EXACT, PORTED } from '../src/core/detMath';

// LAN peers each run the battle themselves and must agree bit for bit, in any browser. Guard
// the simulation source against the things that break that: wall clocks, unseeded randomness,
// and maths the engines compute differently (exponentiation, unported transcendental functions).

const SIM_DIRS = ['core', 'ships', 'weapons', 'skills', 'ai', 'modes', 'world', 'data', 'ground/sim'];
const SIM_FILES = ['config.ts', 'net/hash.ts', 'net/protocol.ts'];
/** The ports themselves read the native functions on purpose. */
const SKIP = new Set(['core/detMath.ts', 'core/installDetMath.ts']);

const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** Source without comments and string contents, so only code is checked. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``');
}

const files = Object.entries(sources)
  .map(([p, src]) => ({ path: p.replace('../src/', ''), src: code(src) }))
  .filter((f) => (SIM_DIRS.some((d) => f.path.startsWith(`${d}/`)) || SIM_FILES.includes(f.path)) && !SKIP.has(f.path));

describe('simulation determinism guard', () => {
  it('scans the simulation sources', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('uses no wall clock or unseeded randomness', () => {
    const banned = /\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\bcrypto\./;
    const hits = files.flatMap((f) => (banned.test(f.src) ? [`${f.path}: ${f.src.match(banned)![0]}`] : []));
    expect(hits).toEqual([]);
  });

  it('uses no ** (engines round it differently)', () => {
    const hits = files.filter((f) => /\*\*/.test(f.src)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it('uses only exact or ported Math members', () => {
    const allowed = new Set([...EXACT, ...PORTED]);
    const hits = files.flatMap((f) => [...f.src.matchAll(/\bMath\.([A-Za-z0-9_]+)/g)].filter((m) => !allowed.has(m[1])).map((m) => `${f.path}: Math.${m[1]}`));
    expect(hits).toEqual([]);
  });
});

// Rendering, sound and HUD listen on the view tier, which runs after the sim and contains its own
// errors; the simulation listens on the sim tier. Mixing them up lets the view steer a LAN peer.
const VIEW_DIRS = ['render', 'fx', 'ui', 'app', 'player', 'input', 'ground/view'];
const all = Object.entries(sources).map(([p, src]) => ({ path: p.replace('../src/', ''), src: code(src) }));

describe('event tiers', () => {
  it('has the view listen with view(), never on()', () => {
    const view = all.filter((f) => VIEW_DIRS.some((d) => f.path.startsWith(`${d}/`)) || f.path === 'main.ts');
    expect(view.length).toBeGreaterThan(30);
    expect(view.filter((f) => /\.on\(''/.test(f.src)).map((f) => f.path)).toEqual([]);
  });

  it('has the simulation listen with on(), never view()', () => {
    expect(files.filter((f) => /\.view\(/.test(f.src)).map((f) => f.path)).toEqual([]);
  });
});
