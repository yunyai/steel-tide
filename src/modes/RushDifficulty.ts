import type { Group } from '../core/BattleSetup';

// Boss Rush difficulty: four presets and a Custom set of knobs. Normal is the Boss Rush as it has
// always been for waves 1..15. Past wave 15 every difficulty keeps climbing: hull and damage
// compound, waves grow, boss waves bring more titans and elite ships carry affixes. Caps keep the
// numbers finite, and no more than MAX_ALIVE enemies sail at once (the rest wait as reinforcements).

export const RUSH_WAVES = 15;
/** Most enemies of a wave afloat at once; the rest arrive as reinforcements. */
export const MAX_ALIVE = 10;
/** Most ships one wave sends, reinforcements included. */
export const MAX_WAVE_SHIPS = 40;
/** Most a wave's hull and damage multipliers ever reach. */
export const HP_CAP = 1e4;
export const DMG_CAP = 25;

export type RushPreset = 'normal' | 'hard' | 'brutal' | 'nightmare';
export const RUSH_PRESET_IDS: RushPreset[] = ['normal', 'hard', 'brutal', 'nightmare'];
export const RUSH_PRESET_LABEL: Record<RushPreset | 'custom', string> = { normal: 'Normal', hard: 'Hard', brutal: 'Brutal', nightmare: 'Nightmare', custom: 'Custom' };

export interface RushKnobs {
  /** A titan every this many waves. */
  bossEvery: number;
  /** Ships added to every wave. */
  extraShips: number;
  /** Enemy hull, in percent of Normal. */
  hpPct: number;
  /** Enemy damage, in percent of Normal. */
  dmgPct: number;
  /** How fast hull, damage and wave size climb, in percent of Normal. */
  rampPct: number;
  /** Most titans one boss wave sends. */
  maxTitans: number;
  /** Seconds between reinforcement groups when a wave outnumbers MAX_ALIVE. */
  stagger: number;
}

/** A run's difficulty: a preset, or Custom knobs (any left out read as Normal's). */
export interface RushDifficulty {
  preset: RushPreset | 'custom';
  custom?: Partial<RushKnobs>;
}

export const RUSH_PRESETS: Record<RushPreset, RushKnobs> = {
  normal: { bossEvery: 5, extraShips: 0, hpPct: 100, dmgPct: 100, rampPct: 100, maxTitans: 2, stagger: 8 },
  hard: { bossEvery: 5, extraShips: 1, hpPct: 125, dmgPct: 115, rampPct: 125, maxTitans: 3, stagger: 7 },
  brutal: { bossEvery: 4, extraShips: 2, hpPct: 150, dmgPct: 130, rampPct: 150, maxTitans: 3, stagger: 6 },
  nightmare: { bossEvery: 3, extraShips: 3, hpPct: 200, dmgPct: 150, rampPct: 200, maxTitans: 4, stagger: 5 },
};

export interface KnobSpec {
  key: keyof RushKnobs;
  label: string;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
}

/** The Custom knobs in the order the orders screen lists them. */
export const RUSH_KNOBS: KnobSpec[] = [
  { key: 'bossEvery', label: 'Titan every', min: 3, max: 8, step: 1, format: (v) => `${v} waves` },
  { key: 'extraShips', label: 'Extra ships', min: 0, max: 4, step: 1, format: (v) => `+${v}` },
  { key: 'hpPct', label: 'Enemy hull', min: 50, max: 300, step: 25, format: (v) => `${v}%` },
  { key: 'dmgPct', label: 'Enemy damage', min: 50, max: 300, step: 25, format: (v) => `${v}%` },
  { key: 'rampPct', label: 'Ramp', min: 50, max: 300, step: 25, format: (v) => `${v}%` },
  { key: 'maxTitans', label: 'Titans at once', min: 1, max: 4, step: 1, format: (v) => String(v) },
  { key: 'stagger', label: 'Reinforcement gap', min: 3, max: 12, step: 1, format: (v) => `${v} s` },
];

/** A knob value on its step, inside its range (Normal's when it is not a number). */
export function clampKnob(spec: KnobSpec, v: unknown): number {
  const n = Number(v);
  if (v === undefined || v === null || !Number.isFinite(n)) return RUSH_PRESETS.normal[spec.key];
  return Math.min(spec.max, Math.max(spec.min, spec.min + Math.round((n - spec.min) / spec.step) * spec.step));
}

const isPreset = (p: unknown): p is RushPreset => RUSH_PRESET_IDS.includes(p as RushPreset);

/** The knobs a difficulty plays with: a preset's, or Custom ones clamped (Normal when unset). */
export function rushKnobs(d?: RushDifficulty): RushKnobs {
  if (!d || d.preset !== 'custom') return { ...RUSH_PRESETS[isPreset(d?.preset) ? d.preset : 'normal'] };
  const out = { ...RUSH_PRESETS.normal };
  for (const spec of RUSH_KNOBS) out[spec.key] = clampKnob(spec, d.custom?.[spec.key]);
  return out;
}

/** The name a run's record is kept under: the preset, or every Custom knob. */
export function rushRecordKey(d?: RushDifficulty): string {
  if (!d || d.preset !== 'custom') return isPreset(d?.preset) ? d.preset : 'normal';
  const k = rushKnobs(d);
  return `custom:${RUSH_KNOBS.map((s) => k[s.key]).join('-')}`;
}

/** A titan of the battle's eras: the first, second, third... in their order (wrapping past the end). */
export type Slot = Group | `titan:${number}`;
export const isTitanSlot = (s: Slot): s is `titan:${number}` => s.startsWith('titan:');

