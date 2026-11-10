import { SIM_DT } from '../../config';
import { distToHull, segmentHitsHull } from '../../core/hull';
import { DEG, TAU, approachAngle, bearingTo, forwardX, forwardZ, wrapAngle } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { aimPoint, buff, ccTime, hurt } from '../kit';
import { emitMisc, type TitanRider } from './MiscEvents';

// The Pharos is a lighthouse: its lamp beam sweeps round the hull all battle. A ship the beam
// crosses is lit and gains Exposure, islands and ridges throw shadows it cannot reach into, and
// every skill works from where the beam points now.

export const PHAROS = {
  accent: 0xffe9a0,
  /** How far the beam reaches. */
  range: 3200,
  /** How far reticle-aimed skills reach. */
  reach: 2800,
  /** The sweep, radians a second: one turn in ten seconds. */
  spin: 36 * DEG,
  halfWidth: 6 * DEG,
  /** Seconds a ship stays lit after the beam leaves it. */
  litTime: 4,
  maxExposure: 8,
  /** Seconds before one beam's sweep can add Exposure to the same hull again. */
  gainGap: 1.5,
  /** Seconds in the dark before Exposure starts to fade, then the seconds each stack takes to go. */
  darkGrace: 5,
  decay: 2,
  battery: { damage: 36000, he: 22000, reload: 8, perExposure: 0.06, lit: 2 },
  hold: { time: 4, slew: 150 * DEG, burn: 30000, tick: 0.5 },
  lance: { warning: 0.7, width: 140, damage: 150000, perExposure: 15000, buoy: 400 },
  counter: { time: 3, speed: 2.5, damage: 70000 },
  dazzle: { damage: 80000, perExposure: 10000, time: 4, scatter: 3, reach: 0.6 },
  buoy: { max: 3, life: 30, radius: 450, damage: 60000, gap: 1.5 },
  dark: { time: 5, reduction: 0.4, radius: 1000, damage: 90000, exposure: 2, wide: 6, widen: 2 },
  twin: { time: 15, speed: 1.5 },
  daybreak: { warning: 1, time: 4, widen: 3, range: 3600, damage: 320000, perExposure: 25000 },
  falseLight: { time: 3.5, lure: 1800, radius: 800, damage: 380000, perExposure: 30000 },
} as const;

/** What the lamp knows of one enemy hull. */
export interface LitRecord {
  target: number;
  /** Exposure, 0 to `PHAROS.maxExposure`. */
  stacks: number;
  /** Lit until this time. */
  until: number;
  /** In a beam on the last tick, so a crossing is counted once. */
  inBeam: boolean;
  gainedAt: number;
  /** When the next stack fades, unless it is lit again first. */
  decayAt: number;
  dazzledUntil: number;
}

export interface LensBuoy {
  id: number;
  x: number;
  z: number;
  expiresAt: number;
  flaredAt: number;
}

export interface PharosState {
  /** Where the lamp points, a world bearing. */
  bearing: number;
  dir: 1 | -1;
  lit: LitRecord[];
  holdUntil: number;
  holdNext: number;
  holdTicks: number;
  scorchUntil: number;
  darkUntil: number;
  /** When the shutters reopen with a flare; 0 when none is due. */
  relightAt: number;
  wideUntil: number;
  twinUntil: number;
  /** A lance winding up along bearings locked at the cast. */
  lance: { bearings: number[]; at: number } | null;
  daybreak: { startAt: number; until: number; started: boolean; seared: number[] } | null;
  buoys: LensBuoy[];
  beacon: { x: number; z: number; until: number; lured: { target: number; until: number }[] } | null;
  serial: number;
}

export function newPharosState(bearing = 0): PharosState {
  return {
    bearing,
    dir: 1,
    lit: [],
    holdUntil: 0,
    holdNext: 0,
    holdTicks: 0,
    scorchUntil: 0,
    darkUntil: 0,
    relightAt: 0,
    wideUntil: 0,
    twinUntil: 0,
    lance: null,
    daybreak: null,
    buoys: [],
    beacon: null,
    serial: 0,
  };
}

