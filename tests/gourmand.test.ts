import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/Game';
import type { Ship } from '../src/ships/Ship';
import { NEW_MISC } from '../src/data/miscTitans';
import { SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import { buff } from '../src/skills/kit';
import { GOURMAND_SKILLS } from '../src/skills/misc/gourmand';
import { miscBattery } from '../src/skills/misc/MiscBattery';
import {
  clearGourmand,
  GOURMAND,
  gourmandBlocksSkill,
  ingredient,
  nextFlavour,
  pantryTotal,
  swallowedBy,
  updateGourmand,
} from '../src/skills/misc/GourmandRuntime';
import { emptyGame, place, run } from './helpers';

// At heading 0 the Gourmand's bow, and its mouth, face -z.
// The Gourmand cooks by itself: every salvo spends one ingredient for a flavour, hitting salvos
// bring back scrap, and its skills chomp, carve, lob a pressure cooker and swallow ships whole.

function kitchen(): { g: Game; s: Ship } {
  const g = emptyGame();
  const s = place(g, 'gourmand', 0, 0, 0);
  return { g, s };
}

/** A hull that soaks every hit and stays put. */
function dummy(g: Game, x: number, z: number): Ship {
  const t = place(g, 'iowa', 1, x, z, Math.PI / 2);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 0;
  return t;
}

function lost(t: Ship): number {
  return t.maxHp - t.hp;
}

function aim(s: Ship, x: number, z: number): void {
  s.control.aimX = x;
  s.control.aimZ = z;
}

describe('Gourmand battery', () => {
  it('lobs high-arc 36k dishes every 7.5 s', () => {
    const main = NEW_MISC.find((s) => s.id === 'gourmand')!.main!;
    expect(main.look).toBe('dish');
    expect(main.ap!.damage).toBe(GOURMAND.battery.damage);
    expect(main.reload).toBe(GOURMAND.battery.reload);
    expect(main.ap!.velocity).toBeLessThan(1050);
  });

  it('flavours each salvo with the ingredient it holds most of, ties going shells, explosives, scrap', () => {
    expect(nextFlavour({ shells: 0, explosives: 0, wreckage: 0 })).toBeNull();
    expect(nextFlavour({ shells: 2, explosives: 2, wreckage: 2 })).toBe('shells');
    expect(nextFlavour({ shells: 1, explosives: 2, wreckage: 2 })).toBe('explosives');
    expect(nextFlavour({ shells: 1, explosives: 0, wreckage: 3 })).toBe('wreckage');
  });

  it('spends one ingredient a salvo; a shell salvo hits 40% harder and pierces', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -2000);
    s.gourmand!.pantry = { shells: 3, explosives: 1, wreckage: 0 };
    const r = miscBattery(s, 0)!;
    expect(s.gourmand!.pantry).toEqual({ shells: 2, explosives: 1, wreckage: 0 });
    expect(r.hitMul!(t)).toBeCloseTo(GOURMAND.flavour.shellMul);
    expect(r.pierce).toBe(true);
    expect(r.fire).toBeFalsy();
  });

  it('lobs a shell salvo on the mortar arc: it pierces hulls but never flies flat like a railgun', () => {
    const { g, s } = kitchen();
    dummy(g, 0, -3000);
    s.gourmand!.pantry = { shells: 6, explosives: 0, wreckage: 0 };
    aim(s, 0, -3000);
    s.control.fire = true;
    run(g, 0.2);
    const dishes = g.shells.shells.filter((x) => x.owner === s);
    expect(dishes.length).toBeGreaterThan(0);
    for (const d of dishes) {
      expect(d.straight).toBe(false);
      expect(d.railgun).toBe(false);
      expect(d.pierce).toBeGreaterThan(0);
    }
  });

  it('splashes 250 m around every dish, and an explosive dish half as wide again and on fire', () => {
    const { g, s } = kitchen();
    const near = dummy(g, 0, -3000);
    const far = dummy(g, 0, -3000 + GOURMAND.battery.splash + 80);
    miscBattery(s, 0)!.onLand(0, -3000);
    expect(lost(near)).toBeCloseTo(GOURMAND.battery.splashDamage);
    expect(lost(far)).toBe(0);
    s.gourmand!.pantry = { shells: 0, explosives: 1, wreckage: 0 };
    const r = miscBattery(s, 0)!;
    expect(r.fire).toBe(true);
    r.onLand(0, -3000);
    expect(lost(far)).toBeCloseTo(GOURMAND.battery.splashDamage);
  });

  it('throws a shrapnel ring and knocks hulls back with a scrap dish', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -3000 + GOURMAND.flavour.shrapnel - 50);
    s.gourmand!.pantry = { shells: 0, explosives: 0, wreckage: 1 };
    miscBattery(s, 0)!.onLand(0, -3000);
    expect(lost(t)).toBeCloseTo(GOURMAND.flavour.shrapnelDamage);
    expect(Math.hypot(t.pushX, t.pushZ)).toBeGreaterThan(0);
  });

  it('brings back one scrap for each salvo that hits, however many rounds strike', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -2000);
    const r = miscBattery(s, 0)!;
    r.onHit(t, t.pos.x, t.pos.z);
    r.onHit(t, t.pos.x, t.pos.z);
    expect(s.gourmand!.pantry.wreckage).toBe(1);
  });
});

