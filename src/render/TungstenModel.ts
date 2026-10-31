import { AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, type BufferGeometry, type Material, type Mesh } from 'three';
import type { Ship } from '../ships/Ship';
import { CUBE, dockLift, haloAngle } from '../skills/misc/TungstenModes';
import { overdriveOn } from '../skills/misc/TungstenRuntime';
import { Parts } from './Geometry';
import { reducedMotion } from './ArchitectPose';
import { MODE_COLORS, ModeSweep, cubeGeometry, cubeSkin, type CubeSkinUniforms } from './TungstenLook';

/** Layout of the levitation dais amidships, in hull space (x forward, y up from the waterline, z starboard). */
export const DAIS = {
  /** The deck it stands on: the Tungsten's freeboard. */
  deck: 14,
  /** Octagonal collar: circumradius of its outer face and its rim above the deck. */
  rim: 40,
  rimH: 5,
  /** The emitter plate sunk inside the collar, above the deck, and its field rings. */
  plate: 1.6,
  rings: [11, 20, 29],
  /** Four emitter horns on the collar's diagonal faces, leaning in under the cube. */
  hornR: 34,
  hornH: 13,
  hornLean: 0.42,
} as const;

/** Centre of the cube floating over the dais, and its base. */
const LIFT = dockLift({ freeboard: DAIS.deck });
const BASE = LIFT - CUBE.edge / 2;
const PLATE = DAIS.deck + DAIS.plate;

/** The horns' glowing tips in hull space: the field arcs leap from them to the cube. */
export const HORN_TIPS: readonly { x: number; y: number; z: number }[] = [1, 3, 5, 7].map((k) => {
  const a = (k * Math.PI) / 4,
    r = DAIS.hornR - DAIS.hornH * Math.sin(DAIS.hornLean);
  return { x: Math.cos(a) * r, y: DAIS.deck + DAIS.rimH + DAIS.hornH * Math.cos(DAIS.hornLean), z: Math.sin(a) * r };
});

const STEEL = 0x59616b,
  DARK = 0x2c3138,
  PLATE_STEEL = 0x3a4048,
  COPPER = 0xb4642c,
  BRASS = 0x9c7b3e,
  INSULATOR = 0xd9d4c8;
const tmpColor = new Color();
const tmpColor2 = new Color();

/** A colour walking round the six modes: `u` in [0, 6), one mode per unit. */
function modeWheel(u: number, out: Color): Color {
  const i = Math.floor(u) % 6;
  return out.copy(MODE_COLORS[i]).lerp(MODE_COLORS[(i + 1) % 6], u - Math.floor(u));
}

/**
 * The Tungsten's levitation dais: a sunken octagonal well amidships whose emitter plate and four horns hold the
 * cube floating and turning over the deck, with nothing above it. Field rings pulse outward in the cube's mode
 * colour (all six in Overdrive). The docked cubes are drawn here so they ride the hull's motion.
 */