function state(s: Ship): PharosState {
  return s.pharos!;
}

function skillOf(s: Ship, id: string): SkillSpec | null {
  return s.spec.skills.find((k) => k.id === id) ?? null;
}

function enemies(s: Ship): Ship[] {
  return s.game.ships.filter((t) => t.alive && !t.withdrawn && t.team !== s.team && !t.mods.banished && !t.deep);
}

/** The slice of a hull that counts as caught when the beam's edge reaches it. */
function hullPad(t: Ship): number {
  return Math.min(t.spec.length, 320) / 4;
}

// ------------------------------------------------------------------ the beam

export interface Beam {
  bearing: number;
  /** Half its width, radians. */
  half: number;
  range: number;
}

function dayActive(a: PharosState, now: number): boolean {
  return !!a.daybreak && a.daybreak.started && a.daybreak.until > now;
}

/** The beams the lamp throws now: none while shuttered, two under Twin Lamps. */
export function pharosBeams(s: Ship): Beam[] {
  const a = s.pharos;
  if (!a) return [];
  const now = s.game.time;
  if (a.darkUntil > now) return [];
  const day = dayActive(a, now);
  const half = PHAROS.halfWidth * Math.max(a.wideUntil > now ? PHAROS.dark.widen : 1, day ? PHAROS.daybreak.widen : 1);
  const range = day ? PHAROS.daybreak.range : PHAROS.range;
  const out: Beam[] = [{ bearing: a.bearing, half, range }];
  if (a.twinUntil > now) out.push({ bearing: wrapAngle(a.bearing + Math.PI), half, range });
  return out;
}

/** How the lamp is turning, signed radians a second; 0 while it is held or winding up Daybreak. */
export function sweepRate(s: Ship): number {
  const a = s.pharos;
  if (!a) return 0;
  const now = s.game.time;
  if (a.daybreak && !a.daybreak.started) return 0;
  if (dayActive(a, now)) return (a.dir * TAU) / PHAROS.daybreak.time;
  if (a.holdUntil > now) return 0;
  return a.dir * PHAROS.spin * (a.twinUntil > now ? PHAROS.twin.speed : 1) * (a.scorchUntil > now ? PHAROS.counter.speed : 1);
}

/** Where the lamp points as this frame is drawn, between simulation ticks. */
export function lampBearing(s: Ship): number {
  return wrapAngle(s.pharos!.bearing - sweepRate(s) * (1 - s.game.alpha) * SIM_DT);
}

/** Whether `beam` from `s` covers (x, z), a target `pad` metres wide; shadows are not considered. */
function covers(s: Ship, beam: Beam, x: number, z: number, pad: number): boolean {
  const d = Math.hypot(x - s.pos.x, z - s.pos.z);
  if (d > beam.range + pad) return false;
  if (d <= pad) return true;
  const off = Math.abs(wrapAngle(bearingTo(s.pos.x, s.pos.z, x, z) - beam.bearing));
  return off <= beam.half + Math.asin(Math.min(1, pad / d));
}

/** Whether a beam of `s` falls on (x, z) now: in its wedge and not in the shadow of land. */
export function beamCatches(s: Ship, x: number, z: number, pad = 0, beams = pharosBeams(s)): boolean {
  if (!beams.some((b) => covers(s, b, x, z, pad))) return false;
  return !s.game.map.losBlocked(s.pos.x, s.pos.z, x, z);
}

/** How far a beam along `bearing` runs before land stops it, up to `range`. */
export function beamReach(s: Ship, bearing: number, range: number): number {
  const fx = forwardX(bearing);
  const fz = forwardZ(bearing);
  const map = s.game.map;
  const step = 80;
  for (let d = step; d < range; d += step) if (map.losBlocked(s.pos.x, s.pos.z, s.pos.x + fx * d, s.pos.z + fz * d)) return d - step;
  return map.losBlocked(s.pos.x, s.pos.z, s.pos.x + fx * range, s.pos.z + fz * range) ? range - step : range;
}

