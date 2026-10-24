import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import type { BattleConfig } from '../src/core/BattleSetup';

function botBattle(type: BattleConfig['type'], mapId: string, seed: number): Game {
  const g = new Game({ mode: 'solo', type, mapId, teamSize: 6, difficulty: 'hard', players: [], seed });
  return g;
}

describe('headless AI battle', () => {
  it('6v6 annihilation on open sea runs to a result with combat happening', () => {
    const g = botBattle('annihilation', 'open', 42);
    expect(g.ships.length).toBe(12);
    let steps = 0;
    while (!g.over && steps < 60 * 60 * 15 + 120) {
      g.step(1 / 60);
      steps++;
    }
    expect(g.over).toBe(true);
    const dmg = g.ships.reduce((a, s) => a + s.stats.damage, 0);
    expect(dmg).toBeGreaterThan(50000);
  }, 180000);

  it('6v6 domination on the archipelago captures points', () => {
    const g = botBattle('domination', 'archipelago', 9);
    let captured = false;
    g.events.on('capture', () => (captured = true));
    for (let i = 0; i < 60 * 60 * 5 && !g.over; i++) g.step(1 / 60);
    expect(captured).toBe(true);
  }, 180000);
});

describe('AI seamanship', () => {
  it('a bot that keeps bumping the same shore backs off and gets clear', () => {
    // The Warspite of this battle used to sit with its bow on an island for the rest of the game.
    const g = new Game({ mode: 'solo', type: 'annihilation', mapId: 'strait', teamSize: 6, difficulty: 'normal', players: [{ shipId: 'desmoines', device: 'mouse' }], seed: 11 });
    for (const s of g.humans()) g.handToAI(s);
    const ship = g.ships.find((s) => s.spec.id === 'warspite')!;
    let pinned = 0;
    let worst = 0;
    for (let i = 0; i < 60 * 60 * 9 && !g.over; i++) {
      g.step(1 / 60);
      if (i % 60) continue;
      pinned = ship.alive && ship.throttle >= 5 && Math.abs(ship.speed) < ship.maxSpeed * 0.1 ? pinned + 1 : 0;
      worst = Math.max(worst, pinned);
    }
    expect(worst).toBeLessThan(20);
  }, 60000);

  it('bots pressed bow to bow back out, and a bot on the map edge sails clear', async () => {
    const { emptyGame, place, run } = await import('./helpers');
    const g = emptyGame('open');
    const a = place(g, 'iowa', 0, 0, 0, Math.PI / 2, true);
    const b = place(g, 'iowa', 0, 120, 0, -Math.PI / 2, true);
    const edge = place(g, 'yamato', 0, 4340, 1500, Math.PI / 2, true);
    const foe = place(g, 'fletcher', 1, -3000, -3000, 0, true);
    // Kept afloat so the battle (and the bots' business) runs the whole 90 s.
    foe.maxHp = foe.hp = 1e9;
    let reversed = { a: false, b: false };
    let edgeSlowest = Infinity;
    let apart = 0;
    for (let i = 0; i < 60 * 90; i++) {
      run(g, 1 / 60);
      reversed = { a: reversed.a || a.speed < 0, b: reversed.b || b.speed < 0 };
      if (i > 60 * 10) edgeSlowest = Math.min(edgeSlowest, edge.speed);
      apart = Math.max(apart, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
    }
    expect(reversed).toEqual({ a: true, b: true });
    // They got clear of each other (both may later close on the same enemy).
    expect(apart).toBeGreaterThan(600);
    for (const s of [a, b, edge]) expect(s.speed).toBeGreaterThan(s.maxSpeed * 0.5);
    // Once under way, never ground to a halt against the edge: it kept enough way to turn back in.
    expect(edgeSlowest).toBeGreaterThan(edge.maxSpeed * 0.2);
    expect(edge.pos.x).toBeLessThan(4200);
  });
});
