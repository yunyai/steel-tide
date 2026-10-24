import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

// Pooled GPU billboards. One draw call per system; three systems cover
// alpha smoke/spray, additive fire/flashes, and flat water decals (wakes, foam).

export const PK = { Smoke: 0, Glow: 1, Spray: 2, Ring: 3, Foam: 4 } as const;
export type PK = (typeof PK)[keyof typeof PK];

export interface PSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  size1?: number;
  color: number;
  color1?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  rot?: number;
  kind?: PK;
  fadeIn?: number;
  fadeOut?: number;
  /** Rise like hot smoke (negative gravity) but slow down with drag. */
  floor?: boolean;
}

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec3 iMisc;
varying vec2 vUv;
varying vec4 vColor;
varying float vKind;
varying float vSeed;
varying float vDist;
varying float vCover;
void main() {
  vUv = position.xy + 0.5;
  float size = iMisc.x;
  float c = cos(iMisc.y);
  float s = sin(iMisc.y);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
#ifdef FLAT
  vec4 mv = viewMatrix * vec4(iPos + vec3(q.x, 0.0, q.y), 1.0);
#else
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += q;
#endif
  gl_Position = projectionMatrix * mv;
  vColor = iColor;
  vKind = floor(iMisc.z);
  vSeed = fract(iMisc.z);
  vDist = -mv.z;
  // Roughly the angle the sprite spans, in radians.
  vCover = size / max(vDist, 1.0);
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
  if (r > 1.0) discard;
  float a;
  vec2 o = vec2(vSeed * 37.0, vSeed * 91.0);
  if (vKind < 0.5) {
    float n = noise(p * 4.0 + o) * 0.6 + noise(p * 9.0 - o) * 0.4;
    a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.7);
  } else if (vKind < 1.5) {
    a = pow(max(0.0, 1.0 - r), 2.0);
  } else if (vKind < 2.5) {
    float n = noise(p * 7.0 + o);
    a = smoothstep(1.0, 0.3, r) * smoothstep(0.25, 0.65, n + (1.0 - r) * 0.4);
  } else if (vKind < 3.5) {
    a = smoothstep(0.22, 0.0, abs(r - 0.75)) * (0.6 + 0.4 * noise(p * 10.0 + o));
  } else {
    float n = noise(p * 6.0 + o) * 0.65 + noise(p * 15.0 + o) * 0.35;
    a = smoothstep(1.0, 0.4, r) * smoothstep(0.35, 0.7, n);
  }
  a *= vColor.a;
#if !defined(ADDITIVE) && !defined(FLAT)
  // Smoke and spray right by the camera would fill the screen: fade puffs wider than about a third of the view.
  a *= 1.0 - smoothstep(0.3, 0.8, vCover);
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

const tmpA = new Color();
const tmpB = new Color();

export class ParticleSystem {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  count = 0;
  private geo: InstancedBufferGeometry;
  private aPos: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  private aMisc: InstancedBufferAttribute;
  // State (struct of arrays).
  private p: Float32Array;
  private v: Float32Array;
  private t: Float32Array; // age, life, fadeIn, fadeOut
  private s: Float32Array; // size0, size1, rot, spin
  private c: Float32Array; // r0 g0 b0 r1 g1 b1 alpha
  private f: Float32Array; // gravity, drag, kind+seed, floor

