import { KNOT, SPEED_SCALE } from '../../config';
import { wrapAngle } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { buff, hurt } from '../kit';
import { emitMisc, type TitanRider } from './MiscEvents';
import { moveSafe } from './MiscSupport';

// The Judge's court. Inside it all six laws hold at once; each break, gavel bolt and punishment adds
// violations to the offender's case, and the case is what the Judge's punishments cash out.

export const LAWS = ['ceasefire', 'silence', 'speedLimit', 'noLoitering', 'straightAhead', 'closedBorders'] as const;
export type Law = (typeof LAWS)[number];
export const LAW_LABELS: Record<Law, string> = {
  ceasefire: 'Ceasefire',
  silence: 'Silence',
  speedLimit: 'Speed Limit',
  noLoitering: 'No Loitering',
  straightAhead: 'Straight Ahead',
  closedBorders: 'Closed Borders',
};
/** What each law asks of a ship inside the court. */
export const LAW_LIMITS: Record<Law, string> = {
  ceasefire: 'hold fire',
  silence: 'no skills',
  speedLimit: '≤ 20 kn',
  noLoitering: '≥ 10 kn',
  straightAhead: 'hold course',
  closedBorders: 'stay inside',
};
/** The popup a victim sees when it breaks each law. */
export const LAW_OFFENCES: Record<Law, string> = {
  ceasefire: 'OPENING FIRE',
  silence: 'BREAKING SILENCE',
  speedLimit: 'SPEEDING',
  noLoitering: 'LOITERING',
  straightAhead: 'SWERVING',
  closedBorders: 'FLEEING COURT',
};

export const JUDGE = {
  /** Most violations one case holds. */
  cap: 50,
  /** Violations the Death Penalty needs. */
  death: 30,
  court: { radius: 2000, martialRadius: 3000, range: 5000, damage: 80000, cite: 2 },
  battery: { perViolation: 0.02 },
  gavel: { damage: 120000, perViolation: 6000, cite: 2, bounces: 3, reach: 2000, falloff: 0.8, speed: 3500 },
  contempt: { warn: 0.65, freeze: 1, time: 6, mul: 3, zap: 15000 },
  arrest: { time: 3, dps: 30000, slow: 0.45, drag: 650 },
  taxes: { damage: 90000, perViolation: 10000, heal: 0.3 },
  objection: { chance: 0.5, reflect: 0.3 },
  martial: { time: 12, damage: 120000, perViolation: 4000, reload: 0.5 },
  verdict: { warn: 1.1, radius: 850, damage: 450000, perViolation: 15000 },
  deathWarn: 1.1,
} as const;

/** Skill slots, in key order Q E Z X C V R T B. */
export const JUDGE_SLOT = { court: 0, gavel: 1, contempt: 2, arrest: 3, taxes: 4, objection: 5, martial: 6, verdict: 7, death: 8 } as const;

interface Case {
  target: number;
  stacks: number;
  /** When each law was last broken, by `LAWS` index. */
  last: number[];
  outside: number;
  inside: boolean;
  heading: number;
  decay: number;
  /** Until when violations count triple and zap. */
  contemptUntil: number;
}

/** A thrown gavel in flight to its `hop`th target. */
interface Gavel {
  target: number;
  hop: number;
  x: number;
  z: number;
  at: number;
  /** Targets already struck by this throw. */
  hit: number[];
}

export interface JudgeState {
  court: { x: number; z: number } | null;
  boundary: string;
  cases: Case[];
  martialUntil: number;
  objectionUntil: number;
  pending: { kind: 'freeze' | 'verdict' | 'death'; target: number; x: number; z: number; at: number }[];
  arrests: { target: number; until: number; effect: string; x: number; z: number; tick: number }[];
  gavels: Gavel[];
}

export function newJudgeState(): JudgeState {
  return { court: null, boundary: '', cases: [], martialUntil: 0, objectionUntil: 0, pending: [], arrests: [], gavels: [] };
}

