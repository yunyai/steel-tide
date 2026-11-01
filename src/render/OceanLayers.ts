// The ocean's fragment shader, built from one table of ripple layers so the GLSL and the
// texture-fetch budget of each tier come from the same place. Tier 0 is the lite sea (Ultra Low
// and Low), 1 Medium, 2 High.
//
// `antiTile: false` builds the shader as it was before the anti-tiling, for A/B comparison. With
// it on, every tier also gets, at no extra fetch: a domain warp from the wind samples (each ripple
// tile lands shifted from its neighbours, so the lattice never lines up), a kilometre-scale mask
// that swells and calms each layer and the swell normals in its own patches, a sun glint that
// tightens in calm water, and a foam threshold that wanders. Lite adds a 97.3 m layer (+1 fetch);
// Medium adds a 1.13 km warp sample (+1); High adds that warp sample, a two-phase flow on the
// 237 m layer (+1) whose samples also carry the foam ridge (−1), and a second set of short wind
// waves blended in by the mask.
//
// The vertex shader lives here too: both sum the swells of WAVES, the same the hulls ride.

import { WAVES } from '../world/Waves';

export type OceanTier = 0 | 1 | 2;

export interface OceanOptions {
  tier: OceanTier;
  antiTile: boolean;
}

export type Fade = 'fine' | 'mid' | 'broad';

export interface RippleLayer {
  /** Metres one tile of the detail texture spans. */
  scale: number;
  /** Rotation of the sampling frame (radians). */
  angle: number;
  /** Drift, in tiles per second. */
  drift: [number, number];
  weight: number;
  /** Which distance fade it follows. */
  fade: Fade;
  /** Tiers that draw it. */
  tiers: OceanTier[];
  /** Tiers that sample it twice in a two-phase flow, so it evolves rather than only sliding. */
  flow?: OceanTier[];
  /** The wind-patch mask that swells and calms it: a component of the shared patch waves (see pb). */
  mask?: 'x' | 'y' | 'z' | 'w';
}

/** A tiling sample of the detail texture, for the lining-up checks. */
export interface TileSample {
  kind: 'ripple' | 'ridge';
  scale: number;
  angle: number;
}

const BEFORE: RippleLayer[] = [
  { scale: 13.7, angle: 0.37, drift: [0.021, 0.013], weight: 0.07, fade: 'fine', tiers: [1, 2] },
  { scale: 61.0, angle: 1.93, drift: [-0.009, 0.014], weight: 0.08, fade: 'mid', tiers: [1, 2] },
  { scale: 237.0, angle: 2.71, drift: [0.003, -0.005], weight: 0.07, fade: 'broad', tiers: [0, 1, 2] },
];

const ANTI_TILE: RippleLayer[] = [
  { scale: 13.7, angle: 0.37, drift: [0.021, 0.013], weight: 0.07, fade: 'fine', tiers: [1, 2], mask: 'x' },
  // Turned and stretched off the old 61 m layer, which sat 0.01 rad from the 13.7 m one modulo a
  // quarter turn and 3% from a 4:1 ratio with the 237 m one.
  { scale: 66.0, angle: 1.54, drift: [-0.009, 0.014], weight: 0.08, fade: 'mid', tiers: [1, 2], mask: 'w' },
  { scale: 237.0, angle: 2.71, drift: [0.003, -0.005], weight: 0.07, fade: 'broad', tiers: [0, 1, 2], flow: [2], mask: 'z' },
  { scale: 97.3, angle: 1.67, drift: [-0.006, 0.008], weight: 0.06, fade: 'mid', tiers: [0], mask: 'y' },
];

/** The foam ridge sample (alpha channel). Anti-tiling moves it off a 4:3 ratio with the 97.3 m layer. */
const RIDGE = { angle: 2.2, before: 131.0, anti: 151.0 };

/** Metres of domain warp from the wind samples (every tier) and from the 1.13 km warp sample. */
const WARP_WIND = 180.0;
const WARP_NEAR = 28.0;

export function oceanLayers(o: OceanOptions): RippleLayer[] {
  return (o.antiTile ? ANTI_TILE : BEFORE).filter((l) => l.tiers.includes(o.tier));
}

/** A flowing layer's two samples carry the foam ridge too, in place of a ridge fetch of its own. */
const flowing = (o: OceanOptions) => oceanLayers(o).some((l) => l.flow?.includes(o.tier));

/** Every tiling sample a tier draws: its ripple layers and, unless a flowing layer carries it, the foam ridge. */
export function tierLayers(o: OceanOptions): TileSample[] {
  return [
    ...oceanLayers(o).map((l): TileSample => ({ kind: 'ripple', scale: l.scale, angle: l.angle })),
    ...(flowing(o) ? [] : [{ kind: 'ridge' as const, scale: o.antiTile ? RIDGE.anti : RIDGE.before, angle: RIDGE.angle }]),
  ];
}

