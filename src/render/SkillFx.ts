import {fleetCue} from '../fx/FleetAudio';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
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
import type { Game, Wall } from '../core/Game';
import { DEG, forwardX, forwardZ } from '../core/math';
import { PICKUP_COLOR } from '../core/Pickups';
import { audio } from '../fx/Audio';
import { PK, type ParticleSystem } from '../fx/Particles';
import { eraOf } from '../data/factions';
import { SHIP_BY_ID } from '../data/ships';
import type { Ship } from '../ships/Ship';
import type { SkillState } from '../skills/types';
import { drumPos, swordfishDrop } from '../skills/historic/titans';
import type { Beam } from '../weapons/BeamSystem';
import type { Field, Tripwire } from '../weapons/FieldSystem';
import type { Strike } from '../weapons/StrikeSystem';
import { waveHeight } from '../world/Waves';
import { Ribbons } from './Projectiles';
import { ENEMY_COLOR as ENEMY } from '../ui/palette';

// Skill visuals: energy beams, lightning, strike telegraphs and impacts (orbital rods, rockets,
// nukes, mines, shock rings), shield bubbles, blink trails, the crates' beacon pillars, and the
// titans' set pieces (ice walls, thunder drums, bombers, blizzards, the maelstrom).
// Everything reads the simulation; nothing here feeds back into it.

const WHITE = new Color(0xffffff);
/** The orbital pillar and rod streaks start this high. */
const SKY = 2400;

export const SHIELD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vP = position;
  gl_Position = projectionMatrix * mv;
}`;

// Fresnel bubble with a hexagon lattice that brightens where (and when) it is struck.
export const SHIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uHit;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float hexEdge(vec2 p) {
  p.x *= 1.1547;
  p.y += mod(floor(p.x), 2.0) * 0.5;
  p = abs(fract(p) - 0.5);
  return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
}
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
  vec2 uv = vec2(atan(vP.z, vP.x) * 4.0, vP.y * 7.0 - uTime * 0.4);
  float edge = 1.0 - smoothstep(0.0, 0.1, hexEdge(uv));
  float a = (0.05 + f * 0.85 + edge * (0.25 + uHit * 1.2)) * uAlpha;
  gl_FragColor = vec4(uColor * a * (1.0 + uHit * 1.5), 1.0);
}`;

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

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const sc = new Vector3();
const UP = new Vector3(0, 1, 0);
const tmp = new Color();
/** Ice shards per metre of Calving Wall, and the most drawn at once. */
const SHARD_STEP = 16;
const MAX_SHARDS = 400;

export class SkillFx {
  /** Additive ribbons: beams, bolts, rings, streaks and beacons. */
  readonly ribbons = new Ribbons(5000, true, false);
  readonly crates: InstancedMesh;
  readonly shards: InstancedMesh;
  /** Per wall: a random size, lean and offset for each shard, fixed when the wall rises. */
  private shardRolls = new WeakMap<Wall, Float32Array>();
  private bolts: Bolt[] = [];
  private bubbles = new Map<Ship, Bubble>();
  private bubbleGeo = new SphereGeometry(1, 40, 20);
  /** Beams already announced (charge and hum sounds play once). */
  private heard = new Set<number>();
  private fired = new Set<number>();
  private shieldSound = 0;
  private off: (() => void)[] = [];
  private time = 0;
  /** Spell circles drawn under fantasy casters for a moment after each cast. */
  private casts: { ship: Ship; color: Color; age: number; spin: number }[] = [];
  /** Camera positions this frame, for culling far work. */
  views: Vector3[] = [];
  /** A bright flash for the post chain (nukes, rods), 0..1. */
  onFlash: ((amount: number, color: number) => void) | null = null;
  /** Local human ships (team colouring of telegraphs, sound cues). */
  locals: Ship[] = [];

