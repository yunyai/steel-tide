import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { audio } from '../../fx/Audio';
import { PK, type ParticleSystem } from '../../fx/Particles';
import { Ribbons } from '../../render/Projectiles';
import { flyerGeometry } from '../../render/ShipModel';
import { SHIELD_FRAG, SHIELD_VERT } from '../../render/SkillFx';
import { ENEMY_COLOR as ENEMY } from '../../ui/palette';
import type { GroundGame } from '../sim/GroundGame';
import type { Vehicle } from '../sim/Vehicle';
import type { Field } from '../sim/weapons/Fields';
import type { Strike, StrikeKind } from '../sim/weapons/Strikes';

// Skill visuals for ground battles: the burst when a skill fires (a column of light for an
// ultimate), warning circles that tighten before a strike lands and what falls into them,
// fields drawn on the ground, auras under buffed hulls, shield bubbles, lightning, and the
// P-47s of a Thunderbolt Run. Everything reads the sim; nothing here feeds back.

const WHITE = new Color(0xffffff);
const G = 9.81;

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Seconds of the delay each kind spends visibly falling (the rest is just the warning). */
const FALL: Record<StrikeKind, number> = { shell: 0.7, satchel: 0, rocket: 0.55, bomb: 1.2, rod: 0.5, missile: 1.6, gustav: 1.8, meteor: 1.4, spell: 0.4 };
/** Where each kind comes from, as a slant (horizontal metres per metre of fall). */
const SLANT: Record<StrikeKind, number> = { shell: 0.35, satchel: 0, rocket: 1.6, bomb: 0.2, rod: 0, missile: 0.25, gustav: 0.3, meteor: 0.6, spell: 0 };
const HEIGHT: Record<StrikeKind, number> = { shell: 260, satchel: 0, rocket: 120, bomb: 300, rod: 900, missile: 900, gustav: 700, meteor: 700, spell: 60 };

interface Bolt {
  points: { x: number; y: number; z: number }[];
  color: Color;
  straight?: boolean;
  life: number;
  max: number;
}

interface Bubble {
  mesh: Mesh<SphereGeometry, ShaderMaterial>;
  hit: number;
  k: number;
}

/** Where a strike's ordnance starts, fixed when it is called. */
interface StrikeStart {
  x: number;
  y: number;
  z: number;
}

/** P-47s on a strafing pass: from behind the caster, down the strip and away. */
interface Flight {
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  len: number;
  y: number;
  t: number;
  dur: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const fwd = new Vector3();
const NOSE = new Vector3(1, 0, 0);
const tmp = new Color();

export class GroundSkillFx {
  readonly ribbons = new Ribbons(4000, true, false);
  private bolts: Bolt[] = [];
  private bubbles = new Map<Vehicle, Bubble>();
  private bubbleGeo = new SphereGeometry(1, 32, 16);
  private starts = new Map<number, StrikeStart>();
  private flights: Flight[] = [];
  private planes: InstancedMesh;
  private off: (() => void)[] = [];
  private time = 0;
  private shieldSound = 0;
  views: Vector3[] = [];
  locals: Vehicle[] = [];
  onFlash: ((amount: number, color: number) => void) | null = null;
  onShake: ((s: { x: number; z: number; amount: number }) => void) | null = null;

  constructor(
    private game: GroundGame,
    private scene: Scene,
    private alpha: ParticleSystem,
    private add: ParticleSystem,
    private flat: ParticleSystem,
  ) {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
    this.planes = new InstancedMesh(flyerGeometry('plane', 0x6a7a8a), mat, 12);
    this.planes.count = 0;
    this.planes.frustumCulled = false;
    scene.add(this.ribbons.mesh, this.planes);
    const ev = game.events;
    this.off.push(
      ev.on('skill', (e) => this.burst(e.v, e.index)),
      ev.on('strike', (e) => this.called(e.strike)),
      ev.on('strikeHit', (e) => this.landed(e.strike)),
      ev.on('lightning', (e) => {
        const color = new Color(e.color).multiplyScalar(3);
        this.bolts.push({ points: e.points, color, life: e.straight ? 0.25 : 0.4, max: e.straight ? 0.25 : 0.4, straight: e.straight });
        const last = e.points[e.points.length - 1];
        audio.play(e.points.length > 2 ? 'thunder' : 'zap', last.x, last.y, last.z, 100, 0.7);
      }),
      ev.on('shieldHit', (e) => {
        const b = this.bubbles.get(e.v);
        if (b) b.hit = 1;
        if (this.time - this.shieldSound > 0.12) {
          this.shieldSound = this.time;
          audio.play('shield', e.v.x, e.v.y + 2, e.v.z, 100, 0.5);
        }
      }),
      ev.on('respawn', (e) => this.arrive(e.v)),
      ev.on('revive', (e) => this.arrive(e.v)),
    );
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    this.scene.remove(this.ribbons.mesh, this.planes);
    this.ribbons.dispose();
    this.planes.geometry.dispose();
    (this.planes.material as MeshStandardMaterial).dispose();
    for (const b of this.bubbles.values()) {
      this.scene.remove(b.mesh);
      b.mesh.material.dispose();
    }
    this.bubbleGeo.dispose();
  }

