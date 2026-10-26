import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5184';
const out = 'docs/verification/fleet-editor';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const results = [];
const check = (ok, message) => { if (!ok) throw new Error(message); };
try {
  for (const [width, height] of [[1024, 768], [1280, 720], [1920, 1080], [2560, 1080]]) {
    for (const fallback of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      if (fallback) await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
      await page.goto(base);
      await page.waitForFunction(() => window.steel);
      if (fallback) await page.addStyleTag({ content: ':root { --display: ui-monospace, monospace; --text: Arial, sans-serif; font-size:20px; }' });
      const capture = async screen => {
        const layout = await page.evaluate(() => {
          const issues = [];
          for (const e of document.querySelectorAll('.era-tabs button,.class-tabs button,.kind-switch button,.fleet-modes button,.fleet-pool-choice')) {
            if (!e.getClientRects().length) continue;
            const r = e.getBoundingClientRect();
            if (e.scrollWidth > e.clientWidth + 1) issues.push(`${e.textContent}: text overflow`);
            for (let p = e.parentElement; p; p = p.parentElement) {
              const s = getComputedStyle(p), pr = p.getBoundingClientRect();
              if (/hidden|clip/.test(s.overflowX) && (r.left < pr.left - 1 || r.right > pr.right + 1)) issues.push(`${e.textContent}: clipped by ${p.className}`);
            }
          }
          const eras = [...document.querySelectorAll('.roster .era-tabs button')];
          if (eras.length === 6 && new Set(eras.map(e => e.offsetTop)).size < 2) issues.push('Six eras need distinct rows');
          return { issues, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        await page.screenshot({ path: `${out}/${screen}-${width}${fallback ? '-fallback' : ''}.jpg`, quality: 88, animations: 'disabled' });
        const r = { width, height, fallback, screen, ...layout };
        results.push(r); console.log(JSON.stringify(r));
        check(!r.issues.length && !r.overflow, JSON.stringify(r));
      };
      const click = name => page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('button', { name: /^Hangar/ }).click();
      await click('Misc');
      await page.getByRole('button', { name: /^Stepper/ }).click();
      await capture('hangar');
      await click('Vehicles');
      await click('Artillery');
      await page.getByRole('button', { name: /Type 4 Ho-Ro/ }).click();
      await capture('garage');
      await click('Back');
      await page.getByRole('button', { name: /^Naval battle/ }).click();
      await click('Mixed');
      await click('Free play');
      const enemy = page.getByRole('region', { name: 'Enemy AI', exact: true });
      await enemy.getByRole('button', { name: 'Random pool', exact: true }).click();
      await enemy.getByRole('button', { name: 'Clear', exact: true }).click();
      await enemy.getByRole('searchbox').fill('queen');
      await enemy.getByRole('checkbox', { name: /Queen Elizabeth/ }).check();
      await enemy.getByRole('searchbox').fill('gato');
      await enemy.getByRole('checkbox', { name: /Gato/ }).check();
      await enemy.getByRole('searchbox').fill('');
      check(await enemy.getByRole('checkbox', { checked: true }).count() === 2, 'Pool checkboxes must retain independent selections');
      await enemy.evaluate(e => e.scrollIntoView({ block: 'start' }));
      await capture('solo-pool');
      await enemy.getByRole('button', { name: 'Assignments', exact: true }).click();
      check(await enemy.getByRole('button', { name: 'Balanced', exact: true }).getAttribute('aria-pressed') === 'true', 'Assignments must start with balanced automatic slots');
      await enemy.getByLabel('Enemy AI AI slot 1', { exact: true }).selectOption('queenElizabeth');
      await enemy.evaluate(e => e.scrollIntoView({ block: 'start' }));
      await capture('solo-assign');
      if (width === 1280 && !fallback) {
        await page.getByRole('group', { name: 'AI allies', exact: true }).getByRole('button', { name: '0', exact: true }).click();
        await page.getByRole('group', { name: 'AI enemies', exact: true }).getByRole('button', { name: '1', exact: true }).click();
        await click('Choose ship');
        await click('Set sail');
        const spawned = await page.evaluate(() => ({
          player: window.steel.battle.game.humans()[0].spec.id,
          enemies: window.steel.battle.game.fleet.filter(s => s.team === 1).map(s => s.spec.id),
        }));
        check(spawned.player === 'stepper' && spawned.enemies.length === 3 && spawned.enemies.filter(id => id === 'queenElizabeth').length === 1, JSON.stringify(spawned));
        console.log(JSON.stringify({ actualMenuSpawns: spawned }));
        writeFileSync(`${out}/solo-spawn.json`, JSON.stringify(spawned, null, 2));
        await page.keyboard.press('Escape');
        await click('Leave battle');
      } else await click('Back');
      await page.getByRole('button', { name: /^LAN battle/ }).click();
      await click('Create lobby');
      await page.waitForFunction(() => window.steel.net.client?.lobby);
      await page.evaluate(() => window.steel.net.client.send({ t: 'settings', s: {
        era: 'mixed', ai: [8, 1], type: 'freeplay', aiSelection: [{ mode: 'assign', slots: ['iowa', 'gato'] }, { mode: 'pool', pool: ['queenElizabeth'] }],
      } }));
      await page.waitForFunction(() => window.steel.net.client.lobby.settings.era === 'mixed');
      const pool = page.getByRole('region', { name: 'Team B AI', exact: true });
      await pool.getByRole('searchbox').fill('gato');
      await pool.getByRole('checkbox', { name: /Gato/ }).check();
      await page.waitForFunction(() => window.steel.net.client.lobby.settings.aiSelection[1].pool.includes('gato'));
      check(await pool.getByRole('searchbox').inputValue() === 'gato', 'LAN checkbox updates must preserve search');
      check(await pool.getByRole('checkbox', { name: /Gato/ }).isChecked(), 'LAN checkbox must stay checked');
      check(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'checkbox'), 'LAN checkbox must retain focus');
      await pool.getByRole('searchbox').fill('');
      await pool.evaluate(e => e.scrollIntoView({ block: 'start' }));
      await capture('lan-pool');
      const slot = page.getByLabel('Team A AI AI slot 8', { exact: true });
      await slot.focus();
      await slot.selectOption('queenElizabeth');
      await page.waitForFunction(() => window.steel.net.client.lobby.settings.aiSelection[0].slots[7] === 'queenElizabeth');
      check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Team A AI AI slot 8'), 'LAN last assignment must retain focus');
      await capture('lan-assign');
      await click('Leave lobby');
      await click('Back');
      check(!errors.length, errors.join('\n'));
      await page.close();
    }
  }
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
