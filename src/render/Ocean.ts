import {
  BufferGeometry,
  Color,
  type CubeTexture,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  type Texture,
  Vector3,
  Vector4,
  type Camera,
} from 'three';
import { makeRng } from '../core/math';
import { WAVES } from '../world/Waves';
import { SHORE_LOW, SHORE_SPAN } from './Islands';

// Gerstner-swell ocean on a camera-following polar grid. Vertex displacement
// uses the same WAVES as the CPU buoyancy (Waves.ts); per-pixel normals add
// short shader-only waves and baked ripples. Each ripple layer is rotated and
// scaled off the others, and a kilometre-scale wind mask breaks the sea into
// rough and calm patches, so no tile repeat reads. It reflects the baked sky,
// fades into the sky's own horizon colour and, given a shore map, shows
// shallows and surf around the islands.

let detail: DataTexture | null = null;

/** Segments around and ring growth of the camera-centred grid. */
const GRID = { full: { seg: 256, growth: 1.03 }, lite: { seg: 96, growth: 1.07 } };

/** Grid cell size per metre of distance from the camera (the larger of the two cell sides). */
function cellPerMetre(lite: boolean): number {
  const g = lite ? GRID.lite : GRID.full;
  return Math.max((Math.PI * 2) / g.seg, g.growth - 1);
}

function polarGrid(lite: boolean): BufferGeometry {
  const SEG = (lite ? GRID.lite : GRID.full).seg;
  const pos: number[] = [0, 0, 0];
  const radii: number[] = [];
  const g = (lite ? GRID.lite : GRID.full).growth;
  const a = 2;
  for (let i = 1; ; i++) {
    const r = (a * (Math.pow(g, i) - 1)) / (g - 1);
    radii.push(r);
    if (r > 42000) break;
  }
  for (const r of radii) {
    for (let j = 0; j < SEG; j++) {
      const t = (j / SEG) * Math.PI * 2;
      pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < SEG; j++) idx.push(0, 1 + ((j + 1) % SEG), 1 + j);
  for (let i = 0; i < radii.length - 1; i++) {
    const a0 = 1 + i * SEG;
    const b0 = 1 + (i + 1) * SEG;
    for (let j = 0; j < SEG; j++) {
      const j1 = (j + 1) % SEG;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = null;
  return geo;
}

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[4];
uniform float uSteep[4];
uniform float uCell;
varying vec3 vWorld;
varying float vHeight;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - cameraPosition.xz);
  float atten = 1.0 - smoothstep(2500.0, 7000.0, dist);
  // The grid coarsens with distance; a swell drawn on cells over a quarter of its wavelength
  // would alias into a lattice, so it flattens out before that.
  float cell = dist * uCell;
  vec3 disp = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = uWaves[i].xy;
    float k = uWaves[i].z;
    float amp = uWaves[i].w * (1.0 - smoothstep(0.25, 0.5, cell * k / 6.2831853));
    float c = sqrt(9.81 / k);
    float ph = k * (dot(d, wp.xz) - c * uTime);
    disp.y += amp * sin(ph);
    disp.xz -= d * (uSteep[i] * amp * cos(ph));
  }
  wp.xyz += disp * atten;
  vHeight = disp.y * atten;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[4];
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uDetail;
uniform samplerCube uSkyCube;
uniform float uHasCube;
uniform sampler2D uShore;
uniform float uShoreHalf;
uniform float uShoreLow;
uniform float uShoreSpan;
varying vec3 vWorld;
varying float vHeight;

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// Baked ripple slope at one scale, sampled in a rotated frame (and rotated back) and drifting.
vec2 ripple(vec2 p, float scale, float ang, vec2 drift) {
  mat2 r = rot(ang);
  vec2 s = texture2D(uDetail, (r * p) / scale + drift * uTime).rg * 2.0 - 1.0;
  return s * r;
}

// Short wind waves for the normals only (the hulls float on the four big swells).
const vec4 SMALL[4] = vec4[4](
  vec4(0.955, 0.296, 14.0, 0.050),
  vec4(-0.129, 0.992, 21.0, 0.045),
  vec4(-0.857, 0.515, 33.0, 0.040),
  vec4(-0.575, -0.818, 45.0, 0.035)
);

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float atten = 1.0 - smoothstep(2500.0, 7000.0, dist);
  float fine = 1.0 - smoothstep(120.0, 2400.0, dist);
  float mid = 1.0 - smoothstep(300.0, 4000.0, dist);
  float broad = 1.0 - smoothstep(500.0, 6000.0, dist);

  // Wind patches: two slow, rotated, kilometre-scale samples of the smooth noise channel.
  float w1 = texture2D(uDetail, (rot(0.9) * vWorld.xz) / 7600.0 + uTime * vec2(0.00012, 0.00009)).b;
  float w2 = texture2D(uDetail, (rot(2.3) * vWorld.xz) / 12100.0 - uTime * vec2(0.00006, 0.00008)).b;
  float wind = smoothstep(0.3, 0.7, w1 * 0.6 + w2 * 0.4);
  float rough = mix(0.55, 1.3, wind);

  // Analytic slope of the swell, the short wind waves and the baked ripples. Analytic waves have
  // no mipmaps: each fades out once a pixel spans a good part of its wavelength, or it would
  // shimmer into a moiré lattice toward the horizon.
  float foot = max(length(fwidth(vWorld.xz)), 1e-3);
  vec2 slope = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = uWaves[i].xy;
    float k = uWaves[i].z;
    float amp = uWaves[i].w * (1.0 - smoothstep(0.15, 0.5, foot * k / 6.2831853));
    float c = sqrt(9.81 / k);
    float ph = k * (dot(d, vWorld.xz) - c * uTime);
    slope += d * (amp * k * cos(ph)) * mix(0.35, 1.0, atten);
  }
