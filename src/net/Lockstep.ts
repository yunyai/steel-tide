import { SIM_DT } from '../config';
import { clamp } from '../core/math';
import { foldSections } from './hash';
import { JitterEstimator } from './Jitter';
import { type ClientMsg, type Continuous, type Edge, HASH_EVERY, type Sections, TURN_TICKS, type Turn } from './protocol';

// Deterministic lockstep over a LAN. Every peer runs the whole battle; the lobby server clocks
// turns of TURN_TICKS sim steps and hands everyone the same orders for each. A captain's own
// orders reach their ship only through those turns, never straight from the controls, so all
// peers step identical battles. What a turn does to a battle is the battle's own business
// (see navalTurns.ts); this file only keeps time.

/** Beyond this much backlog (a hitch, a slow machine) playback fast-forwards. */
const CATCH_UP_TICKS = 120;
/** Milliseconds of sim a frame may spend, playing at least one tick, so a slow peer still draws. */
const PLAY_BUDGET_MS = 8;
/** Milliseconds a frame may spend replaying the log off screen (rejoining, resyncing). */
export const REPLAY_BUDGET_MS = 120;
/** Milliseconds a hidden tab spends on each turn as it arrives, to keep up without frames. */
export const HIDDEN_BUDGET_MS = 6;
/** Continuous orders are resent at least this often (ms), so the server knows the captain is there. */
const HEARTBEAT_MS = 250;

/** What lockstep needs from a battle: play one tick of a turn, fingerprint the state, and blend poses for drawing. */
export interface LockstepSim {
  applyTick(turn: Turn, tick: number): void;
  hash(): number;
  /** The fingerprint by part, so a desync can say which part of the battle drifted. */
  sections?(): Sections;
  /** A section's name as a captain would read it (a ship's section gets the ship's name). */
  sectionName?(name: string): string;
  /** Draw poses `alpha` of the way from the last tick to the next. */
  interpolate(alpha: number): void;
}

/** One line on a desync for the perf panel: the checkpoint, then what drifted. */
export function describeDesync(k: number, diff: string[], name: (section: string) => string): string {
  return diff.length ? `desync k=${k}: ${diff.map(name).join(', ')}` : `desync k=${k}`;
}

/** Drives one LAN battle on this peer: buffers turns, plays them in step with the server, sends our orders. */
export class Lockstep {
  private queue: Turn[] = [];
  private head = 0;
  /** Tick within the turn at the head of the queue. */
  private tick = 0;
  private acc = 0;
  /** Next turn number expected from the server. */
  private expect = 0;
  /** Turns played so far. */
  played = 0;
  /** Playback is fast-forwarding through a backlog. */
  catchingUp = false;
  /** Ticks that threw. The stream still advances, so the peer stays aligned and can resync. */
  faults = 0;
  /** Called when a tick throws; the battle on this peer is no longer trustworthy. */
  onFault?: (error: unknown) => void;
  /** What the last desync drifted on (for the perf panel), or null. */
  desyncNote: string | null = null;
  private lastSent: Continuous | null = null;
  private lastSentAt = -Infinity;
  private jitter = new JitterEstimator();

  constructor(
    readonly sim: LockstepSim,
    private send: (m: ClientMsg) => void,
    private clock: () => number = () => performance.now(),
  ) {}

  /** Ticks of backlog playback aims to keep: enough to ride out how unevenly turns arrive. */
  get cushion(): number {
    return this.jitter.cushion(SIM_DT * 1000);
  }

  /** The first turn has arrived, so the battle is under way. */
  get started(): boolean {
    return this.expect > 0;
  }

  /** Ticks received but not yet played. */
  get backlog(): number {
    return (this.queue.length - this.head) * TURN_TICKS - this.tick;
  }

  /** A turn from the server; `at` is when a live one arrived (log turns come all at once and have none). */
  onTurn(turn: Turn, at?: number): void {
    // The socket delivers in order; anything older is a repeat from a log.
    if (turn.k < this.expect) return;
    this.expect = turn.k + 1;
    this.queue.push(turn);
    if (at !== undefined) this.jitter.sample(at);
  }

  /** Play buffered turns for a real frame of `frameDt` seconds, then interpolate poses for drawing. */
  advance(frameDt: number): void {
    const deadline = this.clock() + PLAY_BUDGET_MS;
    const cushion = this.cushion;
    let played = 0;
    const inTime = () => played === 0 || this.clock() < deadline;
    if (this.backlog > CATCH_UP_TICKS) {
      this.catchingUp = true;
      while (this.backlog > cushion && inTime()) {
        this.stepTick();
        played++;
      }
      if (this.backlog <= cushion) this.acc = 0;
    } else if (this.catchingUp && this.backlog <= cushion * 2) this.catchingUp = false;
    // Drift the playback rate to hold the cushion.
    const rate = clamp(1 + (this.backlog - cushion) * 0.08, 0.9, 2);
    this.acc += frameDt * rate;
    while (this.acc >= SIM_DT && this.backlog > 0 && inTime()) {
      this.stepTick();
      played++;
      this.acc -= SIM_DT;
    }
    // Starved, or out of time: hold at the newest pose instead of running up a debt.
    this.acc = Math.min(this.acc, SIM_DT);
    this.sim.interpolate(Math.min(1, this.acc / SIM_DT));
  }

  /** Play turns as fast as possible for up to `budgetMs`, leaving `keep` ticks. Returns ticks left. */
  fastForward(budgetMs: number, keep = 0): number {
    const until = this.clock() + budgetMs;
    while (this.backlog > keep && this.clock() < until) this.stepTick();
    if (this.backlog <= keep) this.acc = 0;
    return this.backlog;
  }

  private stepTick(): void {
    const turn = this.queue[this.head];
    try {
      this.sim.applyTick(turn, this.tick);
    } catch (e) {
      this.faults++;
      this.onFault?.(e);
    }
    if (++this.tick < TURN_TICKS) return;
    this.tick = 0;
    this.head++;
    this.played++;
    if (this.head > 256) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    if ((turn.k + 1) % HASH_EVERY === 0) {
      const s = this.sim.sections?.();
      this.send(s ? { t: 'hash', k: turn.k, h: foldSections(s), s } : { t: 'hash', k: turn.k, h: this.sim.hash() });
    }
  }

  /** Send the local captain's orders: edges at once, continuous orders when they change, and a heartbeat now and then. */
  sendOrders(c: Continuous, e: Edge | null, now = performance.now()): void {
    const last = this.lastSent;
    const changed = !last || c.length !== last.length || c.some((v, i) => v !== last[i]);
    if (!e && !changed && now - this.lastSentAt < HEARTBEAT_MS) return;
    this.lastSent = c;
    this.lastSentAt = now;
    this.send(e ? { t: 'in', c, e } : { t: 'in', c });
  }

  /** Send a one-off edge order outside the controls (Free play's ship picker). */
  sendEdge(e: Edge): void {
    this.send({ t: 'in', e });
  }
}
