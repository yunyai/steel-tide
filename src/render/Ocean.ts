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
import { oceanFragment, type OceanTier } from './OceanLayers';

// Gerstner-swell ocean on a camera-following polar grid. Vertex displacement
// uses the same WAVES as the CPU buoyancy (Waves.ts); per-pixel normals add
// short shader-only waves and baked ripples (see OceanLayers: each ripple layer is
// rotated and scaled off the others, domain-warped and masked by a kilometre-scale
// wind field, so no tile repeat reads). It reflects the baked sky,
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

  /**
   * `tier` 0 is the lite sea: coarse grid, fewer ripple layers and no sky reflection (Ultra Low and
   * Low). `antiTile` false draws the sea as it was before the anti-tiling, for comparison.
   */
  constructor(look: OceanLook, sunDir: Vector3, skyCube: CubeTexture | null = null, tier: OceanTier = 2, antiTile = true) {
    detail ??= detailTexture();
    const lite = tier === 0;
    if (lite) skyCube = null;
    const waves = WAVES.map((w) => new Vector4(Math.cos(w.dir), Math.sin(w.dir), (2 * Math.PI) / w.length, w.amp));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader: oceanFragment({ tier, antiTile }),
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
