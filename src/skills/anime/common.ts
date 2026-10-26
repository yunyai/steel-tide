import { canTrack } from '../../core/Targeting';
import type { Game } from '../../core/Game';
import { bearingTo, forwardX, forwardZ } from '../../core/math';
import type { MissileLook, MissileProfile, SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Field, FieldOptions } from '../../weapons/FieldSystem';
import { aimPoint, blinkTo, enemiesOnLine, enemiesWithin, hpFrac, hurt, inCone, nearestEnemy, stun } from '../kit';
import { every, landNear, reticleTarget } from '../scifi/common';
import { def, type SkillDef, type SkillState } from '../types';

export { arc, clingTo, droneDive, enemiesAround, every, hurryCooldowns, isAI, landNear, reticleTarget, spendHull } from '../scifi/common';

// Small helpers the anime kits share, and the Titan Shift ultimate every anime ship carries.

/** Seconds of passive charge before a Titan Shift is ready (damage dealt and taken speed it up). */
const SHIFT_CHARGE = 100;

/**
 * A base ship's ultimate: the Titan Shift into the hull's form (see ShipSpec.shift and
 * Game.shiftShip). The bot shifts when a fight is on, or to save a sinking hull.
 */
export function shiftSkill(spec: Pick<SkillSpec, 'id' | 'name' | 'short' | 'description' | 'accent'>): SkillDef {
  return def(
    { ...spec, ult: true, cooldown: SHIFT_CHARGE, duration: 0, icon: 'shift' },
    {
      activate(ship, game) {
        return game.shiftShip(ship);
      },
      aiShouldUse(ship, game) {
        const reach = (ship.spec.main?.range ?? 6000) * 0.9;
        return enemiesWithin(ship, game, reach).length >= 2 || (hpFrac(ship) < 0.55 && !!nearestEnemy(ship, game, reach));
      },
    },
  );
}

/** Shove `s` straight away from (x, z) at `speed` m/s (heavier hulls move less). */
export function knockFrom(s: Ship, x: number, z: number, speed: number): void {
  const dx = s.pos.x - x;
  const dz = s.pos.z - z;
  const d = Math.hypot(dx, dz) || 1;
  s.shove((dx / d) * speed, (dz / d) * speed);
}

/**
 * Close on `target` in an instant and strike it (Rasengan, Dragon Fist): the ship lands just
 * short of the hull, facing it, deals `damage`, shoves it `knock` m/s and stuns it `stunTime`.
 * False when there was no clear water beside the target.
 */
export function dashStrike(ship: Ship, game: Game, target: Ship, damage: number, skill: SkillSpec, knock: number, stunTime = 0): boolean {
  const gap = (target.spec.length + ship.spec.length) * 0.3 + 60;
  if (!landNear(ship, game, target.pos.x, target.pos.z, gap, bearingTo(target.pos.x, target.pos.z, ship.pos.x, ship.pos.z))) return false;
  ship.heading = ship.prevHeading = ship.renderHeading = bearingTo(ship.pos.x, ship.pos.z, target.pos.x, target.pos.z);
  hurt(ship, target, damage, skill);
  if (target.alive) {
    knockFrom(target, ship.pos.x, ship.pos.z, knock);
    if (stunTime > 0) stun(target, stunTime);
  }
  game.events.emit('explosion', { x: target.pos.x, y: target.spec.freeboard, z: target.pos.z, size: 1.4 });
  return true;
}

/** In the middle of a fight: an enemy within `r`. */
export function fighting(ship: Ship, game: Game, r: number): boolean {
  return !!nearestEnemy(ship, game, r);
}

/** The enemy under the reticle (within `reach`), else the nearest one in reach. */
export function victim(ship: Ship, game: Game, reach: number): Ship | null {
  return reticleTarget(ship, game, reach, 500) ?? nearestEnemy(ship, game, reach);
}

/** Appear beside (or, `behind`, astern of) `t`, facing it. */
export function appearAt(ship: Ship, game: Game, t: Ship, behind: boolean): boolean {
  const gap = (t.spec.length + ship.spec.length) * 0.35 + 120;
  const side = behind ? t.heading + Math.PI : bearingTo(t.pos.x, t.pos.z, ship.pos.x, ship.pos.z) + Math.PI / 2;
  if (!landNear(ship, game, t.pos.x, t.pos.z, gap, side)) return false;
  ship.heading = ship.prevHeading = ship.renderHeading = bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
  return true;
}

