import { eligibleShips, type AISelection } from '../core/FleetSelection';
import type { BattleEra } from '../core/types';
import { ERA_LABEL, FACTIONS, eraOf } from '../data/factions';
import { CLASS_LABEL } from '../data/ships';
import { field, h, seg } from './dom';
import { menuFeedback } from './MenuFeedback';

/** Shared solo/LAN editor; assignments apply once to each requested AI slot. */
export function fleetEditor(label: string, era: BattleEra, titans: boolean, value: AISelection | undefined, count: number, put: (v: AISelection) => void, reinforcements = 0): HTMLElement {
  let current: AISelection = structuredClone(value ?? { mode: 'auto' });
  const ships = eligibleShips(era, titans);
  const allowed = new Set(ships.map(s => s.id));
  const key = `fleet-${label}`;
  const root = h('section', { class: 'fleet-editor', 'aria-label': label });
  menuFeedback(root);
  const body = h('div', { class: 'fleet-detail' });
  const commit = () => put(structuredClone(current));
  const defaultPool = () => ships.filter(s => s.cls !== 'TT').map(s => s.id);

  const poolEditor = () => {
    const summary = h('p', { class: 'fleet-pool-count', 'aria-live': 'polite' });
    const warning = h('p', { class: 'note error', role: 'status' });
    const search = h('input', { type: 'search', placeholder: 'Find a ship or era…', 'aria-label': `${label} search ships`, 'data-k': `${key}-search` });
    const filter = h('select', { 'aria-label': `${label} filter class`, 'data-k': `${key}-class` }, h('option', { value: '' }, 'All classes'));
    for (const cls of new Set(ships.map(s => s.cls))) filter.append(h('option', { value: cls }, CLASS_LABEL[cls]));
    const list = h('div', { class: 'fleet-pool', role: 'group', 'aria-label': `${label} allowed pool`, 'data-scroll-key': `${key}-pool` });
    const updateCount = () => {
      const n = ships.filter(s => current.pool?.includes(s.id)).length;
      summary.textContent = `${n} of ${ships.length} ships selected`;
      warning.textContent = n ? '' : 'Choose at least one ship to start this fleet.';
      warning.hidden = n > 0;
    };
    const renderChoices = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const visible = ships.filter(s => (!filter.value || s.cls === filter.value) &&
        `${s.name} ${ERA_LABEL[eraOf(s)]} ${FACTIONS[s.nation].label}`.toLocaleLowerCase().includes(query));
      list.replaceChildren(...visible.map(s => {
        const checkbox = h('input', { type: 'checkbox', value: s.id, 'data-k': `${key}-ship-${s.id}` });
        checkbox.checked = current.pool?.includes(s.id) ?? false;
        checkbox.onchange = () => {
          const selected = new Set(current.pool?.filter(id => allowed.has(id)));
          if (checkbox.checked) selected.add(s.id); else selected.delete(s.id);
          current.pool = [...selected];
          updateCount();
          commit();
        };
        return h('label', { class: 'fleet-pool-choice' }, checkbox,
          h('span', {}, h('b', {}, s.name), h('small', {}, `${ERA_LABEL[eraOf(s)]} · ${CLASS_LABEL[s.cls]}`)));
      }));
      if (!visible.length) list.append(h('p', { class: 'note' }, 'No ships match. Try another name or class.'));
    };
    search.oninput = renderChoices;
    filter.onchange = renderChoices;
    const act = (name: string, ids: () => string[]) => {
      const button = h('button', { class: 'btn btn-quiet', 'data-k': `${key}-${name}` }, name);
      button.onclick = () => { current.pool = ids(); updateCount(); renderChoices(); commit(); };
      return button;
    };
    updateCount();
    renderChoices();
    return h('div', { class: 'fleet-pool-editor' },
      h('div', { class: 'fleet-pool-toolbar' }, summary, act('All ships', () => ships.map(s => s.id)), act('Clear', () => [])),
      h('div', { class: 'fleet-pool-filters' }, search, filter), list, warning,
      h('p', { class: 'note' }, 'Check ships to allow them. Each random slot draws separately, so duplicates can sail.'),
    );
  };

  const render = () => {
    body.replaceChildren();
    if (!count) {
      body.append(h('p', { class: 'note' }, 'No AI ships. Increase the AI count above to add ships to this fleet.'));
      return;
    }
    if (current.mode === 'auto') {
      body.append(h('p', { class: 'note' }, 'Balanced automatic composition, including any titan reinforcements.'));
      return;
    }
    if (current.mode === 'assign') {
      const slots = h('div', { class: 'fleet-slots', 'data-scroll-key': `${key}-slots` });
      for (let i = 0; i < count; i++) {
        const id = `${key}-slot-${i}`;
        const select = h('select', { id, 'aria-label': `${label} AI slot ${i + 1}`, 'data-k': id }, h('option', { value: '' }, 'Automatic'));
        for (const e of new Set(ships.map(eraOf))) {
          const group = h('optgroup', { label: ERA_LABEL[e] });
          for (const s of ships.filter(s => eraOf(s) === e)) group.append(h('option', { value: s.id }, `${s.name} · ${CLASS_LABEL[s.cls]}`));
          select.append(group);
        }
        select.value = current.slots?.[i] && allowed.has(current.slots[i]!) ? current.slots[i]! : '';
        select.onchange = () => {
          current.slots ??= [];
          current.slots[i] = select.value || null;
          commit();
        };
        slots.append(h('div', { class: 'fleet-slot' }, h('label', { for: id }, `Ship ${i + 1}`), select));
      }
      body.append(slots, field('Automatic slots and reinforcements',
        seg([{ value: 'auto', label: 'Balanced' }, { value: 'pool', label: 'Use pool' }],
          () => current.pool === undefined ? 'auto' : 'pool', mode => {
            const focused = (document.activeElement as HTMLElement | null)?.dataset.k;
            if (mode === 'pool') current.pool ??= defaultPool(); else delete current.pool;
            commit(); render();
            if (focused) queueMicrotask(() => root.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true }));
          }, () => {}, `${key}-fallback`),
        'Each assigned ship fills one slot. Unassigned slots and extra ships against titans use this selection.',
      ));
    }
    if (current.mode === 'pool' || current.pool !== undefined) body.append(poolEditor());
  };
  const modes = seg<AISelection['mode']>([{ value: 'auto', label: 'Automatic' }, { value: 'pool', label: 'Random pool' }, { value: 'assign', label: 'Assignments' }], () => current.mode, mode => {
    current = { ...current, mode };
    if (mode === 'pool') current.pool ??= defaultPool();
    if (mode === 'assign') delete current.pool;
    commit(); render();
    if (mode !== 'auto') queueMicrotask(() => root.scrollIntoView({ block: 'start', inline: 'nearest' }));
  }, () => {}, `${key}-mode`);
  modes.classList.add('fleet-modes');
  modes.setAttribute('aria-label', `${label} ship selection`);
  root.append(h('div', { class: 'fleet-heading' }, h('h3', {}, label),
    h('span', { class: 'fleet-count' }, `${count} AI ${count === 1 ? 'ship' : 'ships'}${reinforcements ? ` + ${reinforcements} reinforcements` : ''}`)), modes, body);
  if (reinforcements) root.append(h('p', { class: 'note fleet-reinforcements' }, `${reinforcements} extra ships are added against the opposing titan. They use automatic selection; assignments are not repeated.`));
  render();
  return root;
}
