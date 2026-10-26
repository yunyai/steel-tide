import { describe, expect, it } from 'vitest';
import { SHIP_BY_ID, SHIPS } from '../src/data/ships';
import { eraOf } from '../src/data/factions';
import { emptyGame, place, run } from './helpers';
import { safeStep, snapStep } from '../src/skills/misc/StepperRuntime';
import { Game } from '../src/core/Game';
import { navalRules } from '../server/rules';
import { TurnApplier } from '../src/net/navalTurns';
import { PlayerController } from '../src/player/PlayerController';
import { stateHash } from '../src/net/hash';

function duel() {
  const g = emptyGame();
  const me = place(g, 'stepper', 0, 0, 0);
  const foe = place(g, 'leviathan', 1, 0, -1500);
  me.throttle = foe.throttle = 2;
  me.speed = foe.speed = 0;
  foe.colossus = false;
  me.control.aimX = foe.pos.x;
  me.control.aimZ = foe.pos.z;
  return { g, me, foe };
}
describe('Stepper roster', () => {
  it('offers a Misc titan with six steps and three ultimates', () => {
    const s = SHIP_BY_ID.stepper;
    expect(s).toBeDefined();
    expect(SHIPS).toContain(s);
    expect(eraOf(s)).toBe('misc');
    expect(s.hp).toBe(1100000);
    expect(s.skills).toHaveLength(9);
    expect(s.skills.filter((k) => k.ult)).toHaveLength(3);
    expect(s.skills.every((k) => k.name.toLowerCase().endsWith('step'))).toBe(true);
  });
});
describe('Stepper skills', () => {
  it('snaps Flash-step to the reticle and clamps range', () => {
    const { g, me } = duel();
    me.control.aimX = 10000;
    me.control.aimZ = 0;
    expect(me.activateSkill(0)).toBe(true);
    expect(me.pos.x).toBeCloseTo(3500);
    expect(me.renderPos.equals(me.pos)).toBe(true);
    expect(me.prevPos.equals(me.pos)).toBe(true);
    expect(me.skills[0].cooldown).toBe(5);
    expect(g.time).toBe(0);
  });
  it('fails on blocked water without spending its cooldown', () => {
    const { g, me } = duel();
    g.map.heightAt = () => 10;
    expect(me.activateSkill(0)).toBe(false);
    expect(me.skills[0].cooldown).toBe(0);
    expect(me.skillFailure).toMatch(/water|blocked/i);
  });
  it('sweeps through its Ram-step target exactly once and floods it', () => {
    const { g, me, foe } = duel();
    expect(me.activateSkill(1)).toBe(true);
    run(g, 0.4);
    expect(foe.stats.received).toBeGreaterThanOrEqual(120000);
    expect(foe.stats.received).toBeLessThan(130000);
    expect(foe.flooding).toBeGreaterThan(0);
    expect(me.pos.z).toBeLessThan(foe.pos.z - 200);
  });
  it('sets a broadside and starts its rapid gun stance', () => {
    const { me, foe } = duel();
    expect(me.activateSkill(2)).toBe(true);
    expect(Math.hypot(me.pos.x - foe.pos.x, me.pos.z - foe.pos.z)).toBeCloseTo(700);
    expect(me.skills[2].active).toBe(true);
    expect(me.mods.reloadMul).toBeCloseTo(0.25);
    run(me.game, 0.1);
    expect(me.game.shells.shells.some((s) => s.owner === me && s.dmgMul >= 2)).toBe(true);
  });
  it('fires eight fast torpedoes backwards after Overstep', () => {
    const { g, me, foe } = duel();
    expect(me.activateSkill(3)).toBe(true);
    expect(g.torps.torps).toHaveLength(8);
    expect(me.pos.z).toBeLessThan(foe.pos.z);
    expect(g.torps.torps.every((t) => Math.cos(t.heading - me.heading) < -0.9)).toBe(true);
  });
  it('retreats 2 km, heals and becomes immediately invulnerable', () => {
    const { me, foe } = duel();
    me.hp = me.maxHp / 2;
    expect(me.activateSkill(4)).toBe(true);
    expect(me.pos.z).toBeCloseTo(2000);
    expect(me.hp).toBeCloseTo(me.maxHp * 0.7);
    expect(me.takeDamage(10000, foe)).toBe(0);
  });
  it('dodges direct damage but cannot dodge periodic or piercing damage', () => {
    const { g, me, foe } = duel();
    expect(me.activateSkill(5)).toBe(true);
    const before = me.pos.clone();
    expect(me.takeDamage(10000, foe)).toBe(0);
    expect(me.pos.distanceTo(before)).toBeCloseTo(100);
    run(g, 0.1);
    expect(me.takeDamage(10000, foe)).toBeGreaterThan(0);
    run(g, 0.05);
    expect(me.takeDamage(10000, foe)).toBe(0);
    run(g, 0.2);
    me.startFlood(foe);
    const p = me.pos.clone();
    run(g, 0.1);
    expect(me.pos.distanceTo(p)).toBeCloseTo(0);
    expect(me.takeDamage(10000, foe, null, false, true)).toBeGreaterThan(0);
  });
  it('makes twenty Flicker strikes over three seconds, including repeat targets', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    let hits = 0;
    g.events.on('skillHit', (e) => {
      if (e.skill.id === 'flickerStep') hits++;
    });
    expect(me.activateSkill(6)).toBe(true);
    run(g, 1.5);
    expect(hits).toBe(10);
    expect(me.takeDamage(1000, foe)).toBe(0);
    expect(me.activateSkill(0)).toBe(false);
    run(g, 1.55);
    expect(hits).toBe(20);
    expect(foe.stats.received).toBeCloseTo(600000);
    expect(me.skills[6].active).toBe(false);
  });
  it('carves a fixed area without hurting allies', () => {
    const { g, me, foe } = duel();
    const ally = place(g, 'iowa', 0, 800, -1500);
    me.control.aimX = 600;
    me.meter = 1;
    expect(me.activateSkill(7)).toBe(true);
    run(g, 3);
    expect(foe.stats.received).toBeCloseTo(510000);
    expect(ally.stats.received).toBe(0);
  });
});
describe('Stepper mirrored ships', () => {
  it('creates four fragile copies and mirrors offensive ultimates without recursion', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    expect(me.activateSkill(8)).toBe(true);
    const copies = g.ships.filter((s) => s.summonOwner === me);
    expect(copies).toHaveLength(4);
    expect(copies.every((s) => s.maxHp === me.maxHp * 0.25 && !g.ai.has(s))).toBe(true);
    expect(copies[0].takeDamage(1000, copies[1])).toBe(750);
    // Aim all mirrored slash storms at the same durable target.
    me.control.aimX = 600;
    me.control.aimZ = -1500;
    expect(me.activateSkill(7)).toBe(true);
    run(g, 3);
    expect(foe.stats.received).toBeGreaterThan(510000);
    expect(g.ships.filter((s) => s.summonOwner === me)).toHaveLength(4);
    expect(copies[0].activateSkill(8)).toBe(false);
    me.withdraw();
    run(g, 0.1);
    expect(copies.every((s) => !s.alive)).toBe(true);
  });
  it('replays a multi-ultimate sequence deterministically', () => {
    const play = () => {
      const { g, me } = duel();
      me.meter = 1;
      me.activateSkill(8);
      me.activateSkill(6);
      run(g, 3.1);
      return stateHash(g);
    };
    expect(play()).toBe(play());
  });
});

