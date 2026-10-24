import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { SkillSpec, TorpedoSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  buff,
  enemiesWithin,
  hurt,
  intercept,
  mark,
  offBow,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { enemiesAround, every, laser, reticleTarget } from './common';

// Royal Navy: Conqueror, Daring, Glasgow, Queen Elizabeth, Astute. The silent service and the
// shield of the fleet.

const STINGRAY: TorpedoSpec = { name: 'Sting Ray', launchers: [], tubes: 1, reload: 0, speed: 50, range: 2500, damage: 12000, floodChance: 0.4, spread: 0, detect: 600 };
const BUOY_TORP: TorpedoSpec = { ...STINGRAY, name: 'Sonobuoy torpedo', damage: 10000, range: 1500 };

/** Drop a homing torpedo `off` metres short of `t`, on the line from `from`. */
function dropTorp(owner: Ship, from: { x: number; z: number }, t: Ship, off: number, spec: TorpedoSpec, skill: SkillSpec): void {
  const b = bearingTo(from.x, from.z, t.pos.x, t.pos.z);
  const x = t.pos.x - Math.sin(b) * off;
  const z = t.pos.z - Math.cos(b) * off;
  const torp = owner.game.torps.launch(owner, x, z, b, spec, t);
  torp.skill = skill;
  torp.deep = true;
}

export const UK_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Conqueror
  def(
    {
      id: 'dragonFire',
      name: 'DragonFire',
      short: 'DRAGONFIRE',
      description: '8 s: a laser burns the nearest enemy missile, torpedo or plane within 1.5 km every half second. With nothing in the air or water it burns the nearest hull for 4k.',
      cooldown: 22,
      duration: 8,
      accent: 0x80c0ff,
      icon: 'laser',
      zone: 1500,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        const r = 1500;
        const d = (x: number, z: number) => dist2D(ship.pos.x, ship.pos.z, x, z);
        let best = r;
        let kill: (() => void) | null = null;
        let at = { x: 0, y: 0, z: 0 };
        for (const m of game.missiles.missiles) {
          if (!m.alive || m.delay > 0 || m.team === ship.team || m.uninterceptable || d(m.x, m.z) >= best) continue;
          best = d(m.x, m.z);
          at = { x: m.x, y: m.y, z: m.z };
          kill = () => {
            m.alive = false;
          };
        }
        for (const t of game.torps.torps) {
          if (!t.alive || t.team === ship.team || d(t.x, t.z) >= best) continue;
          best = d(t.x, t.z);
          at = { x: t.x, y: 0, z: t.z };
          kill = () => {
            t.alive = false;
          };
        }
        for (const sq of game.air.squadrons) {
          if (!sq.alive || sq.team === ship.team || d(sq.x, sq.z) >= best) continue;
          best = d(sq.x, sq.z);
          at = { x: sq.x, y: sq.y, z: sq.z };
          kill = () => game.air.damage(sq, sq.spec.hp);
        }
        if (kill) {
          kill();
          laser(ship, game, at.x, at.y, at.z, st.spec.accent);
          game.events.emit('intercept', at);
          return;
        }
        const t = enemiesAround(ship, game, ship.pos.x, ship.pos.z, r).filter((s) => !s.submerged)[0];
        if (!t) return;
        hurt(ship, t, 4000, st.spec);
        laser(ship, game, t.pos.x, t.spec.freeboard + 4, t.pos.z, st.spec.accent);
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1500) >= 4 || enemiesWithin(ship, game, 1400).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'broadsideDoctrine',
      name: 'Broadside Doctrine',
      short: 'BROADSIDE',
      description: '10 s: while the ship under the reticle sits 60 to 120 degrees off your bow, your guns reload 40% faster and you take 23% less damage.',
      cooldown: 22,
      duration: 10,
      accent: 0xd0d8ff,
      icon: 'salvo',
    },
    {
      activate() {},
      update(ship, game, _dt, st) {
        const t = reticleTarget(ship, game, ship.mainRange * 1.2, 900);
        if (!t) return;
        const a = offBow(ship, t);
        if (a < 60 || a > 120) return;
        buff(ship, st.spec.id, 0.2, (m) => {
          m.reloadMul *= 0.6;
          m.damageTakenMul *= 0.77;
        });
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, ship.mainRange * 0.9)) return false;
        const a = offBow(ship, target);
        return a > 55 && a < 125;
      },
    },
  ),
  def(
    {
      id: 'shieldOfFleet',
      name: 'Shield of the Fleet',
      short: 'SHIELD OF FLEET',
      description: '10 s: you and every ally within 2 km take 40% less damage. Debuffs on them are cleansed when it starts.',
      ult: true,
      cooldown: 85,
      duration: 10,
      accent: 0x9fd0ff,
      icon: 'shield',
      zone: 2000,
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 2000)) s.cleanse();
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of alliesWithin(ship, game, 2000)) {
          buff(s, st.spec.id, 0.4, (m) => {
            m.damageTakenMul *= 0.6;
          });
        }
      },
      aiShouldUse(ship, game) {
        const allies = alliesWithin(ship, game, 2000);
        return allies.length >= 3 && enemiesWithin(ship, game, ship.mainRange).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Daring
  def(
    {
      id: 'seaViper',
      name: 'Sea Viper',
      short: 'SEA VIPER',
      description: '8 s: Aster missiles kill enemy missiles and shred planes within 600 m of you and of every ally within 2 km.',
      cooldown: 22,
      duration: 8,
      accent: 0x70d0ff,
      icon: 'flak',
      zone: 2000,
    },
    {
      activate() {},
      update(ship, game, dt) {
        for (const s of alliesWithin(ship, game, 2000)) intercept(ship, game, s.pos.x, s.pos.z, 600, dt, { missiles: true, planes: 6000 });
      },
      aiShouldUse(ship, game) {
        let n = 0;
        for (const m of game.missiles.missiles) if (m.alive && m.team !== ship.team && dist2D(m.x, m.z, ship.pos.x, ship.pos.z) < 2600) n++;
        for (const sq of game.air.squadrons) if (sq.alive && sq.team !== ship.team && dist2D(sq.x, sq.z, ship.pos.x, ship.pos.z) < 2600) n += 3;
        return n >= 3;
      },
    },
  ),
  def(
    {
      id: 'wildcatMartlets',
      name: 'Wildcat Martlets',
      short: 'MARTLETS',
      description: 'A Wildcat fires six Martlets at the ship nearest the reticle (6 km): 4k each, and every hit knocks out one of its turrets for 3 s.',
      cooldown: 16,
      duration: 0,
      accent: 0xffd070,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 6000, 1200);
        if (!t) return false;
        for (let i = 0; i < 6; i++) {
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.15, 4000, {
            profile: 'skim',
            speed: 300,
            blast: 30,
            fire: 0,
            target: t,
            skill: st.spec,
            onHit(hit) {
              const live = hit.turrets.filter((tr) => tr.disabled <= 0);
              if (live.length) live[Math.floor(game.rng() * live.length)].disabled = 3;
            },
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800) && !target.submerged && target.turrets.length > 0;
      },
    },
  ),
  def(
    {
      id: 'baitTheSwarm',
      name: 'Bait the Swarm',
      short: 'BAIT THE SWARM',
      description: '8 s: every enemy missile, plane and homing torpedo within 4 km turns on you instead. Whatever comes within 800 m dies, and each kill repairs 1% of your hull.',
      ult: true,
      cooldown: 80,
      duration: 8,
      accent: 0x60c0ff,
      icon: 'magnet',
      zone: 4000,
    },
    {
      activate() {},
      update(ship, game, dt) {
        const d = (x: number, z: number) => dist2D(ship.pos.x, ship.pos.z, x, z);
        let kills = 0;
        for (const m of game.missiles.missiles) {
          if (!m.alive || m.team === ship.team) continue;
          const r = d(m.x, m.z);
          if (r > 4000) continue;
          if (r < 800 && m.delay <= 0) {
            m.alive = false;
            kills++;
            game.events.emit('intercept', { x: m.x, y: m.y, z: m.z });
            continue;
          }
          m.target = ship;
          m.tx = ship.pos.x;
          m.tz = ship.pos.z;
        }
        for (const t of game.torps.torps) {
          if (!t.alive || t.team === ship.team || !t.homing) continue;
          const r = d(t.x, t.z);
          if (r > 4000) continue;
          if (r < 800) {
            t.alive = false;
            kills++;
            game.events.emit('intercept', { x: t.x, y: 0, z: t.z });
            continue;
          }
          t.homing = ship;
        }
        for (const sq of game.air.squadrons) {
          if (!sq.alive || sq.team === ship.team || sq.type === 'fighter') continue;
          const r = d(sq.x, sq.z);
          if (r > 4000) continue;
          if (r < 800) {
            game.air.damage(sq, 20000 * dt);
            continue;
          }
          sq.target = ship;
          sq.tx = ship.pos.x;
          sq.tz = ship.pos.z;
        }
        if (kills) ship.heal(ship.maxHp * 0.01 * kills);
      },
      aiShouldUse(ship, game) {
        let n = 0;
        for (const m of game.missiles.missiles) if (m.alive && m.team !== ship.team && dist2D(m.x, m.z, ship.pos.x, ship.pos.z) < 4000) n++;
        for (const sq of game.air.squadrons) if (sq.alive && sq.team !== ship.team && dist2D(sq.x, sq.z, ship.pos.x, ship.pos.z) < 4000) n += 3;
        return n >= 6;
      },
    },
  ),

  // ------------------------------------------------------------------ Glasgow
  def(
    {
      id: 'stingrayDrop',
      name: 'Sting Ray Drop',
      short: 'STING RAY',
      description: 'A Merlin drops two homing Sting Rays beside the ship under the reticle (2.5 km): 12k each, and they find submarines at any depth.',
      cooldown: 18,
      duration: 0,
      accent: 0x70e0c0,
      icon: 'torpedo',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 2500, 800);
        if (!t) return false;
        dropTorp(ship, ship.pos, t, 450, STINGRAY, st.spec);
        dropTorp(ship, { x: t.pos.x + forwardX(t.heading) * 400, z: t.pos.z + forwardZ(t.heading) * 400 }, t, 450, STINGRAY, st.spec);
        game.events.emit('torpLaunched', { ship, x: t.pos.x, z: t.pos.z, count: 2 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2400);
      },
    },
  ),
  def(
    {
      id: 'sonar2087',
      name: 'Sonar 2087',
      short: 'SONAR 2087',
      description: '12 s: active towed sonar drives every enemy submarine within 3 km up to periscope depth and marks it.',
      cooldown: 24,
      duration: 12,
      accent: 0x80ffe0,
      icon: 'radar',
      zone: 3000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team || !s.isSub || dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) > 3000) continue;
          if (s.depthState > 1) s.depthState = 1;
          mark(s, 0.5);
        }
      },
      aiShouldUse(ship, game) {
        return game.ships.some((s) => s.alive && s.team !== ship.team && s.isSub && dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) < 2800);
      },
    },
  ),
  def(
    {
      id: 'sonobuoyBarrier',
      name: 'Sonobuoy Barrier',
      short: 'SONOBUOYS',
      description: 'A 2 km line of sonobuoys along the reticle bearing, centred on the reticle (5 km), listens for 20 s. Every enemy crossing it draws three homing torpedoes: 10k each.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0x60ffc0,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const dx = Math.sin(b) * 1000;
        const dz = Math.cos(b) * 1000;
        game.fields.addWire(
          ship,
          p.x - dx,
          p.z - dz,
          p.x + dx,
          p.z + dz,
          20,
          (s) => {
            if (!ship.alive) return;
            for (let i = 0; i < 3; i++) {
              const a = (i / 3) * Math.PI * 2;
              dropTorp(ship, { x: s.pos.x + Math.sin(a) * 600, z: s.pos.z + Math.cos(a) * 600 }, s, 350, BUOY_TORP, st.spec);
            }
          },
          st.spec,
        );
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800) && target.speed > 5;
      },
    },
  ),

  // ------------------------------------------------------------------ Queen Elizabeth
  def(
    {
      id: 'stovlRecovery',
      name: 'STOVL Recovery',
      short: 'STOVL',
      description: 'Short take-off, vertical landing: the deck is clear at once and every hangar gets one squadron back.',
      cooldown: 24,
      duration: 0,
      accent: 0xa0c8ff,
      icon: 'plane',
    },
    {
      activate(ship) {
        const air = ship.spec.air;
        const st = ship.air;
        if (!air || !st) return false;
        st.cooldown = 0;
        for (const k of ['torpedo', 'dive', 'fighter'] as const) {
          st.hangar[k] = Math.min(air[k].hangar, st.hangar[k] + 1);
          st.restore[k] = 0;
        }
      },
      aiShouldUse(ship) {
        const air = ship.spec.air;
        const st = ship.air;
        if (!air || !st) return false;
        return st.hangar.dive + st.hangar.torpedo <= 2;
      },
    },
  ),
  def(
    {
      id: 'crowsnest',
      name: 'Crowsnest',
      short: 'CROWSNEST',
      description: '15 s: an airborne radar Merlin. Allies within 3 km (you too) shoot down planes twice as hard from 50% further, and enemies within 3 km are marked.',
      cooldown: 26,
      duration: 15,
      accent: 0xc0e0ff,
      icon: 'eye',
      zone: 3000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        for (const s of alliesWithin(ship, game, 3000)) {
          buff(s, st.spec.id, 0.6, (m) => {
            m.aaMul *= 2;
            m.aaRangeMul *= 1.5;
          });
        }
        for (const s of enemiesWithin(ship, game, 3000, false)) mark(s, 0.6);
      },
      aiShouldUse(ship, game) {
        let planes = 0;
        for (const sq of game.air.squadrons) if (sq.alive && sq.team !== ship.team && dist2D(sq.x, sq.z, ship.pos.x, ship.pos.z) < 4000) planes++;
        return planes >= 1 || enemiesWithin(ship, game, 3000, false).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'carrierStrikeGroup',
      name: 'Carrier Strike Group',
      short: 'STRIKE GROUP',
      description: 'A Daring and a Glasgow join your screen for 30 s, and your squadrons hit 50% harder while they sail.',
      ult: true,
      cooldown: 90,
      duration: 30,
      accent: 0x90b8ff,
      icon: 'fleet',
    },
    {
      activate(ship, game, st) {
        game.spawnWingman(ship, 260, st.spec.duration, 120, 'daring', `${ship.name} escort HMS Daring`);
        game.spawnWingman(ship, -260, st.spec.duration, 120, 'glasgow', `${ship.name} escort HMS Glasgow`);
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageMul *= 1.5;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 7000).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Astute
  def(
    {
      id: 'spearfish',
      name: 'Spearfish',
      short: 'SPEARFISH',
      description: 'The next spread runs at 80 knots and leaves no wake: enemies see it only inside 500 m.',
      cooldown: 16,
      duration: 0,
      accent: 0x70ffd0,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        const t = ship.spec.torpedoes;
        if (!t) return false;
        ship.torpBuff = { skill: st.spec, speedMul: Math.max(1, 80 / t.speed), spreads: 1, homing: false, wakeless: true };
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.9) && ship.launchers.some((l) => l.reload <= 0);
      },
    },
  ),
  def(
    {
      id: 'huntersPatience',
      name: "Hunter's Patience",
      short: 'PATIENCE',
      description: 'Within 15 s, hold at a quarter speed or less for 3 s and the next spread you fire deals double damage.',
      cooldown: 20,
      duration: 15,
      accent: 0x9fffe0,
      icon: 'time',
    },
    {
      activate(_ship, _g, st) {
        st.data.still = 0;
      },
      update(ship, _g, dt, st) {
        if (Math.abs(ship.speed) > ship.maxSpeed * 0.25) {
          st.data.still = 0;
          return;
        }
        st.data.still = (st.data.still as number) + dt;
        if ((st.data.still as number) < 3) return;
        ship.torpBuff = { skill: st.spec, speedMul: 1, spreads: 1, homing: false, damageMul: 2 };
        st.time = 0;
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.9) && Math.abs(ship.speed) < ship.maxSpeed * 0.5;
      },
    },
  ),
  def(
    {
      id: 'hunterKiller',
      name: 'Hunter-Killer',
      short: 'HUNTER-KILLER',
      description: 'Tubes reload now. For 15 s your torpedoes home, every ship they hit is held to half speed, and each further hit on the same ship deals triple.',
      ult: true,
      cooldown: 85,
      duration: 15,
      accent: 0x40ffb0,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        const t = ship.spec.torpedoes;
        if (!t) return false;
        for (const l of ship.launchers) l.reload = 0;
        const struck = new Set<Ship>();
        st.data.struck = struck;
        ship.torpBuff = {
          skill: st.spec,
          speedMul: 1,
          spreads: 99,
          homing: true,
          onHit(target) {
            // The hit itself already landed: two more of it make a triple.
            if (struck.has(target)) hurt(ship, target, t.damage * 2 * ship.mods.torpDamageMul, st.spec);
            struck.add(target);
            buff(target, 'debuff:hunterKiller', Math.max(1, st.time), (m) => {
              m.speedMul *= 0.5;
            });
          },
        };
      },
      end(ship, _g, st) {
        if (ship.torpBuff?.skill === st.spec) ship.torpBuff = null;
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.8);
      },
    },
  ),
];
