import { MAP_HALF, SHELL_TIME_SCALE } from '../../config';
import type { Game } from '../../core/Game';
import { forwardX, forwardZ } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Mods, Ship } from '../../ships/Ship';
import { buff, clearWater, hurt, placeAt } from '../kit';
import { emitMisc, type TitanRider } from './MiscEvents';

// The Gourmand eats the battle and cooks with it. Its pantry fills with what its mouth swallows
// and what its hits knock loose; every salvo spends one ingredient for a flavour, and its skills
// chomp, carve, lob a pressure cooker, serve dishes and swallow ships whole.

export const GOURMAND = {
  capacity: 18,
  banquetCapacity: 30,
  /** Radius of the bow mouth that eats rounds, and while Banquet runs. */
  mouth: 310,
  banquetMouth: 500,
  battery: { damage: 36000, he: 30000, reload: 7.5, velocity: 760, splash: 250, splashDamage: 12000 },
  /** What a salvo's ingredient adds: shells hit harder and pierce, explosives splash wider and burn, scrap throws shrapnel. */
  flavour: { shellMul: 1.4, splashMul: 1.5, fire: 0.35, shrapnel: 400, shrapnelDamage: 10000, knock: 40 },
  devour: { time: 4, heal: 4000, pull: 1200, pullSpeed: 120, chomp: 450, dps: 50000, tick: 0.25 },
  carve: { damage: 180000, radius: 900, bleed: 15000, bleedTime: 4, tick: 0.5, scrap: 2 },
  cooker: { range: 3000, fuse: 1.5, damage: 200000, perIngredient: 15000, max: 10, radius: 500, perExplosive: 40, focus: 20000, ring: 300, shrapnel: 8000, knock: 30, perScrap: 6 },
  skewer: { damage: 150000, range: 2500, time: 2, speed: 420, chomp: 100000, scrap: 2 },
  serve: { damage: 150000, radius: 350, range: 3500, delay: 0.55, spend: 3 },
  comfort: { heal: 0.03, perHeal: 20000, shield: 150000, perShield: 40000, shieldTime: 6, burp: 600, burpDamage: 60000, burpKnock: 80, burpDelay: 0.6 },
  banquet: { time: 12, every: 1, side: 90000, targets: 2, reach: 3500, sideRadius: 300, reduction: 0.2 },
  swallow: { reach: 1000, warning: 0.8, bite: 200000, digest: 120000, tick: 0.5, time: 3, spit: 200000, spitRadius: 450 },
  catastrophe: { fuse: 1, damage: 500000, perIngredient: 25000, radius: 1500, perExplosive: 35, focus: 10000, knock: 100, perScrap: 15, oil: 40000, oilRadius: 800, oilTime: 6 },
} as const;

/** Skill slots, Q E Z X C V R T B. */
const SLOT = { devour: 0, carve: 1, cooker: 2, skewer: 3, serve: 4, comfort: 5, banquet: 6, swallow: 7, catastrophe: 8 } as const;

export interface Pantry {
  shells: number;
  explosives: number;
  /** Scrap: wrecks, carved plating and what hitting salvos knock loose. */
  wreckage: number;
}

export type Flavour = keyof Pantry;

/** Flavours in tie-break order; events carry a flavour as its index + 1 (0: plain). */
export const FLAVOURS: readonly Flavour[] = ['shells', 'explosives', 'wreckage'];

/** A dish in the air: Serve's, or a Banquet side dish. */
export interface Dish {
  x: number;
  z: number;
  at: number;
  damage: number;
  radius: number;
  flavour: Flavour | null;
  slot: number;
}

export interface GourmandState {
  pantry: Pantry;
  mouthUntil: number;
  /** The next Devour chomp. */
  chompNext: number;
  banquetUntil: number;
  nextServing: number;
  eatenWrecks: number[];
  reel: { target: number; until: number } | null;
  bite: { target: number; at: number; x: number; z: number } | null;
  swallow: {
    target: number;
    until: number;
    nextTick: number;
    originX: number;
    originZ: number;
    heldX: number;
    heldZ: number;
  } | null;
  dishes: Dish[];
  cooker: { x: number; z: number; at: number; spent: Pantry } | null;
  /** When Comfort Food's burp goes off; 0 when none is due. */
  burpAt: number;
  blast: { at: number; spent: Pantry } | null;
  bleeds: { target: number; until: number; next: number }[];
  servings: number;
}

