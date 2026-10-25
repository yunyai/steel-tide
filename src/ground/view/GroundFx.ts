import type { Vector3 } from 'three';
import { audio } from '../../fx/Audio';
import { PK, type ParticleSystem } from '../../fx/Particles';
import { quality } from '../../render/Quality';
import type { GroundGame } from '../sim/GroundGame';
import { MAT } from '../sim/terrain';
import type { Vehicle } from '../sim/Vehicle';

// Turns ground battle events and vehicle state into particles, sounds and camera shake: muzzle
// blasts that kick up dust, sparks off plates that turned a round, spall through ones that
// did not, dirt and masonry thrown by impacts, houses coming down in their own dust, burning
// wrecks, track dust and engine smoke, and smoke screens that stay thick while they last.

const WIND_X = 0.9;
const WIND_Z = 0.4;
const G = 9.81;

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Dust colour thrown up off each ground material. */
const DUST: Record<number, number> = {
  [MAT.dirt]: 0x7a6650,
  [MAT.grass]: 0x6a6448,
  [MAT.road]: 0x8a8478,
  [MAT.rubble]: 0x8c8274,
  [MAT.snow]: 0xf0f4f8,
  [MAT.deepSnow]: 0xf4f8fc,
  [MAT.ice]: 0xdfeaf2,
  [MAT.water]: 0xe8eef0,
  [MAT.mud]: 0x4a3c2c,
  [MAT.rail]: 0x6a6258,
};

export interface GroundShake {
  x: number;
  z: number;
  amount: number;
}

export class GroundFx {
  private off: (() => void)[] = [];
  private acc = new Map<string, number>();
  /** Camera positions this frame (level of detail). */
  views: Vector3[] = [];
  /** Local human vehicles (for interface sounds and shake). */
  locals: Vehicle[] = [];
  onShake: ((s: GroundShake) => void) | null = null;
  /** The gun of a vehicle fired (the scene kicks its barrel back). */
  onFired: ((v: Vehicle) => void) | null = null;

  constructor(
    private game: GroundGame,
    private alpha: ParticleSystem,
    private add: ParticleSystem,
    private flat: ParticleSystem,
  ) {
    const ev = game.events;
    this.off.push(
      ev.on('gunFired', (e) => this.muzzle(e.v, e.x, e.y, e.z, e.yaw, e.pitch, e.caliber, e.artillery)),
      ev.on('rocketLaunched', (e) => this.backblast(e.v, e.x, e.y, e.z)),
      ev.on('shellHit', (e) => this.hit(e.x, e.y, e.z, e.caliber, e.outcome, e.target, e.attacker, e.ammo === 'HE')),
      ev.on('impact', (e) => this.impact(e.x, e.y, e.z, e.caliber, e.surface, e.he)),
      ev.on('explosion', (e) => this.explosion(e.x, e.y, e.z, e.size)),
      ev.on('intercept', (e) => this.intercept(e.x, e.y, e.z)),
      ev.on('crit', (e) => this.crit(e.v, e.kind)),
      ev.on('propDamaged', (e) => this.propHit(e.prop.x, e.prop.y + e.prop.h * 0.7, e.prop.z, Math.max(e.prop.hw, e.prop.hd))),
      ev.on('propDown', (e) => this.propDown(e.prop.kind, e.prop.x, e.prop.y, e.prop.z, e.prop.hw, e.prop.hd, e.prop.h, e.flattened)),
      ev.on('heal', (e) => this.sparkle(e.v, 0x7aff9a, Math.min(20, 4 + e.amount / 40))),
      ev.on('consumable', (e) => {
        if (e.type === 'repair' || e.type === 'fieldRepair') this.sparkle(e.v, 0xffe08a, 24);
        else this.flat.spawn({ x: e.v.x, y: e.v.y + 0.3, z: e.v.z, life: 0.8, size: 4, size1: 22, color: 0xd8e8ff, alpha: 0.7, kind: PK.Ring, fadeOut: 0.5 });
      }),
      ev.on('blink', (e) => {
        this.flash(e.fromX, e.v.y + 1.5, e.fromZ, 0xb8d8ff, 8);
        this.flash(e.v.x, e.v.y + 1.5, e.v.z, 0xb8d8ff, 10);
        audio.play('zap', e.v.x, e.v.y, e.v.z, 100, 0.8);
      }),
      ev.on('shieldHit', (e) => this.flash(e.v.x, e.v.y + 2, e.v.z, 0x9ad8ff, 3)),
      ev.on('respawn', (e) => this.flat.spawn({ x: e.v.x, y: e.v.y + 0.3, z: e.v.z, life: 1.2, size: 3, size1: 30, color: 0xffffff, alpha: 0.6, kind: PK.Ring, fadeOut: 0.5 })),
    );
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
  }

