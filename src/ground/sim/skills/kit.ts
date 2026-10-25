import type { SkillSpec } from '../../../core/types';
import type { GroundGame } from '../GroundGame';
import type { GroundMods, ShotBuff, Vehicle } from '../Vehicle';
import type { StrikeInit } from '../weapons/Strikes';

// Shared building blocks for ground skills.

export function dist(a: Vehicle, b: Vehicle): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function hpFrac(v: Vehicle): number {
  return v.hp / v.maxHp;
}

/** Hit within the last `s` seconds. */
export function underFire(v: Vehicle, g: GroundGame, s = 2.5): boolean {
  return g.time - v.lastHit < s;
}

/** Reach of the vehicle's main weapon. */
export function weaponRange(v: Vehicle): number {
  return v.spec.gun?.range ?? v.spec.launcher?.range ?? 600;
}

export function inRange(v: Vehicle, t: Vehicle | null, r: number): t is Vehicle {
  return !!t && t.alive && dist(v, t) <= r;
}

/** The crosshair's ground point, pulled in to `max` metres from the hull. */
export function aimPoint(v: Vehicle, max: number): { x: number; z: number } {
  const c = v.control;
  const dx = c.aimX - v.x;
  const dz = c.aimZ - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= max || d < 1e-3) return { x: c.aimX, z: c.aimZ };
  return { x: v.x + (dx / d) * max, z: v.z + (dz / d) * max };
}

/** Level unit vector of the hull's bow. */
export function forward(v: Vehicle): [number, number] {
  const f = v.pose.f;
  const l = Math.hypot(f[0], f[2]) || 1;
  return [f[0] / l, f[2] / l];
}

export function enemiesWithin(v: Vehicle, g: GroundGame, r: number): Vehicle[] {
  return g.enemiesNear(v.team, v.x, v.z, r);
}

export function alliesWithin(v: Vehicle, g: GroundGame, r: number): Vehicle[] {
  return g.alliesNear(v.team, v.x, v.z, r);
}

export function buff(v: Vehicle, id: string, time: number, apply: (m: GroundMods) => void): void {
  v.addEffect(id, time, apply);
}

/** The next `left` rounds out of the gun fly special. */
export function nextShots(v: Vehicle, spec: SkillSpec, left: number, opts: Omit<ShotBuff, 'skill' | 'left'>): void {
  v.shotBuff = { skill: spec, left, ...opts };
}

/** A random point in a disc. */
export function scatter(g: GroundGame, x: number, z: number, r: number): [number, number] {
  const a = g.rng() * Math.PI * 2;
  const d = Math.sqrt(g.rng()) * r;
  return [x + Math.cos(a) * d, z + Math.sin(a) * d];
}

type StrikeOpts = Omit<StrikeInit, 'owner' | 'x' | 'z' | 'skill'>;

export function strikeAt(v: Vehicle, g: GroundGame, spec: SkillSpec, x: number, z: number, o: StrikeOpts): void {
  g.strikes.add({ owner: v, x, z, skill: spec, ...o });
}

/** `n` strikes scattered over a disc, landing one after another from `delay`, `gap` apart. */
export function barrage(v: Vehicle, g: GroundGame, spec: SkillSpec, x: number, z: number, spread: number, n: number, gap: number, o: StrikeOpts): void {
  for (let i = 0; i < n; i++) {
    const [sx, sz] = scatter(g, x, z, spread);
    strikeAt(v, g, spec, sx, sz, { ...o, delay: o.delay + i * gap });
  }
}

export interface VolleyOpts {
  x: number;
  z: number;
  /** Rockets land scattered over this radius. */
  r: number;
  damage: number;
  splash: number;
  pen?: number;
  speed?: number;
  /** Seconds between launches. */
  interval: number;
  fire?: boolean;
  stun?: number;
  props?: number;
  loft?: number;
  look?: string;
  /** Launch from here instead of the hull (phantom batteries). */
  from?: (i: number) => { x: number; y: number; z: number };
}

/** A ripple of unguided rockets onto an area. */
export function rocketVolley(v: Vehicle, g: GroundGame, spec: SkillSpec, n: number, o: VolleyOpts): void {
  const p = v.pivot();
  for (let i = 0; i < n; i++) {
    const [tx, tz] = scatter(g, o.x, o.z, o.r);
    const from = o.from?.(i) ?? { x: p.x, y: p.y + 0.6, z: p.z };
    g.missiles.launch({
      owner: v,
      x: from.x,
      y: from.y,
      z: from.z,
      tx,
      ty: g.terrain.heightAt(tx, tz),
      tz,
      speed: o.speed ?? v.spec.launcher?.speed ?? 160,
      damage: o.damage,
      pen: o.pen ?? 60,
      splash: o.splash,
      guidance: 'none',
      target: null,
      look: o.look ?? v.spec.launcher?.look ?? 'rocket',
      skill: spec,
      fire: o.fire,
      delay: i * o.interval,
      loft: o.loft,
      props: o.props,
      stun: o.stun,
    });
  }
  g.events.emit('rocketLaunched', { v, x: p.x, y: p.y, z: p.z });
}

/** Enemies within `r` of the crosshair (pulled in to `max`). */
export function enemiesAtAim(v: Vehicle, g: GroundGame, max: number, r: number): Vehicle[] {
  const a = aimPoint(v, max);
  return g.enemiesNear(v.team, a.x, a.z, r);
}

/** AI: how many enemies sit within `r` of a target. */
export function clusterAround(v: Vehicle, g: GroundGame, t: Vehicle | null, r: number): number {
  return t ? g.enemiesNear(v.team, t.x, t.z, r).length : 0;
}

/** Hurt allies (below `frac`) within `r`. */
export function hurtAllies(v: Vehicle, g: GroundGame, r: number, frac: number): Vehicle[] {
  return alliesWithin(v, g, r).filter((a) => a.hp < a.maxHp * frac || a.crits.tracks > 0 || a.crits.fire > 0);
}
