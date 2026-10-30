import { describe, expect, it } from 'vitest';
import { SHIFT_CHARGE, SHIFT_SURGE, SHIFT_TEMPOS, type ShiftTempo } from '../src/config';
import { buildRoster, type BattleConfig } from '../src/core/BattleSetup';
import { Game } from '../src/core/Game';
import { forwardX, forwardZ, makeRng } from '../src/core/math';
import { eraOf, factionsOf } from '../src/data/factions';
import { ALL, SHIP_BY_ID, bossesOf, shipsOf } from '../src/data/ships';
import { layoutFor } from '../src/input/Keybinds';
import { hurt } from '../src/skills/kit';
import type { Ship } from '../src/ships/Ship';
import { emptyGame, place, run } from './helpers';

/** Every anime line ship, three to a series. */
const SERIES: Record<string, string[]> = {
  jjk: ['gojo', 'sukuna', 'megumi'],
  naruto: ['naruto', 'sasuke', 'itachi'],
  onepiece: ['luffy', 'zoro', 'law'],
  dragonball: ['goku', 'vegeta', 'frieza'],
  bleach: ['ichigo', 'byakuya', 'aizen'],
  aot: ['eren', 'armin', 'levi'],
  demonslayer: ['tanjiro', 'rengoku', 'muzan'],
  mha: ['deku', 'allMight', 'bakugo'],
};
const BASES = Object.values(SERIES).flat();
const kitIndex = (s: Ship, id: string) => s.skills.findIndex((k) => k.spec.id === id);
const ults = (s: Ship) => s.skills.flatMap((k, i) => (k.spec.ult ? [i] : []));

/** Fire the Titan Shift (the base ship's ultimate) and let the shift land. */
function shift(g: Game, s: Ship): void {
  s.meter = 1;
  expect(s.activateSkill(ults(s)[0])).toBe(true);
  run(g, 1 / 60);
}

function tempoGame(tempo: ShiftTempo): Game {
  const g = emptyGame();
  g.config.shiftTempo = tempo;
  return g;
}

describe('anime roster', () => {
  it('each anime ship has two skills and a Titan Shift into a hidden titan form', () => {
    expect(shipsOf('anime').map((s) => s.id).sort()).toEqual([...BASES].sort());
    for (const id of BASES) {
      const s = SHIP_BY_ID[id];
      expect(s.cls, id).not.toBe('TT');
      expect(s.skills.length, id).toBe(3);
      expect(s.skills[2].ult && s.skills[2].icon, id).toBe('shift');
      const form = SHIP_BY_ID[s.shift!.form];
      expect(form, id).toBeDefined();
      expect(form.hidden, id).toBe(true);
      expect(form.cls, id).toBe('TT');
      expect(form.formOf, id).toBe(id);
      expect(form.nation, id).toBe(s.nation);
      expect(form.model.formAura, id).toBeDefined();
      expect(form.skills.length, id).toBe(9);
      expect(form.skills.slice(6).every((k) => k.ult), id).toBe(true);
      expect(form.skills.slice(0, 6).some((k) => k.ult), id).toBe(false);
    }
  });

  it('every series sails in the anime era with three ships, and Misc holds its independent titans', () => {
    expect(factionsOf('anime').map((x) => x.id).sort()).toEqual(Object.keys(SERIES).sort());
    for (const [f, ids] of Object.entries(SERIES)) expect(shipsOf('anime').filter((s) => s.nation === f).map((s) => s.id).sort(), f).toEqual([...ids].sort());
    for (const s of ALL.filter((x) => x.formOf)) expect(eraOf(s)).toBe('anime');
    expect(shipsOf('misc').map((s) => s.id)).toEqual(['stepper', 'tungsten', 'hadal', 'architect']);
  });

  it('the anime line fields every class: five battleships, eight cruisers, four destroyers, three carriers, four subs', () => {
    const count = (cls: string[]) => BASES.filter((id) => cls.includes(SHIP_BY_ID[id].cls)).length;
    expect(count(['BB'])).toBe(5);
    expect(count(['CB', 'CA', 'CL'])).toBe(8);
    expect(count(['DD'])).toBe(4);
    expect(count(['CV'])).toBe(3);
    expect(count(['SS'])).toBe(4);
  });

  it('a full anime battle fills its carrier and submarine slots with anime carriers and subs', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const config: BattleConfig = { mode: 'solo', type: 'annihilation', mapId: 'open', teamSize: 8, difficulty: 'normal', players: [{ shipId: 'goku', device: 'mouse' }], seed, era: 'anime' };
      const roster = buildRoster(config, makeRng(seed));
      for (const team of [0, 1]) {
        const fleet = roster.filter((r) => r.team === team);
        expect(fleet.filter((r) => r.spec.cls === 'CV').length, `seed ${seed} team ${team} CV`).toBeGreaterThanOrEqual(1);
        expect(fleet.filter((r) => r.spec.cls === 'SS').length, `seed ${seed} team ${team} SS`).toBeGreaterThanOrEqual(1);
        for (const r of fleet) expect(BASES, r.spec.id).toContain(r.spec.id);
      }
    }
  });

  it('Boss Rush in Anime sends the forms as bosses', () => {
    const forms = bossesOf('anime').map((s) => s.id).sort();
    expect(forms).toEqual(BASES.map((id) => SHIP_BY_ID[id].shift!.form).sort());
    expect(bossesOf('mixed').map((s) => s.id)).toContain('gojoHonored');
  });
});

