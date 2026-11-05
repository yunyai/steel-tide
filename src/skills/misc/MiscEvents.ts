import type { Ship } from '../../ships/Ship';

// The `miscTitan` event: what the Judge, Hexweaver, Gourmand and Faultline tell their effects,
// model animation, audio and HUD. The simulation emits it; nothing in the simulation listens.

/** Shared by all four titans: a battery round striking a hull or landing in the sea. */
export type MiscGunKind = 'gunHit' | 'gunLand';

export type MiscFxKind = MiscGunKind;

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
}

/** Emits one `miscTitan` event for `s`. */
export function emitMisc(s: Ship, kind: MiscFxKind, x: number, z: number, extra: Omit<Partial<MiscTitanEvent>, 'ship' | 'kind' | 'x' | 'z'> = {}): void {
  s.game.events.emit('miscTitan', { ship: s, kind, x, z, ...extra });
}

/** Whether `s` is one of the four misc titans. */
export function isMiscTitanShip(s: Ship): boolean {
  return !!(s.judge || s.hexweaver || s.gourmand || s.faultline);
}
