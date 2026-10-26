import { audio } from '../fx/Audio';
import { ACTIONS, type ActionId, type ActionInfo, DEFAULT_BINDINGS, bindable, bindings, keyName, rebind, setBindings } from '../input/Keybinds';
import { type ShakeLevel, controls, display, setControls, setDisplay, setSound, sound } from '../input/Settings';
import { QUALITIES, type QualityId, quality, setQuality } from '../render/Quality';
import { field, h, seg } from './dom';
import { applyPalette } from './palette';

// The settings sheet, from the title screen or the battle menu: graphics, sound, controls and
// the keyboard bindings.

export type SettingsTab = 'graphics' | 'sound' | 'controls' | 'keys';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'sound', label: 'Sound' },
  { id: 'controls', label: 'Controls' },
  { id: 'keys', label: 'Keybinds' },
];

/** The tab open last, so the sheet reopens where it was left. */
let lastTab: SettingsTab = 'graphics';

export interface SettingsHooks {
  back(): void;
  click(): void;
  tab?: SettingsTab;
}

/** Keys and buttons the game keeps for itself, shown in the Keybinds tab but not rebindable. */
const FIXED: { label: string; keys: string; pad: string }[] = [
  { label: 'Aim', keys: 'Mouse', pad: 'Right stick' },
  { label: 'Fire', keys: 'Left mouse', pad: 'RT' },
  { label: 'Lock target (titans and warships)', keys: 'Middle mouse', pad: 'A' },
  { label: 'Free look / camera distance', keys: 'Right mouse drag / wheel', pad: '—' },
  { label: 'Boss Rush refit choice', keys: '1 2 3', pad: 'X, Y, B' },
  { label: 'Scoreboard', keys: 'Tab', pad: 'Back' },
  { label: 'Battle menu', keys: 'Esc', pad: 'Start' },
  { label: 'Performance readout', keys: 'F3', pad: '—' },
];

const SECTIONS: { title: string; scope: ActionInfo['scope'] }[] = [
  { title: 'Helm, weapons and camera', scope: 'both' },
  { title: 'Warships', scope: 'ship' },
  { title: 'Titans', scope: 'titan' },
];

const LABEL = Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])) as Record<ActionId, string>;

const VOLUMES = [0, 0.25, 0.5, 0.75, 1].map((v) => ({ value: v, label: v ? `${v * 100}%` : 'Off' }));

/** The volume option nearest a stored value. */
const nearest = (v: number) => VOLUMES.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a)).value;

