import { type KeyLayout, LAYOUT_MOUSE, LAYOUT_TITAN } from '../config';

// Keyboard bindings for the keyboard + mouse captain, remembered in this browser. Warships and
// titans each have a layout; the helm, weapons, consumables and camera keys are shared by both,
// so a key may be used once per layout. Legacy customized titan skills retain their keys.

export type ActionId =
  | 'throttleUp'
  | 'throttleDown'
  | 'left'
  | 'right'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5'
  | 'repair'
  | 'utility'
  | 'architectHullDash'
  | 'architectMobileBattery'
  | 'zoom'
  | 'follow'
  | 'skill1'
  | 'skill2'
  | 'ult'
  | 'lock'
  | 'assist'
  | 'diveUp'
  | 'diveDown'
  | 'tskill1'
  | 'tskill2'
  | 'tskill3'
  | 'tskill4'
  | 'tskill5'
  | 'tskill6'
  | 'tult1'
  | 'tult2'
  | 'tult3'
  | 'tassist'
  | 'tdiveUp'
  | 'tdiveDown';

/** Architect adds mobility to the titan layout, without submarine dive controls. */
export type Scope = 'both' | 'ship' | 'titan' | 'architect';

export interface ActionInfo {
  id: ActionId;
  label: string;
  scope: Scope;
  /** The gamepad button for it (not rebindable). */
  pad: string;
}

export const ACTIONS: ActionInfo[] = [
  { id: 'throttleUp', label: 'Engine telegraph ahead / drive forward (hold)', scope: 'both', pad: 'Left stick up' },
  { id: 'throttleDown', label: 'Engine telegraph astern / reverse (hold)', scope: 'both', pad: 'Left stick down' },
  { id: 'left', label: 'Rudder left (steps, stays set) / steer left (hold)', scope: 'both', pad: 'Left stick left' },
  { id: 'right', label: 'Rudder right / steer right (hold)', scope: 'both', pad: 'Left stick right' },
  { id: 'slot1', label: 'Weapon 1 (AP) / ammo 1', scope: 'both', pad: 'LB / RB' },
  { id: 'slot2', label: 'Weapon 2 (HE) / ammo 2', scope: 'both', pad: 'LB / RB' },
  { id: 'slot3', label: 'Weapon 3 (torpedoes, squadrons) / ammo 3', scope: 'both', pad: 'LB / RB' },
  { id: 'slot4', label: 'Weapon 4', scope: 'both', pad: 'LB / RB' },
  { id: 'slot5', label: 'Weapon 5', scope: 'both', pad: 'LB / RB' },
  { id: 'repair', label: 'Repair kit: puts out fires and flooding, mends tracks, heals', scope: 'both', pad: 'D-pad up' },
  { id: 'utility', label: 'Class utility (smoke, search, boost, plates)', scope: 'both', pad: 'D-pad right' },
  { id: 'architectHullDash', label: 'Vector: Hull Dash', scope: 'architect', pad: 'LB + D-pad right' },
  { id: 'architectMobileBattery', label: 'Vector: Mobile Battery', scope: 'architect', pad: 'RB + D-pad right' },
  { id: 'zoom', label: 'Gunsight scope or artillery view (also: wheel past the closest view)', scope: 'both', pad: 'LT (hold) or d-pad left' },
  { id: 'follow', label: 'Follow shot: ride your newest shell in (ships)', scope: 'both', pad: 'RS click' },
  { id: 'skill1', label: 'Skill 1', scope: 'ship', pad: 'X' },
  { id: 'skill2', label: 'Skill 2', scope: 'ship', pad: 'B' },
  { id: 'ult', label: 'Ultimate', scope: 'ship', pad: 'Y' },
  { id: 'lock', label: 'Lock target (also: middle mouse)', scope: 'both', pad: 'A' },
  { id: 'assist', label: 'Fire-control assist on / off', scope: 'ship', pad: 'D-pad down' },
  { id: 'diveUp', label: 'Submarine: surface', scope: 'ship', pad: 'RS click' },
  { id: 'diveDown', label: 'Submarine: dive', scope: 'ship', pad: 'LS click' },
  { id: 'tskill1', label: 'Titan skill 1', scope: 'titan', pad: 'X' },
  { id: 'tskill2', label: 'Titan skill 2', scope: 'titan', pad: 'B' },
  { id: 'tskill3', label: 'Titan skill 3', scope: 'titan', pad: 'LB X' },
  { id: 'tskill4', label: 'Titan skill 4', scope: 'titan', pad: 'LB B' },
  { id: 'tskill5', label: 'Titan skill 5', scope: 'titan', pad: 'RB X' },
  { id: 'tskill6', label: 'Titan skill 6', scope: 'titan', pad: 'RB B' },
  { id: 'tult1', label: 'Titan ultimate 1', scope: 'titan', pad: 'Y' },
  { id: 'tult2', label: 'Titan ultimate 2', scope: 'titan', pad: 'LB Y' },
  { id: 'tult3', label: 'Titan ultimate 3', scope: 'titan', pad: 'RB Y' },
  { id: 'tassist', label: 'Titan fire-control assist on / off', scope: 'titan', pad: 'D-pad down' },
  { id: 'tdiveUp', label: 'Titan submarine: surface', scope: 'titan', pad: 'RS click' },
  { id: 'tdiveDown', label: 'Titan submarine: dive', scope: 'titan', pad: 'LS click' },
];