/** Seconds until the sweep next reaches `t`, 0 while it is in a beam; null when no sweep will. */
export function nextPass(s: Ship, t: Ship): number | null {
  const a = s.pharos;
  const rate = sweepRate(s);
  const beams = pharosBeams(s);
  if (!a || !beams.length) return null;
  const pad = hullPad(t);
  const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
  if (d > beams[0].range + pad) return null;
  if (beams.some((b) => covers(s, b, t.pos.x, t.pos.z, pad))) return 0;
  if (!rate) return null;
  const to = bearingTo(s.pos.x, s.pos.z, t.pos.x, t.pos.z);
  let best = Infinity;
  for (const b of beams) {
    let turn = (wrapAngle(to - b.bearing) * Math.sign(rate)) % TAU;
    if (turn < 0) turn += TAU;
    best = Math.min(best, Math.max(0, turn - b.half - Math.asin(Math.min(1, pad / Math.max(d, pad)))) / Math.abs(rate));
  }
  return best;
}

// ------------------------------------------------------------------ light and Exposure

/** The lamp's record of `t`, if it has one. */
export function litRecord(s: Ship, t: Ship): LitRecord | undefined {
  return s.pharos?.lit.find((r) => r.target === t.id);
}

export function exposureOf(s: Ship, t: Ship): number {
  return litRecord(s, t)?.stacks ?? 0;
}

export function isLit(s: Ship, t: Ship): boolean {
  return (litRecord(s, t)?.until ?? 0) > s.game.time;
}

function record(s: Ship, t: Ship): LitRecord {
  const a = state(s);
  let r = a.lit.find((x) => x.target === t.id);
  if (!r) {
    r = { target: t.id, stacks: 0, until: 0, inBeam: false, gainedAt: -1e9, decayAt: 0, dazzledUntil: 0 };
    a.lit.push(r);
  }
  return r;
}

/** Lights `t` for `time` seconds: it cannot hide in smoke or under a cloak, and its Exposure holds. */
function light(s: Ship, t: Ship, time: number): LitRecord {
  const now = s.game.time;
  const r = record(s, t);
  r.until = Math.max(r.until, now + time);
  r.decayAt = r.until + PHAROS.darkGrace + PHAROS.decay;
  buff(t, 'debuff:pharosLit', r.until - now, (m) => {
    m.revealed = true;
  });
  return r;
}

function gain(s: Ship, r: LitRecord, n: number): void {
  r.stacks = Math.min(PHAROS.maxExposure, r.stacks + n);
  r.gainedAt = s.game.time;
}

/** What Lance of Light, Daybreak and False Light deal a hull holding `n` Exposure, before the caster's multipliers. */
export const pharosDamage = {
  lance: (n: number): number => PHAROS.lance.damage + n * PHAROS.lance.perExposure,
  dazzle: (n: number): number => PHAROS.dazzle.damage + n * PHAROS.dazzle.perExposure,
  daybreak: (n: number): number => PHAROS.daybreak.damage + n * PHAROS.daybreak.perExposure,
  falseLight: (n: number): number => PHAROS.falseLight.damage + n * PHAROS.falseLight.perExposure,
};

export function applyPharosPassives(s: Ship, mods: Ship['mods']): void {
  if (!s.pharos || s.pharos.darkUntil <= s.game.time) return;
  mods.untargetable = true;
  mods.damageTakenMul *= 1 - PHAROS.dark.reduction;
}

export function clearPharos(s: Ship): void {
  if (!s.pharos) return;
  Object.assign(s.pharos, newPharosState(s.heading));
}

/** Flare rounds: the first to strike an unlit hull lights it briefly, and Exposure makes every round bite harder. */
export function pharosRider(s: Ship): TitanRider {
  return {
    onFirstHit: (t) => {
      if (t.team !== s.team && !isLit(s, t)) light(s, t, PHAROS.battery.lit);
    },
    hitMul: (t) => 1 + PHAROS.battery.perExposure * exposureOf(s, t),
  };
}

