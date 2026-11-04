import { MAP_HALF } from "../../config";
import { distToHull } from "../../core/hull";
import { forwardX, forwardZ } from "../../core/math";
import type { SkillSpec } from "../../core/types";
import type { Ship } from "../../ships/Ship";
import {
  ridgeDistance,
  ridgeNearest,
  type DynamicRidge,
} from "../../world/GameMap";
import { aimPoint, hurt } from "../kit";

export const FAULTLINE = {
  accent: 0xff743c,
  range: 2600,
  maxPressure: 100,
  fractureLife: 14,
  maxFractures: 8,
  ridgeLife: 12,
  ridgeWidth: 150,
  ridgeHeight: 75,
  ridgeLength: 900,
  maxRidges: 6,
  warning: 0.9,
  pulseRadius: 280,
  faultDamage: 48000,
  bedrockTime: 6,
  bedrockReduction: 0.55,
} as const;
export interface Fracture {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  expiresAt: number;
}
export interface FaultPending {
  id: number;
  sequence: number;
  kind: "pulse" | "ridge" | "collapse";
  at: number;
  x: number;
  z: number;
  radius: number;
  damage: number;
  knock: number;
  skillId: string;
  ridge: DynamicRidge | null;
}
export interface FaultlineState {
  pressure: number;
  fractures: Fracture[];
  pending: FaultPending[];
  hits: { sequence: number; target: number; count: number }[];
  serial: number;
  bedrockUntil: number;
  lastReceived: number;
  slip: {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    startedAt: number;
    until: number;
    hit: number[];
  } | null;
}
export function newFaultlineState(): FaultlineState {
  return {
    pressure: 0,
    fractures: [],
    pending: [],
    hits: [],
    serial: 0,
    bedrockUntil: 0,
    lastReceived: 0,
    slip: null,
  };
}
function state(s: Ship): FaultlineState {
  return s.faultline!;
}
export function addPressure(s: Ship, n: number): void {
  const a = state(s);
  a.pressure = Math.min(FAULTLINE.maxPressure, Math.max(0, a.pressure + n));
}
export function applyFaultlinePassives(s: Ship, mods: Ship["mods"]): void {
  if (s.faultline && s.faultline.bedrockUntil > s.game.time)
    mods.damageTakenMul *= 1 - FAULTLINE.bedrockReduction;
  if (s.faultline?.slip) mods.rooted = true;
}
export function clearFaultline(s: Ship): void {
  if (!s.faultline) return;
  s.game.map.dynamicRidges = s.game.map.dynamicRidges.filter(
    (r) => r.owner !== s.id,
  );
  Object.assign(s.faultline, newFaultlineState());
  // Pull fields must not keep trapping ships after their owner leaves the battle.
  for (const f of s.game.fields.fields)
    if (f.owner === s && f.skill?.id.startsWith("faultline")) f.life = f.age;
}
function pulse(
  s: Ship,
  spec: SkillSpec,
  sequence: number,
  x: number,
  z: number,
  radius: number,
  damage: number,
  delay: number,
  knock = 0,
): void {
  const a = state(s);
  a.pending.push({
    id: ++a.serial,
    sequence,
    kind: "pulse",
    at: s.game.time + delay,
    x,
    z,
    radius,
    damage,
    knock,
    skillId: spec.id,
    ridge: null,
  });
  s.game.strikes.spawn(s, {
    kind: "rod",
    look: "quake",
    skill: spec,
    x,
    z,
    radius,
    delay,
    damage: 0,
    hitsSubs: true,
  });
}
function fracture(
  s: Ship,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): Fracture {
  const a = state(s),
    f = {
      id: ++a.serial,
      x0,
      z0,
      x1,
      z1,
      expiresAt: s.game.time + FAULTLINE.fractureLife,
    };
  a.fractures.push(f);
  if (a.fractures.length > FAULTLINE.maxFractures) a.fractures.shift();
  s.game.events.emit("lightning", {
    points: [
      { x: x0, y: 2, z: z0 },
      { x: x1, y: 2, z: z1 },
    ],
    color: FAULTLINE.accent,
    straight: true,
  });
  return f;
}
function linePulse(
  s: Ship,
  spec: SkillSpec,
  f: Fracture,
  seq: number,
  damage: number,
  start: number = FAULTLINE.warning,
  knock = 100,
): number {
  const n = Math.max(1, Math.ceil(Math.hypot(f.x1 - f.x0, f.z1 - f.z0) / 350));
  for (let i = 0; i <= n; i++)
    pulse(
      s,
      spec,
      seq,
      f.x0 + ((f.x1 - f.x0) * i) / n,
      f.z0 + ((f.z1 - f.z0) * i) / n,
      FAULTLINE.pulseRadius,
      damage,
      start + i * 0.08,
      knock,
    );
  return start + n * 0.08;
}
function nearestFracture(s: Ship): Fracture | undefined {
  const p = aimPoint(s, FAULTLINE.range);
  return state(s)
    .fractures.filter((f) => f.expiresAt > s.game.time)
    .sort(
      (a, b) =>
        ridgeDistance({ ...a, width: 0, height: 0, owner: s.id }, p.x, p.z) -
        ridgeDistance({ ...b, width: 0, height: 0, owner: s.id }, p.x, p.z),
    )[0];
}
export function castFault(s: Ship, spec: SkillSpec): void {
  const p = aimPoint(s, FAULTLINE.range),
    fx = forwardX(s.heading),
    fz = forwardZ(s.heading);
  const x0 = s.pos.x + (fx * s.spec.length) / 2,
    z0 = s.pos.z + (fz * s.spec.length) / 2;
  const f = fracture(s, x0, z0, p.x, p.z);
  linePulse(s, spec, f, ++state(s).serial, FAULTLINE.faultDamage);
}
function makeRidge(
  s: Ship,
  x: number,
  z: number,
  dx: number,
  dz: number,
  length: number,
): DynamicRidge {
  const n = Math.hypot(dx, dz) || 1,
    half = length / 2;
  return {
    id: ++state(s).serial,
    owner: s.id,
    x0: x - (dx / n) * half,
    z0: z - (dz / n) * half,
    x1: x + (dx / n) * half,
    z1: z + (dz / n) * half,
    width: FAULTLINE.ridgeWidth,
    height: FAULTLINE.ridgeHeight,
    expiresAt: s.game.time + FAULTLINE.warning + FAULTLINE.ridgeLife,
  };
}
function hullClear(
  s: Ship,
  x: number,
  z: number,
  ridge?: DynamicRidge,
): boolean {
  const map = s.game.map,
    fx = forwardX(s.heading),
    fz = forwardZ(s.heading),
    half = s.spec.length / 2 + 30,
    beam = s.spec.beam / 2 + 30;
  if (
    Math.abs(x) + half > MAP_HALF - 200 ||
    Math.abs(z) + half > MAP_HALF - 200
  )
    return false;
  for (const along of [-half, 0, half])
    for (const across of [-beam, 0, beam]) {
      const px = x + fx * along - fz * across,
        pz = z + fz * along + fx * across;
      if (map.heightAt(px, pz) > -Math.max(8, s.spec.draft)) return false;
      if (ridge && ridgeDistance(ridge, px, pz) < ridge.width / 2 + 25)
        return false;
    }
  return true;
}
/** The whole relocation is prepared before mutating any hull or map geometry. */
function displacements(
  s: Ship,
  r: DynamicRidge,
): { ship: Ship; x: number; z: number }[] | null {
  const moves: { ship: Ship; x: number; z: number }[] = [],
    dx = r.x1 - r.x0,
    dz = r.z1 - r.z0,
    len = Math.hypot(dx, dz) || 1;
  for (const ship of s.game.ships) {
    if (
      !ship.alive ||
      ship.mods.banished ||
      ridgeDistance(r, ship.pos.x, ship.pos.z) >
        r.width / 2 + ship.spec.length / 2 + 40
    )
      continue;
    const p = ridgeNearest(r, ship.pos.x, ship.pos.z),
      side = (ship.pos.x - p.x) * -dz + (ship.pos.z - p.z) * dx < 0 ? -1 : 1;
    let found: { ship: Ship; x: number; z: number } | null = null;
    for (const sign of [side, -side]) {
      for (
        let d = r.width / 2 + ship.spec.length / 2 + 80;
        d <= 1100;
        d += 100
      ) {
        const x = p.x - (dz / len) * d * sign,
          z = p.z + (dx / len) * d * sign;
        if (!hullClear(ship, x, z, r)) continue;
        const occupied = s.game.ships.some((o) => {
          if (o === ship || !o.alive) return false;
          const moved = moves.find((m) => m.ship === o),
            ox = moved?.x ?? o.pos.x,
            oz = moved?.z ?? o.pos.z;
          return (
            Math.hypot(x - ox, z - oz) <
            (ship.spec.length + o.spec.length) / 2 + 30
          );
        });
        if (occupied) continue;
        found = { ship, x, z };
        break;
      }
      if (found) break;
    }
    if (!found) return null;
    moves.push(found);
  }
  return moves;
}
function queueRidges(
  s: Ship,
  spec: SkillSpec,
  ridges: DynamicRidge[],
): boolean {
  const map = s.game.map;
  // Include queued ridges during validation so two fast casts cannot reserve the same space.
  const original = map.dynamicRidges;
  map.dynamicRidges = [
    ...original,
    ...state(s).pending.flatMap((p) => (p.ridge ? [p.ridge] : [])),
  ];
  let valid = true;
  for (const r of ridges) {
    if (!map.canPlaceDynamicRidge(r) || !displacements(s, r)) {
      valid = false;
      break;
    }
    map.dynamicRidges.push(r);
  }
  map.dynamicRidges = original;
  if (!valid)
    return s.failSkill(
      "Uplift: ridge needs clear water, safe exits and space away from spawns",
    );
  for (const r of ridges) {
    state(s).pending.push({
      id: ++state(s).serial,
      sequence: r.id,
      kind: "ridge",
      at: s.game.time + FAULTLINE.warning,
      x: (r.x0 + r.x1) / 2,
      z: (r.z0 + r.z1) / 2,
      radius: r.width,
      damage: 0,
      knock: 0,
      skillId: spec.id,
      ridge: r,
    });
    s.game.strikes.spawn(s, {
      kind: "rod",
      look: "quake",
      skill: spec,
      x: (r.x0 + r.x1) / 2,
      z: (r.z0 + r.z1) / 2,
      radius: Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2,
      delay: FAULTLINE.warning,
      damage: 0,
    });
  }
  return true;
}
export function castUplift(s: Ship, spec: SkillSpec): boolean {
  const p = aimPoint(s, FAULTLINE.range),
    dx = p.x - s.pos.x,
    dz = p.z - s.pos.z;
  return queueRidges(s, spec, [
    makeRidge(
      s,
      p.x,
      p.z,
      -dz || (dx === 0 ? 1 : 0),
      dx,
      FAULTLINE.ridgeLength,
    ),
  ]);
}
export function castSubduction(s: Ship, spec: SkillSpec): boolean {
  const f = nearestFracture(s);
  if (!f) return s.failSkill("Subduction: create a fracture first");
  const p = aimPoint(s, FAULTLINE.range),
    q = ridgeNearest({ ...f, owner: s.id, width: 0, height: 0 }, p.x, p.z);
  s.game.fields.add(s, {
    x: q.x,
    z: q.z,
    r: 700,
    life: 2,
    pull: 220,
    slow: 0.55,
    skill: spec,
    color: FAULTLINE.accent,
    look: "void",
  });
  pulse(s, spec, ++state(s).serial, q.x, q.z, 750, 100000, 2, 80);
  return true;
}
export function castSlip(s: Ship): boolean {
  const f = nearestFracture(s);
  if (!f) return s.failSkill("Slip: create a fracture first");
  const p = aimPoint(s, FAULTLINE.range),
    q = ridgeNearest({ ...f, owner: s.id, width: 0, height: 0 }, p.x, p.z);
  if (Math.hypot(q.x - s.pos.x, q.z - s.pos.z) < 100)
    return s.failSkill("Slip: aim farther along a fracture");
  // Sweep the complete hull corridor. A dash never skips a ridge or island between its ends.
  const steps = Math.ceil(Math.hypot(q.x - s.pos.x, q.z - s.pos.z) / 60);
  for (let i = 1; i <= steps; i++)
    if (
      !hullClear(
        s,
        s.pos.x + ((q.x - s.pos.x) * i) / steps,
        s.pos.z + ((q.z - s.pos.z) * i) / steps,
      )
    )
      return s.failSkill("Slip: fracture path blocked");
  state(s).slip = {
    x0: s.pos.x,
    z0: s.pos.z,
    x1: q.x,
    z1: q.z,
    startedAt: s.game.time,
    until: s.game.time + 0.65,
    hit: [],
  };
  addPressure(s, 15);
  return true;
}
export function castAftershock(s: Ship, spec: SkillSpec): boolean {
  const a = state(s);
  if (!a.fractures.length)
    return s.failSkill("Aftershock: create a fracture first");
  const seq = ++a.serial;
  a.fractures.forEach((f, i) =>
    linePulse(s, spec, f, seq, 44000, 0.5 + i * 0.3, 30),
  );
  return true;
}
export function castBedrock(s: Ship): void {
  const a = state(s);
  a.bedrockUntil = s.game.time + FAULTLINE.bedrockTime;
  a.lastReceived = s.stats.received;
}
export function castDivide(s: Ship, spec: SkillSpec): boolean {
  const p = aimPoint(s, FAULTLINE.range),
    dx = p.x - s.pos.x,
    dz = p.z - s.pos.z,
    n = Math.hypot(dx, dz) || 1;
  const nx = -dz / n,
    nz = dx / n;
  const ridges = [-1, 1].map((side) =>
    makeRidge(s, p.x + nx * 430 * side, p.z + nz * 430 * side, dx, dz, 1400),
  );
  if (!queueRidges(s, spec, ridges)) return false;
  const f = fracture(
    s,
    p.x - (dx / n) * 700,
    p.z - (dz / n) * 700,
    p.x + (dx / n) * 700,
    p.z + (dz / n) * 700,
  );
  linePulse(s, spec, f, ++state(s).serial, 110000, 1.1, 160);
  return true;
}
export function castCaldera(s: Ship, spec: SkillSpec): void {
  const p = aimPoint(s, FAULTLINE.range),
    a = state(s),
    pressure = a.pressure;
  a.pressure = 0;
  s.game.fields.add(s, {
    ...p,
    r: 1000,
    life: 2,
    pull: 150,
    slow: 0.7,
    look: "void",
    color: FAULTLINE.accent,
    skill: spec,
  });
  pulse(s, spec, ++a.serial, p.x, p.z, 1100, 180000 + pressure * 3500, 2, 320);
}
export function castWorldbreaker(s: Ship, spec: SkillSpec): void {
  const a = state(s),
    seq = ++a.serial;
  if (!a.fractures.length) castFault(s, spec);
  let end = 0.9;
  a.fractures.forEach((f, i) => {
    end = Math.max(
      end,
      linePulse(s, spec, f, seq, 135000, 0.9 + i * 0.25, 180),
    );
  });
  a.pending.push({
    id: ++a.serial,
    sequence: seq,
    kind: "collapse",
    at: s.game.time + end + 0.5,
    x: s.pos.x,
    z: s.pos.z,
    radius: 0,
    damage: 140000,
    knock: 180,
    skillId: spec.id,
    ridge: null,
  });
}
function resolvePulse(s: Ship, p: FaultPending): void {
  const a = state(s),
    spec = s.spec.skills.find((k) => k.id === p.skillId) ?? null;
  s.game.events.emit("explosion", {
    x: p.x,
    y: 3,
    z: p.z,
    size: Math.max(4, p.radius / 60),
  });
  for (const t of s.game.ships) {
    if (
      !t.alive ||
      t.team === s.team ||
      t.mods.banished ||
      t.deep ||
      distToHull(t, p.x, p.z) > p.radius
    )
      continue;
    let hit = a.hits.find(
      (h) => h.sequence === p.sequence && h.target === t.id,
    );
    if (!hit) {
      hit = { sequence: p.sequence, target: t.id, count: 0 };
      a.hits.push(hit);
    }
    // Finite per-sequence budget prevents networks of overlapping fractures scaling without bound.
    if (hit.count >= 6) continue;
    const fall = 0.55 ** hit.count++;
    const damage = p.damage * fall;
    const dealt = spec
      ? hurt(s, t, damage, spec)
      : t.takeDamage(damage * s.mods.damageMul, s);
    if (dealt > 0) addPressure(s, Math.min(5, dealt / 15000));
    if (p.knock > 0) {
      const dx = t.pos.x - p.x,
        dz = t.pos.z - p.z,
        n = Math.hypot(dx, dz) || 1;
      t.shove((dx / n) * p.knock * fall, (dz / n) * p.knock * fall);
    }
  }
}
export function updateFaultline(s: Ship, _dt: number): void {
  if (!s.faultline) return;
  if (!s.alive) {
    clearFaultline(s);
    return;
  }
  const a = state(s),
    now = s.game.time;
  s.game.map.expireDynamicRidges(now);
  a.fractures = a.fractures.filter((f) => f.expiresAt > now);
  if (a.bedrockUntil > now) {
    const received = Math.max(0, s.stats.received - a.lastReceived);
    addPressure(
      s,
      (received *
        (FAULTLINE.bedrockReduction / (1 - FAULTLINE.bedrockReduction))) /
        10000,
    );
  }
  a.lastReceived = s.stats.received;
  const due = a.pending.filter((p) => p.at <= now + 1e-8);
  a.pending = a.pending.filter((p) => p.at > now + 1e-8);
  for (const p of due) {
    if (p.kind === "pulse") resolvePulse(s, p);
    else if (p.kind === "ridge" && p.ridge) {
      const r = p.ridge,
        moves = displacements(s, r);
      if (!moves || !s.game.map.addDynamicRidge(r)) {
        s.failSkill("Uplift: water became obstructed before the ridge rose");
        continue;
      }
      for (const m of moves) {
        m.ship.pos.x = m.x;
        m.ship.pos.z = m.z;
        m.ship.speed = 0;
        m.ship.pushX = m.ship.pushZ = 0;
      }
      const owned = s.game.map.dynamicRidges.filter((o) => o.owner === s.id);
      if (owned.length > FAULTLINE.maxRidges)
        s.game.map.dynamicRidges = s.game.map.dynamicRidges.filter(
          (o) => o !== owned[0],
        );
      fracture(s, r.x0, r.z0, r.x1, r.z1);
    } else if (p.kind === "collapse") {
      const owned = s.game.map.dynamicRidges.filter((r) => r.owner === s.id);
      for (const r of owned)
        resolvePulse(s, {
          ...p,
          kind: "pulse",
          x: (r.x0 + r.x1) / 2,
          z: (r.z0 + r.z1) / 2,
          radius: 700,
        });
      s.game.map.dynamicRidges = s.game.map.dynamicRidges.filter(
        (r) => r.owner !== s.id,
      );
      a.fractures = [];
    }
  }
  const activeSequences = new Set(a.pending.map((p) => p.sequence));
  a.hits = a.hits.filter((h) => activeSequences.has(h.sequence));
  const slip = a.slip;
  if (slip) {
    const f = Math.min(
      1,
      (now - slip.startedAt) / (slip.until - slip.startedAt),
    );
    const x = slip.x0 + (slip.x1 - slip.x0) * f,
      z = slip.z0 + (slip.z1 - slip.z0) * f;
    if (!hullClear(s, x, z)) a.slip = null;
    else {
      s.pos.x = x;
      s.pos.z = z;
      s.speed = 0;
      const spec = s.spec.skills.find((k) => k.id === "faultlineSlip");
      for (const t of s.game.ships)
        if (
          spec &&
          t.alive &&
          t.team !== s.team &&
          !t.deep &&
          !slip.hit.includes(t.id) &&
          distToHull(t, x, z) < s.spec.beam + 60
        ) {
          slip.hit.push(t.id);
          hurt(s, t, 65000, spec);
        }
      if (f >= 1) a.slip = null;
    }
  }
}
