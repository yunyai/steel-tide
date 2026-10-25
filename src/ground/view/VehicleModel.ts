import { type BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import { type ColorFn, Parts } from '../../render/Geometry';
import type { Vehicle } from '../sim/Vehicle';
import type { VehicleSpec } from '../sim/types';

// Ground vehicles, built from boxes and cylinders like the ships: tracks and road wheels, a hull
// with its glacis laid back at the armour's slope, a turret and a gun that recoils. Parts are laid
// out with +X forward and +Z to the right, then turned so the bow faces -Z as the sim has it.
// Geometry is shared per spec; each vehicle gets its own material so a wreck can blacken.

/** One spec's geometry, in the vehicle's frame (bow along -Z, ground at y = 0). */
interface VehicleGeo {
  hull: BufferGeometry;
  /** Turns with the turret (or the gun mount of a casemate, the rack of a rocket truck). */
  turret: BufferGeometry;
  /** Elevates with the gun, and recoils. */
  gun: BufferGeometry | null;
  /** Rockets on the rails, shown while the salvo is loaded. */
  load: BufferGeometry | null;
  /** Turret ring: height and distance forward of the hull centre. */
  ringY: number;
  ringF: number;
  /** Gun trunnion above the ring. */
  gunY: number;
  /** How far the barrel slides back on firing. */
  recoil: number;
  /** Rocket rails elevate this far (radians) above the hull. */
  rackPitch: number;
}

const cache = new Map<string, VehicleGeo>();
const c = new Color();

/** Bow from +X to -Z: x' = z, z' = -x. */
function turned(g: BufferGeometry): BufferGeometry {
  g.rotateY(Math.PI / 2);
  g.computeBoundingSphere();
  return g;
}

/** Paint with camouflage blotches over the base colour. */
function paintFn(base: number, camo: number | undefined, rough: boolean): ColorFn {
  const b = new Color(base);
  const k = camo !== undefined ? new Color(camo) : null;
  return (x, y, z) => {
    c.copy(b);
    if (k) {
      const n = Math.sin(x * 1.1 + z * 0.6 + 1.3) + 0.8 * Math.sin(z * 1.7 - y * 2.3 + x * 0.45) + 0.5 * Math.sin(x * 2.9 - z * 2.1);
      if (n > 0.55) c.copy(k);
    }
    if (rough) {
      // Zimmerit: a fine ridged paste over the plates.
      const r = Math.sin(x * 40) * Math.sin(y * 37 + z * 11);
      c.multiplyScalar(0.9 + r * 0.08);
    }
    return c;
  };
}

/** Barrel radii at the breech and muzzle for a calibre (mm). */
function bore(cal: number): [number, number] {
  return [0.04 + cal * 0.0013, 0.025 + cal * 0.0009];
}

/** Tracks, road wheels, sprocket and idler down one side, centred at z. */
function trackRun(p: Parts, len: number, h: number, tw: number, z: number, wheels: number, dark: number, wheel: number): void {
  // Upper and lower runs with a raked front and back.
  p.box(len, h * 0.82, tw, 0, h * 0.12, z, dark, { taper: 0.04 });
  p.box(len * 0.86, h * 0.14, tw * 1.02, 0, 0, z, dark);
  const r = h * 0.36;
  const outer = z + Math.sign(z) * (tw * 0.5 + 0.02);
  for (let i = 0; i < wheels; i++) {
    const x = -len * 0.38 + (i / Math.max(1, wheels - 1)) * len * 0.76;
    p.cyl(r, r, 0.08, x, r + h * 0.04, outer - (z > 0 ? 0.08 : 0), wheel, { rx: Math.PI / 2, seg: 12 });
    p.cyl(r * 0.35, r * 0.35, 0.1, x, r + h * 0.04, outer - (z > 0 ? 0.1 : -0.02), dark, { rx: Math.PI / 2, seg: 8 });
  }
  // Drive sprocket at the front, idler at the back, both a little higher.
  for (const x of [len * 0.47, -len * 0.47]) p.cyl(r * 0.8, r * 0.8, 0.1, x, h * 0.55, outer - (z > 0 ? 0.1 : 0), wheel, { rx: Math.PI / 2, seg: 10 });
}

/** A tracked hull: lower hull between the tracks, a fendered superstructure with sloped glacis. */
function trackedHull(p: Parts, s: VehicleSpec, paint: ColorFn, triple = false): void {
  const { length: L, width: W, height: H } = s.size;
  const trim = s.look.trim;
  const tw = W * 0.22;
  const th = H * 0.5;
  if (triple) {
    // Three track units a side, like the Ratte drawings.
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) trackRun(p, L * 0.92, th, tw * 0.32, side * (W / 2 - tw * (0.17 + k * 0.33)), 9, 0x26241f, 0x3a3a34);
  } else for (const side of [-1, 1]) trackRun(p, L * 0.96, th, tw, side * (W / 2 - tw / 2), Math.max(4, Math.round(L / 1.2)), 0x26241f, 0x3c3a32);
  // Lower hull between the tracks.
  p.box(L * 0.9, th * 0.75, W - tw * 2, 0, th * 0.25, 0, paint);
  // Superstructure over the tracks, the glacis laid back at its slope.
  const up = H - th * 0.95;
  const setback = Math.min(L * 0.25, up * Math.tan((s.armor.hull.slope * Math.PI) / 180));
  p.box(L * 0.94, up, W * 0.98, 0, th * 0.95, 0, paint, { slope: setback });
  // Lower front plate to the nose.
  p.box(0.25, th * 0.6, W - tw * 2, L * 0.45, th * 0.35, 0, paint, { rz: -0.6 });
  // Engine deck and grilles at the back.
  p.box(L * 0.3, 0.05, W * 0.6, -L * 0.3, H, 0, 0x2c2c26);
  for (let k = 0; k < 4; k++) p.box(L * 0.26, 0.04, 0.05, -L * 0.3, H + 0.04, -W * 0.25 + k * W * 0.16, trim);
  // Fender lips.
  for (const side of [-1, 1]) p.box(L * 0.96, 0.05, tw * 1.1, 0, th * 0.95, side * (W / 2 - tw * 0.5), trim);
  // Headlights and a towing eye.
  for (const side of [-1, 1]) p.cyl(0.08, 0.08, 0.12, L * 0.44 - setback * 0.2, H * 0.92, side * W * 0.38, 0x1a1a18, { rz: -Math.PI / 2, seg: 6 });
}

