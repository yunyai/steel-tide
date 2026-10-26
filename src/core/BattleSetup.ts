import { selectedAI, selectionError, type TeamAISelection } from './FleetSelection';
import type { InputDeviceId, ShiftTempo } from '../config';
import { SHIPS, SHIP_BY_ID, shipsIn } from '../data/ships';
import { pick } from './math';
import type { BattleEra, ShipClass, ShipSpec, Team } from './types';

/** One captain at this screen, or several on a LAN (each peer runs the same battle in lockstep). */
export type BattleMode = 'solo' | 'lan';
/** Free play: no score to win and no clock; every ship comes back, and captains may change ship. */
export type BattleType = 'domination' | 'annihilation' | 'convoy' | 'freeplay' | 'bossrush' | 'survival';
/** Convoy: your team guards the cargo ships, or hunts them. */
export type ConvoySide = 'escort' | 'raid';
export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface PlayerConfig {
  shipId: string;
  device: InputDeviceId;
  /** Fire-control assist: the aim leads and is pulled toward a target near the crosshair. */
  assist?: boolean;
  /** Fleet the captain sails with (0 unless set; LAN captains pick theirs). */
  team?: Team;
  /** Captain's name on markers and scoreboards (LAN). */
  name?: string;
}

/** Assist defaults on for keyboard and gamepad captains, off for the mouse. */
export function defaultAssist(device: InputDeviceId): boolean {
  return device !== 'mouse';
}

export interface BattleConfig {
  /** Naval when absent: ground battles carry `kind: 'ground'` (see ground/sim/setup). */
  kind?: 'naval';
  mode: BattleMode;
  type: BattleType;
  mapId: string;
  teamSize: number;
  difficulty: DifficultyId;
  players: PlayerConfig[];
  seed: number;
  /** Boss Rush: AI escorts sailing with the player (0 or 2). */
  escorts?: number;
  /** Convoy: which side of it the player's team is on (escort by default). */
  convoySide?: ConvoySide;
  /** Which era's ships the bots sail (historic by default). */
  era?: BattleEra;
  /** AI ships per fleet, besides its captains (0..8). When set it replaces `teamSize`. */
  ai?: [number, number];
  aiSelection?: TeamAISelection;
  /** Server-resolved bot picks, in team/AI slot order, shared by all peers. */
  resolvedAI?: [string[], string[]];
  /** Free play: whether captains may change into a titan (allowed unless false). */
  titans?: boolean;
  /** How Titan Shift forms run (staggered by default; see SHIFT_TEMPOS). */
  shiftTempo?: ShiftTempo;
}

export interface RosterEntry {
  team: Team;
  spec: ShipSpec;
  humanIndex: number;
  name: string;
}

export type Group = 'BB' | 'cruiser' | 'DD' | 'CV' | 'SS';
const TEMPLATE: Group[] = ['BB', 'DD', 'cruiser', 'BB', 'cruiser', 'DD', 'CV', 'SS'];

export function groupOf(cls: ShipClass): Group {
  if (cls === 'CB' || cls === 'CA' || cls === 'CL') return 'cruiser';
  // A titan takes a battleship's place in the line.
  if (cls === 'TT') return 'BB';
  if (cls === 'AK') return 'cruiser';
  return cls;
}

/** A random ship of a group from the era (titans are never handed out at random). */
export function randomOf(g: Group, rng: () => number, era: BattleEra = 'historic'): ShipSpec {
  const fits = (s: ShipSpec) => s.cls !== 'TT' && groupOf(s.cls) === g;
  const pool = shipsIn(era).filter(fits);
  if (pool.length) return pick(pool, rng);
  // An era short of a class (Misc, say) fills the slot from its own line first; anime now fields every class.
  const line = shipsIn(era).filter((s) => s.cls !== 'TT');
  return pick(line.length ? line : SHIPS.filter(fits), rng);
}

const CAPTAINS = [
  'Halsey', 'Yamamoto', 'Lütjens', 'Cunningham', 'Burke', 'Nagumo', 'Spruance', 'Tovey', 'Kurita',
  'Fraser', 'Mitscher', 'Lee', 'Ozawa', 'Raeder', 'Somerville', 'Kinkaid', 'Tanaka', 'Oldendorf',
  'Vian', 'Ainsworth', 'Kondo', 'Harwood', 'Scott', 'Mikawa',
];

/** Most human captains one fleet can hold. */
export const MAX_HUMANS_PER_TEAM = 8;

/** Builds mirrored team compositions; humans replace a slot of their ship's class. */
export function buildRoster(config: BattleConfig, rng: () => number): RosterEntry[] {
  const error = selectionError(config.aiSelection, config.era, config.titans !== false, config.ai);
  if (error) throw new Error(error);
  const size = Math.max(1, Math.min(8, config.teamSize));
  const out: RosterEntry[] = [];
  const humansByTeam: [number[], number[]] = [[], []];
  config.players.forEach((p, i) => {
    const list = humansByTeam[p.team === 1 ? 1 : 0];
    if (list.length < MAX_HUMANS_PER_TEAM) list.push(i);
  });
  // Every titan a human brings is answered by two extra ships in the other fleet.
  const titans = (t: Team) => humansByTeam[t].filter((i) => SHIP_BY_ID[config.players[i].shipId]?.cls === 'TT').length;
  const sizes: [number, number] = [0, 0];
  for (const t of [0, 1] as Team[]) {
    const other: Team = t === 0 ? 1 : 0;
    if (config.ai) {
      // Set AI counts: a fleet with no AI ships has only its captains, titans or not.
      const bots = Math.max(0, Math.min(8, Math.floor(config.ai[t] || 0)));
      sizes[t] = humansByTeam[t].length + bots + (bots > 0 ? titans(other) * 2 : 0);
    } else sizes[t] = Math.max(size, humansByTeam[t].length) + titans(other) * 2;
  }
  const names = [...CAPTAINS];
  const takeName = () => names.splice(Math.floor(rng() * names.length), 1)[0] ?? 'Bot';

  for (const team of [0, 1] as Team[]) {
    const groups = Array.from({ length: sizes[team] }, (_, i) => TEMPLATE[i % TEMPLATE.length]);
    const slots: (RosterEntry | null)[] = groups.map(() => null);
    for (const hi of humansByTeam[team]) {
      const spec = SHIP_BY_ID[config.players[hi].shipId] ?? SHIPS[0];
      let idx = groups.findIndex((g, i) => g === groupOf(spec.cls) && !slots[i]);
      if (idx < 0) idx = slots.findIndex((s) => !s || s.humanIndex < 0);
      if (idx < 0) continue;
      slots[idx] = { team, spec, humanIndex: hi, name: config.players[hi].name ?? `P${hi + 1}` };
    }
    let botIndex = 0;
    groups.forEach((g, i) => {
      if (slots[i]) return;
      const chosen = selectedAI(config.aiSelection?.[team], botIndex, config.era ?? 'historic', config.titans !== false, rng, () => randomOf(g, rng, config.era));
      const id = config.resolvedAI?.[team][botIndex++];
      const spec = id && Object.hasOwn(SHIP_BY_ID, id) ? SHIP_BY_ID[id] : chosen;
      slots[i] = { team, spec, humanIndex: -1, name: takeName() };
    });
    out.push(...(slots as RosterEntry[]));
  }
  return out;
}

/** Spawn layout: destroyers forward, carriers far back. */
export function spawnOffset(spec: ShipSpec): number {
  switch (spec.cls) {
    case 'DD':
      return 450;
    case 'SS':
      return 350;
    case 'CV':
      return -800;
    case 'BB':
      return -200;
    default:
      return 100;
  }
}
