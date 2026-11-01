import type { ShipSpec } from '../core/types';
import { CLASS_CHIPS, shipMatches } from './ShipChoice';

/** A new pool allows every eligible ship except titans. */
export function defaultPool(ships: readonly ShipSpec[]): string[] {
  return ships.filter((s) => s.cls !== 'TT').map((s) => s.id);
}

/** The ships a search and the pressed class chips leave in view; no chip pressed shows every class. */
export function poolShips(ships: readonly ShipSpec[], query: string, chips: readonly string[]): ShipSpec[] {
  const classes = new Set(CLASS_CHIPS.filter((c) => chips.includes(c.id)).flatMap((c) => c.classes));
  return ships.filter((s) => (!chips.length || classes.has(s.cls)) && shipMatches(s, query));
}

export function selectVisible(pool: readonly string[], visible: readonly ShipSpec[]): string[] {
  const out = [...pool];
  for (const s of visible) if (!out.includes(s.id)) out.push(s.id);
  return out;
}

export function clearVisible(pool: readonly string[], visible: readonly ShipSpec[]): string[] {
  const hide = new Set(visible.map((s) => s.id));
  return pool.filter((id) => !hide.has(id));
}