describe('Stepper safety and defenses', () => {
  it('checks both hull ends, the beam, solid walls, ships and map boundary', () => {
    const { g, me, foe } = duel();
    expect(safeStep(me, 1000, 0)).toBe(true);
    expect(safeStep(me, 4300, 0, Math.PI / 2)).toBe(false);
    expect(safeStep(me, foe.pos.x, foe.pos.z)).toBe(false);
    const original = g.map.heightAt.bind(g.map);
    g.map.heightAt = (x, z) => (x > 1020 && z < -150 ? 10 : original(x, z));
    expect(safeStep(me, 1000, 0)).toBe(false);
    g.map.heightAt = original;
    g.addWall(foe, 900, -100, 1100, -100, 20, 0xffffff);
    expect(safeStep(me, 1000, 0)).toBe(false);
  });
  it.each([1, 2, 3])('rejects concealed reticle targets without spending step %i', (i) => {
    const { g, me, foe } = duel();
    g.smokes.push({ x: foe.pos.x, z: foe.pos.z, r: 400, life: 30, team: 1 });
    expect(me.activateSkill(i)).toBe(false);
    expect(me.skills[i].cooldown).toBe(0);
    foe.mods.revealed = true;
    expect(me.activateSkill(i)).toBe(true);
  });
  it.each([1, 2, 3])('rejects a target just beyond step %i range', (i) => {
    const { me, foe } = duel();
    const r = i === 1 ? 2500 : 3000;
    foe.pos.z = -r - 1;
    me.control.aimZ = foe.pos.z;
    expect(me.activateSkill(i)).toBe(false);
    expect(me.skills[i].cooldown).toBe(0);
  });
  it('keeps ultimate charge when no targets or safe landings exist', () => {
    const { g, me } = duel();
    me.meter = 1;
    g.map.heightAt = () => 20;
    for (const i of [6, 7, 8]) {
      expect(me.activateSkill(i)).toBe(false);
      expect(me.skills[i].meter).toBe(1);
    }
  });
  it('respects shields, invulnerability and reflected skill damage', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    me.control.aimX = 600;
    foe.shield = 300000;
    foe.shieldTime = 20;
    foe.addEffect({ id:'test-mirror', time:3.1, apply(m) { m.spellMirror = true; } });
    foe.mods.spellMirror = true;
    expect(me.activateSkill(7)).toBe(true);
    expect(foe.hp).toBe(foe.maxHp);
    run(g, 3);
    expect(me.hp).toBe(me.maxHp);
    me.control.aimX = 800;
    me.skills[7].meter = 1;
    foe.mods.spellMirror = false;
    foe.mods.invulnerable = true;
    foe.addEffect({ id:'test-invulnerable', time:4, apply(m) { m.invulnerable = true; } });
    expect(me.activateSkill(7)).toBe(true);
    run(g, 3);
    expect(foe.hp).toBe(foe.maxHp);
  });
  it('does not step when no safe dodge landing exists', () => {
    const { g, me, foe } = duel();
    me.colossus = false;
    me.activateSkill(5);
    g.map.heightAt = () => 10;
    expect(me.takeDamage(10000, foe)).toBe(10000);
    expect(me.pos.x).toBe(0);
  });
  it('keeps the Flicker camera steady across distant jumps', () => {
    const { g, me } = duel();
    const pc = new PlayerController(me, 'mouse', 0, g);
    pc.updateCamera(1 / 60);
    me.meter = 1;
    me.activateSkill(6);
    run(g, 0.2);
    g.interpolate();
    pc.updateCamera(1 / 60);
    const a = pc.camera.position.clone();
    run(g, 0.2);
    g.interpolate();
    pc.updateCamera(1 / 60);
    expect(pc.camera.position.distanceTo(a)).toBeLessThan(20);
  });
});
describe('Stepper copy lifecycle', () => {
  it('applies 75% exactly once to skills and periodic damage', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    me.activateSkill(8);
    const c = g.ships.find((s) => s.summonOwner === me)!;
    expect(foe.takeDamage(10000, c)).toBe(7500);
    foe.startFlood(c);
    const before = foe.stats.received;
    run(g, 0.1);
    expect(foe.stats.received - before).toBeCloseTo(foe.maxHp * 0.006 * 0.1 * 0.75);
  });
  it('mirrors twenty Flicker strikes per surviving ship', () => {
    const { g, me, foe } = duel();
    foe.hp = foe.maxHp = 10000000;
    me.meter = 1;
    me.activateSkill(8);
    const hits = new Map<number, number>();
    g.events.on('skillHit', (e) => {
      if (e.skill.id === 'flickerStep') hits.set(e.attacker.id, (hits.get(e.attacker.id) ?? 0) + 1);
    });
    expect(me.activateSkill(6)).toBe(true);
    run(g, 3.1);
    expect(hits.size).toBe(5);
    expect([...hits.values()]).toEqual([20, 20, 20, 20, 20]);
    expect(foe.stats.received).toBeCloseTo(2400000);
  });
  it('mirrors Flash-step into four separate safe formation slots', () => {
    const { g, me } = duel();
    me.meter = 1;
    me.activateSkill(8);
    me.control.aimX = 2000;
    me.control.aimZ = 0;
    expect(me.activateSkill(0)).toBe(true);
    const c = g.ships.filter((s) => s.summonOwner === me);
    expect(c.every((s) => Math.abs(s.pos.distanceTo(me.pos) - 500) < 1)).toBe(true);
    expect(new Set(c.map((s) => `${s.pos.x},${s.pos.z}`)).size).toBe(4);
  });
  it('does not award rewards for destroying copies', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    me.activateSkill(8);
    const c = g.ships.find((s) => s.summonOwner === me)!;
    const hp = foe.hp,
      kills = foe.stats.kills,
      meter = foe.meter;
    c.sink(foe);
    expect(foe.stats.kills).toBe(kills);
    expect(foe.hp).toBe(hp);
    expect(foe.meter).toBe(meter);
    expect(g.respawns.some((r) => r.ship === c)).toBe(false);
  });
  it.each(['expiry', 'end', 'death'] as const)('removes every copy on %s', (reason) => {
    const { g, me, foe } = duel();
    me.meter = 1;
    me.activateSkill(8);
    const copies = g.ships.filter((s) => s.summonOwner === me);
    if (reason === 'expiry') run(g, 18.1);
    else if (reason === 'end') g.finish(0, 'test');
    else me.sink(foe);
    expect(copies.every((s) => !s.alive)).toBe(true);
  });
  it('hashes pending Flicker and dodge state before positions differ', () => {
    const { g, me } = duel();
    const a = stateHash(g);
    me.stepper!.dodgeReady = 3;
    expect(stateHash(g)).not.toBe(a);
  });
});

