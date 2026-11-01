import { validSelection, copyLoadout, type ArchitectLoadout } from '../src/data/architectLoadout';
import { cleanAISelection, selectionError } from '../src/core/FleetSelection';
import { buildRoster, openPlay, rushPlay } from '../src/core/BattleSetup';
import { cleanRush } from '../src/modes/RushDifficulty';
import { makeRng, wrapAngle } from '../src/core/math';
import { MAP_HALF } from '../src/config';
import type { BattleConfig } from '../src/core/BattleSetup';
import type { Team } from '../src/core/types';
import { eraOf } from '../src/data/factions';
import { normalizeEras } from '../src/data/eras';
import { SHIP_BY_ID, shipsIn } from '../src/data/ships';
import { type Continuous, DEFAULT_SETTINGS, DUMMY_MODES, type DummyMode, type Edge, type LobbySettings, MAX_AI, MAX_DUMMIES, MAX_PER_TEAM, SANDBOX_CHEATS, type SandboxCheat, type SandboxCmd } from '../src/net/protocol';
import { MAPS } from '../src/world/GameMap';

// What a kind of battle decides on the LAN server: its settings, what captains may sail, which
// orders are valid, and the config every peer builds the battle from. The lobbies, the turn
// clock and the desync checks around it are the same for every kind (see lan.ts).

/** One captain sailing in a battle about to start. */
export interface Captain {
  architectLoadout?:ArchitectLoadout;
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
  /** The host ends battles of these settings (Free play, Sandbox, a co-op run); others end by themselves. */
  hostEnds(st: LobbySettings): boolean;
  /** Every captain sails on team 0 (Boss Rush, Survival): no team picks, and room for one fleet. */
  oneFleet(st: LobbySettings): boolean;
  /** The host's sandbox command with only its valid fields, clamped to the map, or null. */
  cleanSandbox(v: unknown): SandboxCmd | null;
}

const SHIP_ID = /^[A-Za-z0-9_-]{1,32}$/;

const isTeam = (v: unknown): v is Team => v === 0 || v === 1;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const smallInt = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Any ship in the game a captain could sail. */
const knownShip = (id: unknown): id is string => typeof id === 'string' && SHIP_ID.test(id) && Object.hasOwn(SHIP_BY_ID, id) && !SHIP_BY_ID[id].hidden;

/** A ship captains may pick under these settings: of one of the lobby's eras, and a titan only if allowed. Sandbox allows any. */
function shipAllowed(id: unknown, st: LobbySettings): id is string {
  if (!knownShip(id)) return false;
  if (st.type === 'sandbox') return true;
  const spec = SHIP_BY_ID[id];
  if (!st.eras.includes(eraOf(spec))) return false;
  return st.titans || spec.cls !== 'TT';
}

