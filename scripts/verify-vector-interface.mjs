import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.VECTOR_UI_OUT ?? 'docs/verification/vector-neon-battery/interface';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const rows = [];
try {
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = callback => callback.name === 'frame' ? 1 : raf(callback); });
    await page.goto(process.env.STEEL_URL ?? 'http://127.0.0.1:5198');
    await page.waitForFunction(() => window.steel);
    const noVector = await page.evaluate(async () => {
      window.steel.start({ mode: 'solo', type: 'freeplay', mapId: 'open', teamSize: 1, ai: [0, 0], difficulty: 'normal', seed: 713, era: 'mixed', players: [{ shipId: 'architect', device: 'mouse' }] });
      const b = window.steel.battle, g = b.game, s = g.humans()[0], pc = b.pcs[0], input = b.shell.input;
      g.ai.clear(); input.capture = false; input.fallback = true; input.onLockChange = null; b.paused = false; b.setOverlay(null);
      s.pos.set(0, 0, 3000); s.prevPos.copy(s.pos); s.renderPos.copy(s.pos); s.throttle = 2; s.speed = 0; s.secondaries = [];
      const search = s.consumables[1]; search.cooldown = 40; search.charges = 6;
      const f = window.vectorReview = { b, g, s, pc, input };
      f.draw = () => { g.interpolate(); pc.camera.position.set(-700, 700, 3500); pc.camera.lookAt(200, 40, 2300); pc.camera.updateMatrixWorld(true); window.steel.renderer.update(0, [pc.camera]); b.huds[0].update(0); window.steel.renderer.render(b.viewports); };
      f.key = code => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); pc.control(1 / 60, input); input.endFrame(); window.dispatchEvent(new KeyboardEvent('keyup', { code })); };
      f.snapshot = () => ({ mobilityHidden: [...document.querySelectorAll('.sk.vector')].every(e => e.hidden && getComputedStyle(e).display === 'none'), actions: [...document.querySelectorAll('.sk.vector')].map(e => ({ action: e.dataset.action, state: e.dataset.state, text: e.title, title: e.title, timer: e.querySelector('.t').textContent, charges: e.querySelector('.ch').textContent, key: e.querySelector('kbd').textContent, box: e.getBoundingClientRect().toJSON() })), search: { charges: search.charges, cooldown: search.cooldown, title: document.querySelector('[data-utility="search"]').title }, overflow: document.documentElement.scrollWidth > innerWidth, clipped: [...document.querySelectorAll('.sk.vector')].some(e => e.getBoundingClientRect().top < 0 || e.getBoundingClientRect().right > innerWidth), rows: new Set([...document.querySelectorAll('.skillbar .sk:not([hidden])')].map(e => Math.round(e.getBoundingClientRect().bottom))).size });
      f.draw(); return f.snapshot();
    });
    if(!noVector.mobilityHidden)throw Error('Unfitted Vector tiles are visible');
    await page.screenshot({ path: `${out}/no-vector-${width}.jpg`, quality: 88 });
    // Mobile Battery lifts deployed platforms, so one escort waits on the water.
    const ready=await page.evaluate(async()=>{const {refitArchitect,materialize}=await import('/src/skills/misc/ArchitectRuntime.ts'),f=window.vectorReview;if(!refitArchitect(f.s,0,{type:'vector',skill:0}))throw Error('Vector refit failed');
      const escort=f.s.architect.slots[1],m=materialize(f.s,escort);escort.state='deployed';m.pos.set(1500,0,3000);f.draw();return f.snapshot();});
    if (ready.actions.length !== 2 || ready.actions.some(a => a.state !== 'ready') || ready.actions[0].key !== 'H' || ready.actions[1].key !== 'J' || ready.overflow || ready.clipped || ready.rows !== 1) throw Error(JSON.stringify(ready));
    await page.screenshot({ path: `${out}/ready-${width}.jpg`, quality: 88 });
    const active = await page.evaluate(() => {
      const f = window.vectorReview, { s, g, pc } = f;
      pc.aim.set(2000, 0, 3000); f.key('KeyH'); const dashCommand = { dash: !!pc.out.architectHullDash, mobile: !!pc.out.architectMobileBattery, consumable: pc.out.consumable };
      g.step(); const dashing = !!s.architect.drive;
      for (let i = 0; i < 35; i++) g.step();
      f.key('KeyJ'); const mobileCommand = { dash: !!pc.out.architectHullDash, mobile: !!pc.out.architectMobileBattery, consumable: pc.out.consumable }; g.step(); f.draw();
      return { dashCommand, mobileCommand, dashing, status: s.getVectorMobilityStatus(), hud: f.snapshot() };
    });
    if (!active.dashCommand.dash || active.dashCommand.mobile || active.dashCommand.consumable !== -1 || !active.dashing || !active.mobileCommand.mobile || active.mobileCommand.dash || active.mobileCommand.consumable !== -1 || active.status.hullDash.charges !== 1 || active.status.mobileBattery.activeRemaining < 9.9 || active.hud.search.charges !== 6 || active.hud.actions[1].state !== 'active' || active.hud.clipped) throw Error(JSON.stringify(active));
    await page.screenshot({ path: `${out}/active-${width}.jpg`, quality: 88 });
    const blocked = await page.evaluate(() => {
      const f = window.vectorReview; f.s.mods.rooted = true; f.draw();
      return f.snapshot();
    });
    if (blocked.actions.some(a => !a.text.includes('Rooted')) || blocked.clipped) throw Error(JSON.stringify(blocked));
    await page.screenshot({ path: `${out}/blocked-${width}.jpg`, quality: 88 });
    const keys = width === 1280 ? await page.evaluate(async () => {
      const { DEFAULT_BINDINGS, bindings, parseBindings, rebind, setBindings } = await import('/src/input/Keybinds.ts');
      const f = window.vectorReview, { s, pc, input, g } = f; s.mods.rooted = false;
      const saved = { ...DEFAULT_BINDINGS, tskill1: 'KeyH', tskill2: 'KeyJ', tdiveDown: 'KeyN' }; delete saved.architectHullDash; delete saved.architectMobileBattery;
      setBindings(parseBindings(saved)); f.draw(); const migrated = f.snapshot(); f.draw(); const stillUnbound = f.snapshot();
      const { buildSettings } = await import('/src/ui/SettingsSheet.ts');
      f.b.setPaused(true);
      const sheet = buildSettings({ back() {}, click() {}, tab: 'keys' });
      const overlay = document.createElement('div'); overlay.className = 'overlay'; overlay.append(sheet); f.b.setOverlay(overlay);
      const rows = [...sheet.querySelectorAll('tr')].filter(e => e.textContent.includes('Vector:')).map(e => e.textContent);
      const labels = [...sheet.querySelectorAll('.keycap')].filter(e => e.getAttribute('aria-label')?.startsWith('Vector:')).map(e => e.getAttribute('aria-label'));
      window.vectorSettings = sheet;
      return { migrated, stillUnbound, rows, labels, stored: bindings() };
    }) : null;
    if (keys && (keys.migrated.actions.some(a => a.key !== 'Unbound') || keys.stillUnbound.actions.some(a => !a.title.includes('Keyboard unbound')) || keys.stored.tskill1 !== 'KeyH' || keys.stored.tskill2 !== 'KeyJ' || keys.labels.some(a => !a.includes('unbound')))) throw Error(JSON.stringify(keys));
    if (keys) {
      await page.waitForFunction(()=>!document.pointerLockElement);
      await page.evaluate(() => { [...window.vectorSettings.querySelectorAll('tbody')].find(e=>e.textContent.includes('Vector:'))?.scrollIntoView({ block: 'center' }); });
      await page.screenshot({ path: `${out}/legacy-conflict-settings-1280.jpg`, quality: 88 });
      await page.getByRole('button', { name: /^Vector: Hull Dash: unbound/ }).click();
      await page.keyboard.press('k');
      await page.getByRole('button', { name: /^Vector: Mobile Battery: unbound/ }).click();
      await page.keyboard.press('l');
      const settingsKeys=await page.evaluate(async()=>{const {bindings}=await import('/src/input/Keybinds.ts');return {dash:bindings().architectHullDash,mobile:bindings().architectMobileBattery};});
      if(settingsKeys.dash!=='KeyK'||settingsKeys.mobile!=='KeyL')throw Error(JSON.stringify(settingsKeys));
      keys.reboundInSettings=settingsKeys;
      await page.evaluate(() => { window.vectorReview.b.setOverlay(null); window.scrollTo(0, 0); });
    }
    const controls = width === 1280 ? await page.evaluate(async () => {
      const { PlayerController } = await import('/src/player/PlayerController.ts');
      const f = window.vectorReview, { s, g, input, pc } = f;
      const reset = () => { s.control.architectHullDash = s.control.architectMobileBattery = false; s.control.consumable = -1; s.control.slot = null; };
      reset(); f.key('KeyH'); f.key('KeyJ'); const old = { dash: !!s.control.architectHullDash, mobile: !!s.control.architectMobileBattery };
      reset(); f.key('KeyK'); f.key('KeyL'); const rebound = { dash: !!s.control.architectHullDash, mobile: !!s.control.architectMobileBattery }; reset();
      s.consumables[1].cooldown = 0; const charges = s.consumables[1].charges; f.key('KeyG'); const searchCommand = s.control.consumable; g.step(); const search = { command: searchCommand, used: charges - s.consumables[1].charges, active: s.consumables[1].active };
      let down = []; Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ index: 0, id: 'Injected standard controller', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) }] });
      const pad = new PlayerController(s, 'pad0', 0, g), padCases = [];
      const frame = buttons => { down = buttons; input.pollPads(); pad.control(1 / 60, input); input.endFrame(); };
      for (const buttons of [[4, 15], [5, 15], [4, 5, 15]]) {
        frame([]); reset(); frame(buttons); const command = { dash: !!pad.out.architectHullDash, mobile: !!pad.out.architectMobileBattery, consumable: pad.out.consumable, slot: pad.out.slot };
        frame(buttons.includes(4) && buttons.includes(5) ? [5] : []); const firstRelease = pad.out.slot; frame([]); padCases.push({ buttons, command, firstRelease, slotAfterRelease: pad.out.slot });
      }
      reset(); frame([15]); const plainSearch = pad.out.consumable; frame([]); reset(); frame([5]); frame([]); const shoulderTap = pad.out.slot;
      reset(); frame([4, 2]); const simultaneousFace = pad.out.skill; frame([]); const faceReleaseSlot = pad.out.slot;
      reset(); const targetSlot = s.architect.slots[0]; targetSlot.state = 'destroyed'; targetSlot.hp = 0; targetSlot.rebuild = 5; f.draw();
      return { old, rebound, search, padCases, plainSearch, shoulderTap, simultaneousFace, faceReleaseSlot, lost: f.snapshot() };
    }) : null;
    if (controls && (controls.old.dash || controls.old.mobile || !controls.rebound.dash || !controls.rebound.mobile || controls.search.command !== 1 || controls.search.used !== 1 || !controls.search.active || controls.padCases.some((c, i) => c.command.dash !== (i !== 1) || c.command.mobile !== (i === 1) || c.command.consumable !== -1 || c.command.slot !== null || c.firstRelease !== null || c.slotAfterRelease !== null) || controls.plainSearch !== 1 || controls.shoulderTap !== 1 || controls.simultaneousFace !== 2 || controls.faceReleaseSlot !== null || controls.lost.actions.some(a => a.state !== 'off' || !a.text.includes('rebuild in')))) throw Error(JSON.stringify(controls));
    if (controls) await page.screenshot({ path: `${out}/custom-keys-vector-lost-1280.jpg`, quality: 88 });
    if (errors.length) throw Error(errors.join('\n'));
    rows.push({ width, height, noVector, ready, active, blocked, keys, controls, errors });
    await page.close(); console.log(`Vector interface ${width}x${height}: ready/active/blocked layout, independent Search${controls ? ', saved/custom keys and actual Input/PlayerController gamepad path' : ''} passed`);
  }
  writeFileSync(`${out}/results.json`, JSON.stringify(rows, null, 2));
} finally { await browser.close(); }
