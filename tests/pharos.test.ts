import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/Game';
import { DEG, bearingTo, wrapAngle } from '../src/core/math';
import type { Ship } from '../src/ships/Ship';
import { stateHash } from '../src/net/hash';
import { miscBattery } from '../src/skills/misc/MiscBattery';
import { PHAROS_SKILLS } from '../src/skills/misc/pharos';
import { beamCatches, beamReach, exposureOf, isLit, litRecord, nextPass, PHAROS, pharosBeams, pharosDamage, pharosHold, sweepRate } from '../src/skills/misc/PharosRuntime';
import { emptyGame, place, run } from './helpers';

// Bearing 0 points along -z and grows clockwise, so +x is 90° and +z is 180°. The lamp starts at 0
// and sweeps clockwise at 36° a second.

const [HOLD, LANCE, COUNTER, DAZZLE, BUOY, DARK, TWIN, DAYBREAK, FALSE_LIGHT] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const P = PHAROS;

function light(): { g: Game; s: Ship } {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'pharos', 0, 0, 0);
  s.throttle = 2;
  s.secondaries.length = 0;
  return { g, s };
}

/** A hull that soaks every hit, holds its fire and stays put, bow to the north; it cannot burn unless `burns`. */
function dummy(g: Game, x: number, z: number, id = 'iowa', burns = false): Ship {
  const t = place(g, id, 1, x, z, 0);
  t.hp = t.maxHp = 1e8;
  t.secondaries.length = 0;
  t.throttle = 2;
  if (!burns)
    t.addEffect({
      id: 'test:fireproof',
      time: 1e9,
      apply(m) {
        m.fireImmune = true;
      },
    });
  return t;
}

/** Points the lamp at `deg` and stops ordinary sweeping from muddying a measurement. */
function point(s: Ship, deg: number): void {
  s.pharos!.bearing = wrapAngle(deg * DEG);
}

function cast(s: Ship, i: number): boolean {
  s.skills[i].cooldown = 0;
  s.skills[i].meter = 1;
  return s.activateSkill(i);
}

const lost = (t: Ship) => t.maxHp - t.hp;

describe('the Pharos kit', () => {
  it('has six normals and three ultimates with their own names', () => {
    expect(PHAROS_SKILLS).toHaveLength(9);
    expect(PHAROS_SKILLS.map((d) => !!d.spec.ult)).toEqual([false, false, false, false, false, false, true, true, true]);
    expect(new Set(PHAROS_SKILLS.map((d) => d.spec.name)).size).toBe(9);
    for (const d of PHAROS_SKILLS) expect(d.spec.description).not.toMatch(/undefined|NaN/);
  });
});

describe('the sweep', () => {
  it('turns clockwise once every ten seconds', () => {
    const { g, s } = light();
    run(g, 2.5);
    expect(s.pharos!.bearing / DEG).toBeCloseTo(90, 0);
    expect(sweepRate(s)).toBeCloseTo(P.spin, 6);
    run(g, 7.5);
    expect(Math.abs(wrapAngle(s.pharos!.bearing))).toBeLessThan(1 * DEG);
  });

  it('lights a ship as it crosses and adds one Exposure a crossing', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    run(g, 2);
    expect(isLit(s, t)).toBe(false);
    expect(exposureOf(s, t)).toBe(0);
    run(g, 0.6);
    expect(isLit(s, t)).toBe(true);
    expect(exposureOf(s, t)).toBe(1);
    expect(t.mods.revealed).toBe(true);
    // Still inside the beam: no second stack until it comes round again.
    run(g, 0.2);
    expect(exposureOf(s, t)).toBe(1);
    run(g, 10);
    expect(exposureOf(s, t)).toBe(2);
  });

  it('keeps Exposure through one dark turn and lets it fade after that', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    run(g, 2.6);
    const r = litRecord(s, t)!;
    r.stacks = 3;
    // Shutter the lamp for good, with no flare due.
    s.pharos!.darkUntil = 1e9;
    const until = r.until;
    run(g, until - g.time + P.darkGrace + P.decay - 0.2);
    expect(exposureOf(s, t)).toBe(3);
    run(g, 0.4);
    expect(exposureOf(s, t)).toBe(2);
    run(g, P.decay * 2 + 0.2);
    expect(exposureOf(s, t)).toBe(0);
    expect(litRecord(s, t)).toBeUndefined();
  });

  it('never lights its own side', () => {
    const { g, s } = light();
    const friend = place(g, 'iowa', 0, 1500, 0);
    friend.throttle = 2;
    run(g, 4);
    expect(litRecord(s, friend)).toBeUndefined();
  });

  it('says when the beam will next reach a ship', () => {
    const { g, s } = light();
    const t = dummy(g, 0, 1500);
    const eta = nextPass(s, t)!;
    expect(eta).toBeGreaterThan(4.3);
    expect(eta).toBeLessThan(5);
    run(g, eta + 0.05);
    expect(nextPass(s, t)).toBe(0);
    expect(isLit(s, t)).toBe(true);
    const far = dummy(g, 0, -4200);
    expect(nextPass(s, far)).toBeNull();
  });
});

