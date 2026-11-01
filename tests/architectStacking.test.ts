import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import type { ArchitectType } from '../src/data/architectLoadout';
import { ARCHETYPES, ARCHITECT_TYPES } from '../src/data/architectLoadout';
import { architectGunReloadScale, preparePlatform, setArchitectLoadout, vectorTuning } from '../src/skills/misc/ArchitectRuntime';
import { applyElementMark, architectSkillRechargeRate, moduleLinks, startElementAttack, updateElements } from '../src/skills/misc/ArchitectElements';
import { bulwarkTaken } from '../src/skills/misc/ArchitectSupport';
import { addCitadelDR } from '../src/skills/misc/ArchitectUltimates';
import { dockedHit, updateDockedPassives } from '../src/skills/misc/ArchitectDocked';
import { stackCount } from '../src/skills/misc/ArchitectStacks';
import { canTrack } from '../src/core/Targeting';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';

// Copies of one Architect bonus add up with no cap; different bonuses still multiply. A cap is
// kept only where a single source could otherwise reach 100%.

function architect(types: ArchitectType[]) {
  const g = emptyGame('open', 713, 'freeplay');
  const s = place(g, 'architect', 0, 0, 2000);
  setArchitectLoadout(s, Array.from({ length: 10 }, (_, i) => ({ type: types[i] ?? 'furnace', skill: 0 as const })));
  s.secondaries.length = 0;
  s.refreshModifiers();
  return { g, s };
}

function arena(seed = 713) {
  const g = emptyGame('open', seed, 'freeplay');
  const s = place(g, 'architect', 0, 0, 1800);
  const t = place(g, 'leviathan', 1, 0, -1000);
  s.throttle = t.throttle = 2;
  s.speed = t.speed = 0;
  t.colossus = false;
  t.hp = t.maxHp = 1e8;
  s.secondaries.length = t.secondaries.length = 0;
  s.control.aimX = 0;
  s.control.aimZ = 0;
  return { g, s, t };
}

/** Two platforms out on the water, every automatic attack held. */
function deployed() {
  const v = arena();
  v.s.activateSkill(0);
  run(v.g, 2);
  v.g.shells.shells = [];
  v.s.architect!.elements.jobs = [];
  v.s.architect!.elements.marks = [];
  for (const a of v.s.architect!.slots) {
    a.opening = false;
    a.skillTimer = 100;
    a.castGap = 0;
  }
  return v;
}

const n = (k: number, type: ArchitectType): ArchitectType[] => Array<ArchitectType>(k).fill(type);

function foe(g: Game, x: number, z: number): Ship {
  const t = place(g, 'iowa', 1, x, z);
  t.hp = t.maxHp = 1e9;
  t.throttle = 2;
  t.speed = 0;
  t.secondaries.length = 0;
  return t;
}

describe('Reaction Amplifier and Accelerando stack per emitter', () => {
  it('two Amplifiers add +80% to a reaction, and Hunt still multiplies on top', () => {
    for (const hunted of [false, true]) {
      const { g, s, t } = deployed();
      const [a, b] = s.architect!.slots;
      a.element = 'furnace';
      b.element = 'cryo';
      if (hunted) {
        s.architect!.huntTarget = t.id;
        s.architect!.huntUntil = g.time + 10;
      }
      b.amps = { [`${s.id}:2`]: g.time + 4, [`${s.id}:3`]: g.time + 4 };
      const before = t.stats.received;
      applyElementMark(s, a, t);
      applyElementMark(s, b, t);
      expect(t.stats.received - before).toBeCloseTo(30000 * 1.8 * (hunted ? 1.4 : 1));
    }
  });

  it('each emitter keeps its own timer: a second Amplifier stacks, a recast only refreshes', () => {
    const { g, s, t } = deployed();
    t.withdraw();
    const [a, b, c] = [s.architect!.slots[0], s.architect!.slots[1], s.architect!.slots[2]];
    const target = b.entity!;
    for (const x of [a, c]) {
      x.type = 'resonance';
      x.skill = 1;
      x.element = ARCHETYPES.resonance.element;
    }
    // Slot 2 is still docked: send it next to the others so its cast reaches platform b.
    c.entity = a.entity;
    c.state = 'deployed';
    a.entity!.pos.copy(target.pos);
    startElementAttack(s, a, target, 'skill');
    updateElements(s, 0.3);
    expect(stackCount(b.amps, g.time)).toBe(1);
    startElementAttack(s, a, target, 'skill');
    updateElements(s, 0.3);
    expect(stackCount(b.amps, g.time)).toBe(1);
    startElementAttack(s, c, target, 'skill');
    updateElements(s, 0.3);
    expect(stackCount(b.amps, g.time)).toBe(2);
    g.time += 5;
    expect(stackCount(b.amps, g.time)).toBe(0);
  });

  it('a platform reloads faster for every link it holds, in Citadel too', () => {
    const { g, s } = deployed();
    s.skills[0].cooldown = 0;
    s.control.aimX = 600;
    s.activateSkill(0);
    run(g, 2);
    const a = s.architect!.slots[0], m = a.entity!;
    const reload = () => {
      m.refreshModifiers();
      preparePlatform(m);
      return m.mods.reloadMul;
    };
    for (const state of ['deployed', 'citadel'] as const) {
      a.state = state;
      s.architect!.linkUntil = 0;
      const alone = reload();
      s.architect!.linkUntil = g.time + 10;
      const k = moduleLinks(s, a);
      expect(k, state).toBeGreaterThanOrEqual(2);
      expect(reload() / alone, state).toBeCloseTo(1 / (1 + 0.25 * k));
    }
  });

  it('Accelerandos and links add to the recharge, and Citadel multiplies it', () => {
    const { g, s } = deployed();
    const a = s.architect!.slots[0];
    a.boosts = { x: g.time + 4, y: g.time + 4 };
    expect(architectSkillRechargeRate(s, a)).toBeCloseTo(1.5);
    s.activateSkill(2);
    expect(architectSkillRechargeRate(s, a)).toBeCloseTo(1.75);
    a.boosts = {};
    a.state = 'citadel';
    expect(architectSkillRechargeRate(s, a)).toBeCloseTo(5 * 1.25);
  });
});

