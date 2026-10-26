import { SIM_DT } from '../config';
import { clamp } from '../core/math';
import { type ClientMsg, type Continuous, type Edge, HASH_EVERY, TURN_TICKS, type Turn } from './protocol';

// Deterministic lockstep over a LAN. Every peer runs the whole battle; the lobby server clocks
// turns of TURN_TICKS sim steps and hands everyone the same orders for each. A captain's own
// orders reach their ship only through those turns, never straight from the controls, so all
// peers step identical battles. What a turn does to a battle is the battle's own business
// (see navalTurns.ts); this file only keeps time.

/** Ticks of backlog the playback aims to keep (absorbs Wi-Fi jitter). */
const TARGET_TICKS = 4;
/** Beyond this much backlog (a hidden tab, a hitch) playback fast-forwards. */
const CATCH_UP_TICKS = 120;
/** Milliseconds per frame fast-forwarding may spend. */
const CATCH_UP_BUDGET = 12;
/** Continuous orders are resent at least this often (ms), so the server knows the captain is there. */
const HEARTBEAT_MS = 250;

/** What lockstep needs from a battle: play one tick of a turn, fingerprint the state, and blend poses for drawing. */
export interface LockstepSim {
  applyTick(turn: Turn, tick: number): void;
  hash(): number;
  /** Draw poses `alpha` of the way from the last tick to the next. */
  interpolate(alpha: number): void;
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
  private lastSent: Continuous | null = null;
  private lastSentAt = -Infinity;

  constructor(
    readonly sim: LockstepSim,
    private send: (m: ClientMsg) => void,
  ) {}

  /** The first turn has arrived, so the battle is under way. */
  get started(): boolean {
    return this.expect > 0;
  }

  /** Ticks received but not yet played. */
  get backlog(): number {
    return (this.queue.length - this.head) * TURN_TICKS - this.tick;
  }

  onTurn(turn: Turn): void {
    // The socket delivers in order; anything older is a repeat from a log.
    if (turn.k < this.expect) return;
    this.expect = turn.k + 1;
    this.queue.push(turn);
  }

  /** Play buffered turns for a real frame of `frameDt` seconds, then interpolate poses for drawing. */
  advance(frameDt: number): void {
    if (this.backlog > CATCH_UP_TICKS) {
      this.catchingUp = true;
      this.fastForward(CATCH_UP_BUDGET, TARGET_TICKS);
    } else if (this.catchingUp && this.backlog <= TARGET_TICKS * 2) this.catchingUp = false;
    // Drift the playback rate to hold a small cushion of turns.
    const rate = clamp(1 + (this.backlog - TARGET_TICKS) * 0.08, 0.9, 2);
    this.acc += frameDt * rate;
    while (this.acc >= SIM_DT && this.backlog > 0) {
      this.stepTick();
      this.acc -= SIM_DT;
    }
    // Starved: hold at the newest pose instead of running ahead of the server.
    if (this.backlog === 0) this.acc = Math.min(this.acc, SIM_DT);
    this.sim.interpolate(Math.min(1, this.acc / SIM_DT));
  }

  /** Play turns as fast as possible for up to `budgetMs`, leaving `keep` ticks. Returns ticks left. */
  fastForward(budgetMs: number, keep = 0): number {
    const until = performance.now() + budgetMs;
    while (this.backlog > keep && performance.now() < until) {
      for (let i = 0; i < 8 && this.backlog > keep; i++) this.stepTick();
    }
    if (this.backlog <= keep) this.acc = 0;
    return this.backlog;
  }

  private stepTick(): void {
    const turn = this.queue[this.head];
    this.sim.applyTick(turn, this.tick);
    if (++this.tick < TURN_TICKS) return;
    this.tick = 0;
    this.head++;
    this.played++;
    if (this.head > 256) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    if ((turn.k + 1) % HASH_EVERY === 0) this.send({ t: 'hash', k: turn.k, h: this.sim.hash() });
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
