import type { Ship } from '../../ships/Ship';

// The `miscTitan` event: what the Judge, Hexweaver, Gourmand and Faultline tell their effects,
// model animation, audio and HUD. The simulation emits it; nothing in the simulation listens.

/** Shared by all four titans: a battery round striking a hull or landing in the sea. */
export type MiscGunKind = 'gunHit' | 'gunLand';

/**
 * The Judge: the court slamming down, a citation, a gavel thrown and landing, contempt, an arrest,
 * Taxes, a dismissed hit, Martial Law, a warning (`n` 0 freeze, 1 Verdict, 2 Death Penalty) and the
 * Verdict and Death Penalty landing.
 */
export type JudgeFxKind = 'court' | 'cite' | 'gavelThrow' | 'gavelHit' | 'contempt' | 'arrest' | 'taxes' | 'objection' | 'martial' | 'warn' | 'verdict' | 'death';

/**
 * The Hexweaver: a pin stabbing a doll (`n` its pins), a stitch sweep, a twist (`n` 1 when it
 * spent a pin), Effigy Fire and a doll catching fire, Rip the Seam and a stitched doll erupting,
 * Substitute and its effigy bursting, a coven, one of the Thousand Needles, a doll unmade (`radius`
 * when it blasts) and a doll torn off the shelf.
 */
export type HexFxKind = 'pin' | 'stitch' | 'twist' | 'fire' | 'ignite' | 'rip' | 'erupt' | 'substitute' | 'decoyBurst' | 'coven' | 'needle' | 'unmake' | 'tear';

/**
 * The Gourmand: a battery dish landing (`n` its flavour, 1 shells, 2 explosives, 3 scrap), the mouth
 * opening, a round or wreck gulped down, a chomp (`n` 0: a bite that missed), Carve and each slice,
 * the pressure cooker thrown and bursting, a skewer, a served dish, a Banquet side dish and a dish
 * landing, Comfort Food and its burp, Banquet, the bite warning, a swallow, the spit, and Kitchen
 * Catastrophe's fuse and blast.
 */
export type GourmandFxKind =
  | 'dish'
  | 'devour'
  | 'gulp'
  | 'chomp'
  | 'carve'
  | 'slice'
  | 'cooker'
  | 'cookerBurst'
  | 'skewer'
  | 'serve'
  | 'side'
  | 'plate'
  | 'comfort'
  | 'burp'
  | 'banquet'
  | 'bite'
  | 'swallow'
  | 'spit'
  | 'fuse'
  | 'catastrophe';

export type MiscFxKind = MiscGunKind | JudgeFxKind | HexFxKind | GourmandFxKind;

export interface MiscTitanEvent {
  ship: Ship;
  kind: MiscFxKind;
  x: number;
  z: number;
  tx?: number;
  tz?: number;
  radius?: number;
  target?: Ship;
  n?: number;
  /** The Judge's law broken, by `LAWS` index; -1 for a citation. */
  law?: number;
}

/** A titan's own hooks on its battery's rounds, merged into the shared rider. */
export interface TitanRider {
  /** The first round of a salvo to strike `target`. */
  onFirstHit?: (target: Ship) => void;
  /** Every round that strikes a hull. */
  onHit?: (target: Ship, x: number, z: number) => void;
  /** Every round that falls in the sea. */
  onLand?: (x: number, z: number) => void;
  hitMul?: (target: Ship) => number;
  /** The salvo's rounds pierce hulls. */
  pierce?: boolean;
  /** The salvo's rounds always set what they hit on fire. */
  fire?: boolean;
}

/** Emits one `miscTitan` event for `s`. */
export function emitMisc(s: Ship, kind: MiscFxKind, x: number, z: number, extra: Omit<Partial<MiscTitanEvent>, 'ship' | 'kind' | 'x' | 'z'> = {}): void {
  s.game.events.emit('miscTitan', { ship: s, kind, x, z, ...extra });
}

/** Whether `s` is one of the four misc titans. */
export function isMiscTitanShip(s: Ship): boolean {
  return !!(s.judge || s.hexweaver || s.gourmand || s.faultline);
}
