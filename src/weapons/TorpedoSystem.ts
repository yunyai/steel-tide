import { canTrack } from '../core/Targeting';
import { absorbCube, cubeIntercept } from '../skills/misc/TungstenRuntime';
import { KNOT, MAP_HALF, SPEED_SCALE } from '../config';
import type { Game } from '../core/Game';
import { DEG, approachAngle, bearingTo, forwardX, forwardZ } from '../core/math';
import type { SkillSpec, Team, TorpLook, TorpedoSpec } from '../core/types';
import { hullHalfWidth } from '../ships/HullShape';
import type { Ship } from '../ships/Ship';

export interface Torpedo {
  id: number;
  owner: Ship;
  team: Team;
  x: number;
  z: number;
  heading: number;
  speed: number;
  range: number;
  travelled: number;
  damage: number;
  flood: number;
  detect: number;
  homing: Ship | null;
  /** Spotted by the enemy of the owner. */
  seen: boolean;
  alive: boolean;
  /** Homing torps can strike submerged submarines. */
  deep: boolean;
  /** Launched by a skill (damage popups carry its name). */
  skill: SkillSpec | null;
  /** Steers along the owner's reticle while the owner lives. */
  wire: boolean;
  /** Seen only close in. */
  wakeless: boolean;
  /** Forks into this many when it nears an enemy. */
  split: number;
  /** Fire chance on a hit. */
  fire: number;
  onHit: ((target: Ship) => void) | null;
  look: TorpLook;
}

const ARM_DISTANCE = 120;
/** Share of torpedo kills that set off the magazines. */
const TORP_DETONATION = 0.3;

export class TorpedoSystem {
  torps: Torpedo[] = [];

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  launch(owner: Ship, x: number, z: number, heading: number, spec: TorpedoSpec, homing: Ship | null = null): Torpedo {
    const t: Torpedo = {
      id: this.nextId++,
      owner,
      team: owner.team,
      x,
      z,
      heading,
      speed: spec.speed * KNOT * SPEED_SCALE,
      range: spec.range,
      travelled: 0,
      damage: spec.damage,
      flood: spec.floodChance,
      detect: spec.detect,
      homing,
      seen: false,
      alive: true,
      deep: !!homing,
      skill: null,
      wire: false,
      wakeless: false,
      split: 0,
      fire: 0,
      onHit: null,
      look: spec.look ?? 'torpedo',
    };
    this.torps.push(t);
    return t;
  }