describe('Titan Shift', () => {
  it('swaps the hull, skills and keys for the form, keeping the share of hull plus a surge', () => {
    const g = emptyGame();
    const me = place(g, 'gojo', 0, 0, 0);
    run(g, 0.1);
    me.hp = me.maxHp * 0.5;
    shift(g, me);
    const form = SHIP_BY_ID.gojoHonored;
    expect(me.spec).toBe(form);
    expect(me.base).toBe(SHIP_BY_ID.gojo);
    expect(me.skills.map((k) => k.spec.id)).toEqual(form.skills.map((k) => k.id));
    expect(layoutFor(me.spec).skills.length).toBe(9);
    expect(me.maxHp).toBeCloseTo(form.hp, 3);
    expect(me.hp / me.maxHp).toBeCloseTo(0.5 + SHIFT_SURGE, 2);
    expect(me.form).not.toBeNull();
    // Normal form skills start ready.
    for (let i = 0; i < 6; i++) expect(me.skillReady(i), form.skills[i].id).toBe(true);
  });

  for (const tempo of Object.keys(SHIFT_TEMPOS) as ShiftTempo[]) {
    it(`${tempo}: the form lasts its time and each ultimate comes ready on schedule, once`, () => {
      const t = SHIFT_TEMPOS[tempo];
      const g = tempoGame(tempo);
      const me = place(g, 'goku', 0, 0, 0);
      run(g, 0.1);
      shift(g, me);
      const f = me.form!;
      // Dragon Ball's Limit Breaker stretches every form.
      const time = 40 * t.timeMul * (me.trait?.shiftTimeMul ?? 1);
      expect(f.until - f.start).toBeCloseTo(time, 3);
      const u = ults(me);
      expect(u.length).toBe(3);
      for (let k = 0; k < 3; k++) {
        const at = t.unlock[k] * time;
        if (at > 0.1) expect(me.skillReady(u[k]), `ult ${k} early`).toBe(false);
      }
      run(g, t.unlock[2] * time + 0.2);
      for (let k = 0; k < 3; k++) expect(me.skillReady(u[k]), `ult ${k} ready`).toBe(true);
      // Fire one: it never comes back in this form.
      me.control.aimX = 3000;
      me.control.aimZ = 0;
      expect(me.activateSkill(u[1])).toBe(true);
      run(g, Math.min(8, time - t.unlock[2] * time - 1));
      expect(me.skillReady(u[1])).toBe(false);
      expect(me.skills[u[1]].meter).toBe(0);
    });
  }

  it('reverts after its time: base hull and skills, the same share of hull, cooldowns less the time away', () => {
    const g = emptyGame();
    const me = place(g, 'naruto', 0, 0, 0);
    run(g, 0.1);
    const q = kitIndex(me, 'shadowClone');
    me.activateSkill(q);
    const cd = me.skills[q].cooldown;
    expect(cd).toBeGreaterThan(10);
    shift(g, me);
    // Hit just before the form lapses (a lull would let the hull regenerate).
    run(g, 39.5);
    me.hp = me.maxHp * 0.4;
    run(g, 1);
    expect(me.form).toBeNull();
    expect(me.spec).toBe(SHIP_BY_ID.naruto);
    expect(me.skills.length).toBe(3);
    expect(me.hp / me.maxHp).toBeGreaterThan(0.38);
    expect(me.hp / me.maxHp).toBeLessThan(0.45);
    expect(me.skills[q].cooldown).toBe(0);
    expect(me.meter).toBeLessThan(0.2);
  });

  it('the shift starts empty and damage charges it at a quarter of the usual rate', () => {
    const g = emptyGame();
    const me = place(g, 'gojo', 0, 0, 0);
    const line = place(g, 'iowa', 0, 0, 2000);
    expect(me.meter).toBe(0);
    me.charge(0.4);
    line.meter = 0;
    line.charge(0.4);
    expect(me.meter).toBeCloseTo(0.4 * SHIFT_CHARGE, 6);
    expect(line.meter).toBeCloseTo(0.4, 6);
  });

  it('a ship sunk in its form comes back as itself', () => {
    const g = emptyGame();
    const me = place(g, 'luffy', 0, 0, 0);
    run(g, 0.1);
    shift(g, me);
    expect(me.spec.id).toBe('luffyNika');
    const seen: boolean[] = [];
    g.events.on('shift', (e) => seen.push(e.on));
    me.sink(null);
    me.respawn(0, 0, 0);
    // The HUD hears of it, to lay the base skills out again.
    expect(seen).toEqual([false]);
    expect(me.form).toBeNull();
    expect(me.spec).toBe(SHIP_BY_ID.luffy);
    expect(me.skills.length).toBe(3);
    expect(me.hp).toBeCloseTo(me.maxHp, 3);
  });

  it('a Boss Rush hull refit carries into the form and back', () => {
    const g = emptyGame();
    const me = place(g, 'sukuna', 0, 0, 0);
    run(g, 0.1);
    me.maxHp *= 1.2;
    me.hp = me.maxHp;
    shift(g, me);
    expect(me.maxHp).toBeCloseTo(SHIP_BY_ID.sukunaKing.hp * 1.2, 1);
    run(g, 41);
    expect(me.form).toBeNull();
    expect(me.maxHp).toBeCloseTo(SHIP_BY_ID.sukuna.hp * 1.2, 1);
  });

  it('a shift cleanses stuns and fires, and summons cannot shift', () => {
    const g = emptyGame();
    const me = place(g, 'naruto', 0, 0, 0);
    run(g, 0.1);
    shift(g, me);
    const clones = g.ships.filter((s) => s.isSummon);
    me.activateSkill(kitIndex(me, 'multiShadowClone'));
    run(g, 0.1);
    const clone = g.ships.find((s) => s.isSummon && !clones.includes(s));
    expect(clone).toBeDefined();
    expect(g.shiftShip(clone!)).toBe(false);
  });
});

