import { runnerImport } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
await runnerImport(`${process.cwd()}/src/core/installDetMath.ts`);
const {
  module: { Game },
} = await runnerImport(`${process.cwd()}/src/core/Game.ts`);
const {
  module: { AIController },
} = await runnerImport(`${process.cwd()}/src/ai/AIController.ts`);
const {
  module: { SHIP_BY_ID },
} = await runnerImport(`${process.cwd()}/src/data/ships.ts`);
const out = "docs/verification/misc-titans";
mkdirSync(out, { recursive: true });
const results = [];
for (const id of ["judge", "hexweaver", "gourmand", "faultline"])
  for (const foe of ["stepper", "tungsten", "architect"])
    for (let seed = 0; seed < 2; seed++)
      for (const side of [0, 1]) {
        const g = new Game({
          mode: "solo",
          type: "freeplay",
          mapId: "open",
          teamSize: 1,
          ai: [0, 0],
          difficulty: "hard",
          era: "mixed",
          seed: 710 + seed,
          players: [{ shipId: id, device: "mouse" }],
        });
        g.ships = [];
        g.ai.clear();
        g.fleet.length = 0;
        const add = (ship, team) => {
          const s = g.addShip(
            SHIP_BY_ID[ship],
            team,
            ship,
            (team ? 1 : -1) * 1400,
            seed ? 450 : -450,
            team ? -Math.PI / 2 : Math.PI / 2,
          );
          s.humanIndex = -1;
          s.throttle = 4;
          s.speed = s.maxSpeed * 0.4;
          g.fleet.push(s);
          g.ai.set(s, new AIController(s, g));
          return s;
        };
        const s = add(id, side),
          enemy = add(foe, 1 - side),
          used = new Set();
        g.events.on("skill", (e) => {
          if (e.ship === s) used.add(e.index);
        });
        for (let tick = 0; tick < 90 * 60 && s.alive && enemy.alive; tick++) {
          g.step();
          if (
            g.ships.some(
              (t) => ![t.hp, t.pos.x, t.pos.y, t.pos.z].every(Number.isFinite),
            )
          )
            throw Error("Non-finite state: " + id);
        }
        results.push({
          id,
          foe,
          seed,
          side,
          time: g.time,
          hp: s.hp,
          foeHp: enemy.hp,
          damage: s.stats.damage,
          skillDamage: s.stats.skill,
          skills: [...used].sort(),
          won: s.alive && !enemy.alive,
        });
      }
const summary = ["judge", "hexweaver", "gourmand", "faultline"].map((id) => {
  const r = results.filter((r) => r.id === id);
  return {
    id,
    battles: r.length,
    wins: r.filter((r) => r.won).length,
    averageDamage: Math.round(r.reduce((n, r) => n + r.damage, 0) / r.length),
    skills: [...new Set(r.flatMap((r) => r.skills))].sort(),
  };
});
for (const row of summary)
  if (row.averageDamage <= 0 || row.skills.length < 4)
    throw Error("AI fails to exercise kit: " + JSON.stringify(row));
writeFileSync(
  `${out}/combat-results.json`,
  JSON.stringify({ summary, results }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
