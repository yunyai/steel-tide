import { RESPAWN_SHIELD, ULT_PASSIVE_TIME, ULT_TAKEN_CHARGE } from '../../config';
import { clamp, truncGaussian, wrapAngle } from '../../core/math';
import { FACTIONS, type Trait } from '../../data/factions';
import type { SkillSpec, Team } from '../../core/types';
import type { SkillState } from '../../skills/types';
import { newPose, type Pose, poseAxes, toWorld } from './armor';
import {
  ARTY_ANGLE,
  ARTY_GRAVITY_MUL,
  BLOOM_MOVE,
  BLOOM_SHOT,
  BLOOM_TRAVERSE,
  BLOOM_TURN,
  FIRE_DPS,
  KMH,
  REGEN_DELAY,
  REGEN_RATE,
  SHELL_SPEED_SCALE,
  SMOKE_BLOOM,
  TITAN,
  ULT_DAMAGE_CHARGE,
} from './config';
import { driveStep, settle } from './drive';
import type { CritKind } from './events';
import type { GroundGame } from './GroundGame';
import { GROUND_SKILLS } from './skills/registry';
import type { AmmoSpec, GroundConsumableSpec, VehicleSpec } from './types';

// One vehicle in a ground battle: its orders, hull and gun, crits, consumables, skills and the
// modifiers they stack. Moves through drive.ts; rounds and rockets go to the weapon systems.

const DEG = Math.PI / 180;
const GRAVITY = 9.81;

export interface GroundControl {
  /** -1..1: reverse to full ahead (held). */
  drive: number;
  /** -1..1: left to right. */
  steer: number;
  /** Where the crosshair rests in the world. */
  aimX: number;
  aimY: number;
  aimZ: number;
  fire: boolean;
  /** Ammo slot asked for, or null. */
  ammo: number | null;
  /** Kit index to trigger this step, or -1. */
  skill: number;
  /** 0 repair kit, 1 class utility, or -1. */
  consumable: number;
  /** Vehicle under the crosshair (missile locks, the repair beam), 0 for none. */
  targetId: number;
}

export function emptyGroundControl(): GroundControl {
  return { drive: 0, steer: 0, aimX: 0, aimY: 0, aimZ: 0, fire: false, ammo: null, skill: -1, consumable: -1, targetId: 0 };
}

export interface GroundMods {
  reloadMul: number;
  dispersionMul: number;
  damageMul: number;
  damageTakenMul: number;
  speedMul: number;
  accelMul: number;
  turnMul: number;
  traverseMul: number;
  penMul: number;
  invulnerable: boolean;
  untargetable: boolean;
  stunned: boolean;
  disarmed: boolean;
  silenced: boolean;
  rooted: boolean;
  feared: boolean;
  fearX: number;
  fearZ: number;
  /** Marked: takes this much more damage (1 = unmarked). */
  marked: number;
  critImmune: boolean;
  /** Drives through houses, ignores slopes, stuns and roots. */
  unstoppable: boolean;
  fastReverse: boolean;
  /** Ramming deals this much more. */
  ramMul: number;
  ramSkill: SkillSpec | null;
  /** Rounds that hit this hull ignore its angling (Elven Mark and kin). */
  exposed: boolean;
  lifesteal: number;
  cooldownMul: number;
  ultChargeMul: number;
  regenMul: number;
  healBlock: boolean;
  missileReloadMul: number;
  /** Active protection: chance to swat each incoming missile or round (0..1), and its reach. */
  aps: number;
  apsRange: number;
  /** A shove being applied (m/s, world). */
  knockX: number;
  knockZ: number;
}

function baseMods(): GroundMods {
  return {
    reloadMul: 1,
    dispersionMul: 1,
    damageMul: 1,
    damageTakenMul: 1,
    speedMul: 1,
    accelMul: 1,
    turnMul: 1,
    traverseMul: 1,
    penMul: 1,
    invulnerable: false,
    untargetable: false,
    stunned: false,
    disarmed: false,
    silenced: false,
    rooted: false,
    feared: false,
    fearX: 0,
    fearZ: 0,
    marked: 1,
    critImmune: false,
    unstoppable: false,
    fastReverse: false,
    ramMul: 1,
    ramSkill: null,
    exposed: false,
    lifesteal: 0,
    cooldownMul: 1,
    ultChargeMul: 1,
    regenMul: 1,
    healBlock: false,
    missileReloadMul: 1,
    aps: 0,
    apsRange: 0,
    knockX: 0,
    knockZ: 0,
  };
}

function applyTrait(m: GroundMods, t: Trait): void {
  m.damageMul *= t.damageMul ?? 1;
  m.damageTakenMul *= t.damageTakenMul ?? 1;
  m.cooldownMul *= t.cooldownMul ?? 1;
  m.ultChargeMul *= t.ultChargeMul ?? 1;
  m.lifesteal += t.lifesteal ?? 0;
  m.dispersionMul *= t.dispersionMul ?? 1;
  m.speedMul *= t.speedMul ?? 1;
  m.regenMul *= t.regenMul ?? 1;
  m.missileReloadMul *= t.missileReloadMul ?? 1;
}

