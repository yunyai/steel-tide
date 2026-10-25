import type { BattleEra, Era } from '../../core/types';
import { ERA_LABEL, ERAS } from '../../data/factions';
import { h } from '../../ui/dom';
import { vehicleClassIcon } from '../../ui/Icons';
import { ARMY, vehiclesIn } from '../sim/data';
import { CLASS_NAME, VEHICLE_CLASSES, type VehicleClass, type VehicleSpec } from '../sim/types';
import type { Vehicle } from '../sim/Vehicle';

// Free play's vehicle picker, opened from the battle menu: the next vehicle to drive, from the next
// respawn or (while in the fight) right away. The ship picker's sheet, with ground classes.

export interface VehiclePickerOptions {
  /** The player's vehicle now (a new hull after a change of vehicle). */
  vehicle(): Vehicle;
  era: BattleEra;
  titans: boolean;
  /** Drive `spec` from the next respawn; `now` also leaves the fight to change into it. */
  pick(spec: VehicleSpec, now: boolean): void;
  back(): void;
  click(): void;
}

/** Eras with at least one vehicle to offer. */
export const GROUND_ERAS: Era[] = ERAS.filter((e) => vehiclesIn(e).some((v) => !v.hidden));

/** The picker, and `sync` to run each frame: it redraws when the vehicle dies, respawns or changes. */
export function buildVehiclePicker(o: VehiclePickerOptions): { el: HTMLElement; sync(): void } {
  let me = o.vehicle();
  const offered = (era: BattleEra) => vehiclesIn(era).filter((s) => !s.hidden && (o.titans || s.cls !== 'TT'));
  const eras: Era[] = o.era === 'mixed' ? GROUND_ERAS : [o.era];
  let spec = me.nextSpec ?? me.spec;
  if (!offered(o.era).includes(spec)) spec = offered(o.era)[0];
  let era: Era = eras.includes(spec.era) ? spec.era : eras[0];
  let tab: VehicleClass = spec.cls;

  const overlay = h('div', { class: 'overlay' });
  const sheet = h('div', { class: 'sheet panel picker', role: 'dialog', 'aria-label': 'Change vehicle' });
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
    const meta = h('p', { class: 'meta' }, `${CLASS_NAME[s.cls]}, ${ARMY[s.nation].label}. ${s.hp.toLocaleString()} hit points, ${Math.round(s.drive.maxSpeed)} km/h`);
    const actions = h('div', { class: 'picker-actions' });
    const current = s === me.spec;
    if (me.alive) {
      if (current && !me.nextSpec) actions.append(h('p', { class: 'note' }, 'You are driving this vehicle.'));
      else if (current) actions.append(act('Keep this vehicle', 'btn-primary', () => o.pick(s, false)));
      else {
        actions.append(
          act('Switch now (back in 8 s)', 'btn-primary', () => o.pick(s, true)),
          act('At next respawn', '', () => o.pick(s, false)),
        );
      }
    } else actions.append(act(current && !me.nextSpec ? 'Drive this one again' : 'Drive this one next', 'btn-primary', () => o.pick(s, false)));
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
    const here = offered(era);
    const tabs = VEHICLE_CLASSES.filter((c) => here.some((s) => s.cls === c));
    if (!tabs.includes(tab)) tab = tabs[0];
    classTabs.replaceChildren(
      ...tabs.map((c) => {
        const b = h('button', { class: c === 'TT' ? 'titan' : '', 'aria-pressed': String(tab === c) }, CLASS_NAME[c]);
        b.onclick = () => {
          o.click();
          tab = c;
          renderList();
        };
        return b;
      }),
    );
    list.replaceChildren(
      ...here
        .filter((s) => s.cls === tab)
        .map((s) => {
          const b = h('button', { 'aria-pressed': String(s === spec), class: s.cls === 'TT' ? 'tt' : '' });
          b.innerHTML = vehicleClassIcon(s.cls);
          const mark = s === me.spec ? 'Driving' : s === me.nextSpec ? 'Next' : ARMY[s.nation].short;
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

  const renderLede = () => {
    const next = me.nextSpec;
    lede.textContent = me.alive
      ? `Driving ${me.spec.name}${next ? `; ${next.name} is next` : ''}. Switch now to leave the fight and come back in the new vehicle after 8 seconds, or change at your next respawn.`
      : `Pick the vehicle you drive when you come back${next ? `: ${next.name} so far` : ''}.`;
  };
  renderLede();
  renderList();
  renderDetail();
  sheet.append(
    h('h2', {}, 'Change vehicle'),
    lede,
    h('div', { class: 'picker-body' }, h('nav', { class: 'picker-roster', 'aria-label': 'Vehicles' }, eraTabs, classTabs, list), detail),
    h('div', { class: 'sheet-actions' }, back),
  );
  overlay.append(sheet);
  queueMicrotask(() => list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true }));
  let seen = { v: me, alive: me.alive, next: me.nextSpec };
  const sync = () => {
    const v = o.vehicle();
    if (v === seen.v && v.alive === seen.alive && v.nextSpec === seen.next) return;
    me = v;
    seen = { v, alive: v.alive, next: v.nextSpec };
    const focused = sheet.contains(document.activeElement);
    renderLede();
    renderList();
    renderDetail();
    if (focused) list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  };
  return { el: overlay, sync };
}