  update(dt: number): void {
    const g = this.game;
    for (let i = 0; i < this.torps.length; i++) {
      const t = this.torps[i];
      if (!t.alive) continue;
      // Wire guidance: run down the owner's line of sight until close to the aim point.
      if (t.wire && t.owner.alive) {
        const ax = t.owner.control.aimX;
        const az = t.owner.control.aimZ;
        if (Math.hypot(ax - t.x, az - t.z) > 120) t.heading = approachAngle(t.heading, bearingTo(t.x, t.z, ax, az), 14 * DEG * dt);
      }
      if (t.homing) {
        if (!canTrack(t.owner, t.homing)) t.homing = null;
        else {
          const tgt = t.homing;
          const d = Math.hypot(tgt.pos.x - t.x, tgt.pos.z - t.z);
          const lead = d / t.speed;
          const px = tgt.pos.x + forwardX(tgt.heading) * tgt.speed * lead * 0.8;
          const pz = tgt.pos.z + forwardZ(tgt.heading) * tgt.speed * lead * 0.8;
          t.heading = approachAngle(t.heading, bearingTo(t.x, t.z, px, pz), 9 * DEG * dt);
        }
      }
      const step = t.speed * dt * g.fields.timeScale(t.team, t.x, t.z);
      const ox = t.x;
      const oz = t.z;
      t.x += forwardX(t.heading) * step;
      t.z += forwardZ(t.heading) * step;
      if (g.walls.length && g.wallHit(t.team, ox, oz, t.x, t.z) >= 0) {
        t.alive = false;
        g.events.emit('explosion', { x: t.x, y: 0, z: t.z, size: 0.8 });
        continue;
      }
      t.travelled += step;
      if (t.travelled > t.range || Math.abs(t.x) > MAP_HALF || Math.abs(t.z) > MAP_HALF) {
        t.alive = false;
        continue;
      }
      if (g.map.heightAt(t.x, t.z) > -3) {
        t.alive = false;
        g.events.emit('explosion', { x: t.x, y: 0, z: t.z, size: 0.6 });
        continue;
      }
      const cube = cubeIntercept(g, t.team, ox, 0, oz, t.x, 0, t.z, 'torpedo');
      if (cube) {
        t.alive = false;
        absorbCube(cube, t.damage, t.owner, t.x, 0, t.z);
        g.events.emit('explosion', { x: t.x, y: 0, z: t.z, size: 0.6 });
        continue;
      }
      if (t.travelled < ARM_DISTANCE) continue;
      // Visibility to the opposing team.
      t.seen = false;
      const detect = t.wakeless ? Math.min(t.detect, 500) : t.detect;
      for (const s of g.ships) {
        if (s.alive && s.team !== t.team && Math.hypot(s.pos.x - t.x, s.pos.z - t.z) < detect * (s.isSearchActive() > 0 ? 2 : 1)) {
          t.seen = true;
          break;
        }
      }
      if (t.split > 1) this.trySplit(t);
      for (const s of g.ships) {
        if (!s.alive || s.pos.y > 20 || s.team === t.team || s.mods.torpImmune || s.mods.banished) continue;
        if (s.deep || (s.submerged && !t.deep)) continue;
        const dx = t.x - s.pos.x;
        const dz = t.z - s.pos.z;
        const r = s.spec.length / 2 + 5;
        if (dx * dx + dz * dz > r * r) continue;
        const h = s.heading;
        const lx = dx * Math.sin(h) - dz * Math.cos(h);
        const lz = dx * Math.cos(h) + dz * Math.sin(h);
        if (Math.abs(lx) <= s.spec.length / 2 && Math.abs(lz) <= hullHalfWidth(s.spec, lx) + 1.5) {
          this.detonate(t, s);
          break;
        }
      }
    }
    if (this.torps.length > 32 && this.torps.some((t) => !t.alive)) this.torps = this.torps.filter((t) => t.alive);
  }

  /** A splitting torpedo forks into a fan once an enemy is within 400 m ahead. */
  private trySplit(t: Torpedo): void {
    const g = this.game;
    for (const s of g.ships) {
      if (!canTrack(t.owner, s)) continue;
      if (Math.hypot(s.pos.x - t.x, s.pos.z - t.z) > 400) continue;
      const n = t.split;
      t.split = 0;
      for (let k = 0; k < n; k++) {
        const off = (k / (n - 1) - 0.5) * 24 * DEG;
        const c: Torpedo = { ...t, id: this.nextId++, heading: t.heading + off, damage: t.damage * 0.6, split: 0, homing: null };
        this.torps.push(c);
      }
      t.alive = false;
      g.events.emit('explosion', { x: t.x, y: 0, z: t.z, size: 0.4 });
      return;
    }
  }

  detonate(t: Torpedo, s: Ship): void {
    const g = this.game;
    t.alive = false;
    const prot = s.spec.armor.torpedoProtection;
    const ult = t.skill?.ult ? t.owner.mods.ultDamageMul : 1;
    const mul = t.owner.mods.damageMul * t.owner.mods.torpDamageMul * s.mods.torpTakenMul * ult;
    const dmg = s.takeDamage(t.damage * (1 - prot) * mul * t.owner.critMul(s), t.owner, t.skill);
    t.owner.stats.torpHits++;
    if (!s.alive && dmg > 0 && g.rng() < TORP_DETONATION) s.detonate(t.owner);
    if (g.rng() < t.flood * (1 - prot)) s.startFlood(t.owner);
    if (s.alive && t.fire > 0 && g.rng() < t.fire) s.startFire(Math.floor(g.rng() * 4), t.owner);
    if (s.alive && t.onHit && (s.stepper?.phaseUntil ?? 0) <= g.time) t.onHit(s);
    g.events.emit('torpHit', { attacker: t.owner, target: s, damage: dmg, x: t.x, z: t.z });
    g.events.emit('explosion', { x: t.x, y: 2, z: t.z, size: 1.4 });
    g.events.emit('ribbon', { ship: t.owner, kind: 'Torpedo Hit', damage: dmg });
  }
}
