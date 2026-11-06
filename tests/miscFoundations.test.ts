import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import type { Game } from '../src/core/Game';
import type { GameEventMap } from '../src/core/Events';
import type { Ship } from '../src/ships/Ship';
import { MiscTitanFx, MISC_FX_BURSTS } from '../src/render/MiscTitanFx';
import { miscPanelState } from '../src/ui/MiscTitanPresentation';
import { JUDGE } from '../src/skills/misc/JudgeRuntime';
import { HEX, pinDoll } from '../src/skills/misc/HexweaverRuntime';
import { emptyGame, place, run } from './helpers';

// The groundwork every misc titan builds on: a water-landing hook for shells, a battery rider that
// reports each hit and landing as a `miscTitan` event, bounded event effects and the HUD summary.

function target(g: Game, x: number, z: number): Ship {
  const t = place(g, 'iowa', 1, x, z, Math.PI / 2);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 0;
  return t;
}

/** One turret fires at `t`; runs until its rounds are spent. */
function volley(g: Game, s: Ship, x: number, z: number, index = 0): void {
  s.control.aimX = x;
  s.control.aimZ = z;
  for (let i = 0; i < 240 && !s.turrets[index].canBear; i++) run(g, 1 / 60);
  expect(s.fireTurret(index, 'AP', true)).toBe(true);
  for (let i = 0; i < 900 && g.shells.shells.some((p) => p.alive); i++) run(g, 1 / 60);
}

function misc(g: Game): GameEventMap['miscTitan'][] {
  const seen: GameEventMap['miscTitan'][] = [];
  g.events.on('miscTitan', (e) => seen.push(e));
  return seen;
}

describe('Shell water landings', () => {
  it('call onLand once, where the round meets the sea', () => {
    const g = emptyGame();
    const s = place(g, 'iowa', 0, 0, 0);
    const main = s.spec.main!;
    const landed: { x: number; z: number }[] = [];
    const splashes: { x: number; z: number }[] = [];
    g.events.on('splash', (e) => splashes.push({ x: e.x, z: e.z }));
    g.shells.fire(s, {
      ammo: 'HE',
      spec: main.he!,
      table: s.tableFor('HE')!,
      fromX: 0,
      fromY: 20,
      fromZ: 0,
      toX: 0,
      toZ: -6000,
      dmgMul: 1,
      guaranteedFire: false,
      railgun: false,
      onLand: (x, z) => landed.push({ x, z }),
    });
    run(g, 30);
    expect(landed).toHaveLength(1);
    expect(splashes).toHaveLength(1);
    expect(landed[0]).toEqual(splashes[0]);
    expect(landed[0].z).toBeLessThan(-4000);
  });
});

describe('Misc titan batteries', () => {
  it('report each hull hit as a gunHit event naming the target', () => {
    const g = emptyGame();
    const judge = place(g, 'judge', 0, 0, 0);
    const t = target(g, 0, -2000);
    const seen = misc(g);
    const hits: Ship[] = [];
    g.events.on('shellHit', (e) => {
      if (e.attacker === judge) hits.push(e.target);
    });
    volley(g, judge, t.pos.x, t.pos.z);
    expect(hits.length).toBeGreaterThan(0);
    const gun = seen.filter((e) => e.kind === 'gunHit');
    expect(gun).toHaveLength(hits.length);
    expect(gun.every((e) => e.ship === judge && e.target === t)).toBe(true);
  });

  it('report rounds that fall in the sea as gunLand events', () => {
    const g = emptyGame();
    const hex = place(g, 'hexweaver', 0, 0, 0);
    const seen = misc(g);
    volley(g, hex, 0, -4000);
    const land = seen.filter((e) => e.kind === 'gunLand');
    expect(land).toHaveLength(hex.turrets[0].spec.barrels);
    expect(land.every((e) => e.ship === hex && e.z < -3000)).toBe(true);
  });

  it('leave every other ship’s battery alone', () => {
    const g = emptyGame();
    const iowa = place(g, 'iowa', 0, 0, 0);
    const t = target(g, 0, -2000);
    const seen = misc(g);
    volley(g, iowa, t.pos.x, t.pos.z);
    expect(seen).toHaveLength(0);
  });
});

