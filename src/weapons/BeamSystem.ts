import { MAP_HALF } from '../config';
import type { Game } from '../core/Game';
import { distToHull, segmentHitsHull } from '../core/hull';
import { DEG, approachAngle, bearingTo, clamp, dist2D, forwardX, forwardZ } from '../core/math';
import type { SkillSpec, Team } from '../core/types';
import type { Ship } from '../ships/Ship';

// Directed-energy weapons for skills: a bow cannon fixed to the heading, a turret beam that tracks
// the reticle, an orbital pillar that chases it across the sea, and a blade that sweeps a half
// circle centred on the reticle's bearing.

export type BeamMode = 'bow' | 'aim' | 'orbital' | 'sweep';

export interface BeamOptions {
  mode: BeamMode;
  skill: SkillSpec;
  /** Wind-up before the beam fires (seconds). */
  charge: number;
  /** Seconds of firing. */
  time: number;
  /** Damage per second to each hull in the beam. */
  dps: number;
  /** Bow/aim: reach in metres. */
  length?: number;
  /** Beam width (bow/aim), or the pillar's diameter (orbital). */
  width: number;
  /** Passes through every hull on the line instead of stopping at the first. */
  pierce?: boolean;
  /** Aim: degrees per second the beam swings; orbital: metres per second the pillar moves. */
  rate?: number;
  /** Bow: degrees per second the ship is swung toward the reticle. */
  steer?: number;
  /** Chance per second of starting a fire on a hull in the beam. */
  fireChance?: number;
  /** Knockback (m/s) away from the beam. */
  knock?: number;
  /** Ship-local muzzle (x forward, y up). */
  mx?: number;
  my?: number;
  /** Damage dealt once to each hull the beam first touches (the sweep's cut). */
  strike?: number;
  /** Sweep: degrees swept over the firing time. */
  arc?: number;
  /** Called every tick for each hull the beam is burning (debuffs such as Frost Lance's chill). */
  onHit?: (target: Ship, dt: number) => void;
}

export interface Beam extends Required<Omit<BeamOptions, 'skill' | 'onHit'>> {
  onHit?: BeamOptions['onHit'];
  /** Sweep: bearing of the middle of the arc. */
  centre: number;
  /** Ships the strike has already cut. */
  struck: Set<number>;
  id: number;
  owner: Ship;
  team: Team;
  skill: SkillSpec;
  /** World start and end of the beam this tick (orbital: the pillar's foot is x1/z1). */
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** World bearing of an aimed beam. */
  yaw: number;
  /** Seconds since the beam started charging. */
  age: number;
  alive: boolean;
  /** Ships the beam is touching this tick (render sparks). */
  touching: Ship[];
  /** Damage banked per target, paid out in chunks so popups stay readable. */
  bank: Map<Ship, number>;
  payout: number;
}

/** Beam damage is applied in chunks this often. */
const PAYOUT = 0.25;
/** Height of a ship-mounted beam above the water. */
const BEAM_Y = 10;

export class BeamSystem {
  beams: Beam[] = [];

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  fire(owner: Ship, o: BeamOptions): Beam {
    const b: Beam = {
      id: this.nextId++,
      owner,
      team: owner.team,
      length: 3000,
      pierce: false,
      rate: 30,
      steer: 0,
      fireChance: 0,
      knock: 0,
      strike: 0,
      arc: 180,
      mx: owner.spec.length * 0.45,
      my: owner.spec.freeboard + 4,
      ...o,
      x0: owner.pos.x,
      y0: BEAM_Y,
      z0: owner.pos.z,
      x1: owner.control.aimX,
      y1: 0,
      z1: owner.control.aimZ,
      yaw: owner.heading,
      centre: 0,
      struck: new Set(),
      age: 0,
      alive: true,
      touching: [],
      bank: new Map(),
      payout: PAYOUT,
    };
    if (o.mode === 'aim') b.yaw = bearingTo(owner.pos.x, owner.pos.z, owner.control.aimX, owner.control.aimZ);
    if (o.mode === 'sweep') b.centre = bearingTo(owner.pos.x, owner.pos.z, owner.control.aimX, owner.control.aimZ);
    if (o.mode === 'orbital') {
      b.x1 = owner.control.aimX;
      b.z1 = owner.control.aimZ;
    }
    this.place(b, 0);
    this.beams.push(b);
    return b;
  }

  /** True while the beam is past its wind-up. */
  firing(b: Beam): boolean {
    return b.alive && b.age >= b.charge;
  }

  update(dt: number): void {
    for (const b of this.beams) {
      if (!b.alive) continue;
      b.age += dt;
      if (!b.owner.alive || b.owner.mods.stunned || b.age > b.charge + b.time) {
        this.flush(b);
        b.alive = false;
        continue;
      }
      this.place(b, dt);
      b.touching.length = 0;
      if (b.age < b.charge) continue;
      this.burn(b, dt);
      b.payout -= dt;
      if (b.payout <= 0) {
        b.payout = PAYOUT;
        this.flush(b);
      }
    }
    if (this.beams.length > 8 && this.beams.some((b) => !b.alive)) this.beams = this.beams.filter((b) => b.alive);
  }

