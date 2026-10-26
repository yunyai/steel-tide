import type { Team } from './types';
import type { Ship } from '../ships/Ship';

/** Deterministic contact rules. Camera line of sight is deliberately separate. */
export function revealedTo(target: Ship, team: Team): boolean {
  if (target.mods.banished) return false;
  if (target.mods.revealed || target.game.exposed[team] > 0) return true;
  return target.game.ships.some(s => s.alive && s.team === team && s.consumables.some(c =>
    c.spec.type === 'search' && c.active > 0 && Math.hypot(s.pos.x - target.pos.x, s.pos.z - target.pos.z) <= (c.spec.power ?? 0)));
}

export function concealmentReason(target: Ship, team: Team): string | null {
  if (!target.alive) return 'Target sunk';
  if (target.team === team) return null;
  if (target.mods.banished) return 'Target banished';
  if (revealedTo(target, team)) return null;
  if (target.mods.untargetable) return 'Target cloaked';
  if (target.submerged) return 'Submarine contact lost: use search';
  if (target.game.inSmoke(target.pos.x, target.pos.z)) return 'Target concealed by smoke';
  return null;
}

export function contactVisible(target: Ship, team: Team): boolean {
  return target.alive && concealmentReason(target, team) === null;
}

export function canTrack(observer: Ship, target: Ship): boolean {
  if (target.team === observer.team || !contactVisible(target, observer.team)) return false;
  return target.mods.lockRange <= 0 || Math.hypot(target.pos.x - observer.pos.x, target.pos.z - observer.pos.z) <= target.mods.lockRange;
}