  setViewport(heightPx: number): void {
    this.ribbons.material.uniforms.uViewportH.value = heightPx;
  }

  setFog(color: Color, density: number): void {
    this.ribbons.setFog(color, density);
  }

  private friendly(team: number): boolean {
    const me = this.locals[0];
    return !me || me.team === team;
  }

  private nearest(x: number, z: number): number {
    let d = Infinity;
    for (const c of this.views) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    return d === Infinity ? 0 : d;
  }

  private flash(x: number, z: number, amount: number, color: number): void {
    const k = Math.max(0, 1 - this.nearest(x, z) / 3000);
    if (k > 0) this.onFlash?.(amount * (0.3 + 0.7 * k), color);
  }

  private ring(x: number, z: number, radius: number, color: Color, alpha: number, width: number, y?: number): void {
    const n = Math.max(20, Math.min(64, Math.round(radius / 3)));
    const t = this.game.terrain;
    let px = x + radius;
    let pz = z;
    let py = y ?? t.surfaceAt(px, pz) + 0.4;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const nx = x + Math.cos(a) * radius;
      const nz = z + Math.sin(a) * radius;
      const ny = y ?? t.surfaceAt(nx, nz) + 0.4;
      this.ribbons.push(px, py, pz, nx, ny, nz, color, alpha, width, 1.5);
      px = nx;
      pz = nz;
      py = ny;
    }
  }

  // ------------------------------------------------------------------ events

