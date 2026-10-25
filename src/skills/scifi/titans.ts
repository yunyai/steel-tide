import type { Game } from '../../core/Game';
import { distToHull } from '../../core/hull';
import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  banish,
  blinkTo,
  buff,
  disarm,
  dist,
  enemiesOnLine,
  enemiesWithin,
  hpFrac,
  hurt,
  intercept,
  link,
  mark,
  nextSalvo,
  pullToward,
  raiseAt,
  root,
  silence,
  stun,
  targetInGunRange,
  turnMissile,
  turnTorpedo,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { arc, clingTo, droneDive, enemiesAround, every, hurryCooldowns, landNear, orbitalLaser, reticleTarget, spendHull } from './common';

// Kaguya, Koschei, Constellation and Nüwa: the sci-fi titans. Six skills and three ultimates each.

export const SCIFI_TITAN_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Kaguya
  def(
    {
      id: 'moonstep',
      name: 'Moonstep',
      short: 'MOONSTEP',
      description: 'Step through moonlight to the reticle, up to 1 km away in any direction.',
      cooldown: 14,
      duration: 0,
      accent: 0xe8ecff,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 1000);
        return blinkTo(ship, game, p.x, p.z);
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 1000) >= 10 || (within(ship, target, ship.mainRange) && !within(ship, target, ship.mainRange * 0.5) && hpFrac(ship) > 0.6);
      },
    },
  ),
  def(
    {
      id: 'crescentVolley',
      name: 'Crescent Volley',
      short: 'CRESCENT',
      description: 'The next three salvos fire as railguns: instant reload, flat and straight, half the spread and 30% more damage.',
      cooldown: 18,
      duration: 0,
      accent: 0xff3a5a,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, { railgun: true, dispersionMul: 0.5, damageMul: 1.3 });
        if (ship.salvo) ship.salvo.left *= 3;
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85);
      },
    },
  ),
  def(
    {
      id: 'lunarShroud',
      name: 'Lunar Shroud',
      short: 'LUNAR SHROUD',
      description: '8 s wrapped in moonlight: nothing can target you, and you sail twice as fast.',
      cooldown: 28,
      duration: 8,
      accent: 0xc8d0ff,
      icon: 'cloak',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.untargetable = true;
          m.speedMul *= 2;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 12 || hpFrac(ship) < 0.35;
      },
    },
  ),
  def(
    {
      id: 'tideLock',
      name: 'Tide Lock',
      short: 'TIDE LOCK',
      description: '8 s: the moon holds the sea within 2 km of you. Enemies there are slowed 50% and their turrets train at half speed.',
      cooldown: 22,
      duration: 0,
      accent: 0x9ab0ff,
      icon: 'time',
      zone: 2000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 2000,
          life: 8,
          follow: ship,
          skill: st.spec,
          look: 'time',
          color: st.spec.accent,
          slow: 0.5,
          onTick: (s: Ship) => {
            if (s.team === ship.team) return;
            buff(s, 'debuff:tideLock', 0.4, (m) => {
              m.traverseMul *= 0.5;
            });
          },
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'usagiDrones',
      name: 'Usagi Drones',
      short: 'USAGI',
      description: 'Six rabbit drones bound out to the three nearest enemies within 4 km, two apiece: 8k each, and a hit marks the target for 8 s.',
      cooldown: 16,
      duration: 0,
      accent: 0xffffff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const d = (s: Ship) => Math.hypot(s.pos.x - ship.pos.x, s.pos.z - ship.pos.z);
        const prey = enemiesWithin(ship, game, 4000)
          .filter((s) => !s.submerged)
          .sort((a, b) => d(a) - d(b))
          .slice(0, 3);
        if (!prey.length) return false;
        for (const t of prey) droneDive(ship, game, t, 2, 8000, st.spec, 0.5, (s) => mark(s, 8));
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800).filter((s) => !s.submerged).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'silverArc',
      name: 'Silver Arc',
      short: 'SILVER ARC',
      description: 'Three silver crescents scythe out along the reticle bearing and 20 degrees either side, 3 km long: 40k to every hull each one passes through.',
      cooldown: 18,
      duration: 0,
      accent: 0xe0e8ff,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 3000);
        const brg = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        for (const off of [-20, 0, 20]) {
          const b = brg + (off * Math.PI) / 180;
          const ex = ship.pos.x + forwardX(b) * 3000;
          const ez = ship.pos.z + forwardZ(b) * 3000;
          game.events.emit('lightning', { points: [{ x: ship.pos.x, y: 20, z: ship.pos.z }, { x: ex, y: 6, z: ez }], color: st.spec.accent, straight: true });
          for (const s of enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, ex, ez, 50)) hurt(ship, s, 40000, st.spec);
        }
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 2900) || target.deep) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return true;
      },
    },
  ),
  def(
    {
      id: 'horaiElixir',
      name: 'Hōrai Elixir',
      short: 'HŌRAI',
      description: '10 s: the elixir of immortality. Repair 6% a second, shed every debuff, and take 30% less damage.',
      ult: true,
      cooldown: 85,
      duration: 10,
      accent: 0xfff0a0,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.cleanse();
      },
      update(ship, _g, dt, st) {
        ship.heal(ship.maxHp * 0.06 * dt);
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageTakenMul *= 0.7;
        });
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.45;
      },
    },
  ),
  def(
    {
      id: 'fullMoon',
      name: 'Full Moon',
      short: 'FULL MOON',
      description: '12 s under the full moon: double damage, and your normal skills cool down three times as fast.',
      ult: true,
      cooldown: 85,
      duration: 12,
      accent: 0xfff8e0,
      icon: 'eye',
    },
    {
      activate() {},
      update(ship, _g, dt, st) {
        hurryCooldowns(ship, dt * 2);
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageMul *= 2;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, ship.mainRange * 0.8).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'moonfall',
      name: 'Moonfall',
      short: 'MOONFALL',
      description: 'A shard of the moon falls on the reticle (6 km) 3 s later: 150k at the centre, fading out to 1.3 km.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xd8dce8,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 1300, delay: 3, damage: 150000, fire: 0.6, knock: 200, look: 'meteor' });
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 5800) || target.deep) return false;
        ship.control.aimX = target.pos.x + forwardX(target.heading) * target.speed * 1.5;
        ship.control.aimZ = target.pos.z + forwardZ(target.heading) * target.speed * 1.5;
        return enemiesWithin(ship, game, 7000).length >= 2 || target.spec.cls === 'TT';
      },
    },
  ),

  // ------------------------------------------------------------------ Koschei
  def(
    {
      id: 'gravityAnchor',
      name: 'Gravity Anchor',
      short: 'ANCHOR',
      description: '8 s: a gravity cage 2 km wide rides with you. Enemies inside cannot sail out of it.',
      cooldown: 24,
      duration: 0,
      accent: 0x9050e0,
      icon: 'gravity',
      zone: 2000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 2000, life: 8, follow: ship, skill: st.spec, look: 'void', color: st.spec.accent, cage: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'empLattice',
      name: 'EMP Lattice',
      short: 'EMP LATTICE',
      description: 'A 3 km EMP lattice across the reticle (6 km), square to its bearing, for 12 s. Any enemy crossing it is silenced 4 s and stunned 1 s.',
      cooldown: 20,
      duration: 0,
      accent: 0x60c0ff,
      icon: 'silence',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const nx = Math.cos(b);
        const nz = Math.sin(b);
        game.fields.addWire(
          ship,
          p.x - nx * 1500,
          p.z - nz * 1500,
          p.x + nx * 1500,
          p.z + nz * 1500,
          12,
          (s) => {
            silence(s, 4);
            stun(s, 1);
          },
          st.spec,
        );
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 5500) || target.speed < 10) return false;
        // Lay it across the target's path.
        ship.control.aimX = target.pos.x + forwardX(target.heading) * 300;
        ship.control.aimZ = target.pos.z + forwardZ(target.heading) * 300;
        return true;
      },
    },
  ),
  def(
    {
      id: 'ironHail',
      name: 'Iron Hail',
      short: 'IRON HAIL',
      description: '8 s: the secondary batteries reach twice as far, reload three times as fast and never miss.',
      cooldown: 22,
      duration: 8,
      accent: 0xd84a1a,
      icon: 'flak',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.secRangeMul *= 2;
          m.secReloadMul *= 0.33;
          m.secPerfect = true;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3500).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'redSwarm',
      name: 'Red Swarm',
      short: 'RED SWARM',
      description: 'Three drone frigates launch from the hangar decks and fight beside you for 30 s.',
      cooldown: 40,
      duration: 0,
      accent: 0xff4020,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        if (ship.isSummon) return false;
        [
          [-300, 0],
          [300, 0],
          [0, 260],
        ].forEach(([lat, back], i) => game.spawnWingman(ship, lat, 30, back, 'droneFrigate', `${ship.name} Drone ${i + 1}`));
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, ship.mainRange).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'reactorVent',
      name: 'Reactor Vent',
      short: 'REACTOR VENT',
      description: '5 s: vent the reactor into the sea. Every enemy within 600 m takes 16k a second; the vent costs you 1% of your hull a second.',
      cooldown: 20,
      duration: 5,
      accent: 0xff6a20,
      icon: 'nuke',
      zone: 600,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 600, life: st.spec.duration, follow: ship, skill: st.spec, look: 'fire', color: st.spec.accent, dps: 16000 });
      },
      update(ship, _g, dt) {
        spendHull(ship, 0.01 * dt);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 550).length >= 1 && hpFrac(ship) > 0.2;
      },
    },
  ),
  def(
    {
      id: 'koscheiGrasp',
      name: "Koschei's Grasp",
      short: 'GRASP',
      description: 'A gravity hand drags the enemy under the reticle (4 km) up to 1.5 km toward you over 3 s, then pins it in place for 2 s.',
      cooldown: 22,
      duration: 3,
      accent: 0x7020c0,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 4000, 500);
        if (!t || t.spec.cls === 'TT') return false;
        st.data.t = t;
      },
      update(ship, _g, dt, st) {
        const t = st.data.t as Ship;
        if (t.alive) pullToward(t, ship.pos.x, ship.pos.z, 500, dt, ship.spec.length * 0.6 + 150);
      },
      end(_s, _g, st) {
        const t = st.data.t as Ship;
        if (t.alive) root(t, 2);
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 3800) || target.spec.cls === 'TT') return false;
        if (Math.hypot(target.pos.x - ship.pos.x, target.pos.z - ship.pos.z) < 1500) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return true;
      },
    },
  ),
  def(
    {
      id: 'deathless',
      name: 'Deathless',
      short: 'DEATHLESS',
      description: 'For 30 s Koschei cannot die: the first blow that would sink him leaves him at 60% of his hull instead.',
      ult: true,
      cooldown: 85,
      duration: 30,
      accent: 0x80ff60,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        ship.lastStand = { until: game.time + st.spec.duration, hpFrac: 0.6, skill: st.spec };
      },
      end(ship, _g, st) {
        if (ship.lastStand?.skill === st.spec) ship.lastStand = null;
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.35 && underFire(ship, game, 1500) >= 4;
      },
    },
  ),
  def(
    {
      id: 'gravityCollapse',
      name: 'Gravity Collapse',
      short: 'COLLAPSE',
      description: 'Everything within 3 km is dragged toward you for 2 s, then the well collapses: 60k to every enemy within 1.2 km.',
      ult: true,
      cooldown: 85,
      duration: 2,
      accent: 0x6010b0,
      icon: 'gravity',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 3000, life: 2, follow: ship, skill: st.spec, look: 'void', color: st.spec.accent, pull: 400 });
      },
      end(ship, game, st) {
        if (!ship.alive) return;
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1200, delay: 0, damage: 60000, speed: 1500, hitsSubs: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2500).filter((s) => !s.deep).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'needleInTheEgg',
      name: 'Needle in the Egg',
      short: 'NEEDLE',
      description: 'Koschei hides his death in an egg left 400 m astern. While the egg survives (20 s at most), he takes 75% less damage.',
      ult: true,
      cooldown: 85,
      duration: 20,
      accent: 0xe0d0a0,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        if (ship.isSummon) return false;
        st.data.egg = game.spawnWingman(ship, 0, st.spec.duration, -400 - ship.spec.length * 0.5, 'koscheiEgg', "Koschei's Egg");
      },
      update(ship, _g, _dt, st) {
        const egg = st.data.egg as Ship;
        if (!egg.alive) return;
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageTakenMul *= 0.25;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1500) >= 8 || hpFrac(ship) < 0.5;
      },
    },
  ),

  // ------------------------------------------------------------------ Constellation
  def(
    {
      id: 'skyhook',
      name: 'Skyhook',
      short: 'SKYHOOK',
      description: 'A tether from orbit lifts the ship under the reticle (5 km) out of the fight for 3 s, then drops it: 40k and a 2 s stun. A titan is too heavy to lift and only takes the damage.',
      cooldown: 20,
      duration: 3,
      accent: 0x90c8ff,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 5000);
        if (!t || t.deep) return false;
        // Lowered a moment before the drop: nothing reaches a banished hull.
        if (t.spec.cls !== 'TT') banish(t, st.spec.duration - 0.1);
        st.data.prey = t;
      },
      update(_s, game, dt, st) {
        const t = st.data.prey as Ship;
        if (t.alive && every(st, dt, 0.25)) orbitalLaser(game, t.pos.x, t.pos.z, st.spec.accent);
      },
      end(ship, game, st) {
        const t = st.data.prey as Ship;
        if (!t.alive || !ship.alive) return;
        game.events.emit('explosion', { x: t.pos.x, y: 4, z: t.pos.z, size: 3 });
        hurt(ship, t, 40000, st.spec);
        if (t.alive) stun(t, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800) && !target.deep;
      },
    },
  ),
  def(
    {
      id: 'watchtower',
      name: 'Watchtower',
      short: 'WATCHTOWER',
      description: '10 s: the constellation watches. Any enemy within 6 km that fires, launches or casts is struck from orbit half a second later for 6k (at most once every 1.5 s each).',
      cooldown: 24,
      duration: 10,
      accent: 0xc0e0ff,
      icon: 'eye',
      zone: 6000,
    },
    {
      activate(ship, game, st) {
        const shots = new Map<number, number>();
        for (const s of game.ships) if (s.alive && s.team !== ship.team) shots.set(s.id, s.stats.shotsFired);
        st.data.shots = shots;
        st.data.next = new Map<number, number>();
        const cast = new Set<Ship>();
        st.data.cast = cast;
        const until = game.time + st.spec.duration + 0.5;
        st.data.off = game.events.on('skill', (e) => {
          if (game.time <= until && e.ship.team !== ship.team) cast.add(e.ship);
        });
      },
      update(ship, game, _dt, st) {
        const shots = st.data.shots as Map<number, number>;
        const next = st.data.next as Map<number, number>;
        const cast = st.data.cast as Set<Ship>;
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team) continue;
          const fired = s.stats.shotsFired > (shots.get(s.id) ?? s.stats.shotsFired);
          shots.set(s.id, s.stats.shotsFired);
          const acted = fired || cast.has(s);
          if (!acted || s.deep || dist(s, ship) > 6000 || game.time < (next.get(s.id) ?? 0)) continue;
          next.set(s.id, game.time + 1.5);
          const lead = s.speed * 0.5;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: s.pos.x + forwardX(s.heading) * lead, z: s.pos.z + forwardZ(s.heading) * lead, radius: 60, delay: 0.5, damage: 6000, look: 'plain' });
        }
        cast.clear();
      },
      end(_s, _g, st) {
        (st.data.off as (() => void) | undefined)?.();
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'orbitalMarines',
      name: 'Orbital Marines',
      short: 'ORBITAL MARINES',
      description: 'Drop pods hit the four enemies nearest the reticle (6 km): marines storm each, stunning it for 2 s and disarming it for 5 s.',
      cooldown: 22,
      duration: 0,
      accent: 0xa0b8d0,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const prey = enemiesAround(ship, game, p.x, p.z, 1500)
          .filter((s) => !s.deep)
          .slice(0, 4);
        if (!prey.length) return false;
        prey.forEach((t, i) => {
          let boarded = false;
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.15, 4000, {
            profile: 'ballistic',
            speed: 1600,
            uninterceptable: true,
            blast: 40,
            fire: 0,
            target: t,
            skill: st.spec,
            onHit(s) {
              if (s !== t || boarded) return;
              boarded = true;
              stun(s, 2);
              disarm(s, 5);
            },
          });
        });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 5800) && !target.deep && enemiesAround(ship, game, target.pos.x, target.pos.z, 1500).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'brilliantPebbles',
      name: 'Brilliant Pebbles',
      short: 'PEBBLES',
      description: '12 s: up to 20 orbital interceptors fall on enemy missiles, planes and incoming skill strikes (rods, bombs, meteors) heading for you or any ally within 2 km.',
      cooldown: 22,
      duration: 12,
      accent: 0xe0f0ff,
      icon: 'flak',
      zone: 2000,
    },
    {
      activate(_s, _g, st) {
        st.data.left = 20;
      },
      update(ship, game, dt, st) {
        if ((st.data.left as number) <= 0 || !every(st, dt, 0.15)) return;
        const guarded = alliesWithin(ship, game, 2000);
        const near = (x: number, z: number, r: number) => guarded.some((s) => dist2D(s.pos.x, s.pos.z, x, z) < r);
        let hit: { x: number; y: number; z: number } | null = null;
        const m = game.missiles.missiles.find((m) => m.alive && m.delay <= 0 && m.team !== ship.team && !m.uninterceptable && near(m.x, m.z, 1500));
        if (m) {
          game.missiles.kill(m);
          hit = m;
        }
        const k = hit ? null : game.strikes.strikes.find((k) => k.alive && !k.landed && k.team !== ship.team && k.kind !== 'shock' && k.kind !== 'mine' && near(k.x, k.z, k.radius + 400));
        if (k) {
          k.alive = false;
          hit = { x: k.x, y: 120, z: k.z };
        }
        const sq = hit ? null : game.air.squadrons.find((q) => q.alive && q.team !== ship.team && near(q.x, q.z, 1500));
        if (sq) {
          game.air.damage(sq, Math.max(1, sq.planeHp) * sq.armour);
          hit = { x: sq.x, y: 150, z: sq.z };
        }
        if (!hit) return;
        st.data.left = (st.data.left as number) - 1;
        orbitalLaser(game, hit.x, hit.z, st.spec.accent);
        game.events.emit('intercept', { x: hit.x, y: hit.y, z: hit.z });
      },
      aiShouldUse(ship, game) {
        const incoming = game.missiles.missiles.filter((m) => m.alive && m.team !== ship.team && dist2D(m.x, m.z, ship.pos.x, ship.pos.z) < 4000).length;
        const strikes = game.strikes.strikes.some((k) => k.alive && !k.landed && k.team !== ship.team && k.kind !== 'mine' && dist2D(k.x, k.z, ship.pos.x, ship.pos.z) < 2500);
        return incoming >= 4 || strikes;
      },
    },
  ),
  def(
    {
      id: 'satelliteNetwork',
      name: 'Satellite Network',
      short: 'SATNET',
      description: '12 s: allies within 4 km get 30% more reach on reticle skills and group shells 25% tighter, and every enemy within 6 km is revealed.',
      cooldown: 24,
      duration: 12,
      accent: 0x80d0ff,
      icon: 'radar',
      zone: 4000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of alliesWithin(ship, game, 4000)) {
          buff(s, st.spec.id, 0.4, (m) => {
            m.reachMul *= 1.3;
            m.dispersionMul *= 0.75;
          });
        }
        for (const s of enemiesWithin(ship, game, 6000, false)) {
          buff(s, 'debuff:satnet', 0.4, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 1);
      },
    },
  ),
  def(
    {
      id: 'ionDrive',
      name: 'Ion Drive',
      short: 'ION DRIVE',
      description: '6 s on the ion drive: 2.2x speed and a rudder twice as quick, and shells aimed at you scatter 1.5x wider.',
      cooldown: 20,
      duration: 6,
      accent: 0x60b0ff,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2.2;
          m.turnMul *= 2;
          m.scatterTakenMul *= 1.5;
        });
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 1200) >= 8 || (!!target && target.alive && dist(ship, target) > ship.mainRange * 1.1);
      },
    },
  ),
  def(
    {
      id: 'projectThor',
      name: 'Project Thor',
      short: 'PROJECT THOR',
      description: 'Rods from God: a tungsten rod falls on every enemy within 4 km of the reticle (8 km), one every 0.3 s. 35k and a 2 s stun each, and nothing can stop them.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0xd0e8ff,
      icon: 'rod',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        const prey = enemiesAround(ship, game, p.x, p.z, 4000).filter((s) => !s.deep);
        if (!prey.length) return false;
        prey.forEach((t, i) => {
          const delay = 0.8 + i * 0.3;
          const lead = t.speed * delay;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: t.pos.x + forwardX(t.heading) * lead, z: t.pos.z + forwardZ(t.heading) * lead, radius: 80, delay, damage: 35000, stun: 2, look: 'plain' });
        });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 7800) && enemiesAround(ship, game, target.pos.x, target.pos.z, 4000).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'kesslerSyndrome',
      name: 'Kessler Syndrome',
      short: 'KESSLER',
      description: 'A debris storm fills 3 km around the reticle (8 km) for 10 s: enemies inside take 10k a second, and every enemy plane and missile in it is shredded.',
      ult: true,
      cooldown: 100,
      duration: 10,
      accent: 0xb0b8c8,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 8000);
        st.data.x = p.x;
        st.data.z = p.z;
        game.fields.add(ship, { x: p.x, z: p.z, r: 3000, life: 10, skill: st.spec, look: 'storm', dps: 10000 });
      },
      update(ship, game, dt, st) {
        intercept(ship, game, st.data.x as number, st.data.z as number, 3000, dt, { missiles: true, planes: 600 });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 7800) && enemiesAround(ship, game, target.pos.x, target.pos.z, 2500).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'fleetDrop',
      name: 'Fleet Drop',
      short: 'FLEET DROP',
      description: 'An Apollo and two Mercurys drop from orbit at the reticle (6 km) and fight for 30 s.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0x90b0ff,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 6000);
        const drop = [
          game.spawnWingman(ship, 0, 30, 300, 'apollo', `${ship.name} drop`),
          game.spawnWingman(ship, 300, 30, 0, 'mercury', `${ship.name} drop`),
          game.spawnWingman(ship, -300, 30, 0, 'mercury', `${ship.name} drop`),
        ];
        drop.forEach((s, i) => {
          if (landNear(s, game, p.x, p.z, i === 0 ? 0 : 450, ship.heading + (i === 1 ? Math.PI / 2 : -Math.PI / 2))) orbitalLaser(game, s.pos.x, s.pos.z, 0x90b0ff);
        });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 9000) && enemiesWithin(ship, game, 9000).length >= 3;
      },
    },
  ),

  // ------------------------------------------------------------------ Nüwa
  def(
    {
      id: 'clayBrood',
      name: 'Clay Brood',
      short: 'CLAY BROOD',
      description: 'Six nanite skiffs are shaped from the hive and fight for you for 20 s: fast boats with plasma guns and torpedoes.',
      cooldown: 40,
      duration: 0,
      accent: 0xff7040,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        [-330, -200, -70, 70, 200, 330].forEach((lat) => game.spawnWingman(ship, lat, 20, -140, 'nanoSkiff', 'Clay Brood'));
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, ship.mainRange * 0.9);
      },
    },
  ),
  def(
    {
      id: 'fiveStones',
      name: 'Five-Coloured Stones',
      short: 'FIVE STONES',
      description: 'The five stones that mended the sky: for 12 s each absorbs one hit of 8k or more and bursts on the attacker for 8k.',
      cooldown: 22,
      duration: 12,
      accent: 0xffe060,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        ship.guard = {
          left: 5,
          min: 8000,
          until: game.time + st.spec.duration,
          skill: st.spec,
          onBlock(a) {
            if (!a || !a.alive || a.team === ship.team) return;
            arc(game, ship, a, STONE_COLORS[(ship.guard?.left ?? 0) % 5]);
            hurt(ship, a, 8000, st.spec);
          },
        };
      },
      end(ship, _g, st) {
        if (ship.guard?.skill === st.spec) ship.guard = null;
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 6 || enemiesWithin(ship, game, 6000).some((s) => s.spec.cls === 'TT' || s.spec.cls === 'BB');
      },
    },
  ),
  def(
    {
      id: 'hiveMind',
      name: 'Hive Mind',
      short: 'HIVE MIND',
      description: '12 s: you and allies within 3 km share one body. Every hit on a linked ship is spread evenly across all of them.',
      cooldown: 24,
      duration: 12,
      accent: 0xff9060,
      icon: 'swap',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        const group = alliesWithin(ship, game, 3000);
        if (group.length < 2) return false;
        link(group, game, 'spread', 1, st.spec.duration, st.spec);
        st.data.group = group;
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 1)) return;
        for (const s of st.data.group as Ship[]) if (s !== ship && s.alive) arc(game, ship, s, st.spec.accent, false);
      },
      aiShouldUse(ship, game) {
        const group = alliesWithin(ship, game, 3000);
        return group.length >= 3 && group.some((s) => s !== ship && hpFrac(s) < 0.5);
      },
    },
  ),
  def(
    {
      id: 'hijack',
      name: 'Hijack',
      short: 'HIJACK',
      description: '10 s: nanites take over enemy missiles and torpedoes that come within 1.5 km of you and send them back at the ships that fired them.',
      cooldown: 22,
      duration: 10,
      accent: 0xff6050,
      icon: 'swap',
      zone: 1500,
    },
    {
      activate() {},
      update(ship, game, _dt, st) {
        let fx = 0;
        for (const m of game.missiles.missiles) {
          if (!m.alive || m.delay > 0 || m.team === ship.team || m.struck || dist2D(m.x, m.z, ship.pos.x, ship.pos.z) > 1500) continue;
          const home = m.owner;
          if (!home.alive || home.team === ship.team) {
            game.missiles.kill(m);
            continue;
          }
          turnMissile(m, ship, home);
          if (fx++ < 4) game.events.emit('lightning', { points: [{ x: ship.pos.x, y: ship.spec.freeboard + 20, z: ship.pos.z }, { x: m.x, y: m.y, z: m.z }], color: st.spec.accent });
        }
        for (const t of game.torps.torps) {
          if (!t.alive || t.team === ship.team || dist2D(t.x, t.z, ship.pos.x, ship.pos.z) > 1500) continue;
          const home = t.owner;
          if (!home.alive || home.team === ship.team || home.deep) {
            t.alive = false;
            game.events.emit('intercept', { x: t.x, y: 0, z: t.z });
            continue;
          }
          turnTorpedo(t, ship, home);
        }
      },
      aiShouldUse(ship, game) {
        const missiles = game.missiles.missiles.filter((m) => m.alive && m.team !== ship.team && dist2D(m.x, m.z, ship.pos.x, ship.pos.z) < 3500).length;
        const torps = game.torps.torps.filter((t) => t.alive && t.team !== ship.team && dist2D(t.x, t.z, ship.pos.x, ship.pos.z) < 3000).length;
        return missiles + torps >= 4;
      },
    },
  ),
  def(
    {
      id: 'queensCommand',
      name: "Queen's Command",
      short: "QUEEN'S COMMAND",
      description: 'Your summons and allied summons within 4 km are fully repaired, deal 50% more damage for 10 s and last 10 s longer.',
      cooldown: 24,
      duration: 0,
      accent: 0xffb070,
      icon: 'drums',
      zone: 4000,
    },
    {
      activate(ship, game, st) {
        const brood = game.ships.filter((s) => s.alive && s.isSummon && s.team === ship.team && (s.summonOwner === ship || dist(s, ship) < 4000));
        if (!brood.length) return false;
        for (const s of brood) {
          s.heal(s.maxHp);
          s.expiresAt += 10;
          buff(s, st.spec.id, 10, (m) => {
            m.damageMul *= 1.5;
          });
          arc(game, ship, s, st.spec.accent, false);
        }
      },
      aiShouldUse(ship, game) {
        return game.ships.filter((s) => s.alive && s.isSummon && s.team === ship.team && dist(s, ship) < 4000).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'dissolve',
      name: 'Dissolve',
      short: 'DISSOLVE',
      description: 'Dissolve into nanites and reform at the reticle (1.2 km, any direction), untargetable for 2 s. Enemies within 300 m of where you left and where you arrive take 10k.',
      cooldown: 16,
      duration: 0,
      accent: 0xff8050,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 1200);
        const ox = ship.pos.x;
        const oz = ship.pos.z;
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        buff(ship, st.spec.id, 2, (m) => {
          m.untargetable = true;
        });
        for (const [x, z] of [
          [ox, oz],
          [ship.pos.x, ship.pos.z],
        ]) {
          game.fields.add(ship, { x, z, r: 300 + ship.spec.length * 0.3, life: 1.2, skill: st.spec, look: 'nanite' });
          for (const s of game.ships) if (s.alive && s.team !== ship.team && !s.deep && distToHull(s, x, z) < 300) hurt(ship, s, 10000, st.spec);
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1000) >= 8 || (hpFrac(ship) < 0.4 && enemiesWithin(ship, game, 1500).length >= 1);
      },
    },
  ),
  def(
    {
      id: 'mendHeavens',
      name: 'Mend the Heavens',
      short: 'MEND THE HEAVENS',
      description: '12 s: you and allies within 4 km repair 5% of the hull a second. Repair past full hull becomes a shield, up to half the max hull.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0xffd8a0,
      icon: 'heal',
      zone: 4000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 4000,
          life: 12,
          follow: ship,
          skill: st.spec,
          look: 'nanite',
          heal: 0.05,
          onTick(s) {
            if (s.team !== ship.team) return;
            buff(s, st.spec.id, 0.4, (m) => {
              m.overShield = Math.max(m.overShield, 0.5);
            });
          },
        });
        // The first tick heals before any shield can form; count this one in.
        for (const s of alliesWithin(ship, game, 4000)) {
          buff(s, st.spec.id, 0.4, (m) => {
            m.overShield = Math.max(m.overShield, 0.5);
          });
        }
      },
      aiShouldUse(ship, game) {
        const near = alliesWithin(ship, game, 4000);
        return hpFrac(ship) < 0.55 || near.filter((s) => hpFrac(s) < 0.6).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'assimilate',
      name: 'Assimilate',
      short: 'ASSIMILATE',
      description: 'The three enemies nearest the reticle (5 km) are infested for 10 s, 8k a second each. Any of them (but a titan) that sinks meanwhile is rebuilt on your side, as itself, at half hull for 30 s.',
      ult: true,
      cooldown: 105,
      duration: 10,
      accent: 0xff5030,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const prey = enemiesAround(ship, game, p.x, p.z, 1500)
          .filter((s) => !s.deep)
          .slice(0, 3);
        if (!prey.length) return false;
        for (const t of prey) clingTo(ship, game, t, 8000, st.spec.duration, st.spec);
        st.data.prey = prey;
      },
      update(ship, game, _dt, st) {
        assimilateWrecks(ship, game, st.data.prey as Ship[]);
      },
      end(ship, game, st) {
        assimilateWrecks(ship, game, st.data.prey as Ship[]);
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 4800) && !target.deep && (hpFrac(target) < 0.6 || enemiesAround(ship, game, target.pos.x, target.pos.z, 1500).length >= 2);
      },
    },
  ),
  def(
    {
      id: 'slayBlackDragon',
      name: 'Slay the Black Dragon',
      short: 'SLAY THE DRAGON',
      description: 'The whole hive converges on the ship under the reticle (5 km): 40k plus half the hull it has already lost (15% on a titan).',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0xff4020,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 5000);
        if (!t || t.deep) return false;
        const missing = t.maxHp - t.hp;
        for (let i = 0; i < 5; i++) arc(game, ship, t, st.spec.accent, false);
        game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 3 });
        hurt(ship, t, 40000 + missing * (t.spec.cls === 'TT' ? 0.15 : 0.5), st.spec);
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 4800) || target.deep) return false;
        const missing = target.maxHp - target.hp;
        return target.spec.cls === 'TT' ? missing > target.maxHp * 0.4 : 40000 + missing * 0.5 >= target.hp * 0.8;
      },
    },
  ),
];

/** The five colours of Nüwa's stones. */
const STONE_COLORS = [0xff5040, 0xffe060, 0x60ff90, 0x60a0ff, 0xf0f0f0];

/** Rebuild the sunk ones among `prey` on the owner's side (Assimilate). */
function assimilateWrecks(ship: Ship, game: Game, prey: Ship[]): void {
  for (let i = prey.length - 1; i >= 0; i--) {
    const s = prey[i];
    if (s.alive) continue;
    prey.splice(i, 1);
    if (!ship.alive || s.withdrawn || s.isSummon || s.spec.cls === 'TT' || s.spec.cls === 'AK') continue;
    s.withdrawn = true;
    const r = raiseAt(ship, game, s.pos.x, s.pos.z, s.heading, 30, s.spec.id, `Assimilated ${s.name}`);
    r.hp = r.maxHp * 0.5;
    game.events.emit('revive', { ship: r, skill: null });
  }
}
