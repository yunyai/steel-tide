import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SIM_DT } from '../src/config';
import type { BattleType } from '../src/core/BattleSetup';
import { RUSH_WAVES, loadBest, saveBest } from '../src/modes/BossRush';
import { DMG_CAP, HP_CAP, MAX_ALIVE, MAX_WAVE_SHIPS, RUSH_PRESETS, rushKnobs, rushRecordKey, waveScale, type RushDifficulty, type RushPreset } from '../src/modes/RushDifficulty';
import { SHIP_BY_ID } from '../src/data/ships';
import type { Ship } from '../src/ships/Ship';

// Ship ids and max HP of waves 1..15, recorded from the Boss Rush before difficulty existed
// (seed 11 for Boss Rush, 12 for Survival, Yamato, no escorts, historic).
const GOLDEN: Record<'rush' | 'survival', [string[], number[]][]> = JSON.parse('{"rush":[[["fletcher","shimakaze","shimakaze"],[125000,115000,115000]],[["shimakaze","shimakaze","atlanta","belfast"],[121900,121900,153700,180200]],[["stalingrad","desmoines","shimakaze","gato"],[352800,246400,128800,95200]],[["iowa","atlanta","shimakaze","shimakaze"],[436600,171100,135700,135700]],[["leviathan","shimakaze","shimakaze"],[793600,142600,142600]],[["bismarck","iowa","fletcher","shimakaze"],[448500,481000,162500,149500]],[["akagi","stalingrad","stalingrad","shimakaze","gato"],[408000,428400,428400,156400,115600]],[["bismarck","bismarck","belfast","fletcher","shimakaze"],[489900,489900,241400,177500,163300]],[["bismarck","stalingrad","atlanta","belfast","fletcher","fletcher"],[510600,466200,214600,251600,185000,185000]],[["habakkuk","desmoines","fletcher","fletcher"],[1355200,338800,192500,192500]],[["yamato","warspite","warspite","shimakaze","fletcher"],[787200,472000,472000,184000,200000]],[["yamato","iowa","akagi","desmoines","shimakaze","gato"],[816720,614200,498000,365200,190900,141100]],[["yamato","iowa","atlanta","desmoines","fletcher","fletcher","gato"],[846240,636400,249400,378400,215000,215000,146200]],[["yamato","iowa","iowa","desmoines","stalingrad","fletcher","shimakaze"],[875760,658600,658600,391600,560700,222500,204700]],[["raijin","bismarck","atlanta","fletcher","fletcher"],[993600,634800,266800,230000,230000]]],"survival":[[["shimakaze","fletcher","fletcher"],[115000,125000,125000]],[["shimakaze","fletcher","belfast","stalingrad"],[121900,132500,180200,333900]],[["atlanta","desmoines","shimakaze","gato"],[162400,246400,128800,95200]],[["yamato","atlanta","fletcher","shimakaze"],[580560,171100,147500,135700]],[["iowa","stalingrad","fletcher","shimakaze"],[458800,390600,155000,142600]],[["yamato","iowa","shimakaze","fletcher"],[639600,481000,149500,162500]],[["akagi","belfast","stalingrad","fletcher","gato"],[408000,231200,428400,170000,115600]],[["bismarck","iowa","atlanta","shimakaze","shimakaze"],[489900,525400,205900,163300,163300]],[["bismarck","belfast","belfast","desmoines","shimakaze","shimakaze"],[510600,251600,251600,325600,170200,170200]],[["bismarck","stalingrad","desmoines","shimakaze","shimakaze"],[531300,485100,338800,177100,177100]],[["iowa","bismarck","warspite","fletcher","shimakaze"],[592000,552000,472000,200000,184000]],[["yamato","iowa","akagi","atlanta","fletcher","gato"],[816720,614200,498000,240700,207500,141100]],[["bismarck","warspite","desmoines","atlanta","shimakaze","shimakaze","gato"],[593400,507400,378400,249400,197800,197800,146200]],[["yamato","iowa","iowa","atlanta","stalingrad","fletcher","shimakaze"],[875760,658600,658600,258100,560700,222500,204700]],[["yamato","belfast","bismarck","atlanta","shimakaze","shimakaze"],[905280,312800,634800,266800,211600,211600]]]}');

