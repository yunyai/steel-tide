import type { SkillSpec } from '../../../core/types';
import type { GroundGame } from '../GroundGame';
import type { GroundMods, Vehicle } from '../Vehicle';

// Lasting zones on the ground: fire carpets, healing workshops, slowing frost, gravity wells. Each
// step a field works on every hull inside it, enemies and allies apart.

export interface FieldInit {
  owner: Vehicle;
  x: number;
  z: number;
  r: number;
  life: number;
  color: number;
  skill: SkillSpec | null;
  /** Rides along with this vehicle. */
  follow?: Vehicle;
  /** Damage a second to enemies inside. */
  enemyDps?: number;
  /** Share of max HP a second restored to allies inside. */
  allyHeal?: number;
  /** Allies inside have their crits cleared. */
  clearCrits?: boolean;
  /** Enemy speed multiplier inside. */
  slow?: number;
  /** Pull toward the centre (m/s). */
  pull?: number;
  /** Extra effect on enemies (and allies) inside, re-applied each step. */
  enemyMods?: (m: GroundMods) => void;
  allyMods?: (m: GroundMods) => void;
  /** Drawn as flames. */
  fire?: boolean;
}

export interface Field extends FieldInit {
  id: number;
  age: number;
}

export class Fields {
  list: Field[] = [];
  private nextId = 1;

  constructor(private g: GroundGame) {}

  add(init: FieldInit): Field {
    const f: Field = { ...init, id: this.nextId++, age: 0 };
    this.list.push(f);
    return f;
  }

  update(dt: number): void {
    const g = this.g;
    for (const f of this.list) {
      f.age += dt;
      if (f.follow) {
        if (!f.follow.alive) f.age = f.life;
        f.x = f.follow.x;
        f.z = f.follow.z;
      }
      if (f.age >= f.life) continue;
      for (const v of g.vehicles) {
        if (!v.alive) continue;
        const d = Math.hypot(v.x - f.x, v.z - f.z);
        if (d > f.r) continue;
        if (v.team !== f.owner.team) {
          if (f.enemyDps) v.damage(f.enemyDps * dt, f.owner, f.skill);
          if (f.slow) {
            const slow = f.slow;
            v.addEffect(`field-slow`, 0.15, (m) => (m.speedMul *= slow));
          }
          if (f.enemyMods) v.addEffect(`field-${f.id}`, 0.15, f.enemyMods);
          if (f.pull && d > 2) v.knock(((f.x - v.x) / d) * f.pull * dt * 4, ((f.z - v.z) / d) * f.pull * dt * 4);
        } else {
          if (f.allyHeal) v.heal(v.maxHp * f.allyHeal * dt, f.owner);
          if (f.clearCrits) v.crits.tracks = v.crits.fire = 0;
          if (f.allyMods) v.addEffect(`field-${f.id}`, 0.15, f.allyMods);
        }
      }
    }
    if (this.list.some((f) => f.age >= f.life)) this.list = this.list.filter((f) => f.age < f.life);
  }
}
