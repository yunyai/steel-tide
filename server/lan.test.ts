import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientMsg, LobbyState, SandboxCmd, ServerMsg, Turn } from '../src/net/protocol';
import { MAX_DUMMIES, SIM_PROTOCOL } from '../src/net/protocol';
import { ERAS, eraOf } from '../src/data/factions';
import { SHIPS, SHIP_BY_ID } from '../src/data/ships';
import { readFileSync } from 'node:fs';
import { attachLan, deliver, type LanOptions, LobbyServer } from './lan';
import { navalRules } from './rules';

// The lobby server over real sockets, with its clocks sped up.

const FAST: LanOptions = { turnMs: 10, aiTakeoverMs: 120, idleMs: 60, endGraceMs: 300, loadTimeoutMs: 400, awayAiMs: 120 };

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

class Client {
  readonly inbox: ServerMsg[] = [];
  /** Per message type, how far `next` has read the inbox. */
  private read = new Map<string, number>();
  private waiters: { t: string; pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.inbox.push(m);
      const i = this.inbox.length - 1;
      this.waiters = this.waiters.filter((w) => {
        if (w.t !== m.t || i < (this.read.get(w.t) ?? 0) || !w.pred(m)) return true;
        this.read.set(w.t, i + 1);
        w.resolve(m);
        return false;
      });
    });
  }

  static async open(port: number, name: string, token?: string, origin?: string): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lan`, origin ? { origin } : {});
    await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
    const c = new Client(ws);
    c.send({ t: 'hello', protocol:SIM_PROTOCOL, name, token });
    await c.next('welcome');
    return c;
  }

  send(m: ClientMsg | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }

  /** The first message of type `t` past the last one `next` returned for `t` that passes `pred`. */
  next<T extends ServerMsg['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, ms = 2000): Promise<Msg<T>> {
    const test = (m: ServerMsg) => m.t === t && pred(m as Msg<T>);
    for (let i = this.read.get(t) ?? 0; i < this.inbox.length; i++) {
      if (!test(this.inbox[i])) continue;
      this.read.set(t, i + 1);
      return Promise.resolve(this.inbox[i] as Msg<T>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${t}`)), ms);
      this.waiters.push({ t, pred: test, resolve: (m) => (clearTimeout(timer), resolve(m as Msg<T>)) });
    });
  }

  /** Most recent lobby state seen. */
  get lobby(): LobbyState | null {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i];
      if (m.t === 'lobby') return m.lobby;
    }
    return null;
  }

  turns(): Turn[] {
    return this.inbox.filter((m): m is Msg<'turn'> => m.t === 'turn').map((m) => m.turn);
  }

  get token(): string {
    return (this.inbox.find((m) => m.t === 'welcome') as Msg<'welcome'>).token;
  }

  close(): Promise<void> {
    return new Promise((res) => {
      this.ws.once('close', () => res());
      this.ws.close();
    });
  }
}

let http: Server;
let port: number;
const clients: Client[] = [];

async function serve(opts: LanOptions = FAST): Promise<void> {
  http = createServer();
  attachLan(http, opts);
  await new Promise<void>((res) => http.listen(0, '127.0.0.1', res));
  port = (http.address() as AddressInfo).port;
}

async function client(name: string, token?: string): Promise<Client> {
  const c = await Client.open(port, name, token);
  clients.push(c);
  return c;
}

/** Host creates a lobby and the others join it; resolves once everyone sees every member. */
async function room(...names: string[]): Promise<Client[]> {
  const [host, ...rest] = await Promise.all(names.map((n) => client(n)));
  host.send({ t: 'create', name: 'Test fleet' });
  const { lobby } = await host.next('lobby');
  for (const c of rest) c.send({ t: 'join', lobby: lobby!.id });
  const all = [host, ...rest];
  await Promise.all(all.map((c) => c.next('lobby', (m) => m.lobby?.members.length === names.length)));
  return all;
}

/** Ready the guests, start, report loaded; resolves with the start message each got. */
async function battle(cs: Client[]): Promise<Msg<'start'>[]> {
  for (const c of cs.slice(1)) c.send({ t: 'me', ready: true });
  await cs[0].next('lobby', (m) => m.lobby!.members.filter((x) => x.ready).length === cs.length - 1);
  const starts = Promise.all(cs.map((c) => c.next('start')));
  cs[0].send({ t: 'start' });
  const got = await starts;
  for (const c of cs) c.send({ t: 'loaded' });
  await Promise.all(cs.map((c) => c.next('turn')));
  return got;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => (c.ws.readyState === WebSocket.OPEN ? c.close() : undefined)));
  await new Promise((res) => (http?.listening ? http.close(res) : res(undefined)));
});

