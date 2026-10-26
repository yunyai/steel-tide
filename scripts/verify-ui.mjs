// Run against npm run dev; uses installed Chrome, or PLAYWRIGHT_CHANNEL for another browser.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.STEEL_URL ?? 'http://127.0.0.1:5173';
const out = 'docs/verification';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const require = (v, message) => { if (!v) throw new Error(message); };
try {
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.waitForFunction(() => window.steel);
    await page.getByRole('button', { name: /^Naval battle/ }).click();
    await page.screenshot({ quality: 82, path: `${out}/orders-${width}.jpg` });
    await page.getByRole('button', { name: 'Choose ship', exact: true }).click();
    await page.getByRole('button', { name: 'Random ship', exact: true }).click();
    const hangarRandom = await page.locator('.dossier .ship-name').textContent();
    await page.screenshot({ quality: 82, path: `${out}/hangar-${width}.jpg` });
    await page.evaluate(() => window.steel.start({ mode: 'solo', type: 'freeplay', mapId: 'strait', teamSize: 1, ai: [1, 1], difficulty: 'normal', seed: 9, era: 'mixed', players: [{ shipId: 'hadal', device: 'mouse' }] }));
    await page.waitForTimeout(400);
    await page.screenshot({ quality: 82, path: `${out}/hud-${width}.jpg` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Change ship', exact: true }).click();
    await page.getByRole('button', { name: 'Modern', exact: true }).click();
    await page.getByRole('button', { name: 'Carrier', exact: true }).click();
    await page.getByRole('button', { name: /Queen Elizabeth/ }).click();
    const queenElizabeth = await page.locator('.picker-detail h3').textContent();
    require(queenElizabeth === 'Queen Elizabeth', 'Picker details must follow the selected era/class');
    await page.screenshot({ quality: 82, path: `${out}/picker-${width}.jpg` });
    await page.getByRole('button', { name: 'Random ship', exact: true }).click();
    const random = await page.locator('.picker-detail h3').textContent();
    require(random?.length > 0, 'Random action must display a choice immediately');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Sound', exact: true }).click();
    await page.screenshot({ quality: 82, path: `${out}/settings-${width}.jpg` });
    const keyboardAndPad = await page.evaluate(async () => {
      const { MenuNavigation } = await import('/src/ui/MenuNavigation.ts');
      const nav = new MenuNavigation();
      const root = document.querySelector('.settings');
      const back = [...root.querySelectorAll('button')].find(b => b.textContent === 'Back');
      back.focus(); nav.move(root, 1);
      const moved = document.activeElement !== back;
      nav.activate(root);
      return moved;
    });
    require(keyboardAndPad, 'Controller focus must reach the next action');
    require(errors.length === 0, errors.join('\n'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    require(!overflow, 'Page overflow');
    results.push({ width, height, errors, queenElizabeth, random, hangarRandom, controllerFocus: keyboardAndPad, overflow });
    await page.close();
  }
  writeFileSync(`${out}/ui-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
