import { describe, expect, it } from 'vitest';
import { eraOf } from '../src/data/factions';
import { SHIPS } from '../src/data/ships';
import { DEFAULT_SETTINGS, type LobbySettings } from '../src/net/protocol';
import { navalRules } from './rules';

describe('LAN ship picks', () => {
  it('lets a captain pick every ship the hangar offers, in its era and in mixed', () => {
    const refused: string[] = [];
    for (const spec of SHIPS) {
      if (spec.hidden) continue;
      for (const era of [eraOf(spec), 'mixed'] as LobbySettings['era'][]) {
        for (const titans of [true, false]) {
          const st: LobbySettings = { ...DEFAULT_SETTINGS, era, titans };
          const want = titans || spec.cls !== 'TT';
          if (navalRules.pickAllowed(spec.id, st) !== want) refused.push(`${spec.id} (${era}, titans ${titans})`);
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it('still refuses ids that are not ships', () => {
    const st = { ...DEFAULT_SETTINGS, era: 'mixed' as const };
    for (const id of ['constructor', '__proto__', 'nonsense', 'a'.repeat(40), 'fletcher ', '', 7, null]) expect(navalRules.pickAllowed(id, st), String(id)).toBe(false);
  });
});
