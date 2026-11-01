import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config';
import { Game } from '../src/core/Game';
import { intermissionView, pickCard } from '../src/ui/Intermission';

// The refit card choice between waves, as each captain sees and makes it.

function offer(captains = 2): Game {
  const g = new Game({
    mode: 'solo',
    type: 'bossrush',
    mapId: 'open',
    teamSize: 1,
    difficulty: 'normal',
    eras: ['historic'],
    seed: 11,
    escorts: 0,
    players: Array.from({ length: captains }, (_, i) => ({ shipId: 'iowa', device: 'mouse' as const, name: `C${i + 1}` })),
  });
  for (let t = 0; t < 5; t += SIM_DT) g.step(SIM_DT);
  for (const s of g.ships) if (s.alive && s.team === 1) s.sink(g.rush!.player);
  g.rush!.queue.length = 0;
  g.step(SIM_DT);
  expect(g.rush!.phase).toBe('offer');
  return g;
}

describe('the intermission', () => {
  it('shows each captain their own cards', () => {
    const r = offer().rush!;
    for (const i of [0, 1]) expect(intermissionView(r, i, false)).toEqual({ on: true, cards: r.captains[i].offer, waiting: '' });
  });

  it('a solo pick applies the card for the captain choosing it', () => {
    const r = offer().rush!;
    const card = r.captains[1].offer[2].id;
    expect(pickCard(r, 1, 2, null)).toBe(true);
    expect(r.captains.map((c) => c.taken)).toEqual([[], [card]]);
  });

  it('a LAN pick only sends the card, for every peer to apply on the same turn', () => {
    const r = offer().rush!;
    const sent: number[] = [];
    expect(pickCard(r, 1, 0, (i) => sent.push(i))).toBe(true);
    expect(sent).toEqual([0]);
    expect(r.captains.map((c) => c.taken.length)).toEqual([0, 0]);
    expect(pickCard(r, 1, 5, (i) => sent.push(i))).toBe(false);
    expect(sent).toEqual([0]);
  });

  it('waits on the other captains once a card is picked, or sent', () => {
    const r = offer().rush!;
    expect(intermissionView(r, 1, true)).toEqual({ on: true, cards: [], waiting: 'Waiting for 1 captain…' });
    r.choose(0, 0);
    expect(intermissionView(r, 0, false)).toEqual({ on: true, cards: [], waiting: 'Waiting for 1 captain…' });
    r.choose(0, 1);
    expect(intermissionView(r, 0, false).on).toBe(false);
  });

  it('counts every captain still choosing', () => {
    const r = offer(3).rush!;
    r.choose(0, 0);
    expect(intermissionView(r, 0, false).waiting).toBe('Waiting for 2 captains…');
  });
});
