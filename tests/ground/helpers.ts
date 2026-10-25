import type { Team } from '../../src/core/types';
import { VEHICLE_BY_ID } from '../../src/ground/sim/data';
import { GroundAI } from '../../src/ground/sim/GroundAI';
import { GroundGame } from '../../src/ground/sim/GroundGame';
import { GROUND_MAP_BY_ID } from '../../src/ground/sim/maps';
import { Props } from '../../src/ground/sim/props';
import type { GroundBattleType, GroundConfig } from '../../src/ground/sim/setup';
import { MAT, type Material, Terrain } from '../../src/ground/sim/terrain';
import type { Vehicle } from '../../src/ground/sim/Vehicle';

/** A bare test ground: a height function and one material, no props. */
export function registerMap(id: string, height: (x: number, z: number) => number = () => 0, mat: Material = MAT.dirt, half = 400): string {
  GROUND_MAP_BY_ID[id] = {
    id,
    name: id,
    description: '',
    half,
    sun: { elevation: 30, azimuth: 200 },
    turbidity: 4,
    caps: [{ name: 'Centre', x: 0, z: 0 }],
    spawnSpread: 100,
    build() {
      const terrain = new Terrain(half);
      terrain.shape(height);
      terrain.paint(() => mat);
      return { terrain, props: new Props(half), bridges: [] };
    },
  };
  return id;
}

export function groundConfig(over: Partial<GroundConfig> = {}): GroundConfig {
  return { kind: 'ground', mode: 'solo', type: 'annihilation', mapId: 'city', teamSize: 8, difficulty: 'normal', players: [], seed: 7, ...over };
}

/** A battle with nobody in it yet (vehicles are added with `put`). */
export function emptyGround(mapId = 'city', seed = 7, type: GroundBattleType = 'freeplay'): GroundGame {
  const g = new GroundGame(groundConfig({ mapId, seed, type, teamSize: 1, players: [{ vehicleId: 't34_85', device: 'mouse' }] }));
  g.vehicles = [];
  g.fleet.length = 0;
  g.ai.clear();
  return g;
}

export function put(g: GroundGame, id: string, team: Team, x: number, z: number, heading = 0, ai = false): Vehicle {
  const v = g.addVehicle(VEHICLE_BY_ID[id], team, id, x, z, heading);
  v.humanIndex = ai ? -1 : 0;
  v.spawnShield = 0;
  g.fleet.push(v);
  if (ai) g.ai.set(v, new GroundAI(v, g));
  return v;
}

export function run(g: GroundGame, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    g.step(1 / 60);
    each?.();
  }
}

export function finite(g: GroundGame): boolean {
  return g.vehicles.every((v) => Number.isFinite(v.x + v.y + v.z + v.heading + v.pitch + v.roll + v.hp + v.turretYaw + v.gunPitch + v.speed));
}
