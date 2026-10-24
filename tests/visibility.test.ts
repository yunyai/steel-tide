import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SMOKE_DISPERSION } from '../src/config';
import type { Game } from '../src/core/Game';
import { raycast } from '../src/player/FireControl';
import type { Ship } from '../src/ships/Ship';
import { emptyGame, place, run } from './helpers';

function cloak(s: Ship): void {
  s.addEffect({
    id: 'test-cloak',
    time: 60,
    apply(m) {
      m.untargetable = true;
    },
  });
}

describe('ships are always visible', () => {
  it('the AI picks a target across the map with nothing to spot it first', () => {
    const g = emptyGame();
    const bot = place(g, 'iowa', 0, -4000, 0, Math.PI / 2, true);
    const far = place(g, 'shimakaze', 1, 4000, 0, -Math.PI / 2);
    run(g, 1);
    expect(g.ai.get(bot)!.target).toBe(far);
  });

  it('the crosshair finds a destroyer twelve kilometres out', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const far = place(g, 'shimakaze', 1, 0, -4000, Math.PI / 2);
    run(g, 0.1);
    const o = new Vector3(me.pos.x, 30, me.pos.z);
    const d = new Vector3(far.renderPos.x - o.x, 4 - o.y, far.renderPos.z - o.z).normalize();
    expect(raycast(g, me.team, o, d, 20000).ship).toBe(far);
  });

  it('an untargetable ship is skipped by AI target choice until the effect ends', () => {
    const g = emptyGame();
    const bot = place(g, 'iowa', 0, 0, 0, Math.PI / 2, true);
    const near = place(g, 'fletcher', 1, 1500, 0);
    const far = place(g, 'iowa', 1, 3500, 0);
    cloak(near);
    run(g, 1);
    expect(near.mods.untargetable).toBe(true);
    expect(g.ai.get(bot)!.target).toBe(far);
    near.effects = near.effects.filter((e) => e.id !== 'test-cloak');
    run(g, 1);
    expect(g.ai.get(bot)!.target).toBe(near);
  });
});

/** Spread (RMS distance from the mean) of where `rounds` main-battery shells are aimed to land. */
function spread(g: Game, me: Ship, rounds: number): number {
  const pts: { x: number; z: number }[] = [];
  const fire = g.shells.fire.bind(g.shells);
  g.shells.fire = (owner, o) => {
    pts.push({ x: o.toX, z: o.toZ });
    return fire(owner, o);
  };
  for (let i = 0; i < rounds; i++) {
    me.turrets.forEach((t) => (t.reload = 0));
    me.fireTurret(0, 'AP', true);
  }
  g.shells.fire = fire;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const mz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
  return Math.sqrt(pts.reduce((a, p) => a + (p.x - mx) ** 2 + (p.z - mz) ** 2, 0) / pts.length);
}

describe('smoke', () => {
  it('is cover, not invisibility: shots aimed into it scatter twice as wide', () => {
    const shoot = (smoke: boolean) => {
      const g = emptyGame('open', 3);
      const me = place(g, 'iowa', 0, 0, 0, Math.PI / 2);
      run(g, 0.1);
      me.control.aimX = 0;
      me.control.aimZ = -2500;
      if (smoke) g.smokes.push({ x: 0, z: -2500, r: 400, life: 60, team: 1 });
      return spread(g, me, 300);
    };
    const ratio = shoot(true) / shoot(false);
    expect(ratio).toBeGreaterThan(SMOKE_DISPERSION * 0.85);
    expect(ratio).toBeLessThan(SMOKE_DISPERSION * 1.15);
  });
});
