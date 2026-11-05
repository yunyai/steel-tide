import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config';
import { Game } from '../src/core/Game';
import type { BattleConfig } from '../src/core/BattleSetup';
import { OFFER_TIME, UPGRADES } from '../src/modes/BossRush';
import { stateHash } from '../src/net/hash';
import type { Ship } from '../src/ships/Ship';

// Boss Rush and Survival with several captains on one side: shared waves, a card choice each,
// and a sunk captain sailing again once the wave is beaten.

function rushGame(players: BattleConfig['players'], type: 'bossrush' | 'survival' = 'bossrush', seed = 11): Game {
  return new Game({ mode: 'solo', type, mapId: 'open', teamSize: 1, difficulty: 'normal', eras: ['historic'], seed, escorts: 0, players });
}

const captains = (n: number): BattleConfig['players'] => Array.from({ length: n }, (_, i) => ({ shipId: 'iowa', device: 'mouse', name: `C${i + 1}` }));

function run(g: Game, seconds: number): void {
  for (let t = 0; t < seconds; t += SIM_DT) g.step(SIM_DT);
}

const enemies = (g: Game): Ship[] => g.ships.filter((s) => s.alive && s.team === 1 && !s.isSummon);

function wipe(g: Game, killer: Ship | null = g.rush!.player): void {
  for (const s of enemies(g)) s.sink(killer);
  g.rush!.queue.length = 0;
}

const upgrade = (id: string) => UPGRADES.find((u) => u.id === id)!;