  constructor(
    private game: Game,
    private scene: Scene,
    private alpha: ParticleSystem,
    private add: ParticleSystem,
    private flat: ParticleSystem,
  ) {
    const mat = new MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.25 });
    this.crates = new InstancedMesh(new BoxGeometry(16, 11, 16), mat, 16);
    this.crates.count = 0;
    this.crates.frustumCulled = false;
    const ice = new MeshStandardMaterial({ color: 0xd8f4ff, roughness: 0.12, metalness: 0.05, emissive: 0x4fa8cc, emissiveIntensity: 0.35, transparent: true, opacity: 0.92, flatShading: true });
    this.shards = new InstancedMesh(new ConeGeometry(1, 1, 5), ice, MAX_SHARDS);
    this.shards.count = 0;
    this.shards.frustumCulled = false;
    scene.add(this.ribbons.mesh, this.crates, this.shards);

    const ev = game.events;
    this.off.push(
      ev.on('lightning', (e) => {
        const color = new Color(e.color).multiplyScalar(3.2);
        this.bolts.push({ points: e.points, color, life: e.straight ? 0.25 : 0.4, max: e.straight ? 0.25 : 0.4, straight: e.straight });
        const last = e.points[e.points.length - 1];
        audio.play(e.points.length > 2 ? 'thunder' : 'zap', last.x, last.y, last.z, 100, e.points.length > 2 ? 0.9 : e.straight ? 0.35 : 0.6);
        for (const p of e.points.slice(1)) {
          this.add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.35, size: 30, size1: 70, color: 0xffffff, color1: e.color, kind: PK.Glow });
          for (let i = 0; i < 10; i++) this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: rnd(-40, 40), vy: rnd(5, 40), vz: rnd(-40, 40), gravity: 9.81, life: rnd(0.3, 0.7), size: 2, color: 0xffffff, color1: e.color, kind: PK.Glow });
        }
      }),
      ev.on('strike', (e) => this.strikeLaunched(e.strike)),
      ev.on('strikeHit', (e) => this.strikeHit(e.strike)),
      ev.on('blink', (e) => this.blink(e.ship, e.fromX, e.fromZ, e.fromHeading, e.dodge)),
      ev.on('skill', (e) => {
        if (e.ship.spec.id==='stepper') return;
        if (eraOf(e.ship.spec) !== 'fantasy') return;
        const st = e.ship.skills[e.index];
        if (!st) return;
        this.casts.push({ ship: e.ship, color: new Color(st.spec.accent).multiplyScalar(2.4), age: 0, spin: Math.random() * 6 });
      }),
      ev.on('respawn', (e) => this.spawnFlash(e.ship)),
      ev.on('shift', (e) => {
        if (!e.quiet) this.shiftFlash(e.ship, e.on);
      }),
      ev.on('shieldHit', (e) => {
        const b = this.bubbles.get(e.ship);
        if (b) b.hit = 1;
        if (this.time - this.shieldSound > 0.12) {
          this.shieldSound = this.time;
          audio.play('shield', e.ship.pos.x, 10, e.ship.pos.z, 100, 0.5);
        }
      }),
      ev.on('pickupTaken', (e) => {
        const p = e.pickup;
        const c = PICKUP_COLOR[p.kind];
        this.flat.spawn({ x: p.x, y: 1, z: p.z, life: 0.8, size: 20, size1: 260, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.5 });
        for (let i = 0; i < 30; i++) this.add.spawn({ x: p.x, y: 8, z: p.z, vx: rnd(-30, 30), vy: rnd(20, 70), vz: rnd(-30, 30), gravity: 9.81, life: rnd(0.6, 1.2), size: 4, size1: 1, color: c, kind: PK.Glow });
      }),
    );
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    this.scene.remove(this.ribbons.mesh, this.crates, this.shards);
    this.ribbons.dispose();
    this.crates.geometry.dispose();
    (this.crates.material as MeshStandardMaterial).dispose();
    this.shards.geometry.dispose();
    (this.shards.material as MeshStandardMaterial).dispose();
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

  /** Is this strike's owner on the watching side? Enemy telegraphs read red. */
  private friendly(s: { team: number }): boolean {
    const me = this.locals[0];
    return !me || me.team === s.team;
  }

  /** Flash the screen, fading with the distance from the nearest camera. */
  private flash(x: number, z: number, amount: number, color: number): void {
    let d = Infinity;
    for (const c of this.views) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    const k = d === Infinity ? 1 : Math.max(0, 1 - d / 9000);
    if (k > 0) this.onFlash?.(amount * (0.3 + 0.7 * k), color);
  }

  // ------------------------------------------------------------------ events

  private strikeLaunched(s: Strike): void {
    if (s.kind === 'shock') {
      const c = s.skill?.accent ?? 0x6ff0ff;
      audio.play('thunder', s.x, 5, s.z, 100, 1);
      this.flat.spawn({ x: s.x, y: 1, z: s.z, life: 0.6, size: 40, size1: 400, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.5 });
    }
  }

  private strikeHit(s: Strike): void {
    const c = s.skill?.accent ?? 0xffb060;
    const { x, z } = s;
    if (s.kind === 'nuke') {
      this.nuke(x, z, s.radius);
      return;
    }
    if (s.kind === 'rod') {
      // Kinetic impact: white column, a flat shock ring and a crater of spray.
      this.flash(x, z, 0.35, 0xfff0d0);
      for (let i = 0; i < 12; i++) this.add.spawn({ x, y: i * 30, z, vy: 60, life: 0.6, size: 60, size1: 20, color: 0xffffff, color1: c, kind: PK.Glow, fadeIn: 0.05 });
      this.flat.spawn({ x, y: 1, z, life: 1.2, size: 20, size1: s.radius * 3.2, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.4 });
      this.waterColumn(x, z, s.radius * 0.6, 90);
      return;
    }
    if (s.look === 'meteor' || s.look === 'fireball') {
      // Burning rock or a ball of flame: a fire burst, embers, steam.
      this.flash(x, z, 0.25, 0xffc080);
      for (let i = 0; i < 16; i++) this.add.spawn({ x: x + rnd(-1, 1) * s.radius * 0.3, y: rnd(2, s.radius * 0.4), z: z + rnd(-1, 1) * s.radius * 0.3, vx: rnd(-25, 25), vy: rnd(10, 50), vz: rnd(-25, 25), gravity: 4, life: rnd(0.6, 1.4), size: s.radius * 0.4, size1: s.radius * 0.8, color: 0xffe0a0, color1: 0xff3000, kind: PK.Glow, drag: 0.6 });
      for (let i = 0; i < 20; i++) this.add.spawn({ x, y: 4, z, vx: rnd(-60, 60), vy: rnd(30, 90), vz: rnd(-60, 60), gravity: 9.81, life: rnd(1, 2), size: 3, size1: 1, color: 0xffd060, color1: 0xff4000, kind: PK.Glow });
      this.waterColumn(x, z, s.radius * 0.5, s.look === 'meteor' ? 80 : 40);
    } else if (s.look === 'anvil') {
      this.flash(x, z, 0.2, 0xfff0d0);
      for (let i = 0; i < 24; i++) this.add.spawn({ x, y: 6, z, vx: rnd(-50, 50), vy: rnd(20, 70), vz: rnd(-50, 50), gravity: 9.81, life: rnd(0.6, 1.2), size: 3, size1: 1, color: 0xffffff, color1: c, kind: PK.Glow });
      this.waterColumn(x, z, s.radius * 0.6, 60);
    } else if (s.look === 'rune') {
      for (let i = 0; i < 10; i++) this.add.spawn({ x, y: i * 12, z, vy: 40, life: 0.6, size: s.radius * 0.6, size1: s.radius * 0.2, color: 0xffffff, color1: c, kind: PK.Glow, fadeIn: 0.05 });
      this.waterColumn(x, z, s.radius * 0.4, 35);
    } else if (s.look === 'quake') {
      for (let i = 0; i < 18; i++) this.alpha.spawn({ x: x + rnd(-1, 1) * s.radius * 0.5, y: 2, z: z + rnd(-1, 1) * s.radius * 0.5, vx: rnd(-6, 6), vy: rnd(20, 50), vz: rnd(-6, 6), gravity: 9.81, life: rnd(2, 3.5), size: 22, size1: 60, color: 0x8a7a62, color1: 0x5a5046, alpha: 0.8, drag: 0.3 });
      this.waterColumn(x, z, s.radius * 0.6, 50);
    } else if (s.kind === 'mine' || s.kind === 'mortar') this.waterColumn(x, z, s.radius * 0.5, 45);
    this.flat.spawn({ x, y: 1, z, life: 0.7, size: 10, size1: s.radius * 2.4, color: c, alpha: 0.8, kind: PK.Ring, fadeOut: 0.4 });
  }

  /** Fireball, rising stem, mushroom cap, a sea-wide shock ring and a flash. */
  private nuke(x: number, z: number, r: number): void {
    audio.play('nuke', x, 20, z, 100, 1.4);
    this.flash(x, z, 1, 0xfff4d0);
    for (let i = 0; i < 26; i++) {
      this.add.spawn({ x: x + rnd(-1, 1) * r * 0.4, y: rnd(5, r * 0.6), z: z + rnd(-1, 1) * r * 0.4, vx: rnd(-10, 10), vy: rnd(10, 30), vz: rnd(-10, 10), life: rnd(1.2, 2.4), size: r * 0.5, size1: r * 1.3, color: 0xffffe0, color1: 0xff4000, kind: PK.Glow, drag: 0.8 });
    }
    for (let i = 0; i < 40; i++) {
      // The stem, then the cap rolling outward at the top.
      const stem = i < 16;
      const a = Math.random() * Math.PI * 2;
      const rr = stem ? rnd(0, r * 0.25) : rnd(r * 0.2, r * 0.9);
      this.alpha.spawn({
        x: x + Math.cos(a) * rr,
        y: stem ? rnd(10, r * 2.5) : r * 3 + rnd(-r * 0.3, r * 0.4),
        z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * (stem ? 2 : rnd(8, 22)),
        vy: stem ? rnd(25, 45) : rnd(18, 32),
        vz: Math.sin(a) * (stem ? 2 : rnd(8, 22)),
        life: rnd(12, 18),
        size: r * 0.5,
        size1: r * (stem ? 1.1 : 1.8),
        color: 0x5a3a2a,
        color1: 0x8a7e74,
        alpha: 0.9,
        drag: 0.35,
        fadeIn: 0.03,
      });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.add.spawn({ x: x + Math.cos(a) * r * 0.2, y: r * 3, z: z + Math.sin(a) * r * 0.2, vx: Math.cos(a) * 15, vy: 30, vz: Math.sin(a) * 15, life: 2.5, size: r * 0.6, size1: r * 1.2, color: 0xffa040, color1: 0x401000, kind: PK.Glow, drag: 0.5 });
    }
    this.flat.spawn({ x, y: 1.2, z, life: 2.2, size: r, size1: r * 14, color: 0xffe8c0, alpha: 1, kind: PK.Ring, fadeOut: 0.6 });
    this.flat.spawn({ x, y: 1, z, life: 5, size: r * 2, size1: r * 7, color: 0xff8040, alpha: 0.5, kind: PK.Ring, fadeOut: 0.7 });
    this.waterColumn(x, z, r, 160);
  }

  private waterColumn(x: number, z: number, r: number, height: number): void {
    const y = waveHeight(x, z, this.game.time);
    const v0 = Math.sqrt(2 * 9.81 * height);
    const n = Math.min(70, 20 + r * 0.3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      const k = rnd(0.4, 1);
      this.alpha.spawn({ x: x + Math.cos(a) * rr, y, z: z + Math.sin(a) * rr, vx: Math.cos(a) * rnd(2, 12), vy: v0 * k, vz: Math.sin(a) * rnd(2, 12), gravity: 9.81, life: (2 * v0 * k) / 9.81, size: 10, size1: 30, color: 0xf6f9fa, alpha: 0.9, kind: PK.Spray, drag: 0.2, fadeOut: 0.75 });
    }
    this.flat.spawn({ x, y: y + 0.4, z, life: 18, size: r, size1: r * 2, color: 0xe8eef0, alpha: 0.6, kind: PK.Foam });
  }

  private blink(s: Ship, fx: number, fz: number, _fromHeading = s.heading, dodge = false): void {
    if(s.spec.id==='stepper') return;
    const c = s.skills.find((k) => k.active)?.spec.accent ?? 0xb48cff;
    const L = s.spec.length;
    if(!dodge) audio.play('zap', s.pos.x, 10, s.pos.z, 100, 1);
    for (const [x, z, out] of [
      [fx, fz, false],
      [s.pos.x, s.pos.z, true],
    ] as const) {
      this.flat.spawn({ x, y: 1, z, life: 0.8, size: out ? L * 2 : L * 0.4, size1: out ? L * 0.3 : L * 2.4, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.4 });
      this.add.spawn({ x, y: 15, z, life: 0.4, size: L * 0.5, size1: L * 0.1, color: 0xffffff, color1: c, kind: PK.Glow });
    }
    // Afterimage streak of sparks along the jump.
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      this.add.spawn({ x: fx + (s.pos.x - fx) * t, y: rnd(4, 20), z: fz + (s.pos.z - fz) * t, vy: rnd(0, 8), life: rnd(0.4, 0.9), size: 9, size1: 1, color: c, kind: PK.Glow });
    }
  }

  /** A fresh hull arrives: a column of light and a ring on the water in its side's colour. */
  private spawnFlash(s: Ship): void {
    const L = s.spec.length;
    const c = this.friendly(s) ? 0x5de0ff : ENEMY.getHex();
    const { x, z } = s.pos;
    audio.play('zap', x, 10, z, 100, 0.8);
    this.flat.spawn({ x, y: 1, z, life: 1.2, size: L * 0.3, size1: L * 3, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.5 });
    for (let i = 0; i < 12; i++) this.add.spawn({ x, y: 10 + i * 25, z, vy: 60, life: 0.8, size: L * 0.3, size1: L * 0.05, color: 0xffffff, color1: c, kind: PK.Glow, fadeIn: 0.1 });
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      this.add.spawn({ x: x + Math.cos(a) * L * 0.5, y: 6, z: z + Math.sin(a) * L * 0.5, vx: Math.cos(a) * 50, vy: rnd(10, 30), vz: Math.sin(a) * 50, life: 1.1, size: 7, size1: 1, color: c, kind: PK.Glow, drag: 1.3 });
    }
  }

  /**
   * Titan Shift: a pillar of light in the form's colour, a shock ring and a flash as the hull
   * breaks out; the revert plays the same, smaller and dimmer.
   */
  private shiftFlash(s: Ship, on: boolean): void {
    const form = on ? s.spec : SHIP_BY_ID[s.base.shift?.form ?? ''];
    const c = form?.model.formAura ?? s.spec.skills.find((k) => k.ult)?.accent ?? 0xffd36b;
    const L = s.spec.length;
    const k = on ? 1 : 0.45;
    const { x, z } = s.pos;
    if (this.locals.includes(s)) audio.ui(on ? 'shift' : 'unshift');
    audio.play(on ? 'nuke' : 'thunder', x, 10, z, 100, on ? 0.7 : 0.5);
    if (on) this.flash(x, z, 0.55, c);
    this.flat.spawn({ x, y: 1, z, life: 1.4, size: L * 0.4, size1: L * 5 * k, color: c, alpha: 1, kind: PK.Ring, fadeOut: 0.6 });
    this.flat.spawn({ x, y: 1.5, z, life: 0.9, size: L * 0.2, size1: L * 3 * k, color: 0xffffff, alpha: 0.8, kind: PK.Ring, fadeOut: 0.5 });
    const rise = on ? 28 : 12;
    for (let i = 0; i < rise; i++) this.add.spawn({ x, y: 10 + i * 40, z, vy: on ? 120 : 50, life: on ? 1.6 : 0.9, size: L * 0.5 * k, size1: L * 0.08, color: 0xffffff, color1: c, kind: PK.Glow, fadeIn: 0.1 });
    const sparks = on ? 80 : 30;
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2;
      const v = rnd(60, 160) * k;
      this.add.spawn({ x: x + Math.cos(a) * L * 0.4, y: 8, z: z + Math.sin(a) * L * 0.4, vx: Math.cos(a) * v, vy: rnd(20, 90) * k, vz: Math.sin(a) * v, gravity: 9.81, life: rnd(0.9, 1.6), size: 9, size1: 1, color: c, kind: PK.Glow, drag: 1.1 });
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const g = this.game;
    this.time += dt;
    const r = this.ribbons;
    r.begin();
    for (const b of g.beams.beams) if (b.alive) this.beam(b, dt);
    this.updateBolts(dt);
    for (const s of g.strikes.strikes) if (s.alive) this.strike(s, dt);
    this.pickups();
    this.shields(dt);
    this.walls(dt);
    for (const f of g.fields.fields) this.field(f, dt);
    for (const w of g.fields.wires) this.wire(w);
    this.castCircles(dt);
    for (const s of g.ships) {
      if (!s.alive) continue;
      for (const st of s.skills) if (st.active) this.titanSkill(s, st, dt);
    }
    r.end();
    const live=new Set(g.beams.beams.filter(b=>b.alive).map(b=>b.id));
    for(const id of this.heard)if(!live.has(id))this.heard.delete(id);
    for(const id of this.fired)if(!live.has(id))this.fired.delete(id);
  }

  private beam(b: Beam, dt: number): void {
    const c = tmp.setHex(b.skill.accent);
    const r = this.ribbons;
    const charging = b.age < b.charge;
    if (!this.heard.has(b.id)) {
      this.heard.add(b.id);
      if (b.charge > 0) audio.play('charge', b.x0, b.y0, b.z0, b.charge, .75,{asset:fleetCue(b.owner.spec,b.skill)?.assets[0]});

    }
    if(!charging&&!this.fired.has(b.id)){
      this.fired.add(b.id);const cue=fleetCue(b.owner.spec,b.skill,'release');
      audio.play('laser',b.x0,b.y0,b.z0,b.time,.8,{asset:cue?.assets[0]});
    }
    if (b.mode === 'orbital') {
      const x = b.x1;
      const z = b.z1;
      const w = b.width;
      if (charging) {
        // Targeting circle tightening on the sea before the pillar falls.
        const k = b.age / Math.max(0.01, b.charge);
        this.ring(x, z, w * (2.5 - 1.5 * k), c, 0.9, 3);
        r.push(x, SKY, z, x, 0, z, c.clone().multiplyScalar(1.5), 0.25 * k, w * 0.08, 1.5);
        return;
      }
      const flick = 0.85 + Math.random() * 0.3;
      r.push(x, SKY, z, x, 0, z, tmp.setHex(b.skill.accent).multiplyScalar(2.2), 0.7, w * 0.75 * flick, 6);
      r.push(x, SKY, z, x, 0, z, WHITE.clone().multiplyScalar(4), 1, w * 0.22 * flick, 3);
      this.ring(x, z, w * 0.9, tmp.setHex(b.skill.accent).multiplyScalar(2), 0.8, 4);
      // The sea boils where it lands.
      if (Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2;
        const rr = rnd(0, w * 0.6);
        this.alpha.spawn({ x: x + Math.cos(a) * rr, y: 2, z: z + Math.sin(a) * rr, vx: rnd(-6, 6), vy: rnd(20, 50), vz: rnd(-6, 6), life: rnd(2, 4), size: w * 0.3, size1: w * 1.1, color: 0xf2f4f6, alpha: 0.6, drag: 0.4 });
      }
      if (Math.random() < dt * 30) this.add.spawn({ x, y: rnd(5, 40), z, life: 0.3, size: w * 1.5, size1: w * 2.5, color: 0xffffff, color1: b.skill.accent, kind: PK.Glow });
      return;
    }
    const { x0, y0, z0, x1, y1, z1 } = b;
    if (b.mode === 'sweep') this.sweepArc(b, charging);
    if (charging) {
      // Charge vortex: a growing core with sparks drawn into it.
      const k = b.age / Math.max(0.01, b.charge);
      if (Math.random() < dt * 30) this.add.spawn({ x: x0, y: y0, z: z0, life: 0.15, size: 6 + 30 * k, size1: 10 + 40 * k, color: 0xffffff, color1: b.skill.accent, kind: PK.Glow });
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = rnd(-0.6, 0.8);
        const rr = 60 * (1 - k * 0.5);
        const sx = Math.cos(a) * Math.cos(e) * rr;
        const sy = Math.sin(e) * rr;
        const sz = Math.sin(a) * Math.cos(e) * rr;
        this.add.spawn({ x: x0 + sx, y: y0 + sy, z: z0 + sz, vx: -sx * 2.5, vy: -sy * 2.5, vz: -sz * 2.5, life: 0.38, size: 2.5, size1: 0.5, color: b.skill.accent, kind: PK.Glow });
      }
      // A faint sighting line so the target knows it is coming.
      r.push(x0, y0, z0, x1, y1, z1, this.friendly(b) ? c : ENEMY, 0.25 * k, 1.5, 1);
      return;
    }
    const flick = 0.85 + Math.random() * 0.3;
    const w = b.width;
    r.push(x0, y0, z0, x1, y1, z1, tmp.setHex(b.skill.accent).multiplyScalar(0.9), 0.4, w * 2 * flick, 8);
    r.push(x0, y0, z0, x1, y1, z1, tmp.setHex(b.skill.accent).multiplyScalar(2.4), 0.75, w * 0.6 * flick, 5);
    r.push(x0, y0, z0, x1, y1, z1, WHITE.clone().multiplyScalar(4), 1, w * 0.18 * flick, 2.5);
    if (Math.random() < dt * 25) this.add.spawn({ x: x0, y: y0, z: z0, life: 0.12, size: w * 1.2, size1: w * 2, color: 0xffffff, color1: b.skill.accent, kind: PK.Glow });
    // The sea flashes to steam in a trench under the beam.
    for (let i = 0; i < 3; i++) {
      if (Math.random() > dt * 20) continue;
      const t = Math.random();
      this.alpha.spawn({ x: x0 + (x1 - x0) * t + rnd(-w, w) * 0.4, y: 2, z: z0 + (z1 - z0) * t + rnd(-w, w) * 0.4, vx: rnd(-5, 5), vy: rnd(12, 30), vz: rnd(-5, 5), life: rnd(1.5, 3), size: w * 0.5, size1: w * 1.8, color: 0xeef2f4, alpha: 0.45, drag: 0.5 });
    }
    // Sparks and steam where it bites.
    for (const s of b.touching) {
      if (Math.random() > dt * 30) continue;
      const hx = s.pos.x + rnd(-1, 1) * s.spec.beam * 0.5;
      const hz = s.pos.z + rnd(-1, 1) * s.spec.beam * 0.5;
      this.add.spawn({ x: hx, y: s.spec.freeboard + 4, z: hz, life: 0.25, size: w * 0.8, size1: w * 1.6, color: 0xffffff, color1: b.skill.accent, kind: PK.Glow });
      for (let i = 0; i < 4; i++) this.add.spawn({ x: hx, y: s.spec.freeboard + 4, z: hz, vx: rnd(-35, 35), vy: rnd(10, 45), vz: rnd(-35, 35), gravity: 9.81, life: rnd(0.4, 0.9), size: 1.8, color: 0xfff0c0, color1: b.skill.accent, kind: PK.Glow });
    }
    if (Math.random() < dt * 12) this.alpha.spawn({ x: x1, y: 3, z: z1, vx: rnd(-4, 4), vy: rnd(10, 25), vz: rnd(-4, 4), life: rnd(2, 4), size: w * 0.6, size1: w * 2, color: 0xeef2f4, alpha: 0.5, drag: 0.4 });
  }

  /** Takemikazuchi: the half circle it will cut, then afterimages trailing the blade. */
  private sweepArc(b: Beam, charging: boolean): void {
    const r = this.ribbons;
    const c = (this.friendly(b) ? tmp.setHex(b.skill.accent) : ENEMY).clone().multiplyScalar(1.6);
    const { x0, z0 } = b;
    if (charging) {
      const k = b.age / Math.max(0.01, b.charge);
      const n = 36;
      for (let i = 0; i < n; i++) {
        const a0 = b.centre + (i / n - 0.5) * b.arc * DEG;
        const a1 = b.centre + ((i + 1) / n - 0.5) * b.arc * DEG;
        r.push(x0 + forwardX(a0) * b.length, 2, z0 + forwardZ(a0) * b.length, x0 + forwardX(a1) * b.length, 2, z0 + forwardZ(a1) * b.length, c, 0.35 + 0.5 * k, 6, 1.5);
      }
      for (const e of [-0.5, 0.5]) {
        const a = b.centre + e * b.arc * DEG;
        r.push(x0, 2, z0, x0 + forwardX(a) * b.length, 2, z0 + forwardZ(a) * b.length, c, 0.3 * k, 3, 1.5);
      }
      return;
    }
    for (let i = 1; i <= 5; i++) {
      const a = b.yaw - i * 4 * DEG;
      r.push(x0, b.y0, z0, x0 + forwardX(a) * b.length, 4, z0 + forwardZ(a) * b.length, c, 0.4 / i, b.width * 0.8, 3);
    }
  }

  /** Jagged bolts, re-randomised every frame so they crackle. */
  private updateBolts(dt: number): void {
    const r = this.ribbons;
    for (const b of this.bolts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      const a = b.life / b.max;
      for (let i = 0; i + 1 < b.points.length; i++) {
        const p = b.points[i];
        const n = b.points[i + 1];
        if (b.straight) {
          r.push(p.x, p.y, p.z, n.x, n.y, n.z, b.color, a, 3, 3);
          r.push(p.x, p.y, p.z, n.x, n.y, n.z, WHITE, a, 1, 1);
          continue;
        }
        const len = Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z);
        const segs = Math.max(4, Math.min(18, Math.round(len / 60)));
        const jag = Math.min(80, len * 0.08);
        let px = p.x;
        let py = p.y;
        let pz = p.z;
        for (let k = 1; k <= segs; k++) {
          const t = k / segs;
          const off = k === segs ? 0 : jag;
          const nx = p.x + (n.x - p.x) * t + rnd(-off, off);
          const ny = p.y + (n.y - p.y) * t + rnd(-off, off) * 0.5 + Math.sin(t * Math.PI) * len * 0.12;
          const nz = p.z + (n.z - p.z) * t + rnd(-off, off);
          r.push(px, py, pz, nx, ny, nz, b.color, a, 2.5, 2.5);
          r.push(px, py, pz, nx, ny, nz, WHITE, a, 0.8, 1);
          // Short forks.
          if (Math.random() < 0.25) r.push(nx, ny, nz, nx + rnd(-jag, jag), ny + rnd(-jag, 0), nz + rnd(-jag, jag), b.color, a * 0.6, 1.2, 1.2);
          px = nx;
          py = ny;
          pz = nz;
        }
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  /** Circle on the water as ribbon segments. */
  private ring(x: number, z: number, radius: number, color: Color, alpha: number, width: number, y = 1.5): void {
    const n = Math.max(24, Math.min(72, Math.round(radius / 12)));
    let px = x + radius;
    let pz = z;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const nx = x + Math.cos(a) * radius;
      const nz = z + Math.sin(a) * radius;
      this.ribbons.push(px, y, pz, nx, y, nz, color, alpha, width, 1.5);
      px = nx;
      pz = nz;
    }
  }

  private strike(s: Strike, dt: number): void {
    const accent = tmp.setHex(s.skill?.accent ?? 0xffb060);
    const col = this.friendly(s) ? accent.clone().multiplyScalar(1.8) : ENEMY.clone().multiplyScalar(2);
    if (s.kind === 'shock') {
      if (s.age < s.delay) return;
      this.ring(s.x, s.z, s.ring, accent.clone().multiplyScalar(2.5), 0.9, 10);
      this.ring(s.x, s.z, s.ring * 0.96, accent.clone().multiplyScalar(1.2), 0.4, 18);
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        this.alpha.spawn({ x: s.x + Math.cos(a) * s.ring, y: 2, z: s.z + Math.sin(a) * s.ring, vy: rnd(10, 30), life: 1.5, size: 20, size1: 50, color: 0xf2f6f8, alpha: 0.7, kind: PK.Spray, gravity: 9.81 });
      }
      return;
    }
    if (s.kind === 'mine') {
      // Armed mines blink.
      if (s.age >= s.delay && Math.sin(this.time * 6 + s.id) > 0.6) {
        this.ribbons.push(s.x, 1, s.z, s.x, 4, s.z, col, 1, 3, 3);
      }
      return;
    }
    const left = s.delay - s.age;
    if (left <= 0) return;
    // Telegraph: the blast circle and an inner ring closing in as impact nears.
    const k = 1 - left / Math.max(0.01, s.delay);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 14);
    if (s.look !== 'plain') {
      // Spells are telegraphed by a magic circle; meteors, anvils and fireballs fall in on a slant.
      this.magicCircle(s.x, s.z, Math.max(60, s.radius), col, 0.5 + 0.35 * pulse, this.time * 0.8 + s.id);
      const fall = s.look === 'meteor' ? 1.4 : s.look === 'rune' || s.look === 'quake' ? 0 : 0.9;
      if (left < fall) {
        const t = 1 - left / fall;
        const top = s.look === 'fireball' ? 500 : 1600;
        const y = top * (1 - t);
        const side = (1 - t) * top * 0.45;
        const head = tmp.setHex(s.look === 'anvil' ? 0xe8eef4 : 0xffa040).multiplyScalar(3.5);
        this.ribbons.push(s.x + side + 120, y + 260, s.z + side * 0.4 + 50, s.x + side, y, s.z + side * 0.4, head, 1, s.look === 'meteor' ? 9 : 4, 3);
        if (s.look !== 'anvil') this.add.spawn({ x: s.x + side, y, z: s.z + side * 0.4, life: 0.25, size: s.look === 'meteor' ? 40 : 22, size1: 60, color: 0xffe0a0, color1: 0xff3000, kind: PK.Glow });
      }
      return;
    }
    this.ring(s.x, s.z, s.radius, col, 0.55 + 0.35 * pulse, s.kind === 'nuke' ? 8 : 3);
    this.ring(s.x, s.z, s.radius * (1 - k), col, 0.4, 2);
    // Falling streak over the last moments (rods from orbit, rockets and mortars from the arc).
    const fall = s.kind === 'rod' ? 0.6 : s.kind === 'nuke' ? 1 : 0.45;
    if (left < fall) {
      const t = 1 - left / fall;
      const top = s.kind === 'rod' ? SKY : 600;
      const y = top * (1 - t);
      const lead = s.kind === 'rod' ? 220 : 60;
      const head = s.kind === 'rod' ? WHITE.clone().multiplyScalar(4) : tmp.setHex(0xffc070).multiplyScalar(3);
      this.ribbons.push(s.x, y + lead, s.z, s.x, y, s.z, head, 1, s.kind === 'rod' ? 4 : s.kind === 'nuke' ? 5 : 1.6, 2);
      if (s.kind === 'nuke' || s.kind === 'rod') this.add.spawn({ x: s.x, y, z: s.z, life: 0.08, size: 25, color: 0xffffff, color1: s.skill?.accent ?? 0xffcf5a, kind: PK.Glow });
    }
  }

  private pickups(): void {
    const items = this.game.pickups.items;
    let n = 0;
    for (const p of items) {
      if (!p.alive) continue;
      const c = tmp.setHex(PICKUP_COLOR[p.kind]);
      const bob = Math.sin(this.time * 2 + p.id) * 1.5;
      const y = waveHeight(p.x, p.z, this.game.time) + 3 + bob;
      // Beacon pillar, a ring on the water and the crate itself.
      const glow = 0.5 + 0.2 * Math.sin(this.time * 3 + p.id);
      this.ribbons.push(p.x, y, p.z, p.x, 420, p.z, c.clone().multiplyScalar(2.2), glow, 5, 2);
      this.ribbons.push(p.x, y, p.z, p.x, 160, p.z, WHITE.clone().multiplyScalar(2), glow, 1.2, 1);
      this.ring(p.x, p.z, 45 + ((this.time * 20 + p.id * 13) % 30), c.clone().multiplyScalar(1.6), 0.6, 2, 1.2);
      if (n < 16) {
        q.setFromAxisAngle(UP, this.time * 0.8 + p.id);
        m4.compose(v.set(p.x, y, p.z), q, sc.set(1, 1, 1));
        this.crates.setMatrixAt(n, m4);
        this.crates.setColorAt(n, c);
        n++;
      }
    }
    this.crates.count = n;
    this.crates.instanceMatrix.needsUpdate = true;
    if (this.crates.instanceColor) this.crates.instanceColor.needsUpdate = true;
  }

  private shields(dt: number): void {
    for (const s of this.game.ships) {
      const on = s.alive && s.shield > 0;
      let b = this.bubbles.get(s);
      if (!b) {
        if (!on) continue;
        const accent = s.skills.find((k) => k.spec.icon === 'shield')?.spec.accent ?? 0x7fe0ff;
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
        this.bubbles.set(s, b);
      }
      b.k = Math.max(0, Math.min(1, b.k + (on ? dt * 4 : -dt * 3)));
      b.hit = Math.max(0, b.hit - dt * 3);
      b.mesh.visible = b.k > 0.01;
      if (!b.mesh.visible) continue;
      const L = s.spec.length;
      b.mesh.position.set(s.renderPos.x, s.renderPos.y + s.spec.freeboard * 0.5, s.renderPos.z);
      b.mesh.rotation.set(0, Math.PI / 2 - s.renderHeading, 0);
      b.mesh.scale.set(L * 0.62, Math.max(30, L * 0.18), Math.max(s.spec.beam * 1.6, L * 0.2));
      const u = b.mesh.material.uniforms;
      // Thinner as it drains.
      u.uAlpha.value = b.k * (0.5 + 0.5 * Math.min(1, s.shield / Math.max(1, s.shieldMax)));
      u.uHit.value = b.hit;
      u.uTime.value = this.time;
    }
  }

  /** Calving Wall: shards burst up out of the sea, stand, then slump back under. */
  private walls(dt: number): void {
    let n = 0;
    for (const w of this.game.walls) {
      const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
      const count = Math.max(2, Math.round(len / SHARD_STEP));
      let roll = this.shardRolls.get(w);
      if (!roll) {
        roll = new Float32Array(count * 4).map(() => Math.random());
        this.shardRolls.set(w, roll);
        // The sea heaves where it rises.
        for (let i = 0; i < count; i += 3) {
          const t = i / (count - 1);
          this.alpha.spawn({ x: w.x0 + (w.x1 - w.x0) * t, y: 2, z: w.z0 + (w.z1 - w.z0) * t, vx: rnd(-8, 8), vy: rnd(30, 60), vz: rnd(-8, 8), gravity: 9.81, life: rnd(2, 3.5), size: 20, size1: 60, color: 0xf2fbff, alpha: 0.8, kind: PK.Spray, drag: 0.3 });
        }
      }
      const rise = Math.min(1, w.age / 0.35);
      const ease = 1 - (1 - rise) * (1 - rise);
      const fall = Math.max(0, w.age - w.life);
      const nx = -(w.z1 - w.z0) / len;
      const nz = (w.x1 - w.x0) / len;
      for (let i = 0; i < count && n < MAX_SHARDS; i++) {
        const t = i / (count - 1);
        const r0 = roll[i * 4];
        const r1 = roll[i * 4 + 1];
        const r2 = roll[i * 4 + 2];
        const r3 = roll[i * 4 + 3];
        // Taller in the middle, ragged at the ends.
        const h = (45 + r0 * 75) * (0.45 + 0.55 * Math.sin(Math.PI * t)) * ease;
        const rad = 9 + r1 * 10;
        const side = (r2 - 0.5) * 26;
        v.set(w.x0 + (w.x1 - w.x0) * t + nx * side, h * 0.5 - 4 - fall * fall * 14, w.z0 + (w.z1 - w.z0) * t + nz * side);
        q.setFromAxisAngle(sc.set(nx, 0, nz), (r3 - 0.5) * 0.5);
        m4.compose(v, q, sc.set(rad, Math.max(0.01, h), rad));
        this.shards.setMatrixAt(n++, m4);
      }
      // Frost smoke along the crest.
      if (w.age < w.life && Math.random() < dt * 8) {
        const t = Math.random();
        this.alpha.spawn({ x: w.x0 + (w.x1 - w.x0) * t, y: rnd(20, 70), z: w.z0 + (w.z1 - w.z0) * t, vx: rnd(-3, 3), vy: rnd(1, 4), vz: rnd(-3, 3), life: rnd(3, 5), size: 30, size1: 90, color: 0xeef8ff, alpha: 0.35, drag: 0.3 });
      }
    }
    this.shards.count = n;
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /** Fade in over 0.3 s, out over the second a field lingers past its life. */
  private fade(age: number, life: number): number {
    return Math.min(1, age / 0.3) * Math.max(0, Math.min(1, 1 - (age - life)));
  }

  /** Is (x, z) close enough to any camera to spend particles on? */
  private near(x: number, z: number, r: number): boolean {
    return this.views.some((c) => Math.hypot(c.x - x, c.z - z) < 9000 + r);
  }

  /**
   * A magic circle: twin rings, a star polygon turning between them and rune ticks on the rim.
   * Fantasy casts draw one under the caster and on the spot a spell will land.
   */
  /** A circle blooms under the caster, turns, and fades over 1.2 s (riding with the hull). */
  private castCircles(dt: number): void {
    const LIFE = 1.2;
    for (const c of this.casts) {
      c.age += dt;
      const s = c.ship;
      if (!s.alive || c.age > LIFE || !this.near(s.renderPos.x, s.renderPos.z, 400)) continue;
      const grow = Math.min(1, c.age / 0.25);
      const k = grow * (1 - Math.max(0, c.age - LIFE * 0.6) / (LIFE * 0.4));
      const r = Math.max(60, s.spec.length * 0.8) * (0.7 + 0.3 * grow);
      this.magicCircle(s.renderPos.x, s.renderPos.z, r, c.color, 0.9 * k, c.spin + c.age * 1.6, 2.2);
    }
    if (this.casts.length > 24 || this.casts.some((c) => c.age > LIFE)) this.casts = this.casts.filter((c) => c.age <= LIFE).slice(-24);
  }

  magicCircle(x: number, z: number, r: number, color: Color, alpha: number, spin: number, y = 1.6): void {
    const rb = this.ribbons;
    this.ring(x, z, r, color, alpha, 3.2, y);
    this.ring(x, z, r * 0.84, color, alpha * 0.7, 1.8, y);
    this.ring(x, z, r * 0.36, color, alpha * 0.6, 1.6, y);
    // A seven-pointed star, every third vertex joined.
    const pts = 7;
    for (let i = 0; i < pts; i++) {
      const a0 = spin + (i / pts) * Math.PI * 2;
      const a1 = spin + (((i + 3) % pts) / pts) * Math.PI * 2;
      rb.push(x + Math.cos(a0) * r * 0.84, y, z + Math.sin(a0) * r * 0.84, x + Math.cos(a1) * r * 0.84, y, z + Math.sin(a1) * r * 0.84, color, alpha * 0.8, 2, 1.4);
    }
    // Rune ticks counter-rotate around the rim.
    const ticks = Math.max(12, Math.min(36, Math.round(r / 18)));
    for (let i = 0; i < ticks; i++) {
      const a = -spin * 0.6 + (i / ticks) * Math.PI * 2;
      const r0 = r * (i % 3 === 0 ? 0.86 : 0.9);
      rb.push(x + Math.cos(a) * r0, y, z + Math.sin(a) * r0, x + Math.cos(a) * r * 0.98, y, z + Math.sin(a) * r * 0.98, color, alpha, 2.4, 1.4);
    }
  }

  private polygon(x: number, z: number, r: number, sides: number, rot: number, color: Color, alpha: number, width: number, y: number): void {
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2;
      const a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      this.ribbons.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, color, alpha, width, 1.5);
    }
  }

  /** Spell fields, nanite clouds, time warps and cages: an edge, a look of their own, and motes. */
  private field(f: Field, dt: number): void {
    const k = this.fade(f.age, f.life);
    if (k <= 0) return;
    const base = new Color(f.color).multiplyScalar(2);
    const edge = this.friendly(f) ? base : ENEMY.clone().multiplyScalar(2);
    const t = this.time;
    const { x, z, r } = f;
    switch (f.look) {
      case 'circle':
        this.magicCircle(x, z, r, base, 0.85 * k, t * 0.4);
        break;
      case 'time': {
        this.ring(x, z, r, edge, 0.8 * k, 3);
        this.ring(x, z, r * 0.92, base, 0.4 * k, 1.5);
        // Clock hands, slow and fast.
        for (const [len, speed] of [[0.55, 0.25], [0.85, 1.6]] as const) {
          const a = t * speed;
          this.ribbons.push(x, 1.6, z, x + Math.cos(a) * r * len, 1.6, z + Math.sin(a) * r * len, base, 0.8 * k, 3, 1.5);
        }
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.ribbons.push(x + Math.cos(a) * r * 0.82, 1.6, z + Math.sin(a) * r * 0.82, x + Math.cos(a) * r * 0.92, 1.6, z + Math.sin(a) * r * 0.92, base, k, 3, 1.5);
        }
        break;
      }
      case 'storm':
        // A cage of light: the rim stacked up the wall height, and crackling.
        for (const y of [1.5, 25, 50]) this.ring(x, z, r, edge, (y === 1.5 ? 1 : 0.5) * k, 2.5, y);
        if (f.age < f.life && Math.random() < dt * 6) {
          const a = Math.random() * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          this.bolts.push({ points: [new Vector3(px, 60, pz), new Vector3(px + rnd(-20, 20), 30, pz + rnd(-20, 20)), new Vector3(px, 1, pz)], color: base.clone().multiplyScalar(1.6), life: 0.2, max: 0.2 });
        }
        break;
      case 'hex':
        this.polygon(x, z, r, 6, Math.PI / 6, edge, 0.9 * k, 3, 1.5);
        this.polygon(x, z, r * 0.6, 6, Math.PI / 6, base, 0.4 * k, 1.5, 1.5);
        break;
      case 'void':
        this.ring(x, z, r, edge, 0.7 * k, 3);
        // Spiral arms drawn inward.
        for (let arm = 0; arm < 4; arm++) {
          let px = x + Math.cos(arm * 1.57 + t) * r;
          let pz = z + Math.sin(arm * 1.57 + t) * r;
          for (let i = 1; i <= 10; i++) {
            const u = 1 - i / 10;
            const a = arm * 1.57 + t + (1 - u) * 2.4;
            const nx = x + Math.cos(a) * r * u;
            const nz = z + Math.sin(a) * r * u;
            this.ribbons.push(px, 1.6, pz, nx, 1.6, nz, base, 0.7 * k * (1 - u * 0.5), 2.5, 1.5);
            px = nx;
            pz = nz;
          }
        }
        break;
      default:
        this.ring(x, z, r, edge, 0.75 * k, 2.6);
        this.ring(x, z, r * (0.9 + 0.04 * Math.sin(t * 2)), base, 0.3 * k, 1.4);
    }
    if (f.age >= f.life || !this.near(x, z, r)) return;
    // Motes: how much and what kind depends on the look; denser for bigger fields, capped.
    const rate = Math.min(40, r / 25) * dt;
    const spawns = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (let i = 0; i < spawns; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      switch (f.look) {
        case 'mist':
        case 'nanite':
        case 'swarm':
          if (f.look === 'mist') this.alpha.spawn({ x: px, y: rnd(2, 20), z: pz, vx: rnd(-2, 2), vy: rnd(0, 2), vz: rnd(-2, 2), life: rnd(3, 5), size: 40, size1: 110, color: f.color, alpha: 0.25, drag: 0.4 });
          else this.add.spawn({ x: px, y: rnd(5, 40), z: pz, vx: rnd(-15, 15), vy: rnd(-3, 3), vz: rnd(-15, 15), life: rnd(0.8, 1.6), size: 3, size1: 2, color: f.color, kind: PK.Glow });
          break;
        case 'fire':
          this.add.spawn({ x: px, y: 2, z: pz, vy: rnd(8, 20), life: rnd(0.6, 1.2), size: 18, size1: 4, color: 0xffc060, color1: 0xff3000, kind: PK.Glow });
          break;
        case 'kelp':
        case 'grove':
        case 'frost':
          this.flat.spawn({ x: px, y: 0.8, z: pz, life: rnd(1.5, 3), size: 14, size1: 40, color: f.color, alpha: 0.4, kind: PK.Foam, drag: 0.8 });
          break;
        default:
          this.add.spawn({ x: px, y: 1.5, z: pz, vy: rnd(4, 14), life: rnd(0.8, 1.6), size: 4, size1: 1, color: f.color, kind: PK.Glow });
      }
    }
  }

  /** A tripwire: a pulsing dashed line on the water. */
  private wire(w: Tripwire): void {
    const k = this.fade(w.age, w.life);
    if (k <= 0) return;
    const col = (this.friendly(w) ? new Color(w.color) : ENEMY.clone()).multiplyScalar(2);
    const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
    const n = Math.max(4, Math.min(60, Math.round(len / 60)));
    const shift = (this.time * 0.6) % 1;
    for (let i = 0; i < n; i++) {
      const a = (i + shift) / n;
      const b = Math.min(1, (i + shift + 0.55) / n);
      this.ribbons.push(w.x0 + (w.x1 - w.x0) * a, 1.4, w.z0 + (w.z1 - w.z0) * a, w.x0 + (w.x1 - w.x0) * b, 1.4, w.z0 + (w.z1 - w.z0) * b, col, 0.8 * k, 2.4, 1.6);
    }
  }

  /** Running titan skills that draw something of their own. */
  private titanSkill(s: Ship, st: SkillState, dt: number): void {
    const id = st.spec.id;
    const accent = st.spec.accent;
    const c = tmp.setHex(accent).multiplyScalar(2.2);
    if (id === 'raijinDrums') {
      const pts = [0, 1, 2, 3, 4, 5].map((i) => drumPos(s, this.game.time, i));
      pts.forEach((p, i) => {
        const n = pts[(i + 1) % 6];
        this.ribbons.push(p.x, p.y, p.z, n.x, n.y, n.z, c, 0.25, 2, 1.5);
        this.add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.05, size: 26 + Math.random() * 8, color: 0xffffff, color1: accent, kind: PK.Glow });
      });
    } else if (id === 'swordfishStrike') {
      const k = 1 - st.time / st.spec.duration;
      const d = swordfishDrop(s, st.data.x as number, st.data.z as number);
      const fx = forwardX(d.heading);
      const fz = forwardZ(d.heading);
      // Out from the deck to the drop point, then pulling up and away.
      const along = k < 0.85 ? k / 0.85 : 1 + (k - 0.85) * 2;
      for (let i = 0; i < 6; i++) {
        const lat = (i - 2.5) * 45;
        const back = Math.abs(i - 2.5) * 40;
        const x = s.pos.x + (d.x - s.pos.x) * along - fx * back - fz * lat;
        const z = s.pos.z + (d.z - s.pos.z) * along - fz * back + fx * lat;
        const y = k < 0.85 ? 140 - 110 * (k / 0.85) : 30 + (k - 0.85) * 900;
        this.ribbons.push(x - fx * 120, y + 4, z - fz * 120, x, y, z, WHITE.clone().multiplyScalar(1.5), 0.35, 2, 1.5);
        this.add.spawn({ x, y, z, life: 0.05, size: 9, color: 0xffffff, color1: accent, kind: PK.Glow });
      }
    } else if (id === 'blizzard') {
      const R = st.spec.zone!;
      // Driving snow around each camera inside the storm, and white squalls across it.
      for (const cam of this.views) {
        if (Math.hypot(cam.x - s.pos.x, cam.z - s.pos.z) > R) continue;
        const n = Math.min(12, Math.floor(dt * 400 + Math.random()));
        for (let i = 0; i < n; i++) {
          this.alpha.spawn({ x: cam.x + rnd(-350, 350), y: rnd(10, 160), z: cam.z + rnd(-350, 350), vx: rnd(25, 45), vy: rnd(-14, -6), vz: rnd(-10, 10), life: rnd(2, 3), size: 1.6, color: 0xffffff, alpha: 0.9, drag: 0.05 });
        }
      }
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * R;
        this.alpha.spawn({ x: s.pos.x + Math.cos(a) * rr, y: rnd(20, 120), z: s.pos.z + Math.sin(a) * rr, vx: rnd(15, 30), vy: rnd(-2, 2), vz: rnd(-6, 6), life: rnd(4, 6), size: 150, size1: 320, color: 0xf4f9ff, alpha: 0.32, drag: 0.1, fadeIn: 0.3 });
      }
    } else if (id === 'magneticMaelstrom') {
      const R = st.spec.zone!;
      const inner = s.spec.length * 0.6;
      // Three arms spiralling in on the ship.
      for (let arm = 0; arm < 3; arm++) {
        let px = 0;
        let pz = 0;
        for (let i = 0; i <= 28; i++) {
          const u = i / 28;
          const r = R - (R - inner) * u;
          const a = this.time * 1.4 + (arm * Math.PI * 2) / 3 + u * 3.2;
          const x = s.pos.x + Math.cos(a) * r;
          const z = s.pos.z + Math.sin(a) * r;
          if (i > 0) this.ribbons.push(px, 3, pz, x, 3, z, c, 0.2 + 0.5 * u, 6 + 10 * (1 - u), 2);
          px = x;
          pz = z;
        }
      }
    }
  }

  /** Hide a ship's bubble in viewports that cannot see the ship. */
  visible(ship: Ship, on: boolean): void {
    const b = this.bubbles.get(ship);
    if (b) b.mesh.visible = on && b.k > 0.01;
  }
}
