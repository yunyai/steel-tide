import type { Game } from '../core/Game';
import type { SkillSpec } from '../core/types';
import type { Ship } from '../ships/Ship';
import { AOT_SKILLS } from './anime/aot';
import { BLEACH_SKILLS } from './anime/bleach';
import { DEMONSLAYER_SKILLS } from './anime/demonslayer';
import { DRAGONBALL_SKILLS } from './anime/dragonball';
import { JJK_SKILLS } from './anime/jjk';
import { MHA_SKILLS } from './anime/mha';
import { NARUTO_SKILLS } from './anime/naruto';
import { ONEPIECE_SKILLS } from './anime/onepiece';
import { BATTLESHIP_SKILLS } from './historic/battleships';
import { CRUISER_SKILLS } from './historic/cruisers';
import { LIGHT_SKILLS } from './historic/light';
import { TITAN_SKILLS } from './historic/titans';
import { CONCLAVE_SKILLS } from './fantasy/conclave';
import { DEEPFORGE_SKILLS } from './fantasy/deepforge';
import { DROWNED_SKILLS } from './fantasy/drowned';
import { SILVERWOOD_SKILLS } from './fantasy/silverwood';
import { FANTASY_TITAN_SKILLS } from './fantasy/titans';
import { HADAL_SKILLS } from './misc/hadal';
import { CN_SKILLS } from './modern/cn';
import { RU_SKILLS } from './modern/ru';
import { MODERN_TITAN_SKILLS } from './modern/titans';
import { UK_SKILLS } from './modern/uk';
import { USN_SKILLS } from './modern/usn';
import { CN_SF_SKILLS } from './scifi/cn';
import { JP_SF_SKILLS } from './scifi/jp';
import { RU_SF_SKILLS } from './scifi/ru';
import { SCIFI_TITAN_SKILLS } from './scifi/titans';
import { US_SF_SKILLS } from './scifi/us';
import type { SkillDef, SkillImpl } from './types';

export type { SkillDef, SkillImpl, SkillState } from './types';

/** Every titan's skill pool (none of them is carried by a line ship). */
export const TITAN_POOLS: SkillDef[] = [...TITAN_SKILLS, ...FANTASY_TITAN_SKILLS, ...MODERN_TITAN_SKILLS, ...SCIFI_TITAN_SKILLS, ...HADAL_SKILLS];

const ALL: SkillDef[] = [
  ...BATTLESHIP_SKILLS,
  ...CRUISER_SKILLS,
  ...LIGHT_SKILLS,
  ...SILVERWOOD_SKILLS,
  ...DEEPFORGE_SKILLS,
  ...DROWNED_SKILLS,
  ...CONCLAVE_SKILLS,
  ...USN_SKILLS,
  ...RU_SKILLS,
  ...CN_SKILLS,
  ...UK_SKILLS,
  ...JP_SF_SKILLS,
  ...US_SF_SKILLS,
  ...RU_SF_SKILLS,
  ...CN_SF_SKILLS,
  // Anime kits hold both the line ships' skills and their Titan Shift forms'.
  ...JJK_SKILLS,
  ...NARUTO_SKILLS,
  ...ONEPIECE_SKILLS,
  ...DRAGONBALL_SKILLS,
  ...BLEACH_SKILLS,
  ...AOT_SKILLS,
  ...DEMONSLAYER_SKILLS,
  ...MHA_SKILLS,
  ...TITAN_POOLS,
];

/** Every skill's behaviour, by `SkillSpec.id`. */
export const SKILLS: Record<string, SkillImpl> = Object.fromEntries(ALL.map((d) => [d.spec.id, d.impl]));

/** Every skill's spec, by id. */
export const SKILL_SPECS: Record<string, SkillSpec> = Object.fromEntries(ALL.map((d) => [d.spec.id, d.spec]));

/** AI heuristic for skill `i` (false while it cannot be used). */
export function aiWantsSkill(ship: Ship, game: Game, i: number, target: Ship | null): boolean {
  if (!ship.skillReady(i)) return false;
  const st = ship.skills[i];
  return SKILLS[st.spec.id]?.aiShouldUse(ship, game, target, st) ?? false;
}
