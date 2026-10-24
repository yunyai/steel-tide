import type { ConsumableSpec, ConsumableType, Era, ShipSpec } from '../core/types';
import { eraOf } from '../data/factions';
import { mark } from '../skills/kit';
import type { Ship } from './Ship';

export interface ConsumableState {
  spec: ConsumableSpec;
  charges: number;
  /** Seconds until usable again (includes active time). */
  cooldown: number;
  /** Seconds of activity remaining. */
  active: number;
  /** Seconds until the next spent charge comes back (repair kit). */
  restock: number;
}

const LABELS: Record<Era, Record<ConsumableType, string>> = {
  historic: { repair: 'Repair Kit', smoke: 'Smoke Screen', search: 'Search Radar', speedBoost: 'Engine Boost', depthCharges: 'Depth Charges' },
  fantasy: { repair: 'Mending Rune', smoke: 'Fog Veil', search: 'Scrying Eye', speedBoost: 'Tailwind', depthCharges: 'Depth Runes' },
  modern: { repair: 'Damage Control', smoke: 'Smoke and Chaff', search: 'Search Radar', speedBoost: 'Gas Turbine Boost', depthCharges: 'ASW Mortar' },
  scifi: { repair: 'Nano-Repair', smoke: 'Photon Screen', search: 'Quantum Scan', speedBoost: 'Afterburner', depthCharges: 'Gravity Charges' },
};

/** What a ship's consumable is called in its era. */
export function consumableLabel(type: ConsumableType, spec?: ShipSpec): string {
  return LABELS[spec ? eraOf(spec) : 'historic'][type];
}

export const CONSUMABLE_ICON: Record<ConsumableType, string> = {
  repair: '+',
  smoke: 'SM',
  search: 'SR',
  speedBoost: 'SP',
  depthCharges: 'DP',
};

/** Cloaks fail: the ship can be targeted, locked and homed on. */
export function reveal(ship: Ship, time: number): void {
  ship.addEffect({
    id: 'debuff:revealed',
    time,
    apply(m) {
      m.revealed = true;
    },
  });
}

export function createConsumables(spec: ShipSpec): ConsumableState[] {
  return spec.consumables.map((c) => ({ spec: c, charges: c.charges, cooldown: 0, active: 0, restock: c.restock ?? 0 }));
}

/** Seconds of activity left on the first consumable of `type`, 0 if inactive. */
export function consumableActive(ship: Ship, type: ConsumableType): number {
  for (const c of ship.consumables) if (c.spec.type === type && c.active > 0) return c.active;
  return 0;
}

export function canActivate(c: ConsumableState): boolean {
  return c.charges > 0 && c.cooldown <= 0;
}

export function activateConsumable(ship: Ship, index: number): boolean {
  const c = ship.consumables[index];
  if (!c || !canActivate(c) || !ship.alive) return false;
  const g = ship.game;
  switch (c.spec.type) {
    case 'repair': {
      // The kit does everything at once: puts out fires and flooding, frees jammed modules,
      // then patches the hull while the crew stays on alert against new fires.
      const burning = ship.fires.some((f) => f > 0) || ship.flooding > 0;
      if (!burning && ship.hp >= ship.maxHp && ship.humanIndex < 0) return false;
      ship.cleanse();
      break;
    }
    case 'depthCharges':
      g.depth.drop(ship);
      break;
    default:
      break;
  }
  c.charges--;
  c.active = c.spec.duration;
  c.cooldown = c.spec.duration + c.spec.cooldown;
  g.events.emit('consumable', { ship, type: c.spec.type });
  return true;
}

export function updateConsumables(ship: Ship, dt: number): void {
  const g = ship.game;
  for (const c of ship.consumables) {
    if (c.cooldown > 0) c.cooldown -= dt;
    if (c.spec.restock && c.charges < c.spec.charges) {
      c.restock -= dt;
      if (c.restock <= 0) {
        c.charges++;
        c.restock = c.spec.restock;
      }
    }
    if (c.active <= 0) continue;
    c.active -= dt;
    switch (c.spec.type) {
      case 'repair':
        ship.heal(((c.spec.power ?? 0.2) * ship.maxHp * dt) / c.spec.duration);
        break;
      case 'speedBoost':
        ship.mods.speedMul *= c.spec.power ?? 1.15;
        break;
      case 'search': {
        // Nothing inside the bubble can stay cloaked, and submerged submarines are pinned: marked
        // for extra damage.
        const r = c.spec.power ?? 0;
        for (const s of g.ships) {
          if (!s.alive || s.team === ship.team || Math.hypot(s.pos.x - ship.pos.x, s.pos.z - ship.pos.z) >= r) continue;
          reveal(s, 0.5);
          if (s.submerged) mark(s, 0.5);
        }
        break;
      }
      case 'smoke':
        ship.smokeLay -= dt;
        if (ship.smokeLay <= 0) {
          ship.smokeLay = 1.6;
          const p = ship.localToWorld(-ship.spec.length * 0.4, 0, 0);
          g.addSmoke(p.x, p.z, ship.team);
        }
        break;
      default:
        break;
    }
  }
}
