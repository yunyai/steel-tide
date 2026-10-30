import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import { CUBE } from '../skills/misc/TungstenModes';
import { hash01 } from './BurstParticles';
import type { SpatialDistortion } from './SpatialDistortion';
import { modeColor } from './TungstenLook';
import { clamp01, smooth } from './TungstenPaint';

/** Height the singularity hangs at: the cube is crushed while rising to it. */
export const SINGULARITY_Y = 240;
/** Event-horizon radius before Overdrive's merge (m). */
export const HORIZON = 85;
const DISK_INNER = 1.5;
const DISK_OUTER = 6.5;
const HALO = 3.2;
/** Lens radius in horizon radii; its untouched inner 30% (2.4) holds the photon ring and lensed arcs. */
const LENS = 8;
/** Infall streaks per hole at full particle detail. */
export const INFALL = 720;
/** Seconds the hole takes to wink out after the burst. */
const FADE = 0.3;

/** Where a Collapse is in its life, as drawn. */
export interface CollapseLook {
  x: number;
  z: number;
  /** Seconds since the cube arrived and began to collapse (negative while it is still flying in). */
  hold: number;
  merged: boolean;
  mode: number;
}

/** The Collapse a ship is running, in render time, or null. */
export function collapseLook(s: Ship, game: Game): CollapseLook | null {
  const u = s.tungsten?.ult;
  if (!u || u.kind !== 'collapse' || !s.alive) return null;
  const lag = game.time - game.renderTime;
  return { x: u.x, z: u.z, hold: u.elapsed - lag - CUBE.collapse.travel, merged: u.merged, mode: s.tungsten!.mode };
}

/** 0..1: how far the cube has been crushed into the hole. */
export const crushed = (hold: number) => smooth(hold / 0.45);

const NOISE = /* glsl */ `
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm3(vec3 p) { return noise3(p) * 0.55 + noise3(p * 2.1 + 7.3) * 0.3 + noise3(p * 4.3 - 3.1) * 0.15; }
`;

const FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
float fogAt(float d) { return 1.0 - exp(-uFogDensity * uFogDensity * d * d); }
// The hole is the centrepiece of the fight, so it cuts through haze at half the usual rate.
float haze(float d) { return fogAt(d * 0.5); }
`;

/** A camera-facing quad of half-size uSize round the mesh origin; vUv runs -1..1. */
const BILLBOARD = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying float vDist;
void main() {
  vUv = position.xy * 2.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vDist = -mv.z;
  mv.xy += vUv * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const HORIZON_FRAG = /* glsl */ `