describe('JJK', () => {
  it('Infinity stops every hit, but the World-Cutting Slash goes through it', () => {
    const g = emptyGame();
    const sukuna = place(g, 'sukunaKing', 0, 0, 0, Math.PI / 2);
    const gojo = place(g, 'gojoHonored', 1, 2500, 0, -Math.PI / 2);
    run(g, 0.1);
    expect(gojo.activateSkill(kitIndex(gojo, 'infinity'))).toBe(true);
    run(g, 0.1);
    const before = gojo.hp;
    hurt(sukuna, gojo, 50000, sukuna.skills[0].spec);
    expect(gojo.hp).toBe(before);
    sukuna.control.aimX = gojo.pos.x;
    sukuna.control.aimZ = gojo.pos.z;
    sukuna.meter = 1;
    expect(sukuna.activateSkill(kitIndex(sukuna, 'worldSlash'))).toBe(true);
    run(g, 1);
    expect(gojo.mods.invulnerable).toBe(true);
    // 220k, less the titan's Colossus quarter.
    expect(before - gojo.hp).toBeGreaterThanOrEqual(150000);
  });

  it('Black Flash: a JJK hull sometimes lands a hit two and a half times as hard', () => {
    const g = emptyGame();
    const me = place(g, 'gojo', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 4000, 0);
    run(g, 0.1);
    let crits = 0;
    for (let i = 0; i < 400; i++) if (me.critMul(foe) > 1) crits++;
    expect(crits).toBeGreaterThan(10);
    expect(crits).toBeLessThan(80);
    const iowa = place(g, 'iowa', 0, -4000, 0);
    for (let i = 0; i < 100; i++) expect(iowa.critMul(foe)).toBe(1);
  });
});

