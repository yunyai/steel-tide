import { Vector3 } from 'three';
import { MAP_HALF } from '../../config';
import type { SkillSpec } from '../../core/types';
import { bearingTo, forwardX, forwardZ, segmentBox } from '../../core/math';
import { distToHull, segmentHitsHull } from '../../core/hull';
import { canTrack } from '../../core/Targeting';
import type { Ship } from '../../ships/Ship';
import { stun } from '../../weapons/StrikeSystem';
import { buff, hpFrac, hurt, mark } from '../kit';
import { safeStep } from './StepperRuntime';
import { CUBE, dockLift, HIT, SIGNATURE, TUNGSTEN_MODES, modeOf } from './TungstenModes';

export type CubeState = 'docked' | 'flying' | 'hover' | 'guard' | 'orbit' | 'meteor' | 'collapse' | 'broken';
export type CubePathKind = 'shot' | 'dock' | 'ricochet' | 'home';
/** Orders for hashing and the HUD. */
export const CUBE_STATES: readonly CubeState[] = ['docked', 'flying', 'hover', 'guard', 'orbit', 'meteor', 'collapse', 'broken'];
export const PATH_KINDS: readonly CubePathKind[] = ['shot', 'dock', 'ricochet', 'home'];

export interface CubePath {
  kind: CubePathKind;
  /** Kit index credited with the damage (-1 for none). */
  skill: number;
  tx: number;
  ty: number;
  tz: number;
  speed: number;
  /** Hulls struck and allies healed this pass. */
  hit: number[];
  healed: number[];
  dealt: number;
  /** Ricochet: ship id being chased, and bounces left. */
  target: number;
  bounces: number;
}

export interface Cube {
  id: number;
  mode: number;
  /** Overdrive cubes dissolve when it ends. */
  extra: boolean;
  /** Magnet slot: 0 the cradle, 1..5 the Overdrive ring. */
  slot: number;
  state: CubeState;
  x: number;
  y: number;
  z: number;
  /** Position at the previous sim step, for interpolated drawing. */
  px: number;
  py: number;
  pz: number;
  /** Rotation about the vertical (three.js rotation.y). */
  yaw: number;
  scale: number;
  hp: number;
  maxHp: number;
  /** Metres flown on the current path (Kinetic damage). */
  flown: number;
  /** Seconds until a broken cube re-forms. */
  reform: number;
  path: CubePath | null;
  /** Last strike time per ship, for the Overdrive orbit's contacts. */
  contacts: { id: number; at: number }[];
  gone: boolean;
}

export interface TungstenAct {
  kind: 'slam' | 'reel' | 'field';
  cube: number;
  skill: number;
  x: number;
  z: number;
  elapsed: number;
  time: number;
  radius: number;
  targets: number[];
}

export interface TungstenUlt {
  kind: 'collapse' | 'meteor';
  skill: number;
  x: number;
  z: number;
  elapsed: number;
  cubes: number[];
  /** Start position per cube (x, y, z), and the landing spot per cube (x, z). */
  from: number[];
  spots: number[];
  tick: number;
  stage: number;
  merged: boolean;
  /** Meteor: cubes that began to fall, and cubes that struck. */
  falls: number[];
  struck: number[];
}

export interface TungstenLunge {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  elapsed: number;
  time: number;
  hit: number[];
  cube: number;
}

export interface Tether {
  target: number;
  cube: number;
  skill: number;
  until: number;
  tick: number;
}

export interface TungstenState {
  mode: number;
  cubes: Cube[];
  nextCube: number;
  /** Damage stored by Shield, added to the next skill-driven cube hit. */
  charge: number;
  guardUntil: number;
  orbitAngle: number;
  lunge: TungstenLunge | null;
  tethers: Tether[];
  acts: TungstenAct[];
  ult: TungstenUlt | null;
  overdriveUntil: number;
  auraTick: number;
  /** Throwing energy, 0..1. A spent cube cannot be thrown until it docks or recharges in full. */
  energy: number;
  spent: boolean;
  surgeUntil: number;
  /** Seconds until the fire button may throw again. */
  reload: number;
}

const H = CUBE.edge / 2;
const KINETIC = modeOf('kinetic'),
  CRUSH = modeOf('crush'),
  SHARD = modeOf('shard'),
  REPEL = modeOf('repel'),
  TETHER = modeOf('tether'),
  MEND = modeOf('mend');
const tmp = new Vector3();
const smooth = (k: number) => k * k * (3 - 2 * k);
const gap = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

function newCube(id: number, mode: number, slot: number, extra: boolean): Cube {
  return {
    id,
    mode,
    extra,
    slot,
    state: 'docked',
    x: 0,
    y: 0,
    z: 0,
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    scale: 1,
    hp: CUBE.hp,
    maxHp: CUBE.hp,
    flown: 0,
    reform: 0,
    path: null,
    contacts: [],
    gone: false,
  };
}

export function newTungstenState(): TungstenState {
  return {
    mode: KINETIC,
    cubes: [newCube(1, KINETIC, 0, false)],
    nextCube: 2,
    charge: 0,
    guardUntil: 0,
    orbitAngle: 0,
    lunge: null,
    tethers: [],
    acts: [],
    ult: null,
    overdriveUntil: 0,
    auraTick: 0,
    energy: 1,
    spent: false,
    surgeUntil: 0,
    reload: 0,
  };
}

/** Back to one docked cube: sinking, respawn, withdrawal and the end of a battle. */
export function clearTungsten(s: Ship): void {
  const t = s.tungsten;
  if (!t) return;
  t.cubes = [t.cubes[0]];
  const c = t.cubes[0];
  Object.assign(c, { state: 'docked', path: null, hp: c.maxHp, scale: 1, reform: 0, flown: 0, contacts: [], mode: t.mode });
  dockPose(s, c);
  c.px = c.x;
  c.py = c.y;
  c.pz = c.z;
  t.charge = t.guardUntil = t.overdriveUntil = t.surgeUntil = t.reload = 0;
  t.energy = 1;
  t.spent = false;
  t.lunge = t.ult = null;
  t.tethers = [];
  t.acts = [];
}

export const primaryCube = (t: TungstenState): Cube => t.cubes[0];
export const overdriveOn = (s: Ship): boolean => (s.tungsten?.overdriveUntil ?? 0) > s.game.time;
const cubeById = (t: TungstenState, id: number) => t.cubes.find((c) => c.id === id) ?? null;
const shipById = (s: Ship, id: number) => s.game.ships.find((o) => o.id === id) ?? null;
/** Credited with thrown-cube hits: the cube is the Tungsten's main weapon, not a skill. */
export const CUBE_SHOT: SkillSpec = { id: 'tungstenCube', name: 'Tungsten cube', short: 'CUBE', description: 'A thrown cube striking a hull.', cooldown: 0, duration: 0, accent: 0x3ff0ff, icon: 'ram' };
const skillSpec = (s: Ship, i: number): SkillSpec => (i < 0 ? CUBE_SHOT : s.skills[i].spec);
const hostile = (s: Ship, o: Ship) => o.alive && o.team !== s.team && !o.deep && !o.mods.banished;
const foesNear = (s: Ship, x: number, z: number, r: number) => s.game.ships.filter((o) => hostile(s, o) && gap(o.pos.x, o.pos.z, x, z) <= r);
const busy = (c: Cube) => c.state === 'meteor' || c.state === 'collapse';
/** A cube on its way keeps the mode it was sent with: its hits, speed and fall were set by it. */
export const inFlight = (c: Cube) => c.state === 'flying' || busy(c);
/** Out under the magnet's hold, a wall on the water: hovering, guarding or orbiting. */
const parked = (c: Cube) => c.state === 'hover' || c.state === 'guard' || c.state === 'orbit';
/** Overdrive and Magnet Surge make throws free. */
const freeThrows = (s: Ship) => overdriveOn(s) || s.tungsten!.surgeUntil > s.game.time;

