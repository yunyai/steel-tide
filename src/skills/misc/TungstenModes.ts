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
  /** Overdrive's pentagon halo of five docked cubes round the central one on the dais, wheeling slowly (rad/s). */
  ringRadius: 240,
  ringLift: 100,
  ringSpin: 0.15,
  /** Speed (m/s) at which Switch swaps the central cube with a ring cube in Overdrive. */
  swapSpeed: 700,
  dock: { speed: 1600, damage: 50000, heal: 0.06, dealtHeal: 0.2, cubeRepair: 0.15 },
  lunge: { range: 4000, speed: 1500, damage: 60000, taken: 0.6, minDistance: 300 },
  /**
   * Shield: the cube guards the reticle side, squaring a face up to it at up to `turn` rad/s. Hulls it touches take
   * `damage` plus `store` of the Shield store (kept, not spent) once per `every` and are knocked `knock` m.
   */
  guard: { time: 8, offset: 150, radius: 180, repelRadius: 260, taken: 0.25, speed: 1500, turn: 4, damage: 40000, store: 0.1, knock: 300, every: 0.75 },
  chargeCap: 1_000_000,
  /**
   * Shield in Overdrive: the cubes ring the ship (`radius`), batter hulls and each wears a capture field
   * (`field`, `repelField` in Repel), striking for `damage` plus `store` of the store; the ship takes `taken` damage,
   * and the store holds `cap` times as much.
   */
  orbit: { radius: 420, rate: 0.9, damage: 80000, store: 0.05, knock: 450, every: 0.75, time: 10, field: 240, repelField: 300, taken: 0.7, cap: 3 },
  /** Parked cubes push enemy hulls out of their footprint at up to this speed (m/s). */
  shoveSpeed: 240,
  collapse: {
    range: 4500,
    travel: 0.6,
    pull: 3,
    radius: 1600,
    core: 700,
    coreDps: 15000,
    tick: 0.25,
    burst: 400000,
    edge: 120000,
    burstRadius: 1200,
    merged: 1.5,
    mergedRadius: 1.2,
    /**
     * Each mode's twist; a merged Collapse has all six. Kinetic: the hole drifts at `drift` m/s toward the nearest
     * enemy in the pull. Crush: `pull` times the drag, hulls in the core disarmed, `burst` times the burst. Shard: it
     * swallows enemy shells and missiles in the pull, and the burst throws `fragments` sub-impacts of `damage`.
     * Repel: the burst flings survivors `fling` m out and tears up enemy fire within `clear`. Tether: the drag
     * outruns a fleeing hull by `margin` m/s, and the burst chains every hull in the pull for `time` s. Mend: `share`
     * of the core's damage is split over allies within `radius` and the ship; the burst heals the ship `burst`.
     */
    twist: {
      kinetic: { drift: 150 },
      crush: { pull: 1.5, burst: 1.25 },
      shard: { fragments: 16, damage: 40000 },
      repel: { fling: 900, clear: 2000 },
      tether: { margin: 40, time: 4 },
      mend: { share: 0.5, radius: 2000, burst: 0.1 },
    },
  },
  /**
   * `bounce`: the Kinetic meteor hops `hop` s, `height` m high, onto the nearest enemy within `reach` of its impact
   * that the blast missed, striking for `share` of the damage over `radius` of the blast radius.
   */
  meteor: {
    range: 5000,
    rise: 1.2,
    grow: 1,
    fall: 0.8,
    shrink: 0.6,
    height: 1800,
    scale: 4,
    damage: 700000,
    edge: 175000,
    radius: 900,
    ring: 500,
    share: 0.4,
    bounce: { reach: 1500, share: 0.4, hop: 0.7, height: 400, radius: 0.7 },
  },
  /**
   * The fire button hurls the cube at the reticle (`speed` times the mode's factor), up to `range` from where it
   * is, once per `reload` while held. It ploughs through every hull in its way for `damage` and spends `cost` of
   * the magnet's energy. In Overdrive the central cube flies to the reticle and the five to a pentagon `formation`
   * m round it, all at the central cube's pace.
   */
  shot: { range: 4000, speed: 1800, damage: 80000, reload: 1.5, cost: 0.25, formation: 300 },
  /** The magnet's energy recharges slowly anywhere and fast docked. A cube thrown empty sinks `sink` m into the sea (or rests on land) until it docks or is full again. */
  energy: { regen: 0.03, dockRegen: 0.3, sink: 10 },
  /**
   * Loaded Die: the cube rolls to the reticle (a `ring` round it in Overdrive), up to `range` from where it is, for
   * free. It lands for `damage` to every foe within `radius`, then the face it rolls fires its mode's hit at
   * `strength` times its strength; rolling the cube's own mode fires every face.
   */
  die: { cooldown: 16, range: 4000, radius: 600, damage: 120000, ring: 300, strength: 2 },
  /** A cube turns slowly about its vertical, docked or out on the water (rad/s). */
  spin: 0.25,
  overdrive: { time: 20 },
  aura: { radius: 1000, every: 0.25, life: 0.35 },
} as const;