describe('Stepper complete-hit evasion', () => {
  it('does not run a torpedo on-hit payload after a successful sidestep', () => {
    const { g, me, foe } = duel();
    me.activateSkill(5);
    const t = g.torps.launch(foe, me.pos.x, me.pos.z, 0, me.spec.torpedoes!);
    let payloads = 0;
    t.onHit = () => payloads++;
    g.torps.detonate(t, me);
    expect(payloads).toBe(0);
    expect(me.flooding).toBe(0);
  });
  it('phases through ongoing flooding during Flicker-step', () => {
    const { g, me, foe } = duel();
    me.startFlood(foe);
    me.meter = 1;
    me.activateSkill(6);
    const hp = me.hp;
    run(g, 0.5);
    expect(me.hp).toBe(hp);
  });
});

describe('Stepper mirroring commands and cancellation', () => {
  it.each([1, 2, 3])('mirrors offensive regular step %i on all four copies', (index) => {
    const { g, me } = duel();
    me.meter = 1;
    me.activateSkill(8);
    const cast: number[] = [];
    g.events.on('skill', (e) => {
      if (e.index === index) cast.push(e.ship.id);
    });
    expect(me.activateSkill(index)).toBe(true);
    expect(cast).toHaveLength(5);
  });
  it('keeps other invulnerability effects after Flicker ends', () => {
    const { g, me, foe } = duel();
    me.addEffect({
      id: 'test-barrier',
      time: 10,
      apply: (m) => {
        m.invulnerable = true;
      },
    });
    me.meter = 1;
    me.activateSkill(6);
    run(g, 3.01);
    expect(me.takeDamage(1000, foe)).toBe(0);
  });
  it('cleans copies during free-play redeploy and respawn', () => {
    const { g, me } = duel();
    g.config.type = 'freeplay';
    me.meter = 1;
    me.activateSkill(8);
    const copies = g.ships.filter((c) => c.summonOwner === me);
    g.redeploy(me);
    run(g, 8.2);
    expect(copies.every((c) => !c.alive)).toBe(true);
    expect(me.stepper!.copies).toHaveLength(0);
  });
  it('stops the active Broadstep auto-fire when its target conceals itself', () => {
    const { g, me, foe } = duel();
    me.activateSkill(2);
    run(g, 0.05);
    expect(me.stepper!.broadTarget).toBe(foe.id);
    g.smokes.push({ x: foe.pos.x, z: foe.pos.z, r: 400, life: 30, team: 1 });
    run(g, 0.05);
    expect(me.stepper!.broadTarget).toBe(0);
    expect(me.stepper!.broadUntil).toBeGreaterThan(g.time);
  });
});