/**
 * AI: press fire to throw the cube at `target` once it can reach it, keeping the last throw in reserve so the
 * cube is never left spent; Overdrive and Surge cost nothing, so it throws freely then.
 */
export function aiThrows(s: Ship, target: Ship | null): boolean {
  const t = s.tungsten!,
    c = t.cubes[0];
  if (!target || t.spent || t.reload > 0 || !(c.state === 'docked' || c.state === 'hover')) return false;
  if (gap(c.x, c.z, target.pos.x, target.pos.z) > CUBE.shot.range - 100) return false;
  return freeThrows(s) || t.energy > CUBE.shot.cost + 0.02;
}

/** Centre height over water, or clear of the land beneath. */
export function hoverY(s: Ship, x: number, z: number, scale = 1): number {
  return Math.max(0, s.game.map.heightAt(x, z)) + CUBE.hoverY + H * (scale - 1);
}

/** Where a docked cube sits: floating over the dais, or in the Overdrive halo around and above it. */
export function dockPoint(s: Ship, slot: number, out = tmp): Vector3 {
  const lift = dockLift(s.spec);
  if (slot === 0) return s.localToWorld(0, lift, 0, out);
  const a = ((slot - 1) / 5) * Math.PI * 2 + s.game.time * CUBE.ringSpin;
  return s.localToWorld(Math.cos(a) * CUBE.ringRadius, lift + CUBE.ringLift, Math.sin(a) * CUBE.ringRadius, out);
}
/** A cube settles on the magnet; the cradle cube's arrival wakes a spent magnet. */
function seat(s: Ship, c: Cube): void {
  c.state = 'docked';
  c.path = null;
  dockPose(s, c);
  if (!c.extra) s.tungsten!.spent = false;
}
function dockPose(s: Ship, c: Cube): void {
  const p = dockPoint(s, c.slot);
  c.x = p.x;
  c.y = p.y;
  c.z = p.z;
  // Turning on the sim's clock, so a cube leaves the dais at the angle it was drawn at.
  c.yaw = -s.heading + s.game.time * CUBE.spin;
}

/** Modes whose passives run: the cube's while it holds together; every living cube's in Overdrive. */
export function passiveModes(s: Ship): number[] {
  const t = s.tungsten;
  if (!t) return [];
  const live = overdriveOn(s) ? t.cubes : [t.cubes[0]];
  return [...new Set(live.filter((c) => c.state !== 'broken' && !c.gone).map((c) => c.mode))];
}
function auraCubes(s: Ship): Cube[] {
  const t = s.tungsten!;
  return (overdriveOn(s) ? t.cubes : [t.cubes[0]]).filter((c) => c.state !== 'broken' && !c.gone);
}

export function applyTungstenPassives(s: Ship, m: Ship['mods']): void {
  for (const mode of passiveModes(s)) {
    if (mode === KINETIC) {
      m.speedMul *= 1.15;
      m.accelMul *= 1.15;
      m.cooldownMul *= 0.85;
    } else if (mode === REPEL) m.damageTakenMul *= 0.88;
  }
  if (s.tungsten?.cubes.some((c) => c.state === 'orbit')) m.damageTakenMul *= CUBE.orbit.taken;
}

function emit(s: Ship, kind: import('../../core/Events').TungstenEventKind, c: Cube | null, x: number, y: number, z: number, radius = 0, target?: Ship, mode = c?.mode ?? s.tungsten!.mode): void {
  s.game.events.emit('tungsten', { ship: s, kind, cube: c?.id ?? 0, x, y, z, radius, mode, target });
}

/** Holds a hull moving toward (x, z) at `speed` or more until it is `stop` metres away. Mass does not matter to the magnet. */
function drag(o: Ship, x: number, z: number, speed: number, stop: number): void {
  if (o.trait?.knockImmune || o.mods.knockImmune || o.mods.banished) return;
  const dx = x - o.pos.x,
    dz = z - o.pos.z,
    d = Math.hypot(dx, dz);
  if (d <= stop) return;
  const ux = dx / d,
    uz = dz / d;
  const v = Math.min(speed, (d - stop) * 4);
  const along = o.pushX * ux + o.pushZ * uz;
  if (along < v) {
    o.pushX += ux * (v - along);
    o.pushZ += uz * (v - along);
  }
}

function knockTurrets(s: Ship, o: Ship, count: number, time: number): void {
  const pool = o.turrets.map((_, i) => i);
  for (let k = 0; k < count && pool.length; k++) {
    const i = pool.splice(Math.floor(s.game.rng() * pool.length), 1)[0];
    o.turrets[i].disabled = Math.max(o.turrets[i].disabled, time);
  }
}

function tether(s: Ship, c: Cube, o: Ship, skill: number): void {
  const t = s.tungsten!;
  const until = s.game.time + HIT.tether.time;
  const old = t.tethers.find((x) => x.target === o.id);
  if (old) Object.assign(old, { cube: c.id, skill, until });
  else t.tethers.push({ target: o.id, cube: c.id, skill, until, tick: 0 });
  // The chain takes over from the Tether aura's drag rather than stacking on it.
  o.effects = o.effects.filter((e) => e.id !== 'debuff:tungstenDrag');
  buff(o, 'debuff:tungstenChain', CUBE.aura.life, (m) => {
    m.speedMul *= HIT.tether.slow;
  });
}

/**
 * The one place cube damage happens. `body` hits (the cube itself striking a hull) take the mode's damage
 * factor and its hit effect; every skill-driven hit spends the Shield store on the first enemy it reaches.
 */
