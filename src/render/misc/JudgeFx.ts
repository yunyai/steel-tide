import { Color } from 'three';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { MiscFxKind } from '../../skills/misc/MiscEvents';
import { courtRadius, JUDGE } from '../../skills/misc/JudgeRuntime';
import type { Shell } from '../../weapons/ShellSystem';
import { BK, hash01 } from '../BurstParticles';
import { bump, clamp01, easeOut, hot, mix, TAU } from './MiscFxKit';
import { MiscShipFx, type MiscBurst } from './MiscShipFx';

const GOLD = 0xffca73;
const IVORY = 0xfff1c8;
const RED = 0xff3b2e;
const EMBER = 0xff8a3c;

/** Seconds each Judge burst plays. */
const LIFE: Partial<Record<MiscFxKind, number>> = {
  court: 2,
  cite: 0.7,
  gavelThrow: 2.2,
  gavelHit: 1.4,
  contempt: 1.3,
  arrest: 0.8,
  taxes: 1.9,
  objection: 0.9,
  martial: 2.2,
  warn: 1.2,
  verdict: 3,
  death: 1.6,
};

/** The Judge: its court, cases, gavels and punishments. */
export class JudgeFx extends MiscShipFx {
  readonly look = 'gavel' as const;
  readonly palette = { main: GOLD, hot: IVORY, deep: 0xb0221c };
  /** Colours held across many draws; `hot` and `mix` only keep four scratch colours alive. */
  private readonly held = [new Color(), new Color(), new Color()];

  owns(s: Ship): boolean {
    return !!s.judge;
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
    if (kind === 'court') {
      kit.onFlash?.(x, z, 0.25, GOLD);
      shake(0.25);
    } else if (kind === 'martial') {
      kit.onFlash?.(x, z, 0.4, EMBER);
      shake(0.35);
    } else if (kind === 'verdict') {
      kit.onFlash?.(x, z, 0.6, IVORY);
      shake(0.6);
    } else if (kind === 'death') {
      kit.onFlash?.(x, z, 0.5, RED);
      shake(0.5);
    } else if (kind === 'gavelHit' && !b.e.n) shake(0.15);
  }

  /**
   * Area cues (the court, Martial Law, the Verdict) are public, like the strikes they are. A burst
   * anchored on a ship shows only where that ship can be seen, so it never gives a hidden ship away;
   * Taxes and Objection also draw the Judge's end, so they follow the Judge as well.
   */
  protected shows(b: MiscBurst, team: Team | -1): boolean {
    const { kind, target } = b.e;
    if (kind === 'gunHit' || kind === 'gunLand') return super.shows(b, team);
    if (kind === 'court' || kind === 'martial' || kind === 'verdict') return true;
    if (target && !this.kit.visible(target, team)) return false;
    if (kind === 'taxes' || kind === 'objection') return super.shows(b, team);
    return true;
  }

