import type { Game } from '../core/Game';
import { bearingTo } from '../core/math';
import type { Team } from '../core/types';
import { SHIPS } from '../data/ships';
import { DUMMY_MODES, MAX_DUMMIES, SANDBOX_CHEATS, type DummyMode, type SandboxCmd } from '../net/protocol';
import type { Ship } from '../ships/Ship';
import { field, h, seg } from './dom';
import { CHEAT_LABEL } from './SandboxHud';
import { shipCombo } from './ShipCombo';

// The Sandbox tools sheet (F6, or "Sandbox tools" in the battle menu): cheats, spawning dummies,
// what the dummies do, and the damage meter. Every change is a command: solo applies it at once,
// a LAN host sends it through the turns, and a guest sees the controls but cannot change them.

export interface SandboxPanelOptions {
  game: Game;
  /** The local captain's ship: dummies spawn ahead of it or at its reticle. */
  me(): Ship | undefined;
  /** False for a LAN guest. */
  canEdit: boolean;
  send(cmd: SandboxCmd): void;
  meter: { visible: boolean; reset(): void };
  click(): void;
  back(): void;
  backLabel: string;
}

type Facing = 'toward' | 'broadside' | 'away';
type Place = 'ahead' | 'reticle';

const MODE_LABEL: Record<DummyMode, string> = { idle: 'Idle', sail: 'Sail', fight: 'Fight' };
const MODE_NOTE: Record<DummyMode, string> = {
  idle: 'Dummies sit still and hold fire.',
  sail: 'Dummies sail a 1.5 km square around their posts, guns quiet.',
  fight: 'Dummies fight like AI ships, and shoot back.',
};
const SPAWN_AHEAD = 3000;

/** The spawn choices, kept between openings of the sheet. */
const draft: { ship: string; n: number; enemy: boolean; facing: Facing; place: Place } = { ship: 'fletcher', n: 1, enemy: true, facing: 'toward', place: 'ahead' };

/** Where and how `draft` puts dummies for this captain. */
export function spawnCommand(me: Ship, aim: { x: number; z: number }): Extract<SandboxCmd, { k: 'spawn' }> {
  const ahead = draft.place === 'ahead';
  const x = ahead ? me.pos.x + Math.sin(me.heading) * SPAWN_AHEAD : aim.x;
  const z = ahead ? me.pos.z - Math.cos(me.heading) * SPAWN_AHEAD : aim.z;
  const toward = bearingTo(x, z, me.pos.x, me.pos.z);
  const heading = draft.facing === 'toward' ? toward : draft.facing === 'away' ? toward + Math.PI : toward + Math.PI / 2;
  const team: Team = draft.enemy ? (me.team === 0 ? 1 : 0) : me.team;
  return { k: 'spawn', ship: draft.ship, n: draft.n, team, x, z, heading };
}

