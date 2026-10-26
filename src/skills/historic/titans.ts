import { canTrack } from '../../core/Targeting';
import { distToHull } from '../../core/hull';
import { DEG, bearingTo, forwardX, forwardZ, wrapAngle } from '../../core/math';
import type { TorpedoSpec } from '../../core/types';
import {
  aimPoint,
  alliesWithin,
  blink,
  buff,
  burning,
  chainLightning,
  dist,
  enemiesOnLine,
  enemiesWithin,
  enemyNear,
  hpFrac,
  hurt,
  inCone,
  intercept,
  mark,
  silence,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import type { Ship } from '../../ships/Ship';
import { def, type SkillDef } from '../types';

// Leviathan, Habakkuk, Raijin: the three titans. Each carries six skills and three ultimates,
// all of them its own: nothing here is shared with the line ships.

/** The cryo debuff: crawling speed, sluggish turrets and rudder. */
function chill(s: Ship, time: number): void {
  buff(s, 'debuff:cryo', time, (m) => {
    m.speedMul *= 0.3;
    m.traverseMul *= 0.3;
    m.turnMul *= 0.5;
  });
}

/** Knockback a blast imparts, eased for long hulls (as StrikeSystem does). */
function shove(s: Ship, dx: number, dz: number, speed: number): void {
  const d = Math.hypot(dx, dz) || 1;
  s.shove((dx * speed) / d, (dz * speed) / d);
}

/** Raijin Drums: where drum `i` of six orbits at sim time `time` (shared with the render). */
export function drumPos(ship: Ship, time: number, i: number): { x: number; y: number; z: number } {
  const a = time * 1.6 + (i * Math.PI) / 3;
  const r = ship.spec.length * 0.75;
  return { x: ship.pos.x + Math.cos(a) * r, y: ship.spec.freeboard + 45, z: ship.pos.z + Math.sin(a) * r };
}

/** Swordfish Strike: where the bombers release, short of the reticle on the line from the titan. */
export function swordfishDrop(ship: Ship, x: number, z: number): { x: number; z: number; heading: number } {
  const b = bearingTo(ship.pos.x, ship.pos.z, x, z);
  const back = Math.min(600, Math.hypot(x - ship.pos.x, z - ship.pos.z) * 0.5);
  return { x: x - forwardX(b) * back, z: z - forwardZ(b) * back, heading: b };
}

const SWORDFISH_TORP: TorpedoSpec = {
  name: 'Swordfish torpedo',
  launchers: [],
  tubes: 1,
  reload: 0,
  speed: 55,
  range: 2600,
  damage: 14000,
  floodChance: 0.4,
  spread: 0,
  detect: 500,
};

export const TITAN_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Leviathan
  def(
    {
      id: 'teslaBarrier',
      name: 'Tesla Barrier',
      short: 'TESLA BARRIER',
      description: '10 s: a 120k shield, and 30% of all damage taken arcs back to the shooter.',
      cooldown: 24,
      duration: 10,
      accent: 0x8fb4ff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.addShield(120000, st.spec.duration);
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.reflect = Math.max(m.reflect, 0.3);
        });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.9 && underFire(ship, game, 900) >= 6;
      },
    },
  ),
  def(
    {
      id: 'fullBroadside',
      name: 'Full Broadside',
      short: 'BROADSIDE',
      description: 'Every gun and secondary fires twice, right now.',
      cooldown: 20,
      duration: 1.6,
      accent: 0xff9a3d,
      icon: 'salvo',
    },
    {
      activate(_ship, _g, st) {
        st.data.volleys = 2;
        st.data.timer = 0;
      },
      update(ship, _g, dt, st) {
        const d = st.data as { volleys: number; timer: number };
        d.timer -= dt;
        if (d.volleys <= 0 || d.timer > 0) return;
        for (let i = 0; i < ship.turrets.length; i++) ship.fireTurret(i, ship.ammo, true);
        for (const m of ship.secondaries) m.reload = 0;
        d.volleys--;
        d.timer = 0.8;
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.8);
      },
    },
  ),
  def(
    {
      id: 'creepingBarrage',
      name: 'Creeping Barrage',
      short: 'CREEPING BARRAGE',
      description: '36 heavy shells walk out along the reticle bearing from 1 km to 3.5 km: 9k each in 70 m blasts, and they start fires.',
      cooldown: 20,
      duration: 0,
      accent: 0xffa24a,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 3500);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const fx = forwardX(b);
        const fz = forwardZ(b);
        for (let i = 0; i < 36; i++) {
          const d = 1000 + (2500 * i) / 35;
          const lat = (game.rng() - 0.5) * 180;
          game.strikes.spawn(ship, {
            kind: 'mortar',
            skill: st.spec,
            x: ship.pos.x + fx * d - fz * lat,
            z: ship.pos.z + fz * d + fx * lat,
            radius: 70,
            delay: 0.8 + i * 0.07,
            damage: 9000,
            fire: 0.3,
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3300) && dist(ship, target) > 900;
      },
    },
  ),
  def(
    {
      id: 'juggernaut',
      name: 'Juggernaut',
      short: 'JUGGERNAUT',
      description: '6 s: 80% faster, half damage taken, and no stun or slow can hold you. Anything within 140 m of the bow takes 50k, floods and is thrown aside.',
      cooldown: 22,
      duration: 6,
      accent: 0xff6a3a,
      icon: 'ram',
    },
    {
      activate(ship, _g, st) {
        ship.cleanse();
        ship.throttle = 6;
        st.data.hit = {} as Record<number, number>;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.8;
          m.damageTakenMul *= 0.5;
          m.turnMul *= 1.3;
          m.unstoppable = true;
        });
      },
      update(ship, game, _dt, st) {
        const hit = st.data.hit as Record<number, number>;
        const bow = ship.localToWorld(ship.spec.length * 0.45, 0, 0);
        const fx = forwardX(ship.heading);
        const fz = forwardZ(ship.heading);
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team || s.deep) continue;
          if (distToHull(s, bow.x, bow.z) > 140 || game.time - (hit[s.id] ?? -1e9) < 1.5) continue;
          hit[s.id] = game.time;
          hurt(ship, s, 50000, st.spec);
          s.startFlood(ship);
          // Thrown off the bow to whichever side it lies.
          const side = Math.sign((s.pos.x - ship.pos.x) * -fz + (s.pos.z - ship.pos.z) * fx) || 1;
          shove(s, -fz * side + fx * 0.4, fx * side + fz * 0.4, 260);
          game.events.emit('explosion', { x: bow.x, y: 6, z: bow.z, size: 2.2 });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 2000) || (hpFrac(ship) < 0.5 && underFire(ship, game, 900) >= 8);
      },
    },
  ),
  def(
    {
      id: 'magneticMaelstrom',
      name: 'Magnetic Maelstrom',
      short: 'MAELSTROM',
      description: '5 s: every enemy within 2.2 km is dragged toward you, at half speed and half turret traverse, while tesla arcs burn them for 4k a second.',
      cooldown: 24,
      duration: 5,
      accent: 0x9a8cff,
      icon: 'magnet',
      zone: 2200,
    },
    {
      activate(ship, game, st) {
        if (!enemiesWithin(ship, game, st.spec.zone!, false).length && ship.humanIndex < 0) return false;
        st.data.tick = 0;
      },
      update(ship, game, dt, st) {
        const near = enemiesWithin(ship, game, st.spec.zone!, false).filter((s) => !s.deep);
        for (const s of near) {
          const dx = ship.pos.x - s.pos.x;
          const dz = ship.pos.z - s.pos.z;
          // Pull until the hulls nearly touch; the push decays at 1.5/s, so this holds about 60 m/s.
          if (Math.hypot(dx, dz) > (ship.spec.length + s.spec.length) * 0.5 + 80) shove(s, dx, dz, 90 * dt);
          buff(s, 'debuff:maelstrom', 0.3, (m) => {
            m.speedMul *= 0.5;
            m.traverseMul *= 0.5;
          });
        }
        st.data.tick = (st.data.tick as number) - dt;
        if ((st.data.tick as number) > 0) return;
        st.data.tick = 0.5;
        near.forEach((s, i) => {
          if (i < 5) {
            game.events.emit('lightning', {
              points: [
                { x: ship.pos.x, y: ship.spec.freeboard + 30, z: ship.pos.z },
                { x: s.pos.x, y: s.spec.freeboard + 6, z: s.pos.z },
              ],
              color: st.spec.accent,
            });
          }
          hurt(ship, s, 2000, st.spec);
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2000, false).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'gotterdammerung',
      name: 'Götterdämmerung',
      short: 'GÖTTERDÄMMERUNG',
      description: 'Three nuclear shells at the reticle: 150 m fireballs, 100k each, everything burns.',
      ult: true,
      cooldown: 95,
      duration: 4,
      accent: 0xffcf5a,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6500);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + game.rng();
          game.strikes.spawn(ship, {
            kind: 'nuke',
            skill: st.spec,
            x: p.x + Math.cos(a) * (i ? 170 : 0),
            z: p.z + Math.sin(a) * (i ? 170 : 0),
            radius: 150,
            delay: 2.2 + i * 0.5,
            damage: 100000,
            fire: 1,
            knock: 80,
            stun: 1.5,
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6000);
      },
    },
  ),
  def(
    {
      id: 'empPulse',
      name: 'EMP Pulse',
      short: 'EMP PULSE',
      description: 'An electromagnetic ring rolls out 1.6 km: every enemy inside takes 6k and is silenced for 5 s (no skills), and every hostile missile and plane in it falls.',
      cooldown: 22,
      duration: 0,
      accent: 0x7fd8ff,
      icon: 'silence',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1600, delay: 0, damage: 6000, stun: 0, knock: 0, speed: 1000, follow: true });
        for (const s of enemiesWithin(ship, game, 1600, false)) silence(s, 5);
        intercept(ship, game, ship.pos.x, ship.pos.z, 1600, 1, { missiles: true, planes: 1e9 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1500, false).some((s) => s.skillActive || s.skills.some((_, i) => s.skillReady(i)));
      },
    },
  ),
  def(
    {
      id: 'hochseeflotte',
      name: 'Hochseeflotte',
      short: 'HOCHSEEFLOTTE',
      description: 'The High Seas Fleet sails: three Bismarck-class battleships join your line for 35 s.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0xd8dee8,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        const names = ['Hochseeflotte I', 'Hochseeflotte II', 'Hochseeflotte III'];
        [
          [-480, -200],
          [480, -200],
          [0, -700],
        ].forEach(([lat, back], i) => game.spawnWingman(ship, lat, 35, back, 'bismarck', names[i]));
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 1);
      },
    },
  ),
  def(
    {
      id: 'ragnarok',
      name: 'Ragnarök Protocol',
      short: 'RAGNARÖK',
      description: '8 s of total war: invulnerable, guns reload three times as fast and hit 50% harder. Repairs a quarter of the hull.',
      ult: true,
      cooldown: 110,
      duration: 8,
      accent: 0xff5a2a,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        ship.cleanse();
        ship.extinguish();
        ship.heal(ship.maxHp * 0.25);
        for (const t of ship.turrets) t.reload = 0;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.invulnerable = true;
          m.reloadMul *= 0.33;
          m.secReloadMul *= 0.5;
          m.damageMul *= 1.5;
        });
      },
      aiShouldUse(ship, _g, target) {
        return (hpFrac(ship) < 0.5 && targetInGunRange(ship, target, 0.9)) || hpFrac(ship) < 0.25;
      },
    },
  ),

  // ------------------------------------------------------------------ Habakkuk
  def(
    {
      id: 'droneSwarm',
      name: 'Drone Swarm',
      short: 'DRONE SWARM',
      description: 'Twelve kamikaze drones dive on the enemies nearest the reticle (8k each).',
      cooldown: 18,
      duration: 0,
      accent: 0x9ff4ff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const near = game.ships
          .filter((s) => canTrack(ship, s) && !s.submerged)
          .sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z))
          .slice(0, 3);
        for (let i = 0; i < 12; i++) {
          const t = near.length ? near[i % near.length] : null;
          const m = game.missiles.launch(ship, t ? t.pos.x : p.x, t ? t.pos.z : p.z, i * 0.12, 8000);
          m.target = t;
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
      id: 'cryoField',
      name: 'Cryo Field',
      short: 'CRYO FIELD',
      description: '10 s: the sea freezes for 1 km around you. Enemies inside crawl at 30% speed and turret traverse.',
      cooldown: 26,
      duration: 10,
      accent: 0xbdf3ff,
      icon: 'cryo',
      zone: 1000,
    },
    {
      activate(_ship, _g, st) {
        st.data.tick = 0;
      },
      update(ship, game, dt, st) {
        st.data.tick = (st.data.tick as number) - dt;
        if ((st.data.tick as number) > 0) return;
        st.data.tick = 0.25;
        for (const s of enemiesWithin(ship, game, st.spec.zone!, false)) chill(s, 0.6);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 950, false).length > 0;
      },
    },
  ),
  def(
    {
      id: 'glacierStorm',
      name: 'Glacier Storm',
      short: 'GLACIER STORM',
      description: '48 missiles shared across every enemy within 4 km (12k each).',
      ult: true,
      cooldown: 95,
      duration: 4,
      accent: 0x7fe8ff,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const targets = enemiesWithin(ship, game, 4000).filter((s) => !s.submerged);
        if (!targets.length && ship.humanIndex < 0) return false;
        const p = aimPoint(ship, 4000);
        for (let i = 0; i < 48; i++) {
          const t = targets.length ? targets[i % targets.length] : null;
          const m = game.missiles.launch(ship, t ? t.pos.x : p.x + (game.rng() - 0.5) * 300, t ? t.pos.z : p.z + (game.rng() - 0.5) * 300, i * 0.07, 12000);
          m.target = t;
          m.skill = st.spec;
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'calvingWall',
      name: 'Calving Wall',
      short: 'CALVING WALL',
      description: 'A 700 m wall of ice erupts across the reticle (up to 3 km out): 30k and a deep chill to every hull on it, and for 12 s it stops enemy shells and torpedoes.',
      cooldown: 22,
      duration: 0,
      accent: 0xbfefff,
      icon: 'wall',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 3000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        // Across the bearing: the right-hand vector is (-fz, fx).
        const rx = -forwardZ(b);
        const rz = forwardX(b);
        const x0 = p.x - rx * 350;
        const z0 = p.z - rz * 350;
        const x1 = p.x + rx * 350;
        const z1 = p.z + rz * 350;
        game.addWall(ship, x0, z0, x1, z1, 12, st.spec.accent);
        for (const s of enemiesOnLine(ship, game, x0, z0, x1, z1, 40)) {
          hurt(ship, s, 30000, st.spec);
          if (s.alive) chill(s, 4);
        }
        for (let i = 0; i <= 6; i++) game.events.emit('explosion', { x: x0 + (x1 - x0) * (i / 6), y: 4, z: z0 + (z1 - z0) * (i / 6), size: 1.2 });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 2900) || underFire(ship, game, 1200) >= 8;
      },
    },
  ),
  def(
    {
      id: 'swordfishStrike',
      name: 'Swordfish Strike',
      short: 'SWORDFISH',
      description: 'Six torpedo bombers sweep out and drop a 12-torpedo fan short of the reticle: 14k each.',
      cooldown: 18,
      duration: 2,
      accent: 0x8fe0ff,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        const p = aimPoint(ship, 6000);
        st.data.x = p.x;
        st.data.z = p.z;
        st.data.dropped = false;
      },
      update(ship, game, _dt, st) {
        if (st.data.dropped || st.time > 0.3) return;
        st.data.dropped = true;
        const d = swordfishDrop(ship, st.data.x as number, st.data.z as number);
        for (let i = 0; i < 12; i++) {
          const off = (i / 11 - 0.5) * 36 * DEG;
          const t = game.torps.launch(ship, d.x, d.z, d.heading + off, SWORDFISH_TORP);
          t.skill = st.spec;
        }
        game.events.emit('torpLaunched', { ship, x: d.x, z: d.z, count: 12 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5500) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'pykreteRegrowth',
      name: 'Pykrete Regrowth',
      short: 'REGROWTH',
      description: 'The ice hull grows back: puts out fires and flooding, then 6 s of 40% less damage taken while a quarter of your hit points return.',
      cooldown: 26,
      duration: 6,
      accent: 0xa8f6ff,
      icon: 'heal',
    },
    {
      activate(ship, _g, st) {
        ship.cleanse();
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.6;
          m.fireImmune = true;
        });
      },
      update(ship, _g, dt, st) {
        ship.heal((ship.maxHp * 0.25 * dt) / st.spec.duration);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.65 || burning(ship) >= 2;
      },
    },
  ),
  def(
    {
      id: 'frostLance',
      name: 'Frost Lance',
      short: 'FROST LANCE',
      description: 'A 3 s cryo beam follows the reticle: 25k per second, and every hull it touches freezes to a crawl for 5 s.',
      cooldown: 18,
      duration: 3.6,
      accent: 0xa8f0ff,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, {
          mode: 'aim',
          skill: st.spec,
          charge: 0.5,
          time: 3,
          dps: 25000,
          length: 3600,
          width: 26,
          rate: 30,
          mx: ship.spec.length * 0.3,
          onHit: (s) => chill(s, 5),
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3300);
      },
    },
  ),
  def(
    {
      id: 'blizzard',
      name: 'Blizzard',
      short: 'BLIZZARD',
      description: '10 s of whiteout for 2.5 km around you: enemies inside scatter their shells 2.5 times as wide, slow to 60% and freeze for 8k a second, while allies inside repair 2% a second.',
      ult: true,
      cooldown: 100,
      duration: 10,
      accent: 0xeaf6ff,
      icon: 'snow',
      zone: 2500,
    },
    {
      activate(_ship, _g, st) {
        st.data.tick = 0;
      },
      update(ship, game, dt, st) {
        st.data.tick = (st.data.tick as number) - dt;
        if ((st.data.tick as number) > 0) return;
        st.data.tick = 0.5;
        for (const s of enemiesWithin(ship, game, st.spec.zone!, false)) {
          buff(s, 'debuff:blizzard', 0.6, (m) => {
            m.dispersionMul *= 2.5;
            m.speedMul *= 0.6;
          });
          if (!s.deep) hurt(ship, s, 4000, st.spec);
        }
        for (const s of alliesWithin(ship, game, st.spec.zone!)) s.heal(s.maxHp * 0.01);
      },
      aiShouldUse(ship, game) {
        const n = enemiesWithin(ship, game, 2300, false).length;
        return n >= 2 || (n >= 1 && hpFrac(ship) < 0.5);
      },
    },
  ),
  def(
    {
      id: 'absoluteZero',
      name: 'Absolute Zero',
      short: 'ABSOLUTE ZERO',
      description: 'The sea freezes solid for 1.6 km: 30k to every enemy, frozen in place for 5 s, then crawling and marked (+25% damage taken) for 10 s.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xd8fbff,
      icon: 'cryo',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1600, delay: 0, damage: 30000, stun: 5, speed: 900, follow: true, hitsSubs: true });
        for (const s of enemiesWithin(ship, game, 1600, false)) {
          chill(s, 10);
          mark(s, 10);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1500, false).length >= 2 || (hpFrac(ship) < 0.4 && enemiesWithin(ship, game, 1500, false).length >= 1);
      },
    },
  ),

  // ------------------------------------------------------------------ Raijin
  def(
    {
      id: 'plasmaArc',
      name: 'Plasma Arc',
      short: 'PLASMA ARC',
      description: 'An arc leaps between the three nearest enemies within 2 km: 25k each.',
      cooldown: 14,
      duration: 0,
      accent: 0xd88cff,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const hit = chainLightning(ship, game, st.spec, 3, 2000, 1500, 25000, 0.6);
        return hit.length > 0 || ship.humanIndex >= 0;
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1900, false).length > 0;
      },
    },
  ),
  def(
    {
      id: 'hyperdrive',
      name: 'Hyperdrive',
      short: 'HYPERDRIVE',
      description: 'Jump 700 m ahead, then 4 s at double speed.',
      cooldown: 18,
      duration: 4,
      accent: 0xff7af0,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        if (!blink(ship, game, 700)) return false;
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2;
        });
      },
      aiShouldUse(ship, game, target) {
        return (hpFrac(ship) < 0.5 && underFire(ship, game, 800) >= 4) || (!!target && target.alive && dist(ship, target) > ship.mainRange);
      },
    },
  ),
  def(
    {
      id: 'amaterasu',
      name: 'Amaterasu Lance',
      short: 'AMATERASU',
      description: 'A 6 s orbital laser pillar follows the reticle: 60k per second, boils the sea.',
      ult: true,
      cooldown: 95,
      duration: 6.8,
      accent: 0xfff2a8,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        const lock = enemyNear(ship, game, p.x, p.z, 400);
        if (lock && ship.humanIndex < 0) {
          ship.control.aimX = lock.pos.x;
          ship.control.aimZ = lock.pos.z;
        }
        game.beams.fire(ship, { mode: 'orbital', skill: st.spec, charge: 0.8, time: 6, dps: 60000, width: 80, rate: 90, fireChance: 1.5 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6500);
      },
    },
  ),
  def(
    {
      id: 'raijinDrums',
      name: 'Raijin Drums',
      short: 'RAIJIN DRUMS',
      description: '8 s: six thunder drums circle the hull, and every second each one strikes the nearest enemy within 1.4 km for 6k and a short stun.',
      cooldown: 18,
      duration: 8,
      accent: 0xc9a2ff,
      icon: 'drums',
    },
    {
      activate(ship, game, st) {
        if (!enemiesWithin(ship, game, 1400).length && ship.humanIndex < 0) return false;
        st.data.timer = 0;
        st.data.drum = 0;
      },
      update(ship, game, dt, st) {
        st.data.timer = (st.data.timer as number) - dt;
        // The six drums beat in turn, one every sixth of a second.
        while ((st.data.timer as number) <= 0) {
          st.data.timer = (st.data.timer as number) + 1 / 6;
          const i = (st.data.drum as number) % 6;
          st.data.drum = i + 1;
          const p = drumPos(ship, game.time, i);
          let best: Ship | null = null;
          let bd = 1400;
          for (const s of enemiesWithin(ship, game, 1400 + ship.spec.length)) {
            const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
            if (!s.deep && d < bd) {
              bd = d;
              best = s;
            }
          }
          if (!best) continue;
          game.events.emit('lightning', { points: [p, { x: best.pos.x, y: best.spec.freeboard + 6, z: best.pos.z }], color: st.spec.accent });
          hurt(ship, best, 6000, st.spec);
          if (best.alive) stun(best, 0.2);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1300).length > 0;
      },
    },
  ),
  def(
    {
      id: 'fujinGale',
      name: 'Fujin Gale',
      short: 'FUJIN GALE',
      description: 'A typhoon blasts out toward the reticle, 1.6 km long and 70° wide: 25k to every enemy in it, hurled 400 m back, and every torpedo and missile in its path torn apart.',
      cooldown: 16,
      duration: 0,
      accent: 0x9ff7e0,
      icon: 'gale',
    },
    {
      activate(ship, game, st) {
        const c = bearingTo(ship.pos.x, ship.pos.z, ship.control.aimX, ship.control.aimZ);
        const reach = 1600 + ship.spec.length * 0.5;
        for (const s of enemiesWithin(ship, game, reach, false)) {
          if (s.deep || !inCone(ship, s, c, 35)) continue;
          hurt(ship, s, 25000, st.spec);
          // The push bleeds off at 1.5/s, so 600 m/s carries a hull about 400 m.
          shove(s, s.pos.x - ship.pos.x, s.pos.z - ship.pos.z, 600);
        }
        const inside = (x: number, z: number) => {
          const d = Math.hypot(x - ship.pos.x, z - ship.pos.z);
          return d < reach && Math.abs(wrapAngle(bearingTo(ship.pos.x, ship.pos.z, x, z) - c)) <= 35 * DEG;
        };
        for (const t of game.torps.torps) {
          if (!t.alive || t.team === ship.team || !inside(t.x, t.z)) continue;
          t.alive = false;
          game.events.emit('intercept', { x: t.x, y: 0, z: t.z });
        }
        for (const m of game.missiles.missiles) {
          if (!m.alive || m.team === ship.team || !inside(m.x, m.z)) continue;
          m.alive = false;
          game.events.emit('intercept', { x: m.x, y: m.y, z: m.z });
        }
      },
      aiShouldUse(ship, game, target) {
        if (underFire(ship, game, 1500) >= 8) return true;
        return within(ship, target, 1500);
      },
    },
  ),
  def(
    {
      id: 'lightningRod',
      name: 'Lightning Rod',
      short: 'LIGHTNING ROD',
      description: '8 s: the main battery groups four times as tight, and every hit it lands calls down an 8k thunderbolt.',
      cooldown: 22,
      duration: 8,
      accent: 0xe7d2ff,
      icon: 'rod',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.dispersionMul *= 0.25;
          m.boltOnHit = Math.max(m.boltOnHit, 8000);
          m.boltSkill = st.spec;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85);
      },
    },
  ),
  def(
    {
      id: 'ionShroud',
      name: 'Ion Shroud',
      short: 'ION SHROUD',
      description: '6 s: half damage taken, and anything that hits you is struck back by lightning (4k and a 1 s stun).',
      cooldown: 20,
      duration: 6,
      accent: 0xc58cff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.5;
          m.zap = Math.max(m.zap, 4000);
          m.zapSkill = st.spec;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 5;
      },
    },
  ),
  def(
    {
      id: 'takemikazuchi',
      name: 'Takemikazuchi',
      short: 'TAKEMIKAZUCHI',
      description: 'A 3.2 km blade of lightning sweeps a half circle around the reticle bearing in 2 s, cutting every hull it passes for 150k.',
      ult: true,
      cooldown: 100,
      duration: 2.8,
      accent: 0x9fd8ff,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'sweep', skill: st.spec, charge: 0.7, time: 2, dps: 0, strike: 150000, length: 3200, width: 60, pierce: true, arc: 180, mx: 0, my: ship.spec.freeboard + 20 });
      },
      aiShouldUse(ship, game, target) {
        const n = enemiesWithin(ship, game, 3000).length;
        return n >= 2 || (n >= 1 && within(ship, target, 3000) && hpFrac(target) < 0.6);
      },
    },
  ),
  def(
    {
      id: 'susanoo',
      name: 'Susanoo Tempest',
      short: 'SUSANOO',
      description: 'A 6 s thunderstorm: every 0.4 s a bolt strikes an enemy within 3.5 km for 15k and a short stun.',
      ult: true,
      cooldown: 110,
      duration: 6,
      accent: 0xb9a0ff,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        if (!enemiesWithin(ship, game, 3500).length && ship.humanIndex < 0) return false;
        st.data.timer = 0;
      },
      update(ship, game, dt, st) {
        st.data.timer = (st.data.timer as number) - dt;
        if ((st.data.timer as number) > 0) return;
        st.data.timer = 0.4;
        const near = enemiesWithin(ship, game, 3500);
        if (!near.length) return;
        const t = near[Math.floor(game.rng() * near.length)];
        const ox = (game.rng() - 0.5) * 300;
        const oz = (game.rng() - 0.5) * 300;
        game.events.emit('lightning', {
          points: [
            { x: t.pos.x + ox, y: 1300, z: t.pos.z + oz },
            { x: t.pos.x + ox * 0.4, y: 600, z: t.pos.z + oz * 0.4 },
            { x: t.pos.x, y: t.spec.freeboard + 6, z: t.pos.z },
          ],
          color: st.spec.accent,
        });
        hurt(ship, t, 15000, st.spec);
        if (t.alive) stun(t, 0.5);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3300).length >= 1;
      },
    },
  ),
];