describe('damage reduction: copies add, sources multiply, never 100%', () => {
  it('Bulwark adds 20% per field up to 60%', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(bulwarkTaken)).toEqual([1, 0.8, 0.6, 0.4, 0.4, 0.4, 0.4].map((v) => expect.closeTo(v, 10)));
  });

  it('Citadels from different Architects add, to 90%', () => {
    const m = { citadelDR: 0 } as { citadelDR: number };
    addCitadelDR(m as never, 0.6);
    expect(m.citadelDR).toBeCloseTo(0.6);
    addCitadelDR(m as never, 0.6);
    expect(m.citadelDR).toBeCloseTo(0.9);
  });

  it('Bulwark, Citadel, Plating and dock protection multiply: deep but above zero', () => {
    const { g, s } = architect(n(10, 'bastion'));
    const t = foe(g, 0, -3000);
    const plain = architect([]).s;
    const base = plain.takeDamage(1e5, foe(plain.game, 0, -3000));
    for (let i = 0; i < 5; i++) s.addEffect({ id: `architectBulwark:test:${i}`, time: 10, apply: (m) => void m.bulwark++ });
    s.addEffect({ id: 'architectCitadel:test', time: 10, apply: (m) => addCitadelDR(m, 0.6) });
    s.refreshModifiers();
    const dealt = s.takeDamage(1e5, t);
    // Bulwark .4 × Citadel .4 × Plating (10 Bastions) .6 against the plain hull's dock protection.
    expect(dealt / base).toBeCloseTo(0.4 * 0.4 * 0.6, 3);
    expect(dealt).toBeGreaterThan(0);
  });

  it('no loadout under stacked Bulwarks and Citadels shrugs off a hit entirely', () => {
    for (const type of ARCHITECT_TYPES) {
      const { g, s } = architect(n(10, type));
      const t = foe(g, 0, -3000);
      for (let i = 0; i < 5; i++) s.addEffect({ id: `architectBulwark:test:${i}`, time: 10, apply: (m) => void m.bulwark++ });
      for (const id of [1, 2]) s.addEffect({ id: `architectCitadel:${id}`, time: 10, apply: (m) => addCitadelDR(m, 0.6) });
      s.refreshModifiers();
      expect(s.mods.damageTakenMul, type).toBeGreaterThan(0);
      const hp = s.hp;
      expect(s.takeDamage(1e5, t), type).toBeGreaterThan(0);
      expect(s.hp, type).toBeLessThan(hp);
    }
  });

  it('a negative damage multiplier never heals', () => {
    const { g, s } = architect([]);
    const t = foe(g, 0, -3000);
    s.hp = s.maxHp / 2;
    s.addEffect({ id: 'test:inverse', time: 10, apply: (m) => void (m.damageTakenMul = -1) });
    s.refreshModifiers();
    const hp = s.hp;
    expect(s.takeDamage(1e5, t)).toBe(0);
    expect(s.hp).toBe(hp);
  });
});

