import type { Lockstep } from '../net/Lockstep';

/** A battle on screen, of whatever kind: the shell runs it every frame and disposes of it when it closes. */
export interface ActiveBattle {
  /** The battle is decided here (the report may still be on its way). */
  readonly ended: boolean;
  tick(dt: number): void;
  dispose(): void;
}

/** A LAN battle's link to the lobby server, as the battle on screen sees it. */
export interface BattleLink {
  readonly lockstep: Lockstep;
  /** This captain is the lobby's host. */
  readonly host: boolean;
  /** Once per frame, after the lockstep has advanced. */
  frame(dt: number): void;
  /** The battle has ended on this peer. */
  over(): void;
  /** The host ends a Free play battle for everyone. */
  end(): void;
  /** Leave in the middle of the battle: the AI takes the ship over for the others. */
  leave(): void;
  /** The report is closed: back to the waiting room. */
  toLobby(): void;
  /** Leave the lobby from the report. */
  leaveLobby(): void;
}
