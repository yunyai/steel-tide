import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.STEEL_CAMERA_OUT ?? 'docs/verification/stepper-camera';
const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5184';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const check = (ok, message) => { if (!ok) throw new Error(message); };
const results = [];
try {
  for (const [quality, width, height, reduced] of [
    ['ultralow', 1280, 720, false], ['high', 1280, 720, false],
    ['high', 1920, 1080, false], ['high', 2560, 1080, false], ['high', 1280, 720, true],
  ]) {
    const name = `${quality}-${width}${reduced ? '-reduced' : ''}`;
    const record = quality === 'high' && width === 1280 && !reduced;
    const context = await browser.newContext({
      viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference',
      ...(record ? { recordVideo: { dir: out, size: { width, height } } } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => { window.requestAnimationFrame = cb => { window.testFrame = cb; return 1; }; });
    await page.goto(`${base}/?q=${quality}`);
    await page.waitForFunction(() => window.steel);
    for (const [index, skill] of [[6, 'flicker'], [7, 'cross']]) {
      const start = await page.evaluate(async index => {
        const { SHIP_BY_ID } = await import('/src/data/ships.ts');
        const { stateHash } = await import('/src/net/hash.ts');
        const { setControls } = await import('/src/input/Settings.ts');
        setControls({ shake: 0 });
        window.steel.start({ mode: 'solo', type: 'freeplay', mapId: 'open', teamSize: 1, ai: [0, 0], difficulty: 'normal', seed: 713, era: 'mixed', players: [{ shipId: 'stepper', device: 'mouse' }] });
        const b = window.steel.battle, g = b.game, s = g.humans()[0], pc = b.pcs[0];
        g.ai.clear(); b.shell.input.capture = false; b.shell.input.fallback = true;
        b.shell.input.onLockChange = null; b.paused = false; b.setOverlay(null);
        s.pos.set(0, 0, 1500); s.prevPos.copy(s.pos); s.renderPos.copy(s.pos);
        s.heading = s.prevHeading = s.renderHeading = 0; s.throttle = 2; s.speed = 0;
        s.secondaries.length = 0;
        for (const [x, z] of [[-650, 0], [900, -300]]) {
          const t = g.addShip(SHIP_BY_ID.leviathan, 1, 'Camera target', x, z, 0);
          t.hp = t.maxHp = 10000000; t.colossus = false; t.throttle = 2; t.speed = 0; t.secondaries.length = 0;
        }
        // Exercise entering the cinematic from the scope and returning to it afterwards.
        pc.zoomToggle = index === 6;
        for (let i = 0; i < 60; i++) pc.updateCamera(1 / 60);
        pc.aim.set(0, 0, 0); s.control.aimX = s.control.aimZ = 0; s.meter = 1;
        const activated = s.activateSkill(index);
        pc.updateCamera(0);
        b.shell.renderer.resize();
        const draw = dt => {
          g.interpolate(); window.steel.renderer.update(dt, [pc.camera]);
          b.huds[0].update(dt); window.steel.renderer.render(b.viewports);
        };
        draw(0);
        window.cameraTest = { b, g, s, pc, stateHash, draw, start: pc.camera.position.clone(), previous: pc.camera.position.clone(), rotation: pc.camera.quaternion.clone(), maxMove: 0, maxTurn: 0, returnTurn: 0, pure: true, frozen: false };
        return { activated, hidden: b.viewports[0].hide !== null, zoom: pc.zoom };
      }, index);
      check(start.activated && !start.hidden && !start.zoom, `${name} ${skill}: ${JSON.stringify(start)}`);
      const samples = [];
      for (let frame = 0; frame < 114; frame++) {
        const sample = await page.evaluate(frame => {
          const t = window.cameraTest, { b, g, s, pc, stateHash, draw } = t;
          g.step(); g.step();
          const hash = stateHash(g);
          pc.updateCamera(1 / 30); draw(1 / 30);
          t.pure &&= hash === stateHash(g);
          const active = !!(s.stepper.flicker || s.stepper.cross);
          const turn = pc.camera.quaternion.angleTo(t.rotation);
          if (active) {
            t.maxMove = Math.max(t.maxMove, pc.camera.position.distanceTo(t.previous));
            t.maxTurn = Math.max(t.maxTurn, turn);
          } else t.returnTurn = Math.max(t.returnTurn, turn);
          t.previous.copy(pc.camera.position); t.rotation.copy(pc.camera.quaternion);
          if (frame === 59) {
            pc.updateCamera(0);
            t.frozen = t.previous.distanceTo(pc.camera.position) < 1e-6 && t.rotation.angleTo(pc.camera.quaternion) < 1e-6;
          }
          return { frame, active, position: pc.camera.position.toArray(), fov: pc.camera.fov, travel: pc.camera.position.distanceTo(t.start) };
        }, frame);
        if ([14, 59, 86, 90, 103].includes(frame)) {
          samples.push(sample);
          if (quality === 'high' && !reduced || frame === 86)
            await page.screenshot({ path: `${out}/${name}-${skill}-${frame}.jpg`, quality: 88 });
        }
        if (record) await page.waitForTimeout(18);
      }
      const end = await page.evaluate(() => {
        const t = window.cameraTest, { b, g, s, pc, stateHash } = t;
        const position = pc.camera.position.clone(), quaternion = pc.camera.quaternion.clone(), hash = stateHash(g);
        pc.updateCamera(0);
        const pauseMove = position.distanceTo(pc.camera.position), pauseTurn = quaternion.angleTo(pc.camera.quaternion);
        const paused = pauseMove < 1e-6 && pauseTurn < 1e-6 && hash === stateHash(g);
        return { pure: t.pure, hash, maxMove: t.maxMove, maxTurn: t.maxTurn, returnTurn: t.returnTurn, ended: !s.stepper.flicker && !s.stepper.cross, returned: !pc.stepCamera && pc.stepReturn === 0, restoredScope: pc.zoom, paused: paused && t.frozen, pauseMove, pauseTurn, overflow: document.documentElement.scrollWidth > innerWidth, calls: b.shell.renderer.gl.info.render.calls };
      });
      check(end.pure && end.ended && end.returned && end.paused && !end.overflow, `${name} ${skill}: ${JSON.stringify(end)}`);
      check(end.maxMove < 25 && end.maxTurn < 0.03 && end.returnTurn < 0.2, `${name} ${skill}: camera discontinuity ${JSON.stringify(end)}`);
      check(end.restoredScope === (index === 6), `${name} ${skill}: scope state lost`);
      check(reduced ? samples[2].travel < 1e-6 : samples[2].travel > 400, `${name} ${skill}: unexpected pan ${samples[2].travel}`);
      results.push({ name, skill, samples, ...end, errors });
      console.log(`${name} ${skill}: travel=${samples[2].travel.toFixed(1)}m, maxFrame=${end.maxMove.toFixed(1)}m, returnTurn=${end.returnTurn.toFixed(3)}rad`);
      if (record && index === 7) {
        const cleanup = await page.evaluate(() => {
          const { g, s, pc } = window.cameraTest;
          s.meter = 1;
          const restarted = s.activateSkill(7); pc.updateCamera(0);
          const active = pc.stepCamera;
          g.finish(-1, 'Camera cleanup check');
          for (let i = 0; i < 40; i++) pc.updateCamera(1 / 60);
          return restarted && active && !pc.stepCamera && pc.stepReturn === 0 && pc.stepPan === null;
        });
        check(cleanup, 'Ending the battle must release the cinematic camera');
      }
    }
    check(errors.length === 0, `${name}: ${errors.join('\n')}`);
    const video = page.video();
    await context.close();
    if (record) { await video.saveAs(`${out}/stepper-camera-motion.webm`); await video.delete(); }
  }
  for (const skill of ['flicker', 'cross'])
    check(new Set(results.filter(r => r.skill === skill).map(r => r.hash)).size === 1, `${skill}: presentation changed simulation`);
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log('Stepper camera: framing, motion, scope return, reduced motion and simulation hashes verified.');
} finally { await browser.close(); }
