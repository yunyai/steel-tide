import { ELEMENTS } from '../skills/misc/ArchitectElements';
import { addFleetDetails, FLEET_DETAILS } from './FleetDetails';
import { ArchitectModel, architectTurretGeometry, elementalTurretGeometry, architectGlowMaterial } from './ArchitectModel';
import { StepperModel } from './StepperModel';
import { TungstenModel } from './TungstenModel';
import { stepperHullGeometry, stepperTurretGeometry } from './StepperGeometry';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  Vector4,
  type Material,
  type Object3D,
  type Side,
} from 'three';
import { DEG, clamp, wrapAngle } from '../core/math';
import { DASH_TIME } from '../skills/misc/ArchitectRuntime';
import type { PlaneLook, ShipSpec, SkillSpec } from '../core/types';
import { deckHeight, hullHalfWidth } from '../ships/HullShape';
import type { Ship } from '../ships/Ship';
import { waveHeight } from '../world/Waves';
import { type ColorFn, Parts, loft } from './Geometry';

// Procedural ship meshes built from the same ShipSpec the simulation uses.
// Local space: +X bow, +Y up, +Z starboard (matches Ship.localToWorld).

// The colour multiplier tones the palettes down so hulls read as painted steel, not plaster, under the bright sky light.
export const shipMaterial = new MeshStandardMaterial({ vertexColors: true, color: 0xb4b4b4, roughness: 0.7, metalness: 0.3, envMapIntensity: 0.8 });
/** Hulls take this share of the haze the sea and islands get, so a ship at gun range still reads. */
const SHIP_FOG = 0.5;
/** A destroyed platform falls at this acceleration (m/s²) and is gone this long after it reaches the water. */
const PLATFORM_FALL = 150, PLATFORM_SINK = 3;
/** Seconds after death before a platform's sinking hull can be dropped from the scene. */
export function platformSunkAfter(ship: { renderPos: { y: number } }): number {
  return PLATFORM_SINK + Math.sqrt(Math.max(0, ship.renderPos.y) / PLATFORM_FALL);
}
const FOG_FRAGMENT = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * ${SHIP_FOG.toFixed(2)} );
#endif`;
shipMaterial.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FOG_FRAGMENT);
};
shipMaterial.customProgramCacheKey = () => 'ship-fog';

/** Shell holes remembered per hull (oldest are painted over first). */
const MAX_SCARS = 12;
/** Seconds a fresh hole glows. */
const SCAR_HEAT = 3;

/** Per-ship battle damage, read by that ship's hull material. */
export interface DamageUniforms {
  /** 0..1: how much of the hull is scorched. */
  uSoot: { value: number };
  /** Hole centres in hull space (xyz) and radius (w). */
  uScars: { value: Vector4[] };
  /** Glow of each hole, 1 when fresh. */
  uHeat: { value: number[] };
  /** World to hull space, so turret and superstructure meshes share the hull's frame. */
  uBodyInv: { value: Matrix4 };
}

function damageUniforms(): DamageUniforms {
  return {
    uSoot: { value: 0 },
    uScars: { value: Array.from({ length: MAX_SCARS }, () => new Vector4(0, 0, 0, 0)) },
    uHeat: { value: new Array<number>(MAX_SCARS).fill(0) },
    uBodyInv: { value: new Matrix4() },
  };
}

/**
 * The battle hull material: the shared ship look plus soot that spreads as the ship loses
 * hit points and charred, briefly glowing holes where shells and torpedoes struck.
 */
function hullMaterial(u: DamageUniforms): MeshStandardMaterial {
  const m = shipMaterial.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = `uniform mat4 uBodyInv;\nvarying vec3 vBody;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  vBody = (uBodyInv * modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = `uniform float uSoot;
uniform vec4 uScars[${MAX_SCARS}];
uniform float uHeat[${MAX_SCARS}];
varying vec3 vBody;
float dmgHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dmgNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dmgHash(i), dmgHash(i + vec3(1, 0, 0)), f.x), mix(dmgHash(i + vec3(0, 1, 0)), dmgHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dmgHash(i + vec3(0, 0, 1)), dmgHash(i + vec3(1, 0, 1)), f.x), mix(dmgHash(i + vec3(0, 1, 1)), dmgHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
${shader.fragmentShader}`
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float dmgN = dmgNoise(vBody * 0.09) * 0.65 + dmgNoise(vBody * 0.37) * 0.35;
  float dmgChar = smoothstep(1.0 - uSoot, 1.15 - uSoot, dmgN) * min(1.0, uSoot * 3.0);
  float dmgRag = (dmgNoise(vBody * 0.9) - 0.5) * 0.6;
  float dmgGlow = 0.0;
  for (int i = 0; i < ${MAX_SCARS}; i++) {
    vec4 sc = uScars[i];
    float d = distance(vBody, sc.xyz) / max(sc.w, 0.001) + dmgRag;
    dmgChar = max(dmgChar, 1.0 - smoothstep(0.45, 1.0, d));
    dmgGlow += uHeat[i] * (exp(-pow((d - 0.7) * 5.0, 2.0)) + (1.0 - smoothstep(0.0, 0.5, d)) * 0.5);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), dmgChar * 0.88);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(1.0, 0.36, 0.07) * dmgGlow * 2.5;`,
      )
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  };
  m.customProgramCacheKey = () => 'ship-damage';
  return m;
}

/** Cached bow and stern halves of a hull, cut a little raggedly across midships. */
const halves = new WeakMap<BufferGeometry, [BufferGeometry, BufferGeometry]>();

function splitHull(g: BufferGeometry, cut: number): [BufferGeometry, BufferGeometry] {
  const hit = halves.get(g);
  if (hit) return hit;
  const pos = g.attributes.position;
  const idx = g.index;
  const tris = idx ? idx.count / 3 : pos.count / 3;
  const bow: number[] = [];
  const stern: number[] = [];
  for (let t = 0; t < tris; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    // A torn line, not a saw cut.
    const tear = Math.sin(cy * 0.9 + cz * 0.7) * 2.5 + Math.sin(cz * 2.3 - cy * 1.7) * 1.5;
    (cx > cut + tear ? bow : stern).push(a, b, c);
  }
  const make = (list: number[]): BufferGeometry => {
    const h = new BufferGeometry();
    for (const k of Object.keys(g.attributes)) h.setAttribute(k, g.attributes[k]);
    h.setIndex(list);
    h.computeBoundingSphere();
    return h;
  };
  const pair: [BufferGeometry, BufferGeometry] = [make(bow), make(stern)];
  halves.set(g, pair);
  return pair;
}

const ghostMaterials = {
  ally: new MeshBasicMaterial({ color: 0x5fe3c0, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false }),
  enemy: new MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false }),
  nearbySub: new MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false }),
};
/** Cloaked (untargetable) hulls: still in plain sight, but a shimmering violet glass. */
const cloakMaterial = new MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending });

const STRIPE = 0x1b1c1e;

// Masthead pennants in the HUD's ally and enemy colours, chosen per viewport.
const pennantMaterials = {
  ally: new MeshBasicMaterial({ color: 0x63cfc0, side: DoubleSide }),
  enemy: new MeshBasicMaterial({ color: 0xe2553f, side: DoubleSide }),
};
const PENNANT_SEG = 8;

let radarGeo: BufferGeometry | null = null;

/** A bedspring air-search antenna on a short pedestal, turning about its base. */
function radarGeometry(): BufferGeometry {
  const p = new Parts();
  p.cyl(0.25, 0.3, 0.6, 0, 0, 0, 0x3a3d40, { seg: 6 });
  p.box(0.3, 1.5, 4, 0, 0.6, 0, 0x2c2e31);
  return p.merge();
}

/** The tallest mast that rises clear of the superstructure, if any. */
function mastTop(spec: ShipSpec): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  for (const mt of spec.model.masts) {
    const top = spec.freeboard + mt.h;
    if (top <= spec.freeboard + blockTopAt(spec, mt.x) + 0.8) continue;
    if (!best || top > best.y) best = { x: mt.x, y: top };
  }
  return best;
}

