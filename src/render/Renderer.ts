import {
  ACESFilmicToneMapping,
  Color,
  HalfFloatType,
  type Object3D,
  PCFShadowMap,
  type PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { MAP_HALF } from '../config';
import type { Game } from '../core/Game';
import type { Team } from '../core/types';
import { Effects } from '../fx/Effects';
import { ParticleSystem } from '../fx/Particles';
import type { Ship } from '../ships/Ship';
import { Environment } from './Environment';
import { Islands, shoreTexture } from './Islands';
import { Ocean } from './Ocean';
import { Projectiles } from './Projectiles';
import { quality } from './Quality';
import { ShipView } from './ShipModel';
import { SkillFx } from './SkillFx';

/** Bloom tuned so only real light sources glow: tracers, muzzle flashes, fires, beams, the sun's glint. */
const BLOOM_STRENGTH = 0.45;
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 1.6;

/**
 * Final grade, on the display-encoded image: saturation and contrast, teal shadows and warm
 * highlights, a vignette, plus a flash and chromatic split that big blasts and ultimates kick.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 1, 1) },
    uAberr: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uAberr;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * (0.0015 + uAberr * (0.005 + r2 * 0.02));
  vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.14);
  c = (c - 0.5) * 1.08 + 0.5;
  c += mix(vec3(-0.012, 0.01, 0.028), vec3(0.03, 0.012, -0.02), smoothstep(0.15, 0.75, l));
  c *= 1.0 - r2 * 0.75;
  c = mix(c, uFlashColor, uFlash);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

/** Post-processing chain for one viewport, sized to its rectangle. */
interface Post {
  composer: EffectComposer;
  scene: RenderPass;
  grade: ShaderPass;
  key: string;
}

const size = new Vector2();
/** The shore map covers the battle area plus a margin. */
const SHORE_HALF = MAP_HALF + 500;

export interface Viewport {
  camera: PerspectiveCamera;
  /** Team watching this viewport, for ally/enemy colours (-1: neutral). */
  team: Team | -1;
  /** Fractions of the canvas: x, y from bottom-left, w, h. */
  rect: { x: number; y: number; w: number; h: number };
  /** Shadow focus point (usually the player's ship). */
  focus: { x: number; z: number };
  /** Ship not drawn in this viewport (own hull while looking through binoculars). */
  hide?: Ship | null;
  /** Fog density multiplier (optics cut through haze). */
  fogScale?: number;
}

/** Owns the WebGL context and the 3D scene for one battle. */
export class Renderer {
  readonly gl: WebGLRenderer;
  scene = new Scene();
  game: Game | null = null;
  env: Environment | null = null;
  ocean: Ocean | null = null;
  islands: Islands | null = null;
  projectiles: Projectiles | null = null;
  effects: Effects | null = null;
  skillFx: SkillFx | null = null;
  /** Domination: the old hull of a respawned ship, left to finish sinking. */
  private wrecks: { obj: Object3D; t: number; roll: number; update: () => void; dispose: () => void }[] = [];
  /** Screen flash and chromatic split, decaying each frame. */
  private flashK = 0;
  private aberr = 0;
  private flashColor = new Color(1, 1, 1);
  readonly alpha = new ParticleSystem(9000, 'alpha');
  readonly add = new ParticleSystem(6000, 'add');
  readonly flat = new ParticleSystem(7000, 'flat');
  views = new Map<Ship, ShipView>();
  private fogScale = 1;
  private off: (() => void)[] = [];
  private posts: Post[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFShadowMap;
    this.gl.autoClear = false;
    this.resize();
  }

  resize(): void {
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, quality().pixelRatio));
    this.gl.setSize(window.innerWidth, window.innerHeight, false);
  }

  private disposePost(p: Post): void {
    p.composer.renderTarget1.dispose();
    p.composer.renderTarget2.dispose();
    for (const pass of p.composer.passes) pass.dispose();
  }

  private disposePosts(): void {
    for (const p of this.posts) this.disposePost(p);
    this.posts = [];
  }

  /** The viewport's composer, rebuilt when its size or the quality preset changes; null draws directly. */
  private post(i: number, camera: PerspectiveCamera, w: number, h: number): Post | null {
    const q = quality();
    if (!q.bloom) return null;
    const pr = this.gl.getPixelRatio();
    const key = `${w}x${h}@${pr}/${q.samples}`;
    let p = this.posts[i];
    if (!p || p.key !== key) {
      if (p) this.disposePost(p);
      // The scene draws into a multisampled target and is copied to a plain one for bloom: three
      // discards a multisampled buffer once resolved, so bloom cannot blend back into it.
      const rt = new WebGLRenderTarget(Math.max(1, w * pr), Math.max(1, h * pr), { type: HalfFloatType, samples: q.samples });
      const composer = new EffectComposer(this.gl, rt);
      composer.renderTarget2.samples = 0;
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      const scene = new RenderPass(this.scene, camera);
      composer.addPass(scene);
      composer.addPass(new ShaderPass(CopyShader));
      composer.addPass(new UnrealBloomPass(new Vector2(w, h), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
      composer.addPass(new OutputPass());
      // The grade draws to the screen. Swapping after it would flip the composer's ping-pong each
      // frame, so every other frame the scene would land in the multisampled buffer bloom can't use.
      const grade = new ShaderPass(GradeShader);
      grade.needsSwap = false;
      composer.addPass(grade);
      p = { composer, scene, grade, key };
      this.posts[i] = p;
    }
    p.scene.scene = this.scene;
    p.scene.camera = camera;
    const u = p.grade.uniforms;
    u.uFlash.value = Math.min(0.85, this.flashK);
    u.uFlashColor.value.copy(this.flashColor);
    u.uAberr.value = this.aberr;
    return p;
  }

  attach(game: Game): void {
    this.detach();
    this.game = game;
    this.scene = new Scene();
    const q = quality();
    this.resize();
    this.gl.shadowMap.enabled = q.shadowMap > 0;
    this.env = new Environment(this.scene, game.map.preset);
    this.env.sun.castShadow = q.shadowMap > 0;
    if (q.shadowMap) this.env.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.env.bake(this.gl);
    this.gl.toneMappingExposure = this.env.look.exposure;
    this.ocean = new Ocean(this.env.look, this.env.sunDir, this.env.skyCube, q.oceanLite);
    this.ocean.setShore(shoreTexture(game.map, SHORE_HALF), SHORE_HALF);
    this.scene.add(this.ocean.mesh);
    this.islands = new Islands(game.map, game.config.seed);
    this.scene.add(this.islands.group);
    this.projectiles = new Projectiles();
    this.scene.add(this.projectiles.tracers.mesh, this.projectiles.wakes.mesh, this.projectiles.missiles, ...this.projectiles.planes);
    for (const p of [this.alpha, this.add, this.flat]) {
      p.clear();
      this.scene.add(p.mesh);
    }
    this.fogScale = -1;
    this.setFogScale(q.viewFog);
    this.effects = new Effects(game, this.alpha, this.add, this.flat);
    this.skillFx = new SkillFx(game, this.scene, this.alpha, this.add, this.flat);
    this.skillFx.onFlash = (k, c) => this.flash(k, c);
    this.flashK = this.aberr = 0;
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

  detach(): void {
    if (!this.game) return;
    for (const f of this.off) f();
    this.off = [];
    this.disposePosts();
    this.effects?.dispose();
    this.skillFx?.dispose();
    this.env?.dispose();
    this.ocean?.dispose();
    this.islands?.dispose();
    this.projectiles?.dispose();
    for (const v of this.views.values()) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.views.clear();
    for (const w of this.wrecks) w.dispose();
    this.wrecks = [];
    this.scene.clear();
    this.game = null;
    this.effects = null;
    this.skillFx = null;
  }

  /** Kick a screen flash (0..1) with a chromatic split; fades over about half a second. */
  flash(amount: number, color = 0xffffff): void {
    if (amount > this.flashK) this.flashColor.setHex(color);
    this.flashK = Math.max(this.flashK, amount);
    this.aberr = Math.max(this.aberr, Math.min(1, amount * 1.5));
  }

  private syncShips(): void {
    const g = this.game!;
    for (const s of g.ships) {
      if (!this.views.has(s)) {
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
  }

  /** Advance visual state by a real frame delta. */
  update(dt: number, cameras: PerspectiveCamera[]): void {
    const g = this.game;
    if (!g) return;
    this.syncShips();
    const t = g.renderTime;
    for (const [s, v] of this.views) v.update(s, t);
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
    this.ocean!.update(t);
    this.env!.update(t);
    this.effects!.views = cameras.map((c) => c.position);
    this.effects!.update(dt);
    this.skillFx!.views = this.effects!.views;
    this.skillFx!.update(dt);
    this.flashK *= Math.exp(-dt * 5);
    this.aberr *= Math.exp(-dt * 3.5);
    this.alpha.update(dt);
    this.add.update(dt);
    this.flat.update(dt);
    this.projectiles!.update(g);
  }

  /** Thin or thicken the haze for everything that draws fog. */
  private setFogScale(k: number): void {
    if (!this.env || Math.abs(k - this.fogScale) < 1e-3) return;
    this.fogScale = k;
    const fog = new Color(this.env.look.fog);
    const density = this.env.look.fogDensity * k;
    if (this.scene.fog && 'density' in this.scene.fog) this.scene.fog.density = density;
    if (this.ocean) this.ocean.material.uniforms.uFogDensity.value = density;
    for (const p of [this.alpha, this.add, this.flat]) p.setFog(fog, density);
    this.projectiles?.setFog(fog, density);
    this.skillFx?.setFog(fog, density);
  }

  private visibility(team: Team | -1): void {
    for (const [s, v] of this.views) {
      v.side(team === -1 ? s.team === 0 : s.team === team);
      if (team === -1) {
        v.setMode(s.mods.banished ? 'hidden' : s.submerged ? (s.team === 0 ? 'ally' : 'enemy') : 'normal');
        continue;
      }
      // Every ship is always drawn; submarines under the surface show as a ghost in their side's colour.
      if (!s.alive) v.setMode(s.withdrawn ? 'hidden' : 'normal');
      // Banished: gone from the world; its own side sees where it will return.
      else if (s.mods.banished) v.setMode(s.team === team ? 'cloak' : 'hidden');
      else if (s.mods.untargetable) v.setMode('cloak');
      else if (s.submerged) v.setMode(s.team === team ? 'ally' : 'enemy');
      else v.setMode('normal');
    }
    for (const [s, v] of this.views) {
      if (v.dome) v.dome.visible = v.root.visible && v.glowing;
      this.skillFx?.visible(s, v.root.visible);
    }
  }

  render(viewports: Viewport[]): void {
    const gl = this.gl;
    // Viewports and scissors are in CSS pixels; three scales them by the pixel ratio.
    gl.getSize(size);
    const pr = gl.getPixelRatio();
    gl.setScissorTest(true);
    viewports.forEach((vp, i) => {
      const x = Math.round(vp.rect.x * size.x);
      const y = Math.round(vp.rect.y * size.y);
      const w = Math.round(vp.rect.w * size.x);
      const h = Math.round(vp.rect.h * size.y);
      gl.setViewport(x, y, w, h);
      gl.setScissor(x, y, w, h);
      vp.camera.aspect = w / Math.max(1, h);
      vp.camera.updateProjectionMatrix();
      if (this.game) {
        this.visibility(vp.team);
        if (vp.hide) this.views.get(vp.hide)?.setMode('hidden');
        this.setFogScale((vp.fogScale ?? 1) * quality().viewFog);
        this.ocean!.follow(vp.camera);
        this.env!.focus(vp.focus.x, vp.focus.z);
        this.projectiles!.setViewport(h * pr);
        this.skillFx!.setViewport(h * pr);
        this.projectiles!.updateWakes(this.game, vp.team);
      }
      const post = this.game ? this.post(i, vp.camera, w, h) : null;
      if (post) {
        post.composer.render();
        // The composer leaves its last render target bound; restore the screen rectangle.
        gl.setRenderTarget(null);
      } else {
        gl.clear();
        gl.render(this.scene, vp.camera);
      }
    });
    gl.setScissorTest(false);
  }
}
