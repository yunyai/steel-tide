import type { SkillSpec } from '../../../core/types';
import { HISTORIC_GROUND_SKILLS } from './historic';
import { GROUND_TITAN_SKILLS } from './titans';
import type { GroundSkillDef, GroundSkillImpl } from './types';

export type { GroundSkillDef, GroundSkillImpl, SkillState } from './types';

const ALL: GroundSkillDef[] = [...HISTORIC_GROUND_SKILLS, ...GROUND_TITAN_SKILLS];

/** Every ground skill's behaviour, by `SkillSpec.id`. */
export const GROUND_SKILLS: Record<string, GroundSkillImpl> = Object.fromEntries(ALL.map((d) => [d.spec.id, d.impl]));

/** Every ground skill's spec, by id. */
export const GROUND_SKILL_SPECS: Record<string, SkillSpec> = Object.fromEntries(ALL.map((d) => [d.spec.id, d.spec]));