  constructor(
    readonly max: number,
    mode: 'alpha' | 'add' | 'flat',
  ) {
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.aPos = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.aColor = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aMisc = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iMisc', this.aMisc);
    this.geo.instanceCount = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.t = new Float32Array(max * 4);
    this.s = new Float32Array(max * 4);
    this.c = new Float32Array(max * 7);
    this.f = new Float32Array(max * 4);
    const defines: Record<string, string> = {};
    if (mode === 'add') defines.ADDITIVE = '';
    if (mode === 'flat') defines.FLAT = '';
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      defines,
      uniforms: { uFogColor: { value: new Color(0xaaaaaa) }, uFogDensity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: mode === 'add' ? AdditiveBlending : NormalBlending,
    });
    if (mode === 'flat') {
      this.material.polygonOffset = true;
      this.material.polygonOffsetFactor = -2;
      this.material.polygonOffsetUnits = -2;
    }
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = mode === 'flat' ? 1 : mode === 'alpha' ? 5 : 6;
  }

  setFog(color: Color, density: number): void {
    this.material.uniforms.uFogColor.value.copy(color);
    this.material.uniforms.uFogDensity.value = density;
  }

  spawn(o: PSpawn): void {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.p[i * 3] = o.x;
    this.p[i * 3 + 1] = o.y;
    this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx ?? 0;
    this.v[i * 3 + 1] = o.vy ?? 0;
    this.v[i * 3 + 2] = o.vz ?? 0;
    this.t[i * 4] = 0;
    this.t[i * 4 + 1] = o.life;
    this.t[i * 4 + 2] = o.fadeIn ?? 0.05;
    this.t[i * 4 + 3] = o.fadeOut ?? 0.5;
    this.s[i * 4] = o.size;
    this.s[i * 4 + 1] = o.size1 ?? o.size;
    this.s[i * 4 + 2] = o.rot ?? Math.random() * Math.PI * 2;
    this.s[i * 4 + 3] = o.spin ?? 0;
    tmpA.setHex(o.color);
    tmpB.setHex(o.color1 ?? o.color);
    const c = this.c;
    c[i * 7] = tmpA.r;
    c[i * 7 + 1] = tmpA.g;
    c[i * 7 + 2] = tmpA.b;
    c[i * 7 + 3] = tmpB.r;
    c[i * 7 + 4] = tmpB.g;
    c[i * 7 + 5] = tmpB.b;
    c[i * 7 + 6] = o.alpha ?? 1;
    this.f[i * 4] = o.gravity ?? 0;
    this.f[i * 4 + 1] = o.drag ?? 0;
    this.f[i * 4 + 2] = (o.kind ?? 0) + Math.random() * 0.98;
    this.f[i * 4 + 3] = o.floor ? 1 : 0;
  }

  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.p.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.v.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.t.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.s.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.c.copyWithin(i * 7, j * 7, j * 7 + 7);
    this.f.copyWithin(i * 4, j * 4, j * 4 + 4);
  }

  update(dt: number): void {
    const { p, v, t, s, c, f } = this;
    for (let i = 0; i < this.count; i++) {
      const age = (t[i * 4] += dt);
      if (age >= t[i * 4 + 1]) {
        this.kill(i);
        i--;
        continue;
      }
      const drag = Math.max(0, 1 - f[i * 4 + 1] * dt);
      v[i * 3] *= drag;
      v[i * 3 + 1] = v[i * 3 + 1] * drag - f[i * 4] * dt;
      v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (f[i * 4 + 3] > 0 && p[i * 3 + 1] < 0.5) {
        p[i * 3 + 1] = 0.5;
        if (v[i * 3 + 1] < 0) v[i * 3 + 1] = 0;
      }
      s[i * 4 + 2] += s[i * 4 + 3] * dt;
    }
    const n = this.count;
    const ap = this.aPos.array as Float32Array;
    const ac = this.aColor.array as Float32Array;
    const am = this.aMisc.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const k = t[i * 4] / t[i * 4 + 1];
      const fi = t[i * 4 + 2];
      const fo = t[i * 4 + 3];
      const ain = fi > 0 ? Math.min(1, k / fi) : 1;
      const aout = k > fo ? 1 - (k - fo) / (1 - fo) : 1;
      const grow = 1 - (1 - k) * (1 - k);
      ap[i * 3] = p[i * 3];
      ap[i * 3 + 1] = p[i * 3 + 1];
      ap[i * 3 + 2] = p[i * 3 + 2];
      ac[i * 4] = c[i * 7] + (c[i * 7 + 3] - c[i * 7]) * k;
      ac[i * 4 + 1] = c[i * 7 + 1] + (c[i * 7 + 4] - c[i * 7 + 1]) * k;
      ac[i * 4 + 2] = c[i * 7 + 2] + (c[i * 7 + 5] - c[i * 7 + 2]) * k;
      ac[i * 4 + 3] = c[i * 7 + 6] * ain * aout;
      am[i * 3] = s[i * 4] + (s[i * 4 + 1] - s[i * 4]) * grow;
      am[i * 3 + 1] = s[i * 4 + 2];
      am[i * 3 + 2] = f[i * 4 + 2];
    }
    this.geo.instanceCount = n;
    if (n) {
      this.aPos.addUpdateRange(0, n * 3);
      this.aColor.addUpdateRange(0, n * 4);
      this.aMisc.addUpdateRange(0, n * 3);
      this.aPos.needsUpdate = this.aColor.needsUpdate = this.aMisc.needsUpdate = true;
    }
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
