import { describe, expect, it } from "vitest";
import { MAP_HALF } from "../src/config";
import { SHIP_BY_ID } from "../src/data/ships";
import { GameMap, MAPS, type DynamicRidge } from "../src/world/GameMap";
import { FAULTLINE_SKILLS } from "../src/skills/misc/faultline";
import {
  applyFaultlinePassives,
  FAULTLINE,
  clearFaultline,
  newFaultlineState,
  updateFaultline,
  type FaultlineState,
} from "../src/skills/misc/FaultlineRuntime";
import type { Ship } from "../src/ships/Ship";
import type { SkillState } from "../src/skills/types";
import { emptyGame, place, run } from "./helpers";
import { bearingTo } from "../src/core/math";

type FaultShip = Ship & { faultline: FaultlineState | null };
function arena() {
  const g = emptyGame("open", 411, "freeplay");
  const spec = {
    ...SHIP_BY_ID.stepper,
    id: "faultline",
    skills: FAULTLINE_SKILLS.map((d) => d.spec),
  };
  const s = g.addShip(spec, 0, "Faultline", 0, 2500, Math.PI / 2) as FaultShip;
  s.faultline = newFaultlineState();
  s.speed = 0;
  s.throttle = 2;
  s.control.aimX = 500;
  s.control.aimZ = 2500;
  return { g, s };
}
function cast(s: FaultShip, index: number) {
  const st: SkillState = {
    spec: FAULTLINE_SKILLS[index].spec,
    index,
    active: false,
    cooldown: 0,
    time: 0,
    meter: 1,
    data: {},
  };
  return FAULTLINE_SKILLS[index].impl.activate(s, s.game, st);
}
function tick(s: FaultShip, seconds: number) {
  const n = Math.ceil(seconds * 60);
  for (let i = 0; i < n; i++) {
    s.game.time += seconds / n;
    updateFaultline(s, seconds / n);
  }
}
function ridge(overrides: Partial<DynamicRidge> = {}): DynamicRidge {
  return {
    id: 1,
    owner: 7,
    x0: -500,
    z0: 1800,
    x1: 500,
    z1: 1800,
    width: 140,
    height: 75,
    expiresAt: 12,
    ...overrides,
  };
}

describe("temporary geological terrain", () => {
  it("feeds height, line of sight and avoidance queries without changing static islands", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7),
      original = JSON.stringify(map.islands);
    expect(map.heightAt(0, 1800)).toBeLessThan(0);
    expect(map.addDynamicRidge(ridge())).toBe(true);
    expect(map.heightAt(0, 1800)).toBeGreaterThan(60);
    expect(map.losBlocked(0, 1300, 0, 2300)).toBe(true);
    expect(map.awayFromLand(0, 1810).z).toBeGreaterThan(0.9);
    expect(JSON.stringify(map.islands)).toBe(original);
    map.expireDynamicRidges(12);
    expect(map.heightAt(0, 1800)).toBeLessThan(0);
    expect(map.losBlocked(0, 1300, 0, 2300)).toBe(false);
  });

  it("blocks a swept navigation corridor even when both probe endpoints miss a narrow ridge", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    map.dynamicRidges = [ridge({ x0: 500, z0: 1400, x1: 500, z1: 2200 })];
    expect(map.heightAt(360, 1800)).toBeLessThan(0);
    expect(map.heightAt(580, 1800)).toBeLessThan(0);
    expect(map.dynamicPathBlocked(360, 1800, 580, 1800)).toBe(true);
    expect(map.dynamicPathBlocked(200, 1800, 300, 1800)).toBe(false);
    expect(map.dynamicPathBlocked(350, 1800, 350, 1800, 100)).toBe(true);
  });

  it("sweeps projectiles against ridge volume while allowing shots above the crest", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    map.dynamicRidges = [ridge()];
    expect(map.dynamicSegmentBlocked(0, 20, 1300, 0, 20, 2300)).toBe(true);
    expect(map.dynamicSegmentBlocked(0, 100, 1300, 0, 100, 2300)).toBe(false);
    // A shell descends below ridge height only after it has cleared the ridge.
    expect(map.dynamicSegmentBlocked(0, 200, 1000, 0, 0, 2600)).toBe(false);
    expect(map.dynamicSegmentBlocked(0, 100, 1000, 0, 0, 2600)).toBe(true);
    // Sweep the rounded end rather than only the rectangular middle.
    expect(map.dynamicSegmentBlocked(550, 20, 1600, 550, 20, 2000)).toBe(true);
    expect(map.dynamicSegmentBlocked(590, 20, 1600, 590, 20, 2000)).toBe(false);
    expect(map.dynamicSegmentBlocked(590, 20, 1600, 590, 20, 2000, 25)).toBe(
      true,
    );
  });

  it("rejects invalid geometry and ridges outside the map", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    expect(map.addDynamicRidge(ridge({ x0: NaN }))).toBe(false);
    expect(map.addDynamicRidge(ridge({ x0: 4400, x1: 4600 }))).toBe(false);
    expect(map.dynamicRidges).toHaveLength(0);
  });

  it("lets a ridge rise near the spawn lines", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    expect(map.addDynamicRidge(ridge({ x0: 3600, x1: 4100 }))).toBe(true);
  });

  it("lets a ridge join static land", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    expect(map.staticHeightAt(900, 1000)).toBeGreaterThan(-20);
    expect(
      map.addDynamicRidge(ridge({ x0: 800, z0: 1000, x1: 1000, z1: 1000 })),
    ).toBe(true);
  });

  it("lets a ridge stand next to a small island", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    map.islands.push({ x: 0, z: 2050, r: 35, h: 70, seed: 13, losR: 35 });
    expect(map.addDynamicRidge(ridge())).toBe(true);
  });

  it("steers away from the nearest ridge regardless of creation order", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    map.dynamicRidges = [
      ridge({ z0: 2000, z1: 2000 }),
      ridge({ id: 2, z0: 1790, z1: 1790 }),
    ];
    expect(map.awayFromLand(0, 1800).z).toBeGreaterThan(0.9);
  });

  it("lets ridges cross", () => {
    const map = new GameMap(MAPS.find((m) => m.id === "open")!, 7);
    expect(map.addDynamicRidge(ridge())).toBe(true);
    expect(
      map.addDynamicRidge(ridge({ id: 2, x0: 0, z0: 1400, x1: 0, z1: 2300 })),
    ).toBe(true);
    expect(map.dynamicRidges).toHaveLength(2);
  });
});

