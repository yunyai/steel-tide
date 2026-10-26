import { canTrack } from '../core/Targeting';
import { KNOT, RANGE_SCALE, SPEED_SCALE } from '../config';
import type { Game } from '../core/Game';
import { DEG, approachAngle, bearingTo, dist2D, forwardX, forwardZ, truncGaussian } from '../core/math';
import type { ShellSpec, SkillSpec, SquadronSpec, SquadronType, Team, TorpedoSpec } from '../core/types';
import type { Ship } from '../ships/Ship';

export type SquadronState = 'outbound' | 'attack' | 'patrol' | 'return';

export interface Squadron {
  id: number;
  owner: Ship;
  team: Team;
  type: SquadronType;
  spec: SquadronSpec;
  planes: number;
  /** HP left on the lead plane. */
  planeHp: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: SquadronState;
  tx: number;
  tz: number;
  target: Ship | null;
  timer: number;
  alive: boolean;
  /** Ability squadrons do not consume or return to the hangar. */
  bonus: boolean;
  speedMul: number;
  /** Sim time until which AA cannot touch it (Updraft). */
  aaImmune: number;
  /** Divides the damage it takes from AA and fighters (Heavy Drones). */
  armour: number;
  damageMul: number;
  /** Bomb fire chance override. */
  fire: number | null;
  /** Called on each hull its payload hits. */
  onHit: ((target: Ship) => void) | null;
  /** Replaces the payload: the squadron does this over its target instead (Dragonfire Dive). */
  onDrop: ((sq: Squadron, target: Ship) => void) | null;
  /** Credited in damage popups. */
  skill: SkillSpec | null;
}

/** The owner's next squadron (of these types) flies special: Firebomb Load, Blood Price. */
export interface AirBuff {
  skill: SkillSpec;
  types: SquadronType[];
  damageMul?: number;
  armour?: number;
  fire?: number;
  onHit?: (target: Ship) => void;
  onDrop?: (sq: Squadron, target: Ship) => void;
}

const CRUISE_ALT = 300;
/** Torpedo bombers release inside this distance. */
const DROP_RANGE = 1300 * RANGE_SCALE;
const AERIAL_TORP: Omit<TorpedoSpec, 'damage'> = {
  name: 'Aerial torpedo',
  launchers: [],
  tubes: 1,
  reload: 0,
  speed: 40,
  range: 2200 * RANGE_SCALE,
  floodChance: 0.3,
  spread: 0,
  detect: 900 * RANGE_SCALE,
};

export class AircraftSystem {
  squadrons: Squadron[] = [];

  /** Ids count per battle, so every peer of a LAN battle numbers alike. */
  private nextId = 1;
  constructor(private game: Game) {}

  launch(owner: Ship, type: SquadronType, tx: number, tz: number, bonus = false): Squadron | null {
    const air = owner.spec.air;
    if (!air || !owner.air) return null;
    const spec = air[type];
    let planes = spec.planes;
    if (!bonus) {
      planes = Math.min(planes, owner.air.hangar[type]);
      if (planes <= 0) return null;
      owner.air.hangar[type] -= planes;
    }
    const d = dist2D(owner.pos.x, owner.pos.z, tx, tz);
    if (d > air.range) {
      const b = bearingTo(owner.pos.x, owner.pos.z, tx, tz);
      tx = owner.pos.x + Math.sin(b) * air.range;
      tz = owner.pos.z - Math.cos(b) * air.range;
    }
    const sq: Squadron = {
      id: this.nextId++,
      owner,
      team: owner.team,
      type,
      spec,
      planes,
      planeHp: spec.hp,
      x: owner.pos.x,
      y: 30,
      z: owner.pos.z,
      heading: owner.heading,
      state: 'outbound',
      tx,
      tz,
      target: null,
      timer: 0,
      alive: true,
      bonus,
      speedMul: 1,
      aaImmune: 0,
      armour: 1,
      damageMul: 1,
      fire: null,
      onHit: null,
      onDrop: null,
      skill: null,
    };
    const b = owner.airBuff;
    if (!bonus && b && b.types.includes(type)) {
      owner.airBuff = null;
      sq.skill = b.skill;
      sq.damageMul = b.damageMul ?? 1;
      sq.armour = b.armour ?? 1;
      sq.fire = b.fire ?? null;
      sq.onHit = b.onHit ?? null;
      sq.onDrop = b.onDrop ?? null;
    }
    this.squadrons.push(sq);
    this.game.events.emit('squadronLaunched', { ship: owner });
    return sq;
  }