export function courtRadius(s: Ship): number {
  return s.judge && s.judge.martialUntil > s.game.time ? JUDGE.court.martialRadius : JUDGE.court.radius;
}

export function inCourt(j: Ship, t: Ship): boolean {
  const p = j.judge?.court;
  return !!p && t.alive && t.team !== j.team && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) <= courtRadius(j);
}

function caseOf(j: Ship, t: Ship): Case {
  let c = j.judge!.cases.find((c) => c.target === t.id);
  if (!c) {
    c = { target: t.id, stacks: 0, last: LAWS.map(() => -1e9), outside: j.game.time, inside: inCourt(j, t), heading: t.heading, decay: 0, contemptUntil: 0 };
    j.judge!.cases.push(c);
  }
  return c;
}

export function violationCount(j: Ship, t: Ship): number {
  return j.judge?.cases.find((c) => c.target === t.id)?.stacks ?? 0;
}

/** Whether `t` broke `law` in `j`'s court within the last `window` seconds. */
export function brokeRecently(j: Ship, t: Ship, law: Law, window = 1.5): boolean {
  const c = j.judge?.cases.find((c) => c.target === t.id);
  return !!c && j.game.time - c.last[LAWS.indexOf(law)] < window;
}

/** Whether `t` is held in contempt of `j`'s court. */
export function inContempt(j: Ship, t: Ship): boolean {
  const c = j.judge?.cases.find((c) => c.target === t.id);
  return !!c && c.contemptUntil > j.game.time;
}

/**
 * Adds `n` violations to `t`'s case, tripled in contempt (which also zaps the offender) and doubled
 * again under Martial Law. `law` names the law broken, or -1 for a citation. Returns the violations added.
 */
export function cite(j: Ship, t: Ship, n: number, law = -1): number {
  const a = j.judge;
  if (!a || !t.alive || t.team === j.team || n <= 0) return 0;
  const c = caseOf(j, t);
  const now = j.game.time;
  const contempt = c.contemptUntil > now;
  const before = c.stacks;
  // Contempt and Martial Law compound: a breach in contempt under Martial Law counts six times.
  c.stacks = Math.min(JUDGE.cap, c.stacks + n * (contempt ? JUDGE.contempt.mul : 1) * (a.martialUntil > now ? 2 : 1));
  const added = c.stacks - before;
  if (added > 0 || contempt) emitMisc(j, 'cite', t.pos.x, t.pos.z, { target: t, n: added, law });
  if (contempt) hurt(j, t, JUDGE.contempt.zap, j.skills[JUDGE_SLOT.contempt].spec);
  return added;
}

/** A law broken inside the court counts once a second per law. */
function broke(j: Ship, t: Ship, law: Law): void {
  if (!j.judge?.court) return;
  const c = caseOf(j, t);
  const i = LAWS.indexOf(law);
  if (j.game.time - c.last[i] < 1 - 1e-8) return;
  c.last[i] = j.game.time;
  cite(j, t, 1, i);
}

export function recordJudgeAction(t: Ship, kind: 'fire' | 'skill'): void {
  for (const j of t.game.ships) if (j.alive && j.judge && inCourt(j, t)) broke(j, t, kind === 'fire' ? 'ceasefire' : 'silence');
}

export function clearJudge(s: Ship): void {
  if (s.judge) s.judge = newJudgeState();
  for (const j of s.game.ships)
    if (j.judge) {
      j.judge.cases = j.judge.cases.filter((c) => c.target !== s.id);
      j.judge.arrests = j.judge.arrests.filter((c) => c.target !== s.id);
      j.judge.gavels = j.judge.gavels.filter((c) => c.target !== s.id);
    }
}

