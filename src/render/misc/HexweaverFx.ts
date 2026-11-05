import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, type BufferGeometry, type Material } from 'three';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { HEX, type Doll } from '../../skills/misc/HexweaverRuntime';
import type { MiscFxKind } from '../../skills/misc/MiscEvents';
import type { Shell } from '../../weapons/ShellSystem';
import { BK, hash01 } from '../BurstParticles';
import { bump, clamp01, easeOut, hot, mix, TAU } from './MiscFxKit';
import { MiscShipFx, type MiscBurst } from './MiscShipFx';

const PINK = 0xf290cf;
const BLUSH = 0xffd8f0;
const INK = 0xa45cae;
const SOUL = 0xff5fb8;
const GILT = 0xffd18b;

/** Seconds each Hexweaver burst plays. */
const LIFE: Partial<Record<MiscFxKind, number>> = {
  pin: 0.9,
  stitch: 1.3,
  twist: 1.1,
  fire: 1.4,
  ignite: 0.8,
  rip: 1.5,
  erupt: 1.2,
  substitute: 1,
  decoyBurst: 1.4,
  coven: HEX.coven.time,
  needle: 0.55,
  unmake: 1.5,
  tear: 0.9,
};

/** Seconds a pin takes to fly from the Hexweaver to its doll. */
const PIN_FLIGHT = 0.35;

/** The Hexweaver: dolls that react to their ships, needles, stitches, soulfire and the ritual. */
export class HexweaverFx extends MiscShipFx {
  readonly look = 'needle' as const;
  readonly palette = { main: PINK, hot: BLUSH, deep: INK };
  /** Colours held across many draws; `hot` and `mix` only keep four scratch colours alive. */
  private readonly held = [new Color(), new Color(), new Color()];
  private box = new BoxGeometry(1, 1, 1);
  private round = new SphereGeometry(1, 10, 6);
  private cloth = new OctahedronGeometry(1, 1);
  private cylinder = new CylinderGeometry(0.5, 0.5, 1, 16);
  private clothMaterial = new MeshStandardMaterial({ color: 0x5e354e, roughness: 0.95, metalness: 0.08 });
  private strawMaterial = new MeshStandardMaterial({ color: 0xc9a25a, roughness: 1, metalness: 0 });
  private needleMaterial = new MeshStandardMaterial({ color: GILT, roughness: 0.25, metalness: 0.8, emissive: 0x6b240d, emissiveIntensity: 0.3 });
  private glowMaterial = new MeshBasicMaterial({ color: 0xf998d0, toneMapped: false });

  owns(s: Ship): boolean {
    return !!s.hexweaver;
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
    if (kind === 'coven') {
      kit.onFlash?.(x, z, 0.35, SOUL);
      shake(0.3);
    } else if (kind === 'unmake') {
      kit.onFlash?.(x, z, b.e.radius ? 0.5 : 0.3, SOUL);
      shake(b.e.radius ? 0.45 : 0.25);
    } else if (kind === 'rip' || kind === 'decoyBurst') {
      kit.onFlash?.(x, z, 0.3, PINK);
      shake(0.25);
    }
  }

  /** The coven's circle is public ground; a burst on a ship shows only where that ship can be seen. */
  protected shows(b: MiscBurst, team: Team | -1): boolean {
    const { kind, target } = b.e;
    if (kind === 'gunHit' || kind === 'gunLand') return super.shows(b, team);
    if (kind === 'coven' || kind === 'fire' || kind === 'rip' || kind === 'stitch' || kind === 'decoyBurst') return true;
    if (target && !this.kit.visible(target, team)) return false;
    if (kind === 'pin' || kind === 'substitute') return super.shows(b, team);
    return true;
  }

