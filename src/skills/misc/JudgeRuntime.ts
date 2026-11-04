import type { Ship } from "../../ships/Ship";
import type { SkillSpec } from "../../core/types";
import { KNOT, SPEED_SCALE } from "../../config";
import { wrapAngle } from "../../core/math";
import { buff, hurt } from "../kit";
import { moveSafe } from "./MiscSupport";
export const LAWS = [
  "ceasefire",
  "silence",
  "speedLimit",
  "noLoitering",
  "straightAhead",
  "closedBorders",
] as const;
export type Law = (typeof LAWS)[number];
export const LAW_LABELS: Record<Law, string> = {
  ceasefire: "Ceasefire",
  silence: "Silence",
  speedLimit: "Speed Limit",
  noLoitering: "No Loitering",
  straightAhead: "Straight Ahead",
  closedBorders: "Closed Borders",
};
interface Case {
  target: number;
  stacks: number;
  last: number[];
  outside: number;
  inside: boolean;
  heading: number;
  decay: number;
}
export interface JudgeState {
  court: { x: number; z: number } | null;
  boundary: string;
  laws: { id: Law; until: number }[];
  cases: Case[];
  martialUntil: number;
  objectionUntil: number;
  pending: {
    kind: "freeze" | "verdict" | "death";
    target: number;
    x: number;
    z: number;
    at: number;
  }[];
  arrests: {
    target: number;
    until: number;
    effect: string;
    x: number;
    z: number;
  }[];
}
export function newJudgeState(): JudgeState {
  return {
    court: null,
    boundary: "",
    laws: [],
    cases: [],
    martialUntil: 0,
    objectionUntil: 0,
    pending: [],
    arrests: [],
  };
}
export function courtRadius(s: Ship): number {
  return s.judge && s.judge.martialUntil > s.game.time ? 3000 : 2000;
}
export function inCourt(j: Ship, t: Ship): boolean {
  const p = j.judge?.court;
  return (
    !!p &&
    t.alive &&
    t.team !== j.team &&
    Math.hypot(t.pos.x - p.x, t.pos.z - p.z) <= courtRadius(j)
  );
}
function caseOf(j: Ship, t: Ship): Case {
  let c = j.judge!.cases.find((c) => c.target === t.id);
  if (!c) {
    c = {
      target: t.id,
      stacks: 0,
      last: LAWS.map(() => -1e9),
      outside: j.game.time,
      inside: inCourt(j, t),
      heading: t.heading,
      decay: 0,
    };
    j.judge!.cases.push(c);
  }
  return c;
}
export function violationCount(j: Ship, t: Ship): number {
  return j.judge?.cases.find((c) => c.target === t.id)?.stacks ?? 0;
}
export function enactLaw(s: Ship, id: Law): boolean {
  const a = s.judge;
  if (!a?.court || !LAWS.includes(id))
    return s.failSkill("Establish Jurisdiction first");
  a.laws = a.laws.filter((l) => l.id !== id && l.until > s.game.time);
  if (a.laws.length >= 3) a.laws.shift();
  a.laws.push({ id, until: s.game.time + 30 });
  return true;
}
function active(j: Ship, id: Law): boolean {
  return (
    !!j.judge &&
    (j.judge.martialUntil > j.game.time ||
      j.judge.laws.some((l) => l.id === id && l.until > j.game.time))
  );
}
function add(j: Ship, t: Ship, id: Law) {
  if (!active(j, id)) return;
  const c = caseOf(j, t),
    i = LAWS.indexOf(id);
  if (j.game.time - c.last[i] < 1 - 1e-8) return;
  c.last[i] = j.game.time;
  c.stacks = Math.min(
    30,
    c.stacks + (j.judge!.martialUntil > j.game.time ? 2 : 1),
  );
}
export function recordJudgeAction(t: Ship, kind: "fire" | "skill") {
  for (const j of t.game.ships)
    if (j.alive && j.judge && inCourt(j, t))
      add(j, t, kind === "fire" ? "ceasefire" : "silence");
}
export function clearJudge(s: Ship) {
  if (s.judge) s.judge = newJudgeState();
  for (const j of s.game.ships)
    if (j.judge) {
      j.judge.cases = j.judge.cases.filter((c) => c.target !== s.id);
      j.judge.arrests = j.judge.arrests.filter((c) => c.target !== s.id);
    }
}
export function updateJudge(s: Ship, dt: number) {
  const a = s.judge;
  if (!a) return;
  const g = s.game;
  a.laws = a.laws.filter((l) => l.until > g.time);
  const boundary = a.court ? `${a.court.x}:${a.court.z}:${courtRadius(s)}` : "";
  const changed = boundary !== a.boundary;
  a.boundary = boundary;
  for (const t of g.ships) {
    if (!t.alive || t.team === s.team) continue;
    const inside = inCourt(s, t),
      c = caseOf(s, t);
    if (changed) {
      c.inside = inside;
      c.outside = g.time;
    }
    if (inside) {
      c.outside = g.time;
      c.decay = 0;
      const forced =
        t.mods.rooted ||
        t.mods.stunned ||
        t.mods.feared ||
        Math.abs(t.pushX) + Math.abs(t.pushZ) > 1 ||
        a.arrests.some((r) => r.target === t.id);
      if (!forced) {
        const knots = Math.abs(t.speed) / (KNOT * SPEED_SCALE);
        if (knots > 20) add(s, t, "speedLimit");
        if (knots < 10) add(s, t, "noLoitering");
        if (
          Math.abs(wrapAngle(t.heading - c.heading)) / Math.max(dt, 1e-6) >
          Math.PI / 60
        )
          add(s, t, "straightAhead");
      }
    } else {
      if (c.inside) {
        c.outside = g.time;
        if (
          !t.mods.rooted &&
          !t.mods.stunned &&
          !t.mods.feared &&
          !a.arrests.some((r) => r.target === t.id) &&
          Math.abs(t.pushX) + Math.abs(t.pushZ) < 1
        )
          add(s, t, "closedBorders");
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
  a.cases = a.cases.filter((c) =>
    g.ships.some((t) => t.id === c.target && t.alive),
  );
  for (const r of a.arrests) {
    const t = g.ships.find((t) => t.id === r.target);
    if (
      !t?.alive ||
      !a.court ||
      r.until <= g.time ||
      !t.effects.some((e) => e.id === r.effect) ||
      t.mods.unstoppable ||
      t.mods.ccImmune
    )
      continue;
    if (Math.hypot(t.pos.x - r.x, t.pos.z - r.z) > 250) {
      r.until = 0;
      continue;
    }
    const dx = a.court.x - t.pos.x,
      dz = a.court.z - t.pos.z,
      d = Math.hypot(dx, dz);
    if (
      d > 100 &&
      !moveSafe(
        t,
        t.pos.x + (dx / d) * Math.min(d, 650 * dt),
        t.pos.z + (dz / d) * Math.min(d, 650 * dt),
      )
    )
      r.until = 0;
    r.x = t.pos.x;
    r.z = t.pos.z;
  }
  a.arrests = a.arrests.filter(
    (r) =>
      r.until > g.time &&
      g.ships.some(
        (t) =>
          t.id === r.target &&
          t.alive &&
          t.effects.some((e) => e.id === r.effect),
      ),
  );
  for (const p of a.pending.filter((p) => p.at <= g.time)) {
    const target = g.ships.find((t) => t.id === p.target && t.alive);
    const st =
      s.skills[p.kind === "freeze" ? 2 : p.kind === "verdict" ? 7 : 8].spec;
    if (p.kind === "freeze" && target) {
      buff(target, "debuff:judgeFreeze:" + s.id, 1.5, (m) => {
        m.rooted = true;
      });
      target.speed = 0;
    }
    if (p.kind === "verdict") {
      for (const t of g.ships)
        if (
          t.alive &&
          t.team !== s.team &&
          Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < 850
        )
          hurt(s, t, 180000 + violationCount(s, t) * 9000, st);
    }
    if (p.kind === "death" && target && violationCount(s, target) >= 20) {
      caseOf(s, target).stacks = 0;
      target.takeDamage(target.maxHp, s, st);
    }
    g.events.emit("explosion", {
      x: p.x,
      y: 8,
      z: p.z,
      size: p.kind === "freeze" ? 1 : 5,
    });
  }
  a.pending = a.pending.filter((p) => p.at > g.time);
}
export function judgeWarning(
  s: Ship,
  kind: JudgeState["pending"][number]["kind"],
  t: Ship | null,
  x: number,
  z: number,
  skill: SkillSpec,
) {
  s.judge!.pending.push({
    kind,
    target: t?.id ?? -1,
    x,
    z,
    at: s.game.time + (kind === "freeze" ? 0.65 : 1.1),
  });
  s.game.strikes.spawn(s, {
    kind: "rod",
    skill,
    x,
    z,
    radius: kind === "verdict" ? 850 : 250,
    delay: kind === "freeze" ? 0.65 : 1.1,
    damage: 0,
    look: "anvil",
  });
}