/** The Judge's battery: each salvo cites what it strikes once, and hits harder the bigger the case. */
export function judgeRider(s: Ship): TitanRider {
  return {
    onFirstHit: (t) => cite(s, t, 1),
    hitMul: (t) => 1 + JUDGE.battery.perViolation * violationCount(s, t),
  };
}

/** Q: the court slams down at `x, z`, striking and citing every enemy inside. */
export function placeCourt(s: Ship, x: number, z: number): void {
  const a = s.judge!;
  a.court = { x, z };
  const r = courtRadius(s);
  emitMisc(s, 'court', x, z, { radius: r });
  const spec = s.skills[JUDGE_SLOT.court].spec;
  for (const t of s.game.ships) {
    if (!inCourt(s, t)) continue;
    hurt(s, t, JUDGE.court.damage, spec);
    cite(s, t, JUDGE.court.cite);
  }
}

/** E: throws the gavel at `t`. */
export function throwGavel(s: Ship, t: Ship): void {
  const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
  s.judge!.gavels.push({ target: t.id, hop: 0, x: s.pos.x, z: s.pos.z, at: s.game.time + Math.max(0.2, d / JUDGE.gavel.speed), hit: [] });
  emitMisc(s, 'gavelThrow', s.pos.x, s.pos.z, { tx: t.pos.x, tz: t.pos.z, target: t, n: 0 });
}

function landGavel(s: Ship, gv: Gavel): void {
  const g = s.game;
  const t = g.ships.find((v) => v.id === gv.target && v.alive);
  if (!t) return;
  const spec = s.skills[JUDGE_SLOT.gavel].spec;
  hurt(s, t, (JUDGE.gavel.damage + JUDGE.gavel.perViolation * violationCount(s, t)) * JUDGE.gavel.falloff ** gv.hop, spec);
  cite(s, t, JUDGE.gavel.cite);
  emitMisc(s, 'gavelHit', t.pos.x, t.pos.z, { target: t, n: gv.hop });
  const hit = [...gv.hit, t.id];
  if (gv.hop >= JUDGE.gavel.bounces) return;
  let next: Ship | null = null;
  let best: number = JUDGE.gavel.reach;
  for (const v of g.ships) {
    if (!v.alive || v.team === s.team || hit.includes(v.id) || violationCount(s, v) <= 0) continue;
    const d = Math.hypot(v.pos.x - t.pos.x, v.pos.z - t.pos.z);
    if (d <= best) {
      best = d;
      next = v;
    }
  }
  if (!next) return;
  s.judge!.gavels.push({ target: next.id, hop: gv.hop + 1, x: t.pos.x, z: t.pos.z, at: g.time + Math.max(0.2, best / JUDGE.gavel.speed), hit });
  emitMisc(s, 'gavelThrow', t.pos.x, t.pos.z, { tx: next.pos.x, tz: next.pos.z, target: next, n: gv.hop + 1 });
}

/** X: chains `t` and drags it to court. */
export function arrest(s: Ship, t: Ship): void {
  const a = s.judge!;
  const effect = 'debuff:arrest:' + s.id;
  t.addEffect({
    id: effect,
    time: JUDGE.arrest.time,
    apply: (m) => {
      m.speedMul *= JUDGE.arrest.slow;
    },
  });
  a.arrests = a.arrests.filter((r) => r.target !== t.id);
  a.arrests.push({ target: t.id, until: s.game.time + JUDGE.arrest.time, effect, x: t.pos.x, z: t.pos.z, tick: 0 });
  emitMisc(s, 'arrest', t.pos.x, t.pos.z, { target: t });
}

/** C: collects Taxes from `t`, healing the Judge part of what it takes. */
export function collectTaxes(s: Ship, t: Ship): void {
  const dealt = hurt(s, t, JUDGE.taxes.damage + JUDGE.taxes.perViolation * violationCount(s, t), s.skills[JUDGE_SLOT.taxes].spec);
  s.heal(dealt * JUDGE.taxes.heal);
  emitMisc(s, 'taxes', t.pos.x, t.pos.z, { tx: s.pos.x, tz: s.pos.z, target: t, n: dealt });
}