/**
 * A run of flash strikes (Silver Dragon Flash, Asura, Constant Flux): `activate` queues the
 * targets' ids in `st.data.ids` (an id may repeat), and each `period` seconds of `update` the ship
 * appears astern of the next one alive and strikes it for `damage` and a `stunTime` stun.
 */
export function flashThrough(ship: Ship, game: Game, st: SkillState, dt: number, period: number, damage: number, stunTime: number): void {
  const ids = st.data.ids as number[] | undefined;
  if (!ids?.length || !every(st, dt, period)) return;
  const id = ids.shift();
  const t = game.ships.find((s) => s.id === id);
  if (!t?.alive || !appearAt(ship, game, t, true)) return;
  hurt(ship, t, damage, st.spec);
  if (t.alive && stunTime > 0) stun(t, stunTime);
  game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 1.2 });
}

/** Queue up to `n` strikes for flashThrough, cycling through `targets` (nearest first). */
export function queueFlash(st: SkillState, targets: Ship[], n: number): boolean {
  if (!targets.length) return false;
  st.data.ids = Array.from({ length: n }, (_, i) => targets[i % targets.length].id);
  return true;
}

/**
 * Dash `reach` metres toward the reticle in an instant (Chidori, Nova Strike): every enemy on the
 * path, `pad` metres either side, takes `damage` and a `stunTime` stun. False with nowhere to land.
 */
export function lineDash(ship: Ship, game: Game, reach: number, damage: number, skill: SkillSpec, stunTime = 0, pad = 60, fire = 0): boolean {
  const p = aimPoint(ship, reach);
  const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
  const d = Math.max(200, Math.hypot(p.x - ship.pos.x, p.z - ship.pos.z));
  const x0 = ship.pos.x;
  const z0 = ship.pos.z;
  const x1 = x0 + forwardX(b) * d;
  const z1 = z0 + forwardZ(b) * d;
  const hit = enemiesOnLine(ship, game, x0, z0, x1, z1, pad);
  if (!blinkTo(ship, game, x1, z1)) return false;
  ship.heading = ship.prevHeading = ship.renderHeading = b;
  for (const s of hit) {
    hurt(ship, s, damage, skill);
    if (!s.alive) continue;
    if (stunTime > 0) stun(s, stunTime);
    if (fire > 0 && game.rng() < fire) burn(s, ship, game);
  }
  return true;
}

/** Set `n` fires on `s` at random sites. */
export function burn(s: Ship, by: Ship, game: Game, n = 1): void {
  for (let i = 0; i < n; i++) s.startFire(Math.floor(game.rng() * 4), by);
}

/** `frac` of `t`'s max hull as skill damage (Hakai, Shock Wille); `pierce` cuts through every defence. */
export function hurtFrac(ship: Ship, t: Ship, frac: number, skill: SkillSpec, pierce = false): number {
  return hurt(ship, t, t.maxHp * frac, skill, pierce);
}

/**
 * A cut along the reticle's bearing (Indra's Arrow, Puncture Wille): `damage` once to every hull
 * on the line out to `length`, shoved `knock` m/s, and set alight with chance `fire`.
 */
export function slash(ship: Ship, game: Game, skill: SkillSpec, length: number, width: number, damage: number, o: { charge?: number; knock?: number; fire?: number; offset?: number } = {}): void {
  const b = game.beams.fire(ship, {
    mode: 'aim',
    skill,
    charge: o.charge ?? 0.3,
    time: 0.4,
    dps: 0,
    strike: damage,
    length,
    width,
    pierce: true,
    rate: 0,
    knock: o.knock ?? 0,
    mx: 0,
    my: ship.spec.freeboard + 10,
    onHit: o.fire ? ignite(ship, game, o.fire) : undefined,
  });
  // A beam that does not swing (rate 0) holds its first bearing, so a fan just turns it once.
  b.yaw += o.offset ?? 0;
}

