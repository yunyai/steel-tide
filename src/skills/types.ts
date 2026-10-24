import type { Game } from '../core/Game';
import type { SkillSpec } from '../core/types';
import type { Ship } from '../ships/Ship';

/** Run-time state of one of a ship's three skills. */
export interface SkillState {
  spec: SkillSpec;
  /** Position in the ship's kit (key order: normal skills, then ultimates). */
  index: number;
  /** Seconds until a normal skill can be used again. */
  cooldown: number;
  active: boolean;
  /** Seconds of activity left. */
  time: number;
  /** Ultimates only: charge, 0..1. */
  meter: number;
  /** Scratch space for the skill's own bookkeeping. */
  data: Record<string, unknown>;
}

export interface SkillImpl {
  /** Start the skill. Returning false cancels it (no cooldown spent). */
  activate(ship: Ship, game: Game, st: SkillState): boolean | void;
  update?(ship: Ship, game: Game, dt: number, st: SkillState): void;
  end?(ship: Ship, game: Game, st: SkillState): void;
  /** AI heuristic: is now a good moment? `target` is the AI's current target. */
  aiShouldUse(ship: Ship, game: Game, target: Ship | null, st: SkillState): boolean;
}

export interface SkillDef {
  spec: SkillSpec;
  impl: SkillImpl;
}

export function def(spec: SkillSpec, impl: SkillImpl): SkillDef {
  return { spec, impl };
}

/** The specs of a ship's kit, in key order (normal skills, then ultimates). */
export function kitOf(defs: SkillDef[], ...ids: string[]): SkillSpec[] {
  return ids.map((id) => {
    const d = defs.find((x) => x.spec.id === id);
    if (!d) throw new Error(`unknown skill ${id}`);
    return d.spec;
  });
}
