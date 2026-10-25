import { Vector3 } from 'three';
import {
  FIRE_DPS_FRACTION,
  FIRE_DURATION,
  FLOOD_DPS_FRACTION,
  FLOOD_DURATION,
  KNOT,
  MAP_HALF,
  RANGE_SCALE,
  MAX_FIRES,
  REGEN_DELAY,
  REGEN_RATE,
  RESPAWN_SHIELD,
  SHIFT_CHARGE,
  SHIFT_SURGE,
  SMOKE_DISPERSION,
  SPEED_SCALE,
  ULT_DAMAGE_CHARGE,
  ULT_PASSIVE_TIME,
  ULT_TAKEN_CHARGE,
} from '../config';
import type { Game } from '../core/Game';
import { distToHull } from '../core/hull';
import {
  DEG,
  approach,
  bearingTo,
  clamp,
  dist2D,
  forwardX,
  forwardZ,
  truncGaussian,
  wrapAngle,
  wrapDeg,
} from '../core/math';
import type {
  AmmoType,
  ArmorZone,
  GunTurretSpec,
  SecondarySpec,
  ShipSpec,
  SkillSpec,
  SquadronType,
  Team,
  TorpLook,
  TorpedoLauncherSpec,
  TorpedoSpec,
} from '../core/types';
import { traitOf, type Trait } from '../data/factions';
import { getRangeTable, solve, type RangeTable } from '../weapons/Ballistics';
import type { AirBuff } from '../weapons/AircraftSystem';
import type { Missile, MissileOptions } from '../weapons/MissileSystem';
import { stun } from '../weapons/StrikeSystem';
import { ConsumableState, createConsumables, updateConsumables, activateConsumable, consumableActive } from './Consumables';
import { hullHalfWidth, superstructureBounds } from './HullShape';
import { SKILLS, type SkillState } from '../skills/registry';

export const THROTTLE_STEPS = [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1] as const;
export const THROTTLE_LABELS = ['Full Astern', '1/2 Astern', 'Stop', '1/4', '1/2', '3/4', 'Full'];
const THROTTLE_STOP = 2;
/** Starting charge of a ship's first, second and third ultimate. */
const ULT_START = [0.35, 0.2, 0];

export interface ControlState {
  throttleUp: boolean;
  throttleDown: boolean;
  /** Absolute telegraph index (AI), or null. */
  throttleSet: number | null;
  /** -1 (port) .. +1 (starboard) */
  rudder: number;
  aimX: number;
  aimZ: number;
  fire: boolean;
  slot: number | null;
  /** Skill to trigger this tick: 0 and 1 normal skills, 2 the ultimate, -1 none. */
  skill: number;
  consumable: number;
  diveUp: boolean;
  diveDown: boolean;
  /** Preferred target ship id (-1 none). */
  targetId: number;
}

export function emptyControl(): ControlState {
  return {
    throttleUp: false,
    throttleDown: false,
    throttleSet: null,
    rudder: 0,
    aimX: 0,
    aimZ: 0,
    fire: false,
    slot: null,
    skill: -1,
    consumable: -1,
    diveUp: false,
    diveDown: false,
    targetId: -1,
  };
}

export type WeaponSlot =
  | { kind: 'gun'; ammo: AmmoType; label: string }
  | { kind: 'torp'; label: string }
  | { kind: 'air'; sq: SquadronType; label: string }
  | { kind: 'vls'; label: string };

export interface TurretState {
  spec: GunTurretSpec;
  /** Degrees relative to `facing`. */
  yaw: number;
  /** Barrel elevation in radians. */
  pitch: number;
  reload: number;
  disabled: number;
  canBear: boolean;
  aligned: boolean;
  /** Recoil animation timer. */
  recoil: number;
}

export interface SecondaryMount {
  group: SecondarySpec;
  x: number;
  z: number;
  y: number;
  side: 1 | -1;
  reload: number;
}

export interface LauncherState {
  spec: TorpedoLauncherSpec;
  tubes: number;
  reload: number;
  /** World bearing the launcher last trained to (render). */
  yaw: number;
}

export interface Mods {
  reloadMul: number;
  reloadOverride: number;
  dispersionMul: number;
  damageMul: number;
  apDamageMul: number;
  damageTakenMul: number;
  speedMul: number;
  invulnerable: boolean;
  /** AI, target lock, aim assist and homing weapons ignore this ship (it still draws, shimmering). */
  untargetable: boolean;
  secRangeMul: number;
  secReloadMul: number;
  secPerfect: boolean;
  traverseMul: number;
  railgun: boolean;
  guaranteedFire: boolean;
  torpReloadMul: number;
  /** EMP: no weapons, no skills, engines and rudder idle. */
  stunned: boolean;
  /** Takes extra damage from enemies. */
  marked: boolean;
  /** Fires and flooding cannot start. */
  fireImmune: boolean;
  /** Fires this ship starts burn this much harder. */
  fireDamageMul: number;
  /** Fires and flooding on this ship last this much as long. */
  fireDurationMul: number;
  /** Fraction of incoming damage sent back to the attacker. */
  reflect: number;
  /** Lightning (damage) thrown back at anyone who hits this ship, at most once a second each (Ion Shroud). */
  zap: number;
  zapSkill: SkillSpec | null;
  /** Fraction of damage dealt returned as hit points. */
  lifesteal: number;
  /** Damage of a ram into an enemy hull (0 = not ramming), and the skill it is credited to. */
  ram: number;
  ramSkill: SkillSpec | null;
  turnMul: number;
  /** Normal-skill cooldowns, ultimate charge rate and ultimate damage. */
  cooldownMul: number;
  ultChargeMul: number;
  ultDamageMul: number;
  /** Out-of-combat repair rate (0 for Boss Rush waves). */
  regenMul: number;
  /** Submarine battery does not drain. */
  batteryFree: boolean;
  /** Stuns and slows do not take hold (Juggernaut). */
  unstoppable: boolean;
  /** Shoves and knockbacks do not move the hull (Hardening, Rampage). */
  knockImmune: boolean;
  /** Every main-battery hit calls down a bolt of this much damage (Lightning Rod), and its skill. */
  boltOnHit: number;
  boltSkill: SkillSpec | null;
  /** No skills (Toll, EMP Lattice). */
  silenced: boolean;
  /** No weapons, but the ship still sails (Siren Song, Polymorph). */
  disarmed: boolean;
  /** Held dead in the water (vines, frost); turrets still train. */
  rooted: boolean;
  /** The helm flees this point at full speed, whatever the captain orders (Terror, Banshee Wail). */
  feared: boolean;
  fearX: number;
  fearZ: number;
  /** AP damage taken (Stoneskin). */
  apTakenMul: number;
  /** AP cannot ricochet off or shatter on this hull (Hex of Rot). */
  noBounce: boolean;
  /** Hit points cannot fall below 1. */
  undying: boolean;
  /** Out of the world: hidden, untouchable, frozen (Unmaking). */
  banished: boolean;
  /** Weapons cannot reach past this many metres (0 = no cap). */
  rangeCap: number;
  /** Torpedoes pass under the hull. */
  torpImmune: boolean;
  /** AI captains and homing weapons go for this ship first. */
  taunt: boolean;
  /** A search is on this ship: it cannot stay cloaked. */
  revealed: boolean;
  /** No repairs or healing of any kind. */
  healBlock: boolean;
  missileDamageMul: number;
  torpDamageMul: number;
  missileTakenMul: number;
  torpTakenMul: number;
  /** VLS reload time. */
  missileReloadMul: number;
  /** Anti-aircraft fire against planes and missiles: hitting power and reach. */
  aaMul: number;
  aaRangeMul: number;
  /** Reach of reticle-aimed skills. */
  reachMul: number;
  /** Homing weapons and skill locks cannot pick this ship from further than this (0 = any range). */
  lockRange: number;
  /** Main-battery rounds fly flat at this multiple of muzzle velocity (0 = normal arcs). */
  flatShots: number;
  /** Guns aimed at this ship scatter this much wider (stealth hulls, jamming). */
  scatterTakenMul: number;
  /** Missiles this ship launches cannot be shot down. */
  missileSure: boolean;
  /** No single hit takes more than this fraction of max HP (0 = no cap; Oathstone). */
  hitCap: number;
  /** Hostile damage this ship deals heals its target instead (Inversion). */
  inverted: boolean;
  /** Hostile skill damage is turned back on its caster, and none is taken (Spell Mirror). */
  spellMirror: boolean;
  /** Repair past full hull becomes shield, up to this fraction of max HP (Mend the Heavens). */
  overShield: number;
  /** Stuns, roots, silences and fear do not take hold (Hearts of Oak). */
  ccImmune: boolean;
  /** Chance that a hostile hit misses outright (Autonomous Dodge). */
  dodge: number;
}

function baseMods(): Mods {
  return {
    reloadMul: 1,
    reloadOverride: 0,
    dispersionMul: 1,
    damageMul: 1,
    apDamageMul: 1,
    damageTakenMul: 1,
    speedMul: 1,
    invulnerable: false,
    untargetable: false,
    secRangeMul: 1,
    secReloadMul: 1,
    secPerfect: false,
    traverseMul: 1,
    railgun: false,
    guaranteedFire: false,
    torpReloadMul: 1,
    stunned: false,
    marked: false,
    fireImmune: false,
    fireDamageMul: 1,
    fireDurationMul: 1,
    reflect: 0,
    zap: 0,
    zapSkill: null,
    lifesteal: 0,
    ram: 0,
    ramSkill: null,
    turnMul: 1,
    cooldownMul: 1,
    ultChargeMul: 1,
    ultDamageMul: 1,
    regenMul: 1,
    batteryFree: false,
    unstoppable: false,
    knockImmune: false,
    boltOnHit: 0,
    boltSkill: null,
    silenced: false,
    disarmed: false,
    rooted: false,
    feared: false,
    fearX: 0,
    fearZ: 0,
    apTakenMul: 1,
    noBounce: false,
    undying: false,
    banished: false,
    rangeCap: 0,
    torpImmune: false,
    taunt: false,
    revealed: false,
    healBlock: false,
    missileDamageMul: 1,
    torpDamageMul: 1,
    missileTakenMul: 1,
    torpTakenMul: 1,
    missileReloadMul: 1,
    aaMul: 1,
    aaRangeMul: 1,
    reachMul: 1,
    lockRange: 0,
    flatShots: 0,
    scatterTakenMul: 1,
    missileSure: false,
    hitCap: 0,
    inverted: false,
    spellMirror: false,
    overShield: 0,
    ccImmune: false,
    dodge: 0,
  };
}