/** Side skirts hung over the upper track run. */
function skirts(p: Parts, s: VehicleSpec, paint: ColorFn): void {
  const { length: L, width: W, height: H } = s.size;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) p.box(L * 0.14, H * 0.24, 0.03, -L * 0.42 + k * L * 0.16 + L * 0.07, H * 0.24, side * (W / 2 + 0.02), paint);
  }
}

/** A cast or welded turret with mantlet, cupola and hatches, in the ring's frame. */
function turret(p: Parts, s: VehicleSpec, paint: ColorFn): void {
  const t = s.size.turret!;
  const slope = s.armor.turret?.slope ?? 15;
  const setback = Math.min(t.length * 0.25, t.height * Math.tan((slope * Math.PI) / 180));
  p.box(t.length, t.height, t.width, -t.length * 0.05, 0, 0, paint, { taper: 0.14, slope: setback });
  // Bustle at the back.
  p.box(t.length * 0.3, t.height * 0.7, t.width * 0.8, -t.length * 0.6, t.height * 0.15, 0, paint, { taper: 0.08 });
  // Cupola, a hatch, a periscope.
  p.cyl(0.32, 0.36, 0.28, -t.length * 0.2, t.height, -t.width * 0.22, paint, { seg: 10 });
  p.cyl(0.3, 0.3, 0.04, -t.length * 0.2, t.height + 0.28, -t.width * 0.22, s.look.trim, { seg: 10 });
  p.box(0.5, 0.06, 0.5, -t.length * 0.15, t.height, t.width * 0.22, s.look.trim);
  p.box(0.16, 0.14, 0.1, t.length * 0.15, t.height, t.width * 0.3, 0x1a1a18);
}