  protected burst(b: MiscBurst, age: number): void {
    switch (b.e.kind) {
      case 'pin':
        return this.pin(b, age);
      case 'stitch':
        return this.sweep(b, age);
      case 'twist':
        return this.wring(b, age);
      case 'fire':
        return this.soulfire(b, age);
      case 'ignite':
        return this.ignite(b, age);
      case 'rip':
        return this.zipper(b, age);
      case 'erupt':
        return this.erupt(b, age);
      case 'substitute':
        return this.puff(b, age);
      case 'decoyBurst':
        return this.decoyBurst(b, age);
      case 'coven':
        return this.sigil(b, age);
      case 'needle':
        return this.rain(b, age);
      case 'unmake':
        return this.unmake(b, age);
      case 'tear':
        return this.shreds(b.e.target ?? null, b.e.x, b.e.z, b.id, age, this.life('tear'), 1);
      default:
        super.burst(b, age);
    }
  }

  // ------------------------------------------------------------------ dolls

  protected persist(live: Set<string>): void {
    const { kit } = this;
    const now = kit.game.time;
    const t = kit.t;
    for (const s of kit.game.ships) {
      if (!s.alive || !s.hexweaver) continue;
      for (const d of s.hexweaver.dolls) {
        const v = kit.game.ships.find((v) => v.id === d.target && v.alive);
        if (!v) continue;
        const key = `misc-doll-${s.id}-${v.id}`;
        live.add(key);
        const g = kit.node(key, () => this.doll(this.clothMaterial));
        if (!g) continue;
        this.poseDoll(g, d, v, s.id, now, t);
      }
      const d = s.hexweaver.decoy;
      if (d && d.until > now) {
        const key = `misc-decoy-${s.id}`;
        live.add(key);
        const g = kit.node(key, () => this.doll(this.strawMaterial));
        if (!g) continue;
        // The straw effigy sways, and shakes harder as it soaks up damage.
        const worn = 1 - d.hp / HEX.substitute.hp;
        g.position.set(d.x, 46 + Math.sin(t * 2) * 3, d.z);
        g.scale.setScalar(26);
        g.rotation.set(0, t * 0.35, Math.sin(t * (3 + worn * 20)) * (0.06 + worn * 0.2));
        for (const p of g.userData.pins as Mesh[]) p.visible = false;
      }
    }
  }