/** R: Martial Law widens the court, doubles violations, doubles the guns' rate and strikes the court. */
export function declareMartialLaw(s: Ship): void {
  const a = s.judge!;
  a.martialUntil = s.game.time + JUDGE.martial.time;
  buff(s, 'judgeMartial', JUDGE.martial.time, (m) => {
    m.reloadMul *= JUDGE.martial.reload;
  });
  const p = a.court!;
  emitMisc(s, 'martial', p.x, p.z, { radius: courtRadius(s) });
  const spec = s.skills[JUDGE_SLOT.martial].spec;
  for (const t of s.game.ships) if (inCourt(s, t)) hurt(s, t, JUDGE.martial.damage + JUDGE.martial.perViolation * violationCount(s, t), spec);
}

/**
 * V: whether Objection dismisses a hit of `amount` from `attacker` on the Judge `s`. A dismissed hit
 * cites its attacker and turns part of its damage back on it. Fire and flooding (`periodic`) tick
 * every frame, so they burn through: dismissing each tick would cite their setter 30 times a second.
 */
export function objects(s: Ship, attacker: Ship | null, amount: number, pierce: boolean, reflected: boolean, periodic = false): boolean {
  const a = s.judge;
  if (!a || a.objectionUntil <= s.game.time || !attacker || attacker.team === s.team || pierce || reflected || periodic) return false;
  if (s.game.rng() >= JUDGE.objection.chance) return false;
  cite(s, attacker, 1);
  const back = amount * JUDGE.objection.reflect;
  attacker.takeDamage(back, s, s.skills[JUDGE_SLOT.objection].spec, true);
  emitMisc(s, 'objection', s.pos.x, s.pos.z, { tx: attacker.pos.x, tz: attacker.pos.z, target: attacker, n: back });
  return true;
}

export function updateJudge(s: Ship, dt: number): void {
  const a = s.judge;
  if (!a) return;
  const g = s.game;
  const boundary = a.court ? `${a.court.x}:${a.court.z}:${courtRadius(s)}` : '';
  const changed = boundary !== a.boundary;
  a.boundary = boundary;
  for (const t of g.ships) {
    if (!t.alive || t.team === s.team) continue;
    const inside = inCourt(s, t);
    const c = caseOf(s, t);
    if (changed) {
      c.inside = inside;
      c.outside = g.time;
    }
    const forced = t.mods.rooted || t.mods.stunned || t.mods.feared || Math.abs(t.pushX) + Math.abs(t.pushZ) > 1 || a.arrests.some((r) => r.target === t.id);
    if (inside) {
      c.outside = g.time;
      c.decay = 0;
      if (!forced) {
        const knots = Math.abs(t.speed) / (KNOT * SPEED_SCALE);
        if (knots > 20) broke(s, t, 'speedLimit');
        if (knots < 10) broke(s, t, 'noLoitering');
        if (Math.abs(wrapAngle(t.heading - c.heading)) / Math.max(dt, 1e-6) > Math.PI / 60) broke(s, t, 'straightAhead');
      }
    } else {
      if (c.inside) {
        c.outside = g.time;
        if (!forced) broke(s, t, 'closedBorders');
      }
      if (g.time - c.outside >= 5) {
        c.decay += dt;
        if (c.decay >= 1 - 1e-8) {
          const n = Math.floor(c.decay + 1e-8);
          c.stacks = Math.max(0, c.stacks - n);
          c.decay -= n;
        }
      }
    }
    c.inside = inside;
    c.heading = t.heading;
  }
  a.cases = a.cases.filter((c) => g.ships.some((t) => t.id === c.target && t.alive));
  const arrestSpec = s.skills[JUDGE_SLOT.arrest].spec;
  for (const r of a.arrests) {
    const t = g.ships.find((t) => t.id === r.target);
    if (!t?.alive || !a.court || r.until <= g.time || !t.effects.some((e) => e.id === r.effect) || t.mods.unstoppable || t.mods.ccImmune) continue;
    if (Math.hypot(t.pos.x - r.x, t.pos.z - r.z) > 250) {
      r.until = 0;
      continue;
    }
    t.takeDamage(JUDGE.arrest.dps * dt * s.mods.damageMul, s, arrestSpec, false, false, true);
    r.tick += dt;
    if (r.tick >= 1 - 1e-8) {
      r.tick -= 1;
      cite(s, t, 1);
    }
    const dx = a.court.x - t.pos.x;
    const dz = a.court.z - t.pos.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, JUDGE.arrest.drag * dt);
    if (d > 100 && !moveSafe(t, t.pos.x + (dx / d) * step, t.pos.z + (dz / d) * step)) r.until = 0;
    r.x = t.pos.x;
    r.z = t.pos.z;
  }
  a.arrests = a.arrests.filter((r) => r.until > g.time && g.ships.some((t) => t.id === r.target && t.alive && t.effects.some((e) => e.id === r.effect)));
  const landing = a.gavels.filter((gv) => gv.at <= g.time);
  a.gavels = a.gavels.filter((gv) => gv.at > g.time);
  for (const gv of landing) landGavel(s, gv);
  const due = a.pending.filter((p) => p.at <= g.time);
  a.pending = a.pending.filter((p) => p.at > g.time);
  for (const p of due) resolve(s, p);
}

