import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { MiscTitanFx } from '../src/render/MiscTitanFx';
import { GOURMAND } from '../src/skills/misc/GourmandRuntime';
import type { GourmandFxKind } from '../src/skills/misc/MiscEvents';
import { emptyGame, place, run } from './helpers';

// The Gourmand's effects: every event it emits plays as a burst, its warnings are public, and the
// mouth, the reel and a swallowed ship show for as long as they last.

function kitchen(): { g: Game; s: Ship; enemy: Ship; fx: MiscTitanFx } {
  const g = emptyGame();
  const s = place(g, 'gourmand', 0, 0, 0);
  const enemy = place(g, 'stepper', 1, 0, -1500);
  const fx = new MiscTitanFx(new Scene(), g);
  return { g, s, enemy, fx };
}

/** What one viewport draws: ribbon segments plus particles. */
function drawn(fx: MiscTitanFx, team: 0 | 1 | -1 = -1): number {
  fx.update(1, 1 / 60);
  fx.prepare(team, 720);
  return fx.ribbons.count + fx.kit.particles.count;
}

const KINDS: GourmandFxKind[] = ['dish', 'devour', 'gulp', 'chomp', 'carve', 'slice', 'cooker', 'cookerBurst', 'skewer', 'serve', 'side', 'plate', 'comfort', 'burp', 'banquet', 'bite', 'swallow', 'spit', 'fuse', 'catastrophe'];

describe('Gourmand effects', () => {
  it.each(KINDS)('play a %s burst', (kind) => {
    const { g, s, enemy, fx } = kitchen();
    expect(drawn(fx)).toBe(0);
    g.events.emit('miscTitan', { ship: s, kind, x: enemy.pos.x, z: enemy.pos.z, tx: enemy.pos.x, tz: enemy.pos.z, target: enemy, radius: 500, n: 2 });
    run(g, 0.2);
    expect(drawn(fx)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('let its own dish bursts stand in for the shared battery splash', () => {
    const { g, s, enemy, fx } = kitchen();
    g.events.emit('miscTitan', { ship: s, kind: 'gunLand', x: 0, z: -1500 });
    g.events.emit('miscTitan', { ship: s, kind: 'gunHit', x: enemy.pos.x, z: enemy.pos.z, target: enemy, n: 1 });
    expect(drawn(fx)).toBe(0);
    fx.dispose();
  });

  it('show the pressure cooker whistling for its whole fuse, even to a team that cannot see the Gourmand', () => {
    const { g, s, fx } = kitchen();
    g.events.emit('miscTitan', { ship: s, kind: 'cooker', x: 0, z: 0, tx: 0, tz: -2000, radius: 500, n: 4 });
    run(g, GOURMAND.cooker.fuse - 0.1);
    s.mods.untargetable = true;
    expect(drawn(fx, 1)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('hide a chomp or slice on a ship from a team that cannot see that ship', () => {
    const { g, s, enemy, fx } = kitchen();
    for (const kind of ['chomp', 'slice', 'swallow'] as const) g.events.emit('miscTitan', { ship: s, kind, x: enemy.pos.x, z: enemy.pos.z, target: enemy });
    run(g, 0.1);
    enemy.mods.untargetable = true;
    expect(drawn(fx, 0)).toBe(0);
    fx.dispose();
  });

  it('draw the open mouth, the reel and a swallowed ship for as long as they last', () => {
    const { g, s, enemy, fx } = kitchen();
    const idle = drawn(fx);
    s.gourmand!.mouthUntil = g.time + 2;
    const mouth = drawn(fx);
    expect(mouth).toBeGreaterThan(idle);
    s.gourmand!.reel = { target: enemy.id, until: g.time + 2 };
    const reel = drawn(fx);
    expect(reel).toBeGreaterThan(mouth);
    s.gourmand!.swallow = { target: enemy.id, until: g.time + 2, nextTick: g.time + 0.5, originX: 0, originZ: 0, heldX: 0, heldZ: 0 };
    expect(drawn(fx)).toBeGreaterThan(reel);
    fx.dispose();
  });

  it('flash the sky and shake the Gourmand when the kitchen blows', () => {
    const { g, s, fx } = kitchen();
    const flashes: number[] = [];
    const shakes: Ship[] = [];
    fx.onFlash = (_x, _z, amount) => flashes.push(amount);
    fx.onShake = (v) => shakes.push(v);
    g.events.emit('miscTitan', { ship: s, kind: 'catastrophe', x: 0, z: 0, radius: GOURMAND.catastrophe.radius, n: 6 });
    expect(flashes).toEqual([0.7]);
    if (!fx.kit.reduce) expect(shakes).toEqual([s]);
    drawn(fx);
    if (!fx.kit.reduce) expect(fx.distortions.length).toBeGreaterThan(0);
    fx.dispose();
  });
});