export function cubeHit(owner: Ship, c: Cube, target: Ship, base: number, spec: SkillSpec, body: boolean, spend = true): number {
  const t = owner.tungsten!;
  const mode = TUNGSTEN_MODES[c.mode];
  let amount = base;
  if (body) {
    amount *= mode.damage;
    // A Kinetic cube gains with the distance it flew.
    if (c.mode === KINETIC && c.path) amount *= 1 + HIT.kinetic.bonus * Math.min(1, c.flown / HIT.kinetic.full);
  }
  const core = amount;
  let dealt = hurt(owner, target, amount, spec);
  if (spend && t.charge > 0) {
    dealt += target.takeDamage(t.charge * owner.mods.damageMul, owner, spec);
    t.charge = 0;
  }
  if (body) {
    if (c.mode === CRUSH) stun(target, HIT.crush.stun);
    else if (c.mode === SHARD) {
      knockTurrets(owner, target, 1, HIT.shard.out);
      for (const o of foesNear(owner, target.pos.x, target.pos.z, HIT.shard.radius))
        if (o !== target) {
          hurt(owner, o, core * HIT.shard.splash, spec);
          knockTurrets(owner, o, 1, HIT.shard.out);
        }
    } else if (c.mode === REPEL) {
      let dx = target.pos.x - c.x,
        dz = target.pos.z - c.z,
        d = Math.hypot(dx, dz);
      if (d < 1) {
        dx = forwardX(target.heading);
        dz = forwardZ(target.heading);
        d = 1;
      }
      target.shove((dx / d) * HIT.repel.knock * 1.5, (dz / d) * HIT.repel.knock * 1.5);
    } else if (c.mode === TETHER) tether(owner, c, target, owner.skills.findIndex((x) => x.spec === spec));
    else if (c.mode === MEND) owner.heal(dealt * HIT.mend.lifesteal);
  }
  if (passiveModes(owner).includes(CRUSH)) mark(target, HIT.crush.mark);
  emit(owner, 'hit', c, target.pos.x, c.y, target.pos.z, 0, target);
  return dealt;
}

/** Cube damage from enemy fire. A shattered cube re-forms on the magnet. */
export function damageCube(owner: Ship, c: Cube, amount: number, _attacker: Ship | null): void {
  if (c.state === 'broken' || c.gone || amount <= 0) return;
  c.hp -= amount;
  if (c.hp > 0) return;
  c.hp = 0;
  c.state = 'broken';
  c.path = null;
  c.scale = 1;
  c.reform = CUBE.reform;
  const t = owner.tungsten!;
  t.tethers = t.tethers.filter((x) => x.cube !== c.id);
  emit(owner, 'break', c, c.x, c.y, c.z, H);
}

export interface CubeHitInfo {
  owner: Ship;
  cube: Cube;
  /** Fraction along the projectile's segment. */
  t: number;
  /** Caught by Shield's field rather than struck by the cube. */
  capture: boolean;
}
export type CubeProjectile = 'shell' | 'missile' | 'beam' | 'torpedo';

/**
 * The first enemy cube a projectile's step from (ox, oy, oz) to (x, y, z) meets: the cube's yawed box for
 * shells, missiles and beams, and Shield's capture field (which also takes torpedoes).
 */
export function cubeIntercept(game: Ship['game'], team: number, ox: number, oy: number, oz: number, x: number, y: number, z: number, kind: CubeProjectile): CubeHitInfo | null {
  let best: CubeHitInfo | null = null;
  const dx = x - ox,
    dy = y - oy,
    dz = z - oz;
  const len2 = dx * dx + dz * dz;
  for (const s of game.ships) {
    const t = s.tungsten;
    if (!t || !s.alive || s.team === team) continue;
    for (const c of t.cubes) {
      if (c.gone || !(c.state === 'flying' || parked(c))) continue;
      const h = H * c.scale;
      if (c.state === 'guard' || c.state === 'orbit') {
        const F = c.state === 'orbit' ? { radius: CUBE.orbit.field, repel: CUBE.orbit.repelField } : { radius: CUBE.guard.radius, repel: CUBE.guard.repelRadius };
        const r = c.mode === REPEL ? F.repel : F.radius;
        const k = len2 > 1e-9 ? Math.max(0, Math.min(1, ((c.x - ox) * dx + (c.z - oz) * dz) / len2)) : 0;
        const py = oy + dy * k;
        if (gap(ox + dx * k, oz + dz * k, c.x, c.z) <= r && py <= 600 && (!best || k < best.t)) {
          best = { owner: s, cube: c, t: k, capture: true };
          continue;
        }
      }
      if (kind === 'torpedo') continue;
      const reach = Math.sqrt(len2) / 2 + h * 1.8;
      if (gap((ox + x) / 2, (oz + z) / 2, c.x, c.z) > reach) continue;
      const cs = Math.cos(c.yaw),
        sn = Math.sin(c.yaw);
      const ax = ox - c.x,
        az = oz - c.z;
      const lx = ax * cs - az * sn,
        lz = ax * sn + az * cs;
      const hit = segmentBox(lx, oy - c.y, lz, dx * cs - dz * sn, dy, dx * sn + dz * cs, [-h, -h, -h], [h, h, h]);
      if (hit && (!best || hit.t < best.t)) best = { owner: s, cube: c, t: hit.t, capture: false };
    }
  }
  return best;
}

/** A projectile met a cube: Shield stores captured damage and takes a quarter of it; otherwise the cube takes it all. */
export function absorbCube(hit: CubeHitInfo, damage: number, attacker: Ship | null, x: number, y: number, z: number): void {
  const t = hit.owner.tungsten!;
  if (hit.capture) {
    // A store kept from Overdrive stays over the plain cap; it just takes no more.
    t.charge = Math.max(t.charge, Math.min(CUBE.chargeCap * (overdriveOn(hit.owner) ? CUBE.orbit.cap : 1), t.charge + damage));
    damageCube(hit.owner, hit.cube, damage * CUBE.guard.taken, attacker);
    emit(hit.owner, 'capture', hit.cube, x, y, z, damage);
  } else {
    damageCube(hit.owner, hit.cube, damage, attacker);
    emit(hit.owner, 'block', hit.cube, x, y, z, damage);
  }
}

function newPath(kind: CubePathKind, skill: number, tx: number, ty: number, tz: number, speed: number): CubePath {
  return { kind, skill, tx, ty, tz, speed, hit: [], healed: [], dealt: 0, target: 0, bounces: 0 };
}
function sendHome(s: Ship, c: Cube, kind: 'dock' | 'home', skill = -1): void {
  const p = dockPoint(s, c.slot);
  c.state = 'flying';
  c.flown = 0;
  c.path = newPath(kind, skill, p.x, p.y, p.z, CUBE.dock.speed * TUNGSTEN_MODES[c.mode].speed);
}

/** Cubes a command drives: the cube itself, or every free cube in Overdrive. */
function driven(s: Ship): Cube[] {
  const t = s.tungsten!;
  return overdriveOn(s) ? t.cubes.filter((c) => !c.gone && c.state !== 'broken' && !busy(c)) : [t.cubes[0]];
}
function cubeReady(s: Ship, name: string): boolean {
  const c = s.tungsten!.cubes[0];
  if (overdriveOn(s) && driven(s).length) return true;
  if (c.state === 'broken') return s.failSkill(`${name}: the cube is re-forming`);
  if (busy(c)) return s.failSkill(`${name}: the cube is busy`);
  return true;
}

/**
 * The fire button hurls the cube (every free cube in Overdrive, abreast) at the reticle, up to `CUBE.shot.range`
 * from where it is. It tumbles there, ploughing through every hull in its way, and hovers. Each throw spends
 * energy unless throws are free; the throw that empties it leaves the cube spent where it lands. False when
 * nothing was thrown: every cube already over its spot, or land in the way.
 */
