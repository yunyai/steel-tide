import { Color, DataTexture, Vector3, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RGBAFormat, RepeatWrapping, UnsignedByteType, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SIGNATURE, TUNGSTEN_MODES } from '../skills/misc/TungstenModes';
import type { Cube } from '../skills/misc/TungstenRuntime';

/** Mode colours as three.js colours, in mode order. */
export const MODE_COLORS: readonly Color[] = TUNGSTEN_MODES.map((m) => new Color(m.color));
export const modeColor = (mode: number): Color => MODE_COLORS[((mode % 6) + 6) % 6];

const SIZE = 512;
let etch: DataTexture | null = null;
let cube: BufferGeometry | null = null;

/** Unit cube with softened edges; meshes scale it to the cube's edge. */
export function cubeGeometry(): BufferGeometry {
  return (cube ??= new RoundedBoxGeometry(1, 1, 1, 2, 0.035));
}

/**
 * The neon etching, drawn once into bytes so it is identical in every browser and in tests.
 * R: trace coverage. G: flow coordinate, 0 at the centre to 1 at the rim, which the pulse travels along.
 * B: nodes and the Lodestone sigil, which burn brighter.
 */
export function etchTexture(): DataTexture {
  if (etch) return etch;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const put = (x: number, y: number, cover: number, flow: number, node: number) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || cover <= 0) return;
    const i = (y * SIZE + x) * 4;
    const c = Math.round(Math.min(1, cover) * 255);
    if (c >= data[i]) data[i + 1] = Math.round(Math.min(1, Math.max(0, flow)) * 255);
    data[i] = Math.max(data[i], c);
    data[i + 2] = Math.max(data[i + 2], Math.round(Math.min(1, node * cover) * 255));
    data[i + 3] = 255;
  };
  // Anti-aliased capsule from (ax, ay) to (bx, by) in texels; flow runs from f0 to f1 along it.
  const line = (ax: number, ay: number, bx: number, by: number, w: number, f0: number, f1: number, node = 0) => {
    const dx = bx - ax,
      dy = by - ay,
      len2 = dx * dx + dy * dy || 1;
    const r = w / 2 + 1;
    for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++)
      for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        put(x, y, w / 2 + 0.75 - d, f0 + (f1 - f0) * t, node);
      }
  };
  const dot = (cx: number, cy: number, rad: number, flow: number, ring = false) => {
    for (let y = Math.floor(cy - rad - 2); y <= Math.ceil(cy + rad + 2); y++)
      for (let x = Math.floor(cx - rad - 2); x <= Math.ceil(cx + rad + 2); x++) {
        const d = Math.hypot(x - cx, y - cy);
        put(x, y, ring ? 1.6 - Math.abs(d - rad) : rad + 0.75 - d, flow, 1);
      }
  };
  const P = (u: number) => u * SIZE;
  const C = SIZE / 2;
  // Rotate a quarter's design about the centre four times for a machined, symmetric face.
  const quarter = (fn: (rot: (u: number, v: number) => [number, number]) => void) => {
    for (let k = 0; k < 4; k++) {
      const c = Math.cos((k * Math.PI) / 2),
        s = Math.sin((k * Math.PI) / 2);
      fn((u, v) => {
        const x = P(u) - C,
          y = P(v) - C;
        return [Math.round(C + x * c - y * s), Math.round(C + x * s + y * c)];
      });
    }
  };
  quarter((R) => {
    // The rim frame, broken at the middle of each side for a field gate.
    let [a, b] = R(0.06, 0.06);
    let [c, d] = R(0.4, 0.06);
    line(a, b, c, d, 4, 1, 0.92);
    [a, b] = R(0.06, 0.06);
    [c, d] = R(0.06, 0.4);
    line(a, b, c, d, 4, 1, 0.92);
    // Heavy corner brackets.
    [a, b] = R(0.1, 0.1);
    [c, d] = R(0.22, 0.1);
    line(a, b, c, d, 7, 0.95, 0.9, 0.4);
    [c, d] = R(0.1, 0.22);
    line(a, b, c, d, 7, 0.95, 0.9, 0.4);
    // Nested squares, each opened at a different place.
    for (const [h, gap, w] of [
      [0.34, 0.12, 3],
      [0.24, 0.05, 3],
      [0.15, 0.09, 2.5],
    ] as const) {
      const lo = 0.5 - h,
        flow = h / 0.44;
      [a, b] = R(lo, lo);
      [c, d] = R(0.5 - gap, lo);
      line(a, b, c, d, w, flow, flow);
      [c, d] = R(lo, 0.5 + gap * 0.6);
      line(a, b, c, d, w, flow, flow);
    }
    // Circuit traces from the inner square out through the field gates, with 45-degree doglegs and end nodes.
    const traces: [number, number, number, number, number, number][] = [
      [0.36, 0.26, 0.36, 0.19, 0.29, 0.12],
      [0.42, 0.26, 0.42, 0.16, 0.42, 0.06],
      [0.3, 0.35, 0.22, 0.35, 0.15, 0.28],
      [0.47, 0.35, 0.47, 0.22, 0.47, 0.16],
      [0.26, 0.42, 0.18, 0.42, 0.12, 0.36],
    ];
    for (const [x0, y0, x1, y1, x2, y2] of traces) {
      [a, b] = R(x0, y0);
      [c, d] = R(x1, y1);
      const [e, f] = R(x2, y2);
      const f0 = Math.max(Math.abs(x0 - 0.5), Math.abs(y0 - 0.5)) / 0.44;
      line(a, b, c, d, 2.5, f0, (f0 + 1) / 2);
      line(c, d, e, f, 2.5, (f0 + 1) / 2, 0.95);
      dot(e, f, 5, 0.97, true);
      dot(e, f, 2, 0.97);
    }
    [a, b] = R(0.3, 0.3);
    dot(a, b, 4, 0.45);
  });
  // The Lodestone sigil: a horseshoe magnet, open end down, in the centre.
  const r = P(0.06);
  for (let i = 0; i <= 24; i++) {
    const t0 = (i / 24) * Math.PI,
      t1 = ((i + 1) / 24) * Math.PI;
    if (i < 24) line(C + Math.cos(t0) * r, C + 6 + Math.sin(t0) * r, C + Math.cos(t1) * r, C + 6 + Math.sin(t1) * r, 7, 0.05, 0.05, 1);
  }
  for (const s of [-1, 1]) {
    line(C + s * r, C + 6, C + s * r, C - P(0.05), 7, 0.05, 0.08, 1);
    line(C + s * (r - 5), C - P(0.05) - 6, C + s * (r + 5), C - P(0.05) - 6, 5, 0.1, 0.1, 1);
  }
  etch = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  etch.wrapS = etch.wrapT = RepeatWrapping;
  etch.magFilter = LinearFilter;
  etch.minFilter = LinearMipmapLinearFilter;
  etch.generateMipmaps = true;
  etch.anisotropy = 4;
  etch.needsUpdate = true;
  return etch;
}