export interface GroundEffect {
  id: string;
  time: number;
  apply(m: GroundMods): void;
}

/** The next round(s) out of the gun fly special (Flak Burst, APDS Sabot, Monty's Long Shot...). */
export interface ShotBuff {
  skill: SkillSpec;
  /** Rounds left to buff. */
  left: number;
  damageMul?: number;
  penMul?: number;
  /** Plates count flat on, and nothing ricochets. */
  ignoreAngle?: boolean;
  /** Bursts in the air near an enemy (or at the aim point), blast radius in metres. */
  airburst?: number;
  /** Carries on through hulls and houses. */
  pierce?: boolean;
  /** Fires at once, never waiting on the reload. */
  instant?: boolean;
  onHit?: (target: Vehicle) => void;
}

export interface ConsumableState {
  spec: GroundConsumableSpec;
  charges: number;
  cooldown: number;
  /** Seconds left running. */
  active: number;
}

export interface GroundStats {
  damage: number;
  kills: number;
  deaths: number;
  shots: number;
  hits: number;
  pens: number;
  bounced: number;
  received: number;
  blocked: number;
  crits: number;
  /** Part of `damage` dealt by skills. */
  skill: number;
  /** Hit points restored to allies. */
  healed: number;
  props: number;
}

function newStats(): GroundStats {
  return { damage: 0, kills: 0, deaths: 0, shots: 0, hits: 0, pens: 0, bounced: 0, received: 0, blocked: 0, crits: 0, skill: 0, healed: 0, props: 0 };
}

/** A titan's three ultimates come online one after another. */
const ULT_START = [0.35, 0.2, 0];

export class Vehicle {
  readonly id: number;
  readonly spec: VehicleSpec;
  readonly team: Team;
  name: string;
  humanIndex = -1;
  autopilot = false;
  /** Free play: what this captain drives from the next respawn. */
  nextSpec: VehicleSpec | null = null;
  isSummon = false;
  summonOwner: Vehicle | null = null;
  expiresAt = Infinity;
  /** Out of the fight for good (left the field, or swapped vehicle in Free play). */
  withdrawn = false;
  readonly trait: Trait | undefined;
  readonly titan: boolean;
  readonly mass: number;

  readonly pose: Pose = newPose();
  heading = 0;
  pitch = 0;
  roll = 0;
  /** Forward and sideways speed, m/s. */
  speed = 0;
  side = 0;
  /** Current hull turn rate (rad/s). */
  yawRate = 0;
  /** Turret (or casemate gun) yaw from the bow, and gun elevation in the world. */
  turretYaw = 0;
  gunPitch = 0;
  /** The gun is on its aim point. */
  onTarget = false;

  prevX = 0;
  prevY = 0;
  prevZ = 0;
  prevHeading = 0;
  prevPitch = 0;
  prevRoll = 0;
  prevTurret = 0;
  renderX = 0;
  renderY = 0;
  renderZ = 0;
  renderHeading = 0;
  renderPitch = 0;
  renderRoll = 0;
  renderTurret = 0;

  hp: number;
  maxHp: number;
  alive = true;
  deathTime = 0;
  /** Absorbs damage before the hull. */
  shield = 0;
  shieldTime = 0;
  /** Untouchable for a moment after (re)spawning. */
  spawnShield = 0;
  lastHit = -999;
  lastAttacker: Vehicle | null = null;
  private lastRam = -9;

  control: GroundControl = emptyGroundControl();
  mods: GroundMods = baseMods();
  effects: GroundEffect[] = [];
  skills: SkillState[];
  readonly ultIndices: number[];
  consumables: ConsumableState[];
  crits = { tracks: 0, fire: 0 };
  /** Who lit the fire. */
  private fireBy: Vehicle | null = null;

  /** Seconds until the gun is loaded; rounds left in the clip. */
  reload = 0;
  clip = 0;
  ammoIndex = 0;
  /** Aim circle multiplier: 1 when fully aimed. */
  bloom = 3;
  shotBuff: ShotBuff | null = null;
  /** Rocket salvo under way, and the launcher's reload. */
  salvoLeft = 0;
  salvoTimer = 0;
  launcherReload = 0;
  /** Repair beam: the ally being healed this step (for the view), or null. */
  beamTarget: Vehicle | null = null;
  stats: GroundStats = newStats();

