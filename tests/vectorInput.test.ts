import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerController } from '../src/player/PlayerController';
import { DEFAULT_BINDINGS, parseBindings, rebind, setBindings } from '../src/input/Keybinds';
import type { Input } from '../src/input/Input';
import { emptyGame, place } from './helpers';

/** Input edges are device data; exercise the real controller and outgoing orders. */
function device() {
  let previous = new Set<number>(), down = new Set<number>();
  const keys = new Set<string>();
  const input = {
    aiming: false, mouseDx: 0, mouseDy: 0, wheel: 0,
    pressed: (code: string) => keys.has(code), mousePressed: () => false, mouseDown: () => false,
    pad: () => ({ axes: [0, 0, 0, 0], buttons: [] }),
    padDown: (_: number, button: number) => down.has(button),
    padPressed: (_: number, button: number) => down.has(button) && !previous.has(button),
    padReleased: (_: number, button: number) => !down.has(button) && previous.has(button),
  } as unknown as Input;
  return { input, keys, frame(buttons: number[]) { previous = down; down = new Set(buttons); } };
}
function captain(pad = false) {
  const game = emptyGame('open', 7, 'freeplay'), ship = place(game, 'architect', 0, 0, 3000);
  ship.architect!.slots[0].type = 'vector';
  return { ship, pc: new PlayerController(ship, pad ? 'pad0' : 'mouse', 0, game) };
}
beforeEach(() => setBindings({ ...DEFAULT_BINDINGS }));

describe('Vector manual input', () => {
  it('binds H and J separately while G retains Search', () => {
    const { ship, pc } = captain(), d = device();
    for (const [code, field] of [['KeyH', 'architectHullDash'], ['KeyJ', 'architectMobileBattery']] as const) {
      ship.control.architectHullDash = ship.control.architectMobileBattery = false; ship.control.consumable = -1;
      d.keys.clear(); d.keys.add(code); pc.control(1 / 60, d.input);
      expect(ship.control[field]).toBe(true);
      expect(ship.control.consumable).toBe(-1);
      expect(ship.control[field === 'architectHullDash' ? 'architectMobileBattery' : 'architectHullDash']).toBe(false);
    }
    d.keys.clear(); d.keys.add('KeyG'); ship.control.architectHullDash = ship.control.architectMobileBattery = false;
    pc.control(1 / 60, d.input);
    expect(ship.control.consumable).toBe(1);
    expect(!!(ship.control.architectHullDash || ship.control.architectMobileBattery)).toBe(false);
  });
  it('uses rebound mobility keys immediately', () => {
    const { ship, pc } = captain(), d = device();
    setBindings(rebind(rebind(DEFAULT_BINDINGS, 'architectHullDash', 'KeyK').bindings, 'architectMobileBattery', 'KeyL').bindings);
    d.keys.add('KeyH'); d.keys.add('KeyJ'); pc.control(1 / 60, d.input);
    expect(!!(ship.control.architectHullDash || ship.control.architectMobileBattery)).toBe(false);
    d.keys.clear(); d.keys.add('KeyK'); d.keys.add('KeyL'); pc.control(1 / 60, d.input);
    expect(ship.control.architectHullDash).toBe(true); expect(ship.control.architectMobileBattery).toBe(true);
  });
  it.each([[4, 'architectHullDash'], [5, 'architectMobileBattery']] as const)('consumes shoulder %s plus D-pad right, including release', (shoulder, field) => {
    const { ship, pc } = captain(true), d = device();
    d.frame([shoulder]); pc.control(1 / 60, d.input);
    d.frame([shoulder, 15]); pc.control(1 / 60, d.input);
    expect(ship.control[field]).toBe(true); expect(ship.control.consumable).toBe(-1); expect(ship.control.slot).toBeNull();
    ship.control[field] = false;
    d.frame([shoulder, 15]); pc.control(1 / 60, d.input); expect(ship.control[field]).toBe(false);
    d.frame([]); pc.control(1 / 60, d.input);
    expect(ship.control.slot).toBeNull();
  });
  it('prioritizes LB with both shoulders held and consumes both releases', () => {
    const { ship, pc } = captain(true), d = device();
    d.frame([4, 5, 15]); pc.control(1 / 60, d.input);
    expect(ship.control.architectHullDash).toBe(true); expect(!!ship.control.architectMobileBattery).toBe(false); expect(ship.control.consumable).toBe(-1);
    d.frame([5]); pc.control(1 / 60, d.input); expect(ship.control.slot).toBeNull();
    d.frame([]); pc.control(1 / 60, d.input); expect(ship.control.slot).toBeNull();
  });
  it('retains unmodified pad Search and shoulder taps for weapons', () => {
    const { ship, pc } = captain(true), d = device();
    d.frame([15]); pc.control(1 / 60, d.input); expect(ship.control.consumable).toBe(1);
    d.frame([5]); pc.control(1 / 60, d.input); expect(ship.control.slot).toBeNull();
    d.frame([]); pc.control(1 / 60, d.input); expect(ship.control.slot).toBe(1);
  });
});

describe('Vector saved bindings', () => {
  it('preserves customized legacy H/J actions and leaves conflicting new actions unbound', () => {
    const saved = { ...DEFAULT_BINDINGS, tskill1: 'KeyH', tskill2: 'KeyJ', tdiveDown: 'KeyN' } as Record<string, string>;
    delete saved.architectHullDash; delete saved.architectMobileBattery;
    const migrated = parseBindings(saved);
    expect(migrated).toMatchObject({ tskill1: 'KeyH', tskill2: 'KeyJ', architectHullDash: '', architectMobileBattery: '' });
    expect(parseBindings(migrated)).toEqual(migrated);
  });
  it('keeps user-assigned mobility bindings when the saved map is reloaded', () => {
    const custom = rebind(rebind(DEFAULT_BINDINGS, 'architectHullDash', 'KeyK').bindings, 'architectMobileBattery', 'KeyL').bindings;
    expect(parseBindings(custom)).toEqual(custom);
  });
});

it('keeps Architect H and titan submarine H in their separate contexts after saving', () => {
  expect(DEFAULT_BINDINGS.architectHullDash).toBe('KeyH');
  expect(DEFAULT_BINDINGS.tdiveDown).toBe('KeyH');
  expect(parseBindings({ ...DEFAULT_BINDINGS })).toEqual(DEFAULT_BINDINGS);
  const legacyDefaults = { ...DEFAULT_BINDINGS } as Record<string, string>;
  delete legacyDefaults.architectHullDash; delete legacyDefaults.architectMobileBattery;
  expect(parseBindings(legacyDefaults)).toEqual(DEFAULT_BINDINGS);
  const custom = rebind(DEFAULT_BINDINGS, 'architectHullDash', 'KeyC').bindings;
  expect(custom.architectHullDash).toBe('KeyC');
  expect(custom.tskill5).toBe('');
  expect(custom.tdiveDown).toBe('KeyH');
  expect(rebind(DEFAULT_BINDINGS, 'tdiveDown', 'KeyJ').bindings.architectMobileBattery).toBe('KeyJ');
});
