import {
  DIFFICULTIES,
  DOMINATION_KILL_POINTS,
  DOMINATION_START_SCORE,
  DOMINATION_WIN_SCORE,
  KILL_COOLDOWN_CUT,
  KILL_HEAL,
  KILL_HEAL_TITAN,
  RESPAWN_DELAY,
  SIM_DT,
  ULT_KILL_CHARGE,
} from '../../config';
import { EventBus } from '../../core/Events';
import { makeRng, wrapAngle } from '../../core/math';
import type { SkillSpec, Team } from '../../core/types';
import { GROUND_CAP_RADIUS, GROUND_CAP_TIME, GROUND_TIME_LIMIT, RAM_DAMAGE, SMOKE_LIFE, SMOKE_RADIUS, SPAWN_LINE } from './config';
import { VEHICLE_BY_ID } from './data';
import type { GroundEventMap } from './events';
import { GroundAI } from './GroundAI';
import { type Bridge, crater, GROUND_MAP_BY_ID, GROUND_MAPS, type GroundMapPreset } from './maps';
import { NavGrid } from './navgrid';
import { blocksShells, type Prop, PROP_DAMAGED, PROP_RUBBLE, type Props } from './props';
import { buildGroundRoster, type GroundConfig, spawnDepth } from './setup';
import { MAT, type Terrain } from './terrain';
import type { VehicleSpec } from './types';
import { type GroundMods, Vehicle } from './Vehicle';
import { Fields } from './weapons/Fields';
import { Missiles } from './weapons/Missiles';
import { Shells } from './weapons/Shells';
import { Strikes } from './weapons/Strikes';

// The ground battle: terrain and props, the vehicles and their weapons, captures, respawns and
// the result. Runs at a fixed 60 Hz step from a seed, so every LAN peer computes the same battle.

export interface GroundCapState {
  name: string;
  x: number;
  z: number;
  owner: Team | -1;
  capturer: Team | -1;
  progress: number;
  contested: boolean;
}

export interface Smoke {
  x: number;
  z: number;
  /** Radius now, swelling to `full`. */
  r: number;
  full: number;
  life: number;
  team: Team;
}

export interface BlastOpts {
  skill?: SkillSpec | null;
  /** A hull spared (it took the direct hit already). */
  skip?: Vehicle | null;
  /** Damage to props as a share of the blast's. */
  props?: number;
  stun?: number;
  /** Outward shove (m/s) at the centre. */
  knock?: number;
  /** Full damage across the radius rather than falling off toward the edge. */
  flat?: boolean;
  /** Heal allies inside by this share of their max HP instead of sparing them. */
  allyHeal?: number;
}

export class GroundGame {
  readonly rng: () => number;
  readonly events = new EventBus<GroundEventMap>();
  readonly map: GroundMapPreset;
  readonly terrain: Terrain;
  readonly props: Props;
  readonly bridges: Bridge[];
  readonly nav: NavGrid;
  readonly shells: Shells;
  readonly missiles: Missiles;
  readonly strikes: Strikes;
  readonly fields: Fields;
  readonly difficulty;

  time = 0;
  alpha = 1;
  vehicles: Vehicle[] = [];
  /** Every vehicle that started the battle (scoreboards keep them after they are cleared). */
  readonly fleet: Vehicle[] = [];
  caps: GroundCapState[] = [];
  score: [number, number] = [0, 0];
  smokes: Smoke[] = [];
  over = false;
  winner: Team | -1 = -1;
  reason = '';
  ai = new Map<Vehicle, GroundAI>();
  respawns: { v: Vehicle; at: number }[] = [];
  nextId = 1;
  /** Props that changed state since the view last looked (the view clears it). */
  dirtyProps: Prop[] = [];

  private scoreTimer = 0;
  private accumulator = 0;