describe('Gourmand skills', () => {
  it('Devour eats incoming rounds for a heal, pulls ships ahead to the mouth and chomps them', () => {
    const { g, s } = kitchen();
    const ahead = dummy(g, 0, -s.spec.length / 2 - 900);
    const behind = dummy(g, 0, s.spec.length / 2 + 900);
    // A twin kitchen with nothing to eat measures the hull's own repairs.
    const twin = kitchen();
    for (const k of [s, twin.s]) k.hp = k.maxHp / 2;
    g.torps.launch(ahead, 0, -250, Math.PI, SHIP_BY_ID.stepper.torpedoes!);
    expect(s.activateSkill(0)).toBe(true);
    expect(twin.s.activateSkill(0)).toBe(true);
    run(g, 1 / 30);
    run(twin.g, 1 / 30);
    expect(s.gourmand!.pantry.explosives).toBe(1);
    expect(s.hp - twin.s.hp).toBeCloseTo(GOURMAND.devour.heal, -1);
    const from = ahead.pos.z;
    run(g, 1);
    expect(ahead.pos.z).toBeGreaterThan(from + 50);
    expect(behind.pos.z).toBeCloseTo(s.spec.length / 2 + 900, -1);
    // Parked inside the chomp, a hull loses 50k a second, give or take one bite.
    const mouth = s.localToWorld(s.spec.length * 0.5 + 95, 0, 0);
    ahead.pos.set(mouth.x, 0, mouth.z - 100);
    const before = lost(ahead);
    run(g, 2);
    expect(Math.abs(lost(ahead) - before - 2 * GOURMAND.devour.dps)).toBeLessThanOrEqual(GOURMAND.devour.dps * GOURMAND.devour.tick + 1);
  });

  it('Carve slices everything within 900 m for 180k, bleeds 15k/s for 4 s and supplies scrap', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -800);
    expect(s.activateSkill(1)).toBe(true);
    expect(lost(t)).toBe(GOURMAND.carve.damage);
    expect(s.gourmand!.pantry.wreckage).toBe(GOURMAND.carve.scrap);
    run(g, GOURMAND.carve.bleedTime + 0.5);
    expect(lost(t)).toBeCloseTo(GOURMAND.carve.damage + GOURMAND.carve.bleed * GOURMAND.carve.bleedTime);
  });

  it('the Pressure Cooker whistles for 1.5 s, then bursts for 200k + 15k per ingredient, spending up to 10', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -2000);
    aim(s, 0, -2000);
    // No explosives: their fires would burn this dummy's huge hull for far more than the pot.
    s.gourmand!.pantry = { shells: 4, explosives: 0, wreckage: 8 };
    expect(s.activateSkill(2)).toBe(true);
    expect(pantryTotal(s.gourmand!.pantry)).toBe(2);
    const shells = 4 - s.gourmand!.pantry.shells;
    run(g, GOURMAND.cooker.fuse - 0.1);
    expect(lost(t)).toBe(0);
    run(g, 0.3);
    // The shells focus on the hull nearest the pot.
    expect(lost(t)).toBeCloseTo(GOURMAND.cooker.damage + 10 * GOURMAND.cooker.perIngredient + shells * GOURMAND.cooker.focus);
    expect(Math.hypot(t.pushX, t.pushZ)).toBeGreaterThan(0);
  });

  it('an empty Pressure Cooker still bursts for its base damage', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -2000);
    aim(s, 0, -2000);
    expect(s.activateSkill(2)).toBe(true);
    run(g, 2);
    expect(lost(t)).toBe(GOURMAND.cooker.damage);
  });

  it('Skewer hits for 150k, reels the ship in, and chomps it for 100k and two scrap when it arrives', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -1000);
    aim(s, 0, -1000);
    expect(s.activateSkill(3)).toBe(true);
    expect(lost(t)).toBe(GOURMAND.skewer.damage);
    run(g, GOURMAND.skewer.time + 0.5);
    expect(lost(t)).toBe(GOURMAND.skewer.damage + GOURMAND.skewer.chomp);
    expect(s.gourmand!.pantry.wreckage).toBe(GOURMAND.skewer.scrap);
  });

  it('Skewer cannot reel in a ship braced against knockback', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -1000);
    buff(t, 'test:braced', 30, (m) => {
      m.knockImmune = true;
    });
    run(g, 1 / 60);
    aim(s, 0, -1000);
    expect(s.activateSkill(3)).toBe(true);
    expect(lost(t)).toBe(GOURMAND.skewer.damage);
    run(g, GOURMAND.skewer.time + 0.5);
    expect(t.pos.z).toBeCloseTo(-1000, 0);
  });

  it('Devour cannot pull in a CC-immune ship', () => {
    const { g, s } = kitchen();
    const ahead = dummy(g, 0, -s.spec.length / 2 - 900);
    buff(ahead, 'test:immune', 30, (m) => {
      m.ccImmune = true;
    });
    run(g, 1 / 60);
    const from = ahead.pos.z;
    expect(s.activateSkill(0)).toBe(true);
    run(g, 1);
    expect(ahead.pos.z).toBeCloseTo(from, 0);
  });

  it('Serve lands a 150k dish and spends three of its flavour', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -2000);
    aim(s, 0, -2000);
    // Scrap: its shrapnel ring flies past the hull at the centre, which takes the plate alone.
    s.gourmand!.pantry = { shells: 1, explosives: 0, wreckage: 5 };
    expect(s.activateSkill(4)).toBe(true);
    expect(s.gourmand!.pantry).toEqual({ shells: 1, explosives: 0, wreckage: 2 });
    run(g, GOURMAND.serve.delay + 0.1);
    expect(lost(t)).toBe(GOURMAND.serve.damage);
  });

  it('Comfort Food heals and shields by the pantry, then burps a 60k shockwave', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -500);
    s.hp = s.maxHp / 2;
    s.gourmand!.pantry = { shells: 2, explosives: 2, wreckage: 1 };
    const hp = s.hp;
    expect(s.activateSkill(5)).toBe(true);
    expect(s.hp - hp).toBeCloseTo(s.maxHp * GOURMAND.comfort.heal + 5 * GOURMAND.comfort.perHeal);
    expect(s.shield).toBe(GOURMAND.comfort.shield + 5 * GOURMAND.comfort.perShield);
    expect(pantryTotal(s.gourmand!.pantry)).toBe(0);
    run(g, GOURMAND.comfort.burpDelay + 0.1);
    expect(lost(t)).toBe(GOURMAND.comfort.burpDamage);
    expect(Math.hypot(t.pushX, t.pushZ)).toBeGreaterThan(0);
  });

  it('Banquet serves only enemies the Gourmand can see, never one hidden in smoke', () => {
    const { g, s } = kitchen();
    const hidden = dummy(g, 0, -1500);
    const a = dummy(g, 0, -2500);
    const b = dummy(g, 0, -3200);
    // Keep the smoke over the hidden hull for the whole test.
    for (let i = 0; i < 4; i++) g.addSmoke(hidden.pos.x, hidden.pos.z, 1);
    s.meter = 1;
    expect(s.activateSkill(6)).toBe(true);
    const served: number[] = [];
    g.events.on('miscTitan', (e) => e.kind === 'side' && served.push(e.target!.id));
    run(g, 1.5);
    expect(served).not.toContain(hidden.id);
    expect(lost(hidden)).toBe(0);
    expect(lost(a)).toBeGreaterThan(0);
    expect(lost(b)).toBeGreaterThan(0);
  });

  it('Banquet serves side dishes at two enemies each second, widens the pantry and shrinks it after', () => {
    const { g, s } = kitchen();
    const a = dummy(g, 0, -2000);
    const b = dummy(g, 1500, -2000);
    const c = dummy(g, -1500, -2000);
    s.meter = 1;
    expect(s.activateSkill(6)).toBe(true);
    ingredient(s, 'shells', 40);
    expect(pantryTotal(s.gourmand!.pantry)).toBe(GOURMAND.banquetCapacity);
    run(g, 2.7);
    const served = [a, b, c].map(lost).reduce((x, y) => x + y, 0);
    // Three volleys (at 0, 1 and 2 s) of two dishes.
    expect(served).toBeCloseTo(6 * GOURMAND.banquet.side);
    run(g, GOURMAND.banquet.time);
    expect(pantryTotal(s.gourmand!.pantry)).toBe(GOURMAND.capacity);
  });

  it('Swallow Whole warns, bites for 200k, digests 120k a second and spits the ship out for 200k', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -700);
    aim(s, 0, -700);
    s.meter = 1;
    expect(s.activateSkill(7)).toBe(true);
    expect(swallowedBy(g, t)).toBeNull();
    run(g, GOURMAND.swallow.warning + 0.05);
    expect(swallowedBy(g, t)).toBe(s);
    expect(lost(t)).toBe(GOURMAND.swallow.bite);
    run(g, GOURMAND.swallow.time + 0.3);
    expect(swallowedBy(g, t)).toBeNull();
    expect(lost(t)).toBeCloseTo(GOURMAND.swallow.bite + GOURMAND.swallow.digest * GOURMAND.swallow.time + GOURMAND.swallow.spit, -3);
    expect(g.map.heightAt(t.pos.x, t.pos.z)).toBeLessThan(-6);
  });

  it('Kitchen Catastrophe bursts after 1 s for 500k + 25k per ingredient and leaves a burning oil slick', () => {
    const { g, s } = kitchen();
    const t = dummy(g, 0, -1200);
    s.gourmand!.pantry = { shells: 0, explosives: 0, wreckage: 4 };
    s.meter = 1;
    expect(s.activateSkill(8)).toBe(true);
    run(g, GOURMAND.catastrophe.fuse - 0.1);
    expect(lost(t)).toBe(0);
    run(g, 0.15);
    expect(lost(t)).toBe(GOURMAND.catastrophe.damage + 4 * GOURMAND.catastrophe.perIngredient);
    const oil = g.fields.fields.find((f) => f.owner === s);
    expect(oil).toMatchObject({ dps: GOURMAND.catastrophe.oil, look: 'fire' });
    expect(oil!.r).toBeGreaterThan(0);
  });
});

