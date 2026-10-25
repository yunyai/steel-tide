import { describe, expect, it } from 'vitest';
import { buildRoster, type BattleConfig } from '../src/core/BattleSetup';
import { Game } from '../src/core/Game';
import { makeRng } from '../src/core/math';
import { stateHash } from '../src/net/hash';
import { TurnApplier } from '../src/net/navalTurns';
import { type Continuous, type Edge, type Turn, TURN_TICKS } from '../src/net/protocol';

// Lockstep only works if two peers fed the same turns step the same battle, bit for bit.

function lanConfig(type: BattleConfig['type'], seed = 11): BattleConfig {
  return {
    mode: 'lan',
    type,
    mapId: type === 'convoy' ? 'archipelago' : 'strait',
    teamSize: 4,
    difficulty: 'normal',
    seed,
    convoySide: 'escort',
    players: [
      { shipId: 'yamato', device: 'mouse', team: 0, name: 'Ana' },
      { shipId: 'shimakaze', device: 'mouse', team: 1, name: 'Ben' },
      { shipId: 'atlanta', device: 'mouse', team: 1, name: 'Cy' },
    ],
  };
}

/** A captain's orders as a scripted stream: weaving, aiming at the nearest enemy, skills now and then. */
function script(g: Game, seconds: number, seed = 3): Turn[] {
  const rng = makeRng(seed);
  const turns: Turn[] = [];
  const n = Math.round((seconds * 60) / TURN_TICKS);
  for (let k = 0; k < n; k++) {
    const t: Turn = { k };
    if (k % 6 === 0) {
      t.p = [0, 1, 2].map((p): [number, Continuous] => {
        const own = g.fleet.find((s) => s.humanIndex === p)!;
        const foe = g.fleet.find((s) => s.team !== own.team)!;
        return [p, [Math.round((rng() * 2 - 1) * 2) / 2, foe.pos.x + (rng() - 0.5) * 300, foe.pos.z + (rng() - 0.5) * 300, rng() < 0.7 ? 1 : 0, -1]];
      });
    }
    if (k % 45 === 7) t.e = [[k % 3, 1, { sk: k % 2 }], [(k + 1) % 3, 0, { tu: 1 }]];
    if (k % 140 === 70) t.e = [...(t.e ?? []), [2, 0, { co: 0 }], [1, 1, { sl: 1 }]];
    turns.push(t);
  }
  return turns;
}

function play(config: BattleConfig, turns: Turn[], every = 60): number[] {
  const g = new Game(config);
  const a = new TurnApplier(g);
  const hashes: number[] = [];
  for (const t of turns) {
    for (let i = 0; i < TURN_TICKS; i++) a.applyTick(t, i);
    if ((t.k + 1) % every === 0) hashes.push(stateHash(g));
  }
  return hashes;
}

