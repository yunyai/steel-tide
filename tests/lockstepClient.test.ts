import { describe, expect, it } from 'vitest';
import { Lockstep, type LockstepSim } from '../src/net/Lockstep';
import { HASH_EVERY, TURN_TICKS, type ClientMsg, type Turn } from '../src/net/protocol';

function fakeSim(throwAt: number): LockstepSim & { ticks: number } {
  return {
    ticks: 0,
    applyTick() {
      if (this.ticks++ === throwAt) throw new Error('a step broke');
    },
    hash: () => 7,
    interpolate() {},
  };
}

const turn = (k: number): Turn => ({ k, o: [] }) as unknown as Turn;

describe('lockstep playback', () => {
  it('keeps the turn stream aligned through a step that throws, and reports the fault', () => {
    const sim = fakeSim(5);
    const sent: ClientMsg[] = [];
    const ls = new Lockstep(sim, (m) => sent.push(m));
    const faults: unknown[] = [];
    ls.onFault = (e) => faults.push(e);
    for (let k = 0; k < HASH_EVERY; k++) ls.onTurn(turn(k));
    ls.fastForward(1000);
    expect(sim.ticks).toBe(HASH_EVERY * TURN_TICKS);
    expect(ls.played).toBe(HASH_EVERY);
    expect(ls.faults).toBe(1);
    expect(faults).toHaveLength(1);
    expect(sent.filter((m) => m.t === 'hash')).toEqual([{ t: 'hash', k: HASH_EVERY - 1, h: 7 }]);
  });
});
