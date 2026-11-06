import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { buff, hurt } from '../kit';
import { emitMisc, type TitanRider } from './MiscEvents';
import { immovable, moveSafe } from './MiscSupport';

// The Hexweaver binds enemies to dolls. Pins on a doll make its ship take more from every
// Hexweaver hit; needle volleys prick bound ships until their dolls take free pins; stitched dolls
// share what one suffers; and the big skills cash the pins out.

export const HEX = {
  /** Dolls kept at once; a fifth replaces the oldest. */
  dolls: 4,
  battery: { damage: 20000, he: 14000, reload: 4, velocity: 1600 },
  /** Needle hits on a bound ship that make one free pin. */
  pricks: 4,
  /** Extra damage a pinned ship takes from the Hexweaver, per pin. */
  pinBonus: 0.15,
  pin: { charges: 4, recharge: 5, damage: 70000, range: 5000, max: 3, life: 18 },
  stitch: { damage: 100000, radius: 1200, slow: 0.35, slowTime: 3, time: 8, echo: 0.35, echoCap: 150000 },
  twist: { damage: 160000, perPin: 45000, consume: 130000, slow: 0.5, slowTime: 2 },
  fire: { damage: 70000, radius: 650, field: 25000, fieldTime: 5, burn: 30000, perPin: 0.25, time: 6, tick: 0.5 },
  rip: { damage: 150000, radius: 900, perPin: 80000, erupt: 100000, eruptRadius: 450 },
  substitute: { dash: 800, hp: 300000, time: 5, lure: 2000, burst: 150000, burstRadius: 600 },
  coven: { radius: 1800, stitch: 10, dps: 40000, time: 6 },
  needles: { count: 24, damage: 32000, time: 3, perPin: 0.25 },
  unmaking: { damage: 300000, perPin: 150000, blast: 150000, blastRadius: 650 },
} as const;

export interface Doll {
  target: number;
  pins: number;
  /** Needle hits toward the next free pin. */
  pricks: number;
  until: number;
  stitchedUntil: number;
  burnUntil: number;
  /** The next burn tick; parked far ahead while the doll is not burning. */
  burnNext: number;
  /** When the Hexweaver last hurt, pinned and twisted its ship: what the doll reacts to. */
  struck: number;
  pinnedAt: number;
  twistedAt: number;
}

export interface HexweaverState {
  /** When each spent Pin charge comes back. */
  recharge: number[];
  dolls: Doll[];
  decoy: { x: number; z: number; hp: number; until: number } | null;
  needles: { target: number; next: number; left: number }[];
}

export function newHexweaverState(): HexweaverState {
  return { recharge: [], dolls: [], decoy: null, needles: [] };
}

export function pinCharges(s: Ship): number {
  return s.hexweaver ? HEX.pin.charges - s.hexweaver.recharge.filter((t) => t > s.game.time + 1e-8).length : 0;
}

export function dollOf(s: Ship, t: Ship): Doll | undefined {
  return s.hexweaver?.dolls.find((d) => d.target === t.id);
}

/** What the Hexweaver's hits on `t` are multiplied by: +15% per pin on its doll. */
export function hexMul(s: Ship, t: Ship): number {
  return 1 + (dollOf(s, t)?.pins ?? 0) * HEX.pinBonus;
}

/** `burnNext` of a doll that is not burning. */
const IDLE = 1e9;

function stitched(d: Doll, now: number): boolean {
  return d.stitchedUntil > now;
}

function shipOf(s: Ship, d: Doll): Ship | undefined {
  return s.game.ships.find((v) => v.id === d.target && v.alive);
}

/** The doll for `t`, bound if it has none (dropping the oldest of four). */
function bind(s: Ship, t: Ship): Doll {
  const a = s.hexweaver!;
  let d = dollOf(s, t);
  if (!d) {
    if (a.dolls.length >= HEX.dolls) {
      const old = a.dolls.shift()!;
      tear(s, old);
    }
    d = { target: t.id, pins: 0, pricks: 0, until: 0, stitchedUntil: 0, burnUntil: 0, burnNext: IDLE, struck: -1e9, pinnedAt: -1e9, twistedAt: -1e9 };
    a.dolls.push(d);
  }
  d.until = s.game.time + HEX.pin.life;
  return d;
}