describe('lockstep determinism', () => {
  for (const type of ['domination', 'annihilation', 'convoy'] as const) {
    it(`two peers of a ${type} battle stay identical for four minutes`, () => {
      const config = lanConfig(type);
      // The orders reference live positions, so script them once against a throwaway battle.
      const turns = script(new Game(config), 240);
      const a = play(config, turns);
      const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
      expect(a.length).toBe(120);
      expect(b).toEqual(a);
      // The battle did something: hashes move.
      expect(new Set(a).size).toBeGreaterThan(100);
    }, 120000);
  }

  it('two peers of a mixed-era battle stay identical', () => {
    const config: BattleConfig = { ...lanConfig('domination', 17), era: 'mixed', teamSize: 6 };
    const turns = script(new Game(config), 120);
    const a = play(config, turns);
    const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
    expect(b).toEqual(a);
  }, 120000);

  it('two peers of a modern battle stay identical (missiles, summons and cells)', () => {
    const base = lanConfig('domination', 23);
    const ships = ['arsenal', 'sovremenny', 'fujian'];
    const config: BattleConfig = { ...base, era: 'modern', teamSize: 6, players: base.players.map((p, i) => ({ ...p, shipId: ships[i] })) };
    const turns = script(new Game(config), 120);
    const a = play(config, turns);
    const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
    expect(b).toEqual(a);
  }, 120000);

  it('two peers of a mixed-era titan battle stay identical (links, caps and rebuilt wrecks)', () => {
    const base = lanConfig('domination', 37);
    const ships = ['brokkr', 'vanguard', 'nuwa'];
    const config: BattleConfig = { ...base, era: 'mixed', teamSize: 6, players: base.players.map((p, i) => ({ ...p, shipId: ships[i] })) };
    const turns = script(new Game(config), 120);
    const a = play(config, turns);
    const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
    expect(b).toEqual(a);
  }, 120000);

  it('two peers of a sci-fi battle stay identical (blinks, swaps, fields and twins)', () => {
    const base = lanConfig('domination', 31);
    const ships = ['kunai', 'tiangong', 'oboro'];
    const config: BattleConfig = { ...base, era: 'scifi', teamSize: 6, players: base.players.map((p, i) => ({ ...p, shipId: ships[i] })) };
    const turns = script(new Game(config), 120);
    const a = play(config, turns);
    const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
    expect(b).toEqual(a);
  }, 120000);

  it('two peers of an anime battle stay identical (Titan Shifts, forms and reverts)', () => {
    const base = lanConfig('domination', 43);
    const ships = ['gojo', 'naruto', 'luffy'];
    const config: BattleConfig = { ...base, era: 'anime', teamSize: 6, players: base.players.map((p, i) => ({ ...p, shipId: ships[i] })) };
    const turns = script(new Game(config), 120);
    // Every captain calls the shift once the meter has had time to fill, then tries a form skill.
    const at = Math.round(turns.length * 0.87);
    for (let p = 0; p < 3; p++) {
      turns[at + p].e = [...(turns[at + p].e ?? []), [p, 0, { sk: 2 }]];
      turns[at + 20 + p].e = [...(turns[at + 20 + p].e ?? []), [p, 0, { sk: 3 }]];
    }
    const a = play(config, turns);
    const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
    expect(b).toEqual(a);

    const g = new Game(config);
    let shifts = 0;
    g.events.on('shift', (e) => {
      if (e.on) shifts++;
    });
    const ap = new TurnApplier(g);
    for (const t of turns) for (let i = 0; i < TURN_TICKS; i++) ap.applyTick(t, i);
    expect(shifts).toBeGreaterThan(0);
  }, 120000);

  it('two peers of an anime battle with the new kits stay identical (Rumbling, sub forms, petal wings)', () => {
    for (const [seed, ships] of [
      [47, ['eren', 'muzan', 'byakuya']],
      [53, ['itachi', 'megumi', 'tanjiro']],
    ] as const) {
      const base = lanConfig('domination', seed);
      const config: BattleConfig = { ...base, era: 'anime', teamSize: 8, players: base.players.map((p, i) => ({ ...p, shipId: ships[i] })) };
      const turns = script(new Game(config), 120);
      const at = Math.round(turns.length * 0.8);
      for (let p = 0; p < 3; p++) {
        turns[at + p].e = [...(turns[at + p].e ?? []), [p, 0, { sk: 2 }]];
        // A normal form skill, then the first form ultimate once it has had time to unlock.
        turns[at + 15 + p].e = [...(turns[at + 15 + p].e ?? []), [p, 0, { sk: 3 }]];
        turns[turns.length - 4 + p].e = [...(turns[turns.length - 4 + p].e ?? []), [p, 0, { sk: 6 }]];
      }
      const a = play(config, turns);
      const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
      expect(b, `seed ${seed}`).toEqual(a);

      const g = new Game(config);
      let shifts = 0;
      g.events.on('shift', (e) => {
        if (e.on) shifts++;
      });
      const ap = new TurnApplier(g);
      for (const t of turns) for (let i = 0; i < TURN_TICKS; i++) ap.applyTick(t, i);
      expect(shifts, `seed ${seed}`).toBeGreaterThan(0);
    }
  }, 240000);

  it('two peers of a Free play battle stay identical through ship changes and the host ending it', () => {
    const config: BattleConfig = { ...lanConfig('freeplay', 41), ai: [2, 1] };
    const turns = script(new Game(config), 120);
    const add = (k: number, e: [number, number, Edge]) => (turns[k].e = [...(turns[k].e ?? []), e]);
    // Ana switches at once, Ben picks for his next respawn, Cy switches twice.
    add(30, [0, 0, { sp: 'fletcher', rd: 1 }]);
    add(60, [1, 1, { sp: 'iowa' }]);
    add(90, [2, 0, { sp: 'gato', rd: 1 }]);
    add(900, [2, 1, { sp: 'desmoines', rd: 1 }]);
    turns[3300].ev = [{ end: 1 }];
    const a = play(config, turns);
    const b = play(structuredClone(config), JSON.parse(JSON.stringify(turns)) as Turn[]);
    expect(b).toEqual(a);

    const g = new Game(config);
    const ap = new TurnApplier(g);
    for (const t of turns) for (let i = 0; i < TURN_TICKS; i++) ap.applyTick(t, i);
    expect(ap.ship(0)!.spec.id).toBe('fletcher');
    expect(ap.ship(2)!.spec.id).toBe('desmoines');
    expect(g.humans().map((s) => s.humanIndex)).toEqual([0, 1, 2]);
    expect(g.over).toBe(true);
    expect(g.reason).toBe('The host ended free play');
    // The turns still steer the captain in the new hull.
    const last = [...turns].reverse().find((t) => t.p)!.p!.find(([p]) => p === 0)![1];
    expect(ap.ship(0)!.control.rudder).toBe(last[0]);
  }, 120000);

  it('an earlier battle in the same tab changes nothing (ids count per battle)', () => {
    const config = lanConfig('annihilation', 5);
    const turns = script(new Game(config), 30);
    const fresh = play(config, turns, 30);
    // Another battle that fires shells, launches planes and sinks ships first.
    play(lanConfig('domination', 99), script(new Game(lanConfig('domination', 99)), 40, 8));
    expect(play(config, turns, 30)).toEqual(fresh);
  });

  it('one edge triggers a skill exactly once', () => {
    const g = new Game(lanConfig('annihilation'));
    const a = new TurnApplier(g);
    const me = a.ship(0)!;
    let fired = 0;
    g.events.on('skill', (e) => e.ship === me && fired++);
    a.applyTick({ k: 0, e: [[0, 1, { sk: 0 }]] }, 0);
    expect(fired).toBe(0);
    a.applyTick({ k: 0, e: [[0, 1, { sk: 0 }]] }, 1);
    expect(fired).toBe(1);
    for (let k = 1; k < 30; k++) for (let i = 0; i < TURN_TICKS; i++) a.applyTick({ k }, i);
    expect(fired).toBe(1);
  });

  it('continuous orders hold until changed', () => {
    const g = new Game(lanConfig('annihilation'));
    const a = new TurnApplier(g);
    const me = a.ship(0)!;
    a.applyTick({ k: 0, p: [[0, [1, 100, 200, 1, -1]]] }, 0);
    for (let k = 1; k < 10; k++) for (let i = 0; i < TURN_TICKS; i++) a.applyTick({ k }, i);
    expect(me.control.rudder).toBe(1);
    expect(me.control.aimX).toBe(100);
    expect(me.control.fire).toBe(true);
  });

  it('a dropped captain is sailed by the AI and gets the helm back', () => {
    const g = new Game(lanConfig('domination'));
    const a = new TurnApplier(g);
    const ben = a.ship(1)!;
    a.applyTick({ k: 0, p: [[1, [0.5, 0, 0, 0, -1]]], ev: [{ ai: 1 }] }, 0);
    expect(ben.autopilot).toBe(true);
    expect(g.ai.has(ben)).toBe(true);
    for (let k = 1; k < 30; k++) for (let i = 0; i < TURN_TICKS; i++) a.applyTick({ k }, i);
    // The AI's orders, not the stale ones from the turn stream.
    expect(ben.control.rudder).not.toBe(0.5);
    a.applyTick({ k: 30, ev: [{ human: 1 }] }, 0);
    expect(ben.autopilot).toBe(false);
    expect(g.ai.has(ben)).toBe(false);
    a.applyTick({ k: 30 }, 1);
    expect(ben.control.rudder).toBe(0.5);
  });

  it('a sunk autopilot ship respawns under the AI in Domination', () => {
    const g = new Game(lanConfig('domination'));
    const a = new TurnApplier(g);
    const ben = a.ship(1)!;
    a.applyTick({ k: 0, ev: [{ ai: 1 }] }, 0);
    ben.takeDamage(ben.maxHp * 3, null);
    for (let k = 1; k < 300; k++) for (let i = 0; i < TURN_TICKS; i++) a.applyTick({ k }, i);
    expect(ben.alive).toBe(true);
    expect(g.ai.has(ben)).toBe(true);
  });
});

