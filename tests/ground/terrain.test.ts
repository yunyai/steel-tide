import { describe, expect, it, vi } from 'vitest';
import { GROUND_MAPS } from '../../src/ground/sim/maps';
import { blocksShells, PROP_RUBBLE } from '../../src/ground/sim/props';
import { emptyGround } from './helpers';

// Every test here builds a whole map; under a full parallel run that outgrows the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

describe('ground terrain and props', () => {
  it('builds every map the same way every time', () => {
    for (const m of GROUND_MAPS) {
      const a = m.build();
      const b = m.build();
      expect(a.terrain.h).toEqual(b.terrain.h);
      expect(a.terrain.mat).toEqual(b.terrain.mat);
      expect(a.props.list.map((p) => [p.kind, p.x, p.z, p.hw, p.hd, p.h, p.rot])).toEqual(b.props.list.map((p) => [p.kind, p.x, p.z, p.hw, p.hd, p.h, p.rot]));
      for (const [x, z] of [[0, 0], [123.4, -456.7], [-700, 300], [399.9, 12.1]]) expect(a.terrain.heightAt(x, z)).toBe(b.terrain.heightAt(x, z));
      expect(a.props.list.length).toBeGreaterThan(200);
    }
  });

  it('a building blocks sight until it collapses, then frees sight, the path grid and the street', () => {
    const g = emptyGround('city');
    let tested = 0;
    for (const p of g.props.list) {
      if (p.kind !== 'building' || p.h < 10 || p.hw < 6 || p.hd < 6 || !blocksShells(p)) continue;
      // A line straight through it along its long axis, at half height.
      const ax = Math.cos(p.rot);
      const az = Math.sin(p.rot);
      const y = p.y + p.h * 0.5;
      const x0 = p.x - ax * (p.hw + 1.5);
      const z0 = p.z - az * (p.hw + 1.5);
      const x1 = p.x + ax * (p.hw + 1.5);
      const z1 = p.z + az * (p.hw + 1.5);
      const hit = g.props.segment(x0, y, z0, x1, y, z1);
      if (hit?.prop !== p) continue;
      if (g.terrain.segmentHit(x0, y, z0, x1, y, z1) >= 0) continue;
      expect(g.lineOfSight(x0, y, z0, x1, y, z1)).toBe(false);
      expect(g.nav.openAt(p.x, p.z)).toBe(false);
      let downs = 0;
      g.events.on('propDown', (e) => e.prop === p && downs++);
      g.damageProp(p, p.maxHp + 1, null);
      expect(p.state).toBe(PROP_RUBBLE);
      expect(downs).toBe(1);
      const after = g.props.segment(x0, y, z0, x1, y, z1);
      expect(after?.prop === p).toBe(false);
      if (!g.terrain.slopeDeg(p.x, p.z) && g.nav.openAt(p.x + 30, p.z + 30)) expect(g.nav.openAt(p.x, p.z)).toBe(true);
      expect(g.props.blockedAt(p.x, p.z)?.id === p.id).toBe(false);
      if (++tested >= 3) break;
    }
    expect(tested).toBe(3);
  });

  it('houses take damage in two stages: damaged, then rubble', () => {
    const g = emptyGround('city');
    const p = g.props.list.find((q) => q.kind === 'building' && q.state === 0)!;
    g.damageProp(p, p.maxHp * 0.6, null);
    expect(p.state).toBe(1);
    g.damageProp(p, p.maxHp, null);
    expect(p.state).toBe(PROP_RUBBLE);
  });

  it('every capture point and spawn edge is joined up for the bots', () => {
    const g = emptyGround('city');
    const sx = -g.terrain.half * 0.8;
    for (const c of g.map.caps) {
      expect(g.nav.path(sx, 0, c.x, c.z), c.name).not.toBeNull();
      expect(g.nav.path(-sx, 0, c.x, c.z), c.name).not.toBeNull();
    }
    expect(g.nav.path(sx, -300, -sx, 300)).not.toBeNull();
  });
});
