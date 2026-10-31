import { AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, type BufferGeometry, type Material, type Mesh } from 'three';
import type { ShipSpec } from '../core/types';
import type { Ship } from '../ships/Ship';
import { deckHeight, hullHalfWidth } from '../ships/HullShape';
import { CUBE, dockLift, haloAngle } from '../skills/misc/TungstenModes';
import { overdriveOn } from '../skills/misc/TungstenRuntime';
import { Parts } from './Geometry';
import { reducedMotion } from './ArchitectPose';
import { MODE_COLORS, ModeSweep, cubeGeometry, cubeSkin, storeLook, type CubeSkinUniforms } from './TungstenLook';

/** Layout of the levitation dais amidships, in hull space (x forward, y up from the waterline, z starboard). */
export const DAIS = {
  /** The deck it stands on: the Tungsten's freeboard. */
  deck: 14,
  /** Octagonal collar: circumradius of its outer face and its rim above the deck, standing over the rails. */
  rim: 40,
  rimH: 12,
  /** The emitter plate raised inside the collar, above the deck, and its field rings. */
  plate: 7,
  rings: [11, 20, 29],
  /** Four emitter horns on the collar's diagonal faces, leaning in under the cube. */
  hornR: 34,
  hornH: 7,
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

/**
 * The mass-driver spine: twin magnetic rails on low pylons, bow to stern, broken by the dais (they end in buffers at
 * its collar), wound with coils fore and aft. They stay under the collar's rim, so the cube floats clear over the dais.
 */
export const SPINE = {
  /** Rails' underside above the deck, their size and how far inboard of the hull side they run. */
  lift: 4.5,
  railH: 3,
  railW: 2.6,
  inset: 5,
  /** Furthest out from the centreline: clear of the dais's field column. */
  maxZ: 35,
  from: -186,
  to: 178,
  /** Pylons every `pitch`. The rails end `gap` either side of the dais, just off its collar. */
  pitch: 20,
  gap: 43,
  /** Coils: rings round each rail at these stations (both ends), radius and tube. */
  coils: [54, 74, 94, 114],
  coilR: 4,
  coilTube: 1.1,
} as const;

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
  /** Docked cubes by slot: 0 floats over the dais, 1..5 the Overdrive pentagon round it. */
  readonly cubes: { mesh: Mesh; material: MeshStandardMaterial; u: CubeSkinUniforms; sweep: ModeSweep; present: boolean; since: number; mode: number }[] = [];
  private owned: BufferGeometry[] = [];
  private metal = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.78, roughness: 0.36 });
  /** Horn tips, seams and capacitor collars: the mode colour. */
  private glow = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** Field veins along the deck edge: the mode colour, walking round all six in Overdrive. */
  readonly veins = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** The plate's field rings, inner to outer, each pulsing in turn. */
  private rings = DAIS.rings.map(() => new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  /** A faint column of field between the plate and the cube's base. */
  private column = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  private sweep = new ModeSweep();
  private reduce = reducedMotion();

  constructor(make: (g: BufferGeometry, m: Material) => Mesh, spec: ShipSpec) {
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

    const veins = new Parts();
    massDriver(spec, frame, glow, veins);
    add(frame.merge(), this.metal).name = 'tungsten-spine';
    add(glow.merge(), this.glow).name = 'tungsten-glow';
    add(veins.merge(), this.veins).name = 'tungsten-veins';
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
    // The column stands only while a cube floats over the dais.
    const held = !lead || lead.state === 'docked';
    const column = over ? modeWheel((anim * 0.6) % 6, tmpColor2) : tmpColor2.copy(base);
    this.column.color.copy(column).multiplyScalar(power * (held ? 0.16 + (this.reduce ? 0 : 0.05 * Math.sin(anim * 3)) : 0.04));
    // The veins carry the mode colour; in Overdrive they walk round all six.
    (over ? modeWheel((anim * 0.7) % 6, this.veins.color) : this.veins.color.copy(base)).multiplyScalar(0.6 + 0.5 * Math.min(power, 3) / 3);
    const store = t ? storeLook(t.charge / (CUBE.chargeCap * (over ? CUBE.orbit.cap : 1))).heat : 0;

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
      if (slot === 0) v.mesh.position.set(0, y, 0);
      else {
        // Matches dockPoint: local x forward, z starboard; the five wheel round the dais in a pentagon.
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
      v.u.uStore.value = store;
    }
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    for (const c of this.cubes) c.material.dispose();
    this.metal.dispose();
    this.glow.dispose();
    this.veins.dispose();
    for (const m of this.rings) m.dispose();
    this.column.dispose();
  }
}

/** Where a rail runs at hull station x: inboard of the side, out to SPINE.maxZ amidships. */
const railZ = (spec: ShipSpec, x: number) => Math.min(hullHalfWidth(spec, x) - SPINE.inset, SPINE.maxZ);
const railY = (spec: ShipSpec, x: number) => deckHeight(spec, x) + SPINE.lift;

