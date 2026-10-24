import type { Game } from '../../core/Game';
import { forwardX, forwardZ } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Missile } from '../../weapons/MissileSystem';
import { clearWater, placeAt } from '../kit';

export { every, isAI, reticleTarget, spendHull } from '../fantasy/common';
export { dropLocks, enemiesAround, laser } from '../modern/common';

// Small helpers the sci-fi kits share.

/** A laser lancing straight down from orbit onto a hull (or a point). */
export function orbitalLaser(game: Game, x: number, z: number, color: number): void {
  game.events.emit('lightning', {
    points: [
      { x: x + 120, y: 1800, z: z - 80 },
      { x, y: 2, z },
    ],
    color,
    straight: true,
  });
}

/** A bolt from one hull to another (chains, splinters, prism forks). */
export function arc(game: Game, from: Ship, to: Ship, color: number, straight = true): void {
  game.events.emit('lightning', {
    points: [
      { x: from.pos.x, y: from.spec.freeboard + 6, z: from.pos.z },
      { x: to.pos.x, y: to.spec.freeboard + 6, z: to.pos.z },
    ],
    color,
    straight,
  });
}

/** `n` combat drones (drawn as small drones) diving on `target`, staggered over `spread` seconds. */
export function droneDive(ship: Ship, game: Game, target: Ship, n: number, damage: number, skill: SkillSpec, spread = 0.6, onHit: ((s: Ship) => void) | null = null): Missile[] {
  const out: Missile[] = [];
  for (let i = 0; i < n; i++) {
    out.push(game.missiles.launch(ship, target.pos.x, target.pos.z, (i * spread) / Math.max(1, n), damage, { profile: 'skim', speed: 360, look: 'drone', blast: 45, fire: 0.05, target, skill, onHit, hp: 350 }));
  }
  return out;
}

/** A damage-over-time cloud riding one hull (venom, nanites, coils): `dps` for `time` seconds. */
export function clingTo(owner: Ship, game: Game, target: Ship, dps: number, time: number, skill: SkillSpec, o: { healBlock?: boolean; root?: boolean; slow?: number } = {}): void {
  game.fields.add(owner, { x: target.pos.x, z: target.pos.z, r: 30, life: time, follow: target, dps, skill, look: 'nanite', healBlock: !!o.healBlock, root: !!o.root, slow: o.slow ?? 1 });
}

/** Put `s` down at the first clear water `d` metres from (x, z) along one of a few bearings. */
export function landNear(s: Ship, game: Game, x: number, z: number, d: number, bearing: number): boolean {
  for (let k = 0; k < 8; k++) {
    const b = bearing + k * (Math.PI / 4);
    const px = x + forwardX(b) * d;
    const pz = z + forwardZ(b) * d;
    if (!clearWater(game, s, px, pz)) continue;
    placeAt(s, game, px, pz);
    return true;
  }
  return false;
}

/** Every normal skill on `s` ticks down `extra` seconds more this step (Full Moon, Bridge of Magpies). */
export function hurryCooldowns(s: Ship, extra: number): void {
  for (const k of s.skills) if (!k.spec.ult && k.cooldown > 0) k.cooldown = Math.max(0, k.cooldown - extra);
}
