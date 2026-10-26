import type { Team } from './types';
import type { Ship } from '../ships/Ship';

export const FORCED_DETECTION_RANGE = 500;
export const NEARBY_DETECTION_RANGE = 1500;
export const SUB_HIGHLIGHT_RANGE = 500;
export type ProximityContact = 'forced' | 'nearby' | 'submarine' | null;
export type RevealSource = 'ability' | 'sonar' | 'proximity' | null;

/** Team-shared, deterministic contact rules. Camera line of sight is deliberately separate. */
export function proximityContact(target: Ship, team: Team): ProximityContact {
  if (!target.alive || target.withdrawn || target.team === team || target.mods.banished) return null;
  const ordinary = !target.submerged && !target.mods.untargetable && target.mods.lockRange <= 0 && !target.game.inSmoke(target.pos.x, target.pos.z);
  const close = target.submerged ? SUB_HIGHLIGHT_RANGE : FORCED_DETECTION_RANGE;
  let nearby = false;
  for (const s of target.game.ships) {
    if (!s.alive || s.withdrawn || s.mods.banished || s.team !== team) continue;
    const dx = s.pos.x - target.pos.x, dz = s.pos.z - target.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= close * close) return target.submerged ? 'submarine' : 'forced';
    if (ordinary && d2 <= NEARBY_DETECTION_RANGE * NEARBY_DETECTION_RANGE) nearby = true;
  }
  return nearby ? 'nearby' : null;
}

export function revealSource(target: Ship, team: Team): RevealSource {
  if (!target.alive || target.withdrawn || target.mods.banished || target.team === team) return null;
  if (target.mods.revealed || target.game.exposed[team] > 0) return 'ability';
  if (target.game.ships.some(s => s.alive && !s.withdrawn && !s.mods.banished && s.team === team && s.consumables.some(c =>
    c.spec.type === 'search' && c.active > 0 && Math.hypot(s.pos.x - target.pos.x, s.pos.z - target.pos.z) <= (c.spec.power ?? 0)))) return 'sonar';
  const p = proximityContact(target, team);
  return p === 'forced' || p === 'nearby' ? 'proximity' : null;
}

export function revealedTo(target: Ship, team: Team): boolean {
  return revealSource(target, team) !== null;
}

export function concealmentReason(target: Ship, team: Team): string | null {
  if (!target.alive) return 'Target sunk';
  if (target.team === team) return null;
  if (target.mods.banished) return 'Target banished';
  // Ordinary surface contacts already remain visible at distance; avoid a fleet scan for them.
  if (!target.mods.untargetable && !target.submerged && !target.game.inSmoke(target.pos.x, target.pos.z)) return null;
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
  return target.mods.lockRange <= 0 || Math.hypot(target.pos.x - observer.pos.x, target.pos.z - observer.pos.z) <= target.mods.lockRange || proximityContact(target, observer.team) === 'forced';
}
