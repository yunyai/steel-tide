import { SIM_DT } from '../config';
import type { Game } from '../core/Game';
import type { ControlState, Ship } from '../ships/Ship';
import { stateHash } from './hash';
import type { LockstepSim } from './Lockstep';
import type { Continuous, Edge, Turn } from './protocol';

// A naval battle as lockstep plays it: turns become orders on the captains' ships, and a
// captain's controls become the orders sent for the next turns.

/** Applies turns to a battle: the part every peer, the tests and a replay share. */
export class TurnApplier implements LockstepSim {
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

  hash(): number {
    return stateHash(this.game);
  }

  interpolate(alpha: number): void {
    this.game.alpha = alpha;
    this.game.interpolate();
  }

  /** Write the orders for one tick of `turn` into the captains' ships, then step the battle. */
  applyTick(turn: Turn, tick: number): void {
    const g = this.game;
    if (tick === 0) {
      if (turn.p) for (const [p, c] of turn.p) this.orders.set(p, c);
      if (turn.ev) {
        for (const ev of turn.ev) {
          if ('end' in ev) {
            if (!g.over) g.finish(-1, ev.end === 2 ? 'Free play reached its one-hour limit' : 'The host ended free play');
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
      ctl.aimY = c[5];
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

/** The local captain's orders from the controller's draft: what to send for the next turns. */
export function draftOrders(draft: ControlState): [Continuous, Edge | null] {
  const e = takeEdge(draft);
  const c: Continuous = [draft.rudder, cm(draft.aimX), cm(draft.aimZ), draft.fire ? 1 : 0, draft.targetId];
  if (draft.aimY !== undefined) c.push(cm(draft.aimY));
  return [c, e];
}
