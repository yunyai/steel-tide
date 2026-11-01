import { RESYNC_EVERY_MS } from '../src/net/protocol';

// How fast one socket may send each kind of message: token buckets, refilled continuously. A
// browser playing normally never meets these; a stuck loop or a flood does.

/** [messages per second, most at once] by kind; the lobby edits share one budget. */
const RATES: Record<string, [rate: number, burst: number]> = {
  in: [240, 240],
  hash: [4, 8],
  lobby: [10, 10],
  resync: [1000 / RESYNC_EVERY_MS, 1],
  sandbox: [10, 10],
  ping: [2, 2],
  other: [10, 10],
};

const KIND: Record<string, string> = { in: 'in', hash: 'hash', name: 'lobby', settings: 'lobby', me: 'lobby', resync: 'resync', sandbox: 'sandbox', ping: 'ping' };

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private now: () => number) {}

  /** Spend one message of type `t`; false when the socket is over its budget for it. */
  allow(t: string): boolean {
    // Own keys only: a message named "constructor" or "__proto__" is just another unknown kind.
    const kind = Object.hasOwn(KIND, t) ? KIND[t] : 'other';
    const [rate, burst] = RATES[kind];
    const now = this.now();
    let b = this.buckets.get(kind);
    if (!b) this.buckets.set(kind, (b = { tokens: burst, at: now }));
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
