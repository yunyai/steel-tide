import { canTrack } from '../core/Targeting';
import { MAP_HALF } from '../config';
import type { Game } from '../core/Game';
import { distToHull, segmentHitsHull } from '../core/hull';
import { DEG, bearingTo, clamp, dist2D, forwardX, forwardZ, wrapAngle } from '../core/math';
import type { SkillSpec } from '../core/types';
import type { DamageLink, SalvoBuff, Ship } from '../ships/Ship';
import type { Missile } from '../weapons/MissileSystem';
import type { Torpedo } from '../weapons/TorpedoSystem';
import { stun } from '../weapons/StrikeSystem';

export { stun };

// Shared building blocks for skills.

export function dist(a: Ship, b: Ship): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
}

/** Enemies within `r`; skills that pick targets pass over untargetable (cloaked) ships unless `all`. */
export function enemiesWithin(ship: Ship, game: Game, r: number, targetable = true): Ship[] {
  return game.ships.filter((s) => s.alive && s.team !== ship.team && (!targetable || canTrack(ship, s)) && dist(s, ship) < r);
}

export function alliesWithin(ship: Ship, game: Game, r: number): Ship[] {
  return game.ships.filter((s) => s.alive && s.team === ship.team && dist(s, ship) < r);
}

export function nearestEnemy(ship: Ship, game: Game, r: number, targetable = true): Ship | null {
  let best: Ship | null = null;
  let bd = r;
  for (const s of enemiesWithin(ship, game, r, targetable)) {
    const d = dist(s, ship);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Targetable enemy closest to a point (the reticle), within `r` of it. */
export function enemyNear(ship: Ship, game: Game, x: number, z: number, r: number): Ship | null {
  let best: Ship | null = null;
  let bd = r;
  for (const s of game.ships) {
    if (!canTrack(ship, s)) continue;
    const d = distToHull(s, x, z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export function targetInGunRange(ship: Ship, target: Ship | null, frac = 0.95): boolean {
  if (!target || !target.alive) return false;
  return dist(ship, target) < ship.mainRange * frac;
}

export function within(ship: Ship, target: Ship | null, r: number): target is Ship {
  return !!target && target.alive && dist(ship, target) < r;
}

/** Degrees between the bow and a target. */
export function offBow(ship: Ship, target: Ship): number {
  const b = bearingTo(ship.pos.x, ship.pos.z, target.pos.x, target.pos.z);
  let d = Math.abs(b - ship.heading) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return (d * 180) / Math.PI;
}

/** The reticle, pulled in to at most `max` metres from the ship (further with Uplink). */
export function aimPoint(ship: Ship, max: number): { x: number; z: number } {
  max *= ship.mods.reachMul;
  const { aimX, aimZ } = ship.control;
  const d = dist2D(ship.pos.x, ship.pos.z, aimX, aimZ);
  if (d <= max) return { x: aimX, z: aimZ };
  const k = max / d;
  return { x: ship.pos.x + (aimX - ship.pos.x) * k, z: ship.pos.z + (aimZ - ship.pos.z) * k };
}

/** Skill damage to one hull, scaled by the attacker's damage (and ultimate) modifiers; `pierce` cuts through every defence (see takeDamage). */
export function hurt(attacker: Ship, target: Ship, amount: number, skill: SkillSpec, pierce = false): number {
  const mul = attacker.mods.damageMul * (skill.ult ? attacker.mods.ultDamageMul : 1) * attacker.critMul(target);
  return target.takeDamage(amount * mul, attacker, skill, false, pierce);
}

/** Timed buff; ids starting with `debuff:` are removed by a cleanse. */
export function buff(ship: Ship, id: string, time: number, apply: (m: Ship['mods']) => void): void {
  ship.addEffect({ id, time, apply });
}

/** Marked enemies take more damage. */
export function mark(ship: Ship, time: number): void {
  buff(ship, 'debuff:mark', time, (m) => {
    m.marked = true;
  });
}

/**
 * Arcing bolt that leaps from `from` to up to `n` enemies, nearest first, each within `hop` of the
 * last link. Returns the ships struck.
 */
export function chainLightning(
  ship: Ship,
  game: Game,
  skill: SkillSpec,
  n: number,
  reach: number,
  hop: number,
  damage: number,
  stunTime: number,
): Ship[] {
  const struck: Ship[] = [];
  let fx = ship.pos.x;
  let fz = ship.pos.z;
  let range = reach;
  const points = [{ x: fx, y: ship.spec.freeboard + 25, z: fz }];
  for (let i = 0; i < n; i++) {
    let best: Ship | null = null;
    let bd = range;
    for (const s of game.ships) {
      if (!canTrack(ship, s) || s.deep || struck.includes(s)) continue;
      const d = Math.hypot(s.pos.x - fx, s.pos.z - fz);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) break;
    struck.push(best);
    points.push({ x: best.pos.x, y: best.spec.freeboard + 8, z: best.pos.z });
    hurt(ship, best, damage, skill);
    if (stunTime > 0 && best.alive) stun(best, stunTime);
    fx = best.pos.x;
    fz = best.pos.z;
    range = hop;
  }
  if (struck.length) game.events.emit('lightning', { points, color: skill.accent });
  return struck;
}

/** One bolt from the ship to each target (a storm rather than a chain). */
export function boltTo(ship: Ship, game: Game, target: Ship, color: number): void {
  game.events.emit('lightning', {
    points: [
      { x: ship.pos.x, y: ship.spec.freeboard + 30, z: ship.pos.z },
      { x: target.pos.x, y: target.spec.freeboard + 6, z: target.pos.z },
    ],
    color,
  });
}

/**
 * Teleport up to `distance` metres along the heading, stopping short of land and the map edge.
 * Returns false when there was no room to move at all.
 */
export function blink(ship: Ship, game: Game, distance: number): boolean {
  const fx = forwardX(ship.heading);
  const fz = forwardZ(ship.heading);
  const edge = MAP_HALF - 150;
  const clear = ship.spec.length * 0.6;
  let go = 0;
  for (let t = 20; t <= distance; t += 20) {
    const x = ship.pos.x + fx * t;
    const z = ship.pos.z + fz * t;
    if (Math.abs(x) > edge || Math.abs(z) > edge) break;
    if (game.map.heightAt(x + fx * clear, z + fz * clear) > -6 || game.map.heightAt(x, z) > -6) break;
    go = t;
  }
  if (go < 40) return false;
  const fromX = ship.pos.x;
  const fromZ = ship.pos.z;
  ship.pos.x = clamp(ship.pos.x + fx * go, -edge, edge);
  ship.pos.z = clamp(ship.pos.z + fz * go, -edge, edge);
  // Snap rather than slide: the interpolated pose jumps with the hull.
  ship.prevPos.copy(ship.pos);
  ship.renderPos.copy(ship.pos);
  game.events.emit('blink', { ship, fromX, fromZ });
  if (ship.trait?.ambush) ship.ambushReady = true;
  return true;
}

/** Heal every ally within `r` (the caster included) by `frac` of their max HP. */
export function healAllies(ship: Ship, game: Game, r: number, frac: number): void {
  for (const s of alliesWithin(ship, game, r)) s.heal(s.maxHp * frac);
}

/** Load a one-shot buff for the next full salvo and make it ready to fire now. */
export function nextSalvo(ship: Ship, skill: SkillSpec, b: Partial<Omit<SalvoBuff, 'skill' | 'left'>>): void {
  ship.salvo = {
    skill,
    left: Math.max(1, ship.turrets.length),
    dispersionMul: 1,
    damageMul: 1,
    railgun: false,
    guaranteedFire: false,
    cluster: false,
    ...b,
  };
  for (const t of ship.turrets) t.reload = 0;
}

/** Destroy hostile projectiles and aircraft inside a bubble around a point. */
export function intercept(
  ship: Ship,
  game: Game,
  x: number,
  z: number,
  r: number,
  dt: number,
  what: { shells?: boolean; torps?: boolean; missiles?: boolean; planes?: number },
  onShell?: (owner: Ship, damage: number) => void,
): void {
  const r2 = r * r;
  const inside = (px: number, pz: number) => (px - x) * (px - x) + (pz - z) * (pz - z) < r2;
  let fx = 0;
  if (what.shells) {
    for (const s of game.shells.shells) {
      if (!s.alive || s.team === ship.team || !inside(s.x, s.z)) continue;
      s.alive = false;
      onShell?.(s.owner, s.spec.damage * s.dmgMul);
      if (fx++ < 12) game.events.emit('intercept', { x: s.x, y: s.y, z: s.z });
    }
  }
  if (what.torps) {
    for (const t of game.torps.torps) {
      if (!t.alive || t.team === ship.team || !inside(t.x, t.z)) continue;
      t.alive = false;
      game.events.emit('intercept', { x: t.x, y: 0, z: t.z });
    }
  }
  if (what.missiles) {
    for (const m of game.missiles.missiles) {
      if (!m.alive || m.delay > 0 || m.team === ship.team || m.uninterceptable || !inside(m.x, m.z)) continue;
      m.alive = false;
      game.events.emit('intercept', { x: m.x, y: m.y, z: m.z });
    }
  }
  if (what.planes) {
    for (const sq of game.air.squadrons) {
      if (!sq.alive || sq.team === ship.team || !inside(sq.x, sq.z)) continue;
      game.air.damage(sq, what.planes * dt);
    }
  }
}

/** Hostile fire is converging on this ship (for defensive AI). */
export function underFire(ship: Ship, game: Game, r: number): number {
  let n = 0;
  for (const s of game.shells.shells) if (s.alive && s.team !== ship.team && Math.hypot(s.x - ship.pos.x, s.z - ship.pos.z) < r) n++;
  for (const t of game.torps.torps) if (t.alive && t.team !== ship.team && Math.hypot(t.x - ship.pos.x, t.z - ship.pos.z) < r) n += 4;
  for (const m of game.missiles.missiles) if (m.alive && m.team !== ship.team && Math.hypot(m.x - ship.pos.x, m.z - ship.pos.z) < r * 2) n += 4;
  return n;
}

export function hpFrac(ship: Ship): number {
  return ship.hp / ship.maxHp;
}

export function burning(ship: Ship): number {
  return ship.fires.filter((f) => f > 0).length + (ship.flooding > 0 ? 2 : 0);
}

/** Within `half` degrees of bearing `centre` from the ship. */
export function inCone(ship: Ship, s: Ship, centre: number, half: number): boolean {
  const b = bearingTo(ship.pos.x, ship.pos.z, s.pos.x, s.pos.z);
  return Math.abs(wrapAngle(b - centre)) <= half * DEG;
}

/** Enemy hulls on the segment, widened by `pad`. */
export function enemiesOnLine(ship: Ship, game: Game, x0: number, z0: number, x1: number, z1: number, pad: number): Ship[] {
  return game.ships.filter((s) => s.alive && s.team !== ship.team && !s.deep && segmentHitsHull(s, x0, z0, x1, z1, pad) >= 0);
}

/** How long crowd control holds a hull: titans shrug most of it off, Bastion hulls half. */
export function ccTime(s: Ship, time: number): number {
  return time * (s.spec.cls === 'TT' ? 0.4 : 1) * (s.trait?.stunTakenMul ?? 1);
}

/** Held dead in the water; turrets still train. */
export function root(s: Ship, time: number): void {
  buff(s, 'debuff:root', ccTime(s, time), (m) => {
    m.rooted = true;
  });
}

/** No skills. */
export function silence(s: Ship, time: number): void {
  buff(s, 'debuff:silence', ccTime(s, time), (m) => {
    m.silenced = true;
  });
}

/** No weapons; the ship still sails. */
export function disarm(s: Ship, time: number): void {
  buff(s, 'debuff:disarm', ccTime(s, time), (m) => {
    m.disarmed = true;
  });
}

/** The helm flees (x, z) at full speed. */
export function fear(s: Ship, x: number, z: number, time: number): void {
  buff(s, 'debuff:fear', ccTime(s, time), (m) => {
    m.feared = true;
    m.fearX = x;
    m.fearZ = z;
  });
}

/** Out of the world: untouchable, unseen and frozen. Titans are held for less. */
export function banish(s: Ship, time: number): void {
  buff(s, 'debuff:banish', s.spec.cls === 'TT' ? time * 0.5 : time, (m) => {
    m.banished = true;
  });
}

/** Drag toward (x, z) at `speed` m/s for this step, stopping `stop` metres short. */
export function pullToward(s: Ship, x: number, z: number, speed: number, dt: number, stop = 80): void {
  const dx = x - s.pos.x;
  const dz = z - s.pos.z;
  const d = Math.hypot(dx, dz);
  // The push decays at 1.5/s, so feeding it speed * 1.5 a second holds about `speed`.
  if (d > stop) s.shove((dx / d) * speed * 1.5 * dt, (dz / d) * speed * 1.5 * dt);
}

/** Open water deep enough for the hull, inside the map. */
export function clearWater(game: Game, s: Ship, x: number, z: number): boolean {
  const edge = MAP_HALF - 150;
  if (Math.abs(x) > edge || Math.abs(z) > edge) return false;
  const c = s.spec.length * 0.5;
  const fx = forwardX(s.heading) * c;
  const fz = forwardZ(s.heading) * c;
  return game.map.heightAt(x, z) < -6 && game.map.heightAt(x + fx, z + fz) < -6 && game.map.heightAt(x - fx, z - fz) < -6;
}

/** Snap the hull to (x, z) with no slide, and let the render draw the jump. */
export function placeAt(s: Ship, game: Game, x: number, z: number): void {
  const fromX = s.pos.x;
  const fromZ = s.pos.z;
  s.pos.x = x;
  s.pos.z = z;
  s.prevPos.copy(s.pos);
  s.renderPos.copy(s.pos);
  game.events.emit('blink', { ship: s, fromX, fromZ });
  if (s.trait?.ambush) s.ambushReady = true;
}

/**
 * Teleport toward (x, z), any direction: to the point itself if there is clear water there,
 * otherwise the closest clear water on the way. Returns false when there was nowhere to go.
 */
export function blinkTo(ship: Ship, game: Game, x: number, z: number): boolean {
  const dx = x - ship.pos.x;
  const dz = z - ship.pos.z;
  const d = Math.hypot(dx, dz);
  for (let t = d; t >= 40; t -= 25) {
    const px = ship.pos.x + (dx * t) / d;
    const pz = ship.pos.z + (dz * t) / d;
    if (!clearWater(game, ship, px, pz)) continue;
    placeAt(ship, game, px, pz);
    return true;
  }
  return false;
}

/** Trade places (Shadow Swap); headings stay as they were. */
export function swapPlaces(a: Ship, b: Ship, game: Game): void {
  const ax = a.pos.x;
  const az = a.pos.z;
  placeAt(a, game, b.pos.x, b.pos.z);
  placeAt(b, game, ax, az);
}

/** Wrecks still on the water within `r` of (x, z): sunk ships whose hulls are not yet cleared. */
export function wrecksNear(game: Game, x: number, z: number, r: number): Ship[] {
  return game.ships.filter((s) => !s.alive && !s.withdrawn && !s.isSummon && dist2D(s.pos.x, s.pos.z, x, z) < r);
}

/**
 * Raise a summon of `specId` for the owner at a wreck (Raise the Drowned): it takes the wreck's
 * place and heading, and the wreck itself sinks out of sight.
 */
export function raiseAt(owner: Ship, game: Game, x: number, z: number, heading: number, time: number, specId: string, name: string): Ship {
  const s = game.spawnWingman(owner, 0, time, 0, specId, name);
  s.pos.x = x;
  s.pos.z = z;
  s.heading = s.prevHeading = s.renderHeading = heading;
  s.prevPos.copy(s.pos);
  s.renderPos.copy(s.pos);
  s.speed = 0;
  return s;
}

/** Share damage through a group of hulls for `time` seconds (see DamageLink). */
export function link(group: Ship[], game: Game, mode: DamageLink['mode'], share: number, time: number, skill: SkillSpec): void {
  const l: DamageLink = { group, mode, share, until: game.time + time, skill };
  for (const s of group) s.link = l;
}

/**
 * Unravel the enemy's work within `r` of (x, z) (Dispel): their fields, tripwires, walls, beams,
 * pending strikes and mines end; enemy hulls lose their shields, hit guards, buffs and the normal
 * skills they are running; allies there are cleansed. Returns how many things it undid.
 */
export function dispel(ship: Ship, game: Game, x: number, z: number, r: number): number {
  const near = (px: number, pz: number, pad = 0) => dist2D(px, pz, x, z) < r + pad;
  let n = 0;
  for (const f of game.fields.fields) {
    if (f.team === ship.team || f.age >= f.life || !near(f.x, f.z, f.r * 0.5)) continue;
    f.age = f.life;
    n++;
  }
  for (const w of game.fields.wires) {
    if (w.team === ship.team || w.age >= w.life || !(near(w.x0, w.z0) || near(w.x1, w.z1) || near((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2))) continue;
    w.age = w.life;
    n++;
  }
  for (const w of game.walls) {
    if (w.team === ship.team || w.age >= w.life || !(near(w.x0, w.z0) || near(w.x1, w.z1) || near((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2))) continue;
    w.age = w.life;
    n++;
  }
  for (const b of game.beams.beams) {
    if (!b.alive || b.team === ship.team || !(near(b.x0, b.z0) || near(b.x1, b.z1))) continue;
    b.alive = false;
    n++;
  }
  for (const s of game.strikes.strikes) {
    if (!s.alive || s.team === ship.team || (s.landed && s.kind !== 'mine') || !near(s.x, s.z)) continue;
    s.alive = false;
    game.events.emit('intercept', { x: s.x, y: 10, z: s.z });
    n++;
  }
  for (const s of game.ships) {
    if (!s.alive || !near(s.pos.x, s.pos.z)) continue;
    if (s.team === ship.team) {
      s.cleanse();
      continue;
    }
    s.effects = s.effects.filter((e) => e.id.startsWith('debuff:'));
    s.shield = s.shieldMax = s.shieldTime = 0;
    s.guard = null;
    s.salvo = null;
    for (const st of s.skills) if (st.active && !st.spec.ult) st.time = 0;
    n++;
  }
  return n;
}

/** Turn a hostile missile around onto a new target under a new owner (Hijack, Kill Web). */
export function turnMissile(m: Missile, owner: Ship, target: Ship): void {
  m.owner = owner;
  m.team = owner.team;
  m.target = target;
  m.tx = target.pos.x;
  m.tz = target.pos.z;
  m.age = Math.min(m.age, 20);
  if (m.profile === 'ballistic') {
    m.sx = m.x;
    m.sz = m.z;
    m.u = 0;
  } else if (m.state !== 'boost') m.state = 'cruise';
}

/** Turn a torpedo onto a new target under a new owner, with fuel to reach it. */
export function turnTorpedo(t: Torpedo, owner: Ship, target: Ship): void {
  t.owner = owner;
  t.team = owner.team;
  t.homing = target;
  t.wire = false;
  t.heading = bearingTo(t.x, t.z, target.pos.x, target.pos.z);
  t.range = t.travelled + dist2D(t.x, t.z, target.pos.x, target.pos.z) + 1500;
}
