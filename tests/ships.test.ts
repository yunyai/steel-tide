import { describe, expect, it } from 'vitest';
import { ERAS, FACTIONS, eraOf, factionsOf } from '../src/data/factions';
import { ALL, SHIPS, SHIP_BY_ID, shipsOf, titansOf } from '../src/data/ships';
import { SKILLS } from '../src/skills/registry';

/** The hangar tabs a genre fills four ships each. */
const TABS = [['BB'], ['CA', 'CL', 'CB'], ['DD'], ['CV'], ['SS']];

describe('ship roster', () => {
  it('has at least 10 ships with unique ids', () => {
    expect(SHIPS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ALL.map((s) => s.id)).size).toBe(ALL.length);
  });

  it('every line ship has two skills and an ultimate, all unique and registered', () => {
    const line = SHIPS.filter((s) => s.cls !== 'TT');
    const ids = line.flatMap((s) => s.skills.map((k) => k.id));
    expect(new Set(ids).size).toBe(line.length * 3);
    for (const s of line) {
      expect(s.skills.map((k) => !!k.ult)).toEqual([false, false, true]);
      for (const k of s.skills.slice(0, 2)) expect(k.cooldown).toBeGreaterThanOrEqual(10);
    }
    for (const id of SHIPS.flatMap((s) => s.skills.map((k) => k.id))) expect(SKILLS[id]).toBeDefined();
  });

  it('no two skills share an id or a name across the whole roster', () => {
    const skills = SHIPS.flatMap((s) => s.skills);
    const ids = new Set(skills.map((k) => k.id));
    expect(new Set(skills.map((k) => k.name)).size).toBe(ids.size);
    // A shared id is one skill on two hulls; there are none.
    expect(ids.size).toBe(skills.length);
  });

  it('titans carry six skills and three ultimates, none repeated within a kit', () => {
    for (const s of SHIPS.filter((x) => x.cls === 'TT')) {
      expect(s.skills.map((k) => !!k.ult)).toEqual([false, false, false, false, false, false, true, true, true]);
      expect(new Set(s.skills.map((k) => k.id)).size).toBe(9);
    }
  });

  it('historic keeps its three titans with guns, and the Habakkuk also flies planes', () => {
    const titans = titansOf('historic');
    expect(titans.map((s) => s.id).sort()).toEqual(['habakkuk', 'leviathan', 'raijin']);
    for (const t of titans) expect(t.main).toBeDefined();
    for (const t of SHIPS.filter((s) => s.cls === 'TT')) expect(t.hp).toBeGreaterThanOrEqual(500000);
    expect(SHIP_BY_ID.habakkuk.air).toBeDefined();
  });

  it('each new genre, once built, fills every hangar tab with four ships and four titans', () => {
    // Anime ships turn into titans instead (and its roster grows a series at a time); Misc is one titan.
    for (const era of ERAS.filter((e) => e !== 'historic' && e !== 'anime' && e !== 'misc')) {
      const ships = shipsOf(era);
      if (!ships.length) continue;
      for (const tab of TABS) expect(ships.filter((s) => tab.includes(s.cls)).length, `${era} ${tab}`).toBe(4);
      expect(titansOf(era).length, era).toBe(4);
      for (const f of factionsOf(era)) expect(titansOf(era).filter((t) => t.nation === f.id).length, f.id).toBe(1);
    }
  });

  it('every ship sails for a faction of its own era, and hidden specs stay out of the hangar', () => {
    for (const s of ALL) {
      expect(FACTIONS[s.nation], s.id).toBeDefined();
      expect(FACTIONS[s.nation].era).toBe(eraOf(s));
    }
    for (const s of ALL.filter((x) => x.hidden)) expect(SHIPS).not.toContain(s);
  });

  it('every ship has a specialty, description and an offensive loadout', () => {
    for (const s of SHIPS) {
      expect(s.specialty.length).toBeGreaterThan(20);
      expect(s.description.length).toBeGreaterThan(20);
      // The Tungsten's weapon is its cube.
      expect(!!(s.main || s.air || s.torpedoes || s.missiles) || s.id === 'tungsten', s.id).toBe(true);
      expect(s.consumables[0].type).toBe('repair');
      expect(s.consumables.length).toBeLessThanOrEqual(2);
    }
  });

  it('class-specific equipment is present', () => {
    for (const s of SHIPS) {
      if (s.cls === 'CV') expect(s.air).toBeDefined();
      if (s.cls === 'SS') expect(s.sub && s.torpedoes).toBeTruthy();
      if (s.cls === 'DD') expect(s.torpedoes).toBeDefined();
      // A missile battleship trades turrets for cells.
      if (s.cls === 'BB') expect(s.main!.turrets.length).toBeGreaterThanOrEqual(s.missiles ? 2 : 3);
    }
  });

  it('turrets traverse briskly enough to answer the helm', () => {
    for (const s of SHIPS.filter((x) => x.main)) {
      const min = s.cls === 'TT' ? 4.5 : s.cls === 'BB' ? 4.5 : 6;
      expect(s.main!.traverse, s.id).toBeGreaterThanOrEqual(min);
    }
  });

  it('covers at least six ship classes', () => {
    expect(new Set(SHIPS.map((s) => s.cls)).size).toBeGreaterThanOrEqual(6);
  });
});
