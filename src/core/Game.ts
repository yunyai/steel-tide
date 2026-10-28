import { setArchitectLoadout } from '../skills/misc/ArchitectRuntime';
import { copyLoadout } from '../data/architectLoadout';
import { clearArchitect, destroyPlatform } from '../skills/misc/ArchitectRuntime';
import { clearStepper, syncStepCopies } from '../skills/misc/StepperRuntime';
import { eraOf } from '../data/factions';
import {
  BATTLE_TIME_LIMIT,
  CAP_RADIUS,
  CAP_TIME,
  DIFFICULTIES,
  DOMINATION_KILL_POINTS,
  DOMINATION_START_SCORE,
  DOMINATION_WIN_SCORE,
  KILL_COOLDOWN_CUT,
  KILL_HEAL,
  KILL_HEAL_TITAN,
  MAP_HALF,
  RESPAWN_DELAY,
  SHIFT_TEMPOS,
  SIM_DT,
  SMOKE_LIFETIME,
  SMOKE_RADIUS,
  SPAWN_LINE,
  ULT_KILL_CHARGE,
} from '../config';
import { AIController } from '../ai/AIController';
import { SHIP_BY_ID } from '../data/ships';
import { Ship } from '../ships/Ship';
import { AircraftSystem } from '../weapons/AircraftSystem';
import { BeamSystem } from '../weapons/BeamSystem';
import { DepthChargeSystem } from '../weapons/DepthCharges';
import { FieldSystem } from '../weapons/FieldSystem';
import { MissileSystem } from '../weapons/MissileSystem';
import { ArchitectBatterySystem } from '../weapons/ArchitectBatterySystem';
import { ShellSystem } from '../weapons/ShellSystem';
import { StrikeSystem } from '../weapons/StrikeSystem';
import { TorpedoSystem } from '../weapons/TorpedoSystem';
import { BossRush } from '../modes/BossRush';
import { Convoy } from '../modes/Convoy';
import { GameMap, MAP_BY_ID, MAPS } from '../world/GameMap';
import { type BattleConfig, buildRoster, spawnOffset } from './BattleSetup';
import { EventBus } from './Events';
import { makeRng, segmentsCross, wrapAngle } from './math';
import { Pickups } from './Pickups';
import type { ShipSpec, SkillSpec, Team } from './types';

export interface Smoke {
  x: number;
  z: number;
  r: number;
  life: number;
  team: Team;
}

/** Calving Wall: a line of ice that stops the other team's shells and torpedoes. */
export interface Wall {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  team: Team;
  /** Seconds since it rose, and seconds it stands. */
  age: number;
  life: number;
  color: number;
}

export interface CapState {
  name: string;
  x: number;
  z: number;
  owner: Team | -1;
  capturer: Team | -1;
  progress: number;
  contested: boolean;
}

export class Game {
  readonly rng: () => number;
  readonly events = new EventBus();
  readonly map: GameMap;
  readonly battery: ArchitectBatterySystem;
  readonly shells: ShellSystem;
  readonly torps: TorpedoSystem;
  readonly air: AircraftSystem;
  readonly missiles: MissileSystem;
  readonly depth: DepthChargeSystem;
  readonly beams: BeamSystem;
  readonly strikes: StrikeSystem;
  readonly fields: FieldSystem;
  readonly pickups: Pickups;
  readonly difficulty;
  /** Boss Rush and Survival director (null in fleet battles). */
  readonly rush: BossRush | null = null;
  /** Convoy director (null in other battles). */
  readonly convoy: Convoy | null = null;

  time = 0;
  /** How far the next sim step has progressed (0..1); drawing interpolates by it. */
  alpha = 1;
  ships: Ship[] = [];
  /** Every ship that started the battle, kept after wrecks are cleared (for scoreboards). */
  readonly fleet: Ship[] = [];
  smokes: Smoke[] = [];
  walls: Wall[] = [];
  caps: CapState[] = [];
  score: [number, number] = [0, 0];
  /** Seconds left on Neptune Ping per team: that team's enemies take +25% damage. */
  exposed: [number, number] = [0, 0];
  over = false;
  winner: Team | -1 = -1;
  reason = '';
  ai = new Map<Ship, AIController>();
  /** Domination and Free play: sunk ships waiting to sail again, and the sim time they do. */
  respawns: { ship: Ship; at: number }[] = [];

