import type { HitKind } from '../core/Events';

// The Sandbox's numbers, kept apart from the DOM so they can be tested: a DPS meter over a
// rolling window and a combo log of the latest hits.

/** Seconds the DPS average covers. */
export const DPS_WINDOW = 5;
/** The burst is the most damage dealt within this many seconds. */
const BURST_WINDOW = 1;
/** Hits from one source this close together are one entry in the combo log. */
const MERGE_WINDOW = 0.25;

interface Hit {
  t: number;
  amount: number;
}

export class DpsMeter {
  /** Highest DPS reading since the last reset. */
  peak = 0;
  /** Most damage within one second since the last reset. */
  burst = 0;
  total = 0;
  private hits: Hit[] = [];
  private byKind = new Map<HitKind, number>();

  add(t: number, amount: number, kind: HitKind): void {
    this.hits.push({ t, amount });
    while (this.hits.length && t - this.hits[0].t >= DPS_WINDOW) this.hits.shift();
    this.total += amount;
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + amount);
    let second = 0;
    for (const h of this.hits) if (t - h.t <= BURST_WINDOW) second += h.amount;
    this.burst = Math.max(this.burst, second);
    this.peak = Math.max(this.peak, this.dps(t));
  }

  /** Average damage per second over the last five seconds. */
  dps(now: number): number {
    let sum = 0;
    for (const h of this.hits) if (now - h.t < DPS_WINDOW) sum += h.amount;
    return sum / DPS_WINDOW;
  }

  /** Damage by kind since the last reset, most first. */
  breakdown(): [HitKind, number][] {
    return [...this.byKind].sort((a, b) => b[1] - a[1]);
  }

  reset(): void {
    this.hits = [];
    this.byKind.clear();
    this.peak = this.burst = this.total = 0;
  }
}

export interface ComboEntry {
  source: string;
  kind: HitKind;
  amount: number;
  hits: number;
  /** Seconds between the hit before this entry and its first hit. */
  gap: number;
  /** Sim time of its latest hit. */
  t: number;
}

export class ComboLog {
  /** Newest first. */
  entries: ComboEntry[] = [];
  private last = -1;

  constructor(private readonly max = 8) {}

  add(t: number, source: string, kind: HitKind, amount: number): void {
    const top = this.entries[0];
    if (top && top.source === source && t - top.t <= MERGE_WINDOW) {
      top.amount += amount;
      top.hits++;
      top.t = t;
    } else {
      this.entries.unshift({ source, kind, amount, hits: 1, gap: this.last < 0 ? 0 : t - this.last, t });
      if (this.entries.length > this.max) this.entries.length = this.max;
    }
    this.last = t;
  }

  reset(): void {
    this.entries = [];
    this.last = -1;
  }
}
