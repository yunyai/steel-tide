import type { Game } from '../../core/Game';
import { bearingTo } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import { aimPoint, buff, enemiesWithin, hpFrac, hurt, mark, nearestEnemy, underFire, within } from '../kit';
import { airStrike } from '../modern/common';
import { droneDive, enemiesAround, reticleTarget } from '../scifi/common';
import { def, type SkillDef } from '../types';

// The Hadal (Misc): a titan carrier-submarine from the trenches. Drone wings launched from
// periscope depth, homing swarms from the deep, and a maw that drags whole ships under.

const ABYSS = 0x5fe0d0;
const TRENCH = 0x2a6cff;

function victim(ship: Ship, game: Game, reach: number): Ship | null {
  return reticleTarget(ship, game, reach, 500) ?? nearestEnemy(ship, game, reach);
}

export const HADAL_SKILLS: SkillDef[] = [
  def(
    {
      id: 'hkSwarm',
      name: 'Hunter-Killer Swarm',
      short: 'HK SWARM',
      description: 'Twelve homing drone torpedoes run deep at the enemy under the reticle (within 5 km): 14k each.',
      cooldown: 12,
      duration: 0,
      accent: ABYSS,
      icon: 'torpedo',
    },
    {
      activate(ship, game) {
        const spec = ship.spec.torpedoes;
        const t = victim(ship, game, 5000);
        if (!spec || !t) return false;
        const b = bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
        for (let i = 0; i < 12; i++) {
          const p = ship.localToWorld(ship.spec.length * 0.3, 0, (i - 5.5) * 6);
          game.torps.launch(ship, p.x, p.z, b + (i - 5.5) * 0.06, { ...spec, damage: 14000, range: 6000 }, t);
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'pressurePulse',
      name: 'Pressure Pulse',
      short: 'PULSE',
      description: 'A wall of crushing pressure rolls out 2 km, deep and shallow alike: 40k, a 2 s stun, and every enemy it passes is revealed for 8 s.',
      cooldown: 14,
      duration: 0,
      accent: ABYSS,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 2000, delay: 0, damage: 40000, stun: 2, hitsSubs: true, speed: 900, follow: true });
        for (const s of enemiesWithin(ship, game, 2000, false)) {
          buff(s, 'debuff:revealed', 8, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1800, false).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'abyssalVeil',
      name: 'Abyssal Veil',
      short: 'VEIL',
      description: 'Sink into the dark for 8 s: you dive deep, nothing can target you, the oxygen refills and holds, and the hull repairs 3% a second.',
      cooldown: 22,
      duration: 8,
      accent: 0x5a8ad0,
      icon: 'cloak',
    },
    {
      activate(ship, _g, st) {
        ship.depthState = 2;
        if (ship.spec.sub) ship.battery = ship.spec.sub.battery;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.untargetable = true;
          m.batteryFree = true;
        });
      },
      update(ship, _g, dt) {
        ship.heal(ship.maxHp * 0.03 * dt);
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.55 || underFire(ship, game, 900) >= 5;
      },
    },
  ),
  def(
    {
      id: 'droneWing',
      name: 'Drone Wing',
      short: 'DRONE WING',
      description: 'A torpedo wing and a dive wing burst from the launch tubes at once, deep or not, straight at the enemy under the reticle: about 60k between them.',
      cooldown: 16,
      duration: 0,
      accent: 0x8af0ff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, ship.spec.air?.range ?? 6000);
        if (!t) return false;
        const a = airStrike(ship, game, 'torpedo', t, 35000, st.spec);
        const b = airStrike(ship, game, 'dive', t, 25000, st.spec);
        return !!(a || b);
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, (ship.spec.air?.range ?? 6000) * 0.9);
      },
    },
  ),
  def(
    {
      id: 'breach',
      name: 'Breach',
      short: 'BREACH',
      description: 'Erupt to the surface in an instant: everything within 900 m takes 90k and is thrown aside, and your hull comes up ready to launch.',
      cooldown: 14,
      duration: 0,
      accent: 0xbff8ff,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        ship.depthState = 0;
        ship.pos.y = 0;
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 900, delay: 0, damage: 90000, knock: 200, hitsSubs: true, look: 'quake' });
        if (ship.air) ship.air.cooldown = 0;
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 850).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'sonarLattice',
      name: 'Sonar Lattice',
      short: 'LATTICE',
      description: 'A web of sonar pings marks every enemy within 4 km for 10 s: they cannot hide, and they take 25% more damage.',
      cooldown: 20,
      duration: 0,
      accent: ABYSS,
      icon: 'radar',
    },
    {
      activate(ship, game) {
        const caught = enemiesWithin(ship, game, 4000, false);
        if (!caught.length) return false;
        for (const s of caught) {
          mark(s, 10);
          buff(s, 'debuff:revealed', 10, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800, false).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'hadalTrench',
      name: 'Hadal Trench',
      short: 'TRENCH',
      description: 'The sea floor opens under the reticle for 8 s: a whirlpool 1.2 km wide drags enemies in, slows them to half and grinds them for 30k a second.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: TRENCH,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 1200, life: 8, pull: 120, slow: 0.5, dps: 30000, skill: st.spec, look: 'void', color: TRENCH });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'swarmMother',
      name: 'Swarm Mother',
      short: 'SWARM MOTHER',
      description: 'Sixty combat drones pour out and split between every enemy within 5 km: 9k each.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0x8af0ff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000);
        if (!list.length) return false;
        const each = Math.floor(60 / list.length);
        list.forEach((t, i) => droneDive(ship, game, t, each + (i < 60 % list.length ? 1 : 0), 9000, st.spec, 1.2));
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'abyssalMaw',
      name: 'Abyssal Maw',
      short: 'MAW',
      description: 'Jaws rise under the enemy beneath the reticle (within 3 km) and drag it into the trench: a line ship is sunk outright, a titan loses 15% of its hull.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0x0f7a8a,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: t.pos.x, z: t.pos.z, radius: 150, delay: 0, damage: 0, look: 'quake' });
        hurt(ship, t, t.spec.cls === 'TT' ? t.maxHp * 0.15 : t.maxHp * 4, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900) && !!target && (target.spec.cls !== 'TT' || hpFrac(target) < 0.4);
      },
    },
  ),
];