describe('LAN lobby server', () => {
  it('lists, joins and balances teams; settings and start are the host’s alone', async () => {
    await serve();
    const browser = await client('Watcher');
    const [ana, ben] = await room('Ana', 'Ben');
    const { list } = await browser.next('lobbies', (m) => m.list[0]?.captains === 2);
    expect(list).toMatchObject([{ name: 'Test fleet', host: 'Ana', captains: 2, state: 'waiting' }]);

    const lobby = ana.lobby!;
    expect(lobby.members.map((m) => [m.name, m.team])).toEqual([['Ana', 0], ['Ben', 1]]);
    expect(lobby.host).toBe(lobby.members[0].id);

    ben.send({ t: 'settings', s: { type: 'convoy' } });
    ben.send({ t: 'start' });
    await wait(50);
    expect(ana.lobby!.settings.type).toBe('domination');
    expect(ben.inbox.some((m) => m.t === 'start')).toBe(false);

    ana.send({ t: 'settings', s: { type: 'convoy', mapId: 'dusk', ai: [99, 2], difficulty: 'hard', escortTeam: 1 } });
    const s = (await ben.next('lobby', (m) => m.lobby!.settings.type === 'convoy')).lobby!.settings;
    expect(s).toMatchObject({ type: 'convoy', mapId: 'dusk', ai: [5, 5], difficulty: 'hard', escortTeam: 1 });

    // Not everyone is ready yet.
    ana.send({ t: 'start' });
    expect((await ana.next('error')).text).toContain('Ben');
  });

  it('validates names, ships and teams', async () => {
    await serve();
    const [ana, ben] = await room('A'.repeat(80), 'Ben');
    expect(ana.lobby!.members[0].name).toHaveLength(24);

    ben.send({ t: 'me', shipId: 'constructor' });
    ben.send({ t: 'me', shipId: '__proto__' });
    ben.send({ t: 'me', shipId: 'nonsense' });
    ben.send({ t: 'me', shipId: 'fletcher' });
    await ana.next('lobby', (m) => m.lobby!.members[1].shipId === 'fletcher');

    ana.send({ t: 'settings', s: { titans: false } });
    await ben.next('lobby', (m) => m.lobby!.settings.titans === false);
    ben.send({ t: 'me', shipId: 'leviathan' });
    ben.send({ t: 'me', team: 0 });
    const after = (await ana.next('lobby', (m) => m.lobby!.members[1].team === 0)).lobby!;
    expect(after.members[1].shipId).toBe('fletcher');

    // Junk of every shape is ignored without hurting the session.
    for (const junk of [null, 7, 'x', [], { t: 'nope' }, { t: 'me', team: 5 }, { t: 'in', c: 'fire' }, { t: 'hash', k: 'a' }, { t: 'join', lobby: {} }]) ben.send(junk as never);
    ben.ws.send('{not json');
    ben.send({ t: 'me', ready: true });
    await ana.next('lobby', (m) => m.lobby!.members[1].ready);
  });

  it('keeps a pick of a ship whose id is in camelCase', async () => {
    await serve();
    const [ana, ben] = await room('Ana', 'Ben');
    ana.send({ t: 'settings', s: { era: 'modern' } });
    await ben.next('lobby', (m) => m.lobby!.settings.eras.join() === 'modern');
    ben.send({ t: 'me', shipId: 'queenElizabeth' });
    await ana.next('lobby', (m) => m.lobby!.members[1].shipId === 'queenElizabeth');
  });

  it('keeps the era a lobby is fought in, and captains to its ships', async () => {
    await serve();
    const browser = await client('Watcher');
    const [ana, ben] = await room('Ana', 'Ben');
    expect(ana.lobby!.settings.eras).toEqual(['historic']);
    ana.send({ t: 'settings', s: { era: 'atlantis' as never } });
    ana.send({ t: 'settings', s: { era: 'mixed' } as never });
    await ben.next('lobby', (m) => m.lobby!.settings.eras.length === ERAS.length);
    expect((await browser.next('lobbies', (m) => m.list[0]?.eras.length === ERAS.length)).list[0].eras).toEqual(ERAS);
    // A set of eras, and one with no line ships refused.
    ana.send({ t: 'settings', s: { eras: ['anime', 'historic'] } });
    await ben.next('lobby', (m) => m.lobby!.settings.eras.join() === 'historic,anime');
    ana.send({ t: 'settings', s: { eras: ['misc'] } });
    ana.send({ t: 'settings', s: { difficulty: 'hard' } });
    expect((await ben.next('lobby', (m) => m.lobby!.settings.difficulty === 'hard')).lobby!.settings.eras).toEqual(['historic', 'anime']);
    ana.send({ t: 'settings', s: { era: 'mixed' } as never });
    await ben.next('lobby', (m) => m.lobby!.settings.eras.length === ERAS.length);

    // Back to one era: a captain in another era's hull is moved to one of this era's.
    const other = SHIPS.find((x) => x.cls !== 'TT' && eraOf(x) !== 'historic');
    if (!other) return;
    ben.send({ t: 'me', shipId: other.id });
    await ana.next('lobby', (m) => m.lobby!.members[1].shipId === other.id);
    ana.send({ t: 'settings', s: { era: 'historic' } });
    const after = (await ana.next('lobby', (m) => m.lobby!.settings.eras.join() === 'historic')).lobby!;
    expect(eraOf(SHIP_BY_ID[after.members[1].shipId])).toBe('historic');
    ben.send({ t: 'me', shipId: other.id });
    ben.send({ t: 'me', ready: true });
    const last = (await ana.next('lobby', (m) => m.lobby!.members[1].ready)).lobby!;
    expect(last.members[1].shipId).not.toBe(other.id);
  });

  it('starts one battle for everyone and clocks turns carrying each captain’s orders', async () => {
    await serve();
    const cs = await room('Ana', 'Ben', 'Cy');
    cs[1].send({ t: 'me', shipId: 'gato', team: 0 });
    await cs[0].next('lobby', (m) => m.lobby!.members[1].team === 0);
    const [a, b, c] = await battle(cs);
    expect(a.config).toEqual(b.config);
    expect(b.config).toEqual(c.config);
    expect([a.you, b.you, c.you]).toEqual([0, 1, 2]);
    expect(a.config.mode).toBe('lan');
    expect(a.config.players.map((p) => [p.name, p.team, p.shipId])).toEqual([
      ['Ana', 0, 'yamato'],
      ['Ben', 0, 'gato'],
      ['Cy', 0, 'yamato'],
    ]);

    const t0 = Date.now();
    const k0 = cs[0].turns().length;
    cs[1].send({ t: 'in', c: [0.5, 100.25, -40, 1, 3] });
    for (const e of [{ sk: 1 }, { tu: 1 }, { co: 0 }]) cs[1].send({ t: 'in', e });
    await wait(200);
    const turns = cs[0].turns();
    const rate = (turns.length - k0) / ((Date.now() - t0) / 1000);
    expect(rate).toBeGreaterThan(60);
    expect(rate).toBeLessThan(140);
    // Every peer receives the identical stream, numbered from zero.
    expect(turns.map((t) => t.k)).toEqual(turns.map((_, i) => i));
    expect(JSON.stringify(cs[2].turns().slice(0, turns.length))).toBe(JSON.stringify(turns.slice(0, cs[2].turns().length)));

    const orders = turns.flatMap((t) => t.p ?? []);
    expect(orders).toContainEqual([1, [0.5, 100.25, -40, 1, 3]]);
    const edges = turns.flatMap((t) => t.e ?? []);
    expect(edges.map(([p, , e]) => [p, e])).toEqual([[1, { sk: 1 }], [1, { tu: 1 }], [1, { co: 0 }]]);
    for (const t of turns) expect((t.e ?? []).filter(([p]) => p === 1).length).toBeLessThanOrEqual(2);

    // Ben went quiet with the trigger held: fire is released for him.
    const released = orders.find(([p, o]) => p === 1 && o[3] === 0);
    expect(released?.[1]).toEqual([0.5, 100.25, -40, 0, 3]);
  });

  it('hands a dropped captain to the AI and gives the helm back on reconnect, with the full log', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    const token = cs[1].token;
    await cs[1].close();
    const handed = await cs[0].next('turn', (m) => !!m.turn.ev?.some((e) => 'ai' in e && e.ai === 1));
    expect(handed.turn.ev).toEqual([{ ai: 1 }]);

    const back = await client('Ben', token);
    const log = await back.next('log');
    expect(log.you).toBe(1);
    expect(log.turns.length).toBeGreaterThan(handed.turn.k);
    expect(log.turns.map((t) => t.k)).toEqual(log.turns.map((_, i) => i));
    const helm = await back.next('turn', (m) => !!m.turn.ev?.some((e) => 'human' in e));
    expect(helm.turn.ev).toEqual([{ human: 1 }]);
    expect(helm.turn.k).toBe(log.turns.length);
  });

  it('a captain who leaves mid-battle is sailed by the AI for good', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    cs[1].send({ t: 'leave' });
    await cs[0].next('turn', (m) => !!m.turn.ev?.some((e) => 'ai' in e && e.ai === 1));
    await cs[1].next('lobbies', (m) => m.list[0]?.state === 'battle' && m.list[0].captains === 1);
    expect(cs[0].lobby!.members).toHaveLength(1);
  });

  it('a minority hash gets desync, and resync sends the log', async () => {
    await serve();
    const cs = await room('Ana', 'Ben', 'Cy');
    await battle(cs);
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    cs[0].send({ t: 'hash', k: 59, h: 111 });
    cs[1].send({ t: 'hash', k: 59, h: 222 });
    cs[2].send({ t: 'hash', k: 59, h: 111 });
    await cs[1].next('desync');
    await wait(30);
    expect(cs[0].inbox.some((m) => m.t === 'desync')).toBe(false);
    expect(cs[2].inbox.some((m) => m.t === 'desync')).toBe(false);
    cs[1].send({ t: 'resync' });
    expect((await cs[1].next('log')).you).toBe(1);
  });

  it('tells a drifting captain which parts of the battle drifted', async () => {
    await serve();
    const cs = await room('Ana', 'Ben', 'Cy');
    await battle(cs);
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    const good: [string, number][] = [['core', 1], ['s3', 2], ['s4', 3], ['shells', 4]];
    const bad: [string, number][] = [['core', 1], ['s3', 9], ['s4', 3], ['shells', 8]];
    cs[0].send({ t: 'hash', k: 59, h: 111, s: good });
    cs[1].send({ t: 'hash', k: 59, h: 222, s: bad });
    cs[2].send({ t: 'hash', k: 59, h: 111, s: good });
    expect(await cs[1].next('desync')).toMatchObject({ k: 59, diff: ['s3', 'shells'] });
  });

  it('ignores malformed section lists', async () => {
    await serve();
    const cs = await room('Ana', 'Ben', 'Cy');
    await battle(cs);
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    cs[0].send({ t: 'hash', k: 59, h: 111, s: 'nope' });
    cs[1].send({ t: 'hash', k: 59, h: 222, s: Array.from({ length: 500 }, (_, i) => [`x${i}`, i]) });
    cs[2].send({ t: 'hash', k: 59, h: 111, s: [[1, 'a']] });
    const d = await cs[1].next('desync');
    expect(d.diff).toBeUndefined();
  });

  it('with no strict majority every captain resyncs, not just the later ones', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    cs[0].send({ t: 'hash', k: 59, h: 111 });
    cs[1].send({ t: 'hash', k: 59, h: 222 });
    expect(await cs[0].next('desync')).toMatchObject({ tie: true });
    expect(await cs[1].next('desync')).toMatchObject({ tie: true });
  });

  it('a two-two split resyncs all four captains', async () => {
    await serve();
    const cs = await room('Ana', 'Ben', 'Cy', 'Di');
    await battle(cs);
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    cs.forEach((c, i) => c.send({ t: 'hash', k: 59, h: i < 2 ? 111 : 222 }));
    for (const c of cs) await c.next('desync');
  });

  it('ignores hashes for turns that are not checkpoints or have not been sent', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    for (const k of [-1, 58, 1e12, 0.5, 60 * 1000 - 1]) {
      cs[0].send({ t: 'hash', k, h: 1 });
      cs[1].send({ t: 'hash', k, h: 2 });
    }
    cs[0].send({ t: 'hash', k: 59, h: -5 });
    cs[1].send({ t: 'hash', k: 59, h: 2 ** 33 });
    await wait(60);
    expect(cs.some((c) => c.inbox.some((m) => m.t === 'desync'))).toBe(false);
  });

  it('ends once every captain reports the battle over, and the lobby waits again', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    cs[0].send({ t: 'over' });
    await wait(40);
    expect(cs[0].inbox.some((m) => m.t === 'ended')).toBe(false);
    cs[1].send({ t: 'over' });
    await Promise.all(cs.map((c) => c.next('ended')));
    const lobby = (await cs[0].next('lobby', (m) => m.lobby?.state === 'waiting')).lobby!;
    expect(lobby.members.every((m) => !m.ready && m.player === -1)).toBe(true);
    const n = cs[0].turns().length;
    await wait(60);
    expect(cs[0].turns().length).toBe(n);
  });

  it('ends after the grace period when a captain never reports', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    cs[0].send({ t: 'over' });
    await cs[1].next('ended', undefined, 1500);
  });

  it('starts without a captain who never loads', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    cs[1].send({ t: 'me', ready: true });
    await cs[0].next('lobby', (m) => m.lobby!.members[1].ready);
    cs[0].send({ t: 'start' });
    await cs[0].next('start');
    cs[0].send({ t: 'loaded' });
    await wait(100);
    expect(cs[0].turns()).toHaveLength(0);
    await cs[0].next('turn', undefined, 1500);
  });
});