export const emptyPantry = (): Pantry => ({ shells: 0, explosives: 0, wreckage: 0 });

export function newGourmandState(): GourmandState {
  return {
    pantry: emptyPantry(),
    mouthUntil: 0,
    chompNext: 0,
    banquetUntil: 0,
    nextServing: 0,
    eatenWrecks: [],
    reel: null,
    bite: null,
    swallow: null,
    dishes: [],
    cooker: null,
    burpAt: 0,
    blast: null,
    bleeds: [],
    servings: 0,
  };
}

export const pantryTotal = (p: Pantry): number => p.shells + p.explosives + p.wreckage;

export function pantryCapacity(s: Ship): number {
  return s.gourmand && s.game.time < s.gourmand.banquetUntil ? GOURMAND.banquetCapacity : GOURMAND.capacity;
}

export function ingredient(s: Ship, kind: Flavour, amount = 1): void {
  const a = s.gourmand;
  if (!a) return;
  a.pantry[kind] += Math.max(0, Math.min(amount, pantryCapacity(s) - pantryTotal(a.pantry)));
}

/** The flavour the next salvo takes: the fullest jar, ties going shells, explosives, scrap. */
export function nextFlavour(p: Pantry): Flavour | null {
  let best: Flavour | null = null;
  for (const k of FLAVOURS) if (p[k] > 0 && (!best || p[k] > p[best])) best = k;
  return best;
}

/** Takes up to `n` ingredients out of `p`, one at a time from the fullest jar. */
export function spend(p: Pantry, n: number): Pantry {
  const out = emptyPantry();
  for (let i = 0; i < n; i++) {
    const k = nextFlavour(p);
    if (!k) break;
    p[k]--;
    out[k]++;
  }
  return out;
}

export function flavourIndex(f: Flavour | null): number {
  return f ? FLAVOURS.indexOf(f) + 1 : 0;
}

export function swallowedBy(game: Game, target: Ship): Ship | null {
  return game.ships.find((s) => s.alive && s.gourmand?.swallow?.target === target.id) ?? null;
}

/** Swallowing restricts external attacks but deliberately keeps defensive actions usable. */
export function gourmandBlocksSkill(game: Game, s: Ship, index: number): boolean {
  if (!swallowedBy(game, s)) return false;
  const k = s.skills[index]?.spec;
  return !!k && !k.alwaysUsable && !['shield', 'heal', 'cloak', 'blink', 'shift', 'speed'].includes(k.icon);
}

export function gourmandSwallowMods(s: Ship, m: Mods): void {
  if (!swallowedBy(s.game, s)) return;
  m.rooted = m.disarmed = m.untargetable = true;
}

function skill(s: Ship, index: number): SkillSpec {
  return s.skills[index].spec;
}

function enemiesNear(s: Ship, x: number, z: number, r: number): Ship[] {
  return s.game.ships.filter((v) => v.alive && v.team !== s.team && !v.mods.untargetable && Math.hypot(v.pos.x - x, v.pos.z - z) < r);
}

/** Shoves `v` away from `x, z` at `speed` m/s. */
function knock(v: Ship, x: number, z: number, speed: number): void {
  const dx = v.pos.x - x;
  const dz = v.pos.z - z;
  const d = Math.hypot(dx, dz) || 1;
  v.shove((dx / d) * speed, (dz / d) * speed);
}

function ignite(s: Ship, v: Ship): void {
  v.startFire(Math.floor(s.game.rng() * 4), s);
}

/** The point at the bow where the mouth opens. */
export function mouthPoint(s: Ship): { x: number; z: number } {
  return s.localToWorld(s.spec.length * 0.5 + 95, 0, 0);
}

// ------------------------------------------------------------------ battery

