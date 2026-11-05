import { SHELL_TIME_SCALE, SIM_DT } from '../../config';
import type { GunLook, Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { MiscFxKind, MiscTitanEvent } from '../../skills/misc/MiscEvents';
import type { Shell } from '../../weapons/ShellSystem';
import { BK, hash01 } from '../BurstParticles';
import { clamp01, easeOut, hot, TAU, type MiscFxKit } from './MiscFxKit';

/** Event bursts one misc titan's effects keep at once; the oldest plays out first. */
export const MISC_FX_BURSTS = 48;

/** One `miscTitan` event being played, stamped with the game time it arrived. */
export interface MiscBurst {
  e: MiscTitanEvent;
  time: number;
  id: number;
}

export interface MiscPalette {
  /** The titan's signature colour. */
  main: number;
  /** Its white-hot highlight. */
  hot: number;
  /** Its dark accent (ink, basalt, lacquer). */
  deep: number;
}

/**
 * One misc titan's effects: the bursts its events play, the flight of its battery's rounds and the
 * persistent cues (courts, dolls, ridges) it keeps on the battlefield.
 */
export abstract class MiscShipFx {
  abstract readonly look: GunLook;
  abstract readonly palette: MiscPalette;
  protected list: MiscBurst[] = [];
  private serial = 0;

  constructor(protected readonly kit: MiscFxKit) {}

  /** Whether `s` is this effect's titan. */
  abstract owns(s: Ship): boolean;

  get bursts(): number {
    return this.list.length;
  }

  /** Seconds a burst of `kind` plays for. */
  protected life(kind: MiscFxKind): number {
    return kind === 'gunHit' ? 1.2 : 1.6;
  }

  add(e: MiscTitanEvent): void {
    const b = { e, time: this.kit.game.time, id: this.serial++ };
    this.list.push(b);
    if (this.list.length > MISC_FX_BURSTS) this.list.shift();
    this.arrive(b);
  }

  /** Called once as a burst arrives: the place for camera shake and sky flashes. */
  protected arrive(_b: MiscBurst): void {}

  drop(s: Ship): void {
    this.list = this.list.filter((b) => b.e.ship !== s);
  }

  clear(): void {
    this.list = [];
  }

  /** Forgets bursts that have played out, then poses the pooled groups this titan keeps in `live`. */
  update(live: Set<string>): void {
    const now = this.kit.game.time;
    this.list = this.list.filter((b) => now >= b.time && now - b.time < this.life(b.e.kind));
    this.persist(live);
  }

  /** Builds and poses this titan's scene groups, adding each key it keeps to `live`. */
  protected persist(_live: Set<string>): void {}

  /** Draws everything `team`'s view may see this frame. */
  draw(team: Team | -1): void {
    const now = this.kit.game.time;
    for (const b of this.list) if (this.shows(b, team)) this.burst(b, now - b.time);
    this.flights();
    this.cues(team);
  }

  /** Battery impacts are as public as the splashes under them; everything else follows the titan. */
  protected shows(b: MiscBurst, team: Team | -1): boolean {
    if (b.e.kind === 'gunHit' || b.e.kind === 'gunLand') return true;
    return this.kit.visible(b.e.ship, team);
  }

  protected burst(b: MiscBurst, age: number): void {
    if (b.e.kind === 'gunHit') this.gunHit(b, age);
    else if (b.e.kind === 'gunLand') this.gunLand(b, age);
  }

  /** Persistent per-viewport cues; shows the pooled groups `team` may see. */
  protected cues(_team: Team | -1): void {}

  /** A battery round striking a hull: a flare, a spray of sparks and a shock ring. */
  protected gunHit(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z, target } = b.e;
    const p = this.palette;
    const f = clamp01(age / this.life('gunHit'));
    const fade = 1 - f;
    const y = target ? target.renderPos.y + target.spec.freeboard * 0.6 : kit.surface(x, z) + 8;
    kit.glow(x, y, z, 30 + 110 * fade, hot(p.hot, 2.2), 0.9 * fade);
    kit.particles.push(BK.Flare, x, y, z, 160 * easeOut(age * 6) * fade, hot(p.main, 1.8), 0.8 * fade, b.id);
    const n = Math.round(12 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const up = 0.3 + hash01(b.id, i + 50) * 0.9;
      const d = (120 + hash01(b.id, i + 99) * 160) * age;
      const sx = Math.cos(a);
      const sz = Math.sin(a);
      kit.particles.push(BK.Spark, x + sx * d, y + up * d - 120 * age * age, z + sz * d, 4, hot(p.hot, 2), 0.9 * fade, 0, i, sx * 16, up * 16, sz * 16, 2);
    }
    kit.shock(x, z, 30 + 160 * easeOut(f), hot(p.main, 1.2), 0.5 * fade);
  }

  /** A battery round falling in the sea: a coloured splash and ring. */
  protected gunLand(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const p = this.palette;
    const f = clamp01(age / this.life('gunLand'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    kit.particles.push(BK.Spray, x, y + 30 * easeOut(age * 3), z, 60 + 60 * f, hot(0xf4f8ff, 1), 0.7 * fade, b.id);
    kit.glow(x, y + 6, z, 20 + 60 * fade, hot(p.hot, 1.6), 0.6 * fade);
    kit.shock(x, z, 20 + 150 * easeOut(f), hot(p.main, 1.1), 0.45 * fade);
  }

  /** Decorates every round of this titan's battery look in flight. */
  private flights(): void {
    const g = this.kit.game;
    const back = (1 - g.alpha) * SIM_DT * SHELL_TIME_SCALE;
    for (const s of g.shells.shells) {
      if (!s.alive || s.look !== this.look) continue;
      const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
      this.flight(s, s.x - s.vx * back, s.y - s.vy * back, s.z - s.vz * back, s.vx / sp, s.vy / sp, s.vz / sp);
    }
  }

  /** One round of the battery at (x, y, z) heading along the unit vector (dx, dy, dz). */
  protected flight(_s: Shell, x: number, y: number, z: number, _dx: number, _dy: number, _dz: number): void {
    this.kit.glow(x, y, z, 24, hot(this.palette.hot, 2), 0.8);
  }

  dispose(): void {
    this.list = [];
  }
}
