import { TURN_MS } from './protocol';

// How unevenly turns arrive, so lockstep playback can hold just enough of a cushion: thin on a
// quiet wired LAN, deeper on busy Wi-Fi. It rises at once on a burst and settles slowly.

const RISE = 0.25;
const SETTLE = 0.02;
const MIN_CUSHION = 2;
const MAX_CUSHION = 12;

export class JitterEstimator {
  /** Smoothed distance (ms) between turn arrival gaps and the turn period; starts at one tick. */
  jitter = 1000 / 60;
  private last: number | null = null;

  /** A live turn arrived at `at` (ms). */
  sample(at: number): void {
    const last = this.last;
    this.last = at;
    if (last === null) return;
    const e = Math.abs(at - last - TURN_MS);
    this.jitter += (e - this.jitter) * (e > this.jitter ? RISE : SETTLE);
  }

  /** Ticks of backlog playback should aim to keep, for ticks of `tickMs`. */
  cushion(tickMs: number): number {
    return Math.min(MAX_CUSHION, Math.max(MIN_CUSHION, MIN_CUSHION + Math.round((2 * this.jitter) / tickMs)));
  }
}