  constructor(
    readonly game: GroundGame,
    spec: VehicleSpec,
    team: Team,
    name: string,
  ) {
    this.id = game.nextId++;
    this.spec = spec;
    this.team = team;
    this.name = name;
    this.trait = FACTIONS[spec.nation]?.trait;
    this.titan = spec.cls === 'TT';
    this.mass = spec.mass;
    this.maxHp = this.hp = Math.round(spec.hp * (this.trait?.hpMul ?? 1));
    this.clip = spec.gun?.clip?.size ?? 1;
    let u = 0;
    this.skills = spec.skills.map((sp, index) => ({ spec: sp, index, cooldown: 0, active: false, time: 0, meter: sp.ult ? (ULT_START[u++] ?? 0) : 0, data: {} }));
    this.ultIndices = this.skills.filter((st) => st.spec.ult).map((st) => st.index);
    this.consumables = spec.consumables.map((c) => ({ spec: c, charges: c.charges, cooldown: 0, active: 0 }));
    this.recomputeMods();
  }

  get x(): number {
    return this.pose.x;
  }
  get y(): number {
    return this.pose.y;
  }
  get z(): number {
    return this.pose.z;
  }

  get ammo(): AmmoSpec | null {
    return this.spec.gun?.ammo[this.ammoIndex] ?? null;
  }

  /** World yaw of the gun. */
  get gunYaw(): number {
    return wrapAngle(this.heading + this.turretYaw);
  }

  updateAxes(): void {
    poseAxes(this.pose, this.heading, this.pitch, this.roll);
    this.pose.turretYaw = this.turretYaw;
  }

  /** Put the hull at a place on the ground. */
  place(x: number, z: number, heading: number): void {
    this.pose.x = x;
    this.pose.z = z;
    this.heading = heading;
    this.speed = this.side = 0;
    settle(this, this.game);
    this.prevX = this.renderX = this.pose.x;
    this.prevY = this.renderY = this.pose.y;
    this.prevZ = this.renderZ = this.pose.z;
    this.prevHeading = this.renderHeading = heading;
    this.prevPitch = this.renderPitch = this.pitch;
    this.prevRoll = this.renderRoll = this.roll;
    this.prevTurret = this.renderTurret = this.turretYaw;
    const c = this.control;
    c.aimX = x + Math.sin(heading) * 300;
    c.aimZ = z - Math.cos(heading) * 300;
    c.aimY = this.game.terrain.heightAt(c.aimX, c.aimZ) + 2;
  }

  /** The gun's pivot (top of the turret, or the casemate's mantlet) in the world. */
  pivot(): { x: number; y: number; z: number } {
    const s = this.spec.size;
    const t = s.turret;
    return toWorld(this.pose, 0, s.height + (t ? t.height * 0.55 : 0.3), t ? t.offset : s.length * 0.2);
  }

  /** Where rounds leave the barrel. */
  muzzle(): { x: number; y: number; z: number } {
    const p = this.pivot();
    const cp = Math.cos(this.gunPitch);
    const yaw = this.gunYaw;
    const b = this.spec.size.barrel;
    return { x: p.x + Math.sin(yaw) * cp * b, y: p.y + Math.sin(this.gunPitch) * b, z: p.z - Math.cos(yaw) * cp * b };
  }

  // ------------------------------------------------------------------ modifiers and effects

  addEffect(id: string, time: number, apply: (m: GroundMods) => void): void {
    const old = this.effects.find((e) => e.id === id);
    if (old) {
      old.time = Math.max(old.time, time);
      old.apply = apply;
    } else this.effects.push({ id, time, apply });
    this.recomputeMods();
  }

  hasEffect(id: string): boolean {
    return this.effects.some((e) => e.id === id);
  }

  removeEffect(id: string): void {
    const n = this.effects.length;
    this.effects = this.effects.filter((e) => e.id !== id);
    if (this.effects.length !== n) this.recomputeMods();
  }

  /** Stun, root, fear and silence: titans and the unstoppable shrug them off quicker. */
  addControl(id: string, time: number, apply: (m: GroundMods) => void): void {
    if (this.mods.unstoppable) return;
    this.addEffect(id, time * (this.titan ? 0.4 : 1), apply);
  }

  recomputeMods(): void {
    const keepKnock = { x: this.mods.knockX, z: this.mods.knockZ };
    const m = baseMods();
    if (this.trait) applyTrait(m, this.trait);
    if (this.titan) {
      m.damageTakenMul *= TITAN.damageTaken;
      m.cooldownMul *= TITAN.cooldown;
      m.ultChargeMul *= TITAN.ultCharge;
      m.critImmune = true;
    }
    for (const e of this.effects) e.apply(m);
    if (m.unstoppable) {
      m.stunned = m.rooted = m.feared = false;
    }
    m.knockX = keepKnock.x;
    m.knockZ = keepKnock.z;
    this.mods = m;
  }

  /** A shove (m/s) in a world direction; the unstoppable and titans barely move. */
  knock(x: number, z: number): void {
    if (this.mods.unstoppable) return;
    const k = this.titan ? 0.1 : 1;
    this.mods.knockX += x * k;
    this.mods.knockZ += z * k;
  }

  // ------------------------------------------------------------------ skills

