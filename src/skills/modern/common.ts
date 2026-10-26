import { canTrack, proximityContact } from '../../core/Targeting';
import type { Game } from '../../core/Game';
import type { SkillSpec, SquadronType } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Squadron } from '../../weapons/AircraftSystem';

export { every, isAI, reticleTarget } from '../fantasy/common';

// Small helpers the modern kits share.

/** A straight laser (or tracer) line from the ship's mast to a point. */
export function laser(ship: Ship, game: Game, x: number, y: number, z: number, color: number): void {
  game.events.emit('lightning', {
    points: [
      { x: ship.pos.x, y: ship.spec.freeboard + 22, z: ship.pos.z },
      { x, y, z },
    ],
    color,
    straight: true,
  });
}

/**
 * Send a squadron (not drawn from the hangar) of `type` straight at `target`, its payload scaled so
 * that a good attack lands about `damage`. Only carriers have the planes; others return null.
 */
export function airStrike(ship: Ship, game: Game, type: SquadronType, target: Ship, damage: number, skill: SkillSpec, o: { aaImmune?: number; fire?: number } = {}): Squadron | null {
  const air = ship.spec.air;
  if (!air) return null;
  const sq = game.air.launch(ship, type, target.pos.x, target.pos.z, true);
  if (!sq) return null;
  // Bombs and torpedoes miss some of the time: about two in three land.
  sq.damageMul = (damage * 1.5) / (air[type].planes * air[type].damage);
  sq.skill = skill;
  sq.target = target;
  if (o.aaImmune) sq.aaImmune = game.time + o.aaImmune;
  if (o.fire !== undefined) sq.fire = o.fire;
  return sq;
}

/** Countermeasures break guidance; stealth cannot shake a forced proximity contact. */
export function dropLocks(ship: Ship, game: Game, reason: 'countermeasure' | 'stealth' = 'countermeasure'): void {
  for (const m of game.missiles.missiles) {
    if (!m.alive || m.target !== ship) continue;
    if (reason === 'stealth' && proximityContact(ship, m.team) === 'forced') continue;
    m.target = null;
    m.tx += (game.rng() - 0.5) * 600;
    m.tz += (game.rng() - 0.5) * 600;
  }
  for (const t of game.torps.torps) {
    if (!t.alive || t.homing !== ship) continue;
    if (reason === 'stealth' && proximityContact(ship, t.team) === 'forced') continue;
    t.homing = null;
  }
}

/** Enemies within `r` of a point, nearest first. */
export function enemiesAround(ship: Ship, game: Game, x: number, z: number, r: number): Ship[] {
  const d = (s: Ship) => Math.hypot(s.pos.x - x, s.pos.z - z);
  return game.ships.filter((s) => canTrack(ship, s) && d(s) < r).sort((a, b) => d(a) - d(b));
}
