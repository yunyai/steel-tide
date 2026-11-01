import { eligibleShips, type AISelection } from '../core/FleetSelection';
import type { EraSel, ShipSpec } from '../core/types';
import { ERA_LABEL, eraOf } from '../data/factions';
import { field, h, seg } from './dom';
import { clearVisible, defaultPool, poolShips, selectVisible } from './FleetPool';
import { menuFeedback } from './MenuFeedback';
import { shipCombo } from './ShipCombo';
import { CLASS_CHIPS, chipOf } from './ShipChoice';
import { keepUi } from './uiMemory';

export interface FleetEditorProps {
  era: EraSel;
  titans: boolean;
  value: AISelection | undefined;
  /** AI ships the fleet sails with. */
  count: number;
  /** Extra AI ships added against the other side's titans. */
  reinforcements: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Shared solo/LAN editor; assignments apply once to each requested AI slot. It lives as long as its
 * screen: `update` redraws it in place, keeping the search, class filters, scroll and focus.
 */
export class FleetEditor {
  readonly el: HTMLElement;
  private props: FleetEditorProps;
  private current: AISelection;
  private ships: ShipSpec[] = [];
  private query = '';
  private chips: string[] = [];
  private readonly key: string;

  constructor(private readonly label: string, props: FleetEditorProps, private readonly put: (v: AISelection) => void) {
    this.key = `fleet-${label}`;
    this.el = h('section', { class: 'fleet-editor', 'aria-label': label });
    menuFeedback(this.el);
    this.props = props;
    this.current = structuredClone(props.value ?? { mode: 'auto' });
    this.render();
  }

  update(props: FleetEditorProps): void {
    const value = props.value ?? { mode: 'auto' };
    if (same(props, this.props) && same(value, this.current)) return;
    this.props = props;
    if (!same(value, this.current)) this.current = structuredClone(value);
    keepUi(this.el, () => this.render());
  }

  private commit(): void {
    this.put(structuredClone(this.current));
  }

  private redraw(): void {
    keepUi(this.el, () => this.render());
  }

