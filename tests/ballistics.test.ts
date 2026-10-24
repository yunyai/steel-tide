import { describe, expect, it } from 'vitest';
import { SHELL_DT, buildRangeTable, dragK, penAtVelocity, solve, stepShell } from '../src/weapons/Ballistics';
import { SHIPS } from '../src/data/ships';

function landing(shell: Parameters<typeof dragK>[0], elevation: number): number {
  const k = dragK(shell);
  const s = { x: 0, y: 0, vx: shell.velocity * Math.cos(elevation), vy: shell.velocity * Math.sin(elevation) };
  let px = 0;
  let py = 0;
  for (let i = 0; i < 20000; i++) {
    px = s.x;
    py = s.y;
    stepShell(s, k, SHELL_DT);
    if (s.y < 0 && s.vy < 0) break;
  }
  return px + (s.x - px) * (py / (py - s.y));
}

describe('ballistics', () => {
  for (const ship of SHIPS) {
    const main = ship.main;
    if (!main) continue;
    for (const shell of [main.ap, main.he]) {
      if (!shell) continue;
      it(`${ship.name} ${shell.caliber}mm reaches its rated range and the solver inverts the table`, () => {
        const table = buildRangeTable(shell, main.range);
        expect(table.maxRange).toBeGreaterThanOrEqual(main.range * 0.999);
        for (let i = 1; i < table.count; i++) expect(table.range[i]).toBeGreaterThan(table.range[i - 1]);
        for (const frac of [0.2, 0.5, 0.8, 1]) {
          const d = main.range * frac;
          const sol = solve(table, d);
          const hit = landing(shell, sol.elevation);
          expect(Math.abs(hit - d) / d).toBeLessThan(0.01);
        }
      });
    }
  }

  it('battleship flight times stay readable at max range', () => {
    const y = SHIPS.find((s) => s.id === 'yamato')!.main!;
    const t = solve(buildRangeTable(y.ap!, y.range), y.range).time;
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(10);
  });

  it('penetration falls with velocity', () => {
    const ap = SHIPS[0].main!.ap!;
    expect(penAtVelocity(ap, ap.velocity)).toBeCloseTo(ap.pen);
    expect(penAtVelocity(ap, ap.velocity * 0.6)).toBeLessThan(ap.pen * 0.6);
  });
});
