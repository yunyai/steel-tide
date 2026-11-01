import type { Game } from '../core/Game';
import type { HitKind } from '../core/Events';
import { SANDBOX_CHEATS, type SandboxCheat } from '../net/protocol';
import type { Ship } from '../ships/Ship';
import { h } from './dom';
import { ComboLog, DPS_WINDOW, DpsMeter } from './SandboxMeter';

// The Sandbox readout beside the captain's HUD: what their hits add up to, the latest hits as a
// combo log, and which cheats are on. It reads `damage` events only, so it never touches the sim.

export const KIND_LABEL: Record<HitKind, string> = {
  gun: 'Main battery',
  secondary: 'Secondaries',
  torp: 'Torpedoes',
  air: 'Aircraft',
  missile: 'Missiles',
  skill: 'Skills',
  dot: 'Fire and flooding',
  reflect: 'Reflected',
};

export const CHEAT_LABEL: Record<SandboxCheat, string> = {
  cooldowns: 'No cooldowns',
  ult: 'Ultimate ready',
  consumables: 'Endless consumables',
  god: 'God mode',
  tough: 'Tough dummies',
};

const LOG_LINES = 6;
/** Seconds between redraws of the numbers. */
const REFRESH = 0.1;

const num = (n: number) => Math.round(n).toLocaleString();

/** The captain whose hit this is: summons, platforms and drones count for whoever sent them. */
function creditOf(s: Ship): Ship {
  return s.architectPlatform?.owner ?? s.architectDrone?.owner ?? s.summonOwner ?? s;
}

export class SandboxHud {
  readonly root = h('div', { class: 'sandbox-hud', role: 'status', 'aria-label': 'Sandbox damage meter' });
  readonly meter = new DpsMeter();
  readonly log = new ComboLog(LOG_LINES);
  private readonly dps = h('b', { class: 'num' }, '0');
  private readonly stats = h('div', { class: 'sandbox-stats num' });
  private readonly kinds = h('div', { class: 'sandbox-kinds' });
  private readonly list = h('ol', { class: 'sandbox-log' });
  private readonly cheats = h('div', { class: 'sandbox-cheats' });
  private readonly off: () => void;
  private wait = 0;
  private shown = '';

  constructor(
    parent: HTMLElement,
    private readonly game: Game,
    /** The local captain's current ship (it changes with a change of ship). */
    private readonly mine: () => Ship | undefined,
  ) {
    this.root.append(
      h('div', { class: 'sandbox-head' }, h('span', { class: 'label' }, `DPS (${DPS_WINDOW} s)`), this.dps),
      this.stats,
      this.kinds,
      this.list,
      this.cheats,
      h('p', { class: 'sandbox-keys' }, 'F6 tools · F7 meter · F8 reset'),
    );
    parent.append(this.root);
    this.off = game.events.view('damage', (e) => {
      const me = this.mine();
      if (!me || !e.attacker || creditOf(e.attacker) !== me || e.target.team === me.team) return;
      this.meter.add(game.time, e.amount, e.kind);
      this.log.add(game.time, e.skill?.name ?? KIND_LABEL[e.kind], e.kind, e.amount);
    });
    this.draw();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  reset(): void {
    this.meter.reset();
    this.log.reset();
    this.draw();
  }

  update(dt: number): void {
    this.wait -= dt;
    if (this.wait > 0 || this.root.hidden) return;
    this.wait = REFRESH;
    this.draw();
  }

  private draw(): void {
    const m = this.meter;
    const now = this.game.time;
    const sb = this.game.sandbox;
    const on = sb ? SANDBOX_CHEATS.filter((c) => sb.cheats[c]) : [];
    const key = [Math.round(m.dps(now)), m.peak, m.burst, m.total, this.log.entries.map((e) => `${e.source}${e.amount}${e.hits}`).join(), on.join()].join('|');
    if (key === this.shown) return;
    this.shown = key;
    this.dps.textContent = num(m.dps(now));
    this.stats.replaceChildren(
      ...([['Peak', m.peak], ['Burst (1 s)', m.burst], ['Total', m.total]] as const).map(([label, v]) => h('span', {}, h('i', {}, label), num(v))),
    );
    const total = m.total || 1;
    this.kinds.replaceChildren(
      ...m.breakdown().map(([kind, v]) => {
        const bar = h('i', { class: `bar k-${kind}` });
        bar.style.width = `${(v / total) * 100}%`;
        return h('div', { class: 'kind' }, h('span', {}, KIND_LABEL[kind]), h('span', { class: 'num' }, `${Math.round((v / total) * 100)}%`), bar);
      }),
    );
    this.list.replaceChildren(
      ...this.log.entries.map((e) =>
        h('li', { class: `k-${e.kind}` }, h('span', { class: 'src' }, e.source), h('b', { class: 'num' }, num(e.amount)), h('span', { class: 'num hits' }, e.hits > 1 ? `×${e.hits}` : ''), h('span', { class: 'num gap' }, e.gap > 0 ? `+${e.gap.toFixed(2)} s` : '')),
      ),
    );
    this.cheats.replaceChildren(...on.map((c) => h('span', { class: 'chip' }, CHEAT_LABEL[c])));
  }

  dispose(): void {
    this.off();
    this.root.remove();
  }
}
