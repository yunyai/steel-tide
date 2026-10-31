import { describe, expect, it } from 'vitest';
import { CODEX_NOTE, cubeFirepower, cubeLoadout, tungstenCodexEntries } from '../src/ui/TungstenCodex';
import { CUBE, HIT, SIGNATURE, TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';
import { SHIP_BY_ID } from '../src/data/ships';

describe('Tungsten mode guide', () => {
  const tabs = tungstenCodexEntries();

  it('has a tab for every mode and one for Overdrive', () => {
    expect(tabs.map((t) => t.name)).toEqual([...TUNGSTEN_MODES.map((m) => m.name), 'Overdrive']);
    expect(tabs.slice(0, 6).map((t) => t.color)).toEqual(TUNGSTEN_MODES.map((m) => `#${m.color.toString(16).padStart(6, '0')}`));
    expect(tabs[6].rainbow).toBe(true);
    expect(tabs.slice(0, 6).every((t) => !t.rainbow)).toBe(true);
  });

  it('gives every mode its throw, passive, Signature, Die face, Collapse, Meteor and Shield', () => {
    TUNGSTEN_MODES.forEach((m, i) => {
      const rows = tabs[i].rows;
      expect(rows.map((r) => r.label)).toEqual(['Throw', 'Passive', `Signature · ${m.signature.name}`, 'Die face', 'Collapse', 'Meteor', 'Shield']);
      expect(rows[0].text).toBe(m.hit);
      expect(rows[1].text).toBe(m.passive);
      expect(rows[3].text).toContain(m.die);
      expect(rows[4].text).toBe(m.collapse);
      expect(rows[5].text).toBe(m.meteor);
      expect(rows.every((r) => r.text.length > 20)).toBe(true);
    });
  });

  it('quotes the real Die face and Collapse numbers', () => {
    const row = (id: string, label: string) => tabs.find((t) => t.id === id)!.rows.find((r) => r.label === label)!.text;
    const k = CUBE.die.strength;
    expect(row('kinetic', 'Die face')).toContain(`+${HIT.kinetic.bonus * k * 100}%`);
    expect(row('crush', 'Die face')).toContain(`${HIT.crush.stun * k} s stun`);
    expect(row('shard', 'Die face')).toContain(`${HIT.shard.out * k} s`);
    expect(row('tether', 'Die face')).toContain(`${HIT.tether.time * k} s`);
    expect(row('mend', 'Die face')).toContain(`${HIT.mend.lifesteal * k * 100}%`);
    // A shove of v m/s carries a hull v / 1.5 m, so the sim's 1.5x velocity is the knock distance.
    expect(row('repel', 'Die face')).toContain(`${HIT.repel.knock * k} m out`);
    // Rolling the cube's own mode fires every face.
    expect(row('repel', 'Die face')).toContain('every face');
    const T = CUBE.collapse.twist;
    expect(row('kinetic', 'Collapse')).toContain(`${T.kinetic.drift} m/s`);
    expect(row('crush', 'Collapse')).toContain(`${T.crush.pull}x`);
    expect(row('shard', 'Collapse')).toContain(`${T.shard.fragments} fragments of ${T.shard.damage / 1000}k`);
    expect(row('repel', 'Collapse')).toContain(`${T.repel.fling} m`);
    expect(row('tether', 'Collapse')).toContain(`${T.tether.time} s`);
    expect(row('mend', 'Collapse')).toContain(`${T.mend.share * 100}%`);
  });

  it('widens the Shield capture in Repel', () => {
    const shield = (i: number) => tabs[i].rows[6].text;
    expect(shield(0)).toContain(`${CUBE.guard.radius} m`);
    expect(shield(3)).toContain(`${CUBE.guard.repelRadius} m`);
  });

  it('says the Die leaves the cube on the mode it rolls', () => {
    expect(CODEX_NOTE).toMatch(/Loaded Die.*keeps/);
  });

  it('quotes the real Signature numbers', () => {
    const sig = (id: string) => tabs.find((t) => t.id === id)!.rows[2].text;
    expect(sig('kinetic')).toContain(`${SIGNATURE.ricochet.damage / 1000}k`);
    expect(sig('kinetic')).toContain(`${SIGNATURE.ricochet.bounces} hulls`);
    expect(sig('crush')).toContain(`${SIGNATURE.pile.damage / 1000}k`);
    expect(sig('crush')).toContain(`${SIGNATURE.pile.root} s`);
    expect(sig('shard')).toContain(`${SIGNATURE.cone.shards} shards`);
    expect(sig('shard')).toContain(`${SIGNATURE.cone.damage / 1000}k`);
    expect(sig('repel')).toContain(`${TUNGSTEN_MODES[3].signature.radius} m`);
    expect(sig('repel')).toContain(`${SIGNATURE.mirror.time} s`);
    expect(sig('repel')).toContain(`${SIGNATURE.mirror.return}×`);
    expect(sig('tether')).toContain(`${SIGNATURE.collide.damage / 1000}k`);
    expect(sig('mend')).toContain(`${SIGNATURE.sanctuary.heal * 100}%`);
    expect(sig('mend')).toContain(`${Math.round((1 - SIGNATURE.sanctuary.taken) * 100)}% less`);
  });

  it('explains what Overdrive changes', () => {
    const rows = tabs[6].rows;
    const row = (label: string) => rows.find((r) => r.label === label)!.text;
    expect(rows.map((r) => r.label)).toEqual(['Cubes', 'Throw', 'Passive', 'Signature', 'Die', 'Lunge', 'Shield', 'Collapse', 'Meteor']);
    expect(rows.every((r) => r.text.length > 20)).toBe(true);
    // A central cube on the dais, five in a pentagon round it, swapped by Switch.
    expect(row('Cubes')).toContain('central cube');
    expect(row('Cubes')).toContain('dais');
    expect(row('Cubes')).toContain('pentagon');
    expect(row('Cubes')).toContain('Switch');
    expect(row('Cubes')).not.toContain('empty');
    expect(row('Throw')).toContain(`${CUBE.shot.formation} m`);
    // The Die merges into one rainbow die and bursts back out into a pentagon.
    expect(row('Die')).toContain('rainbow');
    expect(row('Die')).toContain(`${CUBE.die.merged}x`);
    expect(row('Die')).toContain(`${CUBE.die.ring} m`);
    expect(row('Die')).toContain('pentagon');
    expect(row('Die')).not.toContain(`${CUBE.die.ring} m ring`);
    expect(row('Lunge')).toContain('central cube');
    expect(row('Meteor')).toContain('central cube');
    expect(row('Meteor')).toContain(`${CUBE.meteor.ring} m`);
    expect(row('Meteor')).toContain('pentagon');
    expect(row('Shield')).toContain(`${CUBE.orbit.time} s`);
    expect(row('Collapse')).toContain("every mode's twist");
    for (const r of rows) {
      expect(r.text).not.toMatch(/abreast|dash|halo of equals/i);
    }
    expect(CODEX_NOTE).toContain('central cube');
  });
});

describe('Tungsten texts', () => {
  const text = (id: string) => SHIP_BY_ID.tungsten.skills.find((k) => k.id === id)!.description;
  it('describes the central-cube Overdrive in the skill texts', () => {
    expect(text('tungstenOverdrive')).not.toContain('abreast');
    expect(text('tungstenOverdrive')).toContain('central cube');
    expect(text('tungstenOverdrive')).toContain('pentagon');
    expect(text('tungstenSwitch')).toContain('Overdrive');
    expect(text('tungstenSwitch')).toContain('central cube');
    expect(text('tungstenDie')).not.toContain('ring round the reticle');
    expect(text('tungstenDie')).toContain('rainbow');
    expect(text('tungstenDie')).toContain('pentagon');
    expect(text('tungstenLunge')).toContain('central cube');
    expect(text('tungstenSignature')).toContain('In Overdrive');
    for (const id of ['tungstenLunge', 'tungstenSwitch', 'tungstenSignature', 'tungstenDie', 'tungstenOverdrive']) expect(text(id)).not.toMatch(/dash/i);
  });

  it("speaks of a magnet's worth of throws, not a fixed four", () => {
    const spec = SHIP_BY_ID.tungsten;
    expect(spec.specialty).not.toContain('four throws');
    expect(spec.specialty).toContain("a magnet's worth");
  });
});

describe('Tungsten menu stats', () => {
  it('rates the cube by its throw', () => {
    expect(cubeFirepower()).toBe((CUBE.shot.damage * 60) / CUBE.shot.reload);
    expect(cubeLoadout()).toBe(`Cube: fire hurls it up to ${CUBE.shot.range / 1000} km through every hull for ${CUBE.shot.damage / 1000}k, every ${CUBE.shot.reload} s; ${1 / CUBE.shot.cost} throws to a full magnet`);
  });
});