  /** Apply damage to a squadron, shooting planes down. Returns planes lost. */
  damage(sq: Squadron, amount: number): number {
    let lost = 0;
    sq.planeHp -= amount / sq.armour;
    while (sq.planeHp <= 0 && sq.planes > 0) {
      sq.planes--;
      lost++;
      sq.planeHp += sq.spec.hp;
      this.game.events.emit('planeDown', { x: sq.x, y: sq.y, z: sq.z, team: sq.team });
    }
    if (sq.planes <= 0) sq.alive = false;
    return lost;
  }

  update(dt: number): void {
    for (const sq of this.squadrons) {
      if (!sq.alive) continue;
      if (sq.target && (!canTrack(sq.owner, sq.target) || sq.target.deep)) {
        sq.target = null;
        if (sq.state === 'attack') { sq.state = 'patrol'; sq.timer = 0; }
      }
      sq.timer += dt;
      this.steer(sq, dt);
      this.applyAA(sq, dt);
      if (!sq.alive) continue;
      switch (sq.state) {
        case 'outbound':
          if (dist2D(sq.x, sq.z, sq.tx, sq.tz) < 1500 * RANGE_SCALE) {
            if (sq.type === 'fighter') {
              sq.state = 'patrol';
              sq.timer = 0;
            } else {
              sq.target = this.findTarget(sq);
              sq.state = sq.target ? 'attack' : 'patrol';
              sq.timer = 0;
            }
          }
          break;
        case 'patrol':
          if (sq.type !== 'fighter' && !sq.target) {
            sq.target = this.findTarget(sq);
            if (sq.target) sq.state = 'attack';
          }
          if (sq.type === 'fighter') this.dogfight(sq, dt);
          if (sq.timer > (sq.type === 'fighter' ? 45 : 20)) sq.state = 'return';
          break;
        case 'attack':
          this.attack(sq);
          break;
        case 'return':
          if (!sq.owner.alive) {
            sq.alive = false;
          } else if (dist2D(sq.x, sq.z, sq.owner.pos.x, sq.owner.pos.z) < 250) {
            sq.alive = false;
            if (!sq.bonus && sq.owner.air) {
              const cap = sq.owner.spec.air![sq.type].hangar;
              sq.owner.air.hangar[sq.type] = Math.min(cap, sq.owner.air.hangar[sq.type] + sq.planes);
            }
          }
          break;
      }
    }
    if (this.squadrons.length > 16 && this.squadrons.some((s) => !s.alive)) this.squadrons = this.squadrons.filter((s) => s.alive);
  }

  private steer(sq: Squadron, dt: number): void {
    let gx = sq.tx;
    let gz = sq.tz;
    let alt = CRUISE_ALT;
    if (sq.state === 'return') {
      gx = sq.owner.pos.x;
      gz = sq.owner.pos.z;
    } else if (sq.state === 'patrol') {
      // Orbit the designated point.
      const a = sq.timer * 0.25 + sq.id;
      gx = sq.tx + Math.cos(a) * 450;
      gz = sq.tz + Math.sin(a) * 450;
    } else if (sq.state === 'attack' && sq.target) {
      const p = this.leadPoint(sq, sq.target);
      gx = p.x;
      gz = p.z;
      alt = sq.type === 'torpedo' ? 40 : 600;
    }
    sq.heading = approachAngle(sq.heading, bearingTo(sq.x, sq.z, gx, gz), 35 * DEG * dt);
    const v = sq.spec.speed * sq.speedMul;
    sq.x += forwardX(sq.heading) * v * dt;
    sq.z += forwardZ(sq.heading) * v * dt;
    sq.y += Math.sign(alt - sq.y) * Math.min(Math.abs(alt - sq.y), 40 * dt);
  }