describe('shadows', () => {
  function shadowed() {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    expect(g.map.addDynamicRidge({ id: 1, owner: 99, x0: 700, z0: -150, x1: 700, z1: 150, width: 60, height: 75, expiresAt: 1e9 })).toBe(true);
    return { g, s, t };
  }

  it('cannot light a ship behind land, and draws its beam only as far', () => {
    const { g, s, t } = shadowed();
    run(g, 4);
    expect(litRecord(s, t)).toBeUndefined();
    expect(beamReach(s, 90 * DEG, P.range)).toBeLessThan(700);
    expect(beamReach(s, 0, P.range)).toBe(P.range);
    point(s, 90);
    expect(beamCatches(s, t.pos.x, t.pos.z, 60)).toBe(false);
  });

  it('reaches behind land through a lens buoy the beam can see', () => {
    const { g, s, t } = shadowed();
    s.control.aimX = 1450;
    s.control.aimZ = 400;
    expect(cast(s, BUOY)).toBe(true);
    run(g, 4);
    expect(isLit(s, t)).toBe(true);
    expect(exposureOf(s, t)).toBe(1);
    expect(lost(t)).toBeGreaterThan(0);
  });
});

describe('the flare battery', () => {
  it('hits harder for each Exposure and lights what it strikes', () => {
    const { g, s } = light();
    const t = dummy(g, 0, 1500);
    const rider = miscBattery(s, 0)!;
    expect(rider.hitMul!(t)).toBe(1);
    rider.onHit(t, t.pos.x, t.pos.z);
    expect(isLit(s, t)).toBe(true);
    expect(exposureOf(s, t)).toBe(0);
    litRecord(s, t)!.stacks = 5;
    expect(miscBattery(s, 0)!.hitMul!(t)).toBeCloseTo(1 + 5 * P.battery.perExposure, 6);
    void g;
  });
});

describe('Hold the Light', () => {
  it('swings the beam onto the reticle, burns what it holds and resumes the sweep', () => {
    const { g, s } = light();
    const t = dummy(g, 0, 1500);
    s.control.aimX = t.pos.x;
    s.control.aimZ = t.pos.z;
    expect(cast(s, HOLD)).toBe(true);
    run(g, 1.5);
    expect(Math.abs(wrapAngle(s.pharos!.bearing - 180 * DEG))).toBeLessThan(0.5 * DEG);
    expect(sweepRate(s)).toBe(0);
    run(g, P.hold.time - 1.5 + 0.1);
    // In the beam from about 1.1 s: one crossing, five burn ticks and an Exposure every second tick.
    expect(exposureOf(s, t)).toBeGreaterThanOrEqual(3);
    expect(lost(t)).toBeGreaterThan(P.hold.burn * 2);
    const held = s.pharos!.bearing;
    run(g, 1);
    expect(wrapAngle(s.pharos!.bearing - held) / DEG).toBeCloseTo(36, 0);
  });
});

