import { describe, expect, it } from 'vitest';
import { Scene, type Group, type Mesh } from 'three';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { MiscTitanFx } from '../src/render/MiscTitanFx';
import { dollOf, HEX, pinDoll } from '../src/skills/misc/HexweaverRuntime';
import type { HexFxKind } from '../src/skills/misc/MiscEvents';
import { emptyGame, place, run } from './helpers';

// The Hexweaver's effects: every event it emits plays as a burst, the coven's circle is public,
// and each bound enemy's doll reacts to what happens to its ship.

function coven(): { g: Game; hex: Ship; enemy: Ship; fx: MiscTitanFx } {
  const g = emptyGame();
  const hex = place(g, 'hexweaver', 0, 0, 0);
  const enemy = place(g, 'stepper', 1, 1500, 0);
  const fx = new MiscTitanFx(new Scene(), g);
  return { g, hex, enemy, fx };
}

/** What one viewport draws: ribbon segments plus particles. */
function drawn(fx: MiscTitanFx, team: 0 | 1 | -1 = -1, time = 1): number {
  fx.update(time, 1 / 60);
  fx.prepare(team, 720);
  return fx.ribbons.count + fx.kit.particles.count;
}

function doll(fx: MiscTitanFx, hex: Ship, enemy: Ship): Group {
  return fx.kit.peek(`misc-doll-${hex.id}-${enemy.id}`) as Group;
}

const KINDS: HexFxKind[] = ['pin', 'stitch', 'twist', 'fire', 'ignite', 'rip', 'erupt', 'substitute', 'decoyBurst', 'coven', 'needle', 'unmake', 'tear'];

describe('Hexweaver effects', () => {
  it.each(KINDS)('play a %s burst', (kind) => {
    const { g, hex, enemy, fx } = coven();
    expect(drawn(fx)).toBe(0);
    g.events.emit('miscTitan', { ship: hex, kind, x: enemy.pos.x, z: enemy.pos.z, tx: 0, tz: 0, target: enemy, radius: 900, n: 1 });
    run(g, 0.2);
    expect(drawn(fx)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('hide a burst on a ship from a team that cannot see it, but keep the coven’s circle public', () => {
    const { g, hex, enemy, fx } = coven();
    for (const kind of ['pin', 'twist', 'ignite', 'needle', 'unmake', 'tear'] as const) {
      g.events.emit('miscTitan', { ship: hex, kind, x: enemy.pos.x, z: enemy.pos.z, tx: 0, tz: 0, target: enemy, n: 1 });
    }
    run(g, 0.2);
    // The sim rebuilds `mods` every tick, so hide the ship after running it.
    enemy.mods.untargetable = true;
    expect(drawn(fx, 0)).toBe(0);
    hex.mods.untargetable = true;
    g.events.emit('miscTitan', { ship: hex, kind: 'coven', x: 0, z: 0, radius: HEX.coven.radius });
    expect(drawn(fx, 1)).toBeGreaterThan(0);
    fx.dispose();
  });

  it('keep the coven’s circle drawn for the whole ritual', () => {
    const { g, hex, fx } = coven();
    g.events.emit('miscTitan', { ship: hex, kind: 'coven', x: 0, z: 0, radius: HEX.coven.radius });
    run(g, HEX.coven.time - 0.5);
    expect(drawn(fx)).toBeGreaterThan(0);
    run(g, 1);
    expect(drawn(fx)).toBe(0);
    fx.dispose();
  });

  it('hang a doll over each bound enemy, carrying as many needles as it has pins', () => {
    const { hex, enemy, fx } = coven();
    pinDoll(hex, enemy, true);
    pinDoll(hex, enemy, true);
    drawn(fx);
    const g = doll(fx, hex, enemy);
    expect(g.visible).toBe(true);
    expect((g.userData.pins as Mesh[]).map((p) => p.visible)).toEqual([true, true, false]);
    enemy.mods.untargetable = true;
    drawn(fx, 0);
    expect(g.visible).toBe(false);
    fx.dispose();
  });

  it('jolt the doll when the Hexweaver hurts its ship, drive the newest pin in and wring it on a Twist', () => {
    const { g, hex, enemy, fx } = coven();
    if (fx.kit.reduce) return;
    pinDoll(hex, enemy, true);
    run(g, 2);
    drawn(fx, -1, 3);
    const node = doll(fx, hex, enemy);
    const pins = node.userData.pins as Mesh[];
    const rest = { y: node.position.y, spin: node.rotation.y };
    const d = dollOf(hex, enemy)!;
    d.struck = g.time;
    drawn(fx, -1, 3);
    expect(node.position.y).toBeGreaterThan(rest.y);
    d.struck = -1e9;
    d.twistedAt = g.time;
    drawn(fx, -1, 3);
    expect(Math.abs(node.rotation.y - rest.spin)).toBeGreaterThan(1);
    d.twistedAt = -1e9;
    pinDoll(hex, enemy, true);
    drawn(fx, -1, 3);
    expect(pins[1].visible).toBe(true);
    expect(pins[1].position.z).toBeGreaterThan((node.userData.rest as number[])[1] + 1);
    run(g, 0.5);
    drawn(fx, -1, 3);
    expect(pins[1].position.z).toBeCloseTo((node.userData.rest as number[])[1]);
    fx.dispose();
  });

  it('flash and shake when the dolls are unmade', () => {
    const { g, hex, enemy, fx } = coven();
    const flashes: number[] = [];
    const shakes: Ship[] = [];
    fx.onFlash = (_x, _z, amount) => flashes.push(amount);
    fx.onShake = (s) => shakes.push(s);
    g.events.emit('miscTitan', { ship: hex, kind: 'unmake', x: enemy.pos.x, z: enemy.pos.z, target: enemy, n: 3, radius: HEX.unmaking.blastRadius });
    expect(flashes).toEqual([0.5]);
    if (!fx.kit.reduce) expect(shakes).toEqual([hex]);
    fx.dispose();
  });
});
