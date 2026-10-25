import type { SkillSpec } from '../../../core/types';
import { hitVehicle, penetrate } from '../armor';
import type { GroundGame } from '../GroundGame';
import type { Vehicle } from '../Vehicle';

// Rockets and missiles. Unguided rockets fly a lofted arc to a point picked at launch; beam
// riders steer for the owner's live crosshair; top-attack missiles climb and dive on a locked
// hull; homing ones (drones, skill missiles) chase their target.

export type Guidance = 'none' | 'beam' | 'top' | 'homing';

export interface MissileInit {
  owner: Vehicle;
  x: number;
  y: number;
  z: number;
  /** Aim point (unguided: where it comes down). */
  tx: number;
  ty: number;
  tz: number;
  speed: number;
  damage: number;
  pen: number;
  splash: number;
  guidance: Guidance;
  target: Vehicle | null;
  look: string;
  skill: SkillSpec | null;
  /** Leaves a patch of fire where it lands. */
  fire?: boolean;
  /** Seconds before it starts flying (staggered barrages). */
  delay?: number;
  /** Loft of an unguided arc as a share of its range (default 0.14). */
  loft?: number;
  /** Damage to props on the blast, as a share of `damage` (default 0.6). */
  props?: number;
  /** Stun seconds on hulls caught in the blast. */
  stun?: number;
}

export interface Missile extends MissileInit {
  id: number;
  sx: number;
  sy: number;
  sz: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Unguided arcs: progress 0..1 and flight time. */
  s: number;
  dur: number;
  age: number;
  alive: boolean;
  screened: number[];
}

/** Turn rate of steering missiles, rad/s. */
const TURN = { beam: 1.6, top: 2.2, homing: 2.8 };

export class Missiles {
  list: Missile[] = [];
  private nextId = 1;

  constructor(private g: GroundGame) {}