/** The gun along +X from its trunnion, with a mantlet ahead of the turret face. */
function gun(p: Parts, s: VehicleSpec, faceX: number, paint: ColorFn): void {
  const gs = s.gun!;
  const [r0, r1] = bore(gs.caliber);
  const len = s.size.barrel;
  const n = gs.barrels ?? 1;
  const petard = s.look.parts?.includes('petard');
  const mw = Math.max(0.5, r0 * 5 * n);
  p.box(0.4, r0 * 5, mw, faceX - 0.1, -r0 * 2.5, 0, paint, { taper: 0.1 });
  for (let b = 0; b < n; b++) {
    const z = n > 1 ? (b - (n - 1) / 2) * Math.max(0.9, r0 * 4) : 0;
    if (petard) {
      // A stubby spigot mortar.
      p.barrel(r0 * 0.9, r0 * 0.85, len, faceX, 0, z, 0x2a2a26, 10);
      continue;
    }
    p.barrel(r0, r1, len * 0.45, faceX, 0, z, paint, 10);
    p.barrel(r1, r1 * 0.95, len * 0.55, faceX + len * 0.45 - 0.02, 0, z, paint, 10);
    if (s.look.style === 'ww2' && gs.caliber >= 75) {
      // Double-baffle muzzle brake.
      p.barrel(r1 * 1.6, r1 * 1.6, 0.35, faceX + len - 0.3, 0, z, 0x2e2e2a, 10);
    }
  }
}

function buildTank(s: VehicleSpec): VehicleGeo {
  const paint = paintFn(s.look.paint, s.look.camo, !!s.look.parts?.includes('zimmerit'));
  const parts = s.look.parts ?? [];
  const titan = s.look.body === 'titan';
  const hull = new Parts();
  trackedHull(hull, s, paint, titan);
  if (parts.includes('skirts')) skirts(hull, s, paint);
  const { length: L, width: W, height: H } = s.size;
  if (parts.includes('drums')) for (const side of [-1, 1]) hull.cyl(0.3, 0.3, 0.9, -L * 0.42, H * 0.7, side * W * 0.32, 0x3a3e2c, { rz: Math.PI / 2, seg: 10 });
  if (parts.includes('fascine')) hull.cyl(0.9, 0.9, W * 0.9, L * 0.32, H + 0.3, -W * 0.45, 0x6a5a3a, { rx: Math.PI / 2, seg: 10 });
  if (parts.includes('star')) for (const side of [-1, 1]) hull.box(0.5, 0.5, 0.02, -L * 0.05, H * 0.62, side * (W / 2 + 0.03), 0xd8d8d0);
  if (titan) {
    // Secondary turret and flak on the rear deck, a bridge-like command tower.
    hull.box(5, 2.2, 5, -L * 0.3, H, 0, paint, { taper: 0.2 });
    hull.barrel(0.12, 0.09, 6, -L * 0.3 + 2.4, H + 1.2, -0.5, paint);
    hull.barrel(0.12, 0.09, 6, -L * 0.3 + 2.4, H + 1.2, 0.5, paint);
    if (parts.includes('flak')) {
      for (const [fx, fz] of [[-L * 0.42, -W * 0.36], [-L * 0.42, W * 0.36], [L * 0.05, -W * 0.4], [L * 0.05, W * 0.4]]) {
        hull.cyl(0.7, 0.8, 0.6, fx, H, fz, s.look.trim, { seg: 8 });
        hull.barrel(0.05, 0.04, 2.6, fx, H + 0.9, fz - 0.15, 0x2a2a26, 6);
        hull.barrel(0.05, 0.04, 2.6, fx, H + 0.9, fz + 0.15, 0x2a2a26, 6);
      }
    }
    // Rivet rows down the hull sides.
    for (const side of [-1, 1]) for (let k = 0; k < 14; k++) hull.box(0.25, 0.25, 0.06, -L * 0.45 + k * L * 0.07, H * 0.7, side * (W * 0.49 + 0.02), s.look.trim);
  }
  const t = s.size.turret!;
  const top = new Parts();
  turret(top, s, paint);
  const gunParts = new Parts();
  gun(gunParts, s, t.length * 0.45, paint);
  const [r0] = bore(s.gun!.caliber);
  return {
    hull: turned(hull.merge()),
    turret: turned(top.merge()),
    gun: turned(gunParts.merge()),
    load: null,
    ringY: H,
    ringF: t.offset,
    gunY: t.height * 0.55,
    recoil: Math.min(1.2, 0.2 + r0 * 3),
    rackPitch: 0,
  };
}