const SCOPE = Object.fromEntries(ACTIONS.map((a) => [a.id, a.scope])) as Record<ActionId, Scope>;

/** Keys the game keeps for itself: menus, scoreboard, the performance readout and the system. */
export const RESERVED = new Set(['Escape', 'Tab', 'F3', 'MetaLeft', 'MetaRight', 'ContextMenu', 'CapsLock']);

/** Action to KeyboardEvent.code; '' is unbound. */
export type Bindings = Record<ActionId, string>;

export const DEFAULT_BINDINGS: Bindings = (() => {
  const M = LAYOUT_MOUSE;
  const T = LAYOUT_TITAN;
  return {
    throttleUp: M.throttleUp,
    throttleDown: M.throttleDown,
    left: M.left,
    right: M.right,
    slot1: M.slots[0],
    slot2: M.slots[1],
    slot3: M.slots[2],
    slot4: M.slots[3],
    slot5: M.slots[4],
    repair: M.consumables[0],
    utility: M.consumables[1],
    architectHullDash: 'KeyH',
    architectMobileBattery: 'KeyJ',
    zoom: M.zoom,
    follow: M.follow,
    skill1: M.skills[0],
    skill2: M.skills[1],
    ult: M.skills[2],
    lock: M.lock,
    assist: M.assist,
    diveUp: M.diveUp,
    diveDown: M.diveDown,
    tskill1: T.skills[0],
    tskill2: T.skills[1],
    tskill3: T.skills[2],
    tskill4: T.skills[3],
    tskill5: T.skills[4],
    tskill6: T.skills[5],
    tult1: T.skills[6],
    tult2: T.skills[7],
    tult3: T.skills[8],
    tassist: T.assist,
    tdiveUp: T.diveUp,
    tdiveDown: T.diveDown,
  };
})();

/** Two actions can clash only if some layout holds both. */
function shareLayout(a: ActionId, b: ActionId, stored = false): boolean {
  // Older customized bindings may share a warship lock with a titan skill. Keep the
  // recorded keys; that titan uses middle mouse until the captain changes the binding.
  if (stored && (a === 'lock' && SCOPE[b] === 'titan' || b === 'lock' && SCOPE[a] === 'titan')) return false;
  const sa = SCOPE[a];
  const sb = SCOPE[b];
  // Architect uses titan skills, but has no submarine dive controls. Default H is contextual.
  if (sa === 'architect' && (b === 'tdiveUp' || b === 'tdiveDown') || sb === 'architect' && (a === 'tdiveUp' || a === 'tdiveDown')) return false;
  if (sa === 'architect' || sb === 'architect') return sa !== 'ship' && sb !== 'ship';
  return sa === 'both' || sb === 'both' || sa === sb;
}

function clashes(b: Bindings, action: ActionId, stored = false): boolean {
  const code = b[action];
  if (!code) return false;
  return ACTIONS.some((o) => o.id !== action && b[o.id] === code && shareLayout(o.id, action, stored));
}

/** True when `code` may be bound at all. */
export function bindable(code: string): boolean {
  return /^[A-Za-z0-9]{1,24}$/.test(code) && !RESERVED.has(code);
}

/**
 * Bind `action` to `code`. An action that already had the key in a shared layout takes the old
 * key when that stays clear; otherwise it is left unbound. Returns the new bindings and the
 * actions that gave up the key.
 */
export function rebind(b: Bindings, action: ActionId, code: string): { bindings: Bindings; moved: ActionId[] } {
  return applyBinding(b, action, code);
}