  /** Hovers a doll over its ship: jolting when the ship is hurt, wrung by a Twist, a new pin sliding in. */
  private poseDoll(g: Group, d: Doll, v: Ship, owner: number, now: number, t: number): void {
    const still = this.kit.reduce;
    const flinch = clamp01(1 - (now - d.struck) / 0.45);
    const twist = clamp01(1 - (now - d.twistedAt) / 1);
    const jolt = still ? 0 : flinch * flinch;
    g.position.set(v.renderPos.x + jolt * 6 * Math.sin(t * 70), v.renderPos.y + v.spec.freeboard + 90 + jolt * 10, v.renderPos.z);
    // A Twist wrings the doll a full turn and a half, unwinding as it fades.
    g.rotation.y = t * 0.65 + owner * 0.4 + (still ? 0 : easeOut(twist) * TAU * 1.5);
    g.rotation.z = Math.sin(t * 2 + v.id) * 0.12 + jolt * 0.6 * Math.sin(t * 55);
    g.rotation.x = jolt * 0.35;
    const burning = d.burnUntil > now;
    g.scale.setScalar((14 + (burning ? 1.5 : 0)) * (1 + 0.25 * bump(twist * 2)));
    const pins = g.userData.pins as Mesh[];
    const rest = g.userData.rest as number[];
    const fresh = clamp01((now - d.pinnedAt) / 0.25);
    for (let i = 0; i < pins.length; i++) {
      pins[i].visible = i < d.pins;
      // The newest pin drives in from outside the doll.
      const slide = i === d.pins - 1 && !still ? (1 - easeOut(fresh)) * 2.4 : 0;
      pins[i].position.z = rest[i] + slide;
    }
  }

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    const t = kit.t;
    for (const s of kit.game.ships) {
      const h = s.hexweaver;
      if (!h || !s.alive || s.withdrawn) continue;
      const visible = kit.visible(s, team);
      const ink = this.held[0].copy(hot(INK, 1.2));
      for (let i = 0; i < h.dolls.length; i++) {
        const d = h.dolls[i];
        const target = kit.game.ships.find((v) => v.id === d.target && v.alive);
        if (!target || !kit.visible(target, team)) continue;
        const g = kit.peek(`misc-doll-${s.id}-${target.id}`);
        if (g) g.visible = true;
        const x = target.renderPos.x;
        const z = target.renderPos.z;
        const y = target.renderPos.y + target.spec.freeboard + 90;
        const burning = d.burnUntil > now;
        const ring = this.held[1].copy(hot(burning ? SOUL : PINK, burning ? 1.8 : 1.3));
        kit.ring(x, z, 55 + Math.sin(t * 3) * 4, y - 60, ring, 0.45, 3, t * 0.4, 24);
        // A pin count of little gold ticks under the doll.
        for (let k = 0; k < d.pins; k++) {
          const a = t * 0.4 + (k * TAU) / 3;
          kit.line(x + Math.cos(a) * 55, y - 60, z + Math.sin(a) * 55, x + Math.cos(a) * 55, y - 30, z + Math.sin(a) * 55, hot(GILT, 1.8), 0.85, 3);
        }
        if (visible) kit.line(s.renderPos.x, s.spec.freeboard + 45, s.renderPos.z, x, y, z, ink, 0.27, 2);
        if (burning) this.soulflame(x, y - 20, z, d.target, 1);
        if (d.stitchedUntil <= now) continue;
        for (let k = i + 1; k < h.dolls.length; k++) {
          const other = h.dolls[k];
          if (other.stitchedUntil <= now) continue;
          const v = kit.game.ships.find((v) => v.id === other.target && v.alive);
          if (!v || !kit.visible(v, team)) continue;
          this.thread(x, y, z, v.renderPos.x, v.renderPos.y + v.spec.freeboard + 90, v.renderPos.z, d.target * 7 + other.target);
        }
      }
      if (visible && h.decoy && h.decoy.until > now) {
        const g = kit.peek(`misc-decoy-${s.id}`);
        if (g) g.visible = true;
        const dx = h.decoy.x;
        const dz = h.decoy.z;
        kit.ring(dx, dz, 120, 5, hot(PINK, 1.4), 0.55, 4, t * 0.5, 32, true);
        // The lure: a slow pulse out to the reach it draws fire from.
        const f = (t * 0.6) % 1;
        kit.ring(dx, dz, HEX.substitute.lure * easeOut(f), 6, hot(PINK, 1.2), 0.3 * (1 - f), 5, 0, 96);
      }
    }
  }

  /** A shining zig-zag stitch between two dolls, with sparks running along it. */
  private thread(ax: number, ay: number, az: number, bx: number, by: number, bz: number, seed: number): void {
    const { kit } = this;
    const n = 14;
    const c = this.held[2].copy(hot(PINK, 1.6));
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * 16;
    const oz = (dx / len) * 16;
    let px = ax;
    let py = ay;
    let pz = az;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const side = i === n ? 0 : i % 2 ? 1 : -1;
      const x = ax + dx * f + ox * side;
      const y = ay + (by - ay) * f + Math.sin(Math.PI * f) * 60;
      const z = az + dz * f + oz * side;
      kit.line(px, py, pz, x, y, z, c, 0.65, 2.5);
      px = x;
      py = y;
      pz = z;
    }
    const f = (kit.t * 0.5 + hash01(seed, 1)) % 1;
    const p = kit.arcAt(ax, ay, az, bx, by, bz, 60, f);
    kit.glow(p.x, p.y, p.z, 40, hot(BLUSH, 2), 0.8);
  }

  /** Pink soulfire licking up from a point. */
  private soulflame(x: number, y: number, z: number, seed: number, k: number): void {
    const { kit } = this;
    const n = Math.round(5 * kit.k * k);
    for (let i = 0; i < n; i++) {
      const f = (kit.t * 1.4 + i / n + hash01(seed, i)) % 1;
      const a = hash01(seed, i + 9) * TAU;
      const r = 30 * k * (1 - f);
      kit.particles.push(BK.Flare, x + Math.cos(a) * r, y + f * 90 * k, z + Math.sin(a) * r, 40 * k * (1 - f * 0.6), mix(SOUL, BLUSH, f, 2), 0.8 * (1 - f), f * 3, i);
    }
  }

  // ------------------------------------------------------------------ bursts

  /** A giant needle arcs from the Hexweaver and stabs the doll: a flash and a pink ring. */
  private pin(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const tx = t.renderPos.x;
    const tz = t.renderPos.z;
    const ty = t.renderPos.y + t.spec.freeboard + 90;
    const sx = b.e.tx ?? b.e.x;
    const sz = b.e.tz ?? b.e.z;
    if (age < PIN_FLIGHT) {
      const f = age / PIN_FLIGHT;
      const lift = Math.min(500, Math.hypot(tx - sx, tz - sz) * 0.15);
      const p = kit.arcAt(sx, 60, sz, tx, ty, tz, lift, f);
      const q = kit.arcAt(sx, 60, sz, tx, ty, tz, lift, Math.max(0, f - 0.04));
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dz = p.z - q.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.needle(p.x, p.y, p.z, dx / l, dy / l, dz / l, 90, 1);
      kit.arc(sx, 60, sz, tx, ty, tz, lift, hot(PINK, 1.2), 0.3, 2, 20, f);
      return;
    }
    const f = clamp01((age - PIN_FLIGHT) / (this.life('pin') - PIN_FLIGHT));
    const fade = 1 - f;
    kit.particles.push(BK.Flare, tx, ty, tz, 260 * fade, hot(BLUSH, 2.4), fade, b.id);
    kit.ring(tx, tz, 60 + 160 * easeOut(f), ty - 40, hot(PINK, 1.8), 0.8 * fade, 5, 0, 32);
    kit.shock(tx, tz, 80 + 220 * easeOut(f), hot(PINK, 1.4), 0.5 * fade);
  }

  /** A needle blade sweeping across the stitch disc, leaving a stitched seam behind. */
  private sweep(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? HEX.stitch.radius;
    const fade = 1 - clamp01(age / this.life('stitch'));
    const f = easeOut(clamp01(age / 0.5));
    const a = -Math.PI / 2 + Math.PI * f;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // The blade, a long needle laid flat across the disc.
    this.needle(x + ca * r, 30, z + sa * r, -ca, 0, -sa, r * 2, 0.9 * fade, 10);
    // The swept wedge, cross-stitched.
    const steps = 18;
    for (let i = 0; i < steps; i++) {
      const b0 = -Math.PI / 2 + (Math.PI * f * i) / steps;
      const rr = r * (0.3 + 0.7 * ((i * 0.37) % 1));
      kit.line(x + Math.cos(b0) * rr * 0.9, 12, z + Math.sin(b0) * rr * 0.9, x + Math.cos(b0 + 0.05) * rr, 12, z + Math.sin(b0 + 0.05) * rr, hot(PINK, 1.6), 0.6 * fade, 4);
    }
    kit.ring(x, z, r, 8, hot(PINK, 1.5), 0.6 * fade, 5, 0, 96, true);
  }

  /** A pink helix wringing the hull. */
  private wring(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const f = clamp01(age / this.life('twist'));
    const fade = 1 - f;
    const r = t.spec.length * (0.6 - 0.25 * easeOut(f));
    const spin = (kit.reduce ? 0 : age * 9) * (b.e.n ? 1.4 : 1);
    kit.helix(t.renderPos.x, 6, t.renderPos.z, r, 140, 3, spin, hot(PINK, 2), 0.85 * fade, 6);
    kit.helix(t.renderPos.x, 6, t.renderPos.z, r * 0.9, 140, 3, spin + Math.PI, hot(INK, 1.6), 0.6 * fade, 4);
    if (b.e.n) kit.particles.push(BK.Flare, t.renderPos.x, t.spec.freeboard + 40, t.renderPos.z, 360 * fade, hot(BLUSH, 2.4), fade, b.id);
  }

  /** Effigy Fire catching: a soulfire ring and flames rising across the patch. */
  private soulfire(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? HEX.fire.radius;
    const fade = 1 - clamp01(age / this.life('fire'));
    kit.ring(x, z, r * easeOut(age * 3), 8, hot(SOUL, 2), 0.9 * fade, 10, 0, 72);
    kit.shock(x, z, r * easeOut(age * 2), hot(SOUL, 1.4), 0.6 * fade);
    const n = Math.round(22 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const rr = r * Math.sqrt(hash01(b.id, i + 30));
      const h = (age * 220 + hash01(b.id, i + 60) * 80) % 200;
      kit.particles.push(BK.Flare, x + Math.cos(a) * rr, h, z + Math.sin(a) * rr, 70 * (1 - h / 220), mix(SOUL, BLUSH, h / 200, 2), fade * (1 - h / 220), age * 3, i);
    }
  }

  /** A doll catching fire. */
  private ignite(b: MiscBurst, age: number): void {
    const t = b.e.target;
    if (!t) return;
    const fade = 1 - clamp01(age / this.life('ignite'));
    this.kit.particles.push(BK.Flare, t.renderPos.x, t.renderPos.y + t.spec.freeboard + 90, t.renderPos.z, 200 * fade, hot(SOUL, 2.4), fade, b.id);
    this.soulflame(t.renderPos.x, t.spec.freeboard + 20, t.renderPos.z, b.id, 2 * fade + 0.5);
  }

  /** A zipper seam tearing across the disc, throwing cloth shards. */
  private zipper(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? HEX.rip.radius;
    const fade = 1 - clamp01(age / this.life('rip'));
    const f = easeOut(clamp01(age / 0.45));
    const a = hash01(b.id, 3) * Math.PI;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const x0 = x - ux * r;
    const z0 = z - uz * r;
    const len = 2 * r * f;
    const gape = 40 * easeOut(clamp01(age / 0.8));
    // Two lips peeling apart behind the slider, with teeth between them.
    for (const side of [-1, 1]) kit.line(x0 - uz * gape * side, 10, z0 + ux * gape * side, x0 + ux * len - uz * 4 * side, 10, z0 + uz * len + ux * 4 * side, hot(PINK, 2), 0.9 * fade, 8);
    for (let d = 0; d < len; d += 45) {
      const g = gape * (1 - d / Math.max(1, len));
      kit.line(x0 + ux * d - uz * g, 10, z0 + uz * d + ux * g, x0 + ux * d + uz * g, 10, z0 + uz * d - ux * g, hot(GILT, 1.6), 0.6 * fade, 3);
    }
    kit.glow(x0 + ux * len, 30, z0 + uz * len, 120, hot(BLUSH, 2.2), fade);
    kit.ring(x, z, r, 8, hot(PINK, 1.4), 0.5 * fade, 4, 0, 96, true);
    const n = Math.round(16 * kit.k);
    for (let i = 0; i < n; i++) {
      const d = hash01(b.id, i) * len;
      const s = hash01(b.id, i + 40) - 0.5;
      const up = 0.5 + hash01(b.id, i + 80);
      kit.particles.push(BK.Shard, x0 + ux * d - uz * s * 200 * age, 10 + up * 260 * age - 200 * age * age, z0 + uz * d + ux * s * 200 * age, 22, hot(0x8a4a74, 1.4), fade, age * 6 + i, i);
    }
  }

  /** A stitched doll erupting: a pink column and a shock ring. */
  private erupt(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const x = t?.renderPos.x ?? b.e.x;
    const z = t?.renderPos.z ?? b.e.z;
    const r = b.e.radius ?? HEX.rip.eruptRadius;
    const fade = 1 - clamp01(age / this.life('erupt'));
    const f = easeOut(clamp01(age / 0.4));
    kit.line(x, 0, z, x, 600 * f, z, hot(SOUL, 2.2), 0.9 * fade, 40);
    kit.line(x, 0, z, x, 600 * f, z, hot(BLUSH, 2.6), fade, 10);
    kit.shock(x, z, r * easeOut(age * 1.6), hot(PINK, 1.6), 0.7 * fade);
    kit.glow(x, 80, z, 300 * fade, hot(SOUL, 1.8), 0.7 * fade);
  }

  /** Substitute: a cloth puff where the Hexweaver stood and a streak to where it went. */
  private puff(b: MiscBurst, age: number): void {
    const { kit } = this;
    const fade = 1 - clamp01(age / this.life('substitute'));
    const { x, z } = b.e;
    const tx = b.e.tx ?? x;
    const tz = b.e.tz ?? z;
    const n = Math.round(14 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = 40 + 160 * easeOut(age * 2) * hash01(b.id, i + 20);
      kit.particles.push(BK.Smoke, x + Math.cos(a) * d, 30 + 60 * age, z + Math.sin(a) * d, 90 + 120 * age, hot(0xd7a6c6, 1), 0.6 * fade, a, i);
    }
    const f = easeOut(clamp01(age / 0.25));
    kit.line(x, 40, z, x + (tx - x) * f, 40, z + (tz - z) * f, hot(PINK, 2), 0.8 * fade, 14);
    kit.glow(tx, 50, tz, 160 * fade, hot(BLUSH, 2), fade);
  }

  /** The straw effigy bursting. */
  private decoyBurst(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? HEX.substitute.burstRadius;
    const fade = 1 - clamp01(age / this.life('decoyBurst'));
    kit.particles.push(BK.Flare, x, 50, z, 700 * easeOut(age * 5) * fade, hot(SOUL, 2.4), fade, b.id);
    kit.shock(x, z, r * easeOut(age * 1.5), hot(PINK, 1.6), 0.8 * fade);
    this.shreds(null, x, z, b.id, age, this.life('decoyBurst'), 2, 0xc9a25a);
  }

  /** The coven's ritual circle: a sigil on the water, turning runes and candle flames, for its whole life. */
  private sigil(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? HEX.coven.radius;
    const life = this.life('coven');
    const grow = easeOut(clamp01(age / 0.8));
    const fade = clamp01((life - age) / 0.8);
    const a = grow * fade;
    const spin = kit.t * 0.08;
    const c = this.held[0].copy(hot(PINK, 1.8));
    kit.ring(x, z, r * grow, 8, c, 0.85 * a, 10, spin, 120);
    kit.ring(x, z, r * 0.86 * grow, 8, c, 0.55 * a, 5, -spin, 120, true);
    kit.ring(x, z, r * 0.4 * grow, 8, c, 0.5 * a, 4, spin * 2, 60);
    // A seven-pointed star joins the candles.
    const pts = 7;
    for (let i = 0; i < pts; i++) {
      const p0 = spin + (i * TAU) / pts;
      const p1 = spin + (((i * 3) % pts) * TAU) / pts + (3 * TAU) / pts;
      kit.line(x + Math.cos(p0) * r * 0.86 * grow, 9, z + Math.sin(p0) * r * 0.86 * grow, x + Math.cos(p1) * r * 0.86 * grow, 9, z + Math.sin(p1) * r * 0.86 * grow, hot(INK, 1.8), 0.7 * a, 5);
      const cx = x + Math.cos(p0) * r * 0.86 * grow;
      const cz = z + Math.sin(p0) * r * 0.86 * grow;
      kit.line(cx, 4, cz, cx, 60, cz, hot(BLUSH, 1.2), 0.6 * a, 8);
      kit.particles.push(BK.Flare, cx, 72 + 4 * Math.sin(kit.t * 9 + i), cz, 46, hot(GILT, 2.2), a, 0, i);
      kit.glow(cx, 70, cz, 120, hot(SOUL, 1.4), 0.45 * a);
    }
    // Runes between the rings.
    for (let i = 0; i < 14; i++) {
      const p = -spin * 1.5 + (i * TAU) / 14;
      const rx = x + Math.cos(p) * r * 0.93 * grow;
      const rz = z + Math.sin(p) * r * 0.93 * grow;
      const ux = -Math.sin(p) * 22;
      const uz = Math.cos(p) * 22;
      kit.line(rx - ux, 9, rz - uz, rx + ux, 9, rz + uz, c, 0.7 * a, 3);
      kit.line(rx, 9, rz, rx + Math.cos(p) * 22, 9, rz + Math.sin(p) * 22, c, 0.7 * a, 3);
    }
    if (age < 0.6 && !kit.reduce) kit.distortions.push({ x, y: 30, z, radius: r * 0.5, strength: 0.6 * (1 - age / 0.6), priority: 3 });
  }

  /** One of the Thousand Needles dropping out of the sky onto the hull. */
  private rain(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    if (!t) return;
    const off = (hash01(b.id, 1) - 0.5) * t.spec.length * 0.8;
    const side = (hash01(b.id, 2) - 0.5) * t.spec.beam;
    const h = t.renderHeading;
    const x = t.renderPos.x + Math.sin(h) * off + Math.cos(h) * side;
    const z = t.renderPos.z + Math.cos(h) * off - Math.sin(h) * side;
    const deck = t.renderPos.y + t.spec.freeboard;
    const fall = 0.16;
    if (age < fall) {
      const y = deck + 1100 * (1 - age / fall);
      const lean = 0.2 * (hash01(b.id, 3) - 0.5);
      this.needle(x, y, z, lean, -1, -lean, 110, 1);
      return;
    }
    const fade = 1 - clamp01((age - fall) / (this.life('needle') - fall));
    // It sticks, shining, and fades.
    this.needle(x, deck + 50, z, 0, -1, 0, 70, fade);
    kit.particles.push(BK.Flare, x, deck + 6, z, 120 * fade, hot(BLUSH, 2.2), fade, b.id);
    if (age < fall + 0.1) kit.particles.push(BK.Spark, x, deck + 6, z, 6, hot(GILT, 2), 1, 0, b.id, 0, 30, 0, 2);
  }

  /** A doll unmade: torn apart in a pink blast, wider when it was stitched. */
  private unmake(b: MiscBurst, age: number): void {
    const { kit } = this;
    const t = b.e.target;
    const x = t?.renderPos.x ?? b.e.x;
    const z = t?.renderPos.z ?? b.e.z;
    const y = (t?.renderPos.y ?? 0) + (t?.spec.freeboard ?? 10) + 90;
    const fade = 1 - clamp01(age / this.life('unmake'));
    kit.particles.push(BK.Flare, x, y, z, (500 + 120 * (b.e.n ?? 0)) * easeOut(age * 4) * fade, hot(SOUL, 2.6), fade, b.id);
    kit.line(x, 0, z, x, 900 * easeOut(age * 2), z, hot(PINK, 2.2), 0.8 * fade, 30);
    kit.shock(x, z, 200 + 300 * easeOut(age * 1.5), hot(PINK, 1.8), 0.8 * fade);
    if (b.e.radius) {
      kit.shock(x, z, b.e.radius * easeOut(age * 1.2), hot(SOUL, 1.6), 0.7 * fade);
      kit.ring(x, z, b.e.radius * easeOut(age * 1.2), 10, hot(BLUSH, 2), 0.7 * fade, 10, 0, 96);
    }
    this.shreds(t ?? null, x, z, b.id, age, this.life('unmake'), 2);
  }

  /** Cloth (or straw) shards thrown from where a doll hung. */
  private shreds(t: Ship | null, x: number, z: number, id: number, age: number, life: number, k: number, color = 0x8a4a74): void {
    const { kit } = this;
    const fade = 1 - clamp01(age / life);
    const y = t ? t.renderPos.y + t.spec.freeboard + 90 : 60;
    const cx = t?.renderPos.x ?? x;
    const cz = t?.renderPos.z ?? z;
    const n = Math.round(12 * k * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(id, i) * TAU;
      const up = 0.3 + hash01(id, i + 50);
      const d = (90 + 120 * hash01(id, i + 99)) * age * k;
      kit.particles.push(BK.Shard, cx + Math.cos(a) * d, y + up * d - 160 * age * age, cz + Math.sin(a) * d, 16 * k, hot(color, 1.3), fade, age * 8 + i, i);
    }
    if (age < 0.3) kit.particles.push(BK.Flare, cx, y, cz, 160 * k * (1 - age / 0.3), hot(BLUSH, 2.2), 1 - age / 0.3, id);
  }

  // ------------------------------------------------------------------ shapes

  /** A sewing needle in light: a shaft along (dx, dy, dz) ending in a point at (x, y, z), its eye at the back. */
  private needle(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, a: number, w = 5): void {
    const { kit } = this;
    const bx = x - dx * len;
    const by = y - dy * len;
    const bz = z - dz * len;
    kit.line(bx, by, bz, x, y, z, hot(GILT, 2), 0.95 * a, w);
    kit.line(bx + dx * len * 0.3, by + dy * len * 0.3, bz + dz * len * 0.3, x, y, z, hot(0xffffff, 2.4), 0.8 * a, w * 0.35);
    kit.glow(x, y, z, w * 6, hot(BLUSH, 2.2), 0.8 * a);
    kit.glow(bx, by, bz, w * 4, hot(PINK, 1.6), 0.6 * a);
  }

  /** A long thin pink needle trailing a wavering ink thread. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    kit.line(x - dx * 50, y - dy * 50, z - dz * 50, x + dx * 8, y + dy * 8, z + dz * 8, hot(BLUSH, 2.4), 0.95, 1.4);
    kit.glow(x, y, z, 16, hot(PINK, 2), 0.7);
    const len = Math.min(s.travelled, 320);
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    let px = x - dx * 50;
    let py = y - dy * 50;
    let pz = z - dz * 50;
    const thread = this.held[0].copy(hot(PINK, 1.1));
    for (let i = 1; i <= 10; i++) {
      const back = 50 + (len - 50) * (i / 10);
      if (back <= 50) break;
      const wave = Math.sin(i * 1.3 + kit.t * 9 + s.id) * 6 * (i / 10);
      const nx = x - dx * back + (ux / ul) * wave;
      const ny = y - dy * back;
      const nz = z - dz * back + (uz / ul) * wave;
      kit.line(px, py, pz, nx, ny, nz, thread, 0.5 * (1 - i / 11), 1.2);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  /** A cloth (or straw) effigy with glowing stitched eyes and three needles it may carry. */
  private doll(material: Material): Group {
    const g = new Group();
    const add = (geometry: BufferGeometry, m: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh => {
      const mesh = new Mesh(geometry, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      g.add(mesh);
      return mesh;
    };
    add(this.cloth, material, 0, 0, 0, 0.9, 1.4, 0.5);
    add(this.round, material, 0, 1.8, 0, 0.72, 0.72, 0.6);
    for (const side of [-1, 1]) {
      add(this.box, material, side * 1.15, 0.5, 0, 1.3, 0.42, 0.45).rotation.z = side * -0.3;
      add(this.box, material, side * 0.4, -1.65, 0, 0.44, 1.3, 0.44).rotation.z = side * 0.15;
      // Cross stitches on the effigy's face; their glowing eyes read at gameplay distance.
      add(this.round, this.glowMaterial, side * 0.23, 1.9, 0.55, 0.13, 0.13, 0.08);
    }
    const pins: Mesh[] = [];
    const rest: number[] = [];
    for (let i = 0; i < 3; i++) {
      const p = add(this.cylinder, this.needleMaterial, (i - 1) * 0.75, 0.7 - i * 0.45, 0.8, 0.11, 2, 0.11);
      p.rotation.x = Math.PI * 0.45;
      p.rotation.z = (i - 1) * 0.3;
      pins.push(p);
      rest.push(p.position.z);
    }
    g.userData.pins = pins;
    g.userData.rest = rest;
    return g;
  }

  dispose(): void {
    super.dispose();
    this.box.dispose();
    this.round.dispose();
    this.cloth.dispose();
    this.cylinder.dispose();
    this.clothMaterial.dispose();
    this.strawMaterial.dispose();
    this.needleMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
