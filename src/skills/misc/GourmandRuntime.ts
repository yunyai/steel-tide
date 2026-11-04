import { MAP_HALF, SHELL_TIME_SCALE } from "../../config";
import type { Game } from "../../core/Game";
import { bearingTo, forwardX, forwardZ } from "../../core/math";
import type { SkillSpec } from "../../core/types";
import type { Mods, Ship } from "../../ships/Ship";
import { buff, clearWater, hurt, placeAt } from "../kit";

export const GOURMAND = {
  capacity: 18,
  banquetCapacity: 30,
  mouth: 310,
  banquetMouth: 500,
  swallowReach: 1000,
  warning: 0.8,
  swallowTime: 3,
  digestion: 45000,
  cookedTime: 14,
  biteDamage: 90000,
  serveDamage: 55000,
} as const;
export interface Pantry {
  shells: number;
  explosives: number;
  wreckage: number;
}
export interface GourmandState {
  pantry: Pantry;
  cooked: (Pantry & { until: number; salvos: number }) | null;
  mouthUntil: number;
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
  servings: number;
}
export const emptyPantry = (): Pantry => ({
  shells: 0,
  explosives: 0,
  wreckage: 0,
});
export function newGourmandState(): GourmandState {
  return {
    pantry: emptyPantry(),
    cooked: null,
    mouthUntil: 0,
    banquetUntil: 0,
    nextServing: 0,
    eatenWrecks: [],
    reel: null,
    bite: null,
    swallow: null,
    servings: 0,
  };
}
export const pantryTotal = (p: Pantry): number =>
  p.shells + p.explosives + p.wreckage;
