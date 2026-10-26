import { canTrack } from '../core/Targeting';
import { CAP_RADIUS, KNOT, MAP_HALF, RANGE_SCALE, SPEED_SCALE } from '../config';
import type { Game } from '../core/Game';
import { Pickups } from '../core/Pickups';
import { DEG, bearingTo, dist2D, forwardX, forwardZ, gaussian, wrapAngle } from '../core/math';
import type { AmmoType } from '../core/types';
import { canActivate } from '../ships/Consumables';
import { ESCORT_LEASH } from '../modes/Convoy';
import type { Ship } from '../ships/Ship';
import { aiWantsSkill } from '../skills/registry';
import { solve } from '../weapons/Ballistics';
import { avoid, evasion, rudderFor, separate } from './Navigation';

// Class-aware bot captain. Thinks a few times per second, steers every tick.

export class AIController {
  target: Ship | null = null;
  leader: Ship | null = null;
  /** Boss Rush: head for this ship wherever it is, and fight at shorter range. */
  hunt: Ship | null = null;
  /** A marching summon (the Rumbling): hold this bearing at full speed, whatever is in the way. */
  march: number | null = null;
  private think = 0;
  private desired = 0;
  private side = 1;
  private errX = 0;
  private errZ = 0;
  private wantTorps = false;
  private capIndex = -1;
  private reverseTime = 0;
  /** Seconds before backing off may start again (a few tries ahead come between). */
  private reverseRest = 0;
  /** After backing off: seconds left sailing for open water, and the heading to it. */
  private escapeTime = 0;
  private escapeHeading = 0;
  /** Convoy escort: strayed too far and heading back to station. */
  private closingUp = false;

  constructor(
    readonly ship: Ship,
    readonly game: Game,
  ) {
    this.desired = ship.heading;
    this.side = game.rng() < 0.5 ? 1 : -1;
    this.think = game.rng() * 0.5;
  }

