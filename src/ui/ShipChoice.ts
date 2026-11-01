import type { ShipClass, ShipSpec } from '../core/types';
import { ERA_LABEL, ERAS, FACTIONS, eraOf } from '../data/factions';
import { CLASS_LABEL } from '../data/ships';

// The ship combo's list and keys, kept apart from the DOM so they can be tested on their own.

/** Class filters and headings: cruisers of every weight share one. */
export const CLASS_CHIPS: { id: string; label: string; classes: ShipClass[] }[] = [
  { id: 'BB', label: 'Battleships', classes: ['BB'] },
  { id: 'CA', label: 'Cruisers', classes: ['CB', 'CA', 'CL'] },
  { id: 'DD', label: 'Destroyers', classes: ['DD'] },
  { id: 'CV', label: 'Carriers', classes: ['CV'] },
  { id: 'SS', label: 'Submarines', classes: ['SS'] },
  { id: 'TT', label: 'Titans', classes: ['TT'] },
];

export function chipOf(cls: ShipClass): string {
  return CLASS_CHIPS.find((c) => c.classes.includes(cls))?.id ?? cls;
}

/** Name, era, nation, class name or class code, case-insensitively. */
export function shipMatches(s: ShipSpec, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || `${s.name} ${ERA_LABEL[eraOf(s)]} ${FACTIONS[s.nation].label} ${CLASS_LABEL[s.cls]} ${s.cls}`.toLocaleLowerCase().includes(q);
}

export interface ShipRow { kind: 'ship'; id: string | null; label: string; badge: string; era: string }
export type PickerRow = { kind: 'group'; label: string } | ShipRow;

const AUTOMATIC = 'Automatic';

/** Matching ships under era and class headings, with Automatic first when the slot allows it. */
export function pickerRows(ships: readonly ShipSpec[], query: string, auto: boolean): PickerRow[] {
  const rows: PickerRow[] = [];
  const q = query.trim().toLocaleLowerCase();
  if (auto && AUTOMATIC.toLocaleLowerCase().includes(q)) rows.push({ kind: 'ship', id: null, label: AUTOMATIC, badge: 'AUTO', era: 'Balanced' });
  const found = ships.filter((s) => shipMatches(s, q));
  for (const era of ERAS) {
    for (const chip of CLASS_CHIPS) {
      const group = found.filter((s) => eraOf(s) === era && chip.classes.includes(s.cls));
      if (!group.length) continue;
      rows.push({ kind: 'group', label: `${ERA_LABEL[era]} · ${chip.label}` });
      for (const s of group) rows.push({ kind: 'ship', id: s.id, label: s.name, badge: chipOf(s.cls), era: ERA_LABEL[era] });
    }
  }
  return rows;
}

export type PickerAction = 'pick' | 'close' | 'move' | null;

/** Typed letters within this long of each other build one name. */
const TYPE_AHEAD_MS = 700;
const PAGE = 8;

export class ShipChoiceModel {
  query = '';
  rows: PickerRow[] = [];
  choices: ShipRow[] = [];
  /** Index into `choices`. */
  active = 0;
  private typed = '';
  private typedAt = -Infinity;

  constructor(private readonly ships: readonly ShipSpec[], private readonly auto: boolean, value?: string | null) {
    this.filter('');
    this.select(value ?? null);
  }

  get current(): ShipRow | undefined {
    return this.choices[this.active];
  }

  filter(query: string): void {
    this.query = query;
    this.rows = pickerRows(this.ships, query, this.auto);
    this.choices = this.rows.filter((r): r is ShipRow => r.kind === 'ship');
    this.active = 0;
  }

  select(id: string | null): void {
    const i = this.choices.findIndex((c) => c.id === id);
    if (i >= 0) this.active = i;
  }

  private moveTo(i: number): void {
    this.active = Math.max(0, Math.min(this.choices.length - 1, i));
  }

  /** Jump to the next name starting with what was typed; one letter repeated cycles through its names. */
  typeAhead(ch: string, now: number): boolean {
    if (now - this.typedAt > TYPE_AHEAD_MS) this.typed = '';
    this.typedAt = now;
    this.typed += ch.toLocaleLowerCase();
    const repeat = [...this.typed].every((c) => c === this.typed[0]);
    const prefix = repeat ? this.typed[0] : this.typed;
    const n = this.choices.length;
    for (let step = repeat ? 1 : 0; step < n + (repeat ? 1 : 0); step++) {
      const i = (this.active + step) % n;
      if (this.choices[i].label.toLocaleLowerCase().startsWith(prefix)) {
        this.active = i;
        return true;
      }
    }
    return false;
  }

  key(key: string, now: number): PickerAction {
    if (!this.choices.length) return key === 'Escape' ? 'close' : null;
    switch (key) {
      case 'ArrowDown': this.moveTo(this.active + 1); return 'move';
      case 'ArrowUp': this.moveTo(this.active - 1); return 'move';
      case 'PageDown': this.moveTo(this.active + PAGE); return 'move';
      case 'PageUp': this.moveTo(this.active - PAGE); return 'move';
      case 'Home': this.moveTo(0); return 'move';
      case 'End': this.moveTo(this.choices.length - 1); return 'move';
      case 'Enter': return 'pick';
      case 'Escape': return 'close';
    }
    return [...key].length === 1 && key.trim() && this.typeAhead(key, now) ? 'move' : null;
  }
}
