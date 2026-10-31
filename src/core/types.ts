// Shared type definitions for the headless simulation and the spec data.

/** TT: titan, the oversized super-ships of Boss Rush (also playable). */
/** AK: a convoy's cargo ship (never in the hangar). */
export type ShipClass = 'BB' | 'CB' | 'CA' | 'CL' | 'DD' | 'CV' | 'SS' | 'TT' | 'AK';
/** The settings a ship comes from. Misc holds oddities with no era of their own and is never a battle era by itself. */
export type Era = 'historic' | 'fantasy' | 'modern' | 'scifi' | 'anime' | 'misc';
/** A battle is fought in one era, or with every era's ships at once. */
export type BattleEra = Era | 'mixed';
/** A ship's navy or faction; each belongs to one era (see data/factions). */
export type Nation =
  | 'japan'
  | 'usa'
  | 'germany'
  | 'uk'
  | 'ussr'
  | 'silverwood'
  | 'deepforge'
  | 'drowned'
  | 'conclave'
  | 'us_mod'
  | 'ru_mod'
  | 'cn_mod'
  | 'uk_mod'
  | 'jp_sf'
  | 'us_sf'
  | 'ru_sf'
  | 'cn_sf'
  | 'jjk'
  | 'naruto'
  | 'onepiece'
  | 'dragonball'
  | 'bleach'
  | 'aot'
  | 'demonslayer'
  | 'mha'
  | 'abyss'
  | 'fold'
  | 'lodestone'
  | 'foundry';
export type AmmoType = 'AP' | 'HE';
export type Team = 0 | 1;

export type ArmorZone = 'bow' | 'stern' | 'belt' | 'deck' | 'superstructure' | 'turret';

export type HitOutcome =
  | 'citadel'
  | 'penetration'
  | 'overpen'
  | 'ricochet'
  | 'shatter'
  | 'he'
  | 'torpedo'
  | 'bomb'
  | 'missile'
  | 'secondary';

export type ConsumableType = 'repair' | 'smoke' | 'search' | 'speedBoost' | 'depthCharges';

/** How a main battery's rounds look in flight (and what its two ammo types are called). */
export type GunLook = 'shell' | 'starbolt' | 'runefire' | 'soulfire' | 'arcane' | 'rail' | 'laser' | 'plasma';
/** What a carrier's squadrons are drawn as. */
export type PlaneLook = 'plane' | 'griffon' | 'gyro' | 'bat' | 'dragon' | 'jet' | 'heli' | 'drone' | 'petal';
/** What a torpedo is drawn as. */
export type TorpLook = 'torpedo' | 'eel' | 'lance';
/** Flight profile of a guided missile. */
export type MissileProfile = 'cruise' | 'skim' | 'ballistic' | 'hyper';
/** What a missile is drawn as. */
export type MissileLook = 'missile' | 'bolt' | 'drone' | 'arrow' | 'rune' | 'hammer' | 'boar' | 'spear' | 'star';

export interface ShellSpec {
  /** Bore in millimetres. */
  caliber: number;
  /** Projectile mass in kilograms. */
  mass: number;
  /** Muzzle velocity in metres per second (real-world value). */
  velocity: number;
  /** Alpha damage of a full hit. */
  damage: number;
  /** AP: penetration (mm) at muzzle velocity. HE: flat penetration. */
  pen: number;
  /** HE fire chance per penetrating hit (0..1). */
  fireChance?: number;
  /** Drag coefficient (default 0.3). */
  cd?: number;
}

export interface GunTurretSpec {
  /** Position along the hull, metres forward of midships. */
  x: number;
  /** Lateral offset (starboard positive), default 0. */
  z?: number;
  /** Height of turret base above the deck line (superfiring turrets are higher). */
  y: number;
  /** Rest direction relative to bow in degrees (0 forward, 180 aft, ±90 broadside). */
  facing: number;
  /** Half of the traverse arc around `facing`, in degrees. */
  halfArc: number;
  barrels: number;
}

export interface MainBatterySpec {
  name: string;
  turrets: GunTurretSpec[];
  /** Seconds between salvos per turret. */
  reload: number;
  /** Turret traverse, degrees per second. */
  traverse: number;
  /** Maximum firing range in metres (game scale). */
  range: number;
  /** Horizontal dispersion (metres, ~2 sigma) at max range. */
  dispersion: number;
  barrelLength: number;
  ap?: ShellSpec;
  he?: ShellSpec;
  /** Tracer style and ammo names (default 'shell'). */
  look?: GunLook;
  /** Rounds fly in a straight line at this multiple of their muzzle velocity (lasers, rails). */
  flat?: number;
  /** What the AP and HE rounds are called (default "AP shells", "HE shells"). */
  ammoNames?: [string, string];
}

