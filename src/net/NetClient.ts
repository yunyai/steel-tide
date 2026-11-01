import { SIM_PROTOCOL } from './protocol';
import { type ClientMsg, LAN_PATH, type LobbyState, type LobbySummary, NAME_MAX, type ServerMsg } from './protocol';
import { Watchdog } from './Watchdog';

// The browser's link to the LAN lobby server on the page's own host. It reconnects by itself,
// and a reload rejoins the same seat: the session token lives in sessionStorage (per tab). It
// tells the server when the tab is hidden, and drops a link that has gone silent (Watchdog).

export type NetStatus = 'connecting' | 'online' | 'offline';

const NAME_KEY = 'steel-tide.captain';
const TOKEN_KEY = 'steel-tide.lan-token';
/** Set while this tab is in the LAN screens, so a reload goes straight back there. */
const ACTIVE_KEY = 'steel-tide.lan-active';

function load(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function save(store: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // Private windows may refuse storage; the session simply will not survive a reload.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

export class NetClient {
  status: NetStatus = 'connecting';
  /** Our member id in lobbies. */
  id = '';
  urls: string[] = [];
  lobbies: LobbySummary[] = [];
  lobby: LobbyState | null = null;
  /** The server has never answered this client (nothing listening, or not a LAN host). */
  neverConnected = true;
  /** The server gave us a new seat after a reconnect: whatever we were in is gone. */
  lostSeat = false;
  private ws: WebSocket | null = null;
  private listeners = new Set<(m: ServerMsg) => void>();
  private statusListeners = new Set<() => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private _name: string;
  private watchdog = new Watchdog(performance.now());
  private beat: ReturnType<typeof setInterval>;
  private onVisibility = () => this.send({ t: 'away', on: document.hidden });

  constructor() {
    this._name = (load(local, NAME_KEY) ?? '').slice(0, NAME_MAX) || `Captain ${Math.floor(Math.random() * 900 + 100)}`;
    save(session, ACTIVE_KEY, '1');
    document.addEventListener('visibilitychange', this.onVisibility);
    this.beat = setInterval(() => this.checkLink(), 1000);
    this.open();
  }

  /** This tab was in the LAN screens when it was last closed or reloaded. */
  static get wasActive(): boolean {
    return load(session, ACTIVE_KEY) === '1';
  }

  get name(): string {
    return this._name;
  }

  set name(v: string) {
    const n = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
    if (!n || n === this._name) return;
    this._name = n;
    save(local, NAME_KEY, n);
    this.send({ t: 'name', name: n });
  }

  /** The member entry for this client in the current lobby. */
  get me() {
    return this.lobby?.members.find((m) => m.id === this.id) ?? null;
  }

  get isHost(): boolean {
    return !!this.lobby && this.lobby.host === this.id;
  }

  listen(fn: (m: ServerMsg) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Leave the current lobby (and its battle, which the AI then sails for us). */
  leave(): void {
    this.send({ t: 'leave' });
    this.lobby = null;
  }

  /** Leave the LAN screens for good: no reconnects, and a reload stays on the title screen. */
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    clearInterval(this.beat);
    document.removeEventListener('visibilitychange', this.onVisibility);
    save(session, ACTIVE_KEY, null);
    this.ws?.close();
    this.ws = null;
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const f of this.statusListeners) f();
  }

  private open(): void {
    if (this.closed) return;
    this.setStatus('connecting');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}${LAN_PATH}`);
    this.ws = ws;
    ws.onopen = () => {
      this.watchdog = new Watchdog(performance.now());
      ws.send(JSON.stringify({ t: 'hello', protocol:SIM_PROTOCOL, name: this._name, token: load(session, TOKEN_KEY) ?? undefined } satisfies ClientMsg));
    };
    ws.onmessage = (e) => {
      this.watchdog.heard(performance.now());
      if (typeof e.data !== 'string') return;
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      this.receive(m);
    };
    ws.onclose = () => this.lost(ws);
  }

  /** The link closed, or went silent: let it go and try again shortly. */
  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.closed) return;
    this.setStatus('offline');
    // Quick retries first (a reload of the host page, a Wi-Fi blip), then every few seconds.
    const delay = Math.min(4000, 400 * 2 ** Math.min(this.retry++, 4));
    this.timer = setTimeout(() => this.open(), delay);
  }

  /** Ping a quiet link now and then, and give up on one that has stopped answering. */
  private checkLink(): void {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const verdict = this.watchdog.poll(performance.now());
    if (verdict === 'ping') this.send({ t: 'ping' });
    else if (verdict === 'dead') {
      this.lost(ws);
      ws.close();
    }
  }

  private receive(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': {
        const had = load(session, TOKEN_KEY);
        this.lostSeat = !this.neverConnected && had !== null && had !== m.token;
        this.neverConnected = false;
        this.retry = 0;
        this.id = m.id;
        this.urls = m.urls;
        save(session, TOKEN_KEY, m.token);
        if (this.lostSeat) this.lobby = null;
        this.setStatus('online');
        // A tab that reconnects while hidden says so; the server assumes a new link is shown.
        if (document.hidden) this.send({ t: 'away', on: true });
        break;
      }
      case 'lobbies':
        this.lobbies = m.list;
        break;
      case 'lobby':
        this.lobby = m.lobby;
        break;
    }
    for (const f of [...this.listeners]) f(m);
  }
}
