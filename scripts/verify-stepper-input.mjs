import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
try {
  const p = await browser.newPage();
  await p.addInitScript(() => {
    window.requestAnimationFrame = () => 1;
  });
  await p.goto(process.env.STEEL_URL ?? 'http://127.0.0.1:5184');
  await p.waitForFunction(() => window.steel);
  const result = await p.evaluate(async () => {
    const { PlayerController } = await import('/src/player/PlayerController.ts');
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
      s = g.humans()[0],
      input = b.shell.input,
      pc = b.pcs[0];
    input.fallback = true;
    const keyboard = [];
    for (const code of ['KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyR', 'KeyT', 'KeyB']) {
      s.control.skill = -1;
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      pc.control(1 / 60, input);
      keyboard.push(pc.out.skill);
      input.endFrame();
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    }
    let down = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          index: 0,
          id: 'Test controller',
          connected: true,
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: down.includes(i),
            value: down.includes(i) ? 1 : 0,
          })),
        },
      ],
    });
    const pad = new PlayerController(s, 'pad0', 0, g);
    const gamepad = [];
    for (let bank = 0; bank < 3; bank++)
      for (const button of [2, 1, 3]) {
        down = [];
        input.pollPads();
        input.endFrame();
        down = [button, ...(bank ? [bank === 1 ? 4 : 5] : [])];
        input.pollPads();
        s.control.skill = -1;
        pad.control(1 / 60, input);
        gamepad.push(pad.out.skill);
        input.endFrame();
      }
    return { keyboard, gamepad };
  });
  if (
    JSON.stringify(result.keyboard) !== JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8]) ||
    JSON.stringify(result.gamepad) !== JSON.stringify([0, 1, 6, 2, 3, 7, 4, 5, 8])
  )
    throw new Error(JSON.stringify(result));
  writeFileSync('docs/verification/stepper/input-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
