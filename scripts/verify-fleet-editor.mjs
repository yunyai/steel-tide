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
          for (const e of document.querySelectorAll('.era-tabs button,.class-tabs button,.kind-switch button,.fleet-modes button,.fleet-pool-choice,.fleet-chip,.ship-combo-trigger')) {
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
      // The focused control's whole ring must sit inside every ancestor that clips.
      const ring = async label => {
        const r = await page.evaluate(() => {
          const e = document.activeElement, s = getComputedStyle(e);
          const pad = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth), b = e.getBoundingClientRect();
          const clipped = [];
          for (let p = e.parentElement; p; p = p.parentElement) {
            const ps = getComputedStyle(p);
            if (!/hidden|clip|auto|scroll/.test(ps.overflowX) && ps.clipPath === 'none') continue;
            const pr = p.getBoundingClientRect();
            if (b.left - pad < pr.left + parseFloat(ps.borderLeftWidth) - 0.5 || b.right + pad > pr.right - parseFloat(ps.borderRightWidth) + 0.5) clipped.push(p.className);
          }
          return { visible: e.matches(':focus-visible'), pad, clipped };
        });
        console.log(JSON.stringify({ ring: label, width, fallback, ...r }));
        check(r.visible && !r.clipped.length, `${label} focus ring clipped: ${JSON.stringify(r)}`);
      };
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
      check(await enemy.getByRole('checkbox', { name: /Leviathan/ }).isChecked() === false, 'A new pool must leave titans out');
      await enemy.getByRole('button', { name: 'Clear visible', exact: true }).click();
      // Class chips filter the list; Select visible only adds what is shown.
      await enemy.getByRole('button', { name: 'Submarines', exact: true }).click();
      const subs = await enemy.locator('.fleet-pool-choice').count();
      check(subs > 0 && await enemy.locator('.fleet-pool-choice .cls-badge').evaluateAll(b => b.every(x => x.textContent === 'SS')), 'The SS chip must show only submarines');
      await enemy.getByRole('button', { name: 'Select visible', exact: true }).click();
      check(await enemy.getByRole('checkbox', { checked: true }).count() === subs, 'Select visible must check every shown submarine');
      await enemy.getByRole('button', { name: 'Clear visible', exact: true }).click();
      await enemy.getByRole('button', { name: 'Submarines', exact: true }).click();
      await enemy.getByRole('searchbox').fill('queen');
      await ring('pool search');
      await enemy.getByRole('checkbox', { name: /Queen Elizabeth/ }).check();
      await enemy.getByRole('searchbox').fill('gato');
      await enemy.getByRole('checkbox', { name: /Gato/ }).check();
      await enemy.getByRole('searchbox').fill('');
      check(await enemy.getByRole('checkbox', { checked: true }).count() === 2, 'Pool checkboxes must retain independent selections');
      await enemy.evaluate(e => e.scrollIntoView({ block: 'start' }));
      await capture('solo-pool');
      await enemy.getByRole('button', { name: 'Assignments', exact: true }).click();
      check(await enemy.getByRole('button', { name: 'Balanced', exact: true }).getAttribute('aria-pressed') === 'true', 'Assignments must start with balanced automatic slots');
      // The ship combo: ArrowDown opens it, the list keys move, Escape closes back onto the button.
      const trigger = enemy.getByRole('button', { name: /^Enemy AI AI slot 1:/ });
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      const comboSearch = enemy.getByRole('searchbox', { name: 'Enemy AI AI slot 1 search', exact: true });
      check(await comboSearch.evaluate(e => e === document.activeElement), 'Opening the combo must focus its search');
      await page.keyboard.press('ArrowDown');
      check(await comboSearch.getAttribute('aria-activedescendant') !== null, 'Arrow keys must mark an active ship');
      await ring('combo search');
      await capture('solo-combo');
      await page.keyboard.press('Escape');
      check(await trigger.evaluate(e => e === document.activeElement) && !(await comboSearch.isVisible()), 'Escape must close the combo onto its button');
      await trigger.click();
      await comboSearch.fill('queen');
      await page.keyboard.press('Enter');
      check((await trigger.getAttribute('aria-label')) === 'Enemy AI AI slot 1: Queen Elizabeth', 'Enter must choose the first match');
      check(await trigger.evaluate(e => e === document.activeElement), 'Choosing must return focus to the slot');
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
      // An era change redraws the editors in place: the search and the focused checkbox stay.
      await page.evaluate(() => window.steel.net.client.send({ t: 'settings', s: { era: 'historic' } }));
      await page.waitForFunction(() => window.steel.net.client.lobby.settings.era === 'historic');
      check(await pool.getByRole('searchbox').inputValue() === 'gato', 'An era change must keep the pool search');
      check(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'checkbox'), 'An era change must keep focus in the pool');
      await page.evaluate(() => window.steel.net.client.send({ t: 'settings', s: { era: 'mixed' } }));
      await page.waitForFunction(() => window.steel.net.client.lobby.settings.era === 'mixed');
      await pool.getByRole('searchbox').fill('');
      await pool.evaluate(e => e.scrollIntoView({ block: 'start' }));
      await capture('lan-pool');
      await page.getByRole('button', { name: /^Team A AI AI slot 8:/ }).click();
      await page.getByRole('searchbox', { name: 'Team A AI AI slot 8 search', exact: true }).fill('queen');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.steel.net.client.lobby.settings.aiSelection[0].slots[7] === 'queenElizabeth');
      check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Team A AI AI slot 8: Queen Elizabeth'), 'LAN last assignment must retain focus');
      await capture('lan-assign');
      await click('Leave lobby');
      await click('Back');
      check(!errors.length, errors.join('\n'));
      await page.close();
    }
  }
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
