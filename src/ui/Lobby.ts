import { fleetEditor } from './FleetEditor';
import { randomShip, selectionError } from '../core/FleetSelection';
import { DIFFICULTIES, SHIFT_TEMPOS, type ShiftTempo } from '../config';
import type { DifficultyId } from '../core/BattleSetup';
import type { BattleEra, ShipSpec, Team } from '../core/types';
import { ERA_LABEL } from '../data/factions';
import { CLASS_LABEL, LINE_ERAS, SHIP_BY_ID, titansOf } from '../data/ships';
import type { NetClient } from '../net/NetClient';
import { type LobbySettings, type LobbyState, MAX_AI, MAX_PER_TEAM, type Member, NAME_MAX, type ServerMsg } from '../net/protocol';
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

const TYPE_LABEL: Record<LobbySettings['type'], string> = { domination: 'Domination', annihilation: 'Annihilation', convoy: 'Convoy', freeplay: 'Free play' };
const FREEPLAY_NOTE = 'No score and no clock. Sunk ships come back after 8 s; change ship from the battle menu (Esc). The host ends it.';
const TEAM_LABEL = ['Team A', 'Team B'];
/** Eras with ships to sail, then Mixed once there are two. */
const LAN_ERAS: BattleEra[] = LINE_ERAS.length > 1 ? [...LINE_ERAS, 'mixed'] : LINE_ERAS;

function eraLabel(e: BattleEra): string {
  return e === 'mixed' ? 'Mixed' : ERA_LABEL[e];
}