  skillReady(i: number): boolean {
    const st = this.skills[i];
    if (!st || !this.alive || st.active || this.mods.stunned || this.mods.silenced) return false;
    return st.spec.ult ? st.meter >= 1 && !this.isSummon : st.cooldown <= 0;
  }

  activateSkill(i: number): boolean {
    if (!this.skillReady(i)) return false;
    const st = this.skills[i];
    const impl = GROUND_SKILLS[st.spec.id];
    st.data = {};
    if (!impl || impl.activate(this, this.game, st) === false) return false;
    st.active = st.spec.duration > 0;
    st.time = st.spec.duration;
    if (st.spec.ult) st.meter = 0;
    else st.cooldown = st.spec.cooldown * this.mods.cooldownMul;
    this.game.events.emit('skill', { v: this, index: i });
    return true;
  }

  get meter(): number {
    const i = this.ultIndices[0];
    return i === undefined ? 0 : this.skills[i].meter;
  }

  set meter(v: number) {
    for (const i of this.ultIndices) this.skills[i].meter = v;
  }

  charge(amount: number): void {
    if (this.isSummon) return;
    for (const i of this.ultIndices) {
      const st = this.skills[i];
      if (!st.active) st.meter = Math.min(1, st.meter + amount * this.mods.ultChargeMul);
    }
  }

  private updateSkills(dt: number): void {
    for (const st of this.skills) {
      if (st.cooldown > 0) st.cooldown -= dt;
      if (!st.active) continue;
      const impl = GROUND_SKILLS[st.spec.id];
      impl?.update?.(this, this.game, dt, st);
      st.time -= dt;
      if (st.time <= 0 || !this.alive) {
        st.active = false;
        impl?.end?.(this, this.game, st);
        this.game.events.emit('skillEnd', { v: this, index: st.index });
      }
    }
    if (this.isSummon) return;
    for (const i of this.ultIndices) {
      const st = this.skills[i];
      if (!st.active) st.meter = Math.min(1, st.meter + (dt / (st.spec.cooldown || ULT_PASSIVE_TIME)) * this.mods.ultChargeMul);
    }
  }

  // ------------------------------------------------------------------ consumables

  useConsumable(i: number): boolean {
    const c = this.consumables[i];
    if (!c || !this.alive || c.cooldown > 0 || c.charges <= 0 || c.active > 0 || this.mods.stunned) return false;
    const s = c.spec;
    const g = this.game;
    switch (s.type) {
      case 'repair':
        if (!this.crits.tracks && !this.crits.fire && this.hp >= this.maxHp * 0.98) return false;
        this.crits.tracks = this.crits.fire = 0;
        this.heal(this.maxHp * (s.power ?? 0.2));
        break;
      case 'applique':
        this.addEffect('applique', s.duration, (m) => (m.damageTakenMul *= s.power ?? 0.75));
        break;
      case 'bulwark':
        this.addEffect('bulwark', s.duration, (m) => {
          m.damageTakenMul *= s.power ?? 0.6;
          m.critImmune = true;
        });
        break;
      case 'overdrive':
      case 'relocate':
        this.addEffect(s.type, s.duration, (m) => {
          m.speedMul *= s.power ?? 1.35;
          m.accelMul *= 1.6;
          m.turnMul *= 1.2;
        });
        break;
      case 'smoke': {
        const f = this.pose.f;
        for (const k of [-1, 0, 1]) {
          g.addSmoke(this.x + f[0] * 16 - f[2] * k * 14, this.z + f[2] * 16 + f[0] * k * 14, this.team);
        }
        break;
      }
      case 'steady':
        this.addEffect('steady', s.duration, (m) => {
          if (Math.abs(this.speed) < 1.2) {
            m.dispersionMul *= 0.5;
            m.reloadMul *= 0.8;
          }
        });
        break;
      case 'rapidReload':
        this.launcherReload = 0;
        this.reload = Math.min(this.reload, 0.3);
        break;
      case 'fieldRepair':
        g.fields.add({ owner: this, x: this.x, z: this.z, r: s.power ?? 40, life: s.duration, follow: this, allyHeal: 0.025, color: 0x7dffa0, skill: null });
        break;
    }
    c.charges--;
    c.cooldown = s.cooldown;
    c.active = s.duration;
    g.events.emit('consumable', { v: this, type: s.type });
    return true;
  }

  // ------------------------------------------------------------------ damage

  /** Shield of `amount` hit points for `time` seconds (keeps the larger). */
  addShield(amount: number, time: number): void {
    this.shield = Math.max(this.shield, amount);
    this.shieldTime = Math.max(this.shieldTime, time);
  }

