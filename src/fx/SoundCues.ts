import { FLEET_AUDIO_ASSETS } from './FleetAudio';
import type { AudioCategory } from './VoiceBudget';

export const SOUND_KINDS = ['gun', 'explosion', 'splash', 'hit', 'torpedo', 'missile', 'flak', 'depth', 'zap', 'thunder', 'laser', 'nuke', 'shield', 'charge', 'ricochet', 'collapse'] as const;
export type SoundKind = typeof SOUND_KINDS[number];
export const UI_SOUNDS = ['click', 'ribbon', 'alarm', 'ability', 'ult', 'capture', 'victory', 'defeat', 'citadel', 'warning', 'pickup', 'siren', 'horn', 'heartbeat', 'ultReady', 'streak', 'shift', 'unshift'] as const;
export type UiSound = typeof UI_SOUNDS[number];
export type CueFamily = 'charge' | 'impact' | 'beam' | 'slash' | 'transform';
export type CueEvent = 'activate' | 'impact' | 'end';
export type AudioBattleMode = 'naval' | 'ground';

/** Packaged recordings only. Contributor, license and exact edits: public/audio/manifest.json. */
export const FAMILY_ASSETS: Record<CueFamily, string> = {
  charge: `${import.meta.env.BASE_URL}audio/charge.m4a`, impact: `${import.meta.env.BASE_URL}audio/impact.m4a`, beam: `${import.meta.env.BASE_URL}audio/beam.m4a`, slash: `${import.meta.env.BASE_URL}audio/slash.m4a`, transform: `${import.meta.env.BASE_URL}audio/transform.m4a`,
};
export const GUN_ASSETS = [`${import.meta.env.BASE_URL}audio/gun-light.m4a`, `${import.meta.env.BASE_URL}audio/gun-medium.m4a`, `${import.meta.env.BASE_URL}audio/gun-heavy.m4a`] as const;
export const WORLD_ASSETS: Record<SoundKind, string> = {
  gun: GUN_ASSETS[1], explosion: `${import.meta.env.BASE_URL}audio/sonniss-explosion.m4a`, splash: `${import.meta.env.BASE_URL}audio/sonniss-splash.m4a`, hit: `${import.meta.env.BASE_URL}audio/sonniss-hit.m4a`,
  torpedo: `${import.meta.env.BASE_URL}audio/torpedo-launch.m4a`, missile: `${import.meta.env.BASE_URL}audio/missile-launch.m4a`, flak: `${import.meta.env.BASE_URL}audio/flak.m4a`, depth: `${import.meta.env.BASE_URL}audio/sonniss-depth.m4a`,
  zap: `${import.meta.env.BASE_URL}audio/zap.m4a`, thunder: `${import.meta.env.BASE_URL}audio/thunder.m4a`, laser: `${import.meta.env.BASE_URL}audio/laser.m4a`, nuke: `${import.meta.env.BASE_URL}audio/nuke.m4a`,
  shield: `${import.meta.env.BASE_URL}audio/shield.m4a`, charge: FAMILY_ASSETS.charge, ricochet: `${import.meta.env.BASE_URL}audio/ricochet.m4a`, collapse: `${import.meta.env.BASE_URL}audio/collapse.m4a`,
};
export const UI_ASSETS: Record<UiSound, string> = {
  click: `${import.meta.env.BASE_URL}audio/ui-click.m4a`, ribbon: `${import.meta.env.BASE_URL}audio/ui-ribbon.m4a`, alarm: `${import.meta.env.BASE_URL}audio/ui-alarm.m4a`, ability: `${import.meta.env.BASE_URL}audio/ui-ability.m4a`,
  ult: `${import.meta.env.BASE_URL}audio/ui-ult.m4a`, capture: `${import.meta.env.BASE_URL}audio/ui-capture.m4a`, victory: `${import.meta.env.BASE_URL}audio/ui-victory.m4a`, defeat: `${import.meta.env.BASE_URL}audio/ui-defeat.m4a`,
  citadel: `${import.meta.env.BASE_URL}audio/ui-citadel.m4a`, warning: `${import.meta.env.BASE_URL}audio/ui-warning.m4a`, pickup: `${import.meta.env.BASE_URL}audio/ui-pickup.m4a`, siren: `${import.meta.env.BASE_URL}audio/ui-siren.m4a`,
  horn: `${import.meta.env.BASE_URL}audio/ui-horn.m4a`, heartbeat: `${import.meta.env.BASE_URL}audio/ui-heartbeat.m4a`, ultReady: `${import.meta.env.BASE_URL}audio/ui-ult-ready.m4a`, streak: `${import.meta.env.BASE_URL}audio/ui-streak.m4a`,
  shift: FAMILY_ASSETS.transform, unshift: `${import.meta.env.BASE_URL}audio/ui-unshift.m4a`,
};
/** PCM recordings avoid encoder padding at the circular crossfade. */
export const LOOP_ASSETS = {
  sea: `${import.meta.env.BASE_URL}audio/ambience-sea.wav`, wind: `${import.meta.env.BASE_URL}audio/ambience-wind.wav`,
  navalEngine: `${import.meta.env.BASE_URL}audio/engine-naval.wav`, groundEngine: `${import.meta.env.BASE_URL}audio/engine-ground.wav`,
} as const;
export type LoopKind = keyof typeof LOOP_ASSETS;

const OVERRIDES: Record<string, Partial<Record<CueEvent, CueFamily>>> = {
  architectAssembly: { activate:'charge',impact:'beam' }, architectKillbox:{activate:'charge',impact:'impact'}, architectCitadel:{activate:'transform'},
  crossStep: { activate: 'slash', impact: 'slash', end: 'impact' },
  abyssalMaw: { activate: 'impact' }, kamehameha: { activate: 'beam' }, worldSlash: { activate: 'slash' }, titanShift: { activate: 'transform', end: 'transform' },
};
export function cueAsset(ability: string, event: CueEvent, family: CueFamily): string {
  return FAMILY_ASSETS[OVERRIDES[ability]?.[event] ?? (event === 'impact' ? 'impact' : family)];
}
export function allAudioAssets(): string[] {
  return [...new Set([...FLEET_AUDIO_ASSETS, ...Object.values(UI_ASSETS), ...Object.values(FAMILY_ASSETS), ...Object.values(WORLD_ASSETS), ...GUN_ASSETS, ...Object.values(LOOP_ASSETS)])];
}
export function worldAsset(kind: SoundKind, size: number): string {
  return kind === 'gun' ? GUN_ASSETS[size < 150 ? 0 : size < 300 ? 1 : 2] : WORLD_ASSETS[kind];
}
export function worldCategory(kind: SoundKind): AudioCategory {
  return ['zap', 'thunder', 'laser', 'nuke', 'shield', 'charge'].includes(kind) ? 'ability' : 'weapon';
}
export function recordedFallbacks(category: AudioCategory, primary: string): string[] {
  const alternatives = category === 'ui' ? [UI_ASSETS.warning, UI_ASSETS.ribbon, UI_ASSETS.click]
    : category === 'ability' ? [FAMILY_ASSETS.impact, FAMILY_ASSETS.charge, WORLD_ASSETS.zap]
      : [WORLD_ASSETS.gun, ...GUN_ASSETS, WORLD_ASSETS.hit, WORLD_ASSETS.explosion];
  return [...new Set([primary, ...alternatives])];
}
