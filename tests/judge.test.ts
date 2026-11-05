import { describe, expect, it } from 'vitest';
import { KNOT, SPEED_SCALE } from '../src/config';
import type { Game } from '../src/core/Game';
import { NEW_MISC } from '../src/data/miscTitans';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import { DEFAULT_SETTINGS } from '../src/net/protocol';
import { emptyControl, type Ship } from '../src/ships/Ship';
import { miscBattery } from '../src/skills/misc/MiscBattery';
import { cite, JUDGE, LAWS, recordJudgeAction, updateJudge, violationCount } from '../src/skills/misc/JudgeRuntime';
import { judgePanel, miscMarkerChip, miscVictimBanner } from '../src/ui/MiscTitanPresentation';
import { navalRules } from '../server/rules';
import { emptyGame, place, run } from './helpers';

// The Judge: a court that enforces all six laws at once, a gavel battery that cites what it hits,
// a thrown gavel that ricochets between open cases, and punishments that scale with each case.

const kn = (v: number) => v * KNOT * SPEED_SCALE;

function court(g: Game, x = 0, z = 0): Ship {
  const j = place(g, 'judge', 0, x, z);
  j.control.aimX = x;
  j.control.aimZ = z;
  expect(j.activateSkill(0)).toBe(true);
  return j;
}

/** A sturdy enemy that holds still unless told otherwise. */
function dummy(g: Game, x: number, z: number): Ship {
  const t = place(g, 'iowa', 1, x, z, Math.PI / 2);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 0;
  return t;
}

/** Steps only the Judge's court for `seconds`, with `t` held to `knots` on a fixed heading. */
function sail(g: Game, j: Ship, t: Ship, seconds: number, knots: number, turn = 0): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t.speed = kn(knots);
    t.heading += turn / 60;
    g.time += 1 / 60;
    updateJudge(j, 1 / 60);
  }
}

function aim(j: Ship, t: Ship): void {
  j.control.aimX = t.pos.x;
  j.control.aimZ = t.pos.z;
}

describe('Judge court', () => {
  it('registers a complete titan kit with the Gavel on E', () => {
    const skills = SHIP_BY_ID.judge!.skills;
    expect(skills).toHaveLength(9);
    expect(skills[1].id).toBe('judgeGavel');
  });

  it('enforces every law as soon as the court is placed', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 300, 0);
    sail(g, j, t, 0.5, 15);
    expect(violationCount(j, t)).toBe(0);
    recordJudgeAction(t, 'fire');
    recordJudgeAction(t, 'skill');
    expect(violationCount(j, t)).toBe(2);
    sail(g, j, t, 0.9, 25);
    expect(violationCount(j, t)).toBe(3);
    sail(g, j, t, 0.9, 4);
    expect(violationCount(j, t)).toBe(4);
    sail(g, j, t, 0.9, 15, 1);
    expect(violationCount(j, t)).toBe(5);
    t.pos.x = 2600;
    sail(g, j, t, 0.1, 15);
    expect(violationCount(j, t)).toBe(6);
  });

  it('leaves a ship that obeys all six laws alone', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 300, 0);
    sail(g, j, t, 6, 15);
    expect(violationCount(j, t)).toBe(0);
  });

  it('counts each law at most once a second and keeps cases through Taxes', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 300, 0);
    recordJudgeAction(t, 'fire');
    recordJudgeAction(t, 'fire');
    expect(violationCount(j, t)).toBe(1);
    aim(j, t);
    j.activateSkill(4);
    expect(violationCount(j, t)).toBe(1);
  });

  it('decays violations only after leaving for five seconds', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 300, 0);
    recordJudgeAction(t, 'fire');
    t.pos.x = 5000;
    run(g, 4);
    expect(violationCount(j, t)).toBeGreaterThanOrEqual(1);
    const held = violationCount(j, t);
    run(g, 2.1);
    expect(violationCount(j, t)).toBeLessThan(held);
  });

  it('caps a case at 50 and doubles violations under Martial Law', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 500, 0);
    j.meter = 1;
    j.activateSkill(6);
    recordJudgeAction(t, 'fire');
    recordJudgeAction(t, 'skill');
    expect(violationCount(j, t)).toBe(4);
    cite(j, t, 100);
    expect(violationCount(j, t)).toBe(JUDGE.cap);
    expect(JUDGE.cap).toBe(50);
  });

  it('keeps cases isolated and clears them when their target withdraws', () => {
    const g = emptyGame();
    const a = court(g);
    const b = court(g, 0, 600);
    const t = place(g, 'stepper', 1, 500, 0);
    cite(a, t, 1);
    expect(violationCount(a, t)).toBe(1);
    expect(violationCount(b, t)).toBe(0);
    t.withdraw();
    expect(violationCount(a, t)).toBe(0);
  });

  it('ignores forced displacement for the movement laws', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 500, 0);
    t.pushX = 100;
    sail(g, j, t, 0.1, 0);
    expect(violationCount(j, t)).toBe(0);
    t.pushX = 0;
    sail(g, j, t, 0.1, 0);
    expect(violationCount(j, t)).toBe(1);
  });
});

