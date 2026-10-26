import { describe, expect, it } from 'vitest';
import { RESPAWN_DELAY } from '../src/config';
import { Game } from '../src/core/Game';
import { PlayerController } from '../src/player/PlayerController';
import { cameraOccluded } from '../src/render/Visibility';
import { activateConsumable } from '../src/ships/Consumables';
import { emptyGame, place, run } from './helpers';

describe('shared contact eligibility', () => {
  it('drops existing AI and homing locks as soon as smoke conceals the contact', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0, 0, true);
    const foe = place(g, 'iowa', 1, 0, -2000);
    run(g, 1);
    const ai = g.ai.get(me)!;
    expect(ai.target?.id).toBe(foe.id);
    const missile = g.missiles.launch(me, foe.pos.x, foe.pos.z, 0, 100, { target: foe });
    const torp = g.torps.launch(me, 0, 0, 0, me.spec.torpedoes!, foe);
    g.smokes.push({ x: foe.pos.x, z: foe.pos.z, r: 500, life: 50, team: 1 });
    g.step();
    expect(ai.target?.id).not.toBe(foe.id);
    expect(missile.target).toBe(null);
    expect(torp.homing).toBe(null);
  });
  it('suppresses smoke locks and restores them during search, then loses them on expiry', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const foe = place(g, 'gato', 1, 0, -600);
    g.smokes.push({ x: 0, z: -600, r: 300, life: 60, team: 1 });
    run(g, 0.1);
    expect(me.lockAt(0, -600, 700)).toBe(null);
    const search = me.consumables.findIndex(c => c.spec.type === 'search');
    expect(activateConsumable(me, search)).toBe(true);
    foe.depthState = 2;
    me.consumables[search].active = 30;
    run(g, 12);
    expect(foe.deep).toBe(true);
    expect(me.lockAt(0, -600, 700)).toBe(foe);
    me.consumables[search].active = 0;
    run(g, 1);
    expect(me.lockAt(0, -600, 700)).toBe(null);
  });

  it.each(['mouse', 'pad0'] as const)('%s locks only detected submarine contacts', device => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const foe = place(g, 'gato', 1, 0, -800);
    const pc = new PlayerController(me, device, 0, g);
    const pick = () => (pc as unknown as { pickTarget(): unknown }).pickTarget();
    expect(pick()).toBe(foe);
    foe.depthState = 1;
    run(g, 10);
    expect(pick()).toBe(null);
    foe.mods.revealed = true;
    expect(pick()).toBe(foe);
    foe.depthState = 2;
    foe.pos.y = -80;
    expect(pick()).toBe(foe);
  });
});

describe('weapon and marker feedback', () => {
  it('matches torpedo firing eligibility without restricting out-of-range aiming', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    me.control.aimZ = -20000;
    const l = me.launchers[0];
    expect(me.torpedoReadiness(l)).toBe('ready');
    expect(me.launchSpread(me.spec.torpedoes!)).toBeGreaterThan(0);
    expect(me.torpedoReadiness(l)).toBe('reloading');
    l.reload = 0;
    me.control.aimX = 1000;
    me.control.aimZ = 0;
    expect(me.torpedoReadiness(l)).toBe('outside arc');
    me.depthState = 2;
    expect(me.torpedoReadiness(l)).toBe('too deep');
    me.mods.disarmed = true;
    expect(me.torpedoReadiness(l)).toBe('disarmed');
    me.mods.stunned = true;
    expect(me.torpedoReadiness(l)).toBe('stunned');
  });

  it('occludes markers behind solid obstacles independently of sonar', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const foe = place(g, 'gato', 1, 0, -500);
    foe.mods.revealed = true;
    g.addWall(foe, -100, -250, 100, -250, 20, 0xffffff);
    expect(me.lockAt(0, -500, 700)).toBe(foe);
    expect(cameraOccluded(g, { x: 0, y: 30, z: 0 }, { x: 0, y: 10, z: -500 }, 0)).toBe(true);
    g.walls[0].team = 0;
    expect(cameraOccluded(g, { x: 0, y: 30, z: 0 }, { x: 0, y: 10, z: -500 }, 0)).toBe(true);
    expect(cameraOccluded(g, { x: 0, y: 400, z: 0 }, { x: 0, y: 400, z: -500 }, 0)).toBe(false);
  });
});

describe('free play during Titan Shift', () => {
  it('keeps the base ship when selected during its form, replacing a queued Queen Elizabeth', () => {
    const g = new Game({ mode: 'solo', type: 'freeplay', mapId: 'open', teamSize: 1, ai: [0, 0], difficulty: 'normal', seed: 8, era: 'mixed', players: [{ shipId: 'luffy', device: 'mouse' }] });
    const me = g.humans()[0];
    expect(g.shiftShip(me)).toBe(true);
    run(g, 0.1);
    g.pickShip(me, 'queenElizabeth');
    g.pickShip(me, 'luffy');
    expect(me.nextSpec).toBe(null);
    g.pickShip(me, 'queenElizabeth');
    g.redeploy(me);
    run(g, RESPAWN_DELAY + 0.1);
    expect(g.humans()[0].spec.id).toBe('queenElizabeth');
  });
});

describe('Maw activation', () => {
  it('preserves charge before readiness, accepts the inclusive boundary, and respects invulnerability', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 3000, 0);
    me.control.targetId = foe.id;
    const i = me.skills.findIndex(k => k.spec.id === 'abyssalMaw');
    me.skills[i].meter = 0.5;
    expect(me.activateSkill(i)).toBe(false);
    expect(me.skills[i].meter).toBe(0.5);
    me.skills[i].meter = 1;
    foe.mods.invulnerable = true;
    const hp = foe.hp;
    expect(me.activateSkill(i)).toBe(true);
    expect(foe.hp).toBe(hp);
    expect(me.skills[i].meter).toBe(0);
  });

  it('retains the line-ship execution and titan 15% damage rules', () => {
    for (const id of ['iowa', 'leviathan']) {
      const g = emptyGame();
      const me = place(g, 'hadal', 0, 0, 0);
      const foe = place(g, id, 1, 1000, 0);
      const i = me.skills.findIndex(k => k.spec.id === 'abyssalMaw');
      me.skills[i].meter = 1;
      me.control.targetId = foe.id;
      expect(me.activateSkill(i)).toBe(true);
      if (id === 'iowa') expect(foe.alive).toBe(false);
      else expect(foe.hp).toBeCloseTo(foe.maxHp * 0.85);
    }
  });

  it('rejects a target beyond the configured radius without spending charge and explains failure', () => {
    const g = emptyGame();
    const me = place(g, 'hadal', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 3100, 0);
    me.control.aimX = foe.pos.x;
    const i = me.skills.findIndex(k => k.spec.id === 'abyssalMaw');
    me.skills[i].meter = 1;
    expect(me.activateSkill(i)).toBe(false);
    expect(me.skills[i].meter).toBe(1);
    expect(me.skillFailure).toMatch(/range|3.*km/i);
  });
});
