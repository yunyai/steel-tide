import { describe, expect, it } from 'vitest';
import type { BattleConfig } from '../src/core/BattleSetup';
import { Game } from '../src/core/Game';
import type { ShipSpec } from '../src/core/types';
import { SHIP_BY_ID, titansOf } from '../src/data/ships';
import { buff } from '../src/skills/kit';
import type { Ship } from '../src/ships/Ship';
import { emptyGame, place, run } from './helpers';

const kitIndex = (s: Ship, id: string) => s.skills.findIndex((k) => k.spec.id === id);

/** Cast a ship's skill by id, with the reticle on `at` (a ship or a point). */
function cast(s: Ship, id: string, at?: Ship | { x: number; z: number }): boolean {
  if (at) {
    const p = 'pos' in at ? at.pos : at;
    s.control.aimX = p.x;
    s.control.aimZ = p.z;
  }
  s.meter = 1;
  return s.activateSkill(kitIndex(s, id));
}

/** A shell from `from` at the point (x, z), as its main battery would fire it. */
function fireAt(g: Game, from: Ship, x: number, z: number) {
  const main = from.spec.main!;
  return g.shells.fire(from, {
    ammo: 'AP',
    spec: main.ap!,
    table: from.tableFor('AP')!,
    fromX: from.pos.x,
    fromY: 20,
    fromZ: from.pos.z,
    toX: x,
    toZ: z,
    dmgMul: 1,
    guaranteedFire: false,
    railgun: false,
  });
}

describe('the new titans', () => {
  it('each new titan is its faction\'s, with six skills and three ultimates', () => {
    for (const id of ['brokkr', 'astraea', 'zhenghe', 'vanguard', 'constellation', 'nuwa']) {
      const s = SHIP_BY_ID[id];
      expect(s.cls, id).toBe('TT');
      expect(s.skills.length, id).toBe(9);
      expect(s.skills.filter((k) => k.ult).length, id).toBe(3);
      expect(s.skills.slice(6).every((k) => k.ult), id).toBe(true);
    }
  });
});

describe('Brokkr', () => {
  it('Oathstone holds any one hit to 0.5% of its hull, and to 4% for allies close by', () => {
    const g = emptyGame();
    const me = place(g, 'brokkr', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 1500, 0);
    const foe = place(g, 'iowa', 1, 6000, 0);
    run(g, 0.1);
    expect(cast(me, 'oathstone')).toBe(true);
    run(g, 0.5);
    me.takeDamage(500000, foe);
    ally.takeDamage(500000, foe);
    expect(me.stats.received).toBeLessThanOrEqual(me.maxHp * 0.005 + 1);
    expect(ally.stats.received).toBeLessThanOrEqual(ally.maxHp * 0.04 + 1);
    expect(ally.alive).toBe(true);
  });
});