/** A salvo's flavour, taken from the pantry when the turret fires, and the scrap a hit brings back. */
export function gourmandRider(s: Ship): TitanRider {
  const a = s.gourmand!;
  const F = GOURMAND.flavour;
  const B = GOURMAND.battery;
  const flavour = nextFlavour(a.pantry);
  if (flavour) a.pantry[flavour]--;
  const radius = B.splash * (flavour === 'explosives' ? F.splashMul : 1);
  const land = (x: number, z: number, hit: Ship | null) => {
    for (const v of enemiesNear(s, x, z, radius)) {
      if (v === hit) continue;
      v.takeDamage(B.splashDamage * s.mods.damageMul, s);
      if (flavour === 'explosives' && s.game.rng() < F.fire) ignite(s, v);
    }
    if (flavour === 'wreckage') shrapnel(s, x, z, 0, F.shrapnel, F.shrapnelDamage, F.knock, null);
    emitMisc(s, 'dish', x, z, { target: hit ?? undefined, n: flavourIndex(flavour), radius });
  };
  return {
    onFirstHit: () => ingredient(s, 'wreckage', 1),
    onHit: (t, x, z) => land(x, z, t),
    onLand: (x, z) => land(x, z, null),
    hitMul: flavour === 'shells' ? () => F.shellMul : undefined,
    pierce: flavour === 'shells',
    fire: flavour === 'explosives',
  };
}

/** Shrapnel thrown between `inner` and `outer` metres of `x, z`, and a knock for everything inside `outer`. */
function shrapnel(s: Ship, x: number, z: number, inner: number, outer: number, damage: number, speed: number, spec: SkillSpec | null): void {
  for (const v of enemiesNear(s, x, z, outer)) {
    if (Math.hypot(v.pos.x - x, v.pos.z - z) >= inner && damage > 0) {
      if (spec) hurt(s, v, damage, spec);
      else v.takeDamage(damage * s.mods.damageMul, s);
    }
    knock(v, x, z, speed);
  }
}

// ------------------------------------------------------------------ skills

/** Q: the bow mouth opens, eating rounds, pulling ships ahead in and chomping those it reaches. */
export function devour(s: Ship): void {
  const a = s.gourmand!;
  a.mouthUntil = s.game.time + GOURMAND.devour.time;
  a.chompNext = s.game.time + GOURMAND.devour.tick;
  const m = mouthPoint(s);
  emitMisc(s, 'devour', m.x, m.z, { radius: GOURMAND.devour.chomp });
}

/** E: giant cutlery through everything within 900 m; the cuts bleed and give scrap. */
export function carve(s: Ship): boolean {
  const C = GOURMAND.carve;
  const now = s.game.time;
  const targets = enemiesNear(s, s.pos.x, s.pos.z, C.radius);
  if (!targets.length) return s.failSkill('Carve: bring an enemy within 900 m');
  const a = s.gourmand!;
  emitMisc(s, 'carve', s.pos.x, s.pos.z, { radius: C.radius, n: targets.length });
  for (const t of targets) {
    hurt(s, t, C.damage, skill(s, SLOT.carve));
    ingredient(s, 'wreckage', C.scrap);
    a.bleeds = a.bleeds.filter((b) => b.target !== t.id);
    a.bleeds.push({ target: t.id, until: now + C.bleedTime, next: now + C.tick });
    emitMisc(s, 'slice', t.pos.x, t.pos.z, { target: t });
  }
  return true;
}

/** Z: lobs the pressure cooker at `x, z` with up to ten ingredients inside. */
export function pressureCooker(s: Ship, x: number, z: number): void {
  const a = s.gourmand!;
  const spent = spend(a.pantry, GOURMAND.cooker.max);
  a.cooker = { x, z, at: s.game.time + GOURMAND.cooker.fuse, spent };
  emitMisc(s, 'cooker', s.pos.x, s.pos.z, { tx: x, tz: z, n: pantryTotal(spent), radius: cookerRadius(spent) });
}

export function cookerRadius(p: Pantry): number {
  return GOURMAND.cooker.radius + p.explosives * GOURMAND.cooker.perExplosive;
}

export function cookerDamage(p: Pantry): number {
  return GOURMAND.cooker.damage + pantryTotal(p) * GOURMAND.cooker.perIngredient;
}

function burstCooker(s: Ship): void {
  const a = s.gourmand!;
  const c = a.cooker!;
  a.cooker = null;
  const K = GOURMAND.cooker;
  const spec = skill(s, SLOT.cooker);
  const r = cookerRadius(c.spent);
  const victims = enemiesNear(s, c.x, c.z, r);
  for (const v of victims) {
    hurt(s, v, cookerDamage(c.spent), spec);
    if (c.spent.explosives > 0) ignite(s, v);
  }
  // Shells fly straight at the hull nearest the pot.
  const focus = nearestTo(victims, c.x, c.z);
  if (focus && c.spent.shells > 0) hurt(s, focus, c.spent.shells * K.focus, spec);
  if (c.spent.wreckage > 0) shrapnel(s, c.x, c.z, r, r + K.ring, c.spent.wreckage * K.shrapnel, K.knock + c.spent.wreckage * K.perScrap, spec);
  emitMisc(s, 'cookerBurst', c.x, c.z, { radius: r, n: pantryTotal(c.spent) });
}

