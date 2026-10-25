// Gameplay scaling constants and tunables. World units are metres.

/** Knots to metres per second. */
export const KNOT = 0.5144;
/** Ships move faster than real life so battles take minutes, not hours (WoWS uses ~5x on larger maps). */
export const SPEED_SCALE = 2.4;
/** Shell flight is simulated with real physics but runs this many times faster. */
export const SHELL_TIME_SCALE = 1.5;
/**
 * Battle distances (gun, torpedo, ability reach) are this fraction of the WoWS-like
 * values written in the data files. Hulls stay real size, so ships fill the screen at fighting range.
 */
export const RANGE_SCALE = 0.4;
export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;

export const MAP_SIZE = 9000;
export const MAP_HALF = MAP_SIZE / 2;

export const SIM_DT = 1 / 60;
export const SMOKE_RADIUS = 260;
export const SMOKE_LIFETIME = 45;
/** Shells aimed into a smoke screen scatter this much wider. */
export const SMOKE_DISPERSION = 2;
/** Shells below this height are stopped by an ice wall they cross (Calving Wall). */
export const WALL_HEIGHT = 160;

export const FIRE_DPS_FRACTION = 0.0035;
export const FIRE_DURATION = 12;
export const FLOOD_DPS_FRACTION = 0.006;
export const FLOOD_DURATION = 12;

/**
 * Arcade pacing: hit points are this multiple of the data values, gun and torpedo reloads this
 * fraction. Hulls outlast the faster guns a little, so the big skill hits decide fights.
 */
export const HP_SCALE = 5;
export const RELOAD_SCALE = 0.6;

/** Out of combat (no damage taken for REGEN_DELAY s) a ship repairs REGEN_RATE of max HP per second. */
export const REGEN_DELAY = 7;
export const REGEN_RATE = 0.015;
export const MAX_FIRES = 4;

export const BATTLE_TIME_LIMIT = 15 * 60;
export const DOMINATION_WIN_SCORE = 1000;
export const DOMINATION_START_SCORE = 300;
/** Domination: points a kill swings between the teams. */
export const DOMINATION_KILL_POINTS = 45;
/** Domination: seconds before a sunk ship sails again, and seconds it is untouchable after. */
export const RESPAWN_DELAY = 8;
export const RESPAWN_SHIELD = 3;
/** Kill reward: normal-skill cooldowns left are cut to this fraction, and this much max HP returns. */
export const KILL_COOLDOWN_CUT = 0.5;
export const KILL_HEAL = 0.15;
export const KILL_HEAL_TITAN = 0.05;
/** Teams spawn on lines this fraction of the half-map out from the centre. */
export const SPAWN_LINE = 0.55;
export const CAP_RADIUS = 380;
export const CAP_TIME = 20;

/** Fraction of the ultimate meter gained per point of damage dealt. */
export const ULT_DAMAGE_CHARGE = 1 / 220000;
/** Damage taken charges the meter at this fraction of the dealt rate (comeback mechanic). */
export const ULT_TAKEN_CHARGE = 0.5;
/** Meter bonus for sinking a ship. */
export const ULT_KILL_CHARGE = 0.25;
/** The meter fills on its own in this many seconds. */
export const ULT_PASSIVE_TIME = 75;

/**
 * Titan Shift tempos: how much of a form's written time it lasts, and when (as a share of that
 * time) each of its three ultimates comes ready. Each fires once per form.
 */
export const SHIFT_TEMPOS = {
  burst: { label: 'Burst', timeMul: 0.75, unlock: [0, 0, 0] },
  staggered: { label: 'Staggered', timeMul: 1, unlock: [0, 0.3, 0.6] },
  long: { label: 'Long', timeMul: 1.5, unlock: [0.15, 0.45, 0.75] },
} as const;
export type ShiftTempo = keyof typeof SHIFT_TEMPOS;
/** Hull added on a Titan Shift, as a share of the form's max HP. */
export const SHIFT_SURGE = 0.2;
/**
 * Damage charges a Titan Shift at this share of the usual rate (anime skills hit hard enough to
 * fill it in a single cast otherwise), and the meter starts empty: the shift is a moment, not a state.
 */
export const SHIFT_CHARGE = 0.25;

export const DEFAULT_SHELL_CD = 0.3;

export interface Difficulty {
  label: string;
  /** Range error sigma as fraction of distance. */
  aimError: number;
  /** Seconds between AI decisions. */
  think: number;
  /** Probability per decision of using a skill when conditions are met. */
  skillUse: number;
  /** Lead prediction quality 0..1. */
  lead: number;
}

export const DIFFICULTIES: Record<'easy' | 'normal' | 'hard', Difficulty> = {
  easy: { label: 'Recruit', aimError: 0.028, think: 0.9, skillUse: 0.25, lead: 0.6 },
  normal: { label: 'Veteran', aimError: 0.016, think: 0.5, skillUse: 0.5, lead: 0.85 },
  hard: { label: 'Admiral', aimError: 0.008, think: 0.3, skillUse: 0.9, lead: 1.0 },
};

/** Keyboard bindings (KeyboardEvent.code values) for the keyboard + mouse captain. */
export interface KeyLayout {
  label: string;
  throttleUp: string;
  throttleDown: string;
  left: string;
  right: string;
  slots: string[];
  /** Keys for the kit in order: normal skills, then ultimates (Q, E, R; titans use nine). */
  skills: string[];
  /** F: repair kit; G: class utility. */
  consumables: string[];
  /** Target lock key (middle mouse also locks); empty when the key is taken by a skill. */
  lock: string;
  /** Toggles fire-control assist. */
  assist: string;
  zoom: string;
  /** Rides the newest main-battery shell in (the shell cam). */
  follow: string;
  diveUp: string;
  diveDown: string;
}

export const LAYOUT_MOUSE: KeyLayout = {
  label: 'Keyboard + Mouse',
  throttleUp: 'KeyW',
  throttleDown: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  slots: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
  skills: ['KeyQ', 'KeyE', 'KeyR'],
  consumables: ['KeyF', 'KeyG'],
  lock: 'KeyX',
  assist: 'KeyV',
  zoom: 'ShiftLeft',
  follow: 'Space',
  diveUp: 'KeyZ',
  diveDown: 'KeyC',
};

/** Titans: six skills on Q E Z X C V and three ultimates on R T B; lock moves to middle mouse, assist to N, a titan sub's dive keys to Y and H. Defaults: see input/Keybinds. */
export const LAYOUT_TITAN: KeyLayout = {
  ...LAYOUT_MOUSE,
  label: 'Keyboard + Mouse (titan)',
  skills: ['KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyR', 'KeyT', 'KeyB'],
  lock: '',
  assist: 'KeyN',
  // Z and C are titan skills, so a titan submarine surfaces and dives on Y and H.
  diveUp: 'KeyY',
  diveDown: 'KeyH',
};

export type InputDeviceId = 'mouse' | 'pad0';

export const INPUT_DEVICES: { id: InputDeviceId; label: string }[] = [
  { id: 'mouse', label: 'Keyboard + Mouse' },
  { id: 'pad0', label: 'Gamepad' },
];