const hasWarpSample = (o: OceanOptions) => o.antiTile && o.tier > 0;
const hasSmall2 = (o: OceanOptions) => o.antiTile && o.tier === 2;

/** Texture fetches per pixel: two wind samples, the ripples (a flowing one twice), the ridge, the warp sample and the sky cube twice. */
export function fetchCount(o: OceanOptions): number {
  const ripples = oceanLayers(o).reduce((n, l) => n + (l.flow?.includes(o.tier) ? 2 : 1), 0);
  return 2 + ripples + (flowing(o) ? 0 : 1) + (hasWarpSample(o) ? 1 : 0) + (o.tier > 0 ? 2 : 0);
}

/** A GLSL float literal. */
const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const v2 = ([x, y]: [number, number]) => `vec2(${f(x)}, ${f(y)})`;

function rippleLine(l: RippleLayer, o: OceanOptions): string {
  if (!o.antiTile) return `  slope += ripple(vWorld.xz, ${f(l.scale)}, ${f(l.angle)}, ${v2(l.drift)}) * ${f(l.weight)} * ${l.fade} * rough;`;
  const flow = l.flow?.includes(o.tier);
  const call = flow ? `rippleFlow(P, ${f(l.scale)}, ${f(l.angle)}, ${v2(l.drift)}, flow, flowRidge)` : `ripple(P, ${f(l.scale)}, ${f(l.angle)}, ${v2(l.drift)})`;
  const mask = l.mask ? ` * (1.0 + 0.3 * pb.${l.mask})` : '';
  return `  slope += ${call} * ${f(l.weight)}${mask} * ${l.fade} * rough;`;
}

/** Swells the shaders sum: every one of WAVES, so the hulls ride the sea that is drawn. */
const N = WAVES.length;

/**
 * Swells whose slope the fragment shader draws. WAVES runs longest first; the lite sea leaves out
 * the four shortest (its coarse grid flattens them past a hundred metres anyway) to save their cost.
 */
const swellNormals = (o: OceanOptions) => (o.tier === 0 ? 8 : N);

/** A short wind wave for the normals only: direction, wavelength (m) and slope. */
type ShortWave = [number, number, number, number];

/** The short wind waves the sea had before anti-tiling. */
const SMALL: ShortWave[] = [
  [0.955, 0.296, 14.0, 0.05],
  [-0.129, 0.992, 21.0, 0.045],
  [-0.857, 0.515, 33.0, 0.04],
  [-0.575, -0.818, 45.0, 0.035],
];

/**
 * With anti-tiling the swells cover everything from 24 m up, at many angles, so each set of short
 * waves keeps only what lies below them. The second set, turned off the first, takes over in its
 * own wind patches on high.
 */
const SMALL_ANTI: ShortWave[] = SMALL.slice(0, 2);
const SMALL2: ShortWave[] = [
  [0.643, 0.766, 17.3, 0.045],
  [-0.574, 0.819, 11.9, 0.04],
];

const shortWaves = (name: string, ws: ShortWave[]) =>
  `const vec4 ${name}[${ws.length}] = vec4[${ws.length}](\n${ws.map(([x, z, l, a]) => `  vec4(${f(x)}, ${f(z)}, ${f(l)}, ${a.toFixed(3)})`).join(',\n')}\n);`;