describe('LAN roster', () => {
  it('puts captains in their own fleets, grows a fleet to fit them, and answers titans on the other side', () => {
    const config = lanConfig('annihilation');
    config.teamSize = 2;
    config.players.push({ shipId: 'leviathan', device: 'mouse', team: 1, name: 'Dee' });
    const roster = buildRoster(config, makeRng(1));
    const team = (t: number) => roster.filter((r) => r.team === t);
    expect(team(1).filter((r) => r.humanIndex >= 0).map((r) => r.name).sort()).toEqual(['Ben', 'Cy', 'Dee']);
    expect(team(0).find((r) => r.humanIndex === 0)?.name).toBe('Ana');
    // Three captains on a 2-ship side; Dee's titan adds two ships to team 0.
    expect(team(1).length).toBe(3);
    expect(team(0).length).toBe(2 + 2);
  });

  it('keeps the solo roster as it was', () => {
    const config: BattleConfig = { mode: 'solo', type: 'annihilation', mapId: 'open', teamSize: 6, difficulty: 'normal', players: [{ shipId: 'leviathan', device: 'mouse' }], seed: 4 };
    const roster = buildRoster(config, makeRng(4));
    expect(roster.filter((r) => r.team === 0).length).toBe(6);
    expect(roster.filter((r) => r.team === 1).length).toBe(8);
    expect(roster.find((r) => r.humanIndex === 0)?.name).toBe('P1');
  });
});