/** Turretless: an open fighting compartment, the gun in a shielded mount (Archer, Ho-Ro). */
function buildOpen(s: VehicleSpec): VehicleGeo {
  const paint = paintFn(s.look.paint, s.look.camo, false);
  const { length: L, width: W, height: H } = s.size;
  const hull = new Parts();
  const lowH = H * 0.7;
  // Build a tracked hull at the lower deck height, then the compartment walls above it.
  trackedHull(hull, { ...s, size: { ...s.size, height: lowH } }, paint);
  const f = L * 0.2;
  const wallH = H - lowH;
  const cw = W * 0.86;
  const cl = L * 0.42;
  for (const side of [-1, 1]) hull.box(cl, wallH, 0.06, f, lowH, side * cw * 0.5, paint, { slope: 0 });
  const facing = s.gun?.facing ?? 0;
  // Front (or, firing aft, rear) shield plate, and a low back wall.
  const fore = facing >= 90 ? -1 : 1;
  hull.box(0.06, wallH, cw, f + fore * cl * 0.5, lowH, 0, paint);
  hull.box(0.06, wallH * 0.5, cw, f - fore * cl * 0.5, lowH, 0, paint);
  // Crew stowage.
  hull.box(0.6, 0.4, 0.5, f - fore * cl * 0.3, lowH, cw * 0.3, 0x4a4434);
  hull.box(0.5, 0.35, 0.5, f - fore * cl * 0.3, lowH, -cw * 0.3, 0x3a3e2c);
  const mount = new Parts();
  // A pedestal and gun shield, turning with the mount.
  mount.cyl(0.35, 0.45, 0.3, 0, 0, 0, s.look.trim, { seg: 10 });
  mount.box(0.08, 0.9, 1.4, 0.55, 0, 0, paint, { rz: 0.15 });
  const gunParts = new Parts();
  gun(gunParts, s, 0.2, paint);
  // A breech block behind the trunnion.
  const [r0] = bore(s.gun!.caliber);
  gunParts.box(0.7, r0 * 4, r0 * 4, -0.5, -r0 * 2, 0, 0x2a2a26);
  return {
    hull: turned(hull.merge()),
    turret: turned(mount.merge()),
    gun: turned(gunParts.merge()),
    load: null,
    ringY: lowH + 0.05,
    ringF: f,
    gunY: H + 0.3 - lowH - 0.05,
    recoil: Math.min(1, 0.25 + r0 * 3),
    rackPitch: 0,
  };
}

