import {
  CylinderGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  TorusGeometry, Vector2, Vector3, type BufferGeometry, type Material,
} from 'three';
import type { ShipSpec } from '../core/types';
import type { Ship } from '../ships/Ship';
import { GOURMAND } from '../skills/misc/GourmandRuntime';
import { lampBearing, PHAROS } from '../skills/misc/PharosRuntime';
import { deckHeight, hullHalfWidth } from '../ships/HullShape';
import { Parts } from './Geometry';
import { reducedMotion } from './ArchitectPose';
import { chain, inscription, PHAROS_LAMP, pipe, rod, silhouette, slab, TITAN_PALETTES, titanHull, volume, type Point, type TitanPalette } from './MiscTitanGeometry';

const IDS = new Set(['judge', 'hexweaver', 'gourmand', 'faultline', 'pharos']);
const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;

/** What the Hexweaver's effigy copies from one bound enemy's doll. */
interface Mirror {
  pins: number;
  flinch: number;
  twist: number;
}

const STILL: Mirror = { pins: 0, flinch: 0, twist: 0 };

/** The doll the effigy mirrors: the targeted enemy's, else the one holding the most pins. */
function effigyMirror(ship: Ship, reduce: boolean): Mirror {
  const dolls = ship.hexweaver?.dolls;
  const now = ship.game?.time;
  if (!dolls?.length || now === undefined) return STILL;
  const d = dolls.find((x) => x.target === ship.control?.targetId) ?? dolls.reduce((a, b) => (b.pins > a.pins ? b : a));
  const fade = (age: number, span: number) => Math.max(0, Math.min(1, 1 - age / span));
  return { pins: d.pins, flinch: reduce ? 0 : fade(now - d.struck, 0.45), twist: reduce ? 0 : fade(now - d.twistedAt, 1) };
}

interface Jaw {
  /** 1 while the mouth hangs open: Devour, Banquet or a bite about to land. */
  gape: number;
  /** 1 the instant a chomp lands, easing back open; a swallowed ship keeps it chewing. */
  snap: number;
}

const SHUT: Jaw = { gape: 0, snap: 0 };

/** How the Gourmand's jaws stand, read from its state: open while it eats, snapping on each chomp. */
function gourmandJaw(ship: Ship, reduce: boolean): Jaw {
  const a = ship.gourmand;
  const now = ship.game?.time;
  if (!a || now === undefined) return SHUT;
  const gape = a.mouthUntil > now || a.banquetUntil > now || a.bite ? 1 : 0;
  let snap = 0;
  if (a.mouthUntil > now) snap = Math.max(0, 1 - (now - (a.chompNext - GOURMAND.devour.tick)) / 0.15);
  if (a.swallow) snap = reduce ? 0.6 : 0.5 + 0.5 * Math.sin(now * 6);
  return { gape, snap: reduce && !a.swallow ? 0 : Math.min(1, snap) };
}

interface Lamp {
  /** The lens's turn from the bow; null in the hangar, where it idles round. */
  angle: number | null;
  /** 1 while the shutters are down. */
  dark: number;
  twin: boolean;
  /** Daybreak: half while it winds up, 1 while it burns. */
  white: number;
}

const IDLE_LAMP: Lamp = { angle: null, dark: 0, twin: false, white: 0 };

/** How the Pharos's lantern stands, read from its state: the lens points down the beam. */
function pharosLamp(ship: Ship): Lamp {
  const a = ship.pharos;
  const now = ship.game?.time;
  if (!a || now === undefined) return IDLE_LAMP;
  return { angle: ship.renderHeading - lampBearing(ship), dark: a.darkUntil > now ? 1 : 0, twin: a.twinUntil > now, white: a.daybreak ? (a.daybreak.started ? 1 : 0.5) : 0 };
}

export function isMiscTitan(id: string): boolean { return IDS.has(id); }

