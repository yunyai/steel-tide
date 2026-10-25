import { describe, expect, it } from 'vitest';
import { GroundGame } from '../../src/ground/sim/GroundGame';
import { groundStateHash } from '../../src/ground/sim/hash';
import { groundConfig } from './helpers';

function hashes(seed: number, seconds: number): number[] {
  const g = new GroundGame(groundConfig({ type: 'domination', seed, players: [{ vehicleId: 'ratte', device: 'mouse' }] }));
  g.handToAI(g.humans()[0]);
  const out: number[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    g.step();
    if (i % 60 === 0) out.push(groundStateHash(g));
  }
  return out;
}

describe('ground determinism', () => {
  it('the same seed gives the same battle, bit for bit', () => {
    const a = hashes(42, 90);
    const b = hashes(42, 90);
    expect(a).toEqual(b);
  }, 180000);

  it('another seed gives another battle', () => {
    expect(hashes(43, 20)).not.toEqual(hashes(42, 20));
  }, 180000);
});