describe('Stepper integration boundaries', () => {
  it('fires Broadstep main guns even while torpedoes are selected', () => {
    const { g, me } = duel();
    me.slot = 2;
    expect(me.activateSkill(2)).toBe(true);
    run(g, 0.1);
    expect(g.shells.shells.filter((p) => p.owner === me).length).toBeGreaterThan(0);
  });
  it('preserves Flicker charge when only side/front water is safe', () => {
    const { g, me } = duel();
    me.meter = 1;
    g.map.heightAt = (_x, z) => (z > -1200 ? 10 : -100);
    expect(me.activateSkill(6)).toBe(false);
    expect(me.skills[6].meter).toBe(1);
  });
  it.each([1, 2, 3])('accepts the exact target boundary for step %i', (index) => {
    const { me, foe } = duel();
    foe.pos.z = -(index === 1 ? 2500 : 3000);
    me.control.aimZ = foe.pos.z;
    expect(me.activateSkill(index)).toBe(true);
  });
  it.each([1, 2, 3, 6])('cannot acquire a revealed deep submarine for step %i', (index) => {
    const { g, me, foe } = duel();
    foe.withdraw();
    const sub = place(g, 'gato', 1, 0, -1500);
    sub.depthState = 2;
    sub.pos.y = -80;
    sub.mods.revealed = true;
    me.meter = 1;
    expect(me.activateSkill(index)).toBe(false);
  });
  it('resolves duplicate Stepper LAN picks and replays simultaneous ultimates', () => {
    const st = navalRules.defaults();
    navalRules.applySettings(st, { era: 'mixed', titans: true, ai: [0, 0], type: 'freeplay' });
    expect(navalRules.pickAllowed('stepper', st)).toBe(true);
    const c = navalRules.config(
      st,
      [
        { pick: 'stepper', team: 0, name: 'A' },
        { pick: 'stepper', team: 1, name: 'B' },
      ],
      118,
    );
    const games = [new Game(c), new Game(structuredClone(c))];
    for (const g of games) {
      g.ai.clear();
      for (const s of g.humans()) {
        s.pos.set(0, 0, s.team ? -1500 : 0);
        s.speed = 0;
        s.throttle = 2;
        s.hp = s.maxHp = 10000000;
        s.meter = 1;
      }
    }
    const sims = games.map((g) => new TurnApplier(g));
    for (let k = 0; k < 180; k++) {
      const skill = k === 0 ? 8 : k === 1 ? 6 : k === 120 ? 7 : undefined;
      const turn = {
        k,
        p: [
          [0, [0, 0, -1500, 0, -1]],
          [1, [0, 0, 0, 0, -1]],
        ] as [number, [number, number, number, number, number]][],
        e:
          skill === undefined
            ? undefined
            : ([
                [0, 0, { sk: skill }],
                [1, 0, { sk: skill }],
              ] as [number, number, { sk: number }][]),
      };
      for (let tick = 0; tick < 2; tick++) for (const sim of sims) sim.applyTick(turn, tick);
      expect(sims[0].hash()).toBe(sims[1].hash());
    }
    navalRules.applySettings(st, { titans: false });
    expect(navalRules.pickAllowed('stepper', st)).toBe(false);
  });
});

