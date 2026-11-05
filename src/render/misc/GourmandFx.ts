import { Color } from 'three';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { GOURMAND, type GourmandState } from '../../skills/misc/GourmandRuntime';
import type { MiscFxKind } from '../../skills/misc/MiscEvents';
import type { Shell } from '../../weapons/ShellSystem';
import { BK, hash01 } from '../BurstParticles';
import { bump, clamp01, easeOut, hot, mix, TAU } from './MiscFxKit';
import { MiscShipFx, type MiscBurst } from './MiscShipFx';

const AMBER = 0xffa040;
const FIRE = 0xff793b;
const GOLD = 0xffca73;
const STEAM = 0xfff0dc;
const CHAR = 0x6a2a10;
const SAUCE = 0xd8402a;
const STEEL = 0xc8d4e0;
const GAS = 0xd8e070;
const ROPE = 0x4a2c18;
const SEA = 0xf4f8ff;

/** Each flavour's tint by `flavourIndex`: plain, shell, explosive, scrap. */
const TINT = [AMBER, 0xffd88a, 0xff5a24, 0xa9c2d6];

/** Seconds the cooker, a gulped round, the skewer fork and a spat ship spend in the air. */
const COOKER_FLIGHT = 0.4;
const GULP_FLIGHT = 0.4;
const SKEWER_FLIGHT = 0.22;
const SPIT_FLIGHT = 0.3;
/** The bite circle the runtime warns with. */
const BITE_RADIUS = 380;

/** Seconds each Gourmand burst plays. */
const LIFE: Partial<Record<MiscFxKind, number>> = {
  dish: 1.1,
  devour: 0.9,
  gulp: 0.7,
  chomp: 0.6,
  carve: 1.1,
  slice: 1,
  cooker: GOURMAND.cooker.fuse + 0.05,
  cookerBurst: 1.6,
  skewer: 0.7,
  serve: GOURMAND.serve.delay + 0.05,
  side: GOURMAND.serve.delay + 0.05,
  plate: 1.2,
  comfort: 1.6,
  burp: 1.1,
  banquet: 1.6,
  bite: GOURMAND.swallow.warning,
  swallow: 1.1,
  spit: 1.3,
  fuse: GOURMAND.catastrophe.fuse,
  catastrophe: 2.4,
};

/** Bursts anyone may see: lobbed dishes and pots, their landings, and the kitchen going up. */
const PUBLIC = new Set<MiscFxKind>(['dish', 'plate', 'serve', 'side', 'cooker', 'cookerBurst', 'catastrophe']);
/** Bursts that happen to a ship, shown only where that ship can be seen. */
const ANCHORED = new Set<MiscFxKind>(['chomp', 'slice', 'bite', 'swallow', 'spit']);

/**
 * The Gourmand: a mouth that drags ships in and snaps, giant cutlery, a whistling pressure cooker,
 * flying platters, a swallowed hull digesting, a burp and the kitchen blowing up.
 */
export class GourmandFx extends MiscShipFx {
  readonly look = 'dish' as const;
  readonly palette = { main: AMBER, hot: 0xfff0c0, deep: CHAR };
  /** Colours held across many draws; `hot` and `mix` only keep four scratch colours alive. */
  private readonly held = [new Color(), new Color(), new Color()];

  owns(s: Ship): boolean {
    return !!s.gourmand;
  }

  protected life(kind: MiscFxKind): number {
    return LIFE[kind] ?? super.life(kind);
  }

  protected arrive(b: MiscBurst): void {
    const { kit } = this;
    const { ship, kind, x, z } = b.e;
    const shake = (k: number) => {
      if (!kit.reduce) kit.onShake?.(ship, x, z, k);
    };
    if (kind === 'catastrophe') {
      kit.onFlash?.(x, z, 0.7, FIRE);
      shake(0.6);
    } else if (kind === 'cookerBurst') {
      kit.onFlash?.(x, z, 0.3, AMBER);
      shake(0.25);
    } else if (kind === 'swallow') {
      kit.onFlash?.(x, z, 0.25, FIRE);
      shake(0.35);
    } else if (kind === 'burp' || kind === 'spit') shake(0.2);
  }

  protected shows(b: MiscBurst, team: Team | -1): boolean {
    const { kind, target } = b.e;
    if (PUBLIC.has(kind)) return true;
    if (ANCHORED.has(kind) && target) return this.kit.visible(target, team);
    return super.shows(b, team);
  }

  protected burst(b: MiscBurst, age: number): void {
    switch (b.e.kind) {
      case 'dish':
        return this.dish(b, age);
      case 'devour':
        return this.yawn(b, age);
      case 'gulp':
        return this.gulp(b, age);
      case 'chomp':
        return this.chomp(b, age);
      case 'carve':
        return this.carve(b, age);
      case 'slice':
        return this.slice(b, age);
      case 'cooker':
        return this.cooker(b, age);
      case 'cookerBurst':
        return this.cookerBurst(b, age);
      case 'skewer':
        return this.skewer(b, age);
      case 'serve':
        return this.serving(b, age, 70);
      case 'side':
        return this.serving(b, age, 48);
      case 'plate':
        return this.plate(b, age);
      case 'comfort':
        return this.comfort(b, age);
      case 'burp':
        return this.burp(b, age);
      case 'banquet':
        return this.feast(b, age);
      case 'bite':
        return this.bite(b, age);
      case 'swallow':
        return this.swallow(b, age);
      case 'spit':
        return this.spit(b, age);
      case 'fuse':
        return this.fuse(b, age);
      case 'catastrophe':
        return this.catastrophe(b, age);
      // The galley mortar's own dishes stand in for the shared battery splash.
      default:
    }
  }