describe("Faultline", () => {
  it("has six normals and three unique ultimates", () => {
    expect(FAULTLINE_SKILLS.map((d) => !!d.spec.ult)).toEqual([
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
    expect(new Set(FAULTLINE_SKILLS.map((d) => d.spec.id)).size).toBe(9);
  });

  it("warns before fault damage, hits enemies and generates bounded pressure", () => {
    const { g, s } = arena(),
      enemy = place(g, "yamato", 1, 450, 2500),
      ally = place(g, "yamato", 0, 450, 2500);
    const hp = enemy.hp,
      ahp = ally.hp;
    expect(cast(s, 0)).not.toBe(false);
    expect(s.faultline!.fractures).toHaveLength(1);
    tick(s, 0.5);
    expect(enemy.hp).toBe(hp);
    tick(s, 1.5);
    expect(enemy.hp).toBeLessThan(hp);
    expect(ally.hp).toBe(ahp);
    expect(s.faultline!.pressure).toBeGreaterThan(0);
    expect(s.faultline!.pressure).toBeLessThanOrEqual(100);
  });

  it("raises a ridge after the warning and expires it at the scheduled time", () => {
    const { g, s } = arena();
    expect(cast(s, 1)).not.toBe(false);
    expect(g.map.dynamicRidges).toHaveLength(0);
    tick(s, 1.1);
    expect(g.map.dynamicRidges).toHaveLength(1);
    tick(s, 12.2);
    expect(g.map.dynamicRidges).toHaveLength(0);
  });

  it("moves an overlapping hull into safe water when a ridge rises", () => {
    const { g, s } = arena(),
      victim = place(g, "yamato", 1, 500, 2500);
    cast(s, 1);
    tick(s, 1.1);
    expect(g.map.dynamicRidges).toHaveLength(1);
    expect(g.map.heightAt(victim.pos.x, victim.pos.z)).toBeLessThan(-10);
    expect(Math.hypot(victim.pos.x - 500, victim.pos.z - 2500)).toBeGreaterThan(
      100,
    );
  });

  it("raises a ridge even with the reticle on an island", () => {
    const { g, s } = arena();
    s.control.aimX = 900;
    s.control.aimZ = 1000;
    expect(g.map.staticHeightAt(900, 1000)).toBeGreaterThan(-20);
    expect(cast(s, 1)).not.toBe(false);
    tick(s, 1.1);
    expect(g.map.dynamicRidges).toHaveLength(1);
  });

  it("lets a second Uplift cross a ridge still warning", () => {
    const { g, s } = arena();
    expect(cast(s, 1)).not.toBe(false);
    s.control.aimX = 600;
    s.control.aimZ = 2000;
    expect(cast(s, 1)).not.toBe(false);
    expect(s.faultline!.pending.filter((p) => p.kind === "ridge")).toHaveLength(
      2,
    );
    tick(s, 1.1);
    expect(g.map.dynamicRidges).toHaveLength(2);
  });

  it("clips a ridge at the map edge instead of refusing it", () => {
    const { g, s } = arena();
    s.pos.x = 3800;
    s.pos.z = 0;
    s.control.aimX = 4100;
    s.control.aimZ = -1500;
    expect(cast(s, 1)).not.toBe(false);
    tick(s, 1.1);
    const [r] = g.map.dynamicRidges;
    expect(r).toBeDefined();
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    expect(len).toBeGreaterThan(100);
    expect(len).toBeLessThan(FAULTLINE.ridgeLength - 50);
    for (const v of [r.x0, r.x1, r.z0, r.z1])
      expect(Math.abs(v) + r.width / 2).toBeLessThanOrEqual(MAP_HALF - 100 + 1e-6);
  });

  it("keeps six ridges per owner and leaves another Faultline’s terrain intact on cleanup", () => {
    const { g, s } = arena();
    g.map.dynamicRidges = Array.from({ length: 6 }, (_, i) =>
      ridge({
        id: 100 + i,
        owner: s.id,
        x0: -2400 + i * 600,
        x1: -2200 + i * 600,
        z0: -2500,
        z1: -2500,
        expiresAt: 30,
      }),
    );
    g.map.dynamicRidges.push(
      ridge({
        id: 999,
        owner: s.id + 1,
        x0: -500,
        x1: 500,
        z0: -1000,
        z1: -1000,
        expiresAt: 30,
      }),
    );
    expect(cast(s, 1)).not.toBe(false);
    tick(s, 1.1);
    expect(g.map.dynamicRidges.filter((r) => r.owner === s.id)).toHaveLength(6);
    expect(g.map.dynamicRidges.some((r) => r.id === 100)).toBe(false);
    clearFaultline(s);
    expect(g.map.dynamicRidges.map((r) => r.id)).toEqual([999]);
  });

  it("requires a fracture for Slip and Subduction and gives useful failure messages", () => {
    const { s } = arena();
    expect(cast(s, 3)).toBe(false);
    expect(s.skillFailure).toContain("fracture");
    expect(cast(s, 2)).toBe(false);
    expect(s.skillFailure).toContain("fracture");
  });

  it("Slip crosses a clear fracture and damages each contacted enemy only once", () => {
    const { g, s } = arena(),
      victim = place(g, "yamato", 1, 300, 2500),
      hp = victim.hp;
    cast(s, 0);
    expect(cast(s, 3)).not.toBe(false);
    tick(s, 0.7);
    expect(s.pos.x).toBeCloseTo(500);
    expect(s.faultline!.slip).toBe(null);
    expect(hp - victim.hp).toBe(FAULTLINE.slip.damage);
  });

  it("Slip turns the ship to face along the slip", () => {
    const { g, s } = arena();
    s.faultline!.fractures.push({ id: 99, x0: 0, z0: 2500, x1: 0, z1: 1500, expiresAt: 100 });
    s.control.aimX = 0;
    s.control.aimZ = 1500;
    expect(g.map.heightAt(0, 2000)).toBeLessThan(-20);
    expect(s.heading).toBeCloseTo(Math.PI / 2);
    expect(cast(s, 3)).not.toBe(false);
    tick(s, 0.7);
    expect(s.faultline!.slip).toBe(null);
    expect(s.pos.z).toBeCloseTo(1500);
    expect(s.heading).toBeCloseTo(bearingTo(0, 2500, 0, 1500));
  });

  it("swings the bow onto the slip over its first 0.15 s", () => {
    const { s } = arena();
    s.faultline!.fractures.push({ id: 99, x0: 0, z0: 2500, x1: 0, z1: 1500, expiresAt: 100 });
    s.control.aimX = 0;
    s.control.aimZ = 1500;
    cast(s, 3);
    tick(s, FAULTLINE.slip.turn / 2);
    expect(s.heading).toBeGreaterThan(0.05);
    expect(s.heading).toBeLessThan(Math.PI / 2 - 0.05);
    tick(s, FAULTLINE.slip.turn / 2 + 0.02);
    expect(s.heading).toBeCloseTo(0);
  });

  it("keeps the new heading once the slip ends", () => {
    const { g, s } = arena();
    s.faultline!.fractures.push({ id: 99, x0: 0, z0: 2500, x1: 0, z1: 1500, expiresAt: 100 });
    s.control.aimX = 0;
    s.control.aimZ = 1500;
    cast(s, 3);
    run(g, 1);
    expect(s.faultline!.slip).toBe(null);
    expect(s.heading).toBeCloseTo(0, 1);
  });

  it("names Continental Divide and the map edge when a ridge would lie off the map", () => {
    const { s } = arena();
    s.pos.x = 0;
    s.pos.z = -(MAP_HALF - 250);
    s.control.aimX = 2000;
    s.control.aimZ = -(MAP_HALF - 250);
    expect(cast(s, 6)).toBe(false);
    expect(s.skillFailure).toBe("Continental Divide: ridge would lie off the map");
    expect(s.faultline!.pending).toHaveLength(0);
  });

  it("bounds Aftershock damage even when every fracture overlaps one target", () => {
    const { g, s } = arena(),
      victim = place(g, "yamato", 1, 500, 2500),
      hp = victim.hp;
    s.faultline!.fractures = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      x0: 300,
      z0: 2500,
      x1: 700,
      z1: 2500,
      expiresAt: 14,
    }));
    s.faultline!.pressure = 99;
    cast(s, 4);
    tick(s, 4);
    expect(hp - victim.hp).toBeGreaterThan(FAULTLINE.aftershock.damage);
    expect(hp - victim.hp).toBeLessThanOrEqual(FAULTLINE.aftershock.damage / (1 - FAULTLINE.repeat));
    expect(s.faultline!.pressure).toBe(100);
    expect(s.faultline!.hits).toHaveLength(0);
  });

  it("Bedrock reduces damage and converts absorbed hull damage into pressure", () => {
    const { s } = arena();
    cast(s, 5);
    const before = s.mods.damageTakenMul;
    applyFaultlinePassives(s, s.mods);
    expect(s.mods.damageTakenMul).toBeLessThan(before);
    s.stats.received += 100000;
    tick(s, 0.1);
    expect(s.faultline!.pressure).toBeGreaterThan(0);
  });

  it("Worldbreaker eventually collapses its own ridges and cleanup cancels pending attacks", () => {
    const { g, s } = arena();
    cast(s, 1);
    tick(s, 1.1);
    expect(g.map.dynamicRidges).toHaveLength(1);
    cast(s, 0);
    cast(s, 8);
    tick(s, 5);
    expect(g.map.dynamicRidges.filter((r) => r.owner === s.id)).toHaveLength(0);
    cast(s, 0);
    clearFaultline(s);
    expect(s.faultline!.pending).toHaveLength(0);
    expect(s.faultline!.fractures).toHaveLength(0);
    expect(s.faultline!.pressure).toBe(0);
  });

  it("lets the AI raise Continental Divide wherever both ridges fit inside the map", () => {
    const { g, s } = arena();
    const t = place(g, "yamato", 1, 2000, 2500);
    const divide = FAULTLINE_SKILLS[6].impl;
    const st = { spec: FAULTLINE_SKILLS[6].spec, index: 6, active: false, cooldown: 0, time: 0, meter: 1, data: {} } as SkillState;
    expect(divide.aiShouldUse(s, g, t, st)).toBe(true);
    const serial = s.faultline!.serial;
    // Toward the east edge the ridges run along the aim and are clipped short, so they still rise.
    s.pos.x = MAP_HALF - 2400;
    t.pos.x = MAP_HALF - 400;
    expect(divide.aiShouldUse(s, g, t, st)).toBe(true);
    // Along the north edge one ridge would lie wholly off the map: a cast would fail, cost nothing,
    // and be retried every decision ahead of every other skill.
    s.pos.x = 0;
    s.pos.z = -(MAP_HALF - 250);
    t.pos.x = 2000;
    t.pos.z = -(MAP_HALF - 250);
    expect(divide.aiShouldUse(s, g, t, st)).toBe(false);
    expect(s.faultline!.serial).toBe(serial);
  });

  it("Caldera spends pressure rather than letting an empty resource disable its base attack", () => {
    const { g, s } = arena(),
      victim = place(g, "yamato", 1, 500, 2500);
    s.faultline!.pressure = 80;
    const hp = victim.hp;
    cast(s, 7);
    expect(s.faultline!.pressure).toBe(0);
    tick(s, 2.5);
    expect(victim.hp).toBeLessThan(hp);
  });
});