describe('Gourmand pantry and swallowing', () => {
  it('eats hostile bow projectiles exactly once and leaves friendlies, distant and submerged torpedoes alone', () => {
    const { g, s } = kitchen();
    const enemy = place(g, 'stepper', 1, 0, -2500);
    const spec = SHIP_BY_ID.stepper.torpedoes!;
    const incoming = g.torps.launch(enemy, 0, -250, Math.PI, spec);
    const friendly = g.torps.launch(s, 0, -250, Math.PI, spec);
    const behind = g.torps.launch(enemy, 0, 250, Math.PI, spec);
    const deep = g.torps.launch(enemy, 0, -250, Math.PI, spec);
    deep.deep = true;
    s.activateSkill(0);
    updateGourmand(s, 1 / 60);
    updateGourmand(s, 1 / 60);
    expect(incoming.alive).toBe(false);
    expect(friendly.alive).toBe(true);
    expect(behind.alive).toBe(true);
    expect(deep.alive).toBe(true);
    expect(s.gourmand!.pantry.explosives).toBe(1);
  });

  it('caps the pantry and eats a sinking wreck only once, for three scrap', () => {
    const { g, s } = kitchen();
    ingredient(s, 'shells', 50);
    expect(s.gourmand!.pantry.shells).toBe(GOURMAND.capacity);
    s.gourmand!.pantry = { shells: 0, explosives: 0, wreckage: 0 };
    const enemy = place(g, 'stepper', 1, 0, -2500);
    enemy.takeDamage(1e9, s);
    enemy.pos.set(0, 0, -250);
    s.activateSkill(0);
    updateGourmand(s, 1 / 60);
    g.time += 1;
    updateGourmand(s, 1);
    expect(s.gourmand!.pantry.wreckage).toBe(3);
  });

  it('releases a swallowed ship when cleared and blocks its attacks but not its defences', () => {
    const { g, s } = kitchen();
    const t = place(g, 'stepper', 1, 0, -700);
    aim(s, 0, -700);
    s.meter = 1;
    s.activateSkill(7);
    run(g, 1);
    expect(swallowedBy(g, t)).toBe(s);
    expect(gourmandBlocksSkill(g, t, 1)).toBe(true);
    expect(gourmandBlocksSkill(g, t, 5)).toBe(false);
    clearGourmand(s);
    expect(swallowedBy(g, t)).toBeNull();
  });

  it('lets a defensive teleport escape without snapping the victim back', () => {
    const { g, s } = kitchen();
    const t = place(g, 'stepper', 1, 0, -700);
    aim(s, 0, -700);
    s.meter = 1;
    s.activateSkill(7);
    run(g, 1);
    expect(swallowedBy(g, t)).toBe(s);
    t.pos.x = 3000;
    t.pos.z = 0;
    updateGourmand(s, 1 / 60);
    expect(swallowedBy(g, t)).toBeNull();
    expect(t.pos.x).toBe(3000);
  });

  it('does not swallow an invulnerable enemy', () => {
    const { g, s } = kitchen();
    const t = place(g, 'stepper', 1, 0, -700);
    aim(s, 0, -700);
    s.meter = 1;
    s.activateSkill(7);
    g.time += GOURMAND.swallow.warning;
    t.mods.invulnerable = true;
    updateGourmand(s, 1 / 60);
    expect(swallowedBy(g, t)).toBeNull();
  });

  it('gives every AI heuristic the normal skill interface', () => {
    const { g, s } = kitchen();
    const t = place(g, 'stepper', 1, 0, -900);
    GOURMAND_SKILLS.forEach((k, i) => expect(() => k.impl.aiShouldUse(s, g, t, s.skills[i])).not.toThrow());
  });

  it('replays deterministically and hashes the kitchen, with no cooked meal left in it', () => {
    const games = [emptyGame(), emptyGame()];
    for (const g of games) {
      const s = place(g, 'gourmand', 0, 0, 0);
      const t = place(g, 'stepper', 1, 0, -700);
      aim(s, t.pos.x, t.pos.z);
      s.gourmand!.pantry = { shells: 3, explosives: 3, wreckage: 3 };
      s.activateSkill(2);
      s.meter = 1;
      s.activateSkill(7);
      run(g, 2);
    }
    const [a, b] = games;
    expect(stateHash(a)).toBe(stateHash(b));
    expect('cooked' in a.ships[0].gourmand!).toBe(false);
    a.ships[0].gourmand!.pantry.shells++;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});
