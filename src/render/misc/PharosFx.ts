import { AdditiveBlending, BufferAttribute, Color, CylinderGeometry, DoubleSide, FogExp2, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, ShaderMaterial, Vector3, type BufferGeometry } from 'three';
import { forwardX, forwardZ } from '../../core/math';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { MiscFxKind } from '../../skills/misc/MiscEvents';
import { beamReach, lampBearing, PHAROS, pharosBeams, type LensBuoy, type LitRecord, type PharosState } from '../../skills/misc/PharosRuntime';
import type { Shell } from '../../weapons/ShellSystem';
import { BK, hash01 } from '../BurstParticles';
import { Parts } from '../Geometry';
import { PHAROS_LAMP } from '../MiscTitanGeometry';
import { bump, clamp01, easeOut, hot, mix, TAU, type MiscFxKit } from './MiscFxKit';
import { MiscShipFx, type MiscBurst } from './MiscShipFx';

const LAMP = 0xffe9a0;
const WARM = 0xffd070;
const WHITE = 0xfff8e8;
const DAY = 0xffffff;
const SCORCH = 0xff9a4a;
const FALSE = 0x8affd0;
const BRASS = 0xc7a252;
const RED = 0xb03a2b;
const IRON = 0x1c2630;
const SEA = 0xf4f8ff;

/** Seconds a thrown buoy takes to land. */
const TOSS = 0.45;
/** How tall a lens buoy floats, metres: far bigger than life, so it reads from a bridge 2 km off. */
const BUOY_HEIGHT = 34;

/** Seconds each Pharos burst plays. */
const LIFE: Partial<Record<MiscFxKind, number>> = {
  gunHit: 1,
  gunLand: 1.1,
  lit: 0.7,
  hold: 0.7,
  lanceAim: 0.1,
  lance: 1.1,
  lanceHit: 0.9,
  counter: 0.8,
  scorch: 0.9,
  dazzle: 0.8,
  dazzled: 1.1,
  buoy: TOSS + 0.5,
  buoyFlare: 1,
  buoyGone: 0.9,
  douse: 0.8,
  relight: 1.2,
  twin: 1,
  daybreakWarn: PHAROS.daybreak.warning,
  daybreak: 1.4,
  sear: 1.1,
  falseLight: 1.1,
  wreck: 2,
};

/** Bursts on the Pharos's own hull, shown only where it may be seen. */
const OWN = new Set<MiscFxKind>(['hold', 'counter', 'dazzle', 'douse', 'twin']);
/** Bursts on a ship the lamp has found, shown only where that ship may be seen. */
const ON_TARGET = new Set<MiscFxKind>(['lit', 'lanceHit', 'scorch', 'dazzled', 'sear']);

const shaftVertex = /* glsl */ `
attribute float aAcross;
varying float vAlong;
varying float vAcross;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;
void main() {
  vAlong = position.x;
  vAcross = aAcross;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalMatrix * normal;
  vView = -mv.xyz;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// A shaft of light: brightest down its middle and soft toward its sides, thinning along its length
// and into fog, and fading right by the eye so a beam sweeping over the camera does not white it out.
const shaftFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFog;
varying float vAlong;
varying float vAcross;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float core = pow(max(0.0, 1.0 - vAcross * vAcross), 0.8);
  float body = mix(0.2, 1.0, core) * mix(0.5, 1.0, facing);
  float fall = mix(1.0, 0.3, smoothstep(0.0, 1.0, vAlong)) * smoothstep(1.0, 0.85, vAlong);
  float fog = exp(-uFog * uFog * vDepth * vDepth);
  float near = smoothstep(40.0, 260.0, vDepth);
  gl_FragColor = vec4(uColor, uAlpha * body * fall * fog * near);
}`;

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** How one Pharos's lamp burns this frame: its colour, how far past white it is driven, its strength and how thick its shafts stand. */
interface Glare {
  color: number;
  gain: number;
  alpha: number;
  thick: number;
}

/**
 * The Pharos's effects. The beams are shafts of light redrawn from the lamp's state every frame,
 * with their footprint on the water; buoys float where they were thrown; the false light stands
 * as a ghost of the tower; and every event the lamp emits plays as a burst.
 */
