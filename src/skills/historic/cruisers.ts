import { bearingTo, forwardX, forwardZ } from '../../core/math';
import { reveal } from '../../ships/Consumables';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  buff,
  dist,
  enemiesWithin,
  enemyNear,
  hpFrac,
  hurt,
  intercept,
  nearestEnemy,
  nextSalvo,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';

// Stalingrad, Des Moines, Atlanta, Belfast.

/** Hedgehog: furthest the pattern is thrown, and the half-length and half-width of its ellipse. */
const HEDGEHOG_RANGE = 1500;
const HEDGEHOG_LONG = 140;
const HEDGEHOG_WIDE = 80;

export const CRUISER_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Stalingrad
  def(
    {
      id: 'railgunRound',
      name: 'Railgun Round',
      short: 'RAILGUN',
      description: 'Instant reload. The next salvo flies flat at triple velocity and punches through three hulls.',
      cooldown: 16,
      duration: 0,
      accent: 0x66e0ff,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, { railgun: true, damageMul: 1.3, dispersionMul: 0.5 });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85) && ship.turrets.filter((t) => t.canBear).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'fireControl',
      name: 'Fire-Control Lock',
      short: 'FC LOCK',
      description: '10 s: radar locks the enemy under the reticle. It cannot cloak, and your shells aimed at it group 4x tighter.',
      cooldown: 24,
      duration: 10,
      accent: 0x9cf6ff,
      icon: 'radar',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, ship.mainRange);
        const lock = enemyNear(ship, game, p.x, p.z, 700);
        if (!lock) return false;
        st.data.lock = lock;
      },
      update(ship, _g, _dt, st) {
        const lock = st.data.lock as Ship;
        if (!lock.alive) return;
        reveal(lock, 0.3);
        // Only the rounds laid on the locked hull get the fire-control solution.
        const { aimX, aimZ } = ship.control;
        if (Math.hypot(aimX - lock.pos.x, aimZ - lock.pos.z) > 400) return;
        buff(ship, st.spec.id, 0.1, (m) => {
          m.dispersionMul *= 0.25;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9);
      },
    },
  ),
  def(
    {
      id: 'tsarLance',
      name: 'Tsar Lance',
      short: 'TSAR LANCE',
      description: 'A plasma lance you steer with the reticle for 5 s: 40k per second to the first hull it touches.',
      ult: true,
      cooldown: 90,
      duration: 5.8,
      accent: 0xff3b6b,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 0.8, time: 5, dps: 40000, length: 4500, width: 16, rate: 28, fireChance: 1.2, mx: ship.spec.length * 0.12 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4000);
      },
    },
  ),

  // ------------------------------------------------------------------ Des Moines
  def(
    {
      id: 'autoloader',
      name: 'Autoloader Overdrive',
      short: 'OVERDRIVE',
      description: '6 s: the main battery reloads in 1.2 s.',
      cooldown: 20,
      duration: 6,
      accent: 0xff8a2a,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        for (const t of ship.turrets) t.reload = Math.min(t.reload, 1.2);
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.reloadOverride = 1.2;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85);
      },
    },
  ),
  def(
    {
      id: 'thermite',
      name: 'Thermite Rounds',
      short: 'THERMITE',
      description: '10 s: every HE hit starts a fire, and your fires burn twice as hot.',
      cooldown: 22,
      duration: 10,
      accent: 0xff5a1f,
      icon: 'strike',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.guaranteedFire = true;
          m.fireDamageMul *= 2;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85);
      },
    },
  ),
  def(
    {
      id: 'hellfireCarpet',
      name: 'Hellfire Carpet',
      short: 'HELLFIRE',
      description: '36 rockets saturate a 400 x 200 m box at the reticle: 3.5k each, 30% fire chance.',
      ult: true,
      cooldown: 80,
      duration: 3,
      accent: 0xff7a2a,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5500);
        // The long side of the box lies across the line of fire.
        const b = Math.atan2(p.x - ship.pos.x, -(p.z - ship.pos.z));
        const ax = Math.cos(b);
        const az = Math.sin(b);
        for (let i = 0; i < 36; i++) {
          const u = (game.rng() - 0.5) * 400;
          const v = (game.rng() - 0.5) * 200;
          game.strikes.spawn(ship, {
            kind: 'rocket',
            skill: st.spec,
            x: p.x + ax * u + forwardX(b) * v,
            z: p.z + az * u + forwardZ(b) * v,
            radius: 45,
            delay: 0.8 + i * 0.05,
            damage: 3500,
            fire: 0.3,
          });
        }
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 5000)) return false;
        // Best against a cluster.
        return game.ships.filter((s) => s.alive && s.team !== ship.team && Math.hypot(s.pos.x - target.pos.x, s.pos.z - target.pos.z) < 400).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Atlanta
  def(
    {
      id: 'flakCurtain',
      name: 'Flak Curtain',
      short: 'FLAK',
      description: '8 s: your AA reaches 2.5x as far and hits 3x as hard, and enemy ships within 1.5 km sail under the bursts: their shells scatter 60% wider.',
      cooldown: 20,
      duration: 8,
      accent: 0xffb060,
      icon: 'flak',
      zone: 1500,
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.aaRangeMul *= 2.5;
          m.aaMul *= 3;
        });
      },
      update(ship, game, _dt, st) {
        for (const s of enemiesWithin(ship, game, st.spec.zone!, false)) {
          buff(s, 'debuff:flak', 0.3, (m) => {
            m.dispersionMul *= 1.6;
          });
        }
      },
      aiShouldUse(ship, game) {
        const reach = ship.spec.aa.range * 2.5;
        const near = (x: number, z: number) => Math.hypot(x - ship.pos.x, z - ship.pos.z) < reach;
        const air = game.air.squadrons.some((q) => q.alive && q.team !== ship.team && near(q.x, q.z));
        const missiles = game.missiles.missiles.some((m) => m.alive && m.team !== ship.team && near(m.x, m.z));
        return air || missiles || enemiesWithin(ship, game, 1300).length > 0;
      },
    },
  ),
  def(
    {
      id: 'pulseLasers',
      name: 'Pulse Lasers',
      short: 'PULSE LASER',
      description: '8 s: point-defence lasers zap the nearest enemy within 1.6 km three times a second (1.4k a hit).',
      cooldown: 20,
      duration: 8,
      accent: 0x4dffb8,
      icon: 'laser',
    },
    {
      activate(ship, game) {
        return !!nearestEnemy(ship, game, 1600) || ship.humanIndex >= 0;
      },
      update(ship, game, dt, st) {
        st.data.tick = ((st.data.tick as number) ?? 0) - dt;
        if ((st.data.tick as number) > 0) return;
        st.data.tick = 0.33;
        const t = nearestEnemy(ship, game, 1600);
        if (!t) return;
        game.events.emit('lightning', {
          points: [
            { x: ship.pos.x, y: ship.spec.freeboard + 10, z: ship.pos.z },
            { x: t.pos.x, y: t.spec.freeboard + 4, z: t.pos.z },
          ],
          color: st.spec.accent,
        });
        hurt(ship, t, 1400, st.spec);
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, 1500);
      },
    },
  ),
  def(
    {
      id: 'mirrorDome',
      name: 'Mirror Dome',
      short: 'MIRROR DOME',
      description: '10 s: a 600 m dome destroys enemy fire and reflects a fifth of each shell back at its gun. Allies inside heal 2%/s.',
      ult: true,
      cooldown: 85,
      duration: 10,
      accent: 0xc6a6ff,
      icon: 'shield',
      zone: 600,
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.reflect = Math.max(m.reflect, 0.25);
        });
      },
      update(ship, game, dt, st) {
        intercept(ship, game, ship.pos.x, ship.pos.z, st.spec.zone!, dt, { shells: true, torps: true, missiles: true, planes: 30000 }, (owner, dmg) => {
          if (owner.alive) hurt(ship, owner, dmg * 0.2, st.spec);
        });
        for (const a of alliesWithin(ship, game, st.spec.zone!)) a.heal(a.maxHp * 0.02 * dt);
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 10 || (hpFrac(ship) < 0.5 && enemiesWithin(ship, game, 3000).length > 0);
      },
    },
  ),

  // ------------------------------------------------------------------ Belfast
  def(
    {
      id: 'hedgehog',
      name: 'Hedgehog Barrage',
      short: 'HEDGEHOG',
      description: '24 mortar bombs blanket the sea at the reticle, up to 1.5 km out: 7k each, hits submarines, may flood.',
      cooldown: 16,
      duration: 0,
      accent: 0x8fd6ff,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        // Lead a ship near the reticle to where it will be as the bombs land, about 1.5 s from now.
        const p = aimPoint(ship, HEDGEHOG_RANGE);
        const lock = enemyNear(ship, game, p.x, p.z, 250);
        const cx = lock ? lock.pos.x + forwardX(lock.heading) * lock.speed * 1.5 : p.x;
        const cz = lock ? lock.pos.z + forwardZ(lock.heading) * lock.speed * 1.5 : p.z;
        const b = bearingTo(ship.pos.x, ship.pos.z, cx, cz);
        const fx = forwardX(b);
        const fz = forwardZ(b);
        for (let i = 0; i < 24; i++) {
          const a = game.rng() * Math.PI * 2;
          const r = Math.sqrt(game.rng());
          const along = Math.cos(a) * r * HEDGEHOG_LONG;
          const across = Math.sin(a) * r * HEDGEHOG_WIDE;
          const x = cx + fx * along - fz * across;
          const z = cz + fz * along + fx * across;
          game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x, z, radius: 32, delay: 1 + i * 0.04, damage: 7000, flood: 0.15, hitsSubs: true });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, HEDGEHOG_RANGE);
      },
    },
  ),
  def(
    {
      id: 'neptunePing',
      name: 'Neptune Ping',
      short: 'NEPTUNE',
      description: '8 s: a sonar pulse exposes every enemy ship on the map: they take +25% damage from your whole fleet.',
      cooldown: 30,
      duration: 8,
      accent: 0x7fd0ff,
      icon: 'reveal',
    },
    {
      activate(ship, game, st) {
        game.exposed[ship.team] = Math.max(game.exposed[ship.team], st.spec.duration);
      },
      aiShouldUse(ship, game) {
        // Worth it once the fleet is actually trading fire: two or more enemies near any ally.
        const allies = game.ships.filter((s) => s.alive && s.team === ship.team);
        const engaged = game.ships.filter((e) => e.alive && e.team !== ship.team && allies.some((a) => dist(a, e) < 4500));
        return engaged.length >= 2;
      },
    },
  ),
  def(
    {
      id: 'sonicTsunami',
      name: 'Sonic Tsunami',
      short: 'SONIC TSUNAMI',
      description: 'A shock ring rolls out to 1.8 km: 25k, knockback and a 2 s stun to enemies; allies it passes heal 10%.',
      ult: true,
      cooldown: 80,
      duration: 3,
      accent: 0x6ff0ff,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1800, delay: 0, damage: 25000, stun: 2, knock: 90, speed: 650, heal: 0.1, follow: true, hitsSubs: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1600, false).length >= 1;
      },
    },
  ),
];
