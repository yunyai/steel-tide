import { BATTLE_TIME_LIMIT, MAP_HALF } from '../config';
import { avoid, evasion, rudderFor } from '../ai/Navigation';
import type { Game } from '../core/Game';
import { bearingTo, dist2D } from '../core/math';
import type { Team } from '../core/types';
import { TRANSPORTS } from '../data/ships';
import type { Ship } from '../ships/Ship';

// Convoy: four cargo ships zig-zag across the map to a port on the far side. Their escort wins
// by bringing two in, or by keeping two afloat until time runs out; the raiders win by sinking three.

export const CONVOY_SIZE = 4;
export const ARRIVE_GOAL = 2;
export const SINK_GOAL = 3;
export const PORT_RADIUS = 450;
/** Escorts drift no further than this from the convoy before they close up again. */
export const ESCORT_LEASH = 1500;
const WAYPOINT_REACH = 350;
/** Metres between cargo ships in the column. */
const SPACING = 380;
/** The zig-zag, as fractions of the half-map along and across the direction of travel; the last is the port. */
const ROUTE = [
  [-0.25, 0.2],
  [0.1, -0.18],
  [0.4, 0.12],
  [0.62, 0],
];
const START = -0.6;

interface Point {
  x: number;
  z: number;
}

export class Convoy {
  /** The side the cargo ships sail for. */
  readonly team: Team;
  transports: Ship[] = [];
  route: Point[] = [];
  port: Point = { x: 0, z: 0 };
  arrived = 0;
  sunk = 0;
  /** Index of the waypoint each cargo ship is steering for. */
  private legs = new Map<Ship, number>();
  /** Seconds left backing off a shoal. */
  private reverse = new Map<Ship, number>();

  constructor(private game: Game) {
    this.team = game.config.convoySide === 'raid' ? 1 : 0;
  }

  /** Lay the route and put the column at the start, behind its escort's spawn line. */
  start(): void {
    const g = this.game;
    // Team 0 starts in the west; a team 1 convoy runs the same route mirrored.
    const dir = this.team === 0 ? 1 : -1;
    this.route = ROUTE.map(([u, v]) => this.openWater(u * MAP_HALF * dir, v * MAP_HALF));
    this.port = this.route[this.route.length - 1];
    const start = this.openWater(START * MAP_HALF * dir, 0);
    const heading = bearingTo(start.x, start.z, this.route[0].x, this.route[0].z);
    const spec = TRANSPORTS[0];
    for (let i = 0; i < CONVOY_SIZE; i++) {
      const back = i * SPACING;
      const s = g.addShip(spec, this.team, `${spec.name} ${i + 1}`, start.x - Math.sin(heading) * back, start.z + Math.cos(heading) * back, heading);
      s.throttle = 6;
      s.speed = s.maxSpeed * 0.8;
      this.transports.push(s);
      this.legs.set(s, 0);
    }
  }

  /** Cargo ships still at sea. */
  afloat(): Ship[] {
    return this.transports.filter((s) => s.alive);
  }

  /** Middle of the cargo ships still at sea, or null when none are. */
  centre(): Point | null {
    const live = this.afloat();
    if (!live.length) return null;
    let x = 0;
    let z = 0;
    for (const s of live) {
      x += s.pos.x;
      z += s.pos.z;
    }
    return { x: x / live.length, z: z / live.length };
  }

  /** Where escort `ship` keeps station: abeam of the convoy, on a side picked by its id. */
  station(ship: Ship): Point | null {
    const c = this.centre();
    if (!c) return null;
    const lead = this.afloat()[0];
    const h = lead.heading;
    const side = ship.id % 2 ? 1 : -1;
    const lateral = side * (500 + (ship.id % 3) * 200);
    const ahead = ((ship.id % 4) - 1) * 250;
    return { x: c.x + Math.sin(h) * ahead + Math.cos(h) * lateral, z: c.z - Math.cos(h) * ahead + Math.sin(h) * lateral };
  }

