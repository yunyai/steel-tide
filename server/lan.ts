import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server as NetServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Server as TlsServer } from 'node:tls';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { BattleConfig } from '../src/core/BattleSetup';
import type { Team } from '../src/core/types';
import { ERAS, eraOf } from '../src/data/factions';
import { SHIP_BY_ID, shipsIn } from '../src/data/ships';
import { MAPS } from '../src/world/GameMap';
import {
  AI_TAKEOVER_MS,
  type ClientMsg,
  type Continuous,
  DEFAULT_SETTINGS,
  type Edge,
  END_GRACE_MS,
  IDLE_MS,
  LAN_PATH,
  LOBBY_NAME_MAX,
  type LobbySettings,
  type LobbyState,
  type LobbySummary,
  MAX_PER_TEAM,
  NAME_MAX,
  type ServerMsg,
  TURN_MS,
  TURN_TICKS,
  type Turn,
  type TurnEvent,
} from '../src/net/protocol';

// LAN lobby server. It holds the lobbies and, once a battle starts, clocks lockstep turns:
// every TURN_MS it bundles each captain's latest orders and sends the bundle to all of them.
// It never simulates; every browser runs the battle itself from the same seed and turns.

export interface LanOptions {
  /** Addresses friends can open, shown in the lobby. */
  urls?: () => string[];
  turnMs?: number;
  aiTakeoverMs?: number;
  idleMs?: number;
  endGraceMs?: number;
  /** How long a starting battle waits for slow loaders. */
  loadTimeoutMs?: number;
}

/** One browser tab's link to the server. */
export interface Peer {
  send(m: ServerMsg): void;
  session: Session | null;
}

interface Session {
  id: string;
  token: string;
  name: string;
  peer: Peer | null;
  lobby: Lobby | null;
  /** When a waiting-room member who lost their connection is dropped. */
  dropTimer: ReturnType<typeof setTimeout> | null;
}

interface MemberState {
  session: Session;
  team: Team;
  shipId: string;
  ready: boolean;
  player: number;
}

interface Lobby {
  id: string;
  name: string;
  host: Session;
  settings: LobbySettings;
  members: MemberState[];
  battle: Battle | null;
}

interface PlayerInput {
  session: Session;
  cont: Continuous | null;
  sent: Continuous | null;
  edges: Edge[];
  lastIn: number;
  loaded: boolean;
  over: boolean;
  /** Sailed by the AI since the connection dropped or the captain left. */
  ai: boolean;
  /** Still in the lobby (false once they leave; their ship stays with the AI). */
  present: boolean;
  takeover: ReturnType<typeof setTimeout> | null;
  lastDesync: number;
}

interface Battle {
  config: BattleConfig;
  players: PlayerInput[];
  turns: Turn[];
  events: TurnEvent[];
  clock: ReturnType<typeof setTimeout> | null;
  loadTimer: ReturnType<typeof setTimeout> | null;
  endTimer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  /** Last time any captain was connected. */
  lastManned: number;
  /** Turn hashes by turn: what each player reported, and the agreed one once decided. */
  hashes: Map<number, { by: Map<number, number>; agreed: number | null }>;
}

const DESYNC_COOLDOWN = 10000;
const ABANDON_MS = 60000;
const MAX_BATTLE_MS = 60 * 60 * 1000;
const SHIP_ID = /^[a-z0-9_-]{1,32}$/;

function id(bytes = 6): string {
  return randomBytes(bytes).toString('hex');
}

function cleanName(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return s || fallback;
}

/** A ship captains may pick under these settings: of the lobby's era, and a titan only if allowed. */
function shipAllowed(id: unknown, st: LobbySettings): id is string {
  if (typeof id !== 'string' || !SHIP_ID.test(id) || !Object.hasOwn(SHIP_BY_ID, id)) return false;
  const spec = SHIP_BY_ID[id];
  if (spec.hidden || (st.era !== 'mixed' && eraOf(spec) !== st.era)) return false;
  return st.titans || spec.cls !== 'TT';
}

