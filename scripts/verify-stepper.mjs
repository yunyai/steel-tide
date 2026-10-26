import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5184';
const out = 'docs/verification/stepper';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const results = [];
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
try {
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [2560, 1080],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.waitForFunction(() => window.steel);
    // The title's hangar permits browsing every era without changing battle setup.
    const hangar = page.getByRole('button', { name: /Hangar/ }).first();
    if (await hangar.count()) {
      await hangar.click();
      await page.getByRole('button', { name: 'Misc', exact: true }).click();
      await page.getByRole('button', { name: /^Stepper/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/hangar-${width}.jpg`, quality: 88 });
      check((await page.locator('.skill-card').count()) === 9, 'Nine Stepper cards in hangar');
    }
    await page.evaluate(async () => {
      const { SHIP_BY_ID } = await import('/src/data/ships.ts');
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
      s.pos.set(0, 0, 0);
      s.prevPos.copy(s.pos);
      s.renderPos.copy(s.pos);
      s.speed = 0;
      s.throttle = 2;
      s.meter = 1;
      const foe = g.addShip(SHIP_BY_ID.leviathan, 1, 'Target', 0, -1500, 0);
      foe.maxHp = foe.hp = 10000000;
      foe.speed = 0;
      foe.throttle = 2;
      foe.colossus = false;
      b.shell.input.capture = false;
      b.shell.input.fallback = true;
      window.stepperTest = { b, g, s, foe };
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/battle-${width}.jpg`, quality: 88 });
    const result = await page.evaluate(async () => {
      const { b, g, s, foe } = window.stepperTest;
      s.control.aimX = foe.pos.x;
      s.control.aimZ = foe.pos.z;
      const copied = s.activateSkill(8),
        copies = g.ships.filter((c) => c.summonOwner === s);
      b.scene.update(
        0,
        b.pcs.map((p) => p.camera),
      );
      const spectral = copies.every((c) => b.scene.views.get(c).material.opacity === 0.48);
      const allDrive = g.ships
        .filter((c) => c.spec.id === 'stepper')
        .every((c) => b.scene.views.get(c).root.getObjectByName('stepper-phase-drive'));
      return {
        copied,
        copies: copies.length,
        spectral,
        allDrive,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/afterimages-${width}.jpg`, quality: 88 });
    const flicker = await page.evaluate(() => {
      const { s, foe } = window.stepperTest;
      s.control.aimX = foe.pos.x;
      s.control.aimZ = foe.pos.z;
      return s.activateSkill(6);
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}/flicker-${width}.jpg`, quality: 88 });
    check(
      result.copied &&
        result.copies === 4 &&
        result.spectral &&
        result.allDrive &&
        !result.overflow &&
        flicker &&
        !errors.length,
      JSON.stringify({ result, flicker, errors }),
    );
    results.push({ width, height, ...result, flicker, errors });
    await page.close();
  }
  // Run the same deterministic sequence with rendering across each preset. Freeze the app frame loop.
  const presets = [];
  for (const q of ['ultralow', 'low', 'medium', 'high']) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.addInitScript(() => {
      window.requestAnimationFrame = () => 1;
    });
    await p.goto(`${base}/?q=${q}`);
    await p.waitForFunction(() => window.steel);
    const r = await p.evaluate(async () => {
      const { SHIP_BY_ID } = await import('/src/data/ships.ts');
      const { stateHash } = await import('/src/net/hash.ts');
      const { audio } = await import('/src/fx/Audio.ts');
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
      s.pos.set(0, 0, 0);
      s.prevPos.copy(s.pos);
      s.renderPos.copy(s.pos);
      s.speed = 0;
      s.throttle = 2;
      s.meter = 1;
      const foe = g.addShip(SHIP_BY_ID.leviathan, 1, 'Target', 0, -1500, 0);
      foe.maxHp = foe.hp = 10000000;
      foe.speed = 0;
      foe.throttle = 2;
      foe.colossus = false;
      s.control.aimX = 0;
      s.control.aimZ = -1500;
      s.activateSkill(8);
      s.activateSkill(6);
      let voices = 0,
        meshes = 0;
      const times = [];
      for (let i = 0; i < 185; i++) {
        const t = performance.now();
        g.step();
        g.interpolate();
        for (const pc of b.pcs) pc.updateCamera(1 / 60);
        window.steel.renderer.update(
          1 / 60,
          b.pcs.map((pc) => pc.camera),
        );
        window.steel.renderer.render(b.viewports);
        times.push(performance.now() - t);
        voices = Math.max(voices, audio.budget.size);
        meshes = Math.max(meshes, b.scene.skillFx.stepFades.length);
      }
      times.sort((a, b) => a - b);
      const hash = stateHash(g),
        calls = window.steel.renderer.gl.info.render.calls,
        damage = foe.stats.received,
        copyCount = g.ships.filter((c) => c.summonOwner === s && c.alive).length;
      s.control.aimX = 600;
      s.control.aimZ = -1500;
      s.activateSkill(7);
      g.step();
      window.steel.renderer.update(
        1 / 60,
        b.pcs.map((pc) => pc.camera),
      );
      window.steel.renderer.render(b.viewports);
      const rings = b.scene.skillFx.stepFades.filter((f) => f.ownGeo).length;
      const oldSources = [...audio.sources];
      g.finish(0, 'cleanup');
      const cleaned =
        g.ships.filter((c) => c.summonOwner === s).every((c) => !c.alive) &&
        audio.loops.size === 0 &&
        oldSources.every((source) => !audio.sources.has(source));
      return {
        hash,
        calls,
        damage,
        copyCount,
        voices,
        maxFades: meshes,
        rings,
        cleaned,
        medianCpuFrameMs: times[Math.floor(times.length / 2)],
      };
    });
    await p.screenshot({ path: `${out}/preset-${q}.jpg`, quality: 85 });
    presets.push({ quality: q, ...r, errors });
    await p.close();
  }
  check(new Set(presets.map((r) => r.hash)).size === 1, 'Preset simulation hashes differ');
  check(
    presets.every(
      (r) =>
        r.copyCount === 4 &&
        r.damage === 2400000 &&
        r.voices <= 40 &&
        r.maxFades <= 48 &&
        r.rings > 0 &&
        r.cleaned &&
        !r.errors.length,
    ),
    JSON.stringify(presets),
  );
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ sizes: results, presets }, null, 2));
  console.log(JSON.stringify({ sizes: results, presets }));
} finally {
  await browser.close();
}