/**
 * The Tungsten's hull fittings, in hull space: the mass-driver spine and its coils, the stepped bridge forward, the
 * reactor aft with its radiators and capacitor banks, plating seams, bow and stern work, and the field veins along
 * the deck edge. Steel goes in `frame`, mode-coloured light in `glow`, the veins in `veins`.
 */
function massDriver(spec: ShipSpec, frame: Parts, glow: Parts, veins: Parts): void {
  const S = SPINE;
  const fb = spec.freeboard;
  const segment = (p: Parts, x0: number, x1: number, side: number, h: number, w: number, dy: number, dz: number, paint: number) => {
    const z0 = side * (railZ(spec, x0) + dz),
      z1 = side * (railZ(spec, x1) + dz);
    const len = Math.hypot(x1 - x0, z1 - z0);
    p.box(len + 0.4, h, w, (x0 + x1) / 2, (railY(spec, x0) + railY(spec, x1)) / 2 + dy, (z0 + z1) / 2, paint, { ry: -Math.atan2(z1 - z0, x1 - x0) });
  };
  for (const side of [-1, 1]) {
    // The rails: a dark body, a copper conductor along its crown and a lit seam on its inner face, aft and forward of
    // the dais, each run ending in a buffer at the collar.
    for (const [from, to] of [
      [S.from, -S.gap],
      [S.gap, S.to],
    ]) {
      for (let x = from; x < to; x += 8) {
        const x1 = Math.min(to, x + 8);
        segment(frame, x, x1, side, S.railH, S.railW, 0, 0, DARK);
        segment(frame, x, x1, side, 0.5, 1.1, S.railH, 0, COPPER);
        segment(glow, x, x1, side, 0.5, 0.3, S.railH * 0.45, -S.railW / 2 - 0.05, 0xffffff);
      }
    }
    for (const x of [-S.gap, S.gap]) frame.box(4, S.lift + S.railH + 0.8, S.railW + 2.4, x, deckHeight(spec, x) - 0.2, side * railZ(spec, x), STEEL, { taper: 0.2 });
    // Pylons down to the deck.
    for (let x = S.from + 6; x <= S.to - 6; x += S.pitch) {
      if (Math.abs(x) < S.gap + 4) continue;
      const deck = deckHeight(spec, x),
        z = side * railZ(spec, x);
      frame.box(4.5, S.lift + 0.4, 3.2, x, deck - 0.2, z, STEEL, { taper: 0.35 });
      frame.box(6, 1.2, 5, x, deck, z, DARK);
    }
    // Coils: copper rings round the rail with a band of field light inside, four forward and four aft.
    for (const at of S.coils)
      for (const x of [at, -at]) {
        const z = side * railZ(spec, x),
          y = railY(spec, x) + S.railH / 2;
        const dz = side * (railZ(spec, x + 1) - railZ(spec, x - 1)) / 2;
        const ry = -Math.atan2(dz, 1);
        frame.add(new TorusGeometry(S.coilR, S.coilTube, 6, 18).rotateY(Math.PI / 2), COPPER, x, y, z, { ry });
        frame.add(new CylinderGeometry(S.coilR + 0.6, S.coilR + 0.6, 1.2, 18, 1, true).rotateZ(Math.PI / 2), DARK, x, y, z, { ry });
        glow.add(new TorusGeometry(S.coilR - S.coilTube - 0.15, 0.35, 4, 18).rotateY(Math.PI / 2), 0xffffff, x, y, z, { ry });
      }
  }
  // The muzzle at the bow, where the rails meet: a ring round the line of fire.
  const mx = S.to + 2,
    my = railY(spec, S.to) + S.railH / 2;
  frame.add(new TorusGeometry(6, 1.4, 8, 24).rotateY(Math.PI / 2), STEEL, mx, my, 0);
  glow.add(new TorusGeometry(4.4, 0.45, 4, 24).rotateY(Math.PI / 2), 0xffffff, mx, my, 0);
  frame.box(6, my - deckHeight(spec, mx) - 6, 3, mx, deckHeight(spec, mx) - 0.2, 0, STEEL, { taper: 0.3 });
  // Bow work: a raked prow cap, bitts and a stem light.
  frame.box(26, 1.6, 10, S.to - 14, deckHeight(spec, S.to - 14) - 0.4, 0, DARK, { taper: 0.4, slope: 3 });
  for (const side of [-1, 1]) frame.cyl(0.9, 1, 1.6, 150, deckHeight(spec, 150), side * 8, BRASS, { seg: 8 });
  glow.sphere(0.8, S.to + 10, deckHeight(spec, S.to + 10) + 1, 0, 0xffffff);

  // The bridge: stepped and angular over the hit-box blocks, with a window strip, a sensor dome and a raked antenna.
  const [low, high] = spec.model.blocks;
  frame.box(low.len, low.h + 0.3, low.w, low.x, fb - 0.3, 0, STEEL, { taper: 0.12, slope: 3 });
  frame.box(low.len * 0.94, 0.4, low.w * 0.92, low.x - 1, fb + low.h, 0, DARK);
  frame.box(high.len, high.h, high.w, high.x, fb + high.y!, 0, STEEL, { taper: 0.16, slope: 2.4 });
  glow.box(high.len * 0.86, 1.1, high.w * 0.93 + 0.6, high.x, fb + high.y! + high.h * 0.55, 0, 0xffffff);
  glow.box(low.len * 0.3, 0.8, low.w + 0.4, low.x + low.len * 0.28, fb + low.h * 0.55, 0, 0xffffff);
  const roof = fb + high.y! + high.h;
  frame.box(high.len * 0.6, 0.6, high.w * 0.6, high.x - 2, roof, 0, DARK);
  frame.sphere(3.6, high.x + 4, roof + 1.4, 0, 0xc9d0d6, { sy: 0.8 });
  for (const [dx, h, lean] of [
    [-6, 8, 0.32],
    [-9, 6.5, 0.4],
    [-11.5, 5, 0.48],
  ] as const)
    frame.cyl(0.22, 0.3, h, high.x + dx, roof + 0.3, 0, STEEL, { seg: 5, rz: lean });

  // The reactor aft: a banded core on its housing, radiator fin stacks fore and aft of it, capacitor banks beside.
  const r = spec.model.blocks[2];
  const top = fb + r.h;
  frame.box(r.len, r.h + 0.3, r.w, r.x, fb - 0.3, 0, DARK, { taper: 0.08 });
  frame.box(r.len * 0.96, 0.5, r.w * 0.96, r.x, top - 0.2, 0, STEEL);
  frame.cyl(9, 10, 11, r.x, top, 0, STEEL, { seg: 16 });
  frame.cyl(6, 9, 1.6, r.x, top + 11, 0, DARK, { seg: 16 });
  for (const k of [2.5, 5.5, 8.5]) glow.cyl(9.6 - k * 0.06, 9.8 - k * 0.06, 1, r.x, top + k, 0, 0xffffff, { seg: 16 });
  glow.cyl(3, 3, 0.4, r.x, top + 12.6, 0, 0xffffff, { seg: 12 });
  for (const fx of [r.x - r.len / 2 + 6, r.x + r.len / 2 - 6])
    for (let z = -12; z <= 12; z += 2) frame.box(9, 8 - Math.abs(z) * 0.18, 0.5, fx, top, z, z % 4 ? STEEL : PLATE_STEEL);
  for (const side of [-1, 1])
    for (let x = -88; x <= -48; x += 8) {
      const deck = deckHeight(spec, x);
      frame.cyl(2.3, 2.5, 8, x, deck, side * 25, DARK, { seg: 10 });
      frame.cyl(2.6, 2.6, 0.8, x, deck + 8, side * 25, BRASS, { seg: 10 });
      glow.cyl(2.55, 2.55, 0.5, x, deck + 6, side * 25, 0xffffff, { seg: 10 });
    }

  // Stern: thruster pods through the transom with glowing nozzles, and buffer blocks where the rails end.
  for (const side of [-1, 1]) {
    frame.barrel(5, 4.2, 14, -spec.length / 2 - 6, 3, side * 11, DARK, 14);
    glow.add(new CylinderGeometry(3.4, 3.4, 0.4, 14).rotateZ(Math.PI / 2), 0xffffff, -spec.length / 2 - 6.1, 3, side * 11);
    frame.box(6, S.lift + S.railH, 5, S.from - 2, deckHeight(spec, S.from) - 0.2, side * railZ(spec, S.from), STEEL, { taper: 0.2 });
  }

  // Plating seams down both sides, a strake along them, the field veins at the deck edge and the light strip a little
  // below it, both in the mode colour.
  const n = Math.round(Math.min(40, Math.max(12, spec.length / 10))),
    seg = (spec.length * 0.86) / n;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = -spec.length * 0.43 + seg * (i + 0.5);
      veins.box(seg * 1.02, 0.35, 0.1, x, fb * 0.72, side * (hullHalfWidth(spec, x) + 0.06), 0xffffff);
    }
    for (let x = -spec.length / 2 + 15; x < spec.length / 2 - 15; x += 25) frame.box(0.35, fb - 1.6, 0.25, x, 0.8, side * (hullHalfWidth(spec, x) + 0.04), PLATE_STEEL);
    for (let x = -spec.length / 2 + 6; x < spec.length / 2 - 12; x += 10) {
      const x1 = x + 10;
      const z0 = hullHalfWidth(spec, x),
        z1 = hullHalfWidth(spec, x1);
      const ry = -Math.atan2(side * (z1 - z0), 10);
      frame.box(Math.hypot(10, z1 - z0) + 0.2, 0.5, 0.3, x + 5, fb * 0.42, side * ((z0 + z1) / 2 + 0.05), PLATE_STEEL, { ry });
      veins.box(Math.hypot(10, z1 - z0) + 0.2, 0.3, 0.9, x + 5, (deckHeight(spec, x) + deckHeight(spec, x1)) / 2 + 0.05, side * ((z0 + z1) / 2 - 1.4), 0xffffff, { ry });
    }
  }
}
