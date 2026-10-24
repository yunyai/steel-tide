import type { ConsumableSpec } from '../core/types';

// Consumables shared by every era's roster.

/** Every ship's F key: puts out fires and flooding, fire-proofs the crew for a while, patches 20% of the hull. */
export const REPAIR_KIT: ConsumableSpec = { type: 'repair', charges: 3, cooldown: 20, duration: 6, power: 0.2, restock: 75 };
/** A titan's kit patches less: its hull is enormous. */
export const TITAN_REPAIR: ConsumableSpec = { ...REPAIR_KIT, power: 0.15 };
// The G key: one class utility on a short cooldown.
export const smoke: ConsumableSpec = { type: 'smoke', charges: 99, cooldown: 55, duration: 15 };
/**
 * Search (radar, scrying, quantum scan): for its duration, enemies within `radius` cannot stay
 * cloaked and submerged submarines are marked. The counter to every stealth kit.
 */
export const search = (radius = 7500): ConsumableSpec => ({ type: 'search', charges: 99, cooldown: 45, duration: 12, power: radius });
export const speed: ConsumableSpec = { type: 'speedBoost', charges: 99, cooldown: 40, duration: 15, power: 1.25 };
export const depthCharges: ConsumableSpec = { type: 'depthCharges', charges: 99, cooldown: 20, duration: 0 };
