import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID } from '../src/data/ships';
import { HISTORIC } from '../src/data/historic';
import { MODERN } from '../src/data/modern';

describe('ordinary weapon balance', () => {
  it('raises ordinary main and secondary damage while preserving skill damage definitions', () => {
    const raw = HISTORIC.find(s => s.id === 'iowa')!;
    const tuned = SHIP_BY_ID.iowa;
    expect(tuned.main!.ap!.damage).toBeCloseTo(raw.main!.ap!.damage * 1.2);
    expect(tuned.secondaries![0].shell.damage).toBeCloseTo(raw.secondaries![0].shell.damage * 1.2);
    expect(tuned.skills).toEqual(raw.skills);
  });

  it('makes ordinary aircraft tougher and restores/launches them sooner', () => {
    const raw = MODERN.find(s => s.id === 'queenElizabeth')!.air!;
    const tuned = SHIP_BY_ID.queenElizabeth.air!;
    expect(tuned.torpedo.hp).toBe(raw.torpedo.hp * 1.5);
    expect(tuned.launchCooldown).toBeCloseTo(raw.launchCooldown * 0.8);
    expect(tuned.dive.restore).toBeCloseTo(raw.dive.restore * 0.8);
  });
});
