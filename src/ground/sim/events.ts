import type { SkillSpec, Team } from '../../core/types';
import type { Face, PenOutcome } from './armor';
import type { Prop } from './props';
import type { AmmoKind, GroundConsumableType } from './types';
import type { Vehicle } from './Vehicle';
import type { Strike } from './weapons/Strikes';

export type CritKind = 'tracks' | 'fire' | 'ammo';

export interface GroundEventMap {
  gunFired: { v: Vehicle; x: number; y: number; z: number; yaw: number; pitch: number; caliber: number; artillery: boolean };
  /** A round met a vehicle: through, off, or stopped by the plate. */
  shellHit: {
    attacker: Vehicle | null;
    target: Vehicle;
    outcome: PenOutcome | 'splash';
    face: Face;
    damage: number;
    x: number;
    y: number;
    z: number;
    caliber: number;
    ammo: AmmoKind;
  };
  /** A round burst on the ground, water or a prop (or in the air). */
  impact: { x: number; y: number; z: number; caliber: number; surface: 'ground' | 'water' | 'prop' | 'air'; he: boolean };
  explosion: { x: number; y: number; z: number; size: number };
  rocketLaunched: { v: Vehicle; x: number; y: number; z: number };
  crit: { v: Vehicle; kind: CritKind; attacker: Vehicle | null };
  propDamaged: { prop: Prop };
  /** A house fell, or a tree, fence or wall went down under a tank. */
  propDown: { prop: Prop; flattened: boolean };
  destroyed: { v: Vehicle; killer: Vehicle | null };
  respawn: { v: Vehicle };
  vehicleChanged: { old: Vehicle; v: Vehicle };
  revive: { v: Vehicle; skill: SkillSpec | null };
  skill: { v: Vehicle; index: number };
  skillEnd: { v: Vehicle; index: number };
  skillHit: { v: Vehicle; attacker: Vehicle; skill: SkillSpec; damage: number };
  strike: { strike: Strike };
  strikeHit: { strike: Strike };
  consumable: { v: Vehicle; type: GroundConsumableType };
  ribbon: { v: Vehicle; kind: string; damage: number; target?: Vehicle };
  capture: { cap: number; team: Team };
  smoke: { x: number; z: number; team: Team };
  /** An active protection system or flak wall swatted a round out of the air. */
  intercept: { x: number; y: number; z: number };
  shieldHit: { v: Vehicle; amount: number };
  lightning: { points: { x: number; y: number; z: number }[]; color: number; straight?: boolean };
  blink: { v: Vehicle; fromX: number; fromZ: number };
  heal: { v: Vehicle; amount: number };
  gameOver: { winner: Team | -1; reason: string };
}
