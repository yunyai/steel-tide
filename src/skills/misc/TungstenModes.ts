/** The Tungsten's cube: one table of numbers, shared by the sim, the HUD and the renderer. */
export const CUBE = {
  /** Edge of the cube at scale 1 (m). */
  edge: 128,
  /** Centre height when hovering over water, its base 6 m clear. */
  hoverY: 70,
  /** Gap between the dais and a docked cube's base (m). */
  float: 26,
  hp: 2500000,
  /** Seconds a shattered cube takes to re-form on the magnet. */
  reform: 12,
  /** Docked repair per second, as a fraction of max HP. */
  dockRepair: 0.02,
  /** Halo of extra docked cubes during Overdrive, wheeling slowly round the dais (rad/s). */
  ringRadius: 220,
  ringLift: 100,
  ringSpin: 0.15,
  dock: { speed: 1600, damage: 50000, heal: 0.06, dealtHeal: 0.2, cubeRepair: 0.15 },
  lunge: { range: 4000, speed: 1500, damage: 60000, taken: 0.6, minDistance: 300 },
  guard: { time: 8, offset: 150, radius: 180, repelRadius: 260, taken: 0.25, speed: 1500 },
  chargeCap: 600000,
  /**
   * Shield in Overdrive: the cubes ring the ship (`radius`), batter hulls and each wears a capture field
   * (`field`, `repelField` in Repel); the ship takes `taken` damage, and the store holds `cap` times as much.
   */
  orbit: { radius: 420, rate: 0.9, damage: 80000, knock: 450, every: 0.75, time: 10, field: 240, repelField: 300, taken: 0.7, cap: 2 },
  /** Parked cubes push enemy hulls out of their footprint at up to this speed (m/s). */
  shoveSpeed: 240,
  collapse: { range: 4500, travel: 0.6, pull: 3, radius: 1600, core: 700, coreDps: 15000, tick: 0.25, burst: 400000, edge: 120000, burstRadius: 1200, merged: 1.5, mergedRadius: 1.2 },
  meteor: { range: 5000, rise: 1.2, grow: 1, fall: 0.8, shrink: 0.6, height: 1800, scale: 4, damage: 700000, edge: 175000, radius: 900, ring: 500, share: 0.4 },
  /**
   * The fire button hurls the cube at the reticle (`speed` times the mode's factor), up to `range` from where it
   * is, once per `reload` while held. It ploughs through every hull in its way for `damage` and spends `cost` of
   * the magnet's energy; in Overdrive the cubes fly abreast, `spread` apart.
   */
  shot: { range: 4000, speed: 1800, damage: 80000, reload: 1.5, cost: 0.25, spread: 200 },
  /** The magnet's energy recharges slowly anywhere and fast docked. A cube thrown empty sinks `sink` m into the sea until it docks or is full again. */
  energy: { regen: 0.03, dockRegen: 0.3, sink: 10 },
  /** Magnet Surge: full energy and an overcharge: throws fly faster, hit harder and cost nothing. */
  surge: { time: 6, speed: 1.4, damage: 1.4 },
  /** A cube turns slowly about its vertical, docked or out on the water (rad/s). */
  spin: 0.25,
  overdrive: { time: 20 },
  aura: { radius: 1000, every: 0.25, life: 0.35 },
} as const;

/** Height of a docked cube's centre above the waterline: it floats `CUBE.float` over the dais on the deck. */
export const dockLift = (spec: { freeboard: number }) => spec.freeboard + CUBE.float + CUBE.edge / 2;

export type TungstenModeId = 'kinetic' | 'crush' | 'shard' | 'repel' | 'tether' | 'mend';

export interface TungstenMode {
  id: TungstenModeId;
  name: string;
  /** Short caps label for the Switch button. */
  short: string;
  color: number;
  /** Travel speed and body-hit damage factors. */
  speed: number;
  damage: number;
  /** Stops on the first hull instead of ploughing through. */
  stops: boolean;
  /** The Z move in this mode. */
  signature: { id: string; name: string; radius: number };
  /** One line each for the HUD and tooltips. */
  hit: string;
  passive: string;
  meteor: string;
}