/** Faction trait parts that act through the modifiers. */
function applyTrait(m: Mods, t: Trait): void {
  m.damageMul *= t.damageMul ?? 1;
  m.damageTakenMul *= t.damageTakenMul ?? 1;
  m.cooldownMul *= t.cooldownMul ?? 1;
  m.ultChargeMul *= t.ultChargeMul ?? 1;
  m.lifesteal += t.lifesteal ?? 0;
  m.fireDurationMul *= t.fireDurationMul ?? 1;
  m.missileDamageMul *= t.missileDamageMul ?? 1;
  m.torpDamageMul *= t.torpDamageMul ?? 1;
  m.missileReloadMul *= t.missileReloadMul ?? 1;
  m.torpReloadMul *= t.torpReloadMul ?? 1;
  m.missileTakenMul *= t.missileTakenMul ?? 1;
  m.torpTakenMul *= t.torpTakenMul ?? 1;
  m.reachMul *= t.reachMul ?? 1;
  m.lockRange = t.lockRange ?? 0;
}

/** Absorbs whole hits (Rune of Warding), or side-steps the next big one (Kawarimi). */
export interface HitGuard {
  /** Hits still to absorb. */
  left: number;
  /** Smallest hit (after modifiers) the guard bothers with. */
  min: number;
  /** Sim time the guard lapses. */
  until: number;
  skill: SkillSpec | null;
  /** Called on each absorbed hit, with the attacker. */
  onBlock?: (attacker: Ship | null) => void;
}

/**
 * Damage shared through a group (Hive Mind spreads each hit evenly across the group; Iron Chains
 * echoes a share of it onto every other member). Passed-on damage never passes on again.
 */
export interface DamageLink {
  group: Ship[];
  mode: 'spread' | 'echo';
  share: number;
  until: number;
  skill: SkillSpec | null;
}

/** Sinking is cancelled once: the ship comes back with this share of its hull (Deathless, Hōrai). */
export interface LastStand {
  until: number;
  hpFrac: number;
  skill: SkillSpec;
}

/** Where a ship was half a second at a time, for rewinding (Chronoshift). */
export interface PoseRecord {
  x: number;
  z: number;
  heading: number;
  hp: number;
  cooldowns: number[];
}

const TORP_LABEL: Record<TorpLook, string> = { torpedo: 'Torpedoes', eel: 'Spirit eels', lance: 'Plasma lances' };

/** Records kept for rewinding: six seconds at two a second. */
const HISTORY = 13;

/** Titan passive: shrugs off damage, stuns and burns, repairs fast and cycles its skills quicker. */
const COLOSSUS = { damageTaken: 0.75, burnTime: 0.5, cooldown: 0.75, ultCharge: 1.5, regenDelay: 4, regenRate: 2 };

/** One-shot buff for the next salvo of the main battery (Calabria Shot, Railgun Round...). */
export interface SalvoBuff {
  skill: SkillSpec;
  /** Turret firings left before the buff is used up. */
  left: number;
  dispersionMul: number;
  damageMul: number;
  railgun: boolean;
  guaranteedFire: boolean;
  /** Shells burst into fire bomblets where they land. */
  cluster: boolean;
  /** Called on each hull a buffed shell hits (EMP Shell, Graviton Shell...). */
  onHit?: (target: Ship, x: number, z: number) => void;
}

/** The next VLS salvo flies special (Ripple Fire, Terminal Weave). */
export interface VlsBuff {
  skill: SkillSpec;
  /** Extra missiles in the salvo. */
  extra?: number;
  damageMul?: number;
  /** Missile options laid over the cells' own. */
  opts?: Partial<MissileOptions>;
}

/** The next torpedo spread(s) run special. */
export interface TorpBuff {
  skill: SkillSpec;
  speedMul: number;
  /** Spreads left to buff (default 1). */
  spreads: number;
  /** Home on the ship nearest the reticle (default true). */
  homing?: boolean;
  /** Steer along the reticle while the owner lives (wire guidance). */
  wire?: boolean;
  /** Seen only inside 500 m. */
  wakeless?: boolean;
  /** Fork into this many near a target. */
  split?: number;
  damageMul?: number;
  /** Fire chance on a hit. */
  fire?: number;
  onHit?: (target: Ship) => void;
}

export interface Effect {
  id: string;
  time: number;
  apply(m: Mods): void;
}

export interface ShipStats {
  damage: number;
  kills: number;
  citadels: number;
  hits: number;
  fires: number;
  torpHits: number;
  received: number;
  shotsFired: number;
  /** Part of `damage` dealt by skills. */
  skill: number;
  /** Times sunk (Domination and Free play respawns). */
  deaths: number;
}

/** A Titan Shift under way: when it started and ends, when each form ultimate comes ready, and the base hull's state to come back to. */
export interface FormState {
  start: number;
  until: number;
  /** Seconds after the shift that each form ultimate is ready (each fires once). */
  unlock: number[];
  /** Form ultimates already fired, by skill index. */
  used: Set<number>;
  saved: { cooldowns: number[]; consumables: ConsumableState[]; slot: number; hpRatio: number };
}

export class Ship {
  readonly id: number;
  /** The hull as it sails now: the base hull, or its titan form during a Titan Shift. */
  spec: ShipSpec;
  /** The hull this ship was built as (names, pickers and the report use it). */
  readonly base: ShipSpec;
  readonly team: Team;
  name: string;
  /** Index of the human player controlling this ship, or -1 for AI. */
  humanIndex = -1;
  /** A human captain's ship that the AI is sailing while they are disconnected (LAN). */
  autopilot = false;
  /** Free play: the ship this one's captain sails from the next respawn. */
  nextSpec: ShipSpec | null = null;
  isSummon = false;
  summonOwner: Ship | null = null;
  /** Titan passive (see COLOSSUS); Boss Rush bosses go without it. */
  colossus: boolean;
  expiresAt = Infinity;

  pos = new Vector3();
  heading = 0;
  /** Pose at the previous sim step, and the pose interpolated between the two for drawing. */
  prevPos = new Vector3();
  prevHeading = 0;
  renderPos = new Vector3();
  renderHeading = 0;
  speed = 0;
  throttle = THROTTLE_STOP;
  rudder = 0;
  rudderTarget = 0;
  turnRate = 0;

  hp: number;
  maxHp: number;
  alive = true;
  withdrawn = false;
  /** Sunk by a magazine detonation (the wreck breaks in two). */
  detonated = false;
  deathTime = 0;
  lastAttacker: Ship | null = null;

  control: ControlState = emptyControl();
  slots: WeaponSlot[] = [];
  slot = 0;

  turrets: TurretState[] = [];
  secondaries: SecondaryMount[] = [];
  launchers: LauncherState[] = [];
  consumables: ConsumableState[] = [];
  mods: Mods = baseMods();
  effects: Effect[] = [];

  fires: number[] = new Array(MAX_FIRES).fill(0);
  fireAttacker: (Ship | null)[] = new Array(MAX_FIRES).fill(null);
  flooding = 0;
  floodAttacker: Ship | null = null;
  rudderJam = 0;
  engineDown = 0;
  /**
   * How stuck on land the ship is: every touch of the shore adds to it and it bleeds off slowly,
   * so bumping the same bank again and again counts like sitting on it (AI backs off past 0.4).
   */
  grounded = 0;
  /**
   * Seconds spent ordered ahead yet held near a standstill without gaining way: pressed on the map
   * edge or against another hull (AI backs off when it lasts).
   */
  stalled = 0;
  private lastSpeed = 0;
  zonePools!: Record<ArmorZone, number>;

  /** Normal skills, then ultimates (each ultimate charges its own meter). */
  skills: SkillState[] = [];
  /** Positions of the ultimates in `skills`. */
  ultIndices: number[] = [];
  /** The Titan Shift under way, if any. */
  form: FormState | null = null;
  /** A Titan Shift ordered this tick, taken once the skill has fired. */
  private shiftQueued: { form: ShipSpec; time: number; unlock: number[] } | null = null;
  /** Shield hit points (absorbed before the hull) and seconds until the shield lapses. */
  shield = 0;
  shieldMax = 0;
  shieldTime = 0;
  /** Next main-battery salvo buff. */
  salvo: SalvoBuff | null = null;
  /** The next torpedo spread runs special (Long Lance Reload, wire guidance, venom...). */
  torpBuff: TorpBuff | null = null;
  /** The next squadron launched flies special (see AirBuff). */
  airBuff: AirBuff | null = null;
  /** Absorbs or dodges hits while it lasts. */
  guard: HitGuard | null = null;
  /** Comes back once instead of sinking. */
  lastStand: LastStand | null = null;
  /** Damage shared with other hulls while it lasts. */
  link: DamageLink | null = null;
  /** Hostile damage that reached the hull or would have (raw, after shields): Death's Door counts it. */
  intake = 0;
  /** Kage trait: a blink or cloak primes the next hit. */
  ambushReady = false;
  /** Rewind records, oldest first. */
  history: PoseRecord[] = [];
  private historyTimer = 0;
  /** Vertical launch cells: reload, and the enemy locked under the reticle (HUD box). */
  vls: { reload: number; lock: Ship | null } | null = null;
  /** The next VLS salvo flies special. */
  vlsBuff: VlsBuff | null = null;
  /** The faction trait (none for historic navies). */
  readonly trait: Trait | undefined;
  /** Sim time of the last Cooperative Engagement pulse to nearby allies. */
  private auraTimer = 0;
  /** Knockback velocity (m/s), decaying. */
  pushX = 0;
  pushZ = 0;
  /** Sim time of the last damage taken (regen waits after it). */
  lastHurt = -1e9;
  /** Sim time of the last ram per enemy id. */
  private rams = new Map<number, number>();
  /** Sim time of the last Ion Shroud zap per attacker id. */
  private zaps = new Map<number, number>();