/** The ship a captain is put in when theirs is not allowed: the era's first line ship. */
function defaultShip(st: LobbySettings): string {
  return shipsIn(st.era).find((s) => s.cls !== 'TT')!.id;
}

const isTeam = (v: unknown): v is Team => v === 0 || v === 1;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const smallInt = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

function cleanContinuous(v: unknown): Continuous | null {
  if (!Array.isArray(v) || v.length !== 5 || !v.every(finite)) return null;
  const [r, x, z, f, t] = v as number[];
  return [Math.max(-1, Math.min(1, r)), x, z, f ? 1 : 0, Number.isInteger(t) ? t : -1];
}

function cleanEdge(v: unknown): Edge | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const e: Edge = {};
  if (o.tu === 1) e.tu = 1;
  if (o.td === 1) e.td = 1;
  if (smallInt(o.sl, 8)) e.sl = o.sl;
  if (smallInt(o.sk, 16)) e.sk = o.sk;
  if (smallInt(o.co, 8)) e.co = o.co;
  if (o.du === 1) e.du = 1;
  if (o.dd === 1) e.dd = 1;
  return Object.keys(e).length ? e : null;
}

export class LobbyServer {
  private sessions = new Map<string, Session>();
  private lobbies = new Map<string, Lobby>();
  private readonly turnMs: number;
  private readonly aiTakeoverMs: number;
  private readonly idleMs: number;
  private readonly endGraceMs: number;
  private readonly loadTimeoutMs: number;

  constructor(private opts: LanOptions = {}) {
    this.turnMs = opts.turnMs ?? TURN_MS;
    this.aiTakeoverMs = opts.aiTakeoverMs ?? AI_TAKEOVER_MS;
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.endGraceMs = opts.endGraceMs ?? END_GRACE_MS;
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 15000;
  }

  connect(send: (m: ServerMsg) => void): Peer {
    return { send, session: null };
  }

  /** Shut every battle clock down (server closing, tests). */
  close(): void {
    for (const l of this.lobbies.values()) if (l.battle) this.stopClock(l.battle);
    for (const s of this.sessions.values()) if (s.dropTimer) clearTimeout(s.dropTimer);
  }

  receive(peer: Peer, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const m = raw as ClientMsg;
    if (m.t === 'hello') return this.hello(peer, m);
    const s = peer.session;
    if (!s || s.peer !== peer) return;
    switch (m.t) {
      case 'name':
        s.name = cleanName(m.name, NAME_MAX, s.name);
        if (s.lobby) this.pushLobby(s.lobby);
        return;
      case 'create':
        return this.create(s, m.name);
      case 'join':
        return this.join(s, m.lobby);
      case 'leave':
        this.leave(s);
        this.send(s, { t: 'lobby', lobby: null });
        this.send(s, { t: 'lobbies', list: this.summaries() });
        return;
      case 'settings':
        return this.settings(s, m.s);
      case 'me':
        return this.me(s, m);
      case 'start':
        return this.start(s);
      case 'loaded':
        return this.loaded(s);
      case 'in':
        return this.input(s, m);
      case 'hash':
        return this.hash(s, m.k, m.h);
      case 'over':
        return this.over(s);
      case 'resync':
        return this.sendLog(s);
    }
  }

  /** The socket closed. A session survives a while so a reload or a Wi-Fi blip can rejoin. */
  disconnect(peer: Peer): void {
    const s = peer.session;
    if (!s || s.peer !== peer) return;
    s.peer = null;
    const l = s.lobby;
    if (!l) {
      this.sessions.delete(s.token);
      return;
    }
    const p = this.playerOf(s);
    if (p && !p.ai) {
      // Fire is released at once (the idle rule); the AI takes the ship if they stay away.
      p.takeover = setTimeout(() => this.handToAI(l.battle!, p), this.aiTakeoverMs);
    }
    if (!p) s.dropTimer = setTimeout(() => this.forget(s), this.aiTakeoverMs);
    this.pushLobby(l);
  }

  // ---------------------------------------------------------------- sessions and lobbies