function nearestTo(ships: Ship[], x: number, z: number): Ship | null {
  let best: Ship | null = null;
  let near = Infinity;
  for (const v of ships) {
    const d = Math.hypot(v.pos.x - x, v.pos.z - z);
    if (d < near || (d === near && best && v.id < best.id)) {
      near = d;
      best = v;
    }
  }
  return best;
}

/** X: a harpoon-fork into `t`, reeling it to the mouth. */
export function skewer(s: Ship, t: Ship): void {
  hurt(s, t, GOURMAND.skewer.damage, skill(s, SLOT.skewer));
  s.gourmand!.reel = { target: t.id, until: s.game.time + GOURMAND.skewer.time };
  emitMisc(s, 'skewer', s.pos.x, s.pos.z, { tx: t.pos.x, tz: t.pos.z, target: t });
}

/** C: a dish lobbed at `x, z`, flavoured by up to three of the fullest jar's ingredients. */
export function serve(s: Ship, x: number, z: number): void {
  const a = s.gourmand!;
  const S = GOURMAND.serve;
  const flavour = nextFlavour(a.pantry);
  if (flavour) a.pantry[flavour] -= Math.min(S.spend, a.pantry[flavour]);
  const radius = S.radius * (flavour === 'explosives' ? GOURMAND.flavour.splashMul : 1);
  const damage = S.damage * (flavour === 'shells' ? GOURMAND.flavour.shellMul : 1);
  a.dishes.push({ x, z, at: s.game.time + S.delay, damage, radius, flavour, slot: SLOT.serve });
  a.servings++;
  emitMisc(s, 'serve', s.pos.x, s.pos.z, { tx: x, tz: z, n: flavourIndex(flavour), radius });
}

function landDish(s: Ship, d: Dish): void {
  const spec = skill(s, d.slot);
  for (const v of enemiesNear(s, d.x, d.z, d.radius)) {
    hurt(s, v, d.damage, spec);
    if (d.flavour === 'explosives') ignite(s, v);
  }
  if (d.flavour === 'wreckage') shrapnel(s, d.x, d.z, d.radius, d.radius + GOURMAND.flavour.shrapnel, GOURMAND.flavour.shrapnelDamage * 2, GOURMAND.flavour.knock * 1.5, spec);
  emitMisc(s, 'plate', d.x, d.z, { radius: d.radius, n: flavourIndex(d.flavour) });
}

/** V: eats the whole pantry to heal and shield, then burps a shockwave. */
export function comfortFood(s: Ship): void {
  const a = s.gourmand!;
  const C = GOURMAND.comfort;
  const n = pantryTotal(a.pantry);
  a.pantry = emptyPantry();
  s.heal(s.maxHp * C.heal + n * C.perHeal);
  s.addShield(C.shield + n * C.perShield, C.shieldTime);
  a.burpAt = s.game.time + C.burpDelay;
  emitMisc(s, 'comfort', s.pos.x, s.pos.z, { n });
}

/** R: twelve seconds of feast. */
export function banquet(s: Ship): void {
  const a = s.gourmand!;
  const B = GOURMAND.banquet;
  a.banquetUntil = s.game.time + B.time;
  a.nextServing = s.game.time;
  buff(s, 'gourmandBanquet', B.time, (m) => {
    m.damageTakenMul *= 1 - B.reduction;
  });
  emitMisc(s, 'banquet', s.pos.x, s.pos.z, { radius: GOURMAND.banquetMouth });
}

