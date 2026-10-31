import { describe, expect, it } from 'vitest';
import { cubeTargets } from '../src/core/Targeting';
import { PlayerController } from '../src/player/PlayerController';
import { AIController } from '../src/ai/AIController';
import { CUBE } from '../src/skills/misc/TungstenModes';
import type { Cube, CubeState } from '../src/skills/misc/TungstenRuntime';
import type { Input } from '../src/input/Input';
import { bearingTo, wrapAngle } from '../src/core/math';
import { emptyGame, place } from './helpers';
import { cubeLead } from '../src/player/FireControl';
import { SIM_DT } from '../src/config';
import type { Ship } from '../src/ships/Ship';

function park(c: Cube, x: number, z: number, state: CubeState = 'hover') {
  c.state = state;
  c.path = null;
  c.x = c.px = x;
  c.z = c.pz = z;
  c.y = c.py = CUBE.hoverY;
}

/** An input with nothing pressed. */
const idle = {
  aiming: false, mouseDx: 0, mouseDy: 0, wheel: 0,
  pressed: () => false, mousePressed: () => false, mouseDown: () => false,
  pad: () => ({ axes: [0, 0, 0, 0], buttons: [] }),
  padDown: () => false, padPressed: () => false, padReleased: () => false,
} as unknown as Input;

type Lockable = { toggleLock(track: boolean): void };
const toggle = (pc: PlayerController, track = false) => (pc as unknown as Lockable).toggleLock(track);

describe('cube targets', () => {
  it('lists only enemy cubes that shells can hit', () => {
    const g = emptyGame();
    place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'tungsten', 1, 0, -6000);
    const c = foe.tungsten!.cubes[0];
    expect(cubeTargets(g, 0)).toEqual([]);
    for (const state of ['flying', 'hover', 'guard', 'orbit', 'pin'] as const) {
      park(c, 0, -3000, state);
      expect(cubeTargets(g, 0)).toEqual([{ owner: foe, cube: c }]);
    }
    for (const state of ['docked', 'broken', 'collapse', 'meteor'] as const) {
      c.state = state;
      expect(cubeTargets(g, 0)).toEqual([]);
    }
    park(c, 0, -3000);
    expect(cubeTargets(g, 1)).toEqual([]);
    c.gone = true;
    expect(cubeTargets(g, 0)).toEqual([]);
    c.gone = false;
    foe.mods.banished = true;
    expect(cubeTargets(g, 0)).toEqual([]);
    foe.mods.banished = false;
    foe.alive = false;
    expect(cubeTargets(g, 0)).toEqual([]);
  });
});

describe('locking a cube', () => {
  function scene(device: 'mouse' | 'pad0' = 'mouse') {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'tungsten', 1, 3000, -6000);
    const c = foe.tungsten!.cubes[0];
    park(c, 0, -2000);
    const pc = new PlayerController(me, device, 0, g);
    pc.yaw = 0;
    return { g, me, foe, c, pc };
  }

  it('locks the cube nearest the crosshair, not its distant owner', () => {
    const { foe, c, pc } = scene();
    toggle(pc);
    expect(pc.cubeLock).toEqual({ owner: foe, cube: c });
    expect(pc.lock).toBe(null);
    // A cube lock is local: the network target stays empty.
    expect(pc.out.targetId).toBe(-1);
    toggle(pc);
    expect(pc.cubeLock).toBe(null);
  });

  it('locks the ship instead when the crosshair is on it', () => {
    const { me, foe, pc } = scene();
    pc.yaw = bearingTo(me.pos.x, me.pos.z, foe.pos.x, foe.pos.z);
    toggle(pc);
    expect(pc.lock).toBe(foe);
    expect(pc.cubeLock).toBe(null);
  });

  it('moves to the owner when the cube docks', () => {
    const { foe, c, pc } = scene();
    toggle(pc);
    c.state = 'docked';
    pc.control(1 / 60, idle);
    expect(pc.cubeLock).toBe(null);
    expect(pc.lock).toBe(foe);
    expect(pc.out.targetId).toBe(foe.id);
  });

  it('drops with a notice when the cube breaks and the owner cannot be tracked', () => {
    const { g, foe, c, pc } = scene();
    toggle(pc);
    g.smokes.push({ x: foe.pos.x, z: foe.pos.z, r: 600, life: 30, team: 1 });
    c.state = 'broken';
    pc.control(1 / 60, idle);
    expect(pc.cubeLock).toBe(null);
    expect(pc.lock).toBe(null);
    expect(pc.notice).toBe('Cube shattered');
  });

  it('turns the gamepad camera to follow the locked cube', () => {
    const { me, c, pc } = scene('pad0');
    toggle(pc, true);
    park(c, 2000, -2000);
    pc.control(1 / 60, idle);
    expect(wrapAngle(pc.yaw - bearingTo(me.pos.x, me.pos.z, 2000, -2000))).toBeCloseTo(0, 5);
    expect(me.control.aimY).toBe(c.y);
  });

  it('raises the aim to a locked cube only while the crosshair is on it', () => {
    const { me, c, pc } = scene();
    toggle(pc);
    // The mouse camera does not follow the lock: aiming at a hull beside the cube keeps shells at sea level.
    pc.aim.set(c.x + 600, 0, c.z);
    pc.control(1 / 60, idle);
    expect(me.control.aimY).toBeUndefined();
    pc.aim.set(c.x + 40, 0, c.z - 30);
    pc.control(1 / 60, idle);
    expect(me.control.aimY).toBe(c.y);
  });
});

