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

export type MiscFxKind = MiscGunKind | JudgeFxKind;

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
}

/** Emits one `miscTitan` event for `s`. */
export function emitMisc(s: Ship, kind: MiscFxKind, x: number, z: number, extra: Omit<Partial<MiscTitanEvent>, 'ship' | 'kind' | 'x' | 'z'> = {}): void {
  s.game.events.emit('miscTitan', { ship: s, kind, x, z, ...extra });
}

/** Whether `s` is one of the four misc titans. */
export function isMiscTitanShip(s: Ship): boolean {
  return !!(s.judge || s.hexweaver || s.gourmand || s.faultline);
}