/** T: warns `t` with a bite circle, then swallows it if it is still there. */
export function beginSwallow(s: Ship, t: Ship): boolean {
  const a = s.gourmand;
  if (!a) return false;
  if (a.swallow || a.bite || swallowedBy(s.game, s) || swallowedBy(s.game, t) || t.deep || t.mods.banished || t.mods.untargetable)
    return s.failSkill('Swallow Whole: target cannot be swallowed');
  const W = GOURMAND.swallow;
  a.bite = { target: t.id, at: s.game.time + W.warning, x: t.pos.x, z: t.pos.z };
  // A bespoke warning: the AI steers clear of it, and the Gourmand's own effects draw it.
  s.game.strikes.spawn(s, { kind: 'rod', skill: skill(s, SLOT.swallow), x: t.pos.x, z: t.pos.z, radius: 380, delay: W.warning, damage: 0, look: 'bespoke' });
  emitMisc(s, 'bite', t.pos.x, t.pos.z, { target: t, radius: 380 });
  return true;
}

/** B: everything in the kitchen goes up after a second's fuse. */
export function kitchenCatastrophe(s: Ship): void {
  const a = s.gourmand!;
  const spent = a.pantry;
  a.pantry = emptyPantry();
  a.blast = { at: s.game.time + GOURMAND.catastrophe.fuse, spent };
  emitMisc(s, 'fuse', s.pos.x, s.pos.z, { n: pantryTotal(spent), radius: catastropheRadius(spent) });
}

export function catastropheRadius(p: Pantry): number {
  return GOURMAND.catastrophe.radius + p.explosives * GOURMAND.catastrophe.perExplosive;
}

function blowKitchen(s: Ship): void {
  const a = s.gourmand!;
  const p = a.blast!.spent;
  a.blast = null;
  const K = GOURMAND.catastrophe;
  const spec = skill(s, SLOT.catastrophe);
  const r = catastropheRadius(p);
  const victims = enemiesNear(s, s.pos.x, s.pos.z, r);
  for (const v of victims) {
    hurt(s, v, K.damage + pantryTotal(p) * K.perIngredient, spec);
    if (p.explosives > 0) ignite(s, v);
    knock(v, s.pos.x, s.pos.z, K.knock + p.wreckage * K.perScrap);
  }
  const focus = nearestTo(victims, s.pos.x, s.pos.z);
  if (focus && p.shells > 0) hurt(s, focus, p.shells * K.focus, spec);
  s.game.fields.add(s, { x: s.pos.x, z: s.pos.z, r: K.oilRadius, life: K.oilTime, dps: K.oil, skill: spec, look: 'fire', color: 0xff8844 });
  emitMisc(s, 'catastrophe', s.pos.x, s.pos.z, { radius: r, n: pantryTotal(p) });
}

// ------------------------------------------------------------------ swallowing

function isClear(s: Ship, x: number, z: number): boolean {
  if (!clearWater(s.game, s, x, z)) return false;
  return !s.game.ships.some((o) => o !== s && o.alive && !swallowedBy(s.game, o) && Math.hypot(o.pos.x - x, o.pos.z - z) < (o.spec.length + s.spec.length) * 0.42);
}

/** Search around the mouth first, then the pre-swallow point, then the team's spawn. */
function releasePoint(owner: Ship, victim: Ship, ox: number, oz: number): { x: number; z: number } {
  const forward = owner.localToWorld((owner.spec.length + victim.spec.length) * 0.65 + 100, 0, 0);
  const spawn = owner.game.spawnPoint(victim.team, victim.spec, 0);
  for (const origin of [forward, { x: ox, z: oz }, spawn]) {
    for (let r = 0; r <= 1500; r += 150)
      for (let i = 0; i < (r ? 16 : 1); i++) {
        const b = owner.heading + (i * Math.PI) / 8;
        const x = origin.x + forwardX(b) * r;
        const z = origin.z + forwardZ(b) * r;
        if (isClear(victim, x, z)) return { x, z };
      }
  }
  // The static map always has an open spawn; finite chart scan also covers crowded spawns.
  for (let x = -MAP_HALF + 500; x < MAP_HALF - 500; x += 300)
    for (let z = -MAP_HALF + 500; z < MAP_HALF - 500; z += 300) if (isClear(victim, x, z)) return { x, z };
  return { x: ox, z: oz };
}