export const TUNGSTEN_MODES: readonly TungstenMode[] = [
  {
    id: 'kinetic', name: 'Kinetic', short: 'KIN', color: 0x3ff0ff, speed: 1.5, damage: 1, stops: false,
    signature: { id: 'ricochet', name: 'Ricochet', radius: 2000 },
    hit: 'Flies 1.5x faster; hits gain up to +60% with distance flown.',
    passive: 'Ship +15% speed and acceleration; skill cooldowns -15%.',
    meteor: 'Falls twice as fast; a second ring hits wider for 30%.',
  },
  {
    id: 'crush', name: 'Crush', short: 'CRU', color: 0xffae2b, speed: 0.75, damage: 1.6, stops: true,
    signature: { id: 'slam', name: 'Slam', radius: 450 },
    hit: 'Stops on the first hull: +60% damage and a 1 s stun.',
    passive: 'Cube hits mark enemies for 6 s (+25% damage taken).',
    meteor: 'Survivors are stunned for 1.5 s.',
  },
  {
    id: 'shard', name: 'Shard', short: 'SHD', color: 0xff3b3b, speed: 1, damage: 1, stops: false,
    signature: { id: 'storm', name: 'Fragment Storm', radius: 700 },
    hit: 'Shrapnel: 50% splash within 350 m and a turret knocked out.',
    passive: 'Enemies within 1 km of the cube scatter 25% wider.',
    meteor: 'Twelve fragment sub-impacts ring the crater.',
  },
  {
    id: 'repel', name: 'Repel', short: 'REP', color: 0x3d6bff, speed: 1, damage: 0.85, stops: false,
    signature: { id: 'repulse', name: 'Repulse', radius: 800 },
    hit: '-15% damage; knocks hulls 250 m aside. Wider Shield capture.',
    passive: 'Ship takes 12% less damage.',
    meteor: 'Survivors are hurled 600 m outward.',
  },
  {
    id: 'tether', name: 'Tether', short: 'TET', color: 0xb46bff, speed: 1, damage: 1, stops: false,
    signature: { id: 'reel', name: 'Reel', radius: 1200 },
    hit: 'Chains hulls to the cube for 4 s: 40% slow and 6k a second.',
    passive: 'Enemies within 1 km of the cube sail 15% slower.',
    meteor: 'Drags enemies within 2 km inward as it falls.',
  },
  {
    id: 'mend', name: 'Mend', short: 'MND', color: 0x3dff8a, speed: 1, damage: 1, stops: false,
    signature: { id: 'restore', name: 'Restore', radius: 1000 },
    hit: 'Heals the ship for 25% of cube damage; allies it passes heal 5%.',
    passive: 'Ship regenerates 0.3% of max HP a second.',
    meteor: 'Leaves a 6 s field that heals allies 2% a second.',
  },
];

export const modeOf = (id: TungstenModeId): number => TUNGSTEN_MODES.findIndex((m) => m.id === id);

/** Signature numbers, by mode. */
export const SIGNATURE = {
  ricochet: { bounces: 5, reach: 2000, hop: 1500, damage: 55000, speed: 1800 },
  slam: { time: 0.75, damage: 120000, stun: 1.5 },
  storm: { damage: 70000, turrets: 2, out: 5 },
  repulse: { damage: 40000, knock: 300 },
  reel: { time: 1, speed: 400, damage: 80000 },
  restore: { allies: 0.1, ship: 0.08 },
} as const;

/** Body-hit side effects, by mode. */
export const HIT = {
  kinetic: { bonus: 0.6, full: 3000 },
  crush: { stun: 1, mark: 6 },
  shard: { splash: 0.5, radius: 350, out: 4 },
  repel: { knock: 250 },
  tether: { time: 4, slow: 0.6, dps: 6000, leash: 500 },
  mend: { lifesteal: 0.25, ally: 0.05, regen: 0.003 },
} as const;