const rushGame = (type: Extract<BattleType, 'bossrush' | 'survival'>, seed: number, rush?: RushDifficulty) =>
  new Game({ mode: 'solo', type, mapId: 'open', teamSize: 1, escorts: 0, eras: ['historic'], difficulty: 'normal', seed, players: [{ shipId: 'yamato', device: 'mouse' }], rush });

const cls = (ids: string[]) => ids.map((id) => SHIP_BY_ID[id].cls);
const enemies = (g: Game): Ship[] => g.ships.filter((s) => s.alive && s.team === 1 && !s.isSummon);

/** Play `n` waves, sinking each the moment it arrives; returns what each wave brought. */
function waves(g: Game, n: number): [string[], number[]][] {
  const r = g.rush!;
  const out: [string[], number[]][] = [];
  for (let i = 0; i < 1e6 && out.length < n; i++) {
    g.step(SIM_DT);
    if (r.phase === 'offer') r.choose(0);
    if (r.phase === 'fight' && out.length < r.wave) {
      const ships = enemies(g);
      out.push([ships.map((s) => s.spec.id), ships.map((s) => s.maxHp)]);
      for (const s of ships) s.withdraw(true);
    }
  }
  return out;
}

/** Skip ahead: the next wave to arrive is `n`. */
function jumpTo(g: Game, n: number): void {
  const r = g.rush!;
  r.wave = n - 1;
  r.timer = 0;
}

/** Step until wave `n` arrives. */
function until(g: Game, n: number): void {
  const r = g.rush!;
  for (let i = 0; i < 1e5 && !(r.phase === 'fight' && r.wave === n); i++) g.step(SIM_DT);
  expect(r.wave).toBe(n);
}

describe('Boss Rush difficulty: Normal is today', () => {
  it.each([
    ['unset', undefined],
    ['Normal', { preset: 'normal' } as RushDifficulty],
  ])('Boss Rush waves 1..15 match the recording with the setting %s', (_l, d) => {
    expect(waves(rushGame('bossrush', 11, d), RUSH_WAVES)).toEqual(GOLDEN.rush);
  });

  it.each([
    ['unset', undefined],
    ['Normal', { preset: 'normal' } as RushDifficulty],
  ])('Survival waves 1..15 match the recording with the setting %s', (_l, d) => {
    expect(waves(rushGame('survival', 12, d), RUSH_WAVES)).toEqual(GOLDEN.survival);
  });
});

describe('rushKnobs', () => {
  it('reads the presets, and Normal when unset or unknown', () => {
    expect(rushKnobs()).toEqual(RUSH_PRESETS.normal);
    expect(rushKnobs({ preset: 'hard' })).toEqual(RUSH_PRESETS.hard);
    expect(rushKnobs({ preset: 'bogus' as RushPreset })).toEqual(RUSH_PRESETS.normal);
    expect(RUSH_PRESETS.nightmare).toMatchObject({ bossEvery: 3, extraShips: 3, hpPct: 200, dmgPct: 150, rampPct: 200, maxTitans: 4 });
    expect(RUSH_PRESETS.brutal).toMatchObject({ bossEvery: 4, extraShips: 2, hpPct: 150, dmgPct: 130, rampPct: 150, maxTitans: 3 });
    expect(RUSH_PRESETS.hard).toMatchObject({ bossEvery: 5, extraShips: 1, hpPct: 125, dmgPct: 115, rampPct: 125, maxTitans: 3 });
    expect(RUSH_PRESETS.normal).toMatchObject({ bossEvery: 5, extraShips: 0, hpPct: 100, dmgPct: 100, rampPct: 100, maxTitans: 2 });
  });

  it('clamps every Custom knob into its range, and fills the missing ones from Normal', () => {
    const k = rushKnobs({ preset: 'custom', custom: { bossEvery: 1, extraShips: 9, hpPct: 10, dmgPct: 999, rampPct: Number.NaN, maxTitans: 0, stagger: 100 } });
    expect(k).toEqual({ bossEvery: 3, extraShips: 4, hpPct: 50, dmgPct: 300, rampPct: RUSH_PRESETS.normal.rampPct, maxTitans: 1, stagger: 12 });
    expect(rushKnobs({ preset: 'custom', custom: { bossEvery: 6.6 } }).bossEvery).toBe(7);
    expect(rushKnobs({ preset: 'custom' })).toEqual(RUSH_PRESETS.normal);
  });

  it('names a record per preset, and per set of Custom knobs', () => {
    expect(rushRecordKey()).toBe('normal');
    expect(rushRecordKey({ preset: 'brutal' })).toBe('brutal');
    const a = rushRecordKey({ preset: 'custom', custom: { hpPct: 200 } });
    expect(a).not.toBe(rushRecordKey({ preset: 'custom', custom: { hpPct: 225 } }));
    expect(a).toBe(rushRecordKey({ preset: 'custom', custom: { hpPct: 200, bossEvery: 5 } }));
  });
});