export function releaseSwallow(s: Ship, spit: boolean): void {
  const a = s.gourmand;
  const swallowed = a?.swallow;
  if (!a || !swallowed) return;
  a.swallow = null;
  const t = s.game.ships.find((x) => x.id === swallowed.target);
  if (!t || !t.alive) return;
  const p = releasePoint(s, t, swallowed.originX, swallowed.originZ);
  placeAt(t, s.game, p.x, p.z);
  t.pos.y = 0;
  t.speed = 0;
  t.pushX = t.pushZ = 0;
  if (!spit) return;
  const W = GOURMAND.swallow;
  emitMisc(s, 'spit', s.pos.x, s.pos.z, { tx: p.x, tz: p.z, target: t, radius: W.spitRadius });
  // The victim's swallowed mods still mark it untargetable this tick, so it is hit by name.
  hurt(s, t, W.spit, skill(s, SLOT.swallow));
  for (const v of enemiesNear(s, p.x, p.z, W.spitRadius)) if (v !== t) hurt(s, v, W.spit, skill(s, SLOT.swallow));
  knock(t, s.pos.x, s.pos.z, 70);
}

export function clearGourmand(s: Ship): void {
  const a = s.gourmand;
  if (!a) return;
  releaseSwallow(s, false);
  Object.assign(a, newGourmandState());
}

// ------------------------------------------------------------------ eating

/** Is a projectile's swept segment inside the mouth? High-speed rounds cannot skip over it. */
function mouthIntersects(s: Ship, x: number, z: number, y: number, nx: number, nz: number): boolean {
  if (y < -8 || y > s.spec.freeboard + 65) return false;
  const a = s.gourmand!;
  const big = s.game.time < a.banquetUntil;
  const p = mouthPoint(s);
  const r = big ? GOURMAND.banquetMouth : GOURMAND.mouth;
  const dx = nx - x;
  const dz = nz - z;
  const d2 = dx * dx + dz * dz;
  const f = d2 ? Math.max(0, Math.min(1, ((p.x - x) * dx + (p.z - z) * dz) / d2)) : 0;
  const px = x + f * dx;
  const pz = z + f * dz;
  if (Math.hypot(px - p.x, pz - p.z) > r) return false;
  // Restrict to the bow hemisphere: a mouth cannot catch a shot passing behind the hull.
  return (px - s.pos.x) * forwardX(s.heading) + (pz - s.pos.z) * forwardZ(s.heading) > s.spec.length * 0.1;
}

function gulp(s: Ship, kind: Flavour, x: number, z: number): void {
  ingredient(s, kind);
  s.heal(GOURMAND.devour.heal);
  emitMisc(s, 'gulp', x, z, { n: flavourIndex(kind) });
}

function eatProjectiles(s: Ship, dt: number): void {
  const g = s.game;
  for (const p of g.shells.shells) {
    if (!p.alive || p.team === s.team) continue;
    if (!mouthIntersects(s, p.x, p.z, p.y, p.x + p.vx * dt * SHELL_TIME_SCALE, p.z + p.vz * dt * SHELL_TIME_SCALE)) continue;
    p.alive = false;
    gulp(s, p.ammo === 'HE' ? 'explosives' : 'shells', p.x, p.z);
  }
  for (const p of g.torps.torps) {
    if (!p.alive || p.team === s.team || p.deep) continue;
    if (!mouthIntersects(s, p.x, p.z, 0, p.x + forwardX(p.heading) * p.speed * dt, p.z + forwardZ(p.heading) * p.speed * dt)) continue;
    p.alive = false;
    gulp(s, 'explosives', p.x, p.z);
  }
  for (const p of g.missiles.missiles) {
    if (!p.alive || p.team === s.team || p.delay > 0 || p.uninterceptable) continue;
    if (!mouthIntersects(s, p.x, p.z, p.y, p.x + forwardX(p.heading) * p.speed * dt, p.z + forwardZ(p.heading) * p.speed * dt)) continue;
    p.alive = false;
    gulp(s, 'explosives', p.x, p.z);
  }
  const a = s.gourmand!;
  a.eatenWrecks = a.eatenWrecks.filter((id) => g.ships.some((w) => w.id === id && !w.alive));
  for (const wreck of g.ships) {
    if (wreck.alive || wreck.withdrawn || wreck.isSummon) continue;
    if (a.eatenWrecks.includes(wreck.id) || !mouthIntersects(s, wreck.pos.x, wreck.pos.z, 0, wreck.pos.x, wreck.pos.z)) continue;
    a.eatenWrecks.push(wreck.id);
    wreck.withdrawn = true;
    ingredient(s, 'wreckage', 3);
    emitMisc(s, 'gulp', wreck.pos.x, wreck.pos.z, { n: flavourIndex('wreckage') });
  }
}

