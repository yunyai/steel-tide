import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, type BufferGeometry, type Material } from 'three';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Shell } from '../../weapons/ShellSystem';
import { hot } from './MiscFxKit';
import { MiscShipFx } from './MiscShipFx';

const PINK = 0xf290cf;
const FIRE = 0xff793b;
const INK = 0xa45cae;

/** The Hexweaver: dolls over its victims, their threads and stitches, the decoy and needle rounds. */
export class HexweaverFx extends MiscShipFx {
  readonly look = 'needle' as const;
  readonly palette = { main: PINK, hot: 0xffd8f0, deep: INK };
  private box = new BoxGeometry(1, 1, 1);
  private round = new SphereGeometry(1, 10, 6);
  private cloth = new OctahedronGeometry(1, 1);
  private cylinder = new CylinderGeometry(0.5, 0.5, 1, 16);
  private clothMaterial = new MeshStandardMaterial({ color: 0x5e354e, roughness: 0.95, metalness: 0.08 });
  private needleMaterial = new MeshStandardMaterial({ color: 0xffd18b, roughness: 0.25, metalness: 0.8, emissive: 0x6b240d, emissiveIntensity: 0.3 });
  private glowMaterial = new MeshBasicMaterial({ color: 0xf998d0, toneMapped: false });

  owns(s: Ship): boolean {
    return !!s.hexweaver;
  }

  protected persist(live: Set<string>): void {
    const { kit } = this;
    const now = kit.game.time;
    const t = kit.t;
    for (const s of kit.game.ships) {
      if (!s.alive || !s.hexweaver) continue;
      for (const d of s.hexweaver.dolls) {
        const v = kit.game.ships.find((v) => v.id === d.target && v.alive);
        if (!v) continue;
        const key = `misc-doll-${s.id}-${v.id}`;
        live.add(key);
        const g = kit.node(key, () => this.doll());
        if (!g) continue;
        g.position.set(v.renderPos.x, v.renderPos.y + v.spec.freeboard + 75, v.renderPos.z);
        g.rotation.y = t * 0.65 + s.id * 0.4;
        g.rotation.z = Math.sin(t * 2 + v.id) * 0.12;
        g.scale.setScalar(12 + (d.burnUntil > now ? 2 : 0));
        const pins = g.userData.pins as Mesh[];
        for (let i = 0; i < pins.length; i++) pins[i].visible = i < d.pins;
      }
      const d = s.hexweaver.decoy;
      if (d && d.until > now) {
        const key = `misc-decoy-${s.id}`;
        live.add(key);
        const g = kit.node(key, () => this.doll());
        if (!g) continue;
        g.position.set(d.x, 38 + Math.sin(t * 2) * 3, d.z);
        g.scale.setScalar(22);
        g.rotation.y = t * 0.35;
        for (const p of g.userData.pins as Mesh[]) p.visible = false;
      }
    }
  }

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    const t = kit.t;
    for (const s of kit.game.ships) {
      const h = s.hexweaver;
      if (!h || !s.alive || s.withdrawn) continue;
      const visible = kit.visible(s, team);
      for (let i = 0; i < h.dolls.length; i++) {
        const d = h.dolls[i];
        const target = kit.game.ships.find((v) => v.id === d.target && v.alive);
        if (!target || !kit.visible(target, team)) continue;
        const g = kit.peek(`misc-doll-${s.id}-${target.id}`);
        if (g) g.visible = true;
        const x = target.renderPos.x;
        const z = target.renderPos.z;
        const y = target.renderPos.y + target.spec.freeboard + 65;
        kit.ring(x, z, 50 + Math.sin(t * 3) * 4, y - 45, hot(d.burnUntil > now ? FIRE : PINK, d.burnUntil > now ? 1.5 : 1.3), 0.4, 3, 0, 24);
        if (visible) kit.line(s.renderPos.x, s.spec.freeboard + 45, s.renderPos.z, x, y, z, hot(INK), 0.27, 2);
        if (d.stitchedUntil <= now) continue;
        for (let k = i + 1; k < h.dolls.length; k++) {
          const other = h.dolls[k];
          if (other.stitchedUntil <= now) continue;
          const v = kit.game.ships.find((v) => v.id === other.target && v.alive);
          if (!v || !kit.visible(v, team)) continue;
          kit.arc(x, y, z, v.renderPos.x, y, v.renderPos.z, 35, hot(PINK, 1.3), 0.6, 3, 12);
        }
      }
      if (visible && h.decoy) {
        const g = kit.peek(`misc-decoy-${s.id}`);
        if (g) g.visible = true;
        kit.ring(h.decoy.x, h.decoy.z, 90, 5, hot(PINK, 1.3), 0.4, 3, 0, 32);
      }
    }
  }

  /** A long thin pink needle trailing a wavering ink thread. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    kit.line(x - dx * 50, y - dy * 50, z - dz * 50, x + dx * 8, y + dy * 8, z + dz * 8, hot(0xffd8f0, 2.4), 0.95, 1.4);
    kit.glow(x, y, z, 16, hot(PINK, 2), 0.7);
    const len = Math.min(s.travelled, 320);
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    let px = x - dx * 50;
    let py = y - dy * 50;
    let pz = z - dz * 50;
    for (let i = 1; i <= 10; i++) {
      const back = 50 + (len - 50) * (i / 10);
      if (back <= 50) break;
      const wave = Math.sin(i * 1.3 + kit.t * 9 + s.id) * 6 * (i / 10);
      const nx = x - dx * back + (ux / ul) * wave;
      const ny = y - dy * back;
      const nz = z - dz * back + (uz / ul) * wave;
      kit.line(px, py, pz, nx, ny, nz, hot(PINK, 1.1), 0.5 * (1 - i / 11), 1.2);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  /** A cloth effigy with glowing stitched eyes and three needles it may carry. */
  private doll(): Group {
    const g = new Group();
    const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh => {
      const m = new Mesh(geometry, material);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      g.add(m);
      return m;
    };
    add(this.cloth, this.clothMaterial, 0, 0, 0, 0.9, 1.4, 0.5);
    add(this.round, this.clothMaterial, 0, 1.8, 0, 0.72, 0.72, 0.6);
    for (const side of [-1, 1]) {
      add(this.box, this.clothMaterial, side * 1.15, 0.5, 0, 1.3, 0.42, 0.45).rotation.z = side * -0.3;
      add(this.box, this.clothMaterial, side * 0.4, -1.65, 0, 0.44, 1.3, 0.44).rotation.z = side * 0.15;
      // Cross stitches on the effigy's face; their glowing eyes read at gameplay distance.
      add(this.round, this.glowMaterial, side * 0.23, 1.9, 0.55, 0.13, 0.13, 0.08);
    }
    const pins: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = add(this.cylinder, this.needleMaterial, (i - 1) * 0.75, 0.7 - i * 0.45, 0.8, 0.11, 2, 0.11);
      p.rotation.x = Math.PI * 0.45;
      p.rotation.z = (i - 1) * 0.3;
      pins.push(p);
    }
    g.userData.pins = pins;
    return g;
  }

  dispose(): void {
    super.dispose();
    this.box.dispose();
    this.round.dispose();
    this.cloth.dispose();
    this.cylinder.dispose();
    this.clothMaterial.dispose();
    this.needleMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