describe('Judge gavel battery', () => {
  it('fires 34k AP and 20k HE gavel bolts every 7 s, before the battle-wide main gun buff', () => {
    const main = NEW_MISC.find((s) => s.id === 'judge')!.main!;
    expect(main.look).toBe('gavel');
    expect(main.ap!.damage).toBe(34000);
    expect(main.he!.damage).toBe(20000);
    expect(main.reload).toBe(7);
  });

  it('cites each target a salvo strikes once', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    let hits = 0;
    g.events.on('shellHit', (e) => {
      if (e.attacker === j) hits++;
    });
    aim(j, t);
    for (let i = 0; i < 240 && !j.turrets[0].canBear; i++) run(g, 1 / 60);
    expect(j.fireTurret(0, 'AP', true)).toBe(true);
    for (let i = 0; i < 900 && g.shells.shells.some((p) => p.alive); i++) run(g, 1 / 60);
    expect(hits).toBeGreaterThan(1);
    expect(violationCount(j, t)).toBe(1);
  });

  it('hits 2% harder per violation on the target', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    const rider = miscBattery(j, 0)!;
    expect(rider.hitMul!(t)).toBeCloseTo(1);
    cite(j, t, 25);
    expect(rider.hitMul!(t)).toBeCloseTo(1.5);
  });
});

