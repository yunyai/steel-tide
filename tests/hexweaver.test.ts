import { describe, it, expect } from "vitest";
import { emptyGame, place, run } from "./helpers";
import { pinCharges } from "../src/skills/misc/HexweaverRuntime";
const aim = (s: ReturnType<typeof place>, t: ReturnType<typeof place>) => {
  s.control.aimX = t.pos.x;
  s.control.aimZ = t.pos.z;
};
describe("Hexweaver", () => {
  it("stores four Pins and restores spent charges in parallel", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    aim(s, t);
    for (let i = 0; i < 4; i++) expect(s.activateSkill(0)).toBe(true);
    expect(s.activateSkill(0)).toBe(false);
    expect(pinCharges(s)).toBe(0);
    run(g, 6.1);
    expect(pinCharges(s)).toBe(4);
  });
  it("stacks pins on one doll and spreads to distinct enemies", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0),
      a = place(g, "stepper", 1, 500, 0),
      b = place(g, "stepper", 1, 800, 0);
    aim(s, a);
    s.activateSkill(0);
    s.activateSkill(0);
    aim(s, b);
    s.activateSkill(0);
    expect(s.hexweaver!.dolls.map((d) => d.pins)).toEqual([2, 1]);
  });
  it("stitch fire and rip form a group combo without recursive echoes", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0),
      a = place(g, "stepper", 1, 500, 0),
      b = place(g, "stepper", 1, 800, 0);
    aim(s, a);
    s.activateSkill(0);
    aim(s, b);
    s.activateSkill(0);
    s.activateSkill(1);
    const hp = b.hp;
    aim(s, a);
    s.activateSkill(3);
    run(g, 1.1);
    expect(b.hp).toBeLessThan(hp);
    s.activateSkill(4);
    expect(g.ships.every((s) => Number.isFinite(s.hp))).toBe(true);
  });
  it("Twist and Rip damage enemies without a doll", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    aim(s, t);
    const hp = t.hp;
    s.activateSkill(2);
    s.activateSkill(4);
    expect(t.hp).toBeLessThan(hp - 60000);
  });
});

describe("Hexweaver curse lifecycle", () => {
  it("expires dolls and cleans dead-target connections", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    aim(s, t);
    s.activateSkill(0);
    run(g, 18.1);
    expect(s.hexweaver!.dolls).toHaveLength(0);
    s.activateSkill(0);
    t.withdraw();
    expect(s.hexweaver!.dolls).toHaveLength(0);
  });
  it("replaces the oldest fifth doll and caps repeated pins at three", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0);
    const enemies = Array.from({ length: 5 }, (_, i) =>
      place(g, "stepper", 1, 500 + i * 400, 0),
    );
    aim(s, enemies[0]);
    for (let i = 0; i < 4; i++) s.activateSkill(0);
    expect(s.hexweaver!.dolls[0].pins).toBe(3);
    run(g, 6.1);
    for (const t of enemies.slice(1)) {
      aim(s, t);
      s.activateSkill(0);
    }
    expect(s.hexweaver!.dolls).toHaveLength(4);
    expect(s.hexweaver!.dolls.some((d) => d.target === enemies[0].id)).toBe(
      false,
    );
  });
  it("detonates dolls once and cannot recast an empty Unmaking", () => {
    const g = emptyGame(),
      s = place(g, "hexweaver", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    aim(s, t);
    s.activateSkill(0);
    s.meter = 1;
    expect(s.activateSkill(8)).toBe(true);
    expect(s.hexweaver!.dolls).toHaveLength(0);
    s.meter = 1;
    expect(s.activateSkill(8)).toBe(false);
    expect(s.skills[8].meter).toBe(1);
  });
});