describe('Lance of Light', () => {
  it('fires along the bearing it was cast on, not where the sweep has got to', () => {
    const { g, s } = light();
    const on = dummy(g, 1500, 0);
    // The sweep reaches this one during the wind-up; the lance does not.
    const later = dummy(g, 1500 * Math.sin(110 * DEG), -1500 * Math.cos(110 * DEG));
    point(s, 90);
    expect(cast(s, LANCE)).toBe(true);
    expect(lost(on)).toBe(0);
    run(g, P.lance.warning + 0.05);
    expect(lost(on)).toBeGreaterThan(0);
    expect(lost(later)).toBe(0);
    expect(isLit(s, later)).toBe(true);
    expect(s.pharos!.lance).toBeNull();
  });

  it('adds damage for each Exposure', () => {
    const hit = (stacks: number) => {
      const { g, s } = light();
      const t = dummy(g, 1500, 0);
      point(s, 90);
      run(g, 1 / 60);
      litRecord(s, t)!.stacks = stacks;
      litRecord(s, t)!.gainedAt = g.time;
      point(s, 90);
      cast(s, LANCE);
      run(g, P.lance.warning + 0.05);
      return lost(t);
    };
    expect(hit(4) / hit(0)).toBeCloseTo(pharosDamage.lance(4) / pharosDamage.lance(0), 2);
  });

  it('sets a lit hull alight', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0, 'iowa', true);
    point(s, 90);
    run(g, 2 / 60);
    point(s, 90);
    cast(s, LANCE);
    run(g, P.lance.warning + 0.05);
    expect(t.fires.some((f) => f > 0)).toBe(true);
  });

  it('bursts out of a buoy on its line', () => {
    const { g, s } = light();
    // Bow north, so this hull lies 169 m and more off the line: clear of the lance, inside the burst.
    const t = dummy(g, 1000, 300);
    s.control.aimX = 1000;
    s.control.aimZ = 0;
    cast(s, BUOY);
    s.pharos!.buoys[0].flaredAt = 1e9;
    point(s, 90);
    cast(s, LANCE);
    run(g, P.lance.warning + 0.05);
    expect(lost(t)).toBeGreaterThan(0);
  });

  it('fails for free while the lamp is shuttered', () => {
    const { g, s } = light();
    cast(s, DARK);
    expect(cast(s, LANCE)).toBe(false);
    expect(s.skills[LANCE].cooldown).toBe(0);
    expect(s.skillFailure).toMatch(/shuttered/);
    void g;
  });
});

describe('Counter-sweep', () => {
  it('turns the sweep round, speeds it up and scorches what it crosses', () => {
    const { g, s } = light();
    const t = dummy(g, -1500 * Math.sin(40 * DEG), -1500 * Math.cos(40 * DEG));
    run(g, 0.5);
    expect(cast(s, COUNTER)).toBe(true);
    expect(s.pharos!.dir).toBe(-1);
    expect(sweepRate(s)).toBeCloseTo(-P.spin * P.counter.speed, 6);
    run(g, 1);
    expect(lost(t)).toBeGreaterThan(0);
    expect(exposureOf(s, t)).toBe(1);
    run(g, P.counter.time);
    expect(sweepRate(s)).toBeCloseTo(-P.spin, 6);
  });

  it('scorches the ship the beam is already on', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    point(s, 90);
    run(g, 2 / 60);
    expect(lost(t)).toBe(0);
    cast(s, COUNTER);
    run(g, 2 / 60);
    expect(lost(t)).toBeGreaterThan(0);
    expect(exposureOf(s, t)).toBe(2);
  });
});

describe('Dazzle', () => {
  it('fails for free with nothing lit', () => {
    const { g, s } = light();
    dummy(g, 0, 1500);
    expect(cast(s, DAZZLE)).toBe(false);
    expect(s.skills[DAZZLE].cooldown).toBe(0);
    expect(s.skillFailure).toMatch(/no ship is lit/);
  });

  it('hurts every lit ship and scatters its guns', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    const dark = dummy(g, 0, 1500);
    point(s, 90);
    run(g, 2 / 60);
    expect(cast(s, DAZZLE)).toBe(true);
    run(g, 2 / 60);
    expect(lost(t)).toBeGreaterThan(0);
    expect(lost(dark)).toBe(0);
    expect(t.mods.dispersionMul).toBeCloseTo(P.dazzle.scatter, 6);
    expect(t.mods.reachMul).toBeCloseTo(P.dazzle.reach, 6);
    expect(pharosHold(t)!.record!.dazzledUntil).toBeGreaterThan(g.time);
    run(g, P.dazzle.time + 0.1);
    expect(t.mods.dispersionMul).toBe(1);
  });
});

