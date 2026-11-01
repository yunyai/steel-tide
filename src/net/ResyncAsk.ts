import { RESYNC_RETRY_MS } from './protocol';

/**
 * A resync this browser asked the server for. The server takes one per socket every few seconds
 * and ignores the rest, so an ask that comes too soon after the last (a replay that threw again)
 * would leave the browser waiting for a log that never comes: until it does, ask again whenever
 * the server will take it.
 */
export class ResyncAsk {
  /** Asked, and the log has not come yet. */
  pending = false;
  private at = 0;

  /** A new ask; false while one is already waiting for its log. */
  ask(now: number): boolean {
    if (this.pending) return false;
    this.pending = true;
    this.at = now;
    return true;
  }

  /** True when the waiting ask should go to the server again. */
  retry(now: number): boolean {
    if (!this.pending || now - this.at < RESYNC_RETRY_MS) return false;
    this.at = now;
    return true;
  }

  /** The log came. */
  answered(): void {
    this.pending = false;
  }
}
