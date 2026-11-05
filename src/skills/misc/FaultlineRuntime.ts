import { MAP_HALF } from '../../config';
import { distToHull } from '../../core/hull';
import { forwardX, forwardZ } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { ridgeDistance, ridgeNearest, type DynamicRidge } from '../../world/GameMap';
import { aimPoint, hurt } from '../kit';
import { emitMisc, type FaultFxKind, type TitanRider } from './MiscEvents';

// The Faultline breaks the sea: magma mortars build pressure and open fractures, pulses rupture
// along them, ridges rise as temporary terrain, and the ultimates spend it all.

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
  /** Each repeat hit one attack lands on a ship keeps this much of the last. */
  repeat: 0.6,
  /** The most damaging hits one attack lands on one ship. */
  maxHits: 6,
  battery: { damage: 38000, he: 24000, reload: 8, fire: 0.5, every: 4, fracture: 450 },
  fault: { damage: 140000, knock: 100 },
  uplift: { damage: 120000, reach: 200, knock: 120 },
  subduction: { radius: 700, pull: 220, time: 2, crush: 750, damage: 260000, knock: 80 },
  slip: { time: 0.65, damage: 160000, pressure: 15, wake: 25000, wakeTime: 4, tick: 0.5, reach: 120 },
  aftershock: { damage: 110000, knock: 30, boulder: 80000, reach: 450 },
  bedrock: { time: 6, reduction: 0.55, rebound: 60000, perPressure: 2000, radius: 600, knock: 140 },
  divide: { length: 1400, offset: 430, damage: 280000, knock: 160 },
  caldera: { radius: 1100, pull: 1000, time: 2, damage: 400000, perPressure: 5000, knock: 320 },
  worldbreaker: { damage: 320000, collapse: 300000, radius: 700, knock: 180 },
} as const;

export interface Fracture {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  expiresAt: number;
}

/** A warned attack waiting to land: a pulse, a ridge rising, boulders off a ridge, or the collapse. */
export interface FaultPending {
  id: number;
  sequence: number;
  kind: 'pulse' | 'ridge' | 'boulders' | 'collapse';
  at: number;
  x: number;
  z: number;
  radius: number;
  damage: number;
  knock: number;
  skillId: string;
  ridge: DynamicRidge | null;
  /** The effect a pulse plays when it lands, and its `n`. */
  look: FaultFxKind | null;
  n: number;
}

/** Slip's cooling lava: it burns ships near its line until `until`. */
export interface MagmaWake {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  until: number;
  next: number;
}

export interface FaultlineState {
  pressure: number;
  fractures: Fracture[];
  pending: FaultPending[];
  hits: { sequence: number; target: number; count: number }[];
  serial: number;
  bedrockUntil: number;
  lastReceived: number;
  /** When Bedrock's Rebound goes off; 0 when none is due. */
  reboundAt: number;
  /** Battery salvos fired, so every fourth can open a fracture. */
  salvos: number;
  wakes: MagmaWake[];
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
  return { pressure: 0, fractures: [], pending: [], hits: [], serial: 0, bedrockUntil: 0, lastReceived: 0, reboundAt: 0, salvos: 0, wakes: [], slip: null };
}

function state(s: Ship): FaultlineState {
  return s.faultline!;
}

function skillOf(s: Ship, id: string): SkillSpec | null {
  return s.spec.skills.find((k) => k.id === id) ?? null;
}

function enemies(s: Ship): Ship[] {
  return s.game.ships.filter((t) => t.alive && t.team !== s.team && !t.mods.banished && !t.deep);
}

/** Shoves `t` away from (x, z) at `speed`; straight along (nx, nz) when it sits on the point. */
function knock(t: Ship, x: number, z: number, speed: number, nx = 1, nz = 0): void {
  const dx = t.pos.x - x;
  const dz = t.pos.z - z;
  const d = Math.hypot(dx, dz);
  if (d < 1) t.shove(nx * speed, nz * speed);
  else t.shove((dx / d) * speed, (dz / d) * speed);
}

