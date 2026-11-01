import { LINK_SILENCE_MS } from './protocol';

// A browser cannot see the server's WebSocket pings, and a link that dies quietly (a laptop
// waking on another network, a dropped Wi-Fi) may not close for minutes. So the client asks
// the server for a pong now and then, and gives up on a link that has gone silent with a
// question unanswered; the reconnect that follows rejoins the same seat.

/** Ask this often while nothing else is heard. */
const PING_MS = 3000;
/** A ping unanswered this long (and silence past LINK_SILENCE_MS) means the link is dead. */
const ANSWER_MS = 5000;

export class Watchdog {
  private lastSeen: number;
  private lastAsk = -Infinity;
  /** The first ping since anything was last heard, or null. */
  private askedAt: number | null = null;

  constructor(now: number) {
    this.lastSeen = now;
  }

  /** Anything arrived from the server. */
  heard(now: number): void {
    this.lastSeen = now;
    this.askedAt = null;
  }

  /** On a timer: 'ping' when it is time to ask, 'dead' when the link has gone silent, else null. */
  poll(now: number): 'ping' | 'dead' | null {
    if (this.askedAt !== null && now - this.askedAt >= ANSWER_MS && now - this.lastSeen >= LINK_SILENCE_MS) return 'dead';
    if (now - this.lastAsk < PING_MS) return null;
    this.lastAsk = now;
    this.askedAt ??= now;
    return 'ping';
  }
}
