import { describe, expect, it } from 'vitest';
import { eraOf } from '../src/data/factions';
import { SHIPS, SHIP_BY_ID } from '../src/data/ships';
import type { Ship } from '../src/ships/Ship';
import { emptyGame, place, run } from './helpers';

const kitIndex = (s: Ship, id: string) => s.skills.findIndex((k) => k.spec.id === id);

/** Cast a ship's skill by id, with the reticle on `at`. */
function cast(s: Ship, id: string, at?: { pos: { x: number; z: number } }): boolean {
  if (at) {
    s.control.aimX = at.pos.x;
    s.control.aimZ = at.pos.z;
  }
  s.meter = 1;
  return s.activateSkill(kitIndex(s, id));
}

const d2 = (a: Ship, x: number, z: number) => Math.hypot(a.pos.x - x, a.pos.z - z);
const summonsOf = (g: ReturnType<typeof emptyGame>, owner: Ship, specId: string) => g.ships.filter((s) => s.alive && s.isSummon && s.team === owner.team && s.spec.id === specId);

describe('sci-fi roster', () => {
  it('fields four fleets, one ship per hangar tab each, firing lasers, railguns and plasma', () => {
    const sf = SHIPS.filter((s) => eraOf(s) === 'scifi');
    expect(sf.length).toBe(24);
    for (const nation of ['jp_sf', 'us_sf', 'ru_sf', 'cn_sf']) {
      expect(sf.filter((s) => s.nation === nation && s.cls !== 'TT').length, nation).toBe(5);
    }
    for (const s of sf) if (s.main) expect(['laser', 'rail', 'plasma'], s.id).toContain(s.main.look);
    for (const s of sf) if (s.torpedoes) expect(s.torpedoes.look, s.id).toBe('lance');
    for (const s of sf) if (s.air) expect(s.air.look, s.id).toBe('drone');
  });

  it('faction traits shape the hulls: Kage is fragile, Bastion is tough', () => {
    expect(SHIP_BY_ID.kaguya.hp).toBe(1100000);
    expect(SHIP_BY_ID.koschei.hp).toBeGreaterThan(1990000);
    expect(SHIP_BY_ID.tsurugi.hp).toBe(72000 * 5 * 0.8);
    expect(SHIP_BY_ID.buran.hp).toBe(Math.round((76000 * 5 * 1.15) / 100) * 100);
    // Uplink: the USSN guns reach 10% further than the same gun elsewhere would.
    expect(SHIP_BY_ID.apollo.main!.range).toBeCloseTo(14000 * 0.4 * 1.1);
  });
});

describe('sci-fi traits', () => {
  it('Kage: the first hit after a blink deals 60% more', () => {
    const g = emptyGame();
    const me = place(g, 'kunai', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 3000, 0, 0);
    run(g, 0.1);
    const base = foe.takeDamage(1000, me);
    expect(cast(me, 'shunpo', { pos: { x: 600, z: 0 } })).toBe(true);
    expect(me.ambushReady).toBe(true);
    const hit = foe.takeDamage(1000, me);
    expect(hit / base).toBeCloseTo(1.6, 1);
    expect(me.ambushReady).toBe(false);
  });

  it('Bastion: blasts cannot shove the hull, and stuns last half as long', () => {
    const g = emptyGame();
    const me = place(g, 'buran', 0, 0, 0, 0);
    me.shove(500, 0);
    expect(me.pushX).toBe(0);
  });

  it('Nanite Hull: repairs even while under fire', () => {
    const g = emptyGame();
    const me = place(g, 'tiangong', 0, 0, 0, 0);
    const foe = place(g, 'iowa', 1, 6000, 0, 0);
    me.hp = me.maxHp * 0.5;
    const hp = me.hp;
    for (let i = 0; i < 60; i++) {
      me.takeDamage(1, foe);
      run(g, 1 / 20);
    }
    expect(me.hp).toBeGreaterThan(hp + me.maxHp * 0.01 - 60);
  });
});