/** Adds one pin to `t`'s doll (binding one if needed), spending a charge unless `free`. */
export function pinDoll(s: Ship, t: Ship, free = false): boolean {
  const a = s.hexweaver!;
  const now = s.game.time;
  a.recharge = a.recharge.filter((r) => r > now + 1e-8);
  if (!free && pinCharges(s) <= 0) return s.failSkill('All four Pins are recovering');
  if (!free) a.recharge.push(now + HEX.pin.recharge);
  const d = bind(s, t);
  d.pins = Math.min(HEX.pin.max, d.pins + 1);
  d.pinnedAt = now;
  emitMisc(s, 'pin', t.pos.x, t.pos.z, { target: t, n: d.pins, tx: s.pos.x, tz: s.pos.z });
  return true;
}

/** A needle striking `t`: a bound ship's doll is pricked, and every fourth prick is a free pin. */
export function prick(s: Ship, t: Ship): void {
  const d = dollOf(s, t);
  if (!d) return;
  d.pricks++;
  d.until = s.game.time + HEX.pin.life;
  if (d.pricks < HEX.pricks) return;
  d.pricks = 0;
  if (d.pins < HEX.pin.max) pinDoll(s, t, true);
}

/** The Hexweaver's needle battery: pricks bound ships and hits harder per pin. */
export function hexRider(s: Ship): TitanRider {
  return {
    onHit: (t) => {
      prick(s, t);
      const d = dollOf(s, t);
      if (d) d.struck = s.game.time;
    },
    hitMul: (t) => hexMul(s, t),
  };
}

interface HexHit {
  /** Apply the +15% per pin (skills that scale with pins themselves leave it off). */
  pinned?: boolean;
  /** Echo through stitches to the other stitched dolls. */
  echo?: boolean;
}

/**
 * The Hexweaver hurting `t` for `amount`: the doll flinches, and a stitched doll passes a capped
 * share on to every other stitched doll (once, never echoing on). Returns the damage dealt.
 */
export function hexHurt(s: Ship, t: Ship, amount: number, skill: SkillSpec, o: HexHit = {}): number {
  const now = s.game.time;
  const d = dollOf(s, t);
  const dealt = hurt(s, t, amount * (o.pinned ? hexMul(s, t) : 1), skill);
  if (d) d.struck = now;
  if (!o.echo || !d || !stitched(d, now) || dealt <= 0) return dealt;
  const echo = Math.min(HEX.stitch.echoCap, dealt * HEX.stitch.echo);
  for (const other of s.hexweaver!.dolls.slice()) {
    if (other === d || !stitched(other, now)) continue;
    const v = shipOf(s, other);
    if (!v) continue;
    hurt(s, v, echo, skill);
    other.struck = now;
  }
  return dealt;
}

export function igniteDoll(s: Ship, d: Doll): void {
  const now = s.game.time;
  const fresh = d.burnUntil <= now;
  d.burnUntil = now + HEX.fire.time;
  if (fresh) d.burnNext = now + HEX.fire.tick;
  const t = shipOf(s, d);
  if (t) emitMisc(s, 'ignite', t.pos.x, t.pos.z, { target: t, n: d.pins });
}

/** Burn per second on `d`'s ship. */
export function burnRate(d: Doll): number {
  return HEX.fire.burn * (1 + d.pins * HEX.fire.perPin);
}

/** A doll leaving the shelf: torn to cloth, wherever its ship is. */
function tear(s: Ship, d: Doll): void {
  const t = s.game.ships.find((v) => v.id === d.target);
  emitMisc(s, 'tear', t?.pos.x ?? s.pos.x, t?.pos.z ?? s.pos.z, { target: t });
}

function enemiesNear(s: Ship, x: number, z: number, r: number): Ship[] {
  return s.game.ships.filter((v) => v.alive && v.team !== s.team && !v.mods.untargetable && Math.hypot(v.pos.x - x, v.pos.z - z) < r);
}

// ------------------------------------------------------------------ skills

export function stitch(s: Ship, x: number, z: number, skill: SkillSpec): void {
  const now = s.game.time;
  emitMisc(s, 'stitch', x, z, { radius: HEX.stitch.radius });
  for (const v of enemiesNear(s, x, z, HEX.stitch.radius)) {
    hexHurt(s, v, HEX.stitch.damage, skill, { pinned: true });
    buff(v, 'debuff:stitchSlow', HEX.stitch.slowTime, (m) => {
      m.speedMul *= 1 - HEX.stitch.slow;
    });
    const d = dollOf(s, v);
    if (d) d.stitchedUntil = now + HEX.stitch.time;
  }
}