/** Waves 1..15 on Normal. Every fifth is a titan with escorts. */
const WAVES: Slot[][] = [
  ['DD', 'DD', 'DD'],
  ['DD', 'DD', 'cruiser', 'cruiser'],
  ['cruiser', 'cruiser', 'DD', 'SS'],
  ['BB', 'cruiser', 'DD', 'DD'],
  ['titan:0', 'DD', 'DD'],
  ['BB', 'BB', 'DD', 'DD'],
  ['CV', 'cruiser', 'cruiser', 'DD', 'SS'],
  ['BB', 'BB', 'cruiser', 'DD', 'DD'],
  ['BB', 'cruiser', 'cruiser', 'cruiser', 'DD', 'DD'],
  ['titan:1', 'cruiser', 'DD', 'DD'],
  ['BB', 'BB', 'BB', 'DD', 'DD'],
  ['BB', 'BB', 'CV', 'cruiser', 'DD', 'SS'],
  ['BB', 'BB', 'cruiser', 'cruiser', 'DD', 'DD', 'SS'],
  ['BB', 'BB', 'BB', 'cruiser', 'cruiser', 'DD', 'DD'],
  ['titan:2', 'BB', 'cruiser', 'DD', 'DD'],
];

export const isBossWave = (n: number, k: RushKnobs): boolean => n > 0 && n % k.bossEvery === 0;

/**
 * The set ships of wave `n` (1..15), before extras: a titan leads every boss wave, and a wave the
 * knobs moved its titan away from (or Survival, with `boss` false) sends a battleship and a cruiser
 * in its place.
 */
export function tableSlots(n: number, k: RushKnobs, boss = isBossWave(n, k)): Slot[] {
  const rest = WAVES[n - 1].flatMap((s): Slot[] => (isTitanSlot(s) ? ['BB', 'cruiser'] : [s]));
  if (!boss) return rest;
  // The table's own titans already lead with the battleship and cruiser they stand in for.
  const own = WAVES[n - 1].some(isTitanSlot);
  return [`titan:${n / k.bossEvery - 1}`, ...(own ? rest.slice(2) : rest)];
}

export interface WaveScale {
  /** Enemy hull and damage multipliers. */
  hp: number;
  dmg: number;
  /** Ships the wave sends, titans and reinforcements included. */
  ships: number;
  /** Titans on a boss wave (Boss Rush only; Survival trades them away). */
  titans: number;
  /** Share of the wave's line ships that sail as elites, and how many affixes each carries. */
  elite: number;
  affixes: number;
}

/** How hard wave `n` hits. Waves 1..15 ramp in a line; endless waves compound from wave 15. */
export function waveScale(n: number, k: RushKnobs): WaveScale {
  const r = k.rampPct / 100;
  const w = Math.min(n, RUSH_WAVES);
  // Normal's knobs are all 1 here, so waves 1..15 are exactly the old 1 + 0.06(w-1) and 1 + 0.04(w-1).
  let hp = (k.hpPct / 100) * (1 + 0.06 * r * (w - 1));
  let dmg = (k.dmgPct / 100) * (1 + 0.04 * r * (w - 1));
  const boss = isBossWave(n, k);
  if (n <= RUSH_WAVES) return { hp: Math.min(HP_CAP, hp), dmg: Math.min(DMG_CAP, dmg), ships: tableSlots(n, k).length + k.extraShips, titans: boss ? 1 : 0, elite: 0, affixes: 0 };
  const e = n - RUSH_WAVES;
  hp = Math.min(HP_CAP, hp * Math.pow(1 + 0.03 * r, e));
  dmg = Math.min(DMG_CAP, dmg * Math.pow(1 + 0.015 * r, e));
  return {
    hp,
    dmg,
    ships: Math.min(MAX_WAVE_SHIPS, 5 + Math.floor((e * r) / 2) + k.extraShips),
    titans: boss ? Math.min(k.maxTitans, 1 + Math.floor((e * r) / 20)) : 0,
    elite: e > 5 ? Math.min(0.75, 0.03 * r * (e - 5)) : 0,
    affixes: e >= 25 ? 2 : 1,
  };
}

export type Affix = 'armored' | 'swift' | 'gunner' | 'warded';
export const AFFIXES: Affix[] = ['armored', 'swift', 'gunner', 'warded'];
export const AFFIX_LABEL: Record<Affix, string> = { armored: 'Armored', swift: 'Swift', gunner: 'Gunner', warded: 'Warded' };

/** One line on what a set of knobs changes against Normal (`titans` false for Survival, which has none). */
export function describeKnobs(k: RushKnobs, titans = true): string {
  const n = RUSH_PRESETS.normal;
  const parts: string[] = [];
  if (titans && k.bossEvery !== n.bossEvery) parts.push(`a titan every ${k.bossEvery} waves`);
  if (k.extraShips) parts.push(`${k.extraShips} more ship${k.extraShips === 1 ? '' : 's'} a wave`);
  if (k.hpPct !== n.hpPct) parts.push(`${k.hpPct}% hull`);
  if (k.dmgPct !== n.dmgPct) parts.push(`${k.dmgPct}% damage`);
  if (k.rampPct !== n.rampPct) parts.push(`waves climb ${k.rampPct > n.rampPct ? `${k.rampPct - 100}% faster` : `${100 - k.rampPct}% slower`}`);
  if (titans) parts.push(`up to ${k.maxTitans} titan${k.maxTitans === 1 ? '' : 's'} at once in the endless waves`);
  if (!parts.length) return 'The same as Normal.';
  const s = parts.join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
