import { Color } from 'three';
import type { Game } from '../core/Game';
import type { GameEventMap } from '../core/Events';
import type { Team } from '../core/types';
import { contactVisible } from '../core/Targeting';
import type { Ship } from '../ships/Ship';
import { CUBE, modeOf } from '../skills/misc/TungstenModes';
import type { Cube, TungstenState, TungstenUlt } from '../skills/misc/TungstenRuntime';
import { BK, drift, hash01 } from './BurstParticles';
import type { SpatialDistortion } from './SpatialDistortion';
import { modeColor } from './TungstenLook';
import { SPRAY, TAU, WHITE, clamp01, ease, hot, smooth, type TungstenPaint } from './TungstenPaint';
import { HORIZON, SINGULARITY_Y, collapseLook, crushed } from './TungstenSingularity';

type TungstenEvent = GameEventMap['tungsten'];

const KINETIC = modeOf('kinetic');
const CRUSH = modeOf('crush');
const SHARD = modeOf('shard');
const REPEL = modeOf('repel');
const TETHER = modeOf('tether');
const MEND = modeOf('mend');
const FIRE = new Color(0xff7a2a);
const EMBER = new Color(0xffc27a);
const STEAM = new Color(0xcfd6db);
const SOOT = new Color(0x6b5d55);
const CAVITY = new Color(0x0b1c26);
const mix = new Color();

/** Seconds each Collapse and Meteor event's burst lasts. */
export const ULT_LIFE: Partial<Record<TungstenEvent['kind'], number>> = {
  collapse: 0.6,
  collapseHold: 0.8,
  collapseBurst: 2.4,
  meteorRise: 0.9,
  meteorFall: 0.8,
  meteorImpact: 3.4,
  fragment: 0.9,
};

/** How an ult cube is drawn this frame, on top of where the sim puts it. */
export interface UltCubeLook {
  lift: number;
  /** Multiplies the cube's drawn size; 0 hides it. */
  size: number;
  heat: number;
  power: number;
}

/** A meteor cube's own clock: its fall time and when it strikes, in seconds since the ult began. */
function meteorClock(c: Cube) {
  const M = CUBE.meteor;
  const fall = c.mode === KINETIC ? M.fall / 2 : M.fall;
  return { fall, drop: M.rise + M.grow, impact: M.rise + M.grow + fall };
}

/**
 * Collapse and Meteor, apart from the hole itself: telegraphs on the water, the cube crushed or blazing,
 * drag lines, the meteor's entry and impact, the burst, and the Mend field left in the crater.
 */
export class TungstenUltFx {
  readonly distortions: SpatialDistortion[] = [];

  constructor(
    private paint: TungstenPaint,
    private game: Game,
  ) {}

  /** Render-time seconds since the ship's ult began. */
  private elapsed(u: TungstenUlt): number {
    return u.elapsed - (this.game.time - this.game.renderTime);
  }

  /** How a cube taking part in an ult should look; null when it is not in one. */
  cubeLook(s: Ship, c: Cube): UltCubeLook | null {
    const t = s.tungsten!;
    const u = t.ult;
    if (c.state === 'collapse') {
      const look = collapseLook(s, this.game);
      if (!look) return null;
      if (look.hold < 0) return { lift: 0, size: 1, heat: 0, power: 2.6 };
      // Hauled up into the hole and crushed to nothing on the way.
      const crush = crushed(look.hold);
      return { lift: (SINGULARITY_Y - c.y) * smooth(look.hold / 0.35), size: 1 - crush, heat: crush * 0.6, power: 2.6 + crush * 6 };
    }
    if (c.state !== 'meteor' || !u || u.kind !== 'meteor') return null;
    const e = this.elapsed(u);
    const { fall, drop, impact } = meteorClock(c);
    const M = CUBE.meteor;
    if (e < M.rise) return { lift: 0, size: 1, heat: 0, power: 2.2 };
    if (e < drop) return { lift: 0, size: 1, heat: 0, power: 2.2 + 3 * smooth((e - M.rise) / M.grow) };
    if (e < impact) return { lift: 0, size: 1, heat: ((e - drop) / fall) ** 0.7, power: 5.2 };
    const cool = clamp01((e - impact) / 1.6);
    return { lift: 0, size: 1, heat: 1 - cool, power: 5.2 - 3 * cool };
  }