#ifndef LITE
  for (int i = 0; i < 4; i++) {
    vec2 d = SMALL[i].xy;
    float k = 6.2831853 / SMALL[i].z;
    float ph = k * (dot(d, vWorld.xz) - sqrt(9.81 / k) * uTime);
    float aa = 1.0 - smoothstep(0.15, 0.5, foot / SMALL[i].z);
    slope += d * (SMALL[i].w * cos(ph)) * fine * rough * aa;
  }
  slope += ripple(vWorld.xz, 13.7, 0.37, vec2(0.021, 0.013)) * 0.07 * fine * rough;
  slope += ripple(vWorld.xz, 61.0, 1.93, vec2(-0.009, 0.014)) * 0.08 * mid * rough;
#endif
  slope += ripple(vWorld.xz, 237.0, 2.71, vec2(0.003, -0.005)) * 0.07 * broad * rough;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  // The baked sky, clouds and all; blurrier where the ripples are too fine to resolve.
  if (uHasCube > 0.5) sky = min(textureLod(uSkyCube, R, 1.0 + 3.0 * (1.0 - fine)).rgb, vec3(4.0));
  float sunAmt = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunColor * (pow(sunAmt, 900.0) * 6.0 + pow(sunAmt, 60.0) * 0.18 * (1.0 - smoothstep(0.0, 0.25, uSunDir.y) * 0.5));

  float crest = clamp(vHeight * 0.35 + 0.2, 0.0, 1.0);
  float diffuse = max(dot(N, uSunDir), 0.0) * 0.35 + 0.65;
  vec3 body = mix(uDeep, uScatter, crest * (0.35 + 0.65 * pow(1.0 - V.y, 2.0))) * diffuse;
  // Rough water scatters a little more light; calm patches stay dark and glassy.
  body *= mix(0.9, 1.1, wind);

  // Whitecaps on the highest crests, broken up by the ripple ridges, thicker in the wind.
  float ridge = texture2D(uDetail, (rot(2.2) * vWorld.xz) / 131.0 + uTime * vec2(0.003, -0.002)).a;
  float foam = smoothstep(1.5, 2.2, vHeight + ridge * 0.6) * smoothstep(0.5, 0.9, ridge) * atten * 0.45 * mix(0.4, 1.5, wind);

  // Shallows turn green then sandy toward the islands, with surf rolling in at the waterline.
  if (uShoreHalf > 0.0) {
    vec2 suv = vWorld.xz / (2.0 * uShoreHalf) + 0.5;
    float bed = texture2D(uShore, suv).r * uShoreSpan + uShoreLow;
    float depth = max(0.0, vHeight * 0.4 - bed);
    float shallow = 1.0 - smoothstep(1.0, 30.0, depth);
    vec3 shallowCol = mix(uScatter * 1.6 + vec3(0.0, 0.03, 0.02), vec3(0.36, 0.34, 0.24), 1.0 - smoothstep(0.5, 7.0, depth));
    body = mix(body, shallowCol * diffuse, shallow * 0.8);
    float band = sin(depth * 1.2 - uTime * 1.5 + ridge * 2.5);
    float surf = (1.0 - smoothstep(0.5, 8.0, depth)) * smoothstep(0.3, 0.95, band) + (1.0 - smoothstep(0.0, 1.2, depth)) * 0.7;
    foam = max(foam, clamp(surf, 0.0, 1.0) * 0.8 * broad);
  }

  vec3 col = mix(body, sky, F) + spec;
  col = mix(col, vec3(0.86, 0.9, 0.93) * (0.6 + 0.4 * diffuse), foam);

  // Far off, the haze takes the colour of the sky right above the horizon, so sea and sky meet without a seam.
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  vec3 fogCol = uFogColor;
  if (uHasCube > 0.5) {
    vec3 hz = normalize(vec3(-V.x, 0.02, -V.z));
    vec3 skyHz = min(textureLod(uSkyCube, hz, 2.0).rgb, vec3(4.0));
    fogCol = mix(uFogColor, skyHz, smoothstep(0.35, 0.95, fogF));
  }
  col = mix(col, fogCol, fogF);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Tiling ripple map from periodic value noise: RG hold the slope, B the smooth height, A a ridge mask for foam. */
