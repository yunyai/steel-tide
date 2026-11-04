import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(process.env.STEEL_URL ?? "http://127.0.0.1:5174");
  await page.waitForFunction(() => window.steel);
  await page.evaluate(() =>
    window.steel.start({
      mode: "solo",
      type: "sandbox",
      mapId: "open",
      teamSize: 1,
      ai: [0, 0],
      difficulty: "normal",
      seed: 9,
      era: "mixed",
      players: [{ shipId: "judge", device: "mouse" }],
    }),
  );
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const b = window.steel.battle;
    b.shell.input.fallback = true;
    document.exitPointerLock();
  });
  await page.evaluate(() => {
    const b = window.steel.battle;
    b.setPaused(false);
    const s = b.game.humans()[0];
    s.activateSkill(0);
  });
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(100);
  await page
    .getByRole("option", { name: "2 · Silence" })
    .click({ timeout: 3000 });
  await page.waitForTimeout(100);
  const confirmed = await page.evaluate(() =>
    window.steel.battle.game
      .humans()[0]
      .judge.laws.some((l) => l.id === "silence"),
  );
  if (!confirmed)
    throw Error("Clicking law must enact it without reopening selector");
  await page.evaluate(() => {
    const b = window.steel.battle;
    b.game.humans()[0].skills[1].cooldown = 0;
  });
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const cancelled = await page.evaluate(() => {
    const b = window.steel.battle;
    return !b.paused && !b.pcs[0].lawSelection.open;
  });
  if (!cancelled)
    throw Error("Escape must cancel law selection without pausing battle");
  await page.evaluate(() => {
    const b = window.steel.battle;
    b.shell.input.fallback = false;
    b.game.humans()[0].skills[1].cooldown = 0;
    b.shell.input.requestLock();
  });
  await page.waitForTimeout(100);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const lockCancelled = await page.evaluate(() => {
    const b = window.steel.battle;
    return !b.paused && !b.pcs[0].lawSelection.open;
  });
  if (!lockCancelled)
    throw Error(
      "Pointer-lock Escape must cancel law selection without pausing",
    );
  console.log(
    "Judge pointer confirmation, fallback cancellation and pointer-lock cancellation pass",
  );
} finally {
  await browser.close();
}
