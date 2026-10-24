import { bearingTo, dist2D, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  blinkTo,
  boltTo,
  buff,
  disarm,
  dispel,
  dist,
  enemiesOnLine,
  enemiesWithin,
  hpFrac,
  hurt,
  inCone,
  mark,
  nextSalvo,
  pullToward,
  root,
  silence,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { afflicted, every, reticleTarget } from './common';
import { raiseWreck } from './drowned';

// Aspidochelone, Naglfar, Brokkr and Astraea: the fantasy titans. Six skills and three ultimates each, all their own.

export const FANTASY_TITAN_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Aspidochelone
  def(
    {
      id: 'ancientShell',
      name: 'Ancient Shell',
      short: 'ANCIENT SHELL',
      description: '8 s: the world-turtle draws into its shell. 60% less damage taken, at half speed.',
      cooldown: 24,
      duration: 8,
      accent: 0xb8c890,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.4;
          m.speedMul *= 0.5;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 8 || (hpFrac(ship) < 0.5 && underFire(ship, game, 900) >= 3);
      },
    },
  ),
  def(
    {
      id: 'thornsea',
      name: 'Thornsea',
      short: 'THORNSEA',
      description: '10 s: thorned roots spread 1.5 km around you. Enemies in them take 3k a second and are slowed 30%.',
      cooldown: 22,
      duration: 0,
      accent: 0x7ad060,
      icon: 'root',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 1500, life: 10, skill: st.spec, look: 'grove', follow: ship, dps: 3000, slow: 0.7 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1400).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'sporeBloom',
      name: 'Spore Bloom',
      short: 'SPORE BLOOM',
      description: 'The island forest blooms: you and every ally within 2 km repair 25% of the hull and are cleansed of fire, flooding and every debuff.',
      cooldown: 26,
      duration: 0,
      accent: 0xd0ff90,
      icon: 'heal',
      zone: 2000,
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 2000)) {
          s.heal(s.maxHp * 0.25);
          s.cleanse();
          s.extinguish();
        }
      },
      aiShouldUse(ship, game) {
        const near = alliesWithin(ship, game, 2000);
        return near.filter((s) => hpFrac(s) < 0.6 || afflicted(s)).length >= 2 || hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'crystalRain',
      name: 'Crystal Rain',
      short: 'CRYSTAL RAIN',
      description: 'The spires shed twenty crystal shards onto the reticle (7 km): 8k each across a 400 m circle.',
      cooldown: 18,
      duration: 0,
      accent: 0x9fe8ff,
      icon: 'rod',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        for (let i = 0; i < 20; i++) {
          const a = game.rng() * Math.PI * 2;
          const r = Math.sqrt(game.rng()) * 400;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, radius: 70, delay: 0.7 + i * 0.08, damage: 8000, look: 'rune' });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800);
      },
    },
  ),
  def(
    {
      id: 'treantGuard',
      name: 'Treant Guard',
      short: 'TREANT GUARD',
      description: 'Two treants wade out of the forest and fight beside you for 30 s.',
      cooldown: 45,
      duration: 0,
      accent: 0x8ac060,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        game.spawnWingman(ship, -420, 30, -120, 'treant', 'Treant Guard');
        game.spawnWingman(ship, 420, 30, -120, 'treant', 'Treant Guard');
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 1);
      },
    },
  ),
  def(
    {
      id: 'tidalShrug',
      name: 'Tidal Shrug',
      short: 'TIDAL SHRUG',
      description: 'The turtle heaves its shell: a 1.2 km wave, 20k to every enemy it catches and a hard shove outward.',
      cooldown: 20,
      duration: 0,
      accent: 0x80d0ff,
      icon: 'wave',
      zone: 1200,
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1200, delay: 0, damage: 20000, knock: 300, speed: 700 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'worldroot',
      name: 'Worldroot',
      short: 'WORLDROOT',
      description: 'The roots of the world rise under every enemy on the sea: each is held fast for 4 s and takes 25k.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0x60e060,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        for (const s of enemiesWithin(ship, game, 1e9, false)) {
          if (s.deep) continue;
          root(s, 4);
          hurt(ship, s, 25000, st.spec);
          game.fields.add(ship, { x: s.pos.x, z: s.pos.z, r: Math.max(80, s.spec.length * 0.7), life: 4, skill: st.spec, look: 'grove', follow: s });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1e9).length >= 3;
      },
    },
  ),
  def(
    {
      id: 'verdantRebirth',
      name: 'Verdant Rebirth',
      short: 'VERDANT REBIRTH',
      description: 'Spring returns to the whole fleet: every ally on the sea is fully repaired and cleansed, and allies waiting to respawn sail at once.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xa0ff80,
      icon: 'heal',
    },
    {
      activate(ship, game) {
        for (const s of game.ships) {
          if (!s.alive || s.team !== ship.team) continue;
          s.heal(s.maxHp);
          s.cleanse();
          s.extinguish();
        }
        for (const r of game.respawns) if (r.ship.team === ship.team) r.at = Math.min(r.at, game.time);
      },
      aiShouldUse(ship, game) {
        const allies = game.ships.filter((s) => s.alive && s.team === ship.team);
        const low = allies.filter((s) => hpFrac(s) < 0.5).length;
        return low >= 2 || hpFrac(ship) < 0.35 || game.respawns.filter((r) => r.ship.team === ship.team).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'wrathOfAges',
      name: 'Wrath of Ages',
      short: 'WRATH OF AGES',
      description: '6 s: every crystal spire wakes. Six bolts leap every half second at enemies within 3.5 km, 8k a bolt.',
      ult: true,
      cooldown: 105,
      duration: 6,
      accent: 0x9fe8ff,
      icon: 'lightning',
      zone: 3500,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        const prey = enemiesWithin(ship, game, 3500).filter((s) => !s.deep);
        if (!prey.length) return;
        for (let i = 0; i < 6; i++) {
          const t = prey[Math.floor(game.rng() * prey.length)];
          boltTo(ship, game, t, st.spec.accent);
          hurt(ship, t, 8000, st.spec);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3300).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Naglfar
  def(
    {
      id: 'nailStorm',
      name: 'Nail Storm',
      short: 'NAIL STORM',
      description: "A storm of dead men's nails sprays toward the reticle: 30k to every enemy in a 50° cone out to 1.4 km.",
      cooldown: 18,
      duration: 0,
      accent: 0xc8e0b0,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 1400);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        for (const s of enemiesWithin(ship, game, 1400 + 60, false)) if (!s.deep && inCone(ship, s, b, 25)) hurt(ship, s, 30000, st.spec);
        for (let i = 0; i < 16; i++) {
          const a = b + (game.rng() - 0.5) * 0.85;
          const d = 300 + game.rng() * 1100;
          game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: ship.pos.x + forwardX(a) * d, z: ship.pos.z + forwardZ(a) * d, radius: 40, delay: d / 2500, damage: 0 });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 1350) || enemiesWithin(ship, game, 1300).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'soulSiphon',
      name: 'Soul Siphon',
      short: 'SOUL SIPHON',
      description: '6 s: green fire drains the three nearest enemies within 2.5 km, 6k a second each, and every point of it mends your hull.',
      cooldown: 22,
      duration: 6,
      accent: 0x60ff9a,
      icon: 'skull',
      zone: 2500,
    },
    {
      activate(ship, game) {
        if (!enemiesWithin(ship, game, 2500).length) return false;
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.5)) return;
        const prey = enemiesWithin(ship, game, 2500)
          .filter((s) => !s.deep)
          .sort((a, b) => dist(a, ship) - dist(b, ship))
          .slice(0, 3);
        for (const t of prey) {
          boltTo(ship, game, t, st.spec.accent);
          ship.heal(hurt(ship, t, 3000, st.spec));
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 1 && hpFrac(ship) < 0.9;
      },
    },
  ),
  def(
    {
      id: 'deadMensChains',
      name: "Dead Men's Chains",
      short: 'CHAINS',
      description: 'Chains of the drowned catch the ship under the reticle (3 km): for 8 s it cannot get further than 700 m from you.',
      cooldown: 22,
      duration: 8,
      accent: 0x90b0a0,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 3000);
        if (!t) return false;
        st.data.victim = t;
      },
      update(ship, game, dt, st) {
        const t = st.data.victim as Ship;
        if (!t.alive) return;
        const d = dist(t, ship);
        if (d > 700) pullToward(t, ship.pos.x, ship.pos.z, Math.min(120, 40 + (d - 700) * 0.2), dt, 700);
        if (every(st, dt, 0.6)) boltTo(ship, game, t, st.spec.accent);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2800) && dist(ship, target) > 1200;
      },
    },
  ),
  def(
    {
      id: 'corpseLanterns',
      name: 'Corpse Lanterns',
      short: 'CORPSE LANTERNS',
      description: '10 s: the lanterns of the dead swing out. Every 2 s the nearest enemy within 3 km is silenced for 2 s and takes 4k.',
      cooldown: 22,
      duration: 10,
      accent: 0x80ffb0,
      icon: 'eye',
      zone: 3000,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 2)) return;
        const t = enemiesWithin(ship, game, 3000)
          .filter((s) => !s.deep)
          .sort((a, b) => dist(a, ship) - dist(b, ship))[0];
        if (!t) return;
        boltTo(ship, game, t, st.spec.accent);
        hurt(ship, t, 4000, st.spec);
        if (t.alive) silence(t, 2);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'helsMist',
      name: "Hel's Mist",
      short: "HEL'S MIST",
      description: '10 s: the mist of Hel rolls 2 km around you. No enemy inside can repair or be healed.',
      cooldown: 24,
      duration: 0,
      accent: 0x709080,
      icon: 'cloak',
      zone: 2000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 2000, life: 10, skill: st.spec, look: 'mist', follow: ship, healBlock: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1900).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'graspingDead',
      name: 'Grasping Dead',
      short: 'GRASPING DEAD',
      description: 'The drowned rise and hold on: every enemy within 1 km is held fast for 3 s.',
      cooldown: 20,
      duration: 0,
      accent: 0x60c080,
      icon: 'root',
      zone: 1000,
    },
    {
      activate(ship, game) {
        const near = enemiesWithin(ship, game, 1000, false).filter((s) => !s.deep);
        if (!near.length) return false;
        for (const s of near) root(s, 3);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 950).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'helsGate',
      name: "Hel's Gate",
      short: "HEL'S GATE",
      description: 'The gate of Hel opens astern: six drowned galleons sail out to fight beside you for 30 s.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0x50ff90,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        [
          [-520, -150],
          [520, -150],
          [-300, -500],
          [300, -500],
          [-700, -650],
          [700, -650],
        ].forEach(([lat, back], i) => game.spawnWingman(ship, lat, 30, back, 'skeletalGalleon', `Hel's Galleon ${i + 1}`));
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 1);
      },
    },
  ),
  def(
    {
      id: 'harvestOfSouls',
      name: 'Harvest of Souls',
      short: 'HARVEST OF SOULS',
      description: '20 s: every enemy that sinks anywhere on the sea rises at once as a drowned galleon under your flag, for 30 s.',
      ult: true,
      cooldown: 100,
      duration: 20,
      accent: 0x40ff80,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        st.data.marked = game.ships.filter((s) => s.alive && s.team !== ship.team && !s.isSummon);
      },
      update(ship, _g, _dt, st) {
        const marked = st.data.marked as Ship[];
        for (let i = marked.length - 1; i >= 0; i--) {
          const s = marked[i];
          if (s.alive) continue;
          marked.splice(i, 1);
          if (!s.withdrawn && s.spec.cls !== 'AK' && s.spec.cls !== 'TT') raiseWreck(ship, s, 30);
        }
      },
      aiShouldUse(ship, game) {
        return game.ships.some((s) => s.alive && s.team !== ship.team && hpFrac(s) < 0.4 && dist(s, ship) < ship.mainRange);
      },
    },
  ),
  def(
    {
      id: 'deathToll',
      name: 'Death Toll',
      short: 'DEATH TOLL',
      description: 'The great bell of Naglfar tolls once: every enemy within 3 km loses a quarter of the hull it has left (titans a tenth) and is silenced for 3 s.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0xa0ffc0,
      icon: 'silence',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        const near = enemiesWithin(ship, game, 3000, false);
        if (!near.length) return false;
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 3000, delay: 0, damage: 0, speed: 1800 });
        for (const s of near) {
          const frac = s.spec.cls === 'TT' ? 0.1 : 0.25;
          s.takeDamage((s.hp * frac) / Math.max(0.05, s.mods.damageTakenMul), ship, st.spec);
          if (s.alive) silence(s, 3);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Brokkr
  def(
    {
      id: 'mjolnirThrow',
      name: 'Mjölnir Throw',
      short: 'MJÖLNIR',
      description: 'The forge-hammer flies at the ship under the reticle (6 km): 35k and a 2 s stun. On its way home it strikes every enemy within 150 m of its path for 15k.',
      cooldown: 18,
      duration: 0,
      accent: 0xffb050,
      icon: 'hammer',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 6000);
        if (!t || t.deep) return false;
        let back = false;
        game.missiles.launch(ship, t.pos.x, t.pos.z, 0, 35000, {
          profile: 'ballistic',
          speed: 650,
          uninterceptable: true,
          look: 'hammer',
          target: t,
          skill: st.spec,
          blast: 60,
          fire: 0,
          onHit(s) {
            if (s !== t || back) return;
            back = true;
            stun(s, 2);
            // The hammer always comes home: a low run back to the forge, through anything in the way.
            const m = game.missiles.launch(ship, ship.pos.x, ship.pos.z, 0, 15000, {
              profile: 'skim',
              speed: 420,
              uninterceptable: true,
              look: 'hammer',
              target: ship,
              skill: st.spec,
              blast: 150,
              fire: 0,
              pierce: true,
              from: { x: s.pos.x, y: 20, z: s.pos.z },
            });
            m.struck!.add(s.id);
          },
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800) && !target.deep;
      },
    },
  ),
  def(
    {
      id: 'moltenMoat',
      name: 'Molten Moat',
      short: 'MOLTEN MOAT',
      description: '10 s: a ring of lava 1.0 to 1.4 km out rides with you. Enemies in the ring take 8k a second, are slowed 40% and catch fire.',
      cooldown: 24,
      duration: 0,
      accent: 0xff6a20,
      icon: 'meteor',
      zone: 1400,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 1400,
          life: 10,
          follow: ship,
          skill: st.spec,
          look: 'fire',
          onTick(s, f) {
            if (s.team === ship.team || dist2D(s.pos.x, s.pos.z, f.x, f.z) < 1000) return;
            hurt(ship, s, 8000 * 0.25, st.spec);
            buff(s, 'debuff:moltenMoat', 0.35, (m) => {
              m.speedMul *= 0.6;
            });
            if (game.rng() < 0.08) s.startFire(Math.floor(game.rng() * 4), ship);
          },
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1500).some((s) => dist(s, ship) > 900);
      },
    },
  ),
  def(
    {
      id: 'runeforge',
      name: 'Runeforge',
      short: 'RUNEFORGE',
      description: '12 s: the forge runes blaze. You and every ally within 2 km deal 25% more damage, and the fires you start burn 50% hotter.',
      cooldown: 26,
      duration: 0,
      accent: 0xffa040,
      icon: 'rune',
      zone: 2000,
    },
    {
      activate(ship, game, st) {
        for (const s of alliesWithin(ship, game, 2000)) {
          buff(s, st.spec.id, 12, (m) => {
            m.damageMul *= 1.25;
            m.fireDamageMul *= 1.5;
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
      id: 'gullinbursti',
      name: 'Gullinbursti',
      short: 'GULLINBURSTI',
      description: 'The golden boar charges from you to the reticle (3 km): 20k to every hull it gores, which it throws aside. Every enemy within 1 km of its path is revealed for 10 s.',
      cooldown: 20,
      duration: 0,
      accent: 0xffd860,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 3000);
        if (dist2D(ship.pos.x, ship.pos.z, p.x, p.z) < 300) return false;
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const from = ship.localToWorld(ship.spec.length * 0.45, 6, 0);
        game.missiles.launch(ship, p.x, p.z, 0, 20000, {
          profile: 'skim',
          speed: 380,
          uninterceptable: true,
          look: 'boar',
          skill: st.spec,
          blast: 90,
          fire: 0,
          pierce: true,
          from,
          onHit(s) {
            // Thrown off to whichever side of the charge it stood.
            const side = Math.sign((s.pos.x - ship.pos.x) * forwardZ(b) - (s.pos.z - ship.pos.z) * forwardX(b)) || 1;
            s.shove(forwardZ(b) * side * 260, -forwardX(b) * side * 260);
          },
        });
        for (const s of enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, p.x, p.z, 1000)) {
          buff(s, 'debuff:gullinbursti', 10, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 2800) && dist(ship, target) > 600 && enemiesWithin(ship, game, 3000).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'slagShells',
      name: 'Slag Shells',
      short: 'SLAG SHELLS',
      description: 'The next three salvos throw molten slag: each hit slows the ship 20% (stacking to 60%) and halves its turret traverse for 6 s.',
      cooldown: 16,
      duration: 0,
      accent: 0xff8030,
      icon: 'salvo',
    },
    {
      activate(ship, game, st) {
        const stacks = new Map<number, { n: number; until: number }>();
        nextSalvo(ship, st.spec, {
          onHit(t) {
            const prev = stacks.get(t.id);
            const n = Math.min(3, (prev && prev.until > game.time ? prev.n : 0) + 1);
            stacks.set(t.id, { n, until: game.time + 6 });
            buff(t, 'debuff:slag', 6, (m) => {
              m.speedMul *= 1 - 0.2 * n;
              m.traverseMul *= 0.5;
            });
          },
        });
        ship.salvo!.left *= 3;
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9);
      },
    },
  ),
  def(
    {
      id: 'digIn',
      name: 'Dig In',
      short: 'DIG IN',
      description: '8 s: the mountain anchors itself. The main battery reloads 50% faster and groups 40% tighter, but you cannot move.',
      cooldown: 22,
      duration: 8,
      accent: 0xc08a50,
      icon: 'wall',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.rooted = true;
          m.reloadMul *= 0.67;
          m.dispersionMul *= 0.6;
        });
      },
      aiShouldUse(ship, game, target) {
        return targetInGunRange(ship, target, 0.85) && enemiesWithin(ship, game, 1500).length === 0;
      },
    },
  ),
  def(
    {
      id: 'oathstone',
      name: 'Oathstone',
      short: 'OATHSTONE',
      description: '10 s: you swear on the Oathstone. No single hit takes more than 0.5% of your max hull; allies within 2.5 km are held to 4% of theirs.',
      ult: true,
      cooldown: 105,
      duration: 10,
      accent: 0xffc870,
      icon: 'shield',
      zone: 2500,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of alliesWithin(ship, game, 2500)) {
          const cap = s === ship ? 0.005 : 0.04;
          buff(s, st.spec.id, 0.4, (m) => {
            m.hitCap = m.hitCap > 0 ? Math.min(m.hitCap, cap) : cap;
          });
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 12 || (hpFrac(ship) < 0.45 && underFire(ship, game, 1200) >= 4);
      },
    },
  ),
  def(
    {
      id: 'mountainWakes',
      name: 'The Mountain Wakes',
      short: 'MOUNTAIN WAKES',
      description: '10 s: the volcano erupts. Every second a lava bomb falls on each enemy within 4 km (9k and fire), and ash makes enemy guns within 2 km scatter twice as wide.',
      ult: true,
      cooldown: 105,
      duration: 10,
      accent: 0xff5020,
      icon: 'meteor',
      zone: 4000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 2000, life: 10, follow: ship, skill: st.spec, look: 'mist', color: 0x605048, scatter: 2 });
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 1)) return;
        for (const s of enemiesWithin(ship, game, 4000, false)) {
          if (s.deep) continue;
          const lead = s.speed * 1.2;
          game.strikes.spawn(ship, {
            kind: 'mortar',
            skill: st.spec,
            x: s.pos.x + forwardX(s.heading) * lead,
            z: s.pos.z + forwardZ(s.heading) * lead,
            radius: 90,
            delay: 1.2,
            damage: 9000,
            fire: 0.6,
            look: 'fireball',
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'gungnir',
      name: 'Gungnir',
      short: 'GUNGNIR',
      description: 'The spear that never misses flies at the ship under the reticle, anywhere on the sea: 60k plus 10% of its max hull (4% on titans). Cloaks, shields and hit blocks do not stop it.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0xfff0a0,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        // Anywhere: no reach limit, and a cloak does not hide the target from it.
        let t: Ship | null = null;
        let bd = 900;
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team || s.submerged || s.mods.banished) continue;
          const d = dist2D(s.pos.x, s.pos.z, ship.control.aimX, ship.control.aimZ);
          if (d < bd) {
            bd = d;
            t = s;
          }
        }
        if (!t) return false;
        const prey = t;
        let struck = false;
        game.missiles.launch(ship, prey.pos.x, prey.pos.z, 0, 0, {
          profile: 'hyper',
          speed: 1400,
          uninterceptable: true,
          look: 'spear',
          target: prey,
          skill: st.spec,
          blast: 40,
          fire: 0,
          onHit(s) {
            if (s !== prey || struck) return;
            struck = true;
            const guard = s.guard;
            const shield = [s.shield, s.shieldMax, s.shieldTime] as const;
            s.guard = null;
            s.shield = 0;
            hurt(ship, s, 60000 + s.maxHp * (s.spec.cls === 'TT' ? 0.04 : 0.1), st.spec);
            if (!s.alive) return;
            s.guard = guard;
            [s.shield, s.shieldMax, s.shieldTime] = shield;
          },
        });
      },
      aiShouldUse(_ship, _g, target) {
        return !!target && target.alive && !target.submerged && (target.spec.cls === 'TT' || hpFrac(target) < 0.45 || target.maxHp > 150000);
      },
    },
  ),

  // ------------------------------------------------------------------ Astraea
  def(
    {
      id: 'sevenSpheres',
      name: 'Seven Spheres',
      short: 'SEVEN SPHERES',
      description: 'Each sphere of the orrery strikes one of the seven nearest enemies within 4 km for 10k with its own curse: Sun +10k, Moon marked 8 s, Mars two fires, Mercury slowed, Jupiter stunned 1.5 s, Venus disarmed 3 s, Saturn silenced 4 s.',
      cooldown: 20,
      duration: 0,
      accent: 0xd8b0ff,
      icon: 'eye',
      zone: 4000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 4000)
          .filter((s) => !s.deep)
          .sort((a, b) => dist(a, ship) - dist(b, ship))
          .slice(0, 7);
        if (!prey.length) return false;
        prey.forEach((t, i) => {
          boltTo(ship, game, t, SPHERE_COLORS[i]);
          hurt(ship, t, i === 0 ? 20000 : 10000, st.spec);
          if (!t.alive) return;
          if (i === 1) mark(t, 8);
          else if (i === 2) {
            t.startFire(0, ship);
            t.startFire(2, ship);
          } else if (i === 3)
            buff(t, 'debuff:mercury', 5, (m) => {
              m.speedMul *= 0.6;
            });
          else if (i === 4) stun(t, 1.5);
          else if (i === 5) disarm(t, 3);
          else if (i === 6) silence(t, 4);
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'dispel',
      name: 'Dispel',
      short: 'DISPEL',
      description: 'Unravel all magic within 2 km of the reticle (6 km): enemy fields, walls and pending strikes end, enemy ships lose their buffs and shields, and allies there are cleansed.',
      cooldown: 18,
      duration: 0,
      accent: 0xf0e0ff,
      icon: 'rune',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        dispel(ship, game, p.x, p.z, 2000);
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: p.x, z: p.z, radius: 2000, delay: 0, damage: 0, speed: 2500 });
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 5800)) return false;
        const near = (x: number, z: number) => dist2D(x, z, target.pos.x, target.pos.z) < 2000;
        const fields = game.fields.fields.some((f) => f.team !== ship.team && f.age < f.life && near(f.x, f.z));
        const buffed = enemiesWithin(ship, game, 7000).some((s) => near(s.pos.x, s.pos.z) && (s.shield > 0 || !!s.guard || s.effects.some((e) => !e.id.startsWith('debuff:'))));
        return fields || buffed;
      },
    },
  ),
  def(
    {
      id: 'elementalAttunement',
      name: 'Elemental Attunement',
      short: 'ATTUNEMENT',
      description: "12 s: each salvo takes the next element in turn. Fire: each hit has a 50% fire chance. Frost: each hit slows 30% for 4 s. Storm: each hit stuns 0.5 s.",
      cooldown: 24,
      duration: 12,
      accent: 0x90d0ff,
      icon: 'lightning',
    },
    {
      activate() {},
      update(ship, game, _dt, st) {
        if (ship.salvo) return;
        const n = (st.data.n as number | undefined) ?? 0;
        st.data.n = n + 1;
        const el = n % 3;
        // Unlike Slag Shells the guns keep their own pace: the element rides on the next salvo they fire.
        ship.salvo = {
          skill: st.spec,
          left: Math.max(1, ship.turrets.length),
          dispersionMul: 1,
          damageMul: 1,
          railgun: false,
          guaranteedFire: false,
          cluster: false,
          onHit(t) {
            if (el === 0) {
              if (game.rng() < 0.5) t.startFire(Math.floor(game.rng() * 4), ship);
            } else if (el === 1)
              buff(t, 'debuff:frost', 4, (m) => {
                m.speedMul *= 0.7;
              });
            else stun(t, 0.5);
          },
        };
      },
      end(ship, _g, st) {
        if (ship.salvo?.skill === st.spec) ship.salvo = null;
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9);
      },
    },
  ),
  def(
    {
      id: 'resonance',
      name: 'Resonance',
      short: 'RESONANCE',
      description: '10 s: every skill you cast sends out a 1.5 km arcane pulse that hits each enemy it reaches for 12k.',
      cooldown: 24,
      duration: 10,
      accent: 0xc080ff,
      icon: 'wave',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        const until = game.time + st.spec.duration + 0.5;
        st.data.off = game.events.on('skill', (e) => {
          if (e.ship !== ship || e.index === st.index || game.time > until || !ship.alive) return;
          game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1500, delay: 0, damage: 0, speed: 2000 });
          for (const s of enemiesWithin(ship, game, 1500, false)) if (!s.deep) hurt(ship, s, 12000, st.spec);
        });
      },
      end(_s, _g, st) {
        (st.data.off as (() => void) | undefined)?.();
      },
      aiShouldUse(ship, game) {
        const ready = ship.skills.filter((k) => !k.spec.ult && k.cooldown <= 0 && !k.active).length;
        return ready >= 3 && enemiesWithin(ship, game, 1400).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'spellMirror',
      name: 'Spell Mirror',
      short: 'SPELL MIRROR',
      description: '8 s: a mirror of starlight. Skill damage aimed at you strikes its caster in full instead, and you take none of it.',
      cooldown: 24,
      duration: 8,
      accent: 0xe8f0ff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.spellMirror = true;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 6000).some((s) => s.skills.some((k) => k.active || (k.spec.ult && k.meter >= 1))) && underFire(ship, game, 1500) >= 3;
      },
    },
  ),
  def(
    {
      id: 'starWardens',
      name: 'Star Wardens',
      short: 'STAR WARDENS',
      description: 'Two astral wardens step down from the orrery and fight beside you for 25 s.',
      cooldown: 45,
      duration: 0,
      accent: 0xb0a0ff,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        game.spawnWingman(ship, -400, 25, -100, 'starWarden', 'Star Warden');
        game.spawnWingman(ship, 400, 25, -100, 'starWarden', 'Star Warden');
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 1);
      },
    },
  ),
  def(
    {
      id: 'stasis',
      name: 'Stasis',
      short: 'STASIS',
      description: 'Time stops within 3 km for 4 s. Enemy ships there cannot move, fire or cast, and their shells, torpedoes and missiles hang in the air. Allies act freely.',
      ult: true,
      cooldown: 105,
      duration: 0,
      accent: 0xa0c8ff,
      icon: 'time',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 3000,
          life: 4,
          skill: st.spec,
          look: 'time',
          timeScale: 0,
          root: true,
          silence: true,
          onTick(s) {
            if (s.team === ship.team) return;
            buff(s, 'debuff:stasis', 0.35, (m) => {
              m.disarmed = true;
            });
          },
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2600).length >= 3 || (hpFrac(ship) < 0.4 && enemiesWithin(ship, game, 2600).length >= 1);
      },
    },
  ),
  def(
    {
      id: 'grandPortal',
      name: 'Grand Portal',
      short: 'GRAND PORTAL',
      description: 'You and every ally within 1.5 km step through a portal to the reticle (6 km), keeping formation. Each arrives with a 25k shield and every normal skill ready.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0xc8a0ff,
      icon: 'portal',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        if (dist2D(ship.pos.x, ship.pos.z, p.x, p.z) < 400) return false;
        const group = alliesWithin(ship, game, 1500).filter((s) => !s.mods.banished);
        const ox = ship.pos.x;
        const oz = ship.pos.z;
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        const dx = ship.pos.x - ox;
        const dz = ship.pos.z - oz;
        game.fields.add(ship, { x: ox, z: oz, r: 1500, life: 1.5, skill: st.spec, look: 'void' });
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 1500, life: 1.5, skill: st.spec, look: 'void' });
        for (const s of group) {
          if (s !== ship) blinkTo(s, game, s.pos.x + dx, s.pos.z + dz);
          s.addShield(25000, 12);
          for (const k of s.skills) if (!k.spec.ult) k.cooldown = 0;
        }
      },
      aiShouldUse(ship, game, target) {
        if (!target || !target.alive || enemiesWithin(ship, game, ship.mainRange * 0.8).length) return false;
        const d = dist(ship, target);
        return d > ship.mainRange * 0.85 && d < ship.mainRange + 6000;
      },
    },
  ),
  def(
    {
      id: 'inversion',
      name: 'Inversion',
      short: 'INVERSION',
      description: '6 s: the stars turn over. Damage dealt by enemies within 3 km heals whatever it hits instead.',
      ult: true,
      cooldown: 100,
      duration: 6,
      accent: 0xff90e0,
      icon: 'swap',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 3000, life: 6, follow: ship, skill: st.spec, look: 'hex' });
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of enemiesWithin(ship, game, 3000, false)) {
          buff(s, 'debuff:inverted', 0.4, (m) => {
            m.inverted = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1500) >= 10 && enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),
];

/** Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn: the seven days, nearest enemy first. */
const SPHERE_COLORS = [0xffd040, 0xe8ecff, 0xff5030, 0xb0c0d0, 0xffa060, 0x80ffb0, 0xc0a070];