describe('LAN liveness and limits', () => {
  it('hands a captain whose tab is hidden to the AI, and back when the tab is shown', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    cs[1].send({ t: 'away', on: true });
    const handed = await cs[0].next('turn', (m) => !!m.turn.ev?.some((e) => 'ai' in e && e.ai === 1));
    cs[1].send({ t: 'away', on: false });
    const back = await cs[0].next('turn', (m) => !!m.turn.ev?.some((e) => 'human' in e && e.human === 1));
    expect(back.turn.k).toBeGreaterThan(handed.turn.k);
  });

  it('keeps the helm with a captain who only glances away', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    cs[1].send({ t: 'away', on: true });
    await wait(20);
    cs[1].send({ t: 'away', on: false });
    await wait(250);
    expect(cs[0].turns().some((t) => t.ev?.some((e) => 'ai' in e))).toBe(false);
  });

  it('settles a checkpoint without waiting on a hidden tab', async () => {
    await serve();
    const cs = await room('Ana', 'Ben', 'Cy');
    await battle(cs);
    cs[2].send({ t: 'away', on: true });
    await cs[0].next('turn', (m) => m.turn.k >= 59);
    cs[2].send({ t: 'hash', k: 59, h: 222 });
    cs[0].send({ t: 'hash', k: 59, h: 111 });
    cs[1].send({ t: 'hash', k: 59, h: 222 });
    // Two voters split one to one: the hidden tab's hash neither decides it nor holds it up.
    expect((await cs[0].next('desync')).tie).toBe(true);
    expect((await cs[1].next('desync')).tie).toBe(true);
  });

  it('drops a link that stops answering pings and hands its ship to the AI', async () => {
    await serve({ ...FAST, pingMs: 40 });
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    // A paused socket reads nothing, so it never answers a ping: like a laptop gone to sleep.
    cs[1].ws.pause();
    await cs[0].next('turn', (m) => !!m.turn.ev?.some((e) => 'ai' in e && e.ai === 1));
    await cs[0].next('lobby', (m) => m.lobby!.members.some((x) => x.name === 'Ben' && !x.connected));
    cs[1].ws.terminate();
  });

  it('answers app pings so a browser can tell its link is alive, but not a flood of them', async () => {
    await serve();
    const ana = await client('Ana');
    for (let i = 0; i < 10; i++) ana.send({ t: 'ping' });
    await ana.next('pong');
    await wait(50);
    expect(ana.inbox.filter((m) => m.t === 'pong').length).toBeLessThanOrEqual(2);
  });

  it('answers a flood of resyncs with one log', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    for (let i = 0; i < 20; i++) cs[1].send({ t: 'resync' });
    await cs[1].next('log');
    await wait(100);
    expect(cs[1].inbox.filter((m) => m.t === 'log')).toHaveLength(1);
  });

  it('cuts a flood of name changes to the rate limit', async () => {
    await serve();
    const [ana, ben] = await room('Ana', 'Ben');
    for (let i = 0; i < 50; i++) ana.send({ t: 'name', name: `n${i}` });
    await wait(150);
    const names = ben.inbox.filter((m): m is Msg<'lobby'> => m.t === 'lobby').map((m) => m.lobby?.members[0].name);
    expect(names).toContain('n0');
    expect(names).not.toContain('n49');
  });

  it('shrugs off messages named after Object members instead of crashing', async () => {
    await serve();
    const a = await client('Prober');
    for (const t of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) a.send({ t } as never);
    a.send({ t: 'ping' });
    await a.next('pong');
    // And the server still takes new captains.
    const b = await client('Late');
    b.send({ t: 'ping' });
    await b.next('pong');
  });

  it('refuses a page from outside the local network, and lets a LAN page in', async () => {
    await serve();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lan`, { origin: 'https://evil.example' });
    const status = await new Promise<number | undefined>((res) => {
      ws.once('unexpected-response', (_req, r) => res(r.statusCode));
      ws.once('open', () => res(101));
      ws.once('error', () => res(undefined));
    });
    ws.terminate();
    expect(status).toBe(403);
    await client('Home', undefined);
    const lan = await Client.open(port, 'Lan', undefined, 'http://192.168.1.20:5173');
    clients.push(lan);
    expect(lan.inbox[0].t).toBe('welcome');
  });

  it('keeps its clocks on a monotonic timer', () => {
    expect(readFileSync(new URL('./lan.ts', import.meta.url), 'utf8')).not.toMatch(/Date\.now/);
  });
});

describe('AI counts and free play', () => {
  /** Ready the guests (settings changes unready everyone) and wait until the host sees it. */
  async function ready(cs: Client[]): Promise<void> {
    for (const c of cs.slice(1)) c.send({ t: 'me', ready: true });
    await cs[0].next('lobby', (m) => m.lobby!.members.filter((x) => x.ready).length === cs.length - 1);
  }

  it('lets the host set AI ships per team, and refuses an empty side outside free play', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    const [ana, ben] = cs;
    ben.send({ t: 'me', team: 0 });
    await ana.next('lobby', (m) => m.lobby!.members[1].team === 0);
    for (const bad of [[9, 1], [-1, 2], [1.5, 2], [1], 'x', [1, 2, 3], ['1', 2]]) ana.send({ t: 'settings', s: { ai: bad as never } });
    ben.send({ t: 'settings', s: { ai: [8, 8] } });
    ana.send({ t: 'settings', s: { type: 'annihilation', ai: [0, 0] } });
    const set = (await ana.next('lobby', (m) => m.lobby!.settings.type === 'annihilation')).lobby!.settings;
    expect(set.ai).toEqual([0, 0]);

    await ready(cs);
    ana.send({ t: 'start' });
    expect((await ana.next('error')).text).toBe('Team B has no ships: add AI ships or a captain.');
    expect(ana.inbox.some((m) => m.t === 'start')).toBe(false);

    // Free play may start with nobody to fight.
    ana.send({ t: 'settings', s: { type: 'freeplay', ai: [0, 0], titans: false } });
    await ben.next('lobby', (m) => m.lobby!.settings.type === 'freeplay');
    const [start] = await battle(cs);
    expect(start.config).toMatchObject({ type: 'freeplay', ai: [0, 0], titans: false });
  });

  it('passes the ship picks the lobby allows, in free play only, and lets only the host end it', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    cs[0].send({ t: 'settings', s: { type: 'freeplay', titans: false } });
    await cs[1].next('lobby', (m) => m.lobby!.settings.type === 'freeplay');
    await battle(cs);
    const otherEra = SHIPS.find((x) => x.cls !== 'TT' && eraOf(x) !== 'historic');
    for (const e of [{ sp: 'leviathan' }, { sp: 'nonsense', rd: 1 }, { sp: 'constructor' }, { sp: otherEra?.id ?? 'x' }, { sp: 'fletcher' }]) cs[1].send({ t: 'in', e });
    cs[1].send({ t: 'end' });
    await wait(100);
    const edges = cs[0].turns().flatMap((t) => (t.e ?? []).map(([p, , e]) => [p, e]));
    expect(edges).toEqual([[1, { rd: 1 }], [1, { sp: 'fletcher' }]]);
    expect(cs[0].turns().some((t) => t.ev?.some((e) => 'end' in e))).toBe(false);

    cs[0].send({ t: 'end' });
    cs[0].send({ t: 'end' });
    const ended = await cs[1].next('turn', (m) => !!m.turn.ev?.some((e) => 'end' in e));
    expect(ended.turn.ev).toEqual([{ end: 1 }]);
    await wait(60);
    expect(cs[1].turns().flatMap((t) => t.ev ?? []).filter((e) => 'end' in e)).toHaveLength(1);
  });

  it("passes the host's sandbox commands, cleaned and at most 4 a turn, and nobody else's", async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    const commands = () => cs[1].turns().flatMap((t) => (t.ev ?? []).flatMap((e) => ('sb' in e ? [e.sb] : [])));
    // Not a sandbox: refused.
    cs[0].send({ t: 'settings', s: { type: 'freeplay' } });
    await cs[1].next('lobby', (m) => m.lobby!.settings.type === 'freeplay');
    await battle(cs);
    cs[0].send({ t: 'sandbox', cmd: { k: 'respawn' } });
    await wait(60);
    expect(commands()).toEqual([]);
    cs[0].send({ t: 'end' });
    await cs[1].next('turn', (m) => !!m.turn.ev?.some((e) => 'end' in e));
    for (const c of cs) c.send({ t: 'over' });
    await cs[0].next('ended', undefined, 3000);

    cs[0].send({ t: 'settings', s: { type: 'sandbox', ai: [3, 3] } });
    await cs[1].next('lobby', (m) => m.lobby!.settings.type === 'sandbox');
    const [start] = await battle(cs);
    expect(start.config).toMatchObject({ type: 'sandbox', ai: [0, 0] });
    cs[1].send({ t: 'sandbox', cmd: { k: 'clear' } });
    cs[0].send({ t: 'sandbox', cmd: { k: 'nuke' } as never });
    cs[0].send({ t: 'sandbox', cmd: { k: 'spawn', ship: 'fletcher', n: 99, team: 1, x: 0, z: 0, heading: 0, extra: 1 } as never });
    for (let i = 0; i < 8; i++) cs[0].send({ t: 'sandbox', cmd: { k: 'mode', mode: 'sail' } });
    await wait(150);
    const sb = commands();
    expect(sb[0]).toEqual<SandboxCmd>({ k: 'spawn', ship: 'fletcher', n: MAX_DUMMIES, team: 1, x: 0, z: 0, heading: 0 });
    expect(sb.some((c) => c.k === 'clear' || (c.k as string) === 'nuke')).toBe(false);
    expect(sb.length).toBeGreaterThan(1);
    for (const t of cs[1].turns()) expect((t.ev ?? []).filter((e) => 'sb' in e).length).toBeLessThanOrEqual(4);
  });

  it('ends free play for everyone on a turn when it runs out of time, then stops the clock', async () => {
    await serve({ ...FAST, maxBattleMs: 300, rules: navalRules });
    const cs = await room('Ana', 'Ben');
    cs[0].send({ t: 'settings', s: { type: 'freeplay' } });
    await cs[1].next('lobby', (m) => m.lobby!.settings.type === 'freeplay');
    await battle(cs);
    const ended = await cs[1].next('turn', (m) => !!m.turn.ev?.some((e) => 'end' in e), 3000);
    expect(ended.turn.ev).toEqual([{ end: 2 }]);
    // Nobody reports the battle over here, so the clock stops after the grace.
    await Promise.all(cs.map((c) => c.next('ended', undefined, 3000)));
    expect(cs[0].turns().flatMap((t) => t.ev ?? []).filter((e) => 'end' in e)).toHaveLength(1);
  });

  it('just stops other battles at the time limit', async () => {
    await serve({ ...FAST, maxBattleMs: 200 });
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    await Promise.all(cs.map((c) => c.next('ended', undefined, 3000)));
    expect(cs[0].turns().some((t) => t.ev?.length)).toBe(false);
  });

  it('ignores ship picks and ending in other battles', async () => {
    await serve();
    const cs = await room('Ana', 'Ben');
    await battle(cs);
    cs[1].send({ t: 'in', e: { sp: 'fletcher', rd: 1 } });
    cs[1].send({ t: 'in', e: { sp: 'fletcher', tu: 1 } });
    cs[0].send({ t: 'end' });
    await wait(100);
    const edges = cs[0].turns().flatMap((t) => (t.e ?? []).map(([, , e]) => e));
    expect(edges).toEqual([{ tu: 1 }]);
    expect(cs[0].turns().some((t) => t.ev?.length)).toBe(false);
  });
});

describe('LobbyServer without sockets', () => {
  it('drops a socket that has stopped reading rather than buffering for it forever', () => {
    const sent: string[] = [];
    let dropped = false;
    const ws = { readyState: 1, OPEN: 1 as const, bufferedAmount: 0, send: (d: string) => sent.push(d), terminate: () => void (dropped = true) };
    deliver(ws as never, { t: 'pong' });
    expect(sent).toHaveLength(1);
    ws.bufferedAmount = 9 * 1024 * 1024;
    deliver(ws as never, { t: 'pong' });
    expect(sent).toHaveLength(1);
    expect(dropped).toBe(true);
  });

  it('lets a long battle’s turn log drain without counting it as a socket that stopped reading', () => {
    const sent: string[] = [];
    let dropped = false;
    // bufferedAmount grows with every send and the client drains nothing yet.
    const ws = {
      readyState: 1,
      OPEN: 1 as const,
      bufferedAmount: 0,
      send(d: string) {
        sent.push(d);
        this.bufferedAmount += Buffer.byteLength(d);
      },
      terminate: () => void (dropped = true),
    };
    // An hour of busy turns: about 9 MB of log, sent in one message to a captain rejoining.
    const turns = Array.from({ length: 30_000 }, (_, i) => ({ k: i, i: [['x'.repeat(280)]] }));
    deliver(ws as never, { t: 'log', config: {}, you: 0, turns } as never);
    expect(ws.bufferedAmount).toBeGreaterThan(8 * 1024 * 1024);
    // The next turns go out while that log is still on its way.
    for (let i = 0; i < 30; i++) deliver(ws as never, { t: 'pong' });
    expect(dropped).toBe(false);
    expect(sent).toHaveLength(31);
    // A socket that then sits on another 8 MB is still dropped.
    ws.bufferedAmount += 8 * 1024 * 1024 + 1;
    deliver(ws as never, { t: 'pong' });
    expect(dropped).toBe(true);
  });

  it('ignores messages before hello', () => {
    const s = new LobbyServer(FAST);
    const sent: ServerMsg[] = [];
    const peer = s.connect((m) => sent.push(m));
    s.receive(peer, { t: 'create', name: 'x' });
    expect(sent).toEqual([]);
    s.receive(peer, { t: 'hello', protocol:SIM_PROTOCOL, name: '' });
    expect(sent[0]).toMatchObject({ t: 'welcome' });
    s.close();
  });
});
it('rejects malformed Architect loadouts without terminating the lobby',async()=>{
 await serve();const [c]=await room('Builder','Observer');
 c.send({t:'me',architectLoadout:Array.from({length:10},()=>({type:{toString:null},skill:0}))});
 expect((await c.next('error')).text).toMatch(/Invalid Architect/);
 c.send({t:'name',name:'Still connected'});expect((await c.next('lobby',m=>!!m.lobby?.members.some(x=>x.name==='Still connected'))).lobby).not.toBeNull();
});
it('rejects incompatible clients before joining a lobby',()=>{
 const s=new LobbyServer(),messages:ServerMsg[]=[];const p=s.connect(m=>messages.push(m));s.receive(p,{t:'hello',name:'Old client'});expect(messages.some(m=>m.t==='error'&&/versions differ/.test(m.text))).toBe(true);expect(messages.some(m=>m.t==='welcome')).toBe(false);s.close();
});

it('refuses protocol 18 peers from before the misc titans fun pass',()=>{
 const s=new LobbyServer(),messages:ServerMsg[]=[];const p=s.connect(m=>messages.push(m));s.receive(p,{t:'hello',protocol:18,name:'Old Titans'});expect(messages.some(m=>m.t==='error'&&/versions differ/.test(m.text))).toBe(true);expect(messages.some(m=>m.t==='welcome')).toBe(false);s.close();
});
it('refuses protocol 17 peers from before co-op Boss Rush and Architect stacking',()=>{
 const s=new LobbyServer(),messages:ServerMsg[]=[];const p=s.connect(m=>messages.push(m));s.receive(p,{t:'hello',protocol:17,name:'Old Rush'});expect(messages.some(m=>m.t==='error'&&/versions differ/.test(m.text))).toBe(true);expect(messages.some(m=>m.t==='welcome')).toBe(false);s.close();
});
it('refuses protocol 16 peers from before the general update',()=>{
 const s=new LobbyServer(),messages:ServerMsg[]=[];const p=s.connect(m=>messages.push(m));s.receive(p,{t:'hello',protocol:16,name:'Old Tide'});expect(messages.some(m=>m.t==='error'&&/versions differ/.test(m.text))).toBe(true);expect(messages.some(m=>m.t==='welcome')).toBe(false);s.close();
});
it('refuses protocol 2 peers before joining the delayed-flight simulation',()=>{
 const s=new LobbyServer(),messages:ServerMsg[]=[];const p=s.connect(m=>messages.push(m));s.receive(p,{t:'hello',protocol:2,name:'Old Battery'});expect(messages.some(m=>m.t==='error'&&/versions differ/.test(m.text))).toBe(true);expect(messages.some(m=>m.t==='welcome')).toBe(false);s.close();
});
it('refuses protocol 3 peers before joining the Vector and docked-capacitor simulation',()=>{
 const s=new LobbyServer(),messages:ServerMsg[]=[];const p=s.connect(m=>messages.push(m));s.receive(p,{t:'hello',protocol:3,name:'Old Architect'});expect(messages.some(m=>m.t==='error'&&/versions differ/.test(m.text))).toBe(true);expect(messages.some(m=>m.t==='welcome')).toBe(false);s.close();
});

describe('co-op Boss Rush lobbies', () => {
  const rushSettings = () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { type: 'bossrush' });
    return st;
  };

  it('takes Boss Rush and Survival with a clean difficulty and escort count', () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { type: 'bossrush', rush: { preset: 'hard' }, escorts: 0 });
    expect(st).toMatchObject({ type: 'bossrush', rush: { preset: 'hard' }, escorts: 0 });
    navalRules.applySettings(st, { rush: { preset: 'nope' }, escorts: 3 });
    expect(st).toMatchObject({ rush: { preset: 'hard' }, escorts: 0 });
    navalRules.applySettings(st, { type: 'survival', rush: { preset: 'custom', custom: { extraShips: 99, hpPct: 'x', bossEvery: 3.4, junk: 1 } }, escorts: 2 });
    expect(st.type).toBe('survival');
    expect(st.escorts).toBe(2);
    expect(st.rush).toEqual({ preset: 'custom', custom: { bossEvery: 3, extraShips: 4, hpPct: 100, dmgPct: 100, rampPct: 100, maxTitans: 2, stagger: 8 } });
  });

  it('builds a rush from its captains alone, with the difficulty and escorts, and refuses a ninth', () => {
    const st = rushSettings();
    navalRules.applySettings(st, { rush: { preset: 'brutal' }, escorts: 0 });
    const captains = ['Ana', 'Ben'].map((name) => ({ pick: 'iowa', team: 0 as const, name }));
    expect(navalRules.startError(st, captains)).toBeNull();
    const config = navalRules.config(st, captains, 7);
    expect(config).toMatchObject({ mode: 'lan', type: 'bossrush', rush: { preset: 'brutal' }, escorts: 0, seed: 7 });
    expect(config.players.map((p) => [p.name, p.team])).toEqual([['Ana', 0], ['Ben', 0]]);
    expect(config.ai).toBeUndefined();
    expect(config.resolvedAI).toBeUndefined();
    const nine = Array.from({ length: 9 }, (_, i) => ({ pick: 'iowa', team: 0 as const, name: `C${i}` }));
    expect(navalRules.startError(st, nine)).toBe('Boss Rush takes up to 8 captains');
    expect(navalRules.startError(st, [])).toBe('Boss Rush needs a captain');
    expect(navalRules.hostEnds(st)).toBe(true);
  });

  it('refuses to start a fleet battle with more than 8 captains on one team, as a run left behind can', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ pick: 'iowa', team: 0 as const, name: `C${i}` }));
    for (const type of ['domination', 'freeplay', 'sandbox'] as const) {
      const st = navalRules.defaults();
      navalRules.applySettings(st, { type });
      expect(navalRules.startError(st, nine), type).toBe('Team A has more than 8 captains: move some to Team B.');
      expect(navalRules.startError(st, nine.map((c, i) => ({ ...c, team: (i % 2) as 0 | 1 }))), type).toBeNull();
    }
  });

  it('passes rush card picks in a rush only, as a whole card number', () => {
    const st = rushSettings();
    expect(navalRules.cleanEdge({ rc: 2 }, st)).toEqual({ rc: 2 });
    expect(navalRules.cleanEdge({ rc: 0, tu: 1 }, st)).toEqual({ rc: 0, tu: 1 });
    for (const rc of [3, -1, 1.5, '1']) expect(navalRules.cleanEdge({ rc }, st)).toBeNull();
    expect(navalRules.cleanEdge({ rc: 1 }, navalRules.defaults())).toBeNull();
  });

  it('keeps every captain of a rush lobby on the one fleet', async () => {
    await serve();
    const [ana, ben] = await room('Ana', 'Ben');
    expect(ana.lobby!.members.map((m) => m.team)).toEqual([0, 1]);
    ana.send({ t: 'settings', s: { type: 'bossrush' } });
    await ben.next('lobby', (m) => m.lobby!.settings.type === 'bossrush');
    expect(ben.lobby!.members.map((m) => m.team)).toEqual([0, 0]);
    ben.send({ t: 'me', team: 1 });
    const cal = await client('Cal');
    cal.send({ t: 'join', lobby: ana.lobby!.id });
    await ana.next('lobby', (m) => m.lobby!.members.length === 3);
    await wait(50);
    expect(ana.lobby!.members.map((m) => m.team)).toEqual([0, 0, 0]);
  });

  it('is full at eight captains, and will not start a rush with more', async () => {
    await serve();
    const cs = await room(...Array.from({ length: 9 }, (_, i) => `C${i}`));
    cs[0].send({ t: 'settings', s: { type: 'survival' } });
    await cs[1].next('lobby', (m) => m.lobby!.settings.type === 'survival');
    for (const c of cs.slice(1)) c.send({ t: 'me', ready: true });
    await cs[0].next('lobby', (m) => m.lobby!.members.filter((x) => x.ready).length === 8);
    cs[0].send({ t: 'start' });
    expect((await cs[0].next('error')).text).toBe('Survival takes up to 8 captains');
    const late = await client('Late');
    late.send({ t: 'join', lobby: cs[0].lobby!.id });
    expect((await late.next('error')).text).toBe('That lobby is full.');
  });

  it('lets the host end a co-op run, and ends it for everyone at the time limit', async () => {
    await serve({ ...FAST, maxBattleMs: 300, rules: navalRules });
    const cs = await room('Ana', 'Ben');
    cs[0].send({ t: 'settings', s: { type: 'bossrush' } });
    await cs[1].next('lobby', (m) => m.lobby!.settings.type === 'bossrush');
    const [start] = await battle(cs);
    expect(start.config).toMatchObject({ type: 'bossrush', escorts: 2 });
    cs[1].send({ t: 'in', e: { rc: 1 } });
    const ended = await cs[1].next('turn', (m) => !!m.turn.ev?.some((e) => 'end' in e), 3000);
    expect(ended.turn.ev).toEqual([{ end: 2 }]);
    expect(cs[0].turns().flatMap((t) => (t.e ?? []).map(([p, , e]) => [p, e]))).toEqual([[1, { rc: 1 }]]);
  });
});