/** Vertical launch cells: a salvo of guided missiles at the ship nearest the reticle. */
export interface MissileBatterySpec {
  name: string;
  /** Missiles per salvo. */
  salvo: number;
  /** Seconds between salvos. */
  reload: number;
  /** Damage of each missile. */
  damage: number;
  range: number;
  profile: MissileProfile;
  look?: MissileLook;
  fire?: number;
  flood?: number;
}

export interface SecondarySpec {
  name: string;
  /** Mounts per side. */
  perSide: number;
  barrels: number;
  reload: number;
  range: number;
  /** Fore/aft span along the hull where the mounts are placed. */
  span: [number, number];
  y: number;
  shell: ShellSpec;
}

export interface TorpedoLauncherSpec {
  x: number;
  /** +1 starboard, -1 port, 0 centreline (fires either side), 2 bow tubes, -2 stern tubes */
  side: number;
  /** Overrides TorpedoSpec.tubes for this launcher. */
  tubes?: number;
}

export interface TorpedoSpec {
  name: string;
  launchers: TorpedoLauncherSpec[];
  tubes: number;
  reload: number;
  /** Knots (game uses SPEED_SCALE). */
  speed: number;
  range: number;
  damage: number;
  floodChance: number;
  /** Fan spread in degrees. */
  spread: number;
  /** Distance at which enemies see the torpedo. */
  detect: number;
  look?: TorpLook;
}

export type SquadronType = 'torpedo' | 'dive' | 'fighter';

export interface SquadronSpec {
  name: string;
  planes: number;
  hangar: number;
  /** Seconds to restore one plane to the hangar. */
  restore: number;
  /** m/s game scale. */
  speed: number;
  hp: number;
  /** Payload damage per plane. */
  damage: number;
}

export interface AirWingSpec {
  torpedo: SquadronSpec;
  dive: SquadronSpec;
  fighter: SquadronSpec;
  /** Seconds between launching squadrons. */
  launchCooldown: number;
  range: number;
  look?: PlaneLook;
}

export interface ConsumableSpec {
  type: ConsumableType;
  charges: number;
  cooldown: number;
  duration: number;
  /** Radius for search, heal fraction for repair, speed multiplier for boost. */
  power?: number;
  /** Seconds to restock one spent charge (repair kit). */
  restock?: number;
}

/** Glyph drawn on a skill button. */
export type SkillIcon =
  | 'beam'
  | 'laser'
  | 'missile'
  | 'shield'
  | 'lightning'
  | 'blink'
  | 'strike'
  | 'heal'
  | 'cloak'
  | 'torpedo'
  | 'plane'
  | 'mine'
  | 'wave'
  | 'speed'
  | 'reveal'
  | 'salvo'
  | 'nuke'
  | 'flak'
  | 'ram'
  | 'cryo'
  | 'drone'
  | 'magnet'
  | 'fleet'
  | 'wall'
  | 'snow'
  | 'drums'
  | 'gale'
  | 'rod'
  | 'blade'
  | 'root'
  | 'silence'
  | 'fear'
  | 'skull'
  | 'rune'
  | 'meteor'
  | 'time'
  | 'portal'
  | 'beast'
  | 'hammer'
  | 'eye'
  | 'swap'
  | 'gravity'
  | 'radar'
  | 'shift'
  | 'fist'
  | 'dice';

export interface SkillSpec {
  element?:import('../data/architectLoadout').ArchitectElement;
  reaction?:[import('../data/architectLoadout').ArchitectElement,import('../data/architectLoadout').ArchitectElement];
  /** Key into the skill registry (src/skills). */
  id: string;
  name: string;
  /** Short caps label for buttons and damage popups. */
  short: string;
  description: string;
  /** An OVERPOWERED ultimate: charged by its own meter rather than a cooldown. */
  ult?: boolean;
  /** An ultimate that powers the rest of the kit: while it runs the ship (and its AI) keeps casting skills. */
  empowers?: boolean;
  /** Seconds of cooldown (skills) or of passive charge (ultimate). */
  cooldown: number;
  /** Seconds the skill stays active (0 for instant ones). */
  duration: number;
  /** Signature colour: shockwave, aura, banner and popups. */
  accent: number;
  icon: SkillIcon;
  /** Radius (m) of the area the skill holds around the ship while active; drawn as a dome. */
  zone?: number;
  /** Can be started while stunned or silenced. Banishment and the caster's own step sequences still block it. */
  alwaysUsable?: boolean;
}

export interface ArmorSpec {
  belt: number;
  deck: number;
  bow: number;
  stern: number;
  superstructure: number;
  turret: number;
  /** Extra internal plate guarding the citadel (turtleback etc.). */
  citadelInner: number;
  /** Fraction of torpedo damage absorbed. */
  torpedoProtection: number;
}

export interface CitadelSpec {
  /** Fraction of hull length covered by the citadel. */
  length: number;
  /** Citadel roof relative to the waterline (metres). */
  top: number;
  /** Citadel half-width as fraction of beam/2. */
  width: number;
}