  // ------------------------------------------------------------------ persistent cues

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    for (const s of kit.game.ships) {
      const a = s.gourmand;
      if (!a || !s.alive || s.withdrawn) continue;
      const seen = kit.visible(s, team);
      if (a.bite) {
        // The bite warning belongs to its victim: it shows wherever the victim may be seen.
        const v = this.ship(a.bite.target);
        if (v && kit.visible(v, team)) kit.ring(a.bite.x, a.bite.z, BITE_RADIUS, 8, hot(STEAM, 1.4), 0.75, 7, kit.t * 0.15, 48);
      }
      for (const bleed of a.bleeds) {
        const v = this.ship(bleed.target);
        if (v && bleed.until > now && kit.visible(v, team)) this.bleed(v, bleed.target);
      }
      if (!seen) continue;
      if (a.reel) {
        const v = this.ship(a.reel.target);
        if (v && kit.visible(v, team)) this.rope(s, v);
      }
      const banquet = a.banquetUntil > now;
      if (a.mouthUntil > now) this.maw(s, team);
      if (banquet) this.table(s, a);
      if (a.mouthUntil > now || banquet) this.throat(s, banquet ? GOURMAND.banquetMouth : GOURMAND.mouth, banquet ? GOLD : FIRE);
      if (a.swallow) this.digest(s, a.swallow.until - now);
    }
  }

  /** Rings drawn down into the open throat. */
  private throat(s: Ship, radius: number, color: number): void {
    const { kit } = this;
    const m = this.mouth(s);
    const c = this.held[0].copy(hot(color, 1.6));
    for (let i = 0; i < 3; i++) {
      const f = (kit.t * 0.8 + i / 3) % 1;
      kit.ring(m.x, m.z, 20 + radius * (1 - f), m.y - 6, c, 0.12 + 0.35 * f, 4, -kit.t * 1.5 - f * 2, 32);
    }
    kit.glow(m.x, m.y, m.z, radius * 0.6, hot(color, 1.4), 0.35);
  }

  /** Devour's suction: streaks curling in across the water ahead, wakes behind ships being drawn in. */
  private maw(s: Ship, team: Team | -1): void {
    const { kit } = this;
    const t = kit.t;
    const m = this.mouth(s);
    const fx = Math.sin(s.renderHeading);
    const fz = -Math.cos(s.renderHeading);
    const bow = Math.atan2(fz, fx);
    const reach = GOURMAND.devour.pull;
    const fire = this.held[0].copy(hot(FIRE, 1.5));
    kit.ring(m.x, m.z, GOURMAND.devour.chomp, 6, fire, 0.32, 4, t * 0.4, 48, true);
    const streak = this.held[1].copy(hot(STEAM, 1.3));
    const n = Math.max(8, Math.round(18 * kit.k));
    for (let i = 0; i < n; i++) {
      const f = (t * 0.6 + hash01(i, 7)) % 1;
      const lane = (hash01(i, 3) - 0.5) * 2.4;
      const r0 = 60 + reach * (1 - f);
      const r1 = 60 + reach * (1 - Math.min(1, f + 0.08));
      // The closer in, the tighter the curl.
      const a0 = bow + lane * (r0 / reach) + 1.1 * (1 - r0 / reach);
      const a1 = bow + lane * (r1 / reach) + 1.1 * (1 - r1 / reach);
      kit.line(m.x + Math.cos(a0) * r0, 5, m.z + Math.sin(a0) * r0, m.x + Math.cos(a1) * r1, 5, m.z + Math.sin(a1) * r1, streak, 0.5 * bump(f), 3);
    }
    for (const v of kit.game.ships) {
      if (v.team === s.team || !kit.visible(v, team)) continue;
      const dx = m.x - v.renderPos.x;
      const dz = m.z - v.renderPos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 1 || (v.renderPos.x - s.renderPos.x) * fx + (v.renderPos.z - s.renderPos.z) * fz <= 0) continue;
      kit.line(v.renderPos.x, 6, v.renderPos.z, m.x, 6, m.z, fire, 0.22, 8);
      const bx = v.renderPos.x + (dx / d) * v.spec.length * 0.45;
      const bz = v.renderPos.z + (dz / d) * v.spec.length * 0.45;
      kit.particles.push(BK.Spray, bx, 12, bz, 70, hot(SEA, 1), 0.45, t * 3 + v.id, v.id);
    }
  }

  /** Banquet's golden table around the hull, its candles and the time left at the feast. */
  private table(s: Ship, a: GourmandState): void {
    const { kit } = this;
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    const r = s.spec.length * 0.85;
    const gold = this.held[1].copy(hot(GOLD, 1.7));
    kit.ring(x, z, r, 10, gold, 0.5, 6, kit.t * 0.2, 64);
    this.arcRing(x, z, r + 30, 12, -Math.PI / 2, TAU * clamp01((a.banquetUntil - kit.game.time) / GOURMAND.banquet.time), gold, 0.8, 5, 64);
    for (let i = 0; i < 8; i++) {
      const ang = kit.t * 0.2 + (i * TAU) / 8;
      const flicker = kit.reduce ? 1 : 0.8 + 0.2 * Math.sin(kit.t * 9 + i * 2.3);
      kit.glow(x + Math.cos(ang) * r, 34, z + Math.sin(ang) * r, 40 * flicker, hot(FIRE, 2), 0.8);
    }
  }

  /** A skewered ship on its rope, reeled toward the mouth. */
  private rope(s: Ship, v: Ship): void {
    const { kit } = this;
    const m = this.mouth(s);
    const tx = v.renderPos.x;
    const ty = v.renderPos.y + v.spec.freeboard + 12;
    const tz = v.renderPos.z;
    const sag = -12 - (kit.reduce ? 0 : 8 * Math.sin(kit.t * 11));
    kit.arc(m.x, m.y + 20, m.z, tx, ty, tz, sag, hot(ROPE, 1), 0.9, 7, 20, 1, true);
    kit.arc(m.x, m.y + 22, m.z, tx, ty + 2, tz, sag, hot(GOLD, 1.5), 0.45, 2, 20);
    const dx = tx - m.x;
    const dz = tz - m.z;
    const d = Math.hypot(dx, dz) || 1;
    this.fork(tx - (dx / d) * 160, ty + 30, tz - (dz / d) * 160, dx / d, -0.15, dz / d, 170, hot(STEEL, 2), 0.95, 5);
    kit.particles.push(BK.Spray, tx - (dx / d) * v.spec.length * 0.4, 12, tz - (dz / d) * v.spec.length * 0.4, 90, hot(SEA, 1), 0.55, kit.t * 4, v.id);
  }

  /** The swallowed ship digesting: the hull glows in pulses and the time left runs around it. */
  private digest(s: Ship, left: number): void {
    const { kit } = this;
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    const deck = s.renderPos.y + s.spec.freeboard;
    const len = s.spec.length;
    for (let k = 0; k < 5; k++) {
      const p = this.hull(s, (k / 4 - 0.5) * len * 0.7);
      const pulse = kit.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(kit.t * 7 - k * 0.9);
      kit.glow(p.x, deck + 8, p.z, 70 + 60 * pulse, hot(FIRE, 1.3 + pulse), 0.45 + 0.3 * pulse);
    }
    kit.ring(x, z, len * 0.45, deck + 20, hot(FIRE, 1.5), 0.6, 5, kit.t * 0.5, 40);
    this.arcRing(x, z, len * 0.6, deck + 40, -Math.PI / 2, TAU * clamp01(left / GOURMAND.swallow.time), hot(GOLD, 1.8), 0.85, 6, 48);
    const n = Math.max(2, Math.round(4 * kit.k));
    for (let i = 0; i < n; i++) {
      const rise = (kit.t * 0.7 + i / n) % 1;
      const p = this.hull(s, (hash01(i, 11) - 0.5) * len * 0.6);
      kit.particles.push(BK.Smoke, p.x, deck + 20 + rise * 160, p.z, 40 + 60 * rise, hot(STEAM, 0.9), 0.4 * (1 - rise), i, s.id + i);
    }
  }

  /** A carved ship dripping sauce. */
  private bleed(v: Ship, seed: number): void {
    const { kit } = this;
    const deck = v.renderPos.y + v.spec.freeboard;
    kit.glow(v.renderPos.x, deck, v.renderPos.z, 60, hot(SAUCE, 1.4), 0.35);
    for (let i = 0; i < 3; i++) {
      const fall = (kit.t * 1.4 + hash01(seed, i)) % 1;
      const p = this.hull(v, (hash01(seed, i + 5) - 0.5) * v.spec.length * 0.6);
      kit.particles.push(BK.Spark, p.x, deck + 10 - fall * deck, p.z, 7, hot(SAUCE, 1.6), 0.8 * (1 - fall), 0, seed + i, 0, -20, 0, 2);
    }
  }

  // ------------------------------------------------------------------ the galley mortar

  /** A mortar dish landing: a food burst tinted by its flavour. */
  private dish(b: MiscBurst, age: number): void {
    const { x, z, target } = b.e;
    const f = clamp01(age / this.life('dish'));
    const y = target ? target.renderPos.y + target.spec.freeboard * 0.6 : this.kit.surface(x, z) + 6;
    this.foodBurst(x, y, z, b.e.radius ?? GOURMAND.battery.splash, b.e.n ?? 0, age, f, b.id, 1);
  }

  /** A flavoured splash: flare, chunks thrown out, steam and a shock ring; shells lance, explosives burn, scrap rings. */
  private foodBurst(x: number, y: number, z: number, r: number, n: number, age: number, f: number, id: number, scale: number): void {
    const { kit } = this;
    const tint = TINT[n] ?? AMBER;
    const fade = 1 - f;
    kit.particles.push(BK.Flare, x, y, z, (140 + r * 0.7) * scale * easeOut(age * 6) * fade, hot(tint, 2.2), 0.9 * fade, id);
    kit.glow(x, y, z, (60 + 160 * fade) * scale, hot(STEAM, 1.6), 0.6 * fade);
    const chunks = Math.round(10 * scale * kit.k);
    for (let i = 0; i < chunks; i++) {
      const a = hash01(id, i) * TAU;
      const out = (90 + hash01(id, i + 40) * 140) * scale;
      const up = (120 + hash01(id, i + 80) * 160) * scale;
      const py = y + up * age - 260 * age * age;
      if (py < 0) continue;
      kit.particles.push(BK.Shard, x + Math.cos(a) * out * age, py, z + Math.sin(a) * out * age, 10 + hash01(id, i + 120) * 10 * scale, hot(i % 3 ? tint : GOLD, 1.5), 0.9 * fade, age * 8 + i, id + i);
    }
    kit.particles.push(BK.Smoke, x, y + 40 * easeOut(age * 2), z, (80 + 120 * f) * scale, hot(STEAM, 0.9), 0.4 * fade, id, id);
    kit.shock(x, z, 30 + r * easeOut(f * 1.6), hot(tint, 1.4), 0.6 * fade);
    if (n === 1) {
      // A shell's dish pierces: a white-hot lance through the hull.
      kit.line(x, y - 20, z, x, y + 280 * scale * easeOut(age * 5), z, hot(0xfff4d0, 2.4), 0.85 * fade, 10 * scale);
    } else if (n === 2) {
      kit.particles.push(BK.Flare, x, y + 40, z, r * 1.2 * easeOut(age * 4) * fade, hot(FIRE, 2), 0.7 * fade, id + 1);
      kit.particles.push(BK.Smoke, x, y + 90 * easeOut(age), z, (120 + 100 * f) * scale, hot(CHAR, 1), 0.5 * fade, id + 2, id);
    } else if (n === 3) {
      const ring = GOURMAND.flavour.shrapnel * easeOut(f * 2);
      kit.ring(x, z, ring, 8, hot(STEEL, 1.8), 0.6 * fade, 4, id, 40, true);
      const bits = Math.round(10 * kit.k);
      for (let i = 0; i < bits; i++) {
        const a = (i / bits) * TAU + hash01(id, i + 200);
        kit.particles.push(BK.Spark, x + Math.cos(a) * ring, y + 10, z + Math.sin(a) * ring, 6, hot(STEEL, 2), fade, 0, id + i, Math.cos(a) * 30, 4, Math.sin(a) * 30, 2);
      }
    }
  }

  /** A tumbling glowing platter trailing steam. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, _dy: number, dz: number): void {
    const { kit } = this;
    this.platter(x, y, z, 16, kit.t * 7 + s.id, AMBER, false);
    const n = Math.max(2, Math.round(5 * kit.k));
    for (let i = 1; i <= n; i++) {
      const back = i * 22;
      kit.particles.push(BK.Smoke, x - dx * back, y + i * 2, z - dz * back, 18 + i * 6, hot(STEAM, 0.9), 0.35 * (1 - i / (n + 1)), s.id + i, s.id + i);
    }
  }

  // ------------------------------------------------------------------ the mouth

  /** Devour: the jaws yawn open at the bow and the chomp reach flashes out. */
  private yawn(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const m = this.mouth(s);
    const fade = 1 - clamp01(age / this.life('devour'));
    this.jaws(m.x, m.y, m.z, 140 + 60 * easeOut(age * 4), this.bowAxis(s), 0.9 - 0.75 * easeOut(age * 3), hot(FIRE, 2), 0.9 * fade, 6);
    kit.particles.push(BK.Flare, m.x, m.y, m.z, 320 * fade, hot(GOLD, 2.2), fade, b.id);
    kit.shock(m.x, m.z, (b.e.radius ?? GOURMAND.devour.chomp) * easeOut(age * 2), hot(AMBER, 1.4), 0.6 * fade);
    kit.particles.push(BK.Spray, m.x, 20 + 40 * easeOut(age * 2), m.z, 160, hot(SEA, 1), 0.6 * fade, b.id);
  }

  /** An eaten round or wreck spiralling into the mouth, then a snap. */
  private gulp(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const m = this.mouth(s);
    const tint = TINT[b.e.n ?? 0] ?? AMBER;
    if (age < GULP_FLIGHT) {
      const at = (f: number) => {
        const orbit = (1 - f) * 90;
        const ang = f * TAU * 2 + b.id;
        return {
          x: b.e.x + (m.x - b.e.x) * f + Math.cos(ang) * orbit,
          y: 40 + (m.y - 40) * f,
          z: b.e.z + (m.z - b.e.z) * f + Math.sin(ang) * orbit,
        };
      };
      const f = (age / GULP_FLIGHT) ** 1.5;
      const p = at(f);
      const q = at(Math.max(0, f - 0.12));
      kit.glow(p.x, p.y, p.z, 46, hot(tint, 2.2), 0.95);
      kit.line(q.x, q.y, q.z, p.x, p.y, p.z, hot(tint, 1.8), 0.7, 5);
      return;
    }
    const f = clamp01((age - GULP_FLIGHT) / (this.life('gulp') - GULP_FLIGHT));
    kit.particles.push(BK.Flare, m.x, m.y, m.z, 170 * (1 - f), hot(tint, 2), 1 - f, b.id);
    this.jaws(m.x, m.y, m.z, 90, this.bowAxis(s), easeOut(f * 4), hot(FIRE, 1.8), 0.8 * (1 - f), 4);
  }

  /** A chomp: jaws snapping shut on a ship (bigger when a skewered ship arrives, on water when a bite misses). */
  private chomp(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const x = t?.renderPos.x ?? b.e.x;
    const z = t?.renderPos.z ?? b.e.z;
    const y = t ? t.renderPos.y + 4 : kit.surface(x, z) + 2;
    const big = b.e.n === 1;
    const r = (t ? t.spec.length * 0.42 : BITE_RADIUS * 0.8) * (big ? 1.3 : 1);
    const f = clamp01(age / this.life('chomp'));
    const fade = 1 - f;
    const s = b.e.ship;
    const axis = Math.atan2(z - s.renderPos.z, x - s.renderPos.x);
    this.jaws(x, y, z, r, axis, easeOut(age / 0.12), hot(FIRE, 2), 0.9 * fade, big ? 8 : 5);
    if (age < 0.18) kit.particles.push(BK.Flare, x, y + r * 0.6, z, r * 2.2 * (1 - age / 0.18), hot(GOLD, 2.4), 1, b.id);
    const sparks = Math.round((big ? 14 : 8) * kit.k);
    for (let i = 0; i < sparks; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = (80 + hash01(b.id, i + 30) * 120) * age;
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, y + r * 0.6 + d - 200 * age * age, z + Math.sin(a) * d, 5, hot(GOLD, 2), fade, 0, b.id + i, Math.cos(a) * 14, 10, Math.sin(a) * 14, 2);
    }
    if (!t) kit.particles.push(BK.Spray, x, y + 80 * easeOut(age * 3), z, 220 + 120 * f, hot(SEA, 1), 0.7 * fade, b.id);
    if (big) kit.shock(x, z, r * 2 * easeOut(f * 2), hot(FIRE, 1.6), 0.7 * fade);
  }

  // ------------------------------------------------------------------ Carve

  /** Carve: a giant knife and fork sweep around the hull in opposite directions, leaving blade trails. */
  private carve(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const cx = s.renderPos.x;
    const cz = s.renderPos.z;
    const radius = b.e.radius ?? GOURMAND.carve.radius;
    const f = clamp01(age / this.life('carve'));
    const fade = 1 - f;
    const sweep = easeOut(age / 0.45) * TAU * 0.75;
    const start = hash01(b.id, 1) * TAU;
    for (let k = 0; k < 2; k++) {
      const dir = k ? -1 : 1;
      const reach = radius * (k ? 0.62 : 0.94);
      const a = start + dir * sweep + k * Math.PI;
      const trail = this.held[2].copy(hot(k ? GOLD : STEEL, 1.9));
      const span = Math.min(sweep, 1.8);
      this.arcRing(cx, cz, reach, 20, dir > 0 ? a - span : a, span, trail, 0.75 * fade, 12, 24, dir > 0 ? 1 : -1);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const len = reach * 0.88;
      const bx = cx + dx * reach * 0.12;
      const bz = cz + dz * reach * 0.12;
      if (k) this.fork(bx, 40, bz, dx, 0, dz, len, hot(GOLD, 2.2), 0.95 * fade, 8);
      else this.knife(bx, 40, bz, dx, 0, dz, len, hot(STEEL, 2.4), 0.95 * fade, 8);
    }
    kit.ring(cx, cz, radius, 8, hot(AMBER, 1.6), 0.45 * fade, 5, 0, 96, true);
    kit.shock(cx, cz, radius * easeOut(f * 2), hot(AMBER, 1.2), 0.4 * fade);
  }

  /** One cut: a white slash across the hull, a sauce-red decal on the water and sparks. */
  private slice(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const deck = t.renderPos.y + t.spec.freeboard;
    const f = clamp01(age / this.life('slice'));
    const fade = 1 - f;
    const ang = hash01(b.id, 2) * Math.PI;
    const half = t.spec.length * 0.7;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    const drawn = easeOut(age / 0.08);
    kit.line(x - ux * half, deck + 20, z - uz * half, x - ux * half + ux * 2 * half * drawn, deck + 20, z - uz * half + uz * 2 * half * drawn, hot(0xffffff, 2.6), 0.95 * fade, 14);
    kit.line(x - ux * half, kit.surface(x, z) + 1, z - uz * half, x + ux * half, kit.surface(x, z) + 1, z + uz * half, hot(SAUCE, 1.2), 0.6 * fade, 26, true);
    const n = Math.round(10 * kit.k);
    for (let i = 0; i < n; i++) {
      const along = (hash01(b.id, i) - 0.5) * 2 * half;
      const up = 60 + hash01(b.id, i + 20) * 120;
      kit.particles.push(BK.Shard, x + ux * along, deck + up * age - 200 * age * age, z + uz * along, 9, hot(i % 2 ? SAUCE : GOLD, 1.6), fade, age * 9 + i, b.id + i);
    }
  }

  // ------------------------------------------------------------------ Pressure Cooker

  /** The cooker flies, lands, then rattles and whistles with its blast radius closing in. */
  private cooker(b: MiscBurst, age: number): void {
    const { kit } = this;
    const sx = b.e.x;
    const sz = b.e.z;
    const tx = b.e.tx ?? sx;
    const tz = b.e.tz ?? sz;
    const ty = kit.surface(tx, tz) + 4;
    const radius = b.e.radius ?? GOURMAND.cooker.radius;
    if (age < COOKER_FLIGHT) {
      const f = age / COOKER_FLIGHT;
      const lift = 120 + Math.min(700, Math.hypot(tx - sx, tz - sz) * 0.25);
      const p = kit.arcAt(sx, 60, sz, tx, ty, tz, lift, f);
      this.pot(p.x, p.y, p.z, 34, 0, 0, 1);
      kit.arc(sx, 60, sz, tx, ty, tz, lift, hot(STEAM, 1.2), 0.3, 2, 24, f);
      kit.particles.push(BK.Smoke, p.x, p.y + 20, p.z, 50, hot(STEAM, 0.9), 0.45, b.id, b.id);
      kit.ring(tx, tz, radius, 6, hot(FIRE, 1.3), 0.4 * f, 4, 0, 64, true);
      return;
    }
    const f = clamp01((age - COOKER_FLIGHT) / (GOURMAND.cooker.fuse - COOKER_FLIGHT));
    const rattle = kit.reduce ? 0 : Math.max(0, Math.sin(kit.t * (30 + 40 * f))) * (2 + 8 * f);
    this.pot(tx, ty + 6, tz, 34, rattle + 4 * f, f, 1);
    // The whistle: a white-hot jet from the spout climbing as the pressure builds.
    const jet = 120 + 520 * f;
    kit.line(tx + 34, ty + 50, tz, tx + 44, ty + 50 + jet, tz, hot(STEAM, 2 + 2 * f), 0.7, 6 + 8 * f);
    const puffs = Math.max(3, Math.round(6 * kit.k));
    for (let i = 0; i < puffs; i++) {
      const rise = (kit.t * 1.4 + i / puffs) % 1;
      kit.particles.push(BK.Smoke, tx + 44 + rise * 30, ty + 60 + rise * jet * 1.2, tz, 40 + 90 * rise, hot(STEAM, 1), 0.55 * (1 - rise), i, b.id + i);
    }
    kit.glow(tx, ty + 40, tz, 120 + 140 * f, hot(FIRE, 1.5 + f), 0.5 + 0.3 * f);
    // The blast radius, and the time left closing in from its edge.
    kit.ring(tx, tz, radius, 6, hot(FIRE, 1.4 + f), 0.45 + 0.35 * f, 5, kit.t * 0.5, 72, true);
    kit.ring(tx, tz, 40 + (radius - 40) * (1 - f), 6, hot(STEAM, 1.6), 0.55, 4, 0, 48);
  }

  /** The cooker bursts: a steam blast, its lid blown sky-high and a fiery ring. */
  private cookerBurst(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const radius = b.e.radius ?? GOURMAND.cooker.radius;
    const y = kit.surface(x, z);
    const f = clamp01(age / this.life('cookerBurst'));
    const fade = 1 - f;
    kit.particles.push(BK.Flare, x, y + 60, z, radius * 1.8 * easeOut(age * 5) * fade, hot(STEAM, 2.4), fade, b.id);
    kit.particles.push(BK.Flare, x, y + 40, z, radius * 1.2 * easeOut(age * 3) * fade, hot(FIRE, 2), 0.8 * fade, b.id + 1);
    const puffs = Math.round(14 * kit.k);
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * TAU + hash01(b.id, i);
      const d = radius * 0.9 * easeOut(age * 1.5) * (0.5 + 0.5 * hash01(b.id, i + 20));
      kit.particles.push(BK.Smoke, x + Math.cos(a) * d, y + 30 + 70 * age, z + Math.sin(a) * d, 120 + 160 * f, hot(STEAM, 1), 0.55 * fade, a, b.id + i);
    }
    const lidY = y + 900 * age - 500 * age * age;
    if (lidY > y) this.disc(x + 80 * age, lidY, z, 40, age * 12, hot(STEEL, 2), 0.9 * fade, 5);
    kit.shock(x, z, radius * easeOut(f * 2.2), hot(FIRE, 1.6), 0.8 * fade);
    kit.ring(x, z, radius * easeOut(f * 2.2), 10, hot(GOLD, 2), 0.7 * fade, 8, 0, 72);
    this.sparks(x, y + 30, z, radius, age, fade, b.id, GOLD, 16);
    if (age < 0.5 && !kit.reduce) kit.distortions.push({ x, y: 50, z, radius: radius * 0.7, strength: 0.7 * (1 - age / 0.5), priority: 3 });
  }

  // ------------------------------------------------------------------ Skewer, Serve and Banquet

  /** The harpoon-fork thrown on its rope, then the strike on the hull. */
  private skewer(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const m = this.mouth(b.e.ship);
    const tx = t.renderPos.x;
    const ty = t.renderPos.y + t.spec.freeboard + 12;
    const tz = t.renderPos.z;
    if (age < SKEWER_FLIGHT) {
      const f = age / SKEWER_FLIGHT;
      const p = kit.arcAt(m.x, m.y + 20, m.z, tx, ty, tz, 120, f);
      const q = kit.arcAt(m.x, m.y + 20, m.z, tx, ty, tz, 120, Math.max(0, f - 0.05));
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dz = p.z - q.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.fork(p.x - (dx / l) * 180, p.y - (dy / l) * 180, p.z - (dz / l) * 180, dx / l, dy / l, dz / l, 180, hot(STEEL, 2.2), 0.95, 6);
      kit.arc(m.x, m.y + 20, m.z, tx, ty, tz, 120, hot(ROPE, 1), 0.85, 6, 20, f, true);
      return;
    }
    const fade = 1 - clamp01((age - SKEWER_FLIGHT) / (this.life('skewer') - SKEWER_FLIGHT));
    kit.particles.push(BK.Flare, tx, ty, tz, 280 * fade, hot(GOLD, 2.4), fade, b.id);
    kit.ring(tx, tz, 80 + 200 * (1 - fade), ty - 10, hot(STEEL, 1.8), 0.8 * fade, 5, 0, 32);
    this.sparks(tx, ty, tz, 200, age - SKEWER_FLIGHT, fade, b.id, STEEL, 10);
  }

  /** A served dish: a platter under its cloche flying a high arc, its landing ring tightening. */
  private serving(b: MiscBurst, age: number, size: number): void {
    const { kit } = this;
    const sx = b.e.x;
    const sz = b.e.z;
    const tx = b.e.tx ?? sx;
    const tz = b.e.tz ?? sz;
    const radius = b.e.radius ?? GOURMAND.banquet.sideRadius;
    const tint = TINT[b.e.n ?? 0] ?? AMBER;
    const f = clamp01(age / GOURMAND.serve.delay);
    const ty = kit.surface(tx, tz) + 10;
    const lift = 250 + Math.hypot(tx - sx, tz - sz) * 0.18;
    const p = kit.arcAt(sx, 60, sz, tx, ty, tz, lift, f);
    this.platter(p.x, p.y, p.z, size, kit.t * 6 + b.id, tint, true);
    kit.arc(sx, 60, sz, tx, ty, tz, lift, hot(GOLD, 1.2), 0.25, 2, 24, f);
    kit.particles.push(BK.Smoke, p.x, p.y + size, p.z, size * 1.2, hot(STEAM, 0.9), 0.4, b.id, b.id);
    const ring = this.held[2].copy(hot(tint, 1.4));
    kit.ring(tx, tz, radius, 6, ring, 0.3 + 0.4 * f, 4, kit.t, 48, true);
    kit.ring(tx, tz, 20 + (radius - 20) * (1 - f), 6, hot(STEAM, 1.4), 0.45, 3, 0, 32);
  }

  /** A served dish landing: the cloche flies off and the food bursts in its flavour. */
  private plate(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const f = clamp01(age / this.life('plate'));
    const y = kit.surface(x, z) + 8;
    const radius = b.e.radius ?? GOURMAND.serve.radius;
    this.foodBurst(x, y, z, radius, b.e.n ?? 0, age, f, b.id, 1.5);
    const lidY = y + 600 * age - 600 * age * age;
    if (lidY > y) this.disc(x - 60 * age, lidY, z + 40 * age, 50, age * 10, hot(STEEL, 2), 0.9 * (1 - f), 4);
    kit.ring(x, z, radius * easeOut(f * 2), 10, hot(GOLD, 1.8), 0.6 * (1 - f), 6, 0, 48);
  }

  /** Banquet laid: a golden flash, the table ring rolling out and confetti sparks rising. */
  private feast(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    const radius = b.e.radius ?? GOURMAND.banquetMouth;
    const f = clamp01(age / this.life('banquet'));
    const fade = 1 - f;
    kit.particles.push(BK.Flare, x, 80, z, 900 * easeOut(age * 4) * fade, hot(GOLD, 2.4), fade, b.id);
    kit.shock(x, z, radius * 2 * easeOut(f * 1.6), hot(GOLD, 1.6), 0.7 * fade);
    kit.ring(x, z, radius * 2 * easeOut(f * 1.6), 12, hot(GOLD, 2), 0.7 * fade, 10, 0, 96);
    const n = Math.round(24 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = 60 + hash01(b.id, i + 30) * radius;
      const rise = 200 + hash01(b.id, i + 60) * 400;
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, 30 + rise * easeOut(age * 1.5), z + Math.sin(a) * d, 7, hot(i % 2 ? GOLD : FIRE, 2), fade, 0, b.id + i, 0, 18, 0, 2);
    }
  }

  // ------------------------------------------------------------------ Comfort Food

  /** Comfort Food: golden steam rising off the hull and a healing helix. */
  private comfort(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    const deck = s.renderPos.y + s.spec.freeboard;
    const len = s.spec.length;
    const fade = 1 - clamp01(age / this.life('comfort'));
    const n = Math.round(12 * kit.k);
    for (let i = 0; i < n; i++) {
      const rise = (age * 0.9 + hash01(b.id, i)) % 1;
      const p = this.hull(s, (hash01(b.id, i + 9) - 0.5) * len * 0.8);
      kit.particles.push(BK.Smoke, p.x, deck + rise * 260, p.z, 60 + 100 * rise, hot(GOLD, 1.3), 0.5 * (1 - rise) * fade, i, b.id + i);
    }
    kit.helix(x, deck, z, len * 0.35, 300 * easeOut(age * 1.5), 2, kit.t * 2, hot(GOLD, 2), 0.65 * fade, 4, 40);
    kit.glow(x, deck + 40, z, len * 0.8, hot(GOLD, 1.6), 0.4 * fade);
  }

  /** The burp: a sickly gold shockwave rolling out and pushing everything with it. */
  private burp(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const radius = b.e.radius ?? GOURMAND.comfort.burp;
    const fade = 1 - clamp01(age / this.life('burp'));
    const front = radius * easeOut(age / 0.35);
    kit.shock(x, z, front, hot(GAS, 1.6), 0.8 * fade);
    // A wobbling front, like a belch should be.
    const segs = 36;
    for (let i = 0; i < segs; i++) {
      const a0 = (i * TAU) / segs;
      const a1 = ((i + 1) * TAU) / segs;
      const r0 = front + Math.sin(i * 3 + age * 20) * 30;
      const r1 = front + Math.sin((i + 1) * 3 + age * 20) * 30;
      kit.line(x + Math.cos(a0) * r0, 14, z + Math.sin(a0) * r0, x + Math.cos(a1) * r1, 14, z + Math.sin(a1) * r1, hot(GAS, 2), 0.8 * fade, 12);
    }
    kit.ring(x, z, radius * easeOut((age - 0.1) / 0.45), 10, hot(GOLD, 1.8), 0.6 * fade, 6, 0, 64);
    const puffs = Math.round(12 * kit.k);
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * TAU;
      kit.particles.push(BK.Smoke, x + Math.cos(a) * front * 0.9, 40, z + Math.sin(a) * front * 0.9, 140, hot(GAS, 1), 0.5 * fade, a, b.id + i);
    }
    if (age < 0.4 && !kit.reduce) kit.distortions.push({ x, y: 40, z, radius: radius * 0.6, strength: 0.6 * (1 - age / 0.4), priority: 2 });
  }

  // ------------------------------------------------------------------ Swallow Whole

  /** The bite warning: jaws rising out of the sea around the circle, the time left closing in. */
  private bite(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const radius = b.e.radius ?? BITE_RADIUS;
    const f = clamp01(age / this.life('bite'));
    const s = b.e.ship;
    const axis = Math.atan2(z - s.renderPos.z, x - s.renderPos.x);
    this.jaws(x, kit.surface(x, z), z, radius, axis, 0.08 + 0.22 * easeOut(f), hot(FIRE, 1.4 + f), 0.5 + 0.4 * f, 6);
    kit.ring(x, z, 30 + (radius - 30) * (1 - f), 7, hot(FIRE, 1.8), 0.6, 4, 0, 48);
    kit.shock(x, z, radius, hot(CHAR, 1), 0.35 + 0.3 * f, BK.Foam);
  }

  /** The bite lands: jaws snap shut, sink, and the sea gulps after them. */
  private swallow(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const f = clamp01(age / this.life('swallow'));
    const fade = 1 - f;
    const s = b.e.ship;
    const axis = Math.atan2(z - s.renderPos.z, x - s.renderPos.x);
    const y = kit.surface(x, z) - 200 * clamp01((age - 0.3) / 0.8);
    this.jaws(x, y, z, BITE_RADIUS * 0.9, axis, 0.3 + 0.7 * easeOut(age / 0.14), hot(FIRE, 2.2), 0.95 * fade, 9);
    if (age < 0.25) kit.particles.push(BK.Flare, x, 160, z, 900 * (1 - age / 0.25), hot(GOLD, 2.6), 1, b.id);
    kit.particles.push(BK.Spray, x, 20 + 140 * easeOut(age * 2), z, 260 + 220 * f, hot(SEA, 1), 0.75 * fade, b.id);
    kit.shock(x, z, BITE_RADIUS * 1.2 * easeOut(f * 2), hot(STEAM, 1.2), 0.6 * fade, BK.Foam);
    this.sparks(x, 120, z, 300, age, fade, b.id, FIRE, 12);
  }

  /** The swallowed ship spat out: a glob arcs from the mouth and splashes down hard. */
  private spit(b: MiscBurst, age: number): void {
    const { kit } = this;
    const m = this.mouth(b.e.ship);
    const tx = b.e.tx ?? b.e.x;
    const tz = b.e.tz ?? b.e.z;
    const ty = kit.surface(tx, tz);
    const radius = b.e.radius ?? GOURMAND.swallow.spitRadius;
    const lift = 300 + Math.hypot(tx - m.x, tz - m.z) * 0.2;
    if (age < SPIT_FLIGHT) {
      const f = age / SPIT_FLIGHT;
      const p = kit.arcAt(m.x, m.y, m.z, tx, ty, tz, lift, f);
      kit.glow(p.x, p.y, p.z, 160, hot(GAS, 2), 0.9);
      kit.arc(m.x, m.y, m.z, tx, ty, tz, lift, hot(GAS, 1.6), 0.5, 10, 20, f);
      kit.particles.push(BK.Spray, p.x, p.y, p.z, 120, hot(SEA, 1), 0.6, b.id, b.id);
      return;
    }
    const f = clamp01((age - SPIT_FLIGHT) / (this.life('spit') - SPIT_FLIGHT));
    const fade = 1 - f;
    kit.particles.push(BK.Flare, tx, ty + 40, tz, radius * 1.4 * easeOut(f * 6) * fade, hot(GAS, 2.2), fade, b.id);
    kit.particles.push(BK.Spray, tx, ty + 200 * easeOut(f * 3), tz, 300 + 200 * f, hot(SEA, 1), 0.8 * fade, b.id);
    kit.shock(tx, tz, radius * easeOut(f * 2), hot(GAS, 1.6), 0.8 * fade);
    kit.ring(tx, tz, radius * easeOut(f * 2), 10, hot(GOLD, 1.8), 0.6 * fade, 8, 0, 64);
  }

  // ------------------------------------------------------------------ Kitchen Catastrophe

  /** The fuse: the furnace hull glowing hotter, jets of flame and the blast radius closing in. */
  private fuse(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    const deck = s.renderPos.y + s.spec.freeboard;
    const radius = b.e.radius ?? GOURMAND.catastrophe.radius;
    const f = clamp01(age / this.life('fuse'));
    for (let k = 0; k < 5; k++) {
      const p = this.hull(s, (k / 4 - 0.5) * s.spec.length * 0.8);
      const flicker = kit.reduce ? 1 : 0.8 + 0.2 * Math.sin(kit.t * 20 + k);
      kit.glow(p.x, deck + 10, p.z, (80 + 160 * f) * flicker, hot(FIRE, 1.5 + 2 * f), 0.6 + 0.3 * f);
      kit.particles.push(BK.Flare, p.x, deck + 40 + 120 * f * flicker, p.z, 60 + 140 * f, hot(GOLD, 2), 0.7, k, b.id + k);
    }
    this.sparks(x, deck + 30, z, 200 + 300 * f, (kit.t * 0.8) % 1, 1, b.id, FIRE, 10);
    kit.ring(x, z, radius, 8, hot(FIRE, 1.5 + f), 0.4 + 0.4 * f, 8, kit.t * 0.6, 96, true);
    kit.ring(x, z, 60 + (radius - 60) * (1 - f), 8, hot(STEAM, 1.6), 0.55, 5, 0, 64);
  }

  /** The kitchen blows: a furnace mushroom, a shock to the blast radius, cutlery and pan shards flying. */
  private catastrophe(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const radius = b.e.radius ?? GOURMAND.catastrophe.radius;
    const y0 = kit.surface(x, z);
    const f = clamp01(age / this.life('catastrophe'));
    const fade = 1 - f;
    if (age < 0.4) kit.particles.push(BK.Flare, x, y0 + 80, z, radius * 2 * easeOut(age * 6) * (1 - age / 0.4), hot(0xfff4d0, 3), 1, b.id);
    // The mushroom: a stem climbing under a rolling cap, cooling from fire to char.
    const rise = easeOut(age / 1.4);
    const top = 120 + 900 * rise;
    const smoke = this.held[0].copy(mix(FIRE, CHAR, f * 1.4, 1.2 - 0.5 * f));
    const stem = Math.max(4, Math.round(8 * kit.k));
    for (let i = 0; i < stem; i++) {
      const h = (top * (i + 0.5)) / stem;
      const wobble = Math.sin(i * 1.7 + age * 3) * 30;
      kit.particles.push(BK.Smoke, x + wobble, y0 + h, z - wobble * 0.5, 140 + 60 * (i / stem), smoke, 0.7 * fade, i + age, b.id + i);
    }
    if (age < 1) kit.particles.push(BK.Flare, x, y0 + top * 0.5, z, 420 * (1 - age), hot(FIRE, 2.4), 1 - age, b.id + 1);
    const capR = 150 + 350 * rise;
    const cap = Math.max(6, Math.round(14 * kit.k));
    for (let i = 0; i < cap; i++) {
      const a = (i / cap) * TAU + age * 0.5;
      kit.particles.push(BK.Smoke, x + Math.cos(a) * capR, y0 + top + Math.sin(a * 3) * 40, z + Math.sin(a) * capR, 180 + 140 * rise, smoke, 0.75 * fade, a, b.id + 40 + i);
    }
    kit.glow(x, y0 + top, z, capR * 2.2, hot(FIRE, 2.2 * fade + 0.3), 0.7 * fade);
    // The ground shock out to the blast radius.
    kit.shock(x, z, radius * easeOut(age / 0.6), hot(FIRE, 1.8), 0.9 * fade);
    kit.ring(x, z, radius * easeOut(age / 0.6), 10, hot(GOLD, 2.2), 0.8 * (1 - clamp01(age / 0.9)), 14, 0, 128);
    // Cutlery and pan shards thrown from the blast.
    const pieces = Math.round(15 * kit.k);
    for (let i = 0; i < pieces; i++) {
      const a = hash01(b.id, i) * TAU;
      const out = radius * (0.35 + 0.35 * hash01(b.id, i + 30));
      const up = 500 + hash01(b.id, i + 60) * 400;
      const py = y0 + up * age - 450 * age * age;
      if (py < y0) continue;
      const px = x + Math.cos(a) * out * age;
      const pz = z + Math.sin(a) * out * age;
      const spin = age * (6 + 6 * hash01(b.id, i + 90)) + i;
      const dx = Math.cos(spin) * Math.cos(a);
      const dy = Math.sin(spin);
      const dz = Math.cos(spin) * Math.sin(a);
      if (i % 3 === 0) this.knife(px, py, pz, dx, dy, dz, 90, hot(STEEL, 2), 0.9 * fade, 4);
      else if (i % 3 === 1) this.fork(px, py, pz, dx, dy, dz, 80, hot(STEEL, 2), 0.9 * fade, 4);
      else kit.particles.push(BK.Shard, px, py, pz, 30, hot(CHAR, 1.4), fade, spin, b.id + i);
    }
    if (age < 1.2 && !kit.reduce) kit.distortions.push({ x, y: 150, z, radius: radius * 0.5, strength: 0.9 * (1 - age / 1.2), priority: 4 });
  }

  // ------------------------------------------------------------------ shapes

  private ship(id: number): Ship | null {
    return this.kit.game.ships.find((v) => v.id === id && v.alive) ?? null;
  }

  /** The bow mouth at render time. */
  private mouth(s: Ship): { x: number; y: number; z: number } {
    const p = this.hull(s, s.spec.length * 0.5 + 95);
    return { x: p.x, y: s.renderPos.y + s.spec.freeboard * 0.5 + 10, z: p.z };
  }

  /** A point `along` metres forward of a ship's centre at render time. */
  private hull(s: Ship, along: number): { x: number; z: number } {
    return { x: s.renderPos.x + Math.sin(s.renderHeading) * along, z: s.renderPos.z - Math.cos(s.renderHeading) * along };
  }

  /** The bearing of a ship's bow, as an angle on the water. */
  private bowAxis(s: Ship): number {
    return Math.atan2(-Math.cos(s.renderHeading), Math.sin(s.renderHeading));
  }

  /**
   * Two toothed half-rings hinged on a line through (x, z) at angle `axis`: flat on the water at
   * `close` 0, meeting overhead at 1.
   */
  private jaws(x: number, y: number, z: number, r: number, axis: number, close: number, c: Color, a: number, w: number): void {
    const { kit } = this;
    const ux = Math.cos(axis);
    const uz = Math.sin(axis);
    const phi = (clamp01(close) * Math.PI) / 2;
    const flat = Math.cos(phi);
    const lift = Math.sin(phi);
    const segs = 14;
    for (const side of [-1, 1]) {
      const at = (th: number, k: number, axisOut: 'x' | 'y' | 'z'): number => {
        const along = Math.cos(th) * r * k;
        const out = Math.sin(th) * r * k;
        if (axisOut === 'y') return y + out * lift;
        if (axisOut === 'x') return x + ux * along - uz * out * flat * side;
        return z + uz * along + ux * out * flat * side;
      };
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI;
        const t1 = ((i + 1) / segs) * Math.PI;
        const x0 = at(t0, 1, 'x');
        const y0 = at(t0, 1, 'y');
        const z0 = at(t0, 1, 'z');
        const x1 = at(t1, 1, 'x');
        const y1 = at(t1, 1, 'y');
        const z1 = at(t1, 1, 'z');
        kit.line(x0, y0, z0, x1, y1, z1, c, a, w);
        // A tooth pointing in toward the hinge.
        const tm = (t0 + t1) / 2;
        const tx = at(tm, 0.8, 'x');
        const ty = at(tm, 0.8, 'y');
        const tz = at(tm, 0.8, 'z');
        kit.line(x0, y0, z0, tx, ty, tz, c, a, w * 0.7);
        kit.line(tx, ty, tz, x1, y1, z1, c, a, w * 0.7);
      }
    }
  }

  /** A fork from (x, y, z) along unit (dx, dy, dz): handle, crossbar and four tines. */
  private fork(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, c: Color, a: number, w: number): void {
    const seg = this.cutleryLine(x, y, z, dx, dy, dz, len, c, a);
    seg(0, 0, 0.55, 0, w * 1.3);
    seg(0.55, -0.11, 0.55, 0.11, w);
    for (const o of [-0.1, -0.033, 0.033, 0.1]) seg(0.55, o, 1, o, w * 0.8);
  }

  /** A chef's knife from (x, y, z) along unit (dx, dy, dz): handle, bolster, spine and curved edge. */
  private knife(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, c: Color, a: number, w: number): void {
    const seg = this.cutleryLine(x, y, z, dx, dy, dz, len, c, a);
    seg(0, 0, 0.3, 0, w * 1.5);
    seg(0.3, -0.02, 0.3, 0.14, w);
    seg(0.3, 0, 1, 0, w);
    const edge = (f: number) => 0.13 * Math.sqrt(Math.max(0, 1 - ((f - 0.3) / 0.7) ** 2));
    for (let i = 0; i < 8; i++) {
      const f0 = 0.3 + (0.7 * i) / 8;
      const f1 = 0.3 + (0.7 * (i + 1)) / 8;
      seg(f0, edge(f0), f1, edge(f1), w * 0.8);
    }
  }

  /** Draws a segment between (along, side) pairs in a piece of cutlery's own plane. */
  private cutleryLine(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, c: Color, a: number) {
    let sx = -dz;
    let sz = dx;
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-3) {
      sx = 1;
      sz = 0;
    } else {
      sx /= sl;
      sz /= sl;
    }
    return (f0: number, o0: number, f1: number, o1: number, w: number): void =>
      this.kit.line(
        x + dx * len * f0 + sx * len * o0,
        y + dy * len * f0,
        z + dz * len * f0 + sz * len * o0,
        x + dx * len * f1 + sx * len * o1,
        y + dy * len * f1,
        z + dz * len * f1 + sz * len * o1,
        c,
        a,
        w,
      );
  }

  /** A pot: base and rim rings, staves, two handles and a lid lifted `lid` by the pressure. */
  private pot(x: number, y: number, z: number, r: number, lid: number, heat: number, a: number): void {
    const { kit } = this;
    const body = this.held[1].copy(mix(STEEL, FIRE, heat, 1.4 + heat));
    const h = r * 1.1;
    kit.ring(x, z, r, y, body, a, 4, 0, 16);
    kit.ring(x, z, r, y + h, body, a, 4, 0, 16);
    for (let i = 0; i < 6; i++) {
      const ang = (i * TAU) / 6;
      kit.line(x + Math.cos(ang) * r, y, z + Math.sin(ang) * r, x + Math.cos(ang) * r, y + h, z + Math.sin(ang) * r, body, a, 3);
    }
    for (const side of [-1, 1]) {
      kit.line(x + side * r, y + h * 0.85, z, x + side * r * 1.4, y + h * 0.75, z, body, a, 3);
      kit.line(x + side * r * 1.4, y + h * 0.75, z, x + side * r, y + h * 0.5, z, body, a, 3);
    }
    const ly = y + h + lid;
    const top = this.held[2].copy(hot(STEEL, 1.8));
    kit.ring(x, z, r * 1.02, ly, top, a, 4, 0, 16);
    for (let k = 0; k < 2; k++) {
      const ang = (k * Math.PI) / 2;
      kit.arc(x - Math.cos(ang) * r, ly, z - Math.sin(ang) * r, x + Math.cos(ang) * r, ly, z + Math.sin(ang) * r, r * 0.4, top, a, 3, 10);
    }
    kit.glow(x, ly + r * 0.45, z, 16, hot(GOLD, 2), a);
    kit.glow(x, y + h * 0.5, z, r * 2.4, hot(FIRE, 1 + 1.5 * heat), (0.25 + 0.5 * heat) * a);
  }

  /** A platter tumbling about `spin`, under a domed cloche when `cloche` is set. */
  private platter(x: number, y: number, z: number, r: number, spin: number, tint: number, cloche: boolean): void {
    const { kit } = this;
    const tilt = cloche ? 0.25 * Math.sin(spin) : spin;
    const rim = this.held[1].copy(hot(STEEL, 1.8));
    this.disc(x, y, z, r, tilt, rim, 0.85, 4);
    this.disc(x, y + 2, z, r * 0.65, tilt, rim, 0.5, 2);
    if (cloche) {
      const dome = this.held[2].copy(hot(tint, 1.6));
      for (let k = 0; k < 3; k++) {
        const ang = spin * 0.3 + (k * Math.PI) / 3;
        kit.arc(x - Math.cos(ang) * r * 0.8, y, z - Math.sin(ang) * r * 0.8, x + Math.cos(ang) * r * 0.8, y, z + Math.sin(ang) * r * 0.8, r * 0.7, dome, 0.8, 3, 10);
      }
      kit.glow(x, y + r * 0.75, z, r * 0.35, hot(GOLD, 2.2), 0.9);
    }
    kit.glow(x, y, z, r * 2.2, hot(tint, 2), 0.6);
  }

  /** A circle of radius `r` tilted `tilt` about the x axis. */
  private disc(x: number, y: number, z: number, r: number, tilt: number, c: Color, a: number, w: number): void {
    const { kit } = this;
    const sy = Math.sin(tilt);
    const sz = Math.cos(tilt);
    const segs = 16;
    for (let i = 0; i < segs; i++) {
      const a0 = (i * TAU) / segs;
      const a1 = ((i + 1) * TAU) / segs;
      kit.line(x + Math.cos(a0) * r, y + Math.sin(a0) * r * sy, z + Math.sin(a0) * r * sz, x + Math.cos(a1) * r, y + Math.sin(a1) * r * sy, z + Math.sin(a1) * r * sz, c, a, w);
    }
  }

  /** Part of a ring from angle `from` through `span`; `ramp` 1 or -1 brightens it toward one end. */
  private arcRing(x: number, z: number, r: number, y: number, from: number, span: number, c: Color, a: number, w: number, segments: number, ramp = 0): void {
    const n = Math.max(1, Math.ceil((segments * Math.abs(span)) / TAU));
    for (let i = 0; i < n; i++) {
      const b0 = from + (span * i) / n;
      const b1 = from + (span * (i + 1)) / n;
      const k = ramp > 0 ? (i + 1) / n : ramp < 0 ? 1 - i / n : 1;
      this.kit.line(x + Math.cos(b0) * r, y, z + Math.sin(b0) * r, x + Math.cos(b1) * r, y, z + Math.sin(b1) * r, c, a * k, w);
    }
  }

  /** A spray of sparks thrown out from a point. */
  private sparks(x: number, y: number, z: number, reach: number, age: number, fade: number, id: number, color: number, count: number): void {
    const { kit } = this;
    const n = Math.round(count * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(id, i + 300) * TAU;
      const up = 0.3 + hash01(id, i + 350) * 0.9;
      const d = reach * (0.6 + 0.6 * hash01(id, i + 400)) * age;
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, y + up * d - 180 * age * age, z + Math.sin(a) * d, 5, hot(color, 2), 0.9 * fade, 0, id + i, Math.cos(a) * 16, up * 16, Math.sin(a) * 16, 2);
    }
  }
}
