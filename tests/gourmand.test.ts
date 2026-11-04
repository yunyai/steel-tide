import { describe, expect, it } from "vitest";
import { SHIP_BY_ID } from "../src/data/ships";
import type { Ship } from "../src/ships/Ship";
import { GOURMAND_SKILLS } from "../src/skills/misc/gourmand";
import {
  clearGourmand,
  gourmandBlocksSkill,
  ingredient,
  newGourmandState,
  pantryTotal,
  swallowedBy,
  updateGourmand,
} from "../src/skills/misc/GourmandRuntime";
import { stateHash } from "../src/net/hash";
import { emptyGame, place, run } from "./helpers";

function setup() {
  const g = emptyGame();
  const s = g.addShip(
    {
      ...SHIP_BY_ID.stepper,
      id: "gourmand",
      skills: GOURMAND_SKILLS.map((k) => k.spec),
    },
    0,
    "Gourmand",
    0,
    0,
    0,
  );
  s.gourmand = newGourmandState();
  const enemy = place(g, "stepper", 1, 0, -600);
  s.control.aimX = enemy.pos.x;
  s.control.aimZ = enemy.pos.z;
  return { g, s, enemy };
}
function cast(s: Ship, index: number) {
  return GOURMAND_SKILLS[index].impl.activate(s, s.game, s.skills[index]);
}

describe("Gourmand", () => {
  it("eats hostile bow projectiles exactly once and leaves friendlies, distant and submerged torpedoes alone", () => {
    const { g, s, enemy } = setup();
    const spec = SHIP_BY_ID.stepper.torpedoes!;
    const incoming = g.torps.launch(enemy, 0, -250, Math.PI, spec);
    const friendly = g.torps.launch(s, 0, -250, Math.PI, spec);
    const behind = g.torps.launch(enemy, 0, 250, Math.PI, spec);
    const deep = g.torps.launch(enemy, 0, -250, Math.PI, spec);
    deep.deep = true;
    cast(s, 0);
    updateGourmand(s, 1 / 60);
    updateGourmand(s, 1 / 60);
    expect(incoming.alive).toBe(false);
    expect(friendly.alive).toBe(true);
    expect(behind.alive).toBe(true);
    expect(deep.alive).toBe(true);
    expect(s.gourmand!.pantry.explosives).toBe(1);
  });
  it("caps ingredient collection, consumes ingredients when cooking and can serve while empty", () => {
    const { g, s, enemy } = setup();
    s.gourmand!.pantry = { shells: 6, explosives: 6, wreckage: 6 };
    expect(cast(s, 2)).not.toBe(false);
    expect(s.gourmand!.pantry).toEqual({
      shells: 0,
      explosives: 0,
      wreckage: 0,
    });
    expect(s.gourmand!.cooked).not.toBeNull();
    cast(s, 4);
    expect(s.gourmand!.cooked).toBeNull();
    expect(g.strikes.strikes.some((x) => x.damage > 0)).toBe(true);
    const before = g.strikes.strikes.length;
    cast(s, 4);
    expect(g.strikes.strikes.length).toBe(before + 1);
    const hp = enemy.hp;
    g.strikes.update(2);
    expect(enemy.hp).toBeLessThan(hp);
  });
  it("Carve supplies ingredients and Comfort Food protects with an empty pantry", () => {
    const { s, enemy } = setup();
    cast(s, 1);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(s.gourmand!.pantry.wreckage).toBeGreaterThan(0);
    s.gourmand!.pantry = { shells: 0, explosives: 0, wreckage: 0 };
    cast(s, 5);
    expect(s.shield).toBeGreaterThan(0);
  });
  it("warns before swallowing, prevents nested swallowing, then releases safely on timeout", () => {
    const { g, s, enemy } = setup();
    expect(cast(s, 7)).not.toBe(false);
    expect(swallowedBy(g, enemy)).toBeNull();
    g.time = 1;
    updateGourmand(s, 1);
    expect(swallowedBy(g, enemy)).toBe(s);
    const other = g.addShip({ ...s.spec }, 0, "second Gourmand", 0, 0, 0);
    other.gourmand = newGourmandState();
    other.control.aimX = enemy.pos.x;
    other.control.aimZ = enemy.pos.z;
    expect(cast(other, 7)).toBe(false);
    g.time = 4.2;
    updateGourmand(s, 3.2);
    expect(swallowedBy(g, enemy)).toBeNull();
    expect(g.map.heightAt(enemy.pos.x, enemy.pos.z)).toBeLessThan(-6);
    expect(
      Math.hypot(enemy.pos.x - s.pos.x, enemy.pos.z - s.pos.z),
    ).toBeGreaterThan(s.spec.length / 2);
  });
  it("releases victims immediately when cleared and preserves defensive skill access", () => {
    const { g, s, enemy } = setup();
    cast(s, 7);
    g.time = 1;
    updateGourmand(s, 1);
    expect(gourmandBlocksSkill(g, enemy, 1)).toBe(true);
    expect(gourmandBlocksSkill(g, enemy, 5)).toBe(false);
    clearGourmand(s);
    expect(swallowedBy(g, enemy)).toBeNull();
  });
  it("caps incoming ingredients and does not repeatedly eat a sinking wreck", () => {
    const { g, s, enemy } = setup();
    ingredient(s, "shells", 50);
    expect(s.gourmand!.pantry.shells).toBe(18);
    s.gourmand!.pantry = { shells: 0, explosives: 0, wreckage: 0 };
    enemy.takeDamage(10000000, s);
    enemy.pos.set(0, 0, -250);
    cast(s, 0);
    updateGourmand(s, 1 / 60);
    enemy.deathTime += 1;
    g.time += 1;
    updateGourmand(s, 1);
    expect(s.gourmand!.pantry.wreckage).toBe(3);
  });
  it("consumes a wreck globally so a second Gourmand cannot farm the same hull", () => {
    const { g, s, enemy } = setup();
    const second = g.addShip({ ...s.spec }, 0, "second", 0, 0, 0);
    second.gourmand = newGourmandState();
    enemy.takeDamage(10000000, s);
    enemy.pos.set(0, 0, -250);
    cast(s, 0);
    cast(second, 0);
    updateGourmand(s, 1 / 60);
    updateGourmand(second, 1 / 60);
    expect(s.gourmand!.pantry.wreckage + second.gourmand!.pantry.wreckage).toBe(
      3,
    );
    expect(enemy.withdrawn).toBe(true);
  });
  it("shrinks the pantry when Banquet ends", () => {
    const { g, s } = setup();
    cast(s, 6);
    ingredient(s, "shells", 30);
    expect(pantryTotal(s.gourmand!.pantry)).toBe(30);
    g.time = 13;
    updateGourmand(s, 1 / 60);
    expect(pantryTotal(s.gourmand!.pantry)).toBe(18);
  });
  it("lets a defensive teleport escape without snapping the victim back", () => {
    const { g, s, enemy } = setup();
    cast(s, 7);
    g.time = 1;
    updateGourmand(s, 1);
    enemy.pos.x = 2000;
    enemy.pos.z = 0;
    updateGourmand(s, 1 / 60);
    expect(swallowedBy(g, enemy)).toBeNull();
    expect(enemy.pos.x).toBe(2000);
  });
  it("all offensive AI heuristics accept the normal skill interface", () => {
    const { g, s, enemy } = setup();
    for (const k of GOURMAND_SKILLS)
      expect(() => k.impl.aiShouldUse(s, g, enemy, s.skills[0])).not.toThrow();
  });
  it("does not swallow an invulnerable enemy or consume an entire pantry without a valid preparation", () => {
    const { g, s, enemy } = setup();
    enemy.mods.invulnerable = true;
    cast(s, 7);
    g.time = 1;
    updateGourmand(s, 1);
    expect(swallowedBy(g, enemy)).toBeNull();
    expect(cast(s, 2)).toBe(false);
  });
});