  aimRange = 0;
  aimBearing = 0;
  secTarget: Ship | null = null;
  secRetarget = 0;
  smokeLay = 0;

  /** Submarine depth state: 0 surface, 1 periscope, 2 deep. */
  depthState = 0;
  battery = 0;

  air: { hangar: Record<SquadronType, number>; restore: Record<SquadronType, number>; cooldown: number } | null = null;

  stats: ShipStats = { damage: 0, kills: 0, citadels: 0, hits: 0, fires: 0, torpHits: 0, received: 0, shotsFired: 0, skill: 0, deaths: 0 };

  superBox!: ReturnType<typeof superstructureBounds>;
  private tables: Partial<Record<AmmoType, RangeTable>> = {};
  private secTables = new Map<SecondarySpec, RangeTable>();

  constructor(
    readonly game: Game,
    spec: ShipSpec,
    team: Team,
    name?: string,
  ) {
    this.id = game.nextShipId++;
    this.spec = this.base = spec;
    this.team = team;
    this.name = name ?? spec.name;
    this.hp = this.maxHp = spec.hp;
    this.colossus = spec.cls === 'TT';
    this.trait = traitOf(spec);
    this.build(spec);
    // A titan's three ultimates start staggered, so they come online one after another.
    let u = 0;
    for (const st of this.skills) if (st.spec.ult) st.meter = spec.shift ? 0 : (ULT_START[u++] ?? 0);
    if (spec.sub) this.battery = spec.sub.battery;
  }

  /**
   * Everything that follows from the hull: guns, launchers, weapon slots, the air wing, skills
   * (fresh, meters empty), consumables and armour pools. The constructor and both ways of a Titan
   * Shift go through here; hit points, effects and the pose are the caller's.
   */
  private build(spec: ShipSpec): void {
    const game = this.game;
    this.spec = spec;
    this.colossus = spec.cls === 'TT';
    this.zonePools = {
      bow: spec.hp * 0.12,
      stern: spec.hp * 0.12,
      superstructure: spec.hp * 0.12,
      belt: spec.hp * 0.3,
      deck: spec.hp * 0.25,
      turret: Infinity,
    };
    this.superBox = superstructureBounds(spec);
    this.consumables = createConsumables(spec);
    this.skills = spec.skills.map((sp, index) => ({ spec: sp, index, cooldown: 0, active: false, time: 0, meter: 0, data: {} }));
    this.ultIndices = this.skills.filter((st) => st.spec.ult).map((st) => st.index);
    this.turrets = [];
    this.secondaries = [];
    this.launchers = [];
    this.slots = [];
    this.tables = {};
    this.secTables = new Map();
    this.salvo = this.torpBuff = this.airBuff = this.vlsBuff = null;
    this.history.length = 0;
    if (!spec.sub) {
      this.depthState = 0;
      this.pos.y = 0;
    }

    if (spec.main) {
      for (const t of spec.main.turrets) {
        this.turrets.push({ spec: t, yaw: 0, pitch: 0, reload: 0, disabled: 0, canBear: false, aligned: false, recoil: 0 });
      }
      if (spec.main.ap) this.tables.AP = getRangeTable(spec.main.ap, spec.main.range);
      if (spec.main.he) this.tables.HE = getRangeTable(spec.main.he, spec.main.range);
    }
    for (const g of spec.secondaries ?? []) {
      this.secTables.set(g, getRangeTable(g.shell, g.range * 1.7));
      for (let i = 0; i < g.perSide; i++) {
        const f = g.perSide === 1 ? 0.5 : i / (g.perSide - 1);
        const x = g.span[0] + (g.span[1] - g.span[0]) * f;
        for (const side of [1, -1] as const) {
          const z = side * hullHalfWidth(spec, x) * 0.8;
          this.secondaries.push({ group: g, x, z, y: spec.freeboard + g.y, side, reload: game.rng() * g.reload });
        }
      }
    }
    if (spec.torpedoes) {
      for (const l of spec.torpedoes.launchers) {
        this.launchers.push({ spec: l, tubes: l.tubes ?? spec.torpedoes.tubes, reload: 0, yaw: 0 });
      }
    }
    if (spec.cls === 'SS') {
      this.slots = [{ kind: 'torp', label: TORP_LABEL[spec.torpedoes?.look ?? 'torpedo'] }];
      if (spec.main?.he) this.slots.push({ kind: 'gun', ammo: 'HE', label: 'Deck gun HE' });
    } else {
      const names = spec.main?.ammoNames ?? ['AP shells', 'HE shells'];
      if (spec.main?.ap) this.slots.push({ kind: 'gun', ammo: 'AP', label: names[0] });
      if (spec.main?.he) this.slots.push({ kind: 'gun', ammo: 'HE', label: names[1] });
      if (spec.torpedoes) this.slots.push({ kind: 'torp', label: TORP_LABEL[spec.torpedoes.look ?? 'torpedo'] });
    }
    this.vls = spec.missiles ? { reload: 0, lock: null } : null;
    if (spec.missiles) this.slots.push({ kind: 'vls', label: spec.missiles.name });
    // Carriers fly squadrons; the Habakkuk titan carries guns and an air wing.
    this.air = spec.air
      ? {
          hangar: { torpedo: spec.air.torpedo.hangar, dive: spec.air.dive.hangar, fighter: spec.air.fighter.hangar },
          restore: { torpedo: 0, dive: 0, fighter: 0 },
          cooldown: 0,
        }
      : null;
    if (spec.air) {
      this.slots.push(
        { kind: 'air', sq: 'torpedo', label: spec.air.torpedo.name },
        { kind: 'air', sq: 'dive', label: spec.air.dive.name },
        { kind: 'air', sq: 'fighter', label: spec.air.fighter.name },
      );
    }
    this.slot = Math.min(this.slot, Math.max(0, this.slots.length - 1));
  }

  // ---------------------------------------------------------------- Titan Shift

  /** Order a Titan Shift into `form` for `time` seconds; it takes hold once the skill that ordered it has fired. */
  queueShift(form: ShipSpec, time: number, unlock: number[]): boolean {
    if (this.form || this.shiftQueued || !this.alive || this.isSummon) return false;
    this.shiftQueued = { form, time, unlock };
    return true;
  }

  /** Every running skill ends now, as if its time ran out. */
  private endSkills(): void {
    for (const st of this.skills) {
      if (!st.active) continue;
      st.active = false;
      SKILLS[st.spec.id]?.end?.(this, this.game, st);
      this.game.events.emit('skillEnd', { ship: this, index: st.index });
    }
  }

  private shiftNow(form: ShipSpec, time: number, unlock: number[]): void {
    this.endSkills();
    const frac = this.hp / this.maxHp;
    const hpRatio = this.maxHp / this.spec.hp;
    const saved = { cooldowns: this.skills.map((st) => st.cooldown), consumables: this.consumables, slot: this.slot, hpRatio };
    this.build(form);
    this.maxHp = form.hp * hpRatio;
    this.hp = Math.min(this.maxHp, this.maxHp * (frac + SHIFT_SURGE));
    // A form that stays under the sea comes with full tanks.
    if (form.sub) this.battery = form.sub.battery;
    // The power-up burns off fires, flooding and stuns; other curses hold.
    this.extinguish();
    this.effects = this.effects.filter((e) => e.id !== 'debuff:stun');
    this.form = { start: this.game.time, until: this.game.time + time, unlock, used: new Set(), saved };
    this.updateForm();
    this.game.events.emit('shift', { ship: this, on: true });
  }

  /** Back to the base hull: same share of hull, cooldowns as they were less the time spent in the form. */
  private revert(): void {
    const f = this.form;
    if (!f) return;
    this.endSkills();
    const frac = this.hp / this.maxHp;
    this.form = null;
    this.build(this.base);
    this.maxHp = this.base.hp * f.saved.hpRatio;
    this.hp = Math.max(1, this.maxHp * frac);
    // A titan sub's tanks may hold more than the base hull's.
    if (this.base.sub) this.battery = Math.min(this.battery, this.base.sub.battery);
    const gone = this.game.time - f.start;
    this.skills.forEach((st, i) => {
      if (!st.spec.ult) st.cooldown = Math.max(0, (f.saved.cooldowns[i] ?? 0) - gone);
    });
    this.consumables = f.saved.consumables;
    for (const c of this.consumables) {
      c.cooldown = Math.max(0, c.cooldown - gone);
      c.active = 0;
    }
    this.slot = Math.min(f.saved.slot, Math.max(0, this.slots.length - 1));
    this.game.events.emit('shift', { ship: this, on: false });
  }