export class PharosFx extends MiscShipFx {
  readonly look = 'lamp' as const;
  readonly palette = { main: LAMP, hot: WHITE, deep: IRON };
  /** A unit cone along +x from its apex at the origin, shared by every shaft. */
  private cone: BufferGeometry;
  private buoy: { body: BufferGeometry; lens: BufferGeometry };
  private paint = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.4, roughness: 0.6 });
  private lensGlow = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  /** Each shaft's own material, by its node key, so each can take its own colour and strength. */
  private shafts = new Map<string, ShaderMaterial>();
  private basis = new Matrix4();
  private vx = new Vector3();
  private vy = new Vector3();
  private vz = new Vector3();

  constructor(kit: MiscFxKit) {
    super(kit);
    this.cone = new CylinderGeometry(0.004, 1, 1, 24, 8, true).translate(0, -0.5, 0).rotateZ(Math.PI / 2);
    // How far each vertex sits toward the cone's sides, -1 to 1: the shader dims the shaft there.
    const at = this.cone.getAttribute('position');
    const across = new Float32Array(at.count);
    for (let i = 0; i < at.count; i++) across[i] = at.getZ(i) / (Math.hypot(at.getY(i), at.getZ(i)) || 1);
    this.cone.setAttribute('aAcross', new BufferAttribute(across, 1));
    const body = new Parts();
    const s = BUOY_HEIGHT;
    body.cyl(s * 0.2, s * 0.14, s * 0.16, 0, -s * 0.04, 0, RED, { seg: 10 });
    body.cyl(s * 0.21, s * 0.21, s * 0.03, 0, s * 0.1, 0, BRASS, { seg: 10 });
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4 + 0.4;
      body.box(s * 0.025, s * 0.5, s * 0.025, Math.cos(a) * s * 0.11, s * 0.12, Math.sin(a) * s * 0.11, BRASS, { rz: Math.cos(a) * 0.16, rx: -Math.sin(a) * 0.16 });
    }
    body.cyl(s * 0.02, s * 0.1, s * 0.1, 0, s * 0.86, 0, IRON, { seg: 8 });
    const lens = new Parts();
    lens.cyl(s * 0.075, s * 0.075, s * 0.24, 0, s * 0.62, 0, LAMP, { seg: 10 });
    this.buoy = { body: body.merge(), lens: lens.merge() };
  }

  owns(s: Ship): boolean {
    return !!s.pharos;
  }

  protected life(kind: MiscFxKind): number {
    return LIFE[kind] ?? super.life(kind);
  }

  protected arrive(b: MiscBurst): void {
    const { kit } = this;
    const { ship, kind, x, z } = b.e;
    const shake = (k: number) => {
      if (!kit.reduce) kit.onShake?.(ship, x, z, k);
    };
    if (kind === 'wreck') {
      kit.onFlash?.(x, z, 0.7, FALSE);
      shake(0.7);
    } else if (kind === 'daybreak') {
      kit.onFlash?.(x, z, 0.8, DAY);
      shake(0.5);
    } else if (kind === 'lance') {
      kit.onFlash?.(x, z, 0.35, WHITE);
      shake(0.35);
    } else if (kind === 'relight') {
      kit.onFlash?.(x, z, 0.45, LAMP);
      shake(0.25);
    } else if (kind === 'sear') shake(0.3);
    else if (kind === 'dazzle') kit.onFlash?.(x, z, 0.3, WHITE);
  }

  protected shows(b: MiscBurst, team: Team | -1): boolean {
    const { kind, target, ship } = b.e;
    if (kind === 'gunHit' || kind === 'gunLand') return super.shows(b, team);
    if (OWN.has(kind)) return this.kit.visible(ship, team);
    if (ON_TARGET.has(kind)) return !!target && this.kit.visible(target, team);
    return true;
  }

  private lampAt(s: Ship): Point3 {
    return { x: s.renderPos.x, y: s.renderPos.y + s.spec.freeboard + PHAROS_LAMP, z: s.renderPos.z };
  }

  /** How the lamp burns now: warm on its sweep, harder when held, orange while it scorches, white at Daybreak. */
  private glare(a: PharosState, now: number): Glare {
    const { kit } = this;
    const flicker = kit.reduce ? 1 : 0.94 + 0.06 * Math.sin(kit.t * 23);
    if (a.daybreak?.started) return { color: DAY, gain: 3, alpha: 0.6 * flicker, thick: 1.7 };
    if (a.daybreak) {
      const f = clamp01(1 - (a.daybreak.startAt - now) / PHAROS.daybreak.warning);
      return { color: WHITE, gain: 1.6 + f, alpha: (0.3 + 0.3 * f) * (kit.reduce ? 1 : 0.7 + 0.3 * Math.sin(kit.t * (20 + 40 * f))), thick: 1 + 0.5 * f };
    }
    if (a.scorchUntil > now) return { color: SCORCH, gain: 3, alpha: 0.6 * flicker, thick: 1.15 };
    if (a.holdUntil > now) return { color: WHITE, gain: 3, alpha: 0.6 * flicker, thick: 1.1 };
    return { color: LAMP, gain: 2.6, alpha: 0.5 * flicker, thick: 1 };
  }

  // ------------------------------------------------------------------ scene groups

  protected persist(live: Set<string>): void {
    const { kit } = this;
    const now = kit.game.time;
    const fog = kit.scene.fog instanceof FogExp2 ? kit.scene.fog.density : 0;
    const keep = new Set<string>();
    for (const s of kit.game.ships) {
      const a = s.pharos;
      if (!a || !s.alive || s.withdrawn) continue;
      const lamp = this.lampAt(s);
      const glare = this.glare(a, now);
      const turn = lampBearing(s) - a.bearing;
      pharosBeams(s).forEach((beam, i) => {
        const key = `misc-pharos-beam-${s.id}-${i}`;
        live.add(key);
        keep.add(key);
        const g = kit.node(key, () => this.shaft(key));
        const m = this.shafts.get(key);
        if (!g || !m) return;
        const bearing = beam.bearing + turn;
        const len = Math.max(60, beamReach(s, bearing, beam.range));
        const ex = s.renderPos.x + forwardX(bearing) * len;
        const ez = s.renderPos.z + forwardZ(bearing) * len;
        // The shaft runs from the lantern down to the sea at the beam's end, its underside just clear of the water.
        const thick = Math.min(70, 16 + len * 0.014) * glare.thick;
        this.vx.set(ex - lamp.x, thick + 4 - lamp.y, ez - lamp.z);
        const reach = this.vx.length();
        this.vx.multiplyScalar(1 / reach);
        this.vz.set(Math.cos(bearing), 0, Math.sin(bearing));
        this.vy.crossVectors(this.vz, this.vx);
        g.position.set(lamp.x, lamp.y, lamp.z);
        g.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.vx, this.vy, this.vz));
        g.scale.set(reach, thick, Math.max(8, len * Math.tan(beam.half)));
        (m.uniforms.uColor.value as Color).setHex(glare.color).multiplyScalar(glare.gain);
        m.uniforms.uAlpha.value = glare.alpha;
        m.uniforms.uFog.value = fog;
      });
      for (const b of a.buoys) {
        if (now - (b.expiresAt - PHAROS.buoy.life) < TOSS) continue;
        const key = `misc-pharos-buoy-${s.id}-${b.id}`;
        live.add(key);
        const g = kit.node(key, () => this.float());
        if (!g) continue;
        const bob = kit.reduce ? 0 : Math.sin(kit.t * 1.7 + b.id * 2.1);
        g.position.set(b.x, kit.surface(b.x, b.z) + bob * 1.5, b.z);
        g.rotation.set(bob * 0.06, kit.t * 0.4 + b.id, Math.cos(kit.t * 1.3 + b.id) * (kit.reduce ? 0 : 0.05));
      }
    }
    for (const [key, m] of this.shafts)
      if (!keep.has(key)) {
        m.dispose();
        this.shafts.delete(key);
      }
  }

  private shaft(key: string): Group {
    const g = new Group();
    const m = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(LAMP) }, uAlpha: { value: 0 }, uFog: { value: 0 } },
      vertexShader: shaftVertex,
      fragmentShader: shaftFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.shafts.set(key, m);
    const mesh = new Mesh(this.cone, m);
    mesh.frustumCulled = false;
    g.add(mesh);
    return g;
  }

  private float(): Group {
    const g = new Group();
    const body = new Mesh(this.buoy.body, this.paint);
    body.castShadow = true;
    g.add(body, new Mesh(this.buoy.lens, this.lensGlow));
    return g;
  }

  // ------------------------------------------------------------------ persistent cues

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    for (const s of kit.game.ships) {
      const a = s.pharos;
      if (!a || !s.alive || s.withdrawn) continue;
      // Buoys, the lance's line, Daybreak's wind-up and the false light are public hazards.
      for (const b of a.buoys) this.buoyCue(s, b, now);
      if (a.lance) for (const bearing of a.lance.bearings) this.lanceLine(s, bearing, 1 - (a.lance.at - now) / PHAROS.lance.warning);
      if (a.daybreak && !a.daybreak.started) this.dawn(s, 1 - (a.daybreak.startAt - now) / PHAROS.daybreak.warning);
      if (a.beacon) this.beacon(s, a, team, now);
      for (const r of a.lit) {
        const t = kit.game.ships.find((x) => x.id === r.target);
        if (t && kit.visible(t, team)) this.exposure(t, r, now);
      }
      if (!kit.visible(s, team)) continue;
      const lamp = this.lampAt(s);
      const glare = this.glare(a, now);
      const turn = lampBearing(s) - a.bearing;
      const beams = pharosBeams(s);
      beams.forEach((beam, i) => {
        const g = kit.peek(`misc-pharos-beam-${s.id}-${i}`);
        if (g) g.visible = true;
        this.footprint(s, lamp, beam.bearing + turn, beam.half, beam.range, glare);
      });
      // The lantern itself: a hard star while it burns, a dull ember behind the shutters.
      if (beams.length) {
        kit.particles.push(BK.Flare, lamp.x, lamp.y, lamp.z, 150 * glare.thick, hot(glare.color, 2.4), 0.9, kit.t * 0.3, s.id);
        kit.glow(lamp.x, lamp.y, lamp.z, 90 * glare.thick, hot(glare.color, 2), 0.8);
      } else kit.glow(lamp.x, lamp.y, lamp.z, 26, hot(SCORCH, 0.9), 0.35);
    }
  }

  /** The beam's wedge on the water: both edges, the far arc and a wash of light down its length. */
  private footprint(s: Ship, lamp: Point3, bearing: number, half: number, range: number, glare: Glare): void {
    const { kit } = this;
    const len = Math.max(60, beamReach(s, bearing, range));
    const x0 = s.renderPos.x;
    const z0 = s.renderPos.z;
    const y = 3;
    const near = Math.min(len, 160);
    const a = glare.alpha;
    // A hard core down the shaft's axis keeps the beam readable end-on, from the captain's own bridge.
    kit.line(lamp.x, lamp.y, lamp.z, x0 + forwardX(bearing) * len, 8, z0 + forwardZ(bearing) * len, hot(glare.color, glare.gain), a * 0.7, 9 * glare.thick);
    for (const side of [-1, 1]) {
      const fx = forwardX(bearing + side * half);
      const fz = forwardZ(bearing + side * half);
      kit.line(x0 + fx * near, y, z0 + fz * near, x0 + fx * len, y, z0 + fz * len, hot(glare.color, 1.6), a * 0.9, 5);
    }
    const arcs = 8;
    for (let i = 0; i < arcs; i++) {
      const b0 = bearing - half + (2 * half * i) / arcs;
      const b1 = bearing - half + (2 * half * (i + 1)) / arcs;
      kit.line(x0 + forwardX(b0) * len, y, z0 + forwardZ(b0) * len, x0 + forwardX(b1) * len, y, z0 + forwardZ(b1) * len, hot(glare.color, 1.8), a, 6);
    }
    const pools = Math.max(2, Math.round(6 * kit.k));
    for (let i = 1; i <= pools; i++) {
      const d = (len * i) / (pools + 0.4);
      kit.glow(x0 + forwardX(bearing) * d, 8, z0 + forwardZ(bearing) * d, Math.max(40, d * Math.tan(half) * 2.6), hot(glare.color, glare.gain * 0.7), a * 0.5);
    }
  }

  /** Eight ticks round a hull the lamp has found, one lit for each Exposure, and a glint while it is lit. */
  private exposure(t: Ship, r: LitRecord, now: number): void {
    const { kit } = this;
    const lit = r.until > now;
    if (!lit && r.stacks <= 0) return;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const y = kit.surface(x, z) + 3;
    const rad = t.spec.length * 0.62;
    const n = PHAROS.maxExposure;
    const full = r.stacks >= n;
    for (let i = 0; i < n; i++) {
      const on = i < r.stacks;
      if (!on && !lit) continue;
      const a0 = (i * TAU) / n + 0.07 - Math.PI / 2;
      const a1 = ((i + 1) * TAU) / n - 0.07 - Math.PI / 2;
      for (let k = 0; k < 4; k++) {
        const p = a0 + ((a1 - a0) * k) / 4;
        const q = a0 + ((a1 - a0) * (k + 1)) / 4;
        kit.line(x + Math.cos(p) * rad, y, z + Math.sin(p) * rad, x + Math.cos(q) * rad, y, z + Math.sin(q) * rad, on ? hot(full ? WHITE : LAMP, 2) : hot(LAMP, 0.8), on ? 0.85 : 0.16, on ? 5 : 2);
      }
    }
    if (lit) {
      const pulse = kit.reduce ? 1 : 0.8 + 0.2 * Math.sin(kit.t * 9 + t.id);
      kit.particles.push(BK.Flare, x, t.renderPos.y + t.spec.freeboard + 22, z, 70 + 12 * r.stacks, hot(WHITE, 1.8), 0.55 * pulse, 0, t.id);
    }
    if (r.dazzledUntil > now) {
      // Stars round the bridge of a dazzled ship.
      const stars = Math.round(5 * kit.k);
      for (let i = 0; i < stars; i++) {
        const a = kit.t * 2.4 + (i * TAU) / stars;
        kit.particles.push(BK.Flare, x + Math.cos(a) * 60, t.renderPos.y + t.spec.freeboard + 34 + Math.sin(a * 2) * 6, z + Math.sin(a) * 60, 34, hot(DAY, 2.2), 0.8, a, i);
      }
    }
  }

  /** A buoy on the water: its lens, a mast of light to find it by and the reach of its flare. */
  private buoyCue(s: Ship, b: LensBuoy, now: number): void {
    const { kit } = this;
    if (now - (b.expiresAt - PHAROS.buoy.life) < TOSS) return;
    const g = kit.peek(`misc-pharos-buoy-${s.id}-${b.id}`);
    if (g) g.visible = true;
    const y = kit.surface(b.x, b.z);
    const fresh = clamp01(1 - (now - b.flaredAt) / 1.5);
    const dying = clamp01((b.expiresAt - now) / 3);
    kit.glow(b.x, y + BUOY_HEIGHT * 0.74, b.z, 50 + 90 * fresh, mix(LAMP, DAY, fresh, 1.8 + fresh), (0.55 + 0.4 * fresh) * dying);
    kit.line(b.x, y + BUOY_HEIGHT, b.z, b.x, y + BUOY_HEIGHT + 90, b.z, hot(LAMP, 1.4), 0.3 * dying, 2);
    kit.ring(b.x, b.z, PHAROS.buoy.radius, y + 2, hot(LAMP, 1), 0.14 * dying, 2, kit.t * 0.05, 64, true);
  }

  /** The lance winding up: a hair of light down the locked bearing, thickening, with its width marked on the sea. */
  private lanceLine(s: Ship, bearing: number, f: number): void {
    const { kit } = this;
    const k = clamp01(f);
    const lamp = this.lampAt(s);
    const len = beamReach(s, bearing, PHAROS.range);
    const fx = forwardX(bearing);
    const fz = forwardZ(bearing);
    const ex = s.renderPos.x + fx * len;
    const ez = s.renderPos.z + fz * len;
    const flick = kit.reduce ? 1 : 0.7 + 0.3 * Math.sin(kit.t * 50);
    kit.line(lamp.x, lamp.y, lamp.z, ex, 6, ez, hot(WHITE, 2 + 2 * k), (0.35 + 0.5 * k) * flick, 2 + 8 * k);
    const w = PHAROS.lance.width / 2;
    for (const side of [-1, 1]) {
      const ox = fz * w * side;
      const oz = -fx * w * side;
      kit.line(s.renderPos.x + fx * 120 + ox, 3, s.renderPos.z + fz * 120 + oz, ex + ox, 3, ez + oz, hot(SCORCH, 1.6), 0.3 + 0.45 * k, 3);
    }
    kit.glow(lamp.x, lamp.y, lamp.z, 120 + 160 * k, hot(WHITE, 3), 0.9);
  }

  /** Daybreak winding up: light drawn in to the lantern, and the reach of the turn to come. */
  private dawn(s: Ship, f: number): void {
    const { kit } = this;
    const k = clamp01(f);
    const lamp = this.lampAt(s);
    const x = s.renderPos.x;
    const z = s.renderPos.z;
    for (let i = 0; i < 3; i++) {
      const ph = (k * 1.5 + i / 3) % 1;
      kit.ring(x, z, PHAROS.daybreak.range * (1 - ph) * 0.5 + 40, 4, hot(DAY, 1.6), 0.5 * ph, 4, i);
    }
    kit.ring(x, z, PHAROS.daybreak.range, 4, hot(WHITE, 1.4), 0.25 + 0.3 * k, 4, kit.t * 0.1, 96, true);
    kit.particles.push(BK.Flare, lamp.x, lamp.y, lamp.z, 200 + 500 * k, hot(DAY, 3), 0.9, kit.t, s.id);
    const rays = Math.round(10 * kit.k);
    for (let i = 0; i < rays; i++) {
      const a = (i * TAU) / rays + kit.t * 0.6;
      const d = 260 * (1 - ((k * 2 + hash01(s.id, i)) % 1));
      kit.line(lamp.x + Math.cos(a) * d, lamp.y + Math.sin(a * 3) * d * 0.3, lamp.z + Math.sin(a) * d, lamp.x + Math.cos(a) * (d + 50), lamp.y + Math.sin(a * 3) * (d + 50) * 0.3, lamp.z + Math.sin(a) * (d + 50), hot(DAY, 2), 0.6, 3);
    }
  }

  /** The false light: a ghost of the tower with its own turning beams, the ring it lures from and the ring it will burst over. */
  private beacon(s: Ship, a: PharosState, team: Team | -1, now: number): void {
    const { kit } = this;
    const b = a.beacon!;
    const F = PHAROS.falseLight;
    const left = clamp01((b.until - now) / F.time);
    const k = 1 - left;
    const y = kit.surface(b.x, b.z);
    const rise = easeOut(k * 6);
    const h = 150 * rise;
    const sway = kit.reduce ? 0 : Math.sin(kit.t * 30) * 0.15;
    // A tapering tower of pale green light, banded like the real one.
    for (let i = 0; i < 6; i++) {
      const ang = (i * TAU) / 6 + kit.t * 0.2;
      kit.line(b.x + Math.cos(ang) * 16, y, b.z + Math.sin(ang) * 16, b.x + Math.cos(ang) * 8, y + h, b.z + Math.sin(ang) * 8, hot(FALSE, 1.8), 0.7 + sway, 5);
    }
    for (const t of [0.3, 0.55, 0.8, 1]) kit.ring(b.x, b.z, 16 - 8 * t, y + h * t, hot(FALSE, 2), 0.75, 4, 0, 20);
    kit.particles.push(BK.Flare, b.x, y + h + 10, b.z, 110 + 130 * k, hot(FALSE, 2.6), 0.9, -kit.t, s.id);
    kit.glow(b.x, y + h + 10, b.z, 90, hot(FALSE, 2), 0.8);
    for (const side of [0, Math.PI]) {
      const ang = kit.t * (1.2 + 3 * k) + side;
      kit.line(b.x, y + h + 10, b.z, b.x + Math.cos(ang) * 700, y + 6, b.z + Math.sin(ang) * 700, hot(FALSE, 1.4), 0.35, 14);
    }
    kit.ring(b.x, b.z, F.lure, y + 3, hot(FALSE, 1), 0.2, 3, -kit.t * 0.05, 96, true);
    // The burst ring tightens its pulse as the moment comes.
    const beat = kit.reduce ? 1 : 0.6 + 0.4 * Math.sin(kit.t * (6 + 24 * k));
    kit.ring(b.x, b.z, F.radius, y + 3, mix(FALSE, DAY, k, 1.6), (0.35 + 0.5 * k) * beat, 5);
    kit.ring(b.x, b.z, F.radius * left, y + 3, hot(FALSE, 1.4), 0.5, 3);
    for (const l of b.lured) {
      if (l.until <= now) continue;
      const t = kit.game.ships.find((x) => x.id === l.target);
      if (!t || !kit.visible(t, team)) continue;
      kit.arc(t.renderPos.x, t.renderPos.y + t.spec.freeboard + 20, t.renderPos.z, b.x, y + h + 10, b.z, 60, hot(FALSE, 1.5), 0.5, 3, 16);
    }
  }

  // ------------------------------------------------------------------ bursts

  protected burst(b: MiscBurst, age: number): void {
    const f = clamp01(age / this.life(b.e.kind));
    switch (b.e.kind) {
      case 'lit':
        return this.glint(b, f, LAMP, 1);
      case 'scorch':
        return this.glint(b, f, SCORCH, 1.8);
      case 'lanceHit':
        return this.glint(b, f, WHITE, 2.2);
      case 'sear':
        return this.sear(b, age, f);
      case 'dazzled':
        return this.starburst(b.e.target?.renderPos.x ?? b.e.x, (b.e.target?.renderPos.y ?? 0) + 40, b.e.target?.renderPos.z ?? b.e.z, f, 220, b.id);
      case 'dazzle': {
        const lamp = this.lampAt(b.e.ship);
        return this.starburst(lamp.x, lamp.y, lamp.z, f, 520, b.id);
      }
      case 'hold':
      case 'counter':
      case 'twin':
        return this.lampPulse(b, f);
      case 'douse':
        return this.douse(b, f);
      case 'relight':
        return this.wave(b.e.ship.renderPos.x, b.e.ship.renderPos.z, b.e.radius ?? PHAROS.dark.radius, f, LAMP, b.id);
      case 'lance':
        return this.lance(b, age, f);
      case 'buoy':
        return this.toss(b, age);
      case 'buoyFlare':
        return this.buoyFlare(b, f);
      case 'buoyGone':
        return this.sink(b, f);
      case 'daybreak':
        return this.wave(b.e.ship.renderPos.x, b.e.ship.renderPos.z, b.e.radius ?? PHAROS.daybreak.range, f, DAY, b.id);
      case 'falseLight':
        return this.wave(b.e.x, b.e.z, (b.e.radius ?? PHAROS.falseLight.lure) * 0.5, f, FALSE, b.id);
      case 'wreck':
        return this.wreck(b, age, f);
      case 'lanceAim':
      case 'daybreakWarn':
        // Drawn from the lamp's state while they wind up.
        return;
      default:
        super.burst(b, age);
    }
  }

  /** A flash on a hull the beam has found, and a ring on the water under it. */
  private glint(b: MiscBurst, f: number, color: number, size: number): void {
    const { kit } = this;
    const t = b.e.target;
    const x = t?.renderPos.x ?? b.e.x;
    const z = t?.renderPos.z ?? b.e.z;
    const y = (t ? t.renderPos.y + t.spec.freeboard : 0) + 24;
    const fade = 1 - f;
    kit.particles.push(BK.Flare, x, y, z, (120 + 160 * easeOut(f * 3)) * size, hot(color, 2.4), 0.9 * fade, f * 2, b.id);
    kit.glow(x, y, z, 90 * size * fade + 30, hot(color, 2), 0.8 * fade);
    kit.shock(x, z, (t?.spec.length ?? 200) * (0.3 + 0.5 * easeOut(f)), hot(color, 1.3), 0.5 * fade);
    if (size <= 1) return;
    const n = Math.round(10 * size * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = (60 + hash01(b.id, i + 30) * 220) * easeOut(f);
      const up = 20 + hash01(b.id, i + 60) * 120 * f - 90 * f * f;
      kit.particles.push(BK.Spark, x + Math.cos(a) * d, y + up, z + Math.sin(a) * d, 5, hot(color, 2), 0.9 * fade, 0, i, Math.cos(a) * 14, 6, Math.sin(a) * 14, 2);
    }
  }

  /** Daybreak crossing a hull: a white column, a ring and a rain of embers. */
  private sear(b: MiscBurst, age: number, f: number): void {
    const { kit } = this;
    this.glint(b, f, DAY, 2.6);
    const t = b.e.target;
    if (!t) return;
    const x = t.renderPos.x;
    const z = t.renderPos.z;
    const fade = 1 - f;
    kit.line(x, 0, z, x, 420 * easeOut(age * 3), z, hot(DAY, 3), 0.8 * fade, 26 * fade + 4);
    kit.shock(x, z, t.spec.length * (0.4 + 1.1 * easeOut(f)), hot(WHITE, 1.6), 0.7 * fade);
    const n = Math.round(6 * kit.k);
    for (let i = 0; i < n; i++) kit.particles.push(BK.Smoke, x + (hash01(b.id, i) - 0.5) * 160, 30 + 140 * f * (0.5 + hash01(b.id, i + 9)), z + (hash01(b.id, i + 4) - 0.5) * 160, 70 + 110 * f, hot(0xd8d0c0, 1), 0.35 * fade, i, b.id + i);
  }

  /** Rays thrown out from a point: the lamp flaring in someone's eyes. */
  private starburst(x: number, y: number, z: number, f: number, reach: number, seed: number): void {
    const { kit } = this;
    const fade = 1 - f;
    const out = easeOut(f * 1.6);
    const rays = Math.round(14 * kit.k) + 4;
    for (let i = 0; i < rays; i++) {
      const a = (i * TAU) / rays + hash01(seed, i) * 0.3;
      const tilt = (hash01(seed, i + 20) - 0.5) * 1.2;
      const r0 = reach * 0.12 * out;
      const r1 = reach * (0.45 + 0.55 * hash01(seed, i + 40)) * out;
      kit.line(x + Math.cos(a) * r0, y + tilt * r0, z + Math.sin(a) * r0, x + Math.cos(a) * r1, y + tilt * r1, z + Math.sin(a) * r1, hot(DAY, 2.4), 0.8 * fade, 4 + 5 * fade);
    }
    kit.particles.push(BK.Flare, x, y, z, reach * (0.5 + 0.7 * out), hot(DAY, 3), 0.95 * fade, 0, seed);
  }

  /** The lantern answering a skill: a ring off the gallery, and for Counter-sweep a hook showing the new way round. */
  private lampPulse(b: MiscBurst, f: number): void {
    const { kit } = this;
    const lamp = this.lampAt(b.e.ship);
    const fade = 1 - f;
    const twin = b.e.kind === 'twin';
    kit.ring(lamp.x, lamp.z, 20 + (twin ? 260 : 150) * easeOut(f), lamp.y, hot(twin ? WHITE : LAMP, 2), 0.8 * fade, 5);
    kit.particles.push(BK.Flare, lamp.x, lamp.y, lamp.z, 180 + 200 * bump(f), hot(WHITE, 2.6), 0.9 * fade, f, b.id);
    if (b.e.kind === 'counter') {
      const a = b.e.ship.pharos;
      const dir = b.e.n ?? 1;
      const from = (a?.bearing ?? 0) - Math.PI / 2;
      const sweep = 1.6 * easeOut(f * 1.5) * dir;
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const p = from + (sweep * i) / steps;
        const q = from + (sweep * (i + 1)) / steps;
        kit.line(lamp.x + Math.cos(p) * 110, lamp.y, lamp.z + Math.sin(p) * 110, lamp.x + Math.cos(q) * 110, lamp.y, lamp.z + Math.sin(q) * 110, hot(SCORCH, 2.2), 0.85 * fade, 6);
      }
    }
    if (twin)
      for (const side of [-1, 1]) {
        const a = (b.e.ship.pharos?.bearing ?? 0) - Math.PI / 2 + (side < 0 ? Math.PI : 0);
        const d = 600 * easeOut(f);
        kit.line(lamp.x, lamp.y, lamp.z, lamp.x + Math.cos(a) * d, lamp.y - 20, lamp.z + Math.sin(a) * d, hot(WHITE, 2.4), 0.7 * fade, 10);
      }
  }

  /** The shutters dropping: the light folds in on the lantern and a breath of dark is left. */
  private douse(b: MiscBurst, f: number): void {
    const { kit } = this;
    const lamp = this.lampAt(b.e.ship);
    const fade = 1 - f;
    kit.ring(lamp.x, lamp.z, 260 * (1 - easeOut(f)) + 12, lamp.y, hot(LAMP, 1.6), 0.7 * fade, 5);
    kit.ring(lamp.x, lamp.z, 30 + 60 * f, lamp.y, hot(IRON, 1), 0.7 * fade, 8, 0, 24, false, true);
    kit.glow(lamp.x, lamp.y, lamp.z, 160 * fade, hot(WARM, 2), 0.8 * fade);
    const n = Math.round(4 * kit.k);
    for (let i = 0; i < n; i++) kit.particles.push(BK.Smoke, lamp.x + (hash01(b.id, i) - 0.5) * 30, lamp.y + 10 + 40 * f, lamp.z + (hash01(b.id, i + 5) - 0.5) * 30, 40 + 50 * f, hot(0x30363c, 1), 0.45 * fade, i, b.id + i);
  }

  /** A front of light running out over the sea from a point. */
  private wave(x: number, z: number, radius: number, f: number, color: number, seed: number): void {
    const { kit } = this;
    const fade = 1 - f;
    const r = radius * easeOut(f);
    const y = kit.surface(x, z) + 3;
    kit.ring(x, z, r, y, hot(color, 2), 0.85 * fade, 7);
    kit.ring(x, z, r * 0.82, y, hot(color, 1.4), 0.4 * fade, 3);
    kit.shock(x, z, r, hot(color, 1.1), 0.35 * fade);
    kit.glow(x, 60, z, 200 + radius * 0.4 * fade, hot(color, 1.8), 0.6 * fade);
    const n = Math.round(16 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n + hash01(seed, i);
      kit.particles.push(BK.Spark, x + Math.cos(a) * r, y + 10 + 30 * hash01(seed, i + 9), z + Math.sin(a) * r, 5, hot(color, 2), 0.8 * fade, 0, i, Math.cos(a) * 18, 4, Math.sin(a) * 18, 2);
    }
  }

  /** The lance: a white bar from the lantern to the sea, rings where it runs and steam off the water. */
  private lance(b: MiscBurst, age: number, f: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const tx = b.e.tx ?? x;
    const tz = b.e.tz ?? z;
    const lamp = this.lampAt(b.e.ship);
    const len = Math.hypot(tx - x, tz - z) || 1;
    const ux = (tx - x) / len;
    const uz = (tz - z) / len;
    const fade = (1 - f) ** 1.5;
    const flick = kit.reduce ? 1 : 0.85 + 0.15 * Math.sin(kit.t * 70);
    kit.line(lamp.x, lamp.y, lamp.z, tx, 6, tz, hot(DAY, 4), 0.95 * fade * flick, 10 + 60 * fade);
    kit.line(lamp.x, lamp.y, lamp.z, tx, 6, tz, hot(WARM, 2), 0.5 * fade, 30 + 130 * fade);
    // The scar it leaves on the water.
    kit.line(x + ux * 120, 3, z + uz * 120, tx, 3, tz, hot(SCORCH, 2), 0.7 * (1 - f), 8 + 30 * fade);
    kit.glow(lamp.x, lamp.y, lamp.z, 300 * fade + 60, hot(DAY, 3), 0.95 * fade);
    const marks = Math.max(3, Math.round((len / 380) * kit.k));
    for (let i = 1; i <= marks; i++) {
      const d = (len * i) / marks;
      const px = x + ux * d;
      const pz = z + uz * d;
      const local = clamp01(age * 2.4 - (i / marks) * 0.35);
      if (local <= 0) continue;
      kit.shock(px, pz, 40 + 190 * easeOut(local), hot(WHITE, 1.4), 0.6 * (1 - local) * (1 - f));
      kit.particles.push(BK.Smoke, px + (hash01(b.id, i) - 0.5) * 80, 20 + 110 * f, pz + (hash01(b.id, i + 7) - 0.5) * 80, 70 + 120 * f, hot(SEA, 1), 0.3 * (1 - f), i, b.id + i);
      kit.particles.push(BK.Spray, px, 10 + 40 * easeOut(local), pz, 60 + 50 * local, hot(SEA, 1), 0.5 * (1 - local), b.id + i);
    }
    kit.shock(tx, tz, 80 + 260 * easeOut(f), hot(DAY, 1.6), 0.7 * (1 - f));
  }

  /** A buoy lobbed from the deck to where it will float. */
  private toss(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { ship } = b.e;
    const tx = b.e.tx ?? b.e.x;
    const tz = b.e.tz ?? b.e.z;
    const y0 = ship.renderPos.y + ship.spec.freeboard + 12;
    const lift = Math.min(260, 60 + Math.hypot(tx - b.e.x, tz - b.e.z) * 0.12);
    const k = clamp01(age / TOSS);
    if (k < 1) {
      const p = kit.arcAt(b.e.x, y0, b.e.z, tx, 4, tz, lift, k);
      kit.arc(b.e.x, y0, b.e.z, tx, 4, tz, lift, hot(LAMP, 1.6), 0.5, 3, 20, k);
      kit.glow(p.x, p.y, p.z, 46, hot(WHITE, 2.4), 0.95);
      kit.particles.push(BK.Flare, p.x, p.y, p.z, 90, hot(LAMP, 2.2), 0.8, age * 9, b.id);
      return;
    }
    const f = clamp01((age - TOSS) / 0.5);
    kit.particles.push(BK.Spray, tx, 12 + 50 * easeOut(f), tz, 70 + 70 * f, hot(SEA, 1), 0.7 * (1 - f), b.id);
    kit.shock(tx, tz, 30 + 150 * easeOut(f), hot(LAMP, 1.2), 0.55 * (1 - f));
  }

  /** A buoy catching the beam: light thrown out all round, harder when a lance or Daybreak drives it. */
  private buoyFlare(b: MiscBurst, f: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const big = (b.e.n ?? 1) > 1;
    const radius = b.e.radius ?? PHAROS.buoy.radius;
    const y = kit.surface(x, z) + BUOY_HEIGHT * 0.74;
    const color = big ? DAY : LAMP;
    this.wave(x, z, radius, f, color, b.id);
    this.starburst(x, y, z, f, radius * (big ? 0.9 : 0.6), b.id + 3);
    kit.line(x, y, z, x, y + (big ? 420 : 260) * easeOut(f * 2), z, hot(color, 3), 0.8 * (1 - f), 14 * (1 - f) + 3);
  }

  private sink(b: MiscBurst, f: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const fade = 1 - f;
    kit.glow(x, 10 - 20 * f, z, 60 * fade + 10, hot(LAMP, 1.6), 0.7 * fade);
    kit.particles.push(BK.Spray, x, 8 + 20 * f, z, 50 + 30 * f, hot(SEA, 1), 0.5 * fade, b.id);
    kit.shock(x, z, 30 + 90 * easeOut(f), hot(LAMP, 1), 0.4 * fade);
  }

  /** The false light bursting: a green-white column, fronts of light and wreckage thrown up. */
  private wreck(b: MiscBurst, age: number, f: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const radius = b.e.radius ?? PHAROS.falseLight.radius;
    const fade = 1 - f;
    this.wave(x, z, radius, clamp01(f * 1.6), FALSE, b.id);
    this.wave(x, z, radius * 0.6, clamp01(f * 1.2), DAY, b.id + 1);
    const y = kit.surface(x, z);
    kit.line(x, y, z, x, y + 900 * easeOut(age * 2.5), z, hot(DAY, 4), 0.9 * fade, 70 * fade + 6);
    kit.line(x, y, z, x, y + 700 * easeOut(age * 2), z, hot(FALSE, 2.4), 0.6 * fade, 180 * fade + 10);
    kit.particles.push(BK.Flare, x, y + 120, z, 600 + 900 * easeOut(f * 3), mix(DAY, FALSE, f, 3), 0.95 * fade, 0, b.id);
    const n = Math.round(26 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = radius * (0.15 + 0.85 * hash01(b.id, i + 50)) * easeOut(f * 1.4);
      const up = (240 + 420 * hash01(b.id, i + 90)) * age - 260 * age * age;
      if (up < 0) continue;
      kit.particles.push(i % 3 ? BK.Spark : BK.Shard, x + Math.cos(a) * d, y + up, z + Math.sin(a) * d, i % 3 ? 7 : 14, hot(i % 3 ? FALSE : 0x9aa6a8, i % 3 ? 2.2 : 1), 0.9 * fade, a, i, Math.cos(a) * 20, 14, Math.sin(a) * 20, 2);
    }
    const puffs = Math.round(10 * kit.k);
    for (let i = 0; i < puffs; i++) {
      const a = hash01(b.id, i + 200) * TAU;
      const d = radius * 0.55 * hash01(b.id, i + 230);
      kit.particles.push(BK.Smoke, x + Math.cos(a) * d, y + 40 + 200 * f * hash01(b.id, i + 260), z + Math.sin(a) * d, 130 + 220 * f, hot(0xbfe6d6, 0.9), 0.4 * fade, a, b.id + i);
    }
  }

  // ------------------------------------------------------------------ the battery

  /** A flare round: a hard white star trailing a warm tail. */
  protected flight(_s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    kit.glow(x, y, z, 30, hot(WHITE, 2.6), 0.9);
    kit.line(x - dx * 70, y - dy * 70, z - dz * 70, x, y, z, hot(WARM, 1.8), 0.6, 4);
  }

  protected gunHit(b: MiscBurst, age: number): void {
    super.gunHit(b, age);
    if (b.e.n) this.starburst(b.e.x, (b.e.target ? b.e.target.renderPos.y + b.e.target.spec.freeboard : 0) + 14, b.e.z, clamp01(age / this.life('gunHit')), 90, b.id);
  }

  dispose(): void {
    super.dispose();
    for (const m of this.shafts.values()) m.dispose();
    this.shafts.clear();
    this.cone.dispose();
    this.buoy.body.dispose();
    this.buoy.lens.dispose();
    this.paint.dispose();
    this.lensGlow.dispose();
  }
}
