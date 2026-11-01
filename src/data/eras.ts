import type { BattleEra, Era, EraSel } from '../core/types';
import { ERA_LABEL, ERAS } from './factions';
import { LINE_ERAS } from './ships';

// A battle's eras as a set. 'mixed' (every era) and a single era are the older spellings of a set
// and still read as one; settings and configs now carry the set itself.

const isEra = (v: unknown): v is Era => typeof v === 'string' && (ERAS as string[]).includes(v);

/** The eras of a selection, without repeats and in roster order. */
export function eraList(sel: EraSel): Era[] {
  if (sel === 'mixed') return [...ERAS];
  const set = typeof sel === 'string' ? [sel] : sel;
  return ERAS.filter((e) => set.includes(e));
}

/**
 * An untrusted era set (or a legacy single era, or 'mixed') as a clean set in roster order, or null
 * when nothing is left that can fill a fleet: a set needs at least one era with line ships.
 */
export function normalizeEras(v: unknown): Era[] | null {
  let list: Era[];
  if (v === 'mixed') list = [...ERAS];
  else if (isEra(v)) list = [v];
  else if (Array.isArray(v)) list = eraList(v.slice(0, 32).filter(isEra));
  else return null;
  return list.some((e) => LINE_ERAS.includes(e)) ? list : null;
}

/** A battle's eras: its set, else its legacy single era, else `fallback`. */
export function configEras(c: { eras?: readonly Era[]; era?: BattleEra }, fallback: EraSel = 'historic'): Era[] {
  if (c.eras?.length) return eraList(c.eras);
  return eraList(c.era ?? fallback);
}

/** Turn one era on or off; the last era with line ships stays on. */
export function toggleEra(sel: readonly Era[], era: Era): Era[] {
  if (!sel.includes(era)) return eraList([...sel, era]);
  const next = sel.filter((e) => e !== era);
  return next.some((e) => LINE_ERAS.includes(e)) ? eraList(next) : eraList(sel);
}

export function isEveryEra(sel: readonly Era[]): boolean {
  return ERAS.every((e) => sel.includes(e));
}

/** "Mixed" for every era, the names of up to three, else a count. */
export function erasLabel(sel: readonly Era[]): string {
  const list = eraList(sel);
  if (isEveryEra(list)) return 'Mixed';
  return list.length <= 3 ? list.map((e) => ERA_LABEL[e]).join(' + ') : `${list.length} eras`;
}
