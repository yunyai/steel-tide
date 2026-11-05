import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { courtRadius } from '../../skills/misc/JudgeRuntime';
import type { Shell } from '../../weapons/ShellSystem';
import { hot } from './MiscFxKit';
import { MiscShipFx } from './MiscShipFx';

const GOLD = 0xffca73;
const IVORY = 0xfff1c8;

/** The Judge: its court, arrest chains and gavel rail bolts. */
export class JudgeFx extends MiscShipFx {
  readonly look = 'gavel' as const;
  readonly palette = { main: GOLD, hot: IVORY, deep: 0xb0221c };

  owns(s: Ship): boolean {
    return !!s.judge;
  }

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    const t = kit.t;
    const gold = hot(GOLD, 1.4);
    for (const s of kit.game.ships) {
      const j = s.judge;
      if (!j?.court || !s.alive || s.withdrawn) continue;
      // The court is public ground, like a ridge: enemies must see where its laws hold.
      const p = j.court;
      const r = courtRadius(s);
      const martial = j.martialUntil > now;
      kit.ring(p.x, p.z, r, 5, gold, martial ? 0.85 : 0.5, martial ? 9 : 5);
      kit.ring(p.x, p.z, r - 25, 5, gold, 0.22, 2);
      if (martial) kit.ring(p.x, p.z, r - 75, 7, gold, 0.45, 4, t * 0.02);
      for (let i = 0; i < 36; i++) {
        const b = (i * Math.PI) / 18;
        const c = Math.cos(b);
        const sn = Math.sin(b);
        const length = i % 3 ? 30 : 70;
        kit.line(p.x + c * (r - length), 6, p.z + sn * (r - length), p.x + c * (r + 12), 6, p.z + sn * (r + 12), gold, 0.65, 4);
        if (i % 3 === 0) {
          const x = p.x + c * (r - 95);
          const z = p.z + sn * (r - 95);
          kit.line(x - sn * 20, 6, z + c * 20, x + sn * 20, 6, z - c * 20, gold, 0.6, 4);
        }
      }
      if (!kit.visible(s, team)) continue;
      for (const arrest of j.arrests) {
        const target = kit.game.ships.find((v) => v.id === arrest.target);
        if (target && kit.visible(target, team)) this.chain(s, target);
      }
    }
  }

  /** The golden chain an Arrest drags its prisoner by. */
  private chain(a: Ship, b: Ship): void {
    const ax = a.renderPos.x;
    const az = a.renderPos.z;
    const dx = b.renderPos.x - ax;
    const dz = b.renderPos.z - az;
    const len = Math.hypot(dx, dz) || 1;
    const count = Math.min(96, Math.max(12, Math.ceil(len / 30)));
    const gold = hot(GOLD, 1.4);
    let px = ax;
    let py = 30;
    let pz = az;
    for (let i = 1; i <= count; i++) {
      const f = i / count;
      const angle = f * Math.PI * count * 0.7 + this.kit.t * 4;
      const off = Math.sin(angle) * 9;
      const x = ax + dx * f - (dz / len) * off;
      const y = 30 + Math.cos(angle) * 9;
      const z = az + dz * f + (dx / len) * off;
      this.kit.line(px, py, pz, x, y, z, gold, 0.8, 5);
      px = x;
      py = y;
      pz = z;
    }
  }

  /** A gold rail bolt: a white core, a gold sheath and two rail coils riding the head. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    const len = Math.min(s.travelled + 1, 140);
    kit.line(x - dx * len, y - dy * len, z - dz * len, x + dx * 12, y + dy * 12, z + dz * 12, hot(IVORY, 2.4), 0.9, 2.2);
    kit.line(x - dx * len * 0.6, y - dy * len * 0.6, z - dz * len * 0.6, x, y, z, hot(GOLD, 1.6), 0.5, 7);
    kit.glow(x, y, z, 30, hot(GOLD, 2.2), 0.85);
    // Coils are rings in the plane across the flight path.
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    for (let k = 0; k < 2; k++) {
      const back = 14 + k * 22 + ((kit.t * 160) % 22);
      const cx = x - dx * back;
      const cy = y - dy * back;
      const cz = z - dz * back;
      let qx = cx + (ux / ul) * 9;
      let qy = cy;
      let qz = cz + (uz / ul) * 9;
      for (let i = 1; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const nx = cx + (Math.cos(a) * ux) / ul * 9;
        const ny = cy + Math.sin(a) * 9;
        const nz = cz + (Math.cos(a) * uz) / ul * 9;
        kit.line(qx, qy, qz, nx, ny, nz, hot(GOLD, 1.8), 0.7, 1.6);
        qx = nx;
        qy = ny;
        qz = nz;
      }
    }
  }
}