/** Devour's pull on ships ahead of the mouth, and its chomps on those inside the bite. */
function chomp(s: Ship, dt: number): void {
  const a = s.gourmand!;
  const D = GOURMAND.devour;
  const g = s.game;
  const m = mouthPoint(s);
  const fx = forwardX(s.heading);
  const fz = forwardZ(s.heading);
  for (const v of enemiesNear(s, m.x, m.z, D.pull)) {
    if ((v.pos.x - s.pos.x) * fx + (v.pos.z - s.pos.z) * fz <= 0 || swallowedBy(g, v) || v.mods.banished) continue;
    // Drawn straight in, like a reeled skewer; land in the way holds it.
    const dx = m.x - v.pos.x;
    const dz = m.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(D.pullSpeed * dt, Math.max(0, d - 150));
    if (step <= 0) continue;
    const x = v.pos.x + (dx / d) * step;
    const z = v.pos.z + (dz / d) * step;
    if (!clearWater(g, v, x, z)) continue;
    v.pos.x = x;
    v.pos.z = z;
  }
  while (g.time >= a.chompNext - 1e-9 && a.chompNext <= a.mouthUntil + 1e-9) {
    a.chompNext += D.tick;
    for (const v of enemiesNear(s, m.x, m.z, D.chomp)) {
      hurt(s, v, D.dps * D.tick, skill(s, SLOT.devour));
      emitMisc(s, 'chomp', v.pos.x, v.pos.z, { target: v });
    }
  }
}

// ------------------------------------------------------------------ update

export function updateGourmand(s: Ship, dt: number): void {
  const a = s.gourmand;
  if (!a) return;
  if (!s.alive) {
    clearGourmand(s);
    return;
  }
  const g = s.game;
  const now = g.time;
  if (now >= a.banquetUntil) {
    let excess = Math.max(0, pantryTotal(a.pantry) - GOURMAND.capacity);
    for (const kind of ['wreckage', 'explosives', 'shells'] as const) {
      const n = Math.min(excess, a.pantry[kind]);
      a.pantry[kind] -= n;
      excess -= n;
    }
  }
  if (now < a.mouthUntil || now < a.banquetUntil) eatProjectiles(s, dt);
  if (now < a.mouthUntil) chomp(s, dt);
  updateBanquet(s, now);
  for (const d of a.dishes) if (now >= d.at) landDish(s, d);
  a.dishes = a.dishes.filter((d) => now < d.at);
  if (a.cooker && now >= a.cooker.at) burstCooker(s);
  if (a.blast && now >= a.blast.at) blowKitchen(s);
  if (a.burpAt > 0 && now >= a.burpAt) burp(s);
  updateBleeds(s, now);
  updateReel(s, now, dt);
  updateBite(s, now);
  updateSwallow(s, now);
}

function updateBanquet(s: Ship, now: number): void {
  const a = s.gourmand!;
  const B = GOURMAND.banquet;
  if (now >= a.banquetUntil || now < a.nextServing) return;
  a.nextServing = now + B.every;
  const targets = enemiesNear(s, s.pos.x, s.pos.z, B.reach)
    .sort((p, q) => Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z) - Math.hypot(q.pos.x - s.pos.x, q.pos.z - s.pos.z) || p.id - q.id)
    .slice(0, B.targets);
  for (const t of targets) {
    a.dishes.push({ x: t.pos.x, z: t.pos.z, at: now + GOURMAND.serve.delay, damage: B.side, radius: B.sideRadius, flavour: null, slot: SLOT.banquet });
    emitMisc(s, 'side', s.pos.x, s.pos.z, { tx: t.pos.x, tz: t.pos.z, target: t });
  }
}

function burp(s: Ship): void {
  const a = s.gourmand!;
  const C = GOURMAND.comfort;
  a.burpAt = 0;
  for (const v of enemiesNear(s, s.pos.x, s.pos.z, C.burp)) {
    hurt(s, v, C.burpDamage, skill(s, SLOT.comfort));
    knock(v, s.pos.x, s.pos.z, C.burpKnock);
  }
  emitMisc(s, 'burp', s.pos.x, s.pos.z, { radius: C.burp });
}

