import { describe, expect, it } from 'vitest';
import { REGEN_DELAY } from '../src/config';
import { Game } from '../src/core/Game';
import type { BattleConfig } from '../src/core/BattleSetup';
import { SHIPS } from '../src/data/ships';
import { UPGRADES } from '../src/modes/BossRush';
import { TITAN_POOLS } from '../src/skills/registry';
import { stun } from '../src/skills/kit';
import { activateConsumable } from '../src/ships/Consumables';
import { emptyGame, place, run } from './helpers';
import type { Ship } from '../src/ships/Ship';
import { SHIP_BY_ID } from '../src/data/ships';

describe('skills', () => {
  it('every skill of every ship (titans included) runs without breaking the sim', () => {
    for (const spec of SHIPS) {
      for (let i = 0; i < spec.skills.length; i++) {
        const g = emptyGame();
        const me = place(g, spec.id, 0, 0, 0, Math.PI / 2);
        const foe = place(g, 'iowa', 1, 1500, 300, -Math.PI / 2);
        place(g, 'fletcher', 1, 1300, -400, -Math.PI / 2);
        me.control.aimX = foe.pos.x;
        me.control.aimZ = foe.pos.z;
        me.meter = 1;
        run(g, 0.1);
        me.activateSkill(i);
        run(g, 8);
        for (const s of g.ships) {
          expect(Number.isFinite(s.hp), `${spec.id} skill ${i}`).toBe(true);
          expect(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.z), `${spec.id} skill ${i}`).toBe(true);
        }
      }
    }
    // Every skill of ~100 hulls, 8 s each: well past the default 5 s on a busy machine.
  }, 60_000);

  it('normal skills go on cooldown; the ultimate needs a full meter and empties it', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0);
    expect(w.activateSkill(1)).toBe(true);
    expect(w.skills[1].cooldown).toBeGreaterThan(20);
    run(g, 11);
    expect(w.activateSkill(1)).toBe(false);
    run(g, 14);
    expect(w.activateSkill(1)).toBe(true);
    w.meter = 0.5;
    expect(w.activateSkill(2)).toBe(false);
    w.meter = 1;
    expect(w.activateSkill(2)).toBe(true);
    expect(w.meter).toBe(0);
  });

  it('each of a titan\'s ultimates has its own meter', () => {
    const g = emptyGame();
    const t = place(g, 'raijin', 0, 0, 0);
    place(g, 'iowa', 1, 1500, 0, -Math.PI / 2);
    expect(t.ultIndices).toEqual([6, 7, 8]);
    const [a, b, c] = t.ultIndices.map((i) => t.skills[i]);
    expect(a.meter).toBeGreaterThan(b.meter);
    expect(b.meter).toBeGreaterThan(c.meter);
    t.meter = 1;
    run(g, 0.1);
    expect(t.activateSkill(6)).toBe(true);
    expect(a.meter).toBe(0);
    expect(c.meter).toBe(1);
    t.skills[8].meter = 0.2;
    t.charge(0.1);
    // The Colossus passive charges a titan's ultimates half again as fast.
    expect(t.skills[8].meter).toBeCloseTo(0.35);
    expect(t.activateSkill(7)).toBe(true);
  });

  it('dealing damage and sinking ships charge the ultimate meter', () => {
    const g = emptyGame();
    const a = place(g, 'iowa', 0, 0, 0);
    const b = place(g, 'fletcher', 1, 2000, 0);
    a.meter = 0;
    b.takeDamage(30000, a);
    const afterHit = a.meter;
    expect(afterHit).toBeGreaterThan(0.1);
    b.takeDamage(b.hp + 1, a);
    expect(a.meter).toBeGreaterThan(afterHit + 0.2);
  });

  it('a shield soaks damage before the hull', () => {
    const g = emptyGame();
    const w = place(g, 'warspite', 0, 0, 0);
    w.addShield(40000, 10);
    expect(w.takeDamage(30000, null)).toBe(0);
    expect(w.hp).toBe(w.maxHp);
    w.takeDamage(30000, null);
    expect(w.hp).toBeCloseTo(w.maxHp - 20000, 0);
    expect(w.shield).toBe(0);
  });

  it('a stunned ship cannot fire or use skills', () => {
    const g = emptyGame();
    const y = place(g, 'yamato', 0, 0, 0, Math.PI / 2);
    place(g, 'iowa', 1, 0, -3000);
    y.control.aimX = 0;
    y.control.aimZ = -3000;
    y.control.fire = true;
    y.slot = 0;
    y.addEffect({ id: 'debuff:stun', time: 3, apply: (m) => void (m.stunned = true) });
    run(g, 2.5);
    expect(y.stats.shotsFired).toBe(0);
    expect(y.activateSkill(0)).toBe(false);
  });

  it('Wave-Motion Cannon pierces every hull on its line', () => {
    const g = emptyGame();
    const y = place(g, 'yamato', 0, 0, 0, 0);
    const a = place(g, 'desmoines', 1, 0, -1200, Math.PI / 2);
    const b = place(g, 'iowa', 1, 0, -2600, Math.PI / 2);
    y.control.aimX = 0;
    y.control.aimZ = -2000;
    y.meter = 1;
    expect(y.activateSkill(2)).toBe(true);
    run(g, 3.5);
    expect(a.hp).toBeLessThan(a.maxHp - 50000);
    expect(b.hp).toBeLessThan(b.maxHp - 50000);
  });

  it('Tsar Lance stops at the first hull it touches', () => {
    const g = emptyGame();
    const s = place(g, 'stalingrad', 0, 0, 0, Math.PI / 2);
    const a = place(g, 'desmoines', 1, 0, -1200, Math.PI / 2);
    const b = place(g, 'iowa', 1, 0, -2600, Math.PI / 2);
    s.control.aimX = 0;
    s.control.aimZ = -2000;
    s.meter = 1;
    s.activateSkill(2);
    run(g, 3);
    expect(a.hp).toBeLessThan(a.maxHp - 50000);
    expect(b.hp).toBe(b.maxHp);
  });

  it('land blocks a beam', () => {
    const g = emptyGame('archipelago');
    const isl = g.map.islands.reduce((a, b) => (b.r > a.r ? b : a));
    const y = place(g, 'yamato', 0, isl.x - isl.r - 900, isl.z, Math.PI / 2);
    const t = place(g, 'iowa', 1, isl.x + isl.r + 600, isl.z, 0);
    y.control.aimX = t.pos.x;
    y.control.aimZ = t.pos.z;
    y.meter = 1;
    y.activateSkill(2);
    run(g, 3.5);
    expect(t.hp).toBe(t.maxHp);
  });

  it('strikes fall off with distance, and a shock ring hits each ship once', () => {
    const g = emptyGame();
    const me = place(g, 'belfast', 0, 0, 0);
    const near = place(g, 'iowa', 1, 2000, 0, 0);
    const far = place(g, 'iowa', 1, 2000, 300, 0);
    g.strikes.spawn(me, { kind: 'rod', skill: null, x: 2000, z: 0, radius: 400, delay: 0.5, damage: 40000 });
    run(g, 1);
    expect(near.maxHp - near.hp).toBeGreaterThan(far.maxHp - far.hp);
    expect(far.hp).toBeLessThan(far.maxHp);

    const g2 = emptyGame();
    const b = place(g2, 'belfast', 0, 0, 0);
    const e = place(g2, 'iowa', 1, 900, 0, 0);
    b.meter = 1;
    b.activateSkill(2);
    run(g2, 4);
    expect(e.maxHp - e.hp).toBeCloseTo(25000, -2);
  });

  it('a mine waits for a hull to come close', () => {
    const g = emptyGame();
    const me = place(g, 'gato', 0, 0, 0);
    const e = place(g, 'iowa', 1, 2000, 0, -Math.PI / 2);
    g.strikes.spawn(me, { kind: 'mine', skill: null, x: 1000, z: 0, radius: 70, delay: 1, damage: 15000, life: 60 });
    run(g, 2);
    expect(e.hp).toBe(e.maxHp);
    e.pos.x = 1020;
    run(g, 0.1);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('Ramming Speed hurts whatever the bow runs into', () => {
    const g = emptyGame();
    const b = place(g, 'bismarck', 0, 0, 0, Math.PI / 2);
    const e = place(g, 'desmoines', 1, 260, 0, 0);
    b.speed = b.maxSpeed;
    b.activateSkill(1);
    run(g, 6);
    expect(e.maxHp - e.hp).toBeGreaterThanOrEqual(25000);
  });
});