  private leadPoint(sq: Squadron, t: Ship): { x: number; z: number } {
    const d = dist2D(sq.x, sq.z, t.pos.x, t.pos.z);
    const time = sq.type === 'torpedo' ? Math.max(0, d - DROP_RANGE) / sq.spec.speed + DROP_RANGE / (AERIAL_TORP.speed * KNOT * SPEED_SCALE) : d / sq.spec.speed;
    return {
      x: t.pos.x + forwardX(t.heading) * t.speed * time * 0.9,
      z: t.pos.z + forwardZ(t.heading) * t.speed * time * 0.9,
    };
  }

  private findTarget(sq: Squadron): Ship | null {
    let best: Ship | null = null;
    let bd = 3000 * RANGE_SCALE;
    for (const s of this.game.ships) {
      if (!canTrack(sq.owner, s) || s.deep) continue;
      const d = dist2D(sq.tx, sq.tz, s.pos.x, s.pos.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private attack(sq: Squadron): void {
    const g = this.game;
    const t = sq.target;
    if (!t || !canTrack(sq.owner, t) || t.deep) {
      sq.target = null;
      sq.state = 'patrol';
      return;
    }
    const lead = this.leadPoint(sq, t);
    const d = dist2D(sq.x, sq.z, t.pos.x, t.pos.z);
    if (sq.type === 'torpedo') {
      const facing = Math.abs(((bearingTo(sq.x, sq.z, lead.x, lead.z) - sq.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d < DROP_RANGE && facing < 12 * DEG && sq.y < 80) {
        const spec: TorpedoSpec = { ...AERIAL_TORP, damage: sq.spec.damage };
        for (let i = 0; i < sq.planes; i++) {
          const off = (i - (sq.planes - 1) / 2) * 40;
          const px = sq.x + Math.cos(sq.heading) * off;
          const pz = sq.z + Math.sin(sq.heading) * off;
          const tp = g.torps.launch(sq.owner, px, pz, sq.heading + (g.rng() - 0.5) * 2 * DEG, spec);
          tp.damage *= sq.damageMul;
          tp.skill = sq.skill;
          tp.onHit = sq.onHit;
        }
        g.events.emit('torpLaunched', { ship: sq.owner, x: sq.x, z: sq.z, count: sq.planes });
        sq.state = 'return';
      }
    } else if (sq.type === 'dive') {
      if (d < 260) {
        sq.state = 'return';
        if (sq.onDrop) {
          sq.onDrop(sq, t);
          return;
        }
        const bomb: ShellSpec = { caliber: 450, mass: 250, velocity: 200, damage: sq.spec.damage, pen: 60, fireChance: sq.fire ?? 0.4 };
        for (let i = 0; i < sq.planes; i++) {
          const ex = t.pos.x + truncGaussian(g.rng) * 45;
          const ez = t.pos.z + truncGaussian(g.rng) * 30;
          const shell = g.shells.dropBomb(sq.owner, bomb, ex, ez, 220 + i * 25, sq.damageMul);
          const hit = sq.onHit;
          if (hit) shell.onHit = (target) => hit(target);
        }
      }
    }
  }

  private dogfight(sq: Squadron, dt: number): void {
    for (const e of this.squadrons) {
      if (!e.alive || e.team === sq.team) continue;
      if (dist2D(sq.x, sq.z, e.x, e.z) > 3000 * RANGE_SCALE) continue;
      // Fighters chase and grind down enemy squadrons; bombers shoot back weakly.
      sq.tx = e.x;
      sq.tz = e.z;
      this.damage(e, sq.spec.damage * sq.planes * dt);
      this.damage(sq, 20 * e.planes * dt);
      return;
    }
  }

  private applyAA(sq: Squadron, dt: number): void {
    if (sq.aaImmune > this.game.time) return;
    for (const s of this.game.ships) {
      if (!s.alive || s.team === sq.team || s.submerged) continue;
      const d = dist2D(sq.x, sq.z, s.pos.x, s.pos.z);
      const range = s.spec.aa.range * s.mods.aaRangeMul;
      if (d > range) continue;
      // Inner bubble is deadlier.
      const mul = d < range * 0.5 ? 1.4 : 1;
      this.damage(sq, s.spec.aa.dps * s.mods.aaMul * mul * dt);
      if (!sq.alive) return;
    }
  }
}
