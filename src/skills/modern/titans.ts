import type { Game } from '../../core/Game';
import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  blinkTo,
  buff,
  ccTime,
  dist,
  enemiesWithin,
  fear,
  hpFrac,
  hurt,
  inCone,
  intercept,
  link,
  mark,
  silence,
  stun,
  targetInGunRange,
  turnMissile,
  turnTorpedo,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { dropLocks, enemiesAround, every, laser, reticleTarget } from './common';

// Montana, Lun, Zheng He and Vanguard: the modern titans. Six skills and three ultimates each.

/** A straight line of light from orbit onto a hull. */
function skyLaser(ship: Ship, t: Ship, color: number): void {
  ship.game.events.emit('lightning', {
    points: [
      { x: t.pos.x + 60, y: 900, z: t.pos.z - 40 },
      { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z },
    ],
    color,
    straight: true,
  });
}

export const MODERN_TITAN_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Montana
  def(
    {
      id: 'railgunBarrage',
      name: 'Railgun Barrage',
      short: 'RAIL BARRAGE',
      description: '10 s: the 406 mm rails run at full charge. Every salvo flies flat, punches through three hulls, and reloads 30% faster.',
      cooldown: 26,
      duration: 10,
      accent: 0x8fe8ff,
      icon: 'rod',
    },
    {
      activate(ship) {
        for (const t of ship.turrets) t.reload = Math.min(t.reload, 1);
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.railgun = true;
          m.reloadMul *= 0.7;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9);
      },
    },
  ),
  def(
    {
      id: 'laserCiws',
      name: 'Laser CIWS',
      short: 'LASER CIWS',
      description: '10 s: high-energy lasers burn every enemy shell, torpedo, missile and plane that comes within 1.2 km.',
      cooldown: 28,
      duration: 10,
      accent: 0xff6070,
      icon: 'laser',
      zone: 1200,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        intercept(ship, game, ship.pos.x, ship.pos.z, 1200, dt, { shells: true, torps: true, missiles: true, planes: 20000 });
        if (!every(st, dt, 0.3)) return;
        // Show a beam or two at whatever is closest.
        const t = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 1200)[0];
        if (t) laser(ship, game, t.pos.x, t.spec.freeboard + 6, t.pos.z, st.spec.accent);
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1400) >= 8;
      },
    },
  ),
  def(
    {
      id: 'globalHawk',
      name: 'Global Hawk',
      short: 'GLOBAL HAWK',
      description: 'A high-altitude drone sweeps the whole sea: every enemy is marked for 10 s (seen everywhere and 25% more damage taken), and cloaks fail.',
      cooldown: 30,
      duration: 10,
      accent: 0xb0d0ff,
      icon: 'eye',
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team) continue;
          mark(s, 0.6);
          buff(s, 'debuff:globalHawk', 0.6, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 12000, false).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'aegisNetwork',
      name: 'Aegis Network',
      short: 'AEGIS',
      description: 'You and every ally within 3 km raise a 30k shield for 10 s.',
      cooldown: 30,
      duration: 0,
      accent: 0x70b0ff,
      icon: 'shield',
      zone: 3000,
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 3000)) s.addShield(30000, 10);
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 3000).length >= 2 && enemiesWithin(ship, game, ship.mainRange).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'reactorSurge',
      name: 'Reactor Surge',
      short: 'REACTOR SURGE',
      description: '8 s: both reactors to emergency output. 50% faster, and every gun, cell and tube reloads twice as fast.',
      cooldown: 28,
      duration: 8,
      accent: 0xffe070,
      icon: 'speed',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 1.5;
          m.reloadMul *= 0.5;
          m.missileReloadMul *= 0.5;
          m.torpReloadMul *= 0.5;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.8);
      },
    },
  ),
  def(
    {
      id: 'reaperOverwatch',
      name: 'Reaper Overwatch',
      short: 'REAPER',
      description: '12 s: an MQ-9 shadows the ship under the reticle (8 km). Every 1.5 s it fires a Hellfire (5k), and its prey cannot hide or cloak.',
      cooldown: 26,
      duration: 12,
      accent: 0xd0d0d0,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 8000, 900);
        if (!t) return false;
        st.data.prey = t;
      },
      update(ship, game, dt, st) {
        const t = st.data.prey as Ship;
        if (!t.alive) {
          st.time = 0;
          return;
        }
        buff(t, 'debuff:reaper', 0.3, (m) => {
          m.revealed = true;
        });
        if (!every(st, dt, 1.5) || t.submerged) return;
        game.missiles.launch(ship, t.pos.x, t.pos.z, 0, 5000, { profile: 'skim', speed: 360, blast: 30, fire: 0.15, target: t, skill: st.spec });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7800) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'spaceFence',
      name: 'Space Fence',
      short: 'SPACE FENCE',
      description: 'For 3 s orbital lasers hold on the 8 enemies nearest you within 6 km: 25k a second each.',
      ult: true,
      cooldown: 100,
      duration: 3,
      accent: 0xff5060,
      icon: 'laser',
      zone: 6000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 6000).filter((s) => !s.deep).slice(0, 8);
        if (!prey.length) return false;
        st.data.prey = prey;
      },
      update(ship, _game, dt, st) {
        for (const t of st.data.prey as Ship[]) {
          if (!t.alive) continue;
          hurt(ship, t, 25000 * dt, st.spec);
          if (every(st, dt, 0.2, `fx${t.id}`)) skyLaser(ship, t, st.spec.accent);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 6000).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'battleGroup',
      name: 'Battle Group',
      short: 'BATTLE GROUP',
      description: 'A Ford-class carrier and two Arleigh Burkes sail with you for 40 s.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0x90b0ff,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        game.spawnWingman(ship, 0, 40, -420, 'ford', `${ship.name} CVN escort`);
        game.spawnWingman(ship, 300, 40, 160, 'burke', `${ship.name} DDG escort`);
        game.spawnWingman(ship, -300, 40, 160, 'burke', `${ship.name} DDG escort`);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 9000).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'fullSpectrumDominance',
      name: 'Full Spectrum Dominance',
      short: 'FULL SPECTRUM',
      description: '12 s: within 5 km enemies are silenced (no skills), their missiles and homing torpedoes lose every lock, and their guns scatter twice as wide.',
      ult: true,
      cooldown: 100,
      duration: 12,
      accent: 0xa080ff,
      icon: 'radar',
      zone: 5000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        for (const s of enemiesWithin(ship, game, 5000, false)) {
          silence(s, 0.6);
          buff(s, 'debuff:fullSpectrum', 0.6, (m) => {
            m.dispersionMul *= 2;
          });
        }
        // Their weapons in flight lose whatever they were steering for.
        for (const m of game.missiles.missiles) {
          if (!m.alive || m.team === ship.team || !m.target || dist2D(m.x, m.z, ship.pos.x, ship.pos.z) > 5000) continue;
          m.target = null;
          m.tx += (game.rng() - 0.5) * 600;
          m.tz += (game.rng() - 0.5) * 600;
        }
        for (const t of game.torps.torps) if (t.alive && t.team !== ship.team && t.homing && dist2D(t.x, t.z, ship.pos.x, ship.pos.z) < 5000) t.homing = null;
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4500).length >= 3;
      },
    },
  ),

  // ------------------------------------------------------------------ Lun
  def(
    {
      id: 'takeOff',
      name: 'Take Off',
      short: 'TAKE OFF',
      description: '8 s in ground effect: 2.5x speed and torpedoes pass beneath you, but the turns are wide.',
      cooldown: 24,
      duration: 8,
      accent: 0xd0e0ff,
      icon: 'speed',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 2.5;
          m.torpImmune = true;
          m.turnMul *= 0.5;
        });
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 1500) >= 8 || (!!target && !within(ship, target, ship.mainRange * 0.7));
      },
    },
  ),
  def(
    {
      id: 'moskitRack',
      name: 'Moskit Rack',
      short: 'MOSKIT RACK',
      description: 'All eight Moskits leave their racks for the ship under the reticle (7 km): 10k each, and every hit floods.',
      cooldown: 22,
      duration: 0,
      accent: 0xff9070,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        const lock = reticleTarget(ship, game, 7000, 700);
        for (let i = 0; i < 8; i++) {
          game.missiles.launch(ship, p.x, p.z, i * 0.18, 10000, { profile: 'skim', speed: 420, blast: 50, fire: 0.2, flood: 0.5, target: lock, skill: st.spec });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'strafingRun',
      name: 'Strafing Run',
      short: 'STRAFING RUN',
      description: 'Twelve bombs walk 1.2 km along the reticle bearing, centred on the reticle (5 km): 12k each in 90 m, and they start fires.',
      cooldown: 20,
      duration: 0,
      accent: 0xffb060,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        for (let i = 0; i < 12; i++) {
          const k = (i / 11 - 0.5) * 1200;
          game.strikes.spawn(ship, { kind: 'rocket', skill: st.spec, x: p.x + Math.sin(b) * k, z: p.z + Math.cos(b) * k, radius: 90, delay: 0.6 + i * 0.12, damage: 12000, fire: 0.35 });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'jetWash',
      name: 'Jet Wash',
      short: 'JET WASH',
      description: 'Eight turbofans at full thrust: every enemy in a 70° cone 1.2 km astern takes 15k and is blown 400 m away.',
      cooldown: 18,
      duration: 0,
      accent: 0xffd0a0,
      icon: 'gale',
    },
    {
      activate(ship, game, st) {
        const back = ship.heading + Math.PI;
        for (const s of enemiesWithin(ship, game, 1200)) {
          if (!inCone(ship, s, back, 35) || s.deep) continue;
          hurt(ship, s, 15000, st.spec);
          const a = bearingTo(ship.pos.x, ship.pos.z, s.pos.x, s.pos.z);
          s.shove(Math.sin(a) * 400, Math.cos(a) * 400);
        }
        game.events.emit('explosion', { x: ship.pos.x - forwardX(ship.heading) * ship.spec.length * 0.55, y: 4, z: ship.pos.z - forwardZ(ship.heading) * ship.spec.length * 0.55, size: 40 });
      },
      aiShouldUse(ship, game) {
        const back = ship.heading + Math.PI;
        return enemiesWithin(ship, game, 1100).some((s) => inCone(ship, s, back, 35) && !s.deep);
      },
    },
  ),
  def(
    {
      id: 'wakeMines',
      name: 'Wake Mines',
      short: 'WAKE MINES',
      description: 'Eight rising mines roll off the stern ramp into your wake, armed for 40 s. Each rises at the first enemy within 300 m: 12k.',
      cooldown: 22,
      duration: 2,
      accent: 0xc0a080,
      icon: 'mine',
    },
    {
      activate(_s, _g, st) {
        st.data.left = 8;
      },
      update(ship, game, dt, st) {
        if ((st.data.left as number) <= 0 || !every(st, dt, 0.25)) return;
        st.data.left = (st.data.left as number) - 1;
        const p = ship.localToWorld(-ship.spec.length * 0.55, 0, ((st.data.left as number) % 2 ? 1 : -1) * 30);
        game.strikes.spawn(ship, { kind: 'mine', skill: st.spec, x: p.x, z: p.z, radius: 80, delay: 1.5, damage: 12000, flood: 0.4, life: 40, seek: 300, seekSpeed: 30 });
      },
      aiShouldUse(ship, game) {
        const back = ship.heading + Math.PI;
        return enemiesWithin(ship, game, 3000).some((s) => inCone(ship, s, back, 60));
      },
    },
  ),
  def(
    {
      id: 'closeInBarrage',
      name: 'Close-In Barrage',
      short: 'CLOSE-IN',
      description: '8 s: the gun pods fire three times as fast, but nothing reaches past half range.',
      cooldown: 22,
      duration: 8,
      accent: 0xffa040,
      icon: 'salvo',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.reloadMul /= 3;
          m.rangeCap = m.rangeCap > 0 ? Math.min(m.rangeCap, ship.mainRange * 0.5) : ship.mainRange * 0.5;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.45);
      },
    },
  ),
  def(
    {
      id: 'caspianMonster',
      name: 'Caspian Sea Monster',
      short: 'CASPIAN MONSTER',
      description: '12 s of full ground effect: double speed, Moskit cells reload three times as fast, torpedoes pass beneath, and all damage taken is halved.',
      ult: true,
      cooldown: 95,
      duration: 12,
      accent: 0xe0f0ff,
      icon: 'gale',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.speedMul *= 2;
          m.missileReloadMul /= 3;
          m.torpImmune = true;
          m.damageTakenMul *= 0.5;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 7000).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'moskitCascade',
      name: 'Moskit Cascade',
      short: 'MOSKIT CASCADE',
      description: '6 s: every half second a Moskit leaves for each of the three enemies nearest you within 6 km: 8k each, and every hit floods.',
      ult: true,
      cooldown: 95,
      duration: 6,
      accent: 0xff7050,
      icon: 'missile',
      zone: 6000,
    },
    {
      activate(ship, game) {
        if (!enemiesAround(ship, game, ship.pos.x, ship.pos.z, 6000).some((s) => !s.submerged)) return false;
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        for (const t of enemiesAround(ship, game, ship.pos.x, ship.pos.z, 6000).filter((s) => !s.submerged).slice(0, 3)) {
          game.missiles.launch(ship, t.pos.x, t.pos.z, game.rng() * 0.2, 8000, { profile: 'skim', speed: 420, blast: 50, fire: 0.15, flood: 0.4, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5500).filter((s) => !s.submerged).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'skyCracker',
      name: 'Sky Cracker',
      short: 'SKY CRACKER',
      description: 'The Lun climbs out of reach for 2 s, then slams down on the reticle (up to 2 km away, any direction): 120k within 300 m, falling off to the edge, and everything there is thrown clear.',
      ult: true,
      cooldown: 95,
      duration: 2,
      accent: 0xffffff,
      icon: 'meteor',
    },
    {
      activate(ship, _g, st) {
        const p = aimPoint(ship, 2000);
        st.data.x = p.x;
        st.data.z = p.z;
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.invulnerable = true;
          m.untargetable = true;
          m.torpImmune = true;
        });
      },
      end(ship, game, st) {
        if (!ship.alive) return;
        blinkTo(ship, game, st.data.x as number, st.data.z as number);
        for (const s of enemiesWithin(ship, game, 300 + ship.spec.length * 0.5)) {
          if (s.deep) continue;
          const d = dist2D(ship.pos.x, ship.pos.z, s.pos.x, s.pos.z);
          hurt(ship, s, 120000 * (1 - 0.5 * Math.min(1, d / (300 + ship.spec.length * 0.5))), st.spec);
          const a = bearingTo(ship.pos.x, ship.pos.z, s.pos.x, s.pos.z);
          s.shove(Math.sin(a) * 350, Math.cos(a) * 350);
          buff(s, 'debuff:stun', ccTime(s, 1.5), (m) => {
            m.stunned = true;
          });
        }
        game.events.emit('explosion', { x: ship.pos.x, y: 6, z: ship.pos.z, size: 160 });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 1900) && !target.deep && enemiesAround(ship, game, target.pos.x, target.pos.z, 500).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Zheng He
  def(
    {
      id: 'strawBoats',
      name: 'Straw Boats',
      short: 'STRAW BOATS',
      description: '8 s: decoy hulks soak up the enemy fire. Every shell and missile that hits you or an ally within 1.5 km is counted, and when it ends 40% of that damage flies back as missiles split across enemies within 5 km.',
      cooldown: 24,
      duration: 8,
      accent: 0xe0c070,
      icon: 'missile',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        st.data.stored = 0;
        const until = game.time + st.spec.duration + 0.5;
        st.data.off = game.events.on('shellHit', (e) => {
          if (game.time > until || e.target.team !== ship.team || e.attacker.team === ship.team) return;
          if (dist(e.target, ship) > 1500) return;
          st.data.stored = (st.data.stored as number) + e.damage;
        });
      },
      end(ship, game, st) {
        (st.data.off as (() => void) | undefined)?.();
        const total = (st.data.stored as number) * 0.4;
        const prey = enemiesWithin(ship, game, 5000).filter((s) => !s.deep);
        if (!ship.alive || total < 1000 || !prey.length) return;
        const n = Math.min(40, Math.max(2, Math.ceil(total / 6000)));
        for (let i = 0; i < n; i++) {
          const t = prey[i % prey.length];
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.06, total / n, { profile: 'skim', speed: 360, blast: 40, fire: 0.1, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1500) >= 8 && enemiesWithin(ship, game, 5000).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'ironChains',
      name: 'Iron Chains',
      short: 'IRON CHAINS',
      description: 'The three enemies nearest the reticle (5 km) are chained together for 8 s: half of any damage one of them takes is dealt to each of the others as well.',
      cooldown: 22,
      duration: 8,
      accent: 0xa0a8b0,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const group = enemiesAround(ship, game, p.x, p.z, 1500)
          .filter((s) => !s.deep)
          .slice(0, 3);
        if (group.length < 2) return false;
        link(group, game, 'echo', 0.5, st.spec.duration, st.spec);
        st.data.group = group;
      },
      update(_s, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        const group = (st.data.group as Ship[]).filter((s) => s.alive);
        for (let i = 1; i < group.length; i++) chain(game, group[i - 1], group[i], st.spec.accent);
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 4800) && enemiesAround(ship, game, target.pos.x, target.pos.z, 1500).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'eastWind',
      name: 'East Wind',
      short: 'EAST WIND',
      description: '10 s: the wind turns. You and allies within 3 km reload torpedoes and missiles 25% faster and hit 20% harder with them, and group shells 20% tighter.',
      cooldown: 24,
      duration: 0,
      accent: 0x90e0ff,
      icon: 'gale',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        for (const s of alliesWithin(ship, game, 3000)) {
          buff(s, st.spec.id, 10, (m) => {
            m.torpReloadMul *= 0.75;
            m.missileReloadMul *= 0.75;
            m.torpDamageMul *= 1.2;
            m.missileDamageMul *= 1.2;
            m.dispersionMul *= 0.8;
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, Math.max(ship.mainRange, 8000));
      },
    },
  ),
  def(
    {
      id: 'emptyFort',
      name: 'Empty Fort',
      short: 'EMPTY FORT',
      description: 'Throw open the gates: 6 s cloaked, breaking locks outside 500 m proximity detection. Enemies within 1.5 km, suspecting a trap, flee for 3 s.',
      cooldown: 26,
      duration: 6,
      accent: 0xf0e8d0,
      icon: 'fear',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.untargetable = true;
        });
        dropLocks(ship, game, 'stealth');
        for (const s of enemiesWithin(ship, game, 1500, false)) fear(s, ship.pos.x, ship.pos.z, 3);
      },
      aiShouldUse(ship, game) {
        return (hpFrac(ship) < 0.5 && underFire(ship, game, 1200) >= 6) || enemiesWithin(ship, game, 1400).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'droneScreen',
      name: 'Drone Screen',
      short: 'DRONE SCREEN',
      description: '10 s: a cloud of drones throws itself in front of the next 20 hits (of 1k or more), absorbing them whole.',
      cooldown: 22,
      duration: 10,
      accent: 0xd0d8e0,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        ship.guard = { left: 20, min: 1000, until: game.time + st.spec.duration, skill: st.spec };
      },
      end(ship, _g, st) {
        if (ship.guard?.skill === st.spec) ship.guard = null;
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 6;
      },
    },
  ),
  def(
    {
      id: 'killWeb',
      name: 'Kill Web',
      short: 'KILL WEB',
      description: '12 s: the ship under the reticle (6 km) is marked and cannot shoot down missiles or planes, and every allied missile and homing torpedo within 4 km of you retargets onto it.',
      cooldown: 24,
      duration: 12,
      accent: 0xff7050,
      icon: 'radar',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 6000, 700);
        if (!t) return false;
        st.data.prey = t;
        st.data.turned = new Set<number>();
      },
      update(ship, game, dt, st) {
        const t = st.data.prey as Ship;
        if (!t.alive) {
          st.time = 0;
          return;
        }
        buff(t, 'debuff:killWeb', 0.3, (m) => {
          m.marked = true;
          m.revealed = true;
          m.aaMul = 0;
        });
        if (!every(st, dt, 0.25)) return;
        const turned = st.data.turned as Set<number>;
        for (const m of game.missiles.missiles) {
          if (!m.alive || m.team !== ship.team || m.struck || m.delay > 0 || m.target === t || turned.has(m.id)) continue;
          if (dist2D(m.x, m.z, ship.pos.x, ship.pos.z) > 4000) continue;
          turned.add(m.id);
          turnMissile(m, m.owner, t);
        }
        if (t.deep) return;
        for (const p of game.torps.torps) {
          if (!p.alive || p.team !== ship.team || !p.homing || p.homing === t || dist2D(p.x, p.z, ship.pos.x, ship.pos.z) > 4000) continue;
          turnTorpedo(p, p.owner, t);
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'redCliffs',
      name: 'Red Cliffs',
      short: 'RED CLIFFS',
      description: 'Fire ships ram every enemy within 4 km of the reticle (8 km): 15k and three fires each. For 10 s, fire leaps between enemies within 500 m of a burning one.',
      ult: true,
      cooldown: 105,
      duration: 10,
      accent: 0xff6030,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        const prey = enemiesAround(ship, game, p.x, p.z, 4000).filter((s) => !s.deep);
        if (!prey.length) return false;
        prey.forEach((t, i) => {
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.12, 15000, {
            profile: 'skim',
            speed: 340,
            uninterceptable: true,
            look: 'drone',
            blast: 50,
            fire: 0,
            target: t,
            skill: st.spec,
            onHit(s) {
              if (s !== t) return;
              s.startFire(0, ship);
              s.startFire(1, ship);
              s.startFire(3, ship);
            },
          });
        });
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 1)) return;
        const enemies = game.ships.filter((s) => s.alive && s.team !== ship.team && !s.submerged);
        const burning = enemies.filter((s) => s.fires.some((f) => f > 0));
        for (const s of enemies) {
          if (burning.includes(s) || !burning.some((b) => dist(b, s) < 500)) continue;
          s.startFire(Math.floor(game.rng() * 4), ship);
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 7800) && enemiesAround(ship, game, target.pos.x, target.pos.z, 4000).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'treasureFleet',
      name: 'Treasure Fleet',
      short: 'TREASURE FLEET',
      description: 'The treasure fleet sails again: a Nanchang and two Kunmings fight beside you for 30 s.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xffd060,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        game.spawnWingman(ship, 0, 30, 380, 'nanchang', `${ship.name} escort`);
        game.spawnWingman(ship, 340, 30, -200, 'kunming', `${ship.name} escort`);
        game.spawnWingman(ship, -340, 30, -200, 'kunming', `${ship.name} escort`);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 9000).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'tenThousandArrows',
      name: 'Ten Thousand Arrows',
      short: '10,000 ARROWS',
      description: '120 missiles split across every enemy within 5 km of the reticle (9 km), 4k each. Every ship hit loses its AA and CIWS for 8 s.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0xffe0a0,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 9000);
        const prey = enemiesAround(ship, game, p.x, p.z, 5000).filter((s) => !s.deep);
        if (!prey.length) return false;
        for (let i = 0; i < 120; i++) {
          const t = prey[i % prey.length];
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.025, 4000, {
            profile: 'skim',
            speed: 420,
            blast: 35,
            fire: 0.05,
            target: t,
            skill: st.spec,
            onHit(s) {
              buff(s, 'debuff:arrows', 8, (m) => {
                m.aaMul = 0;
              });
            },
          });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 8800) && (enemiesAround(ship, game, target.pos.x, target.pos.z, 5000).length >= 2 || target.spec.cls === 'TT');
      },
    },
  ),

  // ------------------------------------------------------------------ Vanguard
  def(
    {
      id: 'decksAwash',
      name: 'Decks Awash',
      short: 'DECKS AWASH',
      description: '8 s: ballast down to the waterline. Every hit but a torpedo does half damage and shells aimed at you scatter 30% wider, but torpedoes hit twice as hard and you are 30% slower.',
      cooldown: 22,
      duration: 8,
      accent: 0x7090a0,
      icon: 'wave',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.5;
          // Torpedoes pass the halving too, so 4x nets out at twice as hard.
          m.torpTakenMul *= 4;
          m.scatterTakenMul *= 1.3;
          m.speedMul *= 0.7;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 8 && enemiesWithin(ship, game, 2000).length === 0;
      },
    },
  ),
  def(
    {
      id: 'goalkeeperScreen',
      name: 'Goalkeeper Screen',
      short: 'GOALKEEPER',
      description: '10 s: the Goalkeepers fire on incoming shells. One in three enemy shells coming down within 2.5 km of you is shot out of the sky.',
      cooldown: 22,
      duration: 10,
      accent: 0xffe080,
      icon: 'flak',
      zone: 2500,
    },
    {
      activate(_s, _g, st) {
        st.data.seen = new Set<number>();
      },
      update(ship, game, _dt, st) {
        const seen = st.data.seen as Set<number>;
        let fx = 0;
        for (const s of game.shells.shells) {
          if (!s.alive || s.team === ship.team || seen.has(s.id)) continue;
          if (dist2D(s.x, s.z, ship.pos.x, ship.pos.z) > 2500) continue;
          seen.add(s.id);
          if (game.rng() >= 1 / 3) continue;
          s.alive = false;
          if (fx++ < 6) {
            game.events.emit('intercept', { x: s.x, y: s.y, z: s.z });
            laser(ship, game, s.x, s.y, s.z, st.spec.accent);
          }
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 2500) >= 10;
      },
    },
  ),
  def(
    {
      id: 'sonarSweep',
      name: 'Sonar Sweep',
      short: 'SONAR SWEEP',
      description: 'An active ping out to 4 km: every enemy is revealed for 10 s, submarines are driven up to periscope depth and stunned 2 s, and enemy torpedoes in the water are destroyed.',
      cooldown: 20,
      duration: 4,
      accent: 0x80ffe0,
      icon: 'radar',
      zone: 4000,
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 4000, delay: 0, damage: 0, speed: 3000 });
        const prey = enemiesWithin(ship, game, 4000, false);
        for (const s of prey) {
          buff(s, 'debuff:sonar', 10, (m) => {
            m.revealed = true;
          });
          if (s.isSub) stun(s, 2);
        }
        st.data.subs = prey.filter((s) => s.isSub);
        for (const t of game.torps.torps) {
          if (!t.alive || t.team === ship.team || dist2D(t.x, t.z, ship.pos.x, ship.pos.z) > 4000) continue;
          t.alive = false;
          game.events.emit('intercept', { x: t.x, y: 0, z: t.z });
        }
      },
      update(_s, _g, _dt, st) {
        // Held up for a few seconds: long enough to be found.
        for (const s of st.data.subs as Ship[]) if (s.alive && s.depthState > 1) s.depthState = 1;
      },
      aiShouldUse(ship, game) {
        const subs = enemiesWithin(ship, game, 4000, false).some((s) => s.isSub);
        const torps = game.torps.torps.filter((t) => t.alive && t.team !== ship.team && dist2D(t.x, t.z, ship.pos.x, ship.pos.z) < 3000).length;
        return subs || torps >= 3;
      },
    },
  ),
  def(
    {
      id: 'breakTheLine',
      name: 'Break the Line',
      short: 'BREAK THE LINE',
      description: "4 s at double speed, Nelson's way: every enemy that passes within 1.2 km on your beam takes a 30k broadside (once each).",
      cooldown: 20,
      duration: 4,
      accent: 0xffd0a0,
      icon: 'speed',
      zone: 1200,
    },
    {
      activate(ship, _g, st) {
        st.data.hit = new Set<number>();
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2;
        });
      },
      update(ship, game, _dt, st) {
        const hit = st.data.hit as Set<number>;
        for (const s of enemiesWithin(ship, game, 1200, false)) {
          if (s.deep || hit.has(s.id)) continue;
          if (!inCone(ship, s, ship.heading + Math.PI / 2, 40) && !inCone(ship, s, ship.heading - Math.PI / 2, 40)) continue;
          hit.add(s.id);
          laser(ship, game, s.pos.x, s.spec.freeboard, s.pos.z, st.spec.accent);
          game.events.emit('explosion', { x: s.pos.x, y: s.spec.freeboard, z: s.pos.z, size: 2 });
          hurt(ship, s, 30000, st.spec);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2500).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'heartsOfOak',
      name: 'Hearts of Oak',
      short: 'HEARTS OF OAK',
      description: 'You and allies within 2 km are cleansed and, for 8 s, cannot be stunned, silenced, rooted or frightened.',
      cooldown: 24,
      duration: 0,
      accent: 0xc89060,
      icon: 'heal',
      zone: 2000,
    },
    {
      activate(ship, game, st) {
        for (const s of alliesWithin(ship, game, 2000)) {
          s.cleanse();
          buff(s, st.spec.id, 8, (m) => {
            m.ccImmune = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        const held = (s: Ship) => s.mods.stunned || s.mods.silenced || s.mods.rooted || s.mods.feared;
        return alliesWithin(ship, game, 2000).some(held);
      },
    },
  ),
  def(
    {
      id: 'dambuster',
      name: 'Dambuster',
      short: 'DAMBUSTER',
      description: 'Three bouncing bombs skip toward the reticle (5 km). Each bounces three times: 15k in 120 m on the first two, 30k and flooding on the last.',
      cooldown: 20,
      duration: 0,
      accent: 0xb0c0d0,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const d = dist2D(ship.pos.x, ship.pos.z, p.x, p.z);
        if (d < 500) return false;
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        for (let k = -1; k <= 1; k++) {
          const ox = forwardZ(b) * k * 130;
          const oz = -forwardX(b) * k * 130;
          [0.45, 0.75, 1].forEach((u, i) => {
            game.strikes.spawn(ship, {
              kind: 'mortar',
              skill: st.spec,
              x: ship.pos.x + forwardX(b) * d * u + ox,
              z: ship.pos.z + forwardZ(b) * d * u + oz,
              radius: 120,
              delay: (d * u) / 300 + (k + 1) * 0.15,
              damage: i === 2 ? 30000 : 15000,
              flood: i === 2 ? 0.8 : 0,
            });
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800) && dist(ship, target) > 900 && !target.deep;
      },
    },
  ),
  def(
    {
      id: 'trident',
      name: 'Trident',
      short: 'TRIDENT',
      description: 'A Trident missile rises and splits into eight warheads, one on each of the eight enemies nearest the reticle (12 km): 30k each in 200 m, and they cannot be intercepted.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0xffffff,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 12000);
        const prey = enemiesAround(ship, game, p.x, p.z, 6000)
          .filter((s) => !s.deep)
          .slice(0, 8);
        if (!prey.length) return false;
        prey.forEach((t, i) => {
          game.missiles.launch(ship, t.pos.x, t.pos.z, 0.4 + i * 0.12, 30000, { profile: 'ballistic', speed: 900, uninterceptable: true, blast: 200, fire: 0.4, target: t, skill: st.spec });
        });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 11500) && (enemiesAround(ship, game, target.pos.x, target.pos.z, 6000).length >= 3 || target.spec.cls === 'TT');
      },
    },
  ),
  def(
    {
      id: 'englandExpects',
      name: 'England Expects',
      short: 'ENGLAND EXPECTS',
      description: '12 s: "England expects that every man will do his duty." Every ally on the sea deals 25% more damage, reloads 25% faster and cools down skills twice as fast.',
      ult: true,
      cooldown: 105,
      duration: 12,
      accent: 0xe02030,
      icon: 'drums',
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        const refresh = every(st, dt, 0.25);
        for (const s of game.ships) {
          if (!s.alive || s.team !== ship.team) continue;
          for (const k of s.skills) if (!k.spec.ult && k.cooldown > 0) k.cooldown = Math.max(0, k.cooldown - dt);
          if (!refresh) continue;
          buff(s, st.spec.id, 0.4, (m) => {
            m.damageMul *= 1.25;
            m.reloadMul *= 0.75;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, ship.mainRange).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'ruleTheWaves',
      name: 'Rule the Waves',
      short: 'RULE THE WAVES',
      description: '12 s: Britannia rules the waves. You and allies within 3 km are immune to torpedoes and missiles and repair 3% of the hull a second.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0x4070ff,
      icon: 'shield',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 3000,
          life: 12,
          follow: ship,
          skill: st.spec,
          look: 'circle',
          heal: 0.03,
          onTick(s) {
            if (s.team !== ship.team) return;
            buff(s, st.spec.id, 0.4, (m) => {
              m.torpImmune = true;
              m.torpTakenMul = 0;
              m.missileTakenMul = 0;
            });
          },
        });
      },
      aiShouldUse(ship, game) {
        const threats = underFire(ship, game, 3000);
        const hurt = alliesWithin(ship, game, 3000).filter((s) => hpFrac(s) < 0.5).length;
        return threats >= 16 || hurt >= 2 || hpFrac(ship) < 0.35;
      },
    },
  ),
];

/** A chain of iron between two hulls. */
function chain(game: Game, a: Ship, b: Ship, color: number): void {
  game.events.emit('lightning', {
    points: [
      { x: a.pos.x, y: a.spec.freeboard + 4, z: a.pos.z },
      { x: b.pos.x, y: b.spec.freeboard + 4, z: b.pos.z },
    ],
    color,
    straight: true,
  });
}
