import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  buff,
  enemiesWithin,
  intercept,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { enemiesAround, every, reticleTarget } from './common';

// People's Liberation Army Navy: Zhenyuan, Nanchang, Kunming, Fujian, Type 093B.
// Saturation and swarms.

/** Bring the ship's guns into play for a skill that rides on its salvos for a while. */
function salvoWatch(ship: Ship, skill: SkillSpec, onHit: (target: Ship) => void): void {
  ship.salvo = { skill, left: 999, dispersionMul: 1, damageMul: 1, railgun: false, guaranteedFire: false, cluster: false, onHit };
}

export const CN_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Zhenyuan
  def(
    {
      id: 'swarmSalvo',
      name: 'Swarm Salvo',
      short: 'SWARM SALVO',
      description: 'Twenty-four micro-missiles split across every enemy within 2.5 km of the reticle (8 km): 3k each.',
      cooldown: 18,
      duration: 0,
      accent: 0xff6050,
      icon: 'salvo',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        const prey = enemiesAround(ship, game, p.x, p.z, 2500).filter((s) => !s.submerged);
        for (let i = 0; i < 24; i++) {
          const t = prey.length ? prey[i % prey.length] : null;
          const sx = t ? 0 : (game.rng() - 0.5) * 400;
          const sz = t ? 0 : (game.rng() - 0.5) * 400;
          game.missiles.launch(ship, (t?.pos.x ?? p.x) + sx, (t?.pos.z ?? p.z) + sz, i * 0.06, 3000, { profile: 'skim', speed: 330, blast: 50, fire: 0.1, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 7500) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 2500).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'coilgunMode',
      name: 'Coilgun Mode',
      short: 'COILGUN',
      description: '10 s: the main guns switch to coil acceleration. Shells fly twice as fast and flat, and turrets train 50% faster.',
      cooldown: 24,
      duration: 10,
      accent: 0x60e0ff,
      icon: 'rod',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.flatShots = Math.max(m.flatShots, 2);
          m.traverseMul *= 1.5;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, ship.mainRange * 0.95) && !within(ship, target, ship.mainRange * 0.4);
      },
    },
  ),
  def(
    {
      id: 'a2adBubble',
      name: 'A2/AD Bubble',
      short: 'A2/AD',
      description: '12 s: anti-access bubble 3 km wide. Every enemy inside draws a missile from your cells each 1.5 s (5k), and enemy planes in the bubble fall.',
      ult: true,
      cooldown: 90,
      duration: 12,
      accent: 0xff4040,
      icon: 'radar',
      zone: 3000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        intercept(ship, game, ship.pos.x, ship.pos.z, 3000, dt, { planes: 8000 });
        if (!every(st, dt, 1.5)) return;
        for (const t of enemiesWithin(ship, game, 3000).filter((s) => !s.submerged).slice(0, 8)) {
          game.missiles.launch(ship, t.pos.x, t.pos.z, game.rng() * 0.4, 5000, { profile: 'cruise', fire: 0.2, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).filter((s) => !s.submerged).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Nanchang
  def(
    {
      id: 'loiteringMunitions',
      name: 'Loitering Munitions',
      short: 'LOITERING',
      description: 'Eight drones hold over the reticle (7 km) for 10 s, diving on whatever comes within 400 m: 6k each.',
      cooldown: 22,
      duration: 10,
      accent: 0xffa060,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        st.data.x = p.x;
        st.data.z = p.z;
        st.data.left = 8;
        st.data.tick = 1;
        game.fields.add(ship, { x: p.x, z: p.z, r: 400, life: st.spec.duration, skill: st.spec, look: 'swarm', color: st.spec.accent });
      },
      update(ship, game, dt, st) {
        if ((st.data.left as number) <= 0 || !every(st, dt, 1.2)) return;
        const t = enemiesAround(ship, game, st.data.x as number, st.data.z as number, 400)[0];
        if (!t) return;
        st.data.left = (st.data.left as number) - 1;
        // A diving drone leads its prey a little.
        const lead = t.speed * 0.5;
        game.strikes.spawn(ship, { kind: 'rocket', skill: st.spec, x: t.pos.x + forwardX(t.heading) * lead, z: t.pos.z + forwardZ(t.heading) * lead, radius: 70, delay: 0.5, damage: 6000, fire: 0.2 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6500) && !target.submerged && target.speed < 30;
      },
    },
  ),
  def(
    {
      id: 'datalink',
      name: 'Datalink',
      short: 'DATALINK',
      description: '10 s: allies within 2 km (you too) join your targeting network: +20% missile and torpedo damage, and cells and tubes reload 20% faster.',
      cooldown: 24,
      duration: 10,
      accent: 0x70ff90,
      icon: 'fleet',
      zone: 2000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        for (const s of alliesWithin(ship, game, 2000)) {
          buff(s, st.spec.id, 0.6, (m) => {
            m.missileDamageMul *= 1.2;
            m.torpDamageMul *= 1.2;
            m.missileReloadMul *= 0.8;
            m.torpReloadMul *= 0.8;
          });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 6000) && alliesWithin(ship, game, 2000).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'carrierKiller',
      name: 'Carrier Killer',
      short: 'CARRIER KILLER',
      description: 'A DF-21D plunges onto the ship under the reticle (9 km) about 4 s after launch: 85k to a hull 200 m long or more, 42k to anything smaller. Nothing can stop it.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0xff3030,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 9000);
        const lock = reticleTarget(ship, game, 9000, 600);
        const big = !!lock && lock.spec.length >= 200;
        const d = dist2D(ship.pos.x, ship.pos.z, p.x, p.z);
        game.missiles.launch(ship, p.x, p.z, 0, big ? 85000 : 42000, { profile: 'ballistic', speed: Math.max(400, d / 3.5), uninterceptable: true, blast: 90, fire: 0.6, target: lock, skill: st.spec });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 8800) && !target.submerged && target.spec.length >= 150;
      },
    },
  ),

  // ------------------------------------------------------------------ Kunming
  def(
    {
      id: 'overwhelm',
      name: 'Overwhelm',
      short: 'OVERWHELM',
      description: '8 s: every shell hit you land takes a second off your cell and tube reloads.',
      cooldown: 20,
      duration: 8,
      accent: 0xffd060,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        salvoWatch(ship, st.spec, () => {
          if (ship.vls) ship.vls.reload -= 1;
          for (const l of ship.launchers) l.reload -= 1;
        });
      },
      end(ship, _g, st) {
        if (ship.salvo?.skill === st.spec) ship.salvo = null;
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, ship.mainRange * 0.8) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'driftTurn',
      name: 'Drift Turn',
      short: 'DRIFT TURN',
      description: '5 s: the rudder answers at once and the turning circle halves.',
      cooldown: 16,
      duration: 5,
      accent: 0x9fe8ff,
      icon: 'gale',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        ship.rudder = ship.rudderTarget;
        buff(ship, st.spec.id, 0.3, (m) => {
          m.turnMul *= 2;
        });
      },
      aiShouldUse(ship, game) {
        let n = 0;
        for (const t of game.torps.torps) if (t.alive && t.team !== ship.team && Math.hypot(t.x - ship.pos.x, t.z - ship.pos.z) < 900) n++;
        return n >= 1;
      },
    },
  ),
  def(
    {
      id: 'swarmWave',
      name: 'Swarm Wave',
      short: 'SWARM WAVE',
      description: 'Sixteen drone boats race out and ram every enemy within 3 km: 8k each, and they flood what they hit.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff9060,
      icon: 'drone',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 3000).filter((s) => !s.submerged);
        if (!prey.length) return false;
        for (let i = 0; i < 16; i++) {
          const t = prey[i % prey.length];
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.12, 8000, { profile: 'skim', look: 'drone', speed: 95, uninterceptable: true, blast: 40, fire: 0, flood: 0.5, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2500).filter((s) => !s.submerged).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Fujian
  def(
    {
      id: 'j35Sweep',
      name: 'J-35 Sweep',
      short: 'J-35 SWEEP',
      description: 'Stealth fighters sweep 1.2 km round the reticle for 6 s: every enemy plane inside falls, and enemy ships inside are strafed for 2.4k a second.',
      cooldown: 22,
      duration: 6,
      accent: 0xff7060,
      icon: 'plane',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, ship.spec.air?.range ?? 6000);
        st.data.x = p.x;
        st.data.z = p.z;
        game.fields.add(ship, { x: p.x, z: p.z, r: 1200, life: st.spec.duration, skill: st.spec, look: 'swarm', color: st.spec.accent, dps: 2400 });
      },
      update(ship, game, dt, st) {
        intercept(ship, game, st.data.x as number, st.data.z as number, 1200, dt, { planes: 15000 });
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && enemiesAround(ship, game, target.pos.x, target.pos.z, 1200).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'droneCover',
      name: 'Drone Cover',
      short: 'DRONE COVER',
      description: '10 s: six attack drones circle you, and one dives on any enemy within 1.2 km every 1.5 s: 4k each.',
      cooldown: 22,
      duration: 10,
      accent: 0xffb070,
      icon: 'drone',
      zone: 1200,
    },
    {
      activate(_ship, _g, st) {
        st.data.left = 6;
      },
      update(ship, game, dt, st) {
        if ((st.data.left as number) <= 0 || !every(st, dt, 1.5)) return;
        const t = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 1200).filter((s) => !s.submerged)[0];
        if (!t) return;
        st.data.left = (st.data.left as number) - 1;
        game.missiles.launch(ship, t.pos.x, t.pos.z, 0, 4000, { profile: 'skim', look: 'drone', speed: 200, blast: 40, fire: 0.2, target: t, skill: st.spec });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1500).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'dragonSwarm',
      name: 'Dragon Swarm',
      short: 'DRAGON SWARM',
      description: 'Sixty drones fall on every enemy within 2 km of the reticle, six to a ship: 3.4k a drone. Flak can thin them out.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff5040,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, ship.spec.air?.range ?? 6000);
        const prey = enemiesAround(ship, game, p.x, p.z, 2000).filter((s) => !s.submerged).slice(0, 10);
        if (!prey.length) return false;
        let i = 0;
        for (const t of prey) {
          for (let k = 0; k < 6; k++) {
            const a = bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
            game.missiles.launch(ship, t.pos.x + Math.sin(a + k) * 30, t.pos.z + Math.cos(a + k) * 30, i++ * 0.05, 3400, { profile: 'cruise', look: 'drone', speed: 230, blast: 40, fire: 0.15, target: t, skill: st.spec });
          }
        }
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 2000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Type 093B
  def(
    {
      id: 'yj18PopUp',
      name: 'YJ-18 Pop-Up',
      short: 'YJ-18',
      description: 'Two YJ-18s leave the tubes for the ship under the reticle (7 km). They cruise low, then sprint the last stretch at Mach 3: 9k each.',
      cooldown: 18,
      duration: 0,
      accent: 0xffb040,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        const lock = reticleTarget(ship, game, 7000, 600);
        for (let i = 0; i < 2; i++) game.missiles.launch(ship, p.x, p.z, i * 0.4, 9000, { profile: 'hyper', speed: 650, blast: 60, fire: 0.3, target: lock, skill: st.spec });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'acousticLock',
      name: 'Acoustic Lock',
      short: 'ACOUSTIC LOCK',
      description: '15 s: every spread you fire homes on the ship nearest the reticle and hits 30% harder.',
      cooldown: 26,
      duration: 15,
      accent: 0x60ffd0,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        ship.torpBuff = { skill: st.spec, speedMul: 1, spreads: 99, homing: true, damageMul: 1.3 };
      },
      end(ship, _g, st) {
        if (ship.torpBuff?.skill === st.spec) ship.torpBuff = null;
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.8) && ship.launchers.some((l) => l.reload <= 0);
      },
    },
  ),
  def(
    {
      id: 'greatWall',
      name: 'Underwater Great Wall',
      short: 'GREAT WALL',
      description: 'Twelve rising mines across 1.5 km of sea at the reticle (4 km), square to its bearing, armed for 40 s. Each rises at the first enemy within 250 m: 14k.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0x80c0ff,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        const brg = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        // Across the bearing: its right-hand normal.
        const nx = Math.cos(brg);
        const nz = Math.sin(brg);
        for (let i = 0; i < 12; i++) {
          const k = (i / 11 - 0.5) * 1500;
          game.strikes.spawn(ship, { kind: 'mine', skill: st.spec, x: p.x + nx * k, z: p.z + nz * k, radius: 80, delay: 2, damage: 14000, flood: 0.5, life: 40, seek: 250, seekSpeed: 30 });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800) && !target.submerged;
      },
    },
  ),
];
