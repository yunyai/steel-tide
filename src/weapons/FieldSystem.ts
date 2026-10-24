import type { Game } from '../core/Game';
import { dist2D, segmentsCross } from '../core/math';
import type { SkillSpec, Team } from '../core/types';
import type { Mods, Ship } from '../ships/Ship';

// Circles of sea that do something to whoever is inside while they last: groves, kelp, nanite
// clouds, time warps, lightning cages. And tripwires: lines that go off when an enemy hull
// crosses them. Effects are refreshed every tick, so they end a moment after a ship leaves.

/** How a field is drawn. */
export type FieldLook = 'circle' | 'grove' | 'kelp' | 'mist' | 'swarm' | 'frost' | 'time' | 'storm' | 'void' | 'nanite' | 'hex' | 'fire';

export interface Field {
  id: number;
  owner: Ship;
  team: Team;
  x: number;
  z: number;
  r: number;
  /** Seconds since it opened, and seconds it lasts. */
  age: number;
  life: number;
  /** Rides along with this ship. */
  follow: Ship | null;
  skill: SkillSpec | null;
  look: FieldLook;
  color: number;
  // On enemies inside:
  /** Damage per second, paid in quarter-second chunks. */
  dps: number;
  /** Speed multiplier (1 = none). */
  slow: number;
  /** Dispersion multiplier of their guns (1 = none). */
  scatter: number;
  silence: boolean;
  healBlock: boolean;
  root: boolean;
  /** Pull toward the centre (m/s). */
  pull: number;
  /** Hulls inside cannot sail out. */
  cage: boolean;
  /** Their shells, torpedoes and missiles inside move at this fraction of their speed (1 = none). */
  timeScale: number;
  // On allies inside:
  /** Fraction of max HP repaired per second. */
  heal: number;
  undying: boolean;
  /** Extra per-tick work (every 0.25 s) on each ship inside, of either side. */
  onTick?: (ship: Ship, f: Field) => void;
  /** Ships inside at the last tick (for the cage). */
  inside: Set<Ship>;
}

export interface FieldOptions extends Partial<Omit<Field, 'id' | 'owner' | 'team' | 'age' | 'inside'>> {
  x: number;
  z: number;
  r: number;
  life: number;
}

/** A line that goes off on each enemy hull that crosses it (Sonobuoy Barrier, Static Dash). */
export interface Tripwire {
  id: number;
  owner: Ship;
  team: Team;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  age: number;
  life: number;
  color: number;
  skill: SkillSpec | null;
  /** Each ship trips it once. */
  tripped: Set<Ship>;
  onCross: (ship: Ship, w: Tripwire) => void;
}

const TICK = 0.25;

export class FieldSystem {
  fields: Field[] = [];
  wires: Tripwire[] = [];
  private nextId = 1;
  private tick = 0;

  constructor(private game: Game) {}

  add(owner: Ship, o: FieldOptions): Field {
    const f: Field = {
      id: this.nextId++,
      owner,
      team: owner.team,
      age: 0,
      follow: null,
      skill: null,
      look: 'circle',
      color: o.skill?.accent ?? 0xffffff,
      dps: 0,
      slow: 1,
      scatter: 1,
      silence: false,
      healBlock: false,
      root: false,
      pull: 0,
      cage: false,
      timeScale: 1,
      heal: 0,
      undying: false,
      inside: new Set(),
      ...o,
    };
    this.fields.push(f);
    return f;
  }

  addWire(owner: Ship, x0: number, z0: number, x1: number, z1: number, life: number, onCross: Tripwire['onCross'], skill: SkillSpec | null = null): Tripwire {
    const w: Tripwire = {
      id: this.nextId++,
      owner,
      team: owner.team,
      x0,
      z0,
      x1,
      z1,
      age: 0,
      life,
      color: skill?.accent ?? 0xffffff,
      skill,
      tripped: new Set(),
      onCross,
    };
    this.wires.push(w);
    return w;
  }

