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
  charge: '/audio/charge.m4a', impact: '/audio/impact.m4a', beam: '/audio/beam.m4a', slash: '/audio/slash.m4a', transform: '/audio/transform.m4a',
};
export const GUN_ASSETS = ['/audio/gun-light.m4a', '/audio/gun-medium.m4a', '/audio/gun-heavy.m4a'] as const;
export const WORLD_ASSETS: Record<SoundKind, string> = {
  gun: GUN_ASSETS[1], explosion: '/audio/sonniss-explosion.m4a', splash: '/audio/sonniss-splash.m4a', hit: '/audio/sonniss-hit.m4a',
  torpedo: '/audio/torpedo-launch.m4a', missile: '/audio/missile-launch.m4a', flak: '/audio/flak.m4a', depth: '/audio/sonniss-depth.m4a',
  zap: '/audio/zap.m4a', thunder: '/audio/thunder.m4a', laser: '/audio/laser.m4a', nuke: '/audio/nuke.m4a',
  shield: '/audio/shield.m4a', charge: FAMILY_ASSETS.charge, ricochet: '/audio/ricochet.m4a', collapse: '/audio/collapse.m4a',
};
export const UI_ASSETS: Record<UiSound, string> = {
  click: '/audio/ui-click.m4a', ribbon: '/audio/ui-ribbon.m4a', alarm: '/audio/ui-alarm.m4a', ability: '/audio/ui-ability.m4a',
  ult: '/audio/ui-ult.m4a', capture: '/audio/ui-capture.m4a', victory: '/audio/ui-victory.m4a', defeat: '/audio/ui-defeat.m4a',
  citadel: '/audio/ui-citadel.m4a', warning: '/audio/ui-warning.m4a', pickup: '/audio/ui-pickup.m4a', siren: '/audio/ui-siren.m4a',
  horn: '/audio/ui-horn.m4a', heartbeat: '/audio/ui-heartbeat.m4a', ultReady: '/audio/ui-ult-ready.m4a', streak: '/audio/ui-streak.m4a',
  shift: FAMILY_ASSETS.transform, unshift: '/audio/ui-unshift.m4a',
};
/** PCM recordings avoid encoder padding at the circular crossfade. */
export const LOOP_ASSETS = {
  sea: '/audio/ambience-sea.wav', wind: '/audio/ambience-wind.wav',
  navalEngine: '/audio/engine-naval.wav', groundEngine: '/audio/engine-ground.wav',
} as const;
export type LoopKind = keyof typeof LOOP_ASSETS;

const OVERRIDES: Record<string, Partial<Record<CueEvent, CueFamily>>> = {
  abyssalMaw: { activate: 'impact' }, kamehameha: { activate: 'beam' }, worldSlash: { activate: 'slash' }, titanShift: { activate: 'transform', end: 'transform' },
};
export function cueAsset(ability: string, event: CueEvent, family: CueFamily): string {
  return FAMILY_ASSETS[OVERRIDES[ability]?.[event] ?? (event === 'impact' ? 'impact' : family)];
}
export function allAudioAssets(): string[] {
  return [...new Set([...Object.values(UI_ASSETS), ...Object.values(FAMILY_ASSETS), ...Object.values(WORLD_ASSETS), ...GUN_ASSETS, ...Object.values(LOOP_ASSETS)])];
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