/** Naval battles: fleets of warships, picked by ship id. */
export const navalRules: BattleRules = {
  defaults: () => ({ ...DEFAULT_SETTINGS, ai: [...DEFAULT_SETTINGS.ai], eras: [...DEFAULT_SETTINGS.eras] }),

  applySettings(st, o) {
    if (o.type === 'domination' || o.type === 'annihilation' || o.type === 'convoy' || o.type === 'freeplay' || o.type === 'sandbox' || o.type === 'bossrush' || o.type === 'survival') st.type = o.type;
    if (typeof o.mapId === 'string' && MAPS.some((m) => m.id === o.mapId)) st.mapId = o.mapId;
    if (Array.isArray(o.ai) && o.ai.length === 2 && o.ai.every((n) => smallInt(n, MAX_AI))) st.ai = [o.ai[0], o.ai[1]];
    if (o.difficulty === 'easy' || o.difficulty === 'normal' || o.difficulty === 'hard') st.difficulty = o.difficulty;
    if (isTeam(o.escortTeam)) st.escortTeam = o.escortTeam;
    if (typeof o.titans === 'boolean') st.titans = o.titans;
    // A set needs an era with line ships to fill the fleets (Misc adds only its titans). The single
    // `era` of older clients still reads as a set of one, or of all for 'mixed'.
    const eras = normalizeEras(o.eras ?? (o as { era?: unknown }).era);
    if (eras) st.eras = eras;
    if (o.shiftTempo === 'burst' || o.shiftTempo === 'staggered' || o.shiftTempo === 'long') st.shiftTempo = o.shiftTempo;
    const rush = cleanRush(o.rush);
    if (rush) st.rush = rush;
    if (o.escorts === 0 || o.escorts === 2) st.escorts = o.escorts;
    const selection = cleanAISelection(o.aiSelection ?? st.aiSelection, st.eras, st.titans);
    if (selection) st.aiSelection = selection;
  },

  pickAllowed: shipAllowed,

  /** The first line ship of the lobby's eras. */
  defaultPick: (st) => shipsIn(st.eras).find((s) => s.cls !== 'TT')!.id,

  cleanContinuous(v) {
    if (!Array.isArray(v) || (v.length !== 5 && v.length !== 6) || !v.every(finite)) return null;
    const [r, x, z, f, t] = v as number[];
    const c: Continuous = [Math.max(-1, Math.min(1, r)), x, z, f ? 1 : 0, Number.isInteger(t) ? t : -1];
    if (v.length === 6) c.push(Math.max(0, Math.min(1200, v[5])));
    return c;
  },

  /** Edge orders as the battle allows them: Free play and Sandbox add the ship picker's, a co-op run the refit card. */
  cleanEdge(v, st) {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const e: Edge = {};
    if (openPlay(st.type)) {
      if (shipAllowed(o.sp, st)) e.sp = o.sp;
      if (o.rd === 1) e.rd = 1;
      const ar=o.ar as Edge['ar'];if(ar&&smallInt(ar.index,9)&&validSelection(ar.pick))e.ar={index:ar.index,pick:{...ar.pick}};
    }
    if (rushPlay(st.type) && smallInt(o.rc, 2)) e.rc = o.rc;
    if (o.tu === 1) e.tu = 1;
    if (o.td === 1) e.td = 1;
    if (smallInt(o.sl, 8)) e.sl = o.sl;
    if (smallInt(o.sk, 16)) e.sk = o.sk;
    if (smallInt(o.co, 8)) e.co = o.co;
    if(o.hd===1)e.hd=1;
    if(o.mb===1)e.mb=1;
    if (o.du === 1) e.du = 1;
    if (o.dd === 1) e.dd = 1;
    return Object.keys(e).length ? e : null;
  },

  holdFire: (c) => { const held: Continuous = [...c]; held[3] = 0; return held; },

  startError(st, captains) {
    // A sandbox has no fleets to fill: its captains sail alone until they spawn dummies.
    if (st.type === 'sandbox') return null;
    // A co-op run is its captains against the waves: one fleet of them.
    if (rushPlay(st.type)) {
      const mode = st.type === 'survival' ? 'Survival' : 'Boss Rush';
      if (!captains.length) return `${mode} needs a captain`;
      return captains.length > MAX_PER_TEAM ? `${mode} takes up to ${MAX_PER_TEAM} captains` : null;
    }
    const error = selectionError(st.aiSelection, st.eras, st.titans, st.ai);
    if (error) return error;
    // Every other battle is decided by one fleet running out of ships (or never meeting one).
    if (openPlay(st.type)) return null;
    const empty = ([0, 1] as Team[]).find((t) => st.ai[t] === 0 && !captains.some((c) => c.team === t));
    return empty === undefined ? null : `Team ${empty === 0 ? 'A' : 'B'} has no ships: add AI ships or a captain.`;
  },

  config(st, captains, seed) {
    if (rushPlay(st.type)) {
      return {
        mode: 'lan',
        type: st.type,
        mapId: st.mapId,
        teamSize: 1,
        difficulty: st.difficulty,
        seed,
        rush: st.rush ? structuredClone(st.rush) : undefined,
        escorts: st.escorts,
        shiftTempo: st.shiftTempo,
        eras: [...st.eras],
        players: captains.map((c) => ({ shipId: c.pick, architectLoadout: copyLoadout(c.architectLoadout), device: 'mouse', team: 0, name: c.name })),
      };
    }
    const sandbox = st.type === 'sandbox';
    const config: BattleConfig = {
      mode: 'lan',
      type: st.type,
      mapId: st.mapId,
      // Unused once `ai` is set.
      teamSize: 1,
      ai: sandbox ? [0, 0] : [st.ai[0], st.ai[1]],
      aiSelection: st.aiSelection && !sandbox ? structuredClone(st.aiSelection) : undefined,
      shiftTempo: st.shiftTempo,
      titans: st.titans,
      difficulty: st.difficulty,
      seed,
      convoySide: st.escortTeam === 0 ? 'escort' : 'raid',
      eras: [...st.eras],
      players: captains.map((c) => ({ shipId: c.pick, architectLoadout:copyLoadout(c.architectLoadout), device: 'mouse', team: c.team, name: c.name })),
    };
    const roster = buildRoster(config, makeRng(seed));
    config.resolvedAI = [0, 1].map(t => roster.filter(r => r.team === t && r.humanIndex < 0).map(r => r.spec.id)) as [string[], string[]];
    return config;
  },

  hostEnds: (st) => openPlay(st.type) || rushPlay(st.type),

  oneFleet: (st) => rushPlay(st.type),

  cleanSandbox(v) {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    switch (o.k) {
      case 'cheat':
        return SANDBOX_CHEATS.includes(o.cheat as SandboxCheat) && typeof o.on === 'boolean' ? { k: 'cheat', cheat: o.cheat as SandboxCheat, on: o.on } : null;
      case 'spawn': {
        const { ship, n, team, x, z, heading } = o;
        if (!knownShip(ship) || !Number.isInteger(n) || (n as number) < 1 || !isTeam(team) || !finite(x) || !finite(z) || !finite(heading)) return null;
        const map = (v: number) => Math.max(-MAP_HALF, Math.min(MAP_HALF, v));
        return { k: 'spawn', ship, n: Math.min(n as number, MAX_DUMMIES), team, x: map(x), z: map(z), heading: wrapAngle(heading) };
      }
      case 'mode':
        return DUMMY_MODES.includes(o.mode as DummyMode) ? { k: 'mode', mode: o.mode as DummyMode } : null;
      case 'respawn':
        return { k: 'respawn' };
      case 'clear':
        return { k: 'clear' };
    }
    return null;
  },
};
