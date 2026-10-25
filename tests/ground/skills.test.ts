import { describe, expect, it, vi } from 'vitest';
import { VEHICLES } from '../../src/ground/sim/data';
import { GroundGame } from '../../src/ground/sim/GroundGame';
import { GROUND_SKILLS } from '../../src/ground/sim/skills/registry';
import { emptyGround, finite, groundConfig, put, run } from './helpers';

// Every test here builds a whole map; under a full parallel run that outgrows the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

describe('ground skills', () => {
  it('every kit has its skills registered: 2 + 1, titans 6 + 3', () => {
    for (const v of VEHICLES) {
      const ults = v.skills.filter((s) => s.ult).length;
      expect(v.skills.length - ults, v.id).toBe(v.cls === 'TT' ? 6 : 2);
      expect(ults, v.id).toBe(v.cls === 'TT' ? 3 : 1);
      for (const s of v.skills) expect(GROUND_SKILLS[s.id], s.id).toBeDefined();
    }
  });

  for (const spec of VEHICLES) {
    it(`${spec.name}: every skill activates, runs and ends cleanly`, () => {
      for (let i = 0; i < spec.skills.length; i++) {
        const g = emptyGround('city', 5 + i);
        const v = put(g, spec.id, 0, -60, -40, Math.PI / 2);
        const foes = [put(g, 't34_85', 1, 80, -40, -Math.PI / 2, true), put(g, 'tiger2', 1, 110, -20, -Math.PI / 2, true), put(g, 'm24', 1, 100, -70, -Math.PI / 2, true)];
        put(g, 'm24', 0, -80, -20, Math.PI / 2, true).damage(600, foes[0]);
        v.damage(800, foes[0]);
        v.crit('tracks', foes[0]);
        v.control.aimX = foes[0].x;
        v.control.aimY = foes[0].y + 1.5;
        v.control.aimZ = foes[0].z;
        v.control.targetId = foes[0].id;
        const st = v.skills[i];
        st.meter = 1;
        st.cooldown = 0;
        v.control.skill = i;
        let fired = false;
        g.events.on('skill', (e) => e.v === v && e.index === i && (fired = true));
        run(g, 0.1);
        expect(fired, st.spec.id).toBe(true);
        run(g, Math.max(8, st.spec.duration + 2), () => {
          v.control.fire = true;
          v.control.aimX = foes[0].x;
          v.control.aimZ = foes[0].z;
        });
        expect(finite(g), st.spec.id).toBe(true);
        expect(st.active, st.spec.id).toBe(false);
      }
    });
  }

  it('the bots use every skill over a few battles', () => {
    const used = new Set<string>();
    const all = new Set(VEHICLES.flatMap((v) => v.skills.map((s) => s.id)));
    for (const seed of [1, 2, 3]) {
      const g = new GroundGame(groundConfig({ type: 'domination', seed, players: [{ vehicleId: 'ratte', device: 'mouse' }] }));
      g.handToAI(g.humans()[0]);
      g.events.on('skill', (e) => used.add(e.v.skills[e.index].spec.id));
      for (let i = 0; i < 60 * 300 && !g.over; i++) g.step();
      if ([...all].every((id) => used.has(id))) break;
    }
    expect([...all].filter((id) => !used.has(id))).toEqual([]);
  }, 180000);
});