describe('Astraea', () => {
  it('Inversion turns enemy damage into repair', () => {
    const g = emptyGame();
    const me = place(g, 'astraea', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 2000, 0);
    run(g, 0.1);
    me.hp = me.maxHp * 0.5;
    expect(cast(me, 'inversion')).toBe(true);
    run(g, 0.5);
    const hp = me.hp;
    expect(me.takeDamage(40000, foe)).toBe(0);
    expect(me.hp).toBeGreaterThan(hp + 20000);
  });

  it('Spell Mirror sends skill damage back to its caster', () => {
    const g = emptyGame();
    const me = place(g, 'astraea', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 2000, 0);
    run(g, 0.1);
    expect(cast(me, 'spellMirror')).toBe(true);
    run(g, 0.2);
    const hp = me.hp;
    me.takeDamage(30000, foe, foe.skills[0].spec);
    expect(me.hp).toBe(hp);
    expect(foe.stats.received).toBeGreaterThan(25000);
    // Gunfire is not magic: it still lands.
    me.takeDamage(30000, foe);
    expect(me.hp).toBeLessThan(hp);
  });

  it('Dispel ends an enemy field and strips buffs and shields', () => {
    const g = emptyGame();
    const me = place(g, 'astraea', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 4000, 0);
    run(g, 0.1);
    const field = g.fields.add(foe, { x: 4000, z: 300, r: 800, life: 20, look: 'storm' });
    buff(foe, 'test:rage', 20, (m) => {
      m.damageMul *= 2;
    });
    foe.addShield(30000, 20);
    run(g, 0.1);
    expect(cast(me, 'dispel', foe)).toBe(true);
    run(g, 0.1);
    expect(field.age).toBeGreaterThanOrEqual(field.life);
    expect(foe.effects.some((e) => e.id === 'test:rage')).toBe(false);
    expect(foe.shield).toBe(0);
  });

  it('Stasis holds an enemy shell in the air', () => {
    const g = emptyGame();
    const me = place(g, 'astraea', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 2500, 0);
    run(g, 0.1);
    expect(cast(me, 'stasis')).toBe(true);
    run(g, 0.1);
    const shell = fireAt(g, foe, 0, 0);
    run(g, 0.05);
    const x = shell.x;
    run(g, 1);
    expect(shell.x).toBe(x);
    expect(foe.mods.disarmed).toBe(true);
    expect(me.stats.received).toBe(0);
  });

  it('Grand Portal carries nearby allies to the reticle, shielded and with skills ready', () => {
    const g = emptyGame();
    const me = place(g, 'astraea', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 600, 0);
    place(g, 'iowa', 1, 12000, 8000);
    run(g, 0.1);
    ally.skills[0].cooldown = 20;
    expect(cast(me, 'grandPortal', { x: 3000, z: 0 })).toBe(true);
    expect(me.pos.x).toBeGreaterThan(2900);
    // Formation holds: the ally keeps its place off the flagship.
    expect(ally.pos.x - me.pos.x).toBeCloseTo(600, -2);
    expect(ally.shield).toBeGreaterThan(0);
    expect(ally.skills[0].cooldown).toBeLessThanOrEqual(0);
  });
});

describe('Zheng He', () => {
  it('Iron Chains echoes half of every hit onto the other chained ships', () => {
    const g = emptyGame();
    const me = place(g, 'zhenghe', 0, 0, 0);
    const a = place(g, 'iowa', 1, 4000, 0);
    const b = place(g, 'iowa', 1, 4300, 400);
    const c = place(g, 'iowa', 1, 3800, -400);
    run(g, 0.1);
    expect(cast(me, 'ironChains', a)).toBe(true);
    a.takeDamage(20000, me);
    expect(b.stats.received).toBeCloseTo(10000, 0);
    expect(c.stats.received).toBeCloseTo(10000, 0);
    // Echoes do not echo again.
    expect(a.stats.received).toBeCloseTo(20000, 0);
  });

  it('Straw Boats returns 40% of the shellfire it soaked up as missiles', () => {
    const g = emptyGame();
    const me = place(g, 'zhenghe', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 4000, 0);
    run(g, 0.1);
    expect(cast(me, 'strawBoats')).toBe(true);
    for (let i = 0; i < 4; i++) {
      g.events.emit('shellHit', { attacker: foe, target: me, outcome: 'penetration', damage: 25000, x: 0, y: 5, z: 0, caliber: 406, ammo: 'AP' });
    }
    run(g, 9);
    const mine = g.missiles.missiles.filter((m) => m.owner === me && m.skill?.id === 'strawBoats');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.reduce((sum, m) => sum + m.damage, 0)).toBeCloseTo(40000, -2);
    expect(mine.every((m) => m.target === foe)).toBe(true);
  });
});

