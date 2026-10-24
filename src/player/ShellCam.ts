import { Vector3 } from 'three';
import { SHELL_TIME_SCALE, SIM_DT } from '../config';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Shell, ShellPrediction } from '../weapons/ShellSystem';

// Shell cam, on the captain's command: the view rides your newest main-battery shell in,
// holds on the impact, then hands the camera back.

/** Shells closer than this (game seconds) to landing are not worth following. */
const MIN_LEFT = 0.5;
/** Shells fired within this long of the newest one count as the same salvo. */
const SALVO = 0.15;
/** Real seconds the view holds on the impact, and blends in and out. */
const HOLD = 0.8;
const BLEND = 0.3;

/** How good a predicted landing is to watch: a kill, then a citadel, then any hit. */
function rank(p: ShellPrediction | null): number {
  if (!p || !p.ship.alive) return 0;
  if (p.damage >= p.ship.hp + p.ship.shield) return 4;
  if (p.outcome === 'citadel') return 3;
  return p.damage > 0 ? 2 : 1;
}

export class ShellCam {
  shell: Shell | null = null;
  impact: ShellPrediction | null = null;
  /** How much of the view the shell cam owns, 0..1 (eased by the caller). */
  weight = 0;
  /** Where the shell is drawn this frame, and its direction of travel. */
  readonly pos = new Vector3();
  readonly dir = new Vector3(0, 0, -1);
  /** Real seconds since the shell landed. */
  holdTime = 0;
  /** The shell has landed; the view holds on the impact (and keeps that pose while blending out). */
  landed = false;

  constructor(
    private game: Game,
    private ship: Ship,
  ) {}

  get active(): boolean {
    return this.shell !== null;
  }

  /** Does the impact about to be followed sink its target? */
  get kill(): boolean {
    return rank(this.impact) === 4;
  }

  cancel(): void {
    this.shell = null;
    this.impact = null;
  }

  /**
   * Ride the newest main-battery salvo in, picking the shell from it that lands best.
   * Pressed again while riding, it hands the view back. Returns false when nothing is in flight.
   */
  toggle(): boolean {
    if (this.shell) {
      this.cancel();
      return true;
    }
    const g = this.game;
    const mine = g.shells.shells.filter((s) => s.alive && s.owner === this.ship && !s.secondary && !s.bomb && !s.railgun && s.flight - s.age > MIN_LEFT);
    if (!mine.length) return false;
    const newest = Math.min(...mine.map((s) => s.age));
    let best: Shell | null = null;
    let bestP: ShellPrediction | null = null;
    let bestRank = -1;
    for (const s of mine) {
      if (s.age > newest + SALVO) continue;
      const p = g.shells.predictImpact(s, s.flight - s.age + 0.6);
      const r = rank(p);
      if (r > bestRank) {
        best = s;
        bestP = p;
        bestRank = r;
      }
    }
    this.shell = best;
    this.impact = bestRank > 0 ? bestP : null;
    this.holdTime = 0;
    this.landed = false;
    this.place(best!);
    return true;
  }

  /** `dt` is real seconds; `enabled` is whether the captain is at the helm. */
  update(dt: number, enabled: boolean): void {
    if (!enabled || !this.ship.alive) this.cancel();
    const s = this.shell;
    if (s) {
      if (s.alive) this.place(s);
      else {
        this.landed = true;
        this.holdTime += dt;
        if (this.holdTime >= HOLD) this.cancel();
      }
    }
    const goal = this.shell ? 1 : 0;
    const step = dt / BLEND;
    this.weight = goal > this.weight ? Math.min(goal, this.weight + step) : Math.max(goal, this.weight - step);
  }

  /** Drawn where it was between the last two sim steps, like the tracers. */
  private place(s: Shell): void {
    const back = (1 - this.game.alpha) * SIM_DT * SHELL_TIME_SCALE;
    this.pos.set(s.x - s.vx * back, s.y - s.vy * back, s.z - s.vz * back);
    this.dir.set(s.vx, s.vy, s.vz).normalize();
  }
}
