import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { ShellCam } from '../src/player/ShellCam';

function fireAt(g: Game, me: Ship, x: number, z: number) {
  const main = me.spec.main!;
  return g.shells.fire(me, {
    ammo: 'AP',
    spec: main.ap!,
    table: me.tableFor('AP')!,
    fromX: me.pos.x,
    fromY: 20,
    fromZ: me.pos.z,
    toX: x,
    toZ: z,
    dmgMul: 1,
    guaranteedFire: false,
    railgun: false,
  });
}

describe('shell impact prediction', () => {
  it('predicts where and how a shell will hit a broadside target', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const tgt = place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
    const shell = fireAt(g, me, 0, -4000);
    const p = g.shells.predictImpact(shell, shell.flight + 1);
    expect(p).not.toBeNull();
    expect(p!.ship).toBe(tgt);
    let real: { outcome: string; damage: number; x: number; z: number } | null = null;
    g.events.on('shellHit', (e) => {
      real ??= e;
    });
    run(g, shell.flight + 1);
    expect(real).not.toBeNull();
    expect(real!.outcome).toBe(p!.outcome);
    expect(Math.abs(real!.damage - p!.damage)).toBeLessThan(1);
    expect(Math.hypot(real!.x - p!.x, real!.z - p!.z)).toBeLessThan(2);
  });

  it('predicts a miss when the shell lands short', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
    const shell = fireAt(g, me, 0, -3300);
    expect(g.shells.predictImpact(shell, shell.flight + 1)).toBeNull();
  });

  it('leads a moving target', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const tgt = place(g, 'iowa', 1, -400, -4000, Math.PI / 2);
    tgt.speed = 15;
    const probe = fireAt(g, me, 0, -4000);
    probe.alive = false;
    // Aim where the target will be when the shell arrives: the prediction must still find it.
    const shell = fireAt(g, me, -400 + 15 * probe.flight, -4000);
    const p = g.shells.predictImpact(shell, shell.flight + 1);
    expect(p?.ship).toBe(tgt);
  });
});

describe('follow shot', () => {
  it('only rides a shell when asked, and the same key hands the view back', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
    const cam = new ShellCam(g, me);
    expect(cam.toggle()).toBe(false);
    const shell = fireAt(g, me, 0, -4000);
    // Never by itself, however good the shot.
    for (let i = 0; i < 60; i++) {
      g.step(1 / 60);
      cam.update(1 / 60, true);
    }
    expect(cam.active).toBe(false);
    expect(cam.toggle()).toBe(true);
    expect(cam.shell).toBe(shell);
    expect(cam.impact?.outcome).toBe('citadel');
    expect(cam.toggle()).toBe(true);
    expect(cam.active).toBe(false);
  });

  it('picks the shell of the newest salvo that lands best, and lets go after the impact', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const tgt = place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
    fireAt(g, me, 0, -3000);
    const hit = fireAt(g, me, 0, -4000);
    fireAt(g, me, 0, -3300);
    const cam = new ShellCam(g, me);
    expect(cam.toggle()).toBe(true);
    expect(cam.shell).toBe(hit);
    expect(cam.impact?.ship).toBe(tgt);
    for (let t = 0; t < hit.flight + 2; t += 1 / 60) {
      g.step(1 / 60);
      cam.update(1 / 60, true);
    }
    expect(cam.active).toBe(false);
    expect(cam.landed).toBe(true);
  });
});

describe('detonation', () => {
  it('a citadel hit that sinks a ship sets off its magazines', () => {
    const g = emptyGame();
    const me = place(g, 'yamato', 0, 0, 0);
    const tgt = place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
    const shell = fireAt(g, me, 0, -4000);
    expect(g.shells.predictImpact(shell, shell.flight + 1)?.outcome).toBe('citadel');
    let heard = 0;
    g.events.on('detonation', (e) => {
      if (e.ship === tgt && e.killer === me) heard++;
    });
    // Out of combat the hull would repair itself during the flight; cut it down just before impact.
    run(g, shell.flight - 0.2);
    tgt.hp = 1;
    run(g, 1.2);
    expect(tgt.alive).toBe(false);
    expect(tgt.detonated).toBe(true);
    expect(heard).toBe(1);
  });

  it('other kills leave the hull whole, and a respawn clears the flag', () => {
    const g = emptyGame('open', 7, 'domination');
    const me = place(g, 'yamato', 0, 0, 0);
    const tgt = place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
    tgt.hp = 1;
    tgt.takeDamage(10, me);
    expect(tgt.alive).toBe(false);
    expect(tgt.detonated).toBe(false);
    tgt.detonate(me);
    expect(tgt.detonated).toBe(true);
    tgt.respawn(0, 3000, 0);
    expect(tgt.detonated).toBe(false);
  });
});