describe('Stepper final review regressions', () => {
  it.each([1, 2])('inherits and keeps the selected weapon slot %i', (slot) => {
    const { g, me } = duel();
    me.control.slot = slot;
    run(g, 1 / 60);
    me.meter = 1;
    expect(me.control.slot).toBe(null);
    expect(me.activateSkill(8)).toBe(true);
    const copies = g.ships.filter((s) => s.summonOwner === me);
    expect(copies.every((c) => c.slot === slot)).toBe(true);
    run(g, 1 / 60);
    expect(copies.every((c) => c.slot === slot)).toBe(true);
    me.control.slot = 0;
    run(g, 1 / 60);
    expect(copies.every((c) => c.slot === 0)).toBe(true);
  });
  it.each(['spread', 'echo'] as const)('scales damage only once across %s links', (mode) => {
    const { g, me, foe } = duel();
    const partner = place(g, 'iowa', 1, 1200, -1500);
    me.meter = 1;
    me.activateSkill(8);
    const copy = g.ships.find((s) => s.summonOwner === me)!;
    foe.link = { group: [foe, partner], mode, share: 0.5, until: 100, skill: me.skills[7].spec };
    const damage = foe.takeDamage(10000, copy);
    expect(damage).toBe(mode === 'spread' ? 3750 : 7500);
    expect(partner.stats.received).toBe(3750);
  });
  it('scales linked flooding only once', () => {
    const { g, me, foe } = duel();
    const partner = place(g, 'iowa', 1, 1200, -1500);
    me.meter = 1;
    me.activateSkill(8);
    const copy = g.ships.find((s) => s.summonOwner === me)!;
    foe.link = { group: [foe, partner], mode: 'spread', share: 0, until: 100, skill: me.skills[7].spec };
    foe.startFlood(copy);
    run(g, 0.1);
    expect(partner.stats.received).toBeCloseTo((foe.maxHp * 0.006 * 0.1 * 0.75) / 2);
  });
  it('records departure orientation before a turning teleport', () => {
    const { g, me } = duel();
    let heading: number | undefined;
    g.events.on('blink', (e) => {
      heading = e.fromHeading;
    });
    snapStep(me, { x: 1000, z: 0, heading: Math.PI / 2 });
    expect(heading).toBe(0);
    expect(me.heading).toBe(Math.PI / 2);
  });
});

