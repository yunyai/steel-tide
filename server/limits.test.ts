import { describe, expect, it } from 'vitest';
import { RateLimiter } from './limits';

describe('per-socket message limits', () => {
  it('lets a burst through, then refills at the rate for that kind of message', () => {
    let now = 0;
    const r = new RateLimiter(() => now);
    const passed = () => Array.from({ length: 20 }, () => r.allow('ping')).filter(Boolean).length;
    expect(passed()).toBe(2);
    now += 500;
    expect(passed()).toBe(1);
    now += 10_000;
    expect(passed()).toBe(2);
  });

  it('allows one resync every five seconds', () => {
    let now = 0;
    const r = new RateLimiter(() => now);
    expect(r.allow('resync')).toBe(true);
    expect(r.allow('resync')).toBe(false);
    now += 4900;
    expect(r.allow('resync')).toBe(false);
    now += 200;
    expect(r.allow('resync')).toBe(true);
  });

  it('shares one budget between the lobby edits, and keeps kinds apart otherwise', () => {
    const r = new RateLimiter(() => 0);
    for (let i = 0; i < 10; i++) expect(r.allow(i % 2 ? 'name' : 'settings')).toBe(true);
    expect(r.allow('me')).toBe(false);
    expect(r.allow('hash')).toBe(true);
    expect(Array.from({ length: 300 }, () => r.allow('in')).filter(Boolean)).toHaveLength(240);
  });
});
