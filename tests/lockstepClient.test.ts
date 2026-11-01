import { describe, expect, it } from 'vitest';
import { describeDesync, Lockstep, type LockstepSim } from '../src/net/Lockstep';
import { HASH_EVERY, TURN_TICKS, type ClientMsg, type Sections, type Turn } from '../src/net/protocol';
import { foldSections } from '../src/net/hash';

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

describe('lockstep checkpoints', () => {
  it('reports the fingerprint in sections when the battle can give them', () => {
    const sim = { ...fakeSim(-1), sections: (): Sections => [['core', 1], ['s1', 2]] };
    const sent: ClientMsg[] = [];
    const ls = new Lockstep(sim, (m) => sent.push(m));
    for (let k = 0; k < HASH_EVERY; k++) ls.onTurn(turn(k));
    ls.fastForward(1000);
    expect(sent.filter((m) => m.t === 'hash')).toEqual([{ t: 'hash', k: HASH_EVERY - 1, h: foldSections([['core', 1], ['s1', 2]]), s: [['core', 1], ['s1', 2]] }]);
  });
});

describe('desync notes', () => {
  it('says which turn drifted and on what, in the words the battle gives', () => {
    expect(describeDesync(1859, ['s17', 'shells'], (n) => (n === 's17' ? 's17 Yamato' : n))).toBe('desync k=1859: s17 Yamato, shells');
    expect(describeDesync(59, [], (n) => n)).toBe('desync k=59');
  });
});