// ------------------------------------------------------------------ what a victim is told

/** The enemy Pharos with the firmest hold on `t`: its record of `t`, and the seconds `t` is still lured for. */
export function pharosHold(t: Ship): { pharos: Ship; record: LitRecord | null; lured: number } | null {
  const now = t.game.time;
  let best: { pharos: Ship; record: LitRecord | null; lured: number } | null = null;
  let rank = 0;
  for (const p of t.game.ships) {
    const a = p.pharos;
    if (!a || !p.alive || p.team === t.team) continue;
    const r = a.lit.find((x) => x.target === t.id) ?? null;
    const lured = Math.max(0, (a.beacon?.lured.find((l) => l.target === t.id)?.until ?? 0) - now);
    const held = !!r && (r.until > now || r.stacks > 0 || r.dazzledUntil > now);
    if (!held && lured <= 0) continue;
    const score = (lured > 0 ? 1000 : 0) + (r && r.dazzledUntil > now ? 100 : 0) + (r?.stacks ?? 0) + 1;
    if (score > rank) {
      rank = score;
      best = { pharos: p, record: held ? r : null, lured };
    }
  }
  return best;
}

// ------------------------------------------------------------------ skills

const SHUT = 'the lamp is shuttered';

export function castHold(s: Ship): boolean {
  const a = state(s);
  const now = s.game.time;
  if (a.darkUntil > now) return s.failSkill(`Hold the Light: ${SHUT}`);
  if (a.daybreak) return s.failSkill('Hold the Light: Daybreak is burning');
  a.holdUntil = now + PHAROS.hold.time;
  a.holdNext = now + PHAROS.hold.tick;
  a.holdTicks = 0;
  emitMisc(s, 'hold', s.pos.x, s.pos.z);
  return true;
}

export function castLance(s: Ship, spec: SkillSpec): boolean {
  const a = state(s);
  const beams = pharosBeams(s);
  if (!beams.length) return s.failSkill(`Lance of Light: ${SHUT}`);
  const L = PHAROS.lance;
  a.lance = { bearings: beams.map((b) => b.bearing), at: s.game.time + L.warning };
  for (const b of beams) {
    const len = beamReach(s, b.bearing, PHAROS.range);
    const fx = forwardX(b.bearing);
    const fz = forwardZ(b.bearing);
    // Bespoke warnings down the line: the AI steers clear, and the Pharos's own effects draw it.
    for (let d = 300; d <= len; d += 300) s.game.strikes.spawn(s, { kind: 'rod', look: 'bespoke', skill: spec, x: s.pos.x + fx * d, z: s.pos.z + fz * d, radius: L.width, delay: L.warning, damage: 0, hitsSubs: true });
    emitMisc(s, 'lanceAim', s.pos.x, s.pos.z, { tx: s.pos.x + fx * len, tz: s.pos.z + fz * len });
  }
  return true;
}

export function castCounter(s: Ship): boolean {
  const a = state(s);
  const now = s.game.time;
  if (a.darkUntil > now) return s.failSkill(`Counter-sweep: ${SHUT}`);
  a.dir = a.dir === 1 ? -1 : 1;
  a.scorchUntil = now + PHAROS.counter.time;
  // The beam scorches the hull it is already on, too.
  for (const r of a.lit) r.inBeam = false;
  emitMisc(s, 'counter', s.pos.x, s.pos.z, { n: a.dir });
  return true;
}

export function castDazzle(s: Ship, spec: SkillSpec): boolean {
  const now = s.game.time;
  const D = PHAROS.dazzle;
  const lit = enemies(s).filter((t) => isLit(s, t));
  if (!lit.length) return s.failSkill('Dazzle: no ship is lit');
  for (const t of lit) {
    const r = record(s, t);
    hurt(s, t, pharosDamage.dazzle(r.stacks), spec);
    r.dazzledUntil = now + D.time;
    buff(t, 'debuff:pharosDazzle', D.time, (m) => {
      m.dispersionMul *= D.scatter;
      m.reachMul *= D.reach;
    });
    emitMisc(s, 'dazzled', t.pos.x, t.pos.z, { target: t });
  }
  emitMisc(s, 'dazzle', s.pos.x, s.pos.z, { n: lit.length });
  return true;
}

