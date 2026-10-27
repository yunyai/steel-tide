import { elementalShellHit } from '../skills/misc/ArchitectElements';
import { MAP_HALF, SHELL_TIME_SCALE, SIM_DT, WALL_HEIGHT } from '../config';
import type { Game } from '../core/Game';
import { bearingTo, dist2D, forwardX, forwardZ, segmentBox } from '../core/math';
import type { AmmoType, GunLook, HitOutcome, ShellSpec, SkillSpec, Team } from '../core/types';
import { DAMAGE_FACTOR, resolveShellHit, type HitGeometry, type HitResolution } from '../ships/Armor';
import { hullHalfWidth } from '../ships/HullShape';
import type { Ship } from '../ships/Ship';
import { dragK, penAtVelocity, solve, type RangeTable } from './Ballistics';

export interface Shell {
  id: number;
  owner: Ship;
  team: Team;
  ammo: AmmoType;
  spec: ShellSpec;
  k: number;
  x: number;
  /** Physics height (trajectory computed from y = 0). */
  py: number;
  z: number;
  /** Rendered/collision height including the decaying muzzle-height offset. */
  y: number;
  vx: number;
  vy: number;
  vz: number;
  h0: number;
  targetHeight?: number;
  age: number;
  flight: number;
  skill?: SkillSpec;
  dmgMul: number;
  guaranteedFire: boolean;
  railgun: boolean;
  secondary: boolean;
  bomb: boolean;
  pierce: number;
  hit: number[];
  alive: boolean;
  maxDist: number;
  travelled: number;
  /** Bursts into fire bomblets where it lands (Sakura Cluster). */
  cluster: SkillSpec | null;
  /** Flies a straight line (railguns, coilguns, lasers) instead of a ballistic arc. */
  straight: boolean;
  /** Called on each hull it hits. */
  onHit: ((target: Ship, x: number, z: number) => void) | null;
  /** How the round looks in flight. */
  element?: {owner:Ship;slot:number;splash?:number;kind?:import('../data/architectLoadout').ArchitectElement};
  look: GunLook;
}

export interface FireOptions {
  ammo: AmmoType;
  spec: ShellSpec;
  table: RangeTable;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toZ: number;
  toY?: number;
  skill?: SkillSpec;
  dmgMul: number;
  guaranteedFire: boolean;
  railgun: boolean;
  secondary?: boolean;
  cluster?: SkillSpec;
  /** Fly flat at this multiple of muzzle velocity (railgun mode is 3, with piercing). */
  flat?: number;
  onHit?: (target: Ship, x: number, z: number) => void;
  element?: {owner:Ship;slot:number;splash?:number;kind?:import('../data/architectLoadout').ArchitectElement};
  look?: GunLook;
}

