import { describe, expect, it } from 'vitest';
import { ComboLog, DpsMeter } from '../src/ui/SandboxMeter';

describe('DPS meter', () => {
  it('averages the last 5 s, keeps the peak and the biggest second, and splits by kind', () => {
    const m = new DpsMeter();
    m.add(0, 1000, 'gun');
    m.add(0.5, 500, 'torp');
    m.add(1, 500, 'gun');
    expect(m.dps(1)).toBe(2000 / 5);
    expect(m.burst).toBe(2000);
    expect(m.total).toBe(2000);
    expect(m.breakdown()).toEqual([['gun', 1500], ['torp', 500]]);
    m.add(6.2, 100, 'dot');
    // The first three hits have left the window.
    expect(m.dps(6.2)).toBe(100 / 5);
    expect(m.peak).toBe(2000 / 5);
    expect(m.burst).toBe(2000);
    m.reset();
    expect([m.dps(7), m.peak, m.burst, m.total, m.breakdown().length]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('combo log', () => {
  it('merges hits from one source within 0.25 s and shows the gap since the previous hit', () => {
    const log = new ComboLog(4);
    log.add(10, 'Main battery', 'gun', 800);
    log.add(10.1, 'Main battery', 'gun', 900);
    log.add(10.2, 'Long Lance', 'torp', 5000);
    log.add(11, 'Main battery', 'gun', 700);
    expect(log.entries.map((e) => [e.source, e.amount, e.hits, Number(e.gap.toFixed(2))])).toEqual([
      ['Main battery', 700, 1, 0.8],
      ['Long Lance', 5000, 1, 0.1],
      ['Main battery', 1700, 2, 0],
    ]);
    for (let i = 0; i < 5; i++) log.add(20 + i, `S${i}`, 'skill', 1);
    expect(log.entries).toHaveLength(4);
    expect(log.entries[0].source).toBe('S4');
    log.reset();
    expect(log.entries).toEqual([]);
  });
});
