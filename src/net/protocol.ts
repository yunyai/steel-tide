import type { ArchitectLoadout, ArchitectSelection } from '../data/architectLoadout';
export const SIM_PROTOCOL=9;
// LAN lobby and lockstep wire format, shared by the browser and the lobby server.
// Keep this file free of DOM and game imports: the server reads it too.

import type { TeamAISelection } from '../core/FleetSelection';
import type { ShiftTempo } from '../config';
import type { BattleConfig, BattleType, DifficultyId } from '../core/BattleSetup';
import type { BattleEra, Team } from '../core/types';

/** Sim steps per lockstep turn, and the server's turn period (30 turns a second at 60 Hz). */
export const TURN_TICKS = 2;
export const TURN_MS = 1000 / 30;
/** Every this many turns each peer reports a state hash, so drift is caught early. */
export const HASH_EVERY = 60;
/** A captain whose connection drops is handed to the AI after this long. */
export const AI_TAKEOVER_MS = 10000;
/** Fire is released when a connected captain has sent nothing for this long (hidden tab). */
export const IDLE_MS = 1000;
/** Turns keep coming this long after the first captain reports the battle over. */
export const END_GRACE_MS = 30000;
export const NAME_MAX = 24;
export const LOBBY_NAME_MAX = 32;
export const MAX_PER_TEAM = 8;
/** Most AI ships the host can add to one fleet. */
export const MAX_AI = 8;
/** Path of the lobby WebSocket on the game's own server. */
export const LAN_PATH = '/lan';
/** Seconds a LAN battle is clocked at most; Free play ends there for everyone (warned on the HUD before). */
export const LAN_BATTLE_LIMIT_S = 60 * 60;

/** Continuous orders: [rudder -1..1, aimX, aimZ, fire 0/1, targetId]. */
export type Continuous = [number, number, number, number, number, number?];

/** Edge orders, consumed by the tick they land on (see Ship.applyControl). */
export interface Edge {
  ar?:{index:number;pick:ArchitectSelection};
  /** Throttle up / down one step. */
  tu?: 1;
  td?: 1;
  /** Weapon slot, skill index, consumable index. */
  sl?: number;
  sk?: number;
  co?: number;
  /** Independent Vector mobility actions. */
  hd?:1;
  mb?:1;
  /** Submarine depth up / down. */
  du?: 1;
  dd?: 1;
  /** Free play: the ship to sail from the next respawn, and leave the fight now to change into it. */
  sp?: string;
  rd?: 1;
}

/**
 * Something every peer applies at the start of a turn: a captain handed to the AI or back, or
 * Free play ending (1: the host ended it; 2: it reached the server's time limit).
 */
export type TurnEvent = { ai: number } | { human: number } | { end: 1 | 2 };

/** One lockstep turn: changed continuous orders, edges by tick, and events. */
export interface Turn {
  k: number;
  /** [player index, orders] for captains whose orders changed. */
  p?: [number, Continuous][];
  /** [player index, tick within the turn, edge]. */
  e?: [number, number, Edge][];
  ev?: TurnEvent[];
}

export interface LobbySettings {
  type: Exclude<BattleType, 'bossrush' | 'survival'>;
  mapId: string;
  /** AI ships in each fleet, besides its captains (0..MAX_AI). */
  ai: [number, number];
  aiSelection?: TeamAISelection;
  shiftTempo?: ShiftTempo;
  difficulty: DifficultyId;
  /** Convoy: the fleet that escorts the transports. */
  escortTeam: Team;
  titans: boolean;
  /** Which era's ships everyone sails. */
  era: BattleEra;
}

export interface Member {
  architectLoadout?:ArchitectLoadout;
  id: string;
  name: string;
  team: Team;
  shipId: string;
  ready: boolean;
  connected: boolean;
  /** Player index in the running battle, or -1 (joined after it started). */
  player: number;
}

export interface LobbyState {
  id: string;
  name: string;
  host: string;
  settings: LobbySettings;
  members: Member[];
  state: 'waiting' | 'battle';
  /** Members that have built the battle (while starting). */
  loaded: number;
}

export interface LobbySummary {
  id: string;
  name: string;
  host: string;
  type: LobbySettings['type'];
  mapId: string;
  era: BattleEra;
  captains: number;
  state: LobbyState['state'];
}

export type ClientMsg =
  | { t: 'hello'; protocol?:number; name: string; token?: string }
  | { t: 'name'; name: string }
  | { t: 'create'; name: string }
  | { t: 'join'; lobby: string }
  | { t: 'leave' }
  | { t: 'settings'; s: Partial<LobbySettings> }
  | { t: 'me'; architectLoadout?:ArchitectLoadout; team?: Team; shipId?: string; ready?: boolean }
  | { t: 'start' }
  | { t: 'loaded' }
  | { t: 'in'; c?: Continuous; e?: Edge }
  | { t: 'hash'; k: number; h: number }
  | { t: 'over' }
  | { t: 'end' }
  | { t: 'resync' };

export type ServerMsg =
  | { t: 'welcome'; id: string; token: string; urls: string[] }
  | { t: 'lobbies'; list: LobbySummary[] }
  | { t: 'lobby'; lobby: LobbyState | null }
  | { t: 'start'; config: BattleConfig; you: number }
  | { t: 'turn'; turn: Turn }
  | { t: 'log'; config: BattleConfig; you: number; turns: Turn[] }
  | { t: 'desync' }
  | { t: 'ended' }
  | { t: 'error'; text: string };

export const DEFAULT_SETTINGS: LobbySettings = {
  type: 'domination',
  mapId: 'strait',
  ai: [5, 5],
  difficulty: 'normal',
  escortTeam: 0,
  titans: true,
  era: 'historic',
};
