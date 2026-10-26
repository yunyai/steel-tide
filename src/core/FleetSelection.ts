import type { BattleEra, ShipSpec } from './types';
import { shipsIn, SHIP_BY_ID } from '../data/ships';

export interface AISelection {
  mode: 'auto' | 'pool' | 'assign';
  pool?: string[];
  /** One entry per AI slot; null means automatic. Duplicates are intentional. */
  slots?: (string | null)[];
}
export type TeamAISelection = [AISelection, AISelection];

export function eligibleShips(era: BattleEra = 'historic', titans = false): ShipSpec[] {
  return shipsIn(era).filter(s => !s.hidden && (titans || s.cls !== 'TT'));
}

export function randomShip(era: BattleEra, rng: () => number, titans = false): ShipSpec | null {
  const pool = eligibleShips(era, titans);
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] : null;
}

/** Accept bounded, plain configuration from local saves or untrusted network patches. */
export function cleanAISelection(value: unknown, era: BattleEra, titans: boolean): TeamAISelection | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const allowed = new Set(eligibleShips(era, titans).map(s => s.id));
  const out: AISelection[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object' || !['auto', 'pool', 'assign'].includes(v.mode)) return null;
    const ids = (xs: unknown): string[] => Array.isArray(xs) ? xs.slice(0, 256).filter((id): id is string => typeof id === 'string' && allowed.has(id)) : [];
    out.push({ mode: v.mode, ...(v.pool !== undefined ? { pool: ids(v.pool) } : {}), ...(Array.isArray(v.slots) ? { slots: v.slots.slice(0, 8).map((id: unknown) => typeof id === 'string' && allowed.has(id) ? id : null) } : {}) });
  }
  return out as TeamAISelection;
}

export function selectionError(selection: TeamAISelection | undefined, era: BattleEra = 'historic', titans = true, counts?: [number, number]): string | null {
  if (!selection) return null;
  const clean = cleanAISelection(selection, era, titans);
  if (!clean) return 'Invalid AI selection configuration';
  for (const t of [0, 1] as const) {
    const s = clean[t];
    if (counts?.[t] === 0) continue;
    if ((s.mode === 'pool' || s.mode === 'assign' && s.pool !== undefined) && !s.pool?.length) return `Team ${t === 0 ? 'A' : 'B'} has an empty eligible AI pool. Choose ships for this era.`;
  }
  return null;
}

export function selectedAI(selection: AISelection | undefined, index: number, era: BattleEra, titans: boolean, rng: () => number, automatic: () => ShipSpec): ShipSpec {
  if (!selection || selection.mode === 'auto') return automatic();
  const allowed = new Set(eligibleShips(era, titans).map(s => s.id));
  const assigned = selection.mode === 'assign' ? selection.slots?.[index] : null;
  if (assigned && allowed.has(assigned)) return SHIP_BY_ID[assigned];
  const pool = selection.pool?.filter(id => allowed.has(id));
  if (pool?.length) return SHIP_BY_ID[pool[Math.floor(rng() * pool.length)]];
  if (selection.mode === 'pool' || selection.pool !== undefined) throw new Error('Empty eligible AI pool');
  return automatic();
}