export class ShellSystem {
  shells: Shell[] = [];

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  fire(owner: Ship, o: FireOptions): Shell {
    const d = dist2D(o.fromX, o.fromZ, o.toX, o.toZ);
    const b = bearingTo(o.fromX, o.fromZ, o.toX, o.toZ);
    const hx = Math.sin(b);
    const hz = -Math.cos(b);
    const element=o.element??(owner.architectPlatform?{owner:owner.architectPlatform.owner,slot:owner.architectPlatform.index}:undefined);
    const s: Shell = {
      id: this.nextId++,
      owner,
      team: owner.team,
      ammo: o.ammo,
      spec: o.spec,
      k: dragK(o.spec),
      x: o.fromX,
      py: 0,
      z: o.fromZ,
      y: o.fromY,
      vx: 0,
      vy: 0,
      vz: 0,
      h0: o.fromY,
      targetHeight: o.toY ?? 0,
      age: 0,
      flight: 1,
      dmgMul: o.dmgMul,
      skill: o.skill,
      guaranteedFire: o.guaranteedFire,
      railgun: o.railgun,
      secondary: !!o.secondary,
      bomb: false,
      pierce: o.railgun ? 3 : 0,
      hit: [],
      alive: true,
      maxDist: o.table.maxRange * 1.3,
      travelled: 0,
      cluster: o.cluster ?? null,
      straight: o.railgun || (o.flat ?? 0) > 0,
      onHit: o.onHit ?? null,
      element:element?{...element,kind:element.kind??element.owner.architect?.slots[element.slot]?.element}:undefined,
      look: o.look ?? 'shell',
    };
    if (s.straight) {
      // Hypervelocity: straight line toward the aim point at hull height.
      const v = o.spec.velocity * (o.railgun ? Math.max(3, o.flat ?? 0) : o.flat!);
      const dy = (o.toY ?? 4) - o.fromY;
      const len = Math.hypot(d, dy);
      s.vx = (hx * d * v) / len;
      s.vz = (hz * d * v) / len;
      s.vy = (dy * v) / len;
      s.py = o.fromY;
      s.h0 = 0;
      s.targetHeight = 0;
      s.k = 0;
      s.flight = len / v / SHELL_TIME_SCALE;
    } else {
      const sol = solve(o.table, d);
      const v = o.spec.velocity;
      s.vx = hx * v * Math.cos(sol.elevation);
      s.vz = hz * v * Math.cos(sol.elevation);
      s.vy = v * Math.sin(sol.elevation);
      s.flight = Math.max(0.05, sol.time);
    }
    this.shells.push(s);
    return s;
  }

  /** Aerial bomb dropped from altitude straight down onto (x, z). */
  dropBomb(owner: Ship, spec: ShellSpec, x: number, z: number, alt: number, dmgMul = 1): Shell {
    const s: Shell = {
      id: this.nextId++,
      owner,
      team: owner.team,
      ammo: 'HE',
      spec,
      k: 0,
      x,
      py: alt,
      z,
      y: alt,
      vx: 0,
      vy: -90,
      vz: 0,
      h0: 0,
      age: 0,
      flight: 3,
      dmgMul,
      guaranteedFire: false,
      railgun: false,
      secondary: false,
      bomb: true,
      pierce: 0,
      hit: [],
      alive: true,
      maxDist: 1e9,
      travelled: 0,
      cluster: null,
      straight: false,
      onHit: null,
      look: 'shell',
    };
    this.shells.push(s);
    return s;
  }

  update(dt: number): void {
    const g = this.game;
    for (const s of this.shells) {
      if (!s.alive) continue;
      const ox = s.x;
      const oy = s.y;
      const oz = s.z;
      integrate(s, dt * g.fields.timeScale(s.team, s.x, s.z));

      if (this.collideShips(s, ox, oy, oz)) {
        if (s.cluster) this.burst(s, s.x, s.z);
        continue;
      }

      // An ice wall stops low shells that cross it.
      if (g.walls.length && Math.min(oy, s.y) < WALL_HEIGHT) {
        const t = g.wallHit(s.team, ox, oz, s.x, s.z);
        if (t >= 0) {
          s.alive = false;
          g.events.emit('intercept', { x: ox + (s.x - ox) * t, y: oy + (s.y - oy) * t, z: oz + (s.z - oz) * t });
          continue;
        }
      }

      if (s.y <= 0) {
        s.alive = false;
        // Interpolate the water entry point for the splash.
        const f = oy / Math.max(1e-6, oy - s.y);
        const wx = ox + (s.x - ox) * f;
        const wz = oz + (s.z - oz) * f;
        if (s.cluster) this.burst(s, wx, wz);
        if (s.bomb) g.depth.bombSplash(s.owner, wx, wz, s.spec.damage * s.dmgMul);
        g.events.emit('splash', { x: wx, y: 0, z: wz, caliber: s.spec.caliber });
        continue;
      }
      if (s.y < 260 && g.map.heightAt(s.x, s.z) > s.y) {
        s.alive = false;
        g.events.emit('terrainHit', { x: s.x, y: s.y, z: s.z, caliber: s.spec.caliber });
        continue;
      }
      if (s.travelled > s.maxDist || Math.abs(s.x) > MAP_HALF + 1500 || Math.abs(s.z) > MAP_HALF + 1500) s.alive = false;
    }
    if (this.shells.length > 64 && this.shells.some((s) => !s.alive)) {
      this.shells = this.shells.filter((s) => s.alive);
    }
  }