/** Height of a docked cube's centre above the waterline: it floats `CUBE.float` over the dais on the deck. */
export const dockLift = (spec: { freeboard: number }) => spec.freeboard + CUBE.float + CUBE.edge / 2;
/** Bearing of halo slot `slot` (1..5) in hull space at time `time`: a pentagon round the dais, wheeling together. */
export const haloAngle = (slot: number, time: number) => ((slot - 1) / 5) * Math.PI * 2 + time * CUBE.ringSpin;

export type TungstenModeId = 'kinetic' | 'crush' | 'shard' | 'repel' | 'tether' | 'mend';
export type SignatureId = 'ricochet' | 'pile' | 'cone' | 'dash' | 'collide' | 'sanctuary';

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
  /** The Z move in this mode, and how far from the cube it reaches. */
  signature: { id: SignatureId; name: string; radius: number };
  /** One line each for the HUD and tooltips. */
  hit: string;
  passive: string;
  /** What the Loaded Die does when it rolls this face. */
  die: string;
  /** The Collapse's twist in this mode. */
  collapse: string;
  meteor: string;
}

/** Body-hit side effects, by mode. */
export const HIT = {
  kinetic: { bonus: 0.6, full: 3000 },
  crush: { stun: 1, mark: 6 },
  shard: { splash: 0.5, radius: 350, out: 4 },
  repel: { knock: 250 },
  tether: { time: 4, slow: 0.6, dps: 6000, leash: 500 },
  mend: { lifesteal: 0.25, ally: 0.05, regen: 0.003 },
} as const;

const D = CUBE.die.strength;
const T = CUBE.collapse.twist;

