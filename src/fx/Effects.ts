import type { Vector3 } from 'three';
import { MAP_SIZE, MAX_FIRES } from '../config';
import type { Game } from '../core/Game';
import type { Era, GunLook, SkillSpec } from '../core/types';
import { eraOf } from '../data/factions';
import { deckHeight } from '../ships/HullShape';
import type { Ship } from '../ships/Ship';
import { GUN_STYLE } from '../render/Looks';
import { quality } from '../render/Quality';
import { funnelTops } from '../render/ShipModel';
import { waveHeight } from '../world/Waves';
import { audio } from './Audio';
import { PK, type ParticleSystem } from './Particles';

/** Colour of the Search sweep ring in each era. */
const SEARCH_TINT: Record<Era, number> = { historic: 0x8fe3ff, modern: 0x8fe3ff, fantasy: 0xc9a6ff, scifi: 0x7fffc8, anime: 0xffd36b, misc: 0x5fe0d0 };

// Turns simulation events and ship state into particles, sounds and camera shake.

const WIND_X = 2.4;
const WIND_Z = 1.1;


function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export interface Shake {
  x: number;
  z: number;
  amount: number;
}

export class Effects {
  private off: (() => void)[] = [];
  private visualQuality = quality();
  private emitAcc = new Map<string, number>();
  /** Camera positions this frame (for LOD and audio). */
  views: Vector3[] = [];
  onShake: ((s: Shake) => void) | null = null;
  /** Local human ships (for UI sounds). */
  locals: Ship[] = [];