function detailTexture(): DataTexture {
  const N = 512;
  const h = new Float32Array(N * N);
  const rng = makeRng(0x5ea);
  for (const [cells, amp] of [
    [8, 1],
    [16, 0.55],
    [32, 0.3],
    [64, 0.16],
    [128, 0.08],
  ]) {
    const g = Float32Array.from({ length: cells * cells }, () => rng());
    const at = (i: number, j: number) => g[(j % cells) * cells + (i % cells)];
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * cells;
      const y0 = Math.floor(fy);
      const ty = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const x0 = Math.floor(fx);
        const tx = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0));
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        h[y * N + x] += (a + (b - a) * ty) * amp;
      }
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const sx = new Float32Array(N * N);
  const sz = new Float32Array(N * N);
  let max = 1e-6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      sx[i] = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      sz[i] = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      max = Math.max(max, Math.abs(sx[i]), Math.abs(sz[i]));
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const n = (h[i] - lo) / (hi - lo);
    data[i * 4] = Math.round((sx[i] / max) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((sz[i] / max) * 127.5 + 127.5);
    data[i * 4 + 2] = Math.round(n * 255);
    data[i * 4 + 3] = Math.round(Math.pow(1 - Math.abs(2 * n - 1), 2) * 255);
  }
  const tex = new DataTexture(data, N, N, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export interface OceanLook {
  deep: number;
  scatter: number;
  horizon: number;
  zenith: number;
  sunColor: number;
  fog: number;
  fogDensity: number;
}

export class Ocean {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  /** `lite`: coarse grid, a single ripple layer and no sky reflection (Ultra Low). */
  constructor(look: OceanLook, sunDir: Vector3, skyCube: CubeTexture | null = null, lite = false) {
    detail ??= detailTexture();
    if (lite) skyCube = null;
    const waves = WAVES.map((w) => new Vector4(Math.cos(w.dir), Math.sin(w.dir), (2 * Math.PI) / w.length, w.amp));
    this.material = new ShaderMaterial({
      defines: lite ? { LITE: '' } : {},
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaves: { value: waves },
        uSteep: { value: WAVES.map((w) => w.steep) },
        uCell: { value: cellPerMetre(lite) },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new Color(look.sunColor) },
        uHorizon: { value: new Color(look.horizon) },
        uZenith: { value: new Color(look.zenith) },
        uDeep: { value: new Color(look.deep) },
        uScatter: { value: new Color(look.scatter) },
        uFogColor: { value: new Color(look.fog) },
        uFogDensity: { value: look.fogDensity },
        uDetail: { value: detail },
        uSkyCube: { value: skyCube },
        uHasCube: { value: skyCube ? 1 : 0 },
        uShore: { value: null },
        uShoreHalf: { value: 0 },
        uShoreLow: { value: SHORE_LOW },
        uShoreSpan: { value: SHORE_SPAN },
      },
    });
    this.mesh = new Mesh(polarGrid(lite), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  /** Seabed map from `shoreTexture`, covering [-half, half]. */
  setShore(tex: Texture, half: number): void {
    this.material.uniforms.uShore.value = tex;
    this.material.uniforms.uShoreHalf.value = half;
  }

  /** Centre the grid under a camera (snapped to avoid vertex swimming). */
  follow(camera: Camera): void {
    const s = 8;
    this.mesh.position.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
    this.mesh.updateMatrixWorld();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.uniforms.uShore.value?.dispose();
    this.material.dispose();
  }
}
