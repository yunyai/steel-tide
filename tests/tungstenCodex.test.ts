import { describe, expect, it } from 'vitest';
import { cubeFirepower, cubeLoadout, tungstenCodexEntries } from '../src/ui/TungstenCodex';
import { CUBE, SIGNATURE, TUNGSTEN_MODES } from '../src/skills/misc/TungstenModes';

describe('Tungsten mode guide', () => {
  const tabs = tungstenCodexEntries();

  it('has a tab for every mode and one for Overdrive', () => {
    expect(tabs.map((t) => t.name)).toEqual([...TUNGSTEN_MODES.map((m) => m.name), 'Overdrive']);
    expect(tabs.slice(0, 6).map((t) => t.color)).toEqual(TUNGSTEN_MODES.map((m) => `#${m.color.toString(16).padStart(6, '0')}`));
    expect(tabs[6].rainbow).toBe(true);
    expect(tabs.slice(0, 6).every((t) => !t.rainbow)).toBe(true);
  });

  it("gives every mode its throw, passive, Signature and Meteor", () => {
    TUNGSTEN_MODES.forEach((m, i) => {
      const rows = tabs[i].rows;
      expect(rows.map((r) => r.label)).toEqual(['Throw', 'Passive', `Signature · ${m.signature.name}`, 'Meteor']);
      expect(rows[0].text).toBe(m.hit);
      expect(rows[1].text).toBe(m.passive);
      expect(rows[3].text).toBe(m.meteor);
    });
  });

  it('quotes the real Signature numbers', () => {
    const sig = (id: string) => tabs.find((t) => t.id === id)!.rows[2].text;
    expect(sig('kinetic')).toContain(`${SIGNATURE.ricochet.damage / 1000}k`);
    expect(sig('kinetic')).toContain(`${SIGNATURE.ricochet.bounces} hulls`);
    expect(sig('crush')).toContain(`${SIGNATURE.pile.damage / 1000}k`);
    expect(sig('crush')).toContain(`${SIGNATURE.pile.root} s`);
    expect(sig('shard')).toContain(`${SIGNATURE.cone.shards} shards`);
    expect(sig('shard')).toContain(`${SIGNATURE.cone.damage / 1000}k`);
    expect(sig('repel')).toContain(`${SIGNATURE.dash.damage / 1000}k`);
    expect(sig('repel')).toContain(`${SIGNATURE.dash.distance / 1000} km`);
    expect(sig('tether')).toContain(`${SIGNATURE.collide.damage / 1000}k`);
    expect(sig('mend')).toContain(`${SIGNATURE.sanctuary.heal * 100}%`);
    expect(sig('mend')).toContain(`${Math.round((1 - SIGNATURE.sanctuary.taken) * 100)}% less`);
  });

  it('explains what Overdrive changes', () => {
    const rows = tabs[6].rows;
    expect(rows.map((r) => r.label)).toEqual(['Cubes', 'Throw', 'Passive', 'Signature', 'Shield', 'Collapse', 'Meteor']);
    expect(rows.every((r) => r.text.length > 20)).toBe(true);
    expect(rows[4].text).toContain(`${CUBE.orbit.time} s`);
  });
});

describe('Tungsten menu stats', () => {
  it('rates the cube by its throw', () => {
    expect(cubeFirepower()).toBe((CUBE.shot.damage * 60) / CUBE.shot.reload);
    expect(cubeLoadout()).toBe(`Cube: fire hurls it up to ${CUBE.shot.range / 1000} km through every hull for ${CUBE.shot.damage / 1000}k, every ${CUBE.shot.reload} s; ${1 / CUBE.shot.cost} throws to a full magnet`);
  });
});
