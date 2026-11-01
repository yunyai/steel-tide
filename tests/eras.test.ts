import { describe, expect, it } from 'vitest';
import { buildRoster, type BattleConfig } from '../src/core/BattleSetup';
import { eligibleShips } from '../src/core/FleetSelection';
import { Game } from '../src/core/Game';
import { makeRng } from '../src/core/math';
import type { Era } from '../src/core/types';
import { configEras, eraList, erasLabel, isEveryEra, normalizeEras, toggleEra } from '../src/data/eras';
import { ERAS, eraOf } from '../src/data/factions';
import { bossesOf, LINE_ERAS, SHIP_BY_ID, shipsIn, shipsOf, titansOf } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import { TurnApplier } from '../src/net/navalTurns';
import { navalRules } from '../server/rules';

const config = (eras: Era[], over: Partial<BattleConfig> = {}): BattleConfig => ({ mode: 'solo', type: 'annihilation', mapId: 'open', teamSize: 6, eras, difficulty: 'normal', seed: 1, players: [{ shipId: shipsOf(eras.find((e) => LINE_ERAS.includes(e))!).find((s) => s.cls !== 'TT')!.id, device: 'mouse' }], ...over });

describe('era sets', () => {
  it('lists the eras of a selection in roster order, Mixed meaning every era', () => {
    expect(eraList('mixed')).toEqual(ERAS);
    expect(eraList('anime')).toEqual(['anime']);
    expect(eraList(['anime', 'historic', 'anime'])).toEqual(['historic', 'anime']);
  });

  it('cleans an untrusted set: known eras only, no repeats, roster order, at least one with line ships', () => {
    expect(normalizeEras(['scifi', 'historic', 'scifi'])).toEqual(['historic', 'scifi']);
    expect(normalizeEras(['anime', 'atlantis', '__proto__'])).toEqual(['anime']);
    expect(normalizeEras('mixed')).toEqual(ERAS);
    expect(normalizeEras('modern')).toEqual(['modern']);
    expect(normalizeEras(['misc'])).toBeNull();
    expect(normalizeEras([])).toBeNull();
    expect(normalizeEras('atlantis')).toBeNull();
    expect(normalizeEras({ length: 1, 0: 'historic' })).toBeNull();
    expect(normalizeEras(Array(50).fill('historic'))).toEqual(['historic']);
  });

  it("reads a battle's eras from the set, else the legacy era, else the fallback", () => {
    expect(configEras({ eras: ['anime', 'historic'] })).toEqual(['historic', 'anime']);
    expect(configEras({ era: 'modern' })).toEqual(['modern']);
    expect(configEras({ era: 'mixed' })).toEqual(ERAS);
    expect(configEras({})).toEqual(['historic']);
    expect(configEras({}, 'mixed')).toEqual(ERAS);
    expect(configEras({ eras: [], era: 'scifi' })).toEqual(['scifi']);
  });

  it('toggles eras but never turns off the last one with line ships; Misc adds only its titans', () => {
    expect(toggleEra(['historic'], 'anime')).toEqual(['historic', 'anime']);
    expect(toggleEra(['historic', 'anime'], 'historic')).toEqual(['anime']);
    expect(toggleEra(['historic'], 'historic')).toEqual(['historic']);
    expect(toggleEra(['historic', 'misc'], 'historic')).toEqual(['historic', 'misc']);
    expect(toggleEra(['historic', 'misc'], 'misc')).toEqual(['historic']);
    const misc = shipsIn(['historic', 'misc']).filter((s) => eraOf(s) === 'misc');
    expect(misc.length).toBeGreaterThan(0);
    expect(misc.every((s) => s.cls === 'TT')).toBe(true);
  });

  it('names a selection: one era, a few joined, Mixed for all of them', () => {
    expect(isEveryEra(ERAS)).toBe(true);
    expect(isEveryEra(['historic'])).toBe(false);
    expect(erasLabel(ERAS)).toBe('Mixed');
    expect(erasLabel(['historic'])).toBe('Historic');
    expect(erasLabel(['historic', 'anime'])).toBe('Historic + Anime');
    expect(erasLabel(['historic', 'fantasy', 'modern', 'anime'])).toBe('4 eras');
  });

  it('gives the ships, titans and bosses of a set', () => {
    const set: Era[] = ['historic', 'anime'];
    expect(new Set(shipsIn(set).map(eraOf))).toEqual(new Set(set));
    expect(shipsIn(set)).toHaveLength(shipsOf('historic').length + shipsOf('anime').length);
    expect(titansOf(['historic', 'misc'])).toEqual([...titansOf('historic'), ...titansOf('misc')]);
    expect(bossesOf(['anime'])).toEqual(bossesOf('anime'));
    expect(shipsIn(ERAS)).toEqual(shipsIn('mixed'));
    expect(eligibleShips(set).every((s) => set.includes(eraOf(s)) && s.cls !== 'TT')).toBe(true);
  });
});

