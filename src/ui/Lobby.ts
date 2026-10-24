import { DIFFICULTIES } from '../config';
import type { DifficultyId } from '../core/BattleSetup';
import type { BattleEra, ShipSpec, Team } from '../core/types';
import { ERA_LABEL, ERAS } from '../data/factions';
import { CLASS_LABEL, SHIP_BY_ID, shipsOf } from '../data/ships';
import type { NetClient } from '../net/NetClient';
import { type LobbySettings, type LobbyState, MAX_PER_TEAM, type Member, NAME_MAX, type ServerMsg } from '../net/protocol';
import { MAPS } from '../world/GameMap';
import { field, h, seg } from './dom';
import { classIcon, glyph } from './Icons';

// The LAN screens: the lobby list on this server, and the room of the lobby you are in.
// Everything a player typed (captain and lobby names) goes in through textContent only.

export interface LobbyHooks {
  click(): void;
  preview(spec: ShipSpec, offset: number): void;
  /** Back to the title screen. */
  back(): void;
  /** Open the hangar for a LAN pick; the host's titan rule and era limit it. */
  chooseShip(shipId: string, titans: boolean, era: BattleEra): void;
}

const TYPE_LABEL: Record<LobbySettings['type'], string> = { domination: 'Domination', annihilation: 'Annihilation', convoy: 'Convoy' };
const TEAM_LABEL = ['Team A', 'Team B'];
/** Eras with ships to sail, then Mixed once there are two. */
const LIVE_ERAS = ERAS.filter((e) => shipsOf(e).length > 0);
const LAN_ERAS: BattleEra[] = LIVE_ERAS.length > 1 ? [...LIVE_ERAS, 'mixed'] : LIVE_ERAS;

function eraLabel(e: BattleEra): string {
  return e === 'mixed' ? 'Mixed' : ERA_LABEL[e];
}

/** Fleet sizes as the battle will build them (see buildRoster): bots fill up to the team size, titans bring two more foes. */
function fleetSizes(l: LobbyState): [number, number] {
  const humans = (t: Team) => l.members.filter((m) => m.team === t);
  const titans = (t: Team) => (l.settings.titans ? humans(t).filter((m) => SHIP_BY_ID[m.shipId]?.cls === 'TT').length : 0);
  return [Math.max(l.settings.teamSize, humans(0).length) + titans(1) * 2, Math.max(l.settings.teamSize, humans(1).length) + titans(0) * 2];
}

export class Lobby {
  private off: (() => void)[] = [];
  private error = '';
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;
  /** Which screen was drawn last, so a refresh keeps focus where it was. */
  private view = '';

  constructor(
    private root: HTMLElement,
    private net: NetClient,
    private hooks: LobbyHooks,
  ) {}

  get shown(): boolean {
    return this.visible;
  }

  show(): void {
    if (!this.visible) {
      this.visible = true;
      this.off.push(
        this.net.listen((m) => this.receive(m)),
        this.net.onStatus(() => this.render()),
      );
    }
    this.render();
  }

  /** Stop drawing (a battle, the hangar or the title takes the screen). */
  hide(): void {
    this.visible = false;
    this.view = '';
    for (const f of this.off) f();
    this.off = [];
  }

  /** A message for the captain, shown for a few seconds (the server's errors arrive the same way). */
  notice(text: string): void {
    this.receive({ t: 'error', text });
  }

  /** Tell the lobby which ship we picked in the hangar. */
  pickShip(shipId: string): void {
    this.net.send({ t: 'me', shipId });
  }