export const TUNGSTEN_MODES: readonly TungstenMode[] = [
  {
    id: 'kinetic', name: 'Kinetic', short: 'KIN', color: 0x3ff0ff, speed: 1.5, damage: 1, stops: false,
    signature: { id: 'ricochet', name: 'Ricochet+', radius: 2000 },
    hit: 'Flies 1.5x faster; hits gain up to +60% with distance flown.',
    passive: 'Ship +15% speed and acceleration; skill cooldowns -15%.',
    die: `Hits up to +${HIT.kinetic.bonus * D * 100}% harder the farther it rolled.`,
    collapse: `The hole drifts toward the nearest enemy in the pull at ${T.kinetic.drift} m/s.`,
    meteor: 'Bounces to the nearest enemy within 1.5 km for 40%; a second ring hits wider for 30%.',
  },
  {
    id: 'crush', name: 'Crush', short: 'CRU', color: 0xffae2b, speed: 0.75, damage: 1.6, stops: true,
    signature: { id: 'pile', name: 'Pile Driver', radius: 2500 },
    hit: 'Stops on the first hull: +60% damage and a 1 s stun.',
    passive: 'Cube hits mark enemies for 6 s (+25% damage taken).',
    die: `A ${HIT.crush.stun * D} s stun and a ${HIT.crush.mark * D} s mark on every hull in the blast.`,
    collapse: `Pulls ${T.crush.pull}x as hard, silences the guns of hulls in the core and bursts ${T.crush.burst}x as hard.`,
    meteor: 'Survivors are stunned for 1.5 s.',
  },
  {
    id: 'shard', name: 'Shard', short: 'SHD', color: 0xff3b3b, speed: 1, damage: 1, stops: false,
    signature: { id: 'cone', name: 'Shrapnel Cone', radius: 2000 },
    hit: 'Shrapnel: 50% splash within 350 m and a turret knocked out.',
    passive: 'Enemies within 1 km of the cube scatter 25% wider.',
    die: `Knocks out ${D} turrets on every hull in the blast for ${HIT.shard.out * D} s.`,
    collapse: `Swallows enemy shells and missiles in the pull; the burst throws ${T.shard.fragments} fragments of ${T.shard.damage / 1000}k.`,
    meteor: 'Twelve fragment sub-impacts ring the crater.',
  },
  {
    id: 'repel', name: 'Repel', short: 'REP', color: 0x3d6bff, speed: 1, damage: 0.85, stops: false,
    signature: { id: 'dash', name: 'Polarity Dash', radius: 1500 },
    hit: '-15% damage; knocks hulls 250 m aside. Wider Shield capture.',
    passive: 'Ship takes 12% less damage.',
    die: `Flings hulls ${HIT.repel.knock * D} m out and tears up enemy fire in the blast.`,
    collapse: `The burst flings survivors ${T.repel.fling} m out and tears up enemy fire within ${T.repel.clear / 1000} km.`,
    meteor: 'Survivors are hurled 600 m outward.',
  },
  {
    id: 'tether', name: 'Tether', short: 'TET', color: 0xb46bff, speed: 1, damage: 1, stops: false,
    signature: { id: 'collide', name: 'Collide', radius: 1200 },
    hit: 'Chains hulls to the cube for 4 s: 40% slow and 6k a second.',
    passive: 'Enemies within 1 km of the cube sail 15% slower.',
    die: `Chains every hull in the blast to the cube for ${HIT.tether.time * D} s.`,
    collapse: `The drag outruns a fleeing hull, and the burst chains every hull in the pull for ${T.tether.time} s.`,
    meteor: 'Drags enemies within 2 km inward as it falls.',
  },
  {
    id: 'mend', name: 'Mend', short: 'MND', color: 0x3dff8a, speed: 1, damage: 1, stops: false,
    signature: { id: 'sanctuary', name: 'Sanctuary', radius: 900 },
    hit: 'Heals the ship for 25% of cube damage; allies it passes heal 5%.',
    passive: 'Ship regenerates 0.3% of max HP a second.',
    die: `The ship heals ${HIT.mend.lifesteal * D * 100}% of the blast's damage.`,
    collapse: `${T.mend.share * 100}% of the core's damage heals the ship and allies within ${T.mend.radius / 1000} km, split evenly; the burst heals the ship ${T.mend.burst * 100}%.`,
    meteor: 'Leaves a 6 s field that heals allies 2% a second.',
  },
];

export const modeOf = (id: TungstenModeId): number => TUNGSTEN_MODES.findIndex((m) => m.id === id);

/** Signature numbers, by mode. */
export const SIGNATURE = {
  /** Kinetic: the cube bounces between enemies `bounces` times, each leg `gain` times faster than the last. */
  ricochet: { bounces: 6, reach: 2000, hop: 1500, damage: 90000, speed: 1800, gain: 1.15 },
  /** Crush: the cube leaps onto the enemy nearest the reticle, rooting it `root` s and stunning it, then drops beside it. */
  pile: { damage: 200000, root: 3, stun: 2, speed: 2400, height: 450 },
  /** Shard: `shards` rays across a `spread`-degree cone toward the reticle, each striking the first hull it meets. */
  cone: { shards: 24, spread: 40, range: 2000, damage: 25000 },
  /** Repel: the ship dashes `distance` away from the cube (or toward the reticle from the dais), through hulls, taking the Lunge's 40% less damage. */
  dash: { distance: 1500, speed: 2000, damage: 100000 },
  /** Tether: the two nearest hulls are reeled into each other over `time` (a lone hull into the cube). */
  collide: { time: 1, damage: 150000, stun: 1.5 },
  /** Mend: a dome at the cube: allies inside heal `heal` of max HP a second and take `taken` damage. */
  sanctuary: { time: 6, heal: 0.03, taken: 0.6 },
} as const;

