import {
  aimPoint,
  boltTo,
  buff,
  burning,
  enemiesWithin,
  enemyNear,
  hpFrac,
  hurt,
  intercept,
  nextSalvo,
  offBow,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';

// Yamato, Iowa, Bismarck, Warspite.

export const BATTLESHIP_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Yamato
  def(
    {
      id: 'sakuraCluster',
      name: 'Sakura Cluster',
      short: 'SAKURA',
      description: 'Instant reload. The next salvo bursts into six burning bomblets per shell.',
      cooldown: 18,
      duration: 0,
      accent: 0xff7aa8,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, { cluster: true, damageMul: 1.15 });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85) && ship.turrets.filter((t) => t.canBear).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'ironWall',
      name: 'Iron Wall',
      short: 'IRON WALL',
      description: '8 s: take 60% less damage, fires and flooding put out and cannot start.',
      cooldown: 22,
      duration: 8,
      accent: 0xc8d6e8,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.extinguish();
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.4;
          m.fireImmune = true;
        });
      },
      aiShouldUse(ship, game) {
        return burning(ship) >= 2 || (hpFrac(ship) < 0.7 && underFire(ship, game, 600) >= 6);
      },
    },
  ),
  def(
    {
      id: 'waveMotion',
      name: 'Wave-Motion Cannon',
      short: 'WAVE-MOTION',
      description: 'The bow swings onto the reticle, charges, then fires a 4 km beam that cuts through every hull on the line.',
      ult: true,
      cooldown: 90,
      duration: 3.2,
      accent: 0x58c8ff,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 1.6, time: 1.4, dps: 65000, length: 4000, width: 34, pierce: true, steer: 45, fireChance: 0.8, knock: 40 });
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 0.35;
          m.damageTakenMul *= 0.7;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3600) && offBow(ship, target) < 70;
      },
    },
  ),

  // ------------------------------------------------------------------ Iowa
  def(
    {
      id: 'tomahawkVolley',
      name: 'Tomahawk Volley',
      short: 'TOMAHAWK',
      description: 'Six cruise missiles lock onto the ship under the reticle (6k each).',
      cooldown: 16,
      duration: 0,
      accent: 0xffaa44,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const lock = enemyNear(ship, game, p.x, p.z, 500);
        for (let i = 0; i < 6; i++) {
          const m = game.missiles.launch(ship, p.x + (game.rng() - 0.5) * 120, p.z + (game.rng() - 0.5) * 120, i * 0.22, 6000);
          m.target = lock;
          m.skill = st.spec;
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5500) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'phalanxStorm',
      name: 'Phalanx Storm',
      short: 'PHALANX',
      description: '6 s: CIWS shreds every shell, torpedo, missile and plane within 450 m.',
      cooldown: 20,
      duration: 6,
      accent: 0xffe27a,
      icon: 'flak',
      zone: 450,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        intercept(ship, game, ship.pos.x, ship.pos.z, st.spec.zone!, dt, { shells: true, torps: true, missiles: true, planes: 20000 });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 8;
      },
    },
  ),
  def(
    {
      id: 'rodsFromGod',
      name: 'Rods from God',
      short: 'RODS FROM GOD',
      description: 'Five tungsten rods fall on the reticle: 14k each, 70 m blast, 1.5 s EMP stun.',
      ult: true,
      cooldown: 85,
      duration: 3,
      accent: 0xfff0c0,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        const lock = enemyNear(ship, game, p.x, p.z, 300);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const r = i === 0 ? 0 : 70;
          // Rods after the first track a locked ship's motion so a single target cannot simply sail out.
          const lead = lock ? (2 + i * 0.18) * lock.speed : 0;
          const lx = lock ? Math.sin(lock.heading) * lead : 0;
          const lz = lock ? -Math.cos(lock.heading) * lead : 0;
          game.strikes.spawn(ship, {
            kind: 'rod',
            skill: st.spec,
            x: (lock ? lock.pos.x + lx : p.x) + Math.cos(a) * r,
            z: (lock ? lock.pos.z + lz : p.z) + Math.sin(a) * r,
            radius: 70,
            delay: 2 + i * 0.18,
            damage: 14000,
            stun: 1.5,
            knock: 30,
            fire: 0.5,
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6500) && !target.submerged;
      },
    },
  ),

  // ------------------------------------------------------------------ Bismarck
  def(
    {
      id: 'ironStorm',
      name: 'Iron Storm',
      short: 'IRON STORM',
      description: '8 s: secondaries fire three times as fast, reach 60% further and never miss.',
      cooldown: 20,
      duration: 8,
      accent: 0xffd060,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        for (const m of ship.secondaries) m.reload = 0;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.secRangeMul *= 1.6;
          m.secReloadMul /= 3;
          m.secPerfect = true;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3200).length > 0;
      },
    },
  ),
  def(
    {
      id: 'rammingSpeed',
      name: 'Ramming Speed',
      short: 'RAM',
      description: '6 s: 1.7x speed, half damage taken. Ramming an enemy deals 30k and floods it.',
      cooldown: 22,
      duration: 6,
      accent: 0xff6a3d,
      icon: 'ram',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.7;
          m.damageTakenMul *= 0.5;
          m.turnMul *= 1.3;
          m.ram = 30000;
          m.ramSkill = st.spec;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1100) && offBow(ship, target) < 35;
      },
    },
  ),
  def(
    {
      id: 'teslaStorm',
      name: 'Blitz Tesla Storm',
      short: 'TESLA STORM',
      description: 'Lightning strikes every enemy within 1.8 km: 22k each and a 3 s EMP stun.',
      ult: true,
      cooldown: 80,
      duration: 1,
      accent: 0x9ab8ff,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const hit = enemiesWithin(ship, game, 1800, false).filter((s) => !s.deep);
        if (!hit.length && ship.humanIndex < 0) return false;
        for (const s of hit) {
          boltTo(ship, game, s, st.spec.accent);
          hurt(ship, s, 22000, st.spec);
          if (s.alive) stun(s, 3);
        }
      },
      aiShouldUse(ship, game) {
        const n = enemiesWithin(ship, game, 1700, false).length;
        return n >= 2 || (n >= 1 && hpFrac(ship) < 0.5);
      },
    },
  ),

  // ------------------------------------------------------------------ Warspite
  def(
    {
      id: 'calabriaShot',
      name: 'Calabria Shot',
      short: 'CALABRIA',
      description: 'Instant reload. The next salvo lands almost on one point and hits 60% harder.',
      cooldown: 15,
      duration: 0,
      accent: 0xffe08a,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, { dispersionMul: 0.15, damageMul: 1.6 });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9) && ship.turrets.filter((t) => t.canBear).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'royalAegis',
      name: 'Royal Aegis',
      short: 'AEGIS',
      description: '10 s: a 40k-point energy shield soaks damage before the hull.',
      cooldown: 24,
      duration: 10,
      accent: 0x7fe0ff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.addShield(40000, st.spec.duration);
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.85 && underFire(ship, game, 700) >= 4;
      },
    },
  ),
  def(
    {
      id: 'grandOldLady',
      name: 'Grand Old Lady',
      short: 'GRAND OLD LADY',
      description: 'Full heal over 4 s, 6 s invulnerable, every turret reloaded, all damage cleansed.',
      ult: true,
      cooldown: 90,
      duration: 6,
      accent: 0xffe9a0,
      icon: 'heal',
    },
    {
      activate(ship, _g, st) {
        ship.cleanse();
        for (const t of ship.turrets) t.reload = 0;
        st.data.rate = (ship.maxHp - ship.hp) / 4;
        st.data.left = 4;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.invulnerable = true;
        });
      },
      update(ship, _g, dt, st) {
        const d = st.data as { rate: number; left: number };
        if (d.left <= 0) return;
        d.left -= dt;
        ship.heal(d.rate * dt);
        ship.extinguish();
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.35;
      },
    },
  ),
];