  private hello(peer: Peer, m: Extract<ClientMsg, { t: 'hello' }>): void {
    const known = typeof m.token === 'string' ? this.sessions.get(m.token) : undefined;
    let s: Session;
    if (known) {
      s = known;
      if (s.peer && s.peer !== peer) {
        s.peer.send({ t: 'error', text: 'This captain is now playing in another tab.' });
        s.peer.session = null;
      }
      if (s.dropTimer) clearTimeout(s.dropTimer);
      s.dropTimer = null;
    } else {
      s = { id: id(), token: id(16), name: '', peer: null, lobby: null, dropTimer: null };
      this.sessions.set(s.token, s);
    }
    s.name = cleanName(m.name, NAME_MAX, s.name || 'Captain');
    s.peer = peer;
    peer.session = s;
    this.send(s, { t: 'welcome', id: s.id, token: s.token, urls: this.opts.urls?.() ?? [] });
    const l = s.lobby;
    if (!l) {
      this.send(s, { t: 'lobbies', list: this.summaries() });
      return;
    }
    this.pushLobby(l);
    const p = this.playerOf(s);
    if (p && l.battle) {
      if (p.takeover) clearTimeout(p.takeover);
      p.takeover = null;
      if (p.ai) {
        p.ai = false;
        l.battle.events.push({ human: l.battle.players.indexOf(p) });
      }
      p.lastIn = Date.now();
      this.sendLog(s);
    }
  }

  private forget(s: Session): void {
    if (s.peer) return;
    this.leave(s);
    this.sessions.delete(s.token);
  }

  private summaries(): LobbySummary[] {
    return [...this.lobbies.values()].map((l) => ({
      id: l.id,
      name: l.name,
      host: l.host.name,
      type: l.settings.type,
      mapId: l.settings.mapId,
      era: l.settings.era,
      captains: l.members.length,
      state: l.battle ? 'battle' : 'waiting',
    }));
  }

  /** Lobby list to everyone browsing it. */
  private pushList(): void {
    const list = this.summaries();
    for (const s of this.sessions.values()) if (!s.lobby) this.send(s, { t: 'lobbies', list });
  }

  private stateOf(l: Lobby): LobbyState {
    const b = l.battle;
    return {
      id: l.id,
      name: l.name,
      host: l.host.id,
      settings: { ...l.settings },
      members: l.members.map((m) => ({
        id: m.session.id,
        name: m.session.name,
        team: m.team,
        shipId: m.shipId,
        ready: m.ready,
        connected: m.session.peer !== null,
        player: m.player,
      })),
      state: b ? 'battle' : 'waiting',
      loaded: b ? b.players.filter((p) => p.loaded).length : 0,
    };
  }

  private pushLobby(l: Lobby): void {
    const lobby = this.stateOf(l);
    for (const m of l.members) this.send(m.session, { t: 'lobby', lobby });
    this.pushList();
  }

  private create(s: Session, name: unknown): void {
    this.leave(s);
    const l: Lobby = {
      id: id(4),
      name: cleanName(name, LOBBY_NAME_MAX, `${s.name}'s fleet`),
      host: s,
      settings: { ...DEFAULT_SETTINGS },
      members: [],
      battle: null,
    };
    this.lobbies.set(l.id, l);
    this.addMember(l, s);
  }

  private join(s: Session, lobbyId: unknown): void {
    const l = typeof lobbyId === 'string' ? this.lobbies.get(lobbyId) : undefined;
    if (!l) return this.send(s, { t: 'error', text: 'That lobby has closed.' });
    if (s.lobby === l) return this.pushLobby(l);
    if (l.members.length >= MAX_PER_TEAM * 2) return this.send(s, { t: 'error', text: 'That lobby is full.' });
    this.leave(s);
    this.addMember(l, s);
  }

  private addMember(l: Lobby, s: Session): void {
    const count = (t: Team) => l.members.filter((m) => m.team === t).length;
    const team: Team = count(0) <= count(1) ? 0 : 1;
    l.members.push({ session: s, team, shipId: defaultShip(l.settings), ready: false, player: -1 });
    s.lobby = l;
    this.pushLobby(l);
  }

