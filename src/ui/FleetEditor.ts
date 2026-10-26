import { eligibleShips, type AISelection } from '../core/FleetSelection';
import type { BattleEra } from '../core/types';
import { field, h, seg } from './dom';

/** Shared solo/LAN editor; AI slots never include human captains. */
export function fleetEditor(label: string, era: BattleEra, titans: boolean, value: AISelection | undefined, count: number, put: (v: AISelection) => void): HTMLElement {
  let current: AISelection = structuredClone(value ?? { mode: 'auto' });
  const root = h('section', { class: 'fleet-editor', 'aria-label': label });
  const body = h('div', { class: 'fleet-detail' });
  const ships = eligibleShips(era, titans);
  const render = () => {
    body.replaceChildren();
    if (current.mode === 'auto') {
      body.append(h('p', { class: 'note' }, 'Balanced automatic composition.'));
      return;
    }
    if (current.mode === 'pool' || current.pool !== undefined) {
      const pool = h('select', { multiple: '', size: '6', 'aria-label': `${label} allowed pool`, 'data-k': `fleet-${label}-pool` });
      for (const s of ships) {
        const option = h('option', { value: s.id }, s.name);
        option.selected = current.pool?.includes(s.id) ?? false;
        pool.append(option);
      }
      pool.onchange = () => {
        current.pool = Array.from(pool.selectedOptions, o => o.value);
        put(structuredClone(current));
      };
      body.append(field('Allowed pool', pool, 'Select one or more ships. Duplicates may sail. Extra ships against titans use this pool.'));
    }
    if (current.mode === 'assign') {
      for (let i = 0; i < count; i++) {
        const select = h('select', { 'aria-label': `${label} AI slot ${i + 1}`, 'data-k': `fleet-${label}-slot-${i}` }, h('option', { value: '' }, 'Automatic'));
        for (const s of ships) select.append(h('option', { value: s.id }, s.name));
        select.value = current.slots?.[i] ?? '';
        select.onchange = () => {
          current.slots ??= [];
          current.slots[i] = select.value || null;
          put(structuredClone(current));
        };
        body.append(field(`AI slot ${i + 1}`, select));
      }
    }
  };
  root.append(h('h3', {}, label), seg<AISelection['mode']>([{ value: 'auto', label: 'Automatic' }, { value: 'pool', label: 'Random pool' }, { value: 'assign', label: 'Assignments' }], () => current.mode, mode => {
    current = { ...current, mode };
    if (mode === 'pool') current.pool ??= ships.filter(s => s.cls !== 'TT').map(s => s.id);
    put(structuredClone(current));
    render();
  }, () => {}, `fleet-${label}-mode`), body);
  render();
  return root;
}
