import { dist2D } from '../../core/math';
import { canTrack } from '../../core/Targeting';
import { homingSpread } from '../historic/light';
import {
  aimPoint,
  alliesWithin,
  buff,
  dist,
  enemiesWithin,
  hpFrac,
  stun,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { airStrike, dropLocks, enemiesAround, every, reticleTarget } from './common';

// United States Navy: Arsenal, Zumwalt, Arleigh Burke, Gerald R. Ford, Virginia.
// A networked missile fleet.

export const USN_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Arsenal
  def(
    {
      id: 'battleGroupLink',
      name: 'Battle Group Link',
      short: 'GROUP LINK',
      description: '10 s: you and allies within 2 km share one fire-control picture. Guns and cells reload 25% faster and gun salvos group 20% tighter.',
      cooldown: 24,
      duration: 10,
      accent: 0x60b0ff,
      icon: 'fleet',
      zone: 2000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        for (const s of alliesWithin(ship, game, 2000)) {
          buff(s, st.spec.id, 0.6, (m) => {
            m.reloadMul *= 0.75;
            m.missileReloadMul *= 0.75;
            m.dispersionMul *= 0.8;
          });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, ship.mainRange) && alliesWithin(ship, game, 2000).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'rippleFire',
      name: 'Ripple Fire',
      short: 'RIPPLE FIRE',
      description: 'The cells reload at once, and the next salvo carries twice the missiles.',
      cooldown: 26,
      duration: 0,
      accent: 0xffb050,
      icon: 'missile',
    },
    {
      activate(ship, _g, st) {
        const ms = ship.spec.missiles;
        if (!ms || !ship.vls) return false;
        ship.vls.reload = 0;
        ship.vlsBuff = { skill: st.spec, extra: ms.salvo };
      },
      aiShouldUse(ship, _g, target) {
        const ms = ship.spec.missiles;
        return !!ms && !!ship.vls && ship.vls.reload > 4 && within(ship, target, ms.range * 0.9) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'fullArsenal',
      name: 'Full Arsenal',
      short: 'FULL ARSENAL',
      description: '8 s: every cell empties. A missile leaves every quarter second (32 in all) for the enemies nearest the reticle, 4.5k each.',
      ult: true,
      cooldown: 90,
      duration: 8,
      accent: 0xff8030,
      icon: 'salvo',
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        const p = aimPoint(ship, 6000);
        const prey = enemiesAround(ship, game, p.x, p.z, 2500).slice(0, 4);
        const n = (st.data.n = ((st.data.n as number | undefined) ?? 0) + 1);
        const t = prey.length ? prey[n % prey.length] : null;
        game.missiles.launch(ship, t?.pos.x ?? p.x, t?.pos.z ?? p.z, 0, 4500, { profile: 'cruise', target: t, skill: st.spec, fire: 0.25 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800) && !target.submerged;
      },
    },
  ),

  // ------------------------------------------------------------------ Zumwalt
  def(
    {
      id: 'lrlapBarrage',
      name: 'LRLAP Barrage',
      short: 'LRLAP',
      description: 'Twelve rocket-assisted guided shells arc onto the ship under the reticle (6 km): 2.6k each, and they cannot be shot down.',
      cooldown: 18,
      duration: 0,
      accent: 0xffd070,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const lock = reticleTarget(ship, game, 6000);
        for (let i = 0; i < 12; i++) {
          game.missiles.launch(ship, p.x, p.z, i * 0.15, 2600, { profile: 'ballistic', speed: 650, uninterceptable: true, blast: 45, fire: 0.1, target: lock, skill: st.spec });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'stealthProfile',
      name: 'Stealth Profile',
      short: 'STEALTH',
      description: '10 s: the tumblehome hull all but vanishes from radar. Outside 500 m proximity detection, missiles, homing torpedoes and skill locks lose you. Guns laid on you scatter 1.6x wider.',
      cooldown: 26,
      duration: 10,
      accent: 0x8090a0,
      icon: 'cloak',
    },
    {
      activate(ship, game) {
        dropLocks(ship, game, 'stealth');
      },
      update(ship, game, dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.lockRange = 1;
          m.scatterTakenMul *= 1.6;
        });
        if (every(st, dt, 0.5)) dropLocks(ship, game, 'stealth');
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 800) >= 4;
      },
    },
  ),
  def(
    {
      id: 'emRailgun',
      name: 'EM Railgun',
      short: 'RAILGUN',
      description: 'The reactor dumps into the rails: a 32 MJ slug down the reticle bearing, 60k to every hull on a 6 km line.',
      ult: true,
      cooldown: 85,
      duration: 1.4,
      accent: 0x80e8ff,
      icon: 'rod',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 1, time: 0.35, dps: 0, length: 6000, width: 26, pierce: true, strike: 60000, rate: 0 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5500) && !target.submerged;
      },
    },
  ),

  // ------------------------------------------------------------------ Arleigh Burke
  def(
    {
      id: 'spy6Track',
      name: 'SPY-6 Track',
      short: 'SPY-6',
      description: '10 s: the radar guides every missile you fire to the end. None can be shot down, and they hit 30% harder.',
      cooldown: 24,
      duration: 10,
      accent: 0x70c0ff,
      icon: 'radar',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.missileSure = true;
          m.missileDamageMul *= 1.3;
        });
      },
      aiShouldUse(ship, _g, target) {
        const ms = ship.spec.missiles;
        return !!ms && !!ship.vls && ship.vls.reload <= 1 && within(ship, target, ms.range * 0.9) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'flankSpeed',
      name: 'Flank Speed',
      short: 'FLANK SPEED',
      description: '8 s at 1.4x speed with a 1.5x rudder. Tubes and cells reload 40% faster, and what is reloading now catches up.',
      cooldown: 22,
      duration: 8,
      accent: 0x9fe0ff,
      icon: 'speed',
    },
    {
      activate(ship) {
        for (const l of ship.launchers) l.reload *= 0.6;
        if (ship.vls) ship.vls.reload *= 0.6;
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 1.4;
          m.turnMul *= 1.5;
          m.torpReloadMul *= 0.6;
          m.missileReloadMul *= 0.6;
        });
      },
      aiShouldUse(ship, game, target) {
        return (within(ship, target, 4000) && !within(ship, target, 2000)) || (hpFrac(ship) < 0.4 && underFire(ship, game, 800) >= 3);
      },
    },
  ),
  def(
    {
      id: 'seahawkHunt',
      name: 'Seahawk Hunt',
      short: 'SEAHAWK HUNT',
      description: 'MH-60R helicopters hunt the three nearest enemies within 3.5 km: four Hellfires (3k each) and a Mk 54 torpedo (9k, finds a submarine at any depth) on each.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xb0d060,
      icon: 'plane',
      zone: 3500,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 3500, false)
          .filter((s) => !s.mods.banished)
          .sort((a, b) => dist(a, ship) - dist(b, ship))
          .slice(0, 3);
        if (!prey.length) return false;
        for (const t of prey) {
          for (let i = 0; i < 4; i++) {
            if (!t.submerged) game.missiles.launch(ship, t.pos.x, t.pos.z, 1 + i * 0.3, 3000, { profile: 'skim', speed: 240, blast: 40, fire: 0.2, target: t, skill: st.spec });
          }
        }
        homingSpread(ship, game, st.spec, prey.length, prey, { damage: 9000, speed: 55, range: 4500, floodChance: 0.4 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3300, false).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Gerald R. Ford
  def(
    {
      id: 'emalsSurge',
      name: 'EMALS Surge',
      short: 'EMALS',
      description: '12 s: the electromagnetic catapults run flat out. No deck cooldown between launches.',
      cooldown: 30,
      duration: 12,
      accent: 0x80c8ff,
      icon: 'plane',
    },
    {
      activate() {},
      update(ship) {
        if (ship.air) ship.air.cooldown = 0;
      },
      aiShouldUse(ship, _g, target) {
        const air = ship.spec.air;
        const st = ship.air;
        return !!air && !!st && within(ship, target, air.range * 0.9) && st.hangar.torpedo + st.hangar.dive >= air.torpedo.planes * 2;
      },
    },
  ),
  def(
    {
      id: 'growlerJamming',
      name: 'Growler Jamming',
      short: 'JAMMING',
      description: '8 s: EA-18G Growlers jam 1.5 km round the reticle (9 km). Enemies inside scatter their guns twice as wide and their missiles fly blind.',
      cooldown: 24,
      duration: 0,
      accent: 0xc080ff,
      icon: 'radar',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 9000);
        game.fields.add(ship, {
          x: p.x,
          z: p.z,
          r: 1500,
          life: 8,
          skill: st.spec,
          look: 'storm',
          color: st.spec.accent,
          scatter: 2,
          onTick(s) {
            if (s.team === ship.team) return;
            for (const m of game.missiles.missiles) if (m.alive && m.owner === s) m.target = null;
          },
        });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 8500) && enemiesAround(ship, game, target.pos.x, target.pos.z, 1500).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'stealthStrike',
      name: 'Stealth Strike',
      short: 'STEALTH STRIKE',
      description: 'F-35Cs no flak can see strike every enemy within 1.5 km of the reticle at once, about 20k each.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x90a0b0,
      icon: 'plane',
    },
    {
      activate(ship, game, st) {
        const air = ship.spec.air;
        if (!air) return false;
        const p = aimPoint(ship, air.range);
        const prey = enemiesAround(ship, game, p.x, p.z, 1500).filter((s) => !s.deep);
        if (!prey.length) return false;
        for (const t of prey.slice(0, 6)) airStrike(ship, game, 'dive', t, 20000, st.spec, { aaImmune: 60 });
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.deep && enemiesAround(ship, game, target.pos.x, target.pos.z, 1500).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Virginia
  def(
    {
      id: 'wireGuided',
      name: 'Wire-Guided',
      short: 'WIRE GUIDED',
      description: 'The next spread stays on the wire: the fish steer along your reticle for as long as you live, and run 20% faster.',
      cooldown: 18,
      duration: 0,
      accent: 0x80ffd0,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        ship.torpBuff = { skill: st.spec, speedMul: 1.2, spreads: 1, homing: false, wire: true };
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && !ship.torpBuff && within(ship, target, t.range * 0.8) && ship.launchers.some((l) => l.reload <= 0);
      },
    },
  ),
  def(
    {
      id: 'captorField',
      name: 'CAPTOR Field',
      short: 'CAPTOR',
      description: 'Four encapsulated torpedo mines at the reticle (4 km), armed for 40 s. Each runs down the first enemy within 600 m: 14k and flooding.',
      cooldown: 24,
      duration: 0,
      accent: 0x60d0a0,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          game.strikes.spawn(ship, { kind: 'mine', skill: st.spec, x: p.x + Math.cos(a) * 180, z: p.z + Math.sin(a) * 180, radius: 70, delay: 1.5, damage: 14000, flood: 0.6, life: 40, seek: 600, seekSpeed: 40 });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  def(
    {
      id: 'sealBoarding',
      name: 'SEAL Boarding',
      short: 'SEAL TEAM',
      description: 'A SEAL team swims out and boards the ship under the reticle (1.5 km): 10k, a 6 s stun, two fires and flooding.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xd0d0a0,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 1500, 600);
        if (!t || dist2D(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z) > 1600) return false;
        game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 1.2 });
        t.takeDamage(10000 * ship.mods.damageMul * ship.mods.ultDamageMul, ship, st.spec);
        stun(t, 6);
        t.startFire(0, ship);
        t.startFire(2, ship);
        t.startFlood(ship);
        return undefined;
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1400) && canTrack(ship, target);
      },
    },
  ),
];