  begin(): void {
    this.distortions.length = 0;
  }

  /** Ongoing ult visuals for one Tungsten; the cubes themselves are drawn by the caller. */
  state(s: Ship, t: TungstenState, team: Team | -1, reduce: boolean): void {
    const u = t.ult;
    if (u?.kind === 'meteor') this.meteor(s, t, u, team);
    else if (u?.kind === 'collapse') this.collapse(s, team, reduce);
    for (const a of t.acts) if (a.kind === 'field') this.mendField(a.x, a.z, a.radius, a.elapsed, a.time, a.cube * 7 + s.id);
  }

  private meteor(s: Ship, t: TungstenState, u: TungstenUlt, team: Team | -1): void {
    const p = this.paint;
    const M = CUBE.meteor;
    const now = this.game.renderTime;
    const e = this.elapsed(u);
    u.cubes.forEach((id, i) => {
      const c = t.cubes.find((k) => k.id === id);
      if (!c) return;
      const sx = u.spots[i * 2],
        sz = u.spots[i * 2 + 1];
      const { fall, drop, impact } = meteorClock(c);
      if (e >= impact) return;
      const color = modeColor(c.mode);
      const k = clamp01(e / impact);
      // Telegraph: where it will land, with a ring closing on the centre as the strike nears.
      const pulse = p.reduce ? 1 : 0.8 + 0.2 * Math.sin(now * (6 + 10 * k));
      const R = M.radius;
      p.ring(sx, sz, R, hot(color, 1.7), (0.3 + 0.6 * smooth(e / 0.4)) * pulse);
      p.ring(sx, sz, R * (1 - k), hot(WHITE, 1.5), 0.25 + 0.55 * k);
      p.ring(sx, sz, R * 0.18, hot(color, 1.2), 0.55, BK.Hex, p.reduce ? 0 : now * 0.8);
      for (let j = 0; j < 4; j++) {
        const a = (j / 4) * TAU + Math.PI / 4;
        const ax = sx + Math.cos(a) * R * 0.82,
          az = sz + Math.sin(a) * R * 0.82,
          bx = sx + Math.cos(a) * R * 1.1,
          bz = sz + Math.sin(a) * R * 1.1;
        p.lines.push(ax, p.surface(ax, az) + 2, az, bx, p.surface(bx, bz) + 2, bz, hot(color, 1.8), 0.8 * pulse, 7, 2);
      }
      if (c.mode === KINETIC) p.ring(sx, sz, R * 1.6, hot(color, 1.2), 0.3 * k);
      if (c.mode === TETHER) p.ring(sx, sz, 2000, hot(color, 1), 0.2 + 0.2 * k);

      const y = c.py + (c.y - c.py) * this.game.alpha;
      const half = (CUBE.edge * c.scale) / 2;
      if (e >= M.rise && e < drop) {
        // Swelling at the top of the climb: lightning crawls over the faces and a guide line drops to the sea.
        const g = (e - M.rise) / M.grow;
        p.particles.push(BK.Glow, sx, y, sz, half * 5, hot(color, 1.1), 0.35 + 0.3 * g);
        for (let j = 0; j < 5; j++) {
          const a = hash01(id * 7 + j, Math.floor(now * 12)) * TAU,
            b = a + 1.2 + hash01(id * 7 + j, Math.floor(now * 12) + 1) * 2;
          p.arc(sx + Math.cos(a) * half * 1.3, y + (hash01(j, id) - 0.5) * half * 2, sz + Math.sin(a) * half * 1.3, sx + Math.cos(b) * half * 1.6, y + (hash01(j + 9, id) - 0.5) * half * 2, sz + Math.sin(b) * half * 1.6, id * 41 + j, hot(color, 2.4), 0.8, Math.max(3, half * 0.04), half * 0.4, 7);
        }
        for (let j = 0; j < 14; j++) {
          const y0 = y - half - j * ((y - half) / 14);
          p.lines.push(sx, y0, sz, sx, y0 - (y - half) / 30, sz, hot(color, 1.5), 0.35 * g, 4, 1.5);
        }
      } else if (e >= drop) {
        // Six meteors at once would stack into one white sheet; each burns dimmer when they share the sky.
        this.entry(sx, y, sz, half, (e - drop) / fall, color, id, 1 / Math.sqrt(u.cubes.length));
        if (c.mode === TETHER) this.dragLines(s, sx, sz, 2000, hot(color, 2), 0.7, team, 30);
      }
    });
  }

