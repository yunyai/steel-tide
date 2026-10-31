import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import { clamp } from '../core/math';
import type { GameEventMap } from '../core/Events';
import type { Team } from '../core/types';
import { contactVisible } from '../core/Targeting';
import type { Ship } from '../ships/Ship';
import { CUBE, HIT, SIGNATURE, TUNGSTEN_MODES, dockLift, modeOf } from '../skills/misc/TungstenModes';
import { dockPoint, mergedDie, overdriveOn, type Cube, type TungstenState } from '../skills/misc/TungstenRuntime';
import { audio } from '../fx/Audio';
import { BK, drift, hash01, type BurstParticles } from './BurstParticles';
import type { Ribbons } from './Projectiles';
import { quality } from './Quality';
import { FOAM, SPRAY, TAU, TungstenPaint, WHITE, clamp01, ease, hot } from './TungstenPaint';
import { ModeSweep, cubeGeometry, cubeSkin, dieFaceNormal, dieHop, modeColor, pileLift, storeLook, type CubeSkinUniforms } from './TungstenLook';
import { HORN_TIPS, type TungstenModel } from './TungstenModel';
import { INFALL, TungstenSingularities } from './TungstenSingularity';
import { TungstenUltFx, ULT_LIFE } from './TungstenUltFx';
import type { SpatialDistortion } from './SpatialDistortion';

type TungstenEvent = GameEventMap['tungsten'];
interface Burst {
  e: TungstenEvent;
  at: number;
  id: number;
  life: number;
  /** The struck ship's position when struck, so a sinking or moving target does not drag its sparks. */
  tx: number;
  tz: number;
}
interface FreeCube {
  mesh: Mesh;
  material: MeshStandardMaterial;
  u: CubeSkinUniforms;
  sweep: ModeSweep;
  /** Recent render positions and times, newest last: x, y, z, t. */
  trail: number[];
  tumble: number;
  /** Drawn heading, eased toward the sim's so a capped 60 Hz turn reads smooth at any frame rate. */
  yaw: number;
  axisX: number;
  axisZ: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  live: boolean;
  /** Render time it vanished (dissolving), or -1. */
  gone: number;
  /** Last capture or block, for the face flash. */
  struck: number;
  /** The face a Loaded Die rolled and when it landed (-1 for none), shown for `DIE_SHOW` s. */
  face: number;
  faceAt: number;
  /**
   * Die pose: `base` is the cube's lie under its yaw and roll, `wobble` a sideways rock while it rolls; on landing
   * `base` eases from `from` to `to`, the rolled face up, starting at render time `settleAt` (-1 when still).
   */
  base: Quaternion;
  from: Quaternion;
  to: Quaternion;
  settleAt: number;
  wobble: number;
  /** How much the six face colours show, 0 to 1. */
  die: number;
  /** How much a merged die's rainbow shows, 0 to 1; `merged` when the die it last landed was one. */
  rainbow: number;
  merged: boolean;
  /** Render time it merged into a die (-1 when not merged), and where it slides in from. */
  mergeAt: number;
  mergeFrom: Vector3;
  mode: number;
}

const DEBRIS_CAP = 96;
const TRAIL = 0.32;
const LIFE: Partial<Record<TungstenEvent['kind'], number>> = {
  throw: 0.55,
  hit: 0.95,
  land: 1.3,
  dock: 0.6,
  break: 2.8,
  reform: 1.1,
  switch: 0.55,
  signature: 1.6,
  slam: 1.7,
  reel: 0.8,
  lunge: 0.7,
  arrive: 0.9,
  capture: 0.45,
  block: 0.4,
  mirror: 0.45,
  shield: 1,
  contact: 0.7,
  overdrive: 1.8,
  overdriveEnd: 1.1,
  spent: 1.4,
  charged: 0.7,
  die: 1.6,
};
/** Seconds a landed die shows the face it rolled before its own colour sweeps back. */
const DIE_SHOW = 1.6;
/** Seconds a landed die takes to tip onto its face, and how long its six colours hold before fading. */
const DIE_SETTLE = 0.35;
const DIE_HOLD = 0.9;
/** How far (m) a cube flying out to the Overdrive ring bows sideways mid-flight: clear of a swapping cube's corners. */
const SWAP_BOW = 190;
/** Seconds a cube takes to slide into an Overdrive die, and a landed die to shrink back to size. */
const MERGE = 0.3;
const H = CUBE.edge / 2;
const TETHER = modeOf('tether');
const tint2 = new Color();

/**
 * Everything the Tungsten's cubes do away from the magnet: the cubes themselves once undocked, their trails,
 * levitation fields, Shield arcs, tether chains, Lunge streaks, hits, breaks and the six signatures.
 * Rebuilt from game state and timed event snapshots each prepare; it never writes game state.
 */
export class TungstenCubeFx {
  readonly paint: TungstenPaint;
  readonly particles: BurstParticles;
  readonly lines: Ribbons;
  readonly trails: Ribbons;
  readonly debris: InstancedMesh;
  /** Collapse's black holes. */
  readonly singularities: TungstenSingularities;
  /** Telegraphs, entries, impacts and bursts for Collapse and Meteor. */
  readonly ult: TungstenUltFx;
  /** Screen flash for a strike at (x, z), faded by the distance to the nearest camera. */
  onFlash: ((x: number, z: number, amount: number, color: number) => void) | null = null;
  private views = new Map<string, FreeCube>();
  private bursts: Burst[] = [];
  private off: (() => void)[] = [];
  private locals: Ship[] = [];
  private serial = 0;
  private heard = new Map<string, number>();
  private shadows = quality().shadowMap > 0;
  private m4 = new Matrix4();
  private q = new Quaternion();
  private q2 = new Quaternion();
  private q3 = new Quaternion();
  private v = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private scale = new Vector3();
  private up = new Vector3(0, 1, 0);
  private storeTint = new Color();
  /** The horn tips of the ship being drawn, in world space. */
  private tips = HORN_TIPS.map(() => new Vector3());

