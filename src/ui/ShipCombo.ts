import type { ShipSpec } from '../core/types';
import { ERA_LABEL, eraOf } from '../data/factions';
import { CLASS_LABEL, SHIP_BY_ID } from '../data/ships';
import { h } from './dom';
import { ShipChoiceModel, chipOf } from './ShipChoice';

export interface ShipComboOptions {
  /** Names the control, e.g. "Enemy AI slot 2". */
  label: string;
  ships: readonly ShipSpec[];
  value: string | null;
  /** Offer "Automatic" (null) as the first choice. */
  auto?: boolean;
  /** `data-k` of the button, for focus that survives a rebuild. */
  key: string;
  pick(id: string | null): void;
}

let uid = 0;

/**
 * A searchable ship choice: a button showing the ship, which opens a panel below it with a search
 * box and the ships grouped by era and class. Keys: ↑/↓, Home/End, Enter, Esc and type-ahead on the
 * list; a pad moves through it like any dialog and B closes it.
 */
export function shipCombo(o: ShipComboOptions): HTMLElement {
  const id = `ship-combo-${++uid}`;
  let value = o.value;
  let model: ShipChoiceModel | null = null;
  const trigger = h('button', { type: 'button', class: 'ship-combo-trigger', 'data-k': o.key, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': `${id}-panel` });
  const search = h('input', { type: 'search', placeholder: 'Find a ship, era or class…', 'aria-label': `${o.label} search`, 'aria-controls': `${id}-list`, autocomplete: 'off', 'data-k': `${o.key}-search` });
  const list = h('div', { class: 'ship-combo-list', role: 'listbox', id: `${id}-list`, 'aria-label': o.label });
  const close = h('button', { type: 'button', class: 'btn btn-quiet ship-combo-close', 'data-menu-back': '' }, 'Close');
  const panel = h('div', { class: 'ship-combo-panel', role: 'dialog', id: `${id}-panel`, 'aria-label': o.label, hidden: '' }, search, list, close);
  const root = h('div', { class: 'ship-combo' }, trigger, panel);

  const showValue = () => {
    const s = value ? SHIP_BY_ID[value] : null;
    trigger.replaceChildren(
      h('span', { class: 'cls-badge', 'aria-hidden': 'true' }, s ? chipOf(s.cls) : 'AUTO'),
      h('span', { class: 'ship-combo-name' }, h('b', {}, s ? s.name : 'Automatic'), h('small', {}, s ? `${ERA_LABEL[eraOf(s)]} · ${CLASS_LABEL[s.cls]}` : 'Balanced pick')),
    );
    trigger.setAttribute('aria-label', `${o.label}: ${s ? s.name : 'Automatic'}`);
  };

  const options = () => Array.from(list.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  const highlight = (focus: boolean) => {
    if (!model) return;
    const all = options();
    all.forEach((b, i) => b.classList.toggle('active', i === model!.active));
    const active = all[model.active];
    if (active) search.setAttribute('aria-activedescendant', active.id);
    else search.removeAttribute('aria-activedescendant');
    if (focus) active?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: 'nearest' });
  };
  const renderList = () => {
    if (!model) return;
    let n = 0;
    list.replaceChildren(...model.rows.map((r) => {
      if (r.kind === 'group') return h('div', { class: 'ship-combo-group', role: 'presentation' }, r.label);
      const index = n++;
      const b = h('button', { type: 'button', role: 'option', tabindex: '-1', id: `${id}-o${index}`, 'aria-selected': String(r.id === value) },
        h('span', { class: 'cls-badge', 'aria-hidden': 'true' }, r.badge), h('b', {}, r.label), h('small', {}, r.era));
      b.onclick = () => choose(r.id);
      b.onfocus = () => { if (model) { model.active = index; highlight(false); } };
      return b;
    }));
    if (!model.choices.length) list.append(h('p', { class: 'note' }, 'No ships match. Try another name, era or class.'));
    highlight(false);
  };

  const outside = (e: Event) => { if (!root.contains(e.target as Node)) hide(false); };
  const open = (seed = '') => {
    if (model) return;
    model = new ShipChoiceModel(o.ships, o.auto ?? false, value);
    if (seed) model.filter(seed);
    search.value = seed;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    renderList();
    search.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', outside, true);
  };
  const hide = (refocus: boolean) => {
    if (!model) return;
    model = null;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root.classList.remove('open');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) trigger.focus({ preventScroll: true });
  };
  const choose = (pick: string | null) => {
    if (pick !== value) {
      value = pick;
      showValue();
      o.pick(pick);
    }
    hide(true);
  };

  trigger.onclick = () => (model ? hide(true) : open());
  trigger.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    else if ([...e.key].length === 1 && e.key.trim() && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(e.key); }
  };
  search.oninput = () => { model?.filter(search.value); renderList(); };
  close.onclick = () => hide(true);
  panel.addEventListener('keydown', (e) => {
    if (!model || e.ctrlKey || e.metaKey || e.altKey) return;
    const inSearch = e.target === search;
    // Letters type into the search box; on the list they jump by name. Enter on a ship is its own click.
    if (inSearch && [...e.key].length === 1) return;
    if (!inSearch && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.target === close && e.key !== 'Escape') return;
    const action = model.key(e.key, performance.now());
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'close') hide(true);
    else if (action === 'pick') { const c = model.current; if (c) choose(c.id); }
    else highlight(!inSearch);
  });
  root.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (model && next && !root.contains(next)) hide(false);
  });

  showValue();
  return root;
}
