import { Color, CylinderGeometry, ExtrudeGeometry, Group, Shape, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, type BufferGeometry, type Material, type Mesh } from 'three';
import type { Ship } from '../ships/Ship';
import { CUBE } from '../skills/misc/TungstenModes';
import { overdriveOn } from '../skills/misc/TungstenRuntime';
import { Parts } from './Geometry';
import { reducedMotion } from './ArchitectPose';
import { MODE_COLORS, ModeSweep, cubeGeometry, cubeSkin, slamLift, type CubeSkinUniforms } from './TungstenLook';

/** Layout of the electromagnet, in hull space (x forward, y up, z starboard). */
export const MAGNET = {
  /** Leg centre off the keel; the legs stand on sponsons outboard of the 64 m beam. */
  legZ: 48,
  legW: 12,
  legL: 26,
  deck: 14,
  /** Height where the legs turn into the arch, and the arch's centre-line radius. */
  shoulder: 78,
  archR: 48,
  /** Underside of the crown pole, over the cradled cube. */
  poleTip: 102,
} as const;

const STEEL = 0x59616b,
  DARK = 0x2c3138,
  POLE = 0x9aa3ad,
  OXIDE = 0x7a2622,
  COPPER = 0xb4642c,
  BRASS = 0x9c7b3e,
  INSULATOR = 0xd9d4c8;
const BANDS = 7;

