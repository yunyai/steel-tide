import { ArchitectBatteryFx } from './ArchitectBatteryFx';
import { ArchitectElementFx } from './ArchitectElementFx';
import { FleetFx } from './FleetFx';
import { ArchitectFx } from './ArchitectFx';
import { StepperFx } from './StepperFx';
import { CrossStepFx } from './CrossStepFx';
import { TorpedoAim, type TorpedoAimSource } from './TorpedoAim';
import { contactVisible } from '../core/Targeting';
import { type Color, type Object3D, type PerspectiveCamera, Scene } from 'three';
import { MAP_HALF } from '../config';
import type { Game } from '../core/Game';
import type { ShipSpec, Team } from '../core/types';
import { ALL, shipsIn } from '../data/ships';
import { Effects } from '../fx/Effects';
import type { Ship } from '../ships/Ship';
import { Environment } from './Environment';
import { Islands, shoreTexture } from './Islands';
import { Ocean } from './Ocean';
import { Projectiles } from './Projectiles';
import { quality } from './Quality';
import type { BattleScene, Renderer, Viewport } from './Renderer';
import { ShipView, warmGeometry } from './ShipModel';
import { SkillFx } from './SkillFx';
import { shipViewMode } from './Visibility';

/** The shore map covers the battle area plus a margin. */
const SHORE_HALF = MAP_HALF + 500;

/** A naval battle's 3D scene: sky, sea, islands, ships, shells and every effect. */
export class NavalScene implements BattleScene {
  readonly torpedoAim = new TorpedoAim();
  readonly fleetFx: FleetFx;
  readonly elementFx:ArchitectElementFx;
  readonly architectFx: ArchitectFx;
  readonly batteryFx: ArchitectBatteryFx;
  readonly crossFx: CrossStepFx;
  readonly stepperFx: StepperFx;
  readonly aiming = new Map<PerspectiveCamera, TorpedoAimSource>();
  readonly scene = new Scene();
  readonly env: Environment;
  readonly ocean: Ocean;
  readonly islands: Islands;
  readonly projectiles: Projectiles;
  readonly effects: Effects;
  readonly skillFx: SkillFx;
  /** Domination: the old hull of a respawned ship, left to finish sinking. */
  private wrecks: { obj: Object3D; t: number; roll: number; update: () => void; dispose: () => void }[] = [];
  views = new Map<Ship, ShipView>();
  /**
   * Hulls that may sail in later (summons, Boss Rush waves, Free play picks), built a few at a
   * time in quiet frames: building one on arrival stalls a frame for several milliseconds.
   */
  private warm: ShipSpec[] = [];
  private warmIn = 0;
  private off: (() => void)[] = [];

  constructor(
    renderer: Renderer,
    readonly game: Game,
  ) {
    this.scene.add(this.torpedoAim.root);
    this.fleetFx = new FleetFx(this.scene, game);
    this.crossFx = new CrossStepFx(this.scene, game);
    this.stepperFx = new StepperFx(this.scene, game);
    this.elementFx = new ArchitectElementFx(this.scene,game);
    this.architectFx = new ArchitectFx(this.scene, game);
    this.batteryFx = new ArchitectBatteryFx(this.scene, game);
    const q = quality();
    const gl = renderer.gl;
    gl.shadowMap.enabled = q.shadowMap > 0;
    this.env = new Environment(this.scene, game.map.preset);
    this.env.sun.castShadow = q.shadowMap > 0;
    if (q.shadowMap) this.env.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.env.bake(gl);
    gl.toneMappingExposure = this.env.look.exposure;
    this.ocean = new Ocean(this.env.look, this.env.sunDir, this.env.skyCube, q.oceanLite);
    this.ocean.setShore(shoreTexture(game.map, SHORE_HALF), SHORE_HALF);
    this.scene.add(this.ocean.mesh);
    this.islands = new Islands(game.map, game.config.seed);
    this.scene.add(this.islands.group);
    this.projectiles = new Projectiles();
    this.scene.add(this.projectiles.tracers.mesh, this.projectiles.wakes.mesh, this.projectiles.missiles, ...this.projectiles.planes);
    for (const p of [renderer.alpha, renderer.add, renderer.flat]) {
      p.clear();
      this.scene.add(p.mesh);
    }
    // Popped from the end: summons first, as titans call them in at the first clash.
    this.warm = [...shipsIn(game.config.era ?? 'historic'), ...ALL.filter((s) => s.hidden)];
    this.warmIn = 1;
    this.effects = new Effects(game, renderer.alpha, renderer.add, renderer.flat);
    this.skillFx = new SkillFx(game, this.scene, renderer.alpha, renderer.add, renderer.flat);
    this.skillFx.onFlash = (k, c) => renderer.flash(k, c);
    this.off.push(
      game.events.on('gunFired', (e) => {
        if (!e.secondary) this.views.get(e.ship)?.recoil(e.bearing - e.ship.heading, e.caliber);
      }),
      // The ship object sails again at once; a copy of the old hull goes on sinking where it was.
      game.events.on('respawn', (e) => {
        const v = this.views.get(e.ship);
        if (!v) return;
        const w = v.wreck();
        this.scene.add(w.obj);
        this.wrecks.push({ ...w, t: 0, roll: Math.random() < 0.5 ? -1 : 1 });
      }),
      // Battle damage: penetrating hits and torpedoes burn holes into the hull they struck.
      game.events.on('shellHit', (e) => {
        if (e.secondary || e.outcome === 'ricochet' || e.outcome === 'shatter') return;
        this.views.get(e.target)?.scar(e.x, e.y, e.z, 1.5 + (e.caliber / 1000) * (e.outcome === 'overpen' ? 6 : 14));
      }),
      game.events.on('torpHit', (e) => {
        this.views.get(e.target)?.scar(e.x, 0.5, e.z, 9, true);
      }),
      game.events.on('detonation', (e) => this.views.get(e.ship)?.detonate()),
    );
    this.syncShips();
  }