  constructor(
    private scene: Scene,
    private game: Game,
    /** The ship's magnet model, when it has a view, for anchoring arcs to the moving hull. */
    private model: (s: Ship) => TungstenModel | null = () => null,
  ) {
    this.paint = new TungstenPaint(scene, game);
    ({ particles: this.particles, lines: this.lines, trails: this.trails } = this.paint);
    this.singularities = new TungstenSingularities(scene, game, Math.max(160, Math.round(INFALL * this.paint.detail)), this.paint.reduce);
    this.ult = new TungstenUltFx(this.paint, game);
    const chunk = new MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.9, roughness: 0.42 });
    chunk.onBeforeCompile = (shader) => {
      // Torn etching: each chunk glows in its instance colour, which is the cube's mode colour.
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * 0.9;');
    };
    chunk.customProgramCacheKey = () => 'tungsten-debris';
    this.debris = new InstancedMesh(new BoxGeometry(1, 1, 1), chunk, DEBRIS_CAP);
    this.debris.name = 'tungsten-debris';
    this.debris.instanceMatrix.setUsage(DynamicDrawUsage);
    this.debris.setColorAt(0, WHITE);
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.debris.castShadow = this.shadows;
    scene.add(this.debris);
    this.off.push(
      game.events.on('tungsten', (e) => this.event(e)),
      game.events.on('gameOver', () => this.clear()),
      game.events.on('respawn', (e) => this.drop(e.ship)),
      game.events.on('shipChanged', (e) => this.drop(e.old)),
    );
  }

  private event(e: TungstenEvent): void {
    if (this.game.over) return;
    const life = LIFE[e.kind] ?? ULT_LIFE[e.kind];
    if (e.kind === 'meteorImpact') this.onFlash?.(e.x, e.z, 0.5, 0xfff0dc);
    else if (e.kind === 'collapseBurst') this.onFlash?.(e.x, e.z, 0.6, 0xffffff);
    if (life !== undefined) {
      this.bursts.push({ e, at: this.game.time, id: this.serial++, life, tx: e.target?.pos.x ?? e.x, tz: e.target?.pos.z ?? e.z });
      if (this.bursts.length > 160) this.bursts.splice(0, this.bursts.length - 160);
    }
    if (e.kind === 'capture' || e.kind === 'block') {
      const v = this.views.get(this.key(e.ship, e.cube));
      if (v) v.struck = this.game.time;
    }
    if (e.kind === 'die') {
      const v = this.views.get(this.key(e.ship, e.cube));
      if (v) {
        v.face = e.face ?? e.mode;
        v.faceAt = this.game.time;
        v.merged = !!e.merged;
        this.settleDie(v, v.face);
      }
    }
    this.sound(e);
  }

  private sound(e: TungstenEvent): void {
    const local = this.locals.includes(e.ship);
    const gain = local ? 1 : 0.6;
    const asset = (name: string) => `${import.meta.env.BASE_URL}audio/${name}.m4a`;
    const play = (kind: Parameters<typeof audio.play>[0], name: string, g: number, rate = 1, size = 100) =>
      audio.play(kind, e.x, Math.max(10, e.y), e.z, size, g * gain, { category: 'ability', priority: local ? 3 : 1, asset: asset(name), rate });
    // Rapid captures and blocks share one voice per ship.
    const throttle = (k: string, gap: number) => {
      const id = `${e.ship.id}:${k}`;
      const last = this.heard.get(id) ?? -1e9;
      if (this.game.time - last < gap) return false;
      this.heard.set(id, this.game.time);
      return true;
    };
    switch (e.kind) {
      case 'throw':
        play('charge', 'energy-pulse', 0.7, 0.8);
        break;
      case 'hit':
        play('hit', 'mechanical-hit', 0.9, 0.75, 2);
        break;
      case 'contact':
        play('hit', 'mechanical-hit', 0.7, 0.9, 2);
        break;
      case 'land':
        play('splash', 'sonniss-splash', 0.45, 1.2, 2);
        break;
      case 'dock':
        play('hit', 'mechanical-hit', 0.6, 0.6, 2);
        break;
      case 'break':
        play('explosion', 'blast-shock', 1, 0.85, 2);
        break;
      case 'reform':
        play('charge', 'ward-rise', 0.6, 1.1);
        break;
      case 'switch':
        play('zap', 'energy-pulse', 0.35, 1.4);
        break;
      case 'lunge':
        play('charge', 'energy-heavy', 0.8, 0.85);
        break;
      case 'arrive':
        play('hit', 'mechanical-hit', 0.8, 0.55, 2);
        break;
      case 'capture':
        if (throttle('capture', 0.12)) play('shield', 'shield', 0.35, 1.5);
        break;
      case 'block':
        if (throttle('block', 0.1)) play('ricochet', 'ricochet', 0.4, 0.8, 2);
        break;
      case 'mirror':
        if (throttle('mirror', 0.08)) play('ricochet', 'ricochet', 0.5, 1.4, 2);
        break;
      case 'shield':
        play('shield', 'shield', 0.7, 0.9);
        break;
      case 'overdrive':
        play('charge', 'transform', 1, 0.9);
        break;
      case 'overdriveEnd':
        play('charge', 'ward-rise', 0.5, 0.7);
        break;
      case 'spent':
        play('splash', 'sonniss-splash', 0.55, 0.8, 2);
        break;
      case 'charged':
        play('charge', 'ward-rise', 0.45, 1.3);
        break;
      case 'die':
        play('explosion', 'blast-shock', 0.9, e.jackpot ? 0.8 : 1.15, 2);
        if (e.jackpot) play('charge', 'transform', 0.8, 1.2);
        break;
      case 'signature': {
        const sig = TUNGSTEN_MODES[e.mode].signature.id;
        if (sig === 'ricochet') play('ricochet', 'ricochet', 0.8, 1);
        else if (sig === 'pile') play('charge', 'energy-heavy', 0.8, 0.8);
        else if (sig === 'cone') play('explosion', 'blast-shock', 0.8, 1.3, 2);
        else if (sig === 'mirror') play('shield', 'shield', 0.8, 1.3);
        else if (sig === 'collide') play('charge', 'energy-charge', 0.8, 0.8);
        else play('charge', 'ward-rise', 0.8, 0.9);
        break;
      }
      case 'slam':
        play('explosion', 'blast-heavy', 1, 0.8, 2);
        break;
      case 'reel':
        play('hit', 'mechanical-hit', 0.9, 0.65, 2);
        break;
      case 'collapse':
        play('charge', 'arcane-charge', 0.8, 0.7);
        break;
      case 'collapseHold':
        play('charge', 'collapse', 1, 1, 3);
        break;
      case 'collapseBurst':
        play('explosion', 'blast-heavy', 1, 0.6, 3);
        play('explosion', 'thunder', 0.6, 0.8, 3);
        break;
      case 'meteorRise':
        play('charge', 'energy-charge', 0.8, 0.6);
        break;
      case 'meteorFall':
        play('charge', 'jet-release', 0.9, 0.5, 3);
        break;
      case 'meteorImpact':
        play('explosion', 'nuke', 1, 0.9, 3);
        break;
      case 'fragment':
        if (throttle('fragment', 0.08)) play('explosion', 'sonniss-explosion', 0.35, 1.3, 2);
        break;
    }
  }

  private key(s: Ship, cube: number): string {
    return `${s.id}:${cube}`;
  }

  /** The drawn skin of a cube away from the dais, while it has a view. */
  /** The cube's lie under its yaw: its roll about the rolling axis, its rock, then its base pose. */
  private lie(v: FreeCube, out: Quaternion): Quaternion {
    this.v2.set(v.axisX, 0, v.axisZ);
    out.setFromAxisAngle(this.v2, v.tumble);
    if (v.wobble) out.multiply(this.q3.setFromAxisAngle(this.v3.set(v.axisZ, 0, -v.axisX), v.wobble));
    return out.multiply(v.base);
  }

  /**
   * A landed die tips onto the face it rolled: its roll is folded into the base pose, which then eases to the
   * nearest lie with that face up and its sides square to the cube's heading.
   */
  private settleDie(v: FreeCube, face: number): void {
    const lie = this.lie(v, this.q2);
    v.from.copy(lie);
    v.base.copy(lie);
    v.tumble = 0;
    v.wobble = 0;
    const vertical = Math.abs(dieFaceNormal(face, this.v3).y) > 0.5;
    v.to.setFromUnitVectors(this.v3.applyQuaternion(lie), this.up).multiply(lie);
    // Square the sides: turn about the vertical to the nearest quarter, measured on an edge-on axis of the face.
    const side = this.v3.set(vertical ? 1 : 0, vertical ? 0 : 1, 0).applyQuaternion(v.to);
    const psi = Math.atan2(-side.z, side.x);
    v.to.premultiply(this.q3.setFromAxisAngle(this.up, Math.round(psi / (Math.PI / 2)) * (Math.PI / 2) - psi));
    v.settleAt = this.game.renderTime;
  }

  skin(s: Ship, cube: number): CubeSkinUniforms | null {
    return this.views.get(this.key(s, cube))?.u ?? null;
  }

  private drop(s: Ship): void {
    this.bursts = this.bursts.filter((b) => b.e.ship !== s);
    for (const [k, v] of this.views) if (k.startsWith(`${s.id}:`)) v.live = false;
  }

  private clear(): void {
    this.bursts = [];
    for (const v of this.views.values()) this.release(v);
    this.views.clear();
    this.debris.count = 0;
    this.paint.begin();
    this.paint.end();
    this.singularities.clear();
    this.ult.begin();
  }

  private release(v: FreeCube): void {
    this.scene.remove(v.mesh);
    v.material.dispose();
  }

  /** Cubes away from the magnet: everything but docked, shattered and removed ones. */
  private *free(): Generator<[Ship, Cube]> {
    for (const s of this.game.ships) {
      const t = s.tungsten;
      if (!t || s.withdrawn) continue;
      for (const c of t.cubes) if (!c.gone && c.state !== 'docked' && c.state !== 'broken') yield [s, c];
    }
  }

  private renderPos(c: Cube, out: Vector3): Vector3 {
    const a = this.game.alpha;
    return out.set(c.px + (c.x - c.px) * a, c.py + (c.y - c.py) * a, c.pz + (c.z - c.pz) * a);
  }

  update(dt: number, locals: Ship[] = []): void {
    this.locals = locals;
    if (this.game.over) {
      if (this.views.size || this.bursts.length) this.clear();
      return;
    }
    const now = this.game.renderTime;
    this.bursts = this.bursts.filter((b) => this.game.time - b.at < b.life);
    for (const v of this.views.values()) v.live = false;
    for (const [s, c] of this.free()) {
      const k = this.key(s, c.id);
      let v = this.views.get(k);
      if (!v) {
        const { material, u } = cubeSkin();
        const mesh = new Mesh(cubeGeometry(), material);
        mesh.name = `tungsten-free-cube-${k}`;
        mesh.castShadow = this.shadows;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.renderPos(c, this.v);
        v = { mesh, material, u, sweep: new ModeSweep(), trail: [], tumble: 0, yaw: c.yaw, axisX: 1, axisZ: 0, lastX: this.v.x, lastY: this.v.y, lastZ: this.v.z, live: true, gone: -1, struck: -1, face: -1, faceAt: -1, mode: c.mode, base: new Quaternion(), from: new Quaternion(), to: new Quaternion(), settleAt: -1, wobble: 0, die: 0, rainbow: 0, merged: false, mergeAt: -1, mergeFrom: new Vector3() };
        // A cube first seen merging left the magnet for the die this step: it slides in from its slot.
        if (c.state === 'merged') {
          dockPoint(s, c.slot, v.mergeFrom);
          v.lastX = v.mergeFrom.x;
          v.lastY = v.mergeFrom.y;
          v.lastZ = v.mergeFrom.z;
        }
        this.views.set(k, v);
      }
      if (c.state !== 'merged') v.mergeAt = -1;
      else if (v.mergeAt < 0) {
        v.mergeAt = now;
        v.mergeFrom.set(v.lastX, v.lastY, v.lastZ);
      }
      v.live = true;
      v.gone = -1;
      v.mode = c.mode;
      // A cube looks the same every quarter turn: take the short way round to the sim's heading.
      const turn = c.yaw - v.yaw - Math.round((c.yaw - v.yaw) / (Math.PI / 2)) * (Math.PI / 2);
      v.yaw += turn * Math.min(1, dt * 30);
      const p = this.renderPos(c, this.v);
      const moved = Math.hypot(p.x - v.lastX, p.z - v.lastZ);
      if (moved > 0.5 && c.state === 'flying') {
        // The roll axis in the cube's own frame, so it comes to rest on a face however it turns afterwards.
        // Only a throw rolls it: turning the axis under a settled cube would tip it onto an edge.
        const ax = (p.z - v.lastZ) / moved,
          az = -(p.x - v.lastX) / moved;
        const cy = Math.cos(v.yaw),
          sy = Math.sin(v.yaw);
        v.axisX = ax * cy - az * sy;
        v.axisZ = ax * sy + az * cy;
      }
      // Rolling while it flies, a die faster and rocking; settling onto a face once it stops.
      const rolling = c.state === 'flying' && c.path?.kind === 'die';
      const shown = v.face >= 0 && this.game.time - v.faceAt < DIE_SHOW ? clamp01(1 - (this.game.time - v.faceAt - DIE_HOLD) / (DIE_SHOW - DIE_HOLD)) : 0;
      v.die = rolling ? Math.min(1, v.die + dt / 0.15) : shown;
      // A merged die runs rainbow while it rolls and fades back like the faces once it lands.
      v.rainbow = mergedDie(c) ? Math.min(1, v.rainbow + dt / 0.15) : v.merged ? shown : 0;
      if (!this.paint.reduce && rolling) {
        v.tumble += moved / 110;
        v.wobble = 0.45 * Math.sin(c.flown / 240);
      } else if (!this.paint.reduce && c.state === 'flying') v.tumble += moved / 260;
      else {
        const rest = Math.round(v.tumble / (Math.PI / 2)) * (Math.PI / 2);
        v.tumble += (rest - v.tumble) * (1 - Math.exp(-dt * 6));
      }
      // Inside a die it leaves no wake of its own.
      if (c.state !== 'merged' && (moved > 1 || v.trail.length === 0)) v.trail.push(p.x, p.y, p.z, now);
      v.lastX = p.x;
      v.lastY = p.y;
      v.lastZ = p.z;
    }
    for (const [k, v] of this.views) {
      while (v.trail.length && now - v.trail[3] > TRAIL) v.trail.splice(0, 4);
      if (!v.live && v.gone < 0) v.gone = now;
      if (v.gone >= 0 && now - v.gone > 0.65) {
        this.release(v);
        this.views.delete(k);
      }
    }
  }

  get count(): number {
    return this.paint.count;
  }

  /** Post-chain fields: the holes' lenses and the shock fronts of bursts and strikes. */
  get distortions(): SpatialDistortion[] {
    return [...this.singularities.distortions, ...this.ult.distortions];
  }

  setFog(color: Color, density: number): void {
    this.paint.setFog(color, density);
    this.singularities.setFog(color, density);
  }

  private shipVisible(s: Ship, team: Team | -1): boolean {
    return s.alive && !s.withdrawn && (team === -1 || s.team === team || contactVisible(s, team));
  }

  /** A point in the ship's hull space, on the drawn hull when it has a view. */
  private anchor(s: Ship, lx: number, ly: number, lz: number, out: Vector3): Vector3 {
    const m = this.model(s);
    if (m) {
      m.root.updateWorldMatrix(true, false);
      return out.set(lx, ly, lz).applyMatrix4(m.root.matrixWorld);
    }
    const h = s.renderHeading;
    return out.set(s.renderPos.x + Math.sin(h) * lx + Math.cos(h) * lz, s.renderPos.y + ly, s.renderPos.z - Math.cos(h) * lx + Math.sin(h) * lz);
  }

  prepare(team: Team | -1, heightPx: number): void {
    this.paint.begin(heightPx);
    this.ult.begin();
    this.singularities.update(heightPx);
    this.debris.count = 0;
    if (!this.game.over) {
      this.cubes();
      for (const s of this.game.ships) if (s.tungsten && s.alive && !s.withdrawn) this.ship(s, s.tungsten, team);
      for (const b of this.bursts) this.burst(b, team);
    }
    this.paint.end();
    if (this.debris.count) {
      this.debris.instanceMatrix.needsUpdate = true;
      if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
    }
  }

  /** The free cubes: meshes, trails and the levitation field under parked ones. */
  private cubes(): void {
    const now = this.game.renderTime;
    const anim = this.paint.reduce ? 0 : now;
    const alive = new Set<FreeCube>();
    for (const [s, c] of this.free()) {
      const v = this.views.get(this.key(s, c.id));
      if (!v) continue;
      alive.add(v);
      const t = s.tungsten!;
      const p = this.renderPos(c, this.v);
      const parked = c.state === 'hover' || c.state === 'guard' || c.state === 'orbit';
      // A spent cube sits low and dark in the water until it docks or recharges; it flies and guards lit.
      const spent = t.spent && c === t.cubes[0] && c.state === 'hover';
      const bob = parked && !spent && !this.paint.reduce ? Math.sin(anim * 1.3 + c.id * 1.7) * 1.6 : 0;
      const ult = this.ult.cubeLook(s, c);
      const lift = pileLift(c) + (ult?.lift ?? 0);
      let size = CUBE.edge * c.scale * (ult?.size ?? 1);
      let rise = 0;
      if (c.state === 'merged') {
        // Sliding into the die and shrinking away inside it.
        const k = this.paint.reduce ? 1 : ease(clamp01((now - v.mergeAt) / MERGE));
        p.lerpVectors(v.mergeFrom, p, k);
        size *= 1 - k;
      } else if (v.merged && !this.paint.reduce && c.scale === 1) {
        // A landed merged die shrinks back to a cube, its base staying on the water.
        const grow = (CUBE.die.merged - 1) * (1 - ease(clamp01((this.game.time - v.faceAt) / MERGE)));
        size *= 1 + grow;
        rise = H * grow;
      }
      // The cubes it held burst out of it, growing to size as they clear its faces.
      if (c.path?.kind === 'spread') size *= 0.55 + 0.45 * ease(clamp01(c.flown / H));
      v.mesh.visible = size > 0.5;
      // A cube flying out to the Overdrive ring bows aside, so a cube swapping onto the dais never passes through it.
      const P = c.path;
      if (P?.kind === 'home' && c.slot > 0 && overdriveOn(s) && !this.paint.reduce) {
        const dx = P.tx - c.x,
          dz = P.tz - c.z,
          d = Math.hypot(dx, dz);
        if (d > 1) {
          const bow = SWAP_BOW * Math.sin(Math.PI * clamp01(c.flown / Math.max(1, c.flown + Math.hypot(d, P.ty - c.y))));
          p.x -= (dz / d) * bow;
          p.z += (dx / d) * bow;
        }
      }
      v.mesh.position.set(p.x, p.y + bob + lift + rise + (this.paint.reduce ? 0 : dieHop(c)), p.z);
      v.mesh.scale.setScalar(Math.max(0.01, size));
      if (v.settleAt >= 0) {
        const k = this.paint.reduce ? 1 : clamp01((this.game.renderTime - v.settleAt) / DIE_SETTLE);
        v.base.slerpQuaternions(v.from, v.to, ease(k));
        if (k >= 1) v.settleAt = -1;
      }
      this.q.setFromAxisAngle(this.up, v.yaw + (parked && !this.paint.reduce ? Math.sin(anim * 0.4 + c.id) * 0.05 : 0));
      v.mesh.quaternion.copy(this.q).multiply(this.lie(v, this.q2));
      // A landed die wipes to the face it rolled, then back to its own mode.
      const rolled = v.face >= 0 && this.game.time - v.faceAt < DIE_SHOW;
      v.sweep.apply(v.u, rolled ? v.face : c.mode, now, this.paint.reduce);
      v.u.uDie.value = v.die;
      v.u.uRainbow.value = v.rainbow;
      const flash = Math.max(clamp01(1 - (this.game.time - v.struck) / 0.25), rolled ? clamp01(1 - (this.game.time - v.faceAt) / 0.5) : 0);
      const sputter = this.paint.reduce ? 0.2 : hash01(c.id, Math.floor(now * 12)) < 0.18 ? 0.3 : 0.12;
      const power = 1.3 + (t.charge / CUBE.chargeCap) * 1.6 + (c.state === 'flying' ? 0.5 : 0) + (c.state === 'guard' ? 0.4 : 0) + flash * 1.5;
      v.u.uTime.value = anim;
      v.u.uPower.value = ult ? ult.power : spent ? sputter : power;
      v.u.uFlicker.value = Math.max(c.hp < c.maxHp * 0.3 ? 1 - c.hp / (c.maxHp * 0.3) : 0, spent ? 0.5 : 0);
      v.u.uAssemble.value = 1;
      v.u.uHeat.value = ult?.heat ?? 0;
      const color = modeColor(c.mode);
      // The Shield store rides every cube: the etching heats toward white and arcs crackle over the faces.
      const store = !ult && !spent && t.charge > 0 ? storeLook(t.charge / (CUBE.chargeCap * (overdriveOn(s) ? CUBE.orbit.cap : 1))) : null;
      v.u.uStore.value = store?.heat ?? 0;
      if (store && v.mesh.visible) this.storeArcs(c, v, store, color, now);
      // Trail: a wide coloured wake with a white-hot core.
      for (let i = 4; i < v.trail.length; i += 4) {
        const age = now - v.trail[i + 3],
          k = 1 - age / TRAIL;
        if (k <= 0) continue;
        // A grown meteor keeps a cube-sized wake; its fire trail is drawn by the ult effects.
        const w = CUBE.edge * Math.min(c.scale, 1.5) * 0.7;
        this.trails.push(v.trail[i - 4], v.trail[i - 3], v.trail[i - 2], v.trail[i], v.trail[i + 1], v.trail[i + 2], hot(color, 1.6), 0.55 * k, w, 2);
        this.trails.push(v.trail[i - 4], v.trail[i - 3], v.trail[i - 2], v.trail[i], v.trail[i + 1], v.trail[i + 2], hot(WHITE, 1.4), 0.5 * k, w * 0.25, 1);
        // The pressure wave behind a low, fast cube throws up a rooster tail.
        const sx = v.trail[i],
          sz = v.trail[i + 2];
        if (c.state === 'flying' && v.trail[i + 1] < 120 && hash01(c.id * 131 + Math.round(v.trail[i + 3] * 60), 1) < 0.6 * this.paint.detail) {
          const base = this.paint.surface(sx, sz),
            h = drift(age, 110, 2.5, 120);
          if (h > 0) this.particles.push(BK.Spray, sx, base + h, sz, 22 + age * 160, SPRAY, 0.55 * k, hash01(i, c.id) * TAU, hash01(c.id, i));
        }
      }
      if (spent) {
        // Settled in the sea: a slack ring of foam and a dying glow.
        this.paint.ring(p.x, p.z, H * c.scale * 1.15, FOAM, 0.35, BK.Foam, anim * 0.2 + c.id);
        this.paint.ring(p.x, p.z, H * c.scale * 1.3, hot(color, 0.5), 0.12 + 0.1 * sputter);
      } else if (parked || c.state === 'flying') {
        // The levitation field pressing a dish into the sea under the cube.
        const base = this.paint.surface(p.x, p.z);
        const height = p.y - base;
        const k = clamp01(1 - height / 200);
        if (k > 0) {
          this.paint.ring(p.x, p.z, CUBE.edge * c.scale * (0.85 + 0.08 * Math.sin(anim * 3 + c.id)), hot(color, 1.3), 0.45 * k);
          this.paint.ring(p.x, p.z, CUBE.edge * c.scale * 0.95, FOAM, 0.4 * k, BK.Foam, anim * 0.5 + c.id);
          this.particles.push(BK.Glow, p.x, base + 2, p.z, CUBE.edge * c.scale * 2.2, hot(color, 0.7), 0.3 * k);
          if (parked && !this.paint.reduce)
            for (let i = 0; i < Math.round(6 * this.paint.detail); i++) {
              const life = 1.4,
                phase = (anim / life + hash01(c.id, i)) % 1,
                a = hash01(c.id * 7, i) * TAU + anim * 0.3,
                r = CUBE.edge * c.scale * (0.6 + phase * 0.6);
              this.particles.push(BK.Spray, p.x + Math.cos(a) * r, base + phase * 14, p.z + Math.sin(a) * r, 10 + phase * 18, SPRAY, 0.3 * (1 - phase), a, i);
            }
        }
        if (c.path?.kind === 'shot') this.wake(c, c.path.tx, c.path.tz, p.x, p.z, color, anim);
      }
    }
    // Cubes that left: dissolving where they were last drawn.
    for (const v of this.views.values()) {
      if (alive.has(v)) continue;
      if (v.gone < 0) {
        v.mesh.visible = false;
        continue;
      }
      const k = (now - v.gone) / 0.6;
      v.mesh.visible = k < 1;
      v.u.uAssemble.value = Math.max(0.001, 1 - k);
      v.u.uTime.value = anim;
    }
  }

  /**
   * Arcs over a cube holding a Shield store, re-struck six times a second on random faces; more and longer as it
   * fills, and from 90% a few leap from its base into the sea.
   */
  private storeArcs(c: Cube, v: FreeCube, look: ReturnType<typeof storeLook>, color: Color, now: number): void {
    const m = v.mesh;
    const size = m.scale.x;
    const bucket = this.paint.reduce ? 0 : Math.floor(now * 6);
    const tint = this.storeTint.copy(color).lerp(WHITE, look.heat * 0.7);
    const world = (p: Vector3) => p.multiplyScalar(size).applyQuaternion(m.quaternion).add(m.position);
    const a = this.v2,
      b = this.v3,
      n = this.v;
    for (let i = 0; i < this.paint.n(look.arcs); i++) {
      const seed = c.id * 131 + i * 17;
      dieFaceNormal(Math.floor(hash01(seed, bucket) * 6), n);
      // The face's two in-plane axes.
      const ux = n.x !== 0 ? 0 : 1,
        uy = n.x !== 0 ? 1 : 0,
        uz = 0;
      const wx = 0,
        wy = n.z !== 0 ? 1 : 0,
        wz = n.z !== 0 ? 0 : 1;
      const s0 = hash01(seed + 1, bucket) * 0.8 - 0.4,
        t0 = hash01(seed + 2, bucket) * 0.8 - 0.4,
        ang = hash01(seed + 3, bucket) * TAU,
        len = look.reach * 0.5;
      const s1 = clamp(s0 + Math.cos(ang) * len, -0.48, 0.48),
        t1 = clamp(t0 + Math.sin(ang) * len, -0.48, 0.48);
      world(a.set(n.x * 0.505 + ux * s0 + wx * t0, n.y * 0.505 + uy * s0 + wy * t0, n.z * 0.505 + uz * s0 + wz * t0));
      world(b.set(n.x * 0.505 + ux * s1 + wx * t1, n.y * 0.505 + uy * s1 + wy * t1, n.z * 0.505 + uz * s1 + wz * t1));
      this.paint.arc(a.x, a.y, a.z, b.x, b.y, b.z, seed + bucket, hot(tint, 2 + look.heat * 2), 0.45 + 0.45 * look.heat, 1.2 + look.heat * 1.6, size * len * 0.12, 6);
    }
    if (!look.strike) return;
    for (let i = 0; i < 3; i++) {
      const seed = c.id * 71 + i * 29;
      const ox = (hash01(seed, bucket) - 0.5) * size * 0.8,
        oz = (hash01(seed + 1, bucket) - 0.5) * size * 0.8;
      const fx = m.position.x + ox,
        fz = m.position.z + oz,
        fy = m.position.y - size / 2;
      const sx = fx + ox * 0.9,
        sz = fz + oz * 0.9;
      this.paint.arc(fx, fy, fz, sx, this.paint.surface(sx, sz), sz, seed + bucket, hot(tint, 3.5), 0.9, 2.6, 14, 10);
    }
  }

  /** A thrown cube's bow wave toward (tx, tz): foam piled ahead of its leading face and spray peeling off both sides. */
  private wake(c: Cube, tx: number, tz: number, x: number, z: number, color: Color, anim: number): void {
    const d = Math.hypot(tx - x, tz - z);
    if (d < 1) return;
    const ux = (tx - x) / d,
      uz = (tz - z) / d,
      h = H * c.scale,
      k = 1;
    const base = this.paint.surface(x, z);
    this.paint.ring(x + ux * h, z + uz * h, h * (0.55 + 0.35 * k), FOAM, 0.6 * k, BK.Foam, anim + c.id);
    this.paint.ring(x + ux * h * 0.8, z + uz * h * 0.8, h * (0.8 + 0.4 * k), hot(color, 1.2), 0.3 * k);
    if (this.paint.reduce) return;
    for (let i = 0; i < this.paint.n(10); i++) {
      const phase = (anim * 2.2 + hash01(c.id, i)) % 1,
        side = i % 2 ? 1 : -1;
      const along = h * (0.9 - phase * 2.2),
        out = h * (1.05 + phase * 0.8);
      this.particles.push(BK.Spray, x + ux * along - uz * side * out, base + 4 + phase * 30 * k, z + uz * along + ux * side * out, 16 + phase * 40, SPRAY, 0.5 * k * (1 - phase), side, i);
    }
  }

  /** The ship's four horn tips in world space, on the drawn hull. */
  private hornTips(s: Ship): Vector3[] {
    HORN_TIPS.forEach((h, i) => this.anchor(s, h.x, h.y, h.z, this.tips[i]));
    return this.tips;
  }

  private nearestTip(tips: Vector3[], x: number, z: number): Vector3 {
    let best = tips[0];
    for (const tip of tips) if (Math.hypot(tip.x - x, tip.z - z) < Math.hypot(best.x - x, best.z - z)) best = tip;
    return best;
  }

  /** Effects tied to a Tungsten's own state: Shield arcs, tethers, reels and slams, the Lunge and the idle dais. */
  private ship(s: Ship, t: TungstenState, team: Team | -1): void {
    const now = this.game.renderTime;
    const seen = this.shipVisible(s, team);
    this.ult.state(s, t, team, this.paint.reduce, seen);
    const tips = this.hornTips(s);
    const lead = t.cubes[0];
    const mode = modeColor(t.mode);
    // Idle crackle from the horn tips up to the floating cube's base; livelier as the Shield store fills.
    if (seen && lead?.state === 'docked') {
      const base = dockLift(s.spec) - H;
      const charge = t.charge / CUBE.chargeCap;
      HORN_TIPS.forEach((h, i) => {
        const on = this.paint.reduce || hash01(s.id * 17 + i, Math.floor(now * 9)) < 0.45 + charge * 0.5;
        if (!on) return;
        const ox = (hash01(s.id + i, Math.floor(now * 20)) - 0.5) * 16,
          oz = (hash01(s.id + i * 5, Math.floor(now * 20)) - 0.5) * 16;
        const foot = this.anchor(s, h.x * 1.6 + ox, base + 0.5, h.z * 1.6 + oz, this.v2);
        const tip = tips[i];
        this.paint.arc(tip.x, tip.y, tip.z, foot.x, foot.y, foot.z, s.id * 97 + i, hot(mode, 2.2), 0.8, 1.6, 3.5, 6);
      });
    }
    // In Overdrive the central cube feeds the five in its halo; with it away, the horn nearest each feeds it.
    if (seen && overdriveOn(s)) {
      const hub = lead?.state === 'docked' ? this.renderPos(lead, this.v2) : null;
      for (const c of t.cubes) {
        if (c === lead || c.state !== 'docked' || hash01(c.id * 17, Math.floor(now * 9)) > 0.6) continue;
        const p = this.renderPos(c, this.v);
        if (hub) {
          // Face to face, not centre to centre.
          const d = Math.max(1, Math.hypot(p.x - hub.x, p.y - hub.y, p.z - hub.z)),
            k = H / d;
          const ux = (p.x - hub.x) * k,
            uy = (p.y - hub.y) * k,
            uz = (p.z - hub.z) * k;
          this.paint.arc(hub.x + ux, hub.y + uy, hub.z + uz, p.x - ux, p.y - uy, p.z - uz, c.id * 97, hot(modeColor(c.mode), 2.2), 0.8, 1.6, 8, 10);
        } else {
          const tip = this.nearestTip(tips, p.x, p.z);
          this.paint.arc(tip.x, tip.y, tip.z, p.x, p.y - H, p.z, c.id * 97, hot(modeColor(c.mode), 2.2), 0.8, 1.6, 8, 10);
        }
      }
    }
    // Shield: field lines from the crown to each guarding cube, and the capture shimmer around it.
    for (const c of t.cubes) {
      if (c.state !== 'guard') continue;
      const p = this.renderPos(c, this.v);
      const color = modeColor(c.mode);
      const radius = c.mode === modeOf('repel') ? CUBE.guard.repelRadius : CUBE.guard.radius;
      if (seen) {
        const tip = this.nearestTip(tips, p.x, p.z);
        for (let i = 0; i < 3; i++) this.paint.arc(tip.x, tip.y, tip.z, p.x, p.y - H * 0.8, p.z, c.id * 13 + i, hot(color, 2), 0.7 - i * 0.15, 2.4 - i * 0.6, 16 + i * 8, 12);
      }
      const pulse = this.paint.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * 5 + c.id);
      this.paint.field(p.x, p.y, p.z, radius * 1.15, hot(color, 1.8), 0.55 + pulse * 0.2, this.paint.reduce ? 0 : now * 0.35 + c.id);
      this.paint.ring(p.x, p.z, radius, hot(color, 1.2), 0.35, BK.Hex, now * 0.2);
    }
    // Tether chains to every hull the cubes hold.
    for (const x of t.tethers) {
      const c = t.cubes.find((k) => k.id === x.cube);
      const o = this.game.ships.find((k) => k.id === x.target);
      if (!c || !o?.alive) continue;
      const p = this.renderPos(c, this.v);
      const color = modeColor(TETHER);
      const d = Math.hypot(o.renderPos.x - p.x, o.renderPos.z - p.z);
      const fade = clamp01((x.until - this.game.time) / 0.4);
      this.paint.chain(p.x, p.y, p.z, o.renderPos.x, o.renderPos.y + o.spec.freeboard + 4, o.renderPos.z, hot(color, 1.8), 0.85 * fade, Math.min(70, d * 0.12), 1.2);
      this.paint.loop(o.renderPos.x, o.renderPos.y + o.spec.freeboard + 4, o.renderPos.z, o.spec.beam * 0.9, hot(color, 1.6), 0.45 * fade);
      this.paint.ring(o.renderPos.x, o.renderPos.z, o.spec.length * 0.55, hot(color, 1), 0.25 * fade);
    }
    for (const a of t.acts) {
      const c = t.cubes.find((k) => k.id === a.cube);
      if (c?.state === 'docked' && !seen) continue;
      const color = modeColor(c?.mode ?? t.mode);
      const k = a.elapsed / a.time;
      if (a.kind === 'reel') {
        // Taut chains haul the caught pair into each other, or a lone hull into the cube.
        const pair = a.targets.length > 1;
        const p = pair ? this.v.set(a.x, 40, a.z) : c ? this.renderPos(c, this.v) : null;
        if (!p) continue;
        for (const id of a.targets) {
          const o = this.game.ships.find((x) => x.id === id);
          if (!o?.alive) continue;
          this.paint.chain(p.x, p.y, p.z, o.renderPos.x, o.renderPos.y + o.spec.freeboard + 4, o.renderPos.z, hot(color, 2.2), 0.95, 0, 3);
        }
        if (pair) this.paint.loop(a.x, 40, a.z, 50 + 150 * (1 - ease(k)), hot(color, 2), 0.7);
        this.paint.ring(a.x, a.z, a.radius * (1 - ease(k)), hot(color, 1.5), 0.6 * (1 - k));
      } else if (a.kind === 'pin') {
        // The cube on the deck, the hull pressed into the sea under rings of force.
        const o = this.game.ships.find((x) => x.id === a.targets[0]);
        if (!o?.alive) continue;
        const now = this.game.renderTime;
        const pulse = this.paint.reduce ? 1 : 0.75 + 0.25 * Math.sin(now * 9);
        const L = o.spec.length * 0.6;
        this.paint.ring(o.renderPos.x, o.renderPos.z, L, hot(color, 1.6), 0.7 * pulse * (1 - 0.5 * k));
        if (!this.paint.reduce) this.paint.ring(o.renderPos.x, o.renderPos.z, L * (1 - 0.4 * ((now * 1.5) % 1)), hot(WHITE, 1.1), 0.35 * (1 - k));
        this.paint.foamRing(o.renderPos.x, o.renderPos.z, L * 0.9, 0.45 * (1 - k), a.cube);
        this.paint.loop(o.renderPos.x, o.renderPos.y + o.spec.freeboard + 6, o.renderPos.z, o.spec.beam * 0.9, hot(color, 2), 0.6 * pulse);
      } else if (a.kind === 'mirror' && c) {
        this.mirrorBubble(this.renderPos(c, this.v), a.radius, color, clamp01(a.elapsed / 0.3) * clamp01((a.time - a.elapsed) / 0.5), a.cube);
      }
    }
    // Lunge: the hull drawn down a magnetic rail toward the cube, field lines leading it in.
    const L = t.lunge;
    if (L && seen) {
      const c = t.cubes.find((k) => k.id === L.cube);
      const h = s.renderHeading,
        fx = Math.sin(h),
        fz = -Math.cos(h),
        rx = Math.cos(h),
        rz = Math.sin(h);
      const half = s.spec.length / 2;
      for (const side of [-1, 1]) {
        const ox = rx * side * (s.spec.beam / 2 + 6),
          oz = rz * side * (s.spec.beam / 2 + 6);
        this.trails.push(L.x0 + ox, 14, L.z0 + oz, s.renderPos.x + ox + fx * half * 0.6, 14, s.renderPos.z + oz + fz * half * 0.6, hot(mode, 2), 0.7, 10, 2);
        this.trails.push(L.x0 + ox, 30, L.z0 + oz, s.renderPos.x + ox, 30, s.renderPos.z + oz, hot(WHITE, 1.5), 0.45, 3, 1);
      }
      if (c) {
        const p = this.renderPos(c, this.v2);
        const tip = this.nearestTip(tips, p.x, p.z);
        for (let i = 0; i < 3; i++) this.paint.arc(tip.x, tip.y, tip.z, p.x, p.y, p.z, s.id * 7 + i, hot(mode, 2.4), 0.85, 3 - i * 0.8, 30 + i * 20, 16);
      }
      // Bow wave thrown by the dragged hull.
      for (const side of [-1, 1]) this.paint.ring(s.renderPos.x + fx * half * 0.8 + rx * side * 40, s.renderPos.z + fz * half * 0.8 + rz * side * 40, 70, FOAM, 0.5, BK.Foam, side);
    }
  }

  private burst(b: Burst, team: Team | -1): void {
    const e = b.e,
      s = e.ship;
    const age = this.game.renderTime - b.at;
    if (age < 0) return;
    const f = age / b.life;
    if (f >= 1) return;
    const color = modeColor(e.mode);
    const p = this.particles;
    const n = (count: number) => this.paint.n(count);
    const R = (i: number, j: number) => hash01(b.id * 977 + i, j);
    const seen = this.shipVisible(s, team);
    // The ults are overt: everyone sees them.
    if (this.ult.burst(e, b.id, age, f, color)) return;
    // A docked cube rides its hull, so whatever it does there is seen only when the hull is.
    const c = s.tungsten?.cubes.find((k) => k.id === e.cube);
    if (c?.state === 'docked' && !seen) return;
    switch (e.kind) {
      case 'throw': {
        if (!seen) return;
        if (age < 0.15) p.push(BK.Flare, e.x, e.y, e.z, 160 * (1 - age / 0.15) + 40, hot(WHITE, 1.5), 1 - age / 0.15);
        this.paint.loop(e.x, e.y, e.z, 30 + 130 * ease(age / 0.4), hot(color, 1.8), 0.8 * (1 - f));
        for (let i = 0; i < n(18); i++) {
          const side = i % 2 ? 1 : -1,
            a = R(i, 0) * TAU,
            v = 60 + 90 * R(i, 1);
          const o = this.anchor(s, (R(i, 2) - 0.5) * H, dockLift(s.spec) + (R(i, 3) - 0.5) * CUBE.edge, side * (H + 5), this.v);
          p.push(BK.Spark, o.x + Math.cos(a) * drift(age, v, 3), o.y + drift(age, v * 0.4, 3, 30), o.z + Math.sin(a) * drift(age, v, 3), 1.2, hot(color, 2.4), 1 - f, 0, 0, Math.cos(a) * 4, 2, Math.sin(a) * 4, 1.4);
        }
        return;
      }
      case 'hit':
      case 'contact': {
        const x = e.kind === 'hit' ? b.tx : e.x,
          z = e.kind === 'hit' ? b.tz : e.z,
          y = Math.max(20, e.y);
        if (age < 0.18) p.push(BK.Flare, x, y, z, 120, hot(WHITE, 1.8), 1 - age / 0.18, R(0, 0));
        p.push(BK.Glow, x, y, z, 260 * (0.5 + ease(age / 0.3) * 0.5), hot(color, 1.2), 0.45 * (1 - f));
        this.paint.loop(x, y, z, 40 + 180 * ease(age / 0.45), hot(color, 1.6), 0.7 * (1 - clamp01(age / 0.5)));
        for (let i = 0; i < n(28); i++) {
          const a = R(i, 1) * TAU,
            up = 40 + 160 * R(i, 2),
            v = 90 + 220 * R(i, 3);
          const pl = 0.4 + 0.5 * R(i, 4);
          if (age > pl) continue;
          p.push(BK.Spark, x + Math.cos(a) * drift(age, v, 2.4), y + drift(age, up, 2.4, 140), z + Math.sin(a) * drift(age, v, 2.4), 1.6, tint2.copy(WHITE).lerp(color, age / pl).multiplyScalar(2.4), 1 - age / pl, 0, 0, Math.cos(a) * 5, 2, Math.sin(a) * 5, 1.6);
        }
        const base = this.paint.surface(x, z);
        for (let i = 0; i < n(10); i++) {
          const a = R(i, 6) * TAU,
            r = 20 + 50 * R(i, 7),
            h = drift(age, 70 + 90 * R(i, 8), 1.4, 90);
          if (h > 0) p.push(BK.Spray, x + Math.cos(a) * r, base + h, z + Math.sin(a) * r, 24 + age * 60, SPRAY, 0.6 * (1 - f), a, R(i, 9));
        }
        this.modeHit(b, x, y, z, age, f, color);
        return;
      }
      case 'land':
      case 'arrive': {
        if (e.kind === 'arrive' && !seen) return;
        const base = this.paint.surface(e.x, e.z);
        const r = e.kind === 'arrive' ? s.spec.length * 0.5 : CUBE.edge * 1.4;
        if (e.kind === 'arrive') this.paint.foamRing(e.x, e.z, r * (0.5 + ease(age / 0.6)), 0.6 * (1 - f), b.id);
        else this.paint.ring(e.x, e.z, r * (0.5 + ease(age / 0.6)), FOAM, 0.6 * (1 - f), BK.Foam, b.id);
        this.paint.ring(e.x, e.z, r * 1.4 * ease(age / 0.5), hot(color, 1.4), 0.6 * (1 - clamp01(age / 0.6)));
        for (let i = 0; i < n(16); i++) {
          const a = (i / 16) * TAU + R(i, 0) * 0.3,
            out = r * (0.6 + 0.4 * R(i, 1)) + drift(age, 60, 2),
            h = drift(age, 50 + 70 * R(i, 2), 1.6, 80);
          if (h > 0) p.push(BK.Spray, e.x + Math.cos(a) * out, base + h, e.z + Math.sin(a) * out, 20 + age * 40, SPRAY, 0.55 * (1 - f), a, R(i, 3));
        }
        return;
      }
      case 'dock': {
        if (!seen) return;
        const top = this.anchor(s, 0, dockLift(s.spec) + H, 0, this.v);
        if (age < 0.12) p.push(BK.Flare, top.x, top.y, top.z, 200, hot(WHITE, 1.6), 1 - age / 0.12);
        this.paint.loop(top.x, top.y - CUBE.edge / 2, top.z, CUBE.edge * (0.8 + ease(age / 0.3)), hot(color, 2), 0.8 * (1 - f));
        for (let i = 0; i < n(20); i++) {
          const a = R(i, 0) * TAU,
            v = 80 + 120 * R(i, 1);
          p.push(BK.Spark, top.x + Math.cos(a) * drift(age, v, 4), top.y + drift(age, 40, 4, 60), top.z + Math.sin(a) * drift(age, v, 4), 1.2, hot(color, 2.6), 1 - f, 0, 0, Math.cos(a) * 3, 1, Math.sin(a) * 3, 1.2);
        }
        return;
      }
      case 'break':
        this.shatter(b, age, f, color);
        return;
      case 'reform': {
        if (!seen) return;
        const o = this.anchor(s, 0, dockLift(s.spec), 0, this.v);
        p.push(BK.Glow, o.x, o.y, o.z, 200 * (1 - f * 0.5), hot(color, 1.4), 0.6 * (1 - f));
        // Motes drawn in from all round onto the cradle.
        for (let i = 0; i < n(30); i++) {
          const a = R(i, 0) * TAU,
            el = (R(i, 1) - 0.3) * 1.4,
            k = ease(clamp01(age / (0.5 + 0.4 * R(i, 2))));
          const r = 220 * (1 - k) + 10;
          p.push(BK.Spark, o.x + Math.cos(a) * Math.cos(el) * r, o.y + Math.sin(el) * r, o.z + Math.sin(a) * Math.cos(el) * r, 1.4, hot(color, 2.4), 1 - f, 0, 0, -Math.cos(a) * 3, -Math.sin(el) * 3, -Math.sin(a) * 3, 1.4);
        }
        return;
      }
      case 'switch': {
        const o = c?.state === 'docked' ? this.anchor(s, 0, dockLift(s.spec), 0, this.v) : this.v.set(e.x, e.y, e.z);
        this.paint.loop(o.x, o.y, o.z, CUBE.edge * (0.7 + 1.2 * ease(age / 0.4)), hot(color, 2.2), 0.8 * (1 - f));
        if (age < 0.1) p.push(BK.Flare, o.x, o.y, o.z, 140, hot(color, 1.6), 1 - age / 0.1);
        return;
      }
      case 'signature':
        this.signature(b, age, f, color);
        return;
      case 'slam': {
        const base = this.paint.surface(e.x, e.z);
        if (age < 0.2) p.push(BK.Flare, e.x, base + 30, e.z, 420, hot(WHITE, 1.4), 1 - age / 0.2);
        p.push(BK.Glow, e.x, base + 20, e.z, e.radius * 1.6, hot(color, 1.1), 0.5 * (1 - clamp01(age / 0.5)));
        this.paint.ring(e.x, e.z, e.radius * ease(age / 0.45), hot(color, 1.8), 0.9 * (1 - clamp01(age / 0.7)));
        this.paint.ring(e.x, e.z, e.radius * 0.9 * ease(age / 0.3), hot(WHITE, 1.2), 0.5 * (1 - clamp01(age / 0.4)));
        this.paint.ring(e.x, e.z, CUBE.edge * 2.2, FOAM, 0.7 * (1 - f), BK.Foam, b.id);
        this.paint.foamRing(e.x, e.z, e.radius * (0.5 + 0.5 * ease(age / 0.8)), 0.65 * (1 - f), b.id);
        // A wall of water thrown up all round the impact.
        for (let i = 0; i < n(44); i++) {
          const a = (i / 44) * TAU + R(i, 0) * 0.2,
            r = CUBE.edge + drift(age, e.radius * (1.2 + 0.6 * R(i, 1)), 2.2),
            h = drift(age, 160 + 200 * R(i, 2), 1.3, 260);
          if (h > 0) p.push(BK.Spray, e.x + Math.cos(a) * r, base + h, e.z + Math.sin(a) * r, (24 + 20 * R(i, 3)) * (1 + f * 1.5), SPRAY, 0.7 * (1 - f), a, R(i, 4));
        }
        for (let i = 0; i < n(30); i++) {
          const a = R(i, 5) * TAU,
            v = 200 + 300 * R(i, 6);
          if (age > 0.6) break;
          p.push(BK.Spark, e.x + Math.cos(a) * drift(age, v, 2), base + 10 + drift(age, 120, 2, 200), e.z + Math.sin(a) * drift(age, v, 2), 1.8, hot(color, 2.4), 1 - age / 0.6, 0, 0, Math.cos(a) * 6, 1, Math.sin(a) * 6, 1.6);
        }
        return;
      }
      case 'reel': {
        if (age < 0.15) p.push(BK.Flare, e.x, 40, e.z, 260, hot(WHITE, 1.5), 1 - age / 0.15);
        this.paint.loop(e.x, 40, e.z, 80 + 260 * ease(age / 0.5), hot(color, 2), 0.8 * (1 - f));
        return;
      }
      case 'lunge': {
        if (!seen) return;
        if (age < 0.2) p.push(BK.Flare, e.x, 40, e.z, 300, hot(color, 1.4), 1 - age / 0.2);
        this.paint.ring(e.x, e.z, s.spec.length * 0.6 * (0.5 + ease(age / 0.5)), hot(color, 1.4), 0.6 * (1 - f));
        return;
      }
      case 'capture': {
        const to = c ? this.renderPos(c, this.v) : this.v.set(e.x, e.y, e.z);
        // Sparks wrenched off course into the cube.
        for (let i = 0; i < n(8); i++) {
          const k = ease(clamp01(age / (0.25 + 0.15 * R(i, 0))));
          const ox = (R(i, 1) - 0.5) * 40,
            oy = (R(i, 2) - 0.5) * 40,
            oz = (R(i, 3) - 0.5) * 40;
          p.push(BK.Spark, e.x + ox + (to.x - e.x - ox) * k, e.y + oy + (to.y - e.y - oy) * k, e.z + oz + (to.z - e.z - oz) * k, 1.2, hot(color, 2.6), 1 - f, 0, 0, (to.x - e.x) * 0.02, (to.y - e.y) * 0.02, (to.z - e.z) * 0.02, 1.4);
        }
        this.paint.loop(to.x, to.y, to.z, CUBE.edge * (0.7 + 0.5 * ease(age / 0.3)), hot(color, 1.8), 0.5 * (1 - f));
        return;
      }
      case 'block': {
        if (age < 0.08) p.push(BK.Flare, e.x, e.y, e.z, 50, hot(WHITE, 1.6), 1 - age / 0.08);
        for (let i = 0; i < n(10); i++) {
          const a = R(i, 0) * TAU,
            v = 60 + 120 * R(i, 1);
          p.push(BK.Spark, e.x + Math.cos(a) * drift(age, v, 3), e.y + drift(age, 60 * R(i, 2), 3, 80), e.z + Math.sin(a) * drift(age, v, 3), 1, hot(WHITE, 2), 1 - f, 0, 0, Math.cos(a) * 3, 1, Math.sin(a) * 3, 1.2);
        }
        return;
      }
      case 'mirror': {
        // A shell turned on the bubble: a flash where it struck, and a streak flung back toward its firer.
        if (age < 0.18) p.push(BK.Flare, e.x, e.y, e.z, 170, hot(color, 2.2), 1 - age / 0.18);
        this.paint.loop(e.x, e.y, e.z, 20 + 70 * ease(age / 0.25), hot(WHITE, 2), 0.8 * (1 - clamp01(age / 0.3)));
        const dx = b.tx - e.x,
          dz = b.tz - e.z,
          d = Math.hypot(dx, dz) || 1;
        const run = 260 * ease(age / 0.3);
        this.trails.push(e.x + (dx / d) * run * 0.3, e.y, e.z + (dz / d) * run * 0.3, e.x + (dx / d) * run, e.y, e.z + (dz / d) * run, hot(color, 2.4), 0.9 * (1 - f), 4, 2);
        return;
      }
      case 'spent': {
        // The cube drops into the sea: a splash ring and a short wall of spray, its glow dying.
        const base = this.paint.surface(e.x, e.z);
        this.paint.ring(e.x, e.z, H * (1 + 1.2 * ease(age / 0.6)), FOAM, 0.6 * (1 - f), BK.Foam, b.id);
        p.push(BK.Glow, e.x, base + 10, e.z, CUBE.edge * 2 * (1 - f * 0.6), hot(color, 0.8), 0.4 * (1 - clamp01(age / 0.5)));
        for (let i = 0; i < n(20); i++) {
          const a = (i / 20) * TAU + R(i, 0) * 0.3,
            out = H * (1 + 0.3 * R(i, 1)) + drift(age, 40, 2),
            h = drift(age, 40 + 60 * R(i, 2), 1.6, 70);
          if (h > 0) p.push(BK.Spray, e.x + Math.cos(a) * out, base + h, e.z + Math.sin(a) * out, 20 + age * 40, SPRAY, 0.55 * (1 - f), a, R(i, 3));
        }
        return;
      }
      case 'charged': {
        // The etching wakes: a flare off the cube and a ring of field round it.
        const o = c?.state === 'docked' ? this.anchor(s, 0, dockLift(s.spec), 0, this.v) : c ? this.renderPos(c, this.v) : this.v.set(e.x, e.y, e.z);
        if (age < 0.2) p.push(BK.Flare, o.x, o.y, o.z, 160 * (1 - age / 0.2) + 60, hot(WHITE, 1.2), 1 - age / 0.2);
        p.push(BK.Glow, o.x, o.y, o.z, CUBE.edge * 2, hot(color, 0.9), 0.5 * (1 - f));
        this.paint.loop(o.x, o.y, o.z, CUBE.edge * (0.8 + 1.4 * ease(age / 0.5)), hot(color, 2.2), 0.8 * (1 - f));
        return;
      }
      case 'die': {
        // The die erupts out to its blast radius in the colour of the face it rolled; a jackpot rings in all six.
        const base = this.paint.surface(e.x, e.z);
        const face = modeColor(e.face ?? e.mode);
        const k = ease(age / 0.5);
        if (e.jackpot) for (let m = 0; m < 6; m++) this.paint.ring(e.x, e.z, e.radius * k * (0.7 + m * 0.06), hot(modeColor(m), 2), 0.7 * (1 - f));
        else this.paint.ring(e.x, e.z, e.radius * k, hot(face, 2), 0.8 * (1 - f));
        this.paint.ring(e.x, e.z, H + e.radius * 0.5 * k, FOAM, 0.5 * (1 - f), BK.Foam, b.id);
        if (age < 0.2) p.push(BK.Flare, e.x, base + H, e.z, 420 * (1 - age / 0.2) + 80, hot(WHITE, 1.8), 1 - age / 0.2);
        p.push(BK.Glow, e.x, base + H, e.z, CUBE.edge * 3, hot(face, 1.2), 0.5 * (1 - f));
        for (let i = 0; i < n(40); i++) {
          const a = R(i, 0) * TAU,
            v = 200 + 360 * R(i, 1);
          const tint = e.jackpot ? modeColor(i % 6) : face;
          p.push(BK.Spark, e.x + Math.cos(a) * drift(age, v, 2.2), base + drift(age, 160 + 260 * R(i, 2), 1.4, 120), e.z + Math.sin(a) * drift(age, v, 2.2), 1.8, hot(tint, 2.6), 1 - f, 0, 0, Math.cos(a) * 4, 2, Math.sin(a) * 4, 1.4);
        }
        return;
      }
      case 'shield': {
        const radius = e.radius;
        this.paint.ring(e.x, e.z, s.spec.length * 0.5 + radius * ease(age / 0.6), hot(color, 1.5), 0.6 * (1 - f));
        if (seen) this.paint.loop(e.x, 50, e.z, s.spec.length * 0.3 + 120 * ease(age / 0.4), hot(color, 1.6), 0.5 * (1 - f));
        return;
      }
      case 'overdrive':
      case 'overdriveEnd': {
        if (!seen) return;
        const start = e.kind === 'overdrive';
        const o = this.anchor(s, 0, dockLift(s.spec) + H, 0, this.v);
        if (start && age < 0.25) p.push(BK.Flare, o.x, o.y + 30, o.z, 520, hot(WHITE, 1.6), 1 - age / 0.25);
        // One expanding ring per mode, staggered, in the six colours.
        for (let m = 0; m < 6; m++) {
          const a = age - m * 0.07;
          if (a < 0) continue;
          const k = ease(a / 0.9);
          this.paint.ring(e.x, e.z, (start ? 140 + 520 * k : 600 - 400 * k), hot(modeColor(m), 1.7), 0.6 * (1 - f));
        }
        if (start) {
          p.push(BK.Glow, o.x, o.y, o.z, 600 * (1 - f * 0.5), hot(color, 1), 0.5 * (1 - f));
          for (let i = 0; i < n(40); i++) {
            const m = i % 6,
              a = R(i, 0) * TAU,
              v = 100 + 260 * R(i, 1);
            p.push(BK.Spark, o.x + Math.cos(a) * drift(age, v, 1.8), o.y + drift(age, 120 * R(i, 2), 1.8, 60), o.z + Math.sin(a) * drift(age, v, 1.8), 1.8, hot(modeColor(m), 2.6), 1 - f, 0, 0, Math.cos(a) * 5, 1, Math.sin(a) * 5, 1.6);
          }
        }
        return;
      }
    }
  }

  /** Each mode marks its hits its own way. */
  private modeHit(b: Burst, x: number, y: number, z: number, age: number, f: number, color: Color): void {
    const p = this.particles;
    const id = TUNGSTEN_MODES[b.e.mode].id;
    const R = (i: number, j: number) => hash01(b.id * 613 + i, j);
    const n = (count: number) => this.paint.n(count);
    if (id === 'crush') {
      // A dull amber shock ring at the waterline and a stun crown over the hull.
      this.paint.ring(x, z, 60 + 200 * ease(age / 0.5), hot(color, 1.6), 0.8 * (1 - f));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + this.game.renderTime * 3;
        if (age < HIT.crush.stun) p.push(BK.Flare, x + Math.cos(a) * 40, y + 40, z + Math.sin(a) * 40, 22, hot(color, 2), 0.9 * (1 - f));
      }
    } else if (id === 'shard') {
      // Shrapnel thrown across the splash radius.
      for (let i = 0; i < n(30); i++) {
        const a = R(i, 0) * TAU,
          v = HIT.shard.radius * (1.2 + R(i, 1)),
          pl = 0.45 + 0.3 * R(i, 2);
        if (age > pl) continue;
        p.push(BK.Spark, x + Math.cos(a) * drift(age, v, 2), y + drift(age, 90 * R(i, 3), 2, 160), z + Math.sin(a) * drift(age, v, 2), 1.4, hot(color, 2.6), 1 - age / pl, 0, 0, Math.cos(a) * 8, 0.5, Math.sin(a) * 8, 1.4);
      }
      this.paint.ring(x, z, HIT.shard.radius * ease(age / 0.4), hot(color, 1.2), 0.4 * (1 - f));
    } else if (id === 'repel') {
      this.paint.ring(x, z, 80 + HIT.repel.knock * ease(age / 0.5), hot(color, 1.8), 0.85 * (1 - f));
      this.paint.foamRing(x, z, 60 + HIT.repel.knock * 0.8 * ease(age / 0.6), 0.5 * (1 - f), b.id);
    } else if (id === 'tether') {
      this.paint.loop(x, y, z, 70 + 40 * Math.sin(age * 20), hot(color, 2), 0.6 * (1 - f));
    } else if (id === 'mend') {
      // Green motes drift from the wound back to the Tungsten.
      const s = b.e.ship;
      for (let i = 0; i < n(14); i++) {
        const k = ease(clamp01((age - R(i, 0) * 0.3) / 0.6));
        if (k <= 0) continue;
        const ox = (R(i, 1) - 0.5) * 80,
          oz = (R(i, 2) - 0.5) * 80;
        const lift = Math.sin(Math.PI * k) * 120;
        p.push(BK.Glow, x + ox + (s.renderPos.x - x - ox) * k, y + lift + (40 - y) * k, z + oz + (s.renderPos.z - z - oz) * k, 18, hot(color, 2), 0.9 * (1 - k * 0.5));
      }
    } else if (id === 'kinetic') {
      this.paint.loop(x, y, z, 30 + 320 * ease(age / 0.3), hot(WHITE, 1.4), 0.6 * (1 - clamp01(age / 0.35)));
    }
  }

  /** Polarity Mirror: a faceted dome of light round the cube, cut off at the sea, a hex lattice on the water beneath. */
  private mirrorBubble(o: Vector3, r: number, color: Color, fade: number, seed: number): void {
    if (fade < 0.01) return;
    const base = this.paint.surface(o.x, o.z);
    const spin = this.paint.reduce ? 0 : this.game.renderTime * 0.25 + seed;
    const pts = (lat: number, lon: number, out: Vector3) => {
      const phi = (lat / 6) * (Math.PI / 2),
        th = (lon / 12) * TAU + spin;
      return out.set(o.x + r * Math.cos(phi) * Math.cos(th), Math.max(base + 2, o.y + r * Math.sin(phi)), o.z + r * Math.cos(phi) * Math.sin(th));
    };
    const a = this.v2,
      b = this.v3;
    for (let lat = 0; lat < 6; lat++)
      for (let lon = 0; lon < 12; lon++) {
        // Flat facets: straight edges along each latitude and each meridian.
        pts(lat, lon, a);
        pts(lat, lon + 1, b);
        this.lines.push(a.x, a.y, a.z, b.x, b.y, b.z, hot(color, 1.6), 0.45 * fade, 3, 1.2);
        pts(lat + 1, lon, b);
        this.lines.push(a.x, a.y, a.z, b.x, b.y, b.z, hot(color, 1.3), 0.35 * fade, 2, 1.2);
      }
    this.paint.ring(o.x, o.z, r, hot(color, 1.8), 0.7 * fade);
    this.paint.ring(o.x, o.z, r * 0.97, hot(color, 0.9), 0.3 * fade, BK.Hex, spin * 0.4);
  }

  private signature(b: Burst, age: number, f: number, color: Color): void {
    const e = b.e,
      p = this.particles;
    const sig = TUNGSTEN_MODES[e.mode].signature.id;
    const R = (i: number, j: number) => hash01(b.id * 389 + i, j);
    const n = (count: number) => this.paint.n(count);
    const base = this.paint.surface(e.x, e.z);
    if (age < 0.12) p.push(BK.Flare, e.x, e.y, e.z, 200, hot(color, 1.8), 1 - age / 0.12);
    const tx = e.toX ?? e.x,
      tz = e.toZ ?? e.z;
    if (sig === 'ricochet') {
      this.paint.loop(e.x, e.y, e.z, 40 + 160 * ease(age / 0.3), hot(color, 2), 0.8 * (1 - clamp01(age / 0.5)));
    } else if (sig === 'pile') {
      // Pile Driver: the cube kicks off the sea, and a ring closes on the hull it will land on.
      this.paint.foamRing(e.x, e.z, 60 + 220 * ease(age / 0.5), 0.6 * (1 - f), b.id);
      this.paint.ring(tx, tz, 360 * (1 - 0.65 * ease(age / 0.8)), hot(color, 1.8), 0.85 * (1 - f));
      this.paint.ring(tx, tz, 110, hot(WHITE, 1.2), 0.45 * (1 - f), BK.Hex, b.id);
    } else if (sig === 'cone') {
      // Shrapnel Cone: the cube's skin shears off in a fan of white-hot streaks toward the reticle.
      const C = SIGNATURE.cone;
      const b0 = Math.atan2(tz - e.z, tx - e.x),
        half = (C.spread * Math.PI) / 360;
      for (const side of [-1, 1]) {
        const a = b0 + side * half;
        this.trails.push(e.x, e.y, e.z, e.x + Math.cos(a) * C.range, base + 10, e.z + Math.sin(a) * C.range, hot(color, 1.4), 0.4 * (1 - clamp01(age / 0.5)), 4, 1);
      }
      for (let i = 0; i < n(48); i++) {
        const a = b0 + (R(i, 0) * 2 - 1) * half,
          life = 0.3 + 0.25 * R(i, 1);
        if (age > life) continue;
        const d = C.range * (0.75 + 0.25 * R(i, 2)) * ease(age / life),
          d0 = Math.max(0, d - 260);
        const ux = Math.cos(a),
          uz = Math.sin(a),
          y = e.y + (base + 10 - e.y) * (d / C.range);
        this.trails.push(e.x + ux * d0, y + 20, e.z + uz * d0, e.x + ux * d, y, e.z + uz * d, tint2.copy(WHITE).lerp(color, age / life).multiplyScalar(2.6), 0.85 * (1 - age / life), 5, 2);
      }
    } else if (sig === 'mirror') {
      // Polarity Mirror: the field snaps out to the bubble's edge; the act holds the bubble up.
      this.paint.ring(e.x, e.z, e.radius * ease(age / 0.4), hot(color, 2), 0.8 * (1 - f));
      this.paint.loop(e.x, e.y, e.z, 40 + 160 * ease(age / 0.3), hot(WHITE, 1.8), 0.7 * (1 - clamp01(age / 0.4)));
    } else if (sig === 'collide') {
      // Collide: the meeting point, closing as the hulls are hauled in.
      this.paint.ring(tx, tz, e.radius * (1 - ease(age / SIGNATURE.collide.time)), hot(color, 1.8), 0.8 * (1 - f));
      this.paint.loop(tx, 40, tz, 40 + 90 * ease(age / 0.3), hot(color, 2), 0.7 * (1 - f));
    } else {
      // Sanctuary: the dome rises off the cube, motes lifting off the water; the field act holds it up.
      this.paint.ring(e.x, e.z, e.radius * ease(age / 0.6), hot(color, 1.8), 0.85 * (1 - f));
      for (let i = 0; i < n(50); i++) {
        const a = R(i, 0) * TAU,
          r = e.radius * Math.sqrt(R(i, 1)) * ease(age / 0.8),
          rise = drift(age, 40 + 60 * R(i, 2), 0.6);
        p.push(BK.Glow, e.x + Math.cos(a) * r, base + 5 + rise, e.z + Math.sin(a) * r, 10 + 10 * R(i, 3), hot(color, 2.2), 0.8 * (1 - f));
      }
    }
  }

  /** A shattered cube: chunks of tungsten tumble out and splash down, the etching guttering out in sparks. */
  private shatter(b: Burst, age: number, f: number, color: Color): void {
    const e = b.e,
      p = this.particles;
    const R = (i: number, j: number) => hash01(b.id * 211 + i, j);
    if (age < 0.2) p.push(BK.Flare, e.x, e.y, e.z, 380, hot(WHITE, 1.8), 1 - age / 0.2);
    p.push(BK.Glow, e.x, e.y, e.z, 300 * (0.6 + 0.4 * ease(age / 0.3)), hot(color, 1.2), 0.6 * (1 - clamp01(age / 0.7)));
    this.paint.loop(e.x, e.y, e.z, 60 + 340 * ease(age / 0.5), hot(color, 1.8), 0.8 * (1 - clamp01(age / 0.6)));
    for (let i = 0; i < Math.round(16 * this.paint.detail); i++) {
      const a = R(i, 0) * TAU,
        v = 40 + 60 * R(i, 1);
      p.push(BK.Smoke, e.x + Math.cos(a) * drift(age, v, 1), e.y + drift(age, 30 * R(i, 2), 1), e.z + Math.sin(a) * drift(age, v, 1), 40 + age * 50, tint2.setHex(0x3a3d42), 0.6 * (1 - f), a, R(i, 3));
    }
    for (let i = 0; i < Math.round(50 * this.paint.detail); i++) {
      const a = R(i, 4) * TAU,
        el = (R(i, 5) - 0.2) * 1.5,
        v = 150 + 250 * R(i, 6),
        pl = 0.6 + 0.8 * R(i, 7);
      if (age > pl) continue;
      const d = drift(age, v, 1.8);
      p.push(BK.Spark, e.x + Math.cos(a) * Math.cos(el) * d, e.y + drift(age, Math.sin(el) * v, 1.8, 120), e.z + Math.sin(a) * Math.cos(el) * d, 1.6, hot(color, 2.6), 1 - age / pl, 0, 0, Math.cos(a) * 5, 2, Math.sin(a) * 5, 1.4);
    }
    // Real chunks of metal, each with its own arc, spin and splash.
    const chunks = Math.round(18 * this.paint.detail);
    for (let i = 0; i < chunks && this.debris.count < DEBRIS_CAP; i++) {
      const a = R(i, 10) * TAU,
        v = 60 + 140 * R(i, 11),
        up = 40 + 120 * R(i, 12),
        size = 8 + 14 * R(i, 13);
      const x = e.x + Math.cos(a) * drift(age, v, 0.5),
        z = e.z + Math.sin(a) * drift(age, v, 0.5);
      const y = e.y + drift(age, up, 0.5, 60);
      const water = this.paint.surface(x, z);
      if (y < water - size) {
        // Gone in: foam marks where it went.
        p.push(BK.Spray, x, water + 6, z, size * 2.5, SPRAY, 0.35 * (1 - f), a, i);
        continue;
      }
      this.q.setFromAxisAngle(this.v.set(R(i, 14) - 0.5, R(i, 15) - 0.5, R(i, 16) - 0.5).normalize(), age * (3 + 6 * R(i, 17)));
      this.scale.set(size, size * (0.5 + 0.6 * R(i, 18)), size * (0.6 + 0.5 * R(i, 19)));
      this.m4.compose(this.v2.set(x, y, z), this.q, this.scale);
      const k = this.debris.count++;
      this.debris.setMatrixAt(k, this.m4);
      this.debris.setColorAt(k, tint2.copy(color).multiplyScalar(Math.max(0, 1 - age / 1.6)));
    }
    this.paint.foamRing(e.x, e.z, 80 + 260 * ease(age / 1.2), 0.4 * (1 - f), b.id);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    for (const v of this.views.values()) this.release(v);
    this.views.clear();
    this.paint.dispose();
    this.singularities.dispose();
    this.scene.remove(this.debris);
    this.debris.geometry.dispose();
    (this.debris.material as MeshStandardMaterial).dispose();
  }
}
