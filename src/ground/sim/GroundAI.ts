import { clamp, truncGaussian, wrapAngle } from '../../core/math';
import { SHELL_SPEED_SCALE } from './config';
import type { GroundGame } from './GroundGame';
import type { Waypoint } from './navgrid';
import { weaponRange } from './skills/kit';
import { GROUND_SKILLS } from './skills/registry';
import type { VehicleClass } from './types';
import type { Vehicle } from './Vehicle';

// Bots: path along the nav grid toward a goal picked by class (caps, a firing lane, the hurt
// ally), pick a target, lead it and shoot when the aim settles. Heavies angle their armour,
// destroyers and artillery stop to shoot, lights keep moving.

/** Distance each class likes to fight from. */
const STANDOFF: Record<VehicleClass, number> = { HT: 160, MT: 260, LT: 320, TD: 480, SPG: 950, MSL: 560, SUP: 220, TT: 120 };
/** Classes that stop to shoot. */
const STATIONARY: Partial<Record<VehicleClass, boolean>> = { TD: true, SPG: true, MSL: true };
/** Classes that fight from behind the line. */
const REAR: Partial<Record<VehicleClass, boolean>> = { SPG: true, MSL: true, SUP: true };

export class GroundAI {
  /** Wingmen stay near their owner. */
  leader: Vehicle | null = null;
  target: Vehicle | null = null;
  private thinkIn = 0;
  private path: Waypoint[] | null = null;
  private pathIdx = 0;
  private goalX = 0;
  private goalZ = 0;
  private repathIn = 0;
  private stuckFor = 0;
  private reverseFor = 0;
  private reverseSteer = 1;
  /** Aim error, re-rolled on each decision. */
  private errX = 0;
  private errZ = 0;
  /** A flank side, fixed per bot (lights and mediums swing wide). */
  private flank: number;
  /** A place with a clear shot at the target, kept while it stays good. */
  private spot: { x: number; z: number; t: Vehicle } | null = null;

  constructor(
    readonly v: Vehicle,
    readonly g: GroundGame,
  ) {
    this.thinkIn = g.rng() * 0.5;
    this.flank = g.rng() < 0.5 ? -1 : 1;
    this.goalX = v.x;
    this.goalZ = v.z;
  }