export function twist(s: Ship, t: Ship, skill: SkillSpec): void {
  const d = dollOf(s, t);
  const pins = d?.pins ?? 0;
  const consume = pins > 0;
  hexHurt(s, t, HEX.twist.damage + pins * HEX.twist.perPin + (consume ? HEX.twist.consume : 0), skill, { echo: true });
  if (d && consume) d.pins--;
  if (d) d.twistedAt = s.game.time;
  // Wrench the hull a quarter turn, toward whichever side faces the Hexweaver, unless it cannot be moved.
  if (!immovable(t)) {
    const side = Math.sin(t.heading) * (s.pos.z - t.pos.z) - Math.cos(t.heading) * (s.pos.x - t.pos.x) >= 0 ? 1 : -1;
    t.heading += (side * Math.PI) / 2;
  }
  buff(t, 'debuff:twist', HEX.twist.slowTime, (m) => {
    m.speedMul *= 1 - HEX.twist.slow;
  });
  emitMisc(s, 'twist', t.pos.x, t.pos.z, { target: t, n: consume ? 1 : 0 });
}

export function effigyFire(s: Ship, x: number, z: number, skill: SkillSpec): void {
  const now = s.game.time;
  const a = s.hexweaver!;
  emitMisc(s, 'fire', x, z, { radius: HEX.fire.radius });
  const lit: Doll[] = [];
  for (const v of enemiesNear(s, x, z, HEX.fire.radius)) {
    hexHurt(s, v, HEX.fire.damage, skill, { pinned: true });
    const d = dollOf(s, v);
    if (d) lit.push(d);
  }
  // Fire runs along the stitches to every other stitched doll.
  if (lit.some((d) => stitched(d, now))) for (const d of a.dolls) if (stitched(d, now) && !lit.includes(d)) lit.push(d);
  for (const d of lit) igniteDoll(s, d);
  s.game.fields.add(s, { x, z, r: HEX.fire.radius, life: HEX.fire.fieldTime, dps: HEX.fire.field, skill, look: 'fire', color: 0xe878bd });
}

export function ripSeam(s: Ship, x: number, z: number, skill: SkillSpec): void {
  const now = s.game.time;
  emitMisc(s, 'rip', x, z, { radius: HEX.rip.radius });
  const erupt: Ship[] = [];
  for (const v of enemiesNear(s, x, z, HEX.rip.radius)) {
    const d = dollOf(s, v);
    const cash = d ? Math.max(0, d.burnUntil - now) * burnRate(d) + d.pins * HEX.rip.perPin : 0;
    hexHurt(s, v, HEX.rip.damage + cash, skill, { echo: true });
    if (!d) continue;
    if (stitched(d, now)) erupt.push(v);
    d.pins = 0;
    d.burnUntil = now;
    d.burnNext = IDLE;
  }
  for (const v of erupt) {
    emitMisc(s, 'erupt', v.pos.x, v.pos.z, { target: v, radius: HEX.rip.eruptRadius });
    for (const o of enemiesNear(s, v.pos.x, v.pos.z, HEX.rip.eruptRadius)) hexHurt(s, o, HEX.rip.erupt, skill);
  }
}

export function substitute(s: Ship, x: number, z: number): boolean {
  const from = { x: s.pos.x, z: s.pos.z };
  if (!moveSafe(s, x, z)) return s.failSkill('Substitute needs clear water');
  s.hexweaver!.decoy = { ...from, hp: HEX.substitute.hp, until: s.game.time + HEX.substitute.time };
  emitMisc(s, 'substitute', from.x, from.z, { tx: s.pos.x, tz: s.pos.z, radius: HEX.substitute.lure });
  return true;
}

/** Where a hostile Hexweaver's effigy draws `ship`'s fire, if one stands within reach. */
export function effigyLure(ship: Ship): { x: number; z: number } | null {
  const now = ship.game.time;
  for (const h of ship.game.ships) {
    const d = h.hexweaver?.decoy;
    if (!d || !h.alive || h.team === ship.team || d.until <= now || d.hp <= 0) continue;
    if (Math.hypot(ship.pos.x - d.x, ship.pos.z - d.z) < HEX.substitute.lure) return { x: d.x, z: d.z };
  }
  return null;
}