export function ingredient(s: Ship, kind: keyof Pantry, amount = 1): void {
  const a = s.gourmand;
  if (!a) return;
  const max =
    s.game.time < a.banquetUntil ? GOURMAND.banquetCapacity : GOURMAND.capacity;
  a.pantry[kind] += Math.max(0, Math.min(amount, max - pantryTotal(a.pantry)));
}
export function swallowedBy(game: Game, target: Ship): Ship | null {
  return (
    game.ships.find(
      (s) => s.alive && s.gourmand?.swallow?.target === target.id,
    ) ?? null
  );
}
/** Swallowing restricts external attacks but deliberately keeps defensive actions usable. */
export function gourmandBlocksSkill(
  game: Game,
  s: Ship,
  index: number,
): boolean {
  if (!swallowedBy(game, s)) return false;
  const k = s.skills[index]?.spec;
  return (
    !!k &&
    !k.alwaysUsable &&
    !["shield", "heal", "cloak", "blink", "shift", "speed"].includes(k.icon)
  );
}
export function gourmandSwallowMods(s: Ship, m: Mods): void {
  if (!swallowedBy(s.game, s)) return;
  m.rooted = m.disarmed = m.untargetable = true;
}
function skill(s: Ship, index: number): SkillSpec {
  return s.skills[index].spec;
}
function isClear(s: Ship, x: number, z: number): boolean {
  if (!clearWater(s.game, s, x, z)) return false;
  return !s.game.ships.some(
    (o) =>
      o !== s &&
      o.alive &&
      !swallowedBy(s.game, o) &&
      Math.hypot(o.pos.x - x, o.pos.z - z) <
        (o.spec.length + s.spec.length) * 0.42,
  );
}
/** Search around the mouth first, then the pre-swallow point, then the team's spawn. */
function releasePoint(
  owner: Ship,
  victim: Ship,
  ox: number,
  oz: number,
): { x: number; z: number } {
  const forward = owner.localToWorld(
    (owner.spec.length + victim.spec.length) * 0.65 + 100,
    0,
    0,
  );
  const spawn = owner.game.spawnPoint(victim.team, victim.spec, 0);
  for (const origin of [forward, { x: ox, z: oz }, spawn]) {
    for (let r = 0; r <= 1500; r += 150)
      for (let i = 0; i < (r ? 16 : 1); i++) {
        const b = owner.heading + (i * Math.PI) / 8;
        const x = origin.x + forwardX(b) * r,
          z = origin.z + forwardZ(b) * r;
        if (isClear(victim, x, z)) return { x, z };
      }
  }
  // The static map always has an open spawn; finite chart scan also covers crowded spawns.
  for (let x = -MAP_HALF + 500; x < MAP_HALF - 500; x += 300)
    for (let z = -MAP_HALF + 500; z < MAP_HALF - 500; z += 300)
      if (isClear(victim, x, z)) return { x, z };
  return { x: ox, z: oz };
}
export function releaseSwallow(s: Ship, spit: boolean): void {
  const a = s.gourmand,
    swallowed = a?.swallow;
  if (!a || !swallowed) return;
  a.swallow = null;
  const t = s.game.ships.find((x) => x.id === swallowed.target);
  if (!t || !t.alive) return;
  const p = releasePoint(s, t, swallowed.originX, swallowed.originZ);
  placeAt(t, s.game, p.x, p.z);
  t.pos.y = 0;
  t.speed = 0;
  t.pushX = t.pushZ = 0;
  if (spit) {
    const dx = p.x - s.pos.x,
      dz = p.z - s.pos.z,
      d = Math.hypot(dx, dz) || 1;
    t.shove((dx / d) * 70, (dz / d) * 70);
    s.game.events.emit("lightning", {
      points: [
        { x: s.pos.x, y: 20, z: s.pos.z },
        { x: p.x, y: 20, z: p.z },
      ],
      color: 0xffbd71,
      straight: true,
    });
    s.game.strikes.spawn(s, {
      kind: "rod",
      skill: skill(s, 7),
      x: p.x,
      z: p.z,
      radius: 450,
      delay: 0.1,
      damage: 90000,
      knock: 90,
      look: "fireball",
    });
  }
}
export function clearGourmand(s: Ship): void {
  const a = s.gourmand;
  if (!a) return;
  releaseSwallow(s, false);
  if (s.salvo?.skill.id === "gourmandCook") s.salvo = null;
  Object.assign(a, newGourmandState());
}
/** Is a projectile's swept segment inside the mouth? High-speed rounds cannot skip over it. */
function mouthIntersects(
  s: Ship,
  x: number,
  z: number,
  y: number,
  nx: number,
  nz: number,
): boolean {
  if (y < -8 || y > s.spec.freeboard + 65) return false;
  const a = s.gourmand!,
    big = s.game.time < a.banquetUntil;
  const p = s.localToWorld(s.spec.length * 0.5 + 95, 0, 0),
    r = big ? GOURMAND.banquetMouth : GOURMAND.mouth;
  const dx = nx - x,
    dz = nz - z,
    d2 = dx * dx + dz * dz;
  const f = d2
    ? Math.max(0, Math.min(1, ((p.x - x) * dx + (p.z - z) * dz) / d2))
    : 0;
  const px = x + f * dx,
    pz = z + f * dz;
  if (Math.hypot(px - p.x, pz - p.z) > r) return false;
  // Restrict to the bow hemisphere: a mouth cannot catch a shot passing behind the hull.
  return (
    (px - s.pos.x) * forwardX(s.heading) +
      (pz - s.pos.z) * forwardZ(s.heading) >
    s.spec.length * 0.1
  );
}
function eatProjectiles(s: Ship, dt: number): void {
  const g = s.game;
  for (const p of g.shells.shells) {
    if (!p.alive || p.team === s.team) continue;
    if (
      !mouthIntersects(
        s,
        p.x,
        p.z,
        p.y,
        p.x + p.vx * dt * SHELL_TIME_SCALE,
        p.z + p.vz * dt * SHELL_TIME_SCALE,
      )
    )
      continue;
    p.alive = false;
    ingredient(s, p.ammo === "HE" ? "explosives" : "shells");
  }
  for (const p of g.torps.torps) {
    if (!p.alive || p.team === s.team || p.deep) continue;
    if (
      !mouthIntersects(
        s,
        p.x,
        p.z,
        0,
        p.x + forwardX(p.heading) * p.speed * dt,
        p.z + forwardZ(p.heading) * p.speed * dt,
      )
    )
      continue;
    p.alive = false;
    ingredient(s, "explosives");
  }
  for (const p of g.missiles.missiles) {
    if (!p.alive || p.team === s.team || p.delay > 0 || p.uninterceptable)
      continue;
    if (
      !mouthIntersects(
        s,
        p.x,
        p.z,
        p.y,
        p.x + forwardX(p.heading) * p.speed * dt,
        p.z + forwardZ(p.heading) * p.speed * dt,
      )
    )
      continue;
    p.alive = false;
    ingredient(s, "explosives");
  }
  const a = s.gourmand!;
  a.eatenWrecks = a.eatenWrecks.filter((id) =>
    g.ships.some((w) => w.id === id && !w.alive),
  );
  for (const wreck of g.ships) {
    if (wreck.alive || wreck.withdrawn || wreck.isSummon) continue;
    const key = wreck.id;
    if (
      a.eatenWrecks.includes(key) ||
      !mouthIntersects(s, wreck.pos.x, wreck.pos.z, 0, wreck.pos.x, wreck.pos.z)
    )
      continue;
    a.eatenWrecks.push(key);
    wreck.withdrawn = true;
    ingredient(s, "wreckage", 3);
  }
}
export function cook(s: Ship): boolean {
  const a = s.gourmand;
  if (!a) return false;
  const count = pantryTotal(a.pantry);
  if (count <= 0)
    return s.failSkill("Pressure Cooker: eat attacks or Carve an enemy first");
  const portions = Math.max(1, s.turrets.length);
  a.cooked = {
    ...a.pantry,
    until: s.game.time + GOURMAND.cookedTime,
    salvos: portions,
  };
  a.pantry = emptyPantry();
  const prepared = { ...a.cooked };
  s.salvo = {
    skill: skill(s, 2),
    left: portions,
    dispersionMul: 0.65,
    damageMul: 1.4 + Math.min(0.9, prepared.shells * 0.08),
    railgun: prepared.shells > 0,
    guaranteedFire: prepared.explosives > 0,
    cluster: false,
    onHit: (t, x, z) => {
      if (prepared.explosives > 0)
        s.game.strikes.spawn(s, {
          kind: "rod",
          skill: skill(s, 2),
          x,
          z,
          radius: 130 + prepared.explosives * 12,
          delay: 0.1,
          damage: 3500 * prepared.explosives,
          fire: 0.2,
          look: "fireball",
        });
      if (prepared.wreckage > 0)
        for (const n of s.game.ships)
          if (
            n !== t &&
            n.alive &&
            n.team !== s.team &&
            Math.hypot(n.pos.x - x, n.pos.z - z) < 450
          )
            hurt(s, n, 2000 * prepared.wreckage, skill(s, 2));
    },
  };
  return true;
}
export function serve(s: Ship, x: number, z: number, automatic = false): void {
  const a = s.gourmand!;
  let damage: number = GOURMAND.serveDamage,
    extra: Pantry = emptyPantry();
  if (!automatic && a.cooked) {
    const fraction =
      s.salvo?.skill.id === "gourmandCook" ? s.salvo.left / a.cooked.salvos : 0;
    extra = {
      shells: a.cooked.shells * fraction,
      explosives: a.cooked.explosives * fraction,
      wreckage: a.cooked.wreckage * fraction,
    };
    damage += pantryTotal(extra) * 6500;
    a.cooked = null;
    if (s.salvo?.skill.id === "gourmandCook") s.salvo = null;
  }
  s.game.strikes.spawn(s, {
    kind: "rod",
    skill: skill(s, automatic ? 6 : 4),
    x,
    z,
    radius: 320 + extra.explosives * 25,
    delay: 0.55,
    damage: automatic ? 35000 : damage,
    fire: extra.explosives > 0 ? 0.45 : 0,
    knock: extra.wreckage > 0 ? 40 + extra.wreckage * 8 : 0,
    look: "fireball",
  });
  if (extra.shells > 0) {
    const target = s.game.ships
      .filter(
        (t) =>
          t.alive &&
          t.team !== s.team &&
          !t.mods.untargetable &&
          Math.hypot(t.pos.x - x, t.pos.z - z) < 500,
      )
      .sort((a, b) => a.id - b.id)[0];
    if (target) hurt(s, target, extra.shells * 5000, skill(s, 4));
  }
  a.servings++;
}
export function beginSwallow(s: Ship, t: Ship): boolean {
  const a = s.gourmand;
  if (!a) return false;
  if (
    a.swallow ||
    a.bite ||
    swallowedBy(s.game, s) ||
    swallowedBy(s.game, t) ||
    t.deep ||
    t.mods.banished ||
    t.mods.untargetable
  )
    return s.failSkill("Swallow Whole: target cannot be swallowed");
  a.bite = {
    target: t.id,
    at: s.game.time + GOURMAND.warning,
    x: t.pos.x,
    z: t.pos.z,
  };
  s.game.strikes.spawn(s, {
    kind: "rod",
    skill: skill(s, 7),
    x: t.pos.x,
    z: t.pos.z,
    radius: 380,
    delay: GOURMAND.warning,
    damage: 0,
    look: "rune",
  });
  return true;
}
export function updateGourmand(s: Ship, dt: number): void {
  const a = s.gourmand;
  if (!a) return;
  if (!s.alive) {
    clearGourmand(s);
    return;
  }
  const g = s.game,
    now = g.time;
  if (now >= a.banquetUntil) {
    let excess = Math.max(0, pantryTotal(a.pantry) - GOURMAND.capacity);
    for (const kind of ["wreckage", "explosives", "shells"] as const) {
      const n = Math.min(excess, a.pantry[kind]);
      a.pantry[kind] -= n;
      excess -= n;
    }
  }
  if (
    a.cooked &&
    (now >= a.cooked.until || !s.salvo || s.salvo.skill.id !== "gourmandCook")
  ) {
    a.cooked = null;
    if (s.salvo?.skill.id === "gourmandCook") s.salvo = null;
  }
  if (now < a.mouthUntil || now < a.banquetUntil) eatProjectiles(s, dt);
  if (now < a.banquetUntil && now >= a.nextServing) {
    a.nextServing = now + 1.5;
    const t = g.ships.find(
      (t) =>
        t.alive &&
        t.team !== s.team &&
        !t.mods.untargetable &&
        Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 3500,
    );
    if (t) serve(s, t.pos.x, t.pos.z, true);
  }
  if (a.reel) {
    const t = g.ships.find((t) => t.id === a.reel!.target);
    if (
      !t ||
      !t.alive ||
      now >= a.reel.until ||
      t.mods.banished ||
      swallowedBy(g, t)
    ) {
      a.reel = null;
    } else {
      const dx = s.pos.x - t.pos.x,
        dz = s.pos.z - t.pos.z,
        d = Math.hypot(dx, dz),
        step = Math.min(
          240 * dt,
          Math.max(0, d - (s.spec.length + t.spec.length) * 0.5 - 40),
        );
      if (step > 0) {
        const x = t.pos.x + (dx / d) * step,
          z = t.pos.z + (dz / d) * step;
        if (clearWater(g, t, x, z)) {
          t.pos.x = x;
          t.pos.z = z;
        } else a.reel = null;
      }
      buff(t, "debuff:gourmandSkewer", 0.15, (m) => {
        m.speedMul *= 0.5;
      });
    }
  }
  if (a.bite && now >= a.bite.at) {
    const bite = a.bite;
    a.bite = null;
    const t = g.ships.find((x) => x.id === bite.target);
    if (
      t &&
      t.alive &&
      !t.mods.invulnerable &&
      !t.mods.banished &&
      !t.mods.untargetable &&
      !t.deep &&
      !swallowedBy(g, t) &&
      !swallowedBy(g, s) &&
      Math.hypot(t.pos.x - bite.x, t.pos.z - bite.z) < 400 &&
      Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) <
        GOURMAND.swallowReach + 300
    ) {
      hurt(s, t, GOURMAND.biteDamage, skill(s, 7));
      if (t.alive)
        a.swallow = {
          target: t.id,
          until: now + GOURMAND.swallowTime,
          nextTick: now + 0.5,
          originX: t.pos.x,
          originZ: t.pos.z,
          heldX: t.pos.x,
          heldZ: t.pos.z,
        };
    }
  }
  if (a.swallow) {
    const t = g.ships.find((x) => x.id === a.swallow!.target);
    if (!t || !t.alive) {
      a.swallow = null;
      return;
    }
    // A defensive teleport is an escape, rather than being silently snapped back into the mouth.
    if (
      t.mods.banished ||
      Math.hypot(t.pos.x - a.swallow.heldX, t.pos.z - a.swallow.heldZ) > 300
    ) {
      a.swallow = null;
      return;
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
    while (
      a.swallow &&
      now >= a.swallow.nextTick &&
      a.swallow.nextTick < a.swallow.until
    ) {
      a.swallow.nextTick += 0.5;
      hurt(s, t, GOURMAND.digestion * 0.5, skill(s, 7));
      if (!t.alive) {
        a.swallow = null;
        break;
      }
    }
  }
}
export function skewer(s: Ship, t: Ship): void {
  hurt(s, t, 55000, skill(s, 3));
  s.gourmand!.reel = { target: t.id, until: s.game.time + 2 };
  s.game.events.emit("lightning", {
    points: [
      { x: s.pos.x, y: 25, z: s.pos.z },
      { x: t.pos.x, y: 15, z: t.pos.z },
    ],
    color: 0xffc67d,
    straight: true,
  });
}
export function gourmandHeadingTo(s: Ship, t: Ship): number {
  return bearingTo(s.pos.x, s.pos.z, t.pos.x, t.pos.z);
}
