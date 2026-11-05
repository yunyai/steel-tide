import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Shell } from '../../weapons/ShellSystem';
import { BK } from '../BurstParticles';
import { hot } from './MiscFxKit';
import { MiscShipFx } from './MiscShipFx';

const AMBER = 0xffa040;
const FIRE = 0xff793b;
const GOLD = 0xffca73;
const STEAM = 0xfff0dc;

/** The Gourmand: its mouth, the bite warning, a swallowed hull and the dishes its mortars throw. */
export class GourmandFx extends MiscShipFx {
  readonly look = 'dish' as const;
  readonly palette = { main: AMBER, hot: 0xfff0c0, deep: 0x6a2a10 };

  owns(s: Ship): boolean {
    return !!s.gourmand;
  }

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    const t = kit.t;
    for (const s of kit.game.ships) {
      const a = s.gourmand;
      if (!a || !s.alive || s.withdrawn) continue;
      if (a.bite) {
        // The bite warning belongs to its victim: it shows wherever the victim may be seen.
        const target = kit.game.ships.find((v) => v.id === a.bite!.target);
        if (target && kit.visible(target, team)) kit.ring(a.bite.x, a.bite.z, 380, 8, hot(STEAM), 0.75, 7, t * 0.15, 48);
      }
      if (!kit.visible(s, team)) continue;
      const p = s.localToWorld(s.spec.length * 0.5 + 95, 0, 0);
      if (a.mouthUntil > now || a.banquetUntil > now) {
        const radius = a.banquetUntil > now ? 500 : 310;
        for (let i = 0; i < 3; i++) kit.ring(p.x, p.z, radius * (0.35 + ((t * 0.5 + i / 3) % 1) * 0.65), 7, hot(FIRE, 1.5), 0.24, 4, t * 0.2, 32);
      }
      if (a.swallow) {
        kit.ring(s.renderPos.x, s.renderPos.z, 115, 38, hot(FIRE, 1.5), 0.65, 5, t * 0.5, 32);
        kit.ring(s.renderPos.x, s.renderPos.z, 145, 48, hot(GOLD, 1.4), 0.4, 3, -t * 0.5, 32);
      }
    }
  }

  /** A tumbling glowing platter trailing steam. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, _dy: number, dz: number): void {
    const { kit } = this;
    kit.glow(x, y, z, 34, hot(AMBER, 2), 0.8);
    // The platter's rim, tumbling about the flight path.
    const spin = kit.t * 7 + s.id;
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    const tilt = Math.sin(spin);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r1 = Math.cos(a) * 14;
      const r2 = Math.sin(a) * 14;
      const nx = x + (ux / ul) * r1 + dx * r2 * tilt;
      const ny = y + r2 * Math.cos(spin) * 0.6;
      const nz = z + (uz / ul) * r1 + dz * r2 * tilt;
      if (i) kit.line(px, py, pz, nx, ny, nz, hot(0xfff0c0, 1.8), 0.8, 2);
      px = nx;
      py = ny;
      pz = nz;
    }
    const n = Math.max(2, Math.round(5 * kit.k));
    for (let i = 1; i <= n; i++) {
      const back = i * 22;
      kit.particles.push(BK.Smoke, x - dx * back, y + i * 2, z - dz * back, 18 + i * 6, hot(STEAM, 0.9), 0.35 * (1 - i / (n + 1)), spin + i, s.id + i);
    }
  }
}