  /** Scatter burning bomblets around a cluster shell's impact. */
  private burst(s: Shell, x: number, z: number): void {
    const g = this.game;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + g.rng();
      const r = 25 + g.rng() * 45;
      g.strikes.spawn(s.owner, {
        kind: 'cluster',
        skill: s.cluster,
        x: x + Math.cos(a) * r,
        z: z + Math.sin(a) * r,
        radius: 28,
        delay: 0.25 + g.rng() * 0.35,
        damage: 1200,
        fire: 0.25,
      });
    }
  }

  private collideShips(s: Shell, ox: number, oy: number, oz: number): boolean {
    const g = this.game;
    const segLen = Math.hypot(s.x - ox, s.y - oy, s.z - oz);
    for (const ship of g.ships) {
      if (!ship.alive || ship.team === s.team || s.hit.includes(ship.id)) continue;
      if (ship.submerged || ship.mods.banished) continue;
      const reach = ship.spec.length / 2 + segLen + 10;
      const cx = ship.pos.x - s.x;
      const cz = ship.pos.z - s.z;
      if (cx * cx + cz * cz > reach * reach) continue;
      const hit = hitGeometry(ship, ship.pos.x, ship.pos.y, ship.pos.z, ship.heading, ox, oy, oz, s.x, s.y, s.z);
      if (!hit) continue;
      const wx = ox + (s.x - ox) * hit.t;
      const wy = oy + (s.y - oy) * hit.t;
      const wz = oz + (s.z - oz) * hit.t;
      this.applyHit(s, ship, hit.geo, wx, wy, wz);
      if (s.pierce > 0) {
        s.pierce--;
        s.hit.push(ship.id);
        continue;
      }
      s.alive = false;
      return true;
    }
    return false;
  }

  /**
   * Where a shell in flight will land, if it hits a hull within `horizon` game seconds.
   * Enemies are moved along their current heading at their current speed; the armour roll
   * uses a fixed rng, so the outcome is the most likely one rather than the one that will happen.
   */
  predictImpact(shell: Shell, horizon: number): ShellPrediction | null {
    const g = this.game;
    const c: Shell = { ...shell, hit: [...shell.hit] };
    for (let t = SIM_DT; t <= horizon + 1e-9; t += SIM_DT) {
      const ox = c.x;
      const oy = c.y;
      const oz = c.z;
      integrate(c, SIM_DT);
      const segLen = Math.hypot(c.x - ox, c.y - oy, c.z - oz);
      for (const ship of g.ships) {
        if (!ship.alive || ship.team === c.team || c.hit.includes(ship.id) || ship.submerged) continue;
        const px = ship.pos.x + forwardX(ship.heading) * ship.speed * t;
        const pz = ship.pos.z + forwardZ(ship.heading) * ship.speed * t;
        const reach = ship.spec.length / 2 + segLen + 10;
        if ((px - c.x) * (px - c.x) + (pz - c.z) * (pz - c.z) > reach * reach) continue;
        const hit = hitGeometry(ship, px, ship.pos.y, pz, ship.heading, ox, oy, oz, c.x, c.y, c.z);
        if (!hit) continue;
        const res = this.resolve(c, ship, hit.geo, () => 0.5);
        const damage = res.factor > 0 ? c.spec.damage * res.factor * c.dmgMul * ship.mods.damageTakenMul : 0;
        return {
          ship,
          t: t - SIM_DT + SIM_DT * hit.t,
          x: ox + (c.x - ox) * hit.t,
          y: oy + (c.y - oy) * hit.t,
          z: oz + (c.z - oz) * hit.t,
          outcome: res.outcome,
          damage,
        };
      }
      if (c.y <= 0 || c.travelled > c.maxDist) return null;
      if (g.walls.length && Math.min(oy, c.y) < WALL_HEIGHT && g.wallHit(c.team, ox, oz, c.x, c.z) >= 0) return null;
      if (c.y < 260 && g.map.heightAt(c.x, c.z) > c.y) return null;
    }
    return null;
  }

  private resolve(s: Shell, ship: Ship, geo: HitGeometry, rng: () => number): HitResolution {
    // Flat-firing guns (lasers, coilguns) only fly faster for feel: they strike, pen and fuse like a
    // round at muzzle velocity, or nearly every hit would sail clean through and overpen.
    const impactV = s.railgun ? s.spec.velocity * 3 : s.straight ? s.spec.velocity : Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    const pen = s.ammo === 'AP' ? penAtVelocity(s.spec, impactV) * (s.railgun ? 1.5 : 1) : s.spec.pen;
    const res = resolveShellHit(ship.spec, geo, s.ammo, s.spec, pen, impactV, rng);
    // Hexed hulls cannot turn a round away.
    if (ship.mods.noBounce && (res.outcome === 'ricochet' || res.outcome === 'shatter')) {
      return { ...res, outcome: 'penetration', factor: DAMAGE_FACTOR.penetration };
    }
    return res;
  }

  private applyHit(s: Shell, ship: Ship, geo: HitGeometry, wx: number, wy: number, wz: number): void {
    const g = this.game;
    const res = this.resolve(s, ship, geo, g.rng);
    let damage = 0;
    if (res.factor > 0) {
      const raw = s.spec.damage * res.factor * s.dmgMul * (s.ammo === 'AP' ? ship.mods.apTakenMul : 1) * s.owner.critMul(ship);
      damage = ship.takeDamage(res.outcome === 'citadel' ? raw : ship.zoneDamage(res.zone, raw), s.owner, s.skill ?? null);
      // A citadel hit that sinks the ship sets off its magazines.
      if (!ship.alive && res.outcome === 'citadel' && !s.secondary) ship.detonate(s.owner);
    }
    if ((ship.stepper?.phaseUntil ?? 0) > g.time) return;
    const attacker = s.owner;
    attacker.stats.hits++;
    if(s.element&&damage>0)elementalShellHit(s.element.owner,s.element.slot,ship,s.element.splash,s.spec.damage,{x:wx,y:wy,z:wz},s.element.kind);
    if (s.onHit && ship.alive) s.onHit(ship, wx, wz);
    if (res.outcome === 'citadel') attacker.stats.citadels++;
    // Fires from HE, module damage from penetrations.
    if (res.outcome === 'he') {
      const resist = ship.spec.cls === 'BB' ? 0.1 : 0;
      if (s.guaranteedFire || g.rng() < (s.spec.fireChance ?? 0) * (1 - resist)) ship.startFire(ship.fireSiteAt(geo.x), attacker);
    }
    if (res.factor > 0 && res.turretIndex >= 0 && g.rng() < (s.ammo === 'AP' ? 0.25 : 0.08)) {
      ship.turrets[res.turretIndex].disabled = 12;
    }
    if (res.factor > 0 && res.zone === 'stern' && g.rng() < 0.05) {
      if (g.rng() < 0.5) ship.rudderJam = 6;
      else ship.engineDown = 6;
    }
    // Lightning Rod: a main-battery hit calls a bolt down onto the same spot.
    const rod = attacker.mods.boltOnHit;
    if (rod > 0 && !s.secondary && res.factor > 0 && ship.alive) {
      g.events.emit('lightning', {
        points: [
          { x: wx + (g.rng() - 0.5) * 200, y: 1300, z: wz + (g.rng() - 0.5) * 200 },
          { x: wx + (g.rng() - 0.5) * 60, y: 500, z: wz + (g.rng() - 0.5) * 60 },
          { x: wx, y: wy, z: wz },
        ],
        color: attacker.mods.boltSkill?.accent ?? 0xe7d2ff,
      });
      ship.takeDamage(rod * attacker.mods.damageMul, attacker, attacker.mods.boltSkill);
    }
    g.events.emit('shellHit', {
      element:s.element?.kind,
      attacker,
      target: ship,
      outcome: s.secondary && res.factor > 0 ? 'secondary' : res.outcome,
      damage,
      x: wx,
      y: wy,
      z: wz,
      caliber: s.spec.caliber,
      ammo: s.ammo,
      secondary: s.secondary,
    });
  }
}

