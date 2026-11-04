import { describe, it, expect } from "vitest";
import { emptyGame, place, run } from "./helpers";
import { SHIP_BY_ID } from "../src/data/ships";
import {
  enactLaw,
  recordJudgeAction,
  violationCount,
} from "../src/skills/misc/JudgeRuntime";

describe("Judge court", () => {
  it("registers a complete titan kit", () => {
    expect(SHIP_BY_ID.judge?.skills.length).toBe(9);
  });
  it("tracks separate cases, throttles salvos and preserves stacks through Taxes", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0),
      e = place(g, "stepper", 1, 300, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    enactLaw(j, "ceasefire");
    recordJudgeAction(e, "fire");
    recordJudgeAction(e, "fire");
    expect(violationCount(j, e)).toBe(1);
    j.control.aimX = e.pos.x;
    j.control.aimZ = e.pos.z;
    j.activateSkill(4);
    expect(violationCount(j, e)).toBe(1);
  });
  it("supports three laws and replaces oldest, refreshes without duplication", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    for (const law of [
      "ceasefire",
      "silence",
      "speedLimit",
      "noLoitering",
    ] as const)
      enactLaw(j, law);
    expect(j.judge!.laws.map((l) => l.id)).toEqual([
      "silence",
      "speedLimit",
      "noLoitering",
    ]);
    enactLaw(j, "silence");
    expect(j.judge!.laws.length).toBe(3);
  });
  it("decays violations only after leaving for five seconds", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0),
      e = place(g, "stepper", 1, 300, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    enactLaw(j, "ceasefire");
    recordJudgeAction(e, "fire");
    e.pos.x = 5000;
    run(g, 4);
    expect(violationCount(j, e)).toBe(1);
    run(g, 2.1);
    expect(violationCount(j, e)).toBe(0);
  });
  it("death penalty spends a case but respects shields", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0),
      e = place(g, "stepper", 1, 300, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    enactLaw(j, "ceasefire");
    for (let i = 0; i < 20; i++) {
      g.time += 1.01;
      recordJudgeAction(e, "fire");
    }
    e.addShield(e.maxHp, 10);
    j.meter = 1;
    j.control.aimX = e.pos.x;
    j.control.aimZ = e.pos.z;
    expect(j.activateSkill(8)).toBe(true);
    run(g, 1.3);
    expect(e.alive).toBe(true);
    expect(e.hp).toBe(e.maxHp);
    expect(violationCount(j, e)).toBe(0);
  });
});

describe("Judge law and punishment boundaries", () => {
  it("counts distinct laws, doubles Martial Law and caps cases", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    j.meter = 1;
    j.activateSkill(6);
    recordJudgeAction(t, "fire");
    recordJudgeAction(t, "skill");
    expect(violationCount(j, t)).toBe(4);
    for (let k = 0; k < 25; k++) {
      g.time += 1.01;
      recordJudgeAction(t, "fire");
    }
    expect(violationCount(j, t)).toBeLessThanOrEqual(30);
  });
  it("keeps cases isolated and clears them when their target respawns", () => {
    const g = emptyGame(),
      a = place(g, "judge", 0, 0, 0),
      b = place(g, "judge", 0, 0, 600),
      t = place(g, "stepper", 1, 500, 0);
    for (const j of [a, b]) {
      j.control.aimX = 0;
      j.control.aimZ = 0;
      j.activateSkill(0);
    }
    enactLaw(a, "ceasefire");
    recordJudgeAction(t, "fire");
    expect(violationCount(a, t)).toBe(1);
    expect(violationCount(b, t)).toBe(0);
    t.withdraw();
    expect(violationCount(a, t)).toBe(0);
  });
  it("movement laws ignore forced displacement and apply to voluntary speed", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    enactLaw(j, "noLoitering");
    t.pushX = 100;
    run(g, 0.1);
    expect(violationCount(j, t)).toBe(0);
    t.pushX = 0;
    run(g, 0.1);
    expect(violationCount(j, t)).toBe(1);
  });
  it("does not spend Death Penalty without a sufficient case", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0);
    place(g, "stepper", 1, 500, 0);
    j.meter = 1;
    expect(j.activateSkill(8)).toBe(false);
    expect(j.skills[8].meter).toBe(1);
  });
  it("Contempt roots movement but preserves weapons and defense", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0),
      t = place(g, "stepper", 1, 500, 0);
    j.control.aimX = 500;
    j.control.aimZ = 0;
    j.activateSkill(2);
    run(g, 0.8);
    expect(t.mods.rooted).toBe(true);
    expect(t.mods.disarmed).toBe(false);
    expect(t.mods.silenced).toBe(false);
  });
  it("has all six independent law identifiers", () => {
    const g = emptyGame(),
      j = place(g, "judge", 0, 0, 0);
    j.control.aimX = 0;
    j.control.aimZ = 0;
    j.activateSkill(0);
    for (const law of [
      "speedLimit",
      "noLoitering",
      "straightAhead",
      "closedBorders",
    ] as const)
      expect(enactLaw(j, law)).toBe(true);
  });
});