  /** In a form: each ultimate charges up to its unlock time, once; the form lapses at the end. */
  private updateForm(): void {
    const f = this.form;
    if (!f) return;
    if (this.game.time >= f.until) {
      this.revert();
      return;
    }
    const t = this.game.time - f.start;
    this.ultIndices.forEach((i, k) => {
      const st = this.skills[i];
      if (st.active || f.used.has(i)) return;
      const at = f.unlock[k] ?? 0;
      st.meter = at <= 0 ? 1 : Math.min(1, t / at);
    });
  }

  /** Seconds of the form left (0 out of one). */
  get formLeft(): number {
    return this.form ? Math.max(0, this.form.until - this.game.time) : 0;
  }

  // ---------------------------------------------------------------- geometry

  get maxSpeed(): number {
    return this.spec.maxSpeed * KNOT * SPEED_SCALE;
  }

  get isSub(): boolean {
    return !!this.spec.sub;
  }

  get submerged(): boolean {
    return this.isSub && this.pos.y < -3;
  }

  get deep(): boolean {
    return this.isSub && this.pos.y < (this.spec.sub!.periscopeDepth - 8);
  }

  get currentSlot(): WeaponSlot | undefined {
    return this.slots[this.slot];
  }

  get ammo(): AmmoType {
    const s = this.currentSlot;
    if (s?.kind === 'gun') return s.ammo;
    return this.spec.main?.ap ? 'AP' : 'HE';
  }

  /** World position of a local point (x forward, z starboard). */
  localToWorld(lx: number, ly: number, lz: number, out = new Vector3()): Vector3 {
    const h = this.heading;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    return out.set(this.pos.x + fx * lx + rx * lz, this.pos.y + ly, this.pos.z + fz * lx + rz * lz);
  }

  tableFor(ammo: AmmoType): RangeTable | undefined {
    return this.tables[ammo] ?? this.tables.HE ?? this.tables.AP;
  }

  get mainRange(): number {
    return this.spec.main?.range ?? 0;
  }

  maxAimRange(): number {
    if (this.spec.air && !this.spec.main) return Math.max(this.spec.air.range, this.spec.missiles?.range ?? 0);
    return Math.max(this.mainRange, this.spec.torpedoes?.range ?? 0, this.spec.missiles?.range ?? 0, 3000 * RANGE_SCALE);
  }

  /** Search is running: torpedoes are seen further out. */
  isSearchActive(): number {
    return consumableActive(this, 'search');
  }

  /**
   * The targetable enemy nearest (x, z) within `r` of it that this ship can lock (lock range
   * permitting), or null.
   */
  lockAt(x: number, z: number, r: number): Ship | null {
    let best: Ship | null = null;
    let bd = r;
    for (const s of this.game.ships) {
      if (!s.alive || s.team === this.team || s.mods.untargetable || s.deep) continue;
      if (s.mods.lockRange > 0 && dist2D(s.pos.x, s.pos.z, this.pos.x, this.pos.z) > s.mods.lockRange) continue;
      const d = dist2D(s.pos.x, s.pos.z, x, z) - s.spec.length * 0.3;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    if (!this.alive) {
      this.deathTime += dt;
      this.speed *= 1 - dt * 0.3;
      this.pos.x += forwardX(this.heading) * this.speed * dt;
      this.pos.z += forwardZ(this.heading) * this.speed * dt;
      return;
    }
    if (this.game.time >= this.expiresAt) {
      this.withdraw();
      return;
    }
    this.recomputeMods(dt);
    this.applyControl();
    const q = this.shiftQueued;
    if (q) {
      this.shiftQueued = null;
      this.shiftNow(q.form, q.time, q.unlock);
    }
    updateConsumables(this, dt);
    this.updateSkills(dt);
    this.updateForm();
    this.updateShield(dt);
    this.updateSub(dt);
    this.updateMovement(dt);
    this.updateMain(dt);
    this.updateSecondaries(dt);
    this.updateTorpedoes(dt);
    this.updateVls(dt);
    this.updateAir(dt);
    this.updateDamageOverTime(dt);
    this.updateRegen(dt);
    this.updateAura(dt);
    this.recordHistory(dt);
  }

  /** Cooperative Engagement: every half second, sharpen the AA of allies close by (and our own). */
  private updateAura(dt: number): void {
    const aura = this.trait?.aaAura;
    if (!aura) return;
    this.auraTimer -= dt;
    if (this.auraTimer > 0) return;
    this.auraTimer = 0.5;
    for (const s of this.game.ships) {
      if (!s.alive || s.team !== this.team || dist2D(s.pos.x, s.pos.z, this.pos.x, this.pos.z) > 1500) continue;
      s.addEffect({
        id: 'cec',
        time: 0.7,
        apply(m) {
          m.aaMul *= aura;
        },
      });
    }
  }

  private recordHistory(dt: number): void {
    this.historyTimer -= dt;
    if (this.historyTimer > 0) return;
    this.historyTimer = 0.5;
    this.history.push({ x: this.pos.x, z: this.pos.z, heading: this.heading, hp: this.hp, cooldowns: this.skills.map((st) => st.cooldown) });
    if (this.history.length > HISTORY) this.history.shift();
  }

  /**
   * Back to where the ship was `seconds` ago (at most six): pose, hull and skill cooldowns.
   * `'hull'` restores just the hull, `'pose'` just the place and heading (Izanami's loop, which
   * neither heals nor cleanses). Returns false with no record that old.
   */
  rewind(seconds: number, mode: 'all' | 'hull' | 'pose' = 'all'): boolean {
    const back = Math.min(this.history.length, Math.round(seconds * 2));
    if (back <= 0) return false;
    const r = this.history[this.history.length - back];
    if (mode !== 'pose') this.hp = Math.max(this.hp, Math.min(this.maxHp, r.hp));
    if (mode === 'hull') return true;
    const fromX = this.pos.x;
    const fromZ = this.pos.z;
    this.pos.x = r.x;
    this.pos.z = r.z;
    this.heading = r.heading;
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this.prevHeading = this.renderHeading = this.heading;
    if (mode === 'pose') {
      this.game.events.emit('blink', { ship: this, fromX, fromZ });
      return true;
    }
    r.cooldowns.forEach((cd, i) => {
      const st = this.skills[i];
      if (st && !st.spec.ult && !st.active) st.cooldown = Math.min(st.cooldown, cd);
    });
    this.cleanse();
    this.history.length = 0;
    this.game.events.emit('blink', { ship: this, fromX, fromZ });
    return true;
  }

  private recomputeMods(dt: number): void {
    const m = baseMods();
    if (this.colossus) {
      m.damageTakenMul = COLOSSUS.damageTaken;
      m.fireDurationMul = COLOSSUS.burnTime;
      m.cooldownMul = COLOSSUS.cooldown;
      m.ultChargeMul = COLOSSUS.ultCharge;
    }
    if (this.trait) applyTrait(m, this.trait);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.time -= dt;
      if (e.time <= 0) this.effects.splice(i, 1);
    }
    // Buffs first, then debuffs, so an unstoppable ship can keep its pace through slows and stuns.
    for (const e of this.effects) if (!e.id.startsWith('debuff:')) e.apply(m);
    const { speedMul, traverseMul, turnMul } = m;
    for (const e of this.effects) if (e.id.startsWith('debuff:')) e.apply(m);
    if (m.unstoppable) {
      m.stunned = false;
      m.rooted = false;
      m.feared = false;
      m.speedMul = Math.max(m.speedMul, speedMul);
      m.traverseMul = Math.max(m.traverseMul, traverseMul);
      m.turnMul = Math.max(m.turnMul, turnMul);
    }
    if (m.ccImmune) m.stunned = m.rooted = m.feared = m.silenced = false;
    // A search strips cloaks; nothing reaches a banished ship.
    if (m.revealed) m.untargetable = false;
    if (m.banished) {
      m.untargetable = m.invulnerable = m.stunned = true;
    }
    // The Kage strike: a cloak primes the next hit.
    if (m.untargetable && this.trait?.ambush) this.ambushReady = true;
    this.mods = m;
  }

  addEffect(e: Effect): void {
    this.effects = this.effects.filter((x) => x.id !== e.id);
    this.effects.push(e);
  }

  private applyControl(): void {
    const c = this.control;
    if (c.throttleSet !== null) this.throttle = clamp(c.throttleSet, 0, THROTTLE_STEPS.length - 1);
    if (c.throttleUp) this.throttle = Math.min(THROTTLE_STEPS.length - 1, this.throttle + 1);
    if (c.throttleDown) this.throttle = Math.max(0, this.throttle - 1);
    this.rudderTarget = clamp(c.rudder, -1, 1);
    if (c.slot !== null && c.slot >= 0 && c.slot < this.slots.length) this.slot = c.slot;
    if (c.consumable >= 0) activateConsumable(this, c.consumable);
    if (c.skill >= 0) this.activateSkill(c.skill);
    if (this.isSub) {
      if (c.diveDown) this.depthState = Math.min(2, this.depthState + 1);
      if (c.diveUp) this.depthState = Math.max(0, this.depthState - 1);
    }
    // Edge-triggered inputs are consumed by the first tick that sees them.
    c.throttleUp = c.throttleDown = c.diveUp = c.diveDown = false;
    c.slot = null;
    c.skill = -1;
    c.consumable = -1;
  }

  /** Ready to trigger: off cooldown (or meter full for an ultimate) and not already running. */
  skillReady(i: number): boolean {
    const st = this.skills[i];
    if (!st || !this.alive || st.active || this.mods.stunned || this.mods.silenced) return false;
    return st.spec.ult ? st.meter >= 1 && !this.isSummon : st.cooldown <= 0;
  }

  /** Charge of the first ultimate; setting it sets every ultimate's meter. */
  get meter(): number {
    const i = this.ultIndices[0];
    return i === undefined ? 0 : this.skills[i].meter;
  }

  set meter(v: number) {
    for (const i of this.ultIndices) this.skills[i].meter = v;
  }