/** A lorry: cab, bed and three axles, with a rocket rack on the bed (Katyusha). */
function buildTruck(s: VehicleSpec): VehicleGeo {
  const paint = paintFn(s.look.paint, s.look.camo, false);
  const { length: L, width: W, height: H } = s.size;
  const hull = new Parts();
  const r = 0.5;
  // Chassis rails, wheels, mudguards.
  hull.box(L * 0.95, 0.25, W * 0.5, 0, r * 1.1, 0, 0x22221e);
  for (const x of [L * 0.3, -L * 0.15, -L * 0.36]) {
    for (const side of [-1, 1]) {
      hull.cyl(r, r, 0.32, x, r, side * (W / 2 - 0.16) - (side > 0 ? 0.32 : 0), 0x1c1c1a, { rx: Math.PI / 2, seg: 12 });
      hull.cyl(r * 0.45, r * 0.45, 0.34, x, r, side * (W / 2 - 0.16) - (side > 0 ? 0.33 : -0.01), 0x3a3a32, { rx: Math.PI / 2, seg: 8 });
    }
  }
  // Bonnet, cab with windows, flatbed.
  hull.box(L * 0.18, H * 0.38, W * 0.62, L * 0.4, r * 1.3, 0, paint, { taper: 0.08 });
  hull.box(L * 0.18, H * 0.75, W * 0.95, L * 0.22, r * 1.3, 0, paint, { taper: 0.05 });
  hull.box(0.04, H * 0.22, W * 0.8, L * 0.31, r * 1.3 + H * 0.45, 0, 0x1a2228);
  for (const side of [-1, 1]) hull.box(L * 0.1, H * 0.22, 0.04, L * 0.22, r * 1.3 + H * 0.45, side * W * 0.48, 0x1a2228);
  for (const side of [-1, 1]) hull.box(L * 0.14, 0.06, W * 0.22, L * 0.38, r * 1.95, side * W * 0.42, s.look.trim, { rx: side * 0.3 });
  hull.box(L * 0.58, 0.16, W, -L * 0.18, r * 1.3, 0, s.look.trim);
  // The rack: a frame and rails, elevated, and the rockets that sit on it.
  const rack = new Parts();
  const rl = L * 0.55;
  const rails = 8;
  rack.box(0.3, 0.6, W * 0.7, -0.15, -0.6, 0, s.look.trim);
  for (let k = 0; k < rails; k++) {
    const z = -W * 0.4 + (k / (rails - 1)) * W * 0.8;
    rack.box(rl, 0.08, 0.08, rl * 0.5 - 0.3, 0, z, 0x2a2a26);
    rack.box(rl, 0.04, 0.04, rl * 0.5 - 0.3, -0.14, z, 0x2a2a26);
  }
  for (const x of [0, rl * 0.6]) rack.box(0.1, 0.1, W * 0.85, x, -0.1, 0, s.look.trim);
  const load = new Parts();
  for (let k = 0; k < rails; k++) {
    const z = -W * 0.4 + (k / (rails - 1)) * W * 0.8;
    for (const y of [0.15, -0.26]) {
      load.barrel(0.065, 0.065, rl * 0.7, rl * 0.1, y, z, 0x5a6048, 6);
      load.barrel(0.065, 0.02, 0.25, rl * 0.8, y, z, 0x7a2a1a, 6);
    }
  }
  return {
    hull: turned(hull.merge()),
    turret: turned(rack.merge()),
    gun: null,
    load: turned(load.merge()),
    ringY: r * 1.3 + 1.0,
    ringF: -L * 0.38,
    gunY: 0,
    recoil: 0,
    rackPitch: 0.5,
  };
}

function build(s: VehicleSpec): VehicleGeo {
  switch (s.look.body) {
    case 'casemate':
    case 'spg':
      return buildOpen(s);
    case 'truck':
      return buildTruck(s);
    default:
      if (!s.size.turret || !s.gun) return buildOpen(s);
      return buildTank(s);
  }
}

export function vehicleGeometry(s: VehicleSpec): VehicleGeo {
  let g = cache.get(s.id);
  if (!g) {
    g = build(s);
    cache.set(s.id, g);
  }
  return g;
}

/** Build a spec's geometry ahead of time; false if it was already built. */
export function warmVehicle(s: VehicleSpec): boolean {
  if (cache.has(s.id)) return false;
  vehicleGeometry(s);
  return true;
}

