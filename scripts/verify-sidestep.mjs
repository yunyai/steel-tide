import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const out = 'docs/verification/stepper';
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const q of ['ultralow', 'low', 'medium', 'high']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 1;
    });
    await page.goto(`${process.env.STEEL_URL ?? 'http://127.0.0.1:5184'}/?q=${q}`);
    await page.waitForFunction(() => window.steel);
    const r = await page.evaluate(async () => {
      const { SHIP_BY_ID } = await import('/src/data/ships.ts');
      const { audio } = await import('/src/fx/Audio.ts');
      const { stateHash } = await import('/src/net/hash.ts');
      audio.init();
      await audio.ctx.resume();
      await audio.ready();
      window.steel.start({
        mode: 'solo',
        type: 'freeplay',
        mapId: 'open',
        teamSize: 1,
        ai: [0, 0],
        difficulty: 'normal',
        seed: 118,
        era: 'mixed',
        players: [{ shipId: 'stepper', device: 'mouse' }],
      });
      const b = window.steel.battle,
        g = b.game,
        s = g.humans()[0];
      g.ai.clear();
      b.shell.input.fallback = true;
      s.pos.set(0, 0, 0);
      s.prevPos.copy(s.pos);
      s.renderPos.copy(s.pos);
      s.speed = 0;
      s.throttle = 2;
      const foe = g.addShip(SHIP_BY_ID.leviathan, 1, 'Target', 0, -1500, 0);
      foe.speed = 0;
      foe.throttle = 2;
      let dodges = 0,
        maxFades = 0,
        maxVoices = 0;
      const distances = [];
      g.events.on('blink', (e) => {
        if (e.dodge) {
          dodges++;
          distances.push(Math.hypot(e.ship.pos.x - e.fromX, e.ship.pos.z - e.fromZ));
        }
      });
      s.activateSkill(5);
      for (const pc of b.pcs) pc.updateCamera(1 / 60);
      for (let i = 0; i < 100; i++) {
        if (i % 8 === 0) g.shells.dropBomb(foe, foe.spec.main.he, s.pos.x, s.pos.z, 25);
        g.step();
        g.interpolate();
        for (const pc of b.pcs) pc.updateCamera(1 / 60);
        window.steel.renderer.update(
          1 / 60,
          b.pcs.map((pc) => pc.camera),
        );
        for (const h of b.huds) h.update(1 / 60);
        window.steel.renderer.render(b.viewports);
        maxFades = Math.max(maxFades, b.scene.skillFx.stepFades.length);
        maxVoices = Math.max(maxVoices, audio.budget.size);
      }
      return {
        dodges,
        distances,
        damage: s.stats.received,
        hash: stateHash(g),
        maxFades,
        maxVoices,
        notice: document.body.textContent.includes('SIDESTEP'),
        ghosts: b.scene.skillFx.stepFades.filter((f) => !f.ownGeo).length,
        rings: b.scene.skillFx.stepFades.filter((f) => f.ownGeo).length,
      };
    });
    await page.screenshot({ path: `${out}/sidestep-${q}.jpg`, quality: 88 });
    results.push({ quality: q, ...r, errors });
    await page.close();
  }
  if (
    new Set(results.map((r) => r.hash)).size !== 1 ||
    results.some(
      (r) =>
        r.errors.length ||
        r.dodges !== 13 ||
        r.damage !== 0 ||
        r.distances.some((d) => Math.abs(d - 180) > 0.01) ||
        !r.notice ||
        r.ghosts < 3 ||
        r.rings < 1 ||
        r.maxFades > 48 ||
        r.maxVoices > 40,
    )
  )
    throw new Error(JSON.stringify(results));
  writeFileSync(`${out}/sidestep-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
