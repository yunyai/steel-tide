import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.env.VECTOR_LAN_OUT ?? 'docs/verification/vector-neon-battery/lan';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }), pages = [], errors = [];
const url = process.env.STEEL_URL ?? 'http://127.0.0.1:5198';
try {
  for (let i = 0; i < 2; i++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); pages.push(page);
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url); await page.waitForFunction(() => window.steel);
    await page.getByRole('button', { name: /^LAN battle/ }).click();
    await page.waitForFunction(() => window.steel.net.client?.id);
  }
  const [host, guest] = pages;
  await host.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await host.waitForFunction(() => window.steel.net.client?.lobby);
  const lobby = await host.evaluate(() => window.steel.net.client.lobby.id);
  await host.evaluate(async () => {
    const { defaultLoadout } = await import('/src/data/architectLoadout.ts'), loadout = defaultLoadout();
    loadout[0] = { type: 'vector', skill: 0 }; loadout[1] = { type: 'vector', skill: 1 };
    const client = window.steel.net.client;
    client.send({ t: 'settings', s: { era: 'mixed', type: 'freeplay', mapId: 'open', titans: true, ai: [0, 0] } });
    client.send({ t: 'me', shipId: 'architect', team: 0, architectLoadout: loadout });
  });
  await guest.evaluate(id => window.steel.net.client.send({ t: 'join', lobby: id }), lobby);
  await guest.waitForFunction(() => window.steel.net.client?.lobby?.members.length === 2);
  await guest.evaluate(() => window.steel.net.client.send({ t: 'me', shipId: 'iowa', team: 1, ready: true }));
  await host.waitForFunction(() => window.steel.net.client.lobby.members.some(m => m.team === 1 && m.ready));
  await host.getByRole('button', { name: 'Start battle', exact: true }).click();
  await Promise.all(pages.map(page => page.waitForFunction(() => window.steel.net.lan?.lockstep.played > 5)));
  const install = page => page.evaluate(() => {
    const battle = window.steel.battle; battle.setPaused(true); battle.setOverlay(null); battle.shell.input.onLockChange = null;
    const review = window.vectorLanReview = { checkpoints: {}, casts: [] }, sim = window.steel.net.lan.sim, apply = sim.applyTick.bind(sim);
    sim.applyTick = (turn, tick) => {
      apply(turn, tick);
      const s = sim.ship(0), k = turn.k * 2 + tick;
      review.checkpoints[k] = { hash: sim.hash(), charges: s.vectorMobility.dashCharges, rechargeAt: s.vectorMobility.dashRechargeAt, mobileUntil: s.vectorMobility.mobileUntil, mobileReadyAt: s.vectorMobility.mobileReadyAt, x: s.pos.x, z: s.pos.z };
      for (const [player, edgeTick, edge] of turn.e ?? []) if (player === 0 && edgeTick === tick && (edge.hd || edge.mb || edge.co !== undefined)) review.casts.push({ k, edge, dashActive: !!s.architect.drive, ...review.checkpoints[k] });
    };
  });
  await Promise.all(pages.map(install));
  const initial = await host.evaluate(() => { const b = window.steel.battle, s = b.pcs[0].ship; return { position: { x: s.pos.x, z: s.pos.z }, status: s.getVectorMobilityStatus(), search: { charges: s.consumables[1].charges, cooldown: s.consumables[1].cooldown } }; });
  if (!initial.status.unlocked || initial.status.hullDash.charges !== 2) throw Error(JSON.stringify(initial));
  const key = async code => host.evaluate(code => {
    const b = window.steel.battle, pc = b.pcs[0], s = pc.ship, input = b.shell.input;
    pc.aim.set(s.pos.x + Math.sin(s.heading) * 2000, 0, s.pos.z - Math.cos(s.heading) * 2000);
    window.dispatchEvent(new KeyboardEvent('keydown', { code })); pc.control(1 / 60, input); input.endFrame(); window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }, code);
  await key('KeyH'); await host.waitForFunction(() => window.vectorLanReview.casts.some(c => c.edge.hd && c.dashActive && c.charges === 1));
  // Mobile Battery needs a deployed platform: Deploy (Q) through the same lockstep edges first.
  await key('KeyQ'); await host.waitForFunction(() => window.steel.battle.pcs[0].ship.architect.slots.some(a => a.state === 'deployed'));
  await key('KeyJ'); await host.waitForFunction(() => window.vectorLanReview.casts.some(c => c.edge.mb && c.mobileUntil > 0 && c.mobileReadyAt > 0));
  await key('KeyG'); await host.waitForFunction(() => window.vectorLanReview.casts.some(c => c.edge.co === 1));
  await Promise.all(pages.map(page => page.waitForFunction(() => window.vectorLanReview.casts.length >= 3)));
  const beforeReplay = await host.evaluate(() => {
    const s = window.steel.battle.pcs[0].ship;
    return { vector: { ...s.vectorMobility }, loadout: s.architectLoadout, search: { charges: s.consumables[1].charges, active: s.consumables[1].active }, casts: window.vectorLanReview.casts };
  });
  if (beforeReplay.search.charges !== initial.search.charges - 1 || beforeReplay.search.active <= 0) throw Error('Search did not remain independently usable');
  const compare = (a, b) => {
    const common = Object.keys(a).filter(k => b[k] !== undefined);
    if (common.length < 20 || common.some(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]))) throw Error(`Checkpoint divergence: ${common.length} shared ticks`);
    return common.length;
  };
  await host.waitForFunction(() => Object.keys(window.vectorLanReview.checkpoints).length > 60);
  const finalLedgers = await Promise.all(pages.map(page => page.evaluate(() => window.vectorLanReview.checkpoints)));
  const matchingTicks = compare(finalLedgers[0], finalLedgers[1]);
  await host.screenshot({ path: `${out}/two-peer-after-actions-1280.jpg`, quality: 88 });
  await host.evaluate(() => { window.beforeVectorReplay = window.steel.net.lan; window.steel.net.lan.awaitingLog = true; window.steel.net.client.send({ t: 'resync' }); });
  await host.waitForFunction(() => window.steel.net.lan !== window.beforeVectorReplay && !window.steel.net.lan.replaying && window.steel.net.lan.view);
  const replay = await host.evaluate(() => {
    const s = window.steel.battle.pcs[0].ship;
    return { vector: { ...s.vectorMobility }, loadout: s.architectLoadout, searchCharges: s.consumables[1].charges, turns: window.steel.net.lan.lockstep.played };
  });
  for (const field of ['dashRechargeAt', 'mobileUntil', 'mobileReadyAt', 'mobileDuration']) if (replay.vector[field] !== beforeReplay.vector[field]) throw Error(`Replay lost ${field}`);
  if (JSON.stringify(replay.loadout) !== JSON.stringify(beforeReplay.loadout) || replay.searchCharges !== beforeReplay.search.charges) throw Error('Replay lost independent action state');
  await install(host); await host.waitForFunction(() => Object.keys(window.vectorLanReview.checkpoints).length > 90);
  const postReplayLedgers = await Promise.all(pages.map(page => page.evaluate(() => window.vectorLanReview.checkpoints)));
  const replayMatchingTicks = compare(postReplayLedgers[0], postReplayLedgers[1]);
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(`${out}/results.json`, JSON.stringify({ initial, beforeReplay, replay, matchingTicks, replayMatchingTicks, errors }, null, 2));
  console.log(JSON.stringify({ matchingTicks, replayMatchingTicks, replayTurns: replay.turns, casts: beforeReplay.casts.map(c => c.edge), errors }));
  await host.evaluate(() => window.steel.net.client.send({ t: 'end' }));
} finally {
  for (const page of pages) { try { await page.evaluate(() => window.steel?.net.client?.close()); } catch {} }
  await browser.close();
}
