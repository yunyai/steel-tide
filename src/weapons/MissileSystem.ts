import type { Game } from '../core/Game';
import { distToHull } from '../core/hull';
import { DEG, approachAngle, bearingTo, dist2D, forwardX, forwardZ } from '../core/math';
import type { MissileLook, MissileProfile, SkillSpec, Team } from '../core/types';
import type { Ship } from '../ships/Ship';

// Guided missiles. The cruise profile is the BGM-109 Tomahawk: boost, sea-skim cruise, terminal
// pop-up and dive. Sea-skimmers stay low all the way in; ballistic rounds arc high and plunge;
// hypersonic rounds cruise fast and flat and dive at the end.

export interface Missile {
  id: number;
  owner: Ship;
  team: Team;
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  speed: number;
  hp: number;
  tx: number;
  tz: number;
  target: Ship | null;
  state: 'boost' | 'cruise' | 'popup' | 'dive';
  damage: number;
  delay: number;
  alive: boolean;
  age: number;
  /** Launched by a skill (damage popups carry its name). */
  skill: SkillSpec | null;
  profile: MissileProfile;
  /** Top speed (m/s). */
  top: number;
  /** AA and point defence cannot touch it. */
  uninterceptable: boolean;
  fire: number;
  flood: number;
  look: MissileLook;
  blast: number;
  onHit: ((target: Ship) => void) | null;
  /** Ballistic arc: start point, apex height and progress along it (0..1). */
  sx: number;
  sz: number;
  apex: number;
  u: number;
  /** Piercing runners (Gullinbursti, Mjölnir's return): ids of hulls already struck on the way. */
  struck: Set<number> | null;
}

export interface MissileOptions {
  profile: MissileProfile;
  /** Top speed (m/s); each profile has its own default. */
  speed: number;
  uninterceptable: boolean;
  /** Fire chance on each hull caught in the blast. */
  fire: number;
  flood: number;
  look: MissileLook;
  /** Steer onto this ship all the way in. */
  target: Ship | null;
  skill: SkillSpec | null;
  damage: number;
  /** Blast radius (m). */
  blast: number;
  /** Called on each hull the blast catches (Spirit Arrows' slow, Wild Hunt's bite). */
  onHit: ((target: Ship) => void) | null;
  /** Airframe toughness against AA (default 500). */
  hp: number;
  /**
   * Run through every hull within `blast` of the flight path, striking each once, and end at the
   * target point without a blast of its own.
   */
  pierce: boolean;
  /** Launch from here instead of the owner's deck. */
  from: { x: number; y: number; z: number } | null;
}

const PROFILE_SPEED: Record<MissileProfile, number> = { cruise: 270, skim: 300, ballistic: 420, hyper: 900 };

const CRUISE_ALT = 22;
const SKIM_ALT = 6;
const BLAST_RADIUS = 70;

export class MissileSystem {
  missiles: Missile[] = [];

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  launch(owner: Ship, tx: number, tz: number, delay: number, damage = 8000, o: Partial<MissileOptions> = {}): Missile {
    const p = o.from ?? owner.localToWorld(-owner.spec.length * 0.15, owner.spec.freeboard + 4, 0);
    const profile = o.profile ?? 'cruise';
    const m: Missile = {
      id: this.nextId++,
      owner,
      team: owner.team,
      x: p.x,
      y: p.y,
      z: p.z,
      heading: bearingTo(p.x, p.z, tx, tz),
      pitch: Math.PI / 2,
      speed: 60,
      hp: o.hp ?? 500,
      tx,
      tz,
      target: o.target ?? null,
      state: 'boost',
      damage,
      delay,
      alive: true,
      age: 0,
      skill: o.skill ?? null,
      profile,
      top: o.speed ?? PROFILE_SPEED[profile],
      uninterceptable: !!o.uninterceptable || owner.mods.missileSure,
      fire: o.fire ?? 0.7,
      flood: o.flood ?? 0,
      look: o.look ?? 'missile',
      blast: o.blast ?? BLAST_RADIUS,
      onHit: o.onHit ?? null,
      sx: p.x,
      sz: p.z,
      apex: Math.min(1400, Math.max(350, dist2D(p.x, p.z, tx, tz) * 0.3)),
      u: 0,
      struck: o.pierce ? new Set() : null,
    };
    // Runners skip the boost: they set off low and at full tilt.
    if (o.pierce) {
      m.state = 'cruise';
      m.speed = m.top;
      m.pitch = 0;
    }
    this.missiles.push(m);
    return m;
  }

