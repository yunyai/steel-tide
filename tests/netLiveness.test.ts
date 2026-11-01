import { describe, expect, it } from 'vitest';
import { JitterEstimator } from '../src/net/Jitter';
import { Watchdog } from '../src/net/Watchdog';
import { TURN_MS } from '../src/net/protocol';

describe('link watchdog', () => {
  it('pings a quiet link and leaves it be while the server answers', () => {
    const w = new Watchdog(0);
    expect(w.poll(0)).toBe('ping');
    w.heard(5);
    expect(w.poll(1000)).toBe(null);
    expect(w.poll(3000)).toBe('ping');
    w.heard(3004);
    // A hidden tab's timers may only fire once a minute; an answered ping is still a live link.
    expect(w.poll(63_000)).toBe('ping');
    w.heard(63_010);
    expect(w.poll(66_100)).toBe('ping');
  });

  it('never pings or gives up while turns keep arriving', () => {
    const w = new Watchdog(0);
    w.poll(0);
    for (let t = 0; t < 30_000; t += 33) {
      w.heard(t);
      expect(w.poll(t)).not.toBe('dead');
    }
  });

  it('gives up on a link that has gone silent with a ping unanswered', () => {
    const w = new Watchdog(0);
    expect(w.poll(0)).toBe('ping');
    expect(w.poll(3000)).toBe('ping');
    expect(w.poll(6000)).toBe('ping');
    expect(w.poll(9000)).toBe('ping');
    expect(w.poll(10_100)).toBe('dead');
  });

  it('gives up on a throttled tab only after its ping went unanswered', () => {
    const w = new Watchdog(0);
    w.heard(10);
    expect(w.poll(60_000)).toBe('ping');
    expect(w.poll(120_000)).toBe('dead');
  });
});

describe('turn arrival jitter', () => {
  const tick = 1000 / 60;

  it('keeps a thin cushion when turns arrive like clockwork', () => {
    const j = new JitterEstimator();
    for (let k = 0; k < 200; k++) j.sample(k * TURN_MS);
    expect(j.cushion(tick)).toBe(2);
  });

  it('starts at the old four-tick cushion before it has heard anything', () => {
    expect(new JitterEstimator().cushion(tick)).toBe(4);
  });

  it('deepens the cushion at once when turns come in bursts', () => {
    const j = new JitterEstimator();
    for (let k = 0; k < 200; k++) j.sample(k * TURN_MS);
    for (let k = 0; k < 12; k++) j.sample(200 * TURN_MS + Math.floor(k / 3) * 100);
    expect(j.cushion(tick)).toBeGreaterThanOrEqual(6);
  });

  it('never asks for more than twelve ticks, whatever the stalls', () => {
    const j = new JitterEstimator();
    for (let k = 0; k < 50; k++) j.sample(k * 2000);
    expect(j.cushion(tick)).toBe(12);
  });
});
