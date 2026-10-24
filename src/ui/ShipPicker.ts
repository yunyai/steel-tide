import type { BattleEra, Era, ShipSpec } from '../core/types';
import { ERA_LABEL, FACTIONS, eraOf } from '../data/factions';
import { CLASS_LABEL, shipsIn, shipsOf } from '../data/ships';
import type { Ship } from '../ships/Ship';
import { h } from './dom';
import { classIcon } from './Icons';
import { LIVE_ERAS, TABS, type Tab, tabOf } from './Menu';

// Free play's ship picker, opened from the battle menu: the next ship to sail, from the next
// respawn or (while afloat) right away. No 3D preview: the battle owns the renderer.

export interface ShipPickerOptions {
  /** The captain's ship now. */
  ship: Ship;
  era: BattleEra;
  titans: boolean;
  /** Sail `spec` from the next respawn; `now` also leaves the fight to change into it. */
  pick(spec: ShipSpec, now: boolean): void;
  back(): void;
  click(): void;
}

export function buildShipPicker(o: ShipPickerOptions): HTMLElement {
  const me = o.ship;
  const allowed = (s: ShipSpec) => o.titans || s.cls !== 'TT';
  const eras: Era[] = o.era === 'mixed' ? LIVE_ERAS : [o.era];
  // Ships of the battle's era only (a mixed battle offers them all), titans when allowed.
  let spec = me.nextSpec ?? me.spec;
  if (!shipsIn(o.era).includes(spec) || !allowed(spec)) spec = shipsIn(o.era).find(allowed)!;
  let era: Era = eras.includes(eraOf(spec)) ? eraOf(spec) : eras[0];
  let tab: Tab = tabOf(spec.cls);

  const overlay = h('div', { class: 'overlay' });
  const sheet = h('div', { class: 'sheet panel picker', role: 'dialog', 'aria-label': 'Change ship' });
  const eraTabs = h('div', { class: 'era-tabs', role: 'group', 'aria-label': 'Era' });
  const classTabs = h('div', { class: 'class-tabs', role: 'group', 'aria-label': 'Class' });
  const list = h('div', { class: 'ship-list' });
  const detail = h('section', { class: 'picker-detail' });
  const lede = h('p', { class: 'lede' });
  const back = h('button', { class: 'btn btn-quiet' }, 'Back');
  back.onclick = () => {
    o.click();
    o.back();
  };

  const act = (label: string, cls: string, run: () => void): HTMLButtonElement => {
    const b = h('button', { class: `btn ${cls}` }, label);
    b.onclick = () => {
      o.click();
      run();
    };
    return b;
  };

  const renderDetail = () => {
    const s = spec;
    const f = FACTIONS[s.nation];
    const meta = h('p', { class: 'meta' }, `${CLASS_LABEL[s.cls]}, ${f.label}. ${s.hp.toLocaleString()} hull, ${+s.maxSpeed.toFixed(1)} knots`);
    const actions = h('div', { class: 'picker-actions' });
    const current = s === me.spec;
    if (me.alive) {
      if (current && !me.nextSpec) actions.append(h('p', { class: 'note' }, 'You are sailing this ship.'));
      else if (current) actions.append(act('Keep this ship', 'btn-primary', () => o.pick(s, false)));
      else {
        actions.append(
          act('Switch now (back in 8 s)', 'btn-primary', () => o.pick(s, true)),
          act('At next respawn', '', () => o.pick(s, false)),
        );
      }
    } else actions.append(act(current && !me.nextSpec ? 'Sail this one again' : 'Sail this one next', 'btn-primary', () => o.pick(s, false)));
    const name = h('h3', {}, s.name);
    if (s.cls === 'TT') name.classList.add('tt');
    detail.replaceChildren(name, meta, h('p', { class: 'specialty' }, s.specialty), actions);
  };

  const renderList = () => {
    eraTabs.hidden = eras.length < 2;
    eraTabs.replaceChildren(
      ...eras.map((e) => {
        const b = h('button', { class: `era-${e}`, 'aria-pressed': String(era === e) }, ERA_LABEL[e]);
        b.onclick = () => {
          o.click();
          era = e;
          renderList();
        };
        return b;
      }),
    );
    const here = shipsOf(era).filter(allowed);
    const tabs = TABS.filter((t) => here.some((s) => t.classes.includes(s.cls)));
    if (!tabs.some((t) => t.id === tab)) tab = tabs[0].id;
    classTabs.replaceChildren(
      ...tabs.map((t) => {
        const b = h('button', { class: t.id === 'TT' ? 'titan' : '', 'aria-pressed': String(tab === t.id) }, t.label);
        b.onclick = () => {
          o.click();
          tab = t.id;
          renderList();
        };
        return b;
      }),
    );
    const classes = TABS.find((t) => t.id === tab)!.classes;
    list.replaceChildren(
      ...here
        .filter((s) => classes.includes(s.cls))
        .map((s) => {
          const b = h('button', { 'aria-pressed': String(s === spec), class: s.cls === 'TT' ? 'tt' : '' });
          b.innerHTML = classIcon(s.cls);
          const mark = s === me.spec ? 'Sailing' : s === me.nextSpec ? 'Next' : FACTIONS[s.nation].short;
          b.append(h('b', {}, s.name), h('small', {}, mark));
          b.onclick = () => {
            o.click();
            spec = s;
            renderList();
            renderDetail();
          };
          return b;
        }),
    );
  };

  const next = me.nextSpec;
  lede.textContent = me.alive
    ? `Sailing ${me.spec.name}${next ? `; ${next.name} is next` : ''}. Switch now to leave the fight and come back in the new ship after 8 seconds, or change at your next respawn.`
    : `Pick the ship you sail when you come back${next ? `: ${next.name} so far` : ''}.`;
  renderList();
  renderDetail();
  sheet.append(
    h('h2', {}, 'Change ship'),
    lede,
    h('div', { class: 'picker-body' }, h('nav', { class: 'picker-roster', 'aria-label': 'Ships' }, eraTabs, classTabs, list), detail),
    h('div', { class: 'sheet-actions' }, back),
  );
  overlay.append(sheet);
  queueMicrotask(() => list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true }));
  return overlay;
}