export function castBuoy(s: Ship): boolean {
  const a = state(s);
  const B = PHAROS.buoy;
  const p = aimPoint(s, PHAROS.reach);
  if (s.game.map.heightAt(p.x, p.z) > -2) return s.failSkill('Lens Buoy: needs open water');
  a.buoys.push({ id: ++a.serial, x: p.x, z: p.z, expiresAt: s.game.time + B.life, flaredAt: -1e9 });
  if (a.buoys.length > B.max) {
    const old = a.buoys.shift()!;
    emitMisc(s, 'buoyGone', old.x, old.z, { n: old.id });
  }
  emitMisc(s, 'buoy', s.pos.x, s.pos.z, { tx: p.x, tz: p.z, n: a.serial });
  return true;
}

export function castDark(s: Ship): boolean {
  const a = state(s);
  const now = s.game.time;
  if (a.daybreak) return s.failSkill('Dark Lamp: Daybreak is burning');
  a.darkUntil = now + PHAROS.dark.time;
  a.relightAt = a.darkUntil;
  a.holdUntil = 0;
  for (const r of a.lit) r.inBeam = false;
  emitMisc(s, 'douse', s.pos.x, s.pos.z);
  return true;
}

export function castTwin(s: Ship): void {
  state(s).twinUntil = s.game.time + PHAROS.twin.time;
  emitMisc(s, 'twin', s.pos.x, s.pos.z);
}

export function castDaybreak(s: Ship): boolean {
  const a = state(s);
  const now = s.game.time;
  const D = PHAROS.daybreak;
  if (a.darkUntil > now) return s.failSkill(`Daybreak: ${SHUT}`);
  a.daybreak = { startAt: now + D.warning, until: now + D.warning + D.time, started: false, seared: [] };
  a.holdUntil = 0;
  emitMisc(s, 'daybreakWarn', s.pos.x, s.pos.z, { radius: D.range });
  return true;
}

export function castFalseLight(s: Ship, spec: SkillSpec): boolean {
  const a = state(s);
  const F = PHAROS.falseLight;
  const p = aimPoint(s, PHAROS.reach);
  a.beacon = { x: p.x, z: p.z, until: s.game.time + F.time, lured: [] };
  s.game.strikes.spawn(s, { kind: 'rod', look: 'bespoke', skill: spec, x: p.x, z: p.z, radius: F.radius, delay: F.time, damage: 0, hitsSubs: true });
  emitMisc(s, 'falseLight', p.x, p.z, { radius: F.lure });
  return true;
}

// ------------------------------------------------------------------ resolution

/** The shutters reopen: a flare lights everything near, and the beam runs wide for a while. */
function relight(s: Ship): void {
  const a = state(s);
  const D = PHAROS.dark;
  const spec = skillOf(s, 'pharosDark');
  for (const t of enemies(s)) {
    if (distToHull(t, s.pos.x, s.pos.z) > D.radius) continue;
    if (spec) hurt(s, t, D.damage, spec);
    gain(s, light(s, t, PHAROS.litTime), D.exposure);
  }
  a.wideUntil = s.game.time + D.wide;
  emitMisc(s, 'relight', s.pos.x, s.pos.z, { radius: D.radius });
}

