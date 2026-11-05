import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { MiscTitanFx } from '../src/render/MiscTitanFx';
import { cite, JUDGE } from '../src/skills/misc/JudgeRuntime';
import type { JudgeFxKind } from '../src/skills/misc/MiscEvents';
import { emptyGame, place, run } from './helpers';

// The Judge's effects: every event it emits plays as a burst, its court and warnings are public,
// and the case it holds on each enemy hangs over that enemy for whoever can see it.

function court(): { g: Game; judge: Ship; enemy: Ship; fx: MiscTitanFx } {
  const g = emptyGame();
  const judge = place(g, 'judge', 0, 0, 0);
  const enemy = place(g, 'stepper', 1, 1500, 0);
  const fx = new MiscTitanFx(new Scene(), g);
  return { g, judge, enemy, fx };
}

/** What one viewport draws: ribbon segments plus particles. */
function drawn(fx: MiscTitanFx, team: 0 | 1 | -1 = -1): number {
  fx.update(1, 1 / 60);
  fx.prepare(team, 720);
  return fx.ribbons.count + fx.kit.particles.count;
}

const KINDS: JudgeFxKind[] = ['court', 'cite', 'gavelThrow', 'gavelHit', 'contempt', 'arrest', 'taxes', 'objection', 'martial', 'warn', 'verdict', 'death'];

describe('Judge effects', () => {
  it.each(KINDS)('play a %s burst', (kind) => {
    const { g, judge, enemy, fx } = court();
    expect(drawn(fx)).toBe(0);
    g.events.emit('miscTitan', { ship: judge, kind, x: 0, z: 0, tx: enemy.pos.x, tz: enemy.pos.z, target: enemy, radius: 900, n: 1 });
    run(g, 0.2);
    expect(drawn(fx)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('fly the gavel until it lands, then stop drawing it', () => {
    const { g, judge, enemy, fx } = court();
    enemy.pos.x = JUDGE.gavel.speed;
    g.events.emit('miscTitan', { ship: judge, kind: 'gavelThrow', x: 0, z: 0, tx: enemy.pos.x, tz: 0, target: enemy, n: 0 });
    run(g, 0.5);
    expect(drawn(fx)).toBeGreaterThan(0);
    run(g, 0.7);
    expect(fx.bursts).toBe(1);
    expect(drawn(fx)).toBe(0);
    fx.dispose();
  });

  it('show the court and a pending Verdict to a team that cannot see the Judge', () => {
    const { g, judge, fx } = court();
    judge.mods.untargetable = true;
    expect(drawn(fx, 1)).toBe(0);
    judge.judge!.court = { x: 0, z: 0 };
    const withCourt = drawn(fx, 1);
    expect(withCourt).toBeGreaterThan(0);
    judge.judge!.pending.push({ kind: 'verdict', target: -1, x: 800, z: 0, at: g.time + 1 });
    expect(drawn(fx, 1)).toBeGreaterThan(withCourt);
    fx.dispose();
  });

  it('hang the case over a cited enemy only where it can be seen, with a blade from the Death Penalty mark', () => {
    const { judge, enemy, fx } = court();
    const empty = drawn(fx);
    cite(judge, enemy, 5);
    const open = drawn(fx);
    expect(open).toBeGreaterThan(empty);
    judge.judge!.cases[0].stacks = JUDGE.death;
    expect(drawn(fx)).toBeGreaterThan(open);
    enemy.mods.untargetable = true;
    expect(drawn(fx, 0)).toBe(empty);
    fx.dispose();
  });

  it('flash the sky, shake the Judge’s captain and bend the light when the Verdict lands', () => {
    const { g, judge, fx } = court();
    const flashes: number[] = [];
    const shakes: Ship[] = [];
    fx.onFlash = (_x, _z, amount) => flashes.push(amount);
    fx.onShake = (s) => shakes.push(s);
    g.events.emit('miscTitan', { ship: judge, kind: 'verdict', x: 800, z: 0, radius: JUDGE.verdict.radius, n: 0 });
    expect(flashes).toEqual([0.6]);
    if (!fx.kit.reduce) expect(shakes).toEqual([judge]);
    drawn(fx);
    if (!fx.kit.reduce) expect(fx.distortions.length).toBeGreaterThan(0);
    fx.dispose();
  });
});
