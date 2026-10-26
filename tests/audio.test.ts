import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceBudget } from '../src/fx/VoiceBudget';

afterEach(() => vi.unstubAllGlobals());

describe('bounded audio scheduling', () => {
  it('bounds repeated distant salvos, reserving space for local actions and warnings', () => {
    const budget = new VoiceBudget();
    for (let i = 0; i < 200; i++) budget.admit('weapon', 0, 2, 0.1, `salvo-${i}`);
    expect(budget.size).toBeLessThanOrEqual(20);
    expect(budget.admit('ability', 0, 2, 2, 'player')).toBe(true);
    expect(budget.admit('ui', 0, 1, 3, 'danger')).toBe(true);
    expect(budget.size).toBeLessThanOrEqual(40);
  });

  it('merges repeated impacts, expires voices and clears pending sounds', () => {
    const budget = new VoiceBudget();
    expect(budget.admit('weapon', 0, 2, 0.1, 'impact')).toBe(true);
    expect(budget.admit('weapon', 0.02, 2, 0.1, 'impact')).toBe(false);
    expect(budget.admit('weapon', 4, 2, 0.1, 'impact')).toBe(true);
    expect(budget.size).toBe(1);
    budget.clear();
    expect(budget.size).toBe(0);
  });

  it('migrates legacy volume preferences and persists category volumes', async () => {
    vi.resetModules();
    const values = new Map([['steel-tide.sound', JSON.stringify({ master: 0.3, effects: 0.4, ui: 0.6 })]]);
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => values.get(k), setItem: (k: string, v: string) => values.set(k, v) } });
    const { sound, setSound } = await import('../src/input/Settings');
    expect(sound()).toMatchObject({ master: 0.3, effects: 0.4, ui: 0.6, weapons: 1, abilities: 1, ambience: 1 });
    setSound({ weapons: 0, abilities: 0.5 });
    expect(JSON.parse(values.get('steel-tide.sound')!)).toMatchObject({ master: 0.3, weapons: 0, abilities: 0.5 });
  });
});