  private leave(s: Session): void {
    const l = s.lobby;
    if (!l) return;
    s.lobby = null;
    const p = this.playerOf(s, l);
    l.members = l.members.filter((m) => m.session !== s);
    if (p && l.battle) {
      p.present = false;
      if (p.takeover) clearTimeout(p.takeover);
      this.handToAI(l.battle, p);
    }
    if (!l.members.length) {
      if (l.battle) this.stopClock(l.battle);
      this.lobbies.delete(l.id);
      this.pushList();
      return;
    }
    if (l.host === s) l.host = l.members[0].session;
    if (l.battle && !l.battle.players.some((x) => x.present && x.session.peer)) return this.finish(l);
    this.pushLobby(l);
  }

  private member(s: Session): MemberState | undefined {
    return s.lobby?.members.find((m) => m.session === s);
  }

  private settings(s: Session, v: unknown): void {
    const l = s.lobby;
    if (!l || l.host !== s || l.battle || !v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const st = l.settings;
    if (o.type === 'domination' || o.type === 'annihilation' || o.type === 'convoy') st.type = o.type;
    if (typeof o.mapId === 'string' && MAPS.some((m) => m.id === o.mapId)) st.mapId = o.mapId;
    if (Number.isInteger(o.teamSize) && (o.teamSize as number) >= 3 && (o.teamSize as number) <= 8) st.teamSize = o.teamSize as number;
    if (o.difficulty === 'easy' || o.difficulty === 'normal' || o.difficulty === 'hard') st.difficulty = o.difficulty;
    if (isTeam(o.escortTeam)) st.escortTeam = o.escortTeam;
    if (typeof o.titans === 'boolean') st.titans = o.titans;
    if (o.era === 'mixed' || ERAS.includes(o.era as never)) st.era = o.era as LobbySettings['era'];
    for (const m of l.members) {
      m.ready = false;
      if (!shipAllowed(m.shipId, st)) m.shipId = defaultShip(st);
    }
    this.pushLobby(l);
  }

  private me(s: Session, m: Extract<ClientMsg, { t: 'me' }>): void {
    const l = s.lobby;
    const mem = this.member(s);
    if (!l || !mem) return;
    if (!l.battle) {
      if (isTeam(m.team) && m.team !== mem.team) {
        if (l.members.filter((x) => x.team === m.team).length >= MAX_PER_TEAM) return this.send(s, { t: 'error', text: 'That fleet is full.' });
        mem.team = m.team;
      }
      if (shipAllowed(m.shipId, l.settings)) mem.shipId = m.shipId;
    }
    if (typeof m.ready === 'boolean') mem.ready = m.ready;
    this.pushLobby(l);
  }

  // ---------------------------------------------------------------- battles

  private start(s: Session): void {
    const l = s.lobby;
    if (!l || l.host !== s || l.battle) return;
    const waiting = l.members.filter((m) => m.session !== s && m.session.peer && !m.ready);
    if (waiting.length) return this.send(s, { t: 'error', text: `Waiting for ${waiting.map((m) => m.session.name).join(', ')}.` });
    const sailing = l.members.filter((m) => m.session.peer);
    const st = l.settings;
    const ship = (m: MemberState) => (shipAllowed(m.shipId, st) ? m.shipId : defaultShip(st));
    const config: BattleConfig = {
      mode: 'lan',
      type: st.type,
      mapId: st.mapId,
      teamSize: st.teamSize,
      difficulty: st.difficulty,
      seed: randomBytes(4).readUInt32BE(0) % 1e9,
      convoySide: st.escortTeam === 0 ? 'escort' : 'raid',
      era: st.era,
      players: sailing.map((m) => ({ shipId: ship(m), device: 'mouse', team: m.team, name: m.session.name })),
    };
    const now = Date.now();
    const battle: Battle = {
      config,
      players: sailing.map((m) => ({ session: m.session, cont: null, sent: null, edges: [], lastIn: now, loaded: false, over: false, ai: false, present: true, takeover: null, lastDesync: -Infinity })),
      turns: [],
      events: [],
      clock: null,
      loadTimer: null,
      endTimer: null,
      startedAt: 0,
      lastManned: 0,
      hashes: new Map(),
    };
    l.battle = battle;
    for (const m of l.members) {
      m.player = sailing.indexOf(m);
      m.ready = false;
    }
    sailing.forEach((m, you) => this.send(m.session, { t: 'start', config, you }));
    battle.loadTimer = setTimeout(() => this.beginClock(l), this.loadTimeoutMs);
    this.pushLobby(l);
  }

  private playerOf(s: Session, l = s.lobby): PlayerInput | undefined {
    return l?.battle?.players.find((p) => p.session === s && p.present);
  }

  private loaded(s: Session): void {
    const l = s.lobby;
    const p = this.playerOf(s);
    if (!l || !p) return;
    p.loaded = true;
    this.pushLobby(l);
    if (l.battle!.players.every((x) => x.loaded || !x.present || !x.session.peer)) this.beginClock(l);
  }

  private beginClock(l: Lobby): void {
    const b = l.battle;
    if (!b || b.clock) return;
    if (b.loadTimer) clearTimeout(b.loadTimer);
    b.loadTimer = null;
    b.startedAt = b.lastManned = Date.now();
    const loop = () => {
      const now = Date.now();
      // Catch up after a stall, but never burst more than a few turns at once.
      for (let i = 0; i < 6 && b.startedAt + b.turns.length * this.turnMs <= now; i++) this.emitTurn(b, now);
      // Everyone has gone, or it has run for far too long: stop rather than clock turns for nobody.
      if (now - b.lastManned > ABANDON_MS || b.turns.length * this.turnMs > MAX_BATTLE_MS) return this.finish(l);
      b.clock = setTimeout(loop, Math.max(0, b.startedAt + b.turns.length * this.turnMs - Date.now()));
    };
    b.clock = setTimeout(loop, 0);
  }

  private stopClock(b: Battle): void {
    for (const t of [b.clock, b.loadTimer, b.endTimer]) if (t) clearTimeout(t);
    for (const p of b.players) if (p.takeover) clearTimeout(p.takeover);
    b.clock = b.loadTimer = b.endTimer = null;
  }

  private emitTurn(b: Battle, now: number): void {
    const turn: Turn = { k: b.turns.length };
    b.players.forEach((p, i) => {
      // Gone quiet (hidden tab, dropped link): stop shooting until they are back.
      if (p.cont && p.cont[3] && now - p.lastIn > this.idleMs) p.cont = [p.cont[0], p.cont[1], p.cont[2], 0, p.cont[4]];
      if (p.cont && (!p.sent || p.cont.some((v, j) => v !== p.sent![j]))) {
        (turn.p ??= []).push([i, p.cont]);
        p.sent = p.cont;
      }
      for (let tick = 0; tick < TURN_TICKS && p.edges.length; tick++) (turn.e ??= []).push([i, tick, p.edges.shift()!]);
    });
    if (b.events.length) {
      turn.ev = b.events;
      b.events = [];
    }
    b.turns.push(turn);
    for (const p of b.players) if (p.present) this.send(p.session, { t: 'turn', turn });
    if (b.players.some((p) => p.present && p.session.peer)) b.lastManned = now;
  }

  private input(s: Session, m: Extract<ClientMsg, { t: 'in' }>): void {
    const p = this.playerOf(s);
    if (!p) return;
    p.lastIn = Date.now();
    const c = cleanContinuous(m.c);
    if (c) p.cont = c;
    const e = cleanEdge(m.e);
    if (e && p.edges.length < 32) p.edges.push(e);
  }

  private handToAI(b: Battle, p: PlayerInput): void {
    p.takeover = null;
    if (p.ai) return;
    p.ai = true;
    p.edges = [];
    b.events.push({ ai: b.players.indexOf(p) });
  }

  private sendLog(s: Session): void {
    const b = s.lobby?.battle;
    const p = this.playerOf(s);
    if (!b || !p) return;
    this.send(s, { t: 'log', config: b.config, you: b.players.indexOf(p), turns: b.turns });
  }

  private hash(s: Session, k: unknown, h: unknown): void {
    const b = s.lobby?.battle;
    const p = this.playerOf(s);
    if (!b || !p || !Number.isInteger(k) || !Number.isInteger(h)) return;
    const idx = b.players.indexOf(p);
    let rec = b.hashes.get(k as number);
    if (!rec) {
      rec = { by: new Map(), agreed: null };
      b.hashes.set(k as number, rec);
      // Keep the last few checkpoints only.
      for (const old of b.hashes.keys()) if (old < (k as number) - 20 * 60) b.hashes.delete(old);
    }
    rec.by.set(idx, h as number);
    if (rec.agreed === null) {
      const voters = b.players.filter((x) => x.present && x.session.peer && !x.ai).map((x) => b.players.indexOf(x));
      if (!voters.every((v) => rec.by.has(v))) return;
      // Majority wins; a tie goes to the lowest player index (the earliest to join).
      const counts = new Map<number, number>();
      for (const v of [...rec.by.keys()].sort((a, c) => a - c)) counts.set(rec.by.get(v)!, (counts.get(rec.by.get(v)!) ?? 0) + 1);
      let best = -1;
      for (const [hv, n] of counts) if (best < 0 || n > counts.get(best)!) best = hv;
      rec.agreed = best;
      for (const [v, hv] of rec.by) if (hv !== best) this.desync(b.players[v]);
    } else if (h !== rec.agreed) this.desync(p);
  }

  private desync(p: PlayerInput): void {
    const now = Date.now();
    if (now - p.lastDesync < DESYNC_COOLDOWN) return;
    p.lastDesync = now;
    this.send(p.session, { t: 'desync' });
  }

  private over(s: Session): void {
    const l = s.lobby;
    const b = l?.battle;
    const p = this.playerOf(s);
    if (!l || !b || !p) return;
    p.over = true;
    if (!b.endTimer) b.endTimer = setTimeout(() => this.finish(l), this.endGraceMs);
    if (b.players.every((x) => x.over || !x.present || !x.session.peer)) this.finish(l);
  }

  /** The battle is over for everyone: back to the waiting room. */
  private finish(l: Lobby): void {
    const b = l.battle;
    if (!b) return;
    this.stopClock(b);
    l.battle = null;
    for (const p of b.players) if (p.present) this.send(p.session, { t: 'ended' });
    for (const m of l.members) {
      m.player = -1;
      m.ready = false;
    }
    // Members who never came back are dropped now.
    for (const m of [...l.members]) if (!m.session.peer) this.forget(m.session);
    if (this.lobbies.has(l.id)) this.pushLobby(l);
  }

  private send(s: Session, m: ServerMsg): void {
    s.peer?.send(m);
  }
}

/** Addresses friends can open: every non-internal IPv4 interface the server listens on. */
export function lanUrls(server: NetServer): string[] {
  const addr = server.address();
  if (!addr || typeof addr === 'string') return [];
  const scheme = server instanceof TlsServer ? 'https' : 'http';
  const any = addr.address === '0.0.0.0' || addr.address === '::';
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && (any || a.address === addr.address)) out.push(`${scheme}://${a.address}:${addr.port}`);
    }
  }
  return out;
}

/** Serve LAN lobbies on `/lan` of an existing HTTP server, leaving its other upgrades (Vite's HMR) alone. */
export function attachLan(server: NetServer, opts: LanOptions = {}): LobbyServer {
  const lobby = new LobbyServer({ urls: () => lanUrls(server), ...opts });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== LAN_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer = lobby.connect((m) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      });
      ws.on('message', (data, binary) => {
        if (binary) return;
        let msg: unknown;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        lobby.receive(peer, msg);
      });
      ws.on('close', () => lobby.disconnect(peer));
      ws.on('error', () => ws.terminate());
    });
  });
  server.on('close', () => {
    lobby.close();
    wss.close();
  });
  return lobby;
}
