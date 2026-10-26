import { describe, expect, it } from 'vitest';
import { emptyGame, place } from './helpers';
import { forwardX, forwardZ } from '../src/core/math';

// The preview consumes the same solution used by launchSpread, including origin and tube headings.
describe('torpedo firing solutions', () => {
  for (const id of ['shimakaze', 'gato', 'stepper']) {
    it(`matches actual launches and range for ${id}`, () => {
      const g = emptyGame();
      const s = place(g, id, 0, 0, 0);
      s.control.aimX = id === 'gato' ? 0 : 10000; s.control.aimZ = id === 'gato' ? -10000 : 0;
      s.mods.rangeCap = 4500;
      s.launchers.forEach(l => { l.reload = 0; });
      const solutions = s.launchers.map(l => s.torpedoSolution(l, s.control.aimX, s.control.aimZ));
      expect(solutions.some(p => p.readiness === 'ready')).toBe(true);
      const fired = s.launchSpread(s.spec.torpedoes!);
      const expected = solutions.filter(p => p.readiness === 'ready');
      expect(fired).toBe(expected.reduce((n,p) => n + p.headings.length, 0));
      const torps = g.torps.torps;
      expect(torps.length).toBe(expected.reduce((n,p) => n + p.headings.length, 0));
      let i = 0;
      for (const p of expected) for (const h of p.headings) {
        const t = torps[i++];
        expect(t.x).toBeCloseTo(p.x); expect(t.z).toBeCloseTo(p.z);
        expect(t.heading).toBeCloseTo(h);
        expect(t.range).toBe(p.range);
      }
    });
  }
  it('reports independent readiness and never treats beyond-range aim as unavailable', () => {
    const g = emptyGame(); const s = place(g, 'stepper', 0, 0, 0);
    const [starboard, port] = s.launchers;
    expect(s.torpedoSolution(starboard, 20000, 0).readiness).toBe('ready');
    expect(s.torpedoSolution(port, 20000, 0).readiness).toBe('outside arc');
    starboard.reload = 10;
    expect(s.torpedoSolution(starboard, 20000, 0).readiness).toBe('reloading');
    starboard.reload = 0;
    s.mods.disarmed = true;
    expect(s.torpedoSolution(starboard, 20000, 0).readiness).toBe('disarmed');
    s.mods.disarmed = false; s.mods.stunned = true;
    expect(s.torpedoSolution(starboard, 20000, 0).readiness).toBe('stunned');
  });
  it('provides correct allowed sectors for port, starboard, bow, stern and unrestricted mounts', () => {
    const g = emptyGame(); const s = place(g, 'stepper', 0, 0, 0);
    const l = s.launchers[0];
    for (const side of [-2, -1, 0, 1, 2] as const) {
      const mount = { ...l, spec: { ...l.spec, side } };
      const p = s.torpedoSolution(mount, 5000, 0);
      for (let degree = -179; degree <= 180; degree++) {
        const rel = degree * Math.PI / 180;
        const inSector = p.sectors.some(([lo,hi]) => rel >= lo - 1e-8 && rel <= hi + 1e-8);
        expect(inSector).toBe(s.launcherCanBear(mount, rel));
      }
    }
  });
  it('uses bow/stern tube origins and submarines cannot fire too deep', () => {
    const g = emptyGame(); const s = place(g, 'gato', 0, 0, 0);
    s.depthState = 2;
    for (const l of s.launchers) {
      const p = s.torpedoSolution(l, 0, -5000);
      expect(p.readiness).toBe('too deep');
      const origin = s.localToWorld(l.spec.x, 0, 0);
      expect(p.x).toBe(origin.x); expect(p.z).toBe(origin.z);
      for (const h of p.headings) expect(Number.isFinite(forwardX(h) + forwardZ(h))).toBe(true);
    }
  });
});
