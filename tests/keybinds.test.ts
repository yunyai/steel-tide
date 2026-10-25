import { describe, expect, it } from 'vitest';
import { LAYOUT_MOUSE, LAYOUT_TITAN } from '../src/config';
import { ACTIONS, type Bindings, DEFAULT_BINDINGS, bindable, layoutFor, parseBindings, rebind } from '../src/input/Keybinds';

const SHIP = { cls: 'BB' };
const TITAN = { cls: 'TT' };

/** No layout holds the same key twice. */
function clean(b: Bindings): boolean {
  for (const spec of [SHIP, TITAN]) {
    const L = layoutFor(spec, b);
    const keys = [L.throttleUp, L.throttleDown, L.left, L.right, ...L.slots, ...L.skills, ...L.consumables, L.lock, L.assist, L.zoom, L.follow, L.diveUp, L.diveDown].filter(Boolean);
    if (new Set(keys).size !== keys.length) return false;
  }
  return true;
}

describe('keybinds', () => {
  it('defaults give the fixed layouts the game shipped with', () => {
    const ship = layoutFor(SHIP, DEFAULT_BINDINGS);
    const titan = layoutFor(TITAN, DEFAULT_BINDINGS);
    expect(ship).toEqual(LAYOUT_MOUSE);
    expect(titan).toEqual({ ...LAYOUT_TITAN, diveUp: '', diveDown: '' });
    expect(clean(DEFAULT_BINDINGS)).toBe(true);
    expect(Object.keys(DEFAULT_BINDINGS).sort()).toEqual(ACTIONS.map((a) => a.id).sort());
  });

  it('takes a free key without touching anything else', () => {
    const { bindings, moved } = rebind(DEFAULT_BINDINGS, 'skill1', 'KeyH');
    expect(bindings.skill1).toBe('KeyH');
    expect(moved).toEqual([]);
    expect({ ...bindings, skill1: DEFAULT_BINDINGS.skill1 }).toEqual(DEFAULT_BINDINGS);
  });

  it('swaps with the action that had the key when the old key stays clear', () => {
    // Skill 1 (Q) takes E from skill 2, which gets Q: no layout sees a clash.
    const { bindings, moved } = rebind(DEFAULT_BINDINGS, 'skill1', 'KeyE');
    expect(bindings.skill1).toBe('KeyE');
    expect(bindings.skill2).toBe('KeyQ');
    expect(moved).toContain('skill2');
    expect(clean(bindings)).toBe(true);
  });

  it('leaves the other action unbound when the swap would clash in another layout', () => {
    // The lock (X, warships only) takes the throttle (W, every layout); W's old owner would get X,
    // but titan skill 4 sits on X in the titan layout, so the throttle is left unbound.
    const { bindings, moved } = rebind(DEFAULT_BINDINGS, 'lock', 'KeyW');
    expect(bindings.lock).toBe('KeyW');
    expect(bindings.throttleUp).toBe('');
    expect(moved).toEqual(['throttleUp']);
    expect(clean(bindings)).toBe(true);
  });

  it('lets a titan key double as a warship key', () => {
    // Titan skill 3 (Z) and the dive key (Z) never sail together, so neither moves.
    const { bindings, moved } = rebind(DEFAULT_BINDINGS, 'tskill1', 'KeyC');
    expect(bindings.tskill1).toBe('KeyC');
    expect(bindings.diveDown).toBe('KeyC');
    expect(bindings.tskill5).toBe('KeyQ');
    expect(moved).toEqual(['tskill5']);
  });

  it('refuses keys the game keeps', () => {
    for (const code of ['Escape', 'Tab', 'F3', 'MetaLeft', '', '<script>']) expect(bindable(code)).toBe(false);
    expect(rebind(DEFAULT_BINDINGS, 'skill1', 'Tab').bindings).toBe(DEFAULT_BINDINGS);
  });

  it('rejects junk in storage and keeps the valid entries', () => {
    for (const raw of [null, 'x', 7, [], { skill1: 5 }, { nope: 'KeyH' }, { skill1: 'Escape' }, { __proto__: { skill1: 'KeyH' } }]) {
      expect(parseBindings(raw)).toEqual(DEFAULT_BINDINGS);
    }
    const b = parseBindings({ skill1: 'KeyH', ult: '', lock: 'KeyW', bogus: 'KeyJ' });
    expect(b.skill1).toBe('KeyH');
    expect(b.ult).toBe('');
    expect(b.lock).toBe('KeyW');
    expect(clean(b)).toBe(true);
  });

  it('layouts read the overrides', () => {
    const b = { ...DEFAULT_BINDINGS, skill1: 'KeyH', tskill1: 'KeyJ', slot3: 'KeyK', tassist: 'KeyL' };
    expect(layoutFor(SHIP, b).skills[0]).toBe('KeyH');
    expect(layoutFor(TITAN, b).skills[0]).toBe('KeyJ');
    expect(layoutFor(TITAN, b).slots[2]).toBe('KeyK');
    expect(layoutFor(TITAN, b).assist).toBe('KeyL');
    expect(layoutFor(TITAN, b).lock).toBe('');
  });
});