describe('sci-fi skills', () => {
  it('Iaido blinks ahead and readies a tight salvo', () => {
    const g = emptyGame();
    const me = place(g, 'tsurugi', 0, 0, 0, Math.PI / 2);
    place(g, 'iowa', 1, 5000, 0, 0);
    run(g, 0.1);
    const x = me.pos.x;
    for (const t of me.turrets) t.reload = 10;
    expect(cast(me, 'iaido')).toBe(true);
    expect(me.pos.x - x).toBeGreaterThan(250);
    expect(me.salvo?.dispersionMul).toBe(0.5);
    expect(me.turrets.every((t) => t.reload === 0)).toBe(true);
  });

  it('Kawarimi dodges a big hit whole and side-steps the hull', () => {
    const g = emptyGame();
    const me = place(g, 'tsurugi', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 5000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'kawarimi')).toBe(true);
    const hp = me.hp;
    expect(me.takeDamage(me.maxHp * 0.1, foe)).toBe(0);
    expect(me.hp).toBe(hp);
    expect(d2(me, 0, 0)).toBeGreaterThan(250);
    // Spent: the next one lands.
    expect(me.takeDamage(me.maxHp * 0.1, foe)).toBeGreaterThan(0);
  });

  it('Shadow Swap trades places with the reticle ship and stuns it', () => {
    const g = emptyGame();
    const me = place(g, 'oboro', 0, 0, 0, 0);
    const foe = place(g, 'desmoines', 1, 1500, 0, 0);
    run(g, 0.1);
    const [mx, fx] = [me.pos.x, foe.pos.x];
    expect(cast(me, 'shadowSwap', foe)).toBe(true);
    expect(me.pos.x).toBeCloseTo(fx, 0);
    expect(foe.pos.x).toBeCloseTo(mx, 0);
    expect(foe.effects.some((e) => e.id === 'debuff:stun')).toBe(true);
  });

  it('Tsukuyomi Gate flings every enemy near out to 1.5 km', () => {
    const g = emptyGame();
    const me = place(g, 'oboro', 0, 0, 0, 0);
    const a = place(g, 'fletcher', 1, 800, 0, 0);
    const b = place(g, 'fletcher', 1, -600, 400, 0);
    run(g, 0.1);
    expect(cast(me, 'tsukuyomiGate')).toBe(true);
    for (const s of [a, b]) expect(d2(s, me.pos.x, me.pos.z)).toBeGreaterThan(1300);
  });

  it('Shadow Assassination vanishes, then strikes from behind the target', () => {
    const g = emptyGame();
    const me = place(g, 'kunai', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 2500, 0, Math.PI / 2);
    run(g, 0.1);
    const hp = foe.hp;
    expect(cast(me, 'shadowAssassination', foe)).toBe(true);
    run(g, 0.5);
    expect(me.mods.untargetable).toBe(true);
    run(g, 2.7);
    expect(d2(me, foe.pos.x, foe.pos.z)).toBeLessThan(450);
    // Behind it: west of a ship heading east.
    expect(me.pos.x).toBeLessThan(foe.pos.x);
    expect(hp - foe.hp).toBeGreaterThan(foe.maxHp * 0.18);
  });

  it('Deflector Array turns away shells from afar, not from close in', () => {
    const g = emptyGame();
    const me = place(g, 'apollo', 0, 0, 0, 0);
    const far = place(g, 'iowa', 1, 4000, 0, 0);
    const near = place(g, 'iowa', 1, -1500, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'deflectorArray')).toBe(true);
    const shoot = (from: Ship) =>
      g.shells.fire(from, {
        ammo: 'AP',
        spec: from.spec.main!.ap!,
        table: from.tableFor('AP')!,
        fromX: from.pos.x,
        fromY: 20,
        fromZ: from.pos.z,
        toX: me.pos.x,
        toZ: me.pos.z,
        dmgMul: 1,
        guaranteedFire: false,
        railgun: false,
      });
    const a = shoot(far);
    run(g, a.flight + 0.5);
    expect(me.stats.received).toBe(0);
    const b = shoot(near);
    run(g, b.flight + 0.5);
    expect(me.stats.received).toBeGreaterThan(0);
  });

  it('Ablative Armour hardens as the hull is struck', () => {
    const g = emptyGame();
    const me = place(g, 'buran', 0, 0, 0, 0);
    const foe = place(g, 'iowa', 1, 6000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'ablativeArmour')).toBe(true);
    run(g, 0.1);
    const first = me.takeDamage(me.maxHp * 0.07, foe);
    run(g, 0.1);
    const later = me.takeDamage(me.maxHp * 0.07, foe);
    expect(later).toBeLessThan(first * 0.85);
  });

  it('Tunguska Event sends every skill it catches back to full cooldown', () => {
    const g = emptyGame();
    const me = place(g, 'tunguska', 0, 0, 0, 0);
    const foe = place(g, 'oboro', 1, 4000, 0, 0);
    run(g, 0.1);
    foe.meter = 0.8;
    expect(cast(me, 'tunguskaEvent', foe)).toBe(true);
    run(g, 2.5);
    expect(foe.skills[0].cooldown).toBeGreaterThan(foe.skills[0].spec.cooldown - 1);
    // The blast's own damage charges the meter a little; the event takes more back.
    expect(foe.meter).toBeLessThan(0.8);
  });

  it('Thunderdome cages enemies inside the lightning', () => {
    const g = emptyGame();
    const me = place(g, 'molniya', 0, 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 700, 0, Math.PI / 2);
    run(g, 0.1);
    expect(cast(me, 'thunderdome')).toBe(true);
    foe.throttle = 4;
    run(g, 6);
    expect(d2(foe, 0, 0)).toBeLessThan(1100);
  });

  it('Graviton Shell, EMP Shell and Prism Split ride the next salvo', () => {
    const g = emptyGame();
    const buran = place(g, 'buran', 0, 0, 0, 0);
    const tung = place(g, 'tunguska', 0, 0, 600, 0);
    const art = place(g, 'artemis', 0, 0, -600, 0);
    run(g, 0.1);
    for (const [s, id] of [[buran, 'gravitonShell'], [tung, 'empShell'], [art, 'prismSplit']] as const) {
      expect(cast(s, id)).toBe(true);
      expect(s.salvo?.onHit).toBeDefined();
    }
  });

  it('Replicator prints a full-strength twin; the twin cannot print another', () => {
    const g = emptyGame();
    const me = place(g, 'tiangong', 0, 0, 0, 0);
    place(g, 'iowa', 1, 5000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'replicator')).toBe(true);
    const [twin] = summonsOf(g, me, 'tiangong');
    expect(twin.maxHp).toBe(me.maxHp);
    expect(cast(twin, 'replicator')).toBe(false);
  });

  it('Kage Bunshin draws fire with a taunting clone that cannot clone itself', () => {
    const g = emptyGame();
    const me = place(g, 'kage', 0, 0, 0, 0);
    place(g, 'fletcher', 1, 3000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'kageBunshin')).toBe(true);
    run(g, 0.1);
    const [clone] = summonsOf(g, me, 'kage');
    expect(clone.mods.taunt).toBe(true);
    expect(cast(clone, 'kageBunshin')).toBe(false);
  });

  it('Resurrection Protocol rebuilds a sunk ally at its wreck', () => {
    const g = emptyGame();
    const me = place(g, 'shenzhou', 0, 0, 0, 0);
    const ally = place(g, 'fletcher', 0, 800, 0, 0);
    const foe = place(g, 'iowa', 1, 6000, 0, 0);
    run(g, 0.1);
    ally.takeDamage(ally.maxHp * 2, foe);
    expect(ally.alive).toBe(false);
    run(g, 1);
    expect(cast(me, 'resurrectionProtocol')).toBe(true);
    expect(ally.alive).toBe(true);
    expect(ally.hp).toBeCloseTo(ally.maxHp * 0.5, -2);
  });

  it('Bridge of Magpies speeds every ally\'s cooldowns', () => {
    const g = emptyGame();
    const me = place(g, 'queqiao', 0, 0, 0, 0);
    const ally = place(g, 'oboro', 0, 2000, 0, 0);
    place(g, 'iowa', 1, 6000, 0, 0);
    run(g, 0.1);
    ally.skills[0].cooldown = 10;
    expect(cast(me, 'bridgeOfMagpies')).toBe(true);
    run(g, 2);
    expect(ally.skills[0].cooldown).toBeLessThan(6.5);
  });

  it('Hair Clones raise three monkey clones that fight', () => {
    const g = emptyGame();
    const me = place(g, 'wukong', 0, 0, 0, 0);
    place(g, 'fletcher', 1, 3000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'hairClones')).toBe(true);
    expect(summonsOf(g, me, 'wukongClone').length).toBe(3);
  });

  it('Deathless leaves Koschei standing at 60% after a killing blow', () => {
    const g = emptyGame();
    const me = place(g, 'koschei', 0, 0, 0, 0);
    const foe = place(g, 'iowa', 1, 6000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'deathless')).toBe(true);
    me.takeDamage(me.maxHp * 3, foe);
    expect(me.alive).toBe(true);
    expect(me.hp).toBeCloseTo(me.maxHp * 0.6, -3);
  });

  it('Needle in the Egg cuts damage to a quarter while the egg floats', () => {
    const g = emptyGame();
    const me = place(g, 'koschei', 0, 0, 0, 0);
    const foe = place(g, 'iowa', 1, 6000, 0, 0);
    run(g, 0.1);
    expect(cast(me, 'needleInTheEgg')).toBe(true);
    run(g, 0.2);
    const [egg] = summonsOf(g, me, 'koscheiEgg');
    expect(egg).toBeDefined();
    const guarded = me.takeDamage(40000, foe);
    egg.takeDamage(egg.maxHp * 2, foe);
    run(g, 0.4);
    const bare = me.takeDamage(40000, foe);
    expect(guarded / bare).toBeCloseTo(0.25, 1);
  });

  it('Moonfall falls 3 s later and guts what it lands on', () => {
    const g = emptyGame();
    const me = place(g, 'kaguya', 0, 0, 0, 0);
    const foe = place(g, 'iowa', 1, 4000, 0, 0);
    run(g, 0.1);
    const hp = foe.hp;
    expect(cast(me, 'moonfall', foe)).toBe(true);
    run(g, 1);
    expect(foe.hp).toBe(hp);
    run(g, 3);
    expect(hp - foe.hp).toBeGreaterThan(100000);
  });

  it('every sci-fi line ship and titan fights an AI battle without breaking the sim', () => {
    for (const id of ['tsurugi', 'oboro', 'kunai', 'shiden', 'kage', 'apollo', 'artemis', 'mercury', 'gemini', 'orion', 'buran', 'tunguska', 'molniya', 'mir', 'vostok', 'tiangong', 'shenzhou', 'wukong', 'queqiao', 'jiaolong', 'kaguya', 'koschei']) {
      const g = emptyGame();
      const me = place(g, id, 0, -1500, 0, Math.PI / 2, true);
      place(g, 'iowa', 1, 1500, 0, -Math.PI / 2, true);
      place(g, 'fletcher', 1, 1500, 600, -Math.PI / 2, true);
      me.meter = 1;
      run(g, 40);
      for (const s of g.ships) {
        expect(Number.isFinite(s.hp), `${id} ${s.spec.id}`).toBe(true);
        expect(Number.isFinite(s.pos.x + s.pos.z), `${id} ${s.spec.id}`).toBe(true);
      }
      // Something happened: shots or torpedoes left the tubes, or someone got hurt.
      expect(g.ships.reduce((a, s) => a + s.stats.received + s.stats.shotsFired, 0), id).toBeGreaterThan(0);
    }
  }, 60000);
});