  constructor(
    private game: Game,
    private alpha: ParticleSystem,
    private add: ParticleSystem,
    private flat: ParticleSystem,
  ) {
    const ev = game.events;
    this.off.push(
      ev.on('gunFired', (e) => this.muzzle(e.x, e.y, e.z, e.bearing, e.caliber, e.secondary, e.look)),
      ev.on('splash', (e) => this.splash(e.x, e.z, e.caliber)),
      ev.on('terrainHit', (e) => this.dirt(e.x, e.y, e.z, e.caliber)),
      ev.on('shellHit', (e) => this.hit(e.x, e.y, e.z, e.caliber, e.outcome, e.attacker, e.target)),
      ev.on('torpHit', (e) => this.torpHit(e.x, e.z)),
      ev.on('explosion', (e) => this.explosion(e.x, e.y, e.z, e.size)),
      ev.on('detonation', (e) => this.detonation(e.ship)),
      ev.on('intercept', (e) => this.flak(e.x, Math.max(e.y, 4), e.z, true)),
      ev.on('planeDown', (e) => this.planeDown(e.x, e.y, e.z)),
      ev.on('depthCharge', (e) => this.depthCharge(e.x, e.z)),
      ev.on('torpLaunched', (e) => {
        audio.play('torpedo', e.x, 2, e.z, 100, 0.8);
        for (let i = 0; i < 6; i++) this.alpha.spawn({ x: e.x + rnd(-4, 4), y: 2, z: e.z + rnd(-4, 4), vy: rnd(1, 4), life: 2, size: 4, size1: 10, color: 0xf0f4f6, alpha: 0.5, kind: PK.Spray });
      }),
      ev.on('missileLaunched', (e) => {
        audio.play('missile', e.x, e.y, e.z, 100, 0.9);
        for (let i = 0; i < 14; i++) this.alpha.spawn({ x: e.x, y: e.y, z: e.z, vx: rnd(-8, 8), vy: rnd(0, 10), vz: rnd(-8, 8), life: rnd(3, 6), size: 6, size1: 22, color: 0xd8d4cc, alpha: 0.6, drag: 0.8 });
        this.add.spawn({ x: e.x, y: e.y, z: e.z, life: 0.3, size: 20, size1: 30, color: 0xffd090, color1: 0xff6020, kind: PK.Glow });
      }),
      ev.on('skill', (e) => {
        const ult = !!e.ship.skills[e.index].spec.ult;
        const skill = e.ship.skills[e.index].spec;
        audio.cue(skill.id, 'activate', skill.icon === 'beam' || skill.icon === 'laser' ? 'beam' : skill.icon === 'blade' ? 'slash' : ult ? 'impact' : 'charge', e.ship.pos.x, e.ship.pos.y + 10, e.ship.pos.z, this.locals.includes(e.ship));
        this.skillBurst(e.ship, e.ship.skills[e.index].spec, ult);
      }),
      ev.on('shift', e => { if (!e.quiet) audio.cue('titanShift', e.on ? 'activate' : 'end', 'transform', e.ship.pos.x, e.ship.pos.y, e.ship.pos.z, this.locals.includes(e.ship)); }),
      ev.on('consumable', (e) => {
        if (e.type === 'search' && this.locals.includes(e.ship)) audio.ui('pickup');
        if (e.type === 'search') {
          const tint = SEARCH_TINT[eraOf(e.ship.spec)];
          this.flat.spawn({ x: e.ship.pos.x, y: 0.8, z: e.ship.pos.z, life: 2.5, size: 50, size1: (e.ship.spec.consumables.find((c) => c.type === e.type)?.power ?? 3000) * 2, color: tint, alpha: 0.5, kind: PK.Ring, fadeOut: 0.2 });
        }
      }),
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

  // ------------------------------------------------------------------ events

  /** Skill activation: a bright shock ring, a slower wide one, sparks and (ultimates) a column of light. */
  skillBurst(s: Ship, skill: SkillSpec, ult: boolean): void {
    const id = skill.id;
    const tint = skill.accent;
    const L = Math.min(s.spec.length, 300);
    const { x, z } = s.pos;
    const k = ult ? 1 : 0.55;
    this.flat.spawn({ x, y: 0.9, z, life: 0.9, size: L * 0.4, size1: L * 3.5 * k, color: tint, alpha: 1, kind: PK.Ring, fadeOut: 0.5 });
    if (ult) this.flat.spawn({ x, y: 0.8, z, life: 2.4, size: L * 0.8, size1: L * 6, color: tint, alpha: 0.5, kind: PK.Ring, fadeOut: 0.6 });
    const sparks = ult ? 56 : 24;
    for (let i = 0; i < sparks; i++) {
      const a = (i / 56) * Math.PI * 2;
      const r = L * 0.55;
      const sp = rnd(40, 70);
      this.add.spawn({ x: x + Math.cos(a) * r, y: 6, z: z + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: rnd(8, 26), vz: Math.sin(a) * sp, life: 1.4, size: 9, size1: 2, color: tint, kind: PK.Glow, drag: 1.4 });
    }
    if (ult) {
      for (let i = 0; i < 10; i++) {
        this.add.spawn({ x, y: 12 + i * 14, z, vy: 40, life: 0.7, size: L * 0.25, size1: L * 0.04, color: tint, kind: PK.Glow, fadeIn: 0.1 });
      }
    }
    this.shake(x, z, ult ? 1.1 : 0.4);
    // Sonar and radar sweeps run out across the sea.
    if (id === 'fireControl') this.flat.spawn({ x, y: 1.2, z, life: 1.6, size: 60, size1: 5000, color: tint, alpha: 0.7, kind: PK.Ring, fadeOut: 0.5 });
    if (id === 'neptunePing') this.flat.spawn({ x, y: 1.2, z, life: 3.4, size: 80, size1: MAP_SIZE * 2.2, color: tint, alpha: 0.7, kind: PK.Ring, fadeOut: 0.5 });
    // Fujin Gale: a fan of spray torn off the sea toward the reticle.
    if (id === 'fujinGale') {
      const c = Math.atan2(s.control.aimX - x, -(s.control.aimZ - z));
      for (let i = 0; i < 90; i++) {
        const a = c + rnd(-35, 35) * (Math.PI / 180);
        const sp = rnd(500, 1100);
        const r0 = rnd(0.3, 0.6) * L;
        this.alpha.spawn({ x: x + Math.sin(a) * r0, y: rnd(2, 30), z: z - Math.cos(a) * r0, vx: Math.sin(a) * sp, vy: rnd(5, 30), vz: -Math.cos(a) * sp, life: rnd(1.4, 2.2), size: 14, size1: 70, color: 0xf2fbf8, alpha: 0.75, kind: PK.Spray, drag: 1.3 });
      }
      for (let i = 0; i < 30; i++) {
        const a = c + rnd(-35, 35) * (Math.PI / 180);
        const sp = rnd(700, 1300);
        this.add.spawn({ x, y: rnd(8, 40), z, vx: Math.sin(a) * sp, vy: 0, vz: -Math.cos(a) * sp, life: 1.2, size: 8, size1: 2, color: 0xffffff, color1: tint, kind: PK.Glow, drag: 1.2 });
      }
    }
  }

  muzzle(x: number, y: number, z: number, bearing: number, caliber: number, secondary: boolean, look: GunLook = 'shell'): void {
    const st = GUN_STYLE[look];
    const c = caliber / 1000;
    const dx = Math.sin(bearing);
    const dz = -Math.cos(bearing);
    const d = this.near(x, z);
    audio.play('gun', x, y, z, caliber, secondary ? 0.35 : 1);
    if (d > 14000) return;
    const k = secondary ? 0.6 : 1;
    for (let i = 0; i < 3; i++) {
      const o = (8 + i * 10) * c * 2;
      this.add.spawn({ x: x + dx * o, y: y + 1, z: z + dz * o, life: rnd(0.1, 0.18), size: (6 + c * 50) * k * (1 - i * 0.2), size1: (10 + c * 70) * k, color: st.flash, color1: st.flash1, kind: PK.Glow });
    }
    const n = secondary ? 2 : Math.round((4 + c * 18) * st.smoke);
    for (let i = 0; i < n; i++) {
      const sp = rnd(4, 30) * (0.5 + c);
      this.alpha.spawn({
        x: x + dx * c * rnd(10, 50),
        y: y + rnd(0, 2),
        z: z + dz * c * rnd(10, 50),
        vx: dx * sp + rnd(-2, 2) + WIND_X,
        vy: rnd(0.5, 3),
        vz: dz * sp + rnd(-2, 2) + WIND_Z,
        life: rnd(3, 7) * (secondary ? 0.5 : 1),
        size: (3 + c * 26) * k,
        size1: (8 + c * 90) * k,
        color: 0xe8e3da,
        color1: 0xb0aba2,
        alpha: secondary ? 0.3 : 0.55,
        drag: 0.7,
        fadeIn: 0.02,
        fadeOut: 0.35,
      });
    }
    if (!secondary && caliber >= 280) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        this.flat.spawn({ x: x + dx * c * 30, y: 0.6, z: z + dz * c * 30, vx: Math.cos(a) * 10, vz: Math.sin(a) * 10, life: 3, size: c * 40, size1: c * 120, color: 0xd8dde0, alpha: 0.35, kind: PK.Foam, drag: 0.8 });
      }
      this.shake(x, z, c * 1.2);
    }
  }