describe('sustain', () => {
  it('the repair kit puts out fires, heals, and restocks its charges', () => {
    const g = emptyGame();
    const s = place(g, 'iowa', 0, 0, 0);
    s.hp = s.maxHp * 0.5;
    s.startFire(0, null);
    s.startFlood(null);
    expect(activateConsumable(s, 0)).toBe(true);
    expect(s.fires.every((f) => f <= 0) && s.flooding <= 0).toBe(true);
    expect(s.startFire(1, null)).toBe(false);
    run(g, 6.5);
    expect(s.hp).toBeGreaterThan(s.maxHp * 0.68);
    const kit = s.consumables[0];
    expect(kit.charges).toBe(2);
    run(g, 76);
    expect(kit.charges).toBe(3);
  });

  it('hulls regenerate only after a lull in damage', () => {
    const g = emptyGame();
    const s = place(g, 'iowa', 0, 0, 0);
    const e = place(g, 'fletcher', 1, 3000, 0);
    s.takeDamage(50000, e);
    const hurt = s.hp;
    run(g, REGEN_DELAY - 1);
    expect(s.hp).toBe(hurt);
    run(g, 3);
    expect(s.hp).toBeGreaterThan(hurt);
  });

  it('sailing over a crate collects it', () => {
    const g = emptyGame();
    g.pickups.auto = false;
    const s = place(g, 'iowa', 0, 0, 0);
    s.hp = s.maxHp * 0.5;
    s.startFire(0, null);
    g.pickups.spawn('repair', 10, 10);
    run(g, 0.1);
    expect(g.pickups.items.length).toBe(0);
    expect(s.hp).toBeGreaterThan(s.maxHp * 0.74);
    expect(s.fires[0]).toBeLessThanOrEqual(0);
  });
});