describe('co-op Boss Rush', () => {
  it('puts every captain on the player fleet with their own helm and loadout', () => {
    const architectLoadout = Array.from({ length: 10 }, (_, i) => ({ type: 'storm' as const, skill: (i % 2) as 0 | 1 }));
    const g = rushGame([
      { shipId: 'yamato', device: 'mouse', name: 'Ann' },
      { shipId: 'architect', device: 'mouse', name: 'Bo', architectLoadout },
    ]);
    const r = g.rush!;
    expect(r.captains.map((c) => c.ship.humanIndex)).toEqual([0, 1]);
    expect(r.captains.map((c) => c.ship.team)).toEqual([0, 0]);
    expect(r.captains.map((c) => c.ship.spec.id)).toEqual(['yamato', 'architect']);
    expect(r.captains.map((c) => c.ship.name)).toEqual(['Ann', 'Bo']);
    expect(r.captains[1].ship.architectLoadout).toEqual(architectLoadout);
    expect(r.player).toBe(r.captains[0].ship);
    for (const c of r.captains) {
      expect(g.fleet).toContain(c.ship);
      expect(g.ai.has(c.ship)).toBe(false);
    }
    const [a, b] = r.captains.map((c) => c.ship.pos);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(300);
  });

  it('adds two ships and a quarter more hull to every wave for each captain past the first', () => {
    const solo = rushGame(captains(1));
    const duo = rushGame(captains(2));
    expect(duo.rush!.next.ships).toBe(solo.rush!.next.ships + 2);
    run(solo, 5);
    run(duo, 5);
    const one = enemies(solo);
    const two = enemies(duo);
    expect(two.length + duo.rush!.queue.length).toBe(one.length + solo.rush!.queue.length + 2);
    // The extra ships draw from the same rng, so the waves differ; compare hulls by type.
    const soloHp = new Map(one.map((s) => [s.spec.id, s.maxHp]));
    const same = two.filter((s) => soloHp.has(s.spec.id));
    expect(same.length).toBeGreaterThan(0);
    for (const s of same) expect(Math.abs(s.maxHp - soloHp.get(s.spec.id)! * 1.25)).toBeLessThanOrEqual(1);
  });

  it('gives each captain an offer of their own and waits for both', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    wipe(g);
    run(g, 0.1);
    expect(r.phase).toBe('offer');
    for (const c of r.captains) expect(new Set(c.offer.map((u) => u.id)).size).toBe(3);
    expect(r.choose(0, 0)).toBe(true);
    expect(r.phase).toBe('offer');
    expect(r.captains.map((c) => c.taken.length)).toEqual([1, 0]);
    expect(r.choose(1, 0)).toBe(false);
    expect(r.choose(2, 1)).toBe(true);
    expect(r.phase).toBe('warmup');
    expect(r.captains.map((c) => c.taken.length)).toEqual([1, 1]);
  });

  it('takes the first card for a captain who lets the clock run out', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    wipe(g);
    run(g, 0.1);
    r.choose(0, 0);
    const first = r.captains[1].offer[0].id;
    run(g, OFFER_TIME);
    expect(r.phase).toBe('warmup');
    expect(r.captains[1].taken).toEqual([first]);
  });

  it('lets a captain under the AI take the first card at once', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    g.handToAI(r.captains[1].ship);
    wipe(g);
    run(g, 0.1);
    expect(r.phase).toBe('offer');
    expect(r.captains.map((c) => c.taken.length)).toEqual([0, 1]);
  });

  it('applies an upgrade only to the captain who chose it', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    wipe(g);
    run(g, 0.1);
    r.captains[1].offer = [upgrade('damage'), upgrade('chain'), upgrade('drops')];
    expect(r.choose(0, 1)).toBe(true);
    for (const c of r.captains) c.ship.refreshModifiers();
    expect(r.captains[1].ship.mods.damageMul).toBeCloseTo(1.15);
    expect(r.captains[0].ship.mods.damageMul).toBeCloseTo(1);
    upgrade('chain').apply(r.captains[1].ship, r);
    upgrade('drops').apply(r.captains[0].ship, r);
    expect(r.captains.map((c) => c.chainBlast)).toEqual([0, 20000]);
    expect(r.captains.map((c) => c.dropBonus)).toEqual([0.2, 0]);
    expect(r.dropBonus).toBeCloseTo(0.2);
  });

  it('blasts a wreck only for the captain whose kill it was', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    upgrade('chain').apply(r.captains[1].ship, r);
    const [a, b] = enemies(g);
    const before = g.strikes.strikes.length;
    a.sink(r.captains[0].ship);
    expect(g.strikes.strikes.length).toBe(before);
    b.sink(r.captains[1].ship);
    const blast = g.strikes.strikes.at(-1)!;
    expect(g.strikes.strikes.length).toBe(before + 1);
    expect(blast.owner).toBe(r.captains[1].ship);
  });

  it('shields only the captain who took the wave barrier', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    upgrade('waveShield').apply(r.captains[1].ship, r);
    run(g, 5);
    expect(r.wave).toBe(1);
    expect(r.captains[1].ship.shield).toBeGreaterThan(0);
    expect(r.captains[0].ship.shield).toBe(0);
  });

  it('sails on when one captain sinks and brings them back at the wave clear', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    const [keep, lost] = r.captains.map((c) => c.ship);
    upgrade('damage').apply(lost, r);
    upgrade('repair').apply(lost, r);
    const kit = lost.consumables[0];
    kit.charges -= 2;
    const { charges } = kit;
    const most = kit.spec.charges;
    lost.sink(null);
    run(g, 0.1);
    expect(g.over).toBe(false);
    expect(lost.alive).toBe(false);
    wipe(g, keep);
    run(g, 0.1);
    expect(r.phase).toBe('offer');
    expect(lost.alive).toBe(true);
    expect(lost.hp / lost.maxHp).toBeCloseTo(0.5);
    expect(lost.mods.damageMul).toBeCloseTo(1.15);
    expect(lost.consumables[0].spec.charges).toBe(most);
    expect(lost.consumables[0].charges).toBe(charges + 1);
    expect(Math.hypot(lost.pos.x - keep.pos.x, lost.pos.z - keep.pos.z)).toBeLessThan(1500);
  });

  it('brings a captain sunk in their Titan Shift form back with their own repair kits', () => {
    const g = new Game({ mode: 'solo', type: 'bossrush', mapId: 'open', teamSize: 1, difficulty: 'normal', eras: ['historic', 'anime'], seed: 11, escorts: 0, players: [{ shipId: 'iowa', device: 'mouse', name: 'C1' }, { shipId: 'naruto', device: 'mouse', name: 'C2' }] });
    const r = g.rush!;
    run(g, 5);
    const [keep, lost] = r.captains.map((c) => c.ship);
    upgrade('repair').apply(lost, r);
    const own = lost.consumables.map((k) => ({ spec: k.spec, charges: k.charges }));
    expect(g.shiftShip(lost)).toBe(true);
    g.step(SIM_DT);
    expect(lost.form).toBeTruthy();
    expect(lost.consumables[0].spec).not.toEqual(own[0].spec);
    lost.sink(null);
    wipe(g, keep);
    run(g, 0.1);
    expect(lost.alive).toBe(true);
    expect(lost.form).toBeNull();
    expect(lost.consumables.map((k) => k.spec)).toEqual(own.map((k) => k.spec));
    expect(lost.consumables[0].charges).toBe(Math.min(own[0].spec.charges, own[0].charges + 1));
  });

  it('ends the run when the last captains and the last enemy sink on the same tick', () => {
    for (const n of [1, 2]) {
      const g = rushGame(captains(n));
      const r = g.rush!;
      run(g, 5);
      r.queue.length = 0;
      const foes = enemies(g);
      for (const s of foes.slice(1)) s.sink(r.player);
      run(g, 0.1);
      expect(g.over).toBe(false);
      foes[0].sink(r.player);
      for (const c of r.captains) c.ship.sink(foes[0]);
      g.step(SIM_DT);
      expect(g.over, `${n} captain(s)`).toBe(true);
      expect(g.winner).toBe(1);
      expect(r.captains.every((c) => !c.ship.alive)).toBe(true);
    }
  });

  it('ends the run only when every captain is down', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    r.captains[0].ship.sink(null);
    run(g, 0.1);
    expect(g.over).toBe(false);
    r.captains[1].ship.sink(null);
    run(g, 0.1);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(1);
  });

  it('turns hunters on a sunk captain to the nearest one still afloat', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    run(g, 5);
    const hunted = () => enemies(g).map((s) => g.ai.get(s)!.hunt);
    expect(new Set(hunted())).toEqual(new Set(r.captains.map((c) => c.ship)));
    r.captains[1].ship.sink(null);
    run(g, 0.1);
    for (const h of hunted()) expect(h).toBe(r.captains[0].ship);
  });

  it('counts every captain\'s damage in the team score', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    r.captains[0].ship.stats.damage = 1000;
    r.captains[1].ship.stats.damage = 2000;
    expect(r.total).toBe(r.score + 300);
  });

  it('never sends a titan in co-op Survival', () => {
    const g = rushGame(captains(2), 'survival', 12);
    const r = g.rush!;
    run(g, 5);
    for (let w = 1; w <= 10; w++) {
      expect(r.wave).toBe(w);
      expect(enemies(g).some((s) => s.spec.cls === 'TT')).toBe(false);
      wipe(g);
      run(g, 0.1);
      r.choose(0, 0);
      r.choose(0, 1);
      run(g, 5);
    }
  });

  it('folds each captain\'s choice into the battle hash', () => {
    const g = rushGame(captains(2));
    const r = g.rush!;
    const before = stateHash(g);
    r.captains[1].chainBlast = 20000;
    const chain = stateHash(g);
    expect(chain).not.toBe(before);
    r.captains[1].taken.push('hull');
    expect(stateHash(g)).not.toBe(chain);
  });
});
