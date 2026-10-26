// Screenshot and interaction sweep of the shipped desktop surfaces. Requires Vite dev.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5184';
const out = 'docs/verification/release';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const results = [];
const check = (ok, message) => { if (!ok) throw new Error(message); };
try {
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${base}/?q=low`);
    await page.waitForFunction(() => window.steel);
    const shot = async (screen) => {
      await page.screenshot({ path: `${out}/${screen}-${width}.jpg`, quality: 85, animations: 'disabled' });
      const layout = await page.evaluate(() => {
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        const clipped = [];
        const unnamed = [];
        const defects = [];
        for (const e of document.querySelectorAll('button,select,input,a[href]')) {
          if (!visible(e) || e.disabled) continue;
          const label = e.getAttribute('aria-label') || e.textContent?.trim() || e.title || e.labels?.[0]?.textContent;
          if (!label) unnamed.push(e.outerHTML.slice(0, 180));
          if (e instanceof HTMLButtonElement && e.scrollWidth > e.clientWidth + 2)
            defects.push(`Button text overflows: ${label?.slice(0, 60)}`);
          const r = e.getBoundingClientRect();
          // Scrollable ancestors intentionally contain controls outside their initial viewport.
          let scrollable = false;
          for (let p = e.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) { scrollable = true; break; }
          }
          if (!scrollable && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1))
            clipped.push(label.slice(0, 100));
        }
        for (const e of document.querySelectorAll('.setup > .sheet-actions, .lan.room > .sheet-actions')) {
          const r = e.getBoundingClientRect(), s = e.closest('.sheet').getBoundingClientRect();
          if (r.bottom > Math.min(innerHeight, s.bottom) + 1 || r.top < Math.max(0, s.top) - 1)
            defects.push('Setup actions require scrolling to reach');
        }
        const overlaps = [];
        const panels = [...document.querySelectorAll('.cockpit,.helm,.mapframe,.depth')].filter(visible);
        for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
          const a = panels[i], b = panels[j];
          if (a.contains(b) || b.contains(a)) continue;
          const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
          if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 2 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 2)
            overlaps.push([a.className, b.className]);
        }
        return { overflow: document.documentElement.scrollWidth > innerWidth, clipped, unnamed, overlaps, defects };
      });
      results.push({ width, height, screen, ...layout });
      console.log(JSON.stringify(results.at(-1)));
    };
    const click = name => page.getByRole('button', { name, exact: true }).click();
    const menu = async (method, ...args) => page.evaluate(({ method, args }) => {
      window.auditShell.closeBattle(); window.auditShell.menu[method](...args);
    }, { method, args });
    const start = async (shipId = 'stepper', type = 'freeplay') => {
      await page.evaluate(({ shipId, type }) => {
        window.steel.start({ mode: 'solo', type, mapId: 'open', teamSize: 8,
          ai: type === 'freeplay' ? [3, 4] : undefined, escorts: 2,
          difficulty: 'normal', seed: 204, era: 'mixed', players: [{ shipId, device: 'mouse' }] });
        const b = window.steel.battle;
        window.auditShell = b.shell;
        b.shell.input.capture = true; b.shell.input.fallback = true;
      }, { shipId, type });
      await page.waitForTimeout(180);
    };

    await shot('title');
    // Capture a reference to the existing app shell; all subsequent menus use their real methods.
    await start();
    await menu('showOrders', 'battle');
    await shot('naval-orders');
    await click('Convoy');
    await shot('convoy-orders');
    await click('Free play');
    await page.getByRole('button', { name: 'Assignments', exact: true }).first().click();
    await page.getByRole('button', { name: 'Random pool', exact: true }).last().click();
    await shot('fleet-options');
    await menu('showOrders', 'rush');
    await shot('rush-orders');
    await menu('showHangar', null);
    await click('Misc');
    await page.getByRole('button', { name: /^Stepper/ }).click();
    await shot('stepper-hangar');
    await page.locator('.dossier').evaluate(e => e.scrollTop = e.scrollHeight);
    await shot('stepper-hangar-details');
    await menu('showGarage', null);
    await click('Titan');
    await page.getByRole('button', { name: /Landkreuzer/ }).click();
    await shot('garage');
    await menu('showGroundOrders');
    await click('Free play');
    await shot('ground-orders');
    await menu('showSettings');
    for (const tab of ['Graphics', 'Sound', 'Controls', 'Keybinds']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      check(await page.evaluate(() => document.activeElement?.getAttribute('aria-selected') === 'true'), 'Settings tab focus must survive a tab change');
      await shot(`settings-${tab.toLowerCase()}`);
      if (tab === 'Keybinds' || tab === 'Sound') {
        await page.locator('.settings-body').evaluate(e => e.scrollTop = e.scrollHeight);
        await shot(`settings-${tab.toLowerCase()}-bottom`);
      }
    }
    await menu('showTitle');
    await page.getByRole('button', { name: /^LAN battle/ }).click();
    await page.waitForFunction(() => window.steel.net.client?.status === 'online');
    await shot('lan-list');
    await click('Create lobby');
    await page.waitForFunction(() => window.steel.net.client?.lobby);
    await page.evaluate(() => window.steel.net.client.send({ t: 'settings', s: { era: 'mixed', ai: [8, 8], shiftTempo: 'long', aiSelection: [{ mode: 'assign', slots: Array(8).fill('queenElizabeth') }, { mode: 'pool', pool: ['fletcher', 'stepper'] }] } }));
    await page.waitForFunction(() => window.steel.net.client.lobby.settings.shiftTempo === 'long');
    const scroll = await page.evaluate(() => {
      document.querySelector('.lan-room-body').scrollTop = 80;
      document.querySelector('.fleet-slots').scrollTop = 150;
      return [...document.querySelectorAll('.lan-room-body,[data-scroll-key]')].map(e => e.scrollTop);
    });
    await page.evaluate(() => window.steel.net.client.send({ t: 'settings', s: { shiftTempo: 'burst' } }));
    await page.waitForFunction(() => window.steel.net.client.lobby.settings.shiftTempo === 'burst');
    const restored = await page.evaluate(() => [...document.querySelectorAll('.lan-room-body,[data-scroll-key]')].map(e => e.scrollTop));
    check(JSON.stringify(restored) === JSON.stringify(scroll), 'Lobby refresh must preserve scroll position');
    await page.locator('.lan-room-body,[data-scroll-key]').evaluateAll(es => es.forEach(e => e.scrollTop = 0));
    await shot('lan-room');
    await page.locator('.lan-room-body').evaluate(e => e.scrollTop = e.scrollHeight);
    await shot('lan-room-bottom');
    await click('Leave lobby');
    await click('Back');

    for (const shipId of ['stepper', 'hadal', 'gato', 'queenElizabeth']) {
      await start(shipId);
      await shot(`hud-${shipId}`);
      if (shipId === 'stepper') {
        await page.evaluate(async () => {
          const { activateConsumable } = await import('/src/ships/Consumables.ts');
          const b = window.steel.battle, s = b.pcs[0].ship;
          s.meter = 1; s.activateSkill(8); s.activateSkill(5); s.activateSkill(2);
          s.startFlood(b.game.ships.find(e => e.team !== s.team));
          s.startFire(b.game.ships.find(e => e.team !== s.team));
          activateConsumable(s, s.consumables.findIndex(c => c.spec.type === 'search'));
        });
        await page.waitForTimeout(120);
        await shot('hud-status');
      }
    }
    await page.keyboard.down('Tab');
    await page.waitForSelector('.report');
    await shot('scoreboard');
    await page.keyboard.up('Tab');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause');
    await shot('pause');
    await click('Change ship');
    await click('Misc');
    await page.getByRole('button', { name: /^Stepper/ }).click();
    await shot('ship-picker');
    await click('Back');
    await click('End battle');
    await page.waitForSelector('.report');
    await shot('naval-report');
    await click('Main menu');
    await start('stepper', 'bossrush');
    await page.evaluate(() => { const r = window.steel.battle.game.rush; r.wave = 1; r.waveCleared(); });
    await page.waitForSelector('.intermission .card');
    await shot('refit');
    await page.locator('.intermission .card').first().click();
    check(await page.evaluate(() => window.steel.battle.game.rush.phase !== 'offer'), 'Refit click must choose an upgrade');

    await page.evaluate(async () => {
      const { GROUND_MAPS } = await import('/src/ground/sim/maps.ts');
      window.steel.start({ kind: 'ground', mode: 'solo', type: 'freeplay', mapId: GROUND_MAPS[0].id,
        teamSize: 8, ai: [3, 4], difficulty: 'normal', seed: 204, era: 'mixed', players: [{ vehicleId: 'ratte', device: 'mouse' }] });
      window.steel.battle.shell.input.capture = true;
      window.steel.battle.shell.input.fallback = true;
    });
    await page.waitForTimeout(200);
    await shot('ground-hud');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause');
    await shot('ground-pause');
    await click('Change vehicle');
    await shot('vehicle-picker');
    await click('Back');
    await click('End battle');
    await page.waitForSelector('.report');
    await shot('ground-report');
    check(errors.length === 0, errors.join('\n'));
    await page.close();
  }
  writeFileSync(`${out}/ui-sweep.json`, JSON.stringify(results, null, 2));
  const issues = results.filter(r => r.overflow || r.clipped.length || r.unnamed.length || r.overlaps.length || r.defects.length);
  console.log(JSON.stringify({ screens: results.length, issues }, null, 2));
  if (process.env.STRICT_UI === '1') check(issues.length === 0, 'UI defects recorded in ui-sweep.json');
} finally { await browser.close(); }
