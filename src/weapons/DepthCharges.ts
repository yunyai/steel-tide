import type { Game } from '../core/Game';
import { dist2D } from '../core/math';
import type { Ship } from '../ships/Ship';

// Depth charge patterns (destroyers/cruisers) and bomb splash damage against
// submarines at periscope depth.

interface Charge {
  owner: Ship;
  x: number;
  z: number;
  fuse: number;
  alive: boolean;
}

const CHARGE_DAMAGE = 7000;
const CHARGE_RADIUS = 140;

export class DepthChargeSystem {
  charges: Charge[] = [];

  constructor(private game: Game) {}

  drop(owner: Ship): void {
    // Two rails + two K-gun throwers: a diamond pattern astern.
    const L = owner.spec.length;
    const pattern: [number, number][] = [
      [-L * 0.55, 0],
      [-L * 0.55 - 60, 0],
      [-L * 0.55 - 120, 0],
      [-L * 0.4, 70],
      [-L * 0.4, -70],
      [-L * 0.55 - 90, 60],
      [-L * 0.55 - 90, -60],
    ];
    pattern.forEach(([x, z], i) => {
      const p = owner.localToWorld(x, 0, z);
      this.charges.push({ owner, x: p.x, z: p.z, fuse: 2.2 + i * 0.25, alive: true });
    });
  }

  bombSplash(owner: Ship, x: number, z: number, damage: number): void {
    for (const s of this.game.ships) {
      if (!s.alive || !s.isSub || s.team === owner.team || s.deep || !s.submerged) continue;
      if (dist2D(x, z, s.pos.x, s.pos.z) < 55) {
        const dmg = s.takeDamage(damage * 0.6, owner);
        this.game.events.emit('ribbon', { ship: owner, kind: 'Bomb Hit', damage: dmg });
      }
    }
  }

  update(dt: number): void {
    const g = this.game;
    for (const c of this.charges) {
      if (!c.alive) continue;
      c.fuse -= dt;
      if (c.fuse > 0) continue;
      c.alive = false;
      g.events.emit('depthCharge', { x: c.x, z: c.z });
      for (const s of g.ships) {
        if (!s.alive || s.team === c.owner.team || !s.isSub) continue;
        const d = dist2D(c.x, c.z, s.pos.x, s.pos.z);
        if (d > CHARGE_RADIUS) continue;
        const fall = 1 - d / CHARGE_RADIUS;
        const dmg = s.takeDamage(CHARGE_DAMAGE * (0.35 + 0.65 * fall), c.owner);
        if (g.rng() < 0.2) s.startFlood(c.owner);
        g.events.emit('ribbon', { ship: c.owner, kind: 'Depth Charge Hit', damage: dmg });
      }
    }
    this.charges = this.charges.filter((c) => c.alive);
  }
}