describe('Lens Buoy', () => {
  it('keeps three, needs water and flares each time a beam crosses it', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 300);
    for (const [x, z] of [
      [1500, 0],
      [-1000, 0],
      [0, 1000],
      [0, -1000],
    ]) {
      s.control.aimX = x;
      s.control.aimZ = z;
      expect(cast(s, BUOY)).toBe(true);
    }
    expect(s.pharos!.buoys).toHaveLength(P.buoy.max);
    expect(s.pharos!.buoys.some((b) => b.x === 1500)).toBe(false);
    s.control.aimX = 1400;
    s.control.aimZ = 0;
    cast(s, BUOY);
    // The buoy is caught a moment before the hull itself would be.
    point(s, 80);
    run(g, 0.25);
    const first = lost(t);
    expect(first).toBeGreaterThan(0);
    expect(isLit(s, t)).toBe(true);
  });

  it('will not float on land', () => {
    const { g, s } = light();
    g.map.addDynamicRidge({ id: 1, owner: 99, x0: 900, z0: -300, x1: 900, z1: 300, width: 200, height: 75, expiresAt: 1e9 });
    s.control.aimX = 900;
    s.control.aimZ = 0;
    expect(cast(s, BUOY)).toBe(false);
    expect(s.skills[BUOY].cooldown).toBe(0);
    expect(s.pharos!.buoys).toHaveLength(0);
  });

  it('sinks after its life', () => {
    const { g, s } = light();
    s.control.aimX = 0;
    s.control.aimZ = 1000;
    cast(s, BUOY);
    run(g, P.buoy.life + 0.1);
    expect(s.pharos!.buoys).toHaveLength(0);
  });
});

describe('Dark Lamp', () => {
  it('shutters the beam, cloaks the hull and reopens with a flare and a wide beam', () => {
    const { g, s } = light();
    const near = dummy(g, 0, 700);
    const far = dummy(g, 0, -2500);
    run(g, 1 / 60);
    const open = s.mods.damageTakenMul;
    expect(cast(s, DARK)).toBe(true);
    run(g, 2 / 60);
    expect(pharosBeams(s)).toHaveLength(0);
    expect(s.mods.untargetable).toBe(true);
    expect(s.mods.damageTakenMul / open).toBeCloseTo(1 - P.dark.reduction, 6);
    expect(nextPass(s, near)).toBeNull();
    run(g, P.dark.time);
    expect(s.mods.untargetable).toBe(false);
    expect(lost(near)).toBeGreaterThan(0);
    expect(exposureOf(s, near)).toBeGreaterThanOrEqual(P.dark.exposure);
    expect(lost(far)).toBe(0);
    expect(pharosBeams(s)[0].half).toBeCloseTo(P.halfWidth * P.dark.widen, 6);
    run(g, P.dark.wide + 0.1);
    expect(pharosBeams(s)[0].half).toBeCloseTo(P.halfWidth, 6);
  });
});

describe('Twin Lamps', () => {
  it('lights a second beam opposite the first and speeds both', () => {
    const { g, s } = light();
    expect(cast(s, TWIN)).toBe(true);
    const beams = pharosBeams(s);
    expect(beams).toHaveLength(2);
    expect(Math.abs(wrapAngle(beams[1].bearing - beams[0].bearing))).toBeCloseTo(Math.PI, 6);
    expect(sweepRate(s)).toBeCloseTo(P.spin * P.twin.speed, 6);
    // The far beam catches a ship astern of the first.
    const t = dummy(g, 0, 1500);
    point(s, 0);
    run(g, 2 / 60);
    expect(isLit(s, t)).toBe(true);
    run(g, P.twin.time + 0.1);
    expect(pharosBeams(s)).toHaveLength(1);
  });

  it('throws a lance down each beam', () => {
    const { g, s } = light();
    const ahead = dummy(g, 1500, 0);
    const astern = dummy(g, -1500, 0);
    cast(s, TWIN);
    point(s, 90);
    cast(s, LANCE);
    run(g, P.lance.warning + 0.05);
    expect(lost(ahead)).toBeGreaterThan(0);
    expect(lost(astern)).toBeGreaterThan(0);
  });
});