export interface CubeSkinUniforms {
  uGlow: { value: Color };
  uPrev: { value: Color };
  /** Mode-change wipe, 0 to 1 bottom to top; 1 when settled. */
  uSweep: { value: number };
  uTime: { value: number };
  /** Overall etching brightness. */
  uPower: { value: number };
  /** Meteor entry heat on the lower faces. */
  uHeat: { value: number };
  /** The Shield store's heat, 0..1: the etching runs from the mode colour toward white-hot (see storeLook). */
  uStore: { value: number };
  /** Solid fraction while re-forming or dissolving (1 is whole). */
  uAssemble: { value: number };
  /** Shattering cube: the etching stutters. */
  uFlicker: { value: number };
  /** A rolling Loaded Die: 1 lights each face in its own mode's colour (`uFaces`, laid out as `dieFaceNormal`). */
  uDie: { value: number };
  uFaces: { value: readonly Color[] };
}

/**
 * How a cube shows its Shield store, by fill (store / cap, 0..1): the etching's heat toward white, how many arcs
 * crackle over its faces and how far they reach (in half-edges), and whether arcs strike the sea (90% and up).
 */
export function storeLook(fill: number): { heat: number; arcs: number; reach: number; strike: boolean } {
  const f = Math.max(0, Math.min(1, fill));
  if (f <= 0) return { heat: 0, arcs: 0, reach: 0, strike: false };
  return { heat: f, arcs: 1 + Math.round(f * 7), reach: 0.35 + f * 1.1, strike: f >= 0.9 };
}

/** Where each die face points in the cube's own frame: face i is mode i, and opposite faces sum to five, as a die's to seven. */
const DIE_FACES = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [-1, 0, 0],
  [0, -1, 0],
] as const;
export function dieFaceNormal(face: number, out = new Vector3()): Vector3 {
  const n = DIE_FACES[face];
  return out.set(n[0], n[1], n[2]);
}