describe('Vanguard', () => {
  it('Trident splits into eight warheads on eight different ships', () => {
    const g = emptyGame();
    const me = place(g, 'vanguard', 0, 0, 0);
    const foes: Ship[] = [];
    for (let i = 0; i < 10; i++) foes.push(place(g, 'fletcher', 1, 6000 + (i % 5) * 700, -1000 + Math.floor(i / 5) * 2000));
    run(g, 0.1);
    expect(cast(me, 'trident', { x: 7400, z: 0 })).toBe(true);
    const warheads = g.missiles.missiles.filter((m) => m.owner === me && m.skill?.id === 'trident');
    expect(warheads.length).toBe(8);
    expect(new Set(warheads.map((m) => m.target)).size).toBe(8);
    expect(warheads.every((m) => m.uninterceptable)).toBe(true);
    run(g, 20);
    expect(foes.filter((s) => s.stats.received > 0).length).toBeGreaterThanOrEqual(8);
  });

  it('Decks Awash halves gunfire but doubles torpedoes', () => {
    const g = emptyGame();
    const me = place(g, 'vanguard', 0, 0, 0);
    run(g, 0.1);
    const { damageTakenMul: d, torpTakenMul: t } = me.mods;
    expect(cast(me, 'decksAwash')).toBe(true);
    run(g, 0.1);
    expect(me.mods.damageTakenMul / d).toBeCloseTo(0.5, 5);
    // Torpedoes pass through the halving too, and still land twice as hard.
    expect((me.mods.damageTakenMul * me.mods.torpTakenMul) / (d * t)).toBeCloseTo(2, 5);
    expect(me.mods.scatterTakenMul).toBeGreaterThan(1.2);
  });
});

describe('Constellation', () => {
  it('Skyhook lifts its target out of the fight, then drops it hard', () => {
    const g = emptyGame();
    const me = place(g, 'constellation', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 3000, 0);
    run(g, 0.1);
    expect(cast(me, 'skyhook', foe)).toBe(true);
    run(g, 0.5);
    expect(foe.mods.banished).toBe(true);
    expect(foe.stats.received).toBe(0);
    run(g, 3);
    expect(foe.mods.banished).toBe(false);
    expect(foe.stats.received).toBeGreaterThan(30000);
    expect(foe.mods.stunned).toBe(true);
  });

  it('Brilliant Pebbles shoots down a strike falling on an ally', () => {
    const g = emptyGame();
    const me = place(g, 'constellation', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 800, 0);
    const foe = place(g, 'iowa', 1, 6000, 0);
    run(g, 0.1);
    const rod = g.strikes.spawn(foe, { kind: 'rod', skill: null, x: 800, z: 0, radius: 300, delay: 3, damage: 50000 });
    expect(cast(me, 'brilliantPebbles')).toBe(true);
    run(g, 4);
    expect(rod.alive).toBe(false);
    expect(ally.stats.received).toBe(0);
  });
});

