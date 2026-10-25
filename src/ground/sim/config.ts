// Ground battle tunables. World units are metres and seconds; headings follow core/math
// (0 = north along -Z, clockwise positive).

/** km/h to m/s. */
export const KMH = 1 / 3.6;

/** Terrain heightfield and material grid spacing (m). */
export const TERRAIN_CELL = 4;
/** AI path grid spacing (m): fine enough to thread the city's streets. */
export const NAV_CELL = 8;
/** Prop lookup buckets (m). */
export const PROP_BUCKET = 32;

/** Shells fly at this fraction of their real muzzle velocity, so tracers read and leading matters. */
export const SHELL_SPEED_SCALE = 0.5;
/** Artillery shells fall this many times harder than real gravity, so a barrage lands in seconds. */
export const ARTY_GRAVITY_MUL = 12;
/** Artillery fires at this angle and picks its charge to reach the aim point. */
export const ARTY_ANGLE = 55;
/** Shells are dropped once they have flown this far past their gun's range. */
export const SHELL_OVERRANGE = 1.25;

/** Plates struck more than this far off their normal (degrees) deflect the round. */
export const RICOCHET_DEG = 70;
/** HEAT jets skid off only past this angle. */
export const HEAT_RICOCHET_DEG = 80;
/** A round whose calibre exceeds this multiple of the plate's thickness cannot ricochet. */
export const OVERMATCH = 3;
/** Full-calibre and sub-calibre rounds lose up to this share of penetration at their gun's range. */
export const PEN_FALLOFF = 0.25;
/** Damage on a penetration is rolled within this share either side of the round's value. */
export const DAMAGE_ROLL = 0.25;
/** High explosive that fails to penetrate still deals up to this share of its damage. */
export const HE_NONPEN = 0.5;

/** Penetrations near the tracks break them: immobile for this long. */
export const TRACK_CRIT_TIME = 4;
export const TRACK_CRIT_CHANCE = 0.35;
/** Penetrations from behind set the engine alight. */
export const FIRE_CRIT_TIME = 8;
export const FIRE_CRIT_CHANCE = 0.3;
/** Burning costs this share of max HP a second. */
export const FIRE_DPS = 0.012;
/** Penetrations into the hull or turret side may cook off the ammunition. */
export const AMMO_RACK_CHANCE = 0.05;
export const AMMO_RACK_DAMAGE = 0.3;

/** Aim circle: moving at top speed widens it by this factor, turning flat out and traversing by these. */
export const BLOOM_MOVE = 2.4;
export const BLOOM_TURN = 1.4;
export const BLOOM_TRAVERSE = 0.9;
/** Each shot kicks the circle open by this much. */
export const BLOOM_SHOT = 2.2;
/** Smoke between the gun and its aim point widens the circle this much. */
export const SMOKE_BLOOM = 2.5;

export const SMOKE_RADIUS = 26;
export const SMOKE_LIFE = 22;

/** Battles last 12 minutes. */
export const GROUND_TIME_LIMIT = 12 * 60;
export const GROUND_CAP_RADIUS = 50;
export const GROUND_CAP_TIME = 20;

/** Out of combat for this long, a vehicle repairs this share of max HP a second. */
export const REGEN_DELAY = 8;
export const REGEN_RATE = 0.012;

/** Fraction of the ultimate meter per point of damage dealt (a medium is ~2000 HP). */
export const ULT_DAMAGE_CHARGE = 1 / 9000;
/** Vehicles run within this of a building's wall without touching it. */
export const BUILDING_SKIN = 0.2;
/** Ramming: damage per tonne of the rammer per m/s of closing speed. */
export const RAM_DAMAGE = 0.6;
/** Vehicles heavier than this (t) flatten trees and fences; walls and cars need the second figure. */
export const FLATTEN_LIGHT = 12;
export const FLATTEN_HEAVY = 30;

/** Titan passive: shrugs off damage and crits, repairs sooner, cycles skills faster. */
export const TITAN = { damageTaken: 0.75, cooldown: 0.75, ultCharge: 1.5, regenDelay: 5, regenRate: 1.6 };
/** Spawn edges sit this fraction of the half-map out from the centre. */
export const SPAWN_LINE = 0.8;