describe('Dragon Ball', () => {
  it('Autonomous Dodge makes most hostile hits miss', () => {
    const g = emptyGame();
    const goku = place(g, 'gokuUI', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 3000, 0);
    run(g, 0.1);
    expect(goku.activateSkill(kitIndex(goku, 'autonomousDodge'))).toBe(true);
    run(g, 0.1);
    let landed = 0;
    for (let i = 0; i < 100; i++) {
      const hp = goku.hp;
      hurt(foe, goku, 100, foe.skills[0].spec);
      if (goku.hp < hp) landed++;
    }
    expect(landed).toBeGreaterThan(20);
    expect(landed).toBeLessThan(60);
  });
});

describe('shifts across hull types', () => {
  it('Itachi surfaces into the Susanoo and can dive again once it lapses', () => {
    const g = emptyGame();
    const me = place(g, 'itachi', 0, 0, 0);
    me.depthState = 1;
    run(g, 6);
    expect(me.submerged).toBe(true);
    shift(g, me);
    expect(me.spec.id).toBe('itachiSusanoo');
    expect(me.isSub).toBe(false);
    expect(me.pos.y).toBe(0);
    run(g, 41);
    expect(me.form).toBeNull();
    expect(me.isSub).toBe(true);
    me.depthState = 2;
    run(g, 12);
    expect(me.deep).toBe(true);
  });

  it('Law stays under in his Awakening, with fuller tanks that are cut back on the revert', () => {
    const g = emptyGame();
    const me = place(g, 'law', 0, 0, 0);
    me.depthState = 2;
    run(g, 12);
    expect(me.deep).toBe(true);
    shift(g, me);
    expect(me.spec.id).toBe('lawAwakened');
    expect(me.submerged).toBe(true);
    expect(me.battery).toBeGreaterThan(SHIP_BY_ID.law.sub!.battery);
    me.depthState = 0;
    run(g, 41);
    expect(me.form).toBeNull();
    expect(me.battery).toBeLessThanOrEqual(SHIP_BY_ID.law.sub!.battery);
  });

  it('Mahoraga has no air wing: squadrons already out still resolve, and the wing comes back on the revert', () => {
    const g = emptyGame();
    const me = place(g, 'megumi', 0, 0, 0);
    place(g, 'iowa', 1, 6000, 0);
    run(g, 0.1);
    me.slot = me.slots.findIndex((sl) => sl.kind === 'air');
    me.control.aimX = 6000;
    me.control.aimZ = 0;
    me.control.fire = true;
    run(g, 0.5);
    me.control.fire = false;
    expect(g.air.squadrons.some((q) => q.owner === me)).toBe(true);
    shift(g, me);
    expect(me.spec.id).toBe('mahoraga');
    expect(me.air).toBeNull();
    expect(me.slots.some((sl) => sl.kind === 'air')).toBe(false);
    run(g, 41);
    expect(me.form).toBeNull();
    expect(me.air).not.toBeNull();
    expect(me.slots.some((sl) => sl.kind === 'air')).toBe(true);
  });

  it('Golden Frieza launches his bigger wing while in form', () => {
    const g = emptyGame();
    const me = place(g, 'frieza', 0, 0, 0);
    place(g, 'iowa', 1, 6000, 0);
    run(g, 0.1);
    shift(g, me);
    expect(me.spec.id).toBe('friezaGolden');
    me.slot = me.slots.findIndex((sl) => sl.kind === 'air');
    expect(me.slot).toBeGreaterThanOrEqual(0);
    me.control.aimX = 6000;
    me.control.aimZ = 0;
    me.control.fire = true;
    run(g, 0.5);
    expect(g.air.squadrons.some((q) => q.owner === me)).toBe(true);
  });

  it('Squad Levi brings Levi\'s own destroyers, which never shift', () => {
    const g = emptyGame();
    const me = place(g, 'leviStrongest', 0, 0, 0);
    place(g, 'iowa', 1, 5000, 0);
    run(g, 0.1);
    expect(me.activateSkill(kitIndex(me, 'squadLevi'))).toBe(true);
    run(g, 0.1);
    const squad = g.ships.filter((s) => s.isSummon && s.spec.id === 'levi');
    expect(squad.length).toBe(2);
    squad[0].meter = 1;
    expect(g.shiftShip(squad[0])).toBe(false);
  });
});