export function buildSandboxPanel(o: SandboxPanelOptions): { el: HTMLElement; sync(): void } {
  const sb = o.game.sandbox!;
  const send = (cmd: SandboxCmd) => {
    if (!o.canEdit) return;
    o.click();
    o.send(cmd);
  };
  const button = (label: string, cls: string, run: () => void, key: string) => {
    const b = h('button', { type: 'button', class: `btn ${cls}`.trim(), 'data-k': key }, label);
    b.onclick = run;
    return b;
  };
  const edit = <T extends HTMLElement>(el: T): T => {
    if (!o.canEdit) for (const b of el.querySelectorAll<HTMLButtonElement>('button')) b.disabled = true;
    if (!o.canEdit && el instanceof HTMLButtonElement) el.disabled = true;
    return el;
  };

  // Cheats are toggles that show the battle's state, which on a LAN changes a turn after the click.
  const cheats = h('div', { class: 'seg seg-multi', role: 'group' });
  const cheatButtons = SANDBOX_CHEATS.map((c) => {
    const b = h('button', { type: 'button', 'data-k': `sandbox-cheat-${c}`, 'aria-pressed': String(sb.cheats[c]) }, CHEAT_LABEL[c]);
    b.onclick = () => send({ k: 'cheat', cheat: c, on: !sb.cheats[c] });
    cheats.append(b);
    return b;
  });

  const ships = SHIPS.filter((s) => !s.hidden);
  const combo = shipCombo({ label: 'Dummy ship', ships, value: draft.ship, key: 'sandbox-ship', pick: (id) => (draft.ship = id ?? draft.ship) });
  const count = seg([1, 3, 5, 8].map((n) => ({ value: n, label: String(n) })), () => draft.n, (n) => (draft.n = n), o.click, 'sandbox-count');
  const side = seg([{ value: 'enemy', label: 'Enemy' }, { value: 'ally', label: 'Allied' }], () => (draft.enemy ? 'enemy' : 'ally'), (v) => (draft.enemy = v === 'enemy'), o.click, 'sandbox-team');
  const facing = seg<Facing>([{ value: 'toward', label: 'Toward you' }, { value: 'broadside', label: 'Broadside' }, { value: 'away', label: 'Away' }], () => draft.facing, (v) => (draft.facing = v), o.click, 'sandbox-facing');
  const place = seg<Place>([{ value: 'ahead', label: '3 km ahead' }, { value: 'reticle', label: 'At reticle' }], () => draft.place, (v) => (draft.place = v), o.click, 'sandbox-place');
  const spawn = button('Spawn', 'btn-primary', () => {
    const me = o.me();
    if (me) send(spawnCommand(me, { x: me.control.aimX, z: me.control.aimZ }));
  }, 'sandbox-spawn');
  const room = h('p', { class: 'note' });

  const mode = h('div', { class: 'seg', role: 'group', 'aria-label': 'Dummies' });
  const modeButtons = DUMMY_MODES.map((m) => {
    const b = h('button', { type: 'button', 'data-k': `sandbox-mode-${m}`, 'aria-pressed': String(sb.mode === m) }, MODE_LABEL[m]);
    b.onclick = () => send({ k: 'mode', mode: m });
    mode.append(b);
    return b;
  });
  const modeNote = h('p', { class: 'note sandbox-mode-note' });

  const meterShown = h('button', { type: 'button', 'data-k': 'sandbox-meter-show', 'aria-pressed': String(o.meter.visible) }, 'Show meter');
  meterShown.onclick = () => {
    o.click();
    o.meter.visible = !o.meter.visible;
    meterShown.setAttribute('aria-pressed', String(o.meter.visible));
  };
  const meter = h('div', { class: 'seg', role: 'group', 'aria-label': 'Damage meter' }, meterShown);

  const back = button(o.backLabel, 'btn-quiet', () => {
    o.click();
    o.back();
  }, 'sandbox-back');
  const sheet = h(
    'div',
    { class: 'sheet panel sandbox-panel', role: 'dialog', 'aria-label': 'Sandbox tools' },
    h('h2', {}, 'Sandbox tools'),
    h('p', { class: 'lede' }, o.canEdit ? 'Changes apply at once. F6 opens this sheet, F7 shows the meter, F8 resets it.' : 'Only the host changes the sandbox. The meter is yours: F7 shows it, F8 resets it.'),
    field('Cheats, for every captain', edit(cheats)),
    h('div', { class: 'sandbox-spawn' }, field('Dummy ship', edit(combo)), field('How many', edit(count)), field('Side', edit(side)), field('Facing', edit(facing)), field('Where', edit(place))),
    h('div', { class: 'sheet-actions sandbox-row' }, room, edit(spawn)),
    h(
      'div',
      { class: 'sandbox-dummies' },
      field('Dummies', edit(mode)),
      h('div', { class: 'row' }, edit(button('Respawn all', '', () => send({ k: 'respawn' }), 'sandbox-respawn')), edit(button('Clear all', '', () => send({ k: 'clear' }), 'sandbox-clear'))),
    ),
    modeNote,
    h('div', { class: 'sheet-actions' }, meter, button('Reset meter', '', () => {
      o.click();
      o.meter.reset();
    }, 'sandbox-meter-reset'), back),
  );
  const el = h('div', { class: 'overlay' }, sheet);

  let shown = '';
  const sync = () => {
    const left = MAX_DUMMIES - sb.dummies.length;
    const key = [...SANDBOX_CHEATS.map((c) => sb.cheats[c]), sb.mode, left].join();
    if (key === shown) return;
    shown = key;
    SANDBOX_CHEATS.forEach((c, i) => cheatButtons[i].setAttribute('aria-pressed', String(sb.cheats[c])));
    DUMMY_MODES.forEach((m, i) => modeButtons[i].setAttribute('aria-pressed', String(sb.mode === m)));
    modeNote.textContent = MODE_NOTE[sb.mode];
    room.textContent = `${sb.dummies.length} of ${MAX_DUMMIES} dummies afloat${left ? '' : ': clear some to spawn more'}.`;
    if (o.canEdit) spawn.disabled = left <= 0;
  };
  sync();
  queueMicrotask(() => (o.canEdit ? cheatButtons[0] : back).focus({ preventScroll: true }));
  return { el, sync };
}
