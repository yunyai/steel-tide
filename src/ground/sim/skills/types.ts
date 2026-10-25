import type { SkillSpec } from '../../../core/types';
import type { SkillState } from '../../../skills/types';
import type { GroundGame } from '../GroundGame';
import type { Vehicle } from '../Vehicle';

export type { SkillState };

/** A ground skill's behaviour; mirrors the naval SkillImpl. */
export interface GroundSkillImpl {
  /** Start the skill. Returning false cancels it (no cooldown spent). */
  activate(v: Vehicle, g: GroundGame, st: SkillState): boolean | void;
  update?(v: Vehicle, g: GroundGame, dt: number, st: SkillState): void;
  end?(v: Vehicle, g: GroundGame, st: SkillState): void;
  /** AI heuristic: is now a good moment? `target` is the AI's current target. */
  aiShouldUse(v: Vehicle, g: GroundGame, target: Vehicle | null, st: SkillState): boolean;
}

export interface GroundSkillDef {
  spec: SkillSpec;
  impl: GroundSkillImpl;
}

export function gdef(spec: SkillSpec, impl: GroundSkillImpl): GroundSkillDef {
  return { spec, impl };
}

/** The specs of a vehicle's kit, in key order (normal skills, then ultimates). */
export function kitOf(defs: GroundSkillDef[], ...ids: string[]): SkillSpec[] {
  return ids.map((id) => {
    const d = defs.find((x) => x.spec.id === id);
    if (!d) throw new Error(`unknown ground skill ${id}`);
    return d.spec;
  });
}