function throwCubes(s: Ship): boolean {
  const t = s.tungsten!;
  const cubes = driven(s).filter((c) => c.state === 'docked' || c.state === 'hover');
  const b = bearingTo(s.pos.x, s.pos.z, s.control.aimX, s.control.aimZ);
  // Across the line of the throw.
  const rx = Math.cos(b),
    rz = Math.sin(b);
  const boost = t.surgeUntil > s.game.time ? CUBE.surge.speed : 1;
  let thrown = 0,
    blocked = false;
  cubes.forEach((c, i) => {
    const off = (i - (cubes.length - 1) / 2) * CUBE.shot.spread;
    const ax = s.control.aimX + rx * off,
      az = s.control.aimZ + rz * off;
    const d = gap(c.x, c.z, ax, az);
    if (d < 100) return;
    const ux = (ax - c.x) / d,
      uz = (az - c.z) / d;
    let reach = Math.min(d, CUBE.shot.range);
    // It hovers over the last clear water short of an island; a cube already over land may cross to water.
    let wet = s.game.map.heightAt(c.x, c.z) < -2;
    for (let a = 30; a <= reach; a += 30) {
      const px = c.x + ux * a,
        pz = c.z + uz * a;
      const land = s.game.map.heightAt(px, pz) > -2 || Math.abs(px) > MAP_HALF - 200 || Math.abs(pz) > MAP_HALF - 200;
      if (!land) wet = true;
      else if (wet) {
        reach = Math.max(0, a - (H + 20));
        break;
      }
    }
    if (reach < 100) {
      blocked = true;
      return;
    }
    const x = c.x + ux * reach,
      z = c.z + uz * reach;
    c.state = 'flying';
    c.flown = 0;
    c.path = newPath('shot', -1, x, hoverY(s, x, z), z, CUBE.shot.speed * TUNGSTEN_MODES[c.mode].speed * boost);
    emit(s, 'throw', c, c.x, c.y, c.z);
    thrown++;
  });
  if (!thrown) return blocked && s.failSkill('Tungsten cube: land in the way');
  if (!freeThrows(s)) {
    t.energy = Math.max(0, t.energy - CUBE.shot.cost);
    t.spent = t.energy <= 0;
  }
  return true;
}

// ---- Skills ------------------------------------------------------------------------------------

export function lungeToCube(s: Ship, skill: number): boolean {
  const t = s.tungsten!;
  const c = t.cubes[0];
  if (c.state === 'docked') return s.failSkill('Magnet Lunge: throw the cube first');
  if (c.state === 'broken') return s.failSkill('Magnet Lunge: the cube is re-forming');
  if (c.state !== 'hover') return s.failSkill('Magnet Lunge: the cube must be hovering');
  const d = gap(s.pos.x, s.pos.z, c.x, c.z);
  if (d > CUBE.lunge.range) return s.failSkill('Magnet Lunge: the cube is beyond 4 km');
  const h = bearingTo(s.pos.x, s.pos.z, c.x, c.z);
  const fx = forwardX(h),
    fz = forwardZ(h);
  const reach = d - (s.spec.length / 2 + H + 40);
  const at = (a: number) => [s.pos.x + fx * a, s.pos.z + fz * a] as const;
  // The corridor runs through enemy hulls (they take the hit) but not land or allies.
  let clear = 0;
  for (let a = 40; a < reach; a += 40) {
    if (!safeStep(s, ...at(a), h, true)) break;
    clear = a;
  }
  if (clear + 40 >= reach && safeStep(s, ...at(reach), h, true)) clear = reach;
  let land = -1;
  for (let a = clear; a >= CUBE.lunge.minDistance; a -= 40)
    if (safeStep(s, ...at(a), h)) {
      land = a;
      break;
    }
  if (land < 0) return s.failSkill('Magnet Lunge: no clear water toward the cube');
  const [x1, z1] = at(land);
  t.lunge = { x0: s.pos.x, z0: s.pos.z, x1, z1, elapsed: 0, time: land / CUBE.lunge.speed, hit: [], cube: c.id };
  c.state = 'hover';
  s.heading = s.prevHeading = s.renderHeading = h;
  t.guardUntil = Math.min(t.guardUntil, s.game.time);
  emit(s, 'lunge', c, s.pos.x, 0, s.pos.z, land);
  void skill;
  return true;
}

export function switchMode(s: Ship): boolean {
  const t = s.tungsten!;
  if (overdriveOn(s)) return s.failSkill('Switch: every mode is live during Overdrive');
  const c = t.cubes[0];
  if (inFlight(c)) return s.failSkill('Switch: the cube is in flight');
  t.mode = (t.mode + 1) % TUNGSTEN_MODES.length;
  c.mode = t.mode;
  emit(s, 'switch', c, c.x, c.y, c.z);
  return true;
}

/** Magnet Surge: full energy wherever the cube is, waking a spent one, and an overcharge for its throws. */
export function surge(s: Ship): boolean {
  if (!cubeReady(s, 'Magnet Surge')) return false;
  const t = s.tungsten!;
  t.energy = 1;
  t.spent = false;
  t.surgeUntil = s.game.time + CUBE.surge.time;
  const c = t.cubes[0];
  emit(s, 'surge', c, c.x, c.y, c.z);
  return true;
}

export function dockCubes(s: Ship, skill: number): boolean {
  const t = s.tungsten!;
  const pool = overdriveOn(s) ? t.cubes : [t.cubes[0]];
  const out = pool.filter((c) => !c.gone && c.state !== 'docked' && c.state !== 'broken' && !busy(c) && !(c.path && (c.path.kind === 'dock' || c.path.kind === 'home')));
  if (!out.length) {
    const c = t.cubes[0];
    return s.failSkill(c.state === 'broken' ? 'Dock: the cube is re-forming' : busy(c) ? 'Dock: the cube is busy' : c.state === 'docked' ? 'Dock: the cube is already docked' : 'Dock: the cube is already on its way');
  }
  for (const c of out) {
    sendHome(s, c, 'dock', skill);
    emit(s, 'throw', c, c.x, c.y, c.z);
  }
  return true;
}

