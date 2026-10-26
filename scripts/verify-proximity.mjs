import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'docs/verification/proximity';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const results = [];
const scenarios = ['smoke-close', 'smoke-far', 'cloak-close', 'cloak-far', 'sub-close', 'sub-far', 'sub-sonar', 'covered', 'exposed-player', 'sub-player', 'sub-player-sonar', 'sub-player-ability'];
try {
  for (const [q, width, height] of [
    ['ultralow', 1280, 720], ['low', 1280, 720], ['medium', 1280, 720], ['high', 1280, 720],
    ['high', 1920, 1080], ['high', 2560, 1080],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 1; });
    await page.goto(`${process.env.STEEL_URL ?? 'http://127.0.0.1:5184'}/?q=${q}`);
    await page.waitForFunction(() => window.steel);
    await page.evaluate(async () => {
      const { SHIP_BY_ID } = await import('/src/data/ships.ts');
      window.steel.start({ mode: 'solo', type: 'freeplay', mapId: 'open', teamSize: 1, ai: [0, 0], difficulty: 'normal', seed: 719, era: 'mixed', players: [{ shipId: 'gato', device: 'mouse' }] });
      const b = window.steel.battle, g = b.game, me = g.humans()[0];
      g.ai.clear();
      b.shell.input.fallback = true;
      const surface = g.addShip(SHIP_BY_ID.zumwalt, 1, 'Surface contact', 0, -450, Math.PI / 2);
      const sub = g.addShip(SHIP_BY_ID.gato, 1, 'Submarine contact', 0, -450, Math.PI / 2);
      window.visibilityTest = { b, g, me, surface, sub };
    });
    for (const scenario of scenarios) {
      const result = await page.evaluate(async scenario => {
        const { b, g, me, surface, sub } = window.visibilityTest;
        const { canTrack, contactVisible, revealSource, proximityContact } = await import('/src/core/Targeting.ts');
        const { stateHash } = await import('/src/net/hash.ts');
        const ownSub = scenario.startsWith('sub-player');
        const enemySub = scenario.startsWith('sub-') && !ownSub;
        const foe = scenario.startsWith('sub-') ? sub : surface;
        g.ships = [me, foe];
        g.smokes = [];
        g.walls = [];
        for (const s of g.ships) {
          s.pos.set(0, 0, s === me ? 0 : scenario.endsWith('-far') ? -700 : -450);
          s.prevPos.copy(s.pos); s.renderPos.copy(s.pos);
          s.depthState = 0; s.speed = 0; s.throttle = 2;
          s.mods.untargetable = false; s.mods.lockRange = 0; s.mods.revealed = false;
          s.consumables.forEach(c => c.active = 0);
        }
        if (scenario.startsWith('smoke-')) g.smokes.push({ x: 0, z: foe.pos.z, r: 300, life: 30, team: 1 });
        if (scenario.startsWith('cloak-')) { foe.mods.untargetable = true; foe.mods.lockRange = 1; }
        if (enemySub) { sub.pos.y = -30; sub.prevPos.copy(sub.pos); sub.renderPos.copy(sub.pos); }
        if (scenario === 'sub-sonar') me.consumables.find(c => c.spec.type === 'search').active = 10;
        if (ownSub) { me.depthState = 2; me.pos.y = -30; me.prevPos.copy(me.pos); me.renderPos.copy(me.pos); }
        if (scenario === 'sub-player-sonar') foe.consumables.find(c => c.spec.type === 'search').active = 10;
        if (scenario === 'sub-player-ability') me.mods.revealed = true;
        if (scenario === 'covered') { foe.mods.revealed = true; g.addWall(foe, -180, -225, 180, -225, 20, 0xaaddff); }
        if (scenario === 'exposed-player') {
          me.mods.untargetable = true;
          g.smokes.push({ x: 0, z: 0, r: 300, life: 30, team: 0 });
        }
        const pc = b.pcs[0];
        pc.camera.position.set(0, 100, 250);
        pc.camera.lookAt(0, -8, -450);
        pc.camera.updateMatrixWorld(true);
        // Warm visible smoke without advancing the deterministic simulation or moving the ships.
        // Clear old particles so clouds from one fixture cannot contaminate the next capture.
        for (const particles of [window.steel.renderer.alpha, window.steel.renderer.add, window.steel.renderer.flat]) particles.clear();
        if (g.smokes.length) for (let i = 0; i < 240; i++) window.steel.renderer.update(1 / 30, [pc.camera]);
        window.steel.renderer.update(0, [pc.camera]);
        b.huds[0].update(0.2);
        window.steel.renderer.render(b.viewports);
        const view = b.scene.views.get(foe);
        const mode = view.mode;
        let opacity = null;
        view.root.traverse(o => { if (o.isMesh && o.material.transparent) opacity = o.material.opacity; });
        const markers = [...document.querySelectorAll('.marker.enemy')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent);
        const status = document.querySelector('.status-row').textContent;
        const before = stateHash(g);
        // Rendering the opposing team's viewport must not leak the preceding viewport's hull mode.
        b.scene.prepare({ ...b.viewports[0], team: 1 }, 720);
        const opposingMode = view.mode;
        window.steel.renderer.render(b.viewports);
        return {
          scenario, mode, opacity, opposingMode, markers, status,
          contact: contactVisible(foe, 0), track: canTrack(me, foe), source: revealSource(foe, 0),
          proximity: proximityContact(foe, 0), hash: stateHash(g), presentationPure: stateHash(g) === before,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, scenario);
      const hidden = ['smoke-far', 'cloak-far', 'sub-close', 'sub-far'].includes(scenario);
      const marker = !hidden && scenario !== 'covered';
      const expectedMode = scenario === 'sub-close' || scenario === 'sub-sonar' ? 'nearbySub' : scenario === 'sub-far' ? 'enemy' : scenario === 'cloak-far' ? 'cloak' : 'normal';
      if (result.contact === hidden || result.track === hidden || Boolean(result.markers.length) !== marker || result.mode !== expectedMode || !result.presentationPure || result.overflow) throw new Error(JSON.stringify(result));
      if (scenario === 'sub-close' && (result.opacity !== 0.7 || result.opposingMode !== 'ally' || result.source !== null)) throw new Error(JSON.stringify(result));
      if (scenario === 'exposed-player' && (!result.status.includes('Proximity revealed') || !result.status.includes('Smoke exposed') || result.status.includes('Untargetable') || result.status.includes('Smoke concealment'))) throw new Error(JSON.stringify(result));
      if (scenario === 'sub-player' && (!result.status.includes('Nearby silhouette') || !result.status.includes('Depth concealment') || result.status.includes('revealed'))) throw new Error(JSON.stringify(result));
      if (scenario === 'sub-player-sonar' && (!result.status.includes('Sonar revealed') || result.status.includes('Depth concealment'))) throw new Error(JSON.stringify(result));
      if (scenario === 'sub-player-ability' && (!result.status.includes('Ability revealed') || result.status.includes('Depth concealment'))) throw new Error(JSON.stringify(result));
      await page.screenshot({ path: `${out}/${q}-${width}-${scenario}.jpg`, quality: 88 });
      results.push({ q, width, height, ...result });
    }
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  for (const scenario of scenarios) {
    if (new Set(results.filter(r => r.scenario === scenario).map(r => r.hash)).size !== 1) throw new Error(`Preset-dependent simulation: ${scenario}`);
  }
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ screenshots: results.length, presets: 4, widths: [1280, 1920, 2560], checks: 'contacts, locks, markers, submarine opacity, viewport isolation, HUD exposure, hashes' }));
} finally { await browser.close(); }