describe('Nüwa', () => {
  it('Hive Mind spreads a hit evenly across the linked fleet', () => {
    const g = emptyGame();
    const me = place(g, 'nuwa', 0, 0, 0);
    const a = place(g, 'iowa', 0, 1000, 0);
    const b = place(g, 'iowa', 0, -1000, 0);
    const foe = place(g, 'iowa', 1, 8000, 0);
    run(g, 0.1);
    expect(cast(me, 'hiveMind')).toBe(true);
    a.takeDamage(30000, foe);
    expect(a.stats.received).toBeCloseTo(10000, 0);
    expect(b.stats.received).toBeCloseTo(10000, 0);
    expect(me.stats.received).toBeGreaterThan(5000);
  });

  it('Hijack turns an enemy torpedo back on its owner', () => {
    const g = emptyGame();
    const me = place(g, 'nuwa', 0, 0, 0);
    const foe = place(g, 'fletcher', 1, 4000, 0);
    run(g, 0.1);
    expect(cast(me, 'hijack')).toBe(true);
    const t = g.torps.launch(foe, 1300, 0, -Math.PI / 2, SHIP_BY_ID.fletcher.torpedoes!);
    run(g, 0.2);
    expect(t.team).toBe(me.team);
    expect(t.homing).toBe(foe);
    expect(t.owner).toBe(me);
  });

  it('Mend the Heavens turns repair past full hull into a shield', () => {
    const g = emptyGame();
    const me = place(g, 'nuwa', 0, 0, 0);
    const ally = place(g, 'iowa', 0, 1500, 0);
    run(g, 0.1);
    expect(cast(me, 'mendHeavens')).toBe(true);
    run(g, 3);
    expect(ally.hp).toBe(ally.maxHp);
    expect(ally.shield).toBeGreaterThan(ally.maxHp * 0.05);
    expect(ally.shield).toBeLessThanOrEqual(ally.maxHp * 0.5);
  });

  it('Assimilate rebuilds a sunk destroyer on her side at half hull', () => {
    const g = emptyGame();
    const me = place(g, 'nuwa', 0, 0, 0);
    const dd = place(g, 'fletcher', 1, 3000, 0);
    place(g, 'iowa', 1, 9000, 0);
    run(g, 0.1);
    expect(cast(me, 'assimilate', dd)).toBe(true);
    run(g, 0.2);
    const before = g.ships.length;
    dd.takeDamage(dd.hp + 1, me);
    run(g, 0.2);
    const risen = g.ships.slice(before);
    expect(risen.length).toBe(1);
    expect(risen[0].spec.id).toBe('fletcher');
    expect(risen[0].team).toBe(me.team);
    expect(risen[0].hp / risen[0].maxHp).toBeCloseTo(0.5, 1);
  });

  it('Slay the Black Dragon hits harder the more hull its target has lost', () => {
    const slay = (id: string, frac: number): { dmg: number; max: number } => {
      const g = emptyGame();
      const me = place(g, 'nuwa', 0, 0, 0);
      const foe = place(g, id, 1, 3000, 0);
      run(g, 0.1);
      foe.hp = foe.maxHp * frac;
      const hp = foe.hp;
      expect(cast(me, 'slayBlackDragon', foe)).toBe(true);
      return { dmg: hp - foe.hp, max: foe.maxHp };
    };
    const fresh = slay('iowa', 1);
    const hurt = slay('iowa', 0.5);
    expect(hurt.dmg - fresh.dmg).toBeGreaterThan(fresh.max * 0.2);
    // A titan's missing hull counts for far less.
    const titan = slay('brokkr', 0.5);
    expect(titan.dmg).toBeLessThan(fresh.dmg + titan.max * 0.1);
  });
});

describe('Boss Rush with four titans', () => {
  it('a new era\'s three boss waves bring three different titans, and every one can come', () => {
    for (const era of ['fantasy', 'modern', 'scifi'] as const) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 10; seed++) {
        const config: BattleConfig = {
          mode: 'solo',
          type: 'bossrush',
          mapId: 'open',
          teamSize: 1,
          escorts: 0,
          difficulty: 'normal',
          era,
          players: [{ shipId: titansOf(era)[0].id, device: 'mouse' }],
          seed,
        };
        const g = new Game(config);
        const rush = g.rush! as unknown as { titan(i: number): ShipSpec };
        const three = [0, 1, 2].map((i) => rush.titan(i).id);
        expect(new Set(three).size, `${era} ${seed}`).toBe(3);
        for (const id of three) {
          expect(titansOf(era).map((t) => t.id)).toContain(id);
          seen.add(id);
        }
      }
      expect(seen.size, era).toBe(4);
    }
  });
});

describe('new titans under the AI', () => {
  it('each fights a 40 s AI battle without breaking the sim', () => {
    for (const id of ['brokkr', 'astraea', 'zhenghe', 'vanguard', 'constellation', 'nuwa']) {
      const g = emptyGame();
      const me = place(g, id, 0, -1500, 0, Math.PI / 2, true);
      place(g, 'iowa', 1, 1500, 0, -Math.PI / 2, true);
      place(g, 'fletcher', 1, 1500, 600, -Math.PI / 2, true);
      place(g, 'atlanta', 1, 1800, -600, -Math.PI / 2, true);
      me.meter = 1;
      let casts = 0;
      g.events.on('skill', (e) => {
        if (e.ship === me) casts++;
      });
      run(g, 40);
      for (const s of g.ships) {
        expect(Number.isFinite(s.hp), `${id} ${s.spec.id}`).toBe(true);
        expect(Number.isFinite(s.pos.x + s.pos.z), `${id} ${s.spec.id}`).toBe(true);
      }
      expect(me.stats.damage, id).toBeGreaterThan(0);
      expect(casts, id).toBeGreaterThan(2);
    }
  }, 90000);
});