export function signature(s: Ship, skill: number): boolean {
  if (!cubeReady(s, 'Signature')) return false;
  const g = s.game;
  const spec = skillSpec(s, skill);
  let fired = 0;
  for (const c of driven(s)) {
    const sig = TUNGSTEN_MODES[c.mode].signature;
    if (c.mode === KINETIC) {
      const first = nextTarget(s, c, SIGNATURE.ricochet.reach, 0);
      if (!first) continue;
      c.state = 'flying';
      c.flown = 0;
      c.path = newPath('ricochet', skill, first.pos.x, hoverY(s, first.pos.x, first.pos.z), first.pos.z, SIGNATURE.ricochet.speed * TUNGSTEN_MODES[c.mode].speed);
      c.path.target = first.id;
      c.path.bounces = SIGNATURE.ricochet.bounces;
    } else if (c.mode === CRUSH || c.mode === TETHER) {
      const reel = c.mode === TETHER;
      const targets = reel ? foesNear(s, c.x, c.z, sig.radius).map((o) => o.id) : [];
      s.tungsten!.acts.push({ kind: reel ? 'reel' : 'slam', cube: c.id, skill, x: c.x, z: c.z, elapsed: 0, time: reel ? SIGNATURE.reel.time : SIGNATURE.slam.time, radius: sig.radius, targets });
    } else if (c.mode === SHARD) {
      for (const o of foesNear(s, c.x, c.z, sig.radius)) {
        cubeHit(s, c, o, SIGNATURE.storm.damage, spec, false);
        knockTurrets(s, o, SIGNATURE.storm.turrets, SIGNATURE.storm.out);
      }
    } else if (c.mode === REPEL) {
      for (const o of foesNear(s, c.x, c.z, sig.radius)) {
        cubeHit(s, c, o, SIGNATURE.repulse.damage, spec, false);
        const d = Math.max(1, gap(o.pos.x, o.pos.z, c.x, c.z));
        o.shove(((o.pos.x - c.x) / d) * SIGNATURE.repulse.knock * 1.5, ((o.pos.z - c.z) / d) * SIGNATURE.repulse.knock * 1.5);
      }
      repulse(s, c.x, c.z, sig.radius);
    } else if (c.mode === MEND) {
      for (const o of g.ships) if (o !== s && o.alive && o.team === s.team && gap(o.pos.x, o.pos.z, c.x, c.z) <= sig.radius) o.heal(o.maxHp * SIGNATURE.restore.allies);
      s.heal(s.maxHp * SIGNATURE.restore.ship);
    }
    emit(s, 'signature', c, c.x, c.y, c.z, sig.radius);
    fired++;
  }
  return fired > 0 || s.failSkill('Ricochet: no enemy within 2 km of the cube');
}

/** Enemy shells, missiles and torpedoes within `r` of (x, z) are torn apart. */
function repulse(s: Ship, x: number, z: number, r: number): void {
  const g = s.game;
  for (const p of g.shells.shells)
    if (p.alive && p.team !== s.team && gap(p.x, p.z, x, z) <= r) {
      p.alive = false;
      g.events.emit('intercept', { x: p.x, y: p.y, z: p.z });
    }
  for (const m of g.missiles.missiles) if (m.alive && m.team !== s.team && gap(m.x, m.z, x, z) <= r) g.missiles.kill(m);
  for (const p of g.torps.torps)
    if (p.alive && p.team !== s.team && gap(p.x, p.z, x, z) <= r) {
      p.alive = false;
      g.events.emit('explosion', { x: p.x, y: 0, z: p.z, size: 0.6 });
    }
}