  constructor(readonly config: GroundConfig) {
    this.rng = makeRng(config.seed);
    this.map = GROUND_MAP_BY_ID[config.mapId] ?? GROUND_MAPS[0];
    const world = this.map.build();
    this.terrain = world.terrain;
    this.props = world.props;
    this.bridges = world.bridges;
    this.nav = new NavGrid(this.terrain, this.props);
    this.shells = new Shells(this);
    this.missiles = new Missiles(this);
    this.strikes = new Strikes(this);
    this.fields = new Fields(this);
    this.difficulty = DIFFICULTIES[config.difficulty] ?? DIFFICULTIES.normal;
    if (config.type === 'domination') {
      this.score = [DOMINATION_START_SCORE, DOMINATION_START_SCORE];
      this.caps = this.map.caps.map((c) => ({ ...c, owner: -1, capturer: -1, progress: 0, contested: false }));
    }
    this.spawnTeams();
  }

  private spawnTeams(): void {
    const roster = buildGroundRoster(this.config, this.rng);
    const counts: [number, number] = [roster.filter((r) => r.team === 0).length, roster.filter((r) => r.team === 1).length];
    const seen: [number, number] = [0, 0];
    const spread = this.map.spawnSpread;
    for (const r of roster) {
      const i = seen[r.team]++;
      const lane = counts[r.team] > 1 ? -spread + (i / (counts[r.team] - 1)) * spread * 2 : 0;
      const p = this.spawnPoint(r.team, r.spec, lane);
      const v = this.addVehicle(r.spec, r.team, r.name, p.x, p.z, p.heading);
      v.humanIndex = r.humanIndex;
      this.fleet.push(v);
      if (r.humanIndex < 0) this.ai.set(v, new GroundAI(v, this));
    }
  }

  /** Open ground on a team's spawn edge near `lane` (z), facing the enemy. */
  spawnPoint(team: Team, spec: VehicleSpec, lane: number): { x: number; z: number; heading: number } {
    const side = team === 0 ? -1 : 1;
    const heading = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    const x0 = side * (this.terrain.half * SPAWN_LINE - spawnDepth(spec.cls));
    const titan = spec.cls === 'TT';
    for (let k = 0; k < 40; k++) {
      const z = lane + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 12;
      const x = x0 + side * (Math.floor(k / 10) * 14);
      if (!this.nav.openAt(x, z, titan)) continue;
      if (this.vehicles.some((o) => o.alive && Math.hypot(o.x - x, o.z - z) < (o.spec.size.length + spec.size.length) / 2 + 3)) continue;
      return { x, z, heading };
    }
    const k = this.nav.nearestOpen(x0, lane, titan, 30);
    if (k >= 0) return { x: this.nav.cx(k % this.nav.n), z: this.nav.cx(Math.floor(k / this.nav.n)), heading };
    return { x: x0, z: lane, heading };
  }

  addVehicle(spec: VehicleSpec, team: Team, name: string, x: number, z: number, heading: number): Vehicle {
    const v = new Vehicle(this, spec, team, name);
    v.place(x, z, heading);
    this.vehicles.push(v);
    return v;
  }

  byId(id: number): Vehicle | null {
    if (!id) return null;
    for (const v of this.vehicles) if (v.id === id) return v;
    return null;
  }

  humans(): Vehicle[] {
    return this.fleet.filter((v) => v.humanIndex >= 0).sort((a, b) => a.humanIndex - b.humanIndex);
  }

  respawnIn(v: Vehicle): number {
    const r = this.respawns.find((x) => x.v === v);
    return r ? Math.max(0, r.at - this.time) : -1;
  }

  /** An AI wingman beside its owner that leaves after `time` seconds (Steel Avalanche, Panzer Escort). */
  spawnWingman(owner: Vehicle, specId: string, right: number, back: number, time: number, name = `${owner.name}'s escort`): Vehicle | null {
    const spec = VEHICLE_BY_ID[specId];
    if (!spec) return null;
    const f = owner.pose.f;
    const fl = Math.hypot(f[0], f[2]) || 1;
    const fx = f[0] / fl;
    const fz = f[2] / fl;
    let x = owner.x - fx * back - fz * right;
    let z = owner.z - fz * back + fx * right;
    const k = this.nav.nearestOpen(x, z, false, 6);
    if (k >= 0) {
      x = this.nav.cx(k % this.nav.n);
      z = this.nav.cx(Math.floor(k / this.nav.n));
    }
    const v = this.addVehicle(spec, owner.team, name, x, z, owner.heading);
    v.isSummon = true;
    v.summonOwner = owner;
    v.expiresAt = this.time + time;
    v.speed = owner.speed;
    v.maxHp = v.hp = Math.round(v.maxHp * 0.7);
    v.meter = 0;
    const ai = new GroundAI(v, this);
    ai.leader = owner;
    this.ai.set(v, ai);
    return v;
  }