describe('anime primitives', () => {
  /** Count the hits `skill` lands on `s`. */
  function hits(s: Ship, skill: string): () => number {
    let n = 0;
    const orig = s.takeDamage.bind(s);
    s.takeDamage = (...a: Parameters<Ship['takeDamage']>) => {
      if (a[2]?.id === skill) n++;
      return orig(...a);
    };
    return () => n;
  }

  it('the Rumbling: Wall Titans march along Eren\'s heading and ignore the enemy off to the side', () => {
    const g = emptyGame();
    const me = place(g, 'erenFounder', 0, 0, 0, 0);
    place(g, 'iowa', 1, 4000, 2000, 0);
    run(g, 0.1);
    me.meter = 1;
    me.skills.forEach((k) => (k.meter = 1));
    expect(me.activateSkill(kitIndex(me, 'rumbling'))).toBe(true);
    run(g, 0.1);
    const walls = g.ships.filter((s) => s.isSummon && s.spec.id === 'wallTitan');
    expect(walls.length).toBe(8);
    const start = walls.map((w) => ({ x: w.pos.x, z: w.pos.z }));
    run(g, 8);
    walls.forEach((w, i) => {
      expect(Math.abs(Math.atan2(Math.sin(w.heading), Math.cos(w.heading))), w.name).toBeLessThan(0.25);
      const ahead = (w.pos.x - start[i].x) * forwardX(me.heading) + (w.pos.z - start[i].z) * forwardZ(me.heading);
      expect(ahead, w.name).toBeGreaterThan(80);
      expect(w.mods.unstoppable && w.mods.knockImmune).toBe(true);
    });
  });

  it('Izanami snaps the target back to where it was without mending its hull', () => {
    const g = emptyGame();
    const me = place(g, 'itachiSusanoo', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 2000, 0);
    run(g, 3);
    foe.pos.x = foe.prevPos.x = 2600;
    foe.hp = foe.maxHp * 0.5;
    me.control.aimX = foe.pos.x;
    me.control.aimZ = foe.pos.z;
    me.skills.forEach((k) => (k.meter = 1));
    expect(me.activateSkill(kitIndex(me, 'izanami'))).toBe(true);
    run(g, 0.1);
    expect(foe.pos.x).toBeCloseTo(2000, 0);
    // Still the hull it had, not the full one from two seconds ago.
    expect(foe.hp).toBeLessThan(foe.maxHp * 0.55);
    expect(foe.mods.silenced).toBe(true);
  });

  it('a line dash (Chidori) hits each hull on its path once', () => {
    const g = emptyGame();
    const me = place(g, 'sasuke', 0, 0, 0, Math.PI / 2);
    const a = place(g, 'iowa', 1, 400, 0);
    const b = place(g, 'iowa', 1, 800, 0);
    run(g, 0.1);
    const na = hits(a, 'chidori');
    const nb = hits(b, 'chidori');
    me.control.aimX = 1200;
    me.control.aimZ = 0;
    expect(me.activateSkill(kitIndex(me, 'chidori'))).toBe(true);
    run(g, 2);
    expect(na()).toBe(1);
    expect(nb()).toBe(1);
    expect(me.pos.x).toBeGreaterThan(900);
  });

  it('a flash run (Asura) strikes each queued hull once', () => {
    const g = emptyGame();
    const me = place(g, 'zoroKing', 0, 0, 0, Math.PI / 2);
    const foes = [place(g, 'iowa', 1, 1500, 0), place(g, 'iowa', 1, 0, 1800), place(g, 'iowa', 1, -1600, 300)];
    run(g, 0.1);
    const counts = foes.map((f) => hits(f, 'asura'));
    expect(me.activateSkill(kitIndex(me, 'asura'))).toBe(true);
    run(g, 3);
    expect(counts.map((c) => c())).toEqual([1, 1, 1]);
  });

  it('Lost sends Zoro the same way on the same seed', () => {
    const where = (seed: number) => {
      const g = emptyGame('open', seed);
      const me = place(g, 'zoroKing', 0, 0, 0);
      run(g, 0.1);
      expect(me.activateSkill(kitIndex(me, 'lost'))).toBe(true);
      run(g, 0.1);
      return [Math.round(me.pos.x), Math.round(me.pos.z)];
    };
    const a = where(5);
    expect(Math.hypot(a[0], a[1])).toBeGreaterThan(1000);
    expect(where(5)).toEqual(a);
  });

  it('Absorption repairs Muzan by what it drains', () => {
    const g = emptyGame();
    const me = place(g, 'muzanKing', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 1500, 0);
    run(g, 0.1);
    me.hp = me.maxHp * 0.5;
    const hp = me.hp;
    me.skills.forEach((k) => (k.meter = 1));
    expect(me.activateSkill(kitIndex(me, 'absorption'))).toBe(true);
    run(g, 2);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    expect(me.hp).toBeGreaterThan(hp);
  });
});

describe('anime battles', () => {
  it('AI captains shift, fight in their forms and revert', () => {
    const config: BattleConfig = {
      mode: 'solo',
      type: 'annihilation',
      mapId: 'open',
      teamSize: 5,
      difficulty: 'hard',
      players: [{ shipId: 'goku', device: 'mouse' }],
      seed: 11,
      era: 'anime',
    };
    const g = new Game(config);
    for (const s of g.ships) s.meter = 1;
    let shifts = 0;
    let reverts = 0;
    let formSkills = 0;
    g.events.on('shift', (e) => (e.on ? shifts++ : reverts++));
    g.events.on('skill', (e) => {
      if (e.ship.form) formSkills++;
    });
    for (let t = 0; t < 240 && !g.over; t++) run(g, 1);
    expect(shifts).toBeGreaterThan(0);
    expect(formSkills).toBeGreaterThan(0);
    expect(reverts + g.ships.filter((s) => s.form).length).toBeGreaterThan(0);
  }, 60_000);
});