function applyBinding(b: Bindings, action: ActionId, code: string, stored = false): { bindings: Bindings; moved: ActionId[] } {
  if (!bindable(code) || b[action] === code) return { bindings: b, moved: [] };
  const old = b[action];
  const next: Bindings = { ...b, [action]: code };
  const moved: ActionId[] = [];
  for (const o of ACTIONS) {
    if (o.id === action || next[o.id] !== code || !shareLayout(o.id, action, stored)) continue;
    next[o.id] = old;
    if (clashes(next, o.id, stored)) next[o.id] = '';
    moved.push(o.id);
  }
  return { bindings: next, moved };
}

/** Validate stored keys over defaults, retaining customized titan keys if a legacy lock overlaps. */
export function parseBindings(raw: unknown): Bindings {
  let b = { ...DEFAULT_BINDINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return b;
  const saved = raw as Record<string, unknown>;
  // New actions must not claim a legacy custom key or acquire its former key via a swap.
  for (const action of ['architectHullDash', 'architectMobileBattery'] as const) {
    if (!Object.hasOwn(saved, action) && Object.entries(saved).some(([id, code]) => id !== action && Object.hasOwn(SCOPE, id) && shareLayout(id as ActionId, action, true) && code === DEFAULT_BINDINGS[action])) b[action] = '';
  }
  const followKeyOccupied=Object.entries(saved).some(([id,code])=>id!=='follow'&&Object.hasOwn(SCOPE,id)&&code==='KeyU');
  const entries = saved.lock === 'KeyX' && saved.follow === 'Space' && !followKeyOccupied ? { ...saved, lock: 'Space', follow: 'KeyU' } : saved;
  for (const [k, v] of Object.entries(entries)) {
    if (!Object.hasOwn(SCOPE, k) || typeof v !== 'string') continue;
    const id = k as ActionId;
    if (v === '') b = { ...b, [id]: '' };
    else b = applyBinding(b, id, v, true).bindings;
  }
  return b;
}

const KEY = 'steel-tide.keys';
let current: Bindings | null = null;
const listeners = new Set<() => void>();

export function bindings(): Bindings {
  if (!current) {
    try {
      const raw = window.localStorage.getItem(KEY);
      current = parseBindings(raw ? JSON.parse(raw) : null);
    } catch {
      // Storage blocked or no window (tests): the defaults.
      current = { ...DEFAULT_BINDINGS };
    }
  }
  return current;
}

export function setBindings(b: Bindings): void {
  current = b;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // Not remembered, but still applies for this session.
  }
  for (const f of listeners) f();
}

/** Run `f` whenever the bindings change; returns the unsubscribe. */
export function onBindings(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The keyboard layout for a ship, from the bindings: titans need nine skill keys. */
export function layoutFor(spec: { cls: string; sub?: unknown }, b: Bindings = bindings()): KeyLayout {
  const base = {
    throttleUp: b.throttleUp,
    throttleDown: b.throttleDown,
    left: b.left,
    right: b.right,
    slots: [b.slot1, b.slot2, b.slot3, b.slot4, b.slot5],
    consumables: [b.repair, b.utility],
    zoom: b.zoom,
    follow: b.follow,
  };
  if (spec.cls === 'TT') {
    return {
      ...base,
      label: LAYOUT_TITAN.label,
      skills: [b.tskill1, b.tskill2, b.tskill3, b.tskill4, b.tskill5, b.tskill6, b.tult1, b.tult2, b.tult3],
      // Preserve old customized keys that shared a ship lock with a titan action.
      lock: [b.tskill1,b.tskill2,b.tskill3,b.tskill4,b.tskill5,b.tskill6,b.tult1,b.tult2,b.tult3,b.tassist,...(spec.sub?[b.tdiveUp,b.tdiveDown]:[])].includes(b.lock) ? '' : b.lock,
      assist: b.tassist,
      diveUp: spec.sub ? b.tdiveUp : '',
      diveDown: spec.sub ? b.tdiveDown : '',
    };
  }
  return { ...base, label: LAYOUT_MOUSE.label, skills: [b.skill1, b.skill2, b.ult], lock: b.lock, assist: b.assist, diveUp: b.diveUp, diveDown: b.diveDown };
}

/** Every bound key: the browser's own use of them is held off during a battle. */
export function boundKeys(b: Bindings = bindings()): Set<string> {
  return new Set(Object.values(b).filter(Boolean));
}

const NAMES: Record<string, string> = {
  ShiftLeft: 'Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Right Alt',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** A key's name on the keycap. */
export function keyName(code: string | undefined): string {
  if (!code) return '';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