describe('Misc titan event effects', () => {
  it('keep a bounded burst list and leave the scene empty on dispose', () => {
    const g = emptyGame();
    const scene = new Scene();
    const judge = place(g, 'judge', 0, 0, 0);
    const fx = new MiscTitanFx(scene, g);
    for (let i = 0; i < MISC_FX_BURSTS * 3; i++) g.events.emit('miscTitan', { ship: judge, kind: 'gunHit', x: i, z: 0 });
    expect(fx.bursts).toBe(MISC_FX_BURSTS);
    fx.update(1, 1 / 60);
    fx.prepare(-1, 720);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('forget bursts once they have played out', () => {
    const g = emptyGame();
    const scene = new Scene();
    const hex = place(g, 'hexweaver', 0, 0, 0);
    const fx = new MiscTitanFx(scene, g);
    g.events.emit('miscTitan', { ship: hex, kind: 'gunLand', x: 0, z: 0 });
    expect(fx.bursts).toBe(1);
    run(g, 5);
    fx.update(5, 1 / 60);
    expect(fx.bursts).toBe(0);
    fx.dispose();
  });
});

describe('Misc titan panel state line', () => {
  it('names the Judge’s court, and Martial Law while it runs', () => {
    const g = emptyGame();
    const judge = place(g, 'judge', 0, 0, 500);
    expect(miscPanelState(judge)).toBe('NO COURT');
    judge.judge!.court = { x: 0, z: 0 };
    expect(miscPanelState(judge)).toBe(`COURT ${JUDGE.court.radius / 1000} km`);
    judge.judge!.martialUntil = g.time + 6.2;
    expect(miscPanelState(judge)).toBe(`MARTIAL LAW 7s · ${JUDGE.court.martialRadius / 1000} km`);
  });

  it('counts the Hexweaver’s dolls and stitches', () => {
    const g = emptyGame();
    const hex = place(g, 'hexweaver', 0, 0, 0);
    expect(miscPanelState(hex)).toBe(`DOLLS 0/${HEX.dolls}`);
    const a = place(g, 'iowa', 1, 2000, 0);
    const b = place(g, 'iowa', 1, 2000, 600);
    pinDoll(hex, a);
    pinDoll(hex, b);
    expect(miscPanelState(hex)).toBe(`DOLLS 2/${HEX.dolls}`);
    for (const d of hex.hexweaver!.dolls) d.stitchedUntil = g.time + 3;
    expect(miscPanelState(hex)).toBe(`DOLLS 2/${HEX.dolls} · 2 STITCHED`);
  });

  it('shows the Gourmand’s feast timers', () => {
    const g = emptyGame();
    const gm = place(g, 'gourmand', 0, 0, 0);
    expect(miscPanelState(gm)).toBe('');
    gm.gourmand!.banquetUntil = g.time + 8.4;
    gm.gourmand!.mouthUntil = g.time + 1.23;
    expect(miscPanelState(gm)).toBe('BANQUET 9s · MOUTH OPEN 1.2s');
  });

  it('shows the Faultline’s brace', () => {
    const g = emptyGame();
    const f = place(g, 'faultline', 0, 0, 0);
    expect(miscPanelState(f)).toBe('');
    f.faultline!.bedrockUntil = g.time + 3.46;
    expect(miscPanelState(f)).toBe('BEDROCK 3.5s · REBOUND READY');
  });

  it('is empty for every other ship', () => {
    const g = emptyGame();
    expect(miscPanelState(place(g, 'iowa', 0, 0, 900))).toBe('');
  });
});
