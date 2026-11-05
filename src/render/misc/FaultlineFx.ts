import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Shell } from '../../weapons/ShellSystem';
import type { DynamicRidge } from '../../world/GameMap';
import { BK } from '../BurstParticles';
import { hot } from './MiscFxKit';
import { MiscShipFx } from './MiscShipFx';

const MAGMA = 0xff5a14;
const FIRE = 0xff793b;

/** The Faultline: its ridges, fractures, pending ridge outlines and ember rounds. */
export class FaultlineFx extends MiscShipFx {
  readonly look = 'magma' as const;
  readonly palette = { main: MAGMA, hot: 0xffb060, deep: 0x2a2522 };
  private box = new BoxGeometry(1, 1, 1);
  private cylinder = new CylinderGeometry(0.5, 0.5, 1, 16);
  private rockMaterial = new MeshStandardMaterial({ color: 0x353535, roughness: 0.94, metalness: 0.12 });

  owns(s: Ship): boolean {
    return !!s.faultline;
  }

  /** Every raised ridge is drawn, whoever raised it: ridges are terrain. */
  protected persist(live: Set<string>): void {
    for (const r of this.kit.game.map.dynamicRidges) {
      const key = `misc-ridge-${r.owner}-${r.id}`;
      live.add(key);
      const g = this.kit.node(key, () => this.ridge());
      if (!g) continue;
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const len = Math.hypot(dx, dz);
      g.position.set((r.x0 + r.x1) / 2, r.height / 2, (r.z0 + r.z1) / 2);
      g.rotation.y = -Math.atan2(dz, dx);
      g.children[0].scale.set(len, r.height, r.width);
      for (let i = 1; i <= 2; i++) {
        g.children[i].position.x = ((i === 1 ? -1 : 1) * len) / 2;
        g.children[i].scale.set(r.width, r.height, r.width);
      }
    }
  }

  protected cues(_team: Team | -1): void {
    const { kit } = this;
    const t = kit.t;
    const fire = hot(FIRE, 1.5);
    for (const r of kit.game.map.dynamicRidges) {
      const g = kit.peek(`misc-ridge-${r.owner}-${r.id}`);
      if (g) g.visible = true;
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const len = Math.hypot(dx, dz) || 1;
      kit.line(r.x0, r.height + 1, r.z0, r.x1, r.height + 1, r.z1, fire, 0.45 + 0.15 * Math.sin(t * 3 + r.id), 7);
      for (let i = 0; i < 8; i++) {
        const f = (i + 0.5) / 8;
        const x = r.x0 + dx * f;
        const z = r.z0 + dz * f;
        const side = i % 2 ? 1 : -1;
        kit.line(x, r.height + 1, z, x - (dz / len) * r.width * 0.44 * side, r.height + 1, z + (dx / len) * r.width * 0.44 * side, fire, 0.45, 3);
      }
    }
    for (const s of kit.game.ships) {
      if (!s.faultline || !s.alive || s.withdrawn) continue;
      // Fractures and terrain warnings are public hazards, like the solid ridges they become.
      for (const f of s.faultline.fractures) {
        const dx = f.x1 - f.x0;
        const dz = f.z1 - f.z0;
        const len = Math.hypot(dx, dz) || 1;
        const parts = Math.max(3, Math.ceil(len / 100));
        let x = f.x0;
        let z = f.z0;
        for (let i = 1; i <= parts; i++) {
          const n = i === parts ? 0 : Math.sin(i * 2.7 + f.id) * 19;
          const nx = f.x0 + (dx * i) / parts - (dz / len) * n;
          const nz = f.z0 + (dz * i) / parts + (dx / len) * n;
          kit.line(x, 5, z, nx, 5, nz, fire, 0.55 + 0.15 * Math.sin(t * 4 + i), 5);
          x = nx;
          z = nz;
        }
      }
      for (const p of s.faultline.pending) if (p.ridge) this.outline(p.ridge, 0.45 + 0.2 * Math.sin(t * 10));
    }
  }

  /** The footprint a ridge about to rise will cover. */
  private outline(r: DynamicRidge, alpha: number): void {
    const { kit } = this;
    const fire = hot(FIRE, 1.5);
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const w = r.width / 2;
    for (const side of [-1, 1]) kit.line(r.x0 + nx * w * side, 5, r.z0 + nz * w * side, r.x1 + nx * w * side, 5, r.z1 + nz * w * side, fire, alpha, 5);
    const angle = Math.atan2(dz, dx);
    for (let end = 0; end < 2; end++) {
      const x = end ? r.x1 : r.x0;
      const z = end ? r.z1 : r.z0;
      const start = angle + (end ? -0.5 : 0.5) * Math.PI;
      for (let i = 0; i < 12; i++) {
        const a = start + (i * Math.PI) / 12;
        const b = start + ((i + 1) * Math.PI) / 12;
        kit.line(x + Math.cos(a) * w, 5, z + Math.sin(a) * w, x + Math.cos(b) * w, 5, z + Math.sin(b) * w, fire, alpha, 5);
      }
    }
  }

  /** An ember rock trailing smoke and sparks. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    kit.glow(x, y, z, 30, hot(MAGMA, 2.2), 0.85);
    kit.particles.push(BK.Flare, x, y, z, 22, hot(0xffd080, 2.4), 0.9, kit.t * 5 + s.id, s.id);
    const n = Math.max(2, Math.round(6 * kit.k));
    for (let i = 1; i <= n; i++) {
      const back = i * 18;
      kit.particles.push(BK.Smoke, x - dx * back, y - dy * back + i * 3, z - dz * back, 14 + i * 7, hot(0x2a2522, 1), 0.5 * (1 - i / (n + 1)), i + s.id, s.id + i);
      if (i % 2) kit.particles.push(BK.Spark, x - dx * back * 0.6, y - dy * back * 0.6, z - dz * back * 0.6, 3, hot(MAGMA, 2), 0.8, 0, i, -dx * 10, -dy * 10 + 3, -dz * 10, 1.5);
    }
  }

  /** A rock wall with rounded ends. */
  private ridge(): Group {
    const g = new Group();
    g.add(new Mesh(this.box, this.rockMaterial), new Mesh(this.cylinder, this.rockMaterial), new Mesh(this.cylinder, this.rockMaterial));
    for (const child of g.children) {
      child.receiveShadow = true;
      child.castShadow = true;
    }
    return g;
  }

  dispose(): void {
    super.dispose();
    this.box.dispose();
    this.cylinder.dispose();
    this.rockMaterial.dispose();
  }
}
