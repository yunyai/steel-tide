import { Game } from '../src/core/Game';
import type { BattleConfig } from '../src/core/BattleSetup';
import type { Team } from '../src/core/types';
import { SHIP_BY_ID } from '../src/data/ships';
import { AIController } from '../src/ai/AIController';
import type { Ship } from '../src/ships/Ship';

export function emptyGame(mapId = 'open', seed = 7, type: BattleConfig['type'] = 'annihilation'): Game {
  const config: BattleConfig = {
    mode: 'solo',
    type,
    mapId,
    teamSize: 1,
    difficulty: 'normal',
    players: [{ shipId: 'yamato', device: 'mouse' }],
    seed,
  };
  const g = new Game(config);
  g.ships = [];
  g.ai.clear();
  return g;
}

export function place(g: Game, id: string, team: Team, x: number, z: number, heading = 0, ai = false): Ship {
  const s = g.addShip(SHIP_BY_ID[id], team, id, x, z, heading);
  s.humanIndex = ai ? -1 : 0;
  if (ai) g.ai.set(s, new AIController(s, g));
  return s;
}

export function run(g: Game, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) g.step(1 / 60);
}