  /** The fall: a white-hot leading face, plasma peeling off the edges, a fire trail and the sea flattened below. */
  private entry(x: number, y: number, z: number, half: number, k: number, color: Color, id: number, glare: number): void {
    const p = this.paint;
    const now = this.game.renderTime;
    const front = y - half;
    const flicker = p.reduce ? 1 : 0.85 + 0.15 * Math.sin(now * 47 + id);
    p.particles.push(BK.Glow, x, front, z, half * 3.4, mix.copy(FIRE).lerp(EMBER, k).multiplyScalar(2.2), 0.7 * flicker * glare);
    p.particles.push(BK.Flare, x, front - half * 0.2, z, half * 2.4, hot(WHITE, 1.6), (0.5 + 0.4 * k) * glare);
    // Plasma streaming up off the four lower edges.
    for (let i = 0; i < p.n(48); i++) {
      const side = i % 4,
        u = hash01(id * 97 + i, 1) * 2 - 1;
      const ex = side < 2 ? u * half : (side === 2 ? 1 : -1) * half,
        ez = side < 2 ? (side === 0 ? 1 : -1) * half : u * half;
      const run = p.reduce ? 0.5 : (now * 2.5 + hash01(i, id)) % 1;
      const out = 1 + run * 0.5;
      p.particles.push(BK.Spark, x + ex * out, front + run * half * 2.6, z + ez * out, 3, mix.copy(EMBER).lerp(color, run).multiplyScalar(2.6), (1 - run) * 0.9, 0, 0, 0, 220, 0, 2);
    }
    // Fire trail and the smoke it leaves.
    p.trails.push(x, y + half * 14, z, x, y, z, hot(FIRE, 2.4), 0.9, half * 1.3, 4);
    p.trails.push(x, y + half * 9, z, x, y, z, hot(WHITE, 1.4), 0.7, half * 0.45, 2);
    for (let i = 0; i < p.n(10); i++) {
      const up = (i + 1) * half * 1.6;
      p.particles.push(BK.Smoke, x + (hash01(id, i) - 0.5) * half, y + up, z + (hash01(i, id) - 0.5) * half, half * (1.4 + i * 0.25), SOOT, 0.5 * (1 - i / 10), i, hash01(id + i, 3));
    }
    // The pressure wave ahead of it presses the sea flat.
    const base = this.paint.surface(x, z);
    const h = front - base;
    if (h < 700) {
      const press = 1 - h / 700;
      p.ring(x, z, half * (1.5 + 3 * press), hot(EMBER, 1.2), 0.5 * press);
      p.foamRing(x, z, half * (1 + 2.5 * press), 0.6 * press, id);
    }
  }

  private collapse(s: Ship, team: Team | -1, reduce: boolean): void {
    const look = collapseLook(s, this.game);
    if (!look) return;
    const p = this.paint;
    const C = CUBE.collapse;
    const now = this.game.renderTime;
    const scale = look.merged ? C.mergedRadius : 1;
    const color = modeColor(look.mode);
    const reach = C.radius * scale,
      core = C.core * scale;
    const on = look.hold < 0 ? smooth((look.hold + C.travel) / C.travel) : 1;
    const pulse = reduce ? 1 : 0.75 + 0.25 * Math.sin(now * 5);
    p.ring(look.x, look.z, reach, hot(color, 1.3), 0.35 * on);
    p.ring(look.x, look.z, core, hot(WHITE, 1.4), 0.45 * on * pulse);
    if (look.hold < 0) return;
    const form = smooth((look.hold - 0.15) / 0.6);
    // Every hull in the pull is drawn by a taut line toward the hole.
    this.dragLines(s, look.x, look.z, reach, hot(color, 1.8), 0.5 * form, team, SINGULARITY_Y);
    // Lightning from the disk's rim down to the sea.
    for (let i = 0; i < 3; i++) {
      const strike = reduce ? 0 : Math.floor(now * 7 + i * 0.37);
      if (!reduce && hash01(s.id * 13 + i, strike) > 0.55) continue;
      const a = hash01(s.id + i, strike) * TAU,
        r = 300 * scale * (0.6 + 0.4 * hash01(i, strike));
      const x = look.x + Math.cos(a) * r,
        z = look.z + Math.sin(a) * r;
      const rim = HORIZON * 2 * scale;
      p.arc(look.x + Math.cos(a) * rim, SINGULARITY_Y - 10, look.z + Math.sin(a) * rim, x, p.surface(x, z), z, s.id * 53 + i, hot(color, 2.6), 0.9 * form, 3, 40, 10);
    }
  }

