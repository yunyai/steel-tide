import type { Game } from '../core/Game';
import { distToHull } from '../core/hull';
import type { SkillSpec, Team } from '../core/types';
import type { Ship } from '../ships/Ship';

// Telegraphed area attacks for skills: orbital rods, nukes, rocket carpets, mortars,
// bomblets, proximity mines and expanding shock rings.

export type StrikeKind = 'rod' | 'nuke' | 'rocket' | 'mortar' | 'cluster' | 'mine' | 'shock';
/** How the strike is drawn (the kind decides what it does). */
export type StrikeLook = 'plain' | 'meteor' | 'anvil' | 'rune' | 'fireball' | 'quake';

export interface StrikeOptions {
  kind: StrikeKind;
  skill: SkillSpec | null;
  x: number;
  z: number;
  /** Blast radius (shock: the ring's final radius). */
  radius: number;
  /** Seconds until it lands (mine: until it arms). */
  delay: number;
  damage: number;
  /** Chance to start a fire / flooding on each hull hit. */
  fire?: number;
  flood?: number;
  /** Seconds of EMP stun on each hull hit. */
  stun?: number;
  /** Knockback speed (m/s) away from the centre. */
  knock?: number;
  /** Reaches submarines under the surface. */
  hitsSubs?: boolean;
  /** Mine: seconds it stays in the water once armed. */
  life?: number;
  /** Mine: paddles toward the nearest enemy hull within this many metres (0: sits still), this fast (m/s). */
  seek?: number;
  seekSpeed?: number;
  /** Shock: ring speed (m/s), and the fraction of max HP it restores to allies it passes. */
  speed?: number;
  heal?: number;
  /** Shock ring that follows its owner (the ring is centred on the ship). */
  follow?: boolean;
  look?: StrikeLook;
}

export interface Strike extends Required<Omit<StrikeOptions, 'skill'>> {
  id: number;
  owner: Ship;
  team: Team;
  skill: SkillSpec | null;
  /** Seconds since spawning. */
  age: number;
  /** Shock: current ring radius. */
  ring: number;
  /** Landed (or, for a mine, armed). */
  landed: boolean;
  alive: boolean;
  hit: Set<number>;
}

/** A mine goes off when a hull comes this close. */
const MINE_TRIGGER = 45;
/** How fast a seeking mine paddles (m/s). */
const MINE_SEEK_SPEED = 14;

export class StrikeSystem {
  strikes: Strike[] = [];

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  spawn(owner: Ship, o: StrikeOptions): Strike {
    const s: Strike = {
      id: this.nextId++,
      owner,
      team: owner.team,
      fire: 0,
      flood: 0,
      stun: 0,
      knock: 0,
      hitsSubs: false,
      life: 0,
      seek: 0,
      seekSpeed: MINE_SEEK_SPEED,
      speed: 600,
      heal: 0,
      follow: false,
      look: 'plain',
      ...o,
      age: 0,
      ring: 0,
      landed: false,
      alive: true,
      hit: new Set(),
    };
    this.strikes.push(s);
    this.game.events.emit('strike', { strike: s });
    return s;
  }

  update(dt: number): void {
    for (const s of this.strikes) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age < s.delay) continue;
      if (s.kind === 'shock') this.updateShock(s, dt);
      else if (s.kind === 'mine') this.updateMine(s, dt);
      else this.detonate(s);
    }
    if (this.strikes.length > 48 && this.strikes.some((s) => !s.alive)) this.strikes = this.strikes.filter((s) => s.alive);
  }

  private canHit(s: Strike, ship: Ship): boolean {
    if (!ship.alive || ship.team === s.team) return false;
    return !ship.submerged || (s.hitsSubs && !ship.deep);
  }

  private detonate(s: Strike): void {
    const g = this.game;
    s.alive = false;
    s.landed = true;
    const size = s.kind === 'nuke' ? 9 : s.kind === 'rod' ? 4 : s.kind === 'mine' ? 2 : s.radius / 40;
    g.events.emit('explosion', { x: s.x, y: 3, z: s.z, size });
    g.events.emit('strikeHit', { strike: s });
    for (const ship of g.ships) {
      if (!this.canHit(s, ship)) continue;
      const d = distToHull(ship, s.x, s.z);
      if (d > s.radius) continue;
      this.apply(s, ship, 1 - 0.6 * (d / s.radius));
    }
  }

  /** Damage, fire, flooding, stun and knockback on one hull. */
  private apply(s: Strike, ship: Ship, fall: number): void {
    const g = this.game;
    const o = s.owner;
    const mul = o.mods.damageMul * (s.skill?.ult ? o.mods.ultDamageMul : 1);
    ship.takeDamage(s.damage * fall * mul * o.critMul(ship), o, s.skill);
    if ((ship.stepper?.phaseUntil ?? 0) > g.time) return;
    if (s.fire > 0 && g.rng() < s.fire) ship.startFire(Math.floor(g.rng() * 4), o);
    if (s.flood > 0 && g.rng() < s.flood) ship.startFlood(o);
    if (s.stun > 0 && ship.alive) stun(ship, s.stun);
    if (s.knock > 0) {
      const ax = ship.pos.x - s.x;
      const az = ship.pos.z - s.z;
      const d = Math.hypot(ax, az) || 1;
      // Heavier hulls are shoved less.
      const k = (s.knock * fall) / d;
      ship.shove(ax * k, az * k);
    }
  }

  private updateMine(s: Strike, dt: number): void {
    if (!s.landed) {
      s.landed = true;
      s.life += s.delay;
    }
    if (s.age > s.life) {
      s.alive = false;
      return;
    }
    let prey: Ship | null = null;
    let near = s.seek;
    for (const ship of this.game.ships) {
      if (!this.canHit(s, ship) || ship.isSub) continue;
      const d = distToHull(ship, s.x, s.z);
      if (d < MINE_TRIGGER) {
        this.detonate(s);
        return;
      }
      if (d < near) {
        near = d;
        prey = ship;
      }
    }
    if (prey) {
      const dx = prey.pos.x - s.x;
      const dz = prey.pos.z - s.z;
      const k = (s.seekSpeed * dt) / (Math.hypot(dx, dz) || 1);
      s.x += dx * k;
      s.z += dz * k;
    }
  }

  private updateShock(s: Strike, dt: number): void {
    const g = this.game;
    if (s.follow && s.owner.alive) {
      s.x = s.owner.pos.x;
      s.z = s.owner.pos.z;
    }
    s.landed = true;
    s.ring = Math.min(s.radius, s.ring + s.speed * dt);
    for (const ship of g.ships) {
      if (!ship.alive || s.hit.has(ship.id)) continue;
      if (Math.hypot(ship.pos.x - s.x, ship.pos.z - s.z) - ship.spec.length / 2 > s.ring) continue;
      s.hit.add(ship.id);
      if (ship.team === s.team) {
        if (s.heal > 0) ship.heal(ship.maxHp * s.heal);
      } else if (this.canHit(s, ship)) {
        this.apply(s, ship, 1);
      }
    }
    if (s.ring >= s.radius) s.alive = false;
  }
}

/** EMP: no weapons, no skills, engines and rudder idle. */
export function stun(ship: Ship, time: number): void {
  if (ship.spec.cls === 'TT') time *= 0.4;
  time *= ship.trait?.stunTakenMul ?? 1;
  ship.addEffect({
    id: 'debuff:stun',
    time,
    apply(m) {
      m.stunned = true;
    },
  });
}