${FOG}
varying vec2 vUv;
varying float vDist;
void main() {
  if (length(vUv) > 1.0) discard;
  // Haze greys the shadow with distance, but never so far that it stops reading as a hole.
  gl_FragColor = vec4(uFogColor * haze(vDist) * 0.3, 1.0);
  #include <colorspace_fragment>
}
`;

/** Photon ring, inner glow and the far side of the disk lensed over and under the hole, on a shadow. */
const HALO_FRAG = /* glsl */ `
${FOG}
${NOISE}
uniform vec3 uColor;
uniform vec3 uNormal;
uniform float uTime, uGlow, uRatio;
varying vec2 vUv;
varying float vDist;
void main() {
  float rho = length(vUv) * uRatio;
  if (rho < 0.98) discard;
  // The disk's normal on screen: the lensed image hugs the side it points to.
  vec3 n = normalize((viewMatrix * vec4(uNormal, 0.0)).xyz);
  float face = abs(n.z);
  vec2 up = length(n.xy) > 0.001 ? normalize(n.xy) : vec2(0.0, 1.0);
  float s = dot(vUv / max(length(vUv), 0.0001), up);
  float theta = atan(vUv.y, vUv.x);
  // Never thinner than a pixel and a half, or the ring shimmers away at range.
  float w = max(0.022, fwidth(rho) * 1.5);
  float photon = exp(-pow((rho - 1.03) / w, 2.0)) * sqrt(0.022 / w);
  float glow = exp(-(rho - 1.0) * 6.0) * 0.25;
  float flow = fbm3(vec3(cos(theta - uTime * 0.9) * 2.5, sin(theta - uTime * 0.9) * 2.5, rho * 4.0));
  float upper = smoothstep(1.1, 1.24, rho) * (1.0 - smoothstep(1.5, 1.95, rho)) * smoothstep(-0.25 - face * 1.3, 0.4, s);
  float lower = smoothstep(1.04, 1.1, rho) * (1.0 - smoothstep(1.16, 1.26, rho)) * smoothstep(-0.25 - face * 1.3, 0.4, -s) * 0.45;
  vec3 hotc = mix(vec3(1.0, 0.94, 0.86), uColor, smoothstep(1.15, 1.8, rho));
  vec3 col = vec3(1.0, 0.95, 0.9) * photon * 1.4 + uColor * glow + hotc * (upper + lower) * (0.4 + 1.3 * flow) * 1.1;
  float edge = 1.0 - smoothstep(0.8, 1.0, length(vUv));
  float clear = 1.0 - haze(vDist);
  // The hole eats the light round it, so even against a bright sky the ring and disk stand out.
  float shade = 0.65 * exp(-(rho - 1.0) * 1.6) * min(uGlow, 1.0) * edge * clear;
  gl_FragColor = vec4(col * uGlow * edge * clear, shade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DISK_VERT = /* glsl */ `
varying vec2 vLocal;
varying float vDoppler;
varying float vDist;
void main() {
  vLocal = position.xy;
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Gas on the side swinging toward the camera is beamed brighter.
  vec3 along = normalize((modelMatrix * vec4(-position.y, position.x, 0.0, 0.0)).xyz);
  vDoppler = dot(along, normalize(cameraPosition - world.xyz));
  vec4 mv = viewMatrix * world;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const DISK_FRAG = /* glsl */ `
${FOG}
${NOISE}
uniform vec3 uColor;
uniform float uTime, uGlow, uSpin;
varying vec2 vLocal;
varying float vDoppler;
varying float vDist;
void main() {
  float r = length(vLocal);
  float rn = clamp((r - ${DISK_INNER.toFixed(2)}) / ${(DISK_OUTER - DISK_INNER).toFixed(2)}, 0.0, 1.0);
  // Inner gas orbits faster, so the pattern shears into spiral streaks.
  float a = atan(vLocal.y, vLocal.x) - uTime * uSpin * pow(${DISK_INNER.toFixed(2)} / r, 1.5);
  float clumps = fbm3(vec3(cos(a) * 2.2, sin(a) * 2.2, log(r) * 7.0));
  float lanes = noise3(vec3(cos(a) * 1.1, sin(a) * 1.1, log(r) * 26.0));
  float density = smoothstep(0.0, 0.06, rn) * (1.0 - smoothstep(0.55, 1.0, rn));
  float lum = density * (0.25 + 0.9 * clumps * clumps + 0.3 * lanes) * pow(1.0 - rn, 1.2) + exp(-rn * 18.0) * 0.5;
  vec3 hotc = mix(vec3(1.0, 0.9, 0.78), uColor, smoothstep(0.02, 0.3, rn));
  hotc = mix(hotc, uColor * 0.3 + vec3(0.22, 0.05, 0.02), smoothstep(0.45, 1.0, rn));
  float beam = pow(clamp(1.0 + 0.6 * vDoppler, 0.35, 1.6), 1.5);
  float clear = 1.0 - haze(vDist);
  // Dust between the hot lanes dims what lies behind, so the disk keeps its shape against a bright sky.
  float dust = density * (0.3 + 0.4 * (1.0 - clumps)) * min(uGlow, 1.0) * clear;
  gl_FragColor = vec4(hotc * lum * beam * uGlow * clear, dust);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Sea spray torn off the water and wound in: every streak placed on the GPU from its seed and the time. */
const INFALL_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uReach, uHorizon, uDrop, uSpin, uViewportH;
varying vec2 vUv;
varying float vHeat;
varying float vNear;
varying float vDist;
vec3 at(float ph) {
  float r0 = uReach * aSeed.y;
  float r = uHorizon * 1.3 + (r0 - uHorizon * 1.3) * pow(1.0 - ph, 1.5);
  float ang = aSeed.x + uSpin * (sqrt(r0 / r) - 1.0);
  float y = -uDrop * (1.0 - smoothstep(0.1, 0.92, ph));
  return vec3(cos(ang) * r, y, sin(ang) * r);
}
void main() {
  float ph = fract(uTime * aSeed.z + aSeed.w);
  vec4 head = modelViewMatrix * vec4(at(ph), 1.0);
  vec4 tail = modelViewMatrix * vec4(at(max(0.0, ph - 0.045)), 1.0);
  vec2 axis = head.xy - tail.xy;
  float len = length(axis);
  vec2 dir = len > 0.001 ? axis / len : vec2(1.0, 0.0);
  float dist = max(1.0, -head.z);
  float width = max(mix(5.0, 1.6, ph), 1.4 * dist / (projectionMatrix[1][1] * uViewportH * 0.5));
  vec4 p = mix(tail, head, position.x + 0.5);
  p.xy += vec2(-dir.y, dir.x) * position.y * width;
  gl_Position = projectionMatrix * p;
  vUv = position.xy + 0.5;
  vHeat = ph;
  // Streaks passing the camera would sweep the whole screen; let them thin out instead.
  vNear = smoothstep(80.0, 320.0, dist);
  vDist = dist;
}
`;

const INFALL_FRAG = /* glsl */ `
${FOG}
uniform vec3 uColor;
uniform float uGlow;
varying vec2 vUv;
varying float vHeat;
varying float vNear;
varying float vDist;
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float a = across * across * vUv.x * smoothstep(0.0, 0.12, vHeat) * (1.0 - smoothstep(0.86, 1.0, vHeat));
  vec3 col = mix(vec3(0.75, 0.88, 0.95), uColor * 2.0, smoothstep(0.25, 0.75, vHeat));
  col = mix(col, vec3(2.2, 2.1, 2.0), smoothstep(0.8, 0.97, vHeat));
  gl_FragColor = vec4(col * a * vNear * uGlow * 0.6 * (1.0 - haze(vDist)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The sea drawn down into a whirlpool under the hole: foam arms winding inward round a dark throat. */
const SWIRL_FRAG = /* glsl */ `
${FOG}
${NOISE}
uniform vec3 uColor;
uniform float uTime, uGlow, uSpin;
varying vec2 vP;
varying float vDist;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float a = atan(vP.y, vP.x) + uTime * uSpin * 0.25 / max(r, 0.06) + log(max(r, 0.01)) * 5.0;
  float arms = pow(0.5 + 0.5 * sin(a * 4.0), 3.0);
  float grain = noise3(vec3(vP * 16.0, uTime * 0.3));
  float foam = arms * (0.45 + 0.75 * grain) * smoothstep(0.03, 0.22, r) * (1.0 - smoothstep(0.55, 1.0, r));
  float throat = 1.0 - smoothstep(0.0, 0.3, r);
  vec3 col = mix(vec3(0.015, 0.04, 0.06), vec3(0.86, 0.93, 0.97), foam);
  col += uColor * throat * throat * 0.35;
  float alpha = clamp(foam * 0.8 + throat * 0.7, 0.0, 1.0) * uGlow;
  gl_FragColor = vec4(mix(col, uFogColor, fogAt(vDist)), alpha);
  #include <colorspace_fragment>
}
`;

const SWIRL_VERT = /* glsl */ `
varying vec2 vP;
varying float vDist;
void main() {
  vP = position.xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fog = () => ({ uFogColor: { value: new Color(0xaaaaaa) }, uFogDensity: { value: 0 } });

/** One hole: five draws (horizon, halo, disk, infall, whirlpool). */
class Singularity {
  readonly group = new Group();
  readonly horizon: Mesh;
  readonly halo: Mesh;
  readonly disk: Mesh;
  readonly infall: Mesh;
  readonly swirl: Mesh;
  private materials: ShaderMaterial[];
  private normal = new Vector3();
  private tilt = new Group();

  constructor(infall: number, seed: number) {
    const quad = new PlaneGeometry(1, 1);
    const shared = { uTime: { value: 0 }, uGlow: { value: 0 }, uColor: { value: new Color() }, uSpin: { value: 1 } };
    const horizon = new ShaderMaterial({ uniforms: { ...fog(), uSize: { value: HORIZON } }, vertexShader: BILLBOARD, fragmentShader: HORIZON_FRAG });
    const halo = new ShaderMaterial({
      uniforms: { ...fog(), ...shared, uSize: { value: HORIZON * HALO }, uRatio: { value: HALO }, uNormal: { value: this.normal } },
      vertexShader: BILLBOARD,
      fragmentShader: HALO_FRAG,
      blending: NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
    });
    // Premultiplied: the disk adds its light and its dust takes some of the background away.
    const disk = new ShaderMaterial({
      uniforms: { ...fog(), ...shared },
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      blending: NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const streaks = new ShaderMaterial({
      uniforms: { ...fog(), ...shared, uReach: { value: 1000 }, uHorizon: { value: HORIZON }, uDrop: { value: SINGULARITY_Y }, uViewportH: { value: 720 } },
      vertexShader: INFALL_VERT,
      fragmentShader: INFALL_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const swirl = new ShaderMaterial({
      uniforms: { ...fog(), ...shared, uGlow: { value: 0 } },
      vertexShader: SWIRL_VERT,
      fragmentShader: SWIRL_FRAG,
      blending: NormalBlending,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials = [horizon, halo, disk, streaks, swirl];

    this.horizon = new Mesh(quad, horizon);
    this.halo = new Mesh(quad, halo);
    // Under the disk, so its shadow dims the background but not the gas passing in front.
    this.halo.renderOrder = 5;
    this.disk = new Mesh(new RingGeometry(DISK_INNER, DISK_OUTER, 160, 6), disk);
    this.disk.renderOrder = 6;
    // Lie the disk flat (local angle runs from +x toward +z); `face` tips it toward a bearing.
    this.disk.rotation.set(Math.PI / 2, 0, 0);
    this.tilt.add(this.disk);
    this.face(0, 1);

    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(infall * 4);
    for (let i = 0; i < infall; i++) {
      seeds[i * 4] = hash01(seed * 31 + i, 2) * Math.PI * 2;
      seeds[i * 4 + 1] = 0.25 + 0.75 * Math.sqrt(hash01(seed * 31 + i, 3));
      seeds[i * 4 + 2] = 0.22 + 0.4 * hash01(seed * 31 + i, 4);
      seeds[i * 4 + 3] = hash01(seed * 31 + i, 5);
    }
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = infall;
    this.infall = new Mesh(geo, streaks);
    this.infall.renderOrder = 6;

    this.swirl = new Mesh(new CircleGeometry(1, 128), swirl);
    this.swirl.rotation.x = -Math.PI / 2;
    this.swirl.renderOrder = 1;

    for (const m of [this.horizon, this.halo, this.disk, this.infall, this.swirl]) m.frustumCulled = false;
    this.group.add(this.horizon, this.halo, this.tilt, this.infall);
    this.group.name = 'tungsten-singularity';
    this.horizon.name = 'tungsten-horizon';
    this.halo.name = 'tungsten-halo';
    this.disk.name = 'tungsten-disk';
    this.infall.name = 'tungsten-infall';
    this.swirl.name = 'tungsten-whirlpool';
  }

  /**
   * Tips the disk's top face toward (dx, dz), so a camera on that side sees it as an open ellipse rather
   * than a line across the hole.
   */
  face(dx: number, dz: number): void {
    this.tilt.rotation.set(0.38, Math.atan2(dx, dz), 0, 'YXZ');
  }

  /** Lays the hole out for one frame. `size` scales the horizon; `glow` its light; `spin` the gas. */
  set(x: number, z: number, reach: number, size: number, glow: number, spin: number, time: number, color: Color, heightPx: number): void {
    this.group.position.set(x, SINGULARITY_Y, z);
    this.group.scale.setScalar(1);
    this.swirl.position.set(x, 2.6, z);
    this.swirl.scale.setScalar(reach * 0.8);
    const h = HORIZON * size;
    const u = (i: number) => this.materials[i].uniforms;
    u(0).uSize.value = h;
    u(1).uSize.value = h * HALO;
    this.tilt.scale.setScalar(h);
    const streaks = u(3);
    streaks.uReach.value = reach;
    streaks.uHorizon.value = h;
    streaks.uViewportH.value = heightPx;
    // The disk's world normal, for the halo's lensed arcs.
    this.disk.updateWorldMatrix(true, false);
    this.normal.set(0, 0, 1).transformDirection(this.disk.matrixWorld);
    // Halo, disk and infall share one set of these uniforms; the whirlpool has its own glow.
    const shared = u(1);
    shared.uTime.value = time;
    shared.uGlow.value = glow;
    shared.uSpin.value = spin;
    shared.uColor.value.copy(color);
    // The whirlpool builds up with the pull, ahead of the disk lighting.
    u(4).uGlow.value = Math.min(1, glow * 1.4);
  }

  setFog(color: Color, density: number): void {
    for (const m of this.materials) {
      m.uniforms.uFogColor.value.copy(color);
      m.uniforms.uFogDensity.value = density;
    }
  }

  dispose(): void {
    this.horizon.geometry.dispose();
    this.disk.geometry.dispose();
    this.infall.geometry.dispose();
    this.swirl.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}

interface Hole {
  view: Singularity;
  look: CollapseLook;
  /** Render time the Collapse ended (the burst), or -1 while it holds. */
  ended: number;
}

/**
 * Collapse's black holes, one per Tungsten mid-Collapse: built from the sim's ult state each frame, faded
 * out briefly after the burst, and a gravitational lens for the post chain on bloom tiers.
 */
export class TungstenSingularities {
  readonly distortions: SpatialDistortion[] = [];
  private holes = new Map<Ship, Hole>();
  private spare: Singularity[] = [];
  private fogColor = new Color(0xaaaaaa);
  private fogDensity = 0;
  private color = new Color();

  constructor(
    private scene: Scene,
    private game: Game,
    private infall: number,
    private reduce: boolean,
  ) {}

  /** Number of holes on screen. */
  get count(): number {
    return this.holes.size;
  }

  update(heightPx = 720): void {
    const now = this.game.renderTime;
    this.distortions.length = 0;
    const seen = new Set<Ship>();
    for (const s of this.game.ships) {
      const look = collapseLook(s, this.game);
      if (!look || look.hold < 0) continue;
      seen.add(s);
      const hole = this.holes.get(s);
      if (hole) {
        hole.look = look;
        hole.ended = -1;
      } else {
        // Opens toward its caster, whose camera is usually the one watching.
        const view = this.take(s.id);
        view.face(s.renderPos.x - look.x, s.renderPos.z - look.z);
        this.holes.set(s, { view, look, ended: -1 });
      }
    }
    for (const [s, hole] of this.holes) {
      if (!seen.has(s) && hole.ended < 0) hole.ended = now;
      const out = hole.ended < 0 ? 0 : clamp01((now - hole.ended) / FADE);
      if (out >= 1) {
        this.release(hole.view);
        this.holes.delete(s);
        continue;
      }
      this.draw(hole, out, heightPx);
    }
  }

  private draw(hole: Hole, out: number, heightPx: number): void {
    const C = CUBE.collapse;
    const { look } = hole;
    const scale = look.merged ? C.mergedRadius : 1;
    // Forms as the cube is crushed, tightens just before the burst, and winks out after it.
    const form = smooth((look.hold - 0.15) / 0.6);
    const squeeze = smooth((look.hold - (C.pull - 0.5)) / 0.5);
    const size = scale * (0.15 + 0.85 * form) * (1 - 0.3 * squeeze) * (1 - out);
    const glow = form * (1 + squeeze * 0.6) * (1 - out * 0.6);
    const time = this.reduce ? 0 : look.hold;
    this.color.copy(modeColor(look.mode));
    hole.view.set(look.x, look.z, C.radius * scale, size, glow, 1.6 + squeeze * 3, time, this.color, heightPx);
    if (!this.reduce && size > 0.01)
      this.distortions.push({ x: look.x, y: SINGULARITY_Y, z: look.z, radius: HORIZON * size * LENS, strength: 0.75 * form * (1 - out), priority: 6, kind: 'lens' });
  }

  private take(seed: number): Singularity {
    const view = this.spare.pop() ?? new Singularity(this.infall, seed);
    view.setFog(this.fogColor, this.fogDensity);
    this.scene.add(view.group, view.swirl);
    return view;
  }

  private release(view: Singularity): void {
    this.scene.remove(view.group, view.swirl);
    this.spare.push(view);
  }

  /** Drops every hole at once (battle end, rewind). */
  clear(): void {
    for (const hole of this.holes.values()) this.release(hole.view);
    this.holes.clear();
    this.distortions.length = 0;
  }

  setFog(color: Color, density: number): void {
    this.fogColor.copy(color);
    this.fogDensity = density;
    for (const v of [...this.spare, ...[...this.holes.values()].map((h) => h.view)]) v.setFog(color, density);
  }

  dispose(): void {
    this.clear();
    for (const v of this.spare) v.dispose();
    this.spare = [];
  }
}