/** The point of segment (x0, z0)–(x1, z1) nearest (x, z). */
function nearestOn(x0: number, z0: number, x1: number, z1: number, x: number, z: number): { x: number; z: number } {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const f = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)));
  return { x: x0 + dx * f, z: z0 + dz * f };
}

function owned(s: Ship): DynamicRidge[] {
  return s.game.map.dynamicRidges.filter((r) => r.owner === s.id);
}

export function addPressure(s: Ship, n: number): void {
  const a = state(s);
  a.pressure = Math.min(FAULTLINE.maxPressure, Math.max(0, a.pressure + n));
}

export function applyFaultlinePassives(s: Ship, mods: Ship['mods']): void {
  if (s.faultline && s.faultline.bedrockUntil > s.game.time) mods.damageTakenMul *= 1 - FAULTLINE.bedrock.reduction;
  if (s.faultline?.slip) mods.rooted = true;
}

export function clearFaultline(s: Ship): void {
  if (!s.faultline) return;
  s.game.map.dynamicRidges = s.game.map.dynamicRidges.filter((r) => r.owner !== s.id);
  Object.assign(s.faultline, newFaultlineState());
  // Pull fields must not keep trapping ships after their owner leaves the battle.
  for (const f of s.game.fields.fields) if (f.owner === s && f.skill?.id.startsWith('faultline')) f.life = f.age;
}

// ------------------------------------------------------------------ the magma mortar

/**
 * One turret salvo of ember rocks: each hit adds a point of pressure and may set the hull alight,
 * and the first round of every fourth salvo opens a fracture where it falls.
 */
export function faultlineRider(s: Ship): TitanRider {
  const a = state(s);
  const B = FAULTLINE.battery;
  let opened = ++a.salvos % B.every !== 0;
  const open = (x: number, z: number) => {
    if (opened) return;
    opened = true;
    // Laid along the line of fire, so Slip can ride it toward the target.
    const dx = x - s.pos.x;
    const dz = z - s.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const h = B.fracture / 2;
    fracture(s, x - (dx / d) * h, z - (dz / d) * h, x + (dx / d) * h, z + (dz / d) * h, 1);
  };
  return {
    onHit: (t, x, z) => {
      addPressure(s, 1);
      if (s.game.rng() < B.fire) t.startFire(Math.floor(s.game.rng() * 4), s);
      open(x, z);
    },
    onLand: open,
  };
}

// ------------------------------------------------------------------ pulses and fractures

function pulse(s: Ship, spec: SkillSpec, sequence: number, x: number, z: number, radius: number, damage: number, delay: number, knock: number, look: FaultFxKind | null, n = 0): void {
  const a = state(s);
  a.pending.push({ id: ++a.serial, sequence, kind: 'pulse', at: s.game.time + delay, x, z, radius, damage, knock, skillId: spec.id, ridge: null, look, n });
  // A bespoke warning: the AI steers clear of it, and the Faultline's own effects draw it.
  s.game.strikes.spawn(s, { kind: 'rod', look: 'bespoke', skill: spec, x, z, radius, delay, damage: 0, hitsSubs: true });
}

function fracture(s: Ship, x0: number, z0: number, x1: number, z1: number, n = 0): Fracture {
  const a = state(s);
  const f = { id: ++a.serial, x0, z0, x1, z1, expiresAt: s.game.time + FAULTLINE.fractureLife };
  a.fractures.push(f);
  if (a.fractures.length > FAULTLINE.maxFractures) a.fractures.shift();
  emitMisc(s, 'fracture', x0, z0, { tx: x1, tz: z1, n });
  return f;
}

/** Pulses spaced every 350 m along `f`, rippling out from its start. Returns when the last lands. */
function linePulse(s: Ship, spec: SkillSpec, f: Fracture, seq: number, damage: number, start: number, knock: number, n: number): number {
  const count = Math.max(1, Math.ceil(Math.hypot(f.x1 - f.x0, f.z1 - f.z0) / 350));
  for (let i = 0; i <= count; i++) {
    const x = f.x0 + ((f.x1 - f.x0) * i) / count;
    const z = f.z0 + ((f.z1 - f.z0) * i) / count;
    pulse(s, spec, seq, x, z, FAULTLINE.pulseRadius, damage, start + i * 0.08, knock, 'rupture', n);
  }
  return start + count * 0.08;
}