describe('Sidestep rapid visible evasion', () => {
  it('has a short phase window and rapidly rearms visible jumps', () => {
    const { g, me, foe } = duel();
    me.activateSkill(5);
    const start = me.pos.clone();
    expect(me.takeDamage(10000, foe)).toBe(0);
    expect(me.pos.distanceTo(start)).toBeCloseTo(100);
    expect(me.stepper!.phaseUntil - g.time).toBeCloseTo(0.08);
    expect(me.stepper!.dodgeReady - g.time).toBeCloseTo(0.12);
    g.time = 0.06;
    const a = me.pos.clone();
    expect(me.takeDamage(10000, foe)).toBe(0);
    expect(me.pos.equals(a)).toBe(true);
    g.time = 0.1;
    expect(me.takeDamage(10000, foe)).toBeGreaterThan(0);
    g.time = 0.12;
    expect(me.takeDamage(10000, foe)).toBe(0);
    expect(me.pos.distanceTo(a)).toBeCloseTo(100);
  });
  it('steps before a falling shell reaches the deck and marks the visible dodge', () => {
    const { g, me, foe } = duel();
    me.activateSkill(5);
    let visible = false;
    g.events.on('blink', (e) => {
      if (e.ship === me && e.dodge) visible = true;
    });
    const shell = g.shells.dropBomb(foe, foe.spec.main!.he!, 0, 0, 25);
    g.step();
    expect(shell.alive).toBe(true);
    expect(me.pos.length()).toBeCloseTo(100);
    expect(me.stats.received).toBe(0);
    expect(visible).toBe(true);
  });
  it.each(['torpedo', 'missile'] as const)('reacts before an approaching %s reaches its hull', (kind) => {
    const { g, me, foe } = duel();
    me.activateSkill(5);
    if (kind === 'torpedo') {
      const t = g.torps.launch(foe, 0, -200, Math.PI, me.spec.torpedoes!);
      t.travelled = 200;
      t.speed = 300;
    } else {
      const m = g.missiles.launch(foe, 0, 0, 0, 10000, { profile: 'skim', target: me });
      m.x = 0;
      m.z = -220;
      m.y = 12;
      m.heading = Math.PI;
      m.speed = 500;
      m.state = 'cruise';
    }
    g.step();
    expect(me.pos.length()).toBeCloseTo(100);
    expect(me.stats.received).toBe(0);
  });
  it('does not react to friendly, distant or high-flying fire', () => {
    const { g, me, foe } = duel();
    me.activateSkill(5);
    g.shells.dropBomb(me, me.spec.main!.he!, 0, 0, 25);
    g.shells.dropBomb(foe, foe.spec.main!.he!, 0, 0, 1000);
    g.shells.dropBomb(foe, foe.spec.main!.he!, 700, 0, 25);
    g.step();
    expect(me.pos.length()).toBe(0);
  });
  it('searches the opposite dodge direction when the first landing is blocked', () => {
    const { g, me, foe } = duel();
    me.activateSkill(5);
    const blocker = place(g, 'iowa', 0, -100, 0);
    blocker.throttle = 2;
    blocker.speed = 0;
    expect(me.takeDamage(10000, foe)).toBe(0);
    expect(me.pos.x).toBeGreaterThan(0);
    expect(safeStep(me, me.pos.x, me.pos.z)).toBe(true);
  });
  it('lets afterimages make their own visible evasions', () => {
    const { g, me, foe } = duel();
    me.meter = 1;
    me.activateSkill(8);
    me.activateSkill(5);
    const c = g.ships.find((s) => s.summonOwner === me)!;
    const before = c.pos.clone();
    expect(c.takeDamage(10000, foe)).toBe(0);
    expect(c.pos.distanceTo(before)).toBeCloseTo(100);
  });
});

it('replays rapid predictive Sidestep without consuming nondeterministic randomness', () => {
  const games = [duel(), duel()];
  for (const { me } of games) me.activateSkill(5);
  for (let tick = 0; tick < 100; tick++) {
    for (const { g, me, foe } of games) {
      if (tick % 8 === 0) g.shells.dropBomb(foe, foe.spec.main!.he!, me.pos.x, me.pos.z, 25);
      g.step();
    }
    expect(stateHash(games[0].g)).toBe(stateHash(games[1].g));
  }
  expect(games[0].me.stats.received).toBe(0);
});
