/**
 * Timed bonuses that stack per emitter: each source keeps its own timer, so a second copy adds
 * while a recast from the same source only refreshes. Keys are `${ownerId}:${slot}`.
 */
export type Stacks = Record<string, number>;

/** Start or refresh `source`'s copy until `until`, dropping copies that have run out. */
export function addStack(map: Stacks, source: string, until: number, now: number): void {
  for (const k of Object.keys(map)) if (map[k] <= now) delete map[k];
  map[source] = until;
}

/** Copies still running at `now`. */
export function stackCount(map: Stacks, now: number): number {
  let n = 0;
  for (const k in map) if (map[k] > now) n++;
  return n;
}
