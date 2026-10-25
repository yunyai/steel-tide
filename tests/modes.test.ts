import { describe, expect, it } from 'vitest';
import { KILL_HEAL, KILL_HEAL_TITAN, MAP_HALF, RESPAWN_DELAY, SPAWN_LINE } from '../src/config';
import { buildRoster, spawnOffset, type BattleConfig } from '../src/core/BattleSetup';
import { makeRng } from '../src/core/math';
import type { BattleEra } from '../src/core/types';
import { eraOf } from '../src/data/factions';
import { LINE_ERAS, SHIP_BY_ID, bossesOf, shipsOf } from '../src/data/ships';
import { Game } from '../src/core/Game';
import { emptyGame, place, run } from './helpers';

describe('respawn', () => {
  it('Domination brings a sunk ship back on its spawn line after the delay, fresh but with its record', () => {
    const g = emptyGame('open', 7, 'domination');
    const me = place(g, 'fletcher', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 2000, 0);
    me.stats.damage = 12345;
    me.skills[0].cooldown = 10;
    me.meter = 0.6;
    run(g, 0.1);
    me.takeDamage(me.maxHp * 2, foe);
    expect(me.alive).toBe(false);
    expect(me.stats.deaths).toBe(1);
    expect(g.respawnIn(me)).toBeCloseTo(RESPAWN_DELAY, 0);
    run(g, RESPAWN_DELAY - 0.5);
    expect(me.alive).toBe(false);
    run(g, 1);
    expect(me.alive).toBe(true);
    expect(me.hp).toBe(me.maxHp);
    expect(me.stats.damage).toBe(12345);
    expect(me.skills[0].cooldown).toBeLessThanOrEqual(0);
    expect(me.meter).toBeGreaterThanOrEqual(0.6);
    expect(me.pos.x).toBeLessThan(-MAP_HALF * SPAWN_LINE * 0.8);
    expect(g.respawnIn(me)).toBe(-1);
    // Untouchable for a moment after arriving.
    expect(me.takeDamage(1000, foe)).toBe(0);
    run(g, 3);
    expect(me.takeDamage(1000, foe)).toBeGreaterThan(0);
  });

  it('Domination is not won by sinking everything once', () => {
    const g = emptyGame('open', 7, 'domination');
    place(g, 'fletcher', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 2000, 0);
    run(g, 0.1);
    foe.sink(null);
    run(g, 1);
    expect(g.over).toBe(false);
  });

  it('other battles stay one life', () => {
    const g = emptyGame();
    const me = place(g, 'fletcher', 0, 0, 0);
    place(g, 'iowa', 1, 2000, 0);
    place(g, 'iowa', 1, 2000, 800);
    run(g, 0.1);
    me.sink(null);
    expect(g.respawnIn(me)).toBe(-1);
    run(g, RESPAWN_DELAY + 1);
    expect(me.alive).toBe(false);
  });
});

describe('kill rewards', () => {
  it('a kill halves the cooldowns left and repairs the killer', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    place(g, 'fletcher', 1, 2000, 800);
    run(g, 0.1);
    me.skills[0].cooldown = 20;
    me.hp = me.maxHp * 0.5;
    foe.takeDamage(foe.maxHp * 2, me);
    expect(me.skills[0].cooldown).toBeCloseTo(10);
    expect(me.hp / me.maxHp).toBeCloseTo(0.5 + KILL_HEAL);
  });

  it('a titan repairs less from a kill', () => {
    const g = emptyGame();
    const me = place(g, 'raijin', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 2000, 0);
    place(g, 'fletcher', 1, 2000, 800);
    run(g, 0.1);
    me.hp = me.maxHp * 0.5;
    foe.takeDamage(foe.maxHp * 2, me);
    expect(me.hp / me.maxHp).toBeCloseTo(0.5 + KILL_HEAL_TITAN);
  });

  it('battles open fast: the fleets start closer and already under way', () => {
    const g = new Game({ ...emptyGame().config, teamSize: 4 });
    for (const s of g.fleet) {
      expect(Math.abs(s.pos.x) + spawnOffset(s.spec)).toBeCloseTo(MAP_HALF * SPAWN_LINE);
      expect(s.speed).toBeCloseTo(s.maxSpeed * 0.75);
    }
  });
});

function convoyGame(side: 'escort' | 'raid'): Game {
  const g = new Game({ ...emptyGame().config, type: 'convoy', teamSize: 3, convoySide: side });
  // Nobody fights: only the convoy director moves ships.
  g.ai.clear();
  return g;
}