  /** Move the beam with its ship and the reticle, and clip it against land. */
  private place(b: Beam, dt: number): void {
    const s = b.owner;
    const c = s.control;
    if (b.mode === 'orbital') {
      const d = dist2D(b.x1, b.z1, c.aimX, c.aimZ);
      const step = Math.min(d, b.rate * dt);
      if (d > 1e-3) {
        b.x1 += ((c.aimX - b.x1) / d) * step;
        b.z1 += ((c.aimZ - b.z1) / d) * step;
      }
      b.x1 = clamp(b.x1, -MAP_HALF, MAP_HALF);
      b.z1 = clamp(b.z1, -MAP_HALF, MAP_HALF);
      b.x0 = b.x1;
      b.z0 = b.z1;
      b.y0 = 1400;
      b.y1 = Math.max(0, this.game.map.heightAt(b.x1, b.z1));
      return;
    }
    if (b.mode === 'bow') {
      if (b.steer > 0) {
        const want = bearingTo(s.pos.x, s.pos.z, c.aimX, c.aimZ);
        s.heading = approachAngle(s.heading, want, b.steer * DEG * dt);
      }
      b.yaw = s.heading;
    } else if (b.mode === 'sweep') {
      const k = clamp((b.age - b.charge) / b.time, 0, 1);
      b.yaw = b.centre + (k - 0.5) * b.arc * DEG;
    } else {
      b.yaw = approachAngle(b.yaw, bearingTo(s.pos.x, s.pos.z, c.aimX, c.aimZ), b.rate * DEG * dt);
    }
    const m = s.localToWorld(b.mx, 0, 0);
    b.x0 = m.x;
    b.y0 = s.pos.y + b.my;
    b.z0 = m.z;
    // Land stops the beam (ships float lower than any shore, so the beam skims the water).
    const fx = forwardX(b.yaw);
    const fz = forwardZ(b.yaw);
    let reach = b.length;
    for (let t = 30; t < b.length; t += 30) {
      if (this.game.map.heightAt(b.x0 + fx * t, b.z0 + fz * t) > BEAM_Y) {
        reach = t;
        break;
      }
    }
    b.x1 = b.x0 + fx * reach;
    b.z1 = b.z0 + fz * reach;
    b.y1 = BEAM_Y * 0.6;
  }

  private burn(b: Beam, dt: number): void {
    const g = this.game;
    const hits: { s: Ship; t: number }[] = [];
    for (const s of g.ships) {
      if (!s.alive || s.team === b.team || s.deep) continue;
      if (b.mode === 'orbital') {
        if (distToHull(s, b.x1, b.z1) <= b.width / 2) hits.push({ s, t: 0 });
        continue;
      }
      const t = segmentHitsHull(s, b.x0, b.z0, b.x1, b.z1, b.width / 2);
      if (t >= 0) hits.push({ s, t });
    }
    if (!hits.length) return;
    hits.sort((a, c) => a.t - c.t);
    if (!b.pierce && b.mode !== 'orbital') {
      hits.length = 1;
      // A blocked beam ends inside the hull it is cutting.
      const ex = hits[0].s.pos.x - b.x0;
      const ez = hits[0].s.pos.z - b.z0;
      const along = ex * forwardX(b.yaw) + ez * forwardZ(b.yaw);
      b.x1 = b.x0 + forwardX(b.yaw) * along;
      b.z1 = b.z0 + forwardZ(b.yaw) * along;
    }
    const mul = b.owner.mods.damageMul * (b.skill.ult ? b.owner.mods.ultDamageMul : 1);
    for (const { s } of hits) {
      b.touching.push(s);
      if (b.strike > 0 && !b.struck.has(s.id)) {
        b.struck.add(s.id);
        s.takeDamage(b.strike * mul, b.owner, b.skill);
        g.events.emit('explosion', { x: s.pos.x, y: s.spec.freeboard, z: s.pos.z, size: 1.6 });
        if (!s.alive) continue;
      }
      b.bank.set(s, (b.bank.get(s) ?? 0) + b.dps * dt * mul);
      if (b.fireChance > 0 && g.rng() < b.fireChance * dt) s.startFire(Math.floor(g.rng() * 4), b.owner);
      b.onHit?.(s, dt);
      if (b.knock > 0) {
        const ax = b.mode === 'orbital' ? s.pos.x - b.x1 : s.pos.x - b.x0;
        const az = b.mode === 'orbital' ? s.pos.z - b.z1 : s.pos.z - b.z0;
        const d = Math.hypot(ax, az) || 1;
        s.shove((ax / d) * b.knock * dt, (az / d) * b.knock * dt, false);
      }
    }
  }

  private flush(b: Beam): void {
    for (const [s, dmg] of b.bank) {
      if (dmg > 0 && s.alive) s.takeDamage(dmg, b.owner, b.skill);
    }
    b.bank.clear();
  }
}