  /** A skill fires: a shock ring and sparks; an ultimate adds a column of light and a flash. */
  private burst(v: Vehicle, index: number): void {
    const st = v.skills[index];
    if (!st) return;
    const ult = !!st.spec.ult;
    if (this.locals.includes(v)) audio.ui(ult ? 'ult' : 'ability');
    const tint = st.spec.accent;
    const L = Math.max(6, v.spec.size.length);
    const { x, z } = v;
    const y = v.y + 0.4;
    this.flat.spawn({ x, y, z, life: 0.8, size: L * 0.5, size1: L * (ult ? 9 : 4.5), color: tint, alpha: 1, kind: PK.Ring, fadeOut: 0.5 });
    if (ult) this.flat.spawn({ x, y, z, life: 2, size: L, size1: L * 14, color: tint, alpha: 0.5, kind: PK.Ring, fadeOut: 0.6 });
    const n = ult ? 40 : 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = rnd(10, 20);
      this.add.spawn({ x: x + Math.cos(a) * L * 0.5, y: y + 1, z: z + Math.sin(a) * L * 0.5, vx: Math.cos(a) * sp, vy: rnd(2, 8), vz: Math.sin(a) * sp, life: 1.1, size: 1.4, size1: 0.3, color: tint, kind: PK.Glow, drag: 1.6 });
    }
    if (ult) {
      for (let i = 0; i < 10; i++) this.add.spawn({ x, y: y + 2 + i * 5, z, vy: 18, life: 0.7, size: L * 0.5, size1: L * 0.1, color: 0xffffff, color1: tint, kind: PK.Glow, fadeIn: 0.1 });
      this.flash(x, z, 0.2, tint);
      this.onShake?.({ x, z, amount: 0.4 });
    }
    if (st.spec.id === 'thunderboltRun') this.thunderbolts(v);
  }

  /** Two pairs of P-47s down the strip toward the crosshair. */
  private thunderbolts(v: Vehicle): void {
    const c = v.control;
    const b = Math.atan2(c.aimX - v.x, -(c.aimZ - v.z));
    const dx = Math.sin(b);
    const dz = -Math.cos(b);
    const start = Math.max(40, Math.min(500, Math.hypot(c.aimX - v.x, c.aimZ - v.z)) - 160);
    // Starting well behind so they are over the strip when the rockets land (2 s on).
    this.flights.push({ x0: v.x + dx * (start - 260), z0: v.z + dz * (start - 260), dx, dz, len: 1200, y: v.y + 70, t: 0, dur: 5 });
    audio.play('missile', v.x, v.y + 60, v.z, 100, 0.6);
  }

  private called(s: Strike): void {
    const k = s.kind;
    if (k === 'satchel') {
      const o = s.owner;
      this.starts.set(s.id, { x: o.x, y: o.y + o.spec.size.height + 0.5, z: o.z });
      return;
    }
    // From up and back along the line from the caster, so the fall reads which way it came.
    const o = s.owner;
    const d = Math.hypot(s.x - o.x, s.z - o.z) || 1;
    const ux = (s.x - o.x) / d;
    const uz = (s.z - o.z) / d;
    const h = HEIGHT[k];
    const back = h * SLANT[k];
    this.starts.set(s.id, { x: s.x - ux * back, y: s.y + h, z: s.z - uz * back });
    if (k === 'gustav') audio.play('charge', s.x, s.y, s.z, s.delay, 0.8);
  }

  private landed(s: Strike): void {
    this.starts.delete(s.id);
    const c = s.skill?.accent ?? 0xffb060;
    const { x, y, z, r } = s;
    const far = this.nearest(x, z);
    switch (s.kind) {
      case 'gustav': {
        // The 800 mm shell: a white flash, a fireball, a ring that runs out over the city.
        audio.play('nuke', x, y, z, 100, 1.2);
        this.flash(x, z, 0.9, 0xfff0d0);
        this.onShake?.({ x, z, amount: 2.2 });
        for (let i = 0; i < 24; i++) this.add.spawn({ x: x + rnd(-1, 1) * r * 0.3, y: y + rnd(2, r * 0.5), z: z + rnd(-1, 1) * r * 0.3, vx: rnd(-6, 6), vy: rnd(6, 18), vz: rnd(-6, 6), life: rnd(1, 2), size: r * 0.35, size1: r * 0.8, color: 0xffffe0, color1: 0xff4000, kind: PK.Glow, drag: 0.8 });
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = rnd(0, r * 0.7);
          this.alpha.spawn({ x: x + Math.cos(a) * rr, y: y + rnd(2, r * 0.8), z: z + Math.sin(a) * rr, vx: Math.cos(a) * rnd(4, 12), vy: rnd(8, 22), vz: Math.sin(a) * rnd(4, 12), life: rnd(10, 16), size: r * 0.3, size1: r * 0.9, color: 0x3a3026, color1: 0x8a7e74, alpha: 0.9, drag: 0.4, fadeIn: 0.03 });
        }
        for (let i = 0; i < 40; i++) this.alpha.spawn({ x, y: y + 2, z, vx: rnd(-1, 1) * 30, vy: rnd(15, 45), vz: rnd(-1, 1) * 30, gravity: G, life: rnd(2, 4), size: 1.5, size1: 2.5, color: 0x5a4a38, alpha: 1, kind: PK.Spray });
        this.flat.spawn({ x, y: y + 0.5, z, life: 1.6, size: r * 0.5, size1: r * 7, color: 0xffe8c0, alpha: 1, kind: PK.Ring, fadeOut: 0.6 });
        this.flat.spawn({ x, y: y + 0.3, z, life: 40, size: r * 0.9, size1: r * 1.1, color: 0x14100c, alpha: 0.7, kind: PK.Foam, fadeIn: 0.01, fadeOut: 0.3 });
        return;
      }
      case 'missile':
      case 'bomb':
      case 'meteor':
      case 'rod': {
        audio.play('explosion', x, y, z, r / 10, 1);
        this.flash(x, z, 0.3, 0xffd0a0);
        this.onShake?.({ x, z, amount: 0.6 + r / 40 });
        if (far > 3500) return;
        for (let i = 0; i < 16; i++) this.add.spawn({ x: x + rnd(-1, 1) * r * 0.3, y: y + rnd(1, r * 0.4), z: z + rnd(-1, 1) * r * 0.3, vx: rnd(-5, 5), vy: rnd(4, 14), vz: rnd(-5, 5), life: rnd(0.6, 1.3), size: r * 0.3, size1: r * 0.6, color: 0xffe0a0, color1: 0xff3000, kind: PK.Glow, drag: 0.8 });
        for (let i = 0; i < 20; i++) this.alpha.spawn({ x: x + rnd(-1, 1) * r * 0.4, y: y + rnd(1, r * 0.4), z: z + rnd(-1, 1) * r * 0.4, vx: rnd(-3, 3), vy: rnd(4, 10), vz: rnd(-3, 3), life: rnd(7, 12), size: r * 0.2, size1: r * 0.7, color: 0x2a2622, color1: 0x6a645c, alpha: 0.85, drag: 0.4 });
        for (let i = 0; i < 24; i++) this.alpha.spawn({ x, y: y + 1, z, vx: rnd(-1, 1) * 18, vy: rnd(10, 28), vz: rnd(-1, 1) * 18, gravity: G, life: rnd(1.5, 3), size: 1, size1: 1.8, color: 0x5a4a38, alpha: 1, kind: PK.Spray });
        this.flat.spawn({ x, y: y + 0.4, z, life: 0.9, size: r * 0.3, size1: r * 3.5, color: 0xfff0d8, alpha: 0.8, kind: PK.Ring, fadeOut: 0.5 });
        return;
      }
      default: {
        // Shells, rockets, satchels and spells: a blast sized to the radius.
        audio.play('explosion', x, y, z, 0.3 + r / 25, 0.9);
        this.onShake?.({ x, z, amount: 0.15 + r / 60 });
        if (far > 3000) return;
        const k = r / 8;
        this.add.spawn({ x, y: y + 1, z, life: 0.2, size: 3 * k, size1: 6 * k, color: 0xfff0b0, color1: 0xff5010, kind: PK.Glow });
        for (let i = 0; i < 6; i++) this.add.spawn({ x: x + rnd(-1, 1) * r * 0.25, y: y + rnd(0.5, 3) * k, z: z + rnd(-1, 1) * r * 0.25, vx: rnd(-2, 2), vy: rnd(2, 6), vz: rnd(-2, 2), life: rnd(0.4, 0.8), size: 2.5 * k, size1: 5 * k, color: 0xffd090, color1: 0x902000, kind: PK.Glow, drag: 1.2 });
        for (let i = 0; i < 12; i++) this.alpha.spawn({ x, y: y + 0.5, z, vx: rnd(-1, 1) * 7 * k, vy: rnd(6, 16) * Math.sqrt(k), vz: rnd(-1, 1) * 7 * k, gravity: G, life: rnd(1, 2), size: 0.6 * k, size1: 1.2 * k, color: 0x6a5a48, alpha: 0.95, kind: PK.Spray });
        for (let i = 0; i < 5; i++) this.alpha.spawn({ x: x + rnd(-1, 1) * r * 0.3, y: y + rnd(0.5, 2) * k, z: z + rnd(-1, 1) * r * 0.3, vx: rnd(-1, 1), vy: rnd(1, 3), vz: rnd(-1, 1), life: rnd(4, 7), size: 2 * k, size1: 6 * k, color: 0x3a3430, color1: 0x7a726a, alpha: 0.75, drag: 0.5 });
        this.flat.spawn({ x, y: y + 0.3, z, life: 0.5, size: r * 0.2, size1: r * 2.2, color: tmp.setHex(c).getHex(), alpha: 0.6, kind: PK.Ring, fadeOut: 0.5 });
      }
    }
  }

  /** A fresh or revived hull: a column of light and a ring in its side's colour. */
  private arrive(v: Vehicle): void {
    const c = this.friendly(v.team) ? 0x5de0ff : ENEMY.getHex();
    const L = Math.max(6, v.spec.size.length);
    audio.play('zap', v.x, v.y + 2, v.z, 100, 0.6);
    this.flat.spawn({ x: v.x, y: v.y + 0.3, z: v.z, life: 1.1, size: L * 0.3, size1: L * 4, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.5 });
    for (let i = 0; i < 8; i++) this.add.spawn({ x: v.x, y: v.y + 2 + i * 4, z: v.z, vy: 16, life: 0.7, size: L * 0.35, size1: L * 0.06, color: 0xffffff, color1: c, kind: PK.Glow, fadeIn: 0.1 });
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const g = this.game;
    this.time += dt;
    const r = this.ribbons;
    r.begin();
    this.updateBolts(dt);
    for (const s of g.strikes.list) this.strike(s, dt);
    for (const f of g.fields.list) this.field(f, dt);
    this.auras();
    this.shields(dt);
    this.updateFlights(dt);
    r.end();
    if (this.starts.size > 400) this.starts.clear();
  }

  /** The warning circle, tightening as it comes, and the ordnance on its way down. */
  private strike(s: Strike, dt: number): void {
    if (s.done) return;
    const k = Math.min(1, s.t / Math.max(0.01, s.delay));
    const own = this.friendly(s.owner.team);
    const col = (own ? tmp.setHex(s.skill?.accent ?? 0xffc060) : tmp.copy(ENEMY)).multiplyScalar(1.8);
    const R = s.r;
    if (this.nearest(s.x, s.z) > 3500 + R) return;
    this.ring(s.x, s.z, R, col, 0.35 + 0.5 * k, s.kind === 'gustav' ? 2.5 : 1);
    this.ring(s.x, s.z, Math.max(0.5, R * (1 - k)), col, 0.25 + 0.6 * k, s.kind === 'gustav' ? 2 : 0.6);
    if (s.kind === 'gustav') {
      // A cross hair over the block that is about to go.
      for (const [ax, az] of [[1, 0], [0, 1]]) seg(this.ribbons, s.x - ax * R, s.y + 0.6, s.z - az * R, s.x + ax * R, s.y + 0.6, s.z + az * R, col, 0.6 * k, 1.5, 1.5);
    }
    const st = this.starts.get(s.id);
    if (!st) return;
    const left = s.delay - s.t;
    if (s.kind === 'satchel') {
      // Lobbed in an arc from where it was thrown.
      const u = k;
      const x = st.x + (s.x - st.x) * u;
      const z = st.z + (s.z - st.z) * u;
      const y = st.y + (s.y - st.y) * u + Math.sin(u * Math.PI) * Math.max(6, Math.hypot(s.x - st.x, s.z - st.z) * 0.3);
      this.add.spawn({ x, y, z, life: 0.05, size: 0.7, color: 0xffd080, color1: 0xff6020, kind: PK.Glow });
      if (Math.random() < dt * 20) this.alpha.spawn({ x, y, z, life: 0.8, size: 0.3, size1: 1, color: 0x8a8278, alpha: 0.5 });
      return;
    }
    const fall = FALL[s.kind];
    if (left > fall) return;
    const u = 1 - left / fall;
    const x = st.x + (s.x - st.x) * u;
    const y = st.y + (s.y - st.y) * u;
    const z = st.z + (s.z - st.z) * u;
    const ex = (s.x - st.x) / (HEIGHT[s.kind] || 1);
    const ey = (s.y - st.y) / (HEIGHT[s.kind] || 1);
    const ez = (s.z - st.z) / (HEIGHT[s.kind] || 1);
    // A streak trailing back up the path, and a glow at its head.
    const trail = s.kind === 'gustav' ? 60 : s.kind === 'missile' ? 80 : s.kind === 'rocket' ? 25 : 30;
    const w = s.kind === 'gustav' ? 1.6 : s.kind === 'missile' ? 0.9 : 0.35;
    seg(this.ribbons, x - ex * trail, y - ey * trail, z - ez * trail, x, y, z, s.kind === 'missile' || s.kind === 'rocket' ? tmp.setHex(0xffc080).multiplyScalar(1.5) : WHITE, 0.6, w, 1.5);
    this.add.spawn({ x, y, z, life: 0.06, size: w * 4, color: 0xffffff, color1: 0xffa040, kind: PK.Glow });
    if ((s.kind === 'missile' || s.kind === 'rocket') && Math.random() < dt * 40) {
      this.alpha.spawn({ x, y, z, vx: rnd(-1, 1), vy: rnd(-1, 1), vz: rnd(-1, 1), life: rnd(2, 4), size: w * 2, size1: w * 8, color: 0xd8d4cc, alpha: 0.55, drag: 0.6 });
    }
  }

  /** Field edges and what lives inside them: flames, healing motes, the treads' dust. */
  private field(f: Field, dt: number): void {
    const k = Math.min(1, f.age / 0.3) * Math.max(0, Math.min(1, f.life - f.age));
    if (k <= 0 || this.nearest(f.x, f.z) > 2500 + f.r) return;
    const own = this.friendly(f.owner.team);
    const base = tmp.setHex(f.color).multiplyScalar(1.8);
    const edge = own ? base.clone() : ENEMY.clone().multiplyScalar(1.8);
    const heal = (f.allyHeal ?? 0) > 0;
    this.ring(f.x, f.z, f.r, edge, 0.6 * k, 0.8);
    if (!f.follow) this.ring(f.x, f.z, f.r * 0.92, base, 0.25 * k, 0.4);
    const t = this.game.terrain;
    const area = f.r * f.r;
    if (f.fire) {
      const n = Math.min(10, Math.floor(dt * area * 0.06 + Math.random()));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * f.r;
        const x = f.x + Math.cos(a) * rr;
        const z = f.z + Math.sin(a) * rr;
        const y = t.surfaceAt(x, z);
        this.add.spawn({ x, y: y + 0.3, z, vx: rnd(-0.3, 0.3), vy: rnd(1.5, 3.5), vz: rnd(-0.3, 0.3), life: rnd(0.5, 1), size: rnd(1, 2.2), size1: 0.4, color: 0xffd070, color1: 0xff2a00, kind: PK.Glow });
        if (Math.random() < 0.25) this.alpha.spawn({ x, y: y + 1.5, z, vx: 0.8, vy: rnd(1.5, 3), vz: 0.3, life: rnd(3, 5), size: 1.5, size1: 5, color: 0x1e1c1a, color1: 0x55524e, alpha: 0.55, drag: 0.4 });
      }
    } else if (heal) {
      const n = Math.min(6, Math.floor(dt * area * 0.02 + Math.random()));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * f.r;
        const x = f.x + Math.cos(a) * rr;
        const z = f.z + Math.sin(a) * rr;
        this.add.spawn({ x, y: t.surfaceAt(x, z) + 0.3, z, vy: rnd(1, 2.5), life: rnd(0.8, 1.4), size: 0.5, size1: 0.1, color: 0xffffff, color1: f.color, kind: PK.Glow, fadeIn: 0.2 });
      }
    } else if (f.follow && Math.random() < dt * 20) {
      // A damaging zone riding with its owner: debris churned up at the rim.
      const a = Math.random() * Math.PI * 2;
      const x = f.x + Math.cos(a) * f.r;
      const z = f.z + Math.sin(a) * f.r;
      this.alpha.spawn({ x, y: t.surfaceAt(x, z) + 0.5, z, vx: Math.cos(a) * 3, vy: rnd(1, 3), vz: Math.sin(a) * 3, life: rnd(1, 2), size: 1.5, size1: 4, color: 0x8a7a62, alpha: 0.5, drag: 1 });
    }
  }

  /** A ring under every hull with a buff running, in the skill's colour; marks over the marked. */
  private auras(): void {
    const g = this.game;
    for (const v of g.vehicles) {
      if (!v.alive || v.withdrawn) continue;
      if (this.nearest(v.renderX, v.renderZ) > 1200) continue;
      const L = Math.max(5, v.spec.size.length) * 0.75;
      let n = 0;
      for (const st of v.skills) {
        if (!st.active || st.spec.duration <= 0) continue;
        const pulse = 0.7 + 0.3 * Math.sin(this.time * 6 + n);
        this.ring(v.renderX, v.renderZ, L + n * 1.2, tmp.setHex(st.spec.accent).multiplyScalar(1.8), 0.55 * pulse, 0.35);
        n++;
      }
      if (v.mods.marked > 1) {
        // A red diamond hung over a marked enemy.
        const y = v.renderY + v.spec.size.height + 4 + Math.sin(this.time * 4) * 0.3;
        const c = tmp.setHex(0xff5a3a).multiplyScalar(2);
        const s = 1.2;
        const pts = [[0, s], [s, 0], [0, -s], [-s, 0]];
        for (let i = 0; i < 4; i++) {
          const [a, b] = pts[i];
          const [c2, d2] = pts[(i + 1) % 4];
          seg(this.ribbons, v.renderX + a, y + b, v.renderZ, v.renderX + c2, y + d2, v.renderZ, c, 0.9, 0.18, 1.5);
        }
      }
    }
  }

  private shields(dt: number): void {
    for (const v of this.game.vehicles) {
      const on = v.alive && (v.shield > 0 || v.spawnShield > 0);
      let b = this.bubbles.get(v);
      if (!b) {
        if (!on) continue;
        const accent = v.skills.find((k) => k.spec.icon === 'shield')?.spec.accent ?? 0x7fe0ff;
        const material = new ShaderMaterial({
          vertexShader: SHIELD_VERT,
          fragmentShader: SHIELD_FRAG,
          uniforms: { uColor: { value: new Color(accent) }, uAlpha: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        });
        b = { mesh: new Mesh(this.bubbleGeo, material), hit: 0, k: 0 };
        b.mesh.renderOrder = 6;
        this.scene.add(b.mesh);
        this.bubbles.set(v, b);
      }
      b.k = Math.max(0, Math.min(1, b.k + (on ? dt * 4 : -dt * 3)));
      b.hit = Math.max(0, b.hit - dt * 3);
      b.mesh.visible = b.k > 0.01;
      if (!b.mesh.visible) {
        if (!v.alive && v.withdrawn) {
          this.scene.remove(b.mesh);
          b.mesh.material.dispose();
          this.bubbles.delete(v);
        }
        continue;
      }
      const s = v.spec.size;
      b.mesh.position.set(v.renderX, v.renderY + s.height * 0.6, v.renderZ);
      b.mesh.rotation.set(0, -v.renderHeading, 0);
      b.mesh.scale.set(s.width * 0.85, s.height * 1.1 + 0.8, s.length * 0.7);
      const u = b.mesh.material.uniforms;
      // The spawn shield is fainter than a skill's.
      u.uAlpha.value = b.k * (v.shield > 0 ? 0.9 : 0.4);
      u.uHit.value = b.hit;
      u.uTime.value = this.time;
    }
  }

  /** Jagged bolts, re-randomised every frame so they crackle. */
  private updateBolts(dt: number): void {
    for (const b of this.bolts) {
      b.life -= dt;
      const k = Math.max(0, b.life / b.max);
      for (let i = 0; i + 1 < b.points.length; i++) {
        const p0 = b.points[i];
        const p1 = b.points[i + 1];
        if (b.straight) {
          seg(this.ribbons, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, b.color, k, 0.5, 2);
          continue;
        }
        const segs = 6;
        let px = p0.x;
        let py = p0.y;
        let pz = p0.z;
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const j = s === segs ? 0 : len * 0.06;
          const nx = p0.x + (p1.x - p0.x) * t + rnd(-j, j);
          const ny = p0.y + (p1.y - p0.y) * t + rnd(-j, j);
          const nz = p0.z + (p1.z - p0.z) * t + rnd(-j, j);
          seg(this.ribbons, px, py, pz, nx, ny, nz, b.color, k, 0.4, 2);
          px = nx;
          py = ny;
          pz = nz;
        }
      }
    }
    if (this.bolts.some((b) => b.life <= 0)) this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  private updateFlights(dt: number): void {
    let n = 0;
    for (const f of this.flights) {
      f.t += dt;
      const u = f.t / f.dur;
      for (let i = 0; i < 4 && n < this.planes.instanceMatrix.count; i++) {
        const lat = (i - 1.5) * 14;
        const back = Math.abs(i - 1.5) * 12;
        const along = u * f.len - back;
        const x = f.x0 + f.dx * along - f.dz * lat;
        const z = f.z0 + f.dz * along + f.dx * lat;
        // Diving onto the strip, pulling up past it.
        const y = f.y - Math.sin(Math.min(1, u * 1.6) * Math.PI) * 35;
        fwd.set(f.dx, 0, f.dz);
        q.setFromUnitVectors(NOSE, fwd);
        pos.set(x, y, z);
        scl.setScalar(1);
        m4.compose(pos, q, scl);
        this.planes.setMatrixAt(n++, m4);
        if (Math.random() < dt * 8) this.alpha.spawn({ x: x - f.dx * 4, y, z: z - f.dz * 4, life: 1.2, size: 0.6, size1: 2.5, color: 0xd8d8d8, alpha: 0.35, drag: 0.5 });
      }
    }
    this.planes.count = n;
    this.planes.instanceMatrix.needsUpdate = true;
    if (this.flights.some((f) => f.t > f.dur)) this.flights = this.flights.filter((f) => f.t <= f.dur);
  }

  /** Hide a bubble in a viewport that hides its vehicle (the scoped player's own). */
  visible(v: Vehicle, on: boolean): void {
    const b = this.bubbles.get(v);
    if (b) b.mesh.visible = on && b.k > 0.01;
  }
}

/** Push one ribbon segment. */
function seg(rb: Ribbons, ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Color, alpha: number, width: number, minPx: number): void {
  rb.push(ax, ay, az, bx, by, bz, color, alpha, width, minPx);
}
