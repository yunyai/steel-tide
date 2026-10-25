import type { InputDeviceId } from '../../config';
import type { BattleMode, DifficultyId } from '../../core/BattleSetup';
import type { BattleEra, Team } from '../../core/types';
import { VEHICLE_BY_ID, VEHICLES, vehiclesIn } from './data';
import type { VehicleClass, VehicleSpec } from './types';

// Ground battle orders: what the menus, the lobby and the server hand to a GroundGame.

export type GroundBattleType = 'domination' | 'annihilation' | 'freeplay';

export interface GroundPlayerConfig {
  vehicleId: string;
  device: InputDeviceId;
  assist?: boolean;
  team?: Team;
  name?: string;
}

export interface GroundConfig {
  kind: 'ground';
  mode: BattleMode;
  type: GroundBattleType;
  mapId: string;
  teamSize: number;
  difficulty: DifficultyId;
  players: GroundPlayerConfig[];
  seed: number;
  /** Which era's vehicles the bots drive (historic by default). */
  era?: BattleEra;
  /** AI vehicles per team besides its captains (0..8); replaces `teamSize` when set. */
  ai?: [number, number];
  /** Free play: whether captains may change into a titan (allowed unless false). */
  titans?: boolean;
}

export interface GroundRosterEntry {
  team: Team;
  spec: VehicleSpec;
  humanIndex: number;
  name: string;
}

/** Line-up of a team: every class once, the medium twice. */
const TEMPLATE: VehicleClass[] = ['HT', 'MT', 'LT', 'TD', 'MT', 'SPG', 'MSL', 'SUP'];

const COMMANDERS = [
  'Wittmann', 'Kolobanov', 'Barkmann', 'Lafayette Pool', 'Carius', 'Abrams', 'Rudel', 'Shimada',
  'Zhukov', 'Patton', 'Rotmistrov', 'Guderian', 'Hobart', 'Montgomery', 'Rommel', 'Katukov',
  'Nishi', 'Fey', 'Knispel', 'Oddie', 'Ridgway', 'Konev', 'Popel', 'Lavrinenko',
];

/** A random vehicle of a class from the era (titans are never handed out at random). */
export function randomVehicle(cls: VehicleClass, rng: () => number, era: BattleEra = 'historic'): VehicleSpec {
  const fits = (s: VehicleSpec) => s.cls === cls && !s.hidden;
  const pool = vehiclesIn(era).filter(fits);
  const list = pool.length ? pool : VEHICLES.filter(fits);
  return list[Math.floor(rng() * list.length) % list.length];
}

/** Mirrored line-ups; captains take a slot of their vehicle's class. A titan brings two more foes. */
export function buildGroundRoster(config: GroundConfig, rng: () => number): GroundRosterEntry[] {
  const size = Math.max(1, Math.min(8, config.teamSize));
  const humans: [number[], number[]] = [[], []];
  config.players.forEach((p, i) => humans[p.team === 1 ? 1 : 0].push(i));
  const titans = (t: Team) => humans[t].filter((i) => VEHICLE_BY_ID[config.players[i].vehicleId]?.cls === 'TT').length;
  const sizes: [number, number] = [0, 0];
  for (const t of [0, 1] as Team[]) {
    const other: Team = t === 0 ? 1 : 0;
    if (config.ai) {
      const bots = Math.max(0, Math.min(8, Math.floor(config.ai[t] || 0)));
      sizes[t] = humans[t].length + bots + (bots > 0 ? titans(other) * 2 : 0);
    } else sizes[t] = Math.max(size, humans[t].length) + titans(other) * 2;
  }
  const names = [...COMMANDERS];
  const takeName = () => names.splice(Math.floor(rng() * names.length), 1)[0] ?? 'Bot';
  const out: GroundRosterEntry[] = [];
  for (const team of [0, 1] as Team[]) {
    const classes = Array.from({ length: sizes[team] }, (_, i) => TEMPLATE[i % TEMPLATE.length]);
    const slots: (GroundRosterEntry | null)[] = classes.map(() => null);
    for (const hi of humans[team]) {
      const spec = VEHICLE_BY_ID[config.players[hi].vehicleId] ?? VEHICLES[0];
      let idx = classes.findIndex((c, i) => c === spec.cls && !slots[i]);
      if (idx < 0) idx = slots.findIndex((s) => !s);
      if (idx < 0) continue;
      slots[idx] = { team, spec, humanIndex: hi, name: config.players[hi].name ?? `P${hi + 1}` };
    }
    classes.forEach((c, i) => {
      if (!slots[i]) slots[i] = { team, spec: randomVehicle(c, rng, config.era), humanIndex: -1, name: takeName() };
    });
    out.push(...(slots as GroundRosterEntry[]));
  }
  return out;
}

/** How far behind the spawn line a class starts (artillery well back, lights forward). */
export function spawnDepth(cls: VehicleClass): number {
  switch (cls) {
    case 'LT':
      return 40;
    case 'SPG':
      return -90;
    case 'MSL':
      return -60;
    case 'SUP':
      return -20;
    case 'TT':
      return -40;
    default:
      return 0;
  }
}