  /**
   * Take damage; returns what got through. `skill` credits skill damage; `raw` skips the
   * attacker's damage modifiers (they were applied already).
   */
  damage(amount: number, attacker: Vehicle | null, skill: SkillSpec | null = null, raw = false): number {
    if (!this.alive || amount <= 0 || this.mods.invulnerable || this.spawnShield > 0 || this.withdrawn) return 0;
    let dmg = amount * this.mods.damageTakenMul * this.mods.marked;
    if (attacker && !raw) dmg *= attacker.mods.damageMul;
    if (attacker && attacker.team === this.team && attacker !== this) return 0;
    if (this.shield > 0) {
      const soak = Math.min(this.shield, dmg);
      this.shield -= soak;
      dmg -= soak;
      this.game.events.emit('shieldHit', { v: this, amount: soak });
      if (dmg <= 0) return 0;
    }
    dmg = Math.min(dmg, this.hp);
    this.hp -= dmg;
    this.lastHit = this.game.time;
    this.stats.received += dmg;
    this.charge(dmg * ULT_DAMAGE_CHARGE * ULT_TAKEN_CHARGE);
    if (attacker && attacker !== this) {
      this.lastAttacker = attacker;
      const credit = attacker.summonOwner ?? attacker;
      credit.stats.damage += dmg;
      if (skill) credit.stats.skill += dmg;
      if (!skill?.ult) credit.charge(dmg * ULT_DAMAGE_CHARGE);
      if (attacker.mods.lifesteal > 0 && attacker.alive) attacker.heal(dmg * attacker.mods.lifesteal);
      if (skill) this.game.events.emit('skillHit', { v: this, attacker, skill, damage: dmg });
    }
    if (this.hp <= 0) this.die(attacker ?? this.lastAttacker);
    return dmg;
  }

  heal(amount: number, by: Vehicle | null = null): number {
    if (!this.alive || this.mods.healBlock || amount <= 0) return 0;
    const h = Math.min(amount, this.maxHp - this.hp);
    if (h <= 0) return 0;
    this.hp += h;
    if (by && by !== this) by.stats.healed += h;
    return h;
  }

  /** A penetrating hit may break something: tracks low down, the engine from behind, the ammo. */
  crit(kind: CritKind, attacker: Vehicle | null): void {
    if (!this.alive || this.mods.critImmune) return;
    const g = this.game;
    if (kind === 'tracks') this.crits.tracks = Math.max(this.crits.tracks, 4);
    else if (kind === 'fire') {
      this.crits.fire = Math.max(this.crits.fire, 8);
      this.fireBy = attacker;
    }
    if (attacker) attacker.stats.crits++;
    g.events.emit('crit', { v: this, kind, attacker });
    if (kind === 'ammo') {
      g.events.emit('explosion', { x: this.x, y: this.y + 2, z: this.z, size: 1.4 });
      if (attacker) g.events.emit('ribbon', { v: attacker, kind: 'Ammo rack', damage: 0, target: this });
      this.damage(this.maxHp * 0.3, attacker, null, true);
    }
  }

