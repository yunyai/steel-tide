import type { GroundConsumableSpec, VehicleClass } from '../types';

// Consumables every vehicle carries: the repair kit on F and its class's utility on G.

export const REPAIR_KIT: GroundConsumableSpec = { type: 'repair', name: 'Repair kit', charges: 3, cooldown: 25, duration: 0, power: 0.2 };

const UTILITY: Record<VehicleClass, GroundConsumableSpec> = {
  HT: { type: 'applique', name: 'Applique plates', charges: 3, cooldown: 40, duration: 8, power: 0.75 },
  MT: { type: 'overdrive', name: 'Overdrive', charges: 3, cooldown: 35, duration: 8, power: 1.35 },
  LT: { type: 'smoke', name: 'Smoke launchers', charges: 3, cooldown: 30, duration: 0 },
  TD: { type: 'steady', name: 'Steady aim', charges: 3, cooldown: 40, duration: 15 },
  SPG: { type: 'relocate', name: 'Relocate', charges: 3, cooldown: 35, duration: 10, power: 1.4 },
  MSL: { type: 'rapidReload', name: 'Rapid reload', charges: 2, cooldown: 45, duration: 0 },
  SUP: { type: 'fieldRepair', name: 'Field repair', charges: 3, cooldown: 40, duration: 10, power: 40 },
  TT: { type: 'bulwark', name: 'Bulwark', charges: 3, cooldown: 45, duration: 10, power: 0.6 },
};

/** [repair kit, class utility]. */
export function consumablesFor(cls: VehicleClass): GroundConsumableSpec[] {
  return [REPAIR_KIT, UTILITY[cls]];
}
