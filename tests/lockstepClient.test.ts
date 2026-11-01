import { describe, expect, it } from 'vitest';
import { describeDesync, Lockstep, type LockstepSim } from '../src/net/Lockstep';
import { HASH_EVERY, TURN_MS, TURN_TICKS, type ClientMsg, type Sections, type Turn } from '../src/net/protocol';
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

describe('lockstep frame budget', () => {
  function slowSim(clock: { now: number }): LockstepSim {
    return {
      applyTick() {
        clock.now += 3;
      },
      hash: () => 7,
      interpolate() {},
    };
  }

  it('plays a slow battle no further than the frame budget, even far behind', () => {
    const clock = { now: 0 };
    const ls = new Lockstep(slowSim(clock), () => {}, () => clock.now);
    for (let k = 0; k < 200; k++) ls.onTurn(turn(k));
    const before = ls.backlog;
    ls.advance(1 / 60);
    expect(before - ls.backlog).toBeGreaterThanOrEqual(1);
    expect(before - ls.backlog).toBeLessThanOrEqual(3);
  });

  it('plays at least one tick a frame, and no more than the budget, in normal play', () => {
    const clock = { now: 0 };
    const ls = new Lockstep(slowSim(clock), () => {}, () => clock.now);
    for (let k = 0; k < 10; k++) ls.onTurn(turn(k));
    const before = ls.backlog;
    ls.advance(0.1);
    expect(before - ls.backlog).toBeGreaterThanOrEqual(1);
    expect(before - ls.backlog).toBeLessThanOrEqual(3);
  });

  it('holds a deeper cushion when turns arrive unevenly', () => {
    const steady = new Lockstep(fakeSim(-1), () => {});
    const bumpy = new Lockstep(fakeSim(-1), () => {});
    for (let k = 0; k < 200; k++) {
      steady.onTurn(turn(k), k * TURN_MS);
      bumpy.onTurn(turn(k), Math.floor(k / 3) * 100);
    }
    expect(steady.cushion).toBe(2);
    expect(bumpy.cushion).toBeGreaterThan(steady.cushion);
  });
});
