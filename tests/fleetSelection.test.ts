import { describe, expect, it } from 'vitest';
import { buildRoster, type BattleConfig } from '../src/core/BattleSetup';
import { makeRng } from '../src/core/math';
import { navalRules } from '../server/rules';
import { Game } from '../src/core/Game';
import { stateHash } from '../src/net/hash';
import { TurnApplier } from '../src/net/navalTurns';
import { randomShip } from '../src/core/FleetSelection';

const config = (): BattleConfig => ({ mode: 'solo', type: 'annihilation', mapId: 'open', teamSize: 1, ai: [2, 3], era: 'historic', difficulty: 'normal', seed: 27, players: [{ shipId: 'leviathan', device: 'mouse' }] });

describe('fleet selection', () => {
  it('chooses an eligible random line ship immediately and never rerolls it on respawn', () => {
    const rng = makeRng(3);
    for (let i = 0; i < 100; i++) expect(randomShip('mixed', rng)?.cls).not.toBe('TT');
    const chosen = randomShip('modern', rng)!;
    const g = new Game({ ...config(), era: 'modern', type: 'freeplay', ai: [0, 0], players: [{ shipId: chosen.id, device: 'mouse' }] });
    const me = g.humans()[0];
    me.takeDamage(me.maxHp * 10, null);
    for (let i = 0; i < 500; i++) g.step();
    expect(g.humans()[0].spec.id).toBe(chosen.id);
  });
  it.each(['burst', 'staggered', 'long'] as const)('replays resolved AI choices and %s tempo with identical lockstep hashes', tempo => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { era: 'mixed', shiftTempo: tempo, ai: [2, 2], aiSelection: [{ mode: 'assign', slots: ['luffy', 'luffy'] }, { mode: 'pool', pool: ['gato', 'iowa'] }] });
    const c = navalRules.config(st, [{ pick: 'luffy', team: 0, name: 'P' }], 23);
    const a = new Game(c), b = new Game(structuredClone(c));
    const ap = new TurnApplier(a), bp = new TurnApplier(b);
    a.shiftShip(a.humans()[0]); b.shiftShip(b.humans()[0]);
    for (let k = 0; k < 120; k++) {
      for (let tick = 0; tick < 2; tick++) { ap.applyTick({ k }, tick); bp.applyTick({ k }, tick); }
      if (k % 30 === 0) expect(stateHash(a)).toBe(stateHash(b));
    }
  });
  it('supports duplicates and draws titan compensation from the opposing pool', () => {
    const c = config();
    c.aiSelection = [{ mode: 'assign', slots: ['iowa', 'iowa'] }, { mode: 'pool', pool: ['fletcher'] }];
    const r = buildRoster(c, makeRng(c.seed));
    expect(r.filter(s => s.team === 0 && s.humanIndex < 0).map(s => s.spec.id)).toEqual(['iowa', 'iowa']);
    expect(r.filter(s => s.team === 1).map(s => s.spec.id)).toEqual(Array(5).fill('fletcher'));
  });

  it('refuses a pool with no eligible choices', () => {
    const c = config();
    c.aiSelection = [{ mode: 'pool', pool: ['queenElizabeth', 'constructor'] }, { mode: 'auto' }];
    expect(() => buildRoster(c, makeRng(1))).toThrow(/pool/i);
  });

  it('validates LAN assignments, eras, titan permissions and Shift tempo', () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { shiftTempo: 'long', aiSelection: [{ mode: 'assign', slots: ['iowa', null, 'iowa'] }, { mode: 'pool', pool: ['fletcher', 'queenElizabeth', 'constructor'] }] });
    expect(st.shiftTempo).toBe('long');
    expect(st.aiSelection?.[1].pool).toEqual(['fletcher']);
    navalRules.applySettings(st, { shiftTempo: '__proto__' });
    expect(st.shiftTempo).toBe('long');
    const c = navalRules.config(st, [{ pick: 'iowa', team: 0, name: 'P' }], 19);
    expect(c.shiftTempo).toBe('long');
    expect(c.resolvedAI?.[0].slice(0, 3)).toEqual(['iowa', expect.any(String), 'iowa']);
    expect(buildRoster(c, makeRng(19)).filter(s => s.team === 1).every(s => s.spec.id === 'fletcher')).toBe(true);
  });

  it('rejects a start when changing era empties a configured pool', () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { aiSelection: [{ mode: 'pool', pool: ['iowa'] }, { mode: 'auto' }] });
    navalRules.applySettings(st, { era: 'anime' });
    expect(navalRules.startError(st, [{ pick: 'luffy', team: 0, name: 'P' }])).toMatch(/pool/i);
  });
});