function rushGame(shipId = 'iowa'): Game {
  const config: BattleConfig = {
    mode: 'solo',
    type: 'bossrush',
    mapId: 'open',
    teamSize: 1,
    difficulty: 'normal',
    players: [{ shipId, device: 'mouse' }],
    seed: 11,
    escorts: 0,
  };
  return new Game(config);
}

function wipeEnemies(g: Game): void {
  for (const s of g.ships) if (s.team === 1 && s.alive) s.sink(g.rush!.player);
}

describe('boss rush', () => {
  it('runs waves, offers three different refits, and sends a titan on wave 5', () => {
    const g = rushGame();
    const r = g.rush!;
    expect(r.player?.humanIndex).toBe(0);
    run(g, 5);
    expect(r.wave).toBe(1);
    expect(g.ships.filter((s) => s.team === 1).length).toBe(3);
    for (let w = 1; w < 5; w++) {
      wipeEnemies(g);
      run(g, 0.1);
      expect(r.phase).toBe('offer');
      expect(new Set(r.offer.map((u) => u.id)).size).toBe(3);
      expect(r.choose(0)).toBe(true);
      run(g, 5);
      expect(r.wave).toBe(w + 1);
    }
    expect(r.boss?.spec.id).toBe('leviathan');
    // A boss titan fills its three ultimates slower than a player titan would.
    expect(r.boss!.mods.ultChargeMul).toBeCloseTo(0.7);
    expect(r.taken.length).toBe(4);
    expect(r.score).toBeGreaterThan(0);
  });

  it('refits stack', () => {
    const g = rushGame();
    const p = g.rush!.player!;
    const dmg = UPGRADES.find((u) => u.id === 'damage')!;
    dmg.apply(p, g.rush!);
    dmg.apply(p, g.rush!);
    run(g, 0.1);
    expect(p.mods.damageMul).toBeCloseTo(1.15 * 1.15);
  });

  it('the run ends when the player sinks', () => {
    const g = rushGame();
    run(g, 5);
    const p = g.rush!.player!;
    p.takeDamage(p.hp + 1, null);
    run(g, 0.1);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(1);
  });
});