export interface ShellPrediction {
  ship: Ship;
  /** Game seconds from now until impact. */
  t: number;
  x: number;
  y: number;
  z: number;
  outcome: HitOutcome;
  /** Damage before shields and zone saturation. */
  damage: number;
}

/** Advance a shell by one step of `dt` game seconds. */
function integrate(s: Shell, dt: number): void {
  const rdt = dt * SHELL_TIME_SCALE;
  const ox = s.x;
  const oz = s.z;
  if (s.straight) {
    s.x += s.vx * rdt;
    s.py += s.vy * rdt;
    s.z += s.vz * rdt;
  } else {
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    s.vx += -s.k * v * s.vx * rdt;
    s.vz += -s.k * v * s.vz * rdt;
    s.vy += (-9.81 - s.k * v * s.vy) * rdt;
    s.x += s.vx * rdt;
    s.z += s.vz * rdt;
    s.py += s.vy * rdt;
  }
  s.age += dt;
  const progress = Math.min(1, s.age / s.flight);
  s.y = s.py + s.h0 * (1 - progress) + (s.targetHeight ?? 0) * progress;
  s.travelled += Math.hypot(s.x - ox, s.z - oz);
}

/**
 * Where the segment (o -> p) first meets a ship's hull or superstructure, for a ship posed at
 * (px, py, pz) with `heading`. `t` is the fraction along the segment; `geo` is in ship space.
 */