/** A blade swept across `arc` degrees centred on the reticle's bearing: `damage` once to each hull it cuts. */
export function crescent(ship: Ship, game: Game, skill: SkillSpec, arc: number, length: number, damage: number, o: { charge?: number; time?: number; width?: number; knock?: number; fire?: number } = {}): void {
  game.beams.fire(ship, {
    mode: 'sweep',
    skill,
    charge: o.charge ?? 0.3,
    time: o.time ?? 0.5,
    dps: 0,
    strike: damage,
    length,
    width: o.width ?? 60,
    pierce: true,
    arc,
    knock: o.knock ?? 0,
    mx: 0,
    my: ship.spec.freeboard + 12,
    onHit: o.fire ? ignite(ship, game, o.fire) : undefined,
  });
}

/** A beam's onHit that sets each hull it touches alight once, with chance `chance`. */
function ignite(ship: Ship, game: Game, chance: number): (s: Ship) => void {
  const done = new Set<number>();
  return (s) => {
    if (done.has(s.id)) return;
    done.add(s.id);
    if (game.rng() < chance) burn(s, ship, game);
  };
}

/**
 * `n` homing missiles shared out among `targets` in turn (Thunder Spears, Yasaka Magatama): each
 * hits for `damage` and stuns `stunTime`. False with no one to throw at.
 */
export function volley(
  ship: Ship,
  game: Game,
  targets: Ship[],
  n: number,
  damage: number,
  skill: SkillSpec,
  o: { look?: MissileLook; profile?: MissileProfile; speed?: number; blast?: number; stun?: number; spread?: number; fire?: number; onHit?: (s: Ship) => void } = {},
): boolean {
  if (!targets.length) return false;
  for (let i = 0; i < n; i++) {
    const t = targets[i % targets.length];
    game.missiles.launch(ship, t.pos.x, t.pos.z, i * (o.spread ?? 0.08), damage, {
      profile: o.profile ?? 'skim',
      speed: o.speed ?? 700,
      look: o.look ?? 'spear',
      blast: o.blast ?? 60,
      target: t,
      skill,
      uninterceptable: true,
      fire: o.fire,
      onHit: (s) => {
        if ((o.stun ?? 0) > 0) stun(s, o.stun!);
        o.onHit?.(s);
      },
    });
  }
  return true;
}

/**
 * A field that eats `frac` of each enemy's max hull a second (Infinity Castle, Absorption), on top
 * of whatever else `f` does; `onDrain` hears how much each bite took.
 */
export function rot(ship: Ship, game: Game, f: FieldOptions, frac: number, pierce = false, onDrain?: (amount: number) => void): Field {
  return game.fields.add(ship, {
    ...f,
    onTick: (s, fl) => {
      if (s.team === ship.team) return;
      // Fields tick every quarter second.
      const dealt = s.takeDamage(s.maxHp * frac * 0.25 * ship.mods.damageMul, ship, fl.skill, false, pierce);
      onDrain?.(dealt);
    },
  });
}

/** `n` summons of `specId` fanned out astern of the ship for `time` seconds (no cap: they pile up). */
export function pack(ship: Ship, game: Game, specId: string, n: number, time: number, name: string, spacing = 140): Ship[] {
  const out: Ship[] = [];
  for (let i = 0; i < n; i++) {
    const lateral = (i - (n - 1) / 2) * spacing;
    out.push(game.spawnWingman(ship, lateral, time, -80 - (i % 2) * 60, specId, `${name} ${i + 1}`));
  }
  return out;
}

/** Every enemy in a cone `half` degrees either side of the reticle's bearing, out to `reach`. */
export function inFront(ship: Ship, game: Game, reach: number, half: number): Ship[] {
  const b = bearingTo(ship.pos.x, ship.pos.z, ship.control.aimX, ship.control.aimZ);
  return enemiesWithin(ship, game, reach * ship.mods.reachMul).filter((s) => inCone(ship, s, b, half));
}

/** A cut of a share of the hull: a line ship goes down, a titan or form loses `titanFrac`. */
export function execute(ship: Ship, t: Ship, titanFrac: number, skill: SkillSpec): void {
  hurt(ship, t, t.spec.cls === 'TT' ? t.maxHp * titanFrac : t.maxHp * 4, skill);
}

/** The ship nearest the reticle (within `reach`), friend or foe, other than this one. */
export function anyShipAt(ship: Ship, game: Game, reach: number): Ship | null {
  const p = aimPoint(ship, reach);
  let best: Ship | null = null;
  let bd = 500;
  for (const s of game.ships) {
    if (s === ship || !s.alive || s.deep || (s.team !== ship.team ? !canTrack(ship, s) : s.mods.untargetable)) continue;
    const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
