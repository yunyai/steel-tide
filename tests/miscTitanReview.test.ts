import { it, expect } from "vitest";
import { emptyGame, place } from "./helpers";
import {
  enactLaw,
  updateJudge,
  violationCount,
} from "../src/skills/misc/JudgeRuntime";
it("court relocation and fear do not manufacture Closed Borders violations", () => {
  const g = emptyGame(),
    j = place(g, "judge", 0, 0, 0),
    t = place(g, "stepper", 1, 0, -1980);
  j.control.aimX = 0;
  j.control.aimZ = 0;
  j.activateSkill(0);
  enactLaw(j, "closedBorders");
  updateJudge(j, 1 / 60);
  t.mods.feared = true;
  t.pos.z = -2050;
  g.time += 1 / 60;
  updateJudge(j, 1 / 60);
  expect(violationCount(j, t)).toBe(0);
  t.mods.feared = false;
  t.pos.z = 0;
  g.time += 1 / 60;
  updateJudge(j, 1 / 60);
  j.skills[0].cooldown = 0;
  j.control.aimX = 4500;
  j.control.aimZ = 0;
  j.activateSkill(0);
  g.time += 1 / 60;
  updateJudge(j, 1 / 60);
  expect(violationCount(j, t)).toBe(0);
});
it("a ridge intercepts a fast flat shell before a hull behind its rounded end", () => {
  const g = emptyGame(),
    s = place(g, "architect", 0, 570, 1700),
    t = place(g, "gourmand", 1, 760, 1870, Math.PI / 2);
  g.map.dynamicRidges.push({
    id: 1,
    owner: s.id,
    x0: -500,
    z0: 1800,
    x1: 500,
    z1: 1800,
    width: 150,
    height: 75,
    expiresAt: 20,
  });
  const shell = g.shells.fire(s, {
    ammo: "AP",
    spec: s.spec.main!.ap!,
    table: s.tableFor("AP")!,
    fromX: 570,
    fromY: 4,
    fromZ: 1790,
    toX: 570,
    toZ: 3000,
    dmgMul: 1,
    guaranteedFire: false,
    railgun: false,
    flat: 3,
  });
  const hp = t.hp;
  g.shells.update(1 / 60);
  expect(shell.alive).toBe(false);
  expect(t.hp).toBe(hp);
});

it('consumes a rejected law choice with its input edge',()=>{
 const g=emptyGame(),s=place(g,'judge',0,0,0);place(g,'stepper',1,500,0);
 s.control.skill=1;s.control.judgeLaw=3;g.step(1/60);
 expect(s.control.skill).toBe(-1);expect(s.control.judgeLaw).toBeUndefined();
});
