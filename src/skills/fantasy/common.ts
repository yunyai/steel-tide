import type { Game } from '../../core/Game';
import type { Ship } from '../../ships/Ship';
import type { SkillState } from '../types';
import { aimPoint, enemyNear } from '../kit';

// Small helpers the fantasy kits share.

/** Steered by the computer (a bot, a summon, or a LAN captain who dropped out). */
export function isAI(ship: Ship): boolean {
  return ship.humanIndex < 0 || ship.autopilot;
}

/** The enemy under the reticle, with the reticle pulled in to `reach`. */
export function reticleTarget(ship: Ship, game: Game, reach: number, r = 500): Ship | null {
  const p = aimPoint(ship, reach);
  return enemyNear(ship, game, p.x, p.z, r);
}

/** True once every `period` seconds while a skill runs (the first call fires at once). */
export function every(st: SkillState, dt: number, period: number, key = 'tick'): boolean {
  const t = ((st.data[key] as number | undefined) ?? 0) - dt;
  if (t > 0) {
    st.data[key] = t;
    return false;
  }
  st.data[key] = t + period;
  return true;
}

/** A debuff is on the ship (something a cleanse would clear). */
export function afflicted(s: Ship): boolean {
  return s.effects.some((e) => e.id.startsWith('debuff:'));
}

/** Spend a share of max hull, never the last point of it. */
export function spendHull(ship: Ship, frac: number): void {
  ship.hp = Math.max(1, ship.hp - ship.maxHp * frac);
}
