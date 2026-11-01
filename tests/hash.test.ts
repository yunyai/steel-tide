import { describe, expect, it } from 'vitest';
import { diffSections, hashSections, stateHash } from '../src/net/hash';
import { emptyGame, place, run } from './helpers';
import type { Game } from '../src/core/Game';

// LAN peers compare this fingerprint; anything it skips can drift unseen until it moves a hull.

function duel(): Game {
  const g = emptyGame();
  const a = place(g, 'iowa', 0, 0, 0);
  const b = place(g, 'yamato', 1, 0, -9000);
  a.control.aimX = b.pos.x;
  a.control.aimZ = b.pos.z;
  return g;
}

function salvo(g: Game): void {
  const a = g.ships[0];
  a.control.fire = true;
  for (let i = 0; i < 600 && !g.shells.shells.length; i++) run(g, 1 / 60);
  a.control.fire = false;
  expect(g.shells.shells.length).toBeGreaterThan(0);
}

describe('battle fingerprint', () => {
  it('changes when only the random stream moves on', () => {
    const g = duel();
    const before = stateHash(g);
    g.rng();
    expect(stateHash(g)).not.toBe(before);
  });

  it("changes with a regular ship's consumable charges and skill cooldowns", () => {
    const g = duel();
    const s = g.ships[0];
    const before = stateHash(g);
    s.consumables[0].charges -= 1;
    const spent = stateHash(g);
    expect(spent).not.toBe(before);
    s.skills[0].cooldown += 1;
    expect(stateHash(g)).not.toBe(spent);
  });

  it('changes with a gun reload or the throttle', () => {
    const g = duel();
    const s = g.ships[0];
    const before = stateHash(g);
    s.turrets[0].reload += 0.5;
    const reloading = stateHash(g);
    expect(reloading).not.toBe(before);
    s.throttle += 1;
    expect(stateHash(g)).not.toBe(reloading);
  });

  it('changes when a single plain shell moves', () => {
    const g = duel();
    salvo(g);
    const before = stateHash(g);
    g.shells.shells[0].x += 0.001;
    expect(stateHash(g)).not.toBe(before);
  });

  it('names the sections two peers disagree on', () => {
    const g = duel();
    salvo(g);
    const mine = hashSections(g);
    g.ships[1].hp -= 1;
    g.shells.shells[0].z += 1;
    const theirs = hashSections(g);
    expect(diffSections(mine, theirs)).toEqual([`s${g.ships[1].id}`, 'shells']);
    expect(diffSections(mine, mine)).toEqual([]);
  });

  it('folds its sections into the fingerprint', () => {
    const g = duel();
    const sections = hashSections(g);
    expect(sections.map(([name]) => name)).toEqual(expect.arrayContaining(['core', 'mode', 'world', 'shells', 'torps', 'missiles', 'air', `s${g.ships[0].id}`]));
    expect(sections.every(([, h]) => Number.isInteger(h) && h >= 0 && h <= 0xffffffff)).toBe(true);
  });

  it('fingerprints a crowded battle in well under the frame budget', () => {
    const g = emptyGame();
    for (let i = 0; i < 32; i++) place(g, i % 2 ? 'iowa' : 'yamato', (i % 2) as 0 | 1, (i % 8) * 900, Math.floor(i / 8) * 2500 - 4000);
    g.ships[0].control.aimX = g.ships[1].pos.x;
    g.ships[0].control.aimZ = g.ships[1].pos.z;
    salvo(g);
    const shell = g.shells.shells[0];
    while (g.shells.shells.length < 500) g.shells.shells.push({ ...shell, x: shell.x + g.shells.shells.length });
    stateHash(g);
    // Best of several batches: the cost of the hash itself, not of whatever else the machine is running.
    let best = Infinity;
    for (let batch = 0; batch < 6; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) stateHash(g);
      best = Math.min(best, (performance.now() - t0) / 5);
    }
    expect(best).toBeLessThan(2);
  });
});

describe('fingerprint values', () => {
  it('treats -0 like 0, as JSON turns do', () => {
    const g = duel();
    g.ships[0].control.rudder = 0;
    const zero = stateHash(g);
    g.ships[0].control.rudder = -0;
    expect(stateHash(g)).toBe(zero);
  });
});