describe('battles of an era set', () => {
  it('fill both fleets only from the chosen eras, and every chosen era sails across seeds', () => {
    const set: Era[] = ['historic', 'scifi', 'anime'];
    const seen = new Set<Era>();
    for (let seed = 1; seed <= 30; seed++) {
      const r = buildRoster(config(set, { seed }), makeRng(seed));
      for (const s of r) {
        expect(set).toContain(eraOf(s.spec));
        seen.add(eraOf(s.spec));
      }
    }
    expect(seen).toEqual(new Set(set));
  });

  it("refuse a Free play change into a ship outside the set", () => {
    const g = new Game(config(['historic', 'anime'], { type: 'freeplay', ai: [0, 0] }));
    const me = g.humans()[0];
    const modern = shipsOf('modern').find((s) => s.cls !== 'TT')!;
    const anime = shipsOf('anime').find((s) => s.cls !== 'TT' && s !== me.base)!;
    g.pickShip(me, modern.id);
    expect(me.nextSpec).toBeNull();
    g.pickShip(me, anime.id);
    expect(me.nextSpec).toBe(anime);
  });

  it('send Boss Rush titans round-robin across the eras, with no repeat until each is used', () => {
    const set: Era[] = ['historic', 'scifi'];
    const g = new Game({ ...config(set, { type: 'bossrush' }), teamSize: 1, escorts: 0 });
    const titan = (i: number) => (g.rush as unknown as { titan(i: number): (typeof SHIP_BY_ID)[string] }).titan(i);
    const total = bossesOf(set).length;
    const picks = Array.from({ length: total }, (_, i) => titan(i));
    expect(new Set(picks).size).toBe(total);
    const eras = picks.map(eraOf);
    const shorter = Math.min(bossesOf('historic').length, bossesOf('scifi').length);
    for (let i = 1; i < 2 * shorter; i++) expect(eras[i]).not.toBe(eras[i - 1]);
    expect(new Set(eras.slice(0, 2))).toEqual(new Set(set));
  });

  it('keep the one-era Boss Rush titan order', () => {
    const g = new Game({ ...config(['historic'], { type: 'bossrush' }), teamSize: 1, escorts: 0 });
    const titan = (i: number) => (g.rush as unknown as { titan(i: number): (typeof SHIP_BY_ID)[string] }).titan(i);
    expect([0, 1, 2].map((i) => titan(i))).toEqual(bossesOf('historic').slice(0, 3));
  });
});

describe('LAN era sets', () => {
  it('accept a set, the legacy era, and refuse a set with no line ships', () => {
    const st = navalRules.defaults();
    expect(st.eras).toEqual(['historic']);
    navalRules.applySettings(st, { eras: ['anime', 'historic'] });
    expect(st.eras).toEqual(['historic', 'anime']);
    navalRules.applySettings(st, { eras: ['misc'] });
    expect(st.eras).toEqual(['historic', 'anime']);
    navalRules.applySettings(st, { era: 'mixed' } as never);
    expect(st.eras).toEqual(ERAS);
    navalRules.applySettings(st, { eras: ['modern'] });
    const modern = shipsOf('modern').find((s) => s.cls !== 'TT')!.id;
    const historic = shipsOf('historic').find((s) => s.cls !== 'TT')!.id;
    expect(navalRules.pickAllowed(modern, st)).toBe(true);
    expect(navalRules.pickAllowed(historic, st)).toBe(false);
    expect(navalRules.config(st, [{ pick: modern, team: 0, name: 'P' }], 4).eras).toEqual(['modern']);
  });

  it('keep two peers of a historic and anime battle identical', () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { eras: ['historic', 'anime'], ai: [3, 4] });
    const c = navalRules.config(st, [{ pick: 'luffy', team: 0, name: 'P' }], 31);
    expect(new Set(c.resolvedAI!.flat().map((id) => eraOf(SHIP_BY_ID[id])))).toEqual(new Set(['historic', 'anime']));
    const a = new Game(c), b = new Game(structuredClone(c));
    const ap = new TurnApplier(a), bp = new TurnApplier(b);
    for (let k = 0; k < 90; k++) {
      for (let tick = 0; tick < 2; tick++) { ap.applyTick({ k }, tick); bp.applyTick({ k }, tick); }
      if (k % 30 === 29) expect(stateHash(a)).toBe(stateHash(b));
    }
  });
});