  private near(x: number, z: number): number {
    let best = Infinity;
    for (const v of this.views) best = Math.min(best, Math.hypot(v.x - x, v.z - z));
    return best === Infinity ? 0 : best;
  }

  private shake(x: number, z: number, amount: number): void {
    this.onShake?.({ x, z, amount });
  }

  private flash(x: number, y: number, z: number, color: number, size: number): void {
    this.add.spawn({ x, y, z, life: 0.25, size, size1: size * 1.8, color: 0xffffff, color1: color, kind: PK.Glow });
  }

  private dustColor(x: number, z: number): number {
    return DUST[this.game.terrain.materialAt(x, z)] ?? DUST[MAT.dirt];
  }

  // ------------------------------------------------------------------ events

  muzzle(v: Vehicle, x: number, y: number, z: number, yaw: number, pitch: number, caliber: number, artillery: boolean): void {
    this.onFired?.(v);
    audio.play('gun', x, y, z, caliber * (artillery ? 1.6 : 1.2), 1);
    if (this.locals.includes(v)) this.shake(x, z, 0.15 + caliber / 600);
    if (this.near(x, z) > 2500) return;
    const c = caliber / 100;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const b = v.spec.size.barrel;
    const mx = x + dx * b;
    const my = y + dy * b;
    const mz = z + dz * b;
    // The flash: a bright core and a cone of fire down the line of the bore.
    for (let i = 0; i < 4; i++) {
      const o = i * (0.4 + c * 0.5);
      this.add.spawn({ x: mx + dx * o, y: my + dy * o, z: mz + dz * o, life: rnd(0.06, 0.12), size: (1.2 + c * 1.6) * (1 - i * 0.18), size1: (2 + c * 2.4) * (1 - i * 0.15), color: 0xfff4c8, color1: 0xff7a20, kind: PK.Glow });
    }
    // Side jets from the muzzle brake.
    if (caliber >= 75 && !artillery) {
      for (const s of [-1, 1]) this.add.spawn({ x: mx, y: my, z: mz, vx: -dz * s * 12, vy: 0, vz: dx * s * 12, life: 0.1, size: 0.8 + c * 0.6, size1: 2 + c, color: 0xffe0a0, color1: 0xff5010, kind: PK.Glow, drag: 4 });
    }
    // Smoke rolling out ahead, then drifting.
    const n = Math.round(4 + c * 4);
    for (let i = 0; i < n; i++) {
      const sp = rnd(3, 18) * (0.5 + c * 0.4);
      this.alpha.spawn({ x: mx + dx * rnd(0, 2), y: my + rnd(-0.2, 0.4), z: mz + dz * rnd(0, 2), vx: dx * sp + rnd(-1, 1) + WIND_X, vy: dy * sp + rnd(0.2, 1.2), vz: dz * sp + rnd(-1, 1) + WIND_Z, life: rnd(1.8, 3.5) * (artillery ? 1.6 : 1), size: 0.8 + c * 0.8, size1: 3 + c * 3.5, color: 0xd8d2c6, color1: 0xa8a296, alpha: 0.5, drag: 1.2, fadeIn: 0.02, fadeOut: 0.4 });
    }
    // The blast kicks the dust up off the ground in a ring.
    if (caliber >= 75) {
      const gy = this.game.terrain.heightAt(mx, mz);
      if (my - gy < 3) {
        const col = this.dustColor(mx, mz);
        const k = Math.min(3, c * 0.8);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const sp = rnd(6, 12) * k;
          this.alpha.spawn({ x: mx, y: gy + 0.4, z: mz, vx: Math.cos(a) * sp + dx * 6, vy: rnd(0.3, 1.2), vz: Math.sin(a) * sp + dz * 6, life: rnd(1.2, 2.2), size: 1 + k, size1: 3 + k * 3, color: col, alpha: 0.45, drag: 2.2, fadeIn: 0.03 });
        }
        this.flat.spawn({ x: mx, y: gy + 0.2, z: mz, life: 0.5, size: 1, size1: 6 + c * 4, color: 0xfff0d8, alpha: 0.5, kind: PK.Ring, fadeOut: 0.6 });
      }
    }
    if (artillery) for (let i = 0; i < 6; i++) this.alpha.spawn({ x: mx, y: my, z: mz, vx: rnd(-1, 1) + WIND_X, vy: rnd(3, 8), vz: rnd(-1, 1) + WIND_Z, life: rnd(4, 6), size: 2, size1: 7, color: 0xc8c2b6, alpha: 0.5, drag: 0.8 });
  }

  backblast(v: Vehicle, x: number, y: number, z: number): void {
    audio.play('missile', x, y, z, 100, 0.35);
    if (this.near(x, z) > 2000) return;
    const fx = Math.sin(v.renderHeading + v.renderTurret);
    const fz = -Math.cos(v.renderHeading + v.renderTurret);
    this.add.spawn({ x, y: y + 0.5, z, life: 0.15, size: 1.2, size1: 2.4, color: 0xffe8b0, color1: 0xff6020, kind: PK.Glow });
    for (let i = 0; i < 4; i++) {
      this.alpha.spawn({ x: x - fx * 1.5, y: y + 0.4, z: z - fz * 1.5, vx: -fx * rnd(6, 14) + rnd(-2, 2), vy: rnd(0.5, 3), vz: -fz * rnd(6, 14) + rnd(-2, 2), life: rnd(2, 3.5), size: 1, size1: 4.5, color: 0xd8d4cc, color1: 0x9a968e, alpha: 0.5, drag: 1.5 });
    }
  }

  hit(x: number, y: number, z: number, caliber: number, outcome: string, target: Vehicle, attacker: Vehicle | null, he: boolean): void {
    const c = caliber / 100;
    const mine = this.locals.includes(target);
    if (mine) this.shake(x, z, outcome === 'pen' ? 0.35 + c * 0.25 : 0.15);
    if (outcome === 'ricochet') {
      audio.play('ricochet', x, y, z, caliber, 0.9);
      if (this.near(x, z) > 1800) return;
      // Sparks off the plate and a streak where the round skipped away.
      for (let i = 0; i < 10; i++) this.add.spawn({ x, y, z, vx: rnd(-14, 14), vy: rnd(2, 14), vz: rnd(-14, 14), gravity: G, life: rnd(0.2, 0.5), size: 0.25 + c * 0.1, color: 0xfff2c0, color1: 0xff8030, kind: PK.Glow });
      this.add.spawn({ x, y, z, life: 0.08, size: 1 + c * 0.4, size1: 1.8 + c * 0.6, color: 0xffffff, color1: 0xffc070, kind: PK.Glow });
      return;
    }
    if (outcome === 'block') {
      audio.play('hit', x, y, z, caliber, 0.7);
      if (this.near(x, z) > 1800) return;
      this.add.spawn({ x, y, z, life: 0.12, size: 0.8 + c * 0.5, size1: 1.6 + c, color: 0xfff0c0, color1: 0xff7020, kind: PK.Glow });
      for (let i = 0; i < 6; i++) this.add.spawn({ x, y, z, vx: rnd(-6, 6), vy: rnd(1, 8), vz: rnd(-6, 6), gravity: G, life: rnd(0.2, 0.4), size: 0.2, color: 0xffd090, kind: PK.Glow });
      this.alpha.spawn({ x, y, z, vx: WIND_X, vy: 1, vz: WIND_Z, life: 1.5, size: 0.6, size1: 2.5, color: 0x5a5650, alpha: 0.5, drag: 1 });
      return;
    }
    if (outcome === 'splash') {
      audio.play('hit', x, y, z, caliber, 0.5);
      return;
    }
    // Through the plate: a bright punch, spall and a puff of smoke from the hole.
    audio.play('hit', x, y, z, caliber * 1.3, 1);
    if (attacker && this.locals.includes(attacker)) audio.ui('citadel');
    if (this.near(x, z) > 2200) return;
    const s = 1.2 + c * 1.2 + (he ? 1 : 0);
    this.add.spawn({ x, y, z, life: 0.16, size: s, size1: s * 2, color: 0xfff6d0, color1: 0xff6a10, kind: PK.Glow });
    this.add.spawn({ x, y, z, life: 0.4, size: s * 0.7, size1: s * 1.4, color: 0xff9a40, color1: 0x601000, kind: PK.Glow });
    for (let i = 0; i < 12; i++) this.add.spawn({ x, y, z, vx: rnd(-10, 10), vy: rnd(2, 12), vz: rnd(-10, 10), gravity: G, life: rnd(0.3, 0.8), size: 0.22 + c * 0.08, color: 0xffe0a0, color1: 0xff4010, kind: PK.Glow });
    for (let i = 0; i < 3; i++) this.alpha.spawn({ x, y, z, vx: WIND_X + rnd(-1, 1), vy: rnd(1, 3), vz: WIND_Z + rnd(-1, 1), life: rnd(2, 3.5), size: s * 0.5, size1: s * 2, color: 0x2e2a26, color1: 0x5a5650, alpha: 0.65, drag: 0.8 });
  }

  impact(x: number, y: number, z: number, caliber: number, surface: string, he: boolean): void {
    const c = caliber / 100;
    const far = this.near(x, z);
    if (surface === 'air') {
      audio.play('flak', x, y, z, 100, 0.7);
      this.add.spawn({ x, y, z, life: 0.15, size: 2 + c * 2, size1: 4 + c * 3, color: 0xffe0a0, color1: 0xff5010, kind: PK.Glow });
      this.alpha.spawn({ x, y, z, vx: rnd(-1, 1), vy: 0.2, vz: rnd(-1, 1), life: rnd(2.5, 4), size: 1.5 + c, size1: 4 + c * 3, color: 0x1e1e1e, color1: 0x444444, alpha: 0.85, drag: 0.6 });
      return;
    }
    if (surface === 'water') {
      audio.play('splash', x, y, z, caliber, 0.6);
      if (far > 2000) return;
      const H = 3 + c * 5 + (he ? 3 : 0);
      const v0 = Math.sqrt(2 * G * H);
      for (let i = 0; i < 12 + c * 6; i++) {
        const r = Math.random();
        const vy = v0 * (0.45 + 0.55 * r);
        this.alpha.spawn({ x: x + rnd(-0.5, 0.5), y, z: z + rnd(-0.5, 0.5), vx: rnd(-1.5, 1.5), vy, vz: rnd(-1.5, 1.5), gravity: G, life: (2 * vy) / G + 0.2, size: 0.6 + c * 0.4, size1: 1.5 + c, color: 0xf4f8fa, alpha: 0.9, kind: PK.Spray, drag: 0.3, fadeOut: 0.7 });
      }
      this.flat.spawn({ x, y: y + 0.05, z, life: 2.5, size: 1, size1: 6 + c * 4, color: 0xffffff, alpha: 0.6, kind: PK.Ring, fadeOut: 0.4 });
      return;
    }
    const prop = surface === 'prop';
    audio.play(he ? 'explosion' : 'hit', x, y, z, he ? 0.25 + c * 0.25 : caliber, he ? 0.8 : 0.45);
    if (far > 2500) return;
    const col = prop ? 0x9a9284 : this.dustColor(x, z);
    const k = (0.6 + c * 0.5) * (he ? 1.5 : 1);
    // A fountain of earth (or masonry chips) and a lingering cloud.
    const n = Math.round((8 + c * 6) * (far > 1200 ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      this.alpha.spawn({ x, y, z, vx: rnd(-1, 1) * 5 * k, vy: rnd(4, 14) * k, vz: rnd(-1, 1) * 5 * k, gravity: G, life: rnd(0.9, 1.8), size: 0.4 + k * 0.4, size1: 1 + k, color: col, alpha: 0.9, kind: PK.Spray });
    }
    for (let i = 0; i < 3 + (he ? 3 : 0); i++) {
      this.alpha.spawn({ x: x + rnd(-1, 1) * k, y: y + rnd(0, k), z: z + rnd(-1, 1) * k, vx: WIND_X + rnd(-1, 1), vy: rnd(0.5, 2), vz: WIND_Z + rnd(-1, 1), life: rnd(3, 6), size: 1.5 * k, size1: 5 * k, color: col, alpha: 0.55, drag: 0.6, fadeIn: 0.05 });
    }
    if (he) {
      this.add.spawn({ x, y: y + 0.5, z, life: 0.18, size: 2 + c * 3, size1: 3 + c * 5, color: 0xfff0b0, color1: 0xff5010, kind: PK.Glow });
      this.flat.spawn({ x, y: y + 0.15, z, life: 0.45, size: 1, size1: 6 + c * 8, color: 0xfff0d0, alpha: 0.5, kind: PK.Ring, fadeOut: 0.5 });
      this.shake(x, z, 0.08 + c * 0.1);
    }
    // A scorch left on the ground.
    if (!prop && c >= 0.75) this.flat.spawn({ x, y: y + 0.08, z, life: 20, size: 1.2 + c, size1: 1.6 + c * 1.4, color: 0x1a1612, alpha: 0.55, kind: PK.Foam, fadeIn: 0.01, fadeOut: 0.5 });
  }

  explosion(x: number, y: number, z: number, size: number): void {
    audio.play('explosion', x, y, z, size * 0.6, 1);
    this.shake(x, z, 0.25 + size * 0.35);
    if (this.near(x, z) > 3500) return;
    const s = size * 2.2;
    for (let i = 0; i < 4 + size * 4; i++) {
      this.add.spawn({ x: x + rnd(-1, 1) * s, y: y + rnd(0, s), z: z + rnd(-1, 1) * s, vx: rnd(-3, 3), vy: rnd(2, 7), vz: rnd(-3, 3), life: rnd(0.4, 1), size: s * 1.8, size1: s * 3.6, color: 0xffe2a0, color1: 0xa02000, kind: PK.Glow, drag: 1.4 });
    }
    for (let i = 0; i < 5 + size * 6; i++) {
      this.alpha.spawn({ x: x + rnd(-1, 1) * s, y: y + rnd(0, s), z: z + rnd(-1, 1) * s, vx: WIND_X + rnd(-2, 2), vy: rnd(2, 6), vz: WIND_Z + rnd(-2, 2), life: rnd(5, 9), size: s * 1.6, size1: s * 5, color: 0x24211e, color1: 0x5d5954, alpha: 0.8, drag: 0.5, fadeIn: 0.04 });
    }
    for (let i = 0; i < 8 + size * 5; i++) {
      this.add.spawn({ x, y, z, vx: rnd(-18, 18), vy: rnd(5, 24), vz: rnd(-18, 18), gravity: G, life: rnd(0.6, 1.6), size: 0.35, color: 0xffd080, color1: 0xff3000, kind: PK.Glow });
    }
    this.add.spawn({ x, y: y + s * 0.5, z, life: 0.15, size: s * 3, size1: s * 5, color: 0xffffff, color1: 0xffc060, kind: PK.Glow });
    const gy = this.game.terrain.heightAt(x, z);
    if (y - gy < s * 2) this.flat.spawn({ x, y: gy + 0.2, z, life: 0.6, size: s, size1: s * 9, color: 0xfff0d0, alpha: 0.7, kind: PK.Ring, fadeOut: 0.5 });
    if (size >= 2.5) {
      // Burning debris trailing out of the big ones.
      for (let i = 0; i < 6 + size * 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(8, 18) * Math.sqrt(size);
        this.add.spawn({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: rnd(12, 28), vz: Math.sin(a) * sp, gravity: G, life: rnd(1.5, 2.8), size: 1.2, size1: 0.5, color: 0xffe0a0, color1: 0xff4000, kind: PK.Glow, drag: 0.2 });
      }
    }
  }

  intercept(x: number, y: number, z: number): void {
    audio.play('flak', x, y, z, 100, 0.6);
    this.add.spawn({ x, y, z, life: 0.12, size: 2.2, size1: 3.5, color: 0xffffff, color1: 0xffa040, kind: PK.Glow });
    for (let i = 0; i < 6; i++) this.add.spawn({ x, y, z, vx: rnd(-12, 12), vy: rnd(-4, 10), vz: rnd(-12, 12), gravity: G, life: rnd(0.2, 0.5), size: 0.25, color: 0xffe0a0, kind: PK.Glow });
    this.alpha.spawn({ x, y, z, life: 2.5, size: 1.5, size1: 4, color: 0x2a2a2a, alpha: 0.7, drag: 0.8 });
  }

  crit(v: Vehicle, kind: string): void {
    const top = v.y + v.spec.size.height;
    if (kind === 'ammo') {
      // The rack goes up: a jet of flame out of the turret ring.
      this.explosion(v.x, top, v.z, 1.4 + v.spec.size.length / 12);
      for (let i = 0; i < 10; i++) this.add.spawn({ x: v.x + rnd(-0.5, 0.5), y: top + i * 1.4, z: v.z + rnd(-0.5, 0.5), vy: rnd(14, 24), life: rnd(0.5, 0.9), size: 2.5, size1: 4, color: 0xfff0c0, color1: 0x902000, kind: PK.Glow, drag: 1.3, fadeIn: 0.04 });
    } else if (kind === 'tracks') {
      audio.play('hit', v.x, v.y, v.z, 120, 0.8);
      for (let i = 0; i < 8; i++) this.add.spawn({ x: v.x, y: v.y + 0.5, z: v.z, vx: rnd(-6, 6), vy: rnd(1, 6), vz: rnd(-6, 6), gravity: G, life: rnd(0.3, 0.6), size: 0.25, color: 0xffe0a0, kind: PK.Glow });
    } else if (kind === 'fire') audio.play('explosion', v.x, top, v.z, 0.3, 0.5);
  }

  propHit(x: number, y: number, z: number, r: number): void {
    if (this.near(x, z) > 2500) return;
    for (let i = 0; i < 6; i++) {
      this.alpha.spawn({ x: x + rnd(-1, 1) * r, y: y + rnd(-2, 2), z: z + rnd(-1, 1) * r, vx: WIND_X + rnd(-2, 2), vy: rnd(-0.5, 1.5), vz: WIND_Z + rnd(-2, 2), life: rnd(4, 7), size: 2, size1: 7, color: 0x9a9284, alpha: 0.6, drag: 0.6 });
    }
    for (let i = 0; i < 10; i++) {
      this.alpha.spawn({ x: x + rnd(-1, 1) * r, y, z: z + rnd(-1, 1) * r, vx: rnd(-3, 3), vy: rnd(0, 4), vz: rnd(-3, 3), gravity: G, life: rnd(1, 2), size: 0.5, size1: 0.6, color: 0x7a7266, alpha: 0.95, kind: PK.Spray });
    }
  }

  propDown(kind: string, x: number, y: number, z: number, hw: number, hd: number, h: number, flattened: boolean): void {
    const far = this.near(x, z);
    if (kind === 'building') {
      const size = Math.min(4, (hw * hd) / 60 + h / 12);
      audio.play('collapse', x, y, z, size, 1);
      this.shake(x, z, 0.3 + size * 0.25);
      if (far > 3500) return;
      // A grey-brown wall of dust that rolls out over the footprint and then hangs.
      const r = Math.max(hw, hd);
      const n = Math.round(20 + size * 10);
      for (let i = 0; i < n; i++) {
        const lx = rnd(-1, 1) * hw;
        const lz = rnd(-1, 1) * hd;
        const a = Math.atan2(lz, lx);
        const sp = rnd(2, 6) + size;
        this.alpha.spawn({ x: x + lx, y: y + rnd(0, h * 0.6), z: z + lz, vx: Math.cos(a) * sp + WIND_X, vy: rnd(0.5, 3), vz: Math.sin(a) * sp + WIND_Z, life: rnd(8, 14), size: 3 + r * 0.25, size1: 10 + r * 0.7, color: 0xa69a88, color1: 0x8a8274, alpha: 0.75, drag: 0.5, fadeIn: 0.05, fadeOut: 0.4 });
      }
      // Falling masonry.
      for (let i = 0; i < 30; i++) {
        this.alpha.spawn({ x: x + rnd(-1, 1) * hw, y: y + rnd(0.3, 1) * h, z: z + rnd(-1, 1) * hd, vx: rnd(-3, 3), vy: rnd(-2, 4), vz: rnd(-3, 3), gravity: G, life: rnd(1, 2.2), size: 0.6, size1: 0.8, color: 0x6a6258, alpha: 1, kind: PK.Spray });
      }
      this.flat.spawn({ x, y: y + 0.3, z, life: 1.4, size: r, size1: r * 4, color: 0xd8ccb8, alpha: 0.6, kind: PK.Ring, fadeOut: 0.6 });
      return;
    }
    if (far > 1500) return;
    if (kind === 'tree') {
      audio.play('hit', x, y, z, 60, 0.4);
      for (let i = 0; i < 16; i++) this.alpha.spawn({ x: x + rnd(-2, 2), y: y + rnd(3, h), z: z + rnd(-2, 2), vx: rnd(-3, 3), vy: rnd(0, 3), vz: rnd(-3, 3), gravity: 3, life: rnd(1.5, 3), size: 0.3, size1: 0.25, color: 0x4a5a2c, alpha: 0.9, kind: PK.Spray, drag: 1.5, spin: rnd(-4, 4) });
      return;
    }
    audio.play(kind === 'car' ? 'explosion' : 'hit', x, y, z, kind === 'car' ? 0.3 : 90, 0.6);
    const col = kind === 'hedge' ? 0x4a5a2c : 0x9a9284;
    for (let i = 0; i < (flattened ? 8 : 14); i++) {
      this.alpha.spawn({ x: x + rnd(-1, 1) * hw, y: y + rnd(0, h), z: z + rnd(-1, 1) * hd, vx: WIND_X + rnd(-2, 2), vy: rnd(0.5, 2.5), vz: WIND_Z + rnd(-2, 2), life: rnd(2, 4), size: 1, size1: 4, color: col, alpha: 0.6, drag: 0.8 });
    }
    if (kind === 'car' && !flattened) this.explosion(x, y + 1, z, 0.8);
  }

  /** Rocket smoke left hanging along the flight path. */
  trail(x: number, y: number, z: number): void {
    this.alpha.spawn({ x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0, 0.5), vz: rnd(-0.3, 0.3), life: rnd(2, 3.5), size: 0.5, size1: 2.5, color: 0xd8d4cc, color1: 0xb0aca4, alpha: 0.5, drag: 0.8 });
  }

  sparkle(v: Vehicle, color: number, n: number): void {
    if (this.near(v.x, v.z) > 1500) return;
    const L = v.spec.size.length * 0.5;
    for (let i = 0; i < n; i++) {
      this.add.spawn({ x: v.x + rnd(-L, L), y: v.y + rnd(0.5, v.spec.size.height + 1), z: v.z + rnd(-L, L), vy: rnd(1, 3), life: rnd(0.6, 1.2), size: 0.5, size1: 0.1, color: 0xffffff, color1: color, kind: PK.Glow, fadeIn: 0.2 });
    }
  }

  // ------------------------------------------------------------------ per frame

  private emit(key: string, rate: number, dt: number): number {
    const a = (this.acc.get(key) ?? Math.random()) + rate * dt;
    const n = Math.floor(a);
    this.acc.set(key, a - n);
    return n;
  }

  update(dt: number): void {
    const g = this.game;
    const q = quality().particles;
    for (const v of g.vehicles) {
      if (v.withdrawn) continue;
      const d = this.near(v.renderX, v.renderZ);
      const lod = (d < 400 ? 1 : d < 1000 ? 0.5 : d < 1800 ? 0.2 : 0) * q;
      if (lod === 0) continue;
      const s = v.spec.size;
      const h = v.renderHeading;
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const rx = -fz;
      const rz = fx;
      const x = v.renderX;
      const z = v.renderZ;
      const y = v.renderY;
      const top = y + s.height;
      if (!v.alive) {
        // A wreck burns for a while, then smoulders.
        const age = g.time - v.deathTime;
        if (age < 40) {
          const nf = age < 12 ? this.emit(`f${v.id}`, 10 * lod, dt) : 0;
          for (let i = 0; i < nf; i++) this.add.spawn({ x: x + rnd(-1, 1) * s.width * 0.3, y: top + rnd(0, 0.5), z: z + rnd(-1, 1) * s.width * 0.3, vx: rnd(-0.5, 0.5), vy: rnd(1.5, 3.5), vz: rnd(-0.5, 0.5), life: rnd(0.4, 0.8), size: 1 + s.width * 0.3, size1: 0.4, color: 0xffd070, color1: 0xff2a00, kind: PK.Glow });
          const ns = this.emit(`s${v.id}`, (age < 12 ? 4 : 1.5) * lod, dt);
          for (let i = 0; i < ns; i++) this.alpha.spawn({ x, y: top + 1, z, vx: WIND_X + rnd(-0.5, 0.5), vy: rnd(2, 4), vz: WIND_Z + rnd(-0.5, 0.5), life: rnd(6, 10), size: 1.5, size1: 7 + s.width, color: 0x1e1c1a, color1: 0x55524e, alpha: 0.7, drag: 0.25 });
        }
        continue;
      }
      const speed = Math.hypot(v.speed, v.side);
      // Track dust (or snow) off the back corners.
      if (speed > 1.5 && v.spec.drive.type !== 'hover') {
        const k = Math.min(1, speed / 15);
        const n = this.emit(`d${v.id}`, 10 * k * lod, dt);
        for (let i = 0; i < n; i++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const px = x - fx * s.length * 0.48 + rx * side * s.width * 0.4;
          const pz = z - fz * s.length * 0.48 + rz * side * s.width * 0.4;
          const m = g.terrain.materialAt(px, pz);
          if (m === MAT.road && Math.random() < 0.6) continue;
          this.alpha.spawn({ x: px, y: g.terrain.heightAt(px, pz) + 0.3, z: pz, vx: -fx * speed * 0.2 + rnd(-0.6, 0.6), vy: rnd(0.3, 1.2), vz: -fz * speed * 0.2 + rnd(-0.6, 0.6), life: rnd(1.5, 3), size: 0.8, size1: 2.5 + s.width * 0.6, color: DUST[m] ?? DUST[MAT.dirt], alpha: m === MAT.snow || m === MAT.deepSnow ? 0.6 : 0.35 * k + 0.1, drag: 1.2, fadeIn: 0.05 });
        }
      } else if (v.spec.drive.type === 'hover' && speed > 1) {
        // A ring of pressed air under the skirt.
        const n = this.emit(`d${v.id}`, 6 * lod, dt);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          this.alpha.spawn({ x: x + Math.cos(a) * s.width * 0.5, y: y + 0.2, z: z + Math.sin(a) * s.width * 0.5, vx: Math.cos(a) * 3, vy: 0.3, vz: Math.sin(a) * 3, life: 1.2, size: 0.8, size1: 3, color: this.dustColor(x, z), alpha: 0.3, drag: 1.5 });
        }
      }
      // Exhaust off the engine deck, heavier when pulling away.
      const pull = Math.abs(v.control.drive) > 0.1 ? 1 : 0.3;
      const ne = this.emit(`e${v.id}`, 3 * pull * lod, dt);
      for (let i = 0; i < ne; i++) {
        const px = x - fx * s.length * 0.4 + rx * rnd(-0.3, 0.3) * s.width;
        const pz = z - fz * s.length * 0.4 + rz * rnd(-0.3, 0.3) * s.width;
        this.alpha.spawn({ x: px, y: top + 0.2, z: pz, vx: WIND_X - fx * 1.5, vy: rnd(0.8, 2), vz: WIND_Z - fz * 1.5, life: rnd(1.5, 2.5), size: 0.4, size1: 1.8, color: 0x3a3836, color1: 0x7a7874, alpha: 0.25 * pull + 0.05, drag: 0.6 });
      }
      // Burning engine.
      if (v.crits.fire > 0) {
        const nf = this.emit(`x${v.id}`, 16 * lod, dt);
        for (let i = 0; i < nf; i++) {
          const px = x - fx * s.length * 0.3 + rx * rnd(-0.3, 0.3) * s.width;
          const pz = z - fz * s.length * 0.3 + rz * rnd(-0.3, 0.3) * s.width;
          this.add.spawn({ x: px, y: top + 0.1, z: pz, vx: rnd(-0.4, 0.4), vy: rnd(2, 4), vz: rnd(-0.4, 0.4), life: rnd(0.3, 0.6), size: 0.9, size1: 0.3, color: 0xffd070, color1: 0xff2a00, kind: PK.Glow });
        }
        const ns = this.emit(`xs${v.id}`, 4 * lod, dt);
        for (let i = 0; i < ns; i++) this.alpha.spawn({ x: x - fx * s.length * 0.3, y: top + 1, z: z - fz * s.length * 0.3, vx: WIND_X, vy: rnd(2, 3.5), vz: WIND_Z, life: rnd(3, 5), size: 1, size1: 5, color: 0x1a1816, color1: 0x4a4744, alpha: 0.7, drag: 0.3 });
      } else if (v.hp < v.maxHp * 0.3) {
        // Badly hurt: a thin trail of smoke.
        const ns = this.emit(`h${v.id}`, 1.5 * lod, dt);
        for (let i = 0; i < ns; i++) this.alpha.spawn({ x, y: top + 0.4, z, vx: WIND_X, vy: rnd(1, 2), vz: WIND_Z, life: rnd(2, 4), size: 0.6, size1: 3, color: 0x3a3836, alpha: 0.45, drag: 0.4 });
      }
    }
    // Smoke screens: puffs kept coming over the area while it lasts, so it stays thick.
    for (const sm of g.smokes) {
      const d = this.near(sm.x, sm.z);
      if (d > 2500) continue;
      const fade = Math.min(1, sm.life / 3);
      const n = this.emit(`sm${sm.x | 0}:${sm.z | 0}`, (4 + sm.r * 0.4) * fade * q, dt);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * sm.r;
        const px = sm.x + Math.cos(a) * r;
        const pz = sm.z + Math.sin(a) * r;
        this.alpha.spawn({ x: px, y: g.terrain.heightAt(px, pz) + rnd(0.5, 3), z: pz, vx: WIND_X * 0.5 + rnd(-0.4, 0.4), vy: rnd(0.1, 0.5), vz: WIND_Z * 0.5 + rnd(-0.4, 0.4), life: rnd(4, 7), size: 4 + sm.r * 0.15, size1: 8 + sm.r * 0.4, color: 0xdfe2e4, color1: 0xc4c8cc, alpha: 0.75 * fade, drag: 0.6, fadeIn: 0.2, fadeOut: 0.35 });
      }
    }
  }
}