  /** Which waypoint a cargo ship is steering for (route.length - 1 is the port). */
  leg(ship: Ship): number {
    return this.legs.get(ship) ?? 0;
  }

  update(dt: number): void {
    const g = this.game;
    if (g.over) return;
    let ahead: Ship | null = null;
    for (const s of this.transports) {
      if (!s.alive) continue;
      let leg = this.leg(s);
      const wp = this.route[leg];
      const d = dist2D(s.pos.x, s.pos.z, wp.x, wp.z);
      if (leg === this.route.length - 1 && d < PORT_RADIUS) {
        this.arrive(s);
        continue;
      }
      if (d < WAYPOINT_REACH && leg < this.route.length - 1) this.legs.set(s, ++leg);
      const goal = this.route[leg];
      const c = s.control;
      c.fire = false;
      // Keep station on the ship ahead rather than ramming it.
      let throttle = 6;
      if (ahead && this.leg(ahead) >= leg && dist2D(s.pos.x, s.pos.z, ahead.pos.x, ahead.pos.z) < SPACING * 0.75) throttle = 4;
      // Cargo ships comb torpedo tracks and run out from under air strikes like anyone else.
      const dodge = evasion(g, s);
      c.rudder = rudderFor(s, avoid(g, s, dodge ?? bearingTo(s.pos.x, s.pos.z, goal.x, goal.z)));
      c.throttleSet = throttle;
      // Aground or pinned: back off astern with the rudder reversed for a few seconds, then try
      // ahead for a few before backing off again.
      let back = this.reverse.get(s) ?? -3;
      if ((s.grounded > 0.4 || s.stalled > 3) && back <= -3) back = 6;
      if (back > -3) back -= dt;
      if (back > 0) {
        c.throttleSet = 0;
        c.rudder = -c.rudder || 1;
      }
      this.reverse.set(s, back);
      ahead = s;
    }
  }

  /** Safe in port: the ship leaves the battle. */
  private arrive(s: Ship): void {
    s.alive = false;
    s.withdrawn = true;
    s.deathTime = 0;
    this.arrived++;
    this.game.events.emit('convoy', { ship: s, kind: 'arrived' });
  }

  onSunk(ship: Ship): void {
    if (!this.transports.includes(ship)) return;
    this.sunk++;
    this.game.events.emit('convoy', { ship, kind: 'sunk' });
  }

  checkVictory(): void {
    const g = this.game;
    const other: Team = this.team === 0 ? 1 : 0;
    if (this.arrived >= ARRIVE_GOAL) return g.finish(this.team, `${this.arrived} transports reached port`);
    if (this.sunk >= SINK_GOAL) return g.finish(other, `${this.sunk} transports sunk`);
    const alive: [number, number] = [0, 0];
    for (const s of g.ships) if (s.alive && !s.isSummon && s.spec.cls !== 'AK') alive[s.team]++;
    if (alive[other] === 0) return g.finish(this.team, 'Raiders destroyed');
    if (alive[this.team] === 0) return g.finish(other, 'Escort destroyed');
    if (g.time >= BATTLE_TIME_LIMIT) {
      const safe = this.arrived + this.afloat().length;
      g.finish(safe >= ARRIVE_GOAL ? this.team : other, 'Time expired');
    }
  }

  /** Deep water near (x, z), searched in a widening spiral. */
  private openWater(x: number, z: number): Point {
    const map = this.game.map;
    const clear = (px: number, pz: number) => {
      if (map.heightAt(px, pz) > -15) return false;
      for (let a = 0; a < 8; a++) {
        const t = (a / 8) * Math.PI * 2;
        if (map.heightAt(px + Math.cos(t) * 300, pz + Math.sin(t) * 300) > -8) return false;
      }
      return true;
    };
    for (let i = 0; i < 60; i++) {
      const r = i * 70;
      const a = i * 2.4;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (clear(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }
}
