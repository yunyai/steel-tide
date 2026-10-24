import { SIM_DT } from '../config';
import { clamp } from '../core/math';
import type { Game } from '../core/Game';
import type { ControlState, Ship } from '../ships/Ship';
import { stateHash } from './hash';
import { type ClientMsg, type Continuous, type Edge, HASH_EVERY, TURN_TICKS, type Turn } from './protocol';

// Deterministic lockstep over a LAN. Every peer runs the whole battle; the lobby server clocks
// turns of TURN_TICKS sim steps and hands everyone the same orders for each. A captain's own
// orders reach their ship only through those turns, never straight from the controls, so all
// peers step identical battles.

/** Ticks of backlog the playback aims to keep (absorbs Wi-Fi jitter). */
const TARGET_TICKS = 4;
/** Beyond this much backlog (a hidden tab, a hitch) playback fast-forwards. */
const CATCH_UP_TICKS = 120;
/** Milliseconds per frame fast-forwarding may spend. */
const CATCH_UP_BUDGET = 12;
/** Continuous orders are resent at least this often (ms), so the server knows the captain is there. */
const HEARTBEAT_MS = 250;

/** Applies turns to a battle: the part every peer, the tests and a replay share. */
export class TurnApplier {
  /** Each captain's latest continuous orders; they hold until changed. */
  private orders = new Map<number, Continuous>();
  private byPlayer = new Map<number, Ship>();

  constructor(readonly game: Game) {
    for (const s of game.fleet) if (s.humanIndex >= 0) this.byPlayer.set(s.humanIndex, s);
    // Free play: a captain's orders follow them into their next ship.
    game.events.on('shipChanged', ({ ship }) => {
      if (ship.humanIndex >= 0) this.byPlayer.set(ship.humanIndex, ship);
    });
  }

  ship(player: number): Ship | undefined {
    return this.byPlayer.get(player);
  }

  /** Write the orders for one tick of `turn` into the captains' ships, then step the battle. */
  applyTick(turn: Turn, tick: number): void {
    const g = this.game;
    if (tick === 0) {
      if (turn.p) for (const [p, c] of turn.p) this.orders.set(p, c);
      if (turn.ev) {
        for (const ev of turn.ev) {
          if ('end' in ev) {
            if (!g.over) g.finish(-1, 'The host ended free play');
            continue;
          }
          const s = this.ship('ai' in ev ? ev.ai : ev.human);
          if (!s) continue;
          if ('ai' in ev) g.handToAI(s);
          else g.takeHelm(s);
        }
      }
    }
    for (const [p, c] of this.orders) {
      const s = this.byPlayer.get(p);
      if (!s || s.autopilot) continue;
      const ctl = s.control;
      ctl.rudder = c[0];
      ctl.aimX = c[1];
      ctl.aimZ = c[2];
      ctl.fire = c[3] === 1;
      ctl.targetId = c[4];
      ctl.throttleSet = null;
    }
    if (turn.e) {
      for (const [p, t, e] of turn.e) {
        if (t !== tick) continue;
        const s = this.byPlayer.get(p);
        if (!s) continue;
        if (e.sp !== undefined) g.pickShip(s, e.sp);
        if (e.rd) g.redeploy(s);
        if (!s.autopilot) applyEdge(s.control, e);
      }
    }
    g.step(SIM_DT);
  }
}

function applyEdge(c: ControlState, e: Edge): void {
  if (e.tu) c.throttleUp = true;
  if (e.td) c.throttleDown = true;
  if (e.sl !== undefined) c.slot = e.sl;
  if (e.sk !== undefined) c.skill = e.sk;
  if (e.co !== undefined) c.consumable = e.co;
  if (e.du) c.diveUp = true;
  if (e.dd) c.diveDown = true;
}

/** The edge orders a controller left in a draft ControlState, cleared once taken. */
function takeEdge(c: ControlState): Edge | null {
  const e: Edge = {};
  if (c.throttleUp) e.tu = 1;
  if (c.throttleDown) e.td = 1;
  if (c.slot !== null) e.sl = c.slot;
  if (c.skill >= 0) e.sk = c.skill;
  if (c.consumable >= 0) e.co = c.consumable;
  if (c.diveUp) e.du = 1;
  if (c.diveDown) e.dd = 1;
  c.throttleUp = c.throttleDown = c.diveUp = c.diveDown = false;
  c.slot = null;
  c.skill = -1;
  c.consumable = -1;
  return Object.keys(e).length ? e : null;
}

/** Aim points travel at centimetre precision; every peer applies the same rounded numbers. */
const cm = (v: number) => Math.round(v * 100) / 100;

/** Drives one LAN battle on this peer: buffers turns, plays them in step with the server, sends our orders. */
export class Lockstep {
  readonly applier: TurnApplier;
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
    readonly game: Game,
    readonly you: number,
    private send: (m: ClientMsg) => void,
  ) {
    this.applier = new TurnApplier(game);
  }

  /** The local captain's ship. */
  get ship(): Ship | undefined {
    return this.applier.ship(this.you);
  }

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
    const g = this.game;
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
    g.alpha = Math.min(1, this.acc / SIM_DT);
    g.interpolate();
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
    this.applier.applyTick(turn, this.tick);
    if (++this.tick < TURN_TICKS) return;
    this.tick = 0;
    this.head++;
    this.played++;
    if (this.head > 256) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    if ((turn.k + 1) % HASH_EVERY === 0) this.send({ t: 'hash', k: turn.k, h: stateHash(this.game) });
  }

  /**
   * Send the local captain's orders from the controller's draft: edges at once, continuous
   * orders when they change, and a heartbeat now and then.
   */
  sendLocal(draft: ControlState, now = performance.now()): void {
    const e = takeEdge(draft);
    const c: Continuous = [draft.rudder, cm(draft.aimX), cm(draft.aimZ), draft.fire ? 1 : 0, draft.targetId];
    const last = this.lastSent;
    const changed = !last || c.some((v, i) => v !== last[i]);
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
