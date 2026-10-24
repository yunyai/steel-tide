import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MAP_SIZE } from '../src/config';
import { SHIPS } from '../src/data/ships';
import { assistAim, leadPoint, raycast } from '../src/player/FireControl';
import { emptyGame, place } from './helpers';

const dirTo = (o: Vector3, x: number, y: number, z: number) => new Vector3(x - o.x, y - o.y, z - o.z).normalize();

describe('fire control', () => {
  it('crosshair ray stops on an enemy hull before the sea behind it', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 0, -1500, Math.PI / 2);
    const o = new Vector3(0, 40, 200);
    const hit = raycast(g, 0, o, dirTo(o, 0, 4, -1500), 6000, me);
    expect(hit.kind).toBe('ship');
    expect(hit.ship).toBe(foe);
    expect(hit.z).toBeGreaterThan(-1500);
  });

  it('crosshair ray stops on an island', () => {
    const g = emptyGame('strait');
    const o = new Vector3(-300, 40, 0);
    const hit = raycast(g, 0, o, dirTo(o, -300, 0, -2800), 6000);
    expect(hit.kind).toBe('land');
    expect(hit.z).toBeGreaterThan(-1700);
    expect(hit.z).toBeLessThan(-1000);
  });

  it('looking at the sky aims at full range along the bearing', () => {
    const g = emptyGame();
    const o = new Vector3(0, 40, 0);
    const hit = raycast(g, 0, o, new Vector3(0, 0.2, -1).normalize(), 5000);
    expect(hit.kind).toBe('sky');
    expect(hit.z).toBeCloseTo(-5000);
  });

  it('lead point is where a steady target will be after the flight time', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 0, -2000, Math.PI / 2);
    foe.speed = 20;
    const p = leadPoint(me, foe, () => 3);
    expect(p.x).toBeCloseTo(60);
    expect(p.z).toBeCloseTo(-2000);
  });

  it('assist adds the lead once and never doubles a hand-laid lead', () => {
    // Target at the origin moving +x; lead point 100 m ahead.
    const onHull = assistAim(0, 0, 0, 0, 100, 0);
    expect(onHull.x).toBeCloseTo(100);
    const handLed = assistAim(100, 0, 0, 0, 100, 0);
    expect(handLed.x).toBeCloseTo(100);
    // A range error is reduced, not erased.
    const short = assistAim(0, 50, 0, 0, 100, 0);
    expect(short.z).toBeGreaterThan(0);
    expect(short.z).toBeLessThan(50);
  });

  it('every gun reaches less than the width of the battle area', () => {
    for (const s of SHIPS) {
      if (s.main) expect(s.main.range).toBeLessThan(MAP_SIZE * 0.7);
      if (s.torpedoes) expect(s.torpedoes.range).toBeLessThan(MAP_SIZE * 0.5);
    }
  });
});
