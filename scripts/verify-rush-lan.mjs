import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

// Co-op Boss Rush over LAN in two local pages: the host picks Boss Rush on Hard in the lobby,
// both captains sail, wave 1 is sunk on the same turn on both peers, each captain picks their
// own refit card, and the peers' hashes agree tick for tick through the next wave.

const out = process.env.RUSH_LAN_OUT ?? 'docs/verification/rush-lan';
mkdirSync(out, { recursive: true });
const url = process.env.STEEL_URL ?? 'http://127.0.0.1:5197';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [];
const errors = [];
const check = (ok, what) => {
  if (!ok) throw Error(what);
};
try {
  for (let i = 0; i < 2; i++) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    pages.push(p);
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(url);
    await p.waitForFunction(() => window.steel);
    await p.getByRole('button', { name: /^LAN battle/ }).click();
    await p.waitForFunction(() => window.steel.net.client?.id);
  }
  const [host, guest] = pages;
  await host.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await host.waitForFunction(() => window.steel.net.client?.lobby);
  const id = await host.evaluate(() => window.steel.net.client.lobby.id);
  await guest.evaluate((id) => window.steel.net.client.send({ t: 'join', lobby: id }), id);
  await guest.waitForFunction(() => window.steel.net.client?.lobby?.members.length === 2);
  check((await host.evaluate(() => window.steel.net.client.lobby.members.map((m) => m.team))).join() === '0,1', 'A fleet battle lobby should split the captains');

  // The host sets up the run through the lobby itself.
  await host.getByRole('button', { name: 'Boss Rush', exact: true }).click();
  await guest.waitForFunction(() => window.steel.net.client.lobby.settings.type === 'bossrush');
  await host.locator('[data-k="lobby-rush-difficulty-hard"]').click();
  await guest.waitForFunction(() => window.steel.net.client.lobby.settings.rush?.preset === 'hard');
  await host.evaluate(() => window.steel.net.client.send({ t: 'me', shipId: 'iowa' }));
  await host.waitForFunction(() => window.steel.net.client.lobby.members[0].shipId === 'iowa');
  const lobby = await guest.evaluate(() => ({ teams: window.steel.net.client.lobby.members.map((m) => m.team), columns: [...document.querySelectorAll('.lan-teams > section')].map((s) => s.getAttribute('aria-label')), facts: document.querySelector('.lan-facts')?.textContent }));
  check(lobby.teams.join() === '0,0', `Rush lobby keeps one fleet: ${lobby.teams}`);
  check(lobby.columns.join() === 'Captains', `Rush lobby shows one Captains column: ${lobby.columns}`);
  check(/Boss Rush/.test(lobby.facts) && /Hard/.test(lobby.facts) && /Two AI escorts/.test(lobby.facts), `Guest sees the run settings: ${lobby.facts}`);
  const hostCols = await host.evaluate(() => [...document.querySelectorAll('.lan-teams > section')].map((s) => s.getAttribute('aria-label')).join());
  check(hostCols === 'Captains', `Host sees one Captains column: ${hostCols}`);
  check((await host.locator('.lan-ai-step').count()) === 0, 'Rush lobby hides the AI steppers');
  await host.screenshot({ path: `${out}/lobby-host.jpg`, quality: 88 });
  await guest.screenshot({ path: `${out}/lobby-guest.jpg`, quality: 88 });

  await guest.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.waitForFunction(() => window.steel.net.client.lobby.members[1].ready);
  await host.getByRole('button', { name: 'Start battle', exact: true }).click();
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.steel.net.lan?.lockstep.played > 5)));

  // Every peer sinks wave 1 at the same turn, inside the sim step, then records a hash per tick.
  const sinkAt = (await host.evaluate(() => window.steel.net.lan.lockstep.played)) + 200;
  for (const p of pages)
    await p.evaluate((sinkAt) => {
      window.rushReview = { checkpoints: {} };
      const sim = window.steel.net.lan.sim;
      const apply = sim.applyTick.bind(sim);
      sim.applyTick = (turn, tick) => {
        const g = sim.game;
        if (turn.k === sinkAt && tick === 0) {
          for (const s of g.ships) if (s.alive && s.team === 1 && !s.isSummon) s.sink(g.rush.captains[0].ship);
          g.rush.queue.length = 0;
        }
        apply(turn, tick);
        window.rushReview.checkpoints[turn.k * 2 + tick] = sim.hash();
      };
    }, sinkAt);

  const own = await Promise.all(pages.map((p) => p.evaluate(() => ({ me: window.steel.battle.pcs[0].ship.humanIndex, captains: window.steel.battle.game.rush.captains.length, wavebox: !!document.querySelector('.wavebox'), bossbar: !!document.querySelector('.bossbar') }))));
  check(own[0].me === 0 && own[1].me === 1, `Each page sails its own captain: ${JSON.stringify(own)}`);
  check(own.every((o) => o.captains === 2 && o.wavebox && o.bossbar), `Both pages run a two-captain rush HUD: ${JSON.stringify(own)}`);
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.steel.battle.game.rush.wave === 1 && window.steel.battle.game.rush.phase === 'fight', undefined, { timeout: 20000 })));
  await host.screenshot({ path: `${out}/battle-host.jpg`, quality: 88 });
  await guest.screenshot({ path: `${out}/battle-guest.jpg`, quality: 88 });

  // The offer: each captain sees their own cards and picks one by its key.
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.steel.battle.game.rush.phase === 'offer' && document.querySelectorAll('.intermission .card').length === 3, undefined, { timeout: 20000 })));
  const offers = await Promise.all(pages.map((p) => p.evaluate(() => [...document.querySelectorAll('.intermission .card b')].map((b) => b.textContent))));
  const sim = await host.evaluate(() => window.steel.battle.game.rush.captains.map((c) => c.offer.map((u) => u.name)));
  check(JSON.stringify(offers) === JSON.stringify(sim), `Each page shows its own captain's cards: ${JSON.stringify({ offers, sim })}`);
  // The view holds the mouse in battle, so the cards go by their number keys, as their hints say.
  await host.keyboard.press('Digit1');
  await host.waitForFunction(() => document.querySelector('.intermission .waiting')?.textContent === 'Waiting for 1 captain…');
  await host.screenshot({ path: `${out}/intermission-waiting.jpg`, quality: 88 });
  await guest.screenshot({ path: `${out}/intermission-guest-cards.jpg`, quality: 88 });
  check((await guest.evaluate(() => window.steel.battle.game.rush.phase)) === 'offer', 'The offer waits for the second captain');
  await guest.keyboard.press('Digit3');
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.steel.battle.game.rush.wave === 2, undefined, { timeout: 20000 })));
  const taken = await Promise.all(pages.map((p) => p.evaluate(() => window.steel.battle.game.rush.captains.map((c) => c.taken))));
  check(JSON.stringify(taken[0]) === JSON.stringify(taken[1]), `Both peers agree on the refits: ${JSON.stringify(taken)}`);
  check(taken[0][0].length === 1 && taken[0][1].length === 1, `Each captain took one refit: ${JSON.stringify(taken)}`);

  await host.waitForFunction(() => Object.keys(window.rushReview.checkpoints).length > 600, undefined, { timeout: 30000 });
  const hashes = await Promise.all(pages.map((p) => p.evaluate(() => window.rushReview.checkpoints)));
  const common = Object.keys(hashes[0]).filter((k) => hashes[1][k] !== undefined);
  const differ = common.filter((k) => hashes[0][k] !== hashes[1][k]);
  check(common.length > 90 && differ.length === 0, `LAN checkpoints: ${common.length} common, ${differ.length} differ`);

  // The host ends the run: a result for everyone, and no solo record written.
  await host.evaluate(() => window.steel.net.client.send({ t: 'end' }));
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.steel.battle.game.over, undefined, { timeout: 10000 })));
  const ended = await Promise.all(pages.map((p) => p.evaluate(() => ({ reason: window.steel.battle.game.reason, records: Object.keys(localStorage).filter((k) => k.startsWith('steel-tide:bossrush') || k.startsWith('steel-tide:survival')) }))));
  check(ended.every((e) => e.reason === 'Run ended on wave 2'), `Run ended: ${JSON.stringify(ended)}`);
  check(ended.every((e) => e.records.length === 0), `A LAN run keeps no solo records: ${JSON.stringify(ended)}`);
  // The report opens a moment after the end and counts its numbers up.
  await host.waitForTimeout(6000);
  await host.screenshot({ path: `${out}/report-host.jpg`, quality: 88 });
  await guest.screenshot({ path: `${out}/report-guest.jpg`, quality: 88 });
  check(errors.length === 0, errors.join('\n'));
  const result = { lobby, own, offers, taken: taken[0], matchingTicks: common.length, ended, errors };
  writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ matchingTicks: common.length, taken: taken[0], reason: ended[0].reason }));
} finally {
  for (const p of pages) {
    try {
      await p.evaluate(() => window.steel?.net.client?.close());
    } catch {}
  }
  await browser.close();
}
