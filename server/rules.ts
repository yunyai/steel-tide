import type { BattleConfig } from '../src/core/BattleSetup';
import type { Team } from '../src/core/types';
import { eraOf } from '../src/data/factions';
import { LINE_ERAS, SHIP_BY_ID, shipsIn } from '../src/data/ships';
import { type Continuous, DEFAULT_SETTINGS, type Edge, type LobbySettings, MAX_AI } from '../src/net/protocol';
import { MAPS } from '../src/world/GameMap';

// What a kind of battle decides on the LAN server: its settings, what captains may sail, which
// orders are valid, and the config every peer builds the battle from. The lobbies, the turn
// clock and the desync checks around it are the same for every kind (see lan.ts).

/** One captain sailing in a battle about to start. */
export interface Captain {
  pick: string;
  team: Team;
  name: string;
}

export interface BattleRules {
  /** Settings for a new lobby. */
  defaults(): LobbySettings;
  /** Apply the host's settings patch, keeping only the valid fields. */
  applySettings(st: LobbySettings, patch: Record<string, unknown>): void;
  /** What captains may sail under these settings. */
  pickAllowed(pick: unknown, st: LobbySettings): pick is string;
  /** What a captain sails when their pick is not allowed. */
  defaultPick(st: LobbySettings): string;
  cleanContinuous(v: unknown): Continuous | null;
  cleanEdge(v: unknown, st: LobbySettings): Edge | null;
  /** The same orders with firing held off, for a captain gone quiet. */
  holdFire(c: Continuous): Continuous;
  /** Why these captains cannot start under these settings, or null when they can. */
  startError(st: LobbySettings, captains: Captain[]): string | null;
  /** The config every peer builds the battle from. */
  config(st: LobbySettings, captains: Captain[], seed: number): BattleConfig;
  /** The host ends battles of these settings (Free play); others end by themselves. */
  hostEnds(st: LobbySettings): boolean;
}

const SHIP_ID = /^[a-z0-9_-]{1,32}$/;

const isTeam = (v: unknown): v is Team => v === 0 || v === 1;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const smallInt = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** A ship captains may pick under these settings: of the lobby's era, and a titan only if allowed. */
function shipAllowed(id: unknown, st: LobbySettings): id is string {
  if (typeof id !== 'string' || !SHIP_ID.test(id) || !Object.hasOwn(SHIP_BY_ID, id)) return false;
  const spec = SHIP_BY_ID[id];
  if (spec.hidden || (st.era !== 'mixed' && eraOf(spec) !== st.era)) return false;
  return st.titans || spec.cls !== 'TT';
}

/** Naval battles: fleets of warships, picked by ship id. */
export const navalRules: BattleRules = {
  defaults: () => ({ ...DEFAULT_SETTINGS, ai: [...DEFAULT_SETTINGS.ai] }),

  applySettings(st, o) {
    if (o.type === 'domination' || o.type === 'annihilation' || o.type === 'convoy' || o.type === 'freeplay') st.type = o.type;
    if (typeof o.mapId === 'string' && MAPS.some((m) => m.id === o.mapId)) st.mapId = o.mapId;
    if (Array.isArray(o.ai) && o.ai.length === 2 && o.ai.every((n) => smallInt(n, MAX_AI))) st.ai = [o.ai[0], o.ai[1]];
    if (o.difficulty === 'easy' || o.difficulty === 'normal' || o.difficulty === 'hard') st.difficulty = o.difficulty;
    if (isTeam(o.escortTeam)) st.escortTeam = o.escortTeam;
    if (typeof o.titans === 'boolean') st.titans = o.titans;
    // Only eras with line ships to fill the fleets (Misc's lone titan sails in Mixed).
    if (o.era === 'mixed' || LINE_ERAS.includes(o.era as never)) st.era = o.era as LobbySettings['era'];
  },

  pickAllowed: shipAllowed,

  /** The era's first line ship. */
  defaultPick: (st) => shipsIn(st.era).find((s) => s.cls !== 'TT')!.id,

  cleanContinuous(v) {
    if (!Array.isArray(v) || v.length !== 5 || !v.every(finite)) return null;
    const [r, x, z, f, t] = v as number[];
    return [Math.max(-1, Math.min(1, r)), x, z, f ? 1 : 0, Number.isInteger(t) ? t : -1];
  },

  /** Edge orders as the battle allows them: Free play adds the ship picker's. */
  cleanEdge(v, st) {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const e: Edge = {};
    if (st.type === 'freeplay') {
      if (shipAllowed(o.sp, st)) e.sp = o.sp;
      if (o.rd === 1) e.rd = 1;
    }
    if (o.tu === 1) e.tu = 1;
    if (o.td === 1) e.td = 1;
    if (smallInt(o.sl, 8)) e.sl = o.sl;
    if (smallInt(o.sk, 16)) e.sk = o.sk;
    if (smallInt(o.co, 8)) e.co = o.co;
    if (o.du === 1) e.du = 1;
    if (o.dd === 1) e.dd = 1;
    return Object.keys(e).length ? e : null;
  },

  holdFire: (c) => (c[3] ? [c[0], c[1], c[2], 0, c[4]] : c),

  startError(st, captains) {
    // Every other battle is decided by one fleet running out of ships (or never meeting one).
    if (st.type === 'freeplay') return null;
    const empty = ([0, 1] as Team[]).find((t) => st.ai[t] === 0 && !captains.some((c) => c.team === t));
    return empty === undefined ? null : `Team ${empty === 0 ? 'A' : 'B'} has no ships: add AI ships or a captain.`;
  },

  config(st, captains, seed) {
    return {
      mode: 'lan',
      type: st.type,
      mapId: st.mapId,
      // Unused once `ai` is set.
      teamSize: 1,
      ai: [st.ai[0], st.ai[1]],
      titans: st.titans,
      difficulty: st.difficulty,
      seed,
      convoySide: st.escortTeam === 0 ? 'escort' : 'raid',
      era: st.era,
      players: captains.map((c) => ({ shipId: c.pick, device: 'mouse', team: c.team, name: c.name })),
    };
  },

  hostEnds: (st) => st.type === 'freeplay',
};
