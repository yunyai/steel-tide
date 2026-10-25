import type { SkillSpec } from '../../../core/types';
import { type ArmorHit, hitVehicle, penAtRange, penetrate } from '../armor';
import { AMMO_RACK_CHANCE, DAMAGE_ROLL, FIRE_CRIT_CHANCE, HE_NONPEN, PEN_FALLOFF, SHELL_OVERRANGE, TRACK_CRIT_CHANCE } from '../config';
import type { GroundGame } from '../GroundGame';
import type { Prop } from '../props';
import type { AmmoSpec } from '../types';
import type { Vehicle } from '../Vehicle';

// Gun rounds in flight. Each step a round checks the stretch it flew against hulls (armour boxes),
// standing props and the ground, and the nearest wins.

export interface ShellInit {
  owner: Vehicle;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  ammo: AmmoSpec;
  caliber: number;
  range: number;
  damageMul: number;
  penMul: number;
  ignoreAngle: boolean;
  /** Burst near an enemy or at the aim distance, with this blast radius (0: no). */
  airburst: number;
  pierce: boolean;
  onHit?: (target: Vehicle) => void;
  skill: SkillSpec | null;
  artillery: boolean;
  /** Ground distance to the aim point when fired (airburst fuzes). */
  aimDist: number;
}

export interface Shell extends ShellInit {
  id: number;
  px: number;
  py: number;
  pz: number;
  /** Ground distance flown. */
  dist: number;
  alive: boolean;
  /** Hulls and props already passed through (piercing rounds). */
  passed: number[];
  passedProps: number[];
  /** Hulls whose active protection already had its go. */
  screened: number[];
}

/** Share of a round's damage a prop takes, by ammo. */
const PROP_SHARE = { AP: 0.35, APDS: 0.25, HEAT: 0.6, HE: 1 };

export class Shells {
  list: Shell[] = [];
  private nextId = 1;

  constructor(private g: GroundGame) {}

  fire(init: ShellInit): Shell {
    const s: Shell = { ...init, id: this.nextId++, px: init.x, py: init.y, pz: init.z, dist: 0, alive: true, passed: [], passedProps: [], screened: [] };
    this.list.push(s);
    return s;
  }

  update(dt: number): void {
    const g = this.g;
    for (const s of this.list) {
      if (!s.alive) continue;
      s.px = s.x;
      s.py = s.y;
      s.pz = s.z;
      s.vy -= s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.dist += Math.hypot(s.x - s.px, s.z - s.pz);
      if (g.screen(s.owner, s.x, s.y, s.z, s.screened, s.artillery ? 0.5 : 0.7)) {
        s.alive = false;
        continue;
      }
      if (s.airburst > 0 && this.fuze(s)) continue;
      this.trace(s);
      if (s.alive && (s.y < -60 || (!s.artillery && s.dist > s.range * SHELL_OVERRANGE) || Math.abs(s.x) > g.terrain.half + 200 || Math.abs(s.z) > g.terrain.half + 200)) {
        s.alive = false;
      }
    }
    if (this.list.some((s) => !s.alive)) this.list = this.list.filter((s) => s.alive);
  }

  /** Airburst: go off beside an enemy or once the aim distance is flown. */
  private fuze(s: Shell): boolean {
    const g = this.g;
    const r = s.airburst * 0.6;
    let near = s.dist >= s.aimDist;
    if (!near) {
      for (const v of g.vehicles) {
        if (!v.alive || v.team === s.owner.team) continue;
        if (Math.hypot(v.x - s.x, v.y + 1.5 - s.y, v.z - s.z) < r + v.spec.size.width / 2) {
          near = true;
          break;
        }
      }
    }
    if (!near) return false;
    s.alive = false;
    g.events.emit('impact', { x: s.x, y: s.y, z: s.z, caliber: s.caliber, surface: 'air', he: true });
    g.blast(s.owner, s.x, s.y, s.z, s.airburst, s.ammo.damage * s.damageMul * 0.85, { skill: s.skill, props: 0.3 });
    return true;
  }

