import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  buff,
  enemiesOnLine,
  enemiesWithin,
  hpFrac,
  hurt,
  intercept,
  nearestEnemy,
  root,
  stun,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { arc, clingTo, droneDive, enemiesAround, every, hurryCooldowns, landNear } from './common';

// Chinese Hive Fleet: Tiangong, Shenzhou, Wukong, Queqiao, Jiaolong.
// The hive and nanotech. Nanite hulls repair even under fire, and summons stay 50% longer.

/** Allies sunk recently enough to rebuild: their wrecks are still on the water. */
function freshWrecks(ship: Ship, game: Ship['game'], r: number): Ship[] {
  return game.ships.filter((s) => !s.alive && !s.withdrawn && !s.isSummon && s.team === ship.team && s !== ship && s.deathTime <= 40 && dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z) < r);
}

export const CN_SF_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Tiangong
  def(
    {
      id: 'naniteCloud',
      name: 'Nanite Cloud',
      short: 'NANITE CLOUD',
      description: '8 s: a 1 km nanite cloud rides with you. Allies inside repair 1.5% a second; enemies inside are eaten for 4.5k a second.',
      cooldown: 22,
      duration: 0,
      accent: 0x40ffb8,
      icon: 'heal',
      zone: 1000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 1000, life: 8, follow: ship, skill: st.spec, look: 'nanite', color: st.spec.accent, heal: 0.015, dps: 4500 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1000).length >= 1 || (hpFrac(ship) < 0.7 && alliesWithin(ship, game, 1000).length >= 2);
      },
    },
  ),
  def(
    {
      id: 'adaptiveNanoweave',
      name: 'Adaptive Nanoweave',
      short: 'NANOWEAVE',
      description: '10 s: the hull learns from every wound. Half of all damage you take is rebuilt over the next 3 s.',
      cooldown: 22,
      duration: 10,
      accent: 0x1fbf8a,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        st.data.last = ship.intake;
        st.data.pool = 0;
      },
      update(ship, _g, dt, st) {
        const fresh = ship.intake - (st.data.last as number);
        st.data.last = ship.intake;
        let pool = (st.data.pool as number) + fresh * 0.5;
        // Rebuild a third of what is owed each second.
        const give = Math.min(pool, (pool / 3) * dt + 200 * dt);
        pool -= give;
        st.data.pool = pool;
        ship.heal(give);
      },
      end(ship, _g, st) {
        // Whatever is still owed is paid at once.
        ship.heal(st.data.pool as number);
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1000) >= 6 || hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'replicator',
      name: 'Replicator',
      short: 'REPLICATOR',
      description: 'The nanite forge prints a full-strength twin of your ship, skills and all, that fights beside you for 25 s.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0x40ffb8,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        if (ship.isSummon) return false;
        const twin = game.spawnWingman(ship, 260, 25, -40, ship.spec.id, `${ship.name} Replica`);
        twin.maxHp = twin.hp = ship.maxHp;
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, ship.mainRange).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Shenzhou
  def(
    {
      id: 'shieldDrones',
      name: 'Shield Drones',
      short: 'SHIELD DRONES',
      description: 'Drones fly out to you and the four nearest allies (2.5 km): each gets a 15k shield for 8 s, missiles that come within 300 m of them are shot down, and once a second each drone zaps the nearest enemy within 1.5 km for 2.5k.',
      cooldown: 22,
      duration: 8,
      accent: 0x40ffb8,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        const d = (s: Ship) => dist2D(s.pos.x, s.pos.z, ship.pos.x, ship.pos.z);
        const list = [ship, ...alliesWithin(ship, game, 2500).filter((s) => s !== ship).sort((a, b) => d(a) - d(b)).slice(0, 4)];
        for (const s of list) {
          s.addShield(15000, 8);
          if (s !== ship) arc(game, ship, s, st.spec.accent);
        }
        st.data.list = list;
      },
      update(ship, game, dt, st) {
        const zap = every(st, dt, 1);
        for (const s of st.data.list as Ship[]) {
          if (!s.alive) continue;
          intercept(ship, game, s.pos.x, s.pos.z, 300, dt, { missiles: true });
          if (!zap) continue;
          const d = (e: Ship) => dist2D(e.pos.x, e.pos.z, s.pos.x, s.pos.z);
          const e = enemiesAround(ship, game, s.pos.x, s.pos.z, 1500).sort((a, b) => d(a) - d(b))[0];
          if (!e) continue;
          arc(game, s, e, st.spec.accent);
          hurt(ship, e, 2500, st.spec);
        }
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 2500).some((s) => s !== ship && underFire(s, game, 800) >= 4) || underFire(ship, game, 800) >= 6;
      },
    },
  ),
  def(
    {
      id: 'hexLattice',
      name: 'Hex Lattice',
      short: 'HEX LATTICE',
      description: 'Six drones lock into a hexagon 600 m across at the reticle (4 km) for 8 s. Its walls stop enemy shells.',
      cooldown: 18,
      duration: 0,
      accent: 0x60ffc8,
      icon: 'wall',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        const r = 300;
        for (let i = 0; i < 6; i++) {
          const a0 = (i / 6) * Math.PI * 2;
          const a1 = ((i + 1) / 6) * Math.PI * 2;
          game.addWall(ship, p.x + Math.cos(a0) * r, p.z + Math.sin(a0) * r, p.x + Math.cos(a1) * r, p.z + Math.sin(a1) * r, 8, st.spec.accent);
        }
      },
      aiShouldUse(ship, game) {
        // Wall in the ally taking the most fire.
        let best: Ship | null = null;
        let most = 5;
        for (const s of alliesWithin(ship, game, 4000)) {
          const n = underFire(s, game, 800);
          if (n > most) {
            most = n;
            best = s;
          }
        }
        if (!best) return false;
        ship.control.aimX = best.pos.x;
        ship.control.aimZ = best.pos.z;
        return true;
      },
    },
  ),
  def(
    {
      id: 'resurrectionProtocol',
      name: 'Resurrection Protocol',
      short: 'RESURRECT',
      description: 'Rebuild up to two allies sunk within 4 km in the last 40 s, at their wrecks, with half their hull. With no wreck to rebuild, every ally within 2 km repairs 30% and is cleansed.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0x80ffd0,
      icon: 'heal',
    },
    {
      activate(ship, game, st) {
        const wrecks = freshWrecks(ship, game, 4000).slice(0, 2);
        for (const s of wrecks) game.revive(s, s.pos.x, s.pos.z, 0.5, st.spec);
        if (wrecks.length) return;
        for (const s of alliesWithin(ship, game, 2000)) {
          s.heal(s.maxHp * 0.3);
          s.cleanse();
        }
      },
      aiShouldUse(ship, game) {
        if (freshWrecks(ship, game, 4000).length) return true;
        return alliesWithin(ship, game, 2000).filter((s) => hpFrac(s) < 0.5).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Wukong
  def(
    {
      id: 'hairClones',
      name: 'Hair Clones',
      short: 'HAIR CLONES',
      description: 'Pluck three hairs and blow: three monkey clones race out beside you for 16 s, with lasers and torpedoes of their own.',
      cooldown: 24,
      duration: 0,
      accent: 0xffc040,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        if (ship.isSummon) return false;
        for (let i = 0; i < 3; i++) game.spawnWingman(ship, (i - 1) * 160, 16, i === 1 ? 120 : 0, 'wukongClone', `${ship.name} Clone ${i + 1}`);
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, 4000);
      },
    },
  ),
  def(
    {
      id: 'goldenCudgel',
      name: 'Golden Cudgel',
      short: 'GOLDEN CUDGEL',
      description: 'The cudgel grows 1.5 km long and slams down along the reticle bearing: 22k to every enemy on it and a 1 s stun.',
      cooldown: 14,
      duration: 0,
      accent: 0xffd040,
      icon: 'hammer',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 1500);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const reach = 1500 * ship.mods.reachMul;
        const ex = ship.pos.x + forwardX(b) * reach;
        const ez = ship.pos.z + forwardZ(b) * reach;
        game.events.emit('lightning', { points: [{ x: ship.pos.x, y: 30, z: ship.pos.z }, { x: ex, y: 4, z: ez }], color: st.spec.accent, straight: true });
        for (const s of enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, ex, ez, 60)) {
          hurt(ship, s, 22000, st.spec);
          if (s.alive) stun(s, 1);
        }
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 1400) || target.deep) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return true;
      },
    },
  ),
  def(
    {
      id: 'havocInHeaven',
      name: 'Havoc in Heaven',
      short: 'HAVOC',
      description: '8 s: nothing can harm you, you sail 60% faster, and every enemy within 600 m takes 14k a second.',
      ult: true,
      cooldown: 85,
      duration: 8,
      accent: 0xffb020,
      icon: 'hammer',
      zone: 600,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 600, life: st.spec.duration, follow: ship, skill: st.spec, look: 'fire', color: st.spec.accent, dps: 14000 });
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.invulnerable = true;
          m.speedMul *= 1.6;
        });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 1500) || (underFire(ship, game, 800) >= 6 && hpFrac(ship) < 0.5);
      },
    },
  ),

  // ------------------------------------------------------------------ Queqiao
  def(
    {
      id: 'magpieSwarm',
      name: 'Magpie Swarm',
      short: 'MAGPIES',
      description: 'The next dive squadron bursts into micro-drones over its target: four 2.5k drones on every enemy within 800 m of it.',
      cooldown: 16,
      duration: 0,
      accent: 0x60ffd0,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        if (!ship.spec.air) return false;
        ship.airBuff = {
          skill: st.spec,
          types: ['dive'],
          onDrop: (sq, t) => {
            for (const s of enemiesAround(ship, game, t.pos.x, t.pos.z, 800).filter((e) => !e.submerged)) {
              for (const m of droneDive(ship, game, s, 4, 2500, st.spec, 0.5)) {
                // They burst from the squadron, not the carrier.
                m.x = sq.x;
                m.z = sq.z;
                m.y = sq.y;
              }
            }
          },
        };
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && !!ship.air && ship.air.hangar.dive > 0 && within(ship, target, air.range * 0.9) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'relayBridge',
      name: 'Relay Bridge',
      short: 'RELAY BRIDGE',
      description: 'Warp the ally nearest the reticle (4 km) to your side, with a 20k shield for 8 s.',
      cooldown: 22,
      duration: 0,
      accent: 0x80e0ff,
      icon: 'portal',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 4000);
        let a: Ship | null = null;
        let bd = 1200;
        for (const s of game.ships) {
          if (!s.alive || s === ship || s.team !== ship.team || s.spec.cls === 'TT') continue;
          const d = dist2D(s.pos.x, s.pos.z, p.x, p.z);
          if (d < bd) {
            bd = d;
            a = s;
          }
        }
        if (!a) return false;
        const side = game.rng() < 0.5 ? 1 : -1;
        if (!landNear(a, game, ship.pos.x, ship.pos.z, 260 + a.spec.beam, ship.heading + (side * Math.PI) / 2)) return false;
        a.addShield(20000, 8);
      },
      aiShouldUse(ship, game) {
        // Pull out the ally in the most trouble.
        for (const s of alliesWithin(ship, game, 4000)) {
          if (s === ship || s.spec.cls === 'TT' || hpFrac(s) > 0.35 || underFire(s, game, 800) < 4) continue;
          ship.control.aimX = s.pos.x;
          ship.control.aimZ = s.pos.z;
          return true;
        }
        return false;
      },
    },
  ),
  def(
    {
      id: 'bridgeOfMagpies',
      name: 'Bridge of Magpies',
      short: 'MAGPIE BRIDGE',
      description: '12 s: the magpie relay links the whole fleet. Every ally\'s skills cool down twice as fast, and their ultimates charge 1.5% a second.',
      ult: true,
      cooldown: 90,
      duration: 12,
      accent: 0xa0f0ff,
      icon: 'fleet',
    },
    {
      activate() {},
      update(ship, game, dt) {
        for (const s of game.ships) {
          if (!s.alive || s.team !== ship.team) continue;
          hurryCooldowns(s, dt);
          if (s !== ship) s.charge(0.015 * dt);
        }
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 5000).length >= 3 && enemiesWithin(ship, game, 8000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Jiaolong
  def(
    {
      id: 'leechTorps',
      name: 'Leech Torpedoes',
      short: 'LEECH TORPS',
      description: 'The next spread hits 20% harder and feeds on what it hits: each hit repairs you by half its damage.',
      cooldown: 16,
      duration: 12,
      accent: 0x40ffb8,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        const t = ship.spec.torpedoes;
        if (!t) return false;
        ship.torpBuff = { skill: st.spec, speedMul: 1, spreads: 1, damageMul: 1.2, onHit: () => ship.heal(t.damage * 1.2 * 0.5 * ship.mods.damageMul) };
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
      id: 'jiaoCoil',
      name: 'Jiao Coil',
      short: 'JIAO COIL',
      description: 'Coil round the nearest enemy within 400 m for 5 s: it is held dead in the water and crushed for 6k a second.',
      cooldown: 18,
      duration: 0,
      accent: 0x1fbf8a,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        const t = nearestEnemy(ship, game, 400);
        if (!t) return false;
        root(t, 5);
        clingTo(ship, game, t, 6000, 5, st.spec);
        arc(game, ship, t, st.spec.accent, false);
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, 380);
      },
    },
  ),
  def(
    {
      id: 'floodDragon',
      name: 'Flood Dragon',
      short: 'FLOOD DRAGON',
      description: 'The jiao rises as a 2 km surge along your heading: 40k to every hull in its path, a 500 m shove to the side, and flooding.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x40c0ff,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const fx = forwardX(ship.heading);
        const fz = forwardZ(ship.heading);
        const ex = ship.pos.x + fx * 2000;
        const ez = ship.pos.z + fz * 2000;
        game.events.emit('lightning', { points: [{ x: ship.pos.x, y: 4, z: ship.pos.z }, { x: ex, y: 4, z: ez }], color: st.spec.accent });
        for (let i = 1; i <= 8; i++) {
          const k = i / 8;
          game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: ship.pos.x + fx * 2000 * k, z: ship.pos.z + fz * 2000 * k, radius: 120, delay: k * 0.8, damage: 0, look: 'quake' });
        }
        for (const s of enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, ex, ez, 200)) {
          hurt(ship, s, 40000, st.spec);
          if (!s.alive) continue;
          s.startFlood(ship);
          // Thrown to whichever side of the line it was on.
          const side = (s.pos.x - ship.pos.x) * -fz + (s.pos.z - ship.pos.z) * fx >= 0 ? 1 : -1;
          s.shove(-fz * side * 750, fx * side * 750);
        }
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 1900) || target.deep) return false;
        const fx = forwardX(ship.heading);
        const fz = forwardZ(ship.heading);
        return enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, ship.pos.x + fx * 2000, ship.pos.z + fz * 2000, 200).length >= 1;
      },
    },
  ),
];
