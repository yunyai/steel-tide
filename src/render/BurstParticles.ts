import { AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, type Scene } from 'three';

// Immediate-mode billboards rebuilt from event state every prepare, so rewind, replay,
// per-viewport concealment and screenshots all see the same particles for the same time.

/** Particle shapes; the kind picks the batch: additive light, alpha-blended mass, or flat water decals. */
export const BK = { Glow: 0, Flare: 1, Spark: 2, Shard: 3, Smoke: 4, Spray: 5, Ring: 6, Foam: 7, Hex: 8 } as const;
export type BK = (typeof BK)[keyof typeof BK];
const BATCH_OF = ['additive', 'additive', 'additive', 'additive', 'alpha', 'alpha', 'flat', 'flat', 'flat'] as const;
type BatchName = (typeof BATCH_OF)[number];

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iMisc;
attribute vec3 iStreak;
uniform float uViewportH;
varying vec2 vUv;
varying vec4 vColor;
varying float vKind;
varying float vSeed;
varying float vDist;
varying float vCover;
void main() {
  vUv = position.xy + 0.5;
  float c = cos(iMisc.y);
  float s = sin(iMisc.y);
#ifdef FLAT
  float size = iMisc.x;
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
  // Plane y maps to world -z so the decal keeps its front face toward the sky.
  vec4 mv = viewMatrix * vec4(iPos + vec3(q.x, 0.0, -q.y), 1.0);
#else
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float dist = max(1.0, -mv.z);
  // Distant sparks keep a minimum pixel footprint instead of vanishing between pixels.
  float size = max(iMisc.x, iMisc.w * 2.0 * dist / (projectionMatrix[1][1] * uViewportH));
  vec3 streak = (viewMatrix * vec4(iStreak, 0.0)).xyz;
  float len = length(streak.xy);
  vec2 q;
  if (len > 0.001) {
    // Stretch along the screen-space path, head at the particle and tail trailing behind.
    vec2 d = streak.xy / len;
    q = d * position.x * (size + len) + vec2(-d.y, d.x) * position.y * size;
    mv.xy -= d * len * 0.5;
  } else {
    q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
  }
  mv.xy += q;
#endif
  gl_Position = projectionMatrix * mv;
  vColor = iColor;
  vKind = floor(iMisc.z);
  vSeed = fract(iMisc.z);
  vDist = -mv.z;
  vCover = size / max(-mv.z, 1.0);
}
`;

const frag = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vColor;
varying float vKind;
varying float vSeed;
varying float vDist;
varying float vCover;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  vec2 o = vec2(vSeed * 37.0, vSeed * 91.0);
  float a;
  if (vKind < 0.5) {
    a = pow(max(0.0, 1.0 - r), 2.2);
  } else if (vKind < 1.5) {
    // Star flare: a hot core with four thin rays.
    float core = pow(max(0.0, 1.0 - r), 3.0);
    float rays = max(0.0, 1.0 - abs(p.x) * 26.0) + max(0.0, 1.0 - abs(p.y) * 26.0);
    a = core + rays * max(0.0, 1.0 - r) * 0.7;
  } else if (vKind < 2.5) {
    // Streak: bright head, thin fading tail.
    float across = abs(p.y) * 2.0;
    a = max(0.0, 1.0 - across * across) * mix(0.08, 1.0, vUv.x * vUv.x);
  } else if (vKind < 3.5) {
    // Faceted shard: a diamond with one lit face.
    float d = abs(p.x) * 1.15 + abs(p.y) * 2.2;
    a = smoothstep(0.55, 0.48, d) * (p.x * p.y > 0.0 ? 1.0 : 0.45);
  } else if (vKind < 4.5) {
    float n = noise(p * 4.0 + o) * 0.6 + noise(p * 9.0 - o) * 0.4;
    a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.7);
  } else if (vKind < 5.5) {
    float n = noise(p * 7.0 + o);
    a = smoothstep(1.0, 0.3, r) * smoothstep(0.25, 0.65, n + (1.0 - r) * 0.4);
  } else if (vKind < 6.5) {
    a = smoothstep(0.06, 0.0, abs(r - 0.86)) * (0.75 + 0.25 * noise(p * 12.0 + o));
  } else if (vKind < 7.5) {
    float n = noise(p * 6.0 + o) * 0.65 + noise(p * 15.0 + o) * 0.35;
    a = smoothstep(1.0, 0.4, r) * smoothstep(0.35, 0.7, n);
  } else {
    vec2 h = abs(p) * 2.0;
    float hd = max(h.x * 0.866 + h.y * 0.5, h.y);
    a = smoothstep(0.05, 0.0, abs(hd - 0.82));
  }
  if (r > 1.0 && vKind != 2.0 && vKind != 3.0) discard;
  a *= vColor.a;
#if !defined(ADDITIVE) && !defined(FLAT)
  a *= 1.0 - smoothstep(0.3, 0.8, vCover);
#endif
#ifdef ADDITIVE
  // Sparks and shards right by the camera would become screen-wide bars; big glows would white out the view.
  a *= vKind > 1.5 ? 1.0 - smoothstep(0.02, 0.07, vCover) : 1.0 - smoothstep(0.6, 1.4, vCover);
#endif
  if (a < 0.003) discard;
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
#ifdef ADDITIVE
  vec3 col = vColor.rgb * (1.0 - fog);
#else
  vec3 col = mix(vColor.rgb, uFogColor, fog);
#endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class BurstBatch {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  count = 0;
  peak = 0;
  drops = 0;
  readonly geo: InstancedBufferGeometry;
  readonly pos: InstancedBufferAttribute;
  readonly color: InstancedBufferAttribute;
  readonly misc: InstancedBufferAttribute;
  readonly streak: InstancedBufferAttribute;

  constructor(readonly capacity: number, mode: BatchName, name: string) {
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    const attr = (n: number) => new InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(DynamicDrawUsage);
    this.pos = attr(3);
    this.color = attr(4);
    this.misc = attr(4);
    this.streak = attr(3);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iColor', this.color);
    this.geo.setAttribute('iMisc', this.misc);
    this.geo.setAttribute('iStreak', this.streak);
    this.geo.instanceCount = 0;
    const defines: Record<string, string> = {};
    if (mode === 'additive') defines.ADDITIVE = '';
    if (mode === 'flat') defines.FLAT = '';
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      defines,
      uniforms: { uFogColor: { value: new Color(0xaaaaaa) }, uFogDensity: { value: 0 }, uViewportH: { value: 720 } },
      transparent: true,
      depthWrite: false,
      blending: mode === 'additive' ? AdditiveBlending : NormalBlending,
    });
    if (mode === 'flat') {
      this.material.polygonOffset = true;
      this.material.polygonOffsetFactor = -2;
      this.material.polygonOffsetUnits = -2;
    }
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = mode === 'flat' ? 1 : mode === 'alpha' ? 5 : 6;
  }

  /** Writes one instance; returns false when the batch is full. */
  write(x: number, y: number, z: number, size: number, c: Color, alpha: number, kind: number, rot: number, seed: number, sx: number, sy: number, sz: number, minPx: number): boolean {
    if (this.count >= this.capacity) {
      this.drops++;
      return false;
    }
    const i = this.count++;
    const P = this.pos.array as Float32Array;
    const C = this.color.array as Float32Array;
    const M = this.misc.array as Float32Array;
    const S = this.streak.array as Float32Array;
    P[i * 3] = x;
    P[i * 3 + 1] = y;
    P[i * 3 + 2] = z;
    C[i * 4] = c.r;
    C[i * 4 + 1] = c.g;
    C[i * 4 + 2] = c.b;
    C[i * 4 + 3] = alpha;
    M[i * 4] = size;
    M[i * 4 + 1] = rot;
    M[i * 4 + 2] = kind + seed * 0.98;
    M[i * 4 + 3] = minPx;
    S[i * 3] = sx;
    S[i * 3 + 1] = sy;
    S[i * 3 + 2] = sz;
    return true;
  }

  /** The kind of instance i, for tests and diagnostics. */
  kindAt(i: number): number {
    return Math.floor((this.misc.array as Float32Array)[i * 4 + 2]);
  }

  end(): void {
    const n = this.count;
    this.peak = Math.max(this.peak, n);
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const attribute of [this.pos, this.color, this.misc, this.streak]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, n * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

export interface BurstCaps {
  additive: number;
  alpha: number;
  flat: number;
}

/** Three draw calls of billboards, filled from scratch each prepare by `push`. */
export class BurstParticles {
  readonly batches: Record<BatchName, BurstBatch>;
  private readonly list: BurstBatch[];

  constructor(
    private scene: Scene,
    caps: BurstCaps,
    name: string,
  ) {
    this.batches = {
      flat: new BurstBatch(caps.flat, 'flat', `${name}-flat`),
      alpha: new BurstBatch(caps.alpha, 'alpha', `${name}-alpha`),
      additive: new BurstBatch(caps.additive, 'additive', `${name}-additive`),
    };
    this.list = Object.values(this.batches);
    for (const b of this.list) scene.add(b.mesh);
  }

  begin(heightPx = 720): void {
    for (const b of this.list) {
      b.count = 0;
      b.material.uniforms.uViewportH.value = heightPx;
    }
  }

  /** `sx,sy,sz` is a world streak vector (sparks and streaks); `minPx` keeps distant sparks visible. */
  push(kind: BK, x: number, y: number, z: number, size: number, c: Color, alpha: number, rot = 0, seed = 0, sx = 0, sy = 0, sz = 0, minPx = 0): boolean {
    if (alpha < 0.004 || !(size > 0)) return true;
    return this.batches[BATCH_OF[kind]].write(x, y, z, size, c, Math.min(1, alpha), kind, rot, seed, sx, sy, sz, minPx);
  }

  end(): void {
    for (const b of this.list) b.end();
  }

  get count(): number {
    return this.list.reduce((n, b) => n + b.count, 0);
  }

  /** Non-empty draw calls this prepare. */
  get drawn(): number {
    return this.list.filter((b) => b.count > 0).length;
  }

  get stats() {
    return Object.fromEntries(Object.entries(this.batches).map(([k, b]) => [k, { capacity: b.capacity, count: b.count, peak: b.peak, drops: b.drops }])) as Record<BatchName, { capacity: number; count: number; peak: number; drops: number }>;
  }

  setFog(color: Color, density: number): void {
    for (const b of this.list) {
      b.material.uniforms.uFogColor.value.copy(color);
      b.material.uniforms.uFogDensity.value = density;
    }
  }

  dispose(): void {
    for (const b of this.list) {
      this.scene.remove(b.mesh);
      b.dispose();
    }
  }
}

/** Stable [0,1) hash of two integers; render-side randomness keyed by event ids. */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Ballistic travel with linear drag `k` and gravity `g` (negative rises), evaluated at age `t`. */
export function drift(t: number, v: number, k: number, g = 0): number {
  if (k < 1e-4) return v * t - 0.5 * g * t * t;
  const e = (1 - Math.exp(-k * t)) / k;
  return v * e - (g / k) * (t - e);
}

/** Velocity at age `t` of the same motion as `drift`. */
export function driftSpeed(t: number, v: number, k: number, g = 0): number {
  if (k < 1e-4) return v - g * t;
  const e = Math.exp(-k * t);
  return v * e - (g / k) * (1 - e);
}