describe("Gourmand battle integration", () => {
  it("registers six normals and three ultimates with a complete runtime", () => {
    const g = emptyGame(),
      s = place(g, "gourmand", 0, 0, 0);
    expect(s.skills.map((k) => !!k.spec.ult)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(s.gourmand).not.toBeNull();
  });
  it("blocks swallowed attacks while permitting defense and releases immediately on owner death", () => {
    const g = emptyGame(),
      s = place(g, "gourmand", 0, 0, 0),
      enemy = place(g, "stepper", 1, 0, -600);
    s.control.aimX = enemy.pos.x;
    s.control.aimZ = enemy.pos.z;
    s.meter = 1;
    expect(s.activateSkill(7)).toBe(true);
    run(g, 1);
    expect(swallowedBy(g, enemy)).toBe(s);
    expect(enemy.skillReady(1)).toBe(false);
    expect(enemy.skillReady(0)).toBe(true);
    enemy.control.fire = true;
    let fires = 0;
    g.events.on("gunFired", (e) => {
      if (e.ship === enemy) fires++;
    });
    run(g, 0.2);
    expect(fires).toBe(0);
    s.takeDamage(10000000, enemy);
    expect(swallowedBy(g, enemy)).toBeNull();
    expect(
      Math.hypot(enemy.pos.x - s.pos.x, enemy.pos.z - s.pos.z),
    ).toBeGreaterThan(300);
  });
  it("eats a fast swept torpedo before its impact in a real simulation tick", () => {
    const g = emptyGame(),
      s = place(g, "gourmand", 0, 0, 0),
      enemy = place(g, "stepper", 1, 0, -900);
    const torp = g.torps.launch(enemy, 0, -700, Math.PI, {
      ...enemy.spec.torpedoes!,
      speed: 30000,
    });
    const hp = s.hp;
    s.activateSkill(0);
    run(g, 1 / 60);
    expect(torp.alive).toBe(false);
    expect(s.hp).toBe(hp);
    expect(s.gourmand!.pantry.explosives).toBe(1);
  });
  it("replays swallow and pantry state deterministically and hashes resource changes", () => {
    const a = emptyGame(),
      b = emptyGame();
    for (const g of [a, b]) {
      const s = place(g, "gourmand", 0, 0, 0),
        t = place(g, "stepper", 1, 0, -600);
      s.control.aimX = t.pos.x;
      s.control.aimZ = t.pos.z;
      s.meter = 1;
      s.activateSkill(7);
      run(g, 1.2);
    }
    expect(stateHash(a)).toBe(stateHash(b));
    a.ships[0].gourmand!.pantry.shells++;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});