/** A half ring in the y-z plane, `depth` thick along x and centred on x = 0. */
function arc(inner: number, outer: number, depth: number, bevel: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.absarc(0, 0, outer, 0, Math.PI, false);
  shape.lineTo(-inner, 0);
  shape.absarc(0, 0, inner, Math.PI, 0, true);
  shape.lineTo(outer, 0);
  const g = new ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 40 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
const tmpColor = new Color();

/**
 * The Tungsten's horseshoe electromagnet: an arch straddling the hull over the cube cradle, with copper-wound
 * legs whose gaps glow in the cube's mode colour. The docked cubes are drawn here so they ride the hull's motion.
 */
export class TungstenModel {
  readonly root = new Group();
  /** Docked cubes by magnet slot (0 is the cradle, 1..5 the Overdrive ring). */
  readonly cubes: { mesh: Mesh; material: MeshStandardMaterial; u: CubeSkinUniforms; sweep: ModeSweep; present: boolean; since: number; mode: number }[] = [];
  private owned: BufferGeometry[] = [];
  private metal = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.78, roughness: 0.36 });
  /** Pole faces, crown tip, cradle ring and seams: the mode colour. */
  private glow = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** Coil gaps: the mode colour, or one band per mode in Overdrive. */
  private bands = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  private bandColors: Float32Array;
  private bandMesh: Mesh;
  private sweep = new ModeSweep();
  private reduce = reducedMotion();

  constructor(make: (g: BufferGeometry, m: Material) => Mesh) {
    this.root.name = 'tungsten-magnet';
    const add = (g: BufferGeometry, m: Material, parent: Group = this.root) => {
      this.owned.push(g);
      const mesh = make(g, m);
      parent.add(mesh);
      return mesh;
    };
    const M = MAGNET;
    const frame = new Parts(),
      glow = new Parts(),
      bands = new Parts();
    const half = CUBE.edge / 2;
    const cradleTop = M.deck + 6;

    // Cradle: a low plinth under the cube with four clamp jaws and a lit seating ring.
    frame.box(78, 6, 78, 0, M.deck, 0, DARK);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        frame.box(12, 16, 4, sx * (half + 4), cradleTop, sz * (half - 4), STEEL, { taper: 0.2 });
        frame.box(4, 16, 12, sx * (half - 4), cradleTop, sz * (half + 4), STEEL, { taper: 0.2 });
        frame.box(6, 3, 6, sx * (half + 4), cradleTop + 16, sz * (half + 4), BRASS);
      }
    glow.add(new TorusGeometry(26, 0.9, 4, 48), 0xffffff, 0, cradleTop + 0.3, 0, { rx: Math.PI / 2 });
    glow.add(new TorusGeometry(18, 0.6, 4, 40), 0xffffff, 0, cradleTop + 0.3, 0, { rx: Math.PI / 2 });

    for (const side of [-1, 1]) {
      const z = side * M.legZ;
      // Sponson blisters carry the legs outboard of the hull.
      frame.box(84, 16, 26, 0, -2, side * 45, STEEL, { taper: 0.08 });
      frame.box(16, 10, 22, -48, 0, side * 44, STEEL, { taper: 0.5, rz: 0.3 });
      frame.box(16, 10, 22, 48, 0, side * 44, STEEL, { taper: 0.5, rz: -0.3 });
      // Leg core, plinth and the copper windings with glowing gaps.
      frame.box(M.legL + 10, 6, M.legW + 10, 0, M.deck, z, DARK);
      frame.box(M.legL, M.shoulder - M.deck, M.legW, 0, M.deck, z, STEEL);
      const lo = M.deck + 7,
        hi = M.shoulder - 6,
        pitch = (hi - lo) / BANDS,
        gap = 2.2;
      for (let i = 0; i < BANDS; i++) {
        const y = lo + i * pitch;
        frame.box(M.legL + 5, pitch - gap, M.legW + 5, 0, y, z, COPPER);
        // Banding wire and a brass tie on the outboard face.
        frame.box(M.legL + 5.6, 0.6, M.legW + 5.6, 0, y + (pitch - gap) / 2, z, BRASS);
        if (i < BANDS - 1) bands.box(M.legL + 3.6, gap + 0.2, M.legW + 3.6, 0, y + pitch - gap - 0.1, z, 0xffffff);
      }
      // Pole shoe: a slab facing the cube, its face lit.
      frame.box(44, 54, 5, 0, M.deck + 12, side * (half + 7.5), POLE, { taper: 0.04 });
      // A lit grille on the pole face rather than a solid plate, so it reads as machinery.
      for (let k = 0; k < 7; k++) glow.box(30, 1.1, 0.6, 0, M.deck + 18 + k * 6.6, side * (half + 4.8), 0xffffff);
      for (const x of [-16, 16]) glow.box(1.2, 44, 0.8, x, M.deck + 16, side * (half + 4.6), 0xffffff);
      // Capacitor banks fore and aft of the leg, with lit charge collars.
      for (const x of [-26, 26]) {
        frame.cyl(5, 5.5, 18, x, M.deck, side * 54, DARK, { seg: 14 });
        frame.cyl(5.6, 5.6, 1.5, x, M.deck + 12, side * 54, BRASS, { seg: 14 });
        frame.sphere(4.6, x, M.deck + 18, side * 54, STEEL, { sy: 0.5 });
        glow.cyl(5.7, 5.7, 1.2, x, M.deck + 15, side * 54, 0xffffff, { seg: 14 });
        // Cable run from the bank into the leg plinth.
        frame.box(Math.abs(x) - M.legL / 2, 2.4, 3, (x + Math.sign(x) * (M.legL / 2)) / 2, M.deck, side * 50, DARK);
      }
      // Bus bars up the outboard face to the shoulder, on insulators.
      frame.box(3, M.shoulder - M.deck - 8, 3, -8, M.deck + 4, side * (M.legZ + M.legW / 2 + 4.5), BRASS);
      frame.box(3, M.shoulder - M.deck - 8, 3, 8, M.deck + 4, side * (M.legZ + M.legW / 2 + 4.5), BRASS);
      for (let y = M.deck + 12; y < M.shoulder - 6; y += 14) frame.cyl(1.6, 1.6, 4, 0, y, side * (M.legZ + M.legW / 2 + 2), INSULATOR, { seg: 6, rx: Math.PI / 2 });
    }

    // The arch: a bevelled half ring in oxide red, the classic magnet, with a lit seam along its back.
    frame.add(arc(M.archR - M.legW / 2, M.archR + M.legW / 2, M.legL, 1.6), OXIDE, 0, M.shoulder, 0);
    glow.add(arc(M.archR + M.legW / 2 + 1.2, M.archR + M.legW / 2 + 1.9, 3, 0), 0xffffff, 0, M.shoulder, 0);
    for (const x of [-1, 1]) glow.add(arc(M.archR - 1.2, M.archR + 1.2, 0.5, 0), 0xffffff, x * (M.legL / 2 + 1.7), M.shoulder, 0);
    // Shoulder collars where legs meet the arch.
    for (const side of [-1, 1]) frame.box(M.legL + 8, 8, M.legW + 8, 0, M.shoulder - 6, side * M.legZ, DARK, { taper: 0.1 });
    // Crown: a housing over the apex and a field pole pointing down at the cradled cube.
    const crown = M.shoulder + M.archR;
    frame.box(34, 10, 18, 0, crown + M.legW / 2 - 2, 0, OXIDE, { taper: 0.25 });
    frame.add(new CylinderGeometry(7, 10, crown - M.legW / 2 - M.poleTip, 16), POLE, 0, (crown - M.legW / 2 + M.poleTip) / 2, 0);
    frame.add(new TorusGeometry(9, 1.4, 6, 20), COPPER, 0, M.poleTip + 6, 0, { rx: Math.PI / 2 });
    frame.add(new TorusGeometry(8.4, 1.4, 6, 20), COPPER, 0, M.poleTip + 10, 0, { rx: Math.PI / 2 });
    glow.add(new CylinderGeometry(6.4, 6.4, 0.8, 16), 0xffffff, 0, M.poleTip - 0.2, 0);
    // Insulator stacks and a lightning-rod mast on the crown.
    for (const x of [-12, 12]) for (let k = 0; k < 4; k++) frame.cyl(2.4 - k * 0.2, 2.4 - k * 0.2, 1.6, x, crown + M.legW / 2 + 8 + k * 2.2, 0, INSULATOR, { seg: 8 });
    frame.cyl(0.6, 1, 22, 0, crown + M.legW / 2 + 8, 0, BRASS, { seg: 6 });

    add(frame.merge(), this.metal);
    add(glow.merge(), this.glow);
    const bandGeo = bands.merge();
    this.bandColors = (bandGeo.getAttribute('color').array as Float32Array);
    this.bandMesh = add(bandGeo, this.bands);
    this.bandMesh.name = 'tungsten-coil-gaps';

    // Six cube bodies: the cradle and the Overdrive ring. Hidden until a cube docks in that slot.
    for (let slot = 0; slot < 6; slot++) {
      const { material, u } = cubeSkin();
      const mesh = make(cubeGeometry(), material);
      mesh.name = `tungsten-cube-docked-${slot}`;
      mesh.scale.setScalar(CUBE.edge);
      mesh.visible = false;
      this.root.add(mesh);
      this.cubes.push({ mesh, material, u, sweep: new ModeSweep(), present: false, since: -1e9, mode: 0 });
    }
    this.paintBands(-1);
    this.pose(0);
  }

  /** Paint the coil gaps: every gap white (the material carries the colour), or one mode per gap in Overdrive. */
  private painted = -2;
  private paintBands(overdrive: number): void {
    if (overdrive === this.painted) return;
    this.painted = overdrive;
    const n = this.bandColors.length / 3,
      perBand = n / (2 * (BANDS - 1));
    for (let i = 0; i < n; i++) {
      const band = Math.floor(i / perBand) % (BANDS - 1);
      const c = overdrive >= 0 ? MODE_COLORS[band] : tmpColor.setRGB(1, 1, 1);
      this.bandColors[i * 3] = c.r;
      this.bandColors[i * 3 + 1] = c.g;
      this.bandColors[i * 3 + 2] = c.b;
    }
    this.bandMesh.geometry.getAttribute('color').needsUpdate = true;
  }

  /** Render-only: reads the ship's Tungsten state and never writes it. */
  pose(time: number, ship?: Ship): void {
    const t = ship?.alive && !ship.withdrawn ? ship.tungsten : null;
    const now = ship?.game.renderTime ?? time;
    const anim = this.reduce ? 0 : time;
    const mode = t?.mode ?? 0;
    const over = !!ship && !!t && overdriveOn(ship);
    const lead = t?.cubes[0];
    const away = !!lead && lead.state !== 'docked';
    const reeling = !!t?.lunge || (!!lead?.path && (lead.path.kind === 'dock' || lead.path.kind === 'home'));
    const broken = lead?.state === 'broken';
    const charge = t ? t.charge / CUBE.chargeCap : 0;
    this.sweep.apply(this.cubes[0].u, mode, now, this.reduce);
    const base = this.sweep.color(now, tmpColor);
    // The magnet hums brighter while it is pulling, and stutters while the cube is shattered.
    let power = 1.5 + charge * 1.2 + (reeling ? 1.4 : 0) + (away ? 0.25 : 0) + (over ? 0.8 : 0);
    power *= 1 + 0.08 * Math.sin(anim * (over ? 9 : 2.4));
    if (broken) power *= 0.35 + (this.reduce ? 0.2 : 0.4 * Math.max(0, Math.sin(anim * 31) * Math.sin(anim * 7.3)));
    if (!ship?.alive && ship) power = 0;
    this.glow.color.copy(base).multiplyScalar(power);
    this.paintBands(over ? 1 : -1);
    if (over) this.bands.color.setScalar(power * (1 + 0.25 * Math.sin(anim * 14)));
    else this.bands.color.copy(base).multiplyScalar(power * 1.15);

    for (let slot = 0; slot < this.cubes.length; slot++) {
      const v = this.cubes[slot];
      const c = t?.cubes.find((k) => k.slot === slot && !k.gone);
      const docked = c?.state === 'docked';
      // A shattered cube re-forms in the cradle over its last two seconds.
      const reforming = !!c && c.state === 'broken' && slot === 0 && c.reform < 2;
      // Overdrive ring cubes assemble when they arrive and dissolve when they leave; the cradle cube just docks.
      const present = !!ship && !!c && docked;
      if (present !== v.present) {
        v.present = present;
        v.since = now;
      }
      if (c) v.mode = c.mode;
      const fade = slot === 0 ? (present ? 1 : 0) : present ? Math.min(1, (now - v.since) / 0.5) : 1 - Math.min(1, (now - v.since) / 0.6);
      const solid = reforming ? Math.max(0.02, 1 - c!.reform / 2) : this.reduce ? (present ? 1 : 0) : fade;
      v.mesh.visible = !!ship && (reforming || solid > 0.001);
      if (!v.mesh.visible) continue;
      const lift = c && t ? slamLift(t, c.id) : 0;
      if (slot === 0) v.mesh.position.set(0, ship!.spec.freeboard + 6 + CUBE.edge / 2 + lift, 0);
      else {
        const a = ((slot - 1) / 5) * Math.PI * 2;
        // Matches dockPoint: local x forward, z starboard.
        v.mesh.position.set(Math.cos(a) * CUBE.ringRadius, ship!.spec.freeboard + 6 + CUBE.edge / 2 + CUBE.ringLift + lift + (this.reduce ? 0 : Math.sin(anim * 1.4 + slot) * 2), Math.sin(a) * CUBE.ringRadius);
      }
      v.mesh.rotation.set(0, slot && !this.reduce ? anim * 0.3 + slot : 0, 0);
      if (slot) v.sweep.apply(v.u, v.mode, now, this.reduce);
      v.u.uTime.value = anim;
      v.u.uPower.value = 1.2 + charge * 1.6 + (over ? 0.5 : 0);
      v.u.uAssemble.value = solid;
      v.u.uFlicker.value = c && c.hp < c.maxHp * 0.3 ? 1 - c.hp / (c.maxHp * 0.3) : 0;
      v.u.uHeat.value = 0;
    }
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    for (const c of this.cubes) c.material.dispose();
    this.metal.dispose();
    this.glow.dispose();
    this.bands.dispose();
  }
}