describe('Judge skills', () => {
  it('slams the court down for 80k and two violations on every enemy inside', () => {
    const g = emptyGame();
    const a = dummy(g, 600, 0);
    const b = dummy(g, -1500, 0);
    const out = dummy(g, 2600, 0);
    const j = court(g);
    for (const t of [a, b]) {
      expect(t.maxHp - t.hp).toBeCloseTo(JUDGE.court.damage, 0);
      expect(violationCount(j, t)).toBe(2);
    }
    expect(out.hp).toBe(out.maxHp);
    expect(violationCount(j, out)).toBe(0);
  });

  it('throws a gavel that ricochets only to open cases, 80% each bounce, citing two per hit', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const first = dummy(g, 0, -2000);
    const cased = dummy(g, 800, -2000);
    const clean = dummy(g, -700, -2000);
    cite(j, cased, 5);
    aim(j, first);
    expect(j.activateSkill(1)).toBe(true);
    run(g, 3);
    expect(first.maxHp - first.hp).toBeCloseTo(JUDGE.gavel.damage, 0);
    expect(cased.maxHp - cased.hp).toBeCloseTo((JUDGE.gavel.damage + 5 * JUDGE.gavel.perViolation) * 0.8, 0);
    expect(clean.hp).toBe(clean.maxHp);
    expect(violationCount(j, first)).toBe(2);
    expect(violationCount(j, cased)).toBe(7);
  });

  it('stops ricocheting after three bounces', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const chain = [0, 1, 2, 3, 4].map((i) => dummy(g, i * 900, -2000));
    for (const t of chain) cite(j, t, 1);
    aim(j, chain[0]);
    j.activateSkill(1);
    run(g, 5);
    expect(chain.slice(0, 4).every((t) => t.hp < t.maxHp)).toBe(true);
    expect(chain[4].hp).toBe(chain[4].maxHp);
  });

  it('freezes for a second, then holds the target in contempt: ×3 violations and a 15k zap each', () => {
    const g = emptyGame();
    const j = court(g);
    const t = dummy(g, 500, 0);
    aim(j, t);
    expect(j.activateSkill(2)).toBe(true);
    run(g, 0.8);
    expect(t.mods.rooted).toBe(true);
    expect(t.mods.disarmed).toBe(false);
    run(g, 1);
    expect(t.mods.rooted).toBe(false);
    const before = violationCount(j, t);
    const hp = t.hp;
    g.time += 1.01;
    recordJudgeAction(t, 'fire');
    expect(violationCount(j, t)).toBe(before + 3);
    expect(hp - t.hp).toBeCloseTo(JUDGE.contempt.zap, 0);
  });

  it('drags an arrested enemy to court, hurting it and citing it every second', () => {
    const g = emptyGame();
    const j = court(g);
    const t = dummy(g, 1500, 0);
    const hp = t.hp;
    const cases = violationCount(j, t);
    aim(j, t);
    expect(j.activateSkill(3)).toBe(true);
    run(g, 2.05);
    expect(t.pos.x).toBeLessThan(1500);
    expect(hp - t.hp).toBeGreaterThan(JUDGE.arrest.dps * 1.9);
    expect(violationCount(j, t) - cases).toBeGreaterThanOrEqual(2);
  });

  it('collects Taxes of 90k plus 10k per violation and heals the Judge 30% of it', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = dummy(g, 0, -1500);
    cite(j, t, 4);
    j.hp = j.maxHp / 2;
    aim(j, t);
    expect(j.activateSkill(4)).toBe(true);
    const dealt = t.maxHp - t.hp;
    expect(dealt).toBeCloseTo(JUDGE.taxes.damage + 4 * JUDGE.taxes.perViolation, 0);
    expect(j.hp - j.maxHp / 2).toBeCloseTo(dealt * JUDGE.taxes.heal, 0);
  });

  it('dismisses hostile hits under Objection, citing the attacker and reflecting 30%', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = dummy(g, 0, -1500);
    expect(j.activateSkill(5)).toBe(true);
    let dismissed = 0;
    for (let i = 0; i < 20; i++) if (j.takeDamage(10000, t) === 0) dismissed++;
    expect(dismissed).toBeGreaterThan(3);
    expect(dismissed).toBeLessThan(17);
    expect(violationCount(j, t)).toBe(dismissed);
    expect(t.maxHp - t.hp).toBeCloseTo(dismissed * 10000 * JUDGE.objection.reflect, 0);
  });

  it('opens Martial Law with a strike on every enemy in court and twice-as-fast guns', () => {
    const g = emptyGame();
    const j = court(g);
    const t = dummy(g, 2500, 0);
    cite(j, t, 10);
    const hp = t.hp;
    j.meter = 1;
    expect(j.activateSkill(6)).toBe(true);
    expect(hp - t.hp).toBeCloseTo(JUDGE.martial.damage + 10 * JUDGE.martial.perViolation, 0);
    run(g, 1 / 60);
    expect(j.mods.reloadMul).toBeCloseTo(0.5);
  });

  it('brings down the Verdict for 450k plus 15k per violation', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    cite(j, t, 6);
    aim(j, t);
    j.meter = 1;
    expect(j.activateSkill(7)).toBe(true);
    run(g, JUDGE.verdict.warn + 0.1);
    expect(t.maxHp - t.hp).toBeCloseTo(JUDGE.verdict.damage + 6 * JUDGE.verdict.perViolation, -3);
  });

  it('refuses Death Penalty below 30 violations and lands it at 30, spending the case', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = place(g, 'iowa', 1, 300, 0);
    cite(j, t, 29);
    j.meter = 1;
    aim(j, t);
    expect(j.activateSkill(8)).toBe(false);
    expect(j.skills[8].meter).toBe(1);
    cite(j, t, 1);
    expect(j.activateSkill(8)).toBe(true);
    run(g, 1.3);
    expect(t.alive).toBe(false);
    expect(violationCount(j, t)).toBe(0);
  });

  it('lets shields and defensive skills survive the Death Penalty', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = place(g, 'stepper', 1, 300, 0);
    cite(j, t, 30);
    t.addShield(t.maxHp, 10);
    j.meter = 1;
    aim(j, t);
    expect(j.activateSkill(8)).toBe(true);
    run(g, 1.3);
    expect(t.alive).toBe(true);
    expect(t.hp).toBe(t.maxHp);
    expect(violationCount(j, t)).toBe(0);
  });
});