  /** Raise a destroyed vehicle where it fell with `hpFrac` of its HP. */
  revive(v: Vehicle, hpFrac: number, skill: SkillSpec | null = null): void {
    if (v.alive || v.withdrawn) return;
    v.respawn(v.x, v.z, v.heading);
    v.hp = Math.max(1, v.maxHp * hpFrac);
    if (!this.vehicles.includes(v)) this.vehicles.push(v);
    this.respawns = this.respawns.filter((r) => r.v !== v);
    if (v.humanIndex < 0 || v.autopilot) this.ai.set(v, new GroundAI(v, this));
    this.events.emit('revive', { v, skill });
  }

  handToAI(v: Vehicle): void {
    v.autopilot = true;
    if (v.alive && !this.ai.has(v)) this.ai.set(v, new GroundAI(v, this));
  }

  takeHelm(v: Vehicle): void {
    v.autopilot = false;
    this.ai.delete(v);
    v.control.fire = false;
  }

  /** Free play: the vehicle this captain drives from the next respawn. */
  pickVehicle(v: Vehicle, specId: string): void {
    if (this.config.type !== 'freeplay' || v.isSummon || !Object.hasOwn(VEHICLE_BY_ID, specId)) return;
    const spec = VEHICLE_BY_ID[specId];
    if (spec.hidden || (spec.cls === 'TT' && this.config.titans === false)) return;
    v.nextSpec = spec === v.spec ? null : spec;
  }

  /** Free play: leave the fight now and come back after the respawn delay, not counted as destroyed. */
  redeploy(v: Vehicle): void {
    if (this.config.type !== 'freeplay' || v.isSummon || !v.alive || this.over) return;
    v.withdraw();
    this.respawns.push({ v, at: this.time + RESPAWN_DELAY });
  }

  private changeVehicle(old: Vehicle, spec: VehicleSpec): Vehicle {
    const v = new Vehicle(this, spec, old.team, old.name);
    v.humanIndex = old.humanIndex;
    v.autopilot = old.autopilot;
    v.stats = old.stats;
    old.humanIndex = -1;
    old.nextSpec = null;
    old.withdrawn = true;
    this.ai.delete(old);
    const i = this.fleet.indexOf(old);
    if (i >= 0) this.fleet[i] = v;
    this.vehicles.push(v);
    this.events.emit('vehicleChanged', { old, v });
    return v;
  }

  private updateRespawns(): void {
    const due = this.respawns.filter((r) => this.time >= r.at);
    if (!due.length) return;
    this.respawns = this.respawns.filter((r) => this.time < r.at);
    for (const r of due) {
      let v = r.v;
      if (v.alive) continue;
      if (v.nextSpec) v = this.changeVehicle(v, v.nextSpec);
      const p = this.spawnPoint(v.team, v.spec, (this.rng() - 0.5) * this.map.spawnSpread * 2);
      if (!this.vehicles.includes(v)) this.vehicles.push(v);
      v.respawn(p.x, p.z, p.heading);
      if (v.humanIndex < 0 || v.autopilot) this.ai.set(v, new GroundAI(v, this));
    }
  }

  // ---------------------------------------------------------------- world queries

