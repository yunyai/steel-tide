import { describe, expect, it } from 'vitest';
import { eligibleShips } from '../src/core/FleetSelection';
import { ERA_LABEL, ERAS, eraOf } from '../src/data/factions';
import { SHIP_BY_ID } from '../src/data/ships';
import { CLASS_CHIPS, ShipChoiceModel, chipOf, pickerRows } from '../src/ui/ShipChoice';

const mixed = eligibleShips('mixed', true);
const ships = (m: ShipChoiceModel) => m.choices.map((c) => c.id);

describe('ship combo rows', () => {
  it('groups ships by era, then class, under one heading each', () => {
    const rows = pickerRows(mixed, '', false);
    const headings = rows.filter((r) => r.kind === 'group').map((r) => r.label);
    expect(new Set(headings).size).toBe(headings.length);
    let era = -1, chip = -1;
    for (const r of rows) {
      if (r.kind === 'group') continue;
      const s = SHIP_BY_ID[r.id!];
      const e = ERAS.indexOf(eraOf(s)), c = CLASS_CHIPS.findIndex((x) => x.id === chipOf(s.cls));
      expect(e > era || (e === era && c >= chip)).toBe(true);
      era = e; chip = c;
    }
    expect(headings[0]).toBe(`${ERA_LABEL.historic} · Battleships`);
    expect(rows.filter((r) => r.kind === 'ship')).toHaveLength(mixed.length);
  });

  it('shows the class code as a badge and the era beside each ship', () => {
    const row = pickerRows(mixed, 'yamato', false).find((r) => r.kind === 'ship')!;
    expect(row).toMatchObject({ id: 'yamato', label: 'Yamato', badge: 'BB', era: ERA_LABEL.historic });
  });

  it('finds ships by name, era, nation and class code, and drops empty headings', () => {
    expect(pickerRows(mixed, 'YAMA', false).filter((r) => r.kind === 'ship').map((r) => r.id)).toContain('yamato');
    const subs = pickerRows(mixed, 'ss', false).filter((r) => r.kind === 'ship');
    expect(subs.length).toBeGreaterThan(0);
    const anime = pickerRows(mixed, 'anime', false);
    expect(anime.filter((r) => r.kind === 'ship').every((r) => r.kind === 'ship' && r.era === ERA_LABEL.anime)).toBe(true);
    for (const [i, r] of anime.entries()) if (r.kind === 'group') expect(anime[i + 1]?.kind).toBe('ship');
    expect(pickerRows(mixed, 'no such ship at all', false)).toEqual([]);
  });

  it('puts Automatic first when the slot allows it, unless the search rules it out', () => {
    expect(pickerRows(mixed, '', true)[0]).toMatchObject({ kind: 'ship', id: null, label: 'Automatic' });
    expect(pickerRows(mixed, 'auto', true)[0]).toMatchObject({ id: null });
    expect(pickerRows(mixed, 'yamato', true).some((r) => r.kind === 'ship' && r.id === null)).toBe(false);
  });
});

describe('ship combo keys', () => {
  it('opens on the current choice and moves through ships, never onto headings', () => {
    const m = new ShipChoiceModel(mixed, true, 'yamato');
    expect(m.current?.id).toBe('yamato');
    expect(m.key('ArrowDown', 0)).toBe('move');
    expect(m.current?.id).toBe(ships(m)[ships(m).indexOf('yamato') + 1]);
    m.key('ArrowUp', 0); m.key('ArrowUp', 0);
    expect(m.current?.id).toBe(ships(m)[ships(m).indexOf('yamato') - 1]);
  });

  it('stops at either end, and Home and End jump there', () => {
    const m = new ShipChoiceModel(mixed, true, null);
    m.key('ArrowUp', 0);
    expect(m.current?.id).toBeNull();
    m.key('End', 0);
    expect(m.current?.id).toBe(ships(m).at(-1));
    m.key('ArrowDown', 0);
    expect(m.current?.id).toBe(ships(m).at(-1));
    m.key('Home', 0);
    expect(m.current?.id).toBeNull();
  });

  it('chooses with Enter and closes with Escape', () => {
    const m = new ShipChoiceModel(mixed, false, 'yamato');
    expect(m.key('Enter', 0)).toBe('pick');
    expect(m.key('Escape', 0)).toBe('close');
    expect(m.key('Shift', 0)).toBeNull();
  });

  it('starts a new search on the first match', () => {
    const m = new ShipChoiceModel(mixed, true, 'yamato');
    m.filter('iowa');
    expect(m.query).toBe('iowa');
    expect(m.current?.id).toBe('iowa');
    m.filter('nothing matches this');
    expect(m.current).toBeUndefined();
    expect(m.key('Enter', 0)).toBeNull();
  });

  it('jumps to a typed name, extends it while typing, and starts over after a pause', () => {
    const m = new ShipChoiceModel(mixed, false, ships(new ShipChoiceModel(mixed, false, null))[0]);
    const names = m.choices.map((c) => c.label.toLowerCase());
    const target = names.findIndex((n) => n.startsWith('ya'));
    expect(target).toBeGreaterThanOrEqual(0);
    expect(m.key('y', 0)).toBe('move');
    expect(m.current!.label.toLowerCase().startsWith('y')).toBe(true);
    m.key('a', 300);
    expect(m.current!.label.toLowerCase().startsWith('ya')).toBe(true);
    m.key('i', 2000);
    expect(m.current!.label.toLowerCase().startsWith('i')).toBe(true);
  });

  it('cycles through names that share a first letter when it is pressed again', () => {
    const m = new ShipChoiceModel(mixed, false, null);
    const letter = 'i';
    const named = m.choices.filter((c) => c.label.toLowerCase().startsWith(letter)).map((c) => c.id);
    expect(named.length).toBeGreaterThan(1);
    m.key(letter, 0);
    const first = m.current!.id;
    m.key(letter, 100);
    expect(m.current!.id).not.toBe(first);
    expect(named).toContain(m.current!.id);
  });

  it('ignores a typed letter that no ship starts with', () => {
    const m = new ShipChoiceModel(mixed, false, 'yamato');
    expect(m.key('§', 0)).toBeNull();
    expect(m.current?.id).toBe('yamato');
  });
});
