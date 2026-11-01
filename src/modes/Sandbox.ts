import { MAP_HALF } from '../config';
import { AIController } from '../ai/AIController';
import { avoid, rudderFor } from '../ai/Navigation';
import type { Game } from '../core/Game';
import { bearingTo } from '../core/math';
import { SHIP_BY_ID } from '../data/ships';
import { DUMMY_MODES, MAX_DUMMIES, SANDBOX_CHEATS, type DummyMode, type SandboxCheat, type SandboxCmd } from '../net/protocol';
import type { Effect, Ship } from '../ships/Ship';
import { refreshArchitect } from '../skills/misc/ArchitectRuntime';
import { refreshStepper } from '../skills/misc/StepperRuntime';
import { refreshTungsten } from '../skills/misc/TungstenRuntime';
import { findOpenWater } from '../world/openWater';

// Sandbox: a quiet sea to try ships in. Only the captains sail; the host spawns dummies to shoot
// at and switches cheats on for every captain. Every change goes through `apply`, which a LAN
// battle reaches through the turn log, so every peer changes the same thing on the same tick.

/** Seconds before a sunk captain or dummy sails again. */
export const SANDBOX_RESPAWN = 3;
/** Weapon reloads the cooldown cheat holds them at: zero would fire every tick. */
export const RELOAD_FLOOR = 0.25;
/** Seconds without a hostile hit before a tough dummy is patched up. */
const TOUGH_HEAL = 5;
/** Half the side of the square a sailing dummy steers around its post. */
const SAIL_HALF = 750;
/** Its corners, clockwise from the north-east. */
const CORNERS = [[1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
/** Throttle steps: stopped, and the cruise a sailing dummy keeps. */
const STOP = 2;
const CRUISE = 4;

const IDLE: Effect = {
  id: 'sandbox:idle',
  time: Infinity,
  apply(m) {
    m.disarmed = true;
  },
};

export interface Dummy {
  ship: Ship;
  /** Its post: where it spawned and where it comes back. */
  x: number;
  z: number;
  heading: number;
  /** Sim time it sails again after sinking, or -1 while afloat. */
  back: number;
  /** The corner of its square it is steering for. */
  leg: number;
}

export class Sandbox {
  readonly cheats: Record<SandboxCheat, boolean> = { cooldowns: false, ult: false, consumables: false, god: false, tough: false };
  mode: DummyMode = 'idle';
  dummies: Dummy[] = [];

  constructor(private readonly game: Game) {}

  apply(cmd: SandboxCmd): void {
    switch (cmd.k) {
      case 'cheat':
        if (SANDBOX_CHEATS.includes(cmd.cheat)) this.cheats[cmd.cheat] = !!cmd.on;
        return;
      case 'spawn':
        return this.spawn(cmd);
      case 'mode':
        if (!DUMMY_MODES.includes(cmd.mode)) return;
        this.mode = cmd.mode;
        for (const d of this.dummies) if (d.ship.alive) this.enter(d);
        return;
      case 'respawn':
        for (const d of this.dummies) this.raise(d);
        return;
      case 'clear':
        for (const d of this.dummies) {
          this.game.ai.delete(d.ship);
          d.ship.withdraw(true);
        }
        this.dummies = [];
        return;
    }
  }

  isDummy(ship: Ship): boolean {
    return this.dummies.some((d) => d.ship === ship);
  }

  /** A captain's ship, or anything a captain summoned or deployed. */
  captained(ship: Ship): boolean {
    const owner = ship.architectPlatform?.owner ?? ship.architectDrone?.owner ?? ship.summonOwner ?? ship;
    return owner.humanIndex >= 0 && !this.isDummy(owner);
  }

  /** God: captains take no damage at all. */
  protects(ship: Ship): boolean {
    return this.cheats.god && this.captained(ship);
  }

  /** Tough: dummies never go below 1 hp. */
  undying(ship: Ship): boolean {
    return this.cheats.tough && this.isDummy(ship);
  }

  onSunk(ship: Ship): void {
    const d = this.dummies.find((x) => x.ship === ship);
    if (d) d.back = this.game.time + SANDBOX_RESPAWN;
  }

  /** After every ship and weapon has moved: the cheats, then the dummies. */
  update(): void {
    const g = this.game;
    const c = this.cheats;
    if (c.cooldowns || c.ult || c.consumables) for (const s of g.ships) if (s.alive && this.captained(s)) this.refresh(s);
    for (const d of this.dummies) {
      const s = d.ship;
      if (!s.alive) {
        if (d.back >= 0 && g.time >= d.back) this.raise(d);
        continue;
      }
      if (c.tough && s.hp < s.maxHp && g.time - s.lastHurt >= TOUGH_HEAL) s.hp = s.maxHp;
      if (this.mode === 'idle') {
        s.control.throttleSet = STOP;
        s.control.rudder = 0;
      } else if (this.mode === 'sail') this.sail(d);
    }
  }

  private refresh(s: Ship): void {
    const c = this.cheats;
    if (c.cooldowns) {
      for (const st of s.skills) if (!st.spec.ult && st.cooldown > 0) st.cooldown = 0;
      // A consumable still running keeps its cooldown until it ends, so it cannot stack on itself.
      for (const k of s.consumables) k.cooldown = Math.min(k.cooldown, k.active);
      for (const t of s.turrets) t.reload = Math.min(t.reload, RELOAD_FLOOR);
      for (const m of s.secondaries) m.reload = Math.min(m.reload, RELOAD_FLOOR);
      for (const l of s.launchers) l.reload = Math.min(l.reload, RELOAD_FLOOR);
      if (s.vls) s.vls.reload = Math.min(s.vls.reload, RELOAD_FLOOR);
      const air = s.air, spec = s.spec.air;
      if (air && spec) {
        air.cooldown = Math.min(air.cooldown, RELOAD_FLOOR);
        air.hangar = { torpedo: spec.torpedo.hangar, dive: spec.dive.hangar, fighter: spec.fighter.hangar };
      }
      if (s.architect) refreshArchitect(s, RELOAD_FLOOR);
      refreshStepper(s);
      refreshTungsten(s, RELOAD_FLOOR);
    }
    if (c.ult) s.meter = 1;
    if (c.consumables) for (const k of s.consumables) k.charges = Math.max(k.charges, k.spec.charges);
  }

  /** `n` dummies abreast on open water, centred on x, z; ids follow command order on every peer. */
  private spawn(cmd: Extract<SandboxCmd, { k: 'spawn' }>): void {
    const g = this.game;
    if (!Object.hasOwn(SHIP_BY_ID, cmd.ship)) return;
    const spec = SHIP_BY_ID[cmd.ship];
    const n = Math.min(Math.floor(cmd.n), MAX_DUMMIES - this.dummies.length);
    if (spec.hidden || n <= 0) return;
    const gap = Math.max(300, spec.length * 1.2);
    const edge = MAP_HALF * 0.92;
    for (let i = 0; i < n; i++) {
      // Abreast: along the beam, which points to starboard of the bow.
      const off = (i - (n - 1) / 2) * gap;
      const x = Math.max(-edge, Math.min(edge, cmd.x + Math.cos(cmd.heading) * off));
      const z = Math.max(-edge, Math.min(edge, cmd.z + Math.sin(cmd.heading) * off));
      const p = findOpenWater(g.map, x, z);
      const ship = g.addShip(spec, cmd.team, `Dummy ${this.dummies.length + 1}`, p.x, p.z, cmd.heading);
      const d: Dummy = { ship, x: p.x, z: p.z, heading: cmd.heading, back: -1, leg: 0 };
      this.dummies.push(d);
      this.enter(d);
    }
  }

  /** Puts a dummy into the current mode. */
  private enter(d: Dummy): void {
    const g = this.game;
    const s = d.ship;
    g.ai.delete(s);
    s.effects = s.effects.filter((e) => e.id !== IDLE.id);
    s.control.fire = false;
    if (this.mode === 'idle') {
      s.addEffect(IDLE);
      s.throttle = STOP;
      s.speed = 0;
    } else if (this.mode === 'fight') g.ai.set(s, new AIController(s, g));
    else d.leg = 0;
  }

  /** Back at its post, whole, without the spawn shield: it is there to be shot. */
  private raise(d: Dummy): void {
    const g = this.game;
    const s = d.ship;
    s.respawn(d.x, d.z, d.heading);
    s.effects = s.effects.filter((e) => e.id !== 'spawn');
    if (!g.ships.includes(s)) g.ships.push(s);
    d.back = -1;
    this.enter(d);
  }

  /** Steers for the next corner of a 1.5 km square around the post. */
  private sail(d: Dummy): void {
    const s = d.ship;
    let [cx, cz] = CORNERS[d.leg];
    let tx = d.x + cx * SAIL_HALF, tz = d.z + cz * SAIL_HALF;
    if (Math.hypot(tx - s.pos.x, tz - s.pos.z) < 200) {
      d.leg = (d.leg + 1) % CORNERS.length;
      [cx, cz] = CORNERS[d.leg];
      tx = d.x + cx * SAIL_HALF;
      tz = d.z + cz * SAIL_HALF;
    }
    s.control.rudder = rudderFor(s, avoid(this.game, s, bearingTo(s.pos.x, s.pos.z, tx, tz)));
    s.control.throttleSet = CRUISE;
  }
}