  /** Nothing solid between two points: ground, standing walls and houses. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (this.terrain.segmentHit(ax, ay, az, bx, by, bz) >= 0) return false;
    return !this.props.segment(ax, ay, az, bx, by, bz);
  }

  addSmoke(x: number, z: number, team: Team, r = SMOKE_RADIUS, life = SMOKE_LIFE): void {
    this.smokes.push({ x, z, r: r * 0.3, full: r, life, team });
    this.events.emit('smoke', { x, z, team });
  }

  inSmoke(x: number, z: number): boolean {
    for (const s of this.smokes) if (Math.hypot(x - s.x, z - s.z) < s.r) return true;
    return false;
  }

  /** Does smoke hang anywhere along the line from a to b? */
  smokeBetween(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.smokes.length) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    for (const s of this.smokes) {
      const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / l2));
      if (Math.hypot(ax + dx * t - s.x, az + dz * t - s.z) < s.r) return true;
    }
    return false;
  }

  /** Enemies of `team` alive within `r` of a point, nearest first. */
  enemiesNear(team: Team, x: number, z: number, r: number): Vehicle[] {
    return this.vehicles
      .filter((v) => v.alive && v.team !== team && !v.mods.untargetable && Math.hypot(v.x - x, v.z - z) <= r)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) || a.id - b.id);
  }

  alliesNear(team: Team, x: number, z: number, r: number): Vehicle[] {
    return this.vehicles.filter((v) => v.alive && v.team === team && Math.hypot(v.x - x, v.z - z) <= r);
  }

  /** The vehicle a lock settles on: the one under the crosshair, else the enemy nearest the aim point. */
  lockTarget(v: Vehicle, targetId: number, x: number, z: number, r = 60): Vehicle | null {
    const t = this.byId(targetId);
    if (t && t.alive && t.team !== v.team && !t.mods.untargetable) return t;
    return this.enemiesNear(v.team, x, z, r)[0] ?? null;
  }

  /**
   * Active protection and flak walls: does a round at this point get swatted by an enemy's
   * system? Each system gets one try per round.
   */
  screen(owner: Vehicle, x: number, y: number, z: number, tried: number[], weight: number): boolean {
    for (const v of this.vehicles) {
      if (!v.alive || v.team === owner.team || v.mods.aps <= 0 || tried.includes(v.id)) continue;
      const range = v.mods.apsRange || 18;
      if (Math.hypot(v.x - x, v.z - z) > range || y > v.y + range) continue;
      tried.push(v.id);
      if (this.rng() < v.mods.aps * weight) {
        this.events.emit('intercept', { x, y, z });
        return true;
      }
    }
    return false;
  }

  /**
   * A blast: hulls inside take damage falling off toward the edge (none through a wall), props
   * take their share, and the stun and shove land. Returns the enemies hit.
   */
  blast(owner: Vehicle, x: number, y: number, z: number, r: number, damage: number, o: BlastOpts = {}): Vehicle[] {
    const hit: Vehicle[] = [];
    for (const v of this.vehicles) {
      if (!v.alive || v === o.skip) continue;
      const d = Math.hypot(v.x - x, v.y + 1 - y, v.z - z) - v.spec.size.width / 2;
      if (d > r) continue;
      if (v.team === owner.team) {
        if (o.allyHeal) v.heal(v.maxHp * o.allyHeal, owner);
        continue;
      }
      if (v.mods.untargetable) continue;
      if (r > 6 && !o.flat && !this.lineOfSight(x, y + 1, z, v.x, v.y + 1.5, v.z)) continue;
      const k = o.flat ? 1 : Math.max(0.25, 1 - Math.max(0, d) / r);
      v.damage(damage * k, owner, o.skill ?? null);
      if (o.stun) v.addControl('stun', o.stun, (m) => (m.stunned = true));
      if (o.knock) {
        const dl = Math.hypot(v.x - x, v.z - z) || 1;
        v.knock(((v.x - x) / dl) * o.knock * k, ((v.z - z) / dl) * o.knock * k);
      }
      hit.push(v);
    }
    if (o.props) this.damagePropsIn(x, z, r, damage * o.props, owner);
    return hit;
  }

  damagePropsIn(x: number, z: number, r: number, damage: number, by: Vehicle | null): void {
    for (const p of this.props.near(x, z, r, propScratch).slice()) {
      if (p.state === PROP_RUBBLE) continue;
      const lx = Math.max(Math.abs(Math.cos(p.rot) * (x - p.x) + Math.sin(p.rot) * (z - p.z)) - p.hw, 0);
      const lz = Math.max(Math.abs(-Math.sin(p.rot) * (x - p.x) + Math.cos(p.rot) * (z - p.z)) - p.hd, 0);
      const d = Math.hypot(lx, lz);
      if (d > r) continue;
      this.damageProp(p, damage * Math.max(0.3, 1 - d / r), by);
    }
  }

  damageProp(p: Prop, amount: number, by: Vehicle | null): void {
    if (p.state === PROP_RUBBLE || !Number.isFinite(p.hp) || amount <= 0) return;
    p.hp -= amount;
    if (p.hp <= 0) {
      this.collapse(p, by, false);
      return;
    }
    if (p.state === 0 && p.hp < p.maxHp * 0.5 && p.kind === 'building') {
      p.state = PROP_DAMAGED;
      this.dirtyProps.push(p);
      this.events.emit('propDamaged', { prop: p });
    }
  }

  /** A tank drove through it. */
  flattenProp(p: Prop, by: Vehicle): void {
    this.collapse(p, by, true);
  }

  private collapse(p: Prop, by: Vehicle | null, flattened: boolean): void {
    if (p.state === PROP_RUBBLE) return;
    const blocked = blocksShells(p);
    p.state = PROP_RUBBLE;
    p.hp = 0;
    if (by) by.stats.props++;
    if (p.kind === 'building') this.terrain.paintBox(p.x, p.z, p.hw, p.hd, p.rot, MAT.rubble);
    this.nav.updateProp(p);
    this.dirtyProps.push(p);
    this.events.emit('propDown', { prop: p, flattened });
    // A big house coming down shakes loose a blast of masonry.
    if (p.kind === 'building' && blocked && by) {
      this.events.emit('explosion', { x: p.x, y: p.y + p.h * 0.3, z: p.z, size: 1 + Math.min(3, (p.hw * p.hd) / 120) });
    }
  }

  /** Raise a temporary wall of cover for a team (Bocage Wall, Treant Wall). */
  raiseWall(owner: Vehicle, x: number, z: number, length: number, rot: number, life: number, hp: number, style = 0): Prop {
    const p = this.props.add({ kind: 'hedge', x, z, y: this.terrain.heightAt(x, z), hw: length / 2, hd: 1.2, h: 3, rot, style, team: owner.team, expires: this.time + life, hp });
    this.nav.updateProp(p);
    this.dirtyProps.push(p);
    return p;
  }

  crater(x: number, z: number, r: number, depth: number): void {
    crater(this.terrain, x, z, r, depth);
    this.terrain.version++;
  }

  // ---------------------------------------------------------------- stepping

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

  get renderTime(): number {
    return this.time - (1 - this.alpha) * SIM_DT;
  }

  interpolate(): void {
    const a = this.alpha;
    for (const v of this.vehicles) {
      v.renderX = v.prevX + (v.x - v.prevX) * a;
      v.renderY = v.prevY + (v.y - v.prevY) * a;
      v.renderZ = v.prevZ + (v.z - v.prevZ) * a;
      v.renderHeading = wrapAngle(v.prevHeading + wrapAngle(v.heading - v.prevHeading) * a);
      v.renderPitch = v.prevPitch + (v.pitch - v.prevPitch) * a;
      v.renderRoll = v.prevRoll + (v.roll - v.prevRoll) * a;
      v.renderTurret = wrapAngle(v.prevTurret + wrapAngle(v.turretYaw - v.prevTurret) * a);
    }
  }

  step(dt = SIM_DT): void {
    for (const v of this.vehicles) {
      v.prevX = v.x;
      v.prevY = v.y;
      v.prevZ = v.z;
      v.prevHeading = v.heading;
      v.prevPitch = v.pitch;
      v.prevRoll = v.roll;
      v.prevTurret = v.turretYaw;
    }
    this.time += dt;
    for (const [v, ai] of this.ai) if (v.alive) ai.update(dt);
    for (const v of this.vehicles) v.update(dt);
    this.collideVehicles();
    this.shells.update(dt);
    this.missiles.update(dt);
    this.strikes.update(dt);
    this.fields.update(dt);
    if (this.respawns.length && !this.over) this.updateRespawns();

    for (const s of this.smokes) {
      s.life -= dt;
      s.r = Math.min(s.full, s.r + s.full * dt * 0.6);
    }
    if (this.smokes.some((s) => s.life <= 0)) this.smokes = this.smokes.filter((s) => s.life > 0);

    // Raised walls fade when their time is up.
    for (const p of this.props.list) {
      if (p.expires !== undefined && p.state !== PROP_RUBBLE && this.time >= p.expires) this.collapse(p, null, false);
    }
    // Wrecks are cleared a while after they burn out.
    if (this.vehicles.some((v) => !v.alive && (v.deathTime > 30 || v.withdrawn))) {
      for (const v of this.vehicles) if (!v.alive && (v.deathTime > 30 || v.withdrawn)) this.ai.delete(v);
      this.vehicles = this.vehicles.filter((v) => v.alive || (v.deathTime <= 30 && !v.withdrawn));
    }
    if (!this.over) {
      if (this.config.type === 'domination') this.updateCaps(dt);
      this.checkVictory();
    }
  }

  private collideVehicles(): void {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const reach = (a.spec.size.length + b.spec.size.length) / 2;
        if (Math.abs(b.x - a.x) > reach || Math.abs(b.z - a.z) > reach) continue;
        const ra = a.spec.size.width * 0.55;
        const rb = b.spec.size.width * 0.55;
        let touched = false;
        for (const fa of [-0.32, 0, 0.32]) {
          const ax = a.x + a.pose.f[0] * a.spec.size.length * fa;
          const az = a.z + a.pose.f[2] * a.spec.size.length * fa;
          for (const fb of [-0.32, 0, 0.32]) {
            const bx = b.x + b.pose.f[0] * b.spec.size.length * fb;
            const bz = b.z + b.pose.f[2] * b.spec.size.length * fb;
            const ex = bx - ax;
            const ez = bz - az;
            const d = Math.hypot(ex, ez);
            const r = ra + rb;
            if (d >= r || d < 1e-4) continue;
            touched = true;
            // The heavier hull gives way less.
            const wa = b.mass / (a.mass + b.mass);
            const push = r - d;
            a.pose.x -= (ex / d) * push * wa;
            a.pose.z -= (ez / d) * push * wa;
            b.pose.x += (ex / d) * push * (1 - wa);
            b.pose.z += (ez / d) * push * (1 - wa);
          }
        }
        if (touched) this.ram(a, b);
      }
    }
  }

  /** Hulls meeting at speed: each takes damage by the other's weight and the closing speed. */
  private ram(a: Vehicle, b: Vehicle): void {
    const vax = a.pose.f[0] * a.speed;
    const vaz = a.pose.f[2] * a.speed;
    const vbx = b.pose.f[0] * b.speed;
    const vbz = b.pose.f[2] * b.speed;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dl = Math.hypot(dx, dz) || 1;
    const closing = ((vax - vbx) * dx + (vaz - vbz) * dz) / dl;
    a.speed *= 0.9;
    b.speed *= 0.9;
    if (closing < 2.5 || a.team === b.team) return;
    if (!a.canRam(this.time) || !b.canRam(this.time)) return;
    const toB = RAM_DAMAGE * a.mass * closing * a.mods.ramMul;
    const toA = RAM_DAMAGE * b.mass * closing * b.mods.ramMul * 0.5;
    b.damage(toB, a, a.mods.ramSkill, true);
    a.damage(toA, b, b.mods.ramSkill, true);
    b.knock((dx / dl) * closing * Math.min(1.5, a.mass / b.mass), (dz / dl) * closing * Math.min(1.5, a.mass / b.mass));
    this.events.emit('ribbon', { v: a, kind: 'Ram', damage: toB, target: b });
  }

  private updateCaps(dt: number): void {
    for (let ci = 0; ci < this.caps.length; ci++) {
      const cap = this.caps[ci];
      const n: [number, number] = [0, 0];
      for (const v of this.vehicles) {
        if (!v.alive || v.isSummon) continue;
        if (Math.hypot(v.x - cap.x, v.z - cap.z) < GROUND_CAP_RADIUS) n[v.team]++;
      }
      cap.contested = n[0] > 0 && n[1] > 0;
      if (cap.contested) continue;
      const team: Team | -1 = n[0] > 0 ? 0 : n[1] > 0 ? 1 : -1;
      if (team === -1 || team === cap.owner) {
        cap.progress = Math.max(0, cap.progress - dt / GROUND_CAP_TIME);
        if (cap.progress === 0) cap.capturer = -1;
        continue;
      }
      if (cap.capturer !== team) {
        cap.capturer = team;
        cap.progress = 0;
      }
      cap.progress += (dt * Math.min(3, n[team])) / GROUND_CAP_TIME;
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

  onDestroyed(v: Vehicle, killer: Vehicle | null): void {
    this.events.emit('destroyed', { v, killer });
    this.events.emit('explosion', { x: v.x, y: v.y + 1.5, z: v.z, size: 1.2 + v.spec.size.length / 12 });
    if (killer) this.events.emit('ribbon', { v: killer, kind: 'Destroyed', damage: 0, target: v });
    const credit = killer?.summonOwner ?? killer;
    if (credit && credit.team !== v.team) {
      credit.charge(ULT_KILL_CHARGE);
      if (credit.alive) {
        for (const st of credit.skills) if (!st.spec.ult) st.cooldown *= KILL_COOLDOWN_CUT;
        credit.heal(credit.maxHp * (credit.titan ? KILL_HEAL_TITAN : KILL_HEAL));
        this.events.emit('ribbon', { v: credit, kind: 'Kill bonus', damage: 0 });
      }
    }
    for (const o of this.vehicles) {
      const heal = o.trait?.killHeal;
      if (heal && o.alive && o.team !== v.team && Math.hypot(o.x - v.x, o.z - v.z) < 300) o.heal(o.maxHp * heal);
    }
    const type = this.config.type;
    if ((type === 'domination' || type === 'freeplay') && !v.isSummon && !this.over) {
      const other: Team = v.team === 0 ? 1 : 0;
      if (type === 'freeplay') this.score[other]++;
      else {
        this.score[other] += DOMINATION_KILL_POINTS;
        this.score[v.team] = Math.max(0, this.score[v.team] - DOMINATION_KILL_POINTS);
      }
      this.respawns.push({ v, at: this.time + RESPAWN_DELAY });
    }
  }

  private checkVictory(): void {
    const type = this.config.type;
    if (type === 'freeplay') return;
    const alive: [number, number] = [0, 0];
    for (const v of this.vehicles) if (v.alive && !v.isSummon) alive[v.team]++;
    if (type === 'annihilation' && (alive[0] === 0 || alive[1] === 0)) {
      return this.finish(alive[0] === 0 && alive[1] === 0 ? -1 : alive[0] === 0 ? 1 : 0, 'All enemy vehicles destroyed');
    }
    if (type === 'domination') {
      if (this.score[0] >= DOMINATION_WIN_SCORE || this.score[1] <= 0) return this.finish(0, 'Score victory');
      if (this.score[1] >= DOMINATION_WIN_SCORE || this.score[0] <= 0) return this.finish(1, 'Score victory');
    }
    if (this.time >= GROUND_TIME_LIMIT) {
      let a: number;
      let b: number;
      if (type === 'domination') {
        a = this.score[0];
        b = this.score[1];
      } else {
        const hp = (t: Team) => this.vehicles.filter((v) => v.team === t && v.alive && !v.isSummon).reduce((acc, v) => acc + v.hp / v.maxHp, 0);
        a = hp(0);
        b = hp(1);
      }
      this.finish(a === b ? -1 : a > b ? 0 : 1, 'Time expired');
    }
  }

  finish(winner: Team | -1, reason: string): void {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.reason = reason;
    this.events.emit('gameOver', { winner, reason });
  }
}

const propScratch: Prop[] = [];

export type { GroundMods };
