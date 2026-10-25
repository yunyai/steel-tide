import { Color, type PerspectiveCamera, Scene } from 'three';
import { Environment } from '../../render/Environment';
import { Ribbons } from '../../render/Projectiles';
import { quality } from '../../render/Quality';
import type { BattleScene, Renderer, Viewport } from '../../render/Renderer';
import { VEHICLES } from '../sim/data';
import type { GroundGame } from '../sim/GroundGame';
import type { AmmoKind, VehicleSpec } from '../sim/types';
import type { Vehicle } from '../sim/Vehicle';
import { GroundFx } from './GroundFx';
import { GroundSkillFx } from './GroundSkillFx';
import { PropsView } from './PropsView';
import { TerrainView } from './TerrainView';
import { VehicleView, warmVehicle } from './VehicleModel';

/** Tracer colour by round. */
const TRACER: Record<AmmoKind, number> = { AP: 0xffb060, HE: 0xffe080, HEAT: 0x9ae0ff, APDS: 0xffffff };
const tmp = new Color();

/** A ground battle's 3D world: sky, terrain, props, vehicles, rounds in flight and every effect. */
export class GroundScene implements BattleScene {
  readonly scene = new Scene();
  readonly env: Environment;
  readonly terrain: TerrainView;
  readonly props: PropsView;
  readonly effects: GroundFx;
  readonly skillFx: GroundSkillFx;
  readonly tracers = new Ribbons(2500, true);
  views = new Map<Vehicle, VehicleView>();
  private shadows: boolean;
  /** Vehicles that may roll in later (summons, Free play picks), built in quiet frames. */
  private warm: VehicleSpec[] = [];
  private warmIn = 1;

  constructor(
    renderer: Renderer,
    readonly game: GroundGame,
  ) {
    const q = quality();
    const gl = renderer.gl;
    this.shadows = q.shadowMap > 0;
    gl.shadowMap.enabled = this.shadows;
    this.env = new Environment(this.scene, game.map);
    this.env.sun.castShadow = this.shadows;
    if (q.shadowMap) this.env.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    // Tank-sized shadows: a tighter frustum than the sea needs.
    const sc = this.env.sun.shadow.camera;
    sc.left = sc.bottom = -160;
    sc.right = sc.top = 160;
    sc.updateProjectionMatrix();
    this.env.sun.shadow.normalBias = 0.25;
    this.env.bake(gl);
    gl.toneMappingExposure = this.env.look.exposure;
    // Pale lite modes trade the 4 m mesh for 8 m.
    this.terrain = new TerrainView(game.terrain, game.bridges, q.pixelRatio < 0.8 || q.particles < 0.5);
    this.scene.add(this.terrain.group);
    this.props = new PropsView(game.props, this.shadows);
    this.scene.add(this.props.group);
    this.scene.add(this.tracers.mesh);
    for (const p of [renderer.alpha, renderer.add, renderer.flat]) {
      p.clear();
      this.scene.add(p.mesh);
    }
    this.effects = new GroundFx(game, renderer.alpha, renderer.add, renderer.flat);
    this.effects.onFired = (v) => this.views.get(v)?.fired();
    this.skillFx = new GroundSkillFx(game, this.scene, renderer.alpha, renderer.add, renderer.flat);
    this.skillFx.onFlash = (k, c) => renderer.flash(k, c);
    this.warm = VEHICLES.filter((s) => s.era === (game.config.era ?? 'historic') || s.hidden || s.cls === 'TT');
    this.syncVehicles();
  }

  get fog(): { color: number; density: number } {
    // Land battles are fought closer than at sea: the haze is thicker.
    return { color: this.env.look.fog, density: this.env.look.fogDensity * 2.2 };
  }

  setFog(color: Color, density: number): void {
    if (this.scene.fog && 'density' in this.scene.fog) {
      this.scene.fog.density = density;
      this.scene.fog.color.copy(color);
    }
    this.tracers.setFog(color, density);
    this.skillFx.setFog(color, density);
  }

  dispose(): void {
    this.warm = [];
    this.effects.dispose();
    this.skillFx.dispose();
    this.env.dispose();
    this.terrain.dispose();
    this.props.dispose();
    this.tracers.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.game.terrain.trackDirty = false;
    this.scene.clear();
  }

  /** Views for vehicles new to the battle; true if any was built. */
  private syncVehicles(): boolean {
    const g = this.game;
    let built = false;
    for (const v of g.vehicles) {
      const old = this.views.get(v);
      if (old && old.spec === v.spec) continue;
      old?.dispose();
      const view = new VehicleView(v, this.shadows);
      this.views.set(v, view);
      this.scene.add(view.group);
      built = true;
    }
    if (this.views.size > g.vehicles.length) {
      const live = new Set(g.vehicles);
      for (const [v, view] of this.views) {
        if (!live.has(v)) {
          view.dispose();
          this.views.delete(v);
        }
      }
    }
    return built;
  }

  update(dt: number, cameras: PerspectiveCamera[]): void {
    const g = this.game;
    const built = this.syncVehicles();
    this.warmUp(dt, built);
    const t = g.renderTime;
    for (const view of this.views.values()) view.update(dt, g.time);
    this.terrain.update();
    this.props.update(dt, g.dirtyProps);
    g.dirtyProps.length = 0;
    this.env.update(t);
    this.effects.views = cameras.map((c) => c.position);
    this.effects.update(dt);
    this.skillFx.views = this.effects.views;
    this.skillFx.update(dt);
    this.rounds(dt);
  }

  /** Tracers for shells, and rockets and missiles as hot points trailing smoke. */
  private rounds(dt: number): void {
    const g = this.game;
    const r = this.tracers;
    r.begin();
    for (const s of g.shells.list) {
      if (!s.alive) continue;
      const c = tmp.setHex(TRACER[s.ammo.kind]).multiplyScalar(2.2);
      const w = 0.12 + s.caliber / 1200;
      r.push(s.px, s.py, s.pz, s.x, s.y, s.z, c, 0.9, w, 1.6);
    }
    for (const m of g.missiles.list) {
      if (!m.alive) continue;
      const hot = tmp.setHex(m.look === 'missile' ? 0xffe0c0 : 0xffc070).multiplyScalar(2.5);
      r.push(m.px, m.py, m.pz, m.x, m.y, m.z, hot, 1, 0.35, 2);
      if (Math.random() < dt * 50) this.effects.trail(m.px, m.py, m.pz);
    }
    r.end();
  }

  /** Build the next vehicle still to come, about one every other frame and never on a busy one. */
  private warmUp(dt: number, busy: boolean): void {
    if (!this.warm.length) return;
    this.warmIn -= dt;
    if (busy || this.warmIn > 0) return;
    while (this.warm.length && !warmVehicle(this.warm.pop()!));
    this.warmIn = 1 / 30;
  }

  prepare(vp: Viewport, heightPx: number): void {
    for (const [v, view] of this.views) {
      const on = !v.withdrawn && vp.hide !== v;
      view.group.visible = on;
      this.skillFx.visible(v, on);
    }
    this.env.focus(vp.focus.x, vp.focus.z);
    this.tracers.material.uniforms.uViewportH.value = heightPx;
    this.skillFx.setViewport(heightPx);
  }
}