const BASE = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.35, envMapIntensity: 0.8 });
const WRECK = new Color(0x2a2522);
const LIVE = new Color(0xffffff);
/** Seconds a wreck takes to char. */
const CHAR_TIME = 1.5;

/** What a vehicle view reads each frame: a sim vehicle, or the garage's stand-in. */
export type VehicleViewSource = Pick<
  Vehicle,
  'spec' | 'alive' | 'renderX' | 'renderY' | 'renderZ' | 'renderHeading' | 'renderPitch' | 'renderRoll' | 'renderTurret' | 'gunPitch' | 'deathTime' | 'launcherReload' | 'salvoLeft'
>;

export class VehicleView {
  readonly group = new Group();
  private readonly hull: Mesh;
  private readonly turret: Group;
  private readonly gunMount: Group;
  private readonly barrel: Mesh | null;
  private readonly load: Mesh | null;
  private readonly mat: MeshStandardMaterial;
  private readonly geo: VehicleGeo;
  private kick = 0;
  /** The spec this view was built for (a Free play swap rebuilds it). */
  readonly spec: VehicleSpec;

  constructor(
    readonly v: VehicleViewSource,
    shadows: boolean,
  ) {
    this.spec = v.spec;
    this.geo = vehicleGeometry(v.spec);
    this.mat = BASE.clone();
    const glow = v.spec.look.glow;
    if (glow !== undefined) this.mat.emissive.setHex(glow).multiplyScalar(0.15);
    this.hull = new Mesh(this.geo.hull, this.mat);
    this.turret = new Group();
    this.turret.position.set(0, this.geo.ringY, -this.geo.ringF);
    this.turret.add(new Mesh(this.geo.turret, this.mat));
    this.gunMount = new Group();
    this.gunMount.position.y = this.geo.gunY;
    this.turret.add(this.gunMount);
    this.barrel = this.geo.gun ? new Mesh(this.geo.gun, this.mat) : null;
    if (this.barrel) this.gunMount.add(this.barrel);
    this.load = this.geo.load ? new Mesh(this.geo.load, this.mat) : null;
    if (this.load) this.turret.children[0].add(this.load);
    if (this.geo.rackPitch) this.turret.children[0].rotation.x = this.geo.rackPitch;
    this.group.add(this.hull, this.turret);
    this.group.rotation.order = 'YXZ';
    this.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = shadows;
        o.receiveShadow = true;
      }
    });
  }

  /** The gun just fired. */
  fired(): void {
    this.kick = 1;
  }

  update(dt: number, time: number): void {
    const v = this.v;
    const g = this.group;
    g.position.set(v.renderX, v.renderY, v.renderZ);
    g.rotation.set(v.renderPitch, -v.renderHeading, -v.renderRoll);
    if (v.alive) {
      this.turret.rotation.y = -v.renderTurret;
      // The gun's world elevation, less the hull's tilt along its line.
      const tilt = v.renderPitch * Math.cos(v.renderTurret) - v.renderRoll * Math.sin(v.renderTurret);
      this.gunMount.rotation.x = v.gunPitch - tilt;
      this.mat.color.copy(LIVE);
    } else {
      // The wreck chars and the gun sags.
      const k = Math.min(1, (time - v.deathTime) / CHAR_TIME);
      this.mat.color.copy(LIVE).lerp(WRECK, k);
      this.gunMount.rotation.x += (-0.08 - this.gunMount.rotation.x) * Math.min(1, dt * 2);
    }
    if (this.barrel) {
      this.kick = Math.max(0, this.kick - dt * 3.2);
      // Fast back, slow out again.
      this.barrel.position.z = this.geo.recoil * (this.kick > 0.8 ? (1 - this.kick) * 5 : this.kick / 0.8);
    }
    if (this.load) this.load.visible = v.alive && (v.launcherReload <= 0 || v.salvoLeft > 0);
  }

  dispose(): void {
    this.mat.dispose();
    this.group.removeFromParent();
  }
}