  update(dt: number): void {
    const ship = this.ship;
    const c = ship.control;
    if (this.target && !canTrack(ship, this.target)) {
      this.target = null;
      this.think = 0;
      c.fire = false;
      c.targetId = -1;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.game.difficulty.think * (0.8 + this.game.rng() * 0.4);
      this.decide();
    }
    c.rudder = rudderFor(ship, this.desired);
    // Run aground or pinned (map edge, another hull): back off astern with opposite rudder for a
    // few seconds, then try ahead again for a few before backing off once more (so a stern on the
    // rocks cannot keep it reversing).
    if (this.reverseRest > 0) this.reverseRest -= dt;
    if (this.escapeTime > 0) this.escapeTime -= dt;
    if ((ship.grounded > 0.4 || ship.stalled > 3) && this.reverseRest <= 0) {
      this.reverseTime = 6;
      this.reverseRest = 9;
      // Then make for clear water roughly astern before chasing the fight again, or the next
      // turn toward the enemy runs it straight back onto the same rocks.
      this.escapeHeading = avoid(this.game, ship, wrapAngle(ship.heading + Math.PI));
      this.escapeTime = 14;
    }
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      c.throttleSet = 0;
      c.rudder = -c.rudder || 1;
    }
    this.aim();
  }

  // ------------------------------------------------------------ decisions

  private decide(): void {
    const ship = this.ship;
    const g = this.game;
    const c = ship.control;
    this.target = this.pickTarget();
    c.targetId = this.target?.id ?? -1;

    // Fresh aim error each decision, scaled by range and difficulty.
    if (this.target) {
      const d = dist2D(ship.pos.x, ship.pos.z, this.target.pos.x, this.target.pos.z);
      // The floor keeps bots from sniping perfectly at today's short fighting ranges.
      const e = g.difficulty.aimError * (d + 1500);
      this.errX = gaussian(g.rng) * e;
      this.errZ = gaussian(g.rng) * e;
    }

    this.chooseMovement();
    this.chooseWeapon();
    this.useConsumables();
    this.useSkills();
    this.submarineDepth();
  }

  private pickTarget(): Ship | null {
    const ship = this.ship;
    if (this.leader && this.leader.alive) {
      const lt = this.leader.control.targetId;
      const t = this.game.ships.find((s) => s.id === lt && canTrack(ship, s));
      if (t) return t;
    }
    let best: Ship | null = null;
    let bestScore = Infinity;
    for (const s of this.game.ships) {
      if (!canTrack(ship, s)) continue;
      const d = dist2D(ship.pos.x, ship.pos.z, s.pos.x, s.pos.z);
      // Prefer close, damaged targets; stick with the current one.
      let score = d * (0.6 + 0.4 * (s.hp / s.maxHp));
      if (s === this.target) score *= 0.75;
      if (s.submerged && ship.spec.cls !== 'DD') score *= 3;
      // A taunt draws every captain within reach.
      if (s.mods.taunt && d < 5000) score *= 0.25;
      // Gunners favour the bigger hull: more of each salvo lands on it.
      score *= 1.3 - 0.3 * Math.min(1, s.spec.length / 250);
      const cv = this.game.convoy;
      if (cv) {
        // Raiders go for the cargo; escorts deal with whatever is nearest the column.
        if (s.spec.cls === 'AK') score *= 0.6;
        const c = ship.team === cv.team ? cv.centre() : null;
        if (c) score = score * 0.5 + dist2D(s.pos.x, s.pos.z, c.x, c.z) * 0.5;
      }
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private preferredRange(): number {
    return this.baseRange() * (this.hunt ? 0.7 : 1);
  }

  private baseRange(): number {
    const s = this.ship.spec;
    switch (s.cls) {
      case 'TT':
        return (s.main?.range ?? 4000) * 0.6;
      case 'BB':
        return s.main!.range * 0.72;
      case 'CB':
      case 'CA':
        return s.main!.range * 0.7;
      case 'CL':
        return s.main!.range * 0.62;
      case 'DD': {
        const torpReady = this.ship.launchers.some((l) => l.reload <= 0);
        return torpReady && s.torpedoes ? s.torpedoes.range * 0.65 : s.main!.range * 0.75;
      }
      case 'CV':
        return 12000 * RANGE_SCALE;
      case 'SS':
        return (s.torpedoes?.range ?? 4000) * 0.6;
      case 'AK':
        return 1000;
    }
  }

  private chooseMovement(): void {
    const ship = this.ship;
    const g = this.game;
    const c = ship.control;
    let heading = ship.heading;
    let throttle = 6;
    const crate = this.wantedPickup();
    const station = this.convoyStation();
    const dodge = this.evasion();

    if (this.march !== null) {
      heading = this.march;
    } else if (this.escapeTime > 0) {
      heading = this.escapeHeading;
    } else if (dodge !== null) {
      heading = dodge;
    } else if (station) {
      heading = bearingTo(ship.pos.x, ship.pos.z, station.x, station.z);
    } else if (crate && !(this.leader && this.leader.alive && dist2D(ship.pos.x, ship.pos.z, crate.x, crate.z) > 400)) {
      heading = bearingTo(ship.pos.x, ship.pos.z, crate.x, crate.z);
    } else if (this.leader && this.leader.alive) {
      // Escort formation off the leader's quarter.
      const p = this.leader.localToWorld(-150, 0, this.side * 280);
      const d = dist2D(ship.pos.x, ship.pos.z, p.x, p.z);
      heading = d > 200 ? bearingTo(ship.pos.x, ship.pos.z, p.x, p.z) : this.leader.heading;
      throttle = d > 600 ? 6 : 5;
    } else if (this.capDuty()) {
      const cap = this.game.caps[this.capIndex];
      heading = bearingTo(ship.pos.x, ship.pos.z, cap.x, cap.z);
      if (dist2D(ship.pos.x, ship.pos.z, cap.x, cap.z) < CAP_RADIUS * 0.5) heading = ship.heading + 30 * DEG;
    } else if (this.target && this.fightCap()) {
      // Fight from inside a nearby cap: guns bear from anywhere, and the circle needs bodies.
      const cap = this.fightCap()!;
      heading = bearingTo(ship.pos.x, ship.pos.z, cap.x, cap.z);
      if (dist2D(ship.pos.x, ship.pos.z, cap.x, cap.z) < CAP_RADIUS * 0.5) {
        heading = ship.heading + 25 * DEG;
        throttle = 4;
      }
    } else if (this.target) {
      const t = this.target;
      const d = dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
      const toT = bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
      let R = this.preferredRange();
      const band = 300;
      const tooClose = ship.spec.cls === 'DD' ? R * 0.7 : R * 0.5;
      // Battleships angle their armour toward the enemy; cruisers and destroyers run broadside.
      const angle = ship.spec.cls === 'BB' || ship.spec.cls === 'CB' || ship.spec.cls === 'TT' ? 45 : 75;
      if (d > R + band) heading = toT + this.side * 20 * DEG;
      else if (d < tooClose) heading = toT + Math.PI - this.side * 35 * DEG;
      else heading = toT + this.side * angle * DEG;
      if (ship.spec.cls === 'CV') {
        heading = toT + Math.PI + this.side * 30 * DEG;
        throttle = 5;
      }
      if (this.game.rng() < 0.03) this.side = -this.side;
    } else {
      const goal = this.objective();
      const d = dist2D(ship.pos.x, ship.pos.z, goal.x, goal.z);
      heading = bearingTo(ship.pos.x, ship.pos.z, goal.x, goal.z);
      if (d < CAP_RADIUS * 0.5) {
        heading = ship.heading + 25 * DEG;
        throttle = 4;
      }
    }
    // A marching line keeps its ranks: only land turns it.
    this.desired = avoid(g, ship, this.march !== null ? wrapAngle(heading) : separate(g, ship, wrapAngle(heading)));
    c.throttleSet = throttle;
  }

  /** Dodge incoming danger (see `evasion`); less skilled captains notice less often. */
  private evasion(): number | null {
    const g = this.game;
    return g.rng() > g.difficulty.lead ? null : evasion(g, this.ship);
  }

  /** Convoy escort out on a limb: where to rejoin the column, until it is close again. */
  private convoyStation(): { x: number; z: number } | null {
    const ship = this.ship;
    const cv = this.game.convoy;
    if (!cv || ship.team !== cv.team || ship.isSummon) return null;
    const c = cv.centre();
    if (!c) return null;
    const d = dist2D(ship.pos.x, ship.pos.z, c.x, c.z);
    if (d > ESCORT_LEASH) this.closingUp = true;
    else if (d < ESCORT_LEASH * 0.55) this.closingUp = false;
    return this.closingUp ? cv.station(ship) : null;
  }

  /** A crate worth a detour: always when it is close, from further out when hurt. */
  private wantedPickup(): { x: number; z: number } | null {
    const ship = this.ship;
    if (ship.isSummon) return null;
    const reach = ship.hp / ship.maxHp < 0.6 ? 800 : 300;
    let best: { x: number; z: number } | null = null;
    let bd = reach;
    for (const p of this.game.pickups.items) {
      if (!p.alive) continue;
      const d = dist2D(ship.pos.x, ship.pos.z, p.x, p.z) - Pickups.radius(ship);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Destroyers contest their assigned cap unless a target is close. */
  private capDuty(): boolean {
    const ship = this.ship;
    const g = this.game;
    if (!g.caps.length || ship.spec.cls !== 'DD' || ship.isSummon) return false;
    if (this.capIndex < 0) {
      let bd = Infinity;
      g.caps.forEach((cap, i) => {
        const d = Math.abs(cap.z - ship.pos.z);
        if (d < bd) {
          bd = d;
          this.capIndex = i;
        }
      });
    }
    const cap = g.caps[this.capIndex];
    if (cap.owner === ship.team && !cap.contested) {
      this.capIndex = g.caps.findIndex((c) => c.owner !== ship.team);
      if (this.capIndex < 0) return false;
    }
    if (this.target && dist2D(ship.pos.x, ship.pos.z, this.target.pos.x, this.target.pos.z) < 3500 * RANGE_SCALE) return false;
    return true;
  }

  /** A cap we do not hold, close enough to take while trading fire (gun ships, target not on top of us). */
  private fightCap(): { x: number; z: number } | null {
    const ship = this.ship;
    const g = this.game;
    const cls = ship.spec.cls;
    if (!g.caps.length || cls === 'CV' || cls === 'SS' || ship.isSummon || this.hunt) return null;
    const t = this.target;
    if (t && dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z) < 600) return null;
    let best: { x: number; z: number } | null = null;
    let bd = 2200;
    for (const cap of g.caps) {
      if (cap.owner === ship.team && !cap.contested) continue;
      const d = dist2D(ship.pos.x, ship.pos.z, cap.x, cap.z);
      if (d < bd) {
        bd = d;
        best = cap;
      }
    }
    return best;
  }

  /** Where to go when no enemy is visible. */
  private objective(): { x: number; z: number } {
    const ship = this.ship;
    const g = this.game;
    const enemySide = ship.team === 0 ? 1 : -1;
    if (this.hunt?.alive) return this.hunt.pos;
    if (g.caps.length && ship.spec.cls !== 'CV') {
      if (this.capIndex < 0 || g.caps[this.capIndex].owner === ship.team) {
        // Pick the closest cap we do not own.
        let best = -1;
        let bd = Infinity;
        g.caps.forEach((cap, i) => {
          if (cap.owner === ship.team) return;
          const d = dist2D(ship.pos.x, ship.pos.z, cap.x, cap.z) * (ship.spec.cls === 'BB' && i !== 1 ? 1.5 : 1);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        this.capIndex = best;
      }
      if (this.capIndex >= 0) {
        const cap = g.caps[this.capIndex];
        if (ship.spec.cls !== 'BB' || dist2D(ship.pos.x, ship.pos.z, cap.x, cap.z) > 3000 * RANGE_SCALE) return cap;
      }
    }
    if (ship.spec.cls === 'CV') {
      return { x: -enemySide * MAP_HALF * 0.66, z: ship.pos.z * 0.9 };
    }
    const column = g.convoy?.centre();
    if (column) return column;
    // Annihilation: push toward the enemy side, spread out by id.
    return { x: enemySide * MAP_HALF * 0.39, z: ((ship.id % 5) - 2) * MAP_HALF * 0.28 };
  }

  private chooseWeapon(): void {
    const ship = this.ship;
    const c = ship.control;
    const t = this.target;
    this.wantTorps = false;
    // Cells loaded and the target inside missile range: ripple a salvo off first.
    const ms = ship.spec.missiles;
    if (ms && t && ship.vls && ship.vls.reload <= 0 && !t.submerged && dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z) < ms.range * 0.95) {
      c.slot = ship.slots.findIndex((s) => s.kind === 'vls');
      c.fire = true;
      return;
    }
    // A carrier-submarine fires its torpedoes when they are loaded and in reach, and flies its wing otherwise.
    const tspec = ship.spec.torpedoes;
    if (ship.spec.air && ship.isSub && tspec && t && !t.deep && ship.launchers.some((l) => l.reload <= 0) && dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z) < tspec.range * 0.8) {
      this.wantTorps = true;
      c.slot = ship.slots.findIndex((s) => s.kind === 'torp');
      c.fire = true;
      return;
    }
    if (ship.spec.air) {
      const st = ship.air!;
      const enemyAir = this.game.air.squadrons.some(
        (q) => q.alive && q.team !== ship.team && dist2D(q.x, q.z, ship.pos.x, ship.pos.z) < 6000 * RANGE_SCALE,
      );
      let slot = st.hangar.torpedo >= 3 ? 0 : st.hangar.dive >= 3 ? 1 : 2;
      if (enemyAir && st.hangar.fighter >= 3) slot = 2;
      // A carrier-submarine's wing sits behind its torpedo slot.
      c.slot = ship.isSub ? ship.slots.findIndex((s) => s.kind === 'air') + slot : slot;
      c.fire = !!t && st.cooldown <= 0;
      return;
    }
    if (!t) {
      c.fire = false;
      return;
    }
    const d = dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
    const torpSlot = ship.slots.findIndex((s) => s.kind === 'torp');
    if (torpSlot >= 0 && ship.spec.torpedoes) {
      const ready = ship.launchers.some((l) => l.reload <= 0);
      const inRange = d < ship.spec.torpedoes.range * (ship.spec.cls === 'SS' ? 0.85 : 0.75);
      if (ready && inRange && !t.deep) {
        this.wantTorps = true;
        c.slot = torpSlot;
        c.fire = true;
        return;
      }
    }
    const ammo = this.chooseAmmo(t, d);
    const gunSlot = ship.slots.findIndex((s) => s.kind === 'gun' && s.ammo === ammo);
    const anyGun = ship.slots.findIndex((s) => s.kind === 'gun');
    c.slot = gunSlot >= 0 ? gunSlot : anyGun;
    c.fire = anyGun >= 0 && d < ship.mainRange * 0.98 && !t.submerged;
    if (ship.isSub && ship.depthState !== 0) c.fire = false;
  }

  private chooseAmmo(t: Ship, d: number): AmmoType {
    const me = this.ship.spec.cls;
    const tc = t.spec.cls;
    if (tc === 'DD' || tc === 'SS') return 'HE';
    if (me === 'BB' || me === 'TT') return 'AP';
    if (me === 'CB') return tc === 'BB' && d > 8000 * RANGE_SCALE ? 'HE' : 'AP';
    if (me === 'CA') return tc === 'BB' ? 'HE' : 'AP';
    if (me === 'CL') return tc === 'CL' && d < 5000 * RANGE_SCALE ? 'AP' : 'HE';
    return 'HE';
  }

  private useConsumables(): void {
    const ship = this.ship;
    const c = ship.control;
    const fires = ship.fires.filter((f) => f > 0).length;
    const hpFrac = ship.hp / ship.maxHp;
    const enemiesNear = this.game.ships.filter(
      (s) => s.alive && s.team !== ship.team && dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) < 6000 * RANGE_SCALE,
    );
    ship.consumables.forEach((cs, i) => {
      if (!canActivate(cs) || c.consumable >= 0) return;
      switch (cs.spec.type) {
        case 'repair':
          if (fires >= 2 || hpFrac < 0.5 || ((fires >= 1 || ship.flooding > 0) && hpFrac < 0.8)) c.consumable = i;
          break;
        case 'smoke':
          if (this.game.time - ship.lastHurt < 3 && (hpFrac < 0.7 || ship.spec.cls === 'DD') && enemiesNear.length) c.consumable = i;
          break;
        case 'search': {
          // Something is hiding close by: a cloak, a submerged boat, or torpedoes in the water.
          const r = cs.spec.power ?? 3000;
          const hidden = enemiesNear.some(
            (s) => (s.mods.untargetable && !s.mods.banished || s.isSub && s.submerged) && dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) < r,
          );
          if (hidden || this.game.torps.torps.some((t) => t.alive && t.team !== ship.team && dist2D(t.x, t.z, ship.pos.x, ship.pos.z) < 2000)) c.consumable = i;
          break;
        }
        case 'speedBoost':
          if (this.target && dist2D(ship.pos.x, ship.pos.z, this.target.pos.x, this.target.pos.z) > this.preferredRange() + 1500 * RANGE_SCALE) c.consumable = i;
          break;
        case 'depthCharges':
          if (enemiesNear.some((s) => s.isSub && s.submerged && dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) < 500)) c.consumable = i;
          break;
      }
    });
  }

  /** One skill per decision: ultimates first when one is ready and worth it, then the others in random order. */
  private useSkills(): void {
    const ship = this.ship;
    if (ship.ultActive) return;
    const normal = ship.skills.filter((st) => !st.spec.ult).map((st) => st.index);
    for (let i = normal.length - 1; i > 0; i--) {
      const j = Math.floor(this.game.rng() * (i + 1));
      [normal[i], normal[j]] = [normal[j], normal[i]];
    }
    for (const i of [...ship.ultIndices, ...normal]) {
      if (!aiWantsSkill(ship, this.game, i, this.target)) continue;
      if (this.game.rng() >= this.game.difficulty.skillUse) continue;
      // Aim skills at the target before triggering.
      this.aim();
      ship.control.skill = i;
      return;
    }
  }

  private submarineDepth(): void {
    const ship = this.ship;
    if (!ship.isSub) return;
    const c = ship.control;
    const threat = this.game.ships.some(
      (s) => s.alive && s.team !== ship.team && (s.spec.cls === 'DD' || s.spec.cls === 'CL') && dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) < 2500 * RANGE_SCALE,
    );
    let want = 1;
    if (threat && ship.battery > 20) want = 2;
    if (this.wantTorps) want = 1;
    if (ship.battery < 15) want = 0;
    if (!this.target && ship.battery < ship.spec.sub!.battery * 0.6) want = 0;
    if (want > ship.depthState) c.diveDown = true;
    else if (want < ship.depthState) c.diveUp = true;
  }

  // ------------------------------------------------------------ aiming

  private aim(): void {
    const ship = this.ship;
    const c = ship.control;
    const t = this.target;
    if (!t) {
      c.aimX = ship.pos.x + forwardX(ship.heading) * 1500;
      c.aimZ = ship.pos.z + forwardZ(ship.heading) * 1500;
      return;
    }
    const d = dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
    let time = 0;
    const slot = ship.currentSlot;
    if (this.wantTorps || slot?.kind === 'torp') {
      const spd = (ship.spec.torpedoes?.speed ?? 60) * KNOT * SPEED_SCALE;
      time = d / spd;
      // Second pass with predicted distance.
      const px = t.pos.x + forwardX(t.heading) * t.speed * time;
      const pz = t.pos.z + forwardZ(t.heading) * t.speed * time;
      time = dist2D(ship.pos.x, ship.pos.z, px, pz) / spd;
    } else if (slot?.kind === 'air' || slot?.kind === 'vls') {
      time = 0;
    } else {
      const table = ship.tableFor(ship.ammo);
      if (table) time = solve(table, d).time;
    }
    const lead = this.game.difficulty.lead;
    c.aimX = t.pos.x + forwardX(t.heading) * t.speed * time * lead + this.errX;
    c.aimZ = t.pos.z + forwardZ(t.heading) * t.speed * time * lead + this.errZ;
  }
}
