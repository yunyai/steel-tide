import { MAP_HALF } from '../config';
import type { Ship } from '../ships/Ship';
import type { Game } from './Game';

// Supply crates floating at sea: sail through one to grab it.

export type PickupKind = 'repair' | 'overcharge' | 'reset' | 'fury';

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  /** Seconds since it appeared. */
  age: number;
  alive: boolean;
}

export const PICKUP_LABEL: Record<PickupKind, string> = {
  repair: 'Repair crate',
  overcharge: 'Overcharge',
  reset: 'Skill reset',
  fury: 'Fury',
};

export const PICKUP_COLOR: Record<PickupKind, number> = {
  repair: 0x5dff9a,
  overcharge: 0xffb547,
  reset: 0x4de8ff,
  fury: 0xff3b4e,
};

const KINDS: PickupKind[] = ['repair', 'repair', 'overcharge', 'reset', 'fury'];
/** Seconds between spawns, and the most crates afloat at once. */
export const PICKUP_INTERVAL = 18;
export const PICKUP_MAX = 6;
/** Crates sink after this long. */
const PICKUP_LIFE = 120;

export class Pickups {
  items: Pickup[] = [];
  /** Spawning on a timer (Boss Rush drives its own drops). */
  auto = true;
  private timer = 6;

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  /** Drop a crate at a point, or at a random open-water spot. */
  spawn(kind?: PickupKind, x?: number, z?: number): Pickup | null {
    const g = this.game;
    const k = kind ?? KINDS[Math.floor(g.rng() * KINDS.length)];
    let px = x;
    let pz = z;
    if (px === undefined || pz === undefined) {
      const spot = this.openWater();
      if (!spot) return null;
      px = spot.x;
      pz = spot.z;
    }
    const p: Pickup = { id: this.nextId++, kind: k, x: px, z: pz, age: 0, alive: true };
    this.items.push(p);
    g.events.emit('pickupSpawn', { pickup: p });
    return p;
  }

  /** A random point well out to sea, nearer the middle of the map where the fighting is. */
  private openWater(): { x: number; z: number } | null {
    const g = this.game;
    const r = MAP_HALF * 0.7;
    for (let i = 0; i < 20; i++) {
      const x = (g.rng() * 2 - 1) * r;
      const z = (g.rng() * 2 - 1) * r * 0.85;
      const h = (dx: number, dz: number) => g.map.heightAt(x + dx, z + dz) < -6;
      if (h(0, 0) && h(150, 0) && h(-150, 0) && h(0, 150) && h(0, -150)) return { x, z };
    }
    return null;
  }

  static radius(ship: Ship): number {
    return Math.max(60, ship.spec.length * 0.35);
  }

  update(dt: number): void {
    const g = this.game;
    if (this.auto) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 18;
        if (this.items.length < PICKUP_MAX) this.spawn();
      }
    }
    for (const p of this.items) {
      p.age += dt;
      if (p.age > PICKUP_LIFE) {
        p.alive = false;
        continue;
      }
      for (const s of g.ships) {
        if (!s.alive || s.isSummon || s.deep) continue;
        const r = Pickups.radius(s);
        const dx = s.pos.x - p.x;
        const dz = s.pos.z - p.z;
        if (dx * dx + dz * dz > r * r) continue;
        this.collect(p, s);
        break;
      }
    }
    if (this.items.some((p) => !p.alive)) this.items = this.items.filter((p) => p.alive);
  }

  collect(p: Pickup, s: Ship): void {
    p.alive = false;
    switch (p.kind) {
      case 'repair':
        s.extinguish();
        s.heal(s.maxHp * 0.25);
        break;
      case 'overcharge':
        s.boostUlts(0.35);
        break;
      case 'reset':
        for (const st of s.skills) if (!st.spec.ult) st.cooldown = 0;
        break;
      case 'fury':
        s.addEffect({
          id: 'pickup:fury',
          time: 15,
          apply(m) {
            m.damageMul *= 1.3;
          },
        });
        break;
    }
    this.game.events.emit('pickupTaken', { pickup: p, ship: s });
  }
}
