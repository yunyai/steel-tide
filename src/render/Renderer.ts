import {
  ACESFilmicToneMapping,
  Color,
  DepthTexture,
  HalfFloatType,
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
import { SpatialDistortionShader, projectDistortions, type SpatialDistortion } from './SpatialDistortion';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Team } from '../core/types';
import { ParticleSystem } from '../fx/Particles';
import { quality } from './Quality';

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
  distortion: ShaderPass;
  key: string;
}

const size = new Vector2();

export interface Viewport {
  camera: PerspectiveCamera;
  /** Team watching this viewport, for ally/enemy colours (-1: neutral). */
  team: Team | -1;
  /** Fractions of the canvas: x, y from bottom-left, w, h. */
  rect: { x: number; y: number; w: number; h: number };
  /** Shadow focus point (usually the player's own unit). */
  focus: { x: number; z: number };
  /** Unit not drawn in this viewport (own hull while looking through the scope). */
  hide?: unknown;
  /** Fog density multiplier (optics cut through haze). */
  fogScale?: number;
}

/** One battle's 3D world, of whatever kind; the renderer draws it into each viewport. */
export interface BattleScene {
  readonly distortions?: readonly SpatialDistortion[];
  readonly scene: Scene;
  /** Haze colour and density at a fog scale of 1. */
  readonly fog: { color: number; density: number };
  /** Advance visual state by a real frame delta. */
  update(dt: number, cameras: PerspectiveCamera[]): void;
  /** Set up for drawing one viewport: who is shown, the shadow focus, sizes in device pixels. */
  prepare(vp: Viewport, heightPx: number): void;
  /** Thin or thicken the haze on what the scene draws itself (the particles are the renderer's). */
  setFog(color: Color, density: number): void;
  dispose(): void;
}

/** Owns the WebGL context, the post-processing and the shared particles; draws the battle scene attached. */
export class Renderer {
  readonly gl: WebGLRenderer;
  private visualQuality = quality();
  /** The battle on screen, if any. */
  battle: BattleScene | null = null;
  private empty = new Scene();
  /** Screen flash and chromatic split, decaying each frame. */
  private flashK = 0;
  private aberr = 0;
  private flashColor = new Color(1, 1, 1);
  readonly alpha = new ParticleSystem(9000, 'alpha');
  readonly add = new ParticleSystem(6000, 'add');
  readonly flat = new ParticleSystem(7000, 'flat');
  private fogScale = 1;
  private posts: Post[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFShadowMap;
    this.gl.autoClear = false;
    // Post effects render several passes a frame: count them all (the readout shows the total).
    this.gl.info.autoReset = false;
    this.resize();
  }

  resize(): void {
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, this.visualQuality.pixelRatio));
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
  private post(i: number, scene: Scene, camera: PerspectiveCamera, w: number, h: number): Post | null {
    const q = this.visualQuality;
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
      composer.renderTarget1.depthTexture = new DepthTexture(Math.max(1,w*pr),Math.max(1,h*pr));
      composer.renderTarget2.depthTexture = new DepthTexture(Math.max(1,w*pr),Math.max(1,h*pr));
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      const pass = new RenderPass(scene, camera);
      composer.addPass(pass);
      const distortion = new ShaderPass(SpatialDistortionShader);
      composer.addPass(distortion);
      composer.addPass(new UnrealBloomPass(new Vector2(w, h), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
      composer.addPass(new OutputPass());
      // The grade draws to the screen. Swapping after it would flip the composer's ping-pong each
      // frame, so every other frame the scene would land in the multisampled buffer bloom can't use.
      const grade = new ShaderPass(GradeShader);
      grade.needsSwap = false;
      composer.addPass(grade);
      p = { composer, scene: pass, grade, distortion, key };
      this.posts[i] = p;
    }
    p.scene.scene = scene;
    p.scene.camera = camera;
    const d=p.distortion.uniforms, fields=projectDistortions(this.battle?.distortions??[],camera);
    d.tDepth.value=p.composer.readBuffer.depthTexture;
    d.uCount.value=fields.length;d.uNear.value=camera.near;d.uFar.value=camera.far;
    d.uReverse.value=this.gl.capabilities.reversedDepthBuffer?1:0;d.uAspect.value=camera.aspect;d.uHeight.value=h;
    fields.forEach((f,j)=>{d.uShape.value[j].copy(f.shape);d.uDepth.value[j].copy(f.depth);});
    const u = p.grade.uniforms;
    u.uFlash.value = Math.min(0.85, this.flashK);
    u.uFlashColor.value.copy(this.flashColor);
    u.uAberr.value = this.aberr;
    return p;
  }

  /** Put a battle's scene on screen (the scene builds itself against this renderer first). */
  attach(battle: BattleScene): void {
    if (this.battle !== battle) this.detach();
    this.visualQuality = quality();
    this.battle = battle;
    this.resize();
    this.fogScale = -1;
    this.setFogScale(this.visualQuality.viewFog);
    this.flashK = this.aberr = 0;
  }

  detach(): void {
    if (!this.battle) return;
    this.disposePosts();
    this.battle.dispose();
    this.battle = null;
  }

  /** Kick a screen flash (0..1) with a chromatic split; fades over about half a second. */
  flash(amount: number, color = 0xffffff): void {
    if (amount > this.flashK) this.flashColor.setHex(color);
    this.flashK = Math.max(this.flashK, amount);
    this.aberr = Math.max(this.aberr, Math.min(1, amount * 1.5));
  }

  /** Advance visual state by a real frame delta. */
  update(dt: number, cameras: PerspectiveCamera[]): void {
    const b = this.battle;
    if (!b) return;
    b.update(dt, cameras);
    this.flashK *= Math.exp(-dt * 5);
    this.aberr *= Math.exp(-dt * 3.5);
    this.alpha.update(dt);
    this.add.update(dt);
    this.flat.update(dt);
  }

  /** Thin or thicken the haze for everything that draws fog. */
  private setFogScale(k: number): void {
    const b = this.battle;
    if (!b || Math.abs(k - this.fogScale) < 1e-3) return;
    this.fogScale = k;
    const fog = new Color(b.fog.color);
    const density = b.fog.density * k;
    for (const p of [this.alpha, this.add, this.flat]) p.setFog(fog, density);
    b.setFog(fog, density);
  }

  render(viewports: Viewport[]): void {
    const gl = this.gl;
    const b = this.battle;
    gl.info.reset();
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
      if (b) {
        b.prepare(vp, h * pr);
        this.setFogScale((vp.fogScale ?? 1) * this.visualQuality.viewFog);
      }
      const post = b ? this.post(i, b.scene, vp.camera, w, h) : null;
      if (post) {
        post.composer.render();
        // The composer leaves its last render target bound; restore the screen rectangle.
        gl.setRenderTarget(null);
      } else {
        gl.clear();
        gl.render(b?.scene ?? this.empty, vp.camera);
      }
    });
    gl.setScissorTest(false);
  }
}