export class TungstenModel {
  readonly root = new Group();
  /** Docked cubes by slot: 0 floats over the dais (in the halo with the rest during Overdrive), 1..5 the Overdrive halo. */
  readonly cubes: { mesh: Mesh; material: MeshStandardMaterial; u: CubeSkinUniforms; sweep: ModeSweep; present: boolean; since: number; mode: number }[] = [];
  private owned: BufferGeometry[] = [];
  private metal = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.78, roughness: 0.36 });
  /** Horn tips, seams and capacitor collars: the mode colour. */
  private glow = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** The plate's field rings, inner to outer, each pulsing in turn. */
  private rings = DAIS.rings.map(() => new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  /** A faint column of field between the plate and the cube's base. */
  private column = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  private sweep = new ModeSweep();
  private reduce = reducedMotion();

  constructor(make: (g: BufferGeometry, m: Material) => Mesh) {
    this.root.name = 'tungsten-dais';
    const add = (g: BufferGeometry, m: Material) => {
      this.owned.push(g);
      const mesh = make(g, m);
      this.root.add(mesh);
      return mesh;
    };
    const D = DAIS;
    const frame = new Parts(),
      glow = new Parts();
    const oct = Math.PI / 8;

    // The well: a low octagonal plinth walled by a collar, with the emitter plate sunk inside it.
    frame.cyl(D.rim, D.rim + 2, 2, 0, D.deck - 0.4, 0, DARK, { seg: 8, ry: oct });
    const wallR = D.rim * Math.cos(oct) - 3.5;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      frame.box(2 * (wallR + 3.5) * Math.tan(oct) + 0.6, D.rimH, 7, Math.cos(a) * wallR, D.deck, Math.sin(a) * wallR, STEEL, { ry: -a - Math.PI / 2, taper: 0.08 });
      // A lit seam along the collar's inner lip.
      glow.box(2 * (wallR - 3.6) * Math.tan(oct), 0.5, 0.4, Math.cos(a) * (wallR - 3.6), D.deck + D.rimH - 1.2, Math.sin(a) * (wallR - 3.6), 0xffffff, { ry: -a - Math.PI / 2 });
    }
    frame.cyl(wallR - 3.4, wallR - 3.4, D.plate, 0, D.deck, 0, PLATE_STEEL, { seg: 8, ry: oct });
    // Radial vanes across the rings, and a raised hub.
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + oct,
        r = (D.rings[0] + D.rings[2]) / 2;
      frame.box(D.rings[2] - D.rings[0] + 4, 0.9, 1.6, Math.cos(a) * r, PLATE, Math.sin(a) * r, DARK, { ry: -a });
    }
    frame.cyl(6, 7.5, 1.6, 0, PLATE, 0, STEEL, { seg: 8, ry: oct });
    glow.cyl(3.2, 3.2, 0.4, 0, PLATE + 1.6, 0, 0xffffff, { seg: 16 });

    // Horns: tapered emitters on the four diagonal faces, banded in copper, each tipped with a glowing node.
    for (let k = 0; k < 4; k++) {
      const a = ((2 * k + 1) * Math.PI) / 4,
        x = Math.cos(a) * D.hornR,
        z = Math.sin(a) * D.hornR,
        y = D.deck + D.rimH;
      const lean = { ry: -a, rz: D.hornLean };
      frame.box(11, 3, 11, x, y - 0.5, z, DARK, { ry: -a });
      frame.box(8, D.hornH, 7, x, y, z, STEEL, { ...lean, taper: 0.55 });
      for (const [h, w] of [
        [0.3, 7.8],
        [0.55, 6.4],
      ] as const)
        frame.add(new BoxGeometry(w, 1.4, w * 0.9).translate(0, D.hornH * h, 0), COPPER, x, y, z, lean);
      const tip = HORN_TIPS[k];
      glow.sphere(2.2, tip.x, tip.y, tip.z, 0xffffff);
      frame.cyl(2.6, 2.6, 0.8, tip.x, tip.y - 2.4, tip.z, BRASS, { seg: 10 });
    }

    // Cable trunks aft to the reactor, clamped to the deck, and the capacitor stacks beside it.
    for (const side of [-1, 1]) {
      frame.box(58, 3, 4.5, -66, D.deck, side * 15, DARK);
      for (let x = -90; x <= -44; x += 11.5) frame.box(2, 4, 6.5, x, D.deck, side * 15, BRASS);
      for (const x of [-104, -140]) {
        frame.cyl(4.6, 5.2, 16, x, D.deck, side * 25, DARK, { seg: 14 });
        frame.cyl(5.4, 5.4, 1.4, x, D.deck + 10, side * 25, BRASS, { seg: 14 });
        frame.sphere(4.2, x, D.deck + 16, side * 25, STEEL, { sy: 0.45 });
        glow.cyl(5.5, 5.5, 1, x, D.deck + 13, side * 25, 0xffffff, { seg: 14 });
        for (let k = 0; k < 3; k++) frame.cyl(1.4, 1.4, 1.6, x, D.deck + 17.6 + k * 1.9, side * 25, INSULATOR, { seg: 6 });
      }
    }

    add(frame.merge(), this.metal);
    add(glow.merge(), this.glow);
    this.rings.forEach((m, i) => {
      add(new TorusGeometry(D.rings[i], 0.75, 4, 64).rotateX(Math.PI / 2).translate(0, PLATE + 0.5, 0), m).name = `tungsten-field-ring-${i}`;
    });
    // The column fades from the plate up toward the cube's base, flaring slightly.
    const h = BASE - 1 - PLATE;
    const col = new CylinderGeometry(D.rings[2] + 6, D.rings[2], h, 8, 6, true).rotateY(oct).translate(0, PLATE + h / 2, 0);
    const pos = col.getAttribute('position');
    const shade = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) shade.fill(1 - (pos.getY(i) - PLATE) / h, i * 3, i * 3 + 3);
    col.setAttribute('color', new Float32BufferAttribute(shade, 3));
    const column = add(col, this.column);
    column.name = 'tungsten-field-column';
    column.castShadow = column.receiveShadow = false;
    column.renderOrder = 2;

    // Six cube bodies: one over the dais and the Overdrive halo. Hidden until a cube docks in that slot.
    for (let slot = 0; slot < 6; slot++) {
      const { material, u } = cubeSkin();
      const mesh = make(cubeGeometry(), material);
      mesh.name = `tungsten-cube-docked-${slot}`;
      mesh.scale.setScalar(CUBE.edge);
      mesh.visible = false;
      this.root.add(mesh);
      this.cubes.push({ mesh, material, u, sweep: new ModeSweep(), present: false, since: -1e9, mode: 0 });
    }
    this.pose(0);
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
    const spent = !!t?.spent;
    const charge = t ? t.charge / CUBE.chargeCap : 0;
    this.sweep.apply(this.cubes[0].u, mode, now, this.reduce);
    const base = this.sweep.color(now, tmpColor);
    // The dais hums brighter while it pulls, and stutters while the cube is shattered or spent.
    let power = 1.5 + charge * 1.2 + (reeling ? 1.4 : 0) + (away ? 0.25 : 0) + (over ? 0.8 : 0);
    power *= 1 + 0.08 * Math.sin(anim * (over ? 9 : 2.4));
    if (broken || spent) power *= (spent ? 0.3 : 0.35) + (this.reduce ? 0.2 : 0.4 * Math.max(0, Math.sin(anim * 31) * Math.sin(anim * 7.3)));
    if (ship && !ship.alive) power = 0;
    this.glow.color.copy(base).multiplyScalar(power);
    // Rings pulse outward, inner first; in Overdrive each walks round the six mode colours.
    this.rings.forEach((m, i) => {
      const pulse = this.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(anim * 2.2 - i * 1.1);
      const c = over ? modeWheel((anim * 0.9 + i * 2) % 6, tmpColor2) : tmpColor2.copy(base);
      m.color.copy(c).multiplyScalar(power * (0.55 + 0.9 * pulse * pulse));
    });
    // The column stands only while a cube floats over the dais; in Overdrive the dais stands empty, feeding the halo.
    const held = !over && (!lead || lead.state === 'docked');
    const column = over ? modeWheel((anim * 0.6) % 6, tmpColor2) : tmpColor2.copy(base);
    this.column.color.copy(column).multiplyScalar(power * (held ? 0.16 + (this.reduce ? 0 : 0.05 * Math.sin(anim * 3)) : 0.04));

    for (let slot = 0; slot < this.cubes.length; slot++) {
      const v = this.cubes[slot];
      const c = t?.cubes.find((k) => k.slot === slot && !k.gone);
      const docked = c?.state === 'docked';
      // A shattered cube re-forms over the dais in its last two seconds.
      const reforming = !!c && c.state === 'broken' && slot === 0 && c.reform < 2;
      // Halo cubes assemble when they arrive and dissolve when they leave; the main cube just docks.
      // With no ship (the menu preview), the main cube floats docked.
      const present = ship ? docked : slot === 0;
      if (present !== v.present) {
        v.present = present;
        v.since = now;
      }
      if (c) v.mode = c.mode;
      const fade = slot === 0 ? (present ? 1 : 0) : present ? Math.min(1, (now - v.since) / 0.5) : 1 - Math.min(1, (now - v.since) / 0.6);
      const solid = reforming ? Math.max(0.02, 1 - c!.reform / 2) : this.reduce ? (present ? 1 : 0) : fade;
      v.mesh.visible = reforming || solid > 0.001;
      if (!v.mesh.visible) continue;
      // It turns on the sim's clock (see dockPose); bobbing and rocking are drawing only.
      const y = LIFT + (this.reduce ? 0 : Math.sin(anim * 1.1 + slot * 1.7) * 2.5);
      if (slot === 0 && !over) v.mesh.position.set(0, y, 0);
      else {
        // Matches dockPoint: local x forward, z starboard. In Overdrive all six share the halo.
        const a = haloAngle(slot, now);
        v.mesh.position.set(Math.cos(a) * CUBE.ringRadius, y + CUBE.ringLift, Math.sin(a) * CUBE.ringRadius);
      }
      const rock = (k: number) => (this.reduce ? 0 : Math.sin(anim * (0.7 + k * 0.23) + slot + k) * 0.035);
      v.mesh.rotation.set(rock(0), this.reduce ? 0 : now * CUBE.spin, rock(1));
      if (slot) v.sweep.apply(v.u, v.mode, now, this.reduce);
      v.u.uTime.value = anim;
      v.u.uPower.value = (1.2 + charge * 1.6 + (over ? 0.5 : 0)) * (spent && slot === 0 ? 0.35 : 1);
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
    for (const m of this.rings) m.dispose();
    this.column.dispose();
  }
}
