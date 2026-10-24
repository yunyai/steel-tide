import { describe, expect, it } from 'vitest';
import { BATTLE_TIME_LIMIT, RESPAWN_DELAY } from '../src/config';
import { buildRoster, type BattleConfig, type PlayerConfig } from '../src/core/BattleSetup';
import { Game } from '../src/core/Game';
import { makeRng } from '../src/core/math';
import { run } from './helpers';

// Free play: set AI counts per fleet, unlimited respawns, and changing ship between lives.

function freeConfig(ai: [number, number], players: PlayerConfig[] = captains()): BattleConfig {
  return { mode: 'lan', type: 'freeplay', mapId: 'open', teamSize: 1, ai, difficulty: 'normal', seed: 9, players };
}

function captains(a = 'yamato', b = 'fletcher'): PlayerConfig[] {
  return [
    { shipId: a, device: 'mouse', team: 0, name: 'Ana' },
    { shipId: b, device: 'mouse', team: 1, name: 'Ben' },
  ];
}

const side = (g: { team: number }[], t: number) => g.filter((r) => r.team === t);

describe('AI ships per fleet', () => {
  it('builds exactly the captains plus the AI ships asked for', () => {
    const none = buildRoster(freeConfig([0, 0]), makeRng(1));
    expect(none.map((r) => r.name)).toEqual(['Ana', 'Ben']);
    const some = buildRoster(freeConfig([2, 3]), makeRng(1));
    expect(side(some, 0).length).toBe(3);
    expect(side(some, 1).length).toBe(4);
    expect(some.filter((r) => r.humanIndex < 0).length).toBe(5);
  });

  it('answers a titan only in a fleet that has AI ships', () => {
    const titan = captains('leviathan');
    expect(side(buildRoster(freeConfig([0, 0], titan), makeRng(2)), 1).length).toBe(1);
    expect(side(buildRoster(freeConfig([0, 1], titan), makeRng(2)), 1).length).toBe(1 + 1 + 2);
    // The titan's own fleet is untouched.
    expect(side(buildRoster(freeConfig([0, 1], titan), makeRng(2)), 0).length).toBe(1);
  });

  it('works for any battle type, solo too', () => {
    const solo: BattleConfig = { mode: 'solo', type: 'freeplay', mapId: 'open', teamSize: 6, ai: [0, 0], difficulty: 'normal', seed: 3, players: [{ shipId: 'yamato', device: 'mouse' }] };
    const g = new Game(solo);
    expect(g.fleet.length).toBe(1);
    run(g, 1);
    expect(g.over).toBe(false);
    const ann = new Game({ ...freeConfig([1, 4]), type: 'annihilation' });
    expect(side(ann.fleet, 0).length).toBe(2);
    expect(side(ann.fleet, 1).length).toBe(5);
  });
});

describe('free play', () => {
  it('brings every sunk ship back, keeps count of kills, and never ends by itself', () => {
    const g = new Game(freeConfig([0, 0]));
    const [ana, ben] = g.humans();
    for (let i = 0; i < 3; i++) {
      ana.takeDamage(ana.maxHp * 5, ben);
      expect(ana.alive).toBe(false);
      expect(g.over).toBe(false);
      expect(g.respawnIn(ana)).toBeCloseTo(RESPAWN_DELAY, 1);
      run(g, RESPAWN_DELAY + 0.2);
      expect(ana.alive).toBe(true);
      // Clear of the spawn shield before the next blow.
      run(g, 4);
    }
    expect(ana.stats.deaths).toBe(3);
    expect(ben.stats.kills).toBe(3);
    expect(g.score).toEqual([0, 3]);
    g.time = BATTLE_TIME_LIMIT + 1;
    run(g, 0.1);
    expect(g.over).toBe(false);
  });

  it('a pick sails from the next respawn: a new hull in the same place, same captain and stats', () => {
    const g = new Game(freeConfig([1, 1]));
    const [ana, ben] = g.humans();
    const at = g.fleet.indexOf(ana);
    ana.stats.damage = 1234;
    g.pickShip(ana, 'fletcher');
    // Hidden hulls and junk ids are refused.
    g.pickShip(ana, 'skeletalGalleon');
    g.pickShip(ana, 'constructor');
    expect(ana.nextSpec?.id).toBe('fletcher');
    run(g, 1);
    expect(ana.alive).toBe(true);

    let changed: { old: unknown; ship: unknown } | null = null;
    g.events.on('shipChanged', (e) => (changed = e));
    ana.takeDamage(ana.maxHp * 5, ben);
    run(g, RESPAWN_DELAY + 0.2);
    const now = g.humans()[0];
    expect(now).not.toBe(ana);
    expect(changed!.old).toBe(ana);
    expect(changed!.ship).toBe(now);
    expect(now.spec.id).toBe('fletcher');
    expect(now.alive).toBe(true);
    expect([now.humanIndex, now.team, now.name]).toEqual([0, 0, 'Ana']);
    expect(now.stats).toBe(ana.stats);
    expect(now.stats.damage).toBe(1234);
    expect(now.stats.deaths).toBe(1);
    expect(now.nextSpec).toBe(null);
    expect(g.fleet.indexOf(now)).toBe(at);
    expect(g.fleet.length).toBe(4);
    expect(g.ai.has(now)).toBe(false);
    // The old hull leaves the sea and is cleared with the wrecks.
    expect(ana.humanIndex).toBe(-1);
    expect(ana.withdrawn).toBe(true);
    run(g, 41);
    expect(g.ships.includes(ana)).toBe(false);

    // Picking the ship you sail clears a pick.
    g.pickShip(now, 'yamato');
    g.pickShip(now, 'fletcher');
    expect(now.nextSpec).toBe(null);
  });

  it('switch now: the ship leaves at once and is back in the new one after the delay, not counted as sunk', () => {
    const g = new Game(freeConfig([0, 0]));
    const ana = g.humans()[0];
    g.pickShip(ana, 'iowa');
    g.redeploy(ana);
    expect(ana.alive).toBe(false);
    expect(ana.withdrawn).toBe(true);
    run(g, RESPAWN_DELAY - 0.5);
    expect(g.humans()[0]).toBe(ana);
    run(g, 0.7);
    const now = g.humans()[0];
    expect(now.spec.id).toBe('iowa');
    expect(now.alive).toBe(true);
    expect(now.stats.deaths).toBe(0);
    expect(g.score).toEqual([0, 0]);
    // Only once, and not while sunk.
    g.redeploy(now);
    g.redeploy(now);
    expect(g.respawns.length).toBe(1);
  });

  it('a captain on autopilot changes ship under the AI, and bots respawn as they were', () => {
    const g = new Game(freeConfig([1, 0]));
    const ana = g.humans()[0];
    const bot = g.fleet.find((s) => s.humanIndex < 0)!;
    g.handToAI(ana);
    g.pickShip(ana, 'gato');
    g.redeploy(ana);
    bot.takeDamage(bot.maxHp * 5, null);
    run(g, RESPAWN_DELAY + 0.2);
    const now = g.humans()[0];
    expect(now.spec.id).toBe('gato');
    expect(now.autopilot).toBe(true);
    expect(g.ai.has(now)).toBe(true);
    expect(bot.alive).toBe(true);
    expect(g.ai.has(bot)).toBe(true);
  });

  it('ship changes are for free play only', () => {
    const g = new Game({ ...freeConfig([1, 1]), type: 'domination' });
    const ana = g.humans()[0];
    g.pickShip(ana, 'fletcher');
    g.redeploy(ana);
    expect(ana.nextSpec).toBe(null);
    expect(ana.alive).toBe(true);
  });
});
