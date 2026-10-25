import { describe, expect, it, vi } from 'vitest';
import { RESPAWN_DELAY } from '../../src/config';
import { VEHICLE_BY_ID } from '../../src/ground/sim/data';
import { GroundGame } from '../../src/ground/sim/GroundGame';
import { GROUND_MAPS } from '../../src/ground/sim/maps';
import { emptyGround, finite, groundConfig, put, registerMap, run } from './helpers';

// Every test here builds a whole map; under a full parallel run that outgrows the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

describe('ground battles', () => {
  for (const m of GROUND_MAPS) {
    it(`an AI battle on ${m.name} plays out to a result with no NaN`, () => {
      const g = new GroundGame(groundConfig({ mapId: m.id, teamSize: 6, seed: 11 }));
      let shots = 0;
      let pens = 0;
      g.events.on('gunFired', () => shots++);
      g.events.on('shellHit', (e) => e.outcome === 'pen' && pens++);
      let ok = true;
      for (let i = 0; i < 60 * 760 && !g.over; i++) {
        g.step();
        if (i % 30 === 0 && !finite(g)) ok = false;
      }
      expect(ok).toBe(true);
      expect(g.over).toBe(true);
      expect(shots).toBeGreaterThan(50);
      expect(pens).toBeGreaterThan(10);
      expect(g.fleet.some((v) => !v.alive)).toBe(true);
    }, 120000);
  }

  it('domination: holding a point captures it and scores', () => {
    const g = new GroundGame(groundConfig({ type: 'domination', ai: [0, 0], players: [{ vehicleId: 'm24', device: 'mouse' }] }));
    const v = g.humans()[0];
    const cap = g.caps[1];
    v.place(cap.x, cap.z, 0);
    v.spawnShield = 0;
    const start = g.score[0];
    run(g, 26);
    expect(cap.owner).toBe(0);
    run(g, 10);
    expect(g.score[0]).toBeGreaterThan(start);
  });

  it('domination: a contested point does not change hands', () => {
    const g = emptyGround('city', 3, 'domination');
    const cap = g.caps[0];
    put(g, 'm24', 0, cap.x - 10, cap.z);
    put(g, 'm24', 1, cap.x + 10, cap.z);
    run(g, 30);
    expect(cap.contested).toBe(true);
    expect(cap.owner).toBe(-1);
  });

  it('annihilation ends when one side is gone', () => {
    const g = emptyGround('city', 3, 'annihilation');
    const a = put(g, 't34_85', 0, 0, -40);
    const b = put(g, 'm24', 1, 0, 40);
    run(g, 0.5);
    expect(g.over).toBe(false);
    b.damage(1e6, a);
    run(g, 0.1);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });

  it('free play: the destroyed come back, and may come back in another vehicle', () => {
    const g = new GroundGame(groundConfig({ type: 'freeplay', ai: [1, 1], players: [{ vehicleId: 't34_85', device: 'mouse' }] }));
    const me = g.humans()[0];
    g.pickVehicle(me, 'tiger2');
    me.damage(1e6, null);
    expect(me.alive).toBe(false);
    run(g, RESPAWN_DELAY + 0.5);
    const now = g.humans()[0];
    expect(now.alive).toBe(true);
    expect(now.spec).toBe(VEHICLE_BY_ID.tiger2);
    expect(now.stats).toBe(me.stats);
    expect(g.over).toBe(false);
  });

  it('crits: a track hit immobilises, a fire burns, the repair kit fixes both', () => {
    const g = emptyGround(registerMap('flat'));
    const v = put(g, 't34_85', 0, 0, -40);
    v.crit('tracks', null);
    v.crit('fire', null);
    v.control.drive = 1;
    const z0 = v.z;
    const hp0 = v.hp;
    run(g, 2);
    expect(Math.abs(v.z - z0)).toBeLessThan(0.3);
    expect(v.hp).toBeLessThan(hp0);
    v.control.consumable = 0;
    run(g, 0.1);
    expect(v.crits.tracks).toBe(0);
    expect(v.crits.fire).toBe(0);
  });

  it('a titan brings two more enemies and its escorts leave on time', () => {
    const g = new GroundGame(groundConfig({ teamSize: 4, players: [{ vehicleId: 'ratte', device: 'mouse' }] }));
    expect(g.fleet.filter((v) => v.team === 1).length).toBe(6);
    const rat = g.humans()[0];
    const i = rat.skills.findIndex((s) => s.spec.id === 'panzerEscort');
    rat.control.skill = i;
    run(g, 0.1);
    const escorts = g.vehicles.filter((v) => v.isSummon && v.summonOwner === rat);
    expect(escorts.length).toBe(2);
    run(g, 31);
    expect(escorts.every((e) => !e.alive)).toBe(true);
  });
});