function fireLance(s: Ship, bearings: number[]): void {
  const a = state(s);
  const L = PHAROS.lance;
  const spec = skillOf(s, 'pharosLance');
  for (const bearing of bearings) {
    const len = beamReach(s, bearing, PHAROS.range);
    const x1 = s.pos.x + forwardX(bearing) * len;
    const z1 = s.pos.z + forwardZ(bearing) * len;
    emitMisc(s, 'lance', s.pos.x, s.pos.z, { tx: x1, tz: z1 });
    const strike = (t: Ship) => {
      const r = litRecord(s, t);
      if (spec) hurt(s, t, pharosDamage.lance(r?.stacks ?? 0), spec);
      if (r && r.until > s.game.time) t.startFire(Math.floor(s.game.rng() * 4), s);
      emitMisc(s, 'lanceHit', t.pos.x, t.pos.z, { target: t });
    };
    for (const t of enemies(s)) if (segmentHitsHull(t, s.pos.x, s.pos.z, x1, z1, L.width / 2) >= 0) strike(t);
    // A buoy on the line takes the lance in and throws it out all round.
    for (const b of a.buoys) {
      const along = (b.x - s.pos.x) * forwardX(bearing) + (b.z - s.pos.z) * forwardZ(bearing);
      const across = Math.abs((b.x - s.pos.x) * forwardZ(bearing) - (b.z - s.pos.z) * forwardX(bearing));
      if (along < 0 || along > len || across > L.width / 2 + 30) continue;
      for (const t of enemies(s)) if (distToHull(t, b.x, b.z) <= L.buoy) strike(t);
      emitMisc(s, 'buoyFlare', b.x, b.z, { radius: L.buoy, n: 2 });
    }
  }
}

/** A buoy caught by a beam flares over everything round it; `mul` scales the hit. */
function flare(s: Ship, b: LensBuoy, mul: number): void {
  const B = PHAROS.buoy;
  const spec = skillOf(s, 'pharosBuoy');
  b.flaredAt = s.game.time;
  for (const t of enemies(s)) {
    if (distToHull(t, b.x, b.z) > B.radius) continue;
    if (spec) hurt(s, t, B.damage * mul, spec);
    gain(s, light(s, t, PHAROS.litTime), 1);
  }
  emitMisc(s, 'buoyFlare', b.x, b.z, { radius: B.radius, n: mul > 1 ? 2 : 1 });
}

/** One tick of light: ships the beams fall on are lit, fresh crossings count, buoys flare. */
function sweep(s: Ship, now: number): void {
  const a = state(s);
  const beams = pharosBeams(s);
  const day = dayActive(a, now);
  const scorching = a.scorchUntil > now;
  const counter = skillOf(s, 'pharosCounter');
  const dawn = skillOf(s, 'pharosDaybreak');
  for (const t of enemies(s)) {
    const caught = beams.length > 0 && beamCatches(s, t.pos.x, t.pos.z, hullPad(t), beams);
    const old = a.lit.find((r) => r.target === t.id);
    if (!caught) {
      if (old) old.inBeam = false;
      continue;
    }
    const r = light(s, t, PHAROS.litTime);
    if (!r.inBeam) {
      r.inBeam = true;
      if (scorching || now - r.gainedAt >= PHAROS.gainGap) {
        gain(s, r, 1);
        emitMisc(s, 'lit', t.pos.x, t.pos.z, { target: t, n: r.stacks });
      }
      if (scorching && counter) {
        hurt(s, t, PHAROS.counter.damage, counter);
        emitMisc(s, 'scorch', t.pos.x, t.pos.z, { target: t });
      }
    }
    if (day && !a.daybreak!.seared.includes(t.id)) {
      a.daybreak!.seared.push(t.id);
      if (dawn) hurt(s, t, pharosDamage.daybreak(r.stacks), dawn);
      t.startFire(Math.floor(s.game.rng() * 4), s);
      emitMisc(s, 'sear', t.pos.x, t.pos.z, { target: t });
    }
  }
  if (!beams.length) return;
  for (const b of a.buoys) if (now - b.flaredAt >= PHAROS.buoy.gap && beamCatches(s, b.x, b.z, 25, beams)) flare(s, b, day ? 2 : 1);
}