describe('waveScale', () => {
  it.each(['normal', 'hard', 'brutal', 'nightmare'] as RushPreset[])('%s climbs, stays finite and stays under the caps to wave 300', (p) => {
    const k = RUSH_PRESETS[p];
    let last = waveScale(1, k);
    for (let n = 2; n <= 300; n++) {
      const s = waveScale(n, k);
      expect(s.hp).toBeGreaterThanOrEqual(last.hp);
      expect(s.dmg).toBeGreaterThanOrEqual(last.dmg);
      if (n > RUSH_WAVES + 1) expect(s.ships).toBeGreaterThanOrEqual(last.ships);
      for (const v of [s.hp, s.dmg, s.ships, s.titans, s.elite]) expect(Number.isFinite(v)).toBe(true);
      expect(s.hp).toBeLessThanOrEqual(HP_CAP);
      expect(s.dmg).toBeLessThanOrEqual(DMG_CAP);
      expect(s.ships).toBeLessThanOrEqual(MAX_WAVE_SHIPS);
      expect(s.titans).toBeLessThanOrEqual(k.maxTitans);
      expect(s.elite).toBeLessThanOrEqual(1);
      last = s;
    }
    expect(waveScale(300, k).ships).toBe(MAX_WAVE_SHIPS);
  });

  it('keeps climbing past wave 15 faster than the old linear ramp', () => {
    const k = RUSH_PRESETS.normal;
    expect(waveScale(15, k).hp).toBeCloseTo(1 + 0.06 * 14);
    expect(waveScale(100, k).hp).toBeGreaterThan(2 * (1 + 0.06 * 99));
    expect(waveScale(100, RUSH_PRESETS.nightmare).hp).toBeGreaterThan(waveScale(100, k).hp);
  });

  it('puts titans only on boss waves, at most maxTitans of them', () => {
    const k = RUSH_PRESETS.normal;
    expect(waveScale(5, k).titans).toBe(1);
    expect(waveScale(6, k).titans).toBe(0);
    expect(waveScale(60, k).titans).toBe(2);
    expect(waveScale(300, RUSH_PRESETS.nightmare).titans).toBe(4);
    expect(waveScale(9, RUSH_PRESETS.nightmare).titans).toBe(1);
  });
});

