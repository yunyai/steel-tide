import type { MiscFxKind, MiscTitanEvent } from '../skills/misc/MiscEvents';
import { audio } from './Audio';
import type { SoundKind } from './SoundCues';

// What the misc titans' effect events sound like, drawn from the packaged recordings. Casts already
// sound through `fleetCue`; these are the landings, citations and punishments in between.

export interface MiscSound {
  kind: SoundKind;
  /** A file in public/audio, without its extension. */
  asset: string;
  gain: number;
  rate: number;
  /** Seconds before the same titan may play this kind again. */
  gap: number;
}

const s = (kind: SoundKind, asset: string, gain: number, rate = 1, gap = 0): MiscSound => ({ kind, asset, gain, rate, gap });

const SOUNDS: Partial<Record<MiscFxKind, MiscSound>> = {
  court: s('thunder', 'mechanical-hit', 0.8, 0.7),
  cite: s('hit', 'ui-ribbon', 0.3, 1.3, 0.25),
  gavelThrow: s('charge', 'cut-light', 0.45, 0.8),
  gavelHit: s('hit', 'mechanical-hit', 0.75, 0.85),
  contempt: s('zap', 'ui-alarm', 0.55, 0.9),
  arrest: s('hit', 'ricochet', 0.5, 0.7),
  taxes: s('charge', 'ui-pickup', 0.5, 1.1),
  objection: s('shield', 'ward-rise', 0.45, 1.3, 0.3),
  martial: s('thunder', 'ui-horn', 0.8, 0.8),
  warn: s('zap', 'ui-warning', 0.5, 1),
  verdict: s('nuke', 'blast-heavy', 1.2, 0.8),
  death: s('collapse', 'slash', 1.1, 0.7),
  pin: s('hit', 'cut-light', 0.55, 1.3),
  stitch: s('zap', 'slash', 0.6, 1.2),
  twist: s('collapse', 'cut-heavy', 0.7, 0.8),
  fire: s('charge', 'arcane-charge', 0.6, 1.1),
  ignite: s('charge', 'energy-pulse', 0.35, 1.2, 0.3),
  rip: s('explosion', 'cut-heavy', 0.8, 0.9),
  erupt: s('explosion', 'blast-shock', 0.65, 1, 0.2),
  substitute: s('shield', 'phase-arrival', 0.5, 1.1),
  decoyBurst: s('explosion', 'blast-shock', 0.75, 0.9),
  coven: s('thunder', 'arcane-charge', 0.85, 0.7),
  needle: s('hit', 'cut-light', 0.3, 1.6, 0.12),
  unmake: s('nuke', 'blast-heavy', 1.15, 0.9, 0.1),
  tear: s('hit', 'slash', 0.4, 1.4, 0.2),
};

/** The recording a misc titan event plays, or null when it is left to other sounds. */
export function miscSound(kind: MiscFxKind): MiscSound | null {
  return SOUNDS[kind] ?? null;
}

const heard = new WeakMap<object, Map<MiscFxKind, number>>();

/** Plays `e` at its position, `local` louder; rapid repeats of one kind share a voice. */
export function playMiscSound(e: MiscTitanEvent, time: number, local: boolean): void {
  const cue = miscSound(e.kind);
  if (!cue) return;
  const last = heard.get(e.ship) ?? new Map<MiscFxKind, number>();
  heard.set(e.ship, last);
  if (time - (last.get(e.kind) ?? -1e9) < cue.gap) return;
  last.set(e.kind, time);
  // A throw and a dismissed hit are heard at the Judge; everything else where it lands.
  const at = e.kind === 'gavelThrow' || e.kind === 'objection' ? null : e.target;
  const x = at?.pos.x ?? e.x;
  const z = at?.pos.z ?? e.z;
  audio.play(cue.kind, x, 20, z, 100, cue.gain * (local ? 1 : 0.6), {
    category: 'ability',
    priority: local ? 3 : 1,
    asset: `${import.meta.env.BASE_URL}audio/${cue.asset}.m4a`,
    rate: cue.rate,
  });
}