export function coven(s: Ship, x: number, z: number, skill: SkillSpec): void {
  const now = s.game.time;
  emitMisc(s, 'coven', x, z, { radius: HEX.coven.radius });
  for (const v of enemiesNear(s, x, z, HEX.coven.radius)) if (!dollOf(s, v)?.pins) pinDoll(s, v, true);
  for (const d of s.hexweaver!.dolls) d.stitchedUntil = now + HEX.coven.stitch;
  s.game.fields.add(s, { x, z, r: HEX.coven.radius, life: HEX.coven.time, dps: HEX.coven.dps, skill, look: 'hex', color: 0xe878bd });
}

export function thousandNeedles(s: Ship, t: Ship): void {
  s.hexweaver!.needles.push({ target: t.id, next: s.game.time, left: HEX.needles.count });
}

export function unmake(s: Ship, skill: SkillSpec): boolean {
  const a = s.hexweaver!;
  if (!a.dolls.length) return s.failSkill('Bind at least one doll before Unmaking');
  const now = s.game.time;
  const dolls = a.dolls.slice();
  a.dolls = [];
  for (const d of dolls) {
    const v = shipOf(s, d);
    if (!v) continue;
    const blast = stitched(d, now);
    emitMisc(s, 'unmake', v.pos.x, v.pos.z, { target: v, n: d.pins, radius: blast ? HEX.unmaking.blastRadius : undefined });
    hurt(s, v, HEX.unmaking.damage + d.pins * HEX.unmaking.perPin, skill);
    if (blast) for (const o of enemiesNear(s, v.pos.x, v.pos.z, HEX.unmaking.blastRadius)) hurt(s, o, HEX.unmaking.blast, skill);
  }
  return true;
}

// ------------------------------------------------------------------ upkeep

export function clearHexweaver(s: Ship): void {
  if (s.hexweaver) s.hexweaver = newHexweaverState();
  for (const o of s.game.ships) if (o.hexweaver) o.hexweaver.dolls = o.hexweaver.dolls.filter((d) => d.target !== s.id);
}

/** Damage aimed at the Hexweaver that its effigy soaks up first. */
export function hexweaverAbsorb(s: Ship, amount: number): number {
  const d = s.hexweaver?.decoy;
  if (!d || d.until <= s.game.time || d.hp <= 0) return amount;
  const n = Math.min(d.hp, amount);
  d.hp -= n;
  return amount - n;
}

export function updateHexweaver(s: Ship, _dt: number): void {
  const a = s.hexweaver;
  if (!a) return;
  const now = s.game.time;
  a.recharge = a.recharge.filter((t) => t > now + 1e-8);
  const kept: Doll[] = [];
  for (const d of a.dolls) {
    if (d.until > now && s.game.ships.some((t) => t.id === d.target && t.alive)) kept.push(d);
    else tear(s, d);
  }
  a.dolls = kept;
  for (const d of a.dolls) {
    const t = shipOf(s, d)!;
    while (d.burnNext <= now + 1e-6 && d.burnNext <= d.burnUntil + 1e-6) {
      d.burnNext += HEX.fire.tick;
      hexHurt(s, t, burnRate(d) * HEX.fire.tick, s.skills[3].spec);
      if (!t.alive) break;
    }
  }
  const every = HEX.needles.time / HEX.needles.count;
  for (const n of a.needles) {
    while (n.left > 0 && n.next <= now + 1e-6) {
      n.next += every;
      n.left--;
      const t = s.game.ships.find((v) => v.id === n.target && v.alive);
      if (!t) {
        n.left = 0;
        break;
      }
      const d = dollOf(s, t);
      emitMisc(s, 'needle', t.pos.x, t.pos.z, { target: t, n: n.left });
      hexHurt(s, t, HEX.needles.damage * (1 + (d?.pins ?? 0) * HEX.needles.perPin), s.skills[7].spec, { echo: true });
    }
  }
  a.needles = a.needles.filter((n) => n.left > 0);
  const decoy = a.decoy;
  if (decoy && (decoy.until <= now || decoy.hp <= 0)) {
    a.decoy = null;
    emitMisc(s, 'decoyBurst', decoy.x, decoy.z, { radius: HEX.substitute.burstRadius });
    for (const v of enemiesNear(s, decoy.x, decoy.z, HEX.substitute.burstRadius)) hexHurt(s, v, HEX.substitute.burst, s.skills[5].spec, { pinned: true });
  }
}