  protected burst(b: MiscBurst, age: number): void {
    switch (b.e.kind) {
      case 'court':
        return this.slam(b, age, false);
      case 'martial':
        return this.slam(b, age, true);
      case 'cite':
        return this.cite(b, age);
      case 'gavelThrow':
        return this.gavelFlight(b, age);
      case 'gavelHit':
        return this.gavelHit(b, age);
      case 'contempt':
        return this.stamp(b, age);
      case 'arrest':
        return this.cuffSnap(b, age);
      case 'taxes':
        return this.taxes(b, age);
      case 'objection':
        return this.objection(b, age);
      case 'warn':
        return this.ping(b, age);
      case 'verdict':
        return this.verdict(b, age);
      case 'death':
        return this.execution(b, age);
      default:
        super.burst(b, age);
    }
  }

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    for (const s of kit.game.ships) {
      const j = s.judge;
      if (!j || !s.alive || s.withdrawn) continue;
      // The court is public ground, like a ridge: enemies must see where its laws hold.
      if (j.court) this.court(s, j.court.x, j.court.z, courtRadius(s), j.martialUntil > now);
      // Warnings are public too, wherever their target can be seen: whoever stands under one must see it coming.
      for (const p of j.pending) {
        const t = p.kind === 'verdict' ? null : kit.game.ships.find((v) => v.id === p.target && v.alive);
        if (t && !kit.visible(t, team)) continue;
        this.warning(p.kind, t ?? null, p.x, p.z, p.at - now);
      }
      const visible = kit.visible(s, team);
      for (const c of j.cases) {
        const t = kit.game.ships.find((v) => v.id === c.target && v.alive);
        if (!t || !kit.visible(t, team)) continue;
        if (c.stacks > 0) this.caseGlyph(t, c.stacks, c.contemptUntil > now);
        if (c.contemptUntil > now) this.locks(t, c.contemptUntil - now);
      }
      if (visible && j.objectionUntil > now) this.shield(s, j.objectionUntil - now);
      if (!visible) continue;
      for (const arrest of j.arrests) {
        const target = kit.game.ships.find((v) => v.id === arrest.target);
        if (target && kit.visible(target, team)) this.chain(s, target);
      }
    }
  }

  // ------------------------------------------------------------------ persistent

  /** The court: its rings, ticks, twelve light columns and the scales weighing every case. */
  private court(s: Ship, x: number, z: number, r: number, martial: boolean): void {
    const { kit } = this;
    const t = kit.t;
    const tone = this.held[0].copy(martial ? mix(GOLD, RED, 0.45, 1.6) : hot(GOLD, 1.4));
    const core = this.held[1].copy(hot(IVORY, 1.6));
    kit.ring(x, z, r, 5, tone, martial ? 0.85 : 0.5, martial ? 9 : 5);
    kit.ring(x, z, r - 25, 5, tone, 0.22, 2);
    for (let i = 0; i < 36; i++) {
      const b = (i * Math.PI) / 18;
      const c = Math.cos(b);
      const sn = Math.sin(b);
      const length = i % 3 ? 30 : 70;
      kit.line(x + c * (r - length), 6, z + sn * (r - length), x + c * (r + 12), 6, z + sn * (r + 12), tone, 0.65, 4);
    }
    // Twelve columns stand on the ring, breathing slowly.
    for (let i = 0; i < 12; i++) {
      const b = (i * TAU) / 12;
      const cx = x + Math.cos(b) * r;
      const cz = z + Math.sin(b) * r;
      const h = (martial ? 220 : 150) + 20 * Math.sin(t * 1.3 + i);
      const a = 0.35 + 0.15 * Math.sin(t * 2 + i * 0.7);
      kit.line(cx, 4, cz, cx, h, cz, tone, a, 10);
      kit.line(cx, 4, cz, cx, h * 0.9, cz, core, a, 2.5);
      kit.glow(cx, h, cz, 46, tone, a * 1.3);
      kit.ring(cx, cz, 14, 6, tone, a, 2, 0, 10);
    }
    if (martial) {
      // A band of law tablets circles the court under Martial Law.
      const band = this.held[2].copy(mix(GOLD, RED, 0.35, 1.7));
      for (let i = 0; i < 6; i++) this.tablet(x, z, r - 150, (i * TAU) / 6 + t * 0.06, i, band);
      kit.ring(x, z, r - 75, 7, tone, 0.45, 4, t * 0.02);
    }
    this.scales(s, x, z);
  }

  /** A standing law tablet on the court's band: a frame with `i + 1` lines of law. */
  private tablet(cx: number, cz: number, r: number, ang: number, i: number, c: Color): void {
    const { kit } = this;
    const x = cx + Math.cos(ang) * r;
    const z = cz + Math.sin(ang) * r;
    const ux = -Math.sin(ang) * 22;
    const uz = Math.cos(ang) * 22;
    const y0 = 20;
    const y1 = 90;
    kit.line(x - ux, y0, z - uz, x + ux, y0, z + uz, c, 0.7, 3);
    kit.line(x - ux, y1, z - uz, x + ux, y1, z + uz, c, 0.7, 3);
    kit.line(x - ux, y0, z - uz, x - ux, y1, z - uz, c, 0.7, 3);
    kit.line(x + ux, y0, z + uz, x + ux, y1, z + uz, c, 0.7, 3);
    for (let k = 0; k <= i; k++) {
      const y = y1 - 12 - k * 10;
      kit.line(x - ux * 0.6, y, z - uz * 0.6, x + ux * 0.6, y, z + uz * 0.6, c, 0.55, 2);
    }
  }

  /** The floating scales over the court, tipped by the weight of every open case. */
  private scales(s: Ship, x: number, z: number): void {
    const { kit } = this;
    const j = s.judge!;
    const weight = j.cases.reduce((n, c) => n + c.stacks, 0);
    const tip = Math.min(0.42, weight / 160) * (1 + 0.08 * Math.sin(kit.t * 1.7));
    const gold = hot(GOLD, 1.5);
    const top = 190;
    kit.line(x, 20, z, x, top + 20, z, gold, 0.6, 4);
    kit.glow(x, top + 24, z, 50, gold, 0.6);
    const half = 120;
    const dx = Math.cos(tip) * half;
    const dy = Math.sin(tip) * half;
    const ends = [
      { x: x - dx, y: top + dy },
      { x: x + dx, y: top - dy },
    ];
    kit.line(ends[0].x, ends[0].y, z, ends[1].x, ends[1].y, z, gold, 0.75, 5);
    for (const e of ends) {
      const py = e.y - 60;
      for (let k = 0; k < 3; k++) {
        const a = (k * TAU) / 3;
        kit.line(e.x, e.y, z, e.x + Math.cos(a) * 26, py, z + Math.sin(a) * 26, gold, 0.4, 2);
      }
      kit.ring(e.x, z, 28, py, gold, 0.65, 3, 0, 20);
      kit.glow(e.x, py, z, 30, gold, 0.35);
    }
  }

  /** The glyph over a cited ship: scales, a fill arc for its case, red with a blade from 30. */
  private caseGlyph(t: Ship, n: number, contempt: boolean): void {
    const { kit } = this;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const y = t.renderPos.y + t.spec.freeboard + 125;
    const due = n >= JUDGE.death;
    const pulse = due ? 0.7 + 0.3 * Math.sin(kit.t * 8) : 1;
    const c = due || contempt ? mix(RED, GOLD, 0.25, 1.8 * pulse) : hot(GOLD, 1.6);
    const r = 34;
    // The empty track, then the case filling it from the top, clockwise.
    kit.ring(x, z, r, y, hot(0x6a5a40, 0.7), 0.35, 3, 0, 32);
    const fill = n / JUDGE.cap;
    const segs = Math.max(1, Math.round(40 * fill));
    for (let i = 0; i < segs; i++) {
      const a0 = -Math.PI / 2 + (i / 40) * TAU;
      const a1 = -Math.PI / 2 + ((i + 1) / 40) * TAU;
      kit.line(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, c, 0.85, 5);
    }
    // The death notch.
    const m = -Math.PI / 2 + (JUDGE.death / JUDGE.cap) * TAU;
    kit.line(x + Math.cos(m) * (r - 9), y, z + Math.sin(m) * (r - 9), x + Math.cos(m) * (r + 9), y, z + Math.sin(m) * (r + 9), hot(RED, 1.6), 0.8, 3);
    // Small scales in the middle.
    kit.line(x, y - 14, z, x, y + 14, z, c, 0.7, 2.5);
    kit.line(x - 16, y + 12, z, x + 16, y + 12, z, c, 0.7, 2.5);
    for (const side of [-1, 1]) kit.ring(x + side * 16, z, 6, y + 2, c, 0.6, 2, 0, 10);
    if (due) {
      // A blade of light hangs over a ship the Death Penalty can take.
      const by = y + 40 + 6 * Math.sin(kit.t * 4);
      kit.line(x, by, z, x, by + 70, z, hot(RED, 2), 0.9 * pulse, 6);
      kit.line(x - 12, by + 70, z, x + 12, by + 70, z, hot(RED, 2), 0.8 * pulse, 4);
      kit.glow(x, by + 30, z, 60, hot(RED, 1.6), 0.4 * pulse);
    }
  }

  /** Counter-rotating lock rings round a ship in contempt. */
  private locks(t: Ship, left: number): void {
    const { kit } = this;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const r = t.spec.length * 0.55;
    const a = clamp01(left) * 0.8;
    const c = mix(RED, GOLD, 0.3, 1.7);
    kit.ring(x, z, r, t.renderPos.y + t.spec.freeboard + 8, c, a, 4, kit.t * 0.8, 48, true);
    kit.ring(x, z, r * 0.92, t.renderPos.y + t.spec.freeboard + 28, c, a * 0.8, 3, -kit.t * 1.1, 48, true);
    // A padlock glyph: a shackle arc over a body.
    const y = t.renderPos.y + t.spec.freeboard + 70;
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI * (i / 8);
      const a1 = Math.PI * ((i + 1) / 8);
      kit.line(x + Math.cos(a0) * 14, y + 18 + Math.sin(a0) * 14, z, x + Math.cos(a1) * 14, y + 18 + Math.sin(a1) * 14, z, c, a, 3);
    }
    kit.line(x - 20, y + 18, z, x + 20, y + 18, z, c, a, 3);
    kit.line(x - 20, y - 8, z, x + 20, y - 8, z, c, a, 3);
    kit.line(x - 20, y - 8, z, x - 20, y + 18, z, c, a, 3);
    kit.line(x + 20, y - 8, z, x + 20, y + 18, z, c, a, 3);
  }

  /** A slowly turning gold hex prism round the Judge while Objection stands. */
  private shield(s: Ship, left: number): void {
    const { kit } = this;
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    const r = s.spec.length * 0.62;
    const a = 0.35 + 0.15 * Math.sin(kit.t * 5) * clamp01(left);
    const c = hot(GOLD, 1.6);
    const spin = kit.t * 0.3;
    for (let i = 0; i < 6; i++) {
      const a0 = spin + (i * TAU) / 6;
      const a1 = spin + ((i + 1) * TAU) / 6;
      const x0 = x + Math.cos(a0) * r;
      const z0 = z + Math.sin(a0) * r;
      const x1 = x + Math.cos(a1) * r;
      const z1 = z + Math.sin(a1) * r;
      kit.line(x0, 4, z0, x1, 4, z1, c, a, 4);
      kit.line(x0, 110, z0, x1, 110, z1, c, a, 4);
      kit.line(x0, 4, z0, x0, 110, z0, c, a * 0.7, 3);
    }
  }

  /** The golden chain an Arrest drags its prisoner by, with cuffs at both ends and sparks along it. */
  private chain(a: Ship, b: Ship): void {
    const { kit } = this;
    const ax = a.renderPos.x;
    const az = a.renderPos.z;
    const dx = b.renderPos.x - ax;
    const dz = b.renderPos.z - az;
    const len = Math.hypot(dx, dz) || 1;
    const count = Math.min(96, Math.max(12, Math.ceil(len / 30)));
    const gold = this.held[0].copy(hot(GOLD, 1.4));
    const spark = this.held[1].copy(hot(IVORY, 2));
    let px = ax;
    let py = 30;
    let pz = az;
    for (let i = 1; i <= count; i++) {
      const f = i / count;
      const angle = f * Math.PI * count * 0.7 + kit.t * 4;
      const off = Math.sin(angle) * 9;
      const x = ax + dx * f - (dz / len) * off;
      const y = 30 + Math.cos(angle) * 9;
      const z = az + dz * f + (dx / len) * off;
      kit.line(px, py, pz, x, y, z, gold, 0.8, 5);
      px = x;
      py = y;
      pz = z;
    }
    // Sparks run along the chain toward the Judge.
    const sparks = Math.round(6 * kit.k);
    for (let i = 0; i < sparks; i++) {
      const f = 1 - ((kit.t * 0.7 + i / sparks) % 1);
      kit.particles.push(BK.Spark, ax + dx * f, 30, az + dz * f, 4, spark, 0.8, 0, i, (-dx / len) * 20, 4, (-dz / len) * 20, 2);
    }
    for (const [s, sign] of [
      [a, 1],
      [b, -1],
    ] as const)
      this.cuffs(s.renderPos.x, s.renderPos.z, (dx / len) * sign, (dz / len) * sign, gold);
    // The prisoner's wake churns as it is dragged.
    kit.particles.push(BK.Foam, b.renderPos.x - (dx / len) * 60, kit.surface(b.renderPos.x, b.renderPos.z), b.renderPos.z - (dz / len) * 60, 90, hot(0xf4f8ff, 1), 0.4, Math.atan2(dz, dx));
  }

  /** Two linked upright rings facing along (fx, fz). */
  private cuffs(x: number, z: number, fx: number, fz: number, c: Color): void {
    const { kit } = this;
    for (const off of [0, 18]) {
      const cx = x + fx * (40 + off);
      const cz = z + fz * (40 + off);
      const sx = -fz;
      const sz = fx;
      let px = cx + sx * 12;
      let py = 30;
      let pz = cz + sz * 12;
      for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * TAU;
        const nx = cx + sx * Math.cos(a) * 12;
        const ny = 30 + Math.sin(a) * 12;
        const nz = cz + sz * Math.cos(a) * 12;
        kit.line(px, py, pz, nx, ny, nz, c, 0.85, 3);
        px = nx;
        py = ny;
        pz = nz;
      }
    }
  }

  /** The warning before Contempt, the Verdict or the Death Penalty lands, `left` seconds out. */
  private warning(kind: 'freeze' | 'verdict' | 'death', t: Ship | null, x: number, z: number, left: number): void {
    const { kit } = this;
    const cx = t ? t.renderPos.x : x;
    const cz = t ? t.renderPos.z : z;
    const total = kind === 'freeze' ? JUDGE.contempt.warn : kind === 'verdict' ? JUDGE.verdict.warn : JUDGE.deathWarn;
    const f = clamp01(1 - left / total);
    const pulse = 0.6 + 0.4 * Math.sin(kit.t * 14);
    if (kind === 'verdict') {
      const r = JUDGE.verdict.radius;
      kit.ring(cx, cz, r, 6, hot(GOLD, 1.8), 0.55 + 0.35 * pulse, 8, kit.t * 0.2, 96);
      kit.ring(cx, cz, r * (1 - f), 6, hot(IVORY, 1.6), 0.5, 4, 0, 72);
      // The giant gavel lifts back and comes down over the warning.
      const lift = 1100 * (1 - easeOut(f));
      const swing = -1.1 + 1.1 * f * f;
      this.gavelShape(cx, 260 + lift, cz, 1, 0, swing, 70, hot(GOLD, 1.9), 0.9);
      kit.glow(cx, 6, cz, r * 0.6 * f, hot(GOLD, 1.2), 0.25 * f);
      return;
    }
    if (kind === 'freeze') {
      const r = (t?.spec.length ?? 200) * 0.6;
      kit.ring(cx, cz, r * (1.6 - 0.6 * f), 10, mix(RED, GOLD, 0.3, 1.8), 0.7 * pulse, 5, 0, 48, true);
      return;
    }
    // Death Penalty: a red reticle closes and a blade of light descends.
    const r = (t?.spec.length ?? 200) * (0.9 - 0.3 * f);
    const red = hot(RED, 2);
    kit.ring(cx, cz, r, 8, red, 0.8 * pulse, 6, kit.t * 0.6, 64);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + kit.t * 0.6;
      kit.line(cx + Math.cos(a) * r * 0.75, 8, cz + Math.sin(a) * r * 0.75, cx + Math.cos(a) * r * 1.25, 8, cz + Math.sin(a) * r * 1.25, red, 0.9, 6);
    }
    const y = 80 + 1400 * (1 - f * f);
    kit.line(cx, y, cz, cx, y + 380, cz, red, 0.9, 14);
    kit.line(cx, y, cz, cx, y + 380, cz, hot(0xffffff, 2), 0.8, 4);
    kit.glow(cx, y, cz, 120, red, 0.6);
  }

  // ------------------------------------------------------------------ bursts

  /** The court (or Martial Law) slamming down: a pillar of light, shock rings and flaring columns. */
  private slam(b: MiscBurst, age: number, martial: boolean): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? JUDGE.court.radius;
    const life = this.life(b.e.kind);
    const fade = 1 - clamp01(age / life);
    const tone = martial ? mix(GOLD, RED, 0.5, 2) : hot(GOLD, 2);
    if (!martial) {
      const pillar = clamp01(1 - age / 0.9);
      kit.line(x, 0, z, x, 1600, z, tone, 0.9 * pillar, 60);
      kit.line(x, 0, z, x, 1600, z, hot(IVORY, 2.4), pillar, 16);
      kit.glow(x, 40, z, 500 * pillar + 60, tone, 0.8 * pillar);
      if (age < 0.5 && !kit.reduce) kit.distortions.push({ x, y: 40, z, radius: 420, strength: 0.6 * (1 - age / 0.5), priority: 2 });
    }
    for (let k = 0; k < 2; k++) {
      const f = easeOut(clamp01((age - k * 0.18) / 1.1));
      if (f <= 0) continue;
      kit.ring(x, z, r * f, 8 + k * 4, tone, 0.85 * fade, martial ? 14 : 10, 0, 96);
      kit.shock(x, z, r * f, tone, 0.5 * fade);
    }
    // Every column flares as the ring passes it.
    const reach = easeOut(clamp01(age / 1.1));
    if (reach > 0.95)
      for (let i = 0; i < 12; i++) {
        const a = (i * TAU) / 12;
        kit.glow(x + Math.cos(a) * r, 120, z + Math.sin(a) * r, 140 * fade, tone, 0.7 * fade);
      }
  }

  /** A citation: a gold tick and a burst of sparks at the hull. */
  private cite(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const f = clamp01(age / this.life('cite'));
    const fade = 1 - f;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const y = t.renderPos.y + t.spec.freeboard + 20;
    const red = (b.e.n ?? 1) >= 3;
    const c = red ? mix(RED, GOLD, 0.3, 2) : hot(GOLD, 2);
    kit.line(x, y, z, x, y + 30 + 70 * easeOut(f), z, c, 0.9 * fade, 5);
    kit.glow(x, y + 30 + 70 * easeOut(f), z, 40, c, 0.8 * fade);
    const n = Math.round(6 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = 60 * easeOut(f);
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, y + 40 * f, z + Math.sin(a) * d, 3, c, fade, 0, i, Math.cos(a) * 8, 6, Math.sin(a) * 8, 2);
    }
  }

  /** A gavel thrown end over end along an arc, homing on its target. */
  private gavelFlight(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const tx = t?.alive ? t.renderPos.x : (b.e.tx ?? b.e.x);
    const tz = t?.alive ? t.renderPos.z : (b.e.tz ?? b.e.z);
    const d0 = Math.hypot((b.e.tx ?? b.e.x) - b.e.x, (b.e.tz ?? b.e.z) - b.e.z);
    const flight = Math.max(0.2, d0 / JUDGE.gavel.speed);
    if (age >= flight) return;
    const f = age / flight;
    const lift = Math.min(600, d0 * 0.18);
    const y0 = 60;
    const y1 = (t?.spec.freeboard ?? 10) + 30;
    const p = kit.arcAt(b.e.x, y0, b.e.z, tx, y1, tz, lift, f);
    const scale = 9 * Math.pow(0.85, b.e.n ?? 0);
    const dx = tx - b.e.x;
    const dz = tz - b.e.z;
    const l = Math.hypot(dx, dz) || 1;
    this.gavelShape(p.x, p.y, p.z, dx / l, dz / l, age * 14, scale, hot(GOLD, 2), 0.95);
    kit.glow(p.x, p.y, p.z, 70, hot(GOLD, 1.8), 0.7);
    kit.arc(b.e.x, y0, b.e.z, tx, y1, tz, lift, hot(IVORY, 1.6), 0.35, 3, 24, f);
  }

  /** The gavel striking: a shock ring, gold dust and a slam of light. */
  private gavelHit(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const x = t?.alive ? t.renderPos.x : b.e.x;
    const z = t?.alive ? t.renderPos.z : b.e.z;
    const y = (t?.renderPos.y ?? 0) + (t?.spec.freeboard ?? 10) + 10;
    const f = clamp01(age / this.life('gavelHit'));
    const fade = 1 - f;
    const big = Math.pow(0.85, b.e.n ?? 0);
    kit.particles.push(BK.Flare, x, y, z, 300 * big * easeOut(age * 5) * fade, hot(IVORY, 2.4), fade, b.id);
    kit.glow(x, y, z, 220 * big * fade, hot(GOLD, 2), 0.8 * fade);
    kit.line(x, y, z, x, y + 260 * bump(f * 2), z, hot(GOLD, 2), 0.8 * fade, 12);
    for (let k = 0; k < 2; k++) {
      const g = easeOut(clamp01((age - k * 0.12) / 0.9));
      kit.shock(x, z, (60 + 380 * big) * g, hot(GOLD, 1.5), 0.7 * fade);
    }
    const n = Math.round(18 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const up = 0.4 + hash01(b.id, i + 40);
      const d = (160 + 140 * hash01(b.id, i + 80)) * age;
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, y + up * d - 90 * age * age, z + Math.sin(a) * d, 5, hot(GOLD, 2.2), fade, 0, i, Math.cos(a) * 18, up * 18, Math.sin(a) * 18, 2);
    }
  }

  /** Contempt: a red stamp slammed on the deck. */
  private stamp(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const f = clamp01(age / this.life('contempt'));
    const fade = 1 - f;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const r = t.spec.length * (0.75 - 0.2 * easeOut(age * 4));
    const c = hot(RED, 2.2);
    for (let i = 0; i < 4; i++) {
      const a0 = Math.PI / 4 + (i * Math.PI) / 2;
      const a1 = a0 + Math.PI / 2;
      kit.line(x + Math.cos(a0) * r, 12, z + Math.sin(a0) * r, x + Math.cos(a1) * r, 12, z + Math.sin(a1) * r, c, 0.9 * fade, 12);
    }
    kit.particles.push(BK.Flare, x, t.spec.freeboard + 20, z, 320 * fade, c, 0.9 * fade, b.id);
    kit.shock(x, z, r * 1.3, c, 0.6 * fade);
  }

  /** The cuffs snapping shut. */
  private cuffSnap(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const fade = 1 - clamp01(age / this.life('arrest'));
    kit.glow(t.renderPos.x, 30, t.renderPos.z, 160 * fade, hot(GOLD, 2.2), 0.9 * fade);
    kit.ring(t.renderPos.x, t.renderPos.z, 60 + 90 * easeOut(age * 3), 30, hot(IVORY, 2), 0.8 * fade, 5, 0, 32);
  }

  /** Taxes: a stream of coins from the target to the Judge, a heal shimmer when they land. */
  private taxes(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const j = b.e.ship;
    const fx = t?.alive ? t.renderPos.x : b.e.x;
    const fz = t?.alive ? t.renderPos.z : b.e.z;
    const jx = j.renderPos.x;
    const jz = j.renderPos.z;
    const d = Math.hypot(jx - fx, jz - fz);
    const travel = 0.9;
    const coins = Math.round(14 * kit.k);
    for (let i = 0; i < coins; i++) {
      const f = (age - i * 0.05) / travel;
      if (f <= 0 || f >= 1) continue;
      const side = (hash01(b.id, i) - 0.5) * 120;
      const p = kit.arcAt(fx + side, 40, fz, jx, 60, jz, Math.min(500, d * 0.2) + side, f);
      kit.particles.push(BK.Flare, p.x, p.y, p.z, 26, hot(GOLD, 2.4), 0.95, age * 9 + i, i);
      kit.glow(p.x, p.y, p.z, 40, hot(GOLD, 1.5), 0.5);
    }
    if (age < 0.5) kit.particles.push(BK.Flare, fx, 40, fz, 260 * (1 - age / 0.5), hot(GOLD, 2.2), 1 - age / 0.5, b.id);
    const heal = clamp01((age - travel) / 0.9);
    if (heal > 0 && heal < 1) {
      kit.ring(jx, jz, j.spec.length * 0.5, 20 + 80 * heal, hot(GOLD, 1.8), 0.6 * (1 - heal), 4, 0, 40);
      const n = Math.round(10 * kit.k);
      for (let i = 0; i < n; i++) {
        const a = hash01(b.id, i + 30) * TAU;
        const r = j.spec.length * 0.4 * hash01(b.id, i + 60);
        kit.particles.push(BK.Spark, jx + Math.cos(a) * r, 20 + 120 * heal, jz + Math.sin(a) * r, 4, hot(IVORY, 2), 1 - heal, 0, i, 0, 14, 0, 2);
      }
    }
  }

  /** A dismissed hit: a hex flash at the Judge and a bolt sent back to its attacker. */
  private objection(b: MiscBurst, age: number): void {
    const { kit } = this;
    const j = b.e.ship;
    const a = b.e.target;
    const fade = 1 - clamp01(age / this.life('objection'));
    const x = j.renderPos.x;
    const z = j.renderPos.z;
    kit.particles.push(BK.Flare, x, 60, z, 200 * fade, hot(GOLD, 2.2), fade, b.id);
    if (!a?.alive) return;
    const f = clamp01(age / 0.3);
    const ax = a.renderPos.x;
    const az = a.renderPos.z;
    const hx = x + (ax - x) * f;
    const hz = z + (az - z) * f;
    kit.line(x + (ax - x) * Math.max(0, f - 0.3), 60, z + (az - z) * Math.max(0, f - 0.3), hx, 50, hz, hot(IVORY, 2.4), fade, 6);
    kit.glow(hx, 50, hz, 60, hot(GOLD, 2), fade);
    if (f >= 1) kit.particles.push(BK.Flare, ax, a.spec.freeboard + 20, az, 160 * fade, hot(GOLD, 2), fade, b.id + 1);
  }

  /** A ping where a warning begins. */
  private ping(b: MiscBurst, age: number): void {
    const fade = 1 - clamp01(age / this.life('warn'));
    const c = b.e.n === 2 ? hot(RED, 2) : hot(GOLD, 1.8);
    this.kit.shock(b.e.x, b.e.z, (b.e.radius ?? 250) * (0.4 + 0.8 * easeOut(age * 2)), c, 0.6 * fade);
  }

  /** The Verdict landing: a flash, shock rings, a crater and a column of dust. */
  private verdict(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? JUDGE.verdict.radius;
    const fade = 1 - clamp01(age / this.life('verdict'));
    kit.particles.push(BK.Flare, x, 60, z, 1600 * easeOut(age * 4) * clamp01(1 - age / 0.8), hot(IVORY, 2.6), clamp01(1 - age / 0.8), b.id);
    kit.glow(x, 40, z, r * 1.2 * fade, hot(GOLD, 2), 0.8 * fade);
    if (age < 0.6 && !kit.reduce) kit.distortions.push({ x, y: 60, z, radius: r * 0.8, strength: 1 - age / 0.6, priority: 3 });
    for (let k = 0; k < 3; k++) {
      const g = easeOut(clamp01((age - k * 0.2) / 1.4));
      if (g <= 0) continue;
      kit.ring(x, z, r * (0.3 + g * (1 + k * 0.3)), 8, hot(GOLD, 2), 0.8 * (1 - g), 14 - k * 3, 0, 120);
      kit.shock(x, z, r * (0.3 + g * (1 + k * 0.3)), hot(IVORY, 1.6), 0.6 * (1 - g));
    }
    kit.shock(x, z, r * 0.55, hot(0x3a2a1a, 1), 0.7 * fade, BK.Foam);
    const n = Math.round(16 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const rr = r * 0.5 * hash01(b.id, i + 20);
      kit.particles.push(BK.Smoke, x + Math.cos(a) * rr, 30 + 260 * easeOut(age * 0.8) * hash01(b.id, i + 40), z + Math.sin(a) * rr, 120 + 160 * age, hot(0xc8b48a, 0.9), 0.55 * fade, a, i);
    }
    const sparks = Math.round(30 * kit.k);
    for (let i = 0; i < sparks; i++) {
      const a = hash01(b.id, i + 100) * TAU;
      const up = 0.5 + hash01(b.id, i + 140);
      const d = (300 + 300 * hash01(b.id, i + 180)) * age;
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, 20 + up * d - 150 * age * age, z + Math.sin(a) * d, 6, hot(GOLD, 2.2), fade, 0, i, Math.cos(a) * 24, up * 24, Math.sin(a) * 24, 2);
    }
    // The gavel rests a moment where it struck, then lifts away.
    const rest = clamp01(1 - age / 1.2);
    if (rest > 0) this.gavelShape(x, 260 + 300 * (1 - rest), z, 1, 0, 0, 70, hot(GOLD, 1.9), rest);
  }

  /** The Death Penalty: a slash of light across the hull and a red flare. */
  private execution(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const x = t?.renderPos.x ?? b.e.x;
    const z = t?.renderPos.z ?? b.e.z;
    const L = (t?.spec.length ?? 250) * 0.9;
    const fade = 1 - clamp01(age / this.life('death'));
    const f = easeOut(clamp01(age / 0.25));
    const red = hot(RED, 2.4);
    kit.line(x - L * f, 200 - 180 * f, z - L * 0.3 * f, x + L * f, 20 + 180 * f, z + L * 0.3 * f, red, fade, 22);
    kit.line(x - L * f, 200 - 180 * f, z - L * 0.3 * f, x + L * f, 20 + 180 * f, z + L * 0.3 * f, hot(0xffffff, 2.6), fade, 6);
    kit.particles.push(BK.Flare, x, 80, z, 900 * fade, red, fade, b.id);
    kit.shock(x, z, L * 1.6 * easeOut(age * 1.5), red, 0.6 * fade);
  }

  // ------------------------------------------------------------------ shapes

  /**
   * A gavel drawn in light: a handle and a box head. It sits at (x, y, z) facing along (fx, fz);
   * `spin` turns it end over end and `k` scales it (head about 2.4k long).
   */
  private gavelShape(x: number, y: number, z: number, fx: number, fz: number, spin: number, k: number, c: Color, a: number): void {
    const { kit } = this;
    const fl = Math.hypot(fx, fz) || 1;
    const f = [fx / fl, 0, fz / fl];
    const s = [-f[2], 0, f[0]];
    // The handle points along h, in the plane of travel; the head lies across it along s.
    const h = [f[0] * Math.cos(spin), Math.sin(spin), f[2] * Math.cos(spin)];
    const n = [h[1] * s[2] - h[2] * s[1], h[2] * s[0] - h[0] * s[2], h[0] * s[1] - h[1] * s[0]];
    const hx = x + h[0] * 1.6 * k;
    const hy = y + h[1] * 1.6 * k;
    const hz = z + h[2] * 1.6 * k;
    kit.line(x - h[0] * 1.6 * k, y - h[1] * 1.6 * k, z - h[2] * 1.6 * k, hx, hy, hz, c, a, Math.max(2, k * 0.35));
    const L = 1.2 * k;
    const w = 0.45 * k;
    const corner = (i: number) => {
      const sx = i & 1 ? L : -L;
      const sh = i & 2 ? w : -w;
      const sn = i & 4 ? w : -w;
      return [hx + s[0] * sx + h[0] * sh + n[0] * sn, hy + s[1] * sx + h[1] * sh + n[1] * sn, hz + s[2] * sx + h[2] * sh + n[2] * sn];
    };
    for (const [i, j] of [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [0, 2],
      [1, 3],
      [4, 6],
      [5, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]) {
      const p = corner(i);
      const q = corner(j);
      kit.line(p[0], p[1], p[2], q[0], q[1], q[2], c, a, Math.max(2, k * 0.25));
    }
    kit.glow(hx, hy, hz, k * 3, c, a * 0.5);
  }

  /** A gold rail bolt: a white core, a gold sheath and two rail coils riding the head. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    const len = Math.min(s.travelled + 1, 140);
    kit.line(x - dx * len, y - dy * len, z - dz * len, x + dx * 12, y + dy * 12, z + dz * 12, hot(IVORY, 2.4), 0.9, 2.2);
    kit.line(x - dx * len * 0.6, y - dy * len * 0.6, z - dz * len * 0.6, x, y, z, hot(GOLD, 1.6), 0.5, 7);
    kit.glow(x, y, z, 30, hot(GOLD, 2.2), 0.85);
    // Coils are rings in the plane across the flight path.
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    for (let k = 0; k < 2; k++) {
      const back = 14 + k * 22 + ((kit.t * 160) % 22);
      const cx = x - dx * back;
      const cy = y - dy * back;
      const cz = z - dz * back;
      let qx = cx + (ux / ul) * 9;
      let qy = cy;
      let qz = cz + (uz / ul) * 9;
      for (let i = 1; i <= 10; i++) {
        const a = (i / 10) * TAU;
        const nx = cx + ((Math.cos(a) * ux) / ul) * 9;
        const ny = cy + Math.sin(a) * 9;
        const nz = cz + ((Math.cos(a) * uz) / ul) * 9;
        kit.line(qx, qy, qz, nx, ny, nz, hot(GOLD, 1.8), 0.7, 1.6);
        qx = nx;
        qy = ny;
        qz = nz;
      }
    }
  }
}