describe('docked passives without their old caps', () => {
  it('Plating: ten Bastions cut 40%', () => {
    const base = architect([]).s.mods.damageTakenMul;
    expect(architect(n(10, 'bastion')).s.mods.damageTakenMul / base).toBeCloseTo(0.6);
  });

  it('Sonar Net: ten Abyss turn 90% of torpedo damage aside', () => {
    expect(architect(n(10, 'abyss')).s.mods.torpTakenMul).toBeCloseTo(0.1);
  });

  it('Field Repair: ten Restorations repair 1% of the full hull a second', () => {
    const heal = (types: ArchitectType[]) => {
      const { g, s } = architect(types);
      run(g, 3);
      s.hp = s.maxHp / 2;
      const before = s.hp;
      updateDockedPassives(s, 1);
      return { gained: s.hp - before, s };
    };
    const lots = heal(n(10, 'restoration'));
    expect(lots.gained).toBeCloseTo(lots.s.architect!.fullHp * 0.01 * lots.s.mods.regenMul, -2);
  });

  it('Harmonic: nine Resonance make the last docked gun reload 90% faster', () => {
    const { s } = architect(n(9, 'resonance'));
    expect(architectGunReloadScale(s, 'docked', s.architect!.slots[9])).toBeCloseTo(1 / 1.9);
  });

  it('Watch: five Sentinels see a cloaked ship at 7.5 km', () => {
    const { g, s } = architect(n(5, 'sentinel'));
    const cloaked = foe(g, 0, 2000 - 7500);
    cloaked.addEffect({ id: 'cloak-test', time: 100, apply: (m) => void (m.untargetable = true) });
    run(g, 1);
    expect(canTrack(s, cloaked)).toBe(true);
  });

  it('Thrust Vanes: each docked Vector quickens Hull Dash by 10%', () => {
    const docked = architect(n(3, 'vector'));
    const out = architect(n(3, 'vector'));
    for (const a of out.s.architect!.slots.slice(0, 3)) {
      a.state = 'deployed';
      a.aboard = false;
    }
    out.s.refreshModifiers();
    expect(vectorTuning(out.s).dashRecharge / vectorTuning(docked.s).dashRecharge).toBeCloseTo(1.3);
  });

  it('Rime: each docked Cryo slows 10% and turns turrets 15% slower, to 90%', () => {
    for (const [k, speed, traverse] of [[3, 0.7, 0.55], [10, 0.1, 0.1]] as const) {
      const { g, s } = architect(n(k, 'cryo'));
      const t = foe(g, 0, -3000);
      t.refreshModifiers();
      const base = { ...t.mods };
      dockedHit(s, 'cryo', t, 1000);
      t.refreshModifiers();
      expect(t.mods.speedMul / base.speedMul).toBeCloseTo(speed);
      expect(t.mods.traverseMul / base.traverseMul).toBeCloseTo(traverse);
    }
  });

  it('Kindling: the burn grows with every docked Furnace', () => {
    const burned = (k: number) => {
      const { g, s } = architect([...n(k, 'furnace'), ...n(10 - k, 'bastion')]);
      const t = foe(g, 0, -3000);
      dockedHit(s, 'furnace', t, 1000);
      const before = t.stats.received;
      updateDockedPassives(s, 1);
      return t.stats.received - before;
    };
    expect(burned(3) / burned(1)).toBeCloseTo(3);
  });
});

describe('rates and slows', () => {
  it('Mobile Battery: each extra specialization cuts 15% of the cooldown, never below 1 s', () => {
    const tuned = (mobile: number) => {
      const { s } = architect([]);
      setArchitectLoadout(s, Array.from({ length: 10 }, (_, i) => ({ type: i < mobile ? ('vector' as const) : ('furnace' as const), skill: (i < mobile ? 1 : 0) as 0 | 1 })));
      s.refreshModifiers();
      return vectorTuning(s).mobileCooldown;
    };
    expect(tuned(3)).toBeCloseTo(14 * 0.7);
    expect(tuned(10)).toBeCloseTo(1);
  });

  it('the Cryo slow multiplies with another slow instead of giving way to it', () => {
    const { g, s, t: titan } = deployed();
    titan.withdraw();
    const t = foe(g, 0, -400);
    t.addEffect({ id: 'debuff:test-slow', time: 30, apply: (m) => void (m.speedMul *= 0.5) });
    t.refreshModifiers();
    const slowed = t.mods.speedMul;
    const a = s.architect!.slots[0];
    a.type = 'cryo';
    a.element = 'cryo';
    a.skill = 0;
    a.entity!.pos.set(0, 0, 0);
    startElementAttack(s, a, t, 'skill');
    updateElements(s, 0.3);
    run(g, 0);
    t.refreshModifiers();
    expect(t.mods.speedMul / slowed).toBeCloseTo(0.8);
  });
});