function nearestFracture(s: Ship): Fracture | undefined {
  const p = aimPoint(s, FAULTLINE.range);
  const live = state(s).fractures.filter((f) => f.expiresAt > s.game.time);
  const d = (f: Fracture) => {
    const q = nearestOn(f.x0, f.z0, f.x1, f.z1, p.x, p.z);
    return Math.hypot(q.x - p.x, q.z - p.z);
  };
  return live.sort((a, b) => d(a) - d(b))[0];
}

// ------------------------------------------------------------------ ridges

function makeRidge(s: Ship, x: number, z: number, dx: number, dz: number, length: number): DynamicRidge {
  const n = Math.hypot(dx, dz) || 1;
  const half = length / 2;
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

function hullClear(s: Ship, x: number, z: number, ridge?: DynamicRidge): boolean {
  const map = s.game.map;
  const fx = forwardX(s.heading);
  const fz = forwardZ(s.heading);
  const half = s.spec.length / 2 + 30;
  const beam = s.spec.beam / 2 + 30;
  if (Math.abs(x) + half > MAP_HALF - 200 || Math.abs(z) + half > MAP_HALF - 200) return false;
  for (const along of [-half, 0, half])
    for (const across of [-beam, 0, beam]) {
      const px = x + fx * along - fz * across;
      const pz = z + fz * along + fx * across;
      if (map.heightAt(px, pz) > -Math.max(8, s.spec.draft)) return false;
      if (ridge && ridgeDistance(ridge, px, pz) < ridge.width / 2 + 25) return false;
    }
  return true;
}

/** The whole relocation is prepared before mutating any hull or map geometry. */
function displacements(s: Ship, r: DynamicRidge): { ship: Ship; x: number; z: number }[] | null {
  const moves: { ship: Ship; x: number; z: number }[] = [];
  const dx = r.x1 - r.x0;
  const dz = r.z1 - r.z0;
  const len = Math.hypot(dx, dz) || 1;
  for (const ship of s.game.ships) {
    if (!ship.alive || ship.mods.banished || ridgeDistance(r, ship.pos.x, ship.pos.z) > r.width / 2 + ship.spec.length / 2 + 40) continue;
    const p = ridgeNearest(r, ship.pos.x, ship.pos.z);
    const side = (ship.pos.x - p.x) * -dz + (ship.pos.z - p.z) * dx < 0 ? -1 : 1;
    let found: { ship: Ship; x: number; z: number } | null = null;
    for (const sign of [side, -side]) {
      for (let d = r.width / 2 + ship.spec.length / 2 + 80; d <= 1100; d += 100) {
        const x = p.x - (dz / len) * d * sign;
        const z = p.z + (dx / len) * d * sign;
        if (!hullClear(ship, x, z, r)) continue;
        const occupied = s.game.ships.some((o) => {
          if (o === ship || !o.alive) return false;
          const moved = moves.find((m) => m.ship === o);
          const ox = moved?.x ?? o.pos.x;
          const oz = moved?.z ?? o.pos.z;
          return Math.hypot(x - ox, z - oz) < (ship.spec.length + o.spec.length) / 2 + 30;
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

/** Queues `ridges` to rise after the warning; `damage` erupts under ships along each line as it does. */
function queueRidges(s: Ship, spec: SkillSpec, ridges: DynamicRidge[], damage = 0, knockSpeed = 0): boolean {
  const map = s.game.map;
  // Include queued ridges during validation so two fast casts cannot reserve the same space.
  const original = map.dynamicRidges;
  map.dynamicRidges = [...original, ...state(s).pending.flatMap((p) => (p.kind === 'ridge' && p.ridge ? [p.ridge] : []))];
  let valid = true;
  for (const r of ridges) {
    if (!map.canPlaceDynamicRidge(r) || !displacements(s, r)) {
      valid = false;
      break;
    }
    map.dynamicRidges.push(r);
  }
  map.dynamicRidges = original;
  if (!valid) return s.failSkill('Uplift: ridge needs clear water, safe exits and space away from spawns');
  for (const r of ridges) {
    const x = (r.x0 + r.x1) / 2;
    const z = (r.z0 + r.z1) / 2;
    state(s).pending.push({ id: ++state(s).serial, sequence: r.id, kind: 'ridge', at: s.game.time + FAULTLINE.warning, x, z, radius: r.width, damage, knock: knockSpeed, skillId: spec.id, ridge: r, look: null, n: 0 });
    s.game.strikes.spawn(s, { kind: 'rod', look: 'bespoke', skill: spec, x, z, radius: Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2, delay: FAULTLINE.warning, damage: 0 });
  }
  return true;
}

/** A ridge rising erupts under every ship whose hull lies within reach of its line. */
function erupt(s: Ship, r: DynamicRidge, p: FaultPending): void {
  const spec = skillOf(s, p.skillId);
  const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0) || 1;
  for (const t of enemies(s)) {
    const q = ridgeNearest(r, t.pos.x, t.pos.z);
    if (distToHull(t, q.x, q.z) > FAULTLINE.uplift.reach) continue;
    if (spec) hurt(s, t, p.damage, spec);
    const side = (t.pos.x - q.x) * -(r.z1 - r.z0) + (t.pos.z - q.z) * (r.x1 - r.x0) < 0 ? -1 : 1;
    knock(t, q.x, q.z, p.knock, (-(r.z1 - r.z0) / len) * side, ((r.x1 - r.x0) / len) * side);
  }
}

function crumble(s: Ship, r: DynamicRidge, kind: 'crumble' | 'collapse' = 'crumble', radius = r.width): void {
  emitMisc(s, kind, r.x0, r.z0, { tx: r.x1, tz: r.z1, radius, n: r.id });
}

// ------------------------------------------------------------------ skills

export function castFault(s: Ship, spec: SkillSpec): void {
  const p = aimPoint(s, FAULTLINE.range);
  const fx = forwardX(s.heading);
  const fz = forwardZ(s.heading);
  const f = fracture(s, s.pos.x + (fx * s.spec.length) / 2, s.pos.z + (fz * s.spec.length) / 2, p.x, p.z);
  linePulse(s, spec, f, ++state(s).serial, FAULTLINE.fault.damage, FAULTLINE.warning, FAULTLINE.fault.knock, 0);
}

export function castUplift(s: Ship, spec: SkillSpec): boolean {
  const p = aimPoint(s, FAULTLINE.range);
  const dx = p.x - s.pos.x;
  const dz = p.z - s.pos.z;
  const U = FAULTLINE.uplift;
  return queueRidges(s, spec, [makeRidge(s, p.x, p.z, -dz || (dx === 0 ? 1 : 0), dx, FAULTLINE.ridgeLength)], U.damage, U.knock);
}

export function castSubduction(s: Ship, spec: SkillSpec): boolean {
  const f = nearestFracture(s);
  if (!f) return s.failSkill('Subduction: open a fracture first');
  const S = FAULTLINE.subduction;
  const p = aimPoint(s, FAULTLINE.range);
  const q = nearestOn(f.x0, f.z0, f.x1, f.z1, p.x, p.z);
  s.game.fields.add(s, { x: q.x, z: q.z, r: S.radius, life: S.time, pull: S.pull, slow: 0.55, skill: spec, color: FAULTLINE.accent, look: 'circle' });
  pulse(s, spec, ++state(s).serial, q.x, q.z, S.crush, S.damage, S.time, S.knock, 'crush');
  emitMisc(s, 'subduct', q.x, q.z, { radius: S.radius, tx: f.x1 - f.x0, tz: f.z1 - f.z0 });
  return true;
}

export function castSlip(s: Ship): boolean {
  const f = nearestFracture(s);
  if (!f) return s.failSkill('Slip: open a fracture first');
  const p = aimPoint(s, FAULTLINE.range);
  const q = nearestOn(f.x0, f.z0, f.x1, f.z1, p.x, p.z);
  if (Math.hypot(q.x - s.pos.x, q.z - s.pos.z) < 100) return s.failSkill('Slip: aim farther along a fracture');
  // Sweep the complete hull corridor. A dash never skips a ridge or island between its ends.
  const steps = Math.ceil(Math.hypot(q.x - s.pos.x, q.z - s.pos.z) / 60);
  for (let i = 1; i <= steps; i++)
    if (!hullClear(s, s.pos.x + ((q.x - s.pos.x) * i) / steps, s.pos.z + ((q.z - s.pos.z) * i) / steps)) return s.failSkill('Slip: fracture path blocked');
  state(s).slip = { x0: s.pos.x, z0: s.pos.z, x1: q.x, z1: q.z, startedAt: s.game.time, until: s.game.time + FAULTLINE.slip.time, hit: [] };
  addPressure(s, FAULTLINE.slip.pressure);
  emitMisc(s, 'slip', s.pos.x, s.pos.z, { tx: q.x, tz: q.z });
  return true;
}

export function castAftershock(s: Ship, spec: SkillSpec): boolean {
  const a = state(s);
  const ridges = owned(s);
  if (!a.fractures.length && !ridges.length) return s.failSkill('Aftershock: open a fracture or raise a ridge first');
  const A = FAULTLINE.aftershock;
  const seq = ++a.serial;
  a.fractures.forEach((f, i) => linePulse(s, spec, f, seq, A.damage, 0.5 + i * 0.3, A.knock, 1));
  const drop = ++a.serial;
  ridges.forEach((r, i) =>
    a.pending.push({ id: ++a.serial, sequence: drop, kind: 'boulders', at: s.game.time + 0.6 + i * 0.2, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, radius: A.reach, damage: A.boulder, knock: 0, skillId: spec.id, ridge: { ...r }, look: 'boulder', n: 0 }),
  );
  return true;
}

export function castBedrock(s: Ship): void {
  const a = state(s);
  a.bedrockUntil = s.game.time + FAULTLINE.bedrock.time;
  a.reboundAt = a.bedrockUntil;
  a.lastReceived = s.stats.received;
  emitMisc(s, 'bedrock', s.pos.x, s.pos.z);
}

/** Bedrock ends: the stored pressure throws everything near back, without being spent. */
function rebound(s: Ship): void {
  const a = state(s);
  const B = FAULTLINE.bedrock;
  const spec = skillOf(s, 'faultlineBedrock');
  const damage = B.rebound + a.pressure * B.perPressure;
  for (const t of enemies(s)) {
    if (distToHull(t, s.pos.x, s.pos.z) > B.radius) continue;
    if (spec) hurt(s, t, damage, spec);
    knock(t, s.pos.x, s.pos.z, B.knock);
  }
  emitMisc(s, 'rebound', s.pos.x, s.pos.z, { radius: B.radius, n: Math.round(a.pressure) });
}

export function castDivide(s: Ship, spec: SkillSpec): boolean {
  const D = FAULTLINE.divide;
  const p = aimPoint(s, FAULTLINE.range);
  const dx = p.x - s.pos.x;
  const dz = p.z - s.pos.z;
  const n = Math.hypot(dx, dz) || 1;
  const nx = -dz / n;
  const nz = dx / n;
  const ridges = [-1, 1].map((side) => makeRidge(s, p.x + nx * D.offset * side, p.z + nz * D.offset * side, dx, dz, D.length));
  if (!queueRidges(s, spec, ridges)) return false;
  const half = D.length / 2;
  const f = fracture(s, p.x - (dx / n) * half, p.z - (dz / n) * half, p.x + (dx / n) * half, p.z + (dz / n) * half);
  linePulse(s, spec, f, ++state(s).serial, D.damage, 1.1, D.knock, 2);
  return true;
}

export function castCaldera(s: Ship, spec: SkillSpec): void {
  const C = FAULTLINE.caldera;
  const p = aimPoint(s, FAULTLINE.range);
  const a = state(s);
  const pressure = a.pressure;
  a.pressure = 0;
  s.game.fields.add(s, { ...p, r: C.pull, life: C.time, pull: 150, slow: 0.7, look: 'circle', color: FAULTLINE.accent, skill: spec });
  pulse(s, spec, ++a.serial, p.x, p.z, C.radius, C.damage + pressure * C.perPressure, C.time, C.knock, 'eruption', Math.round(pressure));
  emitMisc(s, 'caldera', p.x, p.z, { radius: C.pull, n: Math.round(pressure) });
}

export function castWorldbreaker(s: Ship, spec: SkillSpec): void {
  const W = FAULTLINE.worldbreaker;
  const a = state(s);
  const seq = ++a.serial;
  if (!a.fractures.length) castFault(s, spec);
  let end = 0.9;
  a.fractures.forEach((f, i) => {
    end = Math.max(end, linePulse(s, spec, f, seq, W.damage, 0.9 + i * 0.25, W.knock, 3));
  });
  a.pending.push({ id: ++a.serial, sequence: seq, kind: 'collapse', at: s.game.time + end + 0.5, x: s.pos.x, z: s.pos.z, radius: W.radius, damage: W.collapse, knock: W.knock, skillId: spec.id, ridge: null, look: null, n: 0 });
  emitMisc(s, 'worldbreaker', s.pos.x, s.pos.z, { n: a.fractures.length });
}

// ------------------------------------------------------------------ resolution

/** Hits every enemy within `radius` of (x, z) — or of `ridge`'s line — with diminishing repeats per sequence. */
function strike(s: Ship, p: FaultPending, ridge: DynamicRidge | null = null): void {
  const a = state(s);
  const spec = skillOf(s, p.skillId);
  for (const t of enemies(s)) {
    const q = ridge ? ridgeNearest(ridge, t.pos.x, t.pos.z) : p;
    if (distToHull(t, q.x, q.z) > p.radius) continue;
    let hit = a.hits.find((h) => h.sequence === p.sequence && h.target === t.id);
    if (!hit) {
      hit = { sequence: p.sequence, target: t.id, count: 0 };
      a.hits.push(hit);
    }
    // A finite per-sequence budget keeps networks of overlapping fractures from scaling without bound.
    if (hit.count >= FAULTLINE.maxHits) continue;
    const fall = FAULTLINE.repeat ** hit.count++;
    const damage = p.damage * fall;
    const dealt = spec ? hurt(s, t, damage, spec) : t.takeDamage(damage * s.mods.damageMul, s);
    if (dealt > 0) addPressure(s, Math.min(5, dealt / 15000));
    if (p.knock > 0) knock(t, q.x, q.z, p.knock * fall);
  }
}

function raise(s: Ship, p: FaultPending): void {
  const r = p.ridge!;
  const moves = displacements(s, r);
  if (!moves || !s.game.map.addDynamicRidge(r)) {
    s.failSkill('Uplift: water became obstructed before the ridge rose');
    return;
  }
  if (p.damage > 0) erupt(s, r, p);
  for (const m of moves) {
    m.ship.pos.x = m.x;
    m.ship.pos.z = m.z;
    m.ship.speed = 0;
    m.ship.pushX = m.ship.pushZ = 0;
  }
  emitMisc(s, 'uplift', r.x0, r.z0, { tx: r.x1, tz: r.z1, radius: r.width, n: r.id });
  const mine = owned(s);
  if (mine.length > FAULTLINE.maxRidges) {
    crumble(s, mine[0]);
    s.game.map.dynamicRidges = s.game.map.dynamicRidges.filter((o) => o !== mine[0]);
  }
  fracture(s, r.x0, r.z0, r.x1, r.z1);
}

function collapse(s: Ship, p: FaultPending): void {
  for (const r of owned(s)) {
    crumble(s, r, 'collapse', p.radius);
    strike(s, { ...p, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  }
  s.game.map.dynamicRidges = s.game.map.dynamicRidges.filter((r) => r.owner !== s.id);
  state(s).fractures = [];
}

function updateSlip(s: Ship, now: number): void {
  const a = state(s);
  const slip = a.slip;
  if (!slip) return;
  const SL = FAULTLINE.slip;
  const f = Math.min(1, (now - slip.startedAt) / (slip.until - slip.startedAt));
  const x = slip.x0 + (slip.x1 - slip.x0) * f;
  const z = slip.z0 + (slip.z1 - slip.z0) * f;
  const clear = hullClear(s, x, z);
  if (clear) {
    s.pos.x = x;
    s.pos.z = z;
    s.speed = 0;
    const spec = skillOf(s, 'faultlineSlip');
    for (const t of enemies(s))
      if (spec && !slip.hit.includes(t.id) && distToHull(t, x, z) < s.spec.beam + 60) {
        slip.hit.push(t.id);
        hurt(s, t, SL.damage, spec);
      }
  }
  if (!clear || f >= 1) {
    // The lava cools behind it, burning whatever crosses its line.
    a.wakes.push({ x0: slip.x0, z0: slip.z0, x1: s.pos.x, z1: s.pos.z, until: now + SL.wakeTime, next: now + SL.tick });
    a.slip = null;
  }
}

function updateWakes(s: Ship, now: number): void {
  const a = state(s);
  const SL = FAULTLINE.slip;
  const spec = skillOf(s, 'faultlineSlip');
  for (const w of a.wakes)
    while (now >= w.next - 1e-9 && w.next <= w.until + 1e-9) {
      w.next += SL.tick;
      for (const t of enemies(s)) {
        const q = nearestOn(w.x0, w.z0, w.x1, w.z1, t.pos.x, t.pos.z);
        if (spec && distToHull(t, q.x, q.z) <= SL.reach) hurt(s, t, SL.wake * SL.tick, spec);
      }
    }
  a.wakes = a.wakes.filter((w) => w.next <= w.until + 1e-9);
}

export function updateFaultline(s: Ship, _dt: number): void {
  if (!s.faultline) return;
  if (!s.alive) {
    clearFaultline(s);
    return;
  }
  const a = state(s);
  const now = s.game.time;
  for (const r of owned(s)) if (r.expiresAt <= now) crumble(s, r);
  s.game.map.expireDynamicRidges(now);
  a.fractures = a.fractures.filter((f) => f.expiresAt > now);
  if (a.bedrockUntil > now) {
    const received = Math.max(0, s.stats.received - a.lastReceived);
    const B = FAULTLINE.bedrock;
    addPressure(s, (received * (B.reduction / (1 - B.reduction))) / 10000);
  }
  a.lastReceived = s.stats.received;
  if (a.reboundAt && now >= a.reboundAt - 1e-9) {
    a.reboundAt = 0;
    rebound(s);
  }
  const due = a.pending.filter((p) => p.at <= now + 1e-8);
  a.pending = a.pending.filter((p) => p.at > now + 1e-8);
  for (const p of due) {
    if (p.kind === 'pulse') {
      strike(s, p);
      if (p.look) emitMisc(s, p.look, p.x, p.z, { radius: p.radius, n: p.n });
    } else if (p.kind === 'ridge' && p.ridge) raise(s, p);
    else if (p.kind === 'boulders' && p.ridge) {
      strike(s, p, p.ridge);
      emitMisc(s, 'boulder', p.ridge.x0, p.ridge.z0, { tx: p.ridge.x1, tz: p.ridge.z1, radius: p.radius });
    } else if (p.kind === 'collapse') collapse(s, p);
  }
  const active = new Set(a.pending.map((p) => p.sequence));
  a.hits = a.hits.filter((h) => active.has(h.sequence));
  updateSlip(s, now);
  updateWakes(s, now);
}