function resolve(s: Ship, p: JudgeState['pending'][number]): void {
  const g = s.game;
  const target = g.ships.find((t) => t.id === p.target && t.alive);
  if (p.kind === 'freeze') {
    if (!target) return;
    buff(target, 'debuff:judgeFreeze:' + s.id, JUDGE.contempt.freeze, (m) => {
      m.rooted = true;
    });
    target.speed = 0;
    caseOf(s, target).contemptUntil = g.time + JUDGE.contempt.freeze + JUDGE.contempt.time;
    emitMisc(s, 'contempt', target.pos.x, target.pos.z, { target });
    return;
  }
  if (p.kind === 'verdict') {
    const spec = s.skills[JUDGE_SLOT.verdict].spec;
    emitMisc(s, 'verdict', p.x, p.z, { radius: JUDGE.verdict.radius });
    for (const t of g.ships)
      if (t.alive && t.team !== s.team && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < JUDGE.verdict.radius) hurt(s, t, JUDGE.verdict.damage + JUDGE.verdict.perViolation * violationCount(s, t), spec);
    return;
  }
  if (!target || violationCount(s, target) < JUDGE.death) return;
  emitMisc(s, 'death', target.pos.x, target.pos.z, { target });
  caseOf(s, target).stacks = 0;
  target.takeDamage(target.maxHp, s, s.skills[JUDGE_SLOT.death].spec);
}

/**
 * Warns of a punishment about to land at `x, z`. The warning is a strike the AI steers clear of; the
 * Judge's own effects draw it.
 */
export function judgeWarning(s: Ship, kind: JudgeState['pending'][number]['kind'], t: Ship | null, x: number, z: number, skill: SkillSpec): void {
  const delay = kind === 'freeze' ? JUDGE.contempt.warn : kind === 'verdict' ? JUDGE.verdict.warn : JUDGE.deathWarn;
  const radius = kind === 'verdict' ? JUDGE.verdict.radius : 250;
  s.judge!.pending.push({ kind, target: t?.id ?? -1, x, z, at: s.game.time + delay });
  s.game.strikes.spawn(s, { kind: 'rod', skill, x, z, radius, delay, damage: 0, look: 'bespoke' });
  emitMisc(s, 'warn', x, z, { radius, target: t ?? undefined, n: kind === 'freeze' ? 0 : kind === 'verdict' ? 1 : 2 });
}