  get fog(): { color: number; density: number } {
    return { color: this.env.look.fog, density: this.env.look.fogDensity };
  }

  setFog(color: Color, density: number): void {
    if (this.scene.fog && 'density' in this.scene.fog) this.scene.fog.density = density;
    this.ocean.material.uniforms.uFogDensity.value = density;
    this.projectiles.setFog(color, density);
    this.skillFx.setFog(color, density);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    this.warm = [];
    this.architectFx.dispose();
    this.batteryFx.dispose();
    this.elementFx.dispose();
    this.crossFx.dispose();
    this.fleetFx.dispose();
    this.stepperFx.dispose();
    this.torpedoAim.dispose();
    this.aiming.clear();
    this.effects.dispose();
    this.skillFx.dispose();
    this.env.dispose();
    this.ocean.dispose();
    this.islands.dispose();
    this.projectiles.dispose();
    for (const v of this.views.values()) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.views.clear();
    for (const w of this.wrecks) w.dispose();
    this.wrecks = [];
    this.scene.clear();
  }

  /** Views for ships new to the battle, and away with those gone; true if any view was built. */
  private syncShips(): boolean {
    const g = this.game;
    let built = false;
    for (const s of g.ships) {
      const had = this.views.get(s);
      if(!s.alive&&(s.architectPlatform||s.architectDrone)&&s.deathTime>=3){
        if(had){this.scene.remove(had.root);if(had.dome)this.scene.remove(had.dome);had.dispose();this.views.delete(s);}continue;
      }
      // A Titan Shift (or its revert) swaps the hull's spec: build the new body in place of the old.
      if (had && had.spec !== s.spec) {
        this.scene.remove(had.root);
        if (had.dome) this.scene.remove(had.dome);
        had.dispose();
        this.views.delete(s);
      }
      if (!this.views.has(s)) {
        built = true;
        const v = new ShipView(s.spec);
        this.views.set(s, v);
        this.scene.add(v.root);
        if (v.dome) this.scene.add(v.dome);
      }
    }
    if (this.views.size > g.ships.length) {
      const live = new Set(g.ships);
      for (const [s, v] of this.views) {
        if (!live.has(s)) {
          this.scene.remove(v.root);
          if (v.dome) this.scene.remove(v.dome);
          v.dispose();
          this.views.delete(s);
        }
      }
    }
    return built;
  }

  update(dt: number, cameras: PerspectiveCamera[]): void {
    const g = this.game;
    const built = this.syncShips();
    this.warmUp(dt, built);
    const t = g.renderTime;
    for (const [s, v] of this.views) {v.stepFold=this.stepperFx.foldPhase(s);v.update(s,t);}
    for (const w of this.wrecks) {
      w.t += dt;
      w.obj.position.y -= (4 + w.t * 7) * dt;
      w.obj.rotation.x += w.roll * 0.05 * dt;
      w.obj.rotation.z += w.roll * 0.02 * dt;
      w.update();
      if (w.t > 6) {
        this.scene.remove(w.obj);
        w.dispose();
      }
    }
    if (this.wrecks.length) this.wrecks = this.wrecks.filter((w) => w.t <= 6);
    this.ocean.update(t);
    this.env.update(t);
    this.effects.views = cameras.map((c) => c.position);
    this.effects.update(dt);
    this.skillFx.views = this.effects.views;
    this.skillFx.update(dt);
    this.fleetFx.update(dt);
    this.crossFx.update(dt, this.skillFx.locals);
    this.stepperFx.update(dt, this.skillFx.locals);
    this.architectFx.update(dt, this.skillFx.locals);
    this.batteryFx.update(dt);
    this.elementFx.update(dt,this.skillFx.locals);
    this.projectiles.update(g);
  }

  /** Build the next hull still to come, about one every other frame and never on a frame that built a view. */
  private warmUp(dt: number, busy: boolean): void {
    if (!this.warm.length) return;
    this.warmIn -= dt;
    if (busy || this.warmIn > 0) return;
    while (this.warm.length && !warmGeometry(this.warm.pop()!));
    this.warmIn = 1 / 30;
  }

  private visibility(team: Team | -1): void {
    for (const [s, v] of this.views) {
      v.side(team === -1 ? s.team === 0 : s.team === team);
      v.setMode(s.stepper?.copy&&!s.alive?'hidden':shipViewMode(s, team));
    }
    for (const [s, v] of this.views) {
      if (v.dome) v.dome.visible = v.root.visible && v.glowing;
      this.skillFx.visible(s, v.root.visible && (team === -1 || contactVisible(s, team)));
    }
  }

  get distortions() { return [...this.stepperFx.distortions,...this.crossFx.distortions]; }

  prepare(vp: Viewport, heightPx: number): void {
    this.fleetFx.prepare(vp.team);
    this.architectFx.prepare(vp.team, heightPx);
    this.batteryFx.prepare(vp.team, heightPx);
    this.elementFx.prepare(vp.team);
    this.crossFx.prepare(vp.team, heightPx);
    this.stepperFx.prepare(vp.team, heightPx);
    this.torpedoAim.update(this.aiming.get(vp.camera), heightPx);
    this.visibility(vp.team);
    if (vp.hide) this.views.get(vp.hide as Ship)?.setMode('hidden');
    this.ocean.follow(vp.camera);
    this.env.focus(vp.focus.x, vp.focus.z);
    this.projectiles.setViewport(heightPx);
    this.skillFx.setViewport(heightPx);
    this.projectiles.updateWakes(this.game, vp.team);
  }
}