  update(frame: number): void {
    const g = this.game;
    for (const m of this.missiles) {
      if (!m.alive) continue;
      if (m.delay > 0) {
        m.delay -= frame;
        if (m.delay <= 0) g.events.emit('missileLaunched', { ship: m.owner, x: m.x, y: m.y, z: m.z });
        else continue;
      }
      // Each missile has its own clock: time warps slow only the rounds inside them.
      const dt = frame * g.fields.timeScale(m.team, m.x, m.z);
      m.age += dt;
      if (m.target && m.target.alive && !m.target.submerged && !m.target.mods.banished) {
        m.tx = m.target.pos.x;
        m.tz = m.target.pos.z;
      }
      const d = dist2D(m.x, m.z, m.tx, m.tz);
      if (m.profile === 'ballistic' && m.state !== 'boost') {
        // A high arc from the launch point onto the (moving) target.
        const len = Math.max(1, dist2D(m.sx, m.sz, m.tx, m.tz));
        m.u = Math.min(1, m.u + (m.top * dt) / len);
        const nx = m.sx + (m.tx - m.sx) * m.u;
        const nz = m.sz + (m.tz - m.sz) * m.u;
        m.heading = bearingTo(m.x, m.z, nx, nz);
        const ny = 4 * m.apex * m.u * (1 - m.u) + 4;
        m.pitch = Math.atan2(ny - m.y, Math.max(1e-3, dist2D(m.x, m.z, nx, nz)));
        m.x = nx;
        m.z = nz;
        m.y = ny;
        m.state = m.u > 0.5 ? 'dive' : 'cruise';
        this.intercept(m, dt);
        if (!m.alive) continue;
        if (m.u >= 1 || this.shipAt(m)) this.detonate(m);
        continue;
      }
      switch (m.state) {
        case 'boost':
          m.speed = Math.min(m.top, m.speed + 120 * dt);
          m.y += m.speed * dt * 0.9;
          if (m.y > (m.profile === 'skim' ? 40 : 90)) {
            m.state = 'cruise';
            m.sx = m.x;
            m.sz = m.z;
          }
          break;
        case 'cruise':
          m.speed = Math.min(m.top, m.speed + (m.profile === 'hyper' ? 900 : 120) * dt);
          m.heading = approachAngle(m.heading, bearingTo(m.x, m.z, m.tx, m.tz), (m.profile === 'hyper' ? 12 : 25) * DEG * dt);
          m.y += ((m.profile === 'skim' ? SKIM_ALT : m.profile === 'hyper' ? 60 : CRUISE_ALT) - m.y) * Math.min(1, dt * 0.8);
          if (m.profile === 'skim') {
            // Sea-skimmers stay low to the end and only jink onto the nearest hull.
            if (d < 400 && !m.target && !m.struck) m.target = this.acquire(m);
            m.heading = approachAngle(m.heading, bearingTo(m.x, m.z, m.tx, m.tz), 60 * DEG * dt);
            if (d < 120) m.state = 'dive';
          } else if (d < (m.profile === 'hyper' ? 1500 : 900)) {
            m.state = m.profile === 'hyper' ? 'dive' : 'popup';
            if (!m.target) m.target = this.acquire(m);
          }
          break;
        case 'popup':
          m.heading = approachAngle(m.heading, bearingTo(m.x, m.z, m.tx, m.tz), 40 * DEG * dt);
          m.y += 110 * dt;
          if (m.y > 180 || d < 300) m.state = 'dive';
          break;
        case 'dive': {
          m.heading = approachAngle(m.heading, bearingTo(m.x, m.z, m.tx, m.tz), 90 * DEG * dt);
          // Glide down onto the target; a hypersonic round covers too much ground to fall faster.
          const drop = Math.max(m.profile === 'hyper' ? 10 : 60, (m.y / Math.max(30, d)) * m.speed);
          m.y -= drop * dt;
          break;
        }
      }
      if (m.state !== 'boost') {
        m.x += forwardX(m.heading) * m.speed * dt;
        m.z += forwardZ(m.heading) * m.speed * dt;
      }
      m.pitch = m.state === 'boost' ? Math.PI / 2 : m.state === 'dive' ? -0.6 : m.state === 'popup' ? 0.5 : 0;

      this.intercept(m, dt);
      if (!m.alive) continue;
      const ground = g.map.heightAt(m.x, m.z);
      if (m.struck) {
        this.runThrough(m);
        if (d < 40 || m.y <= Math.max(0, ground) || m.age > 40) {
          m.alive = false;
          g.events.emit('explosion', { x: m.x, y: Math.max(2, m.y), z: m.z, size: 1.4 });
        }
        continue;
      }
      const hitShip = this.shipAt(m);
      if (hitShip || m.y <= Math.max(0, ground) || m.age > 40) this.detonate(m);
    }
    if (this.missiles.length > 16 && this.missiles.some((m) => !m.alive)) this.missiles = this.missiles.filter((m) => m.alive);
  }