  /** Top up every ultimate by a flat amount (pickups, refits); ignores charge modifiers. */
  boostUlts(amount: number): void {
    for (const i of this.ultIndices) this.skills[i].meter = Math.min(1, this.skills[i].meter + amount);
  }

  /** True while any ultimate is running. */
  get ultActive(): boolean {
    return this.ultIndices.some((i) => this.skills[i].active);
  }

  activateSkill(i: number): boolean {
    if (!this.skillReady(i)) return false;
    const st = this.skills[i];
    const impl = SKILLS[st.spec.id];
    st.data = {};
    if (!impl || impl.activate(this, this.game, st) === false) return false;
    st.active = st.spec.duration > 0;
    st.time = st.spec.duration;
    if (st.spec.ult) {
      st.meter = 0;
      this.form?.used.add(i);
    } else st.cooldown = st.spec.cooldown * this.mods.cooldownMul;
    this.game.events.emit('skill', { ship: this, index: i });
    return true;
  }

  /** True while any of this ship's skills is running. */
  get skillActive(): boolean {
    return this.skills.some((s) => s.active);
  }

  /** Add to every ultimate's meter (not to one that is running). */
  charge(amount: number): void {
    // A form's ultimates come ready on the form's own clock.
    if (this.isSummon || this.form) return;
    const k = this.spec.shift ? SHIFT_CHARGE : 1;
    for (const i of this.ultIndices) {
      const st = this.skills[i];
      if (!st.active) st.meter = Math.min(1, st.meter + amount * k * this.mods.ultChargeMul);
    }
  }

  private updateSkills(dt: number): void {
    for (const st of this.skills) {
      if (st.cooldown > 0) st.cooldown -= dt;
      if (!st.active) continue;
      const impl = SKILLS[st.spec.id];
      impl?.update?.(this, this.game, dt, st);
      st.time -= dt;
      if (st.time <= 0 || !this.alive) {
        st.active = false;
        impl?.end?.(this, this.game, st);
        this.game.events.emit('skillEnd', { ship: this, index: st.index });
      }
    }
    if (this.isSummon || this.form) return;
    for (const i of this.ultIndices) {
      const st = this.skills[i];
      if (!st.active) st.meter = Math.min(1, st.meter + (dt / (st.spec.cooldown || ULT_PASSIVE_TIME)) * this.mods.ultChargeMul);
    }
  }

  /** Raise a shield of `amount` hit points for `time` seconds (keeps the larger of old and new). */
  addShield(amount: number, time: number): void {
    this.shield = Math.max(this.shield, amount);
    this.shieldMax = Math.max(this.shield, amount);
    this.shieldTime = Math.max(this.shieldTime, time);
  }

  private updateShield(dt: number): void {
    if (this.shieldTime <= 0) return;
    this.shieldTime -= dt;
    if (this.shieldTime <= 0 || this.shield <= 0) {
      this.shield = this.shieldMax = this.shieldTime = 0;
    }
  }

  private updateSub(dt: number): void {
    const sub = this.spec.sub;
    if (!sub) return;
    if (this.depthState > 0) {
      if (!this.mods.batteryFree) this.battery -= dt * (this.depthState === 2 ? 1.4 : 1);
      if (this.battery <= 0) {
        this.battery = 0;
        this.depthState = 0;
      }
    } else {
      this.battery = Math.min(sub.battery, this.battery + dt * 0.8);
    }
    const target = this.depthState === 0 ? 0 : this.depthState === 1 ? sub.periscopeDepth : sub.deepDepth;
    this.pos.y = approach(this.pos.y, target, sub.diveRate * dt);
  }