describe('Daybreak', () => {
  it('winds up, then sears each ship once in one full turn', () => {
    const { g, s } = light();
    const a = dummy(g, 1500, 0);
    const b = dummy(g, -1500, 0);
    const c = dummy(g, 0, -3400);
    expect(cast(s, DAYBREAK)).toBe(true);
    const from = s.pharos!.bearing;
    run(g, P.daybreak.warning - 0.1);
    expect(sweepRate(s)).toBe(0);
    expect(wrapAngle(s.pharos!.bearing - from)).toBeCloseTo(0, 6);
    expect(lost(a) + lost(b) + lost(c)).toBe(0);
    run(g, 0.2);
    expect(pharosBeams(s)[0].range).toBe(P.daybreak.range);
    expect(pharosBeams(s)[0].half).toBeCloseTo(P.halfWidth * P.daybreak.widen, 6);
    run(g, P.daybreak.time + 0.2);
    expect(s.pharos!.daybreak).toBeNull();
    // 3.4 km out: past the ordinary beam, inside Daybreak's.
    for (const t of [a, b, c]) expect(lost(t)).toBeGreaterThan(0);
    expect(lost(a)).toBeCloseTo(lost(b), -3);
    // One turn, plus the moments of ordinary sweep either side of it.
    expect(Math.abs(wrapAngle(s.pharos!.bearing - from))).toBeLessThan(20 * DEG);
  });

  it('adds damage for each Exposure and cannot start behind the shutters', () => {
    const hit = (stacks: number) => {
      const { g, s } = light();
      const t = dummy(g, 0, 1500);
      point(s, 180);
      run(g, 1 / 60);
      litRecord(s, t)!.stacks = stacks;
      litRecord(s, t)!.gainedAt = 1e9;
      cast(s, DAYBREAK);
      run(g, P.daybreak.warning + 0.1);
      return lost(t);
    };
    expect(hit(8) / hit(0)).toBeCloseTo(pharosDamage.daybreak(8) / pharosDamage.daybreak(0), 2);
    const { s } = light();
    cast(s, DARK);
    expect(cast(s, DAYBREAK)).toBe(false);
    expect(s.skills[DAYBREAK].meter).toBe(1);
  });
});

describe('False Light', () => {
  it('turns nearby helms toward the beacon, then bursts', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    const away = dummy(g, -2500, 0);
    s.control.aimX = 1500;
    s.control.aimZ = 600;
    expect(cast(s, FALSE_LIGHT)).toBe(true);
    run(g, 0.5);
    expect(t.mods.feared).toBe(true);
    // Fleeing the mirrored point is steering for the beacon.
    const flee = bearingTo(t.mods.fearX, t.mods.fearZ, t.pos.x, t.pos.z);
    expect(wrapAngle(flee - bearingTo(t.pos.x, t.pos.z, 1500, 600))).toBeCloseTo(0, 6);
    expect(isLit(s, t)).toBe(true);
    expect(away.mods.feared).toBe(false);
    expect(pharosHold(t)!.lured).toBeGreaterThan(0);
    expect(lost(t)).toBe(0);
    run(g, P.falseLight.time);
    expect(s.pharos!.beacon).toBeNull();
    expect(lost(t)).toBeGreaterThan(0);
    expect(lost(away)).toBe(0);
    run(g, 0.3);
    expect(t.mods.feared).toBe(false);
  });

  it('holds a titan for less', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0, 'stepper');
    s.control.aimX = 1500;
    s.control.aimZ = 600;
    cast(s, FALSE_LIGHT);
    run(g, 0.5);
    expect(t.mods.feared).toBe(true);
    run(g, P.falseLight.time * 0.4);
    expect(t.mods.feared).toBe(false);
    expect(s.pharos!.beacon).not.toBeNull();
  });
});

describe('the lamp going out', () => {
  it('clears everything when the hull withdraws and starts a fresh life', () => {
    const { g, s } = light();
    const t = dummy(g, 1500, 0);
    s.control.aimX = 1000;
    s.control.aimZ = 0;
    for (let i = 0; i < 9; i++) cast(s, i);
    run(g, 3);
    s.withdraw();
    expect(s.pharos!.buoys).toHaveLength(0);
    expect(s.pharos!.lit).toHaveLength(0);
    expect(s.pharos!.beacon).toBeNull();
    s.respawn(0, 0, 0);
    expect(s.alive).toBe(true);
    expect(s.pharos!.darkUntil).toBe(0);
    expect(pharosBeams(s)).toHaveLength(1);
    void t;
  });

  it('hashes every part of its state', () => {
    const { g, s } = light();
    const before = stateHash(g);
    s.pharos!.bearing += 0.01;
    const turned = stateHash(g);
    expect(turned).not.toBe(before);
    s.pharos!.buoys.push({ id: 1, x: 5, z: 5, expiresAt: 9, flaredAt: 0 });
    expect(stateHash(g)).not.toBe(turned);
  });
});
