import type { Era, Nation, SkillSpec } from '../../core/types';

// Ground vehicles: what a spec holds. Speeds in the data are km/h, armour in mm, guns in mm.

/** Heavy, medium, light, tank destroyer, artillery, missile carrier, support, titan. */
export type VehicleClass = 'HT' | 'MT' | 'LT' | 'TD' | 'SPG' | 'MSL' | 'SUP' | 'TT';

export const CLASS_NAME: Record<VehicleClass, string> = {
  HT: 'Heavy tank',
  MT: 'Medium tank',
  LT: 'Light tank',
  TD: 'Tank destroyer',
  SPG: 'Artillery',
  MSL: 'Missile carrier',
  SUP: 'Support',
  TT: 'Titan',
};

export const VEHICLE_CLASSES: VehicleClass[] = ['HT', 'MT', 'LT', 'TD', 'SPG', 'MSL', 'SUP', 'TT'];

/** Armour piercing, high explosive, shaped charge, sub-calibre (APCR/APDS/APFSDS). */
export type AmmoKind = 'AP' | 'HE' | 'HEAT' | 'APDS';

export interface AmmoSpec {
  kind: AmmoKind;
  /** Name on the ammo slot ("PzGr 39/43", "HVAP"...). */
  label: string;
  /** Real muzzle velocity, m/s (flight uses SHELL_SPEED_SCALE; artillery picks its own charge). */
  velocity: number;
  damage: number;
  /** Penetration at point-blank range, mm. */
  pen: number;
  /** Blast radius (m), for high explosive. */
  splash?: number;
}

export interface GunSpec {
  name: string;
  caliber: number;
  /** Seconds between shots, or to refill the clip. */
  reload: number;
  /** Autoloader: rounds in the clip and seconds between them. */
  clip?: { size: number; interval: number };
  /** Barrels firing together (Ratte twin mounts). */
  barrels?: number;
  /** Turret traverse, degrees a second. */
  traverse: number;
  /** Gun depression and elevation limits, degrees. */
  depression: number;
  elevation: number;
  /** Dispersion: shot spread radius (m) at 100 m, fully aimed. */
  dispersion: number;
  /** Seconds for the aim circle to settle. */
  aimTime: number;
  range: number;
  ammo: AmmoSpec[];
  /** Casemate mounts: half-angle (deg) of the gun's arc either side of `facing`. */
  arc?: number;
  /** Casemate mounts: where the arc points, degrees from the bow (180: firing over the rear deck). */
  facing?: number;
  /** High-arc howitzer: the shells come down on the roof. */
  artillery?: boolean;
  /** How the rounds are drawn. */
  look?: 'shell' | 'rail' | 'plasma' | 'laser' | 'arcane' | 'runefire' | 'soulfire' | 'starbolt';
}

/** A rocket or missile launcher: unguided salvos, beam-riders that follow the crosshair, or top-attack locks. */
export interface LauncherSpec {
  name: string;
  /** Rockets per salvo, and seconds between them. */
  salvo: number;
  interval: number;
  /** Seconds to reload the whole salvo. */
  reload: number;
  /** m/s. */
  speed: number;
  damage: number;
  pen: number;
  splash: number;
  /** Spread radius (m) at 100 m (unguided rockets). */
  spread: number;
  range: number;
  guidance: 'none' | 'beam' | 'top';
  /** Launch rails' arc either side of the bow (deg); 180 turns with a turret. */
  arc: number;
  look?: 'rocket' | 'missile' | 'drone' | 'arrow' | 'bolt';
}

export type Locomotion = 'tracks' | 'wheels' | 'hover';

export interface DriveSpec {
  type: Locomotion;
  /** km/h forward and reverse. */
  maxSpeed: number;
  reverse: number;
  /** m/s². */
  accel: number;
  /** Hull turn rate, degrees a second (pivot rate for tracks and hover; at speed for wheels). */
  turnRate: number;
  /** Steepest slope the vehicle can climb, degrees. */
  climbDeg: number;
}

export interface PlateSet {
  front: number;
  side: number;
  rear: number;
  roof: number;
}

export interface VehicleArmor {
  hull: PlateSet & {
    /** Upper glacis lean back from vertical, degrees. */
    slope: number;
  };
  /** Null for casemates and open mounts. */
  turret: (PlateSet & { slope?: number }) | null;
}

export interface VehicleSize {
  length: number;
  width: number;
  /** Hull roof above the ground. */
  height: number;
  /** Turret box: width, length and height above the hull roof, and its centre forward of the hull's. */
  turret?: { width: number; length: number; height: number; offset: number };
  /** Gun barrel length (m), for muzzle positions. */
  barrel: number;
}

export type GroundConsumableType =
  | 'repair'
  | 'applique'
  | 'overdrive'
  | 'smoke'
  | 'steady'
  | 'relocate'
  | 'rapidReload'
  | 'fieldRepair'
  | 'bulwark';

export interface GroundConsumableSpec {
  type: GroundConsumableType;
  name: string;
  charges: number;
  cooldown: number;
  duration: number;
  /** Heal share, speed multiplier, radius... per type. */
  power?: number;
}

/** How a vehicle is modelled: the body style and era details are read by the view only. */
export interface VehicleLook {
  /** Paint and trim colours. */
  paint: number;
  trim: number;
  /** Era dressing: side skirts and camo, ERA blocks, hover skirts and glow, runes and brass. */
  style: 'ww2' | 'modern' | 'scifi' | 'fantasy';
  /** Body plan the model builds from. */
  body: 'tank' | 'casemate' | 'truck' | 'spg' | 'titan';
  camo?: number;
  /** Emissive accent (sci-fi glow, fantasy runes). */
  glow?: number;
  /** Extra parts: 'skirts', 'era', 'aps', 'rack', 'dozer', 'petard', 'twin', 'rails'... */
  parts?: string[];
}

/** The nations that field ground vehicles (the anime series and the Abyss sail only). */
export type GroundNation = Exclude<Nation, 'jjk' | 'naruto' | 'onepiece' | 'dragonball' | 'bleach' | 'aot' | 'demonslayer' | 'mha' | 'abyss' | 'fold' | 'foundry' | 'lodestone'>;

export interface VehicleSpec {
  id: string;
  name: string;
  nation: GroundNation;
  era: Era;
  cls: VehicleClass;
  year: number;
  description: string;
  /** One line on what it is best at, for the garage. */
  specialty: string;
  hp: number;
  /** Tonnes: ramming and flattening props. */
  mass: number;
  size: VehicleSize;
  drive: DriveSpec;
  armor: VehicleArmor;
  /** Main gun (missile carriers may go without). */
  gun: GunSpec | null;
  launcher?: LauncherSpec;
  /** Support: heals the ally under the crosshair. */
  repairBeam?: { range: number; hps: number };
  consumables: GroundConsumableSpec[];
  /** Normal skills, then ultimates (2 + 1; titans 6 + 3). */
  skills: SkillSpec[];
  look: VehicleLook;
  /** Summons only: never offered in the garage or handed out. */
  hidden?: boolean;
}
