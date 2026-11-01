import { describe, expect, it } from 'vitest';
import { aiFleetSizes, buildRoster, type BattleConfig } from '../src/core/BattleSetup';
import { eligibleShips } from '../src/core/FleetSelection';
import { makeRng } from '../src/core/math';
import { clearVisible, defaultPool, poolShips, selectVisible } from '../src/ui/FleetPool';

const mixed = eligibleShips('mixed', true);

describe('fleet pool', () => {
  it('leaves titans out of a new pool', () => {
    const pool = defaultPool(mixed);
    expect(pool.length).toBeGreaterThan(0);
    expect(mixed.filter((s) => pool.includes(s.id)).every((s) => s.cls !== 'TT')).toBe(true);
    expect(pool).toHaveLength(mixed.filter((s) => s.cls !== 'TT').length);
  });

  it('filters by class chips, with cruisers covering every cruiser class, and by search', () => {
    expect(poolShips(mixed, '', [])).toHaveLength(mixed.length);
    const cruisers = poolShips(mixed, '', ['CA']);
    expect(new Set(cruisers.map((s) => s.cls))).toEqual(new Set(mixed.filter((s) => ['CB', 'CA', 'CL'].includes(s.cls)).map((s) => s.cls)));
    const bbOrSs = poolShips(mixed, '', ['BB', 'SS']);
    expect(bbOrSs.every((s) => s.cls === 'BB' || s.cls === 'SS')).toBe(true);
    expect(bbOrSs.some((s) => s.cls === 'SS')).toBe(true);
    expect(poolShips(mixed, 'yamato', ['BB']).map((s) => s.id)).toContain('yamato');
    expect(poolShips(mixed, 'yamato', ['DD'])).toEqual([]);
  });

  it('selects and clears only the ships in view', () => {
    const subs = poolShips(mixed, '', ['SS']);
    const pool = selectVisible(['yamato'], subs);
    expect(pool).toEqual(['yamato', ...subs.map((s) => s.id)]);
    expect(selectVisible(pool, subs)).toEqual(pool);
    expect(clearVisible(pool, subs)).toEqual(['yamato']);
  });
});

describe('AI fleet sizes', () => {
  const config = (over: Partial<BattleConfig> = {}): BattleConfig => ({ mode: 'solo', type: 'annihilation', mapId: 'open', teamSize: 5, era: 'mixed', difficulty: 'normal', seed: 3, players: [{ shipId: 'iowa', device: 'mouse' }], ...over });
  const roster = (c: BattleConfig) => {
    const r = buildRoster(c, makeRng(c.seed));
    return [0, 1].map((t) => r.filter((s) => s.team === t && s.humanIndex < 0).length);
  };

  it('counts the AI ships each fleet really gets, for any number of captains', () => {
    const cases: BattleConfig[] = [
      config(),
      config({ players: [{ shipId: 'iowa', device: 'mouse' }, { shipId: 'yamato', device: 'pad0' }] }),
      config({ players: [{ shipId: 'iowa', device: 'mouse' }, { shipId: 'yamato', device: 'pad0', team: 1 }] }),
      config({ type: 'freeplay', ai: [2, 6] }),
      config({ type: 'freeplay', ai: [0, 0] }),
    ];
    for (const c of cases) {
      const s = aiFleetSizes(c);
      expect([s.ai[0] + s.extras[0], s.ai[1] + s.extras[1]]).toEqual(roster(c));
    }
    expect(aiFleetSizes(cases[1]).ai).toEqual([3, 5]);
  });

  it('adds two reinforcements against each titan, except to a fleet with no AI', () => {
    const titan = config({ players: [{ shipId: 'leviathan', device: 'mouse' }] });
    expect(aiFleetSizes(titan).extras).toEqual([0, 2]);
    expect(aiFleetSizes(config({ players: titan.players, type: 'freeplay', ai: [3, 0] })).extras).toEqual([0, 0]);
    expect(aiFleetSizes(config({ players: titan.players, type: 'freeplay', ai: [3, 2] })).extras).toEqual([0, 2]);
  });
});