  die(killer: Vehicle | null): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.deathTime = 0;
    this.speed = this.side = 0;
    this.control.fire = false;
    this.salvoLeft = 0;
    this.crits.tracks = 0;
    this.stats.deaths++;
    const credit = killer?.summonOwner ?? killer;
    if (credit && credit.team !== this.team) credit.stats.kills++;
    for (const st of this.skills) {
      if (!st.active) continue;
      st.active = false;
      GROUND_SKILLS[st.spec.id]?.end?.(this, this.game, st);
    }
    this.game.onDestroyed(this, killer);
  }

  /** Back into the fight at a spawn point (Domination, Free play). */
  respawn(x: number, z: number, heading: number): void {
    this.alive = true;
    this.withdrawn = false;
    this.hp = this.maxHp;
    this.shield = this.shieldTime = 0;
    this.crits.tracks = this.crits.fire = 0;
    this.effects = [];
    this.mods.knockX = this.mods.knockZ = 0;
    this.recomputeMods();
    this.reload = 0;
    this.clip = this.spec.gun?.clip?.size ?? 1;
    this.launcherReload = 0;
    this.salvoLeft = 0;
    this.shotBuff = null;
    this.turretYaw = 0;
    this.bloom = 3;
    this.lastAttacker = null;
    for (const c of this.consumables) {
      c.charges = c.spec.charges;
      c.cooldown = c.active = 0;
    }
    for (const st of this.skills) {
      st.active = false;
      st.time = 0;
    }
    this.place(x, z, heading);
    this.spawnShield = RESPAWN_SHIELD;
    this.game.events.emit('respawn', { v: this });
  }

  /** Rams count once every half second or so per hull. */
  canRam(time: number): boolean {
    if (time - this.lastRam < 0.6) return false;
    this.lastRam = time;
    return true;
  }

  /** Free play: out of the fight without counting as destroyed. */
  withdraw(): void {
    this.alive = false;
    this.withdrawn = true;
    this.hp = 0;
    this.speed = this.side = 0;
  }

  // ------------------------------------------------------------------ step

  update(dt: number): void {
    if (!this.alive) {
      this.deathTime += dt;
      return;
    }
    const g = this.game;
    if (this.spawnShield > 0) this.spawnShield -= dt;
    if (this.shieldTime > 0) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0) this.shield = 0;
    }
    if (this.isSummon && g.time >= this.expiresAt) {
      this.withdraw();
      return;
    }

    // Effects run out.
    let changed = false;
    for (const e of this.effects) {
      e.time -= dt;
      if (e.time <= 0) changed = true;
    }
    if (changed) this.effects = this.effects.filter((e) => e.time > 0);
    // Some effects read live state (Steady aim), so the stack is rebuilt every step.
    this.recomputeMods();
    const k = Math.exp(-dt * 6);
    this.mods.knockX *= k;
    this.mods.knockZ *= k;
    if (Math.abs(this.mods.knockX) + Math.abs(this.mods.knockZ) < 0.05) this.mods.knockX = this.mods.knockZ = 0;

    // Crits.
    if (this.crits.tracks > 0) this.crits.tracks -= dt;
    if (this.crits.fire > 0) {
      this.crits.fire -= dt;
      this.damage(this.maxHp * FIRE_DPS * dt, this.fireBy, null, true);
      if (!this.alive) return;
    }

    for (const c of this.consumables) {
      if (c.cooldown > 0) c.cooldown -= dt;
      if (c.active > 0) c.active -= dt;
    }

    // Orders.
    const c = this.control;
    if (c.ammo !== null && this.spec.gun && c.ammo < this.spec.gun.ammo.length && c.ammo !== this.ammoIndex) {
      // Changing rounds clears the breech: a full reload.
      this.ammoIndex = c.ammo;
      this.reload = this.spec.gun.reload * this.mods.reloadMul;
      this.clip = this.spec.gun.clip?.size ?? 1;
    }
    if (c.skill >= 0) this.activateSkill(c.skill);
    if (c.consumable >= 0) this.useConsumable(c.consumable);
    c.ammo = null;
    c.skill = -1;
    c.consumable = -1;

    this.updateSkills(dt);
    if (!this.alive) return;
    driveStep(this, g, dt);
    this.aimGun(dt);
    this.updateBloom(dt);
    if (this.reload > 0) this.reload -= dt;
    if (this.launcherReload > 0) this.launcherReload -= dt;
    this.fireGun();
    this.fireLauncher(dt);
    this.repairBeam(dt);

    // Out of the fight, the crew patches the hull up.
    const delay = this.titan ? TITAN.regenDelay : REGEN_DELAY;
    if (g.time - this.lastHit > delay && this.crits.fire <= 0 && this.hp < this.maxHp) {
      this.heal(this.maxHp * REGEN_RATE * this.mods.regenMul * (this.titan ? TITAN.regenRate : 1) * dt);
    }
  }

  /** Swing the turret toward the aim point and lay the gun for its range. */
  private aimGun(dt: number): void {
    const gun = this.spec.gun;
    const c = this.control;
    const p = this.pivot();
    const want = Math.atan2(c.aimX - p.x, -(c.aimZ - p.z));
    let rel = wrapAngle(want - this.heading);
    const arc = gun?.arc ?? this.spec.launcher?.arc ?? 180;
    if (arc < 180) {
      const facing = ((gun?.facing ?? 0) * Math.PI) / 180;
      rel = facing + clamp(wrapAngle(rel - facing), -arc * DEG, arc * DEG);
    }
    const traverse = (gun?.traverse ?? 30) * DEG * this.mods.traverseMul * (this.mods.stunned ? 0 : 1);
    const before = this.turretYaw;
    const d = wrapAngle(rel - this.turretYaw);
    this.turretYaw = Math.abs(d) <= traverse * dt ? rel : wrapAngle(this.turretYaw + Math.sign(d) * traverse * dt);
    this.traversing = Math.abs(wrapAngle(this.turretYaw - before)) / Math.max(1e-6, traverse * dt);
    this.pose.turretYaw = this.turretYaw;

    if (!gun) {
      this.onTarget = Math.abs(wrapAngle(want - this.gunYaw)) < 1.5 * DEG;
      return;
    }
    const ammo = this.ammo!;
    const dx = Math.hypot(c.aimX - p.x, c.aimZ - p.z);
    const dy = c.aimY - p.y;
    let pitch: number;
    if (gun.artillery) pitch = ARTY_ANGLE * DEG;
    else pitch = lowArc(ammo.velocity * SHELL_SPEED_SCALE, GRAVITY, dx, dy) ?? 0.6;
    // The gun's limits are against the hull, which may be tipped along the gun's line.
    const tilt = this.pitch * Math.cos(this.turretYaw) - this.roll * Math.sin(this.turretYaw);
    const relPitch = clamp(pitch - tilt, -gun.depression * DEG, (gun.artillery ? 80 : gun.elevation) * DEG);
    const laid = relPitch + tilt;
    const step = 20 * DEG * dt;
    this.gunPitch = Math.abs(laid - this.gunPitch) <= step ? laid : this.gunPitch + Math.sign(laid - this.gunPitch) * step;
    this.onTarget = Math.abs(wrapAngle(want - this.gunYaw)) < 0.6 * DEG && Math.abs(laid - pitch) < 0.5 * DEG;
  }

  /** How hard the turret is slewing (0..1), for the aim circle. */
  traversing = 0;

  private updateBloom(dt: number): void {
    const gun = this.spec.gun;
    const aimTime = gun?.aimTime ?? 2;
    const maxF = this.spec.drive.maxSpeed * KMH;
    const want =
      1 +
      BLOOM_MOVE * clamp(Math.hypot(this.speed, this.side) / Math.max(1, maxF), 0, 1) +
      BLOOM_TURN * clamp(Math.abs(this.yawRate) / Math.max(0.01, this.spec.drive.turnRate * DEG), 0, 1) +
      BLOOM_TRAVERSE * clamp(this.traversing, 0, 1);
    if (want > this.bloom) this.bloom += (want - this.bloom) * Math.min(1, dt * 8);
    else this.bloom = 1 + (this.bloom - 1) * Math.exp((-dt * 2.6) / aimTime);
  }

  /** Spread radius (m) at 100 m right now. */
  get spread(): number {
    const gun = this.spec.gun;
    if (!gun) return (this.spec.launcher?.spread ?? 1) * this.mods.dispersionMul;
    const c = this.control;
    const smoke = this.game.smokeBetween(this.x, this.z, c.aimX, c.aimZ) ? SMOKE_BLOOM : 1;
    return gun.dispersion * this.bloom * this.mods.dispersionMul * smoke;
  }

  get canFire(): boolean {
    return this.alive && !this.mods.disarmed && !this.mods.stunned && this.spawnShield <= RESPAWN_SHIELD - 0.5;
  }

  private fireGun(): void {
    const gun = this.spec.gun;
    const buff = this.shotBuff;
    if (!gun || !this.control.fire || !this.canFire) return;
    if (this.reload > 0 && !buff?.instant) return;
    const g = this.game;
    const ammo = this.ammo!;
    const c = this.control;
    const p = this.pivot();
    const rng = g.rng;
    const spreadAng = (this.spread / 100) * (rng() * 0.5 + 0.5);
    const a = rng() * Math.PI * 2;
    const dev = (Math.abs(truncGaussian(rng, 2)) / 2) * spreadAng;
    const barrels = gun.barrels ?? 1;
    let vel = ammo.velocity * SHELL_SPEED_SCALE;
    let gravity = GRAVITY;
    let yaw = this.gunYaw + Math.cos(a) * dev;
    let pitch = this.gunPitch + Math.sin(a) * dev;
    if (gun.artillery) {
      // Pick the charge that lands the round on a point in the aim circle.
      gravity = GRAVITY * ARTY_GRAVITY_MUL;
      const dist = Math.hypot(c.aimX - p.x, c.aimZ - p.z);
      const r = dev * dist;
      const lx = c.aimX + Math.cos(a) * r;
      const lz = c.aimZ + Math.sin(a) * r;
      const dx = Math.min(gun.range, Math.hypot(lx - p.x, lz - p.z));
      const dy = g.terrain.heightAt(lx, lz) - p.y;
      yaw = Math.atan2(lx - p.x, -(lz - p.z));
      pitch = ARTY_ANGLE * DEG;
      vel = chargeFor(dx, dy, pitch, gravity);
    }
    for (let b = 0; b < barrels; b++) {
      const side = barrels > 1 ? (b - (barrels - 1) / 2) * 0.9 : 0;
      const m = this.muzzle();
      const by = yaw + (barrels > 1 ? (rng() - 0.5) * 0.004 : 0);
      g.shells.fire({
        owner: this,
        x: m.x + Math.cos(this.gunYaw) * side,
        y: m.y,
        z: m.z + Math.sin(this.gunYaw) * side,
        vx: Math.sin(by) * Math.cos(pitch) * vel,
        vy: Math.sin(pitch) * vel,
        vz: -Math.cos(by) * Math.cos(pitch) * vel,
        gravity,
        ammo,
        caliber: gun.caliber,
        range: gun.range,
        damageMul: buff?.damageMul ?? 1,
        penMul: (buff?.penMul ?? 1) * this.mods.penMul,
        ignoreAngle: buff?.ignoreAngle ?? false,
        airburst: buff?.airburst ?? 0,
        pierce: buff?.pierce ?? false,
        onHit: buff?.onHit,
        skill: buff?.skill ?? null,
        artillery: !!gun.artillery,
        aimDist: Math.hypot(c.aimX - p.x, c.aimZ - p.z),
      });
    }
    this.stats.shots++;
    g.events.emit('gunFired', { v: this, x: p.x, y: p.y, z: p.z, yaw: this.gunYaw, pitch: this.gunPitch, caliber: gun.caliber, artillery: !!gun.artillery });
    if (buff) {
      buff.left--;
      if (buff.left <= 0) this.shotBuff = null;
    }
    const clip = gun.clip;
    if (clip) {
      this.clip--;
      if (this.clip > 0) this.reload = clip.interval;
      else {
        this.clip = clip.size;
        this.reload = gun.reload * this.mods.reloadMul;
      }
    } else this.reload = gun.reload * this.mods.reloadMul;
    if (this.shotBuff?.instant) this.reload = Math.min(this.reload, 0.35);
    this.bloom = Math.min(7, this.bloom + BLOOM_SHOT);
  }

  /** Start a salvo on the trigger; rockets leave the rails one at a time. */
  private fireLauncher(dt: number): void {
    const l = this.spec.launcher;
    if (!l) return;
    const c = this.control;
    if (this.salvoLeft <= 0) {
      if (!c.fire || this.launcherReload > 0 || !this.canFire || this.spec.gun) return;
      if (!this.launcherBears()) return;
      this.salvoLeft = l.salvo;
      this.salvoTimer = 0;
      this.stats.shots++;
    }
    this.salvoTimer -= dt;
    while (this.salvoLeft > 0 && this.salvoTimer <= 0) {
      this.launchRocket();
      this.salvoLeft--;
      this.salvoTimer += l.interval;
    }
    if (this.salvoLeft <= 0) this.launcherReload = l.reload * this.mods.reloadMul * this.mods.missileReloadMul;
  }

  /** The crosshair is inside the launch rails' arc. */
  launcherBears(): boolean {
    const l = this.spec.launcher;
    if (!l) return false;
    if (l.arc >= 180) return true;
    const c = this.control;
    const want = Math.atan2(c.aimX - this.x, -(c.aimZ - this.z));
    return Math.abs(wrapAngle(want - this.heading)) <= l.arc * DEG;
  }

  /** One rocket off the rails toward the aim point (spread for unguided ones). */
  launchRocket(opts: { damageMul?: number; skill?: SkillSpec | null; fire?: boolean } = {}): void {
    const l = this.spec.launcher;
    if (!l) return;
    const g = this.game;
    const c = this.control;
    const p = this.pivot();
    const dist = Math.min(l.range, Math.hypot(c.aimX - p.x, c.aimZ - p.z));
    const a = g.rng() * Math.PI * 2;
    const r = l.guidance === 'none' ? (Math.sqrt(g.rng()) * l.spread * this.mods.dispersionMul * dist) / 100 : 0;
    const bearing = Math.atan2(c.aimX - p.x, -(c.aimZ - p.z));
    const tx = p.x + Math.sin(bearing) * dist + Math.cos(a) * r;
    const tz = p.z - Math.cos(bearing) * dist + Math.sin(a) * r;
    const target = l.guidance === 'top' ? g.lockTarget(this, c.targetId, c.aimX, c.aimZ) : null;
    g.missiles.launch({
      owner: this,
      x: p.x,
      y: p.y + 0.6,
      z: p.z,
      tx,
      ty: g.terrain.heightAt(tx, tz),
      tz,
      speed: l.speed,
      damage: l.damage * (opts.damageMul ?? 1),
      pen: l.pen,
      splash: l.splash,
      guidance: l.guidance,
      target,
      look: l.look ?? 'rocket',
      skill: opts.skill ?? null,
      fire: opts.fire ?? false,
    });
    g.events.emit('rocketLaunched', { v: this, x: p.x, y: p.y, z: p.z });
  }

  /** Support: heal the ally under the crosshair, if close enough and in sight. */
  private repairBeam(dt: number): void {
    this.beamTarget = null;
    const beam = this.spec.repairBeam;
    if (!beam || this.mods.disarmed || this.mods.stunned) return;
    const t = this.game.byId(this.control.targetId);
    if (!t || t === this || !t.alive || t.team !== this.team || t.hp >= t.maxHp) return;
    if (Math.hypot(t.x - this.x, t.z - this.z) > beam.range) return;
    if (!this.game.lineOfSight(this.x, this.y + 2.5, this.z, t.x, t.y + 1.5, t.z)) return;
    this.beamTarget = t;
    t.heal(beam.hps * dt, this);
  }
}

/** Flat-trajectory elevation to hit a point `dx` away and `dy` up, or null out of reach. */
export function lowArc(v: number, g: number, dx: number, dy: number): number | null {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return null;
  return Math.atan2(v2 - Math.sqrt(disc), g * dx);
}

/** Launch speed that carries a round fired at `pitch` to a point `dx` away and `dy` up. */
export function chargeFor(dx: number, dy: number, pitch: number, g: number): number {
  const c = Math.cos(pitch);
  const denom = 2 * c * c * (dx * Math.tan(pitch) - dy);
  if (denom <= 0) return Math.sqrt(g * Math.max(10, dx));
  return Math.sqrt((g * dx * dx) / denom);
}