  /** Projectile speed multiplier at (x, z) for rounds of `team` (time warps of the other side). */
  timeScale(team: Team, x: number, z: number): number {
    let k = 1;
    for (const f of this.fields) {
      if (f.timeScale >= 1 || f.team === team || f.age >= f.life) continue;
      if (dist2D(x, z, f.x, f.z) < f.r) k *= f.timeScale;
    }
    return k;
  }

  update(dt: number): void {
    const g = this.game;
    this.tick -= dt;
    const tick = this.tick <= 0;
    if (tick) this.tick += TICK;
    for (const f of this.fields) {
      f.age += dt;
      if (f.age >= f.life) continue;
      if (f.follow) {
        if (!f.follow.alive) f.life = f.age;
        f.x = f.follow.pos.x;
        f.z = f.follow.pos.z;
      }
      for (const s of g.ships) {
        if (!s.alive || s.mods.banished) continue;
        const d = dist2D(s.pos.x, s.pos.z, f.x, f.z);
        const enemy = s.team !== f.team;
        if (enemy && f.cage && f.inside.has(s) && d > f.r - s.spec.length * 0.2) {
          // The cage holds: walk the hull back inside and kill its way outward.
          const k = (f.r - s.spec.length * 0.2) / d;
          s.pos.x = f.x + (s.pos.x - f.x) * k;
          s.pos.z = f.z + (s.pos.z - f.z) * k;
          s.speed *= 0.9;
          continue;
        }
        if (d > f.r) continue;
        if (enemy && f.pull > 0 && d > 60) s.shove(((f.x - s.pos.x) / d) * f.pull * dt * 1.5, ((f.z - s.pos.z) / d) * f.pull * dt * 1.5);
        if (tick) this.apply(f, s, enemy);
      }
      if (tick && f.cage) {
        f.inside.clear();
        for (const s of g.ships) if (s.alive && s.team !== f.team && dist2D(s.pos.x, s.pos.z, f.x, f.z) <= f.r) f.inside.add(s);
      }
    }
    for (const w of this.wires) {
      w.age += dt;
      if (w.age >= w.life) continue;
      for (const s of g.ships) {
        if (!s.alive || s.team === w.team || w.tripped.has(s) || s.mods.banished) continue;
        if (segmentsCross(s.prevPos.x, s.prevPos.z, s.pos.x, s.pos.z, w.x0, w.z0, w.x1, w.z1) < 0) continue;
        w.tripped.add(s);
        w.onCross(s, w);
      }
    }
    // Fields linger a moment past their life so the render can fade them.
    if (this.fields.some((f) => f.age > f.life + 1)) this.fields = this.fields.filter((f) => f.age <= f.life + 1);
    if (this.wires.some((w) => w.age > w.life + 1)) this.wires = this.wires.filter((w) => w.age <= w.life + 1);
  }

  private apply(f: Field, s: Ship, enemy: boolean): void {
    const id = `field${f.id}`;
    const hold = TICK + 0.1;
    if (enemy) {
      if (f.dps > 0) {
        const o = f.owner;
        const ult = f.skill?.ult ? o.mods.ultDamageMul : 1;
        s.takeDamage(f.dps * TICK * o.mods.damageMul * ult, o, f.skill);
      }
      const { slow, scatter, silence, healBlock, root } = f;
      if (slow < 1 || scatter > 1 || silence || healBlock || root) {
        s.addEffect({
          id: `debuff:${id}`,
          time: hold,
          apply(m: Mods) {
            m.speedMul *= slow;
            m.dispersionMul *= scatter;
            if (silence) m.silenced = true;
            if (healBlock) m.healBlock = true;
            if (root) m.rooted = true;
          },
        });
      }
    } else {
      if (f.heal > 0) s.heal(s.maxHp * f.heal * TICK);
      if (f.undying) {
        s.addEffect({
          id,
          time: hold,
          apply(m: Mods) {
            m.undying = true;
          },
        });
      }
    }
    f.onTick?.(s, f);
  }
}
