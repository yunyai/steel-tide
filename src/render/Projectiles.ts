import { ELEMENT_STYLE } from '../skills/misc/ArchitectElements';
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHELL_TIME_SCALE, SIM_DT } from '../config';
import type { Game } from '../core/Game';
import type { PlaneLook, Team } from '../core/types';
import { waveHeight } from '../world/Waves';
import { GUN_STYLE, MISSILE_GLOW, TORP_WAKE } from './Looks';
import { flyerGeometry, shipMaterial } from './ShipModel';

// Shell tracers and torpedo wakes as screen-width-clamped ribbons, plus
// instanced aircraft and cruise missiles.

const ribbonVert = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColor;
attribute vec2 iW;
uniform float uViewportH;
varying float vAcross;
varying float vAlong;
varying vec4 vColor;
varying float vDist;
void main() {
  vec4 a = viewMatrix * vec4(iA, 1.0);
  vec4 b = viewMatrix * vec4(iB, 1.0);
  float along = position.x + 0.5;
  vec4 mv = mix(a, b, along);
  vec3 t = b.xyz - a.xyz;
  if (dot(t, t) < 1e-6) t = vec3(1.0, 0.0, 0.0);
  vec3 side = normalize(cross(normalize(t), normalize(mv.xyz)));
  float dist = max(1.0, -mv.z);
  float pix = 2.0 * dist / (projectionMatrix[1][1] * uViewportH);
  float w = max(iW.x, iW.y * pix);
  mv.xyz += side * w * position.y * 2.0;
  gl_Position = projectionMatrix * mv;
  vAcross = position.y * 2.0;
  vAlong = along;
  vColor = iColor;
  vDist = dist;
}
`;

const ribbonFrag = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vAcross;
varying float vAlong;
varying vec4 vColor;
varying float vDist;
void main() {
  // Interpolation can put an edge fractionally beyond 1. A negative fractional
  // power becomes NaN, which bloom spreads across the entire frame.
  float a = pow(max(0.0, 1.0 - abs(vAcross)), 1.5) * vColor.a;
#ifdef TAPER
  a *= mix(0.05, 1.0, vAlong * vAlong);
#endif
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
#ifdef ADDITIVE
  gl_FragColor = vec4(vColor.rgb * (1.0 - fog * 0.8), a);
#else
  gl_FragColor = vec4(mix(vColor.rgb, uFogColor, fog), a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Ribbons {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  count = 0;
  private geo: InstancedBufferGeometry;
  private a: InstancedBufferAttribute;
  private b: InstancedBufferAttribute;
  private c: InstancedBufferAttribute;
  private w: InstancedBufferAttribute;

  /** Tapered ribbons fade toward their start point, like a tracer's tail; untapered ones are even. */
  constructor(
    readonly max: number,
    additive: boolean,
    taper = true,
  ) {
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.a = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.b = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.c = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.w = new InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iA', this.a);
    this.geo.setAttribute('iB', this.b);
    this.geo.setAttribute('iColor', this.c);
    this.geo.setAttribute('iW', this.w);
    this.material = new ShaderMaterial({
      vertexShader: ribbonVert,
      fragmentShader: ribbonFrag,
      defines: { ...(additive ? { ADDITIVE: '' } : {}), ...(taper ? { TAPER: '' } : {}) },
      uniforms: { uViewportH: { value: 1000 }, uFogColor: { value: new Color() }, uFogDensity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 7 : 2;
  }

  begin(): void {
    this.count = 0;
  }

  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Color, alpha: number, width: number, minPx: number): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.c.array as Float32Array;
    const W = this.w.array as Float32Array;
    A[i * 3] = ax;
    A[i * 3 + 1] = ay;
    A[i * 3 + 2] = az;
    B[i * 3] = bx;
    B[i * 3 + 1] = by;
    B[i * 3 + 2] = bz;
    C[i * 4] = color.r;
    C[i * 4 + 1] = color.g;
    C[i * 4 + 2] = color.b;
    C[i * 4 + 3] = alpha;
    W[i * 2] = width;
    W[i * 2 + 1] = minPx;
  }

  end(): void {
    const n = this.count;
    this.geo.instanceCount = n;
    if (!n) return;
    for (const [attr, size] of [
      [this.a, 3],
      [this.b, 3],
      [this.c, 4],
      [this.w, 2],
    ] as const) {
      attr.addUpdateRange(0, n * size);
      attr.needsUpdate = true;
    }
  }

  setFog(color: Color, density: number): void {
    this.material.uniforms.uFogColor.value.copy(color);
    this.material.uniforms.uFogDensity.value = density;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

const AP_COL = new Color(0xd8ecff).multiplyScalar(2.2);
const HE_COL = new Color(0xffa040).multiplyScalar(2.4);
const RAIL_COL = new Color(0x60e8ff).multiplyScalar(3);
const SEC_COL = new Color(0xffc070).multiplyScalar(1.4);
const WAKE_ALLY = new Color(0xffffff);
const WAKE_ENEMY = new Color(0xffc2b8);

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler(0, 0, 0, 'YZX');
const v = new Vector3();
const one = new Vector3(1, 1, 1);
const PLANE_LOOKS: PlaneLook[] = ['plane', 'griffon', 'gyro', 'bat', 'dragon', 'jet', 'heli', 'drone', 'petal'];

export class Projectiles {
  readonly tracers = new Ribbons(3000, true);
  readonly wakes = new Ribbons(600, false);
  /** Every look of aircraft, one mesh per side; `flyers` indexes them by look then team. */
  readonly planes: InstancedMesh[] = [];
  private flyers = new Map<PlaneLook, InstancedMesh[]>();
  readonly missiles: InstancedMesh;
  private lastY = new Map<number, number>();

  constructor() {
    for (const look of PLANE_LOOKS) {
      const pair = [0x3f5a78, 0x5d6a3e].map((c) => {
        const m = new InstancedMesh(flyerGeometry(look, c), shipMaterial, look === 'plane' ? 240 : 120);
        m.count = 0;
        m.frustumCulled = false;
        return m;
      });
      this.flyers.set(look, pair);
      this.planes.push(...pair);
    }
    const body = new CylinderGeometry(0.28, 0.28, 5.5, 8);
    body.rotateZ(-Math.PI / 2);
    const nose = new ConeGeometry(0.28, 0.8, 8);
    nose.rotateZ(-Math.PI / 2);
    nose.translate(3.1, 0, 0);
    const wing = new CylinderGeometry(0.05, 0.05, 2.6, 4);
    wing.rotateX(Math.PI / 2);
    const merged = mergeGeometries([body.toNonIndexed(), nose.toNonIndexed(), wing.toNonIndexed()].map((g) => {
      g.deleteAttribute('uv');
      return g;
    }))!;
    this.missiles = new InstancedMesh(merged, new MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.5, metalness: 0.6 }), 64);
    this.missiles.count = 0;
    this.missiles.frustumCulled = false;
  }

  /** Shell tracers, aircraft and missiles (shared by all viewports). */
  update(game: Game): void {
    const tr = this.tracers;
    // Shells are drawn where they were between the last two sim steps, matching the interpolated ships.
    const back = (1 - game.alpha) * SIM_DT * SHELL_TIME_SCALE;
    tr.begin();
    for (const s of game.shells.shells) {
      if (!s.alive) continue;
      const x = s.x - s.vx * back;
      const y = s.y - s.vy * back;
      const z = s.z - s.vz * back;
      const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
      const c = s.spec.caliber / 1000;
      const st = GUN_STYLE[s.look];
      const plain = s.look === 'shell';
      const len = s.railgun ? 260 : Math.min(s.travelled + 1, ((s.secondary ? 18 : 25) + c * 80) * st.length);
      const element=s.element?.owner.architect?.slots[s.element.slot]?.element;
      const col = element?new Color(ELEMENT_STYLE[element].color):s.railgun ? RAIL_COL : s.secondary || s.bomb ? SEC_COL : !plain ? st.color : s.ammo === 'AP' ? AP_COL : HE_COL;
      const width = s.railgun ? 2.5 : (0.35 + c * 2.2) * st.width;
      const minPx = s.secondary ? 1.1 : 1.6 + c * 2.5;
      tr.push(x - (s.vx / sp) * len, y - (s.vy / sp) * len, z - (s.vz / sp) * len, x, y, z, col, s.bomb ? 0.6 : 1, width, minPx);
    }

    for (const m of this.planes) m.count = 0;
    for (const sq of game.air.squadrons) {
      if (!sq.alive) continue;
      // A wing still out when its carrier shifted into a form without one keeps the base look.
      const look = (sq.owner.spec.air ?? sq.owner.base.air)?.look ?? 'plane';
      const mesh = this.flyers.get(look)![sq.team];
      // Beasts bank and sway harder than machines.
      const sway = look === 'plane' || look === 'jet' || look === 'drone' ? 0.08 : 0.22;
      const prev = this.lastY.get(sq.id) ?? sq.y;
      const climb = Math.max(-1.2, Math.min(1.2, (sq.y - prev) * 0.25));
      this.lastY.set(sq.id, sq.y);
      const h = sq.heading;
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      for (let i = 0; i < sq.planes; i++) {
        const row = Math.ceil(i / 2);
        const side = i === 0 ? 0 : i % 2 ? -1 : 1;
        const back = row * 20;
        const lat = side * row * 18;
        const bob = Math.sin(game.time * 1.3 + i * 1.7) * 1.5;
        v.set(sq.x - fx * back - fz * lat, sq.y + bob - row * 2, sq.z - fz * back + fx * lat);
        e.set(Math.sin(game.time * 0.9 + i) * sway, Math.PI / 2 - h, climb);
        q.setFromEuler(e);
        m4.compose(v, q, one);
        if (mesh.count >= mesh.instanceMatrix.count) break;
        mesh.setMatrixAt(mesh.count++, m4);
      }
    }
    if (this.lastY.size > 200) this.lastY.clear();
    for (const m of this.planes) m.instanceMatrix.needsUpdate = true;

    let n = 0;
    for (const mi of game.missiles.missiles) {
      if (!mi.alive || mi.delay > 0 || n >= 64) continue;
      const glow = MISSILE_GLOW[mi.look];
      if (glow) {
        // Spell bolts are light, not hardware: a short bright streak along the flight path.
        const fx = Math.sin(mi.heading) * Math.cos(mi.pitch);
        const fz = -Math.cos(mi.heading) * Math.cos(mi.pitch);
        const fy = Math.sin(mi.pitch);
        tr.push(mi.x - fx * 40, mi.y - fy * 40, mi.z - fz * 40, mi.x, mi.y, mi.z, glow, 1, 3, 3);
        continue;
      }
      v.set(mi.x, mi.y, mi.z);
      e.set(0, Math.PI / 2 - mi.heading, mi.pitch);
      q.setFromEuler(e);
      m4.compose(v, q, one);
      this.missiles.setMatrixAt(n++, m4);
    }
    tr.end();
    this.missiles.count = n;
    this.missiles.instanceMatrix.needsUpdate = true;
  }

  /** Torpedo wakes visible to one team (own torps + spotted enemy torps). */
  updateWakes(game: Game, team: Team | -1): void {
    const w = this.wakes;
    w.begin();
    const t = game.time;
    for (const tp of game.torps.torps) {
      if (!tp.alive) continue;
      const own = team === -1 || tp.team === team;
      if (!own && !tp.seen) continue;
      const fx = Math.sin(tp.heading);
      const fz = -Math.cos(tp.heading);
      const len = Math.min(tp.travelled, 110);
      const hx = tp.x;
      const hz = tp.z;
      const tx = hx - fx * len;
      const tz = hz - fz * len;
      const glow = TORP_WAKE[tp.look];
      const col = glow ? glow[own ? 0 : 1] : own ? WAKE_ALLY : WAKE_ENEMY;
      w.push(tx, waveHeight(tx, tz, t) + 0.6, tz, hx, waveHeight(hx, hz, t) + 0.6, hz, col, own ? 0.55 : 0.9, 2.4, own ? 1.2 : 2.2);
    }
    w.end();
  }

  setViewport(heightPx: number): void {
    this.tracers.material.uniforms.uViewportH.value = heightPx;
    this.wakes.material.uniforms.uViewportH.value = heightPx;
  }

  setFog(color: Color, density: number): void {
    this.tracers.setFog(color, density);
    this.wakes.setFog(color, density);
  }

  dispose(): void {
    this.tracers.dispose();
    this.wakes.dispose();
    for (const p of this.planes) p.geometry.dispose();
    this.missiles.geometry.dispose();
    (this.missiles.material as MeshStandardMaterial).dispose();
  }
}