function updateBleeds(s: Ship, now: number): void {
  const a = s.gourmand!;
  const C = GOURMAND.carve;
  for (const b of a.bleeds) {
    const t = s.game.ships.find((v) => v.id === b.target && v.alive);
    while (t && b.next <= now + 1e-9 && b.next <= b.until + 1e-9) {
      b.next += C.tick;
      hurt(s, t, C.bleed * C.tick, skill(s, SLOT.carve));
    }
  }
  a.bleeds = a.bleeds.filter((b) => b.next <= b.until + 1e-9 && s.game.ships.some((v) => v.id === b.target && v.alive));
}

function updateReel(s: Ship, now: number, dt: number): void {
  const a = s.gourmand!;
  if (!a.reel) return;
  const g = s.game;
  const K = GOURMAND.skewer;
  const t = g.ships.find((v) => v.id === a.reel!.target);
  if (!t || !t.alive || now >= a.reel.until || t.mods.banished || swallowedBy(g, t)) {
    a.reel = null;
    return;
  }
  const dx = s.pos.x - t.pos.x;
  const dz = s.pos.z - t.pos.z;
  const d = Math.hypot(dx, dz);
  const gap = Math.max(0, d - (s.spec.length + t.spec.length) * 0.5 - 40);
  const step = Math.min(K.speed * dt, gap);
  if (step > 0) {
    const x = t.pos.x + (dx / d) * step;
    const z = t.pos.z + (dz / d) * step;
    if (!clearWater(g, t, x, z)) {
      a.reel = null;
      return;
    }
    t.pos.x = x;
    t.pos.z = z;
  }
  buff(t, 'debuff:gourmandSkewer', 0.15, (m) => {
    m.speedMul *= 0.5;
  });
  // Reeled all the way in: the mouth takes a bite.
  if (gap - step <= 1) {
    a.reel = null;
    hurt(s, t, K.chomp, skill(s, SLOT.skewer));
    ingredient(s, 'wreckage', K.scrap);
    emitMisc(s, 'chomp', t.pos.x, t.pos.z, { target: t, n: 1 });
  }
}

function updateBite(s: Ship, now: number): void {
  const a = s.gourmand!;
  if (!a.bite || now < a.bite.at) return;
  const g = s.game;
  const W = GOURMAND.swallow;
  const bite = a.bite;
  a.bite = null;
  const t = g.ships.find((x) => x.id === bite.target);
  if (
    !t ||
    !t.alive ||
    t.mods.invulnerable ||
    t.mods.banished ||
    t.mods.untargetable ||
    t.deep ||
    swallowedBy(g, t) ||
    swallowedBy(g, s) ||
    Math.hypot(t.pos.x - bite.x, t.pos.z - bite.z) >= 400 ||
    Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) >= W.reach + 300
  ) {
    emitMisc(s, 'chomp', bite.x, bite.z, { n: 0 });
    return;
  }
  hurt(s, t, W.bite, skill(s, SLOT.swallow));
  if (!t.alive) return;
  a.swallow = { target: t.id, until: now + W.time, nextTick: now + W.tick, originX: t.pos.x, originZ: t.pos.z, heldX: t.pos.x, heldZ: t.pos.z };
  emitMisc(s, 'swallow', t.pos.x, t.pos.z, { target: t });
}

function updateSwallow(s: Ship, now: number): void {
  const a = s.gourmand!;
  if (!a.swallow) return;
  const g = s.game;
  const W = GOURMAND.swallow;
  const t = g.ships.find((x) => x.id === a.swallow!.target);
  if (!t || !t.alive) {
    a.swallow = null;
    return;
  }
  // A defensive teleport is an escape, rather than being silently snapped back into the mouth.
  if (t.mods.banished || Math.hypot(t.pos.x - a.swallow.heldX, t.pos.z - a.swallow.heldZ) > 300) {
    a.swallow = null;
    return;
  }
  while (now >= a.swallow.nextTick - 1e-9 && a.swallow.nextTick <= a.swallow.until + 1e-9) {
    a.swallow.nextTick += W.tick;
    hurt(s, t, W.digest * W.tick, skill(s, SLOT.swallow));
    if (!t.alive) {
      a.swallow = null;
      return;
    }
  }
  if (now >= a.swallow.until) {
    releaseSwallow(s, true);
    return;
  }
  const p = s.localToWorld(s.spec.length * 0.12, 0, 0);
  t.pos.x = p.x;
  t.pos.z = p.z;
  a.swallow.heldX = p.x;
  a.swallow.heldZ = p.z;
  t.speed = 0;
  t.pushX = t.pushZ = 0;
}
