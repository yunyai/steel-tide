import { DEG, bearingTo, dist2D } from '../../core/math';
import type { TorpedoSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import type { Torpedo } from '../../weapons/TorpedoSystem';
import { homingSpread } from '../historic/light';
import {
  aimPoint,
  alliesWithin,
  buff,
  dist,
  enemiesWithin,
  hpFrac,
  intercept,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { airStrike, dropLocks, enemiesAround, every, reticleTarget } from './common';

// Russian Navy: Admiral Nakhimov, Marshal Ustinov, Sovremenny, Admiral Kuznetsov, Belgorod.
// Hypersonic heavy hitters.

/** The supercavitating rocket-torpedo (Shkval) and the nuclear drone (Poseidon), in battle units. */
const SHKVAL: TorpedoSpec = { name: 'Shkval', launchers: [], tubes: 1, reload: 0, speed: 200, range: 4500, damage: 15000, floodChance: 0.4, spread: 0, detect: 1200 };
const POSEIDON: TorpedoSpec = { name: 'Poseidon', launchers: [], tubes: 1, reload: 0, speed: 200, range: 5000, damage: 20000, floodChance: 1, spread: 0, detect: 2000 };

export const RU_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Admiral Nakhimov
  def(
    {
      id: 'zircon',
      name: 'Zircon',
      short: 'ZIRCON',
      description: 'One 3M22 Zircon at the ship under the reticle (8 km): Mach 9 in the dive, nothing can stop it, 22k.',
      cooldown: 18,
      duration: 0,
      accent: 0xffe060,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        const lock = reticleTarget(ship, game, 8000);
        game.missiles.launch(ship, p.x, p.z, 0, 22000, { profile: 'hyper', uninterceptable: true, blast: 60, fire: 0.5, target: lock, skill: st.spec });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7800) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'reactorOverdrive',
      name: 'Reactor Overdrive',
      short: 'OVERDRIVE',
      description: '8 s: both reactors past the red line. 1.5x speed, and the cells reload three times as fast.',
      cooldown: 26,
      duration: 8,
      accent: 0xff6040,
      icon: 'speed',
    },
    {
      activate(ship) {
        if (ship.vls) ship.vls.reload /= 3;
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 1.5;
          m.missileReloadMul /= 3;
        });
      },
      aiShouldUse(ship, game, target) {
        return (!!ship.vls && ship.vls.reload > 8 && within(ship, target, 7000)) || (hpFrac(ship) < 0.35 && underFire(ship, game, 800) >= 3);
      },
    },
  ),
  def(
    {
      id: 'granitWolfpack',
      name: 'Granit Wolfpack',
      short: 'GRANIT',
      description: 'Sixteen P-700 Granits split among the four largest enemies within 7 km: 8k each, and their armoured airframes take three times the flak to bring down.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0xff9040,
      icon: 'salvo',
      zone: 7000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 7000)
          .filter((s) => !s.submerged)
          .sort((a, b) => b.maxHp - a.maxHp)
          .slice(0, 4);
        if (!prey.length) return false;
        for (let i = 0; i < 16; i++) {
          const t = prey[i % prey.length];
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.15, 8000, { profile: 'skim', speed: 340, hp: 1500, fire: 0.4, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 6800).filter((s) => !s.submerged).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Marshal Ustinov
  def(
    {
      id: 'vulkanSalvo',
      name: 'Vulkan Salvo',
      short: 'VULKAN',
      description: 'Sixteen P-1000 Vulkans blanket 300 m round the reticle (7 km): 5k each, with a 30% chance to start a fire.',
      cooldown: 18,
      duration: 0,
      accent: 0xff7040,
      icon: 'salvo',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        for (let i = 0; i < 16; i++) {
          const a = game.rng() * Math.PI * 2;
          const r = Math.sqrt(game.rng()) * 300;
          game.missiles.launch(ship, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, i * 0.1, 5000, { profile: 'cruise', blast: 90, fire: 0.3, skill: st.spec });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6000) && !target.submerged && target.speed < 25;
      },
    },
  ),
  def(
    {
      id: 'decoyBarrage',
      name: 'Decoy Barrage',
      short: 'DECOYS',
      description: '8 s: chaff rockets and towed decoys. Missiles and homing torpedoes guided at you, or at allies within 1.5 km, veer off onto them.',
      cooldown: 24,
      duration: 8,
      accent: 0xc0c0c0,
      icon: 'cloak',
      zone: 1500,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of alliesWithin(ship, game, 1500)) dropLocks(s, game);
      },
      aiShouldUse(ship, game) {
        let n = 0;
        for (const m of game.missiles.missiles) if (m.alive && m.team !== ship.team && m.target && m.target.team === ship.team && dist(m.target, ship) < 1500) n++;
        for (const t of game.torps.torps) if (t.alive && t.team !== ship.team && t.homing && t.homing.team === ship.team && dist(t.homing, ship) < 1500) n += 2;
        return n >= 4;
      },
    },
  ),
  def(
    {
      id: 'shkvalWall',
      name: 'Shkval Wall',
      short: 'SHKVAL',
      description: 'Twelve VA-111 Shkval rocket-torpedoes race out in a wide fan along the reticle bearing at 200 knots: 15k each.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0x80e0ff,
      icon: 'torpedo',
    },
    {
      activate(ship, game, st) {
        const p = ship.localToWorld(ship.spec.length * 0.4, 0, 0);
        const brg = bearingTo(p.x, p.z, ship.control.aimX, ship.control.aimZ);
        for (let i = 0; i < 12; i++) {
          const t = game.torps.launch(ship, p.x, p.z, brg + (i / 11 - 0.5) * 34 * DEG, SHKVAL);
          t.skill = st.spec;
        }
        game.events.emit('torpLaunched', { ship, x: p.x, z: p.z, count: 12 });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 3800) && enemiesAround(ship, game, target.pos.x, target.pos.z, 1200).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Sovremenny
  def(
    {
      id: 'terminalWeave',
      name: 'Terminal Weave',
      short: 'WEAVE',
      description: 'The Moskit launchers reload at once. The next salvo jinks through the last mile (nothing can shoot it down), and each hit has an even chance to flood.',
      cooldown: 22,
      duration: 0,
      accent: 0xffc060,
      icon: 'missile',
    },
    {
      activate(ship, _g, st) {
        if (!ship.vls) return false;
        ship.vls.reload = 0;
        ship.vlsBuff = { skill: st.spec, opts: { uninterceptable: true, flood: 0.5 } };
      },
      aiShouldUse(ship, _g, target) {
        const ms = ship.spec.missiles;
        return !!ms && !!ship.vls && ship.vls.reload > 3 && within(ship, target, ms.range * 0.9) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'suppressionFire',
      name: 'Suppression Fire',
      short: 'SUPPRESSION',
      description: '8 s: the AK-130s slew instantly and reload 20% faster. Every hit slows its target 15% for 4 s, stacking to 60%.',
      cooldown: 22,
      duration: 8,
      accent: 0xffa050,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        const stacks = new Map<number, number>();
        st.data.stacks = stacks;
        ship.salvo = {
          skill: st.spec,
          left: 999,
          dispersionMul: 1,
          damageMul: 1,
          railgun: false,
          guaranteedFire: false,
          cluster: false,
          onHit(target: Ship) {
            const n = Math.min(4, (stacks.get(target.id) ?? 0) + 1);
            stacks.set(target.id, n);
            buff(target, 'debuff:suppressed', 4, (m) => {
              m.speedMul *= 1 - 0.15 * n;
            });
          },
        };
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.traverseMul *= 20;
          m.reloadMul *= 0.8;
        });
      },
      end(ship, _g, st) {
        if (ship.salvo?.skill === st.spec) ship.salvo = null;
      },
      aiShouldUse(ship, _g, target) {
        return targetInRange(ship, target);
      },
    },
  ),
  def(
    {
      id: 'mosquitoFleet',
      name: 'Mosquito Fleet',
      short: 'MOSQUITO FLEET',
      description: 'Six Tarantul missile boats join you for 30 s, each with a pair of Moskits and a quick 76 mm gun.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff8060,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        for (let i = 0; i < 6; i++) {
          const side = i % 2 ? 1 : -1;
          game.spawnWingman(ship, side * (60 + Math.floor(i / 2) * 55), 30, -70 - Math.floor(i / 2) * 50, 'tarantul', `${ship.name} Tarantul ${i + 1}`);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Admiral Kuznetsov
  def(
    {
      id: 'skiJumpScramble',
      name: 'Ski-Jump Scramble',
      short: 'SCRAMBLE',
      description: 'A fighter flight and a strike flight leave the ski-jump together for the reticle, deck cooldown or not.',
      cooldown: 24,
      duration: 0,
      accent: 0x90c0ff,
      icon: 'plane',
    },
    {
      activate(ship, game) {
        const air = ship.spec.air;
        if (!air) return false;
        const p = aimPoint(ship, air.range);
        const a = game.air.launch(ship, 'fighter', p.x, p.z);
        const b = game.air.launch(ship, 'dive', p.x, p.z);
        if (!a && !b) return false;
      },
      aiShouldUse(ship, _g, target) {
        const air = ship.spec.air;
        return !!air && !!ship.air && within(ship, target, air.range * 0.8) && ship.air.hangar.dive >= air.dive.planes;
      },
    },
  ),
  def(
    {
      id: 'kashtanBastion',
      name: 'Kashtan Bastion',
      short: 'KASHTAN',
      description: '8 s: the Kashtan mounts fire at everything within 1.6 km. Enemy hulls take 2.5k a second and planes are torn from the sky.',
      cooldown: 24,
      duration: 8,
      accent: 0xffd040,
      icon: 'flak',
      zone: 1600,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 1600, life: st.spec.duration, skill: st.spec, look: 'circle', color: st.spec.accent, follow: ship, dps: 2500 });
      },
      update(ship, game, dt) {
        intercept(ship, game, ship.pos.x, ship.pos.z, 1600, dt, { missiles: true, planes: 6000 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1500).length >= 1 || game.air.squadrons.some((q) => q.alive && q.team !== ship.team && Math.hypot(q.x - ship.pos.x, q.z - ship.pos.z) < 1500);
      },
    },
  ),
  def(
    {
      id: 'redBannerRegiment',
      name: 'Red Banner Regiment',
      short: 'RED BANNER',
      description: 'Su-33 flights strike up to five enemies within 4 km of the reticle, a flight to each: about 14k and fires.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff5050,
      icon: 'plane',
    },
    {
      activate(ship, game, st) {
        const air = ship.spec.air;
        if (!air) return false;
        const p = aimPoint(ship, air.range);
        const prey = enemiesAround(ship, game, p.x, p.z, 4000).filter((s) => !s.deep).slice(0, 5);
        if (!prey.length) return false;
        for (const t of prey) airStrike(ship, game, 'dive', t, 14000, st.spec, { fire: 0.5 });
      },
      aiShouldUse(ship, _g, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.deep;
      },
    },
  ),

  // ------------------------------------------------------------------ Belgorod
  def(
    {
      id: 'type65',
      name: 'Type 65',
      short: 'TYPE 65',
      description: 'One 650 mm wake-homing torpedo for the ship under the reticle: 30k, and it finds a submarine at any depth.',
      cooldown: 20,
      duration: 0,
      accent: 0x60c0ff,
      icon: 'torpedo',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 6000, 700);
        homingSpread(ship, game, st.spec, 1, t ? [t] : [], { damage: 30000, speed: 55, range: 6000, floodChance: 0.6 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5000);
      },
    },
  ),
  def(
    {
      id: 'crashDive',
      name: 'Crash Dive',
      short: 'CRASH DIVE',
      description: 'Flood every tank: straight down to full depth, and untouchable for 3 s on the way.',
      cooldown: 22,
      duration: 3,
      accent: 0x4080c0,
      icon: 'cloak',
    },
    {
      activate(ship) {
        const sub = ship.spec.sub;
        if (!sub || ship.battery < 5) return false;
        ship.depthState = 2;
        ship.pos.y = sub.deepDepth;
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.invulnerable = true;
        });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.5 && underFire(ship, game, 600) >= 3;
      },
    },
  ),
  def(
    {
      id: 'poseidon',
      name: 'Poseidon',
      short: 'POSEIDON',
      description: 'A nuclear torpedo drone runs for the reticle (5 km) at 200 knots and goes off on the first hull or at the mark: 150k in 450 m, falling off, flooding everything and throwing hulls back.',
      ult: true,
      cooldown: 95,
      duration: 30,
      accent: 0xb0ffb0,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const from = ship.localToWorld(ship.spec.length * 0.45, 0, 0);
        const t = game.torps.launch(ship, from.x, from.z, bearingTo(from.x, from.z, p.x, p.z), { ...POSEIDON, range: Math.max(300, dist2D(from.x, from.z, p.x, p.z)) });
        t.skill = st.spec;
        t.deep = true;
        st.data.torp = t;
        game.events.emit('torpLaunched', { ship, x: from.x, z: from.z, count: 1 });
      },
      update(ship, game, _dt, st) {
        const t = st.data.torp as Torpedo;
        if (t.alive && t.travelled < t.range - 5) return;
        t.alive = false;
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: t.x, z: t.z, radius: 450, delay: 0, damage: 150000, flood: 1, knock: 70, hitsSubs: true });
        st.time = 0;
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 4200) && enemiesAround(ship, game, target.pos.x, target.pos.z, 500).length >= 2;
      },
    },
  ),
];

function targetInRange(ship: Ship, target: Ship | null): boolean {
  return within(ship, target, ship.mainRange * 0.9) && !target.submerged;
}
