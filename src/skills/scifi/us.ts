import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import type { Field } from '../../weapons/FieldSystem';
import {
  aimPoint,
  blinkTo,
  buff,
  enemiesOnLine,
  enemiesWithin,
  enemyNear,
  hpFrac,
  hurt,
  nextSalvo,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { arc, enemiesAround, every, laser, orbitalLaser, reticleTarget } from './common';

// United States Space Navy: Apollo, Artemis, Mercury, Gemini, Orion.
// Orbital supremacy. Uplink stretches every reticle skill here 30% further.

export const US_SF_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Apollo
  def(
    {
      id: 'kineticLance',
      name: 'Kinetic Lance',
      short: 'KINETIC LANCE',
      description: 'A satellite drops a tungsten lance on the reticle (7 km). It lands half a second later: 27k in 60 m.',
      cooldown: 14,
      duration: 0,
      accent: 0x4aa8ff,
      icon: 'rod',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 60, delay: 0.5, damage: 27000, fire: 0.3 });
      },
      aiShouldUse(ship, _g, target) {
        // A half-second fall: lead the target by where it will be.
        if (!within(ship, target, 6800) || target.submerged) return false;
        ship.control.aimX = target.pos.x + forwardX(target.heading) * target.speed * 0.5;
        ship.control.aimZ = target.pos.z + forwardZ(target.heading) * target.speed * 0.5;
        return true;
      },
    },
  ),
  def(
    {
      id: 'deflectorArray',
      name: 'Deflector Array',
      short: 'DEFLECTOR',
      description: '8 s: a deflector screen turns away every shell fired at you from more than 3 km off.',
      cooldown: 22,
      duration: 8,
      accent: 0x80c8ff,
      icon: 'shield',
    },
    {
      activate() {},
      update(ship, game) {
        const r = ship.spec.length * 0.5 + 120;
        let fx = 0;
        for (const s of game.shells.shells) {
          if (!s.alive || s.team === ship.team || Math.hypot(s.x - ship.pos.x, s.z - ship.pos.z) > r) continue;
          if (Math.hypot(s.owner.pos.x - ship.pos.x, s.owner.pos.z - ship.pos.z) < 3000) continue;
          s.alive = false;
          if (fx++ < 8) game.events.emit('shieldHit', { ship, amount: s.spec.damage * s.dmgMul });
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 6;
      },
    },
  ),
  def(
    {
      id: 'sunburstGrid',
      name: 'Sunburst Grid',
      short: 'SUNBURST',
      description: '6 s: the orbital grid paints a 1 km circle that chases your reticle (8 km). Once a second, every enemy inside takes an orbital laser: 6.5k.',
      ult: true,
      cooldown: 85,
      duration: 6,
      accent: 0xffe060,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        st.data.f = game.fields.add(ship, { x: p.x, z: p.z, r: 1000, life: st.spec.duration, skill: st.spec, look: 'circle', color: st.spec.accent });
      },
      update(ship, game, dt, st) {
        const f = st.data.f as Field;
        // The circle chases the reticle at 220 m/s.
        const p = aimPoint(ship, 8000);
        const d = dist2D(f.x, f.z, p.x, p.z);
        const step = Math.min(d, 220 * dt);
        if (d > 1) {
          f.x += ((p.x - f.x) / d) * step;
          f.z += ((p.z - f.z) / d) * step;
        }
        if (!every(st, dt, 1)) return;
        for (const s of enemiesAround(ship, game, f.x, f.z, 1000)) {
          if (s.submerged) continue;
          orbitalLaser(game, s.pos.x, s.pos.z, st.spec.accent);
          hurt(ship, s, 6500, st.spec);
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 7500) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 1000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Artemis
  def(
    {
      id: 'prismSplit',
      name: 'Prism Split',
      short: 'PRISM',
      description: 'The next salvo goes through a prism: every hit forks two beams of 30% of an AP round onto other enemies within 1 km.',
      cooldown: 16,
      duration: 0,
      accent: 0xb0f0ff,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        const fork = (ship.spec.main?.ap?.damage ?? 3000) * 0.3;
        nextSalvo(ship, st.spec, {
          onHit: (t) => {
            const near = enemiesAround(ship, game, t.pos.x, t.pos.z, 1000).filter((s) => s !== t && !s.submerged);
            for (const s of near.slice(0, 2)) {
              arc(game, t, s, st.spec.accent);
              hurt(ship, s, fork, st.spec);
            }
          },
        });
      },
      aiShouldUse(ship, game, target) {
        return targetInGunRange(ship, target, 0.9) && enemiesAround(ship, game, target!.pos.x, target!.pos.z, 1000).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'hunterSatellite',
      name: 'Hunter Satellite',
      short: 'HUNTER SAT',
      description: 'A satellite locks onto the enemy under the reticle (8 km) for 12 s: it is marked, cannot cloak, and shells at it group 30% tighter.',
      cooldown: 20,
      duration: 0,
      accent: 0x4aa8ff,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        // Cloaked hulls cannot hide from it: look among every enemy, not just the visible ones.
        let t: Ship | null = null;
        let bd = 600;
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team) continue;
          const d = dist2D(s.pos.x, s.pos.z, p.x, p.z);
          if (d < bd) {
            bd = d;
            t = s;
          }
        }
        if (!t) return false;
        buff(t, 'debuff:hunterSatellite', 12, (m) => {
          m.marked = true;
          m.revealed = true;
          m.scatterTakenMul *= 0.7;
        });
        orbitalLaser(game, t.pos.x, t.pos.z, st.spec.accent);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7500) && !target.mods.marked;
      },
    },
  ),
  def(
    {
      id: 'archerOfMoon',
      name: 'Archer of the Moon',
      short: 'MOON ARCHER',
      description: 'A 5 km laser down the reticle bearing: 60k to the first hull it meets, then it shatters into splinters that deal 20k to every enemy within 800 m of it.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xe8f0ff,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const reach = 5000 * ship.mods.reachMul;
        const ex = ship.pos.x + forwardX(b) * reach;
        const ez = ship.pos.z + forwardZ(b) * reach;
        const near = (s: Ship) => dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z);
        const first = enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, ex, ez, 30)
          .filter((s) => !s.submerged)
          .sort((a, c) => near(a) - near(c))[0];
        if (!first) {
          laser(ship, game, ex, 4, ez, st.spec.accent);
          return;
        }
        laser(ship, game, first.pos.x, first.spec.freeboard, first.pos.z, st.spec.accent);
        hurt(ship, first, 60000, st.spec);
        for (const s of enemiesAround(ship, game, first.pos.x, first.pos.z, 800)) {
          if (s === first || s.submerged) continue;
          arc(game, first, s, st.spec.accent);
          hurt(ship, s, 20000, st.spec);
        }
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 4800) || target.submerged) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return true;
      },
    },
  ),

  // ------------------------------------------------------------------ Mercury
  def(
    {
      id: 'afterburnerWake',
      name: 'Afterburner Wake',
      short: 'AFTERBURNER',
      description: '5 s at 1.8x speed. The fusion exhaust sets the sea alight behind you: burning patches 150 m wide that deal 4k a second for 6 s.',
      cooldown: 16,
      duration: 5,
      accent: 0xff8a30,
      icon: 'speed',
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 1.8;
        });
        if (!every(st, dt, 0.5)) return;
        const back = ship.spec.length * 0.6;
        game.fields.add(ship, { x: ship.pos.x - forwardX(ship.heading) * back, z: ship.pos.z - forwardZ(ship.heading) * back, r: 150, life: 6, skill: st.spec, look: 'fire', color: st.spec.accent, dps: 4000 });
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 700) >= 4 || (within(ship, target, 4000) && !within(ship, target, 2000));
      },
    },
  ),
  def(
    {
      id: 'plasmaTorps',
      name: 'Plasma Torpedoes',
      short: 'PLASMA TORPS',
      description: 'The next spread runs as plasma lances: twice as fast, and every hit starts a fire.',
      cooldown: 16,
      duration: 12,
      accent: 0x4aa8ff,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        ship.torpBuff = { skill: st.spec, speedMul: 2, spreads: 1, fire: 1 };
      },
      end(ship, _g, st) {
        if (ship.torpBuff?.skill === st.spec) ship.torpBuff = null;
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.9) && ship.launchers.some((l) => l.reload <= 0);
      },
    },
  ),
  def(
    {
      id: 'machStrike',
      name: 'Mach Strike',
      short: 'MACH STRIKE',
      description: 'Break the sound barrier: dash 1.2 km toward the reticle. The sonic boom deals 40k to every enemy within 150 m of your path and stuns it 1 s.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xb0e0ff,
      icon: 'speed',
    },
    {
      activate(ship, game, st) {
        const x0 = ship.pos.x;
        const z0 = ship.pos.z;
        const p = aimPoint(ship, 1200);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        for (const s of enemiesOnLine(ship, game, x0, z0, ship.pos.x, ship.pos.z, 150)) {
          hurt(ship, s, 40000, st.spec);
          if (s.alive) stun(s, 1);
        }
        game.events.emit('lightning', { points: [{ x: x0, y: 8, z: z0 }, { x: ship.pos.x, y: 8, z: ship.pos.z }], color: st.spec.accent, straight: true });
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 1300) || target.deep) return false;
        // Dash through the target, not just up to it.
        ship.control.aimX = target.pos.x + (target.pos.x - ship.pos.x) * 0.3;
        ship.control.aimZ = target.pos.z + (target.pos.z - ship.pos.z) * 0.3;
        return true;
      },
    },
  ),

  // ------------------------------------------------------------------ Gemini
  def(
    {
      id: 'dropPod',
      name: 'Drop Pod',
      short: 'DROP POD',
      description: 'A bonus strike squadron drops from orbit right over the reticle and dives on the nearest enemy there.',
      cooldown: 18,
      duration: 0,
      accent: 0x4aa8ff,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const air = ship.spec.air;
        if (!air) return false;
        const p = aimPoint(ship, air.range);
        const t = enemyNear(ship, game, p.x, p.z, 1200);
        const sq = game.air.launch(ship, 'dive', t?.pos.x ?? p.x, t?.pos.z ?? p.z, true);
        if (!sq) return false;
        // Falls in 500 m short of the target, already lined up.
        const b = bearingTo(ship.pos.x, ship.pos.z, sq.tx, sq.tz);
        sq.x = sq.tx - forwardX(b) * 500;
        sq.z = sq.tz - forwardZ(b) * 500;
        sq.heading = b;
        sq.skill = st.spec;
        if (t) sq.target = t;
      },
      aiShouldUse(ship, _g, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'orbitalResupply',
      name: 'Orbital Resupply',
      short: 'RESUPPLY',
      description: 'A supply capsule splashes down alongside: every hangar refills and the hull repairs 15%.',
      cooldown: 30,
      duration: 0,
      accent: 0x9adfff,
      icon: 'heal',
    },
    {
      activate(ship) {
        const air = ship.spec.air;
        if (air && ship.air) {
          ship.air.hangar.torpedo = air.torpedo.hangar;
          ship.air.hangar.dive = air.dive.hangar;
          ship.air.hangar.fighter = air.fighter.hangar;
        }
        ship.heal(ship.maxHp * 0.15);
      },
      aiShouldUse(ship) {
        const a = ship.air;
        const air = ship.spec.air;
        return hpFrac(ship) < 0.6 || (!!a && !!air && a.hangar.dive + a.hangar.torpedo < (air.dive.hangar + air.torpedo.hangar) / 3);
      },
    },
  ),
  def(
    {
      id: 'spaceFleet',
      name: 'Space Fleet',
      short: 'SPACE FLEET',
      description: 'Gunships hold over the reticle for 10 s: every half second, three of them fire on enemies within 900 m, 2.8k a shot.',
      ult: true,
      cooldown: 85,
      duration: 10,
      accent: 0x60b0ff,
      icon: 'fleet',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, ship.spec.air?.range ?? 6000);
        st.data.x = p.x;
        st.data.z = p.z;
        game.fields.add(ship, { x: p.x, z: p.z, r: 900, life: st.spec.duration, skill: st.spec, look: 'swarm', color: st.spec.accent });
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        const x = st.data.x as number;
        const z = st.data.z as number;
        const prey = enemiesAround(ship, game, x, z, 900).filter((s) => !s.submerged);
        if (!prey.length) return;
        for (let i = 0; i < 3; i++) {
          const t = prey[Math.floor(game.rng() * prey.length)];
          game.events.emit('lightning', { points: [{ x: x + (game.rng() - 0.5) * 600, y: 380, z: z + (game.rng() - 0.5) * 600 }, { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z }], color: st.spec.accent, straight: true });
          hurt(ship, t, 2800, st.spec);
        }
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 900).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Orion
  def(
    {
      id: 'pulseDrive',
      name: 'Pulse Drive',
      short: 'PULSE DRIVE',
      description: '4 s at 3x speed on a pulse drive. Each pulse, once a second, deals 5k to every enemy within 200 m.',
      cooldown: 16,
      duration: 4,
      accent: 0x60c0ff,
      icon: 'wave',
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 3;
        });
        if (!every(st, dt, 1)) return;
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 200, delay: 0, damage: 5000, speed: 400, follow: true, hitsSubs: true });
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 700) >= 4 || (within(ship, target, 3500) && !within(ship, target, 1500));
      },
    },
  ),
  def(
    {
      id: 'ballisticTorpedo',
      name: 'Ballistic Torpedo',
      short: 'BALLISTIC',
      description: 'A torpedo leaves the water on a rocket and plunges onto the reticle (3 km): 30k in 150 m, and it floods what it hits.',
      cooldown: 16,
      duration: 0,
      accent: 0x4aa8ff,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 3000);
        const lock = reticleTarget(ship, game, 3000, 400);
        game.missiles.launch(ship, p.x, p.z, 0, 30000, { profile: 'ballistic', speed: 320, blast: 150, flood: 0.7, fire: 0, target: lock, skill: st.spec });
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 2900) || target.submerged) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return true;
      },
    },
  ),
  def(
    {
      id: 'hunterConstellation',
      name: 'Hunter Constellation',
      short: 'CONSTELLATION',
      description: '15 s: the satellite net guides every torpedo you fire. They home, run twice as fast, and the tubes reload in 2 s.',
      ult: true,
      cooldown: 85,
      duration: 15,
      accent: 0x80d0ff,
      icon: 'radar',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        ship.torpBuff = { skill: st.spec, speedMul: 2, spreads: 99, homing: true };
      },
      update(ship) {
        for (const l of ship.launchers) l.reload = Math.min(l.reload, 2);
      },
      end(ship, _g, st) {
        if (ship.torpBuff?.skill === st.spec) ship.torpBuff = null;
      },
      aiShouldUse(ship, game, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.8) && enemiesWithin(ship, game, t.range).length >= 1;
      },
    },
  ),
];