describe('Judge network surface', () => {
  it('has no law edge left', () => {
    expect('judgeLaw' in emptyControl()).toBe(false);
    expect(navalRules.cleanEdge({ sk: 1, jl: 5 }, DEFAULT_SETTINGS)).toEqual({ sk: 1 });
  });

  it('hashes thrown gavels and contempt', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const t = dummy(g, 0, -2000);
    const h0 = stateHash(g);
    aim(j, t);
    j.activateSkill(1);
    const h1 = stateHash(g);
    expect(h1).not.toBe(h0);
    cite(j, t, 1);
    j.judge!.cases[0].contemptUntil = 99;
    expect(stateHash(g)).not.toBe(h1);
  });
});

describe('Judge HUD', () => {
  it('lights the laws the aimed target is breaking, with its case and the cash-out previews', () => {
    const g = emptyGame();
    const j = court(g);
    const t = place(g, 'stepper', 1, 300, 0);
    sail(g, j, t, 0.1, 25);
    cite(j, t, 9);
    const p = judgePanel(j, t);
    expect(p.court).toBe('ACTIVE');
    expect(p.laws).toHaveLength(LAWS.length);
    expect(p.laws.find((l) => l.id === 'speedLimit')!.broken).toBe(true);
    expect(p.laws.find((l) => l.id === 'ceasefire')!.broken).toBe(false);
    expect(p.case).toEqual({ n: 10, cap: 50, death: 30 });
    expect(p.previews.gavel).toBe(JUDGE.gavel.damage + 10 * JUDGE.gavel.perViolation);
    expect(p.previews.taxes).toBe(JUDGE.taxes.damage + 10 * JUDGE.taxes.perViolation);
    expect(p.previews.verdict).toBe(JUDGE.verdict.damage + 10 * JUDGE.verdict.perViolation);
    expect(p.deathReady).toBe(false);
    expect(p.top[0]).toEqual({ name: t.name, n: 10 });
  });

  it('marks enemies with their case, red from 30', () => {
    const g = emptyGame();
    const j = place(g, 'judge', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 0, 800);
    const t = place(g, 'stepper', 1, 300, 0);
    expect(miscMarkerChip(ally, t)).toBeNull();
    cite(j, t, 12);
    expect(miscMarkerChip(ally, t)).toMatchObject({ kind: 'judge', text: '⚖ 12', alert: false });
    cite(j, t, 18);
    expect(miscMarkerChip(j, t)).toMatchObject({ text: '⚖ 30', alert: true });
    expect(miscMarkerChip(t, j)).toBeNull();
  });

  it('shows a victim the court, its laws and their own case', () => {
    const g = emptyGame();
    const j = court(g);
    const inside = place(g, 'stepper', 1, 500, 0);
    const outside = place(g, 'stepper', 1, 4000, 0);
    expect(miscVictimBanner(outside)).toBeNull();
    cite(j, inside, 3);
    const b = miscVictimBanner(inside)!;
    expect(b.kind).toBe('judge');
    expect(b.title).toBe('Court of the Judge');
    expect(b.laws).toHaveLength(6);
    expect(b.meter).toEqual({ n: 3, cap: 50, mark: 30 });
    expect(miscVictimBanner(j)).toBeNull();
  });
});