  launch(init: MissileInit): Missile {
    const dx = init.tx - init.x;
    const dz = init.tz - init.z;
    const dist = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, -dz);
    const up = init.guidance === 'top' ? 0.7 : init.guidance === 'none' ? 0.35 : 0.08;
    const m: Missile = {
      ...init,
      id: this.nextId++,
      sx: init.x,
      sy: init.y,
      sz: init.z,
      px: init.x,
      py: init.y,
      pz: init.z,
      vx: Math.sin(yaw) * Math.cos(up) * init.speed,
      vy: Math.sin(up) * init.speed,
      vz: -Math.cos(yaw) * Math.cos(up) * init.speed,
      s: 0,
      dur: Math.max(0.3, dist / init.speed),
      age: 0,
      alive: true,
      screened: [],
    };
    this.list.push(m);
    return m;
  }

  update(dt: number): void {
    const g = this.g;
    for (const m of this.list) {
      if (!m.alive) continue;
      if (m.delay && m.delay > 0) {
        m.delay -= dt;
        continue;
      }
      m.px = m.x;
      m.py = m.y;
      m.pz = m.z;
      m.age += dt;
      if (m.guidance === 'none') {
        m.s = Math.min(1, m.s + dt / m.dur);
        const dist = Math.hypot(m.tx - m.sx, m.tz - m.sz);
        const loft = dist * (m.loft ?? 0.14);
        m.x = m.sx + (m.tx - m.sx) * m.s;
        m.z = m.sz + (m.tz - m.sz) * m.s;
        m.y = m.sy + (m.ty - m.sy) * m.s + 4 * loft * m.s * (1 - m.s);
        m.vx = (m.x - m.px) / dt;
        m.vy = (m.y - m.py) / dt;
        m.vz = (m.z - m.pz) / dt;
      } else {
        this.steer(m, dt);
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.z += m.vz * dt;
      }
      if (g.screen(m.owner, m.x, m.y, m.z, m.screened, 0.9)) {
        m.alive = false;
        continue;
      }
      this.trace(m);
      if (m.alive && (m.age > 20 || m.s >= 1)) this.burst(m, m.x, g.terrain.surfaceAt(m.x, m.z), m.z, null);
    }
    if (this.list.some((m) => !m.alive)) this.list = this.list.filter((m) => m.alive);
  }

  private steer(m: Missile, dt: number): void {
    let tx = m.tx;
    let ty = m.ty;
    let tz = m.tz;
    if (m.guidance === 'beam' && m.owner.alive) {
      const c = m.owner.control;
      tx = c.aimX;
      ty = c.aimY;
      tz = c.aimZ;
    } else if (m.target?.alive) {
      tx = m.target.x;
      ty = m.target.y + 1.2;
      tz = m.target.z;
    }
    if (m.guidance === 'top') {
      // Climb until close, then dive onto the roof.
      const d = Math.hypot(tx - m.x, tz - m.z);
      if (d > 90) ty = Math.max(ty + 70, m.y);
    }
    const sp = Math.hypot(m.vx, m.vy, m.vz) || 1;
    let wx = tx - m.x;
    let wy = ty - m.y;
    let wz = tz - m.z;
    const wl = Math.hypot(wx, wy, wz) || 1;
    wx /= wl;
    wy /= wl;
    wz /= wl;
    const k = Math.min(1, TURN[m.guidance as 'beam' | 'top' | 'homing'] * dt);
    let nx = m.vx / sp + (wx - m.vx / sp) * k;
    let ny = m.vy / sp + (wy - m.vy / sp) * k;
    let nz = m.vz / sp + (wz - m.vz / sp) * k;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    m.vx = nx * m.speed;
    m.vy = ny * m.speed;
    m.vz = nz * m.speed;
  }

  private trace(m: Missile): void {
    const g = this.g;
    for (const v of g.vehicles) {
      if (!v.alive || v.team === m.owner.team || v.mods.untargetable) continue;
      if (Math.hypot(v.x - m.x, v.z - m.z) > v.spec.size.length + 8) continue;
      const hit = hitVehicle(v.spec, v.pose, m.px, m.py, m.pz, m.x, m.y, m.z);
      if (!hit) continue;
      const x = m.px + (m.x - m.px) * hit.t;
      const y = m.py + (m.y - m.py) * hit.t;
      const z = m.pz + (m.z - m.pz) * hit.t;
      const res = penetrate(hit, 'HEAT', 150, m.pen * m.owner.mods.penMul, v.mods.exposed);
      const dmg = res.outcome === 'pen' ? m.damage : m.damage * 0.25;
      const done = v.damage(dmg, m.owner, m.skill);
      m.owner.stats.hits++;
      if (res.outcome === 'pen') m.owner.stats.pens++;
      g.events.emit('shellHit', { attacker: m.owner, target: v, outcome: res.outcome, face: hit.face, damage: done, x, y, z, caliber: 150, ammo: 'HEAT' });
      this.burst(m, x, y, z, v);
      return;
    }
    const ph = g.props.segment(m.px, m.py, m.pz, m.x, m.y, m.z, (p) => p.team === m.owner.team);
    if (ph) {
      this.burst(m, m.px + (m.x - m.px) * ph.t, m.py + (m.y - m.py) * ph.t, m.pz + (m.z - m.pz) * ph.t, null);
      g.damageProp(ph.prop, m.damage * 0.8, m.owner);
      return;
    }
    const t = g.terrain.segmentHit(m.px, m.py, m.pz, m.x, m.y, m.z);
    if (t >= 0) {
      const x = m.px + (m.x - m.px) * t;
      const z = m.pz + (m.z - m.pz) * t;
      this.burst(m, x, g.terrain.surfaceAt(x, z), z, null);
    }
  }

  private burst(m: Missile, x: number, y: number, z: number, direct: Vehicle | null): void {
    const g = this.g;
    m.alive = false;
    g.events.emit('impact', { x, y, z, caliber: 150, surface: 'ground', he: true });
    if (m.splash > 0) {
      g.blast(m.owner, x, y, z, m.splash, m.damage * 0.45, { skill: m.skill, skip: direct, props: m.props ?? 0.6, stun: m.stun });
    }
    if (m.fire) g.fields.add({ owner: m.owner, x, z, r: Math.max(6, m.splash), life: 6, enemyDps: m.damage * 0.12, color: 0xff7a2a, skill: m.skill, fire: true });
  }
}