export function hitGeometry(
  ship: Ship,
  px: number,
  py: number,
  pz: number,
  heading: number,
  ox: number,
  oy: number,
  oz: number,
  x: number,
  y: number,
  z: number,
): { t: number; geo: HitGeometry } | null {
  const spec = ship.spec;
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = Math.sin(heading);
  const ax = ox - px;
  const az = oz - pz;
  const p0x = ax * fx + az * fz;
  const p0z = ax * rx + az * rz;
  const p0y = oy - py;
  const bx = x - px;
  const bz = z - pz;
  const dx = bx * fx + bz * fz - p0x;
  const dz = bx * rx + bz * rz - p0z;
  const dy = y - py - p0y;
  const half = spec.length / 2;
  const hb = spec.beam / 2;
  let best: { t: number; axis: 0 | 1 | 2; part: 'hull' | 'super' } | null = null;
  const hullHit = segmentBox(p0x, p0y, p0z, dx, dy, dz, [-half, -spec.draft, -hb], [half, spec.freeboard * 1.15, hb]);
  if (hullHit) {
    // The box is wider than the tapered hull; march to the real plating.
    for (let i = 0; i <= 10; i++) {
      const t = hullHit.t + ((hullHit.tExit - hullHit.t) * i) / 10;
      const lx = p0x + dx * t;
      const lz = p0z + dz * t;
      if (Math.abs(lz) <= hullHalfWidth(spec, lx) + 0.3) {
        const axis: 0 | 1 | 2 = i === 0 ? hullHit.axis : 2;
        best = { t, axis: axis === 0 && Math.abs(lx) < half - 3 ? 2 : axis, part: 'hull' };
        break;
      }
    }
  }
  const sb = ship.superBox;
  if (sb) {
    const sh = segmentBox(p0x, p0y, p0z, dx, dy, dz, [sb.x0, spec.freeboard, -sb.hw], [sb.x1, sb.top, sb.hw]);
    if (sh && (!best || sh.t < best.t)) best = { t: sh.t, axis: sh.axis, part: 'super' };
  }
  if (!best) return null;
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    t: best.t,
    geo: {
      x: p0x + dx * best.t,
      y: p0y + dy * best.t,
      z: p0z + dz * best.t,
      dx: dx / len,
      dy: dy / len,
      dz: dz / len,
      axis: best.axis,
      part: best.part,
    },
  };
}
