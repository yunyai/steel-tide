import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../server/limits';
import { RESYNC_RETRY_MS } from '../src/net/protocol';
import { ResyncAsk } from '../src/net/ResyncAsk';

describe('asking the server for a resync', () => {
  it('asks once, then again only while the log has still not come', () => {
    const a = new ResyncAsk();
    expect(a.ask(0)).toBe(true);
    expect(a.pending).toBe(true);
    expect(a.ask(100)).toBe(false);
    expect(a.retry(RESYNC_RETRY_MS - 1)).toBe(false);
    expect(a.retry(RESYNC_RETRY_MS)).toBe(true);
    expect(a.retry(RESYNC_RETRY_MS + 10)).toBe(false);
    a.answered();
    expect(a.pending).toBe(false);
    expect(a.retry(1e9)).toBe(false);
  });

  it('asks again once the server takes resyncs again, when it dropped the first ask', () => {
    let now = 0;
    const server = new RateLimiter(() => now);
    const a = new ResyncAsk();
    // A resync a moment ago (say, the one whose replay threw again) used the server's budget.
    expect(server.allow('resync')).toBe(true);
    now = 100;
    expect(a.ask(now)).toBe(true);
    expect(server.allow('resync')).toBe(false);
    // Without the retry this peer would wait for that log forever.
    now += RESYNC_RETRY_MS;
    expect(a.retry(now)).toBe(true);
    expect(server.allow('resync')).toBe(true);
  });
});