describe('titans', () => {
  const kitIndex = (s: Ship, id: string) => s.skills.findIndex((k) => k.spec.id === id);

  it('carry only titan skills, none of them shared with the line ships', () => {
    const titanIds = new Set(TITAN_POOLS.map((d) => d.spec.id));
    for (const spec of SHIPS) {
      for (const k of spec.skills) {
        if (spec.cls === 'TT') expect(titanIds.has(k.id), `${spec.id} ${k.id}`).toBe(true);
        else expect(titanIds.has(k.id), `${spec.id} ${k.id}`).toBe(false);
      }
    }
  });

  it('Colossus: a player titan takes a quarter less damage; a Boss Rush boss does not', () => {
    const g = emptyGame();
    const t = place(g, 'leviathan', 0, 0, 0);
    const foe = place(g, 'iowa', 1, 3000, 0);
    run(g, 0.1);
    expect(t.colossus).toBe(true);
    expect(t.takeDamage(10000, foe)).toBeCloseTo(7500);
    t.colossus = false;
    run(g, 0.1);
    expect(t.takeDamage(10000, foe)).toBeCloseTo(10000);
  });

  it('Hochseeflotte brings three Bismarcks into the line', () => {
    const g = emptyGame();
    const t = place(g, 'leviathan', 0, 0, 0);
    t.meter = 1;
    run(g, 0.1);
    expect(t.activateSkill(kitIndex(t, 'hochseeflotte'))).toBe(true);
    const wing = g.ships.filter((s) => s.summonOwner === t);
    expect(wing.map((s) => s.spec.id)).toEqual(['bismarck', 'bismarck', 'bismarck']);
    expect(wing.every((s) => s.team === 0 && s.hp === Math.round(SHIP_BY_ID.bismarck.hp * 0.7))).toBe(true);
    run(g, 36);
    expect(wing.every((s) => s.withdrawn)).toBe(true);
  });

  it('Juggernaut shrugs off stuns and slows', () => {
    const g = emptyGame();
    const t = place(g, 'leviathan', 0, 0, 0);
    run(g, 0.1);
    expect(t.activateSkill(kitIndex(t, 'juggernaut'))).toBe(true);
    stun(t, 3);
    t.addEffect({ id: 'debuff:cryo', time: 3, apply: (m) => void (m.speedMul *= 0.3) });
    run(g, 0.1);
    expect(t.mods.stunned).toBe(false);
    expect(t.mods.speedMul).toBeCloseTo(1.8);
  });

  it('a Calving Wall stops enemy shells that would have hit', () => {
    const hitsOn = (wall: boolean) => {
      const g = emptyGame();
      const h = place(g, 'habakkuk', 0, 0, 0, Math.PI / 2);
      const foe = place(g, 'iowa', 1, 0, -4000, Math.PI / 2);
      foe.control.aimX = 0;
      foe.control.aimZ = 0;
      h.control.aimX = 0;
      h.control.aimZ = -2000;
      run(g, 3);
      if (wall) expect(h.activateSkill(kitIndex(h, 'calvingWall'))).toBe(true);
      for (let i = 0; i < foe.turrets.length; i++) foe.fireTurret(i, 'AP', true);
      run(g, 8);
      return foe.stats.hits;
    };
    expect(hitsOn(false)).toBeGreaterThan(0);
    expect(hitsOn(true)).toBe(0);
  });

  it('Lightning Rod calls a bolt down on every main-battery hit', () => {
    const g = emptyGame();
    const r = place(g, 'raijin', 0, 0, 0, Math.PI / 2);
    const foe = place(g, 'iowa', 1, 0, -3500, Math.PI / 2);
    r.control.aimX = foe.pos.x;
    r.control.aimZ = foe.pos.z;
    let bolts = 0;
    g.events.on('skillHit', (e) => {
      if (e.skill.id === 'lightningRod') bolts++;
    });
    run(g, 3);
    expect(r.activateSkill(kitIndex(r, 'lightningRod'))).toBe(true);
    for (let i = 0; i < r.turrets.length; i++) r.fireTurret(i, 'AP', true);
    run(g, 7);
    expect(r.stats.hits).toBeGreaterThan(0);
    expect(bolts).toBe(r.stats.hits);
  });

  it('Takemikazuchi cuts every hull across a half circle once', () => {
    const g = emptyGame();
    const r = place(g, 'raijin', 0, 0, 0, Math.PI / 2);
    const foes = [place(g, 'iowa', 1, 2000, 0), place(g, 'iowa', 1, 0, -2500), place(g, 'iowa', 1, -2000, 0)];
    r.control.aimX = 0;
    r.control.aimZ = -2000;
    r.meter = 1;
    run(g, 0.1);
    expect(r.activateSkill(kitIndex(r, 'takemikazuchi'))).toBe(true);
    run(g, 3);
    for (const f of foes) expect(f.maxHp - f.hp).toBeGreaterThanOrEqual(149000);
  });
});