/** Hold the Light: ships kept in the beam burn, and gain Exposure every second. */
function holdTick(s: Ship, now: number): void {
  const a = state(s);
  const H = PHAROS.hold;
  const spec = skillOf(s, 'pharosHold');
  while (a.holdUntil > 0 && now >= a.holdNext - 1e-9 && a.holdNext <= a.holdUntil + 1e-9) {
    a.holdNext += H.tick;
    a.holdTicks++;
    for (const t of enemies(s)) {
      const r = litRecord(s, t);
      if (!r?.inBeam) continue;
      if (spec) hurt(s, t, H.burn * H.tick, spec);
      if (a.holdTicks % 2 === 0) gain(s, r, 1);
    }
  }
  if (a.holdUntil > 0 && now >= a.holdUntil) a.holdUntil = 0;
}

/** The false light: ships near it steer for it, and when it bursts they are on the rocks. */
function updateBeacon(s: Ship, now: number): void {
  const a = state(s);
  const beacon = a.beacon;
  if (!beacon) return;
  const F = PHAROS.falseLight;
  if (now >= beacon.until - 1e-9) {
    const spec = skillOf(s, 'pharosFalseLight');
    for (const t of enemies(s)) {
      if (distToHull(t, beacon.x, beacon.z) > F.radius) continue;
      if (spec) hurt(s, t, pharosDamage.falseLight(exposureOf(s, t)), spec);
    }
    emitMisc(s, 'wreck', beacon.x, beacon.z, { radius: F.radius });
    a.beacon = null;
    return;
  }
  for (const t of enemies(s)) {
    if (Math.hypot(t.pos.x - beacon.x, t.pos.z - beacon.z) > F.lure) continue;
    light(s, t, PHAROS.litTime);
    let l = beacon.lured.find((x) => x.target === t.id);
    if (!l) {
      l = { target: t.id, until: Math.min(beacon.until, now + ccTime(t, F.time)) };
      beacon.lured.push(l);
    }
    if (now >= l.until) continue;
    // The helm's fear runs from a point, so the point is the beacon mirrored through the hull.
    const fx = 2 * t.pos.x - beacon.x;
    const fz = 2 * t.pos.z - beacon.z;
    buff(t, 'debuff:fear', 0.12, (m) => {
      m.feared = true;
      m.fearX = fx;
      m.fearZ = fz;
    });
  }
}

export function updatePharos(s: Ship, dt: number): void {
  if (!s.pharos) return;
  if (!s.alive) {
    clearPharos(s);
    return;
  }
  const a = state(s);
  const now = s.game.time;
  for (const b of a.buoys) if (b.expiresAt <= now) emitMisc(s, 'buoyGone', b.x, b.z, { n: b.id });
  a.buoys = a.buoys.filter((b) => b.expiresAt > now);
  if (a.relightAt && now >= a.relightAt - 1e-9) {
    a.relightAt = 0;
    relight(s);
  }
  if (a.daybreak) {
    if (!a.daybreak.started && now >= a.daybreak.startAt - 1e-9) {
      a.daybreak.started = true;
      emitMisc(s, 'daybreak', s.pos.x, s.pos.z, { radius: PHAROS.daybreak.range });
    } else if (a.daybreak.started && now >= a.daybreak.until) a.daybreak = null;
  }
  // The lamp turns: onto the reticle while held, else round its sweep.
  if (a.holdUntil > now) a.bearing = approachAngle(a.bearing, bearingTo(s.pos.x, s.pos.z, s.control.aimX, s.control.aimZ), PHAROS.hold.slew * dt);
  else a.bearing = wrapAngle(a.bearing + sweepRate(s) * dt);
  if (a.lance && now >= a.lance.at - 1e-9) {
    const { bearings } = a.lance;
    a.lance = null;
    fireLance(s, bearings);
  }
  sweep(s, now);
  holdTick(s, now);
  updateBeacon(s, now);
  for (const r of a.lit) {
    while (r.stacks > 0 && r.until <= now && now >= r.decayAt) {
      r.stacks--;
      r.decayAt += PHAROS.decay;
    }
  }
  a.lit = a.lit.filter((r) => {
    if (r.stacks <= 0 && r.until <= now && r.dazzledUntil <= now && !r.inBeam) return false;
    const t = s.game.ships.find((x) => x.id === r.target);
    return !!t && t.alive && !t.withdrawn;
  });
}