  private receive(m: ServerMsg): void {
    if (m.t === 'error') {
      this.error = m.text;
      if (this.errorTimer) clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        this.error = '';
        if (this.visible) this.render();
      }, 5000);
    }
    if (m.t === 'welcome' || m.t === 'lobbies' || m.t === 'lobby' || m.t === 'error') this.render();
  }

  private act(label: string, cls: string, fn: () => void, key = label): HTMLButtonElement {
    const b = h('button', { class: `btn ${cls}`, 'data-k': key }, label);
    b.onclick = () => {
      this.hooks.click();
      fn();
    };
    return b;
  }

  private render(): void {
    if (!this.visible) return;
    // Re-rendering replaces the buttons; keep keyboard focus on the same one.
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const typing = document.activeElement instanceof HTMLInputElement && this.root.contains(document.activeElement);
    if (typing) return this.renderStatusOnly();
    const lobby = this.net.status === 'online' ? this.net.lobby : null;
    const view = lobby ? `room-${lobby.id}` : 'list';
    this.root.replaceChildren(lobby ? this.room(lobby) : this.list());
    // The default focus only on arriving at a screen, never on a refresh of the same one.
    const el = focused ? this.root.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`) : view !== this.view ? this.root.querySelector<HTMLElement>('[data-focus]') : null;
    this.view = view;
    el?.focus({ preventScroll: true });
  }

  /** While the name box has focus, only the parts below it change (so typing is never interrupted). */
  private renderStatusOnly(): void {
    const slot = this.root.querySelector('.lan-dynamic');
    if (slot) slot.replaceChildren(...this.dynamicList());
  }

  private status(): HTMLElement | null {
    const n = this.net;
    if (n.status === 'online') return null;
    if (n.status === 'connecting' && n.neverConnected) return h('p', { class: 'lan-status' }, 'Looking for the LAN server…');
    if (n.neverConnected) {
      const p = h('p', { class: 'lan-status bad' }, 'No LAN server at this address. On the host computer run ');
      p.append(h('code', {}, 'npm run lan'), ', then open the address it prints.');
      return p;
    }
    return h('p', { class: 'lan-status warn' }, 'Lost the LAN server. Reconnecting…');
  }

  private errorLine(): HTMLElement | null {
    return this.error ? h('p', { class: 'lan-error', role: 'alert' }, this.error) : null;
  }

  // ---------------------------------------------------------------- the lobby list

  private list(): HTMLElement {
    const n = this.net;
    const name = h('input', { type: 'text', maxlength: String(NAME_MAX), 'aria-label': 'Captain name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    name.value = n.name;
    const commit = () => {
      n.name = name.value;
      name.value = n.name;
    };
    name.onchange = commit;
    name.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      // Swallow the key: the re-render after blur must not pass it on to a button.
      e.preventDefault();
      name.blur();
    };
    name.onblur = () => {
      commit();
      this.render();
    };
    const create = this.act('Create lobby', 'btn-primary', () => n.send({ t: 'create', name: `${n.name}'s fleet` }));
    create.disabled = n.status !== 'online';
    create.dataset.focus = '';
    return h(
      'div',
      { class: 'sheet panel lan' },
      h('h2', {}, 'LAN battle'),
      h('p', { class: 'lede' }, 'Sail with friends on the same network. Pick sides for a fleet battle, or put everyone on one team against the AI. AI ships fill the empty places.'),
      field('Captain name', name, 'Shown on your ship to the other captains.'),
      h('div', { class: 'lan-dynamic' }, ...this.dynamicList()),
      h('div', { class: 'sheet-actions' }, this.act('Back', 'btn-quiet', () => this.hooks.back()), create),
    );
  }

  private dynamicList(): HTMLElement[] {
    const n = this.net;
    const out: HTMLElement[] = [];
    const st = this.status();
    if (st) out.push(st);
    else {
      if (n.urls.length) {
        const p = h('p', { class: 'lan-join' }, 'Friends join at ');
        n.urls.forEach((u, i) => {
          if (i) p.append(' or ');
          p.append(h('b', {}, u));
        });
        out.push(p);
      } else out.push(h('p', { class: 'lan-join' }, 'This server only listens on this computer, so friends cannot reach it. Start it with npm run lan instead.'));
      const rows = n.lobbies.map((l) => {
        const b = h('button', { class: 'lan-row', 'data-k': `lobby-${l.id}` });
        const title = h('b', {});
        title.textContent = l.name;
        const host = h('span', { class: 'host' });
        host.textContent = `Hosted by ${l.host}`;
        const map = MAPS.find((m) => m.id === l.mapId)?.name ?? l.mapId;
        b.append(
          h('span', { class: 'who' }, title, host),
          h('span', { class: 'what' }, `${TYPE_LABEL[l.type]}, ${map}`),
          h('span', { class: 'num count' }, `${l.captains} ${l.captains === 1 ? 'captain' : 'captains'}`),
          h('span', { class: `state ${l.state}` }, l.state === 'battle' ? 'In battle' : 'Waiting'),
        );
        b.onclick = () => {
          this.hooks.click();
          n.send({ t: 'join', lobby: l.id });
        };
        return b;
      });
      out.push(
        rows.length
          ? h('div', { class: 'lan-list', role: 'list', 'aria-label': 'Lobbies' }, ...rows)
          : h('p', { class: 'lan-empty' }, 'No lobbies here yet. Create one and it shows up for everyone on this server.'),
      );
    }
    const err = this.errorLine();
    if (err) out.push(err);
    return out;
  }

  // ---------------------------------------------------------------- the room

  private room(l: LobbyState): HTMLElement {
    const n = this.net;
    const me = n.me;
    const host = n.isHost;
    const st = l.settings;
    if (me) this.hooks.preview(SHIP_BY_ID[me.shipId] ?? SHIP_BY_ID.yamato, 0.3);
    const set = (s: Partial<LobbySettings>) => n.send({ t: 'settings', s });

    const settings = h('div', { class: 'lan-settings' });
    const mapName = MAPS.find((m) => m.id === st.mapId)?.name ?? st.mapId;
    if (host) {
      const sg = <T extends string | number>(opts: { value: T; label: string }[], get: () => T, put: (v: T) => void) => seg(opts, get, put, () => this.hooks.click());
      settings.append(
        field('Battle type', sg<LobbySettings['type']>((['domination', 'annihilation', 'convoy'] as const).map((v) => ({ value: v, label: TYPE_LABEL[v] })), () => st.type, (v) => set({ type: v }))),
      );
      if (st.type === 'convoy') settings.append(field('Transports sail with', sg<Team>([0, 1].map((t) => ({ value: t as Team, label: TEAM_LABEL[t] })), () => st.escortTeam, (v) => set({ escortTeam: v }))));
      settings.append(
        field('Map', sg(MAPS.map((m) => ({ value: m.id, label: m.name })), () => st.mapId, (v) => set({ mapId: v }))),
        field('Ships per team', sg([3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: String(v) })), () => st.teamSize, (v) => set({ teamSize: v }))),
        field('AI skill', sg<DifficultyId>((Object.keys(DIFFICULTIES) as DifficultyId[]).map((k) => ({ value: k, label: DIFFICULTIES[k].label })), () => st.difficulty, (v) => set({ difficulty: v }))),
        field('Titans', sg([{ value: 1, label: 'Allowed' }, { value: 0, label: 'Not allowed' }], () => (st.titans ? 1 : 0), (v) => set({ titans: v === 1 }))),
      );
      if (LAN_ERAS.length > 1) settings.append(field('Era', sg<BattleEra>(LAN_ERAS.map((e) => ({ value: e, label: eraLabel(e) })), () => st.era, (v) => set({ era: v }))));
    } else {
      const facts: [string, string][] = [
        ['Battle type', TYPE_LABEL[st.type] + (st.type === 'convoy' ? `, transports with ${TEAM_LABEL[st.escortTeam]}` : '')],
        ['Map', mapName],
        ['Ships per team', String(st.teamSize)],
        ['AI skill', DIFFICULTIES[st.difficulty].label],
        ['Titans', st.titans ? 'Allowed' : 'Not allowed'],
        ['Era', eraLabel(st.era)],
      ];
      settings.append(h('dl', { class: 'lan-facts' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
    }

    const sizes = fleetSizes(l);
    const myTeam = me?.team ?? 0;
    const column = (t: Team) => {
      const members = l.members.filter((m) => m.team === t);
      const col = h('section', { class: `lan-team ${t === myTeam ? 'ally' : 'foe'}`, 'aria-label': TEAM_LABEL[t] });
      const head = h('header', {}, h('h3', {}, TEAM_LABEL[t]));
      if (me && me.team !== t && l.state === 'waiting') {
        const sw = this.act('Join this team', 'btn-quiet', () => n.send({ t: 'me', team: t }), `team-${t}`);
        sw.disabled = members.length >= MAX_PER_TEAM;
        head.append(sw);
      }
      col.append(head, ...members.map((m) => this.memberRow(l, m, me)));
      const ai = sizes[t] - members.length;
      col.append(h('p', { class: 'lan-ai' }, ai > 0 ? `+ ${ai} AI ${ai === 1 ? 'ship' : 'ships'}` : 'No AI ships'));
      return col;
    };

    const actions = h('div', { class: 'sheet-actions' });
    actions.append(this.act('Leave lobby', 'btn-quiet', () => (n.leave(), this.render())));
    const notes: HTMLElement[] = [];
    if (l.state === 'battle') {
      notes.push(h('p', { class: 'lan-status' }, me && me.player >= 0 ? 'Your battle is still being fought.' : 'A battle is under way. You sail in the next one.'));
    } else if (me) {
      actions.append(this.act('Choose ship', 'btn', () => this.hooks.chooseShip(me.shipId, st.titans, st.era)));
      if (host) {
        const waiting = l.members.filter((m) => m.id !== me.id && m.connected && !m.ready);
        const start = this.act('Start battle', 'btn-primary', () => n.send({ t: 'start' }));
        start.dataset.focus = '';
        if (waiting.length) {
          start.disabled = true;
          const names = waiting.map((m) => m.name);
          notes.push(h('p', { class: 'lan-status' }, `Waiting for ${names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ')} to get ready.`));
        }
        actions.append(start);
      } else {
        const ready = this.act(me.ready ? 'Not ready' : 'Ready', me.ready ? 'btn' : 'btn-primary', () => n.send({ t: 'me', ready: !me.ready }), 'ready');
        ready.dataset.focus = '';
        actions.append(ready);
        notes.push(h('p', { class: 'lan-status' }, me.ready ? 'The host starts the battle once everyone is ready.' : 'Choose a ship, then get ready.'));
      }
    }
    if (!('getGamepads' in navigator) || !window.isSecureContext) {
      notes.push(h('p', { class: 'lan-status' }, 'Gamepads only work in a browser on the host computer itself (at localhost). Over the network, use keyboard and mouse.'));
    }

    const title = h('h2', {});
    title.textContent = l.name;
    const hostName = l.members.find((m) => m.id === l.host)?.name ?? '';
    const sub = h('p', { class: 'lede' });
    sub.textContent = host ? 'You host this lobby: you pick the battle and start it.' : `Hosted by ${hostName}.`;
    const status = this.status();
    const err = this.errorLine();
    return h(
      'div',
      { class: 'sheet panel lan room' },
      title,
      sub,
      ...(status ? [status] : []),
      h('div', { class: 'lan-room' }, settings, h('div', { class: 'lan-teams' }, column(0), column(1))),
      ...notes,
      ...(err ? [err] : []),
      actions,
    );
  }

  private memberRow(l: LobbyState, m: Member, me: Member | null): HTMLElement {
    const spec = SHIP_BY_ID[m.shipId] ?? SHIP_BY_ID.yamato;
    const row = h('div', { class: `lan-member${m.id === me?.id ? ' you' : ''}${m.connected ? '' : ' away'}` });
    const icon = h('span', { class: 'cls', title: CLASS_LABEL[spec.cls] });
    icon.innerHTML = classIcon(spec.cls);
    const name = h('b', {});
    name.textContent = m.name + (m.id === me?.id ? ' (you)' : '');
    const ship = h('span', { class: 'ship' }, spec.name);
    const tag = h('span', { class: 'tag' });
    if (!m.connected) tag.textContent = 'Reconnecting';
    else if (m.id === l.host) {
      tag.innerHTML = glyph('star');
      tag.append(' Host');
      tag.classList.add('host');
    } else if (l.state === 'waiting') {
      tag.textContent = m.ready ? 'Ready' : 'Not ready';
      if (m.ready) tag.classList.add('ready');
    }
    row.append(icon, h('span', { class: 'who' }, name, ship), tag);
    return row;
  }
}
