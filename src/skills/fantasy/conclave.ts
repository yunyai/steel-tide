import { canTrack } from '../../core/Targeting';
import { dist2D, forwardX, forwardZ } from '../../core/math';
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
  root,
  silence,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { reticleTarget } from './common';

// The Starfall Conclave: Sunspire, Spellweaver, Blinkwisp, Dragonrest, Voidpearl.
// Spell burst and control.

export const CONCLAVE_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Sunspire
  def(
    {
      id: 'fireball',
      name: 'Fireball',
      short: 'FIREBALL',
      description: 'A roaring fireball at the reticle (6 km): 18k in 150 m, and everything it touches burns.',
      cooldown: 16,
      duration: 0,
      accent: 0xff7030,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const d = dist2D(ship.pos.x, ship.pos.z, p.x, p.z);
        game.strikes.spawn(ship, { kind: 'rocket', skill: st.spec, x: p.x, z: p.z, radius: 150, delay: 0.5 + d / 1800, damage: 18000, fire: 1, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'manaShield',
      name: 'Mana Shield',
      short: 'MANA SHIELD',
      description: 'A 50k ward of pure mana for 10 s. While it holds, your guns reload 30% faster.',
      cooldown: 22,
      duration: 10,
      accent: 0x9a80ff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.addShield(50000, st.spec.duration);
      },
      update(ship, _g, _dt, st) {
        if (ship.shield <= 0) return;
        buff(ship, st.spec.id, 0.3, (m) => {
          m.reloadMul *= 0.7;
        });
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 700) >= 4 || (targetInGunRange(ship, target, 0.8) && hpFrac(ship) < 0.6);
      },
    },
  ),
  def(
    {
      id: 'meteorSwarm',
      name: 'Meteor Swarm',
      short: 'METEOR SWARM',
      description: 'Eight meteors tear down over 4 s on an 800 m circle at the reticle (7 km): 24k each, fires, and a 1 s stun.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff9040,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        for (let i = 0; i < 8; i++) {
          const a = game.rng() * Math.PI * 2;
          const r = Math.sqrt(game.rng()) * 400;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, radius: 160, delay: 1 + i * 0.45, damage: 24000, fire: 0.8, stun: 1, look: 'meteor' });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800);
      },
    },
  ),

  // ------------------------------------------------------------------ Spellweaver
  def(
    {
      id: 'frostNova',
      name: 'Frost Nova',
      short: 'FROST NOVA',
      description: 'A ring of frost bursts out 1 km: every enemy in it takes 10k and freezes, hull and turrets, for 2.5 s.',
      cooldown: 18,
      duration: 0,
      accent: 0xa0e8ff,
      icon: 'snow',
      zone: 1000,
    },
    {
      activate(ship, game, st) {
        const near = enemiesWithin(ship, game, 1000, false);
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1000, delay: 0, damage: 10000, speed: 1600 });
        for (const s of near) {
          root(s, 2.5);
          buff(s, `debuff:${st.spec.id}`, 2.5, (m) => {
            m.traverseMul = 0;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 950).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'timeWarp',
      name: 'Time Warp',
      short: 'TIME WARP',
      description: '6 s: time thickens 700 m around you. Enemy shells, torpedoes and missiles inside crawl at a fifth of their speed.',
      cooldown: 22,
      duration: 6,
      accent: 0xd0b0ff,
      icon: 'time',
      zone: 700,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 700, life: st.spec.duration, skill: st.spec, look: 'time', follow: ship, timeScale: 0.2 });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 700) >= 5;
      },
    },
  ),
  def(
    {
      id: 'chronoshift',
      name: 'Chronoshift',
      short: 'CHRONOSHIFT',
      description: 'Turn back the clock 5 s: your position, hull and skill cooldowns return to where they were. Allies within 1.5 km get their hull of 5 s ago back.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xc8a0ff,
      icon: 'time',
      zone: 1500,
    },
    {
      activate(ship, game) {
        const allies = alliesWithin(ship, game, 1500).filter((s) => s !== ship);
        if (!ship.rewind(5)) return false;
        for (const s of allies) s.rewind(5, 'hull');
      },
      aiShouldUse(ship) {
        const then = ship.history[0];
        return hpFrac(ship) < 0.4 && !!then && then.hp > ship.hp + ship.maxHp * 0.15;
      },
    },
  ),

  // ------------------------------------------------------------------ Blinkwisp
  def(
    {
      id: 'arcaneMissiles',
      name: 'Arcane Missiles',
      short: 'ARCANE MISSILES',
      description: 'Ten bolts of arcane force seek the nearest enemies within 2 km: 2.5k each, and nothing can shoot them down.',
      cooldown: 14,
      duration: 0,
      accent: 0xb070ff,
      icon: 'missile',
      zone: 2000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 2000).sort((a, b) => dist(a, ship) - dist(b, ship)).slice(0, 3);
        if (!prey.length) return false;
        for (let i = 0; i < 10; i++) {
          const t = prey[i % prey.length];
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.09, 2500, { profile: 'skim', look: 'bolt', speed: 480, uninterceptable: true, fire: 0, blast: 40, target: t, skill: st.spec });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1900).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'blinkStrike',
      name: 'Blink Strike',
      short: 'BLINK STRIKE',
      description: 'Blink behind the ship under the reticle (1.5 km), facing the way you were, and every tube reloads.',
      cooldown: 18,
      duration: 0,
      accent: 0xe0c0ff,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const t = reticleTarget(ship, game, 1500);
        if (!t || dist(t, ship) > 1600) return false;
        const back = t.spec.length / 2 + 280;
        if (!blinkTo(ship, game, t.pos.x - forwardX(t.heading) * back, t.pos.z - forwardZ(t.heading) * back)) return false;
        for (const l of ship.launchers) l.reload = 0;
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1450) && hpFrac(ship) > 0.35;
      },
    },
  ),
  def(
    {
      id: 'polymorph',
      name: 'Polymorph',
      short: 'POLYMORPH',
      description: 'The ship under the reticle (5 km) and up to two neighbours within 600 m become rowboats for 6 s: no weapons, no skills, half speed, and 25% more damage taken.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xf0a0ff,
      icon: 'swap',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 5000);
        if (!t) return false;
        const victims = [t, ...game.ships.filter((s) => s !== t && canTrack(ship, s) && dist(s, t) < 600).sort((a, b) => dist(a, t) - dist(b, t)).slice(0, 2)];
        for (const s of victims) {
          disarm(s, 6);
          silence(s, 6);
          buff(s, `debuff:${st.spec.id}`, s.spec.cls === 'TT' ? 2.4 : 6, (m) => {
            m.speedMul *= 0.5;
            m.damageTakenMul *= 1.25;
          });
          game.events.emit('blink', { ship: s, fromX: s.pos.x, fromZ: s.pos.z });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800) && hpFrac(target) > 0.25;
      },
    },
  ),

  // ------------------------------------------------------------------ Dragonrest
  def(
    {
      id: 'dragonfireDive',
      name: 'Dragonfire Dive',
      short: 'DRAGONFIRE',
      description: 'The next dive squadron breathes instead of bombing: a 400 m line of dragonfire across its target, 12k and two fires to every hull on it.',
      cooldown: 16,
      duration: 0,
      accent: 0xff6020,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        if (!ship.spec.air) return false;
        ship.airBuff = {
          skill: st.spec,
          types: ['dive'],
          onDrop: (sq, t) => {
            const fx = forwardX(sq.heading);
            const fz = forwardZ(sq.heading);
            const x0 = t.pos.x - fx * 200;
            const z0 = t.pos.z - fz * 200;
            const x1 = t.pos.x + fx * 200;
            const z1 = t.pos.z + fz * 200;
            for (let i = 0; i < 6; i++) {
              const k = i / 5;
              game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, radius: 50, delay: 0.1 + k * 0.4, damage: 0, look: 'fireball' });
            }
            for (const s of enemiesOnLine(ship, game, x0, z0, x1, z1, 40)) {
              hurt(ship, s, 12000, st.spec);
              s.startFire(Math.floor(game.rng() * 4), ship);
              s.startFire(Math.floor(game.rng() * 4), ship);
            }
          },
        };
      },
      aiShouldUse(ship) {
        return !ship.airBuff && (ship.air?.hangar.dive ?? 0) >= (ship.spec.air?.dive.planes ?? 1);
      },
    },
  ),
  def(
    {
      id: 'draconicRoar',
      name: 'Draconic Roar',
      short: 'DRACONIC ROAR',
      description: 'The dragons roar from the deck: enemy squadrons within 1.2 km turn for home, and enemy ships within 800 m are stunned 1.5 s.',
      cooldown: 20,
      duration: 0,
      accent: 0xffa060,
      icon: 'wave',
      zone: 1200,
    },
    {
      activate(ship, game, st) {
        for (const sq of game.air.squadrons) {
          if (sq.alive && sq.team !== ship.team && dist2D(sq.x, sq.z, ship.pos.x, ship.pos.z) < 1200) sq.state = 'return';
        }
        for (const s of enemiesWithin(ship, game, 800, false)) stun(s, 1.5);
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1200, delay: 0, damage: 0, speed: 1500 });
      },
      aiShouldUse(ship, game) {
        const raid = game.air.squadrons.some((sq) => sq.alive && sq.team !== ship.team && sq.type !== 'fighter' && dist2D(sq.x, sq.z, ship.pos.x, ship.pos.z) < 1100);
        return raid || enemiesWithin(ship, game, 750).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'elderWyrm',
      name: 'Elder Wyrm',
      short: 'ELDER WYRM',
      description: 'An elder wyrm circles the reticle (6 km) for 8 s, bathing everything within 700 m of it in flame: 8k a second to every enemy below.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff5020,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 700, life: 8, skill: st.spec, look: 'fire', dps: 8000 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),

  // ------------------------------------------------------------------ Voidpearl
  def(
    {
      id: 'manaBurn',
      name: 'Mana Burn',
      short: 'MANA BURN',
      description: 'A pulse of void: 8k to every enemy within 1.2 km, and each loses 30% of its ultimate charge.',
      cooldown: 18,
      duration: 0,
      accent: 0x9050ff,
      icon: 'lightning',
      zone: 1200,
    },
    {
      activate(ship, game, st) {
        const near = enemiesWithin(ship, game, 1200, false);
        if (!near.length) return false;
        for (const s of near) {
          hurt(ship, s, 8000, st.spec);
          for (const k of s.skills) if (k.spec.ult && !k.active) k.meter = Math.max(0, k.meter - 0.3);
        }
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1200, delay: 0, damage: 0, speed: 1800, hitsSubs: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'splittingSpell',
      name: 'Splitting Spell',
      short: 'SPLITTING SPELL',
      description: 'The next spread is enchanted: each spirit eel forks into three as it nears a target.',
      cooldown: 18,
      duration: 0,
      accent: 0xc080ff,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        ship.torpBuff = { skill: st.spec, speedMul: 1, spreads: 1, split: 3 };
      },
      aiShouldUse(ship, _g, target) {
        return !ship.torpBuff && within(ship, target, (ship.spec.torpedoes?.range ?? 3000) * 0.9) && ship.launchers.some((l) => l.reload <= 0);
      },
    },
  ),
  def(
    {
      id: 'unmaking',
      name: 'Unmaking',
      short: 'UNMAKING',
      description: 'The ship under the reticle (4 km) is torn out of the world for 6 s, and returns missing 40% of its hull (titans 12%).',
      ult: true,
      cooldown: 85,
      duration: 6.3,
      accent: 0x7040ff,
      icon: 'portal',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 4000);
        if (!t) return false;
        st.data.victim = t;
        banish(t, 6);
      },
      end(ship, _g, st) {
        const t = st.data.victim as Ship;
        if (!t.alive) return;
        const frac = t.spec.cls === 'TT' ? 0.12 : 0.4;
        t.takeDamage((t.maxHp * frac) / Math.max(0.05, t.mods.damageTakenMul), ship, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800) && hpFrac(target) > 0.4;
      },
    },
  ),
];