/** Dark tungsten with the neon etching; each cube gets its own so its colour and state are its own. */
export function cubeSkin(): { material: MeshStandardMaterial; u: CubeSkinUniforms } {
  const u: CubeSkinUniforms = {
    uGlow: { value: MODE_COLORS[0].clone() },
    uPrev: { value: MODE_COLORS[0].clone() },
    uSweep: { value: 1 },
    uTime: { value: 0 },
    uPower: { value: 1 },
    uHeat: { value: 0 },
    uStore: { value: 0 },
    uAssemble: { value: 1 },
    uFlicker: { value: 0 },
    uDie: { value: 0 },
    uFaces: { value: MODE_COLORS },
  };
  const material = new MeshStandardMaterial({ color: 0x40454d, metalness: 0.92, roughness: 0.36 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uEtch: { value: etchTexture() } });
    shader.vertexShader =
      'varying vec3 vCubeObj;\nvarying vec2 vEtchUv;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCubeObj = position;\nvEtchUv = uv;');
    shader.fragmentShader =
      `uniform sampler2D uEtch;
uniform vec3 uGlow, uPrev;
uniform vec3 uFaces[6];
uniform float uSweep, uTime, uPower, uHeat, uStore, uAssemble, uFlicker, uDie;
varying vec3 vCubeObj;
varying vec2 vEtchUv;
float cubeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
` +
      shader.fragmentShader
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
  // Re-forming and dissolving: the cube assembles cell by cell, its seams burning.
  float cell = cubeHash(floor((vCubeObj + 0.5) * 9.0));
  if (cell > uAssemble) discard;
  float seam = uAssemble < 0.999 ? smoothstep(uAssemble - 0.12, uAssemble, cell) : 0.0;
  vec4 etch = texture2D(uEtch, vEtchUv);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  // The traces are polished inlays in a bead-blasted face.
  roughnessFactor = mix(roughnessFactor, 0.14, etch.r);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  {
    float wipe = vCubeObj.y + 0.5;
    float front = uSweep * 1.2 - 0.1;
    vec3 glow = mix(uPrev, uGlow, step(wipe, front));
    float band = uSweep < 0.999 ? exp(-pow((wipe - front) * 16.0, 2.0)) : 0.0;
    // A rolling die: every face in its own mode's colour, laid out as dieFaceNormal.
    if (uDie > 0.0) {
      vec3 a = abs(vCubeObj);
      vec3 face = a.y >= a.x && a.y >= a.z ? (vCubeObj.y > 0.0 ? uFaces[0] : uFaces[5])
        : a.x >= a.z ? (vCubeObj.x > 0.0 ? uFaces[1] : uFaces[4])
        : (vCubeObj.z > 0.0 ? uFaces[2] : uFaces[3]);
      glow = mix(glow, face, uDie);
    }
    // A full Shield store runs the etching white-hot, and brighter.
    glow = mix(glow, vec3(1.0, 0.94, 0.84), uStore * 0.7);
    // Pulses run outward from the sigil to the rim.
    float pulse = pow(0.5 + 0.5 * sin((etch.g * 3.0 - uTime * 0.9) * 6.2831), 8.0);
    // Far away the fine traces mip away; a floor keeps a distant cube reading in its colour.
    float far = smoothstep(900.0, 4500.0, length(vViewPosition));
    float mask = max(etch.r, far * 0.3);
    float stutter = uFlicker > 0.0 ? mix(1.0, step(0.45, fract(sin(floor(uTime * 22.0) * 91.7) * 47.3)), uFlicker) : 1.0;
    float lum = uPower * stutter * (mask * (0.55 + 1.6 * pulse) + etch.b * 0.9) * (1.0 + uStore * 0.5);
    totalEmissiveRadiance = glow * lum + glow * band * 3.0 + uGlow * seam * 4.0;
    // A rim in the mode colour keeps the silhouette against dark water.
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
    totalEmissiveRadiance += glow * rim * 0.22 * uPower;
    // Entry heat: the leading (lower) faces glow white-orange.
    float h = uHeat * smoothstep(0.15, -0.5, vCubeObj.y);
    totalEmissiveRadiance += mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.86, 0.62), h) * h * 5.0;
  }`,
        );
  };
  material.customProgramCacheKey = () => 'tungsten-cube-skin';
  return { material, u };
}

const sweepFrom = new Color();
/** Tracks a cube's mode for the colour wipe; one per drawn cube. */
export class ModeSweep {
  private mode = -1;
  private since = -1e9;
  private prev = MODE_COLORS[0];
  /** Seconds the wipe takes. */
  static readonly TIME = 0.3;
  apply(u: CubeSkinUniforms, mode: number, time: number, reduce: boolean): void {
    if (this.mode === -1) this.mode = mode;
    if (mode !== this.mode) {
      this.prev = modeColor(this.mode);
      this.mode = mode;
      this.since = time;
    }
    const k = reduce ? 1 : Math.max(0, Math.min(1, (time - this.since) / ModeSweep.TIME));
    u.uGlow.value.copy(modeColor(mode));
    u.uPrev.value.copy(k < 1 ? this.prev : modeColor(mode));
    u.uSweep.value = k;
  }
  /** The blended colour for lights that cannot wipe. */
  color(time: number, out: Color): Color {
    const k = Math.max(0, Math.min(1, (time - this.since) / ModeSweep.TIME));
    return out.copy(sweepFrom.copy(this.prev).lerp(modeColor(Math.max(0, this.mode)), k));
  }
}

/** Presentation-only hops for a rolling Loaded Die, dying away as it nears the reticle. */
export function dieHop(c: Cube): number {
  const p = c.path;
  if (c.state !== 'flying' || p?.kind !== 'die') return 0;
  const left = Math.hypot(p.tx - c.x, p.tz - c.z);
  const k = c.flown / Math.max(1, c.flown + left);
  return 80 * (1 - k) * Math.abs(Math.sin((Math.PI * c.flown) / 520));
}

/** Presentation-only arc for a Pile Driver's leap: the sim flies it straight; it is drawn rising and crashing down. */
export function pileLift(c: Cube): number {
  const p = c.path;
  if (c.state !== 'flying' || p?.kind !== 'pile' || p.bounces <= 0) return 0;
  const left = Math.hypot(p.tx - c.x, p.tz - c.z);
  const k = c.flown / Math.max(1, c.flown + left);
  return SIGNATURE.pile.height * 4 * k * (1 - k);
}