  /** Lines from every visible enemy hull within `reach` toward a point `y` above (x, z). */
  private dragLines(s: Ship, x: number, z: number, reach: number, color: Color, alpha: number, team: Team | -1, y: number): void {
    if (alpha < 0.01) return;
    for (const o of this.game.ships) {
      if (!o.alive || o.team === s.team || o.withdrawn) continue;
      if (team !== -1 && o.team !== team && !contactVisible(o, team)) continue;
      const d = Math.hypot(o.renderPos.x - x, o.renderPos.z - z);
      if (d > reach || d < 40) continue;
      this.paint.chain(o.renderPos.x, o.renderPos.y + o.spec.freeboard + 6, o.renderPos.z, x, y, z, color, alpha * (0.5 + 0.5 * (1 - d / reach)), 0, -1.5);
    }
  }

  /** Mend's meteor field: a green ring of light on the crater, healing motes rising off the water. */
  private mendField(x: number, z: number, radius: number, elapsed: number, time: number, seed: number): void {
    const p = this.paint;
    const now = this.game.renderTime;
    const fade = clamp01(elapsed / 0.4) * clamp01((time - elapsed) / 0.6);
    const color = modeColor(MEND);
    p.ring(x, z, radius, hot(color, 1.6), 0.7 * fade);
    p.ring(x, z, radius * 0.97, hot(color, 0.9), 0.3 * fade, BK.Hex, p.reduce ? 0 : now * 0.1);
    p.particles.push(BK.Glow, x, p.surface(x, z) + 4, z, radius * 1.4, hot(color, 0.5), 0.25 * fade);
    for (let i = 0; i < p.n(40); i++) {
      const phase = p.reduce ? hash01(seed, i) : (now * 0.35 + hash01(seed, i)) % 1;
      const a = hash01(seed + 1, i) * TAU,
        r = radius * Math.sqrt(hash01(seed + 2, i));
      const mx = x + Math.cos(a) * r,
        mz = z + Math.sin(a) * r;
      p.particles.push(BK.Glow, mx, p.surface(mx, mz) + 5 + phase * 160, mz, 12 + 8 * hash01(seed + 3, i), hot(color, 2.2), 0.8 * fade * Math.sin(Math.PI * phase));
    }
  }