  /** Ship ids count per battle (AI lanes and convoy slots read them), so every LAN peer agrees. */
  nextShipId = 1;

  private scoreTimer = 0;
  private accumulator = 0;

  constructor(readonly config: BattleConfig) {
    this.rng = makeRng(config.seed);
    this.map = new GameMap(MAP_BY_ID[config.mapId] ?? MAPS[0], config.seed);
    this.battery = new ArchitectBatterySystem(this);
    this.shells = new ShellSystem(this);
    this.torps = new TorpedoSystem(this);
    this.air = new AircraftSystem(this);
    this.missiles = new MissileSystem(this);
    this.depth = new DepthChargeSystem(this);
    this.beams = new BeamSystem(this);
    this.strikes = new StrikeSystem(this);
    this.fields = new FieldSystem(this);
    this.pickups = new Pickups(this);
    this.difficulty = DIFFICULTIES[config.difficulty] ?? DIFFICULTIES.normal;

    if (config.type === 'domination') {
      this.score = [DOMINATION_START_SCORE, DOMINATION_START_SCORE];
      this.caps = this.map.preset.caps.map((c) => ({ ...c, owner: -1, capturer: -1, progress: 0, contested: false }));
    }
    if (config.type === 'bossrush' || config.type === 'survival') {
      this.rush = new BossRush(this, config.type === 'survival');
      this.rush.start();
    } else {
      this.spawnTeams();
    }
    if (config.type === 'convoy') {
      this.convoy = new Convoy(this);
      this.convoy.start();
    }
  }

  private spawnTeams(): void {
    const roster = buildRoster(this.config, this.rng);
    const perTeam: [number, number] = [0, 0];
    const counts: [number, number] = [
      roster.filter((r) => r.team === 0).length,
      roster.filter((r) => r.team === 1).length,
    ];
    for (const r of roster) {
      const i = perTeam[r.team]++;
      const lane = (i - (counts[r.team] - 1) / 2) * 600;
      const p = this.spawnPoint(r.team, r.spec, lane);
      const ship = this.addShip(r.spec, r.team, r.name, p.x, p.z, p.heading);
      ship.humanIndex = r.humanIndex;
      setArchitectLoadout(ship,copyLoadout(this.config.players[r.humanIndex]?.architectLoadout));
      this.fleet.push(ship);
      // Already under way, so the fleets meet within a quarter of a minute.
      ship.throttle = 6;
      ship.speed = ship.maxSpeed * 0.75;
      if (r.humanIndex < 0) this.ai.set(ship, new AIController(ship, this));
    }
  }