/** Complete, read-only procedural replacement models. Local +X is bow, +Y up and +Z starboard. */
export class MiscTitanModel {
  readonly group = new Group();
  private readonly art = new Group();
  private readonly owned = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly metal = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: .67, roughness: .43 });
  private readonly glow = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  private readonly fabric = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .94, metalness: .04 });
  private readonly palette: TitanPalette;
  private readonly reduce = reducedMotion();
  private readonly id: string;
  private pose: (time: number, activity: number, ultimate: number, slots: readonly number[]) => void = () => {};
  private readonly cooldowns: number[] = [];
  private readonly meters: number[] = [];
  private readonly impulses: number[] = [];
  private pinRecharge = 0;
  private mirror: Mirror = STILL;
  private jaw: Jaw = SHUT;
  private lamp: Lamp = IDLE_LAMP;
  /** How far the Pharos's shutters have dropped, 0 to 1, and whether its lamp burns at all. */
  private shutter = 0;
  private burning = 1;
  private activity = 0;
  private ultimate = 0;
  private disposed = false;

  constructor(spec: ShipSpec) {
    if (!isMiscTitan(spec.id)) throw new Error(`No misc titan model for ${spec.id}`);
    this.id = spec.id;
    this.palette = TITAN_PALETTES[spec.id];
    this.group.name = `${spec.id}-model`;
    this.art.name = `${spec.id}-machinery`;
    // Keeping the keel in simulation metres preserves the waterline and collision silhouette.
    // Deck machinery is authored at 400 × 80 m and scales to the selected hull.
    this.art.position.y = spec.freeboard;
    this.art.scale.set(spec.length / 400, Math.max(.85, Math.min(1.2, spec.beam / 80)), spec.beam / 80);
    this.group.add(this.art);
    for (const material of [this.metal, this.glow, this.fabric]) this.materials.add(material);
    this.add(titanHull(spec, this.palette), this.group, this.metal, `${spec.id}-hull`);
    this.buildHullFittings(spec);
    if (this.id === 'judge') this.buildJudge();
    else if (this.id === 'hexweaver') this.buildHexweaver();
    else if (this.id === 'gourmand') this.buildGourmand();
    else if (this.id === 'pharos') this.buildPharos(spec);
    else this.buildFaultline();
    this.pose(0, 0, 0, []);
  }

  private add(source: Parts | BufferGeometry, parent: Group = this.art, material: Material = this.metal, name?: string): Mesh {
    const geometry = source instanceof Parts ? source.merge() : source;
    this.owned.add(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = name ?? `${this.id}-${material === this.glow ? 'light' : 'structure'}`;
    mesh.castShadow = material !== this.glow;
    mesh.receiveShadow = material !== this.glow;
    parent.add(mesh);
    return mesh;
  }

  private joint(name: string, x: number, y: number, z: number, parent: Group = this.art): Group {
    const group = new Group();
    group.name = `${this.id}-${name}`;
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }

  private buildHullFittings(spec: ShipSpec): void {
    const p = this.palette, frame = new Parts(), lights = new Parts();
    const sx = this.art.scale.x, sy = this.art.scale.y, sz = this.art.scale.z;
    for (const side of [-1, 1]) {
      const edge: Point[] = [];
      for (let x = -184; x <= 184; x += 8) {
        const z = hullHalfWidth(spec, x * sx) / sz, y = (deckHeight(spec, x * sx) - spec.freeboard) / sy;
        edge.push([x, y + 1.3, side * (z - 1.1)]);
      }
      pipe(frame, edge, .95, p.trim);
      pipe(lights, edge.map(([x, y, z]) => [x, y - 3.4, z] as const), .43, p.light);
      for (let x = -158; x <= 142; x += 25) {
        const z = hullHalfWidth(spec, x * sx) / sz;
        frame.box(15, 5, 1.8, x, -5, side * (z - .5), p.edge, { taper: .12 });
        for (const dx of [-4.5, 4.5]) frame.add(new CylinderGeometry(.6, .6, 1, 6).rotateX(Math.PI / 2), p.trim, x + dx, -1.8, side * (z + .5));
      }
      frame.box(34, 5, 10, -165, 0, side * 13, p.dark, { taper: .16 });
      for (let x = -178; x < -151; x += 4.5) frame.box(1.3, 1.4, 8, x, 5, side * 13, p.edge);
      frame.box(18, 2, 8, -95, .5, side * 25, p.dark, { taper: .1 });
      frame.box(16, 1, 6, -95, 2.5, side * 25, p.armor);
      for (let i = 0; i < 3; i++) frame.box(1, 1.3, 6, -100 + i * 5, 3.5, side * 25, p.trim);
      // Stern bollards and fairleads keep these enormous assemblies recognizably sea-going.
      for (const x of [-180, 164]) {
        const z = hullHalfWidth(spec, x * sx) / sz * .69;
        frame.box(8, 1.1, 6, x, 1, side * z, p.edge);
        for (const dx of [-2, 2]) { frame.cyl(1.1, 1.1, 4, x + dx, 2, side * z, p.dark); frame.cyl(1.6, 1.6, .9, x + dx, 5.5, side * z, p.trim); }
      }
    }
    this.add(frame, this.art, this.metal, `${this.id}-hull-fittings`);
    this.add(lights, this.art, this.glow, `${this.id}-waterline-seams`);
  }

  /** Theme-specific triple batteries occupy the same fore/aft stations in each hull. */
  private battery(index: number, parent = this.art, position?: Point): Group {
    const p = this.palette, group = this.joint(`battery-${index}`, ...(position ?? [index ? -128 : 128, 2, 0] as const), parent);
    if (index) group.rotation.y = Math.PI;
    const base = new Parts(), lights = new Parts(), guns = new Parts();
    base.cyl(12, 14, 4, 0, 0, 0, p.dark, { seg: 12 });
    base.cyl(12.2, 12.2, 1, 0, 4, 0, p.trim, { seg: 12 });
    base.box(28, 11, 23, -3, 5, 0, p.armor, { taper: .2, slope: 3 });
    base.box(21, 2.2, 18, -5, 16, 0, p.edge, { taper: .13 });
    for (const side of [-1, 1]) {
      base.box(20, 6, 3, -5, 7, side * 12, p.dark);
      base.box(16, 1.5, 3.3, -5, 12, side * 12, p.trim);
      lights.box(12, 1.2, .8, -4, 14, side * 12.3, p.light);
    }
    if (this.id === 'judge') {
      for (const side of [-1, 1]) for (const x of [-10, 1]) base.cyl(1.2, 1.4, 8, x, 7, side * 12, p.pale, { seg: 8 });
      base.add(silhouette([[-16, 0], [9, 0], [-3.5, 5]], 24), p.pale, -1, 18, 0);
    } else if (this.id === 'hexweaver') {
      for (const side of [-1, 1]) for (const x of [-10, -2, 6]) rod(base, [x, 8, side * 13], [x + 5, 15, side * 11], .7, p.pale);
      base.box(19, 1.3, 5, -4, 18, 0, p.trim, { ry: .28 });
    } else if (this.id === 'gourmand') {
      base.box(8, 10, 19, -15, 8, 0, p.dark, { taper: .1 });
      for (let y = 10; y < 17; y += 3) lights.box(.5, 1, 13, -19.2, y, 0, p.light);
      for (const side of [-1, 1]) base.add(new TorusGeometry(3, .6, 5, 10), p.trim, -4, 10, side * 14);
    } else if (this.id === 'pharos') {
      // A small harbour light rides each turret.
      base.cyl(6, 7.5, 4, -7, 16, 0, p.armor, { seg: 10 });
      lights.cyl(3.6, 3.6, 3, -7, 20, 0, p.light, { seg: 10 });
      base.cyl(.8, 5, 3, -7, 23, 0, p.trim, { seg: 10 });
    } else {
      base.add(slab([[-16, -14], [7, -12], [13, -5], [8, 1], [12, 12], [-12, 13], [-19, 4]], 4), p.edge, -1, 17, 0);
      for (const side of [-1, 1]) lights.box(19, 1.1, .8, -4, 18, side * 10, p.light, { ry: side * .12 });
    }
    for (const z of [-6, 0, 6]) {
      guns.barrel(2.3, 2.3, 6, 4, 11, z, p.dark);
      guns.barrel(1.55, 1.2, 22, 9, 11, z, p.edge, 10);
      for (const x of [13, 24]) guns.barrel(1.95, 1.95, 1.4, x, 11, z, p.trim);
      guns.barrel(2, 2, 3.2, 29, 11, z, p.armor);
      guns.barrel(1.25, 1.25, .13, 32.25, 11, z, p.dark);
    }
    this.add(base, group);
    this.add(guns, group, this.metal, `${this.id}-battery-${index}-barrels`);
    this.add(lights, group, this.glow);
    return group;
  }

  private buildJudge(): void {
    const p = this.palette, frame = new Parts(), light = new Parts();
    // A raised, complete peristyle courthouse, with steps, fluted columns and a pediment.
    for (let i = 0; i < 4; i++) frame.box(119 - i * 5, 2.8, 62 - i * 4, -48, i * 2.8, 0, i % 2 ? p.pale : p.armor);
    frame.box(91, 29, 40, -51, 11, 0, p.dark);
    frame.box(94, 3, 44, -51, 39, 0, p.trim);
    for (const side of [-1, 1]) {
      for (const x of [-91, -71, -51, -31, -11]) {
        frame.box(7, 2, 7, x, 11, side * 25, p.pale);
        frame.cyl(2.2, 2.8, 25, x, 13, side * 25, p.armor, { seg: 12 });
        frame.box(7.5, 2.5, 7.5, x, 38, side * 25, p.pale);
        for (let k = 0; k < 8; k++) {
          const a = k * TAU / 8;
          rod(frame, [x + Math.cos(a) * 2.5, 15, side * 25 + Math.sin(a) * 2.5], [x + Math.cos(a) * 2.15, 36, side * 25 + Math.sin(a) * 2.15], .22, p.edge, undefined, 5);
        }
      }
      for (let x = -84; x <= -20; x += 16) {
        frame.box(6, 15, .8, x, 19, side * 20.5, p.edge);
        light.box(3, 11, .9, x, 21, side * 21, p.light);
      }
      inscription(frame, 'LEX AETERNA', 4.2, -51, 43, side * 29.5, p.trim, 'z');
      // Trussed flying buttresses tie the court to its armored hull.
      for (const x of [-84, -34]) rod(frame, [x, 13, side * 25], [x - 5, 3, side * 37], 2.1, p.edge);
    }
    frame.box(108, 5, 62, -51, 40, 0, p.armor);
    // Rotating the custom triangular extrusion puts its tympanum on the bow-facing facade.
    frame.add(silhouette([[-31, 0], [31, 0], [0, 18]], 108, .7), p.pale, -51, 45, 0, { ry: Math.PI / 2 });
    frame.add(silhouette([[-24, 0], [24, 0], [0, 12]], 1), p.dark, 3.7, 47, 0, { ry: Math.PI / 2 });
    inscription(frame, 'LEX', 5, 4.6, 48.5, 0, p.trim);
    for (const z of [-17, 17]) {
      frame.cyl(2.3, 2.7, 27, 3, 12, z, p.armor, { seg: 12 });
      frame.box(7, 2, 7, 3, 39, z, p.pale);
    }
    frame.box(1.2, 23, 15, -4, 12, 0, p.trim);
    frame.box(1.4, 20, 12, -3.1, 13, 0, p.dark);
    for (const z of [-4.5, 4.5]) frame.box(1.5, 18, .65, -2.2, 14, z, p.trim);
    // Armored legal tablets are real relief geometry with legible inscriptions.
    for (const side of [-1, 1]) {
      frame.box(32, 18, 3, 46, 5, side * 24, p.dark, { taper: .08 });
      frame.box(34, 2, 4, 46, 23, side * 24, p.trim);
      inscription(frame, 'ORDO', 5, 46, 13, side * 26, p.pale, 'z');
      inscription(light, 'LEX', 3, 46, 7.5, side * 26, p.light, 'z');
    }
    // The gavel axle sits outboard, leaving the fore battery and court facade clear.
    frame.box(21, 11, 17, 35, 0, -31, p.dark, { taper: .16 });
    for (const z of [-39, -23]) frame.box(9, 27, 5, 35, 9, z, p.armor, { taper: .16 });
    frame.add(new CylinderGeometry(7, 7, 22, 12).rotateX(Math.PI / 2), p.trim, 35, 32, -31);
    const gavel = this.joint('gavel', 35, 32, -31);
    const hammer = new Parts(), hammerLight = new Parts();
    hammer.cyl(3.3, 4.4, 80, 0, 0, 0, p.dark, { seg: 10 });
    for (let y = 8; y < 40; y += 5) hammer.cyl(4.3, 4.3, 1.6, 0, y, 0, p.trim, { seg: 10 });
    hammer.box(7, 39, 5, 0, 38, 0, p.armor, { taper: .12 });
    hammer.box(1, 33, 5.3, 0, 42, 0, p.trim);
    hammer.barrel(15, 15, 37, -18.5, 83, 0, p.dark, 16);
    for (const side of [-1, 1]) {
      hammer.barrel(18, 18, 5, side < 0 ? -24 : 19, 83, 0, p.trim, 16);
      hammer.barrel(15.5, 16.8, 3.5, side < 0 ? -27.5 : 24, 83, 0, p.armor, 16);
      hammer.barrel(11.8, 11.8, .6, side < 0 ? -28.1 : 27.5, 83, 0, p.dark, 12);
    }
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8;
      hammer.box(34, 1.2, 1.2, 0, 83 + Math.sin(a) * 15, Math.cos(a) * 15, p.trim);
    }
    inscription(hammerLight, 'LEX', 5, 0, 80, 15.7, p.light, 'z');
    this.add(hammer, gavel);
    this.add(hammerLight, gavel, this.glow);
    frame.cyl(18, 20, 19, 116, 3, -35, p.dark, { seg: 16 });
    frame.cyl(17, 17, 3, 116, 22, -35, p.trim, { seg: 16 });
    light.add(new TorusGeometry(13.5, .65, 5, 32).rotateX(Math.PI / 2), p.light, 116, 25.3, -35);
    // Scales on a tall stern clockwork mast. Pans counter-rotate to hang vertically.
    frame.box(18, 9, 18, -137, 0, 0, p.dark, { taper: .15 });
    frame.cyl(3.3, 5.5, 92, -137, 8, 0, p.trim, { seg: 8 });
    frame.box(10, 12, 12, -137, 86, 0, p.armor, { taper: .12 });
    frame.add(silhouette([[-5, 0], [0, 15], [5, 0]], 4), p.trim, -137, 101, 0);
    const balance = this.joint('scales', -137, 99, 0), balanceParts = new Parts();
    balanceParts.box(5, 4, 102, 0, -2, 0, p.trim);
    for (const side of [-1, 1]) {
      rod(balanceParts, [0, 6, 0], [0, 0, side * 48], 1, p.pale);
      balanceParts.add(new TorusGeometry(3.5, 1, 6, 12), p.trim, 0, 0, side * 47, { ry: Math.PI / 2 });
    }
    this.add(balanceParts, balance);
    const pans: Group[] = [];
    for (const side of [-1, 1]) {
      const pan = this.joint(`scale-pan-${side}`, 0, 0, side * 47, balance), panParts = new Parts();
      for (const k of [0, 1, 2]) {
        const a = k * TAU / 3;
        chain(panParts, [0, 0, 0], [Math.cos(a) * 12, -31, Math.sin(a) * 12], .85, p.trim);
      }
      panParts.add(new LatheGeometry([new Vector2(0, -35), new Vector2(6, -35), new Vector2(12, -32), new Vector2(13.5, -30), new Vector2(13, -29), new Vector2(11, -31), new Vector2(5, -33), new Vector2(0, -33)], 20), p.trim);
      panParts.add(new TorusGeometry(13, .8, 5, 24).rotateX(Math.PI / 2), p.pale, 0, -30, 0);
      this.add(panParts, pan); pans.push(pan);
    }
    // Four arrest-chain drums and freely articulated lengths of open chain.
    const arrests: Group[] = [];
    for (const side of [-1, 1]) for (const x of [-70, 62]) {
      const z = side * 37;
      frame.box(17, 9, 10, x, 1, z, p.dark, { taper: .1 });
      frame.add(new CylinderGeometry(6, 6, 9, 12).rotateZ(Math.PI / 2), p.trim, x, 11, z);
      for (const dx of [-6, 6]) frame.add(new CylinderGeometry(7.5, 7.5, 1, 12).rotateZ(Math.PI / 2), p.edge, x + dx, 11, z);
      const arrest = this.joint(`arrest-chain-${arrests.length}`, x, 8, z), links = new Parts();
      chain(links, [0, 0, 0], [8, -17, side * 8], 1.5, p.trim);
      links.add(new TorusGeometry(5.5, 1.4, 6, 16, Math.PI * 1.7), p.edge, 8, -20, side * 8, { rx: .3, rz: -.4 });
      this.add(links, arrest); arrests.push(arrest);
    }
    this.add(frame); this.add(light, this.art, this.glow);
    this.battery(0); this.battery(1);
    this.pose = (t, active, ult, slots) => {
      // The gavel swings for the court, a thrown Gavel, Martial Law, the Verdict and the Death Penalty.
      const strike = Math.max(slots[0] ?? 0, slots[1] ?? 0, slots[6] ?? 0, slots[7] ?? 0, slots[8] ?? 0, active * .3);
      // A deliberate raised backswing followed by a heavy seated strike.
      gavel.rotation.z = -.27 - strike * (1.02 + (this.reduce ? 0 : .1 * Math.sin(t * 7))) + Math.sin(t * .7) * .035;
      gavel.rotation.x = -.07 + Math.sin(t * .47) * .018;
      balance.rotation.x = Math.sin(t * .65) * .11 + Math.sin(t * 2.3) * active * .13 + ult * .18;
      pans.forEach((pan, i) => { pan.rotation.x = -balance.rotation.x + Math.sin(t * .9 + i * 2) * .025; });
      arrests.forEach((link, i) => { link.rotation.x = Math.sin(t * .8 + i) * .09 + (i < 2 ? -1 : 1) * active * .5; link.rotation.z = Math.sin(t * .6 + i) * .08; });
    };
  }

  private buildHexweaver(): void {
    const p = this.palette, wood = new Parts(), light = new Parts();
    // A timber-and-iron marionette gallows: tenons, straps, pegs and diagonal braces.
    for (const side of [-1, 1]) {
      wood.box(24, 6, 19, -46, 0, side * 29, p.dark, { taper: .16 });
      wood.box(10, 137, 10, -46, 4, side * 29, p.armor, { rz: -.055, taper: .15 });
      for (const y of [18, 42, 82, 116, 134]) wood.box(12.2, 4, 12.2, -46 + Math.sin(.055) * (y - 4), y, side * 29, p.dark);
      for (const y of [25, 65, 105]) {
        wood.box(.7, 21, 10.2, -41.1 + Math.sin(.055) * (y - 4), y, side * 29, p.edge, { rz: -.055 });
        wood.box(5, 1.6, 12.5, -44 + Math.sin(.055) * (y - 4), y + 7, side * 29, p.trim);
      }
      rod(wood, [-64, 2, side * 35], [-39, 78, side * 29], 3, p.edge, 2.4);
      rod(wood, [-39, 108, side * 29], [-13, 141, side * 50], 2.4, p.armor);
      // Bone-colored ribs around the thread wells, with ruby spool cores.
      for (const x of [-82, 61]) {
        wood.cyl(10, 12, 5, x, 0, side * 27, p.dark, { seg: 10 });
        wood.cyl(6.5, 6.5, 20, x, 5, side * 27, p.trim, { seg: 12 });
        for (const y of [5, 22]) wood.cyl(10, 10, 2, x, y, side * 27, p.pale, { seg: 12 });
        for (let y = 9; y < 22; y += 3) light.add(new TorusGeometry(6.8, .45, 4, 16).rotateX(Math.PI / 2), p.light, x, y, side * 27);
      }
    }
    wood.box(13, 11, 120, -36, 139, 0, p.armor, { taper: .06 });
    wood.box(16, 3, 124, -36, 145, 0, p.dark);
    for (const z of [-49, -29, 0, 29, 49]) {
      wood.box(16, 14, 4, -36, 138, z, p.trim);
      wood.add(new TorusGeometry(4.5, 1, 5, 16), p.edge, -27, 136, z, { ry: Math.PI / 2 });
    }
    // A ritual loom sits below the effigy, rings crossed by taut physical threads.
    wood.cyl(30, 34, 5, 0, 0, 0, p.dark, { seg: 12 });
    wood.add(new TorusGeometry(29, 1.3, 6, 48).rotateX(Math.PI / 2), p.trim, 0, 5, 0);
    light.add(new TorusGeometry(24, .65, 5, 48).rotateX(Math.PI / 2), p.light, 0, 5.5, 0);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8, b = a + TAU * 3 / 8;
      rod(light, [Math.cos(a) * 24, 5.8, Math.sin(a) * 24], [Math.cos(b) * 24, 5.8, Math.sin(b) * 24], .22, p.light, undefined, 5);
      wood.cyl(1.3, 1.8, 7, Math.cos(a) * 30, 5, Math.sin(a) * 30, p.pale, { seg: 7 });
    }
    const effigy = this.joint('effigy', 2, 72, 0), cloth = new Parts(), stitches = new Parts(), eyes = new Parts();
    cloth.add(volume([[0, 10, 13], [6, 15, 19], [21, 16, 21], [37, 12, 24], [44, 7, 10]], 18, .045), p.armor);
    cloth.add(volume([[44, 5, 6], [49, 9, 13], [58, 14, 17], [69, 12, 15], [75, 5, 8]], 18, .035), p.pale, 1, 0, 0);
    // The prominent cross stitches follow the forward belly and head seam.
    for (let y = 5; y <= 40; y += 4.5) {
      const x = y > 30 ? 13 : 16.4;
      rod(stitches, [x, y, -2.5], [x + .2, y + 2.8, 2.5], .55, p.dark, undefined, 5);
      rod(stitches, [x + .2, y + 2.8, -2.5], [x, y, 2.5], .55, p.dark, undefined, 5);
    }
    for (let y = 53; y < 72; y += 4) rod(stitches, [13.3, y, -1.6], [13.3, y + 1, 1.6], .4, p.trim, undefined, 5);
    for (const side of [-1, 1]) {
      // Button eyes sit proud of the fabric, with contrasting sewn crosses.
      stitches.add(new CylinderGeometry(4.8, 4.8, 1.5, 12).rotateZ(-Math.PI / 2), p.dark, 14, 63, side * 8);
      stitches.add(new TorusGeometry(4.1, .65, 5, 14).rotateY(Math.PI / 2), p.trim, 15, 63, side * 8);
      rod(eyes, [15.2, 60.8, side * 8 - 2.1], [15.2, 65.2, side * 8 + 2.1], .48, p.light);
      rod(eyes, [15.2, 60.8, side * 8 + 2.1], [15.2, 65.2, side * 8 - 2.1], .48, p.light);
      rod(stitches, [12.3, 53, side * 1], [10.8, 54, side * 9], .65, p.dark);
      for (let z = 3; z < 10; z += 3) rod(stitches, [12, 51.8, side * z], [12, 55, side * z], .4, p.trim);
    }
    // A patch is a separate irregular cloth panel, sewn round its perimeter.
    cloth.box(1, 11, 12, 15, 17, 10, p.trim, { rx: -.13 });
    for (let y = 18; y < 29; y += 2.5) rod(stitches, [15.7, y, 3.5], [15.7, y + 1, 6], .35, p.pale);
    for (let z = 6; z < 16; z += 2.5) rod(stitches, [15.8, 17.5, z], [15.8, 20, z + .7], .35, p.pale);
    this.add(cloth, effigy, this.fabric); this.add(stitches, effigy); this.add(eyes, effigy, this.glow);
    const limbs: Group[] = [];
    for (const side of [-1, 1]) {
      const arm = this.joint(`effigy-arm-${side}`, 0, 36, side * 21, effigy), armCloth = new Parts(), armSeams = new Parts();
      armCloth.add(volume([[-38, 3.6, 4.5], [-33, 5.5, 6], [-18, 4.6, 5], [-5, 6, 7], [2, 6.5, 7.5]], 12, .045), p.armor);
      for (const y of [-30, -14, -5]) armSeams.add(new TorusGeometry(6, .55, 5, 12).rotateX(Math.PI / 2), p.trim, 0, y, 0, { sx: .86 });
      for (let y = -34; y < -3; y += 5) rod(armSeams, [5, y, -1.5], [5, y + 2, 1.5], .4, p.pale);
      this.add(armCloth, arm, this.fabric); this.add(armSeams, arm); limbs.push(arm);
      const leg = this.joint(`effigy-leg-${side}`, 0, 1, side * 10, effigy), legCloth = new Parts(), legSeams = new Parts();
      legCloth.add(volume([[-38, 5, 6], [-34, 7, 7], [-20, 5, 5.5], [-6, 7, 8], [3, 8, 9]], 12, .03), p.armor);
      for (const y of [-30, -18, -5]) legSeams.add(new TorusGeometry(7, .6, 5, 12).rotateX(Math.PI / 2), p.pale, 0, y, 0, { sx: .82 });
      this.add(legCloth, leg, this.fabric); this.add(legSeams, leg); limbs.push(leg);
    }
    // Six oversize sewing needles have real open eyes, collars, handles and pointed shafts.
    const needles: Group[] = [];
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const needle = this.joint(`needle-${needles.length}`, -60 + i * 60, 15, side * 34), pin = new Parts(), pinLight = new Parts();
      pin.add(new TorusGeometry(3.5, 1.1, 6, 16).scale(1, 1.65, 1), p.edge, 0, 4, 0);
      pin.cyl(1.6, 2.5, 8, 0, 8, 0, p.trim, { seg: 10 });
      pin.cyl(.85, 1.35, 48, 0, 16, 0, p.edge, { seg: 10 });
      pin.cyl(0, .85, 10, 0, 64, 0, p.pale, { seg: 8 });
      pinLight.cyl(1.8, 1.8, 1.2, 0, 12, 0, p.light, { seg: 12 });
      for (let y = 20; y < 57; y += 9) pin.cyl(1.45, 1.45, .9, 0, y, 0, p.trim, { seg: 10 });
      this.add(pin, needle); this.add(pinLight, needle, this.glow); needles.push(needle);
      wood.cyl(6, 8, 7, -60 + i * 60, 0, side * 34, p.dark, { seg: 10 });
      wood.add(new TorusGeometry(5, 1, 5, 16).rotateX(Math.PI / 2), p.trim, -60 + i * 60, 8, side * 34);
    }
    // Small bound effigies on the aft rack make the curse workshop legible in the hangar.
    const dolls: Group[] = [];
    wood.box(50, 3, 4, -95, 43, 0, p.armor);
    for (const z of [-16, 0, 16]) {
      const doll = this.joint(`bound-doll-${dolls.length}`, -94, 39, z), rag = new Parts(), binding = new Parts();
      chain(binding, [0, 4, 0], [0, -1, 0], .45, p.edge);
      rag.add(volume([[-21, 2, 3], [-13, 3, 4], [-8, 2, 3], [-7, 1, 1], [-4, 3, 3], [0, 2, 2]], 8, .02), p.pale);
      for (const side of [-1, 1]) {
        rod(rag, [0, -10, side * 3], [0, -17, side * 6], 1.1, p.armor);
        rod(rag, [0, -20, side * 2], [0, -27, side * 3], 1.2, p.armor);
        rod(binding, [3, -3, side * .5], [3, -5, side * 2], .3, p.trim);
      }
      for (const y of [-10, -15, -20]) binding.add(new TorusGeometry(3.2, .45, 4, 10).rotateX(Math.PI / 2), p.trim, 0, y, 0);
      this.add(rag, doll, this.fabric); this.add(binding, doll); dolls.push(doll);
    }
    this.add(wood); this.add(light, this.art, this.glow);
    this.battery(0); this.battery(1);
    const suspension = [-1, 1].map(side => this.line(.55, this.metal, p.pale, `suspension-${side}`));
    const strings = needles.map((_, i) => this.line(.32, this.glow, p.light, `curse-thread-${i}`));
    this.pose = (t, active, ult) => {
      // The effigy mirrors one bound enemy's doll: it jolts when that ship is hurt, is wrung by a
      // Twist, and a pair of needles leans in to pierce it for each pin.
      const { pins, flinch, twist } = this.mirror;
      const jolt = flinch * flinch;
      const sway = Math.sin(t * .63) * .035 + jolt * .3 * Math.sin(t * 55 + 1);
      effigy.position.y = 72 + Math.sin(t * .91) * 1.5 + active * 5 + ult * 9 + jolt * 7;
      effigy.rotation.set(Math.sin(t * .57) * .025 + jolt * .2, Math.sin(t * .43) * .05 + active * .07 + (1 - (1 - twist) ** 2) * TAU * 1.5, sway);
      limbs.forEach((limb, i) => { const side = i < 2 ? -1 : 1, arm = i % 2 === 0; limb.rotation.x = side * (arm ? -.7 - active * .4 - jolt * .6 : .09 + jolt * .3) + Math.sin(t * .8 + i) * .055; limb.rotation.z = Math.sin(t * .72 + i * 1.7) * .05 + active * .08; });
      needles.forEach((needle, i) => {
        const side = i < 3 ? -1 : 1, index = i % 3, pierce = index < pins ? 1 : 0;
        needle.rotation.x = -side * (.46 + active * .24 + pierce * .38 + Math.sin(t * 1.1 + i) * .055);
        needle.rotation.z = (index - 1) * .46 * (1 - pierce * .4) + Math.sin(t * .87 + i * 1.4) * .045;
        needle.position.y = 15 + Math.sin(t * 1.3 + i * 1.2) * 1.8 + active * (4 + Math.sin(t * 5 + i) * 2) + pierce * 10;
        const rotation = needle.quaternion;
        const eye = new Vector3(0, 4, 0).applyQuaternion(rotation).add(needle.position);
        this.stretch(strings[i], [-60 + index * 60, 24, side * 27], [eye.x, eye.y, eye.z]);
      });
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1, shoulder = new Vector3(0, 39, side * 23).applyQuaternion(effigy.quaternion).add(effigy.position);
        this.stretch(suspension[i], [-27, 136, side * 29], [shoulder.x, shoulder.y, shoulder.z]);
      }
      dolls.forEach((doll, i) => { doll.rotation.x = Math.sin(t * .9 + i * 2) * (.12 + active * .17); doll.rotation.z = Math.cos(t * 1.1 + i) * .06; });
    };
  }

  /** A shared unit cylinder transformed between endpoints, used for ropes and telescoping machinery. */
  private line(radius: number, material: Material, color: number, name: string): Mesh {
    const parts = new Parts();
    parts.add(new CylinderGeometry(1, 1, 1, 6), color);
    const mesh = this.add(parts, this.art, material, `${this.id}-${name}`);
    mesh.scale.set(radius, 1, radius);
    return mesh;
  }

  private stretch(mesh: Mesh, a: Point, b: Point): void {
    const direction = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), length = direction.length();
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    mesh.scale.y = Math.max(.001, length);
    if (length > .001) mesh.quaternion.setFromUnitVectors(UP, direction.multiplyScalar(1 / length));
  }

  private buildGourmand(): void {
    const p = this.palette, frame = new Parts(), lights = new Parts();
    // The bow is a working reverberatory furnace: a dark throat behind two toothed jaws.
    frame.box(70, 34, 70, 72, 0, 0, p.dark, { taper: .09 });
    for (const side of [-1, 1]) {
      frame.add(silhouette([[-29, 0], [42, 0], [52, 18], [34, 53], [-23, 48]], 7, 1), p.armor, 68, 0, side * 33);
      frame.add(silhouette([[-22, 5], [35, 6], [39, 17], [25, 42], [-18, 39]], 1), p.dark, 68, 0, side * 37.2);
      for (const x of [48, 62, 76]) frame.box(4, 28, 3, x, 9, side * 38, p.trim, { rz: -.17 });
      frame.add(new CylinderGeometry(11, 11, 6, 16).rotateX(Math.PI / 2), p.edge, 106, 18, side * 37);
      frame.add(new CylinderGeometry(6, 6, 7, 12).rotateX(Math.PI / 2), p.dark, 106, 18, side * 38);
    }
    frame.box(3, 27, 58, 106, 6, 0, p.dark);
    lights.box(1, 22, 52, 108, 9, 0, p.light);
    // Recessed firebrick grate: the lit throat remains visible between iron bars.
    for (let z = -24; z <= 24; z += 6) frame.box(2.5, 26, 2, 109, 7, z, p.dark);
    for (let y = 10; y <= 28; y += 9) frame.box(2, 1.6, 52, 109.5, y, 0, p.trim);
    const upper = this.joint('upper-jaw', 104, 34, 0), lower = this.joint('lower-jaw', 103, 4, 0);
    const upperParts = new Parts(), lowerParts = new Parts(), upperFire = new Parts(), lowerFire = new Parts();
    upperParts.add(slab([[-7, -36], [30, -34], [60, -25], [80, -10], [87, 0], [80, 10], [60, 25], [30, 34], [-7, 36]], 9, 1.2), p.armor);
    upperParts.add(slab([[0, -29], [29, -27], [56, -20], [77, 0], [56, 20], [29, 27], [0, 29]], 3), p.edge, 0, 9, 0);
    lowerParts.add(slab([[-6, -34], [33, -32], [62, -23], [82, -8], [87, 0], [82, 8], [62, 23], [33, 32], [-6, 34]], 7, 1), p.dark);
    lowerParts.add(slab([[0, -29], [35, -28], [60, -20], [78, 0], [60, 20], [35, 28], [0, 29]], 2), p.trim, 0, 7, 0);
    // Teeth grow along the chevron of the mouth instead of becoming a row across the deck.
    for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
      const x = 15 + i * 10, z = side * (32 - i * 4.4);
      upperParts.add(silhouette([[-3.8, 0], [4.5, 0], [2.3, -11], [-1.8, -7]], 5, .35), p.pale, x, 0, z);
      lowerParts.add(silhouette([[-3.6, 0], [4, 0], [1.2, 9]], 5, .35), p.edge, x + 3, 9, z - side * 1.4);
      upperFire.box(5, .6, 1.1, x, -.6, z - side * 4.5, p.light);
      lowerFire.box(6, .65, 1.4, x, 9.3, z - side * 5, p.light);
    }
    for (let x = 9; x < 65; x += 11) lowerParts.box(2, 1.7, 40 - x * .25, x, 9, 0, p.dark);
    this.add(upperParts, upper); this.add(upperFire, upper, this.glow);
    this.add(lowerParts, lower); this.add(lowerFire, lower, this.glow);
    this.battery(0, upper, [24, 13, 0]); this.battery(1);
    // The pantry is a bank of copper-clad pressure vats with meters, doors and service pipes.
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x = -93 + i * 42, z = side * 24, h = 31 + (i % 2) * 9;
      frame.cyl(10, 11, 4, x, 1, z, p.dark, { seg: 16 });
      frame.add(volume([[0, 8.5, 8.5], [4, 11, 11], [h - 5, 11, 11], [h, 7, 7]], 20), i % 2 ? p.armor : p.trim, x, 5, z);
      frame.cyl(7.5, 7.5, 2, x, h + 5, z, p.dark, { seg: 16 });
      frame.cyl(2, 2, 6, x, h + 7, z, p.edge);
      for (const y of [10, h]) frame.add(new TorusGeometry(11.2, .9, 5, 24).rotateX(Math.PI / 2), p.edge, x, y, z);
      frame.box(7, 13, 2, x, 13, z + side * 10.5, p.dark);
      lights.box(3, 9, .7, x, 15, z + side * 11.7, p.light);
      for (const y of [17, 20, 23]) frame.box(5, .8, 1, x, y, z + side * 12.2, p.trim);
      pipe(frame, [[x, 11, z - side * 10], [x, 9, side * 9], [x + 12, 7, side * 7]], 1.4, p.edge);
      pipe(frame, [[x, h + 12, z], [x, h + 15, z - side * 5], [x + 9, h + 15, z - side * 5]], 1.2, p.trim);
      frame.add(new TorusGeometry(3.8, .65, 6, 12), p.armor, x + 9, h + 15, z - side * 5);
    }
    // A rail-fed conveyor leads from pantry to furnace, with visible rollers and coal trays.
    for (const z of [-7.5, 7.5]) frame.box(127, 5, 2.6, -22, 4, z, p.edge);
    for (let x = -77; x <= 33; x += 10) {
      frame.add(new CylinderGeometry(2.5, 2.5, 13, 8).rotateX(Math.PI / 2), p.dark, x, 7, 0);
      frame.box(7, 2, 10, x, 9, 0, p.armor, { taper: .12 });
    }
    // Two elbows and slotted chimney crowns make the silhouette read as industrial cooking.
    for (const side of [-1, 1]) {
      const x = side < 0 ? -57 : -11, h = side < 0 ? 73 : 61;
      frame.cyl(5, 7, h - 12, x, 16, side * 11, p.dark, { seg: 12 });
      for (const y of [28, 43, 56]) frame.cyl(6, 6, 2, x, y, side * 11, p.trim, { seg: 12 });
      frame.cyl(8, 6, 7, x, h, side * 11, p.edge, { seg: 12 });
      frame.cyl(6.5, 6.5, .7, x, h + 7, side * 11, p.dark, { seg: 12 });
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6; frame.box(2, 6, 2, x + Math.cos(a) * 7, h + 5, side * 11 + Math.sin(a) * 7, p.trim); }
      frame.cyl(9, 8, 2, x, h + 11, side * 11, p.armor, { seg: 12 });
      pipe(frame, [[x, 19, side * 11], [x + 6, 17, side * 5], [30, 17, side * 5], [39, 22, side * 13]], 2.1, p.trim);
    }
    // Port carving fork and starboard cleaver, on independent shoulder/elbow cranks.
    const utensils: Group[] = [];
    for (const side of [-1, 1]) {
      const utensil = this.joint(side < 0 ? 'fork' : 'cleaver', 8, 18, side * 39), steel = new Parts();
      frame.box(24, 14, 12, 8, 0, side * 36, p.dark, { taper: .2 });
      frame.add(new CylinderGeometry(7, 7, 7, 12).rotateX(Math.PI / 2), p.trim, 8, 18, side * 39);
      steel.box(6, 42, 7, 0, 0, 0, p.armor, { taper: .2 });
      steel.box(2, 35, 7.2, 0, 4, 0, p.trim);
      steel.add(new CylinderGeometry(5.5, 5.5, 9, 12).rotateX(Math.PI / 2), p.dark, 0, 40, 0);
      steel.box(5, 28, 5, 2, 40, 0, p.edge, { rz: -.25 });
      if (side < 0) {
        steel.box(21, 7, 5, 9, 65, 0, p.edge, { taper: .1 });
        for (const x of [1, 6, 11, 16]) steel.add(silhouette([[-1.5, 0], [1.5, 0], [1.1, 20], [0, 25], [-1.1, 20]], 2.5), p.pale, x, 70, 0);
      } else {
        steel.add(silhouette([[-1, 0], [27, 0], [30, 5], [28, 31], [0, 34]], 3.2, .6), p.edge, 4, 65, 0);
        steel.add(silhouette([[24, 1], [28, 5], [26, 30], [23, 31]], 3.4), p.pale, 4, 65, 0);
        steel.add(new TorusGeometry(2.4, .8, 5, 12), p.dark, 10, 93, 1.8);
      }
      for (const y of [7, 18, 29]) steel.add(new CylinderGeometry(.9, .9, 8, 6).rotateX(Math.PI / 2), p.trim, 0, y, 0);
      this.add(steel, utensil); utensils.push(utensil);
    }
    // Outboard flywheels and a spit rotor remain visibly alive at idle.
    const wheels: Group[] = [];
    for (const side of [-1, 1]) {
      const wheel = this.joint(`flywheel-${side}`, 66, 24, side * 41), parts = new Parts();
      parts.add(new TorusGeometry(12, 2.3, 6, 24), p.edge);
      parts.add(new TorusGeometry(8, .7, 5, 20), p.trim);
      parts.add(new CylinderGeometry(3, 3, 7, 10).rotateX(Math.PI / 2), p.trim);
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; rod(parts, [Math.cos(a) * 3, Math.sin(a) * 3, 0], [Math.cos(a) * 11, Math.sin(a) * 11, 0], 1.1, p.armor); }
      this.add(parts, wheel); wheels.push(wheel);
    }
    this.add(frame); this.add(lights, this.art, this.glow);
    const pistons = [-1, 1].map(side => ({ side, sleeve: this.line(2.8, this.metal, p.dark, `jaw-sleeve-${side}`), shaft: this.line(1.5, this.metal, p.edge, `jaw-piston-${side}`) }));
    this.pose = (t, active, ult) => {
      const chew = this.reduce ? 0 : (.5 + .5 * Math.sin(t * (active > .1 ? 5.7 : 1.3)));
      const { gape, snap } = this.jaw;
      upper.rotation.z = .065 + chew * .045 + active * .22 + ult * .08 + gape * .3 - snap * .32;
      lower.rotation.z = -.035 - chew * .055 - active * .15 - ult * .08 - gape * .22 + snap * .24;
      utensils.forEach((utensil, i) => { utensil.rotation.x = (i ? 1 : -1) * (.15 + active * .18) + Math.sin(t * .9 + i * 1.8) * .045; utensil.rotation.z = -.22 + Math.sin(t * (active > .1 ? 3 : .65) + i * 2) * (.05 + active * .22); });
      wheels.forEach((wheel, i) => { wheel.rotation.z = t * (i ? -.4 : .4) + active * Math.sin(t * 4); });
      for (const piston of pistons) {
        const at = new Vector3(32, 6, piston.side * 27).applyQuaternion(upper.quaternion).add(upper.position);
        const a: Point = [71, 34, piston.side * 30], mid: Point = [a[0] + (at.x - a[0]) * .58, a[1] + (at.y - a[1]) * .58, a[2] + (at.z - a[2]) * .58];
        this.stretch(piston.sleeve, a, mid); this.stretch(piston.shaft, mid, [at.x, at.y, at.z]);
      }
    };
  }

  private buildFaultline(): void {
    const p = this.palette, frame = new Parts(), hot = new Parts();
    // An exposed seismic chassis runs the full length beneath independently suspended slabs.
    frame.box(326, 8, 22, -7, 0, 0, p.dark, { taper: .07 });
    for (const side of [-1, 1]) {
      frame.box(308, 4, 3, -7, 8, side * 12, p.edge);
      hot.box(295, 1.2, 1, -7, 12, side * 11, p.light);
      // Hot suspension beds remain visible through the open gaps between individual plates.
      frame.box(276, 3, 25, -8, 4, side * 28, p.dark);
      hot.box(270, 1.5, 23, -8, 7, side * 28, p.light);
      for (let x = -145; x <= 135; x += 28) {
        frame.box(8, 7, 67, x, 1, 0, p.armor, { taper: .12 });
        frame.box(10, 3, 10, x, 8, side * 28, p.edge);
      }
    }
    const plates: { group: Group; x: number; z: number; side: number; phase: number; sleeve: Mesh; shaft: Mesh }[] = [];
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const x = -113 + i * 70, z = side * (i === 3 ? 23 : 30), plate = this.joint(`tectonic-plate-${plates.length}`, x, 9, z);
      plate.scale.x = .89;
      const rock = new Parts(), seams = new Parts();
      const outline: readonly (readonly [number, number])[] = [[-34,-11],[-17,-16],[7,-13],[26,-16],[35,-5],[29,3],[33,12],[9,16],[-9,12],[-29,15],[-36,3]];
      rock.add(slab(outline, 10 + i % 2 * 4, 1.2), p.armor);
      // Offset strata create irregular exposed ledges instead of a single smooth stone block.
      rock.add(slab([[-30,-9],[-13,-13],[10,-9],[27,-12],[29,0],[23,9],[4,13],[-15,8],[-28,11]], 4, .7), p.edge, -1, 10 + i % 2 * 4, 0);
      const ridge = i % 2 ? [[-26,0],[-20,8],[-9,7],[-4,25],[8,19],[14,7],[27,0]] as const : [[-24,0],[-12,13],[-3,9],[10,19],[16,8],[27,0]] as const;
      rock.add(silhouette(ridge, 13, .8), p.armor, -4, 14 + i % 2 * 4, 0, { ry: side * (.12 + i * .035) });
      rock.add(silhouette([[-17,0],[-5,9],[3,5],[11,12],[20,0]], 10, .6), p.edge, i % 2 ? 1 : -5, 15 + i % 2 * 4, side * 4, { ry: side * (.12 - i * .04) });
      for (const offset of [-17, 9]) {
        rock.box(5, 3, 34, offset, 6, 0, p.dark, { ry: .12 });
        rock.box(4, 1.7, 29, offset, 9.5, 0, p.trim, { ry: .12 });
        for (const sz of [-1, 1]) rock.cyl(.95, .95, 1.2, offset, 11.2, sz * 11, p.pale, { seg: 6 });
      }
      // Branching veins follow real fractured faces, mirrored to the outer face on either side.
      pipe(seams, [[-30,6,side*13],[-18,7,side*14],[-10,6,side*11],[2,8,side*14],[13,8,side*13],[27,10,side*10]], .6, p.light);
      pipe(seams, [[-10,6,side*11],[-6,14,side*9],[3,18,side*7],[8,26,side*4]], .5, p.light);
      pipe(seams, [[13,8,side*13],[17,16,side*9],[22,19,side*6]], .4, p.light);
      pipe(seams, [[-25,15+i%2*4,side*10],[-13,15+i%2*4,side*9],[-5,16+i%2*4,side*12],[6,16+i%2*4,side*11],[21,16+i%2*4,side*9]], .65, p.light);
      seams.box(48, .8, 1, -1, -.6, side * 9, p.light, { ry: side * .04 });
      this.add(rock, plate, this.fabric); this.add(seams, plate, this.glow);
      const sleeve = this.line(3, this.metal, p.dark, `piston-sleeve-${plates.length}`);
      const shaft = this.line(1.65, this.metal, p.edge, `piston-shaft-${plates.length}`);
      plates.push({ group: plate, x, z, side, phase: i * 1.6 + side, sleeve, shaft });
      frame.add(new CylinderGeometry(5, 5, 8, 10).rotateX(Math.PI / 2), p.trim, x, 12, side * 10);
    }
    // A split caldera-shaped reaction chamber. Its outline is custom jagged geology, not a sphere.
    frame.cyl(28, 32, 8, -10, 8, 0, p.dark, { seg: 12 });
    frame.cyl(23, 27, 8, -10, 16, 0, p.trim, { seg: 12 });
    hot.cyl(22, 22, 1.5, -10, 25, 0, p.light, { seg: 24 });
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8, x = -10 + Math.cos(a) * 24, z = Math.sin(a) * 24;
      frame.add(silhouette([[-8,0],[8,0],[6,22],[1,28],[-6,18]], 9, .8), k % 2 ? p.edge : p.armor, x, 20, z, { ry: -a - Math.PI / 2 });
      rod(hot, [x, 22, z], [x - Math.cos(a) * 3, 40 + k % 3 * 2, z - Math.sin(a) * 3], .55, p.light);
    }
    // The piston hammer is hung from an A-frame, reciprocating down into the hot caldera.
    for (const side of [-1, 1]) {
      rod(frame, [-39, 8, side * 21], [-27, 85, side * 14], 4.5, p.armor, 3.5, 10);
      rod(frame, [20, 8, side * 21], [7, 85, side * 14], 4.5, p.armor, 3.5, 10);
      frame.box(44, 9, 8, -10, 81, side * 15, p.edge, { taper: .1 });
      for (const x of [-23, 3]) frame.box(5, 7, 9, x, 82, side * 15, p.trim);
      frame.box(36, 6, 7, -10, 62, side * 16, p.dark, { taper: .12 });
      for (const x of [-24, 4]) rod(frame, [x, 16, side * 15], [x, 80, side * 15], 1.5, p.edge);
    }
    frame.box(22, 10, 37, -10, 80, 0, p.dark, { taper: .1 });
    frame.cyl(9, 10, 9, -10, 90, 0, p.edge, { seg: 10 });
    const ram = this.joint('seismic-ram', -10, 50, 0), ramParts = new Parts(), ramHot = new Parts();
    ramParts.cyl(5, 5, 38, 0, 0, 0, p.edge, { seg: 12 });
    ramParts.cyl(10, 14, 11, 0, -7, 0, p.dark, { seg: 10 });
    ramParts.cyl(12, 15, 4, 0, -10, 0, p.trim, { seg: 10 });
    ramParts.add(slab([[-11,-8],[-3,-12],[9,-10],[13,-1],[7,11],[-5,12],[-13,3]], 7, .7), p.armor, 0, -17, 0);
    for (const y of [-8, -2, 5]) ramHot.add(new TorusGeometry(y === 5 ? 5.5 : 11, .65, 5, 20).rotateX(Math.PI / 2), p.light, 0, y, 0);
    this.add(ramParts, ram); this.add(ramHot, ram, this.glow);
    // Paired flywheel/crank drives and longitudinal accumulator banks.
    const wheels: Group[] = [];
    for (const side of [-1, 1]) {
      const wheel = this.joint(`seismic-flywheel-${side}`, -10, 72, side * 24), wheelParts = new Parts();
      wheelParts.add(new TorusGeometry(16, 3, 6, 24), p.dark);
      wheelParts.add(new TorusGeometry(16, 1.2, 5, 24), p.trim, 0, 0, side * 2.4);
      wheelParts.add(new CylinderGeometry(4, 4, 8, 12).rotateX(Math.PI / 2), p.edge);
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6; rod(wheelParts, [Math.cos(a) * 3, Math.sin(a) * 3, 0], [Math.cos(a) * 15, Math.sin(a) * 15, 0], 1.6, p.edge); }
      wheelParts.add(new CylinderGeometry(2.4, 2.4, 10, 10).rotateX(Math.PI / 2), p.trim, 0, 9, side * 2);
      this.add(wheelParts, wheel); wheels.push(wheel);
      for (const x of [-78, 65]) {
        frame.barrel(7, 7, 30, x - 15, 19, side * 10, p.dark, 12);
        for (const dx of [-13, 0, 13]) frame.barrel(8.4, 8.4, 2, x + dx, 19, side * 10, p.trim, 12);
        hot.barrel(7.2, 7.2, .9, x + 9, 19, side * 10, p.light, 12);
        pipe(frame, [[x, 24, side * 10], [x, 31, side * 7], [x + (x < 0 ? 29 : -29), 31, side * 7]], 1.4, p.edge);
      }
    }
    this.add(frame); this.add(hot, this.art, this.glow);
    this.battery(0); this.battery(1);
    this.pose = (t, active, ult) => {
      const surge = active + ult * .6;
      plates.forEach(({ group, x, z, side, phase, sleeve, shaft }) => {
        const tremor = Math.sin(t * (1.1 + surge * 6) + phase);
        group.position.set(x + Math.sin(t * .7 + phase) * .8, 9 + tremor * (.7 + surge * 2.3) + surge * 4, z + side * (surge * 8 + Math.sin(t * .65 + phase) * .7));
        group.rotation.set(side * (.025 + surge * .12) + tremor * .012, side * Math.sin(t * .8 + phase) * .018, Math.sin(t * .9 + phase) * (.012 + surge * .025));
        const at = new Vector3(0, 7, -side * 9).applyQuaternion(group.quaternion).add(group.position);
        const start: Point = [x, 12, side * 8], midpoint: Point = [x, 12 + (at.y - 12) * .54, side * 8 + (at.z - side * 8) * .54];
        this.stretch(sleeve, start, midpoint); this.stretch(shaft, midpoint, [at.x, at.y, at.z]);
      });
      ram.position.y = 50 + Math.sin(t * 1.6) * 3 - surge * (4 + (this.reduce ? 0 : Math.sin(t * 8) * 3));
      wheels.forEach((wheel, i) => { wheel.rotation.z = t * (i ? -1 : 1) * .8 + surge * Math.sin(t * 3); });
    };
  }

  private buildPharos(spec: ShipSpec): void {
    const p = this.palette, stone = new Parts(), frame = new Parts(), lights = new Parts();
    // The rock the tower never left: a breakwater of rough courses carried amidships.
    stone.add(slab([[-60,-27],[-31,-31],[5,-29],[37,-31],[61,-22],[67,-4],[58,21],[30,30],[-7,28],[-39,31],[-63,18],[-69,-6]], 5, 1.2), p.edge);
    stone.add(slab([[-42,-21],[-13,-24],[23,-22],[45,-15],[48,6],[31,22],[-5,24],[-37,20],[-49,2]], 5, 1), p.dark, 0, 5, 0);
    for (const [x, z, r, turn] of [[-73,-20,8,.4],[-77,9,7,1.3],[71,-13,8,2.2],[74,13,6,.9],[18,-33,5,1.7],[-22,33,6,2.9],[46,30,5,.2],[-50,-31,5,2.4]] as const)
      stone.add(slab([[-r,-r*.5],[-r*.2,-r],[r*.8,-r*.6],[r,r*.3],[r*.3,r],[-r*.7,r*.7]], r * .7, .8), p.edge, x, 0, z, { ry: turn });
    this.add(stone, this.art, this.fabric, 'pharos-breakwater');
    // The keeper's house, lit, with its red roof and chimney.
    frame.box(36, 13, 26, -102, 0, 0, p.armor);
    frame.add(silhouette([[-21, 0], [21, 0], [0, 11]], 29, .4), p.trim, -102, 13, 0);
    frame.box(4, 13, 4, -112, 13, 7, p.edge);
    frame.box(5, 1.2, 5, -112, 26, 7, p.dark);
    for (const side of [-1, 1]) for (const x of [-112, -102, -92]) lights.box(4, 4, .5, x, 5, side * 13.2, p.light);
    lights.box(.5, 7, 4, -83.8, 0, 0, p.light);
    // Lens buoys wait in their cradles to starboard; the keeper's boat hangs on davits to port.
    for (const x of [-27, 0, 27]) {
      frame.box(8, 1.4, 8, x, 5, 27, p.dark);
      frame.cyl(3.4, 2.4, 2.6, x, 6.4, 27, p.trim, { seg: 10 });
      frame.cyl(1.1, 2.6, 5, x, 9, 27, p.pale, { seg: 8 });
      lights.cyl(1.3, 1.3, 1.8, x, 14, 27, p.light, { seg: 8 });
      frame.cyl(.3, 1.5, 1.2, x, 15.8, 27, p.dark, { seg: 8 });
    }
    frame.box(18, 3.2, 5.5, 0, 9, -27, p.armor, { taper: .28 });
    frame.box(16, .6, 4.6, 0, 12.2, -27, p.pale);
    for (const x of [-7, 7]) pipe(frame, [[x, 5, -22], [x, 16, -23], [x, 18, -27], [x, 12.4, -27]], .45, p.edge);
    // A signal mast aft carries the running lights.
    rod(frame, [-152, 0, 0], [-152, 48, 0], 1, p.edge, .5);
    rod(frame, [-152, 35, -11], [-152, 35, 11], .45, p.edge);
    for (const z of [-11, 11]) lights.sphere(1.1, -152, 36.5, z, p.light);
    lights.sphere(1.3, -152, 49, 0, p.light);
    this.add(frame); this.add(lights, this.art, this.glow);
    // Two brass fog horns on the forecastle shake when the lamp works hard.
    const horns = this.joint('fog-horns', 80, 0, 0), hornParts = new Parts();
    hornParts.box(14, 8, 24, 0, 0, 0, p.dark, { taper: .12 });
    for (const z of [-7, 7]) {
      hornParts.barrel(1.6, 6.4, 23, 2, 13, z, p.pale, 12);
      hornParts.barrel(6.4, 7, 1.3, 25, 13, z, p.trim, 12);
      hornParts.cyl(1.2, 1.7, 6, 5, 7.5, z, p.edge);
    }
    this.add(hornParts, horns);
    // The tower stands outside the deck machinery's stretch, so its lens turns true.
    const tower = this.joint('tower', 0, spec.freeboard, 0, this.group), masonry = new Parts(), iron = new Parts(), panes = new Parts();
    const top = PHAROS_LAMP - 12, r = (y: number) => 9 + 6.5 * ((top - y) / (top - 10)) ** 1.3;
    masonry.cyl(r(10) + 2, 20, 10, 0, 0, 0, p.edge, { seg: 16 });
    const bands = [10, 26, 40, 56, 70, top];
    for (let i = 0; i < 5; i++) {
      const y0 = bands[i], y1 = bands[i + 1], mid = (y0 + y1) / 2, paint = i % 2 ? p.trim : p.armor;
      masonry.cyl(r(mid), r(y0), mid - y0, 0, y0, 0, paint, { seg: 20 });
      masonry.cyl(r(y1), r(mid), y1 - mid, 0, mid, 0, paint, { seg: 20 });
    }
    for (let i = 0; i < 6; i++) {
      const a = 2.2 + i * 1.3, y = 18 + i * 11.5, d = r(y + 2);
      iron.box(.8, 4.4, 2.6, Math.cos(a) * d, y, Math.sin(a) * d, p.dark, { ry: -a });
      panes.box(.5, 2.8, 1.4, Math.cos(a) * (d + .3), y + .8, Math.sin(a) * (d + .3), p.light, { ry: -a });
    }
    iron.box(1.4, 8, 5, -19.4, 0, 0, p.dark);
    // The gallery: a corbelled deck, a brass rail and the glazed lantern room under its red cupola.
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + .2; iron.box(5, 3, 1.5, Math.cos(a) * 11, top - 3, Math.sin(a) * 11, p.edge, { ry: -a }); }
    iron.cyl(15, 12.5, 2, 0, top, 0, p.dark, { seg: 16 });
    for (let k = 0; k < 16; k++) { const a = k * TAU / 16, x = Math.cos(a) * 14.4, z = Math.sin(a) * 14.4; rod(iron, [x, top + 2, z], [x, top + 6.5, z], .28, p.edge, undefined, 5); }
    iron.add(new TorusGeometry(14.4, .32, 5, 32).rotateX(Math.PI / 2), p.pale, 0, top + 6.5, 0);
    iron.add(new TorusGeometry(14.4, .2, 4, 32).rotateX(Math.PI / 2), p.edge, 0, top + 4.2, 0);
    iron.cyl(9.4, 10.2, 3.2, 0, top + 2, 0, p.armor, { seg: 16 });
    for (let k = 0; k < 12; k++) { const a = k * TAU / 12, x = Math.cos(a) * 9, z = Math.sin(a) * 9; rod(iron, [x, top + 5.2, z], [x, top + 19, z], .32, p.dark, undefined, 5); }
    iron.cyl(9.8, 9.8, 1.4, 0, top + 19, 0, p.dark, { seg: 16 });
    iron.cyl(1.4, 10.4, 7.5, 0, top + 20.4, 0, p.trim, { seg: 16 });
    iron.sphere(1.9, 0, top + 29, 0, p.pale);
    rod(iron, [0, top + 29, 0], [0, top + 39, 0], .28, p.edge);
    this.add(masonry, tower, this.fabric, 'pharos-tower'); this.add(iron, tower); this.add(panes, tower, this.glow);
    const vane = this.joint('weathervane', 0, top + 35, 0, tower), vaneParts = new Parts();
    rod(vaneParts, [-5, 0, 0], [6, 0, 0], .3, p.pale, .12);
    vaneParts.add(silhouette([[-6, -2], [-2.5, 0], [-6, 2]], .3, 0), p.pale);
    this.add(vaneParts, vane);
    // The lens: a turntable of brass prism rings round the burner, a bullseye fore and one aft.
    // Only the fore one shines until Twin Lamps uncovers the other.
    const lampGlow = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
    const rearGlow = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
    this.materials.add(lampGlow); this.materials.add(rearGlow);
    const lamp = this.joint('lamp', 0, PHAROS_LAMP, 0, tower), carriage = new Parts(), lens = new Parts(), rear = new Parts(), cover = new Parts();
    carriage.cyl(4.6, 5.2, 1.2, 0, -6.4, 0, p.pale, { seg: 12 });
    carriage.cyl(4.6, 4.6, .9, 0, 5.6, 0, p.pale, { seg: 12 });
    for (const y of [-4, -2, 0, 2, 4]) carriage.add(new TorusGeometry(4.3 - Math.abs(y) * .18, .22, 4, 20).rotateX(Math.PI / 2), p.pale, 0, y, 0);
    lens.cyl(2.6, 2.6, 10, 0, -5, 0, p.light, { seg: 10 });
    for (const [parts, side] of [[lens, 1], [rear, -1]] as const) {
      parts.add(new CylinderGeometry(3.6, 3.6, .7, 16).rotateZ(Math.PI / 2), p.light, side * 5.1, 0, 0);
      for (const ring of [1.5, 2.6, 3.7]) carriage.add(new TorusGeometry(ring, .2, 4, 16).rotateY(Math.PI / 2), p.pale, side * 5.6, 0, 0);
    }
    cover.add(new CylinderGeometry(3.8, 3.8, .5, 16).rotateZ(Math.PI / 2), p.dark, -5.9, 0, 0);
    this.add(carriage, lamp, this.metal, 'pharos-lens-carriage'); this.add(lens, lamp, lampGlow, 'pharos-lens');
    const rearLens = this.add(rear, lamp, rearGlow, 'pharos-rear-lens'), rearCover = this.add(cover, lamp, this.metal, 'pharos-rear-cover');
    const blind = new Parts();
    blind.add(new CylinderGeometry(9.5, 9.5, 13.6, 12, 1, true), p.dark);
    const shutters = this.add(blind, tower, this.metal, 'pharos-shutters');
    this.battery(0); this.battery(1);
    this.pose = (t, active, ult) => {
      const { angle, twin, white } = this.lamp, k = this.shutter;
      // In battle the lens points down the beam; in the hangar it turns at the sweep's pace.
      lamp.rotation.y = angle ?? -t * PHAROS.spin;
      lamp.position.y = PHAROS_LAMP + Math.sin(t * 1.3) * .15 + active * .8;
      shutters.scale.y = Math.max(.03, k);
      shutters.position.y = top + 19 - 6.8 * Math.max(.03, k);
      rearLens.visible = twin;
      rearCover.visible = !twin;
      vane.rotation.y = Math.sin(t * .31) * .6 + Math.sin(t * 1.7) * .08 + active * .5;
      horns.scale.setScalar(1 + active * .04 + ult * .07 * (this.reduce ? 1 : .5 + .5 * Math.sin(t * 30)));
      const power = this.burning * (1 - k) * (1.5 + white * 2.5 + active * .5) + .04;
      lampGlow.color.setScalar(power);
      rearGlow.color.setScalar(power);
    };
  }

  /** Read-only presentation; instant casts also get a brief response when their cooldown starts. */
  update(ship: Ship, time: number, dt: number): void {
    if (this.disposed) return;
    const alive = ship.alive && !ship.withdrawn, step = Math.max(0, Math.min(.25, Number.isFinite(dt) ? dt : 0));
    let activity = 0, ultimate = 0;
    const slots: number[] = [];
    // Charged Pins do not start the ordinary Q cooldown. Reading their newest recovery
    // deadline preserves the same presentation impulse without changing any runtime state.
    const recharge = ship.hexweaver?.recharge;
    const pinRecharge = recharge?.length ? Math.max(...recharge) : 0;
    const pinCast = this.id === 'hexweaver' && pinRecharge > this.pinRecharge + .01;
    this.pinRecharge = pinRecharge;
    if (this.id === 'hexweaver') this.mirror = alive ? effigyMirror(ship, this.reduce) : STILL;
    if (this.id === 'gourmand') this.jaw = alive ? gourmandJaw(ship, this.reduce) : SHUT;
    for (let i = 0; i < ship.skills.length; i++) {
      const skill = ship.skills[i], previous = this.cooldowns[i], meter = this.meters[i];
      const cast = (previous !== undefined && skill.cooldown > previous + .15)
        || (skill.spec.ult && meter !== undefined && skill.meter < meter - .1)
        || (i === 0 && pinCast);
      this.impulses[i] = alive && cast ? 1 : Math.max(0, (this.impulses[i] ?? 0) - step * 1.1);
      this.cooldowns[i] = skill.cooldown;
      this.meters[i] = skill.meter;
      slots[i] = alive ? Math.max(skill.active ? 1 : 0, this.impulses[i]) : 0;
      activity = Math.max(activity, slots[i]);
      if (skill.spec.ult) ultimate = Math.max(ultimate, slots[i]);
    }
    const mix = this.reduce ? 1 : 1 - Math.exp(-step * 9);
    this.activity += (activity - this.activity) * mix;
    this.ultimate += (ultimate - this.ultimate) * mix;
    if (this.id === 'pharos') {
      this.lamp = alive ? pharosLamp(ship) : IDLE_LAMP;
      this.shutter += (this.lamp.dark - this.shutter) * mix;
      this.burning = alive ? 1 : 0;
    }
    const t = this.reduce || !Number.isFinite(time) ? 0 : time;
    this.pose(t, this.activity, this.ultimate, slots);
    const power = alive ? 1.05 + this.activity * .65 + this.ultimate * .65 + Math.sin(t * 2.1) * .055 : .08;
    this.glow.color.setRGB(power, power, power);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.owned) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.owned.clear(); this.materials.clear();
    this.group.clear();
  }
}