function nextTarget(s: Ship, c: Cube, r: number, skip: number): Ship | null {
  let best: Ship | null = null,
    bd = r;
  for (const o of s.game.ships) {
    if (o.id === skip || !hostile(s, o) || !canTrack(s, o)) continue;
    const d = gap(o.pos.x, o.pos.z, c.x, c.z);
    if (d <= bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export function raiseShield(s: Ship, _skill: number): boolean {
  if (!cubeReady(s, 'Tungsten Shield')) return false;
  const t = s.tungsten!;
  const orbit = overdriveOn(s);
  for (const c of driven(s)) {
    c.state = orbit ? 'orbit' : 'guard';
    c.path = null;
    c.contacts = [];
  }
  t.guardUntil = s.game.time + (orbit ? CUBE.orbit.time : CUBE.guard.time);
  const c = t.cubes[0];
  emit(s, 'shield', c, s.pos.x, 0, s.pos.z, orbit ? CUBE.orbit.radius : CUBE.guard.radius);
  return true;
}

function beginUlt(s: Ship, kind: 'collapse' | 'meteor', skill: number, range: number): boolean {
  const t = s.tungsten!;
  if (t.ult) return s.failSkill('The cube is busy');
  if (!cubeReady(s, kind === 'collapse' ? 'Collapse' : 'Tungsten Meteor')) return false;
  const cubes = driven(s).filter((c) => c.state !== 'broken');
  if (!cubes.length) return s.failSkill('The cube is re-forming');
  const d = gap(s.pos.x, s.pos.z, s.control.aimX, s.control.aimZ);
  const k = d > range ? range / d : 1;
  const x = s.pos.x + (s.control.aimX - s.pos.x) * k,
    z = s.pos.z + (s.control.aimZ - s.pos.z) * k;
  const n = cubes.length;
  const spots = cubes.flatMap((_, i) => {
    if (kind === 'collapse' || n === 1) return [x, z];
    const a = (i / n) * Math.PI * 2;
    return [x + Math.cos(a) * CUBE.meteor.ring, z + Math.sin(a) * CUBE.meteor.ring];
  });
  t.ult = { kind, skill, x, z, elapsed: 0, cubes: cubes.map((c) => c.id), from: cubes.flatMap((c) => [c.x, c.y, c.z]), spots, tick: 0, stage: 0, merged: n > 1, falls: [], struck: [] };
  t.guardUntil = Math.min(t.guardUntil, s.game.time);
  for (const c of cubes) {
    c.state = kind;
    c.path = null;
  }
  emit(s, kind === 'collapse' ? 'collapse' : 'meteorRise', cubes[0], x, 0, z, kind === 'collapse' ? CUBE.collapse.radius : CUBE.meteor.radius);
  return true;
}
export const collapse = (s: Ship, skill: number) => beginUlt(s, 'collapse', skill, CUBE.collapse.range);
export const meteor = (s: Ship, skill: number) => beginUlt(s, 'meteor', skill, CUBE.meteor.range);

export function overdrive(s: Ship): boolean {
  if (overdriveOn(s)) return s.failSkill('Overdrive: already running');
  const t = s.tungsten!;
  t.cubes = t.cubes.filter((c) => !c.extra);
  t.overdriveUntil = s.game.time + CUBE.overdrive.time;
  t.energy = 1;
  t.spent = false;
  let slot = 1;
  for (let m = 0; m < TUNGSTEN_MODES.length; m++) {
    if (m === t.mode) continue;
    const c = newCube(t.nextCube++, m, slot++, true);
    dockPose(s, c);
    c.px = c.x;
    c.py = c.y;
    c.pz = c.z;
    t.cubes.push(c);
  }
  emit(s, 'overdrive', t.cubes[0], s.pos.x, 0, s.pos.z, CUBE.ringRadius);
  return true;
}

// ---- Simulation step ---------------------------------------------------------------------------

export function updateTungsten(s: Ship, dt: number): void {
  const t = s.tungsten;
  if (!t) return;
  for (const c of t.cubes) {
    c.px = c.x;
    c.py = c.y;
    c.pz = c.z;
  }
  if (!s.alive) return;
  const g = s.game;
  if (t.overdriveUntil > 0 && g.time >= t.overdriveUntil) {
    t.overdriveUntil = 0;
    emit(s, 'overdriveEnd', t.cubes[0], s.pos.x, 0, s.pos.z);
  }
  if (t.lunge) stepLunge(s, t, dt);
  if (t.ult?.kind === 'collapse') stepCollapse(s, t, dt);
  else if (t.ult?.kind === 'meteor') stepMeteor(s, t, dt);
  fire(s, t, dt);
  for (const c of t.cubes) stepCube(s, t, c, dt);
  if (!t.overdriveUntil)
    for (const c of t.cubes) {
      if (!c.extra) continue;
      if (c.state === 'docked' || c.state === 'broken') c.gone = true;
      else if (parked(c)) sendHome(s, c, 'home');
    }
  if (t.cubes.some((c) => c.gone)) {
    t.cubes = t.cubes.filter((c) => !c.gone);
    t.tethers = t.tethers.filter((x) => cubeById(t, x.cube));
  }
  stepTethers(s, t, dt);
  stepActs(s, t, dt);
  t.auraTick -= dt;
  if (t.auraTick <= 0) {
    t.auraTick += CUBE.aura.every;
    for (const c of auraCubes(s)) {
      if (c.mode !== SHARD && c.mode !== TETHER) continue;
      for (const o of foesNear(s, c.x, c.z, CUBE.aura.radius)) {
        if (c.mode === SHARD)
          buff(o, 'debuff:tungstenScatter', CUBE.aura.life, (m) => {
            m.dispersionMul *= 1.25;
          });
        else if (!t.tethers.some((x) => x.target === o.id))
          buff(o, 'debuff:tungstenDrag', CUBE.aura.life, (m) => {
            m.speedMul *= 0.85;
          });
      }
    }
  }
  if (passiveModes(s).includes(MEND)) s.heal(s.maxHp * HIT.mend.regen * dt);
}

function stepLunge(s: Ship, t: TungstenState, dt: number): void {
  const L = t.lunge!;
  L.elapsed += dt;
  const f = L.time > 0 ? Math.min(1, L.elapsed / L.time) : 1;
  const ox = s.pos.x,
    oz = s.pos.z;
  s.pos.x = L.x0 + (L.x1 - L.x0) * f;
  s.pos.z = L.z0 + (L.z1 - L.z0) * f;
  const spec = skillSpec(s, 0);
  for (const o of s.game.ships)
    if (hostile(s, o) && !L.hit.includes(o.id) && segmentHitsHull(o, ox, oz, s.pos.x, s.pos.z, s.spec.beam / 2) >= 0) {
      L.hit.push(o.id);
      hurt(s, o, CUBE.lunge.damage, spec);
    }
  if (f < 1) return;
  t.lunge = null;
  const c = cubeById(t, L.cube);
  emit(s, 'arrive', c, s.pos.x, 0, s.pos.z);
  if (!c || c.state !== 'hover') return;
  if (gap(c.x, c.z, s.pos.x, s.pos.z) < 400 + s.spec.length / 2) {
    seat(s, c);
    emit(s, 'dock', c, c.x, c.y, c.z);
  } else sendHome(s, c, 'home');
}

function stepCube(s: Ship, t: TungstenState, c: Cube, dt: number): void {
  const g = s.game;
  switch (c.state) {
    case 'docked':
      dockPose(s, c);
      c.hp = Math.min(c.maxHp, c.hp + c.maxHp * CUBE.dockRepair * dt);
      return;
    case 'broken':
      c.reform -= dt;
      if (c.reform <= 0) {
        seat(s, c);
        c.hp = c.maxHp;
        c.reform = 0;
        c.px = c.x;
        c.py = c.y;
        c.pz = c.z;
        emit(s, 'reform', c, c.x, c.y, c.z, H);
      }
      return;
    case 'flying':
      stepPath(s, t, c, dt);
      return;
    case 'hover': {
      // Turning slowly where it hovers; a spent cube sinks to rest low in the water.
      c.yaw += CUBE.spin * dt;
      const rest = t.spent && !c.extra ? Math.max(0, g.map.heightAt(c.x, c.z)) + H * c.scale - CUBE.energy.sink : hoverY(s, c.x, c.z, c.scale);
      c.y += Math.max(-60 * dt, Math.min(60 * dt, rest - c.y));
      break;
    }
    case 'guard': {
      if (g.time >= t.guardUntil) return sendHome(s, c, 'home');
      const b = bearingTo(s.pos.x, s.pos.z, s.control.aimX, s.control.aimZ);
      const r = s.spec.length / 2 + CUBE.guard.offset;
      moveToward(s, c, s.pos.x + forwardX(b) * r, s.pos.z + forwardZ(b) * r, CUBE.guard.speed * dt);
      c.yaw = -b;
      break;
    }
    case 'orbit': {
      if (g.time >= t.guardUntil) return sendHome(s, c, 'home');
      const ring = t.cubes.filter((x) => x.state === 'orbit');
      const i = ring.indexOf(c);
      if (i === 0) t.orbitAngle += CUBE.orbit.rate * dt;
      const a = t.orbitAngle + (i / ring.length) * Math.PI * 2;
      moveToward(s, c, s.pos.x + Math.cos(a) * CUBE.orbit.radius, s.pos.z + Math.sin(a) * CUBE.orbit.radius, CUBE.guard.speed * dt);
      c.yaw = -a;
      const spec = skillSpec(s, 5);
      for (const o of g.ships) {
        if (!hostile(s, o) || distToHull(o, c.x, c.z) > H * 1.2 + 20 || !due(c, o.id, CUBE.orbit.every, g.time)) continue;
        cubeHit(s, c, o, CUBE.orbit.damage, spec, false, false);
        const d = Math.max(1, gap(o.pos.x, o.pos.z, s.pos.x, s.pos.z));
        o.shove(((o.pos.x - s.pos.x) / d) * CUBE.orbit.knock * 1.5, ((o.pos.z - s.pos.z) / d) * CUBE.orbit.knock * 1.5);
        emit(s, 'contact', c, c.x, c.y, c.z, 0, o);
      }
      break;
    }
    default:
      return;
  }
  // A parked cube is a wall: enemy hulls are eased out of its footprint.
  const h = H * c.scale * 1.2;
  for (const o of g.ships) {
    if (!hostile(s, o)) continue;
    const d = distToHull(o, c.x, c.z);
    if (d >= h) continue;
    let ux = o.pos.x - c.x,
      uz = o.pos.z - c.z;
    const n = Math.hypot(ux, uz);
    if (n < 1) {
      ux = Math.cos(o.heading);
      uz = Math.sin(o.heading);
    } else {
      ux /= n;
      uz /= n;
    }
    const push = Math.min(h - d, CUBE.shoveSpeed * dt);
    o.pos.x += ux * push;
    o.pos.z += uz * push;
  }
}

/** Whether `id` may be struck (or healed) again by this cube; records the contact if so. */
function due(c: Cube, id: number, every: number, now: number): boolean {
  const last = c.contacts.find((k) => k.id === id);
  if (last && now - last.at < every) return false;
  if (last) last.at = now;
  else c.contacts.push({ id, at: now });
  return true;
}

/** The fire button throws once per reload while held; otherwise the magnet recharges, slowly out and fast docked. */
function fire(s: Ship, t: TungstenState, dt: number): void {
  t.reload = Math.max(0, t.reload - dt);
  const held = s.control.fire && s.currentSlot?.kind === 'cube' && !s.mods.stunned && !s.mods.disarmed && !t.lunge && !t.spent;
  if (held && t.reload <= 0 && throwCubes(s)) {
    t.reload = CUBE.shot.reload;
    return;
  }
  t.energy = Math.min(1, t.energy + (t.cubes[0].state === 'docked' ? CUBE.energy.dockRegen : CUBE.energy.regen) * dt);
  if (t.spent && t.energy >= 1) {
    t.spent = false;
    const c = t.cubes[0];
    emit(s, 'charged', c, c.x, c.y, c.z);
  }
}

function moveToward(s: Ship, c: Cube, x: number, z: number, step: number): void {
  const d = gap(c.x, c.z, x, z);
  const f = d <= step ? 1 : step / d;
  c.x += (x - c.x) * f;
  c.z += (z - c.z) * f;
  c.y = hoverY(s, c.x, c.z, c.scale);
}

function stepPath(s: Ship, t: TungstenState, c: Cube, dt: number): void {
  const p = c.path!;
  const g = s.game;
  if (p.kind === 'dock' || p.kind === 'home') {
    const d = dockPoint(s, c.slot);
    p.tx = d.x;
    p.ty = d.y;
    p.tz = d.z;
  } else if (p.kind === 'ricochet') {
    const o = shipById(s, p.target);
    if (!o || !hostile(s, o)) return land(s, c);
    const lead = gap(c.x, c.z, o.pos.x, o.pos.z) / p.speed;
    p.tx = o.pos.x + forwardX(o.heading) * o.speed * lead;
    p.tz = o.pos.z + forwardZ(o.heading) * o.speed * lead;
    p.ty = hoverY(s, p.tx, p.tz);
  }
  const dx = p.tx - c.x,
    dy = p.ty - c.y,
    dz = p.tz - c.z;
  const d = Math.hypot(dx, dy, dz);
  const step = p.speed * dt;
  const f = d <= step ? 1 : step / d;
  const ox = c.x,
    oz = c.z;
  c.x += dx * f;
  c.y += dy * f;
  c.z += dz * f;
  c.flown += Math.min(step, d);
  if (Math.hypot(c.x - ox, c.z - oz) > 1e-6) c.yaw = -bearingTo(ox, oz, c.x, c.z);
  if (p.kind !== 'home') {
    const spec = skillSpec(s, p.skill);
    const h = H * c.scale;
    for (const o of g.ships) {
      if (!hostile(s, o) || p.hit.includes(o.id) || (p.kind === 'ricochet' && o.id !== p.target)) continue;
      const k = segmentHitsHull(o, ox, oz, c.x, c.z, h);
      if (k < 0) continue;
      p.hit.push(o.id);
      const base = p.kind === 'ricochet' ? SIGNATURE.ricochet.damage : p.kind === 'dock' ? CUBE.dock.damage : CUBE.shot.damage * (t.surgeUntil > g.time ? CUBE.surge.damage : 1);
      p.dealt += cubeHit(s, c, o, base, spec, true);
      if (p.kind === 'ricochet') {
        p.bounces--;
        const next = p.bounces > 0 ? nextTarget(s, c, SIGNATURE.ricochet.hop, o.id) : null;
        if (!next) return land(s, c);
        p.target = next.id;
        p.hit = [];
        return;
      }
      // A Crush cube stops on the first hull it meets.
      if (p.kind === 'shot' && TUNGSTEN_MODES[c.mode].stops) {
        c.x = ox + (c.x - ox) * k;
        c.z = oz + (c.z - oz) * k;
        return land(s, c);
      }
    }
    if (c.mode === MEND)
      for (const o of g.ships)
        if (o !== s && o.alive && o.team === s.team && !p.healed.includes(o.id) && segmentHitsHull(o, ox, oz, c.x, c.z, h) >= 0) {
          p.healed.push(o.id);
          o.heal(o.maxHp * HIT.mend.ally);
        }
  }
  if (f < 1) return;
  if (p.kind === 'shot' || p.kind === 'ricochet') return land(s, c);
  if (p.kind === 'home' && c.extra && !t.overdriveUntil) {
    c.gone = true;
    return;
  }
  seat(s, c);
  if (p.kind === 'dock') {
    if (!c.extra) s.heal(s.maxHp * CUBE.dock.heal);
    s.heal(p.dealt * CUBE.dock.dealtHeal);
    c.hp = Math.min(c.maxHp, c.hp + c.maxHp * CUBE.dock.cubeRepair);
  }
  emit(s, 'dock', c, c.x, c.y, c.z);
}

function land(s: Ship, c: Cube): void {
  c.state = 'hover';
  c.path = null;
  c.y = hoverY(s, c.x, c.z, c.scale);
  emit(s, 'land', c, c.x, c.y, c.z, H);
  // Thrown empty, it drops into the sea.
  if (s.tungsten!.spent && !c.extra) emit(s, 'spent', c, c.x, c.y, c.z);
}

function stepTethers(s: Ship, t: TungstenState, dt: number): void {
  const g = s.game;
  t.tethers = t.tethers.filter((x) => {
    const o = shipById(s, x.target),
      c = cubeById(t, x.cube);
    if (!o || !hostile(s, o) || !c || c.state === 'broken' || g.time >= x.until) return false;
    buff(o, 'debuff:tungstenChain', CUBE.aura.life, (m) => {
      m.speedMul *= HIT.tether.slow;
    });
    x.tick += dt;
    while (x.tick >= CUBE.aura.every) {
      x.tick -= CUBE.aura.every;
      hurt(s, o, HIT.tether.dps * CUBE.aura.every, skillSpec(s, x.skill));
    }
    const d = gap(o.pos.x, o.pos.z, c.x, c.z);
    if (d > HIT.tether.leash) drag(o, c.x, c.z, Math.min(600, 100 + (d - HIT.tether.leash) * 2), HIT.tether.leash);
    return true;
  });
}

function stepActs(s: Ship, t: TungstenState, dt: number): void {
  const g = s.game;
  t.acts = t.acts.filter((a) => {
    a.elapsed += dt;
    const c = cubeById(t, a.cube);
    if (c && a.kind !== 'field') {
      a.x = c.x;
      a.z = c.z;
    }
    const spec = skillSpec(s, a.skill);
    if (a.kind === 'reel') {
      for (const id of a.targets) {
        const o = shipById(s, id);
        if (o && hostile(s, o)) drag(o, a.x, a.z, SIGNATURE.reel.speed, H + o.spec.beam / 2 + 60);
      }
      if (a.elapsed < a.time) return true;
      for (const id of a.targets) {
        const o = shipById(s, id);
        if (o && hostile(s, o) && c) cubeHit(s, c, o, SIGNATURE.reel.damage, spec, false);
      }
      emit(s, 'reel', c, a.x, 0, a.z, a.radius);
      return false;
    }
    if (a.kind === 'slam') {
      if (a.elapsed < a.time) return true;
      for (const o of foesNear(s, a.x, a.z, a.radius)) {
        if (c) cubeHit(s, c, o, SIGNATURE.slam.damage, spec, false);
        stun(o, SIGNATURE.slam.stun);
      }
      emit(s, 'slam', c, a.x, 0, a.z, a.radius);
      return false;
    }
    for (const o of g.ships) if (o.alive && o.team === s.team && gap(o.pos.x, o.pos.z, a.x, a.z) <= a.radius) o.heal(o.maxHp * 0.02 * dt);
    return a.elapsed < a.time;
  });
}

function stepCollapse(s: Ship, t: TungstenState, dt: number): void {
  const C = CUBE.collapse;
  const u = t.ult!;
  u.elapsed += dt;
  const k = u.merged ? C.merged : 1,
    rk = u.merged ? C.mergedRadius : 1;
  const hy = hoverY(s, u.x, u.z) + 40;
  const f = smooth(Math.min(1, u.elapsed / C.travel));
  u.cubes.forEach((id, i) => {
    const c = cubeById(t, id);
    if (!c) return;
    c.x = u.from[i * 3] + (u.x - u.from[i * 3]) * f;
    c.y = u.from[i * 3 + 1] + (hy - u.from[i * 3 + 1]) * f;
    c.z = u.from[i * 3 + 2] + (u.z - u.from[i * 3 + 2]) * f;
  });
  if (u.elapsed < C.travel) return;
  const spec = skillSpec(s, u.skill);
  if (u.stage === 0) {
    u.stage = 1;
    emit(s, 'collapseHold', cubeById(t, u.cubes[0]), u.x, hy, u.z, C.radius * rk);
  }
  const R = C.radius * rk;
  for (const o of foesNear(s, u.x, u.z, R)) drag(o, u.x, u.z, 60 + 200 * (1 - gap(o.pos.x, o.pos.z, u.x, u.z) / R), 60);
  u.tick += dt;
  while (u.tick >= C.tick) {
    u.tick -= C.tick;
    for (const o of foesNear(s, u.x, u.z, C.core * rk)) hurt(s, o, C.coreDps * C.tick * k, spec);
  }
  if (u.elapsed < C.travel + C.pull - 1e-9) return;
  const r = C.burstRadius * rk;
  const lead = cubeById(t, u.cubes[0]) ?? t.cubes[0];
  for (const o of foesNear(s, u.x, u.z, r)) {
    const d = gap(o.pos.x, o.pos.z, u.x, u.z);
    cubeHit(s, lead, o, (C.burst - (C.burst - C.edge) * (d / r)) * k, spec, false);
  }
  emit(s, 'collapseBurst', lead, u.x, hy, u.z, r);
  u.cubes.forEach((id, i) => {
    const c = cubeById(t, id);
    if (!c) return;
    const a = (i / u.cubes.length) * Math.PI * 2;
    c.x = u.x + (i ? Math.cos(a) * 90 : 0);
    c.z = u.z + (i ? Math.sin(a) * 90 : 0);
    land(s, c);
  });
  t.ult = null;
}

function stepMeteor(s: Ship, t: TungstenState, dt: number): void {
  const M = CUBE.meteor;
  const u = t.ult!;
  u.elapsed += dt;
  const e = u.elapsed;
  let pending = false;
  u.cubes.forEach((id, i) => {
    const c = cubeById(t, id);
    if (!c) return;
    const fall = c.mode === KINETIC ? M.fall / 2 : M.fall;
    const sx = u.spots[i * 2],
      sz = u.spots[i * 2 + 1];
    const impact = M.rise + M.grow + fall;
    if (e < M.rise) {
      const k = smooth(e / M.rise);
      c.x = u.from[i * 3] + (sx - u.from[i * 3]) * k;
      c.y = u.from[i * 3 + 1] + (M.height - u.from[i * 3 + 1]) * k;
      c.z = u.from[i * 3 + 2] + (sz - u.from[i * 3 + 2]) * k;
      pending = true;
    } else if (e < M.rise + M.grow) {
      c.x = sx;
      c.z = sz;
      c.y = M.height;
      c.scale = 1 + (M.scale - 1) * smooth((e - M.rise) / M.grow);
      pending = true;
    } else if (e < impact - 1e-9) {
      const k = (e - M.rise - M.grow) / fall;
      c.x = sx;
      c.z = sz;
      c.scale = M.scale;
      c.y = M.height * (1 - k * k) + H * M.scale * 0.3 * k * k;
      if (!u.falls.includes(id)) {
        u.falls.push(id);
        emit(s, 'meteorFall', c, sx, 0, sz, M.radius);
      }
      if (c.mode === TETHER) for (const o of foesNear(s, sx, sz, 2000)) drag(o, sx, sz, 250, M.radius * 0.3);
      pending = true;
    } else {
      if (!u.struck.includes(id)) {
        u.struck.push(id);
        meteorImpact(s, t, u, c, sx, sz);
      }
      const k = Math.min(1, (e - impact) / M.shrink);
      c.scale = M.scale + (1 - M.scale) * smooth(k);
      const top = hoverY(s, sx, sz, c.scale);
      c.y = H * M.scale * 0.3 + (top - H * M.scale * 0.3) * smooth(k);
      if (k < 1) pending = true;
      else {
        c.scale = 1;
        land(s, c);
      }
    }
  });
  if (!pending) t.ult = null;
}

function meteorImpact(s: Ship, t: TungstenState, u: TungstenUlt, c: Cube, x: number, z: number): void {
  const M = CUBE.meteor;
  const g = s.game;
  const spec = skillSpec(s, u.skill);
  const share = u.merged ? M.share : 1;
  const R = M.radius;
  const blast = (r: number, frac: number) => {
    for (const o of foesNear(s, x, z, r)) {
      const d = gap(o.pos.x, o.pos.z, x, z);
      cubeHit(s, c, o, (M.damage - (M.damage - M.edge) * (d / r)) * share * frac, spec, false);
    }
  };
  blast(R, 1);
  if (c.mode === KINETIC) blast(R * 1.6, 0.3);
  else if (c.mode === CRUSH) for (const o of foesNear(s, x, z, R)) stun(o, 1.5);
  else if (c.mode === SHARD)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + g.rng() * 0.3;
      const r = R * (0.5 + g.rng() * 0.9);
      const fx = x + Math.cos(a) * r,
        fz = z + Math.sin(a) * r;
      for (const o of foesNear(s, fx, fz, 150)) cubeHit(s, c, o, 40000 * share, spec, false);
      emit(s, 'fragment', c, fx, 0, fz, 150);
    }
  else if (c.mode === REPEL)
    for (const o of foesNear(s, x, z, R)) {
      const d = Math.max(1, gap(o.pos.x, o.pos.z, x, z));
      o.shove(((o.pos.x - x) / d) * 600 * 1.5, ((o.pos.z - z) / d) * 600 * 1.5);
    }
  else if (c.mode === MEND) t.acts.push({ kind: 'field', cube: c.id, skill: u.skill, x, z, elapsed: 0, time: 6, radius: R, targets: [] });
  g.events.emit('explosion', { x, y: 5, z, size: u.merged ? 3 : 5 });
  emit(s, 'meteorImpact', c, x, 0, z, R);
}

/** AI helpers. */
export function tungstenWantedMode(s: Ship, target: Ship | null, fire: number): number {
  if (hpFrac(s) < 0.45) return MEND;
  if (fire >= 8) return REPEL;
  const c = s.tungsten!.cubes[0];
  const around = target ?? null;
  const x = around ? around.pos.x : c.x,
    z = around ? around.pos.z : c.z;
  if (foesNear(s, x, z, 1500).length >= 3) return SHARD;
  if (target) return target.spec.maxSpeed >= 34 ? TETHER : CRUSH;
  return KINETIC;
}
export const foesNearCube = (s: Ship, c: Cube, r: number) => foesNear(s, c.x, c.z, r);
