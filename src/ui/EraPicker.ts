import type { Era } from '../core/types';
import { eraList, erasLabel, isEveryEra, toggleEra } from '../data/eras';
import { ERAS, ERA_BLURB, ERA_LABEL } from '../data/factions';
import { shipsOf } from '../data/ships';
import { multiSeg } from './dom';

// The battle's eras, chosen as a set: the solo orders and the LAN lobby share it.

const OFFERED = ERAS.filter((e) => shipsOf(e).length > 0);

/** Each era with ships on its own button, and "All eras" for Mixed. The last era with warships stays on. */
export function eraSeg(get: () => readonly Era[], set: (eras: Era[]) => void, click?: () => void, key = ''): HTMLElement {
  return multiSeg(OFFERED.map((e) => ({ value: e, label: ERA_LABEL[e] })), get, (e) => set(toggleEra(get(), e)), { label: 'All eras', set: () => set(eraList('mixed')) }, click, key);
}

export function erasBlurb(eras: readonly Era[]): string {
  const list = eraList(eras);
  if (isEveryEra(list)) return 'Every era at once: galleons, missile cruisers and railgun dreadnoughts in one fight.';
  if (list.length === 1) return ERA_BLURB[list[0]];
  return `${erasLabel(list)}: both fleets draw their ships from every era chosen. At least one era with warships stays on.`;
}