/** The ocean's vertex shader: Gerstner displacement by every swell, on the camera-centred grid. */
export function oceanVertex(): string {
  return /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[${N}];
uniform float uSteep[${N}];
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
  for (int i = 0; i < ${N}; i++) {
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
}

/** The ocean fragment shader for a tier. */
export function oceanFragment(o: OceanOptions): string {
  const anti = o.antiTile;
  const ripples = oceanLayers(o).map((l) => rippleLine(l, o)).join('\n');
  const flows = flowing(o);
  const wind = anti
    ? /* glsl */ `
  // Wind patches: two slow, rotated, kilometre-scale samples of the smooth noise channel, read a few
  // mips down so they stay smooth enough to warp with.
  vec4 wa = texture2D(uDetail, (rot(0.9) * vWorld.xz) / 7600.0 + uTime * vec2(0.00012, 0.00009), 3.0);
  vec4 wb = texture2D(uDetail, (rot(2.3) * vWorld.xz) / 12100.0 - uTime * vec2(0.00006, 0.00008), 3.0);
  float w1 = wa.b;
  float w2 = wb.b;
  vec2 wv = vec2(w1, w2);
  // Two smooth patch waves over the wind field. Their sines and cosines are four patch patterns a
  // quarter turn apart; each mask below takes one, so a mask costs a multiply rather than a sine.
  vec2 pa = 6.2831853 * vec2(dot(wv, vec2(1.7, 0.6)), dot(wv, vec2(0.5, 1.9)));
  vec4 pb = vec4(sin(pa), cos(pa));`
    : /* glsl */ `
  // Wind patches: two slow, rotated, kilometre-scale samples of the smooth noise channel.
  float w1 = texture2D(uDetail, (rot(0.9) * vWorld.xz) / 7600.0 + uTime * vec2(0.00012, 0.00009)).b;
  float w2 = texture2D(uDetail, (rot(2.3) * vWorld.xz) / 12100.0 - uTime * vec2(0.00006, 0.00008)).b;`;
  const warp = anti
    ? /* glsl */ `
  // Domain warp: the wind samples shift each ripple tile a different way from its neighbours, so
  // the lattice never lines up${hasWarpSample(o) ? '; the 1.13 km warp sample adds a closer wobble' : ''}.
  vec2 warp = (wv - 0.5) * ${f(WARP_WIND)};${
    hasWarpSample(o)
      ? `
  vec4 wq = texture2D(uDetail, (rot(1.27) * vWorld.xz) / 1130.0 + uTime * vec2(-0.00011, 0.00007), 1.0);
  warp += (vec2(wq.b, wq.a) - 0.5) * ${f(WARP_NEAR)};`
      : ''
  }
  vec2 P = vWorld.xz + warp;${flows ? '\n  vec2 flow = clamp((wa.rg - 0.5) * 6.0, -1.0, 1.0);\n  float flowRidge;' : ''}`
    : '';
  // Each swell takes a component of the patch waves (a quarter turn apart), at no dot product; the
  // next four take the same components turned over, so neighbouring swells trade weight.
  const swell = anti ? ' * (1.0 + 0.2 * pb[i % 4] * (((i / 4) % 2 == 0) ? 1.0 : -1.0))' : '';
  // The short wind waves only shade the surface, so with anti-tiling they take the warp too: their
  // wavefronts curve and their lattice never settles.
  const small = anti ? SMALL_ANTI : SMALL;
  const shortGlsl =
    o.tier === 0
      ? ''
      : hasSmall2(o)
        ? /* glsl */ `
  // Two sets of short wind waves, traded patch by patch. The patches are kilometres wide, so whole
  // stretches of screen skip the set that has no weight there. Both bend through the warp: they only
  // light the surface, so their wavefronts can curve where the swells the hulls ride cannot.
  float sb = smoothstep(0.4, 0.6, 0.5 + 0.5 * pb.y);
  if (sb < 1.0) {
    for (int i = 0; i < ${small.length}; i++) {
      vec2 d = SMALL[i].xy;
      float k = 6.2831853 / SMALL[i].z;
      float ph = k * (dot(d, P) - sqrt(9.81 / k) * uTime);
      float aa = 1.0 - smoothstep(0.15, 0.5, foot / SMALL[i].z);
      slope += d * (SMALL[i].w * cos(ph)) * fine * rough * aa * (1.0 - sb);
    }
  }
  if (sb > 0.0) {
    for (int i = 0; i < ${SMALL2.length}; i++) {
      vec2 d = SMALL2[i].xy;
      float k = 6.2831853 / SMALL2[i].z;
      float ph = k * (dot(d, P) - sqrt(9.81 / k) * uTime);
      float aa = 1.0 - smoothstep(0.15, 0.5, foot / SMALL2[i].z);
      slope += d * (SMALL2[i].w * cos(ph)) * fine * rough * aa * sb;
    }
  }`
        : /* glsl */ `
  for (int i = 0; i < ${small.length}; i++) {
    vec2 d = SMALL[i].xy;
    float k = 6.2831853 / SMALL[i].z;
    float ph = k * (dot(d, ${anti ? 'P' : 'vWorld.xz'}) - sqrt(9.81 / k) * uTime);
    float aa = 1.0 - smoothstep(0.15, 0.5, foot / SMALL[i].z);
    slope += d * (SMALL[i].w * cos(ph)) * fine * rough * aa;
  }`;
  const ridgeAt = anti ? 'P' : 'vWorld.xz';
  const ridgeScale = f(anti ? RIDGE.anti : RIDGE.before);
  const ridge = flows
    ? '  float ridge = flowRidge;'
    : `  float ridge = texture2D(uDetail, (rot(${f(RIDGE.angle)}) * ${ridgeAt}) / ${ridgeScale} + uTime * vec2(0.003, -0.002)).a;`;
  const jitter = anti ? '\n  float fj = (w2 - 0.5) * 0.5;' : '';
  const foamLo = anti ? '1.5 + fj' : '1.5';
  const foamHi = anti ? '2.2 + fj' : '2.2';
  const glint = anti ? 'mix(1400.0, 600.0, wind)' : '900.0';
  return /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[${N}];
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
${
  flows
    ? `
// Two-phase flow: two samples slide along the wind and cross-fade, so the layer evolves instead of
// only drifting (one extra fetch). Their ridge channel, cross-faded the same way, is the foam ridge,
// which saves that fetch back.
vec2 rippleFlow(vec2 p, float scale, float ang, vec2 drift, vec2 flow, out float ridge) {
  mat2 r = rot(ang);
  vec2 uv = (r * p) / scale + drift * uTime;
  float a = fract(uTime / 9.0);
  float b = fract(uTime / 9.0 + 0.5);
  vec4 s0 = texture2D(uDetail, uv + flow * (a - 0.5) * 0.3);
  vec4 s1 = texture2D(uDetail, uv + flow * (b - 0.5) * 0.3 + vec2(0.37, 0.61));
  float k = abs(2.0 * a - 1.0);
  // Cross-fading two unrelated samples flattens them half-way; this keeps their contrast.
  float n = inversesqrt(k * k + (1.0 - k) * (1.0 - k));
  ridge = clamp(0.5 + (mix(s0.a, s1.a, k) - 0.5) * n, 0.0, 1.0);
  return ((mix(s0.rg, s1.rg, k) * 2.0 - 1.0) * n) * r;
}
`
    : ''
}
// Short wind waves for the normals only (the hulls float on the swells).
${shortWaves('SMALL', small)}${
  hasSmall2(o)
    ? `
// A second set, turned off the first, for the patches where it takes over.
${shortWaves('SMALL2', SMALL2)}`
    : ''
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float atten = 1.0 - smoothstep(2500.0, 7000.0, dist);
  float fine = 1.0 - smoothstep(120.0, 2400.0, dist);
  float mid = 1.0 - smoothstep(300.0, 4000.0, dist);
  float broad = 1.0 - smoothstep(500.0, 6000.0, dist);
${wind}
  float wind = smoothstep(0.3, 0.7, w1 * 0.6 + w2 * 0.4);
  float rough = mix(0.55, 1.3, wind);
${warp}

  // Analytic slope of the swell, the short wind waves and the baked ripples. Analytic waves have
  // no mipmaps: each fades out once a pixel spans a good part of its wavelength, or it would
  // shimmer into a moiré lattice toward the horizon.
  float foot = max(length(fwidth(vWorld.xz)), 1e-3);
  vec2 slope = vec2(0.0);
  for (int i = 0; i < ${swellNormals(o)}; i++) {
    vec2 d = uWaves[i].xy;
    float k = uWaves[i].z;
    float amp = uWaves[i].w * (1.0 - smoothstep(0.15, 0.5, foot * k / 6.2831853));
    float c = sqrt(9.81 / k);
    float ph = k * (dot(d, vWorld.xz) - c * uTime);
    slope += d * (amp * k * cos(ph)) * mix(0.35, 1.0, atten)${swell};
  }${shortGlsl}
${ripples}
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  // The baked sky, clouds and all; blurrier where the ripples are too fine to resolve.
  if (uHasCube > 0.5) sky = min(textureLod(uSkyCube, R, 1.0 + 3.0 * (1.0 - fine)).rgb, vec3(4.0));
  float sunAmt = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunColor * (pow(sunAmt, ${glint}) * 6.0 + pow(sunAmt, 60.0) * 0.18 * (1.0 - smoothstep(0.0, 0.25, uSunDir.y) * 0.5));

  float crest = clamp(vHeight * 0.35 + 0.2, 0.0, 1.0);
  float diffuse = max(dot(N, uSunDir), 0.0) * 0.35 + 0.65;
  vec3 body = mix(uDeep, uScatter, crest * (0.35 + 0.65 * pow(1.0 - V.y, 2.0))) * diffuse;
  // Rough water scatters a little more light; calm patches stay dark and glassy.
  body *= mix(0.9, 1.1, wind);

  // Whitecaps on the highest crests, broken up by the ripple ridges, thicker in the wind.
${ridge}${jitter}
  float foam = smoothstep(${foamLo}, ${foamHi}, vHeight + ridge * 0.6) * smoothstep(0.5, 0.9, ridge) * atten * 0.45 * mix(0.4, 1.5, wind);

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
}