  /** Bursts for the ult events; `color` is the event's mode colour. Returns false for other kinds. */
  burst(e: TungstenEvent, id: number, age: number, f: number, color: Color): boolean {
    const p = this.paint;
    const R = (i: number, j: number) => hash01(id * 733 + i, j);
    switch (e.kind) {
      case 'collapse': {
        p.ring(e.x, e.z, e.radius * ease(age / 0.4), hot(color, 2), 0.8 * (1 - f));
        return true;
      }
      case 'collapseHold': {
        // Implosion: the light of the cube drawn into a point.
        if (age < 0.25) p.particles.push(BK.Flare, e.x, SINGULARITY_Y, e.z, 520 * (1 - age / 0.25), hot(WHITE, 1.8), 1 - age / 0.25);
        for (let i = 0; i < p.n(70); i++) {
          const a = R(i, 0) * TAU,
            el = (R(i, 1) - 0.5) * 2.4,
            k = ease(clamp01(age / (0.3 + 0.3 * R(i, 2))));
          const r = 420 * (1 - k) + 6;
          p.particles.push(BK.Spark, e.x + Math.cos(a) * Math.cos(el) * r, SINGULARITY_Y + Math.sin(el) * r, e.z + Math.sin(a) * Math.cos(el) * r, 2, hot(color, 2.6), 1 - f, 0, 0, -Math.cos(a) * Math.cos(el) * 20, -Math.sin(el) * 20, -Math.sin(a) * Math.cos(el) * 20, 1.6);
        }
        p.ring(e.x, e.z, e.radius * (1 - ease(age / 0.6)), hot(WHITE, 1.6), 0.7 * (1 - f));
        return true;
      }
      case 'collapseBurst':
        this.collapseBurst(e, id, age, f, color);
        return true;
      case 'meteorRise':
        p.ring(e.x, e.z, e.radius * ease(age / 0.35), hot(WHITE, 1.8), 0.9 * (1 - f));
        return true;
      case 'meteorFall':
        p.ring(e.x, e.z, e.radius * (0.9 + 0.1 * ease(age / 0.2)), hot(color, 2.4), 0.8 * (1 - f));
        return true;
      case 'meteorImpact':
        this.impact(e, id, age, f, color);
        return true;
      case 'fragment': {
        const base = p.surface(e.x, e.z);
        if (age < 0.12) p.particles.push(BK.Flare, e.x, base + 20, e.z, 160, hot(WHITE, 1.6), 1 - age / 0.12);
        p.ring(e.x, e.z, e.radius * ease(age / 0.4), hot(color, 1.8), 0.8 * (1 - f));
        for (let i = 0; i < p.n(16); i++) {
          const a = R(i, 0) * TAU,
            v = 120 + 200 * R(i, 1);
          if (age > 0.6) break;
          p.particles.push(BK.Spark, e.x + Math.cos(a) * drift(age, v, 2), base + 10 + drift(age, 160 * R(i, 2), 2, 200), e.z + Math.sin(a) * drift(age, v, 2), 1.6, hot(color, 2.6), 1 - age / 0.6, 0, 0, Math.cos(a) * 5, 2, Math.sin(a) * 5, 1.5);
        }
        for (let i = 0; i < p.n(8); i++) {
          const a = R(i, 3) * TAU,
            h = drift(age, 110 + 80 * R(i, 4), 1.5, 140);
          if (h > 0) p.particles.push(BK.Spray, e.x + Math.cos(a) * 20, base + h, e.z + Math.sin(a) * 20, 22 + age * 50, SPRAY, 0.6 * (1 - f), a, R(i, 5));
        }
        return true;
      }
      default:
        return false;
    }
  }

  private collapseBurst(e: TungstenEvent, id: number, age: number, f: number, color: Color): void {
    const p = this.paint;
    const R = (i: number, j: number) => hash01(id * 977 + i, j);
    const y = SINGULARITY_Y;
    const base = p.surface(e.x, e.z);
    if (age < 0.3) p.particles.push(BK.Flare, e.x, y, e.z, 1400 * (1 - age / 0.3) + 200, hot(WHITE, 2), 1 - age / 0.3);
    p.particles.push(BK.Glow, e.x, y, e.z, e.radius * 0.7 * (0.3 + 0.7 * ease(age / 0.25)), mix.copy(WHITE).lerp(color, clamp01(age / 0.4)).multiplyScalar(1.6), 0.8 * (1 - clamp01(age / 0.6)));
    // The shock: a white front on the water and an equatorial ring in the air, then a slower wave in colour.
    const front = e.radius * ease(age / 0.55);
    p.ring(e.x, e.z, front, hot(WHITE, 2.2), 0.95 * (1 - clamp01(age / 0.9)));
    p.ring(e.x, e.z, e.radius * 1.1 * ease(age / 1.1), hot(color, 1.8), 0.7 * (1 - f));
    p.loop(e.x, y, e.z, e.radius * 0.8 * ease(age / 0.45), hot(color, 2.2), 0.8 * (1 - clamp01(age / 0.6)), 10);
    p.foamRing(e.x, e.z, front * 0.95, 0.65 * (1 - f), id);
    if (!p.reduce && age < 0.7) this.distortions.push({ x: e.x, y: 40, z: e.z, radius: front / 0.48, strength: 0.9 * (1 - age / 0.7), priority: 4 });
    // A shell of sparks thrown out in every direction.
    for (let i = 0; i < p.n(120); i++) {
      const a = R(i, 0) * TAU,
        el = (R(i, 1) - 0.35) * 2,
        v = 500 + 700 * R(i, 2),
        pl = 0.6 + 0.7 * R(i, 3);
      if (age > pl) continue;
      const d = drift(age, v, 2.2);
      p.particles.push(BK.Spark, e.x + Math.cos(a) * Math.cos(el) * d, Math.max(base + 2, y + Math.sin(el) * d), e.z + Math.sin(a) * Math.cos(el) * d, 2.4, mix.copy(WHITE).lerp(color, age / pl).multiplyScalar(2.6), 1 - age / pl, 0, 0, Math.cos(a) * Math.cos(el) * 14, Math.sin(el) * 14, Math.sin(a) * Math.cos(el) * 14, 2);
    }
    // The sea, released, throws up a ring wall.
    for (let i = 0; i < p.n(64); i++) {
      const a = (i / 64) * TAU + R(i, 4) * 0.1,
        r = front * (0.9 + 0.1 * R(i, 5)),
        h = drift(age, 140 + 160 * R(i, 6), 1.4, 220);
      if (h > 0) p.particles.push(BK.Spray, e.x + Math.cos(a) * r, base + h, e.z + Math.sin(a) * r, (40 + 30 * R(i, 7)) * (1 + f), SPRAY, 0.6 * (1 - f), a, R(i, 8));
    }
  }