  update(dt: number): void {
    const v = this.v;
    const g = this.g;
    const c = v.control;
    if (!v.alive) return;
    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = g.difficulty.think * (0.8 + g.rng() * 0.4);
      this.think();
    }
    if (this.target && !this.target.alive) this.target = null;
    this.drive(dt);
    this.aim();
    if (c.skill < 0 && c.consumable < 0) this.consumables();
  }

  private think(): void {
    const v = this.v;
    const g = this.g;
    this.target = this.pickTarget();
    const d = g.difficulty;
    const dist = this.target ? Math.hypot(this.target.x - v.x, this.target.z - v.z) : 0;
    this.errX = truncGaussian(g.rng, 2) * d.aimError * dist * 0.9;
    this.errZ = truncGaussian(g.rng, 2) * d.aimError * dist * 0.9;
    this.pickGoal();
    // Skills.
    for (let i = 0; i < v.skills.length; i++) {
      const st = v.skills[i];
      if (!v.skillReady(i)) continue;
      const impl = GROUND_SKILLS[st.spec.id];
      if (!impl) continue;
      // Aim skills at the current target.
      if (this.target) this.aimAt(this.target, false);
      if (impl.aiShouldUse(v, g, this.target, st) && g.rng() < d.skillUse + (st.spec.ult ? 0.3 : 0)) {
        v.control.skill = i;
        break;
      }
    }
  }

  private pickTarget(): Vehicle | null {
    const v = this.v;
    const g = this.g;
    const range = Math.max(v.spec.gun?.range ?? 0, v.spec.launcher?.range ?? 0, 400);
    const arty = !!v.spec.gun?.artillery || v.spec.launcher?.guidance === 'none';
    let best: Vehicle | null = null;
    let bestScore = Infinity;
    for (const e of g.vehicles) {
      if (!e.alive || e.team === v.team || e.mods.untargetable) continue;
      const d = Math.hypot(e.x - v.x, e.z - v.z);
      if (d > range * 1.15) continue;
      const sight = arty || g.lineOfSight(v.x, v.y + 2.5, v.z, e.x, e.y + 1.5, e.z);
      // Close, hurt and in sight first; keep the current target unless a much better one shows.
      let score = d * (sight ? 1 : 3) * (0.5 + e.hp / e.maxHp);
      if (e === this.target) score *= 0.7;
      if (e.titan) score *= 1.3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) {
      // Nothing in reach: head for the nearest.
      let nd = Infinity;
      for (const e of g.vehicles) {
        if (!e.alive || e.team === v.team || e.mods.untargetable) continue;
        const d = Math.hypot(e.x - v.x, e.z - v.z);
        if (d < nd) {
          nd = d;
          best = e;
        }
      }
    }
    return best;
  }

  /** Where to drive: a cap, a firing position, the hurt ally, the leader, or home to heal. */
  private pickGoal(): void {
    const v = this.v;
    const g = this.g;
    const cls = v.spec.cls;
    const home = v.team === 0 ? -1 : 1;
    let gx = v.x;
    let gz = v.z;
    const t = this.target;
    const standoff = STANDOFF[cls];
    const hurt = v.hp < v.maxHp * 0.25 && !v.consumables[0]?.charges && !v.titan;
    if (this.leader?.alive) {
      const f = this.leader.pose.f;
      gx = this.leader.x - f[0] * 20 + -f[2] * this.flank * 14;
      gz = this.leader.z - f[2] * 20 + f[0] * this.flank * 14;
    } else if (hurt) {
      gx = home * g.terrain.half * 0.7;
      gz = v.z;
    } else if (cls === 'SUP') {
      const ally = this.hurtAlly(350) ?? this.frontAlly();
      if (ally) {
        gx = ally.x - ally.pose.f[0] * 25;
        gz = ally.z - ally.pose.f[2] * 25;
      }
    } else if (g.caps.length && cls !== 'SPG' && cls !== 'MSL' && cls !== 'TD') {
      // Domination: the nearest cap that is not ours (lights favour their flank).
      let best = Infinity;
      for (const cap of g.caps) {
        if (cap.owner === v.team && !cap.contested) continue;
        const d = Math.hypot(cap.x - v.x, cap.z - v.z) + (cls === 'LT' ? Math.sign(cap.z) * this.flank * -200 : 0);
        if (d < best) {
          best = d;
          gx = cap.x + this.flank * 20;
          gz = cap.z;
        }
      }
      if (best === Infinity && t) [gx, gz] = this.firingSpot(t, standoff);
    } else if (t) {
      [gx, gz] = cls === 'SPG' ? this.standoffPoint(t, standoff) : this.firingSpot(t, standoff);
    } else if (g.caps.length) {
      gx = 0;
      gz = g.caps[1]?.z ?? 0;
    }
    if (Math.hypot(gx - this.goalX, gz - this.goalZ) > 30 || !this.path) this.repathIn = 0;
    this.goalX = gx;
    this.goalZ = gz;
  }

  /** A point `range` back from the target along the line to us, nudged to our flank. */
  private standoffPoint(t: Vehicle, range: number): [number, number] {
    const v = this.v;
    const dx = v.x - t.x;
    const dz = v.z - t.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < range * 1.15 && d > range * 0.6) return [v.x, v.z];
    const a = Math.atan2(dx, dz) + this.flank * 0.25;
    return [t.x + Math.sin(a) * range, t.z + Math.cos(a) * range];
  }

  /** Somewhere about `range` from the target with a clear line to it: hold here if this is one. */
  private firingSpot(t: Vehicle, range: number): [number, number] {
    const v = this.v;
    const g = this.g;
    const eye = (x: number, z: number) => g.lineOfSight(x, g.terrain.heightAt(x, z) + 2.5, z, t.x, t.y + 1.5, t.z);
    const d = Math.hypot(v.x - t.x, v.z - t.z);
    if (d < range * 1.15 && d > range * 0.3 && eye(v.x, v.z)) {
      this.spot = null;
      return [v.x, v.z];
    }
    const s = this.spot;
    if (s && s.t === t && Math.hypot(s.x - t.x, s.z - t.z) < range * 1.2 && eye(s.x, s.z)) return [s.x, s.z];
    // Sample a fan of places on our side of the target, nearest to us first.
    const base = Math.atan2(v.x - t.x, v.z - t.z);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 10; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.3 * this.flank;
      const r = range * (k < 6 ? 0.85 : 0.5);
      const x = t.x + Math.sin(a) * r;
      const z = t.z + Math.cos(a) * r;
      if (!g.nav.openAt(x, z) || !eye(x, z)) continue;
      const dd = Math.hypot(x - v.x, z - v.z);
      if (dd < bestD) {
        bestD = dd;
        best = [x, z];
      }
    }
    if (best) {
      this.spot = { x: best[0], z: best[1], t };
      return best;
    }
    // Nothing in the clear: close in along the line.
    this.spot = null;
    return this.standoffPoint(t, range * 0.5);
  }

  /** The ally most worth a repair within `range`: hurt the worst, nearest first. */
  private hurtAlly(range: number): Vehicle | null {
    const v = this.v;
    let best: Vehicle | null = null;
    let bestScore = Infinity;
    for (const a of this.g.vehicles) {
      if (!a.alive || a === v || a.team !== v.team) continue;
      const d = Math.hypot(a.x - v.x, a.z - v.z);
      const f = a.hp / a.maxHp;
      if (d > range || f >= 0.92) continue;
      const score = f + (d / range) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** The nearest ally that fights up front (not artillery, rockets or another support). */
  private frontAlly(): Vehicle | null {
    const v = this.v;
    let best: Vehicle | null = null;
    let nd = Infinity;
    for (const a of this.g.vehicles) {
      if (!a.alive || a === v || a.team !== v.team || a.isSummon || REAR[a.spec.cls]) continue;
      const d = Math.hypot(a.x - v.x, a.z - v.z);
      if (d < nd) {
        nd = d;
        best = a;
      }
    }
    return best;
  }

  private drive(dt: number): void {
    const v = this.v;
    const g = this.g;
    const c = v.control;
    const cls = v.spec.cls;
    // Backing out of a jam.
    if (this.reverseFor > 0) {
      this.reverseFor -= dt;
      c.drive = -1;
      c.steer = this.reverseSteer;
      if (this.reverseFor <= 0) this.repathIn = 0;
      return;
    }
    this.repathIn -= dt;
    if (this.repathIn <= 0) {
      this.repathIn = 4 + g.rng() * 2;
      this.path = g.nav.path(v.x, v.z, this.goalX, this.goalZ, v.titan);
      this.pathIdx = 0;
    }
    const t = this.target;
    const dist = t ? Math.hypot(t.x - v.x, t.z - v.z) : Infinity;
    // Snipers and artillery stop for anything they can hit; the rest close to their standoff first.
    const reach = STATIONARY[cls] ? weaponRange(v) * 0.95 : STANDOFF[cls] * 1.2;
    const sight = !!t && dist < weaponRange(v) && (cls === 'SPG' || g.lineOfSight(v.x, v.y + 2.5, v.z, t.x, t.y + 1.5, t.z));
    const engaged = sight && dist < reach;
    const atGoal = Math.hypot(this.goalX - v.x, this.goalZ - v.z) < 14;
    const stop = (engaged && (STATIONARY[cls] || cls === 'HT' || v.titan)) || atGoal || !this.path || this.pathIdx >= (this.path?.length ?? 0);
    if (stop) {
      c.drive = 0;
      c.steer = 0;
      // Heavies turn their armour 30 degrees off the threat; others face it.
      if (t && engaged && (cls === 'HT' || cls === 'TT' || cls === 'MT')) {
        const want = Math.atan2(t.x - v.x, -(t.z - v.z)) + (cls === 'MT' ? 0 : this.flank * 0.5);
        const off = wrapAngle(want - v.heading);
        c.steer = Math.abs(off) > 0.15 ? clamp(off * 2, -1, 1) : 0;
      } else if (t && engaged && v.spec.gun?.arc) {
        // Casemates turn the hull to bring the gun to bear.
        const facing = ((v.spec.gun.facing ?? 0) * Math.PI) / 180;
        const want = Math.atan2(t.x - v.x, -(t.z - v.z)) - facing;
        const off = wrapAngle(want - v.heading);
        c.steer = Math.abs(off) > (v.spec.gun.arc * Math.PI) / 360 ? clamp(off * 2, -1, 1) : 0;
      } else if (t && engaged && v.spec.launcher && v.spec.launcher.arc < 180) {
        const want = Math.atan2(t.x - v.x, -(t.z - v.z));
        const off = wrapAngle(want - v.heading);
        c.steer = Math.abs(off) > 0.15 ? clamp(off * 2, -1, 1) : 0;
      }
      this.stuckFor = 0;
      return;
    }
    const path = this.path!;
    let wp = path[this.pathIdx];
    while (Math.hypot(wp.x - v.x, wp.z - v.z) < 9 && this.pathIdx < path.length - 1) wp = path[++this.pathIdx];
    if (Math.hypot(wp.x - v.x, wp.z - v.z) < 9) this.pathIdx++;
    const want = Math.atan2(wp.x - v.x, -(wp.z - v.z));
    // A gun over the rear deck backs toward the enemy it can see, so it can shoot on the way.
    const rearGun = (v.spec.gun?.facing ?? 0) >= 90;
    const backing = rearGun && sight && Math.abs(wrapAngle(want - Math.atan2(t!.x - v.x, -(t!.z - v.z)))) < Math.PI / 2;
    const off = wrapAngle(want + (backing ? Math.PI : 0) - v.heading);
    const wheels = v.spec.drive.type === 'wheels';
    // Tracks turn the hull the same way in either gear; wheels swap over in reverse.
    c.steer = clamp(off * 2.4, -1, 1) * (backing && wheels ? -1 : 1);
    c.drive = Math.abs(off) > 1.1 && !wheels ? 0.15 : Math.abs(off) > 0.5 ? 0.6 : 1;
    if (backing) c.drive = -c.drive;
    // Mediums and lights slow to shoot when the aim is far off.
    if (engaged && (cls === 'MT' || cls === 'LT') && v.bloom > 2.6) c.drive *= 0.6;
    // Stuck: no headway for a while; back out turning and plan again.
    if (Math.abs(v.speed) < 0.6 && Math.abs(c.drive) > 0.5 && v.crits.tracks <= 0 && !v.mods.rooted && !v.mods.stunned) {
      this.stuckFor += dt;
      if (this.stuckFor > 2.2) {
        this.stuckFor = 0;
        this.reverseFor = 1.4 + g.rng();
        this.reverseSteer = g.rng() < 0.5 ? -1 : 1;
      }
    } else this.stuckFor = Math.max(0, this.stuckFor - dt);
  }

  /** Point the crosshair at a target, leading it by the round's flight time. */
  private aimAt(t: Vehicle, err = true): void {
    const v = this.v;
    const c = v.control;
    const dist = Math.hypot(t.x - v.x, t.z - v.z);
    const speed = v.spec.gun ? v.spec.gun.ammo[v.ammoIndex].velocity * SHELL_SPEED_SCALE : (v.spec.launcher?.speed ?? 200);
    const flight = v.spec.gun?.artillery ? 2 + dist / 400 : dist / speed;
    const lead = this.g.difficulty.lead * flight;
    const vx = t.pose.f[0] * t.speed;
    const vz = t.pose.f[2] * t.speed;
    c.aimX = t.x + vx * lead + (err ? this.errX : 0);
    c.aimZ = t.z + vz * lead + (err ? this.errZ : 0);
    c.aimY = t.y + t.spec.size.height * 0.6;
    c.targetId = t.id;
  }

  private aim(): void {
    const v = this.v;
    const g = this.g;
    const c = v.control;
    const t = this.target;
    c.fire = false;
    const sup = v.spec.repairBeam ? this.hurtAlly(v.spec.repairBeam.range) : null;
    if (!t) {
      if (sup) c.targetId = sup.id;
      return;
    }
    this.aimAt(t);
    if (sup) c.targetId = sup.id;
    const dist = Math.hypot(t.x - v.x, t.z - v.z);
    const gun = v.spec.gun;
    const l = v.spec.launcher;
    // Smoke between: the bot loses its aim most of the time.
    if (g.smokeBetween(v.x, v.z, t.x, t.z) && g.rng() < 0.97) return;
    if (gun) {
      if (dist > gun.range || v.reload > 0 || !v.onTarget) return;
      if (!gun.artillery && !g.lineOfSight(v.x, v.y + 2.5, v.z, t.x, t.y + 1.2, t.z)) return;
      // Bots on the move take the snap shot up close.
      const settle = STATIONARY[v.spec.cls] ? 1.8 : dist < 300 ? 4.6 : 3.6;
      if (v.bloom > settle) return;
      c.fire = true;
    } else if (l) {
      if (dist > l.range || v.launcherReload > 0 || !v.launcherBears()) return;
      if (l.guidance !== 'none' && !g.lineOfSight(v.x, v.y + 2.5, v.z, t.x, t.y + 1.2, t.z)) return;
      c.fire = true;
    }
  }

  private consumables(): void {
    const v = this.v;
    const c = v.control;
    const g = this.g;
    const rep = v.consumables[0];
    if (rep && rep.charges > 0 && rep.cooldown <= 0 && (v.crits.tracks > 0.5 || v.crits.fire > 0.5 || v.hp < v.maxHp * 0.3)) {
      c.consumable = 0;
      return;
    }
    const u = v.consumables[1];
    if (!u || u.charges <= 0 || u.cooldown > 0 || u.active > 0) return;
    const t = this.target;
    const dist = t ? Math.hypot(t.x - v.x, t.z - v.z) : Infinity;
    const recent = g.time - v.lastHit < 2;
    let use = false;
    switch (u.spec.type) {
      case 'applique':
      case 'bulwark':
        use = recent && v.hp < v.maxHp * 0.75;
        break;
      case 'overdrive':
        use = Math.hypot(this.goalX - v.x, this.goalZ - v.z) > 250;
        break;
      case 'smoke':
        use = recent && v.hp < v.maxHp * 0.5 && dist < 400;
        break;
      case 'steady':
        use = !!t && dist < (v.spec.gun?.range ?? 0) && Math.abs(v.speed) < 1;
        break;
      case 'relocate':
        use = recent;
        break;
      case 'rapidReload':
        use = v.launcherReload > 3 && dist < (v.spec.launcher?.range ?? 0);
        break;
      case 'fieldRepair':
        use = g.alliesNear(v.team, v.x, v.z, 40).filter((a) => a.hp < a.maxHp * 0.7).length >= 2;
        break;
    }
    if (use) c.consumable = 1;
  }
}