describe('Boss Rush difficulty in battle', () => {
  it('bossEvery moves the titans: Brutal sends one on wave 4 and none on wave 5', () => {
    const g = rushGame('bossrush', 3, { preset: 'brutal' });
    const w = waves(g, 5);
    expect(cls(w[3][0])).toContain('TT');
    expect(cls(w[4][0])).not.toContain('TT');
    // Wave 5's titan becomes a battleship and a cruiser, beside its two destroyers and two extras.
    expect(w[4][0]).toHaveLength(2 + 2 + 2);
  });

  it('extraShips adds ships to every wave', () => {
    expect(waves(rushGame('bossrush', 5, { preset: 'hard' }), 2).map((w) => w[0].length)).toEqual([3 + 1, 4 + 1]);
    expect(waves(rushGame('bossrush', 5, { preset: 'nightmare' }), 1)[0][0]).toHaveLength(3 + 3);
  });

  it('hpPct scales the hull of every wave', () => {
    const normal = waves(rushGame('bossrush', 7), 1)[0];
    const hard = rushGame('bossrush', 7, { preset: 'custom', custom: { hpPct: 200 } });
    const w = waves(hard, 1)[0];
    expect(w[0]).toEqual(normal[0]);
    expect(w[1]).toEqual(normal[1].map((hp) => hp * 2));
  });

  it('never has more than 10 enemies afloat, and the rest arrive as reinforcements', () => {
    const g = rushGame('bossrush', 9);
    const seen: number[] = [];
    g.events.on('reinforcements', (e) => seen.push(e.count));
    jumpTo(g, 81);
    until(g, 81);
    const r = g.rush!;
    const total = waveScale(81, rushKnobs()).ships;
    expect(total).toBeGreaterThan(MAX_ALIVE);
    let spawned = 0;
    const ids = new Set<number>();
    for (let i = 0; i < 60 * 600 && r.wave === 81 && r.phase === 'fight'; i++) {
      // The player holds out however hard wave 81 hits.
      r.player!.hp = r.player!.maxHp;
      g.step(SIM_DT);
      const live = enemies(g);
      expect(live.length).toBeLessThanOrEqual(MAX_ALIVE);
      for (const s of live) ids.add(s.id);
      // Sink one enemy a second.
      if (i % 60 === 0 && live.length) live[0].withdraw(true);
      spawned = ids.size;
    }
    expect(spawned).toBe(total);
    expect(seen.length).toBeGreaterThan(0);
    expect(r.phase).toBe('offer');
  });

  it('holds the titan cap: Normal sends two titans late in the endless run, never three', () => {
    const g = rushGame('bossrush', 4);
    jumpTo(g, 60);
    until(g, 60);
    expect(enemies(g).filter((s) => s.spec.cls === 'TT')).toHaveLength(2);
    expect(g.rush!.boss?.spec.cls).toBe('TT');
  });

  it('sends elites with affixes by wave 40, two affixes each from wave 40 on', () => {
    const g = rushGame('bossrush', 2);
    jumpTo(g, 40);
    until(g, 40);
    const elites = enemies(g).filter((s) => s.effects.some((e) => e.id.startsWith('refit:elite:')));
    expect(elites.length).toBeGreaterThan(0);
    for (const s of elites) expect(s.effects.filter((e) => e.id.startsWith('refit:elite:'))).toHaveLength(2);
    const early = rushGame('bossrush', 2);
    jumpTo(early, 18);
    until(early, 18);
    expect(enemies(early).some((s) => s.effects.some((e) => e.id.startsWith('refit:elite:')))).toBe(false);
  });

  it.each([12, 45, 90])('Survival never sends a titan, even on Nightmare (wave %i)', (n) => {
    const g = rushGame('survival', 6, { preset: 'nightmare' });
    if (n > 12) jumpTo(g, n);
    for (const w of waves(g, n > 12 ? 1 : n)) expect(cls(w[0])).not.toContain('TT');
  });
});

describe('Boss Rush records', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps a record per difficulty, and reads the old record as Normal', () => {
    store.set('steel-tide:bossrush', JSON.stringify({ yamato: { wave: 12, score: 90000 } }));
    expect(loadBest(false)).toEqual({ yamato: { wave: 12, score: 90000 } });
    expect(loadBest(false, { preset: 'normal' })).toEqual({ yamato: { wave: 12, score: 90000 } });
    expect(loadBest(false, { preset: 'hard' })).toEqual({});
    expect(saveBest('yamato', 9, 50000, false, { preset: 'hard' })).toBe(true);
    expect(loadBest(false, { preset: 'hard' })).toEqual({ yamato: { wave: 9, score: 50000 } });
    expect(loadBest(false, { preset: 'brutal' })).toEqual({});
    expect(loadBest(false)).toEqual({ yamato: { wave: 12, score: 90000 } });
    expect(saveBest('yamato', 3, 1000, true, { preset: 'hard' })).toBe(true);
    expect(loadBest(false, { preset: 'hard' }).yamato.score).toBe(50000);
    expect(loadBest(true, { preset: 'hard' }).yamato.score).toBe(1000);
  });
});