  /**
   * AA fire against missiles is less effective than against slow aircraft and is split between
   * every missile inside a ship's envelope.
   */
  private intercept(m: Missile, dt: number): void {
    if (m.uninterceptable) return;
    const g = this.game;
    for (const s of g.ships) {
      if (!s.alive || s.team === m.team || s.submerged) continue;
      const r = s.spec.aa.range * 0.8 * s.mods.aaRangeMul;
      if (dist2D(m.x, m.z, s.pos.x, s.pos.z) >= r) continue;
      let n = 0;
      for (const o of this.missiles) if (o.alive && o.delay <= 0 && o.team === m.team && dist2D(o.x, o.z, s.pos.x, s.pos.z) < r) n++;
      // Hypersonic rounds give the gunners almost no time.
      const fast = m.profile === 'hyper' ? 0.25 : 1;
      m.hp -= (s.spec.aa.dps * 0.15 * s.mods.aaMul * fast * dt) / Math.max(1, n);
    }
    if (m.hp <= 0) this.kill(m);
  }

  /** Shot down. */
  kill(m: Missile): void {
    m.alive = false;
    this.game.events.emit('intercept', { x: m.x, y: m.y, z: m.z });
  }

  private acquire(m: Missile): Ship | null {
    let best: Ship | null = null;
    let bd = 400;
    for (const s of this.game.ships) {
      if (!s.alive || s.team === m.team || s.submerged || s.mods.banished) continue;
      const d = dist2D(m.tx, m.tz, s.pos.x, s.pos.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private shipAt(m: Missile): Ship | null {
    if (m.state !== 'dive' && m.profile !== 'skim') return null;
    for (const s of this.game.ships) {
      if (!s.alive || s.team === m.team || s.submerged || s.mods.banished) continue;
      if (m.y > s.spec.freeboard + 12) continue;
      const dx = m.x - s.pos.x;
      const dz = m.z - s.pos.z;
      const h = s.heading;
      const lx = dx * Math.sin(h) - dz * Math.cos(h);
      const lz = dx * Math.cos(h) + dz * Math.sin(h);
      if (Math.abs(lx) < s.spec.length / 2 && Math.abs(lz) < s.spec.beam / 2 + 2) return s;
    }
    return null;
  }

  private detonate(m: Missile): void {
    const g = this.game;
    m.alive = false;
    g.events.emit('explosion', { x: m.x, y: Math.max(2, m.y), z: m.z, size: 2.2 });
    for (const s of g.ships) {
      if (!s.alive || s.team === m.team || s.submerged || s.mods.banished) continue;
      // Measured from the hull, not its centre: a hit on the bow of a long ship counts in full.
      const d = distToHull(s, m.x, m.z);
      if (d > m.blast) continue;
      this.hit(m, s, 1 - (0.6 * d) / m.blast);
    }
  }

  /** A piercing runner strikes each hull it passes within its blast radius, once. */
  private runThrough(m: Missile): void {
    if (m.y > 60) return;
    for (const s of this.game.ships) {
      if (!s.alive || s.team === m.team || s.submerged || s.mods.banished || m.struck!.has(s.id)) continue;
      if (distToHull(s, m.x, m.z) > m.blast) continue;
      m.struck!.add(s.id);
      this.game.events.emit('explosion', { x: m.x, y: 4, z: m.z, size: 1.6 });
      this.hit(m, s, 1);
    }
  }

  private hit(m: Missile, s: Ship, fall: number): void {
    const g = this.game;
    const ult = m.skill?.ult ? m.owner.mods.ultDamageMul : 1;
    const mul = m.owner.mods.damageMul * m.owner.mods.missileDamageMul * s.mods.missileTakenMul * ult;
    const dmg = s.takeDamage(m.damage * fall * mul, m.owner, m.skill);
    if (g.rng() < m.fire) s.startFire(Math.floor(g.rng() * 4), m.owner);
    if (m.flood > 0 && g.rng() < m.flood) s.startFlood(m.owner);
    if (m.onHit && s.alive) m.onHit(s);
    g.events.emit('shellHit', { attacker: m.owner, target: s, outcome: 'missile', damage: dmg, x: m.x, y: m.y, z: m.z, caliber: 530, ammo: 'HE' });
  }
}