  /**
   * A meteor strike: fireball, shock, a crown of water, steam, and each mode's own aftermath. The cube lands
   * 512 m wide and only then shrinks, so everything is laid round its footprint or above it, never inside.
   */
  private impact(e: TungstenEvent, id: number, age: number, f: number, color: Color): void {
    const p = this.paint;
    const R = (i: number, j: number) => hash01(id * 619 + i, j);
    const r = e.radius;
    const base = p.surface(e.x, e.z);
    const half = (CUBE.edge * CUBE.meteor.scale) / 2;
    // The landed cube sits 30% sunk, so its top is this high.
    const top = base + half * 1.3;
    if (age < 0.3) p.particles.push(BK.Flare, e.x, top + 40, e.z, r * 1.6 * (1 - age / 0.3) + 200, hot(WHITE, 2), 1 - age / 0.3);
    const fire = mix.copy(WHITE).lerp(FIRE, clamp01(age / 0.35)).lerp(color, clamp01((age - 0.35) / 0.6)).multiplyScalar(1.8);
    if (age < 1) p.particles.push(BK.Glow, e.x, top + age * 160, e.z, r * (0.4 + 0.5 * ease(age / 0.3)), fire, 0.85 * (1 - age));
    // Fireballs bursting out from under every face.
    for (let i = 0; i < 10 && age < 1; i++) {
      const a = (i / 10) * TAU + R(i, 30) * 0.3,
        d = half * (1.1 + 0.5 * ease(age / 0.6));
      p.particles.push(BK.Glow, e.x + Math.cos(a) * d, base + 40 + age * 90, e.z + Math.sin(a) * d, half * (0.7 + 0.6 * ease(age / 0.4)), fire, 0.7 * (1 - age));
    }
    // Shock fronts.
    const front = r * 1.35 * ease(age / 0.7);
    p.ring(e.x, e.z, front, hot(WHITE, 2.2), 0.95 * (1 - clamp01(age / 1)));
    p.ring(e.x, e.z, r * ease(age / 1), hot(color, 1.9), 0.8 * (1 - clamp01(age / 1.6)));
    if (!p.reduce && age < 0.8) this.distortions.push({ x: e.x, y: 30, z: e.z, radius: front / 0.48, strength: 0.9 * (1 - age / 0.8), priority: 4 });
    p.foamRing(e.x, e.z, r * 1.1 * ease(age / 1.6), 0.7 * (1 - f), id);
    // The cavity punched in the sea, bared as the cube shrinks off it, then closing again.
    p.ring(e.x, e.z, half * 1.1 * (0.7 + 0.3 * ease(age / 0.3)), CAVITY, 0.75 * (1 - clamp01(age / 1.6)), BK.Foam, id);
    // A crown of water thrown out from under the faces.
    for (let i = 0; i < p.n(120); i++) {
      const a = (i / 120) * TAU + R(i, 0) * 0.05,
        out = half * 1.05 + drift(age, 260 + 160 * R(i, 1), 1.3),
        h = drift(age, 900 + 500 * R(i, 2), 1.1, 330);
      if (h > 0) p.particles.push(BK.Spray, e.x + Math.cos(a) * out, base + h, e.z + Math.sin(a) * out, (70 + 60 * R(i, 3)) * (1 + age), SPRAY, 0.75 * (1 - f), a, R(i, 4));
    }
    // Once the cube lifts off, the sea it displaced slams back and throws a column straight up.
    const rebound = age - CUBE.meteor.shrink * 0.6;
    for (let i = 0; i < p.n(36) && rebound > 0; i++) {
      const a = R(i, 5) * TAU,
        out = 60 * R(i, 6),
        h = drift(rebound, 1200 + 500 * R(i, 7), 0.9, 380);
      if (h > 0) p.particles.push(BK.Spray, e.x + Math.cos(a) * out, base + h, e.z + Math.sin(a) * out, (80 + 50 * R(i, 8)) * (1 + rebound * 1.3), SPRAY, 0.7 * (1 - f), a, R(i, 9));
    }
    for (let i = 0; i < p.n(90); i++) {
      const a = R(i, 10) * TAU,
        v = 300 + 600 * R(i, 11),
        pl = 0.7 + 0.8 * R(i, 12);
      if (age > pl) continue;
      const d = half + drift(age, v, 1.6);
      p.particles.push(BK.Spark, e.x + Math.cos(a) * d, base + 20 + drift(age, 200 + 400 * R(i, 13), 1.6, 300), e.z + Math.sin(a) * d, 2.4, mix.copy(EMBER).lerp(color, age / pl).multiplyScalar(2.6), 1 - age / pl, 0, 0, Math.cos(a) * 8, 4, Math.sin(a) * 8, 2);
    }
    // Steam boiling off the crater.
    for (let i = 0; i < p.n(28); i++) {
      const la = age - 0.3 - R(i, 14) * 0.6;
      if (la < 0) continue;
      const a = R(i, 15) * TAU,
        d = half * (0.3 + 0.9 * R(i, 16));
      p.particles.push(BK.Smoke, e.x + Math.cos(a) * d, base + 20 + la * (40 + 40 * R(i, 17)), e.z + Math.sin(a) * d, 160 + la * 100, STEAM, 0.4 * (1 - f) * clamp01(la / 0.3), a, R(i, 18));
    }
    // Each mode's aftermath.
    if (e.mode === KINETIC) {
      const k = clamp01((age - 0.15) / 0.9);
      p.ring(e.x, e.z, r * 1.6 * ease(k), hot(color, 2), 0.8 * (1 - k));
    } else if (e.mode === CRUSH && age < 1.8) {
      const hold = 1 - clamp01((age - 1.2) / 0.6);
      p.ring(e.x, e.z, r, hot(color, 2), 0.7 * hold);
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU + R(i, 20),
          a1 = a0 + 0.6 + R(i, 21) * 0.5;
        const ax = e.x + Math.cos(a0) * r,
          az = e.z + Math.sin(a0) * r,
          bx = e.x + Math.cos(a1) * r,
          bz = e.z + Math.sin(a1) * r;
        p.arc(ax, p.surface(ax, az) + 4, az, bx, p.surface(bx, bz) + 4, bz, id * 3 + i, hot(color, 2.4), 0.8 * hold, 3, 60, 10);
      }
    } else if (e.mode === REPEL) {
      const k = clamp01(age / 1.1);
      p.ring(e.x, e.z, r * 1.7 * ease(k), hot(color, 2), 0.9 * (1 - k));
      p.foamRing(e.x, e.z, r * 1.65 * ease(k), 0.6 * (1 - k), id + 1);
    } else if (e.mode === TETHER && age < 0.6) {
      p.loop(e.x, base + 30, e.z, 2000 * (1 - ease(age / 0.6)), hot(color, 2), 0.8 * (1 - age / 0.6), 12);
    } else if (e.mode === SHARD && age < 0.9) {
      for (let i = 0; i < p.n(40); i++) {
        const a = R(i, 22) * TAU,
          v = r * (1.4 + R(i, 23));
        p.particles.push(BK.Spark, e.x + Math.cos(a) * drift(age, v, 2), base + 30 + drift(age, 260 * R(i, 24), 2, 250), e.z + Math.sin(a) * drift(age, v, 2), 2.2, hot(color, 2.8), 1 - age / 0.9, 0, 0, Math.cos(a) * 10, 2, Math.sin(a) * 10, 1.8);
      }
    }
    p.particles.push(BK.Glow, e.x, base + 10, e.z, r * 1.4, hot(e.mode === MEND ? modeColor(MEND) : color, 0.6), 0.4 * (1 - f));
  }
}