  /** A place on `team`'s spawn line, `lane` metres along it, facing the enemy. */
  spawnPoint(team: Team, spec: ShipSpec, lane: number): { x: number; z: number; heading: number } {
    const side = team === 0 ? -1 : 1;
    return { x: side * MAP_HALF * SPAWN_LINE - side * spawnOffset(spec), z: lane, heading: team === 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  /** Seconds until a sunk ship sails again, or -1 if it will not. */
  respawnIn(ship: Ship): number {
    const r = this.respawns.find((x) => x.ship === ship);
    return r ? Math.max(0, r.at - this.time) : -1;
  }

  /** Free play: the captain's next ship, sailed from their next respawn. */
  pickShip(ship: Ship, specId: string): void {
    if (this.config.type !== 'freeplay' || ship.isSummon || !Object.hasOwn(SHIP_BY_ID, specId)) return;
    const spec = SHIP_BY_ID[specId];
    if (spec.hidden || this.config.titans === false && spec.cls === 'TT' || this.config.era && this.config.era !== 'mixed' && eraOf(spec) !== this.config.era) return;
    ship.nextSpec = spec === ship.base ? null : spec;
  }

  /**
   * Titan Shift: the ship takes its titan form, for as long as the battle's tempo (and its
   * faction) allows. False if the hull has no form to take.
   */
  shiftShip(ship: Ship): boolean {
    const shift = ship.base.shift;
    const form = shift && SHIP_BY_ID[shift.form];
    // Summons (Squad Levi) carry the full kit but never shift.
    if (!form || ship.isSummon) return false;
    const tempo = SHIFT_TEMPOS[this.config.shiftTempo ?? 'staggered'] ?? SHIFT_TEMPOS.staggered;
    const time = shift.time * tempo.timeMul * (ship.trait?.shiftTimeMul ?? 1);
    return ship.queueShift(form, time, tempo.unlock.map((u) => u * time));
  }

  /** Free play: leave the fight now and come back after the respawn delay, not counted as sunk. */
  redeploy(ship: Ship): void {
    if (this.config.type !== 'freeplay' || ship.isSummon || !ship.alive || this.over) return;
    ship.withdraw();
    this.respawns.push({ ship, at: this.time + RESPAWN_DELAY });
  }

  /**
   * Free play: a new hull for a ship's captain (or bot). It takes the old one's place in the
   * fleet, with the same captain and the same stats; the old hull leaves the sea.
   */
  private changeShip(old: Ship, spec: ShipSpec): Ship {
    const ship = new Ship(this, spec, old.team, old.name);
    ship.humanIndex = old.humanIndex;
    setArchitectLoadout(ship,old.architectLoadout);
    ship.autopilot = old.autopilot;
    ship.stats = old.stats;
    old.humanIndex = -1;
    old.nextSpec = null;
    old.withdrawn = true;
    this.ai.delete(old);
    const i = this.fleet.indexOf(old);
    if (i >= 0) this.fleet[i] = ship;
    this.ships.push(ship);
    this.events.emit('shipChanged', { old, ship });
    return ship;
  }

  private updateRespawns(): void {
    const due = this.respawns.filter((r) => this.time >= r.at);
    if (!due.length) return;
    this.respawns = this.respawns.filter((r) => this.time < r.at);
    for (const r of due) {
      let ship = r.ship;
      if (ship.alive) continue;
      if (ship.nextSpec) ship = this.changeShip(ship, ship.nextSpec);
      // A random lane of the spawn line with open water around it.
      let p = this.spawnPoint(ship.team, ship.spec, 0);
      for (let k = 0; k < 12; k++) {
        const q = this.spawnPoint(ship.team, ship.spec, (this.rng() - 0.5) * MAP_HALF * 0.9);
        if (this.map.heightAt(q.x, q.z) < -20 && this.map.heightAt(q.x + Math.sin(q.heading) * ship.spec.length, q.z) < -20) {
          p = q;
          break;
        }
      }
      ship.respawn(p.x, p.z, p.heading);
      if (ship.humanIndex < 0 || ship.autopilot) this.ai.set(ship, new AIController(ship, this));
    }
  }

  /** Runtime summons resolve registered specs here, keeping skill modules independent of roster initialization. */
  shipSpec(id: string): ShipSpec { return SHIP_BY_ID[id]; }

  addShip(spec: ShipSpec, team: Team, name: string, x: number, z: number, heading: number): Ship {
    const ship = new Ship(this, spec, team, name);
    ship.pos.set(x, 0, z);
    ship.heading = heading;
    ship.prevPos.copy(ship.pos);
    ship.renderPos.copy(ship.pos);
    ship.prevHeading = ship.renderHeading = heading;
    ship.control.aimX = x + Math.sin(heading) * 2000;
    ship.control.aimZ = z - Math.cos(heading) * 2000;
    this.ships.push(ship);
    return ship;
  }

  /**
   * An AI escort (by default of the owner's own class) that withdraws after `time` seconds:
   * Little Beavers, Hochseeflotte.
   */
  spawnWingman(owner: Ship, lateral: number, time: number, back = -60, specId = owner.spec.id, name = `${owner.name} DesRon 23`): Ship {
    const p = owner.localToWorld(back, 0, lateral);
    const ship = this.addShip(SHIP_BY_ID[specId], owner.team, name, p.x, p.z, owner.heading);
    ship.isSummon = true;
    ship.summonOwner = owner;
    ship.expiresAt = this.time + time * (owner.trait?.summonTimeMul ?? 1);
    ship.speed = owner.speed;
    ship.throttle = owner.throttle;
    // A Boss Rush titan (fighting without its Colossus passive) calls in half-strength wingmen.
    const boss = owner.spec.cls === 'TT' && !owner.colossus;
    ship.maxHp = ship.hp = Math.round(ship.maxHp * (boss ? 0.35 : 0.7));
    ship.meter = 0;
    const ai = new AIController(ship, this);
    ai.leader = owner;
    this.ai.set(ship, ai);
    return ship;
  }

  /**
   * Raise a sunk ship where it went down (or at x, z) with `hpFrac` of its hull: Resurrection
   * Protocol, Verdant Rebirth. Wrecks already cleared from the sea are put back.
   */
  revive(ship: Ship, x: number, z: number, hpFrac: number, skill: SkillSpec | null = null): void {
    if (ship.alive) return;
    ship.respawn(x, z, ship.heading);
    ship.hp = Math.max(1, ship.maxHp * hpFrac);
    if (!this.ships.includes(ship)) this.ships.push(ship);
    this.respawns = this.respawns.filter((r) => r.ship !== ship);
    if (ship.humanIndex < 0 || ship.autopilot) this.ai.set(ship, new AIController(ship, this));
    this.events.emit('revive', { ship, skill });
  }

  /** A LAN captain dropped out: the AI takes their ship (and any later respawn of it). */
  handToAI(ship: Ship): void {
    ship.autopilot = true;
    if (ship.alive && !this.ai.has(ship)) this.ai.set(ship, new AIController(ship, this));
  }

  /** The captain is back: their orders drive the ship again. */
  takeHelm(ship: Ship): void {
    ship.autopilot = false;
    this.ai.delete(ship);
    ship.control.fire = false;
  }

  humans(): Ship[] {
    return this.fleet.filter((s) => s.humanIndex >= 0).sort((a, b) => a.humanIndex - b.humanIndex);
  }

  addWall(owner: Ship, x0: number, z0: number, x1: number, z1: number, life: number, color: number): Wall {
    const w: Wall = { x0, z0, x1, z1, team: owner.team, age: 0, life, color };
    this.walls.push(w);
    return w;
  }

  /** Where the segment first crosses a wall raised by `team`'s enemies, as a fraction along it, or -1. */
  wallHit(team: Team, ax: number, az: number, bx: number, bz: number): number {
    let best = -1;
    for (const w of this.walls) {
      if (w.team === team || w.age >= w.life) continue;
      const t = segmentsCross(ax, az, bx, bz, w.x0, w.z0, w.x1, w.z1);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  addSmoke(x: number, z: number, team: Team): void {
    this.smokes.push({ x, z, r: 40, life: SMOKE_LIFETIME, team });
  }

  inSmoke(x: number, z: number): boolean {
    for (const s of this.smokes) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz < s.r * s.r) return true;
    }
    return false;
  }

  /** Advance by a real frame delta using fixed sim steps, then interpolate poses for drawing. */
  advance(frameDt: number): number {
    this.accumulator = Math.min(this.accumulator + frameDt, SIM_DT * 6);
    let steps = 0;
    while (this.accumulator >= SIM_DT) {
      this.step(SIM_DT);
      this.accumulator -= SIM_DT;
      steps++;
    }
    this.alpha = this.accumulator / SIM_DT;
    this.interpolate();
    return steps;
  }

  /** Sim time matching the interpolated poses. */
  get renderTime(): number {
    return this.time - (1 - this.alpha) * SIM_DT;
  }

  /** Display rates rarely match the 60 Hz sim; drawing between steps keeps motion smooth. */
  interpolate(): void {
    const a = this.alpha;
    for (const s of this.ships) {
      s.renderPos.lerpVectors(s.prevPos, s.pos, a);
      s.renderHeading = wrapAngle(s.prevHeading + wrapAngle(s.heading - s.prevHeading) * a);
    }
  }

  step(dt = SIM_DT): void {
    for (const s of this.ships) {
      s.prevPos.copy(s.pos);
      s.prevHeading = s.heading;
    }
    this.time += dt;
    for (const t of [0, 1] as Team[]) if (this.exposed[t] > 0) this.exposed[t] -= dt;

    for (const [ship, ai] of this.ai) if (ship.alive) ai.update(dt);
    syncStepCopies(this);
    for (const s of this.ships) s.update(dt);
    syncStepCopies(this);
    this.collideShips();

    this.battery.update();
    this.shells.update(dt);
    this.torps.update(dt);
    this.missiles.update(dt);
    this.air.update(dt);
    this.depth.update(dt);
    this.beams.update(dt);
    this.strikes.update(dt);
    this.fields.update(dt);
    this.pickups.update(dt);
    this.rush?.update(dt);
    this.convoy?.update(dt);
    if (this.respawns.length && !this.over) this.updateRespawns();

    for (const s of this.smokes) {
      s.life -= dt;
      s.r = Math.min(SMOKE_RADIUS, s.r + dt * 90);
    }
    if (this.smokes.length && this.smokes[0].life <= 0) this.smokes = this.smokes.filter((s) => s.life > 0);
    for (const w of this.walls) w.age += dt;
    // Walls linger a moment past their life so the render can crumble them.
    if (this.walls.some((w) => w.age > w.life + 3)) this.walls = this.walls.filter((w) => w.age <= w.life + 3);

    // Sunk hulks are removed once they have slipped under.
    if (this.ships.some((s) => !s.alive && s.deathTime > 40)) {
      for (const s of this.ships) if (!s.alive && s.deathTime > 40) this.ai.delete(s);
      this.ships = this.ships.filter((s) => s.alive || s.deathTime <= 40);
    }

    if (!this.over) {
      if (this.config.type === 'domination') this.updateCaps(dt);
      this.checkVictory();
    }
  }

  private collideShips(): void {
    const ships = this.ships;
    for (let i = 0; i < ships.length; i++) {
      const a = ships[i];
      if (!a.alive || a.deep || a.mods.banished) continue;
      for (let j = i + 1; j < ships.length; j++) {
        const b = ships[j];
        if (!b.alive || b.deep || b.mods.banished || a.architectPlatform && (a.pos.y > 20 || a.architectPlatform.owner.architect?.slots[a.architectPlatform.index].path) || b.architectPlatform && (b.pos.y > 20 || b.architectPlatform.owner.architect?.slots[b.architectPlatform.index].path) || a.stepper?.rush || b.stepper?.rush) continue;
        const reach = (a.spec.length + b.spec.length) / 2;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        if (dx * dx + dz * dz > reach * reach) continue;
        // Three circles along each hull.
        for (const fa of [-0.3, 0, 0.3]) {
          const pa = a.localToWorld(a.spec.length * fa, 0, 0);
          for (const fb of [-0.3, 0, 0.3]) {
            const pb = b.localToWorld(b.spec.length * fb, 0, 0);
            const r = (a.spec.beam + b.spec.beam) * 0.6;
            const ex = pb.x - pa.x;
            const ez = pb.z - pa.z;
            const d = Math.hypot(ex, ez);
            if (d >= r || d < 1e-3) continue;
            const push = (r - d) / 2;
            a.pos.x -= (ex / d) * push;
            a.pos.z -= (ez / d) * push;
            b.pos.x += (ex / d) * push;
            b.pos.z += (ez / d) * push;
            a.speed *= 0.995;
            b.speed *= 0.995;
            a.ramInto(b);
            b.ramInto(a);
          }
        }
      }
    }
  }

  private updateCaps(dt: number): void {
    for (let ci = 0; ci < this.caps.length; ci++) {
      const cap = this.caps[ci];
      const n: [number, number] = [0, 0];
      for (const s of this.ships) {
        if (!s.alive || s.isSummon) continue;
        if (Math.hypot(s.pos.x - cap.x, s.pos.z - cap.z) < CAP_RADIUS) n[s.team]++;
      }
      cap.contested = n[0] > 0 && n[1] > 0;
      if (cap.contested) continue;
      const team: Team | -1 = n[0] > 0 ? 0 : n[1] > 0 ? 1 : -1;
      if (team === -1 || team === cap.owner) {
        cap.progress = Math.max(0, cap.progress - dt / CAP_TIME);
        if (cap.progress === 0) cap.capturer = -1;
        continue;
      }
      if (cap.capturer !== team) {
        cap.capturer = team;
        cap.progress = 0;
      }
      cap.progress += (dt * Math.min(3, n[team])) / CAP_TIME;
      if (cap.progress >= 1) {
        cap.owner = team;
        cap.progress = 0;
        cap.capturer = -1;
        this.events.emit('capture', { cap: ci, team });
      }
    }
    this.scoreTimer += dt;
    if (this.scoreTimer >= 3) {
      this.scoreTimer -= 3;
      for (const cap of this.caps) if (cap.owner !== -1) this.score[cap.owner] += 4;
    }
  }

  onShipSunk(ship: Ship, killer: Ship | null): void {
    if (ship.architectPlatform) { destroyPlatform(ship); return; }
    if(ship.architectDrone){this.events.emit('explosion',{x:ship.pos.x,y:ship.pos.y,z:ship.pos.z,size:1});return;}
    clearArchitect(ship);
    const stepCopy = ship.stepper?.copy;
    clearStepper(ship);
    this.events.emit('shipSunk', { ship, killer });
    if (stepCopy) return;
    this.events.emit('explosion', { x: ship.pos.x, y: 8, z: ship.pos.z, size: 3 + ship.spec.length / 120 });
    if (killer) this.events.emit('ribbon', { ship: killer, kind: 'Destroyed', damage: 0 });
    // A kill tops up the ultimate meter (wingmen earn it for their captain), halves the cooldowns
    // left on the captain's skills and patches up the hull.
    const credit = killer?.summonOwner ?? killer;
    if (credit && credit.team !== ship.team) {
      credit.charge(ULT_KILL_CHARGE);
      if (credit.alive) {
        for (const st of credit.skills) if (!st.spec.ult) st.cooldown *= KILL_COOLDOWN_CUT;
        credit.heal(credit.maxHp * (credit.spec.cls === 'TT' ? KILL_HEAL_TITAN : KILL_HEAL));
        this.events.emit('ribbon', { ship: credit, kind: 'Kill bonus', damage: 0 });
      }
    }
    // Undying: the drowned feed on every death nearby.
    for (const s of this.ships) {
      const heal = s.trait?.killHeal;
      if (!heal || !s.alive || s.team === ship.team || Math.hypot(s.pos.x - ship.pos.x, s.pos.z - ship.pos.z) > 2000) continue;
      s.heal(s.maxHp * heal);
    }
    this.rush?.onSunk(ship, credit ?? null);
    this.convoy?.onSunk(ship);
    // Fleets fight on after the result, but the score stands as it was when the battle was decided.
    const type = this.config.type;
    if ((type === 'domination' || type === 'freeplay') && !ship.isSummon && !this.over) {
      const other: Team = ship.team === 0 ? 1 : 0;
      if (type === 'freeplay') this.score[other]++;
      else {
        this.score[other] += DOMINATION_KILL_POINTS;
        this.score[ship.team] = Math.max(0, this.score[ship.team] - DOMINATION_KILL_POINTS);
      }
      this.respawns.push({ ship, at: this.time + RESPAWN_DELAY });
    }
  }

  private checkVictory(): void {
    if (this.rush) return this.rush.checkVictory();
    if (this.convoy) return this.convoy.checkVictory();
    // Free play runs until the host (or the solo captain) ends it.
    if (this.config.type === 'freeplay') return;
    const alive: [number, number] = [0, 0];
    for (const s of this.ships) if (s.alive && !s.isSummon) alive[s.team]++;
    // Domination fleets come back, so only score and the clock decide it.
    if (this.config.type !== 'domination' && (alive[0] === 0 || alive[1] === 0)) {
      return this.finish(alive[0] === 0 && alive[1] === 0 ? -1 : alive[0] === 0 ? 1 : 0, 'All enemy ships destroyed');
    }
    if (this.config.type === 'domination') {
      if (this.score[0] >= DOMINATION_WIN_SCORE || this.score[1] <= 0) return this.finish(0, 'Score victory');
      if (this.score[1] >= DOMINATION_WIN_SCORE || this.score[0] <= 0) return this.finish(1, 'Score victory');
    }
    if (this.time >= BATTLE_TIME_LIMIT) {
      let a: number;
      let b: number;
      if (this.config.type === 'domination') {
        a = this.score[0];
        b = this.score[1];
      } else {
        const hp = (t: Team) => this.ships.filter((s) => s.team === t && s.alive && !s.isSummon).reduce((acc, s) => acc + s.hp / s.maxHp, 0);
        a = hp(0);
        b = hp(1);
      }
      this.finish(a === b ? -1 : a > b ? 0 : 1, 'Time expired');
    }
  }

  finish(winner: Team | -1, reason: string): void {
    this.over = true;
    this.battery.clear();
    for (const s of this.ships) if (s.architect) clearArchitect(s);
    for (const s of this.ships) if (s.spec.id === 'stepper' && !s.isSummon) clearStepper(s);
    this.winner = winner;
    this.reason = reason;
    this.events.emit('gameOver', { winner, reason });
  }
}