export function buildSettings(hooks: SettingsHooks): HTMLElement {
  let tab = hooks.tab ?? lastTab;
  const pick = <T extends string | number>(options: { value: T; label: string }[], get: () => T, set: (v: T) => void) => seg(options, get, set, hooks.click);
  const sheet = h('div', { class: 'sheet panel settings', role: 'dialog', 'aria-label': 'Settings' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'settings-body' });
  const actions = h('div', { class: 'sheet-actions' });
  /** Stops listening for a new key, if the Keybinds tab was waiting for one. */
  let stopListening = () => {};

  const graphics = () => [
    field(
      'Quality',
      pick<QualityId>((Object.keys(QUALITIES) as QualityId[]).map((k) => ({ value: k, label: QUALITIES[k].label })), () => quality().id, (v) => setQuality(v)),
      'All presets show the same combat contacts, telegraphs and projectiles at the same view distance. Higher presets add resolution, water detail, scenery, shadows and bloom. Changes apply from the next battle.',
    ),
    field(
      'Performance readout',
      pick(
        [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
        () => (display().perf ? 1 : 0),
        (v) => setDisplay({ perf: v === 1 }),
      ),
      'Frame time, draw calls and what is afloat, in a corner of the battle. F3 shows or hides it too.',
    ),
  ];

  const volume = (label: string, key: 'master' | 'effects' | 'weapons' | 'abilities' | 'ambience' | 'ui', note?: string) =>
    field(
      label,
      pick(
        VOLUMES,
        () => nearest(sound()[key]),
        (v) => {
          setSound({ [key]: v });
          audio.applySound();
        },
      ),
      note,
    );

  const soundTab = () => [
    volume('Master volume', 'master'),
    volume('Battle volume', 'effects', 'Retains your saved effects volume; scales all battle categories.'),
    volume('Weapons', 'weapons'),
    volume('Abilities', 'abilities'),
    volume('Sea and engines', 'ambience'),
    volume('Interface', 'ui', 'Menu clicks and alerts.'),
    h('div', { class: 'audio-credits' },
      h('h3', {}, 'Audio credits'),
      h('p', { class: 'note' }, 'All game audio uses recordings from Helton Yan (CC BY 4.0), Kenney (CC0) and Sonniss GameAudioGDC contributors. Weapons, abilities, interface cues and naval/ground ambience and engines are excerpted, edited and normalized for this game. Full contributor credits, source files and licenses are linked below.'),
      h('a', { href: 'https://heltonyan.itch.io/retroanimesfx', target: '_blank', rel: 'noopener noreferrer' }, 'Helton Yan'), ' · ',
      h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener noreferrer' }, 'CC BY 4.0'), ' · ',
      h('a', { href: 'https://kenney.nl/assets/sci-fi-sounds', target: '_blank', rel: 'noopener noreferrer' }, 'Kenney'), ' · ',
      h('a', { href: 'https://sonniss.com/gameaudiogdc/', target: '_blank', rel: 'noopener noreferrer' }, 'Sonniss contributors'), ' · ',
      h('a', { href: '/audio/CREDITS.md', target: '_blank', rel: 'noopener noreferrer' }, 'Full credits and modifications'),
    ),
  ];

  const controlsTab = () => [
    field(
      'Mouse sensitivity',
      pick(
        [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${v}×` })),
        () => controls().sens,
        (v) => setControls({ sens: v }),
      ),
    ),
    field(
      'Vertical aim',
      pick(
        [
          { value: 0, label: 'Normal' },
          { value: 1, label: 'Inverted' },
        ],
        () => (controls().invertY ? 1 : 0),
        (v) => setControls({ invertY: v === 1 }),
      ),
    ),
    field(
      'Camera shake',
      pick<ShakeLevel>(
        [
          { value: 0, label: 'Off' },
          { value: 0.5, label: 'Low' },
          { value: 1, label: 'Full' },
        ],
        () => controls().shake,
        (v) => setControls({ shake: v }),
      ),
      'How hard the view kicks when your guns fire and when you are hit.',
    ),
    field(
      'Colour-blind palette',
      pick(
        [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
        () => (display().colourBlind ? 1 : 0),
        (v) => {
          setDisplay({ colourBlind: v === 1 });
          applyPalette();
        },
      ),
      'Enemy red turns vermilion and green cues turn blue, so nothing depends on telling red from green.',
    ),
  ];

  /** The Keybinds tab: click a key, then press the new one. */
  const keysTab = () => {
    const status = h('p', { class: 'note keys-status', 'aria-live': 'polite' });
    const table = h('table', { class: 'keys' });
    let listening: ActionId | null = null;

    const say = (text: string, warn = false) => {
      status.textContent = text;
      status.classList.toggle('warn', warn);
    };

    const cap = (id: ActionId) => {
      const code = bindings()[id];
      const b = h('button', { class: `keycap${code ? '' : ' unbound'}`, 'aria-label': `${LABEL[id]}: ${code ? keyName(code) : 'unbound'}. Change key` });
      if (listening === id) {
        b.classList.add('listening');
        b.textContent = 'Press a key (Esc cancels)';
      } else b.append(code ? h('kbd', {}, keyName(code)) : 'Unbound');
      b.onclick = (e) => {
        e.stopPropagation();
        hooks.click();
        listen(id);
      };
      return b;
    };

    const render = () => {
      const head = h('thead', {}, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Keyboard'), h('th', {}, 'Gamepad')));
      const groups = SECTIONS.map((sec) =>
        h(
          'tbody',
          {},
          h('tr', { class: 'section' }, h('th', { colspan: '3' }, sec.title)),
          ...ACTIONS.filter((a) => a.scope === sec.scope).map((a) => h('tr', {}, h('td', {}, a.label), h('td', {}, cap(a.id)), h('td', {}, a.pad))),
        ),
      );
      const fixed = h(
        'tbody',
        { class: 'fixed' },
        h('tr', { class: 'section' }, h('th', { colspan: '3' }, 'Fixed')),
        ...FIXED.map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, f.keys), h('td', {}, f.pad))),
      );
      table.replaceChildren(head, ...groups, fixed);
    };

    const onKey = (e: KeyboardEvent) => {
      // The sheet went away (the battle ended under it): let keys through again.
      if (!sheet.isConnected) return stopListening();
      // The battle and the menus must not see the key being bound (Esc would also close the menu).
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || !listening) return;
      const id = listening;
      stopListening();
      if (e.code === 'Escape') say('');
      else if (!bindable(e.code)) say(`${keyName(e.code)} is kept for the game.`, true);
      else {
        const { bindings: next, moved } = rebind(bindings(), id, e.code);
        setBindings(next);
        const notes = moved.map((m) => (next[m] ? `${LABEL[m]} moved to ${keyName(next[m])}.` : `${LABEL[m]} is now unbound.`));
        say([`${LABEL[id]}: ${keyName(e.code)}.`, ...notes].join(' '), moved.some((m) => !next[m]));
      }
      render();
      table.querySelector<HTMLElement>(`[aria-label^="${CSS.escape(LABEL[id])}:"]`)?.focus({ preventScroll: true });
    };
    // A click anywhere else gives up on the new key.
    const onDown = () => {
      if (!listening) return;
      stopListening();
      render();
    };

    const listen = (id: ActionId) => {
      stopListening();
      listening = id;
      say('');
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onDown, true);
      stopListening = () => {
        listening = null;
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onDown, true);
        stopListening = () => {};
      };
      render();
    };

    render();
    const reset = h('button', { class: 'btn btn-quiet' }, 'Reset to defaults');
    reset.onclick = () => {
      hooks.click();
      stopListening();
      setBindings({ ...DEFAULT_BINDINGS });
      say('Every key is back to its default.');
      render();
    };
    actions.prepend(reset);
    return [
      h('p', { class: 'lede' }, 'Click a key, then press the one you want. Warships, tanks and titans share the helm, weapon and camera keys; a key taken by another action moves to your old key, or is left unbound when that would clash.'),
      status,
      table,
    ];
  };

  const show = () => {
    stopListening();
    lastTab = tab;
    tabs.replaceChildren(
      ...TABS.map((t) => {
        const b = h('button', { role: 'tab', 'aria-pressed': String(t.id === tab), 'aria-selected': String(t.id === tab) }, t.label);
        b.onclick = () => {
          if (t.id === tab) return;
          const focused = document.activeElement === b;
          hooks.click();
          tab = t.id;
          show();
          if (focused) tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
        };
        return b;
      }),
    );
    const done = h('button', { class: 'btn btn-primary' }, 'Back');
    done.onclick = () => {
      stopListening();
      hooks.click();
      hooks.back();
    };
    actions.replaceChildren(done);
    body.replaceChildren(...(tab === 'graphics' ? graphics() : tab === 'sound' ? soundTab() : tab === 'controls' ? controlsTab() : keysTab()));
  };

  show();
  sheet.append(h('h2', {}, 'Settings'), tabs, body, actions);
  return sheet;
}