  splash(x: number, z: number, caliber: number): void {
    const c = caliber / 1000;
    const d = this.near(x, z);
    audio.play('splash', x, 0, z, caliber, 0.7);
    if (d > 16000) return;
    const y = waveHeight(x, z, this.game.time);
    const H = 8 + c * 110;
    const v0 = Math.sqrt(2 * 9.81 * H);
    const n = Math.round((d > 7000 ? 0.4 : 1) * (8 + c * 40));
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      this.alpha.spawn({
        x: x + rnd(-1, 1) * c * 6,
        y,
        z: z + rnd(-1, 1) * c * 6,
        vx: rnd(-1, 1) * (2 + c * 10),
        vy: v0 * (0.45 + 0.55 * r),
        vz: rnd(-1, 1) * (2 + c * 10),
        gravity: 9.81,
        life: ((2 * v0 * (0.45 + 0.55 * r)) / 9.81) * 0.95 + 0.2,
        size: 2 + c * 12,
        size1: 5 + c * 30,
        color: 0xf4f8fa,
        color1: 0xdfe6ea,
        alpha: 0.9,
        kind: PK.Spray,
        drag: 0.25,
        fadeOut: 0.75,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.alpha.spawn({ x: x + rnd(-3, 3), y: y + 2, z: z + rnd(-3, 3), vx: WIND_X, vy: rnd(0.5, 2), vz: WIND_Z, life: rnd(3, 5), size: c * 30 + 4, size1: c * 80 + 10, color: 0xf0f3f5, alpha: 0.35, fadeIn: 0.1 });
    }
    this.flat.spawn({ x, y: y + 0.4, z, life: 4, size: c * 20 + 3, size1: c * 80 + 10, color: 0xffffff, alpha: 0.6, kind: PK.Ring, fadeOut: 0.3 });
    this.flat.spawn({ x, y: y + 0.4, z, life: 12, size: c * 30 + 4, size1: c * 60 + 8, color: 0xe8eef0, alpha: 0.5, kind: PK.Foam });
  }

  dirt(x: number, y: number, z: number, caliber: number): void {
    const c = caliber / 1000;
    audio.play('explosion', x, y, z, 0.3 + c, 0.6);
    for (let i = 0; i < 10 + c * 20; i++) {
      this.alpha.spawn({ x, y, z, vx: rnd(-1, 1) * 12, vy: rnd(5, 25) * (0.5 + c), vz: rnd(-1, 1) * 12, gravity: 9.81, life: rnd(1.2, 2.5), size: 2 + c * 10, size1: 4 + c * 20, color: 0x5a4a38, alpha: 0.9, kind: PK.Spray });
    }
    for (let i = 0; i < 4; i++) {
      this.alpha.spawn({ x, y, z, vx: WIND_X + rnd(-2, 2), vy: rnd(1, 4), vz: WIND_Z + rnd(-2, 2), life: rnd(4, 7), size: 6 + c * 20, size1: 15 + c * 70, color: 0x8a7a62, alpha: 0.6, drag: 0.4 });
    }
    this.add.spawn({ x, y, z, life: 0.2, size: 6 + c * 30, color: 0xffc070, color1: 0xff5010, kind: PK.Glow });
  }

  hit(x: number, y: number, z: number, caliber: number, outcome: string, attacker: Ship, target: Ship): void {
    const c = caliber / 1000;
    const big = outcome === 'citadel' ? 2.2 : outcome === 'penetration' || outcome === 'he' || outcome === 'missile' ? 1 : outcome === 'overpen' ? 0.5 : 0.3;
    audio.play(outcome === 'citadel' || outcome === 'missile' ? 'explosion' : 'hit', x, y, z, outcome === 'citadel' ? 1.2 : caliber, outcome === 'secondary' ? 0.4 : 0.9);
    if (this.locals.includes(attacker) && outcome === 'citadel') audio.ui('citadel');
    if (this.locals.includes(target)) this.shake(x, z, 0.4 + c * big);
    if (this.near(x, z) > 15000) return;
    if (outcome === 'ricochet' || outcome === 'shatter') {
      for (let i = 0; i < 8; i++) {
        this.add.spawn({ x, y, z, vx: rnd(-40, 40), vy: rnd(5, 40), vz: rnd(-40, 40), gravity: 9.81, life: rnd(0.3, 0.7), size: 0.8 + c * 2, color: 0xfff0c0, color1: 0xff7020, kind: PK.Glow });
      }
      return;
    }
    const s = (4 + c * 30) * big;
    this.add.spawn({ x, y, z, life: 0.25, size: s, size1: s * 1.8, color: 0xfff0b0, color1: 0xff5a10, kind: PK.Glow });
    this.add.spawn({ x, y, z, life: 0.5 + big * 0.2, size: s * 0.7, size1: s * 1.4, color: 0xff9a40, color1: 0x601000, kind: PK.Glow });
    for (let i = 0; i < 6 * big + 3; i++) {
      this.add.spawn({ x, y, z, vx: rnd(-30, 30), vy: rnd(5, 35), vz: rnd(-30, 30), gravity: 9.81, life: rnd(0.4, 1.1), size: 0.9 + c * 2, color: 0xffe0a0, color1: 0xff4010, kind: PK.Glow });
    }
    for (let i = 0; i < 2 + big * 3; i++) {
      this.alpha.spawn({ x, y, z, vx: WIND_X + rnd(-3, 3), vy: rnd(2, 6), vz: WIND_Z + rnd(-3, 3), life: rnd(2.5, 5), size: s * 0.4, size1: s * 1.6, color: 0x2e2a26, color1: 0x5a5650, alpha: 0.7, drag: 0.5 });
    }
  }

  torpHit(x: number, z: number): void {
    const y = waveHeight(x, z, this.game.time);
    const v0 = Math.sqrt(2 * 9.81 * 70);
    for (let i = 0; i < 60; i++) {
      const r = Math.random();
      this.alpha.spawn({ x: x + rnd(-6, 6), y, z: z + rnd(-6, 6), vx: rnd(-8, 8), vy: v0 * (0.4 + 0.6 * r), vz: rnd(-8, 8), gravity: 9.81, life: (2 * v0 * (0.4 + 0.6 * r)) / 9.81, size: 8, size1: 22, color: 0xf6f9fa, alpha: 0.9, kind: PK.Spray, drag: 0.2, fadeOut: 0.75 });
    }
    this.flat.spawn({ x, y: y + 0.4, z, life: 6, size: 20, size1: 160, color: 0xffffff, alpha: 0.7, kind: PK.Ring, fadeOut: 0.3 });
    this.flat.spawn({ x, y: y + 0.4, z, life: 20, size: 40, size1: 90, color: 0xe8eef0, alpha: 0.6, kind: PK.Foam });
    audio.play('depth', x, 0, z, 100, 1);
    this.shake(x, z, 1.4);
  }

  explosion(x: number, y: number, z: number, size: number): void {
    audio.play('explosion', x, y, z, size, 1);
    this.shake(x, z, size * 0.8);
    if (this.near(x, z) > 18000) return;
    for (let i = 0; i < 4 + size * 4; i++) {
      this.add.spawn({ x: x + rnd(-1, 1) * size * 6, y: y + rnd(0, size * 6), z: z + rnd(-1, 1) * size * 6, vx: rnd(-8, 8), vy: rnd(4, 18), vz: rnd(-8, 8), life: rnd(0.5, 1.2), size: size * 10, size1: size * 22, color: 0xffe2a0, color1: 0xa02000, kind: PK.Glow, drag: 1.2 });
    }
    for (let i = 0; i < 6 + size * 8; i++) {
      this.alpha.spawn({ x: x + rnd(-1, 1) * size * 5, y: y + rnd(0, size * 4), z: z + rnd(-1, 1) * size * 5, vx: WIND_X + rnd(-4, 4), vy: rnd(5, 14), vz: WIND_Z + rnd(-4, 4), life: rnd(7, 13), size: size * 10, size1: size * 34, color: 0x24211e, color1: 0x5d5954, alpha: 0.85, drag: 0.35, fadeIn: 0.04 });
    }
    for (let i = 0; i < 8 + size * 6; i++) {
      this.add.spawn({ x, y, z, vx: rnd(-50, 50), vy: rnd(10, 60), vz: rnd(-50, 50), gravity: 9.81, life: rnd(0.8, 2), size: 1.5, color: 0xffd080, color1: 0xff3000, kind: PK.Glow });
    }
    // White-hot core and a shock ring racing out across the water.
    this.add.spawn({ x, y: y + size * 2, z, life: 0.18, size: size * 18, size1: size * 34, color: 0xffffff, color1: 0xffc060, kind: PK.Glow });
    this.flat.spawn({ x, y: 1, z, life: 0.7, size: size * 6, size1: size * 60, color: 0xfff0d0, alpha: 0.8, kind: PK.Ring, fadeOut: 0.5 });
    // Big blasts (wrecks, rods, magazines) throw burning debris that trails smoke.
    if (size >= 2.5) {
      for (let i = 0; i < 6 + size * 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(20, 45) * Math.sqrt(size);
        this.add.spawn({ x, y: y + 4, z, vx: Math.cos(a) * sp, vy: rnd(30, 70), vz: Math.sin(a) * sp, gravity: 9.81, life: rnd(2, 3.5), size: 5, size1: 2, color: 0xffe0a0, color1: 0xff4000, kind: PK.Glow, drag: 0.2 });
      }
      for (let i = 0; i < size * 3; i++) {
        this.add.spawn({ x: x + rnd(-1, 1) * size * 3, y: y + i * size * 5, z: z + rnd(-1, 1) * size * 3, vy: rnd(15, 30), life: rnd(0.8, 1.4), size: size * 9, size1: size * 16, color: 0xffd090, color1: 0x801800, kind: PK.Glow, drag: 0.9, fadeIn: 0.05 });
      }
    }
  }

  /** Magazines going up: fireballs down the hull, a pillar of flame and a towering smoke cloud. */
  detonation(s: Ship): void {
    const L = s.spec.length;
    const size = 2 + L / 160;
    for (const u of [-0.18, 0.18]) {
      const w = s.localToWorld(u * L, s.spec.freeboard, 0);
      this.explosion(w.x, w.y, w.z, size * 0.8);
    }
    const x = s.pos.x;
    const z = s.pos.z;
    this.shake(x, z, 2.5);
    if (this.near(x, z) > 18000) return;
    for (let i = 0; i < 24; i++) {
      this.add.spawn({ x: x + rnd(-1, 1) * size * 3, y: 6 + i * size * 3, z: z + rnd(-1, 1) * size * 3, vy: rnd(40, 80), life: rnd(0.9, 1.6), size: size * 10, size1: size * 18, color: 0xfff0c0, color1: 0x902000, kind: PK.Glow, drag: 1.1, fadeIn: 0.04 });
    }
    for (let i = 0; i < 30; i++) {
      const top = i > 14;
      this.alpha.spawn({ x: x + rnd(-1, 1) * size * (top ? 14 : 5), y: top ? rnd(90, 150) : rnd(10, 90), z: z + rnd(-1, 1) * size * (top ? 14 : 5), vx: WIND_X + rnd(-6, 6), vy: top ? rnd(4, 10) : rnd(14, 30), vz: WIND_Z + rnd(-6, 6), life: rnd(14, 22), size: size * 14, size1: size * 55, color: 0x1c1a18, color1: 0x5a5651, alpha: 0.9, drag: 0.4, fadeIn: 0.05 });
    }
  }

  flak(x: number, y: number, z: number, flash: boolean): void {
    this.alpha.spawn({ x, y, z, vx: rnd(-1, 1), vy: rnd(-0.5, 0.5), vz: rnd(-1, 1), life: rnd(2, 3.5), size: 5, size1: 15, color: 0x1a1a1a, color1: 0x3d3d3d, alpha: 0.8, drag: 0.5 });
    if (flash) this.add.spawn({ x, y, z, life: 0.12, size: 9, color: 0xffd080, color1: 0xff6020, kind: PK.Glow });
    if (Math.random() < 0.3) audio.play('flak', x, y, z, 100, 0.4);
  }

  planeDown(x: number, y: number, z: number): void {
    this.add.spawn({ x, y, z, life: 0.5, size: 14, size1: 22, color: 0xffd080, color1: 0xff3000, kind: PK.Glow });
    for (let i = 0; i < 6; i++) this.alpha.spawn({ x, y, z, vx: rnd(-6, 6), vy: rnd(-12, -2), vz: rnd(-6, 6), life: 3, size: 6, size1: 16, color: 0x222222, alpha: 0.7 });
    audio.play('flak', x, y, z, 100, 0.7);
  }

  depthCharge(x: number, z: number): void {
    const y = waveHeight(x, z, this.game.time);
    const v0 = Math.sqrt(2 * 9.81 * 22);
    for (let i = 0; i < 30; i++) {
      const r = Math.random();
      this.alpha.spawn({ x: x + rnd(-8, 8), y, z: z + rnd(-8, 8), vx: rnd(-6, 6), vy: v0 * (0.3 + 0.7 * r), vz: rnd(-6, 6), gravity: 9.81, life: (2 * v0 * (0.3 + 0.7 * r)) / 9.81, size: 7, size1: 18, color: 0xf2f6f8, alpha: 0.85, kind: PK.Spray, fadeOut: 0.7 });
    }
    this.flat.spawn({ x, y: y + 0.4, z, life: 5, size: 10, size1: 120, color: 0xffffff, alpha: 0.6, kind: PK.Ring });
    this.flat.spawn({ x, y: y + 0.4, z, life: 14, size: 30, size1: 70, color: 0xdfe8ea, alpha: 0.55, kind: PK.Foam });
    audio.play('depth', x, 0, z, 100, 0.8);
  }

  // ------------------------------------------------------------------ per frame

  /** Emit at `rate` per second with a per-key accumulator. Returns count to spawn. */
  private emit(key: string, rate: number, dt: number): number {
    const acc = (this.emitAcc.get(key) ?? Math.random()) + rate * dt;
    const n = Math.floor(acc);
    this.emitAcc.set(key, acc - n);
    return n;
  }

  update(dt: number): void {
    const g = this.game;
    const t = g.time;
    for (const s of g.ships) {
      const spec = s.spec;
      const d = this.near(s.pos.x, s.pos.z);
      const lod = (d < 3000 ? 1 : d < 8000 ? 0.5 : d < 14000 ? 0.2 : 0) * this.visualQuality.particles;
      if (lod === 0) continue;
      const fx = Math.sin(s.heading);
      const fz = -Math.cos(s.heading);
      const L = spec.length;
      const surfaced = s.pos.y > -2;

      // Wake and bow wave.
      const spd = Math.abs(s.speed);
      if (surfaced && spd > 1.5) {
        const k = Math.min(1, spd / 30);
        const n = this.emit(`w${s.id}`, (6 + 10 * k) * lod, dt);
        for (let i = 0; i < n; i++) {
          const lat = rnd(-0.35, 0.35) * spec.beam;
          const sx = s.pos.x - fx * L * 0.48 - fz * lat;
          const sz = s.pos.z - fz * L * 0.48 + fx * lat;
          this.flat.spawn({ x: sx, y: waveHeight(sx, sz, t) + 0.5, z: sz, vx: -fx * spd * 0.15, vz: -fz * spd * 0.15, life: 14 + k * 8, size: spec.beam * 0.9, size1: spec.beam * (2.5 + k * 3), color: 0xf4f8f8, alpha: 0.32 + 0.4 * k, kind: PK.Foam, drag: 0.5, fadeIn: 0.02, fadeOut: 0.3 });
        }
        const nb = this.emit(`b${s.id}`, 10 * k * lod, dt);
        for (let i = 0; i < nb; i++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const bx = s.pos.x + fx * L * 0.42 - fz * side * spec.beam * 0.45;
          const bz = s.pos.z + fz * L * 0.42 + fx * side * spec.beam * 0.45;
          const ox = -fz * side;
          const oz = fx * side;
          this.flat.spawn({ x: bx, y: waveHeight(bx, bz, t) + 0.5, z: bz, vx: ox * spd * 0.35, vz: oz * spd * 0.35, life: 6, size: spec.beam * 0.5, size1: spec.beam * 2.2, color: 0xffffff, alpha: 0.5 * k, kind: PK.Foam, drag: 0.6 });
          if (k > 0.55 && Math.random() < 0.3 * lod) {
            this.alpha.spawn({ x: bx, y: 1.5, z: bz, vx: ox * 4 + fx * spd * 0.6, vy: rnd(2, 6), vz: oz * 4 + fz * spd * 0.6, gravity: 9.81, life: 1, size: 2, size1: 7, color: 0xf8fbfc, alpha: 0.6, kind: PK.Spray });
          }
        }
      }

      // Funnel exhaust.
      if (s.alive && surfaced && spec.model.funnels.length + (spec.cls === 'CV' ? 1 : 0) > 0) {
        const tops = funnelTops(spec);
        const k = 0.3 + 0.7 * Math.abs(s.throttle - 2) / 4;
        tops.forEach((p, i) => {
          const n = this.emit(`f${s.id}:${i}`, 2.5 * k * lod, dt);
          for (let j = 0; j < n; j++) {
            const w = s.localToWorld(p.x, p.y, p.z);
            this.alpha.spawn({ x: w.x, y: w.y, z: w.z, vx: WIND_X - fx * s.speed * 0.3, vy: rnd(2, 4), vz: WIND_Z - fz * s.speed * 0.3, life: rnd(5, 9), size: 3, size1: 18 + L * 0.05, color: 0x55524e, color1: 0x9b9893, alpha: 0.35 * k + 0.1, drag: 0.15 });
          }
        });
      }

      // Fires.
      for (let i = 0; i < MAX_FIRES; i++) {
        if (s.fires[i] <= 0) continue;
        const u = [0.62, 0.2, -0.2, -0.62][i];
        const lx = u * L * 0.5;
        const scale = Math.max(0.6, L / 160);
        const nf = this.emit(`x${s.id}:${i}`, 14 * lod, dt);
        for (let j = 0; j < nf; j++) {
          const w = s.localToWorld(lx + rnd(-4, 4), deckHeight(spec, lx) + rnd(1, 4), rnd(-0.3, 0.3) * spec.beam);
          this.add.spawn({ x: w.x, y: w.y, z: w.z, vx: rnd(-1, 1), vy: rnd(3, 8), vz: rnd(-1, 1), life: rnd(0.5, 1), size: 4 * scale, size1: 1.5 * scale, color: 0xffd070, color1: 0xff2a00, kind: PK.Glow });
        }
        const ns = this.emit(`s${s.id}:${i}`, 5 * lod, dt);
        for (let j = 0; j < ns; j++) {
          const w = s.localToWorld(lx, deckHeight(spec, lx) + 5, 0);
          this.alpha.spawn({ x: w.x, y: w.y, z: w.z, vx: WIND_X * 1.5 + rnd(-1, 1), vy: rnd(5, 9), vz: WIND_Z * 1.5 + rnd(-1, 1), life: rnd(8, 12), size: 5 * scale, size1: 34 * scale, color: 0x1d1b19, color1: 0x56524d, alpha: 0.75, drag: 0.2 });
        }
      }

      // Knocked-out turrets smoke.
      if (s.alive) {
        for (let i = 0; i < s.turrets.length; i++) {
          const tu = s.turrets[i];
          if (tu.disabled <= 0 || !this.emit(`t${s.id}:${i}`, 3 * lod, dt)) continue;
          const tx = tu.spec.x;
          const w = s.localToWorld(tx, deckHeight(spec, tx) + tu.spec.y + 3, tu.spec.z ?? 0);
          this.alpha.spawn({ x: w.x, y: w.y, z: w.z, vx: WIND_X + rnd(-1, 1), vy: rnd(4, 7), vz: WIND_Z + rnd(-1, 1), life: rnd(5, 8), size: 3, size1: 20, color: 0x2a2724, color1: 0x6c6863, alpha: 0.6, drag: 0.25 });
        }
      }

      // An oil slick spreads from a sinking hull, burning on the water at first.
      if (!s.alive && !s.withdrawn && s.deathTime < 24) {
        const no = this.emit(`o${s.id}`, 3 * lod, dt);
        for (let j = 0; j < no; j++) {
          const a = Math.random() * Math.PI * 2;
          const r = rnd(0, 0.45) * L + s.deathTime * 3;
          const ox = s.pos.x + Math.cos(a) * r;
          const oz = s.pos.z + Math.sin(a) * r;
          this.flat.spawn({ x: ox, y: waveHeight(ox, oz, t) + 0.35, z: oz, vx: Math.cos(a) * 1.5, vz: Math.sin(a) * 1.5, life: 30, size: L * 0.15, size1: L * 0.45, color: 0x0b0a09, alpha: 0.55, kind: PK.Foam, drag: 0.3, fadeIn: 0.05, fadeOut: 0.4 });
        }
        if (s.deathTime < 20) {
          const nw = this.emit(`ow${s.id}`, 10 * lod, dt);
          for (let j = 0; j < nw; j++) {
            const a = Math.random() * Math.PI * 2;
            const r = rnd(0.1, 0.5) * L + s.deathTime * 2;
            const ox = s.pos.x + Math.cos(a) * r;
            const oz = s.pos.z + Math.sin(a) * r;
            this.add.spawn({ x: ox, y: 1.5, z: oz, vy: rnd(2, 5), life: rnd(0.6, 1.2), size: rnd(5, 9), size1: 2, color: 0xffb050, color1: 0xff2000, kind: PK.Glow });
            if (Math.random() < 0.3) this.alpha.spawn({ x: ox, y: 4, z: oz, vx: WIND_X * 1.5, vy: rnd(4, 8), vz: WIND_Z * 1.5, life: rnd(8, 12), size: 6, size1: 34, color: 0x141210, color1: 0x46423e, alpha: 0.7, drag: 0.2 });
          }
        }
      }

      // A broken hull burns hard at the break.
      if (s.detonated && s.deathTime < 30) {
        const nb = this.emit(`k${s.id}`, 14 * lod, dt);
        for (let j = 0; j < nb; j++) {
          const w = s.localToWorld(rnd(-6, 6), 3, rnd(-0.4, 0.4) * spec.beam);
          this.add.spawn({ x: w.x, y: Math.max(1, w.y), z: w.z, vx: rnd(-2, 2), vy: rnd(6, 14), vz: rnd(-2, 2), life: rnd(0.7, 1.3), size: 12, size1: 4, color: 0xffd070, color1: 0xff2000, kind: PK.Glow });
          if (Math.random() < 0.4) this.alpha.spawn({ x: w.x, y: Math.max(3, w.y + 6), z: w.z, vx: WIND_X * 1.5, vy: rnd(8, 14), vz: WIND_Z * 1.5, life: rnd(10, 16), size: 10, size1: 60, color: 0x12100e, color1: 0x413d39, alpha: 0.85, drag: 0.2 });
        }
      }

      // Burning wreck while sinking.
      if (!s.alive && !s.withdrawn && s.deathTime < 30) {
        const n = this.emit(`d${s.id}`, 8 * lod, dt);
        for (let j = 0; j < n; j++) {
          const w = s.localToWorld(rnd(-0.4, 0.4) * L, 4, 0);
          this.alpha.spawn({ x: w.x, y: Math.max(2, w.y), z: w.z, vx: WIND_X * 1.5, vy: rnd(6, 10), vz: WIND_Z * 1.5, life: rnd(9, 14), size: 8, size1: 50, color: 0x161412, color1: 0x4a4642, alpha: 0.8, drag: 0.2 });
          if (s.deathTime < 15) this.add.spawn({ x: w.x, y: Math.max(1, w.y), z: w.z, vy: rnd(3, 6), life: 0.8, size: 10, size1: 3, color: 0xffc060, color1: 0xff2000, kind: PK.Glow });
        }
      }

      // Light damage smoke at low health.
      if (s.alive && s.hp / s.maxHp < 0.35) {
        const n = this.emit(`h${s.id}`, 2 * lod, dt);
        for (let j = 0; j < n; j++) {
          const w = s.localToWorld(rnd(-0.3, 0.3) * L, spec.freeboard + 4, 0);
          this.alpha.spawn({ x: w.x, y: w.y, z: w.z, vx: WIND_X, vy: rnd(3, 5), vz: WIND_Z, life: 8, size: 4, size1: 26, color: 0x3b3835, color1: 0x77736e, alpha: 0.45, drag: 0.2 });
        }
      }

      // Skill auras.
      if (s.alive) {
        for (const st of s.skills) {
          if (!st.active) continue;
          const sk = st.spec;
          const tint = sk.accent;
          if (sk.zone) {
            const R = sk.zone;
            if (sk.icon === 'flak') {
              const nb = this.emit(`fc${s.id}:${st.index}`, 18, dt);
              for (let j = 0; j < nb; j++) {
                const a = Math.random() * Math.PI * 2;
                const r = rnd(0.2, 0.95) * R;
                this.flak(s.pos.x + Math.cos(a) * r, rnd(40, R * 0.6), s.pos.z + Math.sin(a) * r, true);
              }
            }
            if (this.emit(`fr${s.id}:${st.index}`, 1, dt)) this.flat.spawn({ x: s.pos.x, y: 1, z: s.pos.z, life: 1.5, size: R * 1.9, size1: R * 2, color: tint, alpha: 0.4, kind: PK.Ring, fadeIn: 0.2 });
          } else if (sk.icon !== 'cloak') {
            const n = this.emit(`a${s.id}:${st.index}`, 10 * lod, dt);
            for (let j = 0; j < n; j++) {
              const w = s.localToWorld(rnd(-0.5, 0.5) * L, spec.freeboard + rnd(0, 10), rnd(-0.6, 0.6) * spec.beam);
              this.add.spawn({ x: w.x, y: w.y, z: w.z, vy: rnd(4, 10), life: 1, size: 3, size1: 0.5, color: tint, kind: PK.Glow });
            }
          }
        }
      }
    }

    // Smoke screens: keep each cloud dense with long-lived puffs.
    g.smokes.forEach((sm) => {
      if (sm.life < 6) return;
      const key = `sm${sm.x.toFixed(0)}:${sm.z.toFixed(0)}`;
      const n = this.emit(key, 1.6, dt);
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * sm.r * 0.75;
        this.alpha.spawn({ x: sm.x + Math.cos(a) * r, y: rnd(10, sm.r * 0.35), z: sm.z + Math.sin(a) * r, vx: WIND_X * 0.4, vy: rnd(0, 1), vz: WIND_Z * 0.4, life: 9, size: sm.r * 0.5, size1: sm.r * 0.95, color: 0xdedcd8, color1: 0xc8c6c2, alpha: 0.85, fadeIn: 0.25, fadeOut: 0.6, drag: 0.2 });
      }
    });
    if (this.emitAcc.size > 4000) this.emitAcc.clear();

    // AA fire around squadrons near enemy ships.
    for (const sq of g.air.squadrons) {
      if (!sq.alive) continue;
      for (const s of g.ships) {
        if (!s.alive || s.team === sq.team || s.submerged) continue;
        const dd = Math.hypot(s.pos.x - sq.x, s.pos.z - sq.z);
        if (dd > s.spec.aa.range) continue;
        const n = this.emit(`aa${sq.id}:${s.id}`, 3 + s.spec.aa.dps / 60, dt);
        for (let j = 0; j < n; j++) this.flak(sq.x + rnd(-120, 120), sq.y + rnd(-30, 50), sq.z + rnd(-120, 120), Math.random() < 0.5);
      }
    }
    for (const m of g.missiles.missiles) {
      if (!m.alive || m.delay > 0) continue;
      const fx = Math.sin(m.heading) * Math.cos(m.pitch);
      const fz = -Math.cos(m.heading) * Math.cos(m.pitch);
      const fy = Math.sin(m.pitch);
      this.add.spawn({ x: m.x - fx * 4, y: m.y - fy * 4, z: m.z - fz * 4, life: 0.08, size: 6, color: 0xffe0a0, color1: 0xff6020, kind: PK.Glow });
      if (this.emit(`m${m.id}`, 20, dt)) this.alpha.spawn({ x: m.x - fx * 6, y: m.y - fy * 6, z: m.z - fz * 6, vx: rnd(-1, 1), vy: rnd(0, 1), vz: rnd(-1, 1), life: rnd(2, 4), size: 2, size1: 9, color: 0xdcd8d0, alpha: 0.45, drag: 0.5 });
    }
  }
}
