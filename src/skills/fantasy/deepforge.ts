import { bearingTo, clamp, forwardX, forwardZ, wrapAngle } from '../../core/math';
import {
  aimPoint,
  alliesWithin,
  buff,
  dist,
  enemiesOnLine,
  enemiesWithin,
  hpFrac,
  hurt,
  nearestEnemy,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { afflicted, isAI, spendHull } from './common';

// The Deepforge Clans: Anvilheart, Hammerfall, Sparkrunner, Gyrehold, Deepdelver.
// Runic armour, fire and earthquakes.

export const DEEPFORGE_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Anvilheart
  def(
    {
      id: 'runeWarding',
      name: 'Rune of Warding',
      short: 'WARDING',
      description: 'A ward rune flares on the hull: the next 4 heavy hits within 12 s are absorbed whole.',
      cooldown: 22,
      duration: 12,
      accent: 0xffc060,
      icon: 'rune',
    },
    {
      activate(ship, game, st) {
        ship.guard = { left: 4, min: 2500, until: game.time + st.spec.duration, skill: st.spec };
      },
      end(ship, _g, st) {
        if (ship.guard?.skill === st.spec) ship.guard = null;
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 700) >= 6 || (targetInGunRange(ship, target, 0.8) && hpFrac(ship) < 0.7);
      },
    },
  ),
  def(
    {
      id: 'forgeBreath',
      name: 'Forge Breath',
      short: 'FORGE BREATH',
      description: '4 s: the bow forge roars open. A 900 m jet of dragonfire, 14k a second to every hull in it, and it sets them burning.',
      cooldown: 20,
      duration: 0,
      accent: 0xff7a20,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 0.5, time: 4, dps: 14000, length: 900, width: 45, pierce: true, steer: 10, fireChance: 0.8 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 850);
      },
    },
  ),
  def(
    {
      id: 'earthshatter',
      name: 'Earthshatter',
      short: 'EARTHSHATTER',
      description: 'The keel strikes the seabed: 30k and a 3 s stun to every enemy within 1.6 km, then a ring of stone pillars rises around you and stops shells for 10 s.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0xd8a060,
      icon: 'hammer',
      zone: 1600,
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1600, delay: 0, damage: 30000, stun: 3, speed: 900, look: 'quake' });
        const n = 14;
        const r = 1750;
        for (let i = 0; i < n; i++) {
          const a0 = (i * Math.PI * 2) / n;
          const a1 = ((i + 0.72) * Math.PI * 2) / n;
          const x0 = ship.pos.x + Math.cos(a0) * r;
          const z0 = ship.pos.z + Math.sin(a0) * r;
          game.addWall(ship, x0, z0, ship.pos.x + Math.cos(a1) * r, ship.pos.z + Math.sin(a1) * r, 10, 0x9a8670);
        }
      },
      aiShouldUse(ship, game) {
        const n = enemiesWithin(ship, game, 1500).length;
        return n >= 2 || (n === 1 && hpFrac(ship) < 0.6);
      },
    },
  ),

  // ------------------------------------------------------------------ Hammerfall
  def(
    {
      id: 'thunderhammer',
      name: 'Thunderhammer',
      short: 'THUNDERHAMMER',
      description: 'A rune hammer falls on the reticle (5 km): 11k in 120 m and a 2 s stun.',
      cooldown: 18,
      duration: 0,
      accent: 0xffd27a,
      icon: 'hammer',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 120, delay: 0.8, damage: 11000, stun: 2, look: 'anvil' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'stoneskin',
      name: 'Stoneskin',
      short: 'STONESKIN',
      description: '8 s: the hull turns to living granite. Armour-piercing rounds do 70% less to you.',
      cooldown: 20,
      duration: 8,
      accent: 0xb0a090,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.apTakenMul *= 0.3;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 700) >= 5;
      },
    },
  ),
  def(
    {
      id: 'rainOfAnvils',
      name: 'Rain of Anvils',
      short: 'RAIN OF ANVILS',
      description: '24 anvils fall over 3 s on a 600 m circle at the reticle (6 km): 12k each and a 1 s stun.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xffb050,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        for (let i = 0; i < 24; i++) {
          const a = game.rng() * Math.PI * 2;
          const r = Math.sqrt(game.rng()) * 600;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, radius: 95, delay: 0.6 + i * 0.12, damage: 12000, stun: 1, look: 'anvil' });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),

  // ------------------------------------------------------------------ Sparkrunner
  def(
    {
      id: 'overpressure',
      name: 'Overpressure',
      short: 'OVERPRESSURE',
      description: '5 s: boilers past the red line. 2x speed and the steam loaders fire the guns twice as fast; when it ends the safety valves blow a cloud of steam around you.',
      cooldown: 20,
      duration: 5,
      accent: 0xffa860,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2;
          m.turnMul *= 1.2;
          m.reloadMul *= 0.5;
        });
      },
      end(ship, game) {
        if (!ship.alive) return;
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          game.addSmoke(ship.pos.x + Math.cos(a) * 60, ship.pos.z + Math.sin(a) * 60, ship.team);
        }
        game.addSmoke(ship.pos.x, ship.pos.z, ship.team);
      },
      aiShouldUse(ship, game, target) {
        const reach = ship.spec.torpedoes?.range ?? 3000;
        return (hpFrac(ship) < 0.5 && underFire(ship, game, 700) >= 3) || (within(ship, target, reach * 1.5) && dist(ship, target!) > reach * 0.9);
      },
    },
  ),
  def(
    {
      id: 'clockworkMines',
      name: 'Clockwork Mines',
      short: 'CLOCKWORK MINES',
      description: 'Five clockwork mines paddle out along the reticle bearing up to 1 km and stay armed for 40 s, paddling after any enemy that comes within 400 m: 15k each and they flood.',
      cooldown: 18,
      duration: 0,
      accent: 0xe0a050,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 1000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const fx = forwardX(b);
        const fz = forwardZ(b);
        for (let i = 0; i < 5; i++) {
          const d = 250 + i * 190;
          const lat = (i % 2 ? 1 : -1) * 60;
          game.strikes.spawn(ship, { kind: 'mine', skill: st.spec, x: ship.pos.x + fx * d - fz * lat, z: ship.pos.z + fz * d + fx * lat, radius: 90, delay: 1 + d / 120, damage: 15000, flood: 0.6, life: 40, seek: 400, look: 'rune' });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1600);
      },
    },
  ),
  def(
    {
      id: 'boilerBomb',
      name: 'Boiler Bomb',
      short: 'BOILER BOMB',
      description: 'Light the fuse: 6 s at 2x speed. When it runs out, or you come within 250 m of an enemy hull, the boilers burst: 60k in 400 m with fires, at the cost of 30% of your own hull.',
      ult: true,
      cooldown: 80,
      duration: 6,
      accent: 0xff6a20,
      icon: 'nuke',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2;
          m.turnMul *= 1.3;
        });
      },
      update(ship, game, _dt, st) {
        // Getting close sets it off early.
        const touch = game.ships.some((s) => s.alive && s.team !== ship.team && !s.deep && dist(s, ship) < (s.spec.length + ship.spec.length) / 2 + 250);
        if (touch) st.time = 0;
        // A bot captain steers the lit boat at the nearest hull.
        const prey = isAI(ship) && nearestEnemy(ship, game, 2500);
        if (prey) ship.rudderTarget = clamp(wrapAngle(bearingTo(ship.pos.x, ship.pos.z, prey.pos.x, prey.pos.z) - ship.heading) * 2, -1, 1);
      },
      end(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 400, delay: 0, damage: 60000, fire: 1, look: 'fireball' });
        game.events.emit('explosion', { x: ship.pos.x, y: 6, z: ship.pos.z, size: 4 });
        ship.effects = ship.effects.filter((e) => e.id !== st.spec.id);
        if (ship.alive) spendHull(ship, 0.3);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1500) && hpFrac(ship) > 0.4;
      },
    },
  ),

  // ------------------------------------------------------------------ Gyrehold
  def(
    {
      id: 'firebombLoad',
      name: 'Firebomb Load',
      short: 'FIREBOMBS',
      description: 'The next gyrocopter dive squadron carries rune firebombs: every bomb that hits starts two fires.',
      cooldown: 16,
      duration: 0,
      accent: 0xff8a30,
      icon: 'plane',
    },
    {
      activate(ship, game, st) {
        if (!ship.spec.air) return false;
        ship.airBuff = {
          skill: st.spec,
          types: ['dive'],
          onHit: (t) => {
            t.startFire(Math.floor(game.rng() * 4), ship);
            t.startFire(Math.floor(game.rng() * 4), ship);
          },
        };
      },
      aiShouldUse(ship) {
        return !ship.airBuff && (ship.air?.hangar.dive ?? 0) >= (ship.spec.air?.dive.planes ?? 1);
      },
    },
  ),
  def(
    {
      id: 'warHorn',
      name: 'War Horn',
      short: 'WAR HORN',
      description: 'The horn of the clans sounds: you and allies within 1.5 km shake off every debuff and reload 30% faster for 8 s.',
      cooldown: 22,
      duration: 0,
      accent: 0xe8c080,
      icon: 'drums',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        for (const s of alliesWithin(ship, game, 1500)) {
          s.cleanse();
          buff(s, st.spec.id, 8, (m) => {
            m.reloadMul *= 0.7;
            m.torpReloadMul *= 0.7;
          });
        }
      },
      aiShouldUse(ship, game) {
        const near = alliesWithin(ship, game, 1500);
        return near.some(afflicted) || near.length >= 3;
      },
    },
  ),
  def(
    {
      id: 'skyhammerCarpet',
      name: 'Skyhammer Carpet',
      short: 'SKYHAMMER',
      description: '40 rune bombs walk a 2 km line through the reticle (7 km), along your bearing to it: 9k each, and they start fires.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xffa040,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const fx = forwardX(b);
        const fz = forwardZ(b);
        for (let i = 0; i < 40; i++) {
          const along = -1000 + (2000 * i) / 39;
          const lat = (game.rng() - 0.5) * 140;
          game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: p.x + fx * along - fz * lat, z: p.z + fz * along + fx * lat, radius: 80, delay: 1 + i * 0.06, damage: 9000, fire: 0.45, look: 'rune' });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800);
      },
    },
  ),

  // ------------------------------------------------------------------ Deepdelver
  def(
    {
      id: 'drillRam',
      name: 'Drill Ram',
      short: 'DRILL RAM',
      description: '5 s: the bow drill spins up, 2.2x speed even submerged. Ramming an enemy (at periscope depth or shallower) deals 40k and floods.',
      cooldown: 18,
      duration: 5,
      accent: 0xd0a070,
      icon: 'ram',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2.2;
          m.ram = Math.max(m.ram, 40000);
          m.ramSkill = st.spec;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 900) && hpFrac(ship) > 0.35;
      },
    },
  ),
  def(
    {
      id: 'seismicCharge',
      name: 'Seismic Charge',
      short: 'SEISMIC CHARGE',
      description: 'A charge settles on the seabed under the reticle (4 km) and erupts 3 s later: 25k in 200 m, flooding and a 2 s stun. It reaches submarines too.',
      cooldown: 16,
      duration: 0,
      accent: 0xc89060,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: p.x, z: p.z, radius: 200, delay: 3, damage: 25000, flood: 0.8, stun: 2, hitsSubs: true, look: 'quake' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3000);
      },
    },
  ),
  def(
    {
      id: 'earthquake',
      name: 'Earthquake',
      short: 'EARTHQUAKE',
      description: 'The seabed splits along the reticle bearing for 2.5 km: a second later every enemy hull on the fault takes 50k, floods and is stunned 3 s.',
      ult: true,
      cooldown: 85,
      duration: 1.2,
      accent: 0xe0a060,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 2500);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const x1 = ship.pos.x + forwardX(b) * 2500;
        const z1 = ship.pos.z + forwardZ(b) * 2500;
        st.data.line = [ship.pos.x, ship.pos.z, x1, z1];
        // The fault opens as a line of eruptions (the damage comes with the last of them).
        for (let i = 0; i < 14; i++) {
          const k = (i + 1) / 14;
          game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: ship.pos.x + (x1 - ship.pos.x) * k, z: ship.pos.z + (z1 - ship.pos.z) * k, radius: 70, delay: 0.2 + k * 0.8, damage: 0, look: 'quake' });
        }
      },
      end(ship, game, st) {
        const [x0, z0, x1, z1] = st.data.line as number[];
        for (const s of enemiesOnLine(ship, game, x0, z0, x1, z1, 70)) {
          hurt(ship, s, 50000, st.spec);
          s.startFlood(ship);
          if (s.alive) stun(s, 3);
        }
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 2400)) return false;
        return enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, target.pos.x, target.pos.z, 120).length >= 1;
      },
    },
  ),
];
