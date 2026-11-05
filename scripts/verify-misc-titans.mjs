import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "docs/verification/misc-titans";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(process.env.STEEL_URL ?? "http://127.0.0.1:5174");
  await page.waitForFunction(() => window.steel);
  for (const id of ["judge", "hexweaver", "gourmand", "faultline"]) {
    await page.evaluate(
      (id) =>
        window.steel.start({
          mode: "solo",
          type: "sandbox",
          mapId: "open",
          teamSize: 1,
          ai: [0, 0],
          difficulty: "normal",
          seed: 17,
          era: "mixed",
          players: [{ shipId: id, device: "mouse" }],
        }),
      id,
    );
    await page.waitForTimeout(400);
    const result = await page.evaluate(async (id) => {
      const b = window.steel.battle,
        g = b.game,
        s = g.humans()[0];
      const { SHIP_BY_ID } = await import("/src/data/ships.ts");
      s.pos.set(0, 0, 0);
      s.speed = 0;
      s.throttle = 2;
      g.ai.clear();
      s.meter = 1;
      g.sandbox.apply({ k: "cheat", cheat: "tough", on: true });
      const foes = [
        g.addShip(SHIP_BY_ID.stepper, 1, "Witness", 700, 0, 0),
        g.addShip(SHIP_BY_ID.stepper, 1, "Accomplice", 900, 400, 0),
      ];
      s.control.aimX = 700;
      s.control.aimZ = 0;
      if (id === "judge") {
        s.control.aimX = 0;
        s.activateSkill(0);
        s.control.judgeLaw = 0;
        s.activateSkill(1);
        s.meter = 1;
        s.activateSkill(6);
        b.pcs[0].lawSelection.open = true;
      }
      if (id === "hexweaver") {
        for (const t of foes) {
          s.control.aimX = t.pos.x;
          s.control.aimZ = t.pos.z;
          s.activateSkill(0);
        }
        s.activateSkill(1);
        s.activateSkill(3);
      }
      if (id === "gourmand") {
        s.gourmand.pantry = { shells: 5, explosives: 5, wreckage: 5 };
        s.activateSkill(0);
        s.activateSkill(6);
      }
      if (id === "faultline") {
        s.control.aimX = 1500;
        s.control.aimZ = -1000;
        s.activateSkill(0);
        s.activateSkill(1);
      }
      for (let i = 0; i < 75; i++) g.step(1 / 60);
      g.interpolate();
      b.scene.update(
        1 / 60,
        b.pcs.map((p) => p.camera),
      );
      b.pcs[0].updateCamera = () => {};
      b.huds.forEach((h) => h.update(0));
      const camera = b.pcs[0].camera;
      camera.position.set(-420, 460, 620);
      camera.lookAt(0, 35, 0);
      camera.updateMatrixWorld();
      b.scene.prepare(b.viewports[0], 900);
      window.steel.renderer.render(b.viewports, 0);
      b.paused = false;
      b.overlay?.remove();
      b.overlay = null;
      b.tick = () => window.steel.renderer.render(b.viewports);
      return {
        id,
        skills: s.skills.length,
        model: !!b.scene.views.get(s).miscModel,
        resources: document.querySelector(".misc-panel .mp-line")?.textContent,
        finite: g.ships.every(
          (t) => Number.isFinite(t.hp) && Number.isFinite(t.pos.x),
        ),
        geometry: b.scene.views.get(s).miscModel.group.children.length,
      };
    }, id);
    await page.screenshot({ path: `${out}/${id}.png` });
    await page.evaluate(() => {
      const b = window.steel.battle;
      for (const h of b.huds) h.root.style.visibility = "hidden";
    });
    await page.screenshot({ path: `${out}/${id}-model.png` });
    results.push(result);
  }
  if (errors.length) throw Error(errors.join("\n"));
  if (results.some((r) => !r.model || r.skills !== 9 || !r.finite))
    throw Error("Titan integration failed");
  writeFileSync(
    `${out}/browser-results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