// Fresnel glow for ability auras: bright at grazing angles, faint face-on. `uGrid` adds the
// latitude and longitude lines of the flak dome.
const AURA_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}`;
const AURA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uBase;
uniform float uGrid;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  float grid = uGrid * max(step(0.99, fract(vUv.x * 36.0)), step(0.975, fract(vUv.y * 6.0)));
  float a = (uBase + f + grid * 0.6) * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

function auraMaterial(hex: number, base: number, grid: number, side: Side): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: AURA_VERT,
    fragmentShader: AURA_FRAG,
    uniforms: { uColor: { value: new Color(hex) }, uAlpha: { value: 0 }, uBase: { value: base }, uGrid: { value: grid } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side,
  });
}

let domeGeo: SphereGeometry | null = null;

function col(hex: number): Color {
  return new Color(hex);
}

/** Camouflage paint as a function of local position. */
export function camoFn(spec: ShipSpec, base: number): ColorFn {
  const m = spec.model;
  const pal = m.palette;
  const c = new Color();
  const L2 = spec.length / 2;
  switch (m.camo) {
    case 'measure22':
      // Navy blue up to the lowest deck line, haze grey above.
      return (_x, y) => c.setHex(y < spec.freeboard * 0.92 ? pal.hull : pal.upper);
    case 'baltic':
      // Bismarck, May 1941: black and white bands fore and aft, false bow wave.
      return (x, y) => {
        const u = Math.abs(x) / L2;
        if (u > 0.5 && u < 0.86 && y > 0.6) return c.setHex(Math.floor((x + 400) / 8.5) % 2 ? 0x24262a : 0xd9dbdc);
        return c.setHex(base);
      };
    case 'dazzle': {
      const tones = [0x2c3a46, 0x6f8592, 0xb9c5cc, 0x8fa1ab];
      return (x, y, z) => {
        const side = z >= 0 ? 1 : -1;
        const a = Math.sin(x * 0.06 + y * 0.22 * side) + 0.7 * Math.sin(x * 0.021 - y * 0.09 + side);
        const i = a > 0.9 ? 0 : a > 0.1 ? 1 : a > -0.6 ? 2 : 3;
        return c.setHex(tones[i]);
      };
    }
    default:
      return () => c.setHex(base);
  }
}

// ------------------------------------------------------------------ hull

function hullGeometry(spec: ShipSpec): BufferGeometry[] {
  const L = spec.length;
  const d = spec.draft;
  const fb = spec.freeboard;
  const pal = spec.model.palette;
  const boot = col(pal.boot ?? 0x2b2b2b);
  const stripe = col(STRIPE);
  const deckCol = col(pal.deck);
  const paint = camoFn(spec, pal.hull);
  const n = Math.round(clamp(L / 3, 40, 110));
  const rakeFrac = spec.model.hullStyle === 'block' ? 0 : spec.model.bow === 'straight' ? 0.015 : 0.045;

  if (spec.sub) {
    const rings: Vector3[][] = [];
    const colors: Color[][] = [];
    const hb = spec.beam / 2;
    const yc = (fb - d) / 2;
    const ryMax = (fb + d) / 2;
    const SEG = 18;
    for (let i = 0; i <= n; i++) {
      const x = -L / 2 + (L * i) / n;
      const hw = hullHalfWidth(spec, x);
      const k = hw / hb;
      const ring: Vector3[] = [];
      const cr: Color[] = [];
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI * 2;
        const y = yc + ryMax * Math.pow(k, 0.8) * Math.sin(th);
        ring.push(new Vector3(x, y, hw * Math.cos(th)));
        cr.push(y > -0.4 ? col(pal.hull) : boot);
      }
      rings.push(ring);
      colors.push(cr);
    }
    return [loft(rings, colors, false)];
  }

  // Profile: [half-width factor, height] from deck edge down to the keel. A tumblehome hull leans
  // its sides in above the waterline, the widest point at the water.
  const tumble = spec.model.hullStyle === 'tumblehome';
  const prof = (deck: number): [number, number][] => tumble ? [
    [0.7, deck],
    [0.85, deck * 0.5 + 0.6],
    [0.97, 1.3],
    [1.0, 0.9],
    [0.99, -0.25],
    [0.93, -d * 0.45],
    [0.8, -d * 0.82],
    [0.42, -d * 0.99],
    [0, -d],
  ] : [
    [1.0, deck],
    [1.0, deck * 0.55 + 0.6],
    [0.99, 1.3],
    [0.985, 0.9],
    [0.97, -0.25],
    [0.93, -d * 0.45],
    [0.8, -d * 0.82],
    [0.42, -d * 0.99],
    [0, -d],
  ];
  const sideRings: Vector3[][] = [];
  const sideCols: Color[][] = [];
  const deckRings: Vector3[][] = [];
  const deckCols: Color[][] = [];
  const camber = spec.beam * 0.012;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = -L / 2 + L * u;
    const hw = hullHalfWidth(spec, x);
    const deck = deckHeight(spec, x);
    const P = prof(deck);
    const bowSlope = tumble ? 0.06 * clamp((u - 0.8) / 0.2, 0, 1) : 0;
    const pts: { v: Vector3; c: Color }[] = [];
    const point = (fac: number, y: number, side: number) => {
      let f = fac;
      if (y < 0) {
        f *= 1 - 0.3 * clamp((u - 0.62) / 0.38, 0, 1);
        f *= 1 - 0.25 * clamp((0.12 - u) / 0.12, 0, 1);
      }
      // A wave-piercing bow runs out furthest at the keel and slopes back to the deck.
      const rake = tumble ? clamp((y + d) / (fb + d), 0, 1) * bowSlope : clamp((fb - y) / (fb + d), 0, 1) * rakeFrac;
      const px = x * (1 - rake);
      const z = side * f * hw;
      const c = y < -0.25 ? boot : y < 1.0 ? stripe : paint(px, y, z).clone();
      pts.push({ v: new Vector3(px, y, z), c });
    };
    for (let k = 0; k < P.length; k++) point(P[k][0], P[k][1], -1);
    for (let k = P.length - 2; k >= 0; k--) point(P[k][0], P[k][1], 1);
    sideRings.push(pts.map((p) => p.v));
    sideCols.push(pts.map((p) => p.c));
    const dr: Vector3[] = [];
    for (const [fz, fy] of [
      [1, 0],
      [0.5, 0.75],
      [0, 1],
      [-0.5, 0.75],
      [-1, 0],
    ]) {
      dr.push(new Vector3(x * (1 - bowSlope), deck + camber * fy, fz * hw * P[0][0]));
    }
    deckRings.push(dr);
    deckCols.push(dr.map(() => deckCol));
  }
  return [loft(sideRings, sideCols, true), loft(deckRings, deckCols, false)];
}

// ------------------------------------------------------------------ parts

interface TurretGeo {
  house: BufferGeometry;
  guns: BufferGeometry;
  pivotX: number;
  pivotY: number;
}

type TurretStyle = NonNullable<ShipSpec['model']['turretStyle']>;

/** A gun house with `barrels` guns. Origin at turret centre, guns along +X. */
export function turretGeometry(caliber: number, barrels: number, barrelLen: number, baseY: number, color: number, accent: number, style: TurretStyle = 'gun'): TurretGeo {
  const c = caliber / 1000;
  const w = 1.8 + c * (barrels * 5 + 6);
  const len = w * (barrels === 1 ? 1.15 : 1.35);
  const h = 1.2 + c * 7;
  const house = new Parts();
  if (baseY > 0.2) house.cyl(w * 0.42, w * 0.44, baseY + 0.4, 0, -baseY - 0.2, 0, color, { seg: 16 });
  if (style === 'orb' || style === 'runecannon') return spellTurret(style, c, barrels, barrelLen, w, h, house, color, accent);
  if (style === 'stealth' || style === 'rail' || style === 'emitter') return techTurret(style, c, barrels, barrelLen, w, h, house, color, accent);
  house.box(len, h, w, -len * 0.12, 0, 0, color, { taper: 0.06, slope: h * 0.45 });
  if (caliber >= 280) house.box(1.4, 0.9, w * 1.25, -len * 0.45, h * 0.55, 0, accent);
  const guns = new Parts();
  const r0 = c * 1.05 + 0.05;
  const r1 = c * 0.72 + 0.03;
  const spacing = barrels > 1 ? (w * 0.78) / barrels : 0;
  for (let b = 0; b < barrels; b++) {
    const z = (b - (barrels - 1) / 2) * spacing;
    guns.barrel(r0 * 1.35, r0 * 1.3, Math.min(2.2, barrelLen * 0.15), -0.4, 0, z, color);
    guns.barrel(r0, r1, barrelLen, 0, 0, z, color);
  }
  return { house: house.merge(), guns: guns.merge(), pivotX: len * 0.25, pivotY: h * 0.42 };
}

/**
 * Fantasy gun houses. An orb: a crystal sphere on a ringed plinth, firing from slim wands. A rune
 * cannon: a squat six-sided drum with flared bronze muzzles.
 */
function spellTurret(style: TurretStyle, c: number, barrels: number, barrelLen: number, w: number, h: number, house: Parts, color: number, accent: number): TurretGeo {
  const guns = new Parts();
  const spacing = barrels > 1 ? (w * 0.7) / barrels : 0;
  if (style === 'orb') {
    house.cyl(w * 0.5, w * 0.55, h * 0.35, 0, 0, 0, color, { seg: 12 });
    house.cyl(w * 0.56, w * 0.56, 0.25, 0, h * 0.35, 0, accent, { seg: 12 });
    house.sphere(w * 0.42, 0, h * 0.35 + w * 0.3, 0, accent, { sy: 0.85 });
    for (let b = 0; b < barrels; b++) {
      const z = (b - (barrels - 1) / 2) * spacing;
      guns.barrel(c * 0.6 + 0.08, c * 0.25 + 0.04, barrelLen * 0.8, 0, 0, z, color, 6);
      guns.sphere(c * 1.2 + 0.15, barrelLen * 0.8, 0, z, accent);
    }
    return { house: house.merge(), guns: guns.merge(), pivotX: w * 0.2, pivotY: h * 0.35 + w * 0.3 };
  }
  house.cyl(w * 0.55, w * 0.62, h * 1.1, 0, 0, 0, color, { seg: 6 });
  house.cyl(w * 0.6, w * 0.6, 0.35, 0, h * 0.55, 0, accent, { seg: 6 });
  house.cyl(w * 0.3, w * 0.4, h * 0.4, -w * 0.1, h * 1.1, 0, accent, { seg: 6 });
  for (let b = 0; b < barrels; b++) {
    const z = (b - (barrels - 1) / 2) * spacing;
    guns.barrel(c * 1.1 + 0.08, c * 0.9 + 0.06, barrelLen * 0.75, 0, 0, z, color);
    guns.barrel(c * 1.0 + 0.06, c * 1.7 + 0.12, barrelLen * 0.15, barrelLen * 0.72, 0, z, accent);
  }
  return { house: house.merge(), guns: guns.merge(), pivotX: w * 0.3, pivotY: h * 0.55 };
}

/**
 * Modern and future gun houses. Stealth: a low faceted shield with slim, sleeved barrels. Rail: a
 * slab mount carrying paired rails with a glowing strip between. Emitter: a sensor dome with short
 * lenses ringed in light.
 */
function techTurret(style: TurretStyle, c: number, barrels: number, barrelLen: number, w: number, h: number, house: Parts, color: number, accent: number): TurretGeo {
  const guns = new Parts();
  const spacing = barrels > 1 ? (w * 0.72) / barrels : 0;
  const len = w * (barrels === 1 ? 1.25 : 1.3);
  if (style === 'stealth') {
    house.box(len, h * 0.85, w, -len * 0.1, 0, 0, color, { taper: 0.38, slope: h * 0.7 });
    house.box(len * 0.5, 0.2, w * 0.66, -len * 0.18, h * 0.85, 0, color);
    for (let b = 0; b < barrels; b++) {
      const z = (b - (barrels - 1) / 2) * spacing;
      guns.barrel(c * 1.25 + 0.12, c * 1.15 + 0.1, barrelLen * 0.22, -0.2, 0, z, color, 6);
      guns.barrel(c * 0.72 + 0.05, c * 0.6 + 0.04, barrelLen, 0, 0, z, color);
    }
    return { house: house.merge(), guns: guns.merge(), pivotX: len * 0.25, pivotY: h * 0.4 };
  }
  if (style === 'rail') {
    house.box(len, h * 0.8, w, -len * 0.1, 0, 0, color, { taper: 0.12, slope: h * 0.25 });
    house.box(len * 0.7, 0.3, w * 1.04, -len * 0.15, h * 0.45, 0, accent);
    for (let b = 0; b < barrels; b++) {
      const z = (b - (barrels - 1) / 2) * spacing;
      const rh = c * 1.6 + 0.15;
      const gap = c * 0.9 + 0.08;
      for (const side of [-1, 1]) guns.box(barrelLen, rh, c * 0.55 + 0.06, barrelLen / 2, -rh / 2, z + side * gap, color);
      guns.box(barrelLen * 0.92, rh * 0.5, gap * 1.2, barrelLen * 0.48, -rh / 4, z, accent);
      guns.box(1.4, rh * 1.4, gap * 2.8, 0.5, -rh * 0.7, z, color);
    }
    return { house: house.merge(), guns: guns.merge(), pivotX: len * 0.25, pivotY: h * 0.5 };
  }
  house.cyl(w * 0.5, w * 0.56, h * 0.4, 0, 0, 0, color, { seg: 16 });
  house.sphere(w * 0.46, 0, h * 0.4, 0, color, { sy: 0.7 });
  house.cyl(w * 0.5, w * 0.5, 0.3, 0, h * 0.4, 0, accent, { seg: 16 });
  for (let b = 0; b < barrels; b++) {
    const z = (b - (barrels - 1) / 2) * spacing;
    guns.barrel(c * 1.3 + 0.12, c * 1.1 + 0.1, barrelLen * 0.45, 0, 0, z, color, 10);
    guns.barrel(c * 1.25 + 0.12, c * 1.25 + 0.12, barrelLen * 0.06, barrelLen * 0.45, 0, z, accent, 10);
  }
  return { house: house.merge(), guns: guns.merge(), pivotX: w * 0.2, pivotY: h * 0.4 + w * 0.15 };
}

export function planeParts(p: Parts, color: number, x = 0, y = 0, z = 0, ry = 0, scale = 1): Parts {
  const s = scale;
  const rot = (dx: number, dz: number): [number, number] => [x + dx * Math.cos(ry) + dz * Math.sin(ry), z - dx * Math.sin(ry) + dz * Math.cos(ry)];
  const at = (dx: number, dy: number, dz: number) => {
    const [px, pz] = rot(dx * s, dz * s);
    return [px, y + dy * s, pz] as const;
  };
  const light = new Color(color).offsetHSL(0, -0.05, 0.12).getHex();
  let q = at(0, -0.6, 0);
  p.box(9 * s, 1.3 * s, 1.3 * s, q[0], q[1], q[2], color, { ry, taper: 0.2 });
  q = at(0.6, 0.5, 0);
  p.box(2.2 * s, 0.6 * s, 0.9 * s, q[0], q[1], q[2], 0x9fb3bf, { ry, taper: 0.3 });
  q = at(0.8, -0.35, 0);
  p.box(2.2 * s, 0.25 * s, 12.5 * s, q[0], q[1], q[2], light, { ry });
  q = at(-3.9, -0.2, 0);
  p.box(1.2 * s, 0.2 * s, 4.2 * s, q[0], q[1], q[2], color, { ry });
  q = at(-3.9, -0.1, 0);
  p.box(1.4 * s, 1.6 * s, 0.2 * s, q[0], q[1], q[2], color, { ry });
  return p;
}

export function planeGeometry(color: number): BufferGeometry {
  return planeParts(new Parts(), color).merge();
}

/**
 * A squadron member of each look, nose along +X, about plane-sized. `color` is the team colour,
 * worn on the wings (or the fuselage of machines) so sides stay readable.
 */
export function flyerGeometry(look: PlaneLook, color: number): BufferGeometry {
  if (look === 'plane') return planeGeometry(color);
  const p = new Parts();
  const dark = new Color(color).offsetHSL(0, 0, -0.12).getHex();
  const light = new Color(color).offsetHSL(0, -0.05, 0.14).getHex();
  switch (look) {
    case 'griffon':
      // Lion body, eagle head and broad feathered wings.
      p.box(6, 2, 2, -0.5, -1, 0, 0xc29a5a, { taper: 0.15 });
      p.sphere(1.2, 3, 0.6, 0, 0xf0ead8, { sx: 1.3 });
      p.box(1.2, 0.5, 0.5, 4.2, 0.4, 0, 0xe0b040, { taper: 0.5 });
      p.box(3, 0.25, 14, 0.4, 0.4, 0, light, { taper: 0.25 });
      p.box(1.6, 0.2, 18, -0.4, 0.5, 0, color);
      p.box(3.2, 0.3, 0.3, -4.6, -0.4, 0, 0xa07a40);
      break;
    case 'bat':
      // A ragged wraith of a bat: thin body, scalloped membrane wings.
      p.box(4, 1.2, 1.2, 0, -0.6, 0, 0x2a2830, { taper: 0.2 });
      p.sphere(0.8, 2.3, 0.2, 0, 0x34303a);
      for (const z of [-1, 1]) {
        p.box(3.4, 0.2, 7, 0.2, 0.1, z * 4, dark, { ry: z * 0.18, taper: 0.35 });
        p.box(2.2, 0.2, 4, -0.8, 0.1, z * 8.4, color, { ry: z * 0.45, taper: 0.5 });
        p.box(0.6, 1, 0.3, 2.6, 0.6, z * 0.5, 0x7affb0);
      }
      break;
    case 'dragon':
      // Long neck, horned head, barbed tail and great leathery wings.
      p.box(7, 2.2, 2.4, 0, -1.1, 0, 0x7a2418, { taper: 0.2 });
      p.box(3.5, 1, 1, 4.6, 0, 0, 0x8a2a1a, { rz: 0.25, taper: 0.2 });
      p.box(2.2, 1.1, 1.2, 6.9, 0.9, 0, 0x9a3020, { taper: 0.3 });
      p.box(0.9, 0.9, 0.2, 6.2, 1.8, -0.4, 0xe8d8b0, { rz: -0.6 });
      p.box(0.9, 0.9, 0.2, 6.2, 1.8, 0.4, 0xe8d8b0, { rz: -0.6 });
      p.box(7, 0.6, 0.6, -6.5, -0.6, 0, 0x6a1e14, { taper: 0.6 });
      for (const z of [-1, 1]) {
        p.box(4.5, 0.25, 9, 0.6, 0.4, z * 5.2, dark, { ry: z * 0.12, taper: 0.4 });
        p.box(3, 0.25, 6, -1.4, 0.4, z * 10.8, color, { ry: z * 0.5, taper: 0.55 });
      }
      break;
    case 'gyro':
      // A dwarven gyrocopter: a brass tub under a spinning rotor, with a pusher prop.
      p.box(4.5, 1.8, 1.8, 0, -1, 0, 0x8a6a3c, { taper: 0.2 });
      p.sphere(0.8, 1.8, 0.5, 0, 0xd0e8f0, { sy: 0.7 });
      p.cyl(0.15, 0.15, 1.8, 0, 0.6, 0, 0x3a3634, { seg: 5 });
      p.cyl(7, 7, 0.08, 0, 2.4, 0, light, { seg: 10 });
      p.box(0.4, 0.4, 7, 0, 2.5, 0, color);
      p.box(3.6, 0.4, 0.4, -3.6, -0.3, 0, 0x5a4a3a);
      p.cyl(1.4, 1.4, 0.1, -5.4, -0.3, 0, color, { seg: 8, rz: Math.PI / 2 });
      break;
    case 'jet':
      // A swept fighter-bomber: delta wing, twin tails.
      p.box(11, 1.2, 1.4, 0, -0.6, 0, color, { taper: 0.25 });
      p.box(2.2, 0.6, 0.9, 2.8, 0.5, 0, 0x26343c, { taper: 0.3 });
      p.box(5.5, 0.22, 10, -1.2, -0.3, 0, light, { taper: 0.75 });
      for (const z of [-1, 1]) p.box(1.8, 1.8, 0.2, -4.6, 0, z * 1.2, color, { rx: z * 0.35, taper: 0.4 });
      break;
    case 'heli':
      // A naval helicopter: cabin, tail boom, main and tail rotors.
      p.box(5.5, 2.4, 2.4, 0.5, -1.4, 0, color, { taper: 0.15 });
      p.box(1.6, 1.2, 2, 3.4, -0.6, 0, 0x26343c, { taper: 0.3 });
      p.box(6, 0.7, 0.6, -5, -0.2, 0, color, { taper: 0.4 });
      p.cyl(0.2, 0.2, 0.8, 0.5, 1, 0, 0x2c2e31, { seg: 5 });
      p.cyl(7.5, 7.5, 0.06, 0.5, 1.8, 0, light, { seg: 12 });
      p.cyl(1.2, 1.2, 0.08, -8, 0.2, 0.4, light, { seg: 8, rx: Math.PI / 2 });
      break;
    case 'drone':
      // A tailless flying wing: a chevron with a glowing sensor eye.
      for (const z of [-1, 1]) p.box(6, 0.4, 6, -1.4, -0.2, z * 2.8, color, { ry: z * 0.6, taper: 0.5 });
      p.box(5, 0.8, 1.6, 0.4, -0.4, 0, dark, { taper: 0.3 });
      p.sphere(0.4, 2.6, 0.1, 0, 0x80f0ff);
      break;
    case 'petal':
      // A drift of cherry-blossom blades: five pink petals fanned round a glowing hilt-guard.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        p.box(4.2, 0.18, 1.6, Math.cos(a) * 3.2, 0.2 * (i % 2), Math.sin(a) * 3.2, i % 2 ? 0xffc8dc : 0xff9ec4, { ry: -a, taper: 0.7 });
      }
      p.sphere(0.9, 0, 0, 0, color);
      break;
  }
  return p.merge();
}

/** Height of the superstructure top above the freeboard at local x. */
function blockTopAt(spec: ShipSpec, x: number): number {
  let stack = 0;
  let top = 0;
  for (const b of spec.model.blocks) {
    const base = b.y ?? stack;
    stack = base + b.h;
    if (Math.abs(x - b.x) <= b.len / 2) top = Math.max(top, base + b.h);
  }
  return top;
}

const funnelCache = new Map<string, Vector3[]>();

/** Local positions of funnel mouths (for exhaust smoke). */
export function funnelTops(spec: ShipSpec): Vector3[] {
  let out = funnelCache.get(spec.id);
  if (out) return out;
  out = spec.model.funnels.map((f) => {
    const base = spec.freeboard + blockTopAt(spec, f.x) - 0.6;
    const t = f.tilt ?? 0;
    return new Vector3(f.x + Math.sin(t) * f.h, base + f.h * Math.cos(t) + 0.5, 0);
  });
  if (spec.cls === 'CV') out.push(new Vector3(0, spec.freeboard + 4, spec.beam * 0.62));
  funnelCache.set(spec.id, out);
  return out;
}

function staticGeometry(spec: ShipSpec): BufferGeometry {
  const p = new Parts();
  for (const g of hullGeometry(spec)) p.list.push(g.index ? g.toNonIndexed() : g);
  const m = spec.model;
  const pal = m.palette;
  const fb = spec.freeboard;
  const L = spec.length;
  const refreshed=!!FLEET_DETAILS[spec.id];
  const upperPaint = m.camo === 'dazzle' || m.camo === 'baltic' ? camoFn(spec, pal.upper) : pal.upper;

  if (spec.sub) {
    p.box(L * 0.8, 0.6, spec.beam * 0.32, L * 0.02, fb - 0.5, 0, pal.deck);
    const ct = m.conningTower!;
    p.box(ct.len, ct.h, spec.beam * 0.34, ct.x, fb - 0.2, 0, pal.upper, { taper: 0.18, slope: 1.2 });
    p.box(ct.len * 0.5, 1.2, spec.beam * 0.36, ct.x + ct.len * 0.15, fb + ct.h - 1.6, 0, STRIPE);
    p.cyl(0.18, 0.2, 4.5, ct.x + 1.5, fb + ct.h - 0.2, 0, pal.accent);
    p.cyl(0.14, 0.16, 3.6, ct.x - 1, fb + ct.h - 0.2, 0, pal.accent);
    p.box(ct.len * 0.6, 0.4, spec.beam * 0.45, ct.x - ct.len * 0.2, fb + ct.h * 0.55, 0, pal.upper);
    addFleetDetails(p,spec);
    return p.merge();
  }

  // Superstructure blocks, stacked unless an explicit base is given. The Tungsten's mass-driver model draws its own
  // bridge and reactor over them (TungstenModel); here they only set the hit box.
  let stack = 0;
  for (const b of spec.id === 'tungsten' ? [] : m.blocks) {
    const base = b.y ?? stack;
    stack = base + b.h;
    const y0 = fb + base - 0.3;
    p.box(b.len, b.h + 0.3, b.w, b.x, y0, b.z ?? 0, upperPaint, { taper: m.flightDeck ? 0 : refreshed ? .12 : .04, slope: refreshed&&!m.flightDeck?Math.min(2,b.h*.2):0 });
    if(refreshed&&!m.flightDeck){
      p.box(b.len*.92,.35,b.w*.9,b.x,y0+b.h,b.z??0,pal.upper);
      for(const side of [-1,1])for(let j=0;j<Math.min(8,Math.floor(b.len/5));j++){
        const wx=b.x-b.len*.36+j*b.len*.72/Math.max(1,Math.min(8,Math.floor(b.len/5))-1);
        p.box(Math.min(2,b.len*.04),.6,.22,wx,y0+b.h*.65,(b.z??0)+side*b.w*.46,0x263d4c);
      }
    }
    if (!m.flightDeck && b.h >= 3) p.box(b.len * 1.004, 0.45, b.w * 1.01, b.x, y0 + b.h - 1.1, b.z ?? 0, STRIPE);
    if (!m.flightDeck && b.len > 20) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ax = b.x + sx * (b.len / 2 - 2.5);
          const az = (b.z ?? 0) + sz * (b.w / 2 - 1.6);
          p.cyl(1.0, 1.1, 0.9, ax, y0 + b.h + 0.3, az, pal.upper);
          p.barrel(0.09, 0.07, 2.2, ax, y0 + b.h + 1.1, az - 0.3, pal.accent, 5);
          p.barrel(0.09, 0.07, 2.2, ax, y0 + b.h + 1.1, az + 0.3, pal.accent, 5);
        }
      }
    }
  }

  // Bridge / tower.
  if (m.tower) {
    const t = m.tower;
    const base = fb + blockTopAt(spec, t.x) - 0.2;
    if (t.style === 'pagoda') {
      const tiers = 6;
      let y = base;
      for (let i = 0; i < tiers; i++) {
        const k = 1 - i * 0.11;
        const th = t.h / tiers;
        p.box(t.len * k, th, t.w * k, t.x - i * 0.3, y, 0, upperPaint, { taper: 0.05 });
        p.box(t.len * k + 1.6, 0.35, t.w * k + 2.2, t.x - i * 0.3, y + th - 0.2, 0, pal.upper);
        if (i === tiers - 2) p.box(t.len * k * 1.01, 0.6, t.w * k * 1.01, t.x - i * 0.3, y + th * 0.4, 0, STRIPE);
        y += th;
      }
      p.box(1.5, 1.5, t.w * 2.4, t.x - 2, y + 1.2, 0, pal.upper);
      p.box(3, 2, 3, t.x - 2, y, 0, pal.upper);
    } else if (t.style === 'tower') {
      p.box(t.len, t.h, t.w, t.x, base, 0, upperPaint, { taper: 0.32 });
      p.box(t.len * 1.25, 0.4, t.w * 1.5, t.x, base + t.h * 0.45, 0, pal.upper);
      p.box(t.len * 0.9, 0.8, t.w * 0.95, t.x, base + t.h * 0.62, 0, STRIPE);
      p.box(t.len * 0.7, 0.4, t.w * 1.2, t.x, base + t.h * 0.8, 0, pal.upper);
      p.cyl(1.6, 1.8, 2.2, t.x, base + t.h, 0, pal.upper, { seg: 14 });
      p.box(1, 1, t.w * 1.5, t.x, base + t.h + 0.8, 0, pal.upper);
    } else if (t.style === 'tripod') {
      for (const [dx, dz] of [
        [1.5, 0],
        [-1.5, 1.6],
        [-1.5, -1.6],
      ]) {
        p.cyl(0.35, 0.45, t.h, t.x + dx, base, dz, pal.upper, { seg: 6, rx: -dz * 0.025, rz: dx * 0.025 });
      }
      p.box(t.len * 0.6, 2.4, t.w * 0.8, t.x, base + t.h - 0.5, 0, pal.upper);
    } else {
      p.box(t.len, t.h * 0.7, t.w, t.x, base, 0, upperPaint, { taper: 0.08, slope: 1.2 });
      p.box(t.len * 1.02, 0.7, t.w * 1.02, t.x, base + t.h * 0.7 - 1.4, 0, STRIPE);
      p.box(t.len * 1.25, 0.35, t.w + 3.2, t.x - 0.5, base + t.h * 0.5, 0, pal.upper);
      p.cyl(1.4, 1.6, t.h * 0.18, t.x - 0.8, base + t.h * 0.7, 0, pal.upper, { seg: 12 });
      p.box(2.4, 1.4, 2.4, t.x - 0.8, base + t.h * 0.88, 0, pal.upper);
    }
  }

  // Funnels with dark caps.
  for (const f of m.funnels) {
    const base = fb + blockTopAt(spec, f.x) - 0.6;
    const sx = f.len ? f.len / (2 * f.r) : 1;
    p.cyl(f.r * 0.94, f.r, f.h, f.x, base, 0, pal.upper, { sx, rz: -(f.tilt ?? 0), seg: 18 });
    const lean = Math.sin(-(f.tilt ?? 0)) * f.h;
    p.cyl(f.r * 0.98, f.r * 0.96, 1.4, f.x - lean, base + f.h * Math.cos(f.tilt ?? 0) - 1.2, 0, pal.accent, { sx, rz: -(f.tilt ?? 0), seg: 18 });
  }

  // Masts and yards.
  for (const mt of m.masts) {
    const base = fb + blockTopAt(spec, mt.x) - 0.2;
    const top = fb + mt.h;
    if (top <= base + 1) continue;
    p.cyl(0.28, 0.5, top - base, mt.x, base, 0, pal.upper, { seg: 6 });
    p.box(0.3, 0.3, spec.beam * 0.55, mt.x, base + (top - base) * 0.78, 0, pal.upper);
    if (mt.h > 22) p.box(2.4, 0.4, 2.4, mt.x, base + (top - base) * 0.6, 0, pal.upper);
  }

  if (m.hullStyle === 'galleon') {
    // Castles fore and aft, gilded stern windows, a bowsprit and a figurehead.
    const aftLen = L * 0.2;
    const ax = -L / 2 + aftLen / 2 + 1;
    const ah = Math.max(4, fb * 0.9);
    const ay = deckHeight(spec, ax) - 0.2;
    p.box(aftLen, ah, hullHalfWidth(spec, ax) * 1.8, ax, ay, 0, pal.hull, { taper: 0.06 });
    p.box(aftLen * 0.6, ah * 0.6, hullHalfWidth(spec, ax) * 1.5, ax - aftLen * 0.1, ay + ah, 0, pal.upper, { taper: 0.08 });
    p.box(0.4, ah * 0.35, hullHalfWidth(spec, ax) * 1.5, -L / 2 + 1.2, ay + ah * 0.35, 0, pal.accent);
    for (const sz of [-1, 1]) p.box(aftLen * 0.8, 0.5, 0.3, ax, ay + ah * 0.5, sz * hullHalfWidth(spec, ax) * 0.92, pal.accent);
    p.sphere(0.9, -L / 2 + 0.8, ay + ah * 1.6 + 1.2, 0, pal.accent);
    const fx = L / 2 - L * 0.07;
    p.box(L * 0.12, Math.max(2.5, fb * 0.5), hullHalfWidth(spec, fx) * 1.7, fx, deckHeight(spec, fx) - 0.2, 0, pal.hull, { taper: 0.1 });
    const bow = L / 2 - 1;
    p.cyl(0.35, 0.55, L * 0.16, bow, deckHeight(spec, bow) + 0.5, 0, pal.upper, { rz: -(Math.PI / 2 - 0.32), seg: 6 });
    p.sphere(1.3, bow + 1.2, fb * 0.75, 0, pal.accent, { sx: 1.5, sy: 0.9 });
  }

  for (const sl of m.sails ?? []) {
    // A mast with yards and square sails, each row a little narrower than the one below.
    const base = deckHeight(spec, sl.x) + blockTopAt(spec, sl.x);
    const rows = sl.rows ?? 2;
    const top = base + sl.h;
    p.cyl(0.35, 0.6, sl.h + 3, sl.x, base, 0, pal.upper, { seg: 6 });
    const rowH = (sl.h * 0.82) / rows;
    for (let r = 0; r < rows; r++) {
      const y = base + sl.h * 0.12 + r * rowH;
      const w = sl.w * (1 - r * 0.18);
      p.box(0.3, 0.3, w * 1.06, sl.x, y + rowH, 0, pal.upper);
      if(refreshed){
        const points:number[]=[];
        const pt=(u:number,v:number)=>[sl.x+.5+Math.sin(u*Math.PI)*Math.sin(v*Math.PI)*w*.12,y+rowH*(.05+.92*v),(u-.5)*w*(1-.06*v)];
        for(let a=0;a<8;a++)for(let b=0;b<5;b++){
          const v0=pt(a/8,b/5),v1=pt((a+1)/8,b/5),v2=pt(a/8,(b+1)/5),v3=pt((a+1)/8,(b+1)/5);
          for(const tri of [[v0,v1,v2],[v2,v1,v3],[v2,v1,v0],[v3,v1,v2]])for(const v of tri)points.push(...v);
        }
        const cloth=new BufferGeometry();cloth.setAttribute('position',new BufferAttribute(new Float32Array(points),3));cloth.computeVertexNormals();p.add(cloth,m.sailColor??0xe6dcc4);
      }else p.box(0.5, rowH * 0.92, w, sl.x + 0.5, y + rowH * 0.05, 0, m.sailColor ?? 0xe6dcc4, { slope: -0.8, taper: 0.06 });
    }
    p.cyl(0.25, 0.25, 2, sl.x, top + 2.6, 0, pal.accent, { seg: 5 });
  }

  // Vertical launch cells: a dark deck plate ruled into hatches.
  for (const v of m.vls ?? []) {
    const cell = 2.3;
    const y = deckHeight(spec, v.x) - 0.05;
    const vz = v.z ?? 0;
    p.box(v.cols * cell + 0.6, 0.3, v.rows * cell + 0.6, v.x, y, vz, pal.accent);
    for (let i = 0; i < v.cols; i++) {
      for (let j = 0; j < v.rows; j++) {
        p.box(cell * 0.8, 0.12, cell * 0.8, v.x + (i - (v.cols - 1) / 2) * cell, y + 0.3, vz + (j - (v.rows - 1) / 2) * cell, pal.upper);
      }
    }
  }

  // Phased-array radar faces, two to a station, angled out over the bow (or the stern).
  for (const pn of m.panels ?? []) {
    let hw = spec.beam * 0.3;
    for (const b of m.blocks) if (Math.abs(pn.x - b.x) < b.len / 2) hw = Math.max(hw, b.w / 2);
    const y = fb + pn.y;
    const fore = pn.x >= 0 ? 1 : -1;
    for (const side of [-1, 1]) {
      const ry = side > 0 ? (fore > 0 ? Math.PI / 4 : -Math.PI / 4) : fore > 0 ? (3 * Math.PI) / 4 : (-3 * Math.PI) / 4;
      p.cyl(pn.w / 2, pn.w / 2, 0.35, pn.x + fore * pn.w * 0.15, y, side * (hw + 0.1), 0x3a4048, { seg: 8, rx: Math.PI / 2, ry });
    }
  }

  // Blade fins, swept back, standing on the deck or the superstructure under them.
  for (const f of m.fins ?? []) {
    const y = deckHeight(spec, f.x) + blockTopAt(spec, f.x) - 0.2;
    p.box(f.len, f.h, 0.7, f.x, y, f.z ?? 0, pal.upper, { taper: 0.4, slope: f.len * 0.55 });
    p.box(f.len * 0.9, 0.35, 0.8, f.x - f.len * 0.05, y + f.h * 0.35, f.z ?? 0, pal.accent);
  }

  // Sensor domes on top of the superstructure.
  for (const d of m.domes ?? []) p.sphere(d.r, d.x, deckHeight(spec, d.x) + blockTopAt(spec, d.x) + d.r * 0.55, 0, 0xe8ecef);

  // A submarine-style sail on a surface hull (Vanguard): slab-sided, with sail planes.
  if (m.conningTower) {
    const ct = m.conningTower;
    const y = deckHeight(spec, ct.x) + blockTopAt(spec, ct.x) - 0.2;
    p.box(ct.len, ct.h, spec.beam * 0.22, ct.x, y, 0, pal.upper, { taper: 0.18, slope: 1.6 });
    p.box(ct.len * 0.55, 1.2, spec.beam * 0.24, ct.x + ct.len * 0.12, y + ct.h - 1.6, 0, STRIPE);
    p.box(ct.len * 0.3, 0.6, spec.beam * 0.55, ct.x + ct.len * 0.15, y + ct.h * 0.6, 0, pal.upper, { taper: 0.2 });
  }

  // A volcanic cone with a lumpy shoulder (Brokkr); the crater's glow is added by the view.
  if (m.volcano) {
    const v = m.volcano;
    const y = deckHeight(spec, v.x) + blockTopAt(spec, v.x) - 0.3;
    p.cyl(v.r * 0.32, v.r, v.h, v.x, y, 0, 0x3a302a, { seg: 14 });
    p.cyl(v.r * 0.36, v.r * 0.5, v.h * 0.3, v.x - v.r * 0.4, y, v.r * 0.35, 0x2e2622, { seg: 9 });
    p.cyl(v.r * 0.3, v.r * 0.45, v.h * 0.22, v.x + v.r * 0.45, y, -v.r * 0.3, 0x2e2622, { seg: 9 });
    p.cyl(v.r * 0.34, v.r * 0.3, v.h * 0.08, v.x, y + v.h - 0.2, 0, 0x241c18, { seg: 14 });
  }

  // Uplink dishes on stalks, tilted skyward toward the bow.
  for (const d of m.dishes ?? []) {
    const y = deckHeight(spec, d.x) + blockTopAt(spec, d.x) - 0.2;
    const z = d.z ?? 0;
    p.cyl(d.r * 0.1, d.r * 0.16, d.r * 0.9, d.x, y, z, pal.upper, { seg: 8 });
    p.cyl(d.r, d.r * 0.18, d.r * 0.32, d.x, y + d.r * 0.8, z, 0xdfe4ea, { seg: 18, rz: -0.5 });
    p.cyl(d.r * 0.05, d.r * 0.05, d.r * 0.7, d.x, y + d.r * 0.9, z, pal.accent, { seg: 5, rz: -0.5 });
  }

  // The orrery's brass ring and column (Astraea); its spheres turn in the view.
  if (m.orbs) {
    const o = m.orbs;
    const y = deckHeight(spec, o.x) + blockTopAt(spec, o.x) - 0.2;
    p.cyl(o.size * 0.3, o.size * 0.5, o.y, o.x, y, 0, 0xb08a40, { seg: 8 });
    p.add(new TorusGeometry(o.r, o.size * 0.12, 6, 48), 0xc8a050, o.x, y + o.y, 0, { rx: Math.PI / 2 });
    p.add(new TorusGeometry(o.r * 0.6, o.size * 0.1, 6, 36), 0xc8a050, o.x, y + o.y, 0, { rx: Math.PI / 2 + 0.25 });
  }

  // Ekranoplan: low wings with engine pods, and a tall tail.
  if (m.wings) {
    const wg = m.wings;
    const wy = fb * 0.35;
    for (const side of [-1, 1]) {
      p.box(wg.chord, 1.4, wg.span / 2 - spec.beam * 0.4, wg.x, wy, side * (wg.span / 4 + spec.beam * 0.2), pal.hull, { taper: 0.05 });
      p.box(wg.chord * 0.4, 3.5, 1.2, wg.x - wg.chord * 0.2, wy - 2.5, side * wg.span / 2, pal.hull);
    }
    const ex = L / 2 - L * 0.16;
    for (const side of [-1, 1]) {
      p.box(8, 1, spec.beam * 0.9, ex, fb + 2, side * spec.beam * 0.75, pal.upper);
      for (let i = 0; i < 4; i++) p.barrel(1.4, 1.2, 9, ex - 4, fb + 3.6, side * (spec.beam * 0.45 + i * 3.2), 0x50565c, 10);
    }
    const tx = -L / 2 + L * 0.08;
    p.box(L * 0.12, L * 0.11, 1.4, tx, fb, 0, pal.hull, { taper: 0.3, slope: L * 0.03 });
    p.box(L * 0.09, 1, wg.span * 0.45, tx - L * 0.02, fb + L * 0.1, 0, pal.hull, { taper: 0.2 });
  }

  // Bow jack staff and stern ensign staff.
  const bowX = L / 2 - 1.5;
  p.cyl(0.08, 0.1, 6, bowX, deckHeight(spec, bowX), 0, pal.accent, { seg: 4 });
  p.cyl(0.08, 0.1, 7, -L / 2 + 1.5, deckHeight(spec, -L / 2), 0, pal.accent, { seg: 4 });

  // Aircraft carrier: flight deck, island, funnel, parked aircraft.
  if (m.flightDeck) {
    const fd = m.flightDeck;
    const y = fb + fd.y;
    const len = L * (0.86 + fd.overhang);
    const w = spec.beam * 0.98;
    const cx = L * 0.02;
    p.box(len, 0.7, w, cx, y, 0, refreshed ? pal.deck : m.hullStyle === 'block' ? pal.deck : 0x7a6146);
    p.box(len * 0.98, 0.04, 0.5, cx, y + 0.7, w / 2 - 1.2, 0xe8e8e0);
    p.box(len * 0.98, 0.04, 0.5, cx, y + 0.7, -w / 2 + 1.2, 0xe8e8e0);
    for (let i = 0; i < 12; i++) p.box(6, 0.04, 0.45, cx - len / 2 + 14 + i * (len - 28) / 11, y + 0.7, 0, 0xe8e8e0);
    for (let i = 0; i < 7; i++) p.box(4, 0.05, w / 7, cx - len / 2 + 2, y + 0.7, -w / 2 + (i + 0.5) * (w / 7), i % 2 ? 0xe8e8e0 : 0xb02a22);
    p.cyl(4.2, 4.2, 0.05, cx + len * 0.36, y + 0.72, 0, 0xc0281f, { seg: 24 });
    // Supports under the deck overhang.
    for (const sx of [-1, 1]) p.box(3, fd.y - 1, w * 0.6, cx + sx * (len / 2 - 4), fb, 0, pal.hull);
    const ix = L * 0.08;
    const iz = -w * 0.36;
    p.box(14, 7, 5.5, ix, y + 0.7, iz, pal.upper, { taper: 0.1 });
    p.box(14.1, 0.6, 5.6, ix, y + 5.6, iz, STRIPE);
    p.cyl(0.25, 0.4, 12, ix - 3, y + 7, iz, pal.upper, { seg: 6 });
    p.cyl(2.2, 2.6, 10, 0, fb + 6, w * 0.48, pal.accent, { rx: Math.PI * 0.62, seg: 12 });
    // Olive warbirds on a WWII deck; jets, helicopters and drones are painted low-vis grey.
    const look = spec.air?.look;
    const planeCol = look === 'jet' || look === 'heli' || look === 'drone' ? 0x6c737a : 0x56663f;
    for (let i = 0; i < 9; i++) {
      const px = cx - len / 2 + 12 + Math.floor(i / 3) * 11;
      const pz = (i % 3 - 1) * 9;
      if(refreshed&&look&&look!=='plane')p.add(flyerGeometry(look,planeCol),planeCol,px,y+2.4,pz,{sx:.75,sy:.75,sz:.75});
      else planeParts(p, planeCol, px, y + 2.1, pz, 0, 0.9);
    }
  }
  addFleetDetails(p,spec);
  return p.merge();
}

// ------------------------------------------------------------------ view

interface TurretView {
  yaw: Group;
  pitch: Group;
  slide: Group;
}

const geoCache = new Map<string, { hull: BufferGeometry; turrets: TurretGeo[]; secs: Map<string, TurretGeo>; launcher: BufferGeometry | null }>();

function geometriesFor(spec: ShipSpec) {
  let g = geoCache.get(spec.id);
  if (g) return g;
  const pal = spec.model.palette;
  const turrets: TurretGeo[] = [];
  if (spec.main) {
    const shell = spec.main.ap ?? spec.main.he!;
    for (const t of spec.main.turrets) turrets.push(spec.id==='architect'||spec.id==='architectPlatform'?architectTurretGeometry():spec.id==='stepper'?stepperTurretGeometry():turretGeometry(shell.caliber, t.barrels, spec.main.barrelLength, t.y, pal.upper, pal.accent, spec.model.turretStyle));
  }
  const secs = new Map<string, TurretGeo>();
  for (const sg of spec.secondaries ?? []) {
    secs.set(sg.name, turretGeometry(sg.shell.caliber, sg.barrels, (sg.shell.caliber / 1000) * 42, 0, pal.upper, pal.accent));
  }
  let launcher: BufferGeometry | null = null;
  const tspec = spec.torpedoes;
  if (tspec && !spec.sub) {
    const lp = new Parts();
    lp.cyl(1.3, 1.5, 0.6, 0, 0, 0, pal.upper);
    const n = tspec.tubes;
    const r = tspec.name.startsWith('610') ? 0.42 : 0.36;
    for (let i = 0; i < n; i++) lp.barrel(r, r, 8, -3.5, 0.95, (i - (n - 1) / 2) * r * 2.1, pal.upper, 8);
    lp.box(2.2, 1.1, n * r * 2.1 + 0.4, -3.6, 0.4, 0, pal.upper);
    launcher = lp.merge();
  }
  if(FLEET_DETAILS[spec.id]) for(const t of turrets){
    const p=new Parts();p.list.push(t.house);
    const k=Math.max(1,(spec.main?.he?.caliber??150)/100);
    for(const side of [-1,1]){
      p.box(k*2.2,k*.65,k*.3,-k*.5,k*.2,side*k*1.6,pal.upper,{taper:.2});
      p.box(k*1.6,k*.14,k*.32,-k*.6,k*.85,side*k*1.6,pal.accent);
    }
    p.box(k*.65,k*.45,k*.65,-k,k*1.15,0,pal.upper,{taper:.25});t.house=p.merge();
  }
  g = { hull: spec.id==='stepper'?stepperHullGeometry():staticGeometry(spec), turrets, secs, launcher };
  geoCache.set(spec.id, g);
  return g;
}

export function ghostHull(spec: ShipSpec): BufferGeometry { return geometriesFor(spec).hull; }

/** Build a hull's shared geometry ahead of its first view; true if it was not built yet. */
export function warmGeometry(spec: ShipSpec): boolean {
  if (geoCache.has(spec.id)) return false;
  geometriesFor(spec);
  return true;
}

export type ViewMode = 'normal' | 'ally' | 'enemy' | 'nearbySub' | 'cloak' | 'hidden';

/** Heel from flooding and lost buoyancy, at most (destroyers list further). */
const MAX_LIST = 4 * DEG;
const MAX_LIST_DD = 6 * DEG;
/** Knocked-out barrels sag this far. */
const DROOP = -8 * DEG;
/** The mast comes down below this share of hit points. */
const MAST_FALL_HP = 0.35;

const tmpScar = new Vector3();

/** A broken hull: the stern half and what was moved onto it. */
interface Split {
  stern: Group;
  sternHull: Mesh;
  sternMat: MeshStandardMaterial;
  sternU: DamageUniforms;
  moved: Object3D[];
}

export class ShipView {
  readonly root = new Group();
  readonly body = new Group();
  private turrets: TurretView[] = [];
  private secs: { obj: Group; side: number; x: number; z: number }[] = [];
  private launchers: Group[] = [];
  private meshes: Mesh[] = [];
  private mode: ViewMode = 'normal';
  private sinkSign: number;
  private recoilScale: number;
  /** Heel and trim from the guns' recoil: angle and angular velocity, on a damped spring. */
  private heel = 0;
  private heelV = 0;
  private trim = 0;
  private trimV = 0;
  private lastTime = -1;
  /** Glow around the hull while a skill runs (in that skill's accent), faded by `auraK`. */
  private aura: Mesh<BufferGeometry, ShaderMaterial>;
  private auraK = 0;
  /** A Titan Shift form's standing glow: a wider shell than the skill aura, always lit. */
  private formShell: Mesh<BufferGeometry, ShaderMaterial> | null = null;
  /** Reach of a zone skill (Flak Curtain, Mirror Dome...), drawn as a dome at sea level (added to the scene by the Renderer). */
  readonly dome: Mesh<SphereGeometry, ShaderMaterial> | null = null;
  private domeK = 0;
  private radar: Group | null = null;
  private pennant: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private pennantLen = 0;
  private pennantPhase = Math.random() * 10;
  /** Titans' glowing energy emitters (HDR colour, so bloom picks them up), pulsed in `update`. */
  private emitters: { mesh: Mesh<BufferGeometry, MeshBasicMaterial>; color: Color }[] = [];
  /** Astraea's turning orrery. */
  private orrery: Group | null = null;
  /** Battle damage drawn on this hull. */
  readonly damage = damageUniforms();
  private material: MeshStandardMaterial;
  /** The material each mesh wears when drawn normally (ghost modes swap it out). */
  private home = new WeakMap<Mesh, Material>();
  private hullMesh: Mesh;
  private hullGeo: BufferGeometry;
  private scarNext = 0;
  /** Current list and the side it falls to (+1 starboard). */
  private list = 0;
  private listSide: number;
  private mastFall = 0;
  private mastY = 0;
  private mastDeck = 0;
  private split: Split | null = null;
  private wasAlive = true;
  private architectModel: ArchitectModel | null = null;
  stepFold=0;
  /** Presentation-only yaw added to the hull, used by Stepper's turn-to-face on Flicker strikes. */
  stepYaw=0;
  private stepModel: StepperModel | null = null;
  /** The Tungsten's electromagnet and its docked cubes. */
  tungstenModel: TungstenModel | null = null;

  constructor(readonly spec: ShipSpec, shadows = true) {
    const geo = geometriesFor(spec);
    this.material = hullMaterial(this.damage);
    this.root.add(this.body);
    this.root.rotation.order = 'YZX';
    this.sinkSign = Math.random() < 0.5 ? -1 : 1;
    this.listSide = this.sinkSign;
    const cal = spec.main ? (spec.main.ap ?? spec.main.he!).caliber : 100;
    this.recoilScale = Math.min(1, cal / 300);
    const hull = this.mesh(geo.hull, shadows);
    this.hullMesh = hull;
    this.hullGeo = geo.hull;
    const accent = (spec.skills.find((k) => k.ult) ?? spec.skills[0])?.accent ?? 0xffd36b;
    this.aura = new Mesh(geo.hull, auraMaterial(accent, 0.05, 0, FrontSide));
    this.aura.scale.set(1.02, 1.12, 1.25);
    this.aura.visible = false;
    this.body.add(this.aura);
    if (spec.model.formAura !== undefined) {
      this.formShell = new Mesh(geo.hull, auraMaterial(spec.model.formAura, 0.12, 0, FrontSide));
      this.formShell.scale.set(1.05, 1.3, 1.5);
      this.body.add(this.formShell);
    }
    const zone = spec.skills.find((k) => k.zone);
    if (zone) {
      domeGeo ??= new SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      this.dome = new Mesh(domeGeo, auraMaterial(zone.accent, 0.02, 1, DoubleSide));
      this.dome.visible = false;
    }
    this.body.add(hull);
    if(spec.id==='architect'||spec.id==='architectPlatform'){this.architectModel=new ArchitectModel((g,m)=>this.mesh(g,shadows,m),spec);this.body.add(this.architectModel.root);}
    if(spec.id==='stepper'){this.stepModel=new StepperModel((g,m)=>this.mesh(g,shadows,m));this.body.add(this.stepModel.root);}
    if (spec.id === 'tungsten') {
      this.tungstenModel = new TungstenModel((g, m) => this.mesh(g, shadows, m), spec);
      this.body.add(this.tungstenModel.root);
    }

    const top = spec.sub ? null : mastTop(spec);
    if (top) {
      radarGeo ??= radarGeometry();
      this.radar = new Group();
      this.radar.position.set(top.x, top.y, 0);
      this.mastY = top.y;
      this.mastDeck = deckHeight(spec, top.x) + 1;
      this.radar.rotation.y = Math.random() * Math.PI * 2;
      this.radar.add(this.mesh(radarGeo, false));
      this.body.add(this.radar);
      // The pennant streams aft from just below the radar.
      this.pennantLen = clamp(spec.length * 0.045, 5, 11);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array((PENNANT_SEG + 1) * 6), 3));
      const idx: number[] = [];
      for (let i = 0; i < PENNANT_SEG; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      geo.setIndex(idx);
      this.pennant = new Mesh(geo, pennantMaterials.ally);
      this.pennant.position.set(top.x - 0.3, top.y - 0.4, 0);
      this.pennant.frustumCulled = false;
      this.body.add(this.pennant);
      this.wave(0);
    }

    spec.main?.turrets.forEach((t, i) => {
      const tg = spec.id==='architect'||spec.id==='architectPlatform'?elementalTurretGeometry(ELEMENTS[i%5]):geo.turrets[i];
      const yaw = new Group();
      if(spec.id==='stepper') yaw.name=`stepper-turret-${i}`;
      if(spec.id==='architect') yaw.name=`architect-turret-${i}`;
      yaw.position.set(t.x, deckHeight(spec, t.x) + t.y, t.z ?? 0);
      if(spec.id==='architect'||spec.id==='architectPlatform')yaw.position.y+=12;
      yaw.rotation.y = -t.facing * DEG;
      yaw.add(this.mesh(tg.house, shadows));
      const pitch = new Group();
      pitch.position.set(tg.pivotX, tg.pivotY, 0);
      const slide = new Group();
      slide.add(this.mesh(tg.guns, shadows));
      pitch.add(slide);
      yaw.add(pitch);
      if(spec.id==='architect'||spec.id==='architectPlatform')yaw.add(this.mesh(elementalTurretGeometry(ELEMENTS[i%5]).glow,false,architectGlowMaterial));
      this.body.add(yaw);
      this.turrets.push({ yaw, pitch, slide });
    });

    for (const sg of spec.secondaries ?? []) {
      const tg = geo.secs.get(sg.name)!;
      for (let i = 0; i < sg.perSide; i++) {
        const f = sg.perSide === 1 ? 0.5 : i / (sg.perSide - 1);
        const x = sg.span[0] + (sg.span[1] - sg.span[0]) * f;
        for (const side of [1, -1]) {
          const z = side * hullHalfWidth(spec, x) * 0.8;
          const obj = new Group();
          obj.position.set(x, spec.freeboard + sg.y - 0.3, z);
          obj.rotation.y = -side * 90 * DEG;
          obj.add(this.mesh(tg.house, false));
          const g = this.mesh(tg.guns, false);
          g.position.set(tg.pivotX, tg.pivotY, 0);
          g.rotation.z = 0.08;
          obj.add(g);
          this.body.add(obj);
          this.secs.push({ obj, side, x, z });
        }
      }
    }

    // Strips (narrow emitters) run along both sides of the superstructure; wide ones sit on the centreline.
    for (const e of spec.model.emitters ?? []) {
      const strip = e.w <= 4;
      const h = strip ? 1.6 : e.w > 16 ? 1 : e.w * 0.5;
      const color = new Color(e.color);
      for (const side of strip ? [1, -1] : [0]) {
        const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false });
        const mesh = new Mesh(new BoxGeometry(e.len, h, e.w), mat);
        mesh.position.set(e.x, deckHeight(spec, e.x) + e.y - h / 2, side * hullHalfWidth(spec, e.x) * 0.6);
        this.body.add(mesh);
        this.emitters.push({ mesh, color });
      }
    }

    // Crystal spires and rune bands glow like emitters.
    for (const sp of spec.model.spires ?? []) {
      const color = new Color(sp.color);
      const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false });
      const mesh = new Mesh<BufferGeometry, MeshBasicMaterial>(new OctahedronGeometry(1, 0), mat);
      mesh.scale.set(sp.r, sp.h / 2, sp.r);
      mesh.position.set(sp.x, deckHeight(spec, sp.x) + blockTopAt(spec, sp.x) + sp.h / 2, sp.z ?? 0);
      this.body.add(mesh);
      this.emitters.push({ mesh, color });
    }
    if (spec.model.runeBand !== undefined && spec.cls !== 'SS') {
      const color = new Color(spec.model.runeBand);
      const band = new Parts();
      const n = Math.round(clamp(spec.length / 8, 10, 40));
      for (let i = 0; i < n; i++) {
        // Runes: short dashes with gaps, riding the hull side.
        const x = -spec.length * 0.42 + (spec.length * 0.84 * (i + 0.5)) / n;
        const seg = (spec.length * 0.84) / n;
        for (const sz of [-1, 1]) band.box(seg * (i % 3 === 0 ? 0.35 : 0.7), 0.5, 0.1, x, spec.freeboard * 0.5, sz * (hullHalfWidth(spec, x) + 0.06), 0xffffff);
      }
      const mesh = new Mesh<BufferGeometry, MeshBasicMaterial>(band.merge(), new MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false }));
      this.body.add(mesh);
      this.emitters.push({ mesh, color });
    }
    // Sci-fi light line: one unbroken strip a little below the deck edge, following the hull's curve.
    if (spec.model.lightStrip !== undefined && spec.cls !== 'SS') {
      const color = new Color(spec.model.lightStrip);
      const strip = new Parts();
      const n = Math.round(clamp(spec.length / 10, 12, 40));
      const seg = (spec.length * 0.86) / n;
      for (let i = 0; i < n; i++) {
        const x = -spec.length * 0.43 + seg * (i + 0.5);
        for (const sz of [-1, 1]) strip.box(seg * 1.02, 0.35, 0.1, x, spec.freeboard * 0.72, sz * (hullHalfWidth(spec, x) + 0.06), 0xffffff);
      }
      const mesh = new Mesh<BufferGeometry, MeshBasicMaterial>(strip.merge(), new MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false }));
      this.body.add(mesh);
      this.emitters.push({ mesh, color });
    }

    // The volcano's crater: a pool of glowing lava in the mouth of the cone.
    const vol = spec.model.volcano;
    if (vol) {
      const color = new Color(vol.glow);
      const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false });
      const mesh = new Mesh<BufferGeometry, MeshBasicMaterial>(new CylinderGeometry(vol.r * 0.28, vol.r * 0.28, 0.6, 14), mat);
      mesh.position.set(vol.x, deckHeight(spec, vol.x) + blockTopAt(spec, vol.x) + vol.h - 0.1, 0);
      this.body.add(mesh);
      this.emitters.push({ mesh, color });
    }
    // The orrery: a sun on the column and the planets wheeling round it.
    const orbs = spec.model.orbs;
    if (orbs) {
      const y = deckHeight(spec, orbs.x) + blockTopAt(spec, orbs.x) - 0.2 + orbs.y;
      const ring = new Group();
      ring.position.set(orbs.x, y, 0);
      for (let i = 0; i <= orbs.count; i++) {
        const sun = i === orbs.count;
        const color = new Color(sun ? 0xffd060 : orbs.color);
        const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false });
        const r = sun ? orbs.size * 1.6 : orbs.size * (0.6 + 0.2 * (i % 3));
        const mesh = new Mesh<BufferGeometry, MeshBasicMaterial>(new SphereGeometry(r, 12, 8), mat);
        const a = (i / orbs.count) * Math.PI * 2;
        const d = sun ? 0 : i % 2 ? orbs.r : orbs.r * 0.6;
        mesh.position.set(Math.cos(a) * d, sun ? 0 : Math.sin(a) * d * (i % 2 ? 0 : 0.25), Math.sin(a) * d);
        ring.add(mesh);
        this.emitters.push({ mesh, color });
      }
      this.body.add(ring);
      this.orrery = ring;
    }

    if (geo.launcher && spec.torpedoes) {
      for (const l of spec.torpedoes.launchers) {
        const obj = new Group();
        const side = l.side === 1 ? 1 : l.side === -1 ? -1 : 0;
        obj.position.set(l.x, deckHeight(spec, l.x), side * spec.beam * 0.3);
        obj.rotation.y = side ? -side * 90 * DEG : 0;
        obj.add(this.mesh(geo.launcher, false));
        this.body.add(obj);
        this.launchers.push(obj);
      }
    }
  }

  private mesh(g: BufferGeometry, shadows: boolean, mat: Material = this.material): Mesh {
    const m = new Mesh(g, mat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    this.meshes.push(m);
    this.home.set(m, mat);
    return m;
  }

  /**
   * A shell or torpedo struck at world point (x, y, z): burn a hole of `radius` metres there.
   * Torpedo holes also set the side the ship lists to.
   */
  scar(x: number, y: number, z: number, radius: number, torpedo = false): void {
    const v = tmpScar.set(x, y, z);
    this.body.updateWorldMatrix(true, false);
    this.body.worldToLocal(v);
    this.damage.uScars.value[this.scarNext].set(v.x, v.y, v.z, radius);
    this.damage.uHeat.value[this.scarNext] = 1;
    this.scarNext = (this.scarNext + 1) % MAX_SCARS;
    if (torpedo) this.listSide = v.z >= 0 ? 1 : -1;
  }

  /** The magazines went up: break the hull in two at midships. */
  detonate(): void {
    if (this.split) return;
    const cut = 0;
    const [bowGeo, sternGeo] = splitHull(this.hullGeo, cut);
    const stern = new Group();
    this.root.add(stern);
    const sternU: DamageUniforms = { ...this.damage, uBodyInv: { value: new Matrix4() } };
    const sternMat = hullMaterial(sternU);
    // Open hull: the far plating shows through the break.
    sternMat.side = DoubleSide;
    this.material.side = DoubleSide;
    this.material.needsUpdate = true;
    this.hullMesh.geometry = bowGeo;
    const sternHull = this.mesh(sternGeo, this.hullMesh.castShadow, sternMat);
    stern.add(sternHull);
    const moved: Object3D[] = [];
    for (const c of [...this.body.children]) {
      if (c === this.hullMesh || c === this.aura || c === this.formShell || c.position.x >= cut) continue;
      stern.add(c);
      moved.push(c);
      c.traverse((o) => {
        if (o instanceof Mesh && this.home.get(o) === this.material) {
          this.home.set(o, sternMat);
          if (o.material === this.material) o.material = sternMat;
        }
      });
    }
    this.aura.visible = false;
    if (this.formShell) this.formShell.visible = false;
    for (const e of this.emitters) e.mesh.visible = false;
    this.split = { stern, sternHull, sternMat, sternU, moved };
  }

  /** A fresh hull (Domination respawn): mend the break, the holes and the mast. */
  private refit(): void {
    const sp = this.split;
    if (sp) {
      for (const c of sp.moved) {
        this.body.add(c);
        c.traverse((o) => {
          if (o instanceof Mesh && this.home.get(o) === sp.sternMat) {
            this.home.set(o, this.material);
            if (o.material === sp.sternMat) o.material = this.material;
          }
        });
      }
      this.root.remove(sp.stern);
      this.meshes = this.meshes.filter((m) => m !== sp.sternHull);
      sp.sternMat.dispose();
      this.hullMesh.geometry = this.hullGeo;
      this.body.position.set(0, 0, 0);
      this.body.rotation.set(0, 0, 0);
      this.material.side = FrontSide;
      this.material.needsUpdate = true;
      for (const e of this.emitters) e.mesh.visible = this.mode === 'normal';
      this.split = null;
    }
    for (const v of this.damage.uScars.value) v.set(0, 0, 0, 0);
    this.damage.uHeat.value.fill(0);
    this.damage.uSoot.value = 0;
    this.list = 0;
    this.mastFall = 0;
    if (this.radar) {
      this.radar.position.y = this.mastY;
      this.radar.rotation.x = 0;
    }
    if (this.pennant) this.pennant.visible = this.mode === 'normal';
  }

  /**
   * A copy of this view as it stands, for a wreck left behind by a respawn. Its hull materials
   * are frozen copies, so mending this view does not mend the wreck; call `update` after moving it.
   */
  wreck(): { obj: Object3D; update: () => void; dispose: () => void } {
    const obj = this.root.clone();
    obj.visible = true;
    const pairs: { u: DamageUniforms; body: Object3D; m: MeshStandardMaterial }[] = [];
    const freeze = (src: DamageUniforms, mat: MeshStandardMaterial, body: Object3D) => {
      const u = damageUniforms();
      u.uSoot.value = src.uSoot.value;
      u.uScars.value.forEach((v, i) => v.copy(src.uScars.value[i]));
      u.uHeat.value = src.uHeat.value.slice();
      const m = hullMaterial(u);
      m.side = mat.side;
      body.traverse((o) => {
        if (o instanceof Mesh && o.material === mat) o.material = m;
      });
      pairs.push({ u, body, m });
    };
    freeze(this.damage, this.material, obj.children[this.root.children.indexOf(this.body)]);
    const sp = this.split;
    if (sp) freeze(sp.sternU, sp.sternMat, obj.children[this.root.children.indexOf(sp.stern)]);
    return {
      obj,
      update: () => {
        obj.updateMatrixWorld(true);
        for (const p of pairs) p.u.uBodyInv.value.copy(p.body.matrixWorld).invert();
      },
      dispose: () => {
        for (const p of pairs) p.m.dispose();
      },
    };
  }

  /** Colour the pennant for whoever is watching. */
  side(ally: boolean): void {
    if (this.pennant) this.pennant.material = ally ? pennantMaterials.ally : pennantMaterials.enemy;
  }

  /** Ripple the pennant: a tapering strip whose tail swings more than its hoist. */
  private wave(time: number): void {
    const pos = this.pennant!.geometry.attributes.position as BufferAttribute;
    const len = this.pennantLen;
    for (let i = 0; i <= PENNANT_SEG; i++) {
      const f = i / PENNANT_SEG;
      const x = -len * f;
      const z = Math.sin(f * 4 - time * 7 + this.pennantPhase) * len * 0.07 * f;
      const sag = -f * f * len * 0.06;
      const half = 0.7 * (1 - f * 0.85);
      pos.setXYZ(i * 2, x, sag + half, z);
      pos.setXYZ(i * 2 + 1, x, sag - half, z);
    }
    pos.needsUpdate = true;
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.visible = mode !== 'hidden';
    if (this.pennant) this.pennant.visible = mode === 'normal' && this.mastFall < 0.15;
    for (const e of this.emitters) e.mesh.visible = mode === 'normal' && !this.split;
    const ghost: Material | null = mode === 'ally' ? ghostMaterials.ally : mode === 'enemy' ? ghostMaterials.enemy : mode === 'nearbySub' ? ghostMaterials.nearbySub : mode === 'cloak' ? cloakMaterial : null;
    for (const m of this.meshes) {
      m.material = ghost ?? this.home.get(m) ?? this.material;
      m.renderOrder = mode === 'normal' ? 0 : 10;
    }
  }

  /**
   * A turret fired toward `rel` (radians from the bow). The hull heels away from the shot and
   * the bow lifts a little when firing forward; heavier guns on lighter hulls move it more.
   */
  recoil(rel: number, caliber: number): void {
    const c = caliber / 1000;
    const k = (c * c * 0.2) / Math.sqrt(this.spec.length / 100);
    this.heelV -= Math.sin(rel) * k;
    this.trimV += Math.cos(rel) * k * 0.25;
  }

  /** A zone skill's dome is showing (per viewport). */
  get glowing(): boolean {
    return this.domeK > 0.01;
  }

  /** Static pose for menus / previews. */
  pose(time: number): void {
    this.architectModel?.pose(time);
    this.stepModel?.pose(time);
    this.tungstenModel?.pose(time);
    this.root.position.y = waveHeight(0, 0, time) * 0.3;
    this.root.rotation.z = Math.sin(time * 0.6) * 0.01;
    this.root.rotation.x = Math.sin(time * 0.45) * 0.015;
    if (this.radar) this.radar.rotation.y = time * 1.6;
    if (this.pennant) this.wave(time);
    if (this.formShell) this.formShell.material.uniforms.uAlpha.value = 0.32 + 0.12 * Math.sin(time * 3.2);
  }

  update(ship: Ship, time: number): void {
    this.architectModel?.pose(time,ship);
    this.stepModel?.pose(time,ship,this.stepFold);
    this.tungstenModel?.pose(time, ship);
    if(this.stepModel) {
      this.material.transparent=!!ship.stepper?.copy;
      this.material.opacity=ship.stepper?.copy?0.48:1;
      if(ship.stepper?.copy)for(const m of this.meshes)m.castShadow=false;
    }
    const spec = this.spec;
    const L = spec.length;
    const h = ship.renderHeading + this.stepYaw;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const px = ship.renderPos.x;
    const pz = ship.renderPos.z;
    const resp = clamp(95 / L, 0.22, 1);
    let y = ship.renderPos.y;
    let pitch = 0;
    let roll = 0;
    if (y > -2) {
      const hb = waveHeight(px + fx * L * 0.4, pz + fz * L * 0.4, time);
      const hs = waveHeight(px - fx * L * 0.4, pz - fz * L * 0.4, time);
      const hp = waveHeight(px + fz * spec.beam, pz - fx * spec.beam, time);
      const hst = waveHeight(px - fz * spec.beam, pz + fx * spec.beam, time);
      y += ((hb + hs + hp + hst) / 4) * (0.4 + resp * 0.6);
      pitch = Math.atan2(hb - hs, L * 0.8) * (0.5 + resp * 0.5);
      roll = Math.atan2(hp - hst, spec.beam * 2) * 0.35 * resp;
    }
    roll += -clamp(ship.turnRate * ship.speed * 0.012, -0.07, 0.07);
    // Recoil spring (about a 3 s roll period, lightly damped).
    const dt = this.lastTime < 0 ? 0 : clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;
    this.heelV += (-4.8 * this.heel - 1.5 * this.heelV) * dt;
    this.heel += this.heelV * dt;
    this.trimV += (-9 * this.trim - 2.4 * this.trimV) * dt;
    this.trim += this.trimV * dt;
    roll += this.heel;
    pitch += this.trim;

    // Battle damage: soot spreads with lost hit points, fresh holes cool, the hull lists.
    if (ship.alive && !this.wasAlive) this.refit();
    this.wasAlive = ship.alive;
    const lost = 1 - ship.hp / ship.maxHp;
    const u = this.damage;
    u.uSoot.value = ship.alive ? lost * 0.8 : Math.min(1, 0.8 + ship.deathTime * 0.03);
    for (let i = 0; i < MAX_SCARS; i++) u.uHeat.value[i] = Math.max(0, u.uHeat.value[i] - dt / SCAR_HEAT);
    if (ship.alive) {
      const max = spec.cls === 'DD' ? MAX_LIST_DD : MAX_LIST;
      const goal = max * clamp(lost * 0.8 + (ship.flooding > 0 ? 0.35 : 0), 0, 1) * this.listSide;
      this.list += (goal - this.list) * Math.min(1, dt * 0.6);
    }
    roll += this.list;
    if (this.radar && (!ship.alive || ship.hp < ship.maxHp * MAST_FALL_HP)) this.mastFall = Math.min(1, this.mastFall + dt);

    // Skill aura fades in and out and breathes while active, tinted by the newest running skill.
    let active: SkillSpec | null = null;
    let zone: SkillSpec | null = null;
    if (ship.alive && this.mode === 'normal') {
      for (const st of ship.skills) {
        if (!st.active) continue;
        active = st.spec;
        if (st.spec.zone) zone = st.spec;
      }
    }
    if (active) this.aura.material.uniforms.uColor.value.setHex(active.accent);
    this.auraK = clamp(this.auraK + (active ? dt * 3 : -dt * 2), 0, 1);
    this.aura.visible = this.auraK > 0.01;
    this.aura.material.uniforms.uAlpha.value = this.auraK * (0.45 + 0.2 * Math.sin(time * 5)) * (ship.spec.cls === 'TT' ? 0.6 : 1);
    if (this.formShell) {
      this.formShell.visible = ship.alive && this.mode === 'normal' && !this.split;
      this.formShell.material.uniforms.uAlpha.value = 0.32 + 0.12 * Math.sin(time * 3.2);
    }
    if (this.dome) {
      this.domeK = clamp(this.domeK + (zone ? dt * 3 : -dt * 2), 0, 1);
      if (zone) {
        this.dome.scale.setScalar(zone.zone!);
        this.dome.material.uniforms.uColor.value.setHex(zone.accent);
      }
      this.dome.position.set(ship.renderPos.x, 0, ship.renderPos.z);
      this.dome.material.uniforms.uAlpha.value = this.domeK * 0.14;
    }
    if (this.emitters.length) {
      // Emitters breathe; they flare while a skill runs and die with the ship.
      const k = ship.alive ? (active ? 4.5 : 2.2) + Math.sin(time * 3.2) * 0.6 : Math.max(0, 1.5 - ship.deathTime * 0.2);
      for (const e of this.emitters) e.mesh.material.color.copy(e.color).multiplyScalar(k);
    }
    pitch += clamp(ship.speed * 0.0006, -0.01, 0.02);
    // Hull Dash: bow up on the lift, bow down into the landing, banked while it swings onto the dash line.
    const drive = ship.architect?.drive;
    if (drive && ship.alive) {
      const f = clamp(drive.elapsed / DASH_TIME, 0, 1);
      pitch += 0.09 * Math.sin(f * Math.PI * 2);
      roll -= clamp(wrapAngle(Math.atan2(drive.dx, -drive.dz) - drive.from), -1, 1) * 0.22 * Math.sin(Math.min(1, f * 2) * Math.PI);
    }
    if (this.radar && ship.alive && this.mastFall <= 0) this.radar.rotation.y += dt * 1.6;
    if (this.orrery && ship.alive) this.orrery.rotation.y += dt * (active ? 1.2 : 0.3);
    if (this.radar && this.mastFall > 0) {
      // The mast top is shot away and topples onto the deck.
      const f = this.mastFall * this.mastFall;
      this.radar.rotation.x = f * 1.45 * this.listSide;
      this.radar.position.y = this.mastY - f * (this.mastY - this.mastDeck) * 0.7;
      if (this.pennant && this.mastFall > 0.15) this.pennant.visible = false;
    }
    if (this.mode === 'cloak') cloakMaterial.opacity = 0.28 + 0.14 * Math.sin(time * 9 + Math.sin(time * 2.3) * 2);
    if (this.pennant && this.root.visible) this.wave(time);
    if (!ship.alive) {
      const t = ship.deathTime;
      if(ship.architectPlatform){
        // A destroyed platform tumbles into the sea and goes under; a hovering one drops out of the air first.
        // Withdrawal belongs to docking/refit and simply vanishes.
        const h=Math.max(0,ship.renderPos.y),land=platformSunkAfter(ship)-PLATFORM_SINK,f=Math.min(1,t/2.2),under=Math.max(0,t-land);
        y=h-Math.min(h,PLATFORM_FALL*t*t)-Math.min(30,under*under*12);roll+=f*1.8;pitch+=f*.65;
        this.root.visible=!ship.withdrawn&&t<platformSunkAfter(ship);
      }
      else if(ship.architectDrone){const f=Math.min(1,t/2.2);y=ship.renderPos.y*(1-f)-Math.min(30,t*t*12);roll+=f*1.8;pitch+=f*.65;this.root.visible=t<3;}
      else if (ship.withdrawn) {
        y -= t * t * 0.4;
      } else if (this.split) {
        // Broken in two: both halves hinge up about the keel at the break and go down fast.
        y -= Math.pow(Math.min(1, t / 26), 1.4) * (spec.freeboard + spec.draft + 40) + Math.max(0, t - 20) * 4;
        this.breakPose(t);
      } else {
        const k = Math.min(1, t / 38);
        y -= Math.pow(k, 1.6) * (spec.freeboard + spec.draft + 30);
        roll += this.sinkSign * Math.min(0.7, t * 0.03);
        pitch += this.sinkSign * Math.min(0.22, t * 0.008);
      }
    }
    if(ship.architectPlatform&&ship.alive)this.root.scale.setScalar(1);
    this.root.position.set(px, y, pz);
    this.root.rotation.set(roll, Math.PI / 2 - h, pitch);

    ship.turrets.forEach((t, i) => {
      const v = this.turrets[i];
      if (!v) return;
      if(ship.architectDrone)this.root.scale.setScalar(.45);
      if(ship.architectPlatform)v.yaw.visible=true;
      if(ship.architect)v.yaw.visible=ship.architect.slots[i].state==='docked';
      const moduleSlot=ship.architect?.slots[i]??(ship.architectPlatform?ship.architectPlatform.owner.architect?.slots[ship.architectPlatform.index]:undefined);
      if(moduleSlot){const geo=elementalTurretGeometry(moduleSlot.type);(v.yaw.children[0] as Mesh).geometry=geo.house;(v.slide.children[0] as Mesh).geometry=geo.guns;(v.yaw.children[2] as Mesh).geometry=geo.glow;
        // Physical focusing hardware breathes as its selected ability approaches readiness.
        const charge=1-Math.min(1,moduleSlot.skillTimer/4);v.slide.scale.set(1,1+charge*.06,1+charge*.1);
      }
      v.yaw.rotation.y = -(t.spec.facing + t.yaw) * DEG;
      // Knocked out (or dead): the barrels sag.
      if (t.disabled > 0 || !ship.alive) v.pitch.rotation.z += (DROOP - v.pitch.rotation.z) * Math.min(1, dt * 4);
      else v.pitch.rotation.z = t.pitch * 1.1;
      const back = t.recoil > 0.5 ? (0.6 - t.recoil) * 12 : Math.max(0, t.recoil) * 2.4;
      v.slide.position.x = -back * this.recoilScale;
    });

    const tgt = ship.secTarget;
    for (const s of this.secs) {
      let goal = s.side * 90 * DEG;
      if (tgt && tgt.alive) {
        const wx = px + fx * s.x - fz * s.z;
        const wz = pz + fz * s.x + fx * s.z;
        const rel = wrapAngle(Math.atan2(tgt.pos.x - wx, -(tgt.pos.z - wz)) - h);
        if (Math.sign(rel) === s.side && Math.abs(rel) > 15 * DEG && Math.abs(rel) < 165 * DEG) goal = rel;
      }
      s.obj.rotation.y += (-goal - s.obj.rotation.y) * 0.08;
    }

    ship.launchers.forEach((l, i) => {
      const obj = this.launchers[i];
      if (!obj || l.spec.side !== 0) return;
      const rel = wrapAngle(l.yaw - h);
      const a = Math.abs(rel);
      const goal = a >= 25 * DEG && a <= 155 * DEG ? rel : 0;
      obj.rotation.y += (-goal - obj.rotation.y) * 0.05;
    });

    // World to hull space for the damage shader (the root moved this frame).
    this.root.updateMatrixWorld(true);
    u.uBodyInv.value.copy(this.body.matrixWorld).invert();
    if (this.split) this.split.sternU.uBodyInv.value.copy(this.split.stern.matrixWorld).invert();
  }

  /** Pose the two halves of a broken hull `t` seconds after the detonation. */
  private breakPose(t: number): void {
    const sp = this.split!;
    const spec = this.spec;
    const px = 0;
    const py = -spec.draft * 0.6;
    const hinge = (g: Object3D, a: number, d: number) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.rotation.z = a;
      g.position.set(px - (px * c - py * s) + d, py - (px * s + py * c), 0);
    };
    const k = 1 - Math.exp(-t * 0.25);
    hinge(this.body, 0.42 * k, Math.min(spec.length * 0.06, t * 2));
    hinge(sp.stern, -0.34 * k, -Math.min(spec.length * 0.05, t * 1.6));
    sp.stern.rotation.x = this.sinkSign * 0.45 * k;
  }

  /** Free what this view owns (hull and turret geometry is shared and cached). */
  dispose(): void {
    this.architectModel?.dispose();
    this.stepModel?.dispose();
    this.tungstenModel?.dispose();
    this.aura.material.dispose();
    this.formShell?.material.dispose();
    this.material.dispose();
    this.split?.sternMat.dispose();
    for (const e of this.emitters) {
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
    }
    this.dome?.material.dispose();
    this.pennant?.geometry.dispose();
  }
}