export interface SuperBlock {
  x: number;
  len: number;
  w: number;
  h: number;
  /** Base height above deck (default: stacked). */
  y?: number;
  /** Lateral offset (starboard positive). */
  z?: number;
}

export interface ModelSpec {
  palette: { hull: number; upper: number; deck: number; accent: number; boot?: number };
  camo?: 'none' | 'baltic' | 'measure22' | 'dazzle';
  bow: 'clipper' | 'straight' | 'bulbous';
  stern: 'transom' | 'cruiser';
  blocks: SuperBlock[];
  tower?: { x: number; h: number; w: number; len: number; style: 'pagoda' | 'tower' | 'tripod' | 'block' };
  funnels: { x: number; r: number; h: number; tilt?: number; len?: number }[];
  masts: { x: number; h: number }[];
  flightDeck?: { y: number; overhang: number };
  conningTower?: { x: number; len: number; h: number };
  sheer?: number;
  /**
   * Slab-sided ice fortress instead of a ship-shaped hull (Habakkuk); galleons get castles and a
   * figurehead; tumblehome sides lean in above the waterline under a wave-piercing bow (Zumwalt).
   */
  hullStyle?: 'ship' | 'block' | 'galleon' | 'tumblehome';
  /** Glowing energy emitters on deck (titans). */
  emitters?: { x: number; y: number; len: number; w: number; color: number }[];
  /** Masts rigged with square sails: `h` above the deck, `w` the widest yard, `rows` sails high. */
  sails?: { x: number; h: number; w: number; rows?: number }[];
  /** Sail cloth colour (default off-white). */
  sailColor?: number;
  /** Glowing crystal spires standing on deck. */
  spires?: { x: number; z?: number; h: number; r: number; color: number }[];
  /** A glowing band of runes along both sides of the hull. */
  runeBand?: number;
  /** Vertical launch cells: a grid of hatches `rows` across and `cols` long, centred at `x`. */
  vls?: { x: number; z?: number; rows: number; cols: number }[];
  /** Phased-array radar faces on the superstructure at `x`, `y` above the deck, `w` across. */
  panels?: { x: number; y: number; w: number }[];
  /** Ekranoplan wings and tail (Lun): span tip to tip, chord fore and aft. */
  wings?: { x: number; span: number; chord: number };
  /** Gun house shape (default 'gun'). */
  turretStyle?: 'gun' | 'orb' | 'runecannon' | 'stealth' | 'rail' | 'emitter';
  /** Swept blade fins standing on deck (sci-fi): `h` tall, `len` long, on the centreline unless `z`. */
  fins?: { x: number; h: number; len: number; z?: number }[];
  /** Sensor domes on the superstructure at `x`, radius `r`. */
  domes?: { x: number; r: number }[];
  /** A continuous glowing light line along both sides of the hull, in this colour. */
  lightStrip?: number;
  /** An orrery: `count` glowing spheres of radius `size` circling `r` out, `y` above the deck at `x` (Astraea). */
  orbs?: { x: number; y: number; r: number; count: number; size: number; color: number };
  /** A smoking volcanic cone on deck at `x`, `r` across the base and `h` high, its crater glowing (Brokkr). */
  volcano?: { x: number; r: number; h: number; glow: number };
  /** Satellite uplink dishes of radius `r`, tilted skyward (Constellation). */
  dishes?: { x: number; z?: number; r: number }[];
  /** A titan form's aura: a glowing shell of this colour around the whole hull. */
  formAura?: number;
}

export interface ShipSpec {
  id: string;
  name: string;
  nation: Nation;
  cls: ShipClass;
  year: number;
  description: string;
  specialty: string;
  hp: number;
  length: number;
  beam: number;
  draft: number;
  freeboard: number;
  /** Knots, real value. */
  maxSpeed: number;
  /** Seconds to reach full speed from stop. */
  accelTime: number;
  /** Turning radius in metres (game scale). */
  turnRadius: number;
  /** Seconds to shift rudder from centre to full. */
  rudderTime: number;
  armor: ArmorSpec;
  citadel: CitadelSpec;
  main?: MainBatterySpec;
  secondaries?: SecondarySpec[];
  torpedoes?: TorpedoSpec;
  missiles?: MissileBatterySpec;
  air?: AirWingSpec;
  aa: { range: number; dps: number };
  /** [0] is always the repair kit (F); [1] the optional class utility (G). */
  consumables: ConsumableSpec[];
  /** Normal skills first, then ultimates, in key order: Q, E, R for most ships; titans carry six and three. */
  skills: SkillSpec[];
  model: ModelSpec;
  sub?: { battery: number; periscopeDepth: number; deepDepth: number; diveRate: number };
  /** Summon-only: never in the hangar or a random roster. */
  hidden?: boolean;
  /** Titan Shift (anime): the ultimate turns the ship into the titan `form` (a spec id) for `time` seconds. */
  shift?: { form: string; time: number };
  /** A Titan Shift form: the id of the ship it is the form of (hidden from the hangar). */
  formOf?: string;
}