describe('convoy', () => {
  it('four transports sail for the escort and work their way along the route', () => {
    const g = convoyGame('escort');
    const cv = g.convoy!;
    expect(cv.team).toBe(0);
    expect(cv.transports.length).toBe(4);
    expect(cv.transports.every((s) => s.team === 0 && s.spec.cls === 'AK')).toBe(true);
    // Cargo ships are not part of either fleet's roster.
    expect(g.fleet.some((s) => s.spec.cls === 'AK')).toBe(false);
    const first = cv.route[0];
    const before = cv.transports.map((s) => Math.hypot(s.pos.x - first.x, s.pos.z - first.z));
    run(g, 40);
    cv.transports.forEach((s, i) => {
      expect(s.alive).toBe(true);
      expect(Math.hypot(s.pos.x - first.x, s.pos.z - first.z)).toBeLessThan(before[i] - 300);
    });
  });

  it('the escort wins when two transports reach port', () => {
    const g = convoyGame('escort');
    const cv = g.convoy!;
    let arrived = 0;
    g.events.on('convoy', (e) => {
      if (e.kind === 'arrived') arrived++;
    });
    for (const s of cv.transports.slice(0, 2)) {
      for (const wp of cv.route) {
        s.pos.x = wp.x;
        s.pos.z = wp.z;
        run(g, 2 / 60);
      }
    }
    run(g, 0.1);
    expect(arrived).toBe(2);
    expect(cv.arrived).toBe(2);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });

  it('raiders win by sinking three transports', () => {
    const g = convoyGame('raid');
    const cv = g.convoy!;
    expect(cv.team).toBe(1);
    const me = g.fleet.find((s) => s.humanIndex === 0)!;
    expect(me.team).toBe(0);
    cv.transports.slice(0, 2).forEach((s) => s.sink(me));
    run(g, 0.1);
    expect(g.over).toBe(false);
    cv.transports[2].sink(me);
    run(g, 0.1);
    expect(cv.sunk).toBe(3);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });

  it('raider AI goes for the cargo', () => {
    const g = new Game({ ...emptyGame().config, type: 'convoy', teamSize: 3, convoySide: 'escort' });
    const raider = g.fleet.find((s) => s.team === 1)!;
    const ai = g.ai.get(raider)!;
    const cargo = g.convoy!.transports[0];
    const escort = g.fleet.find((s) => s.team === 0)!;
    // The cargo ship a little further off still beats the warship.
    raider.pos.set(0, 0, 0);
    escort.pos.set(2000, 0, 0);
    cargo.pos.set(-2600, 0, 0);
    run(g, 1);
    expect(ai.target).toBe(cargo);
  });
});

function survivalGame(): Game {
  return new Game({ ...emptyGame().config, type: 'survival', escorts: 0, seed: 11 });
}

describe('survival', () => {
  it('sends no titans and keeps sending waves past the Boss Rush finish', () => {
    const g = survivalGame();
    const r = g.rush!;
    expect(r.survival).toBe(true);
    run(g, 5);
    const firstWave = g.ships.filter((s) => s.team === 1 && s.alive).length;
    for (let w = 1; w <= 16; w++) {
      expect(r.wave).toBe(w);
      expect(g.ships.some((s) => s.team === 1 && s.alive && s.spec.cls === 'TT')).toBe(false);
      expect(r.boss).toBeNull();
      for (const s of g.ships) if (s.team === 1 && s.alive) s.sink(r.player);
      run(g, 0.1);
      expect(r.phase).toBe('offer');
      expect(r.choose(0)).toBe(true);
      run(g, 5);
    }
    expect(r.wave).toBe(17);
    expect(r.cleared).toBe(false);
    expect(g.over).toBe(false);
    expect(g.ships.filter((s) => s.team === 1 && s.alive).length).toBeGreaterThan(firstWave);
  });

  it('ends when the player sinks, counting the waves held', () => {
    const g = survivalGame();
    run(g, 5);
    const p = g.rush!.player!;
    p.takeDamage(p.hp + 1, null);
    run(g, 0.1);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(1);
  });
});

describe('eras', () => {
  // Battle eras: those with line ships (Misc holds only a titan and sails in Mixed battles).
  const live = LINE_ERAS;
  const battle = (era: BattleEra, type: BattleConfig['type'] = 'annihilation', shipId = shipsOf(live[0])[0].id): BattleConfig => ({
    mode: 'solo',
    type,
    mapId: 'open',
    teamSize: 8,
    difficulty: 'normal',
    players: [{ shipId, device: 'mouse' }],
    seed: 5,
    escorts: 2,
    era,
  });

  it('bots sail ships of the battle era, never a hidden or titan hull', () => {
    for (const era of live) {
      for (let seed = 1; seed <= 4; seed++) {
        const roster = buildRoster({ ...battle(era, 'annihilation', shipsOf(era)[0].id), seed }, makeRng(seed));
        for (const r of roster.filter((x) => x.humanIndex < 0)) {
          expect(eraOf(r.spec), `${era} ${r.spec.id}`).toBe(era);
          expect(r.spec.hidden).toBeFalsy();
          expect(r.spec.cls).not.toBe('TT');
        }
      }
    }
  });

  it('a mixed battle draws from every era with ships', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) for (const r of buildRoster({ ...battle('mixed'), seed }, makeRng(seed))) seen.add(eraOf(r.spec));
    expect(seen.size).toBe(live.length);
  });

  it('a battle with no era set is a historic one', () => {
    const config = battle('historic');
    delete config.era;
    for (const r of buildRoster(config, makeRng(2))) expect(eraOf(r.spec)).toBe('historic');
  });

  it('Boss Rush sends the era\'s titans (in Anime, its Titan Shift forms)', () => {
    for (const era of live) {
      const g = new Game({ ...battle(era, 'bossrush', shipsOf(era)[0].id), teamSize: 1, escorts: 0 });
      const r = g.rush!;
      run(g, 5);
      for (let w = 1; w < 5; w++) {
        for (const s of g.ships) if (s.team === 1 && s.alive) s.sink(r.player);
        run(g, 0.1);
        r.choose(0);
        run(g, 5);
      }
      expect(r.wave).toBe(5);
      expect(bossesOf(era)).toContain(SHIP_BY_ID[r.boss!.spec.id]);
    }
  });
});
