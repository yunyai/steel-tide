import type { ArchitectElement, ArchitectType } from './architectLoadout';
import type { Ship } from '../ships/Ship';

/** Cosmetic machinery layout; every layout still contributes one logical hit. */
export type ArchitectBatteryLayout = 'wide' | 'compact' | 'folded';
export type ArchitectBatteryStage = 0 | 1 | 2 | 3;
export interface ArchitectBatteryPoint { readonly x:number; readonly y:number; readonly z:number }
export interface ArchitectBatteryCarrier extends ArchitectBatteryPoint { readonly heading:number }
export interface ArchitectBatteryArc {
  readonly muzzle:ArchitectBatteryPoint;
  readonly control:ArchitectBatteryPoint;
  readonly impact:ArchitectBatteryPoint;
}
export interface ArchitectBatteryHeadPose {
  readonly position:ArchitectBatteryPoint;
  readonly yaw:number;
  readonly pitch:number;
  readonly extension:number;
  readonly recoil:number;
  readonly muzzle:ArchitectBatteryPoint;
}
export interface ArchitectBatteryMember {
  readonly slot:number;
  readonly layout:ArchitectBatteryLayout;
  readonly carrier:ArchitectBatteryCarrier;
}
export interface ArchitectBatteryCast {
  readonly id:number;
  readonly generation:number;
  readonly startedAt:number;
  readonly members:readonly ArchitectBatteryMember[];
}
export interface ArchitectBatteryLaunchInput {
  readonly owner:Ship;
  readonly generation:number;
  readonly castId:number;
  readonly slot:number;
  readonly stage:ArchitectBatteryStage;
  readonly launchTime:number;
  readonly arrivalTime:number;
  readonly type:ArchitectType;
  readonly element:ArchitectElement;
  readonly skill:0|1;
  readonly center:ArchitectBatteryPoint;
  readonly radius:number;
  readonly baseDamage:number;
  /** Frozen owner damage × ultimate modifiers, applied exactly once. */
  readonly damageMultiplier:number;
  readonly layout:ArchitectBatteryLayout;
  readonly carrier:ArchitectBatteryCarrier;
  readonly paths:readonly [ArchitectBatteryArc,ArchitectBatteryArc];
}
export interface ArchitectBatteryLaunch extends ArchitectBatteryLaunchInput { readonly id:number }
export interface ArchitectBatteryRecipient extends ArchitectBatteryPoint { readonly target:Ship; readonly damage:number }
export interface ArchitectBatteryImpact {
  readonly launch:ArchitectBatteryLaunch;
  readonly resolvedAt:number;
  readonly recipients:readonly ArchitectBatteryRecipient[];
}
export const ARCHITECT_BATTERY_FLIGHT = .42;