describe('leading a cube', () => {
  it('leads a flying cube by its last step', () => {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const c = place(g, 'tungsten', 1, 0, -6000).tungsten!.cubes[0];
    park(c, 0, -3000, 'flying');
    c.px = -10;
    const lead = cubeLead(me, c, () => 2);
    expect(lead.x).toBeCloseTo((10 / SIM_DT) * 2, 6);
    expect(lead.z).toBeCloseTo(-3000, 6);
    c.px = c.x;
    expect(cubeLead(me, c, () => 2)).toEqual({ x: 0, z: -3000 });
  });
});

describe('AI and cubes', () => {
  function line(state: CubeState = 'hover', hp = 1) {
    const g = emptyGame();
    const me = place(g, 'iowa', 0, 0, 0);
    const reach = me.mainRange;
    const foe = place(g, 'tungsten', 1, 0, -reach * 0.8);
    const c = foe.tungsten!.cubes[0];
    park(c, 150, -reach * 0.4, state);
    c.hp = c.maxHp * hp;
    const ai = new AIController(me, g);
    return { g, me, foe, c, ai };
  }
  /** One decision, then a tick once the ship has taken any skill order (skills aim at the ship target). */
  const think = (ai: AIController) => {
    ai.update(1);
    ai.ship.control.skill = -1;
    ai.update(0.01);
  };

  it('shoots a hovering cube that stands in the line of fire', () => {
    const { me, c, ai } = line();
    think(ai);
    expect(ai.cube?.cube).toBe(c);
    expect(me.currentSlot?.kind).toBe('gun');
    expect(me.control.fire).toBe(true);
    expect(me.control.aimX).toBeCloseTo(c.x, 0);
    expect(me.control.aimZ).toBeCloseTo(c.z, 0);
  });

  it('ignores a guarding cube', () => {
    const { me, c, ai } = line('guard');
    think(ai);
    expect(ai.cube).toBe(null);
    expect(Math.hypot(me.control.aimX - c.x, me.control.aimZ - c.z)).toBeGreaterThan(500);
  });

  it('finishes a badly hurt cube off the line of fire', () => {
    const { me, c, ai } = line('hover', 0.2);
    park(c, 3000, -me.mainRange * 0.4);
    think(ai);
    expect(ai.cube?.cube).toBe(c);
    park(c, 3000, -me.mainRange * 0.4);
    c.hp = c.maxHp;
    think(ai);
    expect(ai.cube).toBe(null);
  });

  it('lets go once the cube leaves the water', () => {
    const { c, ai } = line();
    think(ai);
    expect(ai.cube?.cube).toBe(c);
    c.state = 'docked';
    ai.update(0.01);
    expect(ai.cube).toBe(null);
  });

  it('never has a Tungsten or a carrier chase cubes', () => {
    for (const id of ['tungsten', 'akagi']) {
      const g = emptyGame();
      const me: Ship = place(g, id, 0, 0, 0);
      const foe = place(g, 'tungsten', 1, 0, -8000);
      park(foe.tungsten!.cubes[0], 0, -4000);
      const ai = new AIController(me, g);
      think(ai);
      expect(ai.cube).toBe(null);
    }
  });
});