  /** What the round met along the stretch it flew this step, nearest first. */
  private trace(s: Shell): void {
    const g = this.g;
    let bestT = Infinity;
    let bestV: Vehicle | null = null;
    let bestHit: ArmorHit | null = null;
    const sx = s.x - s.px;
    const sy = s.y - s.py;
    const sz = s.z - s.pz;
    const len = Math.hypot(sx, sy, sz);
    for (const v of g.vehicles) {
      if (!v.alive || v === s.owner || v.team === s.owner.team || v.mods.untargetable || s.passed.includes(v.id)) continue;
      const reach = v.spec.size.length * 0.75 + 3;
      // Distance from the hull's centre to the segment, as a cheap first test.
      const cx = v.x - s.px;
      const cy = v.y + 1.5 - s.py;
      const cz = v.z - s.pz;
      const t = Math.max(0, Math.min(1, (cx * sx + cy * sy + cz * sz) / Math.max(1e-6, len * len)));
      if (Math.hypot(cx - sx * t, cy - sy * t, cz - sz * t) > reach) continue;
      const hit = hitVehicle(v.spec, v.pose, s.px, s.py, s.pz, s.x, s.y, s.z);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestV = v;
        bestHit = hit;
      }
    }
    const ph = g.props.segment(s.px, s.py, s.pz, s.x, s.y, s.z, (p) => p.team === s.owner.team || s.passedProps.includes(p.id));
    const tt = g.terrain.segmentHit(s.px, s.py, s.pz, s.x, s.y, s.z);
    const groundT = tt < 0 ? Infinity : tt;
    const propT = ph ? ph.t : Infinity;
    if (bestV && bestHit && bestT <= propT && bestT <= groundT) {
      const x = s.px + sx * bestT;
      const y = s.py + sy * bestT;
      const z = s.pz + sz * bestT;
      this.hitHull(s, bestV, bestHit, x, y, z);
      return;
    }
    if (ph && propT <= groundT) {
      const x = s.px + sx * propT;
      const y = s.py + sy * propT;
      const z = s.pz + sz * propT;
      this.hitProp(s, ph.prop, x, y, z);
      return;
    }
    if (groundT < Infinity) {
      const x = s.px + sx * groundT;
      const z = s.pz + sz * groundT;
      const wet = g.terrain.heightAt(x, z) < g.terrain.waterLevel;
      const y = g.terrain.surfaceAt(x, z);
      s.alive = false;
      const he = s.ammo.kind === 'HE';
      g.events.emit('impact', { x, y, z, caliber: s.caliber, surface: wet ? 'water' : 'ground', he });
      if (he && s.ammo.splash) g.blast(s.owner, x, y, z, s.ammo.splash, s.ammo.damage * s.damageMul * (s.artillery ? 0.55 : 0.3), { skill: s.skill, props: 0.6 });
    }
  }

  private hitHull(s: Shell, v: Vehicle, hit: ArmorHit, x: number, y: number, z: number): void {
    const g = this.g;
    const a = s.ammo;
    const owner = s.owner;
    const pen = penAtRange(a.kind, a.pen * s.penMul, s.dist, s.range, s.artillery ? 0 : PEN_FALLOFF);
    const res = penetrate(hit, a.kind, s.caliber, pen, s.ignoreAngle || v.mods.exposed);
    owner.stats.hits++;
    // A bounce still counts as being in a fight.
    v.lastHit = g.time;
    let damage = 0;
    if (res.outcome === 'pen') {
      const roll = 1 + (g.rng() * 2 - 1) * DAMAGE_ROLL;
      damage = v.damage(a.damage * s.damageMul * roll, owner, s.skill);
      owner.stats.pens++;
      this.crits(v, hit, owner);
      s.onHit?.(v);
    } else if (res.outcome === 'block' && a.kind === 'HE') {
      // The blast scours the outside of the plate.
      const k = Math.max(0.1, 1 - hit.thickness / Math.max(1, pen * 2));
      damage = v.damage(a.damage * s.damageMul * HE_NONPEN * k, owner, s.skill);
      s.onHit?.(v);
    } else {
      owner.stats.bounced++;
      v.stats.blocked += a.damage * s.damageMul;
    }
    g.events.emit('shellHit', { attacker: owner, target: v, outcome: res.outcome, face: hit.face, damage, x, y, z, caliber: s.caliber, ammo: a.kind });
    if (a.kind === 'HE' && a.splash) g.blast(owner, x, y, z, a.splash, a.damage * s.damageMul * 0.3, { skill: s.skill, skip: v, props: 0.5 });
    if (s.pierce && res.outcome === 'pen') {
      s.passed.push(v.id);
      return;
    }
    s.alive = false;
  }

  /** Penetrations break things: tracks low on the hull, the engine from behind, the ammo from the side. */
  private crits(v: Vehicle, hit: ArmorHit, by: Vehicle): void {
    const g = this.g;
    const L = v.spec.size.length;
    if (hit.part === 'hull' && hit.face !== 'roof' && hit.ly < v.spec.size.height * 0.5 && g.rng() < TRACK_CRIT_CHANCE) v.crit('tracks', by);
    if (hit.part === 'hull' && (hit.face === 'rear' || (hit.face === 'roof' && hit.lf < -L * 0.15)) && g.rng() < FIRE_CRIT_CHANCE) v.crit('fire', by);
    if ((hit.face === 'side' || (hit.part === 'turret' && hit.face === 'rear')) && g.rng() < AMMO_RACK_CHANCE) v.crit('ammo', by);
  }

  private hitProp(s: Shell, p: Prop, x: number, y: number, z: number): void {
    const g = this.g;
    const a = s.ammo;
    const dmg = a.damage * s.damageMul * PROP_SHARE[a.kind] * (s.pierce ? 4 : 1) * (s.caliber > 200 ? 2 : 1);
    g.damageProp(p, dmg, s.owner);
    g.events.emit('impact', { x, y, z, caliber: s.caliber, surface: 'prop', he: a.kind === 'HE' });
    if (a.kind === 'HE' && a.splash) g.blast(s.owner, x, y, z, a.splash, a.damage * s.damageMul * 0.3, { skill: s.skill, props: 0.4 });
    if (s.pierce) s.passedProps.push(p.id);
    else s.alive = false;
  }
}