  private render(): void {
    const { era, titans, count, reinforcements } = this.props;
    this.ships = eligibleShips(era, titans);
    const modes = seg<AISelection['mode']>([{ value: 'auto', label: 'Automatic' }, { value: 'pool', label: 'Random pool' }, { value: 'assign', label: 'Assignments' }], () => this.current.mode, (mode) => {
      this.current = { ...this.current, mode };
      if (mode === 'pool') this.current.pool ??= defaultPool(this.ships);
      if (mode === 'assign') delete this.current.pool;
      this.commit();
      this.redraw();
      if (mode !== 'auto') queueMicrotask(() => this.el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    }, undefined, `${this.key}-mode`);
    modes.classList.add('fleet-modes');
    modes.setAttribute('aria-label', `${this.label} ship selection`);
    const parts: HTMLElement[] = [
      h('div', { class: 'fleet-heading' }, h('h3', {}, this.label),
        h('span', { class: 'fleet-count' }, `${count} AI ${count === 1 ? 'ship' : 'ships'}${reinforcements ? ` + ${reinforcements} reinforcements` : ''}`)),
      modes, this.body(),
    ];
    if (reinforcements) parts.push(h('p', { class: 'note fleet-reinforcements' }, `${reinforcements} extra ships are added against the opposing titan. They are never titans: they come from this fleet's pool, or automatic selection; assignments are not repeated.`));
    this.el.replaceChildren(...parts);
  }

  private body(): HTMLElement {
    const body = h('div', { class: 'fleet-detail' });
    const { count } = this.props;
    if (!count) {
      body.append(h('p', { class: 'note' }, 'No AI ships. Increase the AI count above to add ships to this fleet.'));
      return body;
    }
    if (this.current.mode === 'auto') {
      body.append(h('p', { class: 'note' }, 'Balanced automatic composition, including any titan reinforcements.'));
      return body;
    }
    if (this.current.mode === 'assign') body.append(this.slots(), this.fallback());
    if (this.current.mode === 'pool' || this.current.pool !== undefined) body.append(this.poolEditor());
    return body;
  }

  private slots(): HTMLElement {
    const allowed = new Set(this.ships.map((s) => s.id));
    const slots = h('div', { class: 'fleet-slots', 'data-scroll-key': `${this.key}-slots` });
    for (let i = 0; i < this.props.count; i++) {
      const assigned = this.current.slots?.[i];
      const combo = shipCombo({
        label: `${this.label} AI slot ${i + 1}`,
        ships: this.ships,
        value: assigned && allowed.has(assigned) ? assigned : null,
        auto: true,
        key: `${this.key}-slot-${i}`,
        pick: (id) => {
          this.current.slots ??= [];
          this.current.slots[i] = id;
          this.commit();
        },
      });
      slots.append(h('div', { class: 'fleet-slot' }, h('span', { class: 'fleet-slot-label', 'aria-hidden': 'true' }, `Ship ${i + 1}`), combo));
    }
    return slots;
  }

  private fallback(): HTMLElement {
    return field('Automatic slots and reinforcements',
      seg([{ value: 'auto', label: 'Balanced' }, { value: 'pool', label: 'Use pool' }], () => (this.current.pool === undefined ? 'auto' : 'pool'), (mode) => {
        if (mode === 'pool') this.current.pool ??= defaultPool(this.ships);
        else delete this.current.pool;
        this.commit();
        this.redraw();
      }, undefined, `${this.key}-fallback`),
      'Each assigned ship fills one slot. Unassigned slots and extra ships against titans use this selection.',
    );
  }

  private poolEditor(): HTMLElement {
    const ships = this.ships;
    const key = this.key;
    const summary = h('p', { class: 'fleet-pool-count', 'aria-live': 'polite' });
    const warning = h('p', { class: 'note error', role: 'status' });
    const search = h('input', { type: 'search', placeholder: 'Find a ship, era or nation…', 'aria-label': `${this.label} search ships`, 'data-k': `${key}-search` });
    search.value = this.query;
    const list = h('div', { class: 'fleet-pool', role: 'group', 'aria-label': `${this.label} allowed pool`, 'data-scroll-key': `${key}-pool` });
    // A class the era no longer has can't stay pressed with no chip left to release it.
    const present = new Set(ships.map((s) => chipOf(s.cls)));
    this.chips = this.chips.filter((c) => present.has(c));
    const visible = () => poolShips(ships, this.query, this.chips);
    const setPool = (pool: string[]) => {
      const allowed = new Set(ships.map((s) => s.id));
      this.current.pool = pool.filter((id) => allowed.has(id));
      this.commit();
    };
    const updateCount = () => {
      const n = ships.filter((s) => this.current.pool?.includes(s.id)).length;
      summary.textContent = `${n} of ${ships.length} ships selected`;
      warning.textContent = n ? '' : 'Choose at least one ship to start this fleet.';
      warning.hidden = n > 0;
    };
    const renderChoices = () => {
      const shown = visible();
      list.replaceChildren(...shown.map((s) => {
        const checkbox = h('input', { type: 'checkbox', value: s.id, 'data-k': `${key}-ship-${s.id}` });
        checkbox.checked = this.current.pool?.includes(s.id) ?? false;
        checkbox.onchange = () => {
          const pool = this.current.pool ?? [];
          setPool(checkbox.checked ? selectVisible(pool, [s]) : clearVisible(pool, [s]));
          updateCount();
        };
        return h('label', { class: 'fleet-pool-choice' }, checkbox,
          h('span', { class: 'cls-badge', 'aria-hidden': 'true' }, chipOf(s.cls)), h('b', {}, s.name), h('small', {}, ERA_LABEL[eraOf(s)]));
      }));
      if (!shown.length) list.append(h('p', { class: 'note' }, 'No ships match. Try another name or class.'));
    };
    search.oninput = () => { this.query = search.value; renderChoices(); };
    const chips = h('div', { class: 'fleet-chips', role: 'group', 'aria-label': `${this.label} filter class` },
      ...CLASS_CHIPS.filter((c) => present.has(c.id)).map((c) => {
        const b = h('button', { type: 'button', class: 'fleet-chip', 'aria-pressed': String(this.chips.includes(c.id)), 'data-k': `${key}-chip-${c.id}`, title: c.label }, c.id);
        b.setAttribute('aria-label', c.label);
        b.onclick = () => {
          this.chips = this.chips.includes(c.id) ? this.chips.filter((x) => x !== c.id) : [...this.chips, c.id];
          b.setAttribute('aria-pressed', String(this.chips.includes(c.id)));
          renderChoices();
        };
        return b;
      }));
    const act = (name: string, change: (pool: string[]) => string[]) => {
      const button = h('button', { type: 'button', class: 'btn btn-quiet', 'data-k': `${key}-${name}` }, name);
      button.onclick = () => { setPool(change(this.current.pool ?? [])); updateCount(); renderChoices(); };
      return button;
    };
    updateCount();
    renderChoices();
    return h('div', { class: 'fleet-pool-editor' },
      h('div', { class: 'fleet-pool-toolbar' }, summary, act('Select visible', (pool) => selectVisible(pool, visible())), act('Clear visible', (pool) => clearVisible(pool, visible()))),
      h('div', { class: 'fleet-pool-filters' }, search, chips), list, warning,
      h('p', { class: 'note' }, 'Check ships to allow them. Each random slot draws separately, so duplicates can sail.'),
    );
  }
}
