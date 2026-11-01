import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID } from '../src/data/ships';
import { emptyGame, place, run } from './helpers';

// Torpedoes against submarines: periscope depth is within reach of any torpedo; only a homing
// torpedo follows a submarine down deep.

function dived(depth: 1 | 2) {
  const g = emptyGame();
  const sub = place(g, 'hadal', 0, 0, 0);
  const dd = place(g, 'fletcher', 1, -3000, 0, Math.PI / 2);
  sub.depthState = depth;
  run(g, 12);
  expect(sub.submerged).toBe(true);
  expect(sub.deep).toBe(depth === 2);
  return { g, sub, dd };
}

function torpedoAt(depth: 1 | 2, homing: boolean) {
  const { g, sub, dd } = dived(depth);
  const hp = sub.hp;
  const t = g.torps.launch(dd, sub.pos.x - 1500, sub.pos.z, Math.PI / 2, SHIP_BY_ID.fletcher.torpedoes!, homing ? sub : null);
  for (let i = 0; i < 60 * 30 && t.alive; i++) run(g, 1 / 60);
  return { hit: sub.hp < hp, t };
}

describe('torpedoes against submarines', () => {
  it('a straight-running torpedo hits a submarine at periscope depth', () => {
    expect(torpedoAt(1, false).hit).toBe(true);
  });

  it('a straight-running torpedo passes over a submarine running deep', () => {
    expect(torpedoAt(2, false).hit).toBe(false);
  });

  it('a homing torpedo follows a submarine down deep', () => {
    expect(torpedoAt(2, true).hit).toBe(true);
  });
});