/** Fleet sizes as the battle will build them (see buildRoster): captains, the host's AI ships, and two more AI ships per enemy titan (only in a fleet that has AI). */
function fleetSizes(l: LobbyState): [number, number] {
  const humans = (t: Team) => l.members.filter((m) => m.team === t);
  const titans = (t: Team) => (l.settings.titans ? humans(t).filter((m) => SHIP_BY_ID[m.shipId]?.cls === 'TT').length : 0);
  const size = (t: Team) => {
    const bots = l.settings.ai[t];
    return humans(t).length + bots + (bots > 0 ? titans(t === 0 ? 1 : 0) * 2 : 0);
  };
  return [size(0), size(1)];
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
  pickShip(shipId: string,architectLoadout?:import('../data/architectLoadout').ArchitectLoadout): void {
    this.net.send({ t: 'me', shipId,architectLoadout });
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
    const menuOption = (document.activeElement as HTMLElement | null)?.dataset?.menuOption;
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text' && this.root.contains(document.activeElement);
    if (typing) return this.renderStatusOnly();
    const lobby = this.net.status === 'online' ? this.net.lobby : null;
    const view = lobby ? `room-${lobby.id}` : 'list';
    const scrollers = () => Array.from(this.root.querySelectorAll<HTMLElement>('.lan-room-body, [data-scroll-key]'));
    const scroll = new Map(view === this.view ? scrollers().map(el => [el.dataset.scrollKey ?? 'room', { top: el.scrollTop, left: el.scrollLeft }]) : []);
    const filters = Array.from(this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.fleet-pool-filters [data-k]')).map(el => ({ key: el.dataset.k!, value: el.value }));
    this.root.replaceChildren(lobby ? this.room(lobby) : this.list());
    for (const f of filters) {
      const el = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k="${CSS.escape(f.key)}"]`);
      if (el) { el.value = f.value; el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input')); }
    }
    scrollers().forEach(el => {
      const position = scroll.get(el.dataset.scrollKey ?? 'room');
      if (position) { el.scrollTop = position.top; el.scrollLeft = position.left; }
    });
    // The default focus only on arriving at a screen, never on a refresh of the same one.
    const el = focused ? this.root.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`) : view !== this.view ? this.root.querySelector<HTMLElement>('[data-focus]') : null;
    this.view = view;
    if (el && menuOption !== undefined) el.dataset.menuOption = menuOption;
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
      e.preventDefault();
      name.blur();
    };
    const create = this.act('Create lobby', 'btn-primary', () => n.send({ t: 'create', name: `${n.name}'s fleet` }));
    // Typing holds back full renders (only the lobby rows refresh). Catch up on blur without
    // replacing the buttons: a click that took focus from the box must land on the one pressed.
    name.onblur = () => {
      commit();
      create.disabled = n.status !== 'online';
    };
    create.disabled = n.status !== 'online';
    create.dataset.focus = '';
    return h(
      'div',
      { class: 'sheet panel lan' },
      h('h2', {}, 'LAN battle'),
      h('p', { class: 'lede' }, 'Sail with friends on the same network. Pick sides for a fleet battle, or put everyone on one team against the AI. The host sets how many AI ships sail with each team, from none to eight.'),
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
      const sg = <T extends string | number>(opts: { value: T; label: string }[], get: () => T, put: (v: T) => void) => seg(opts, get, put, () => this.hooks.click(), `lobby-setting-${opts[0].label}`);
      settings.append(
        field(
          'Battle type',
          sg<LobbySettings['type']>((['domination', 'annihilation', 'convoy', 'freeplay'] as const).map((v) => ({ value: v, label: TYPE_LABEL[v] })), () => st.type, (v) => set({ type: v })),
          st.type === 'freeplay' ? FREEPLAY_NOTE : undefined,
        ),
      );
      if (st.type === 'convoy') settings.append(field('Transports sail with', sg<Team>([0, 1].map((t) => ({ value: t as Team, label: TEAM_LABEL[t] })), () => st.escortTeam, (v) => set({ escortTeam: v }))));
      settings.append(
        field('Map', sg(MAPS.map((m) => ({ value: m.id, label: m.name })), () => st.mapId, (v) => set({ mapId: v }))),
        field('AI skill', sg<DifficultyId>((Object.keys(DIFFICULTIES) as DifficultyId[]).map((k) => ({ value: k, label: DIFFICULTIES[k].label })), () => st.difficulty, (v) => set({ difficulty: v }))),
      );
      settings.append(field('Titan Shift', sg<ShiftTempo>((Object.keys(SHIFT_TEMPOS) as ShiftTempo[]).map(value => ({ value, label: SHIFT_TEMPOS[value].label })), () => st.shiftTempo ?? 'staggered', shiftTempo => set({ shiftTempo }))));
      // Anime has no hangar titans (its ships become titans by Titan Shift), so the switch has nothing to gate.
      if (titansOf(st.era).length) settings.append(field('Titans', sg([{ value: 1, label: 'Allowed' }, { value: 0, label: 'Not allowed' }], () => (st.titans ? 1 : 0), (v) => set({ titans: v === 1 }))));
      if (LAN_ERAS.length > 1) settings.append(field('Era', sg<BattleEra>(LAN_ERAS.map((e) => ({ value: e, label: eraLabel(e) })), () => st.era, (v) => set({ era: v }))));
    } else {
      const facts: [string, string][] = [
        ['Battle type', TYPE_LABEL[st.type] + (st.type === 'convoy' ? `, transports with ${TEAM_LABEL[st.escortTeam]}` : '')],
        ['Map', mapName],
        ['AI skill', DIFFICULTIES[st.difficulty].label],
        ...(titansOf(st.era).length ? [['Titans', st.titans ? 'Allowed' : 'Not allowed'] as [string, string]] : []),
        ['Era', eraLabel(st.era)],
        ['Titan Shift', SHIFT_TEMPOS[st.shiftTempo ?? 'staggered'].label],
      ];
      settings.append(h('dl', { class: 'lan-facts' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
      if (st.type === 'freeplay') settings.append(h('p', { class: 'note' }, FREEPLAY_NOTE));
    }

    const poolError = selectionError(st.aiSelection, st.era, st.titans, st.ai);
    if (poolError) settings.append(h('p', { class: 'note error', role: 'alert' }, poolError));
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
      // The titan answer: AI ships the host did not set, added against the other side's titans.
      const extra = ai - st.ai[t];
      if (host && l.state === 'waiting') {
        const step = (d: number, label: string, name: string) => {
          const b = this.act(label, 'step', () => set({ ai: t === 0 ? [st.ai[0] + d, st.ai[1]] : [st.ai[0], st.ai[1] + d] }), `ai-${t}-${d}`);
          b.setAttribute('aria-label', `${name} AI ships for ${TEAM_LABEL[t]}`);
          b.disabled = st.ai[t] + d < 0 || st.ai[t] + d > MAX_AI;
          return b;
        };
        const row = h('div', { class: 'lan-ai lan-ai-step' }, h('span', {}, 'AI ships'), step(-1, '−', 'Fewer'), h('b', { class: 'num', 'aria-live': 'polite' }, String(st.ai[t])), step(1, '+', 'More'));
        if (extra > 0) row.append(h('span', {}, `+ ${extra} against titans`));
        col.append(row);
      } else col.append(h('p', { class: 'lan-ai' }, ai > 0 ? `+ ${ai} AI ${ai === 1 ? 'ship' : 'ships'}` : 'No AI ships'));
      if (host && l.state === 'waiting') col.append(fleetEditor(`${TEAM_LABEL[t]} AI`, st.era, st.titans, st.aiSelection?.[t], st.ai[t], value => {
        const aiSelection: NonNullable<LobbySettings['aiSelection']> = structuredClone(st.aiSelection ?? [{ mode: 'auto' }, { mode: 'auto' }]);
        aiSelection[t] = value;
        set({ aiSelection });
      }, extra));
      else if (st.aiSelection?.[t]) col.append(h('p', { class: 'note' }, `AI selection: ${st.aiSelection[t].mode}`));
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
        const empty = st.type === 'freeplay' ? -1 : sizes.findIndex((n) => n === 0);
        if (waiting.length) {
          start.disabled = true;
          const names = waiting.map((m) => m.name);
          notes.push(h('p', { class: 'lan-status' }, `Waiting for ${names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ')} to get ready.`));
        } else if (empty >= 0) {
          start.disabled = true;
          notes.push(h('p', { class: 'lan-status' }, `${TEAM_LABEL[empty]} has no ships: add AI ships or a captain. Free play can start with an empty side.`));
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
      h('div', { class: 'lan-room-body' },
        h('div', { class: 'lan-room' }, settings, h('div', { class: 'lan-teams' }, column(0), column(1))),
        ...notes,
        ...(err ? [err] : []),
      ),
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
    if (m.id === me?.id && l.state === 'waiting') row.append(this.act('Random ship', 'btn-quiet', () => {
      const s = randomShip(l.settings.era, Math.random);
      if (s) this.pickShip(s.id);
    }));
    return row;
  }
}