  private updateMovement(dt: number): void {
    const s = this.spec;
    let maxSpd = this.maxSpeed * this.mods.speedMul;
    if (this.engineDown > 0) {
      this.engineDown -= dt;
      maxSpd *= 0.2;
    }
    if (this.submerged) maxSpd *= 0.75;
    const stunned = this.mods.stunned;
    let frac = stunned ? 0 : THROTTLE_STEPS[this.throttle];
    if (this.mods.feared && !stunned) {
      // Flee: full ahead, helm hard over away from the source.
      const away = bearingTo(this.mods.fearX, this.mods.fearZ, this.pos.x, this.pos.z);
      this.rudderTarget = clamp(wrapAngle(away - this.heading) * 2, -1, 1);
      frac = 1;
    }
    if (this.mods.rooted) {
      frac = 0;
      this.speed = 0;
    }
    const target = frac * maxSpd * (1 - 0.12 * Math.abs(this.rudder));
    const accel = (this.maxSpeed / s.accelTime) * (Math.sign(target - this.speed) !== Math.sign(this.speed) ? 1.3 : 1);
    if (!this.mods.rooted) this.speed = approach(this.speed, target, accel * dt);

    if (this.rudderJam > 0) this.rudderJam -= dt;
    else this.rudder = approach(this.rudder, stunned ? 0 : this.rudderTarget, dt / s.rudderTime);

    this.turnRate = ((this.speed / s.turnRadius) * this.rudder * this.mods.turnMul);
    this.heading = wrapAngle(this.heading + this.turnRate * dt);

    // Knockback from shock waves and blasts bleeds off over a couple of seconds.
    const pk = Math.exp(-dt * 1.5);
    this.pushX *= pk;
    this.pushZ *= pk;
    const fx = forwardX(this.heading);
    const fz = forwardZ(this.heading);
    const nx = this.pos.x + (fx * this.speed + this.pushX) * dt;
    const nz = this.pos.z + (fz * this.speed + this.pushZ) * dt;

    // Island grounding: probe bow, midships and stern.
    const half = s.length / 2;
    const probe = Math.sign(this.speed || 1) * half * 0.95;
    const hBow = this.game.map.heightAt(nx + fx * probe, nz + fz * probe);
    const hMid = this.game.map.heightAt(nx, nz);
    const keel = -Math.min(s.draft, 6) * 0.6;
    if (hBow > keel || hMid > keel) {
      this.speed = 0;
      this.pushX = this.pushZ = 0;
      // A touch pushes the hull clear and stops it dead, so the next one may come a second or so
      // later. Count each touch, not just the time spent touching.
      this.grounded = Math.min(0.6, this.grounded + 0.2);
      const away = this.game.map.awayFromLand(this.pos.x, this.pos.z);
      this.pos.x += away.x * 2;
      this.pos.z += away.z * 2;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
      this.grounded = Math.max(0, this.grounded - dt * 0.05);
    }
    const lim = MAP_HALF - 150;
    if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.z) > lim) {
      // Driving into the map edge loses way; sliding along it does not. Either way enough is left
      // to turn back in, since a hull at a standstill cannot turn at all.
      const dir = Math.sign(this.speed);
      const into = Math.max(Math.abs(this.pos.x) > lim ? Math.sign(this.pos.x) * fx * dir : 0, Math.abs(this.pos.z) > lim ? Math.sign(this.pos.z) * fz * dir : 0);
      this.pos.x = clamp(this.pos.x, -lim, lim);
      this.pos.z = clamp(this.pos.z, -lim, lim);
      if (into > 0.3 && Math.abs(this.speed) > maxSpd * 0.35) this.speed *= 0.97;
    }
    if (frac > 0.3 && this.speed < maxSpd * 0.1 && this.speed - this.lastSpeed < accel * dt * 0.5) this.stalled += dt;
    else this.stalled = 0;
    this.lastSpeed = this.speed;
  }

  // ---------------------------------------------------------------- weapons

  private updateMain(dt: number): void {
    const main = this.spec.main;
    if (!main) return;
    const c = this.control;
    const aimDist = dist2D(this.pos.x, this.pos.z, c.aimX, c.aimZ);
    this.aimRange = aimDist;
    this.aimBearing = bearingTo(this.pos.x, this.pos.z, c.aimX, c.aimZ);
    const table = this.tableFor(this.ammo);
    const elev = table ? solve(table, aimDist).elevation : 0;
    const traverse = main.traverse * this.mods.traverseMul * dt;
    const canFireGuns = (!this.isSub || this.depthState === 0 && this.pos.y > -1.5) && !this.mods.stunned && !this.mods.disarmed;
    for (const t of this.turrets) {
      if (t.reload > 0) t.reload -= dt;
      if (t.disabled > 0) t.disabled -= dt;
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt);
      const tp = this.localToWorld(t.spec.x, 0, t.spec.z ?? 0, tmpV);
      const brg = bearingTo(tp.x, tp.z, c.aimX, c.aimZ);
      const rel = wrapDeg((brg - this.heading) / DEG - t.spec.facing);
      t.canBear = Math.abs(rel) <= t.spec.halfArc;
      const goal = clamp(rel, -t.spec.halfArc, t.spec.halfArc);
      t.yaw = approach(t.yaw, goal, traverse);
      t.aligned = t.canBear && Math.abs(t.yaw - rel) < 1.2;
      t.pitch = approach(t.pitch, elev, dt * 0.15);
    }
    const slot = this.currentSlot;
    if (c.fire && slot?.kind === 'gun' && canFireGuns) {
      for (let i = 0; i < this.turrets.length; i++) {
        const t = this.turrets[i];
        if (t.reload <= 0 && t.aligned && t.disabled <= 0) this.fireTurret(i, slot.ammo);
      }
    }
  }

  /** Fire one turret at the current aim point. `force` skips readiness checks (abilities). */
  fireTurret(index: number, ammo: AmmoType, force = false): boolean {
    const main = this.spec.main;
    const t = this.turrets[index];
    if (!main || !t) return false;
    if (!force && (t.reload > 0 || !t.aligned || t.disabled > 0)) return false;
    if (force && !t.canBear) return false;
    const shell = ammo === 'AP' ? main.ap ?? main.he : main.he ?? main.ap;
    const table = this.tableFor(ammo);
    if (!shell || !table) return false;
    const c = this.control;
    const g = this.game;
    const buff = this.salvo;
    if (buff && --buff.left <= 0) this.salvo = null;
    const tp = this.localToWorld(t.spec.x, 0, t.spec.z ?? 0, tmpV);
    const muzzleY = this.pos.y + this.spec.freeboard + t.spec.y + 3;
    const cap = this.mods.rangeCap > 0 ? this.mods.rangeCap : Infinity;
    const dist = Math.min(dist2D(tp.x, tp.z, c.aimX, c.aimZ), table.maxRange, cap);
    const brg = bearingTo(tp.x, tp.z, c.aimX, c.aimZ);
    // Smoke is cover, not invisibility: shots into it scatter wide.
    const smoke = g.inSmoke(c.aimX, c.aimZ) ? SMOKE_DISPERSION : 1;
    const disp = main.dispersion * this.mods.dispersionMul * (buff?.dispersionMul ?? 1) * smoke * this.evasionAt(c.aimX, c.aimZ);
    const sigmaH = (disp * (0.25 + (0.75 * dist) / main.range)) / 2;
    const sigmaV = sigmaH * 0.6;
    const dmgMul = this.mods.damageMul * (ammo === 'AP' ? this.mods.apDamageMul : 1) * (buff?.damageMul ?? 1);
    for (let b = 0; b < t.spec.barrels; b++) {
      const lateral = truncGaussian(g.rng) * sigmaH;
      const along = truncGaussian(g.rng) * sigmaV;
      const d = clamp(dist + along, 50, table.maxRange);
      const tx = tp.x + Math.sin(brg) * d + Math.cos(brg) * lateral;
      const tz = tp.z - Math.cos(brg) * d + Math.sin(brg) * lateral;
      g.shells.fire(this, {
        ammo,
        spec: shell,
        table,
        fromX: tp.x,
        fromY: muzzleY,
        fromZ: tp.z,
        toX: tx,
        toZ: tz,
        dmgMul,
        guaranteedFire: this.mods.guaranteedFire || !!buff?.guaranteedFire,
        railgun: this.mods.railgun || !!buff?.railgun,
        cluster: buff?.cluster ? buff.skill : undefined,
        flat: this.mods.flatShots || main.flat || 0,
        onHit: buff?.onHit,
        look: main.look,
      });
    }
    t.reload = this.mods.reloadOverride > 0 ? this.mods.reloadOverride : main.reload * this.mods.reloadMul;
    t.recoil = 0.6;
    this.stats.shotsFired += t.spec.barrels;
    g.events.emit('gunFired', { ship: this, x: tp.x, y: muzzleY, z: tp.z, bearing: brg, caliber: shell.caliber, secondary: false, look: main.look });
    return true;
  }

  /** Stealth hulls and jammers near the aim point make guns laid on them scatter wider. */
  private evasionAt(x: number, z: number): number {
    let k = 1;
    for (const s of this.game.ships) {
      if (s.mods.scatterTakenMul === 1 || !s.alive || s.team === this.team) continue;
      if (distToHull(s, x, z) < 300) k = Math.max(k, s.mods.scatterTakenMul);
    }
    return k;
  }

  private updateSecondaries(dt: number): void {
    if (!this.secondaries.length || this.submerged || this.mods.stunned || this.mods.disarmed) return;
    const g = this.game;
    this.secRetarget -= dt;
    if (this.secRetarget <= 0) {
      this.secRetarget = 0.5;
      this.secTarget = this.pickSecondaryTarget();
    }
    const tgt = this.secTarget;
    for (const m of this.secondaries) {
      if (m.reload > 0) m.reload -= dt;
      if (!tgt || m.reload > 0) continue;
      const mp = this.localToWorld(m.x, 0, m.z, tmpV);
      const brg = bearingTo(mp.x, mp.z, tgt.pos.x, tgt.pos.z);
      const rel = wrapAngle(brg - this.heading);
      // Mounts only engage targets on their own side of the ship.
      if (Math.sign(rel) !== m.side || Math.abs(rel) < 15 * DEG || Math.abs(rel) > 165 * DEG) continue;
      const range = Math.min(m.group.range * this.mods.secRangeMul, this.mods.rangeCap > 0 ? this.mods.rangeCap : Infinity);
      const d = dist2D(mp.x, mp.z, tgt.pos.x, tgt.pos.z);
      if (d > range) continue;
      const table = this.secTables.get(m.group)!;
      const sol = solve(table, d);
      // Fire control leads the target automatically.
      const lx = tgt.pos.x + forwardX(tgt.heading) * tgt.speed * sol.time;
      const lz = tgt.pos.z + forwardZ(tgt.heading) * tgt.speed * sol.time;
      const sigma = this.mods.secPerfect ? 0.004 * d + 8 : 0.03 * d + 20;
      for (let b = 0; b < m.group.barrels; b++) {
        g.shells.fire(this, {
          ammo: 'HE',
          spec: m.group.shell,
          table,
          fromX: mp.x,
          fromY: this.pos.y + m.y,
          fromZ: mp.z,
          toX: lx + truncGaussian(g.rng) * sigma,
          toZ: lz + truncGaussian(g.rng) * sigma,
          dmgMul: this.mods.damageMul,
          guaranteedFire: false,
          railgun: false,
          secondary: true,
        });
      }
      m.reload = m.group.reload * this.mods.secReloadMul * (0.9 + g.rng() * 0.2);
      g.events.emit('gunFired', { ship: this, x: mp.x, y: this.pos.y + m.y, z: mp.z, bearing: brg, caliber: m.group.shell.caliber, secondary: true });
    }
  }

  private pickSecondaryTarget(): Ship | null {
    let best: Ship | null = null;
    let bestD = Infinity;
    const maxR = Math.max(...(this.spec.secondaries ?? []).map((s) => s.range)) * this.mods.secRangeMul;
    for (const s of this.game.ships) {
      if (!s.alive || s.team === this.team || s.submerged) continue;
      const d = dist2D(this.pos.x, this.pos.z, s.pos.x, s.pos.z);
      const bias = s.id === this.control.targetId ? 0.6 : 1;
      if (d < maxR && d * bias < bestD) {
        bestD = d * bias;
        best = s;
      }
    }
    return best;
  }

  /** Relative bearing window check for a torpedo launcher. */
  launcherCanBear(l: LauncherState, rel: number): boolean {
    const a = Math.abs(rel) / DEG;
    switch (l.spec.side) {
      case 1:
        return rel > 0 && a >= 25 && a <= 155;
      case -1:
        return rel < 0 && a >= 25 && a <= 155;
      case 2:
        return a <= 40;
      case -2:
        return a >= 140;
      default:
        return a >= 25 && a <= 155;
    }
  }

  private updateTorpedoes(dt: number): void {
    const tspec = this.spec.torpedoes;
    if (!tspec) return;
    const c = this.control;
    for (const l of this.launchers) {
      if (l.reload > 0) l.reload -= dt;
      const lp = this.localToWorld(l.spec.x, 0, 0, tmpV);
      const brg = bearingTo(lp.x, lp.z, c.aimX, c.aimZ);
      l.yaw = brg;
    }
    const slot = this.currentSlot;
    if (!c.fire || slot?.kind !== 'torp' || this.mods.stunned || this.mods.disarmed) return;
    if (this.isSub && this.depthState === 2) return;
    this.launchSpread(tspec);
  }

  /** Every launcher that can bear fires its tubes at the reticle (with the torpedo buff, if any). */
  launchSpread(tspec: TorpedoSpec, ignoreReload = false): number {
    const c = this.control;
    const g = this.game;
    const tb = this.torpBuff;
    const homing = tb && tb.homing !== false ? this.lockAt(c.aimX, c.aimZ, 700) : null;
    const cap = this.mods.rangeCap > 0 ? this.mods.rangeCap : Infinity;
    const spec: TorpedoSpec = {
      ...tspec,
      speed: tspec.speed * (tb?.speedMul ?? 1),
      range: Math.min(tspec.range, cap),
      damage: tspec.damage * (tb?.damageMul ?? 1),
      look: tspec.look,
    };
    let fired = 0;
    for (const l of this.launchers) {
      if (l.reload > 0 && !ignoreReload) continue;
      const lp = this.localToWorld(l.spec.x, 0, (l.spec.side === 1 ? 1 : l.spec.side === -1 ? -1 : 0) * this.spec.beam * 0.3, tmpV);
      const brg = bearingTo(lp.x, lp.z, c.aimX, c.aimZ);
      const rel = wrapAngle(brg - this.heading);
      if (!this.launcherCanBear(l, rel)) continue;
      const n = l.tubes;
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? (i / (n - 1) - 0.5) * tspec.spread * DEG : 0;
        const t = g.torps.launch(this, lp.x, lp.z, brg + off, spec, homing);
        if (tb) {
          t.skill = tb.skill;
          t.wire = !!tb.wire;
          t.wakeless = !!tb.wakeless;
          t.split = tb.split ?? 0;
          t.onHit = tb.onHit ?? null;
          t.fire = tb.fire ?? 0;
        }
      }
      fired += n;
      l.reload = tspec.reload * this.mods.torpReloadMul;
      g.events.emit('torpLaunched', { ship: this, x: lp.x, z: lp.z, count: n });
    }
    if (fired && tb && --tb.spreads <= 0) this.torpBuff = null;
    return fired;
  }

  private updateVls(dt: number): void {
    const ms = this.spec.missiles;
    const v = this.vls;
    if (!ms || !v) return;
    if (v.reload > 0) v.reload -= dt;
    const c = this.control;
    const cap = this.mods.rangeCap > 0 ? Math.min(this.mods.rangeCap, ms.range) : ms.range;
    v.lock = this.lockAt(c.aimX, c.aimZ, 700);
    if (v.lock && dist2D(v.lock.pos.x, v.lock.pos.z, this.pos.x, this.pos.z) > cap) v.lock = null;
    if (!c.fire || this.currentSlot?.kind !== 'vls' || v.reload > 0 || this.mods.stunned || this.mods.disarmed) return;
    if (this.isSub && this.depthState === 2) return;
    const b = this.vlsBuff;
    this.vlsBuff = null;
    const n = ms.salvo + (this.trait?.vlsExtra ?? 0) + (b?.extra ?? 0);
    this.fireVls(n, v.lock, b?.skill ?? null, { ...b?.opts, damage: ms.damage * (b?.damageMul ?? 1) });
    v.reload = ms.reload * this.mods.missileReloadMul;
  }

  /**
   * Launch `n` missiles from the cells at `target` (or the reticle, held inside VLS range).
   * Skills pass their spec so damage popups carry their name; `o` overrides the cell defaults.
   */
  fireVls(n: number, target: Ship | null, skill: SkillSpec | null, o: Partial<MissileOptions> = {}): Missile[] {
    const ms = this.spec.missiles;
    const g = this.game;
    const range = ms?.range ?? 4000;
    let tx = target?.pos.x ?? this.control.aimX;
    let tz = target?.pos.z ?? this.control.aimZ;
    const d = dist2D(this.pos.x, this.pos.z, tx, tz);
    if (d > range) {
      tx = this.pos.x + ((tx - this.pos.x) * range) / d;
      tz = this.pos.z + ((tz - this.pos.z) * range) / d;
    }
    const out: Missile[] = [];
    for (let i = 0; i < n; i++) {
      // Rounds ripple out of the cells; without a lock they scatter over the aim point.
      const sx = target ? 0 : (g.rng() - 0.5) * 140;
      const sz = target ? 0 : (g.rng() - 0.5) * 140;
      const m = g.missiles.launch(this, tx + sx, tz + sz, i * 0.12, o.damage ?? ms?.damage ?? 6000, {
        profile: ms?.profile ?? 'cruise',
        look: ms?.look,
        fire: ms?.fire ?? 0.3,
        flood: ms?.flood ?? 0,
        ...o,
        target,
        skill,
      });
      out.push(m);
    }
    this.stats.shotsFired += n;
    return out;
  }

  private updateAir(dt: number): void {
    const air = this.spec.air;
    const st = this.air;
    if (!air || !st) return;
    if (st.cooldown > 0) st.cooldown -= dt;
    for (const k of ['torpedo', 'dive', 'fighter'] as const) {
      const sq = air[k];
      if (st.hangar[k] < sq.hangar) {
        st.restore[k] += dt;
        if (st.restore[k] >= sq.restore) {
          st.restore[k] = 0;
          st.hangar[k]++;
        }
      }
    }
    const slot = this.currentSlot;
    const c = this.control;
    // A carrier-submarine flies its wing off from periscope depth or the surface, never from the deep.
    if (c.fire && slot?.kind === 'air' && st.cooldown <= 0 && st.hangar[slot.sq] >= 1 && !this.mods.stunned && !this.mods.disarmed && !this.deep) {
      if (this.game.air.launch(this, slot.sq, c.aimX, c.aimZ)) st.cooldown = air.launchCooldown;
    }
  }

  // ---------------------------------------------------------------- damage

  /** Scale damage by the remaining HP pool of a zone (saturation). */
  zoneDamage(zone: ArmorZone, dmg: number): number {
    const pool = this.zonePools[zone];
    if (pool === Infinity) return dmg;
    if (pool <= 0) return dmg * 0.5;
    this.zonePools[zone] = pool - dmg;
    return dmg;
  }

  /** Black Flash: the multiplier on one of this ship's hits on `target` (1 for a plain hit). */
  critMul(target: Ship): number {
    const c = this.trait?.crit;
    if (!c || target.team === this.team || this.game.rng() >= c.chance) return 1;
    this.game.events.emit('ribbon', { ship: this, kind: 'Black Flash', damage: 0, target });
    return c.mul;
  }

  /**
   * Apply damage after shields and modifiers. `skill` tags skill damage for popups and stats;
   * `reflected` stops a reflect bouncing back and forth between two mirrored ships. A `pierce`
   * hit (World-Cutting Slash) cuts through invulnerability, guards, shields and hit caps, though
   * never through a fresh spawn's protection or out of the world.
   */
  takeDamage(amount: number, attacker: Ship | null, skill: SkillSpec | null = null, reflected = false, pierce = false): number {
    if (!this.alive || amount <= 0) return 0;
    if (pierce && (this.mods.banished || this.effects.some((e) => e.id === 'spawn' || e.id === 'revived'))) return 0;
    if (this.mods.invulnerable && !pierce) return 0;
    const hostile = !!attacker && attacker.team !== this.team;
    if (hostile && !pierce && this.mods.dodge > 0 && this.game.rng() < this.mods.dodge) return 0;
    let mul = this.mods.damageTakenMul;
    if (attacker && this.game.exposed[attacker.team] > 0) mul *= 1.25;
    if (this.mods.marked && hostile) mul *= 1.25;
    if (hostile && attacker.ambushReady && !attacker.mods.untargetable) {
      attacker.ambushReady = false;
      mul *= attacker.trait?.ambush ?? 1;
      this.game.events.emit('ribbon', { ship: attacker, kind: 'Ambush', damage: 0, target: this });
    }
    let raw = amount * mul;
    if (hostile && attacker.mods.inverted) {
      this.heal(raw);
      return 0;
    }
    if (hostile && skill && !reflected && !pierce && this.mods.spellMirror) {
      this.game.events.emit('shieldHit', { ship: this, amount: raw });
      if (attacker.alive) attacker.takeDamage(amount, this, skill, true);
      return 0;
    }
    if (this.mods.hitCap > 0 && !pierce) raw = Math.min(raw, this.maxHp * this.mods.hitCap);
    const link = this.link;
    if (link && this.game.time > link.until) this.link = null;
    else if (link && hostile && !reflected) {
      const others = link.group.filter((s) => s !== this && s.alive);
      if (link.mode === 'spread' && others.length) {
        raw /= others.length + 1;
        for (const s of others) s.takeDamage(raw, attacker, link.skill, true);
      } else if (link.mode === 'echo') {
        for (const s of others) s.takeDamage(raw * link.share, attacker, link.skill, true);
      }
    }
    if (hostile) this.lastHurt = this.game.time;
    const guard = this.guard;
    if (guard && hostile && !pierce && raw >= guard.min) {
      if (this.game.time > guard.until) this.guard = null;
      else {
        if (--guard.left <= 0) this.guard = null;
        this.game.events.emit('shieldHit', { ship: this, amount: raw });
        guard.onBlock?.(attacker);
        return 0;
      }
    }
    if (this.shield > 0 && !pierce) {
      const absorbed = Math.min(this.shield, raw);
      this.shield -= absorbed;
      raw -= absorbed;
      this.game.events.emit('shieldHit', { ship: this, amount: absorbed });
      if (this.shield <= 0) this.shield = this.shieldMax = this.shieldTime = 0;
      if (raw <= 0) return 0;
    }
    if (hostile) this.intake += raw;
    let dmg = Math.min(this.hp, raw);
    if (this.mods.undying) dmg = Math.max(0, Math.min(dmg, this.hp - 1));
    this.hp -= dmg;
    this.stats.received += dmg;
    if (hostile) {
      // Taking punishment charges the meter too, at a lower rate: a way back into the fight.
      this.charge(dmg * ULT_DAMAGE_CHARGE * ULT_TAKEN_CHARGE);
      attacker.stats.damage += dmg;
      // An ultimate's own damage does not refill the meters, or the big ones recast at once.
      if (!skill?.ult) attacker.charge(dmg * ULT_DAMAGE_CHARGE);
      if (attacker.mods.lifesteal > 0) attacker.heal(dmg * attacker.mods.lifesteal);
      this.lastAttacker = attacker;
      // Wingmen credit their damage to the player who summoned them.
      if (attacker.summonOwner) attacker.summonOwner.stats.damage += dmg;
      if (skill) attacker.stats.skill += dmg;
      if (skill) this.game.events.emit('skillHit', { ship: this, attacker, skill, damage: dmg });
      if (this.mods.reflect > 0 && !reflected && attacker.alive) {
        attacker.takeDamage(dmg * this.mods.reflect, this, null, true);
      }
      if (this.mods.zap > 0 && !reflected && attacker.alive && this.game.time - (this.zaps.get(attacker.id) ?? -1e9) >= 1) {
        this.zaps.set(attacker.id, this.game.time);
        this.game.events.emit('lightning', {
          points: [
            { x: this.pos.x, y: this.spec.freeboard + 30, z: this.pos.z },
            { x: attacker.pos.x, y: attacker.spec.freeboard + 6, z: attacker.pos.z },
          ],
          color: this.mods.zapSkill?.accent ?? 0xc58cff,
        });
        attacker.takeDamage(this.mods.zap * this.mods.damageMul, this, this.mods.zapSkill, true);
        if (attacker.alive) stun(attacker, 1);
      }
    }
    if (this.hp <= 0.5) this.sink(attacker ?? this.lastAttacker);
    return dmg;
  }

  heal(amount: number): void {
    if (!this.alive || this.mods.healBlock) return;
    const over = this.hp + amount - this.maxHp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (over > 0 && this.mods.overShield > 0) {
      this.shield = Math.min(this.maxHp * this.mods.overShield, this.shield + over);
      this.shieldMax = Math.max(this.shieldMax, this.shield);
      this.shieldTime = Math.max(this.shieldTime, 8);
    }
  }

  /** Fires and flooding cannot start (Repair kit afterglow, Iron Wall...). */
  get fireProof(): boolean {
    return this.mods.fireImmune || consumableActive(this, 'repair') > 0;
  }

  startFire(site: number, attacker: Ship | null): boolean {
    if (!this.alive || this.submerged || this.fireProof) return false;
    site = clamp(site, 0, MAX_FIRES - 1);
    if (this.fires[site] > 0) return false;
    this.fires[site] = FIRE_DURATION * this.mods.fireDurationMul;
    this.fireAttacker[site] = attacker;
    if (attacker) attacker.stats.fires++;
    this.game.events.emit('fire', { ship: this, site });
    if (attacker) this.game.events.emit('ribbon', { ship: attacker, kind: 'Fire', damage: 0, target: this });
    return true;
  }

  startFlood(attacker: Ship | null): boolean {
    if (!this.alive || this.fireProof || this.flooding > 0) return false;
    this.flooding = FLOOD_DURATION * this.mods.fireDurationMul;
    this.floodAttacker = attacker;
    this.game.events.emit('flood', { ship: this });
    if (attacker) this.game.events.emit('ribbon', { ship: attacker, kind: 'Flooding', damage: 0, target: this });
    return true;
  }

  extinguish(): void {
    this.fires.fill(0);
    this.flooding = 0;
  }

  /** Clear fires, flooding, module damage and hostile statuses. */
  cleanse(): void {
    this.extinguish();
    this.rudderJam = this.engineDown = 0;
    for (const t of this.turrets) t.disabled = 0;
    this.effects = this.effects.filter((e) => !e.id.startsWith('debuff:'));
  }

  /** Map a local x coordinate to one of the four fire sites (bow..stern). */
  fireSiteAt(lx: number): number {
    const u = lx / (this.spec.length / 2);
    if (u > 0.45) return 0;
    if (u > 0) return 1;
    if (u > -0.45) return 2;
    return 3;
  }

  private updateDamageOverTime(dt: number): void {
    for (let i = 0; i < MAX_FIRES; i++) {
      if (this.fires[i] <= 0) continue;
      this.fires[i] -= dt;
      const by = this.fireAttacker[i];
      this.takeDamage(this.maxHp * FIRE_DPS_FRACTION * dt * (by?.mods.fireDamageMul ?? 1), by);
      if (!this.alive) return;
    }
    if (this.flooding > 0) {
      this.flooding -= dt;
      this.takeDamage(this.maxHp * FLOOD_DPS_FRACTION * dt, this.floodAttacker);
    }
  }

  private get regenDelay(): number {
    return (this.colossus ? COLOSSUS.regenDelay : REGEN_DELAY) - (this.trait?.regenSooner ?? 0);
  }

  /** Out of combat for a few seconds (REGEN_DELAY, less for a titan): patch the hull back up. Not under water. */
  private updateRegen(dt: number): void {
    // Nanite hulls knit themselves back together whatever is going on.
    const always = this.trait?.regenAlways;
    if (always && this.alive && this.mods.regenMul > 0) this.heal(this.maxHp * always * dt);
    if (!this.regenerating) return;
    if (this.fires.some((f) => f > 0) || this.flooding > 0) return;
    this.heal(this.maxHp * REGEN_RATE * (this.colossus ? COLOSSUS.regenRate : 1) * (this.trait?.regenMul ?? 1) * this.mods.regenMul * dt);
  }

  /** Regen is ticking (HUD shimmer). */
  get regenerating(): boolean {
    return this.alive && !this.submerged && this.mods.regenMul > 0 && this.hp < this.maxHp && this.game.time - this.lastHurt >= this.regenDelay;
  }

  /** Knockback (m/s), eased for long hulls unless `eased` is false. Bastion hulls cannot be moved. */
  shove(vx: number, vz: number, eased = true): void {
    if (this.trait?.knockImmune || this.mods.knockImmune || this.mods.banished) return;
    const k = eased ? Math.min(1, 180 / this.spec.length) : 1;
    this.pushX += vx * k;
    this.pushZ += vz * k;
  }

  /** Ram damage against an enemy hull, at most once per second per target. */
  ramInto(other: Ship): void {
    if (this.mods.ram <= 0 || other.team === this.team || !other.alive) return;
    const last = this.rams.get(other.id) ?? -1e9;
    if (this.game.time - last < 1) return;
    this.rams.set(other.id, this.game.time);
    other.takeDamage(this.mods.ram * this.mods.damageMul, this, this.mods.ramSkill);
    other.startFlood(this);
    this.game.events.emit('explosion', { x: other.pos.x, y: 4, z: other.pos.z, size: 1.4 });
  }

  sink(killer: Ship | null): void {
    if (!this.alive) return;
    const ls = this.lastStand;
    if (ls && this.game.time <= ls.until) {
      // Deathless: the hull refuses to go down, once.
      this.lastStand = null;
      this.hp = this.maxHp * ls.hpFrac;
      this.cleanse();
      this.addEffect({
        id: 'revived',
        time: 2,
        apply(m) {
          m.invulnerable = true;
        },
      });
      this.game.events.emit('revive', { ship: this, skill: ls.skill });
      return;
    }
    this.alive = false;
    this.hp = 0;
    this.deathTime = 0;
    this.stats.deaths++;
    this.extinguish();
    const credited = killer?.summonOwner ?? killer;
    if (credited && credited.team !== this.team) credited.stats.kills++;
    this.game.onShipSunk(this, credited ?? null);
  }

  /** The magazines go up on a ship that has just sunk. */
  detonate(killer: Ship | null): void {
    if (this.alive || this.detonated || this.withdrawn) return;
    this.detonated = true;
    const g = this.game;
    g.events.emit('detonation', { ship: this, killer });
    g.events.emit('explosion', { x: this.pos.x, y: this.spec.freeboard, z: this.pos.z, size: 3.2 });
    const credited = killer?.summonOwner ?? killer;
    if (credited && credited.team !== this.team) g.events.emit('ribbon', { ship: credited, kind: 'Detonation', damage: 0 });
  }

  /**
   * Back into the fight at (x, z) as a fresh hull (Domination). The same object comes back, so
   * controllers, the HUD and the scoreboard keep following it; ultimate meters carry over.
   */
  respawn(x: number, z: number, heading: number): void {
    // A ship sunk in its titan form comes back as itself.
    const reverted = !!this.form || this.spec !== this.base;
    if (reverted) {
      const hpRatio = this.form?.saved.hpRatio ?? this.maxHp / this.spec.hp;
      this.form = null;
      this.build(this.base);
      this.maxHp = this.base.hp * hpRatio;
    }
    this.shiftQueued = null;
    const spec = this.spec;
    this.alive = true;
    this.withdrawn = false;
    this.detonated = false;
    this.hp = this.maxHp;
    this.deathTime = 0;
    this.lastAttacker = null;
    this.lastHurt = -1e9;
    this.pos.set(x, 0, z);
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this.heading = this.prevHeading = this.renderHeading = heading;
    this.throttle = 5;
    this.speed = this.maxSpeed * 0.5;
    this.rudder = this.rudderTarget = this.turnRate = 0;
    this.pushX = this.pushZ = 0;
    this.control = emptyControl();
    this.control.aimX = x + forwardX(heading) * 2000;
    this.control.aimZ = z + forwardZ(heading) * 2000;
    this.extinguish();
    this.fireAttacker.fill(null);
    this.floodAttacker = null;
    this.rudderJam = this.engineDown = this.grounded = this.stalled = 0;
    this.lastSpeed = this.speed;
    this.zonePools = {
      bow: spec.hp * 0.12,
      stern: spec.hp * 0.12,
      superstructure: spec.hp * 0.12,
      belt: spec.hp * 0.3,
      deck: spec.hp * 0.25,
      turret: Infinity,
    };
    for (const t of this.turrets) t.reload = t.disabled = t.recoil = 0;
    for (const l of this.launchers) l.reload = 0;
    this.consumables = createConsumables(spec);
    for (const st of this.skills) {
      st.active = false;
      st.time = 0;
      st.data = {};
      if (!st.spec.ult) st.cooldown = 0;
    }
    this.shield = this.shieldMax = this.shieldTime = 0;
    this.salvo = null;
    this.torpBuff = null;
    this.airBuff = null;
    this.guard = null;
    this.lastStand = null;
    this.link = null;
    this.ambushReady = false;
    this.history.length = 0;
    if (this.vls) this.vls = { reload: 0, lock: null };
    this.vlsBuff = null;
    this.depthState = 0;
    if (spec.sub) this.battery = spec.sub.battery;
    if (this.air && spec.air) {
      this.air.hangar = { torpedo: spec.air.torpedo.hangar, dive: spec.air.dive.hangar, fighter: spec.air.fighter.hangar };
      this.air.restore = { torpedo: 0, dive: 0, fighter: 0 };
      this.air.cooldown = 0;
    }
    // Refits and passives stay; everything picked up in the last life goes.
    this.effects = this.effects.filter((e) => e.time === Infinity);
    this.addEffect({
      id: 'spawn',
      time: RESPAWN_SHIELD,
      apply(m) {
        m.invulnerable = true;
      },
    });
    // Quiet: the respawn has its own flash, but HUDs still lay out the base hull's skills again.
    if (reverted) this.game.events.emit('shift', { ship: this, on: false, quiet: true });
    this.game.events.emit('respawn', { ship: this });
  }

  withdraw(): void {
    if (!this.alive) return;
    this.alive = false;
    this.withdrawn = true;
    this.hp = 0;
    this.game.events.emit('explosion', { x: this.pos.x, y: 5, z: this.pos.z, size: 0.3 });
  }
}

const tmpV = new Vector3();
