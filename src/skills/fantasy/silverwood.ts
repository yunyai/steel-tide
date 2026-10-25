import { bearingTo } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  blink,
  buff,
  dist,
  enemiesWithin,
  hpFrac,
  hurt,
  nearestEnemy,
  nextSalvo,
  pullToward,
  disarm,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { isAI, reticleTarget, every } from './common';

// The Silverwood Elves: Eldarwyn, Silverbough, Windrunner, Gryphonhold, Tidesinger.
// Precision and renewal.

/**
 * Spirit Arrows and the Wild Hunt stack their slows: each bite is its own debuff, up to `stacks`
 * of them; past that the oldest is refreshed.
 */
function slowBite(s: Ship, key: string, frac: number, time: number, stacks: number): void {
  const prefix = `debuff:${key}`;
  const mine = s.effects.filter((e) => e.id.startsWith(prefix));
  let id = mine[0]?.id ?? `${prefix}0`;
  for (let i = 0; i < stacks; i++) {
    if (!mine.some((e) => e.id === `${prefix}${i}`)) {
      id = `${prefix}${i}`;
      break;
    }
  }
  buff(s, id, time, (m) => {
    m.speedMul *= 1 - frac;
  });
}

export const SILVERWOOD_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Eldarwyn
  def(
    {
      id: 'moonlitVolley',
      name: 'Moonlit Volley',
      short: 'MOONLIT VOLLEY',
      description: 'Every gun reloads at once, and the next salvo of starbolts groups five times tighter.',
      cooldown: 18,
      duration: 0,
      accent: 0xe4f4ff,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, { dispersionMul: 0.2 });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9) && ship.turrets.some((t) => t.reload > 4);
      },
    },
  ),
  def(
    {
      id: 'barkskin',
      name: 'Barkskin',
      short: 'BARKSKIN',
      description: '10 s: living bark grows over the hull. You take 40% less damage, and a quarter of what still gets through grows back.',
      cooldown: 22,
      duration: 10,
      accent: 0x9fd07a,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        st.data.intake = ship.intake;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.6;
        });
      },
      update(ship, _g, _dt, st) {
        const took = ship.intake - (st.data.intake as number);
        st.data.intake = ship.intake;
        if (took > 0) ship.heal(took * 0.25);
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 700) >= 5 || (hpFrac(ship) < 0.55 && underFire(ship, game, 700) >= 2);
      },
    },
  ),
  def(
    {
      id: 'wrathWildwood',
      name: 'Wrath of the Wildwood',
      short: 'WILDWOOD',
      description: 'Vines erupt from the sea: every enemy within 2.2 km is rooted for 4 s and crushed for 6k a second.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0x6fdc6a,
      icon: 'root',
      zone: 2200,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 2200, life: 4, skill: st.spec, look: 'grove', root: true, dps: 6000 });
      },
      aiShouldUse(ship, game) {
        const n = enemiesWithin(ship, game, 2000).length;
        return n >= 2 || (n === 1 && hpFrac(ship) < 0.6);
      },
    },
  ),

  // ------------------------------------------------------------------ Silverbough
  def(
    {
      id: 'rejuvenation',
      name: 'Rejuvenation',
      short: 'REJUVENATION',
      description: '10 s: a ring of moonlight rides with you. You and every ally within 1.2 km repair 2.5% of the hull a second.',
      cooldown: 24,
      duration: 10,
      accent: 0xb8ffd8,
      icon: 'heal',
      zone: 1200,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 1200, life: st.spec.duration, skill: st.spec, look: 'grove', follow: ship, heal: 0.025 });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.65 || alliesWithin(ship, game, 1100).some((s) => s !== ship && hpFrac(s) < 0.7);
      },
    },
  ),
  def(
    {
      id: 'leafstep',
      name: 'Leafstep',
      short: 'LEAFSTEP',
      description: 'Scatter into leaves and reform 450 m ahead. For 2 s nothing can lock onto you.',
      cooldown: 16,
      duration: 2,
      accent: 0xc8f0a0,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        if (!blink(ship, game, 450)) return false;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 600) >= 5 || (hpFrac(ship) < 0.35 && underFire(ship, game, 600) >= 2);
      },
    },
  ),
  def(
    {
      id: 'sanctuaryGrove',
      name: 'Sanctuary Grove',
      short: 'SANCTUARY',
      description: '8 s: a sacred grove takes root around you, 900 m across. Allies inside cannot sink and repair 4% a second; enemies inside are slowed 40%.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x7affc0,
      icon: 'heal',
      zone: 900,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 900, life: 8, skill: st.spec, look: 'grove', undying: true, heal: 0.04, slow: 0.6 });
      },
      aiShouldUse(ship, game) {
        const hurtAllies = alliesWithin(ship, game, 800).filter((s) => hpFrac(s) < 0.5).length;
        return hurtAllies >= 2 || hpFrac(ship) < 0.3;
      },
    },
  ),

  // ------------------------------------------------------------------ Windrunner
  def(
    {
      id: 'galeSails',
      name: 'Gale Sails',
      short: 'GALE SAILS',
      description: '6 s: a gale fills the sails. 1.8x speed and twice the rudder, and every eel tube reloads.',
      cooldown: 20,
      duration: 6,
      accent: 0xd8f8ff,
      icon: 'gale',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        for (const l of ship.launchers) l.reload = 0;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.8;
          m.turnMul *= 2;
        });
      },
      aiShouldUse(ship, game, target) {
        const reach = ship.spec.torpedoes?.range ?? 3000;
        const reloading = ship.launchers.some((l) => l.reload > 5);
        return (within(ship, target, reach * 1.3) && reloading) || (hpFrac(ship) < 0.4 && underFire(ship, game, 700) >= 3);
      },
    },
  ),
  def(
    {
      id: 'spiritArrows',
      name: 'Spirit Arrows',
      short: 'SPIRIT ARROWS',
      description: 'Six homing arrows of moonlight at the ship under the reticle (4 km): 3.5k each, and each hit slows it 10% for 6 s (stacks).',
      cooldown: 16,
      duration: 0,
      accent: 0xd8ffe0,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const target = reticleTarget(ship, game, 4000) ?? nearestEnemy(ship, game, 4000);
        if (!target) return false;
        for (let i = 0; i < 6; i++) {
          game.missiles.launch(ship, target.pos.x, target.pos.z, i * 0.12, 3500, {
            profile: 'skim',
            look: 'arrow',
            speed: 420,
            fire: 0,
            blast: 40,
            target,
            skill: st.spec,
            onHit: (s) => slowBite(s, 'arrows', 0.1, 6, 6),
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  def(
    {
      id: 'wildHunt',
      name: 'Wild Hunt',
      short: 'WILD HUNT',
      description: 'Sixteen spectral hounds run down every enemy within 3 km: 4k a bite, each bite slowing 50% for 4 s. Nothing can shoot them down.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xa0ffe8,
      icon: 'beast',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 3000);
        if (!prey.length) return false;
        for (let i = 0; i < 16; i++) {
          const t = prey[i % prey.length];
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.08, 4000, {
            profile: 'skim',
            look: 'arrow',
            speed: 380,
            uninterceptable: true,
            fire: 0,
            blast: 40,
            target: t,
            skill: st.spec,
            onHit: (s) => slowBite(s, 'hunt', 0.5, 4, 1),
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Gryphonhold
  def(
    {
      id: 'updraft',
      name: 'Updraft',
      short: 'UPDRAFT',
      description: '8 s: a rising wind under every wing. Your griffons fly 60% faster and no anti-air fire can touch them.',
      cooldown: 22,
      duration: 8,
      accent: 0xf0e8c0,
      icon: 'gale',
    },
    {
      activate() {},
      update(ship, game) {
        // Squadrons launched while it blows catch the wind too.
        for (const sq of game.air.squadrons) {
          if (!sq.alive || sq.owner !== ship) continue;
          sq.speedMul = Math.max(sq.speedMul, 1.6);
          sq.aaImmune = Math.max(sq.aaImmune, game.time + 0.3);
        }
      },
      end(ship, game) {
        for (const sq of game.air.squadrons) if (sq.owner === ship && !sq.skill) sq.speedMul = 1;
      },
      aiShouldUse(ship, game) {
        return game.air.squadrons.some((sq) => sq.alive && sq.owner === ship && sq.state !== 'return' && sq.type !== 'fighter');
      },
    },
  ),
  def(
    {
      id: 'moonfeather',
      name: 'Moonfeather',
      short: 'MOONFEATHER',
      description: 'Feathers of moonlight drift down at the reticle (6 km): allies within 800 m of it repair 20% of the hull over 6 s.',
      cooldown: 22,
      duration: 0,
      accent: 0xe8f0ff,
      icon: 'heal',
    },
    {
      activate(ship, game, st) {
        let p = aimPoint(ship, 6000);
        if (isAI(ship)) {
          // Bots drop it on the most battered ally in reach.
          const hurt = game.ships.filter((s) => s.alive && s.team === ship.team && dist(s, ship) < 6000).sort((a, b) => hpFrac(a) - hpFrac(b))[0];
          if (!hurt) return false;
          p = { x: hurt.pos.x, z: hurt.pos.z };
        }
        game.fields.add(ship, { x: p.x, z: p.z, r: 800, life: 6, skill: st.spec, look: 'circle', heal: 0.2 / 6 });
      },
      aiShouldUse(ship, game) {
        return game.ships.some((s) => s.alive && s.team === ship.team && dist(s, ship) < 6000 && hpFrac(s) < 0.55);
      },
    },
  ),
  def(
    {
      id: 'stormOfTalons',
      name: 'Storm of Talons',
      short: 'STORM OF TALONS',
      description: 'Thirty griffons stoop on the five enemies nearest the reticle (7 km): 9k a griffon, and every hull they strike has its rudder jammed for 5 s.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xffd890,
      icon: 'plane',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        const prey = game.ships
          .filter((s) => s.alive && s.team !== ship.team && !s.deep && !s.mods.untargetable && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 3000)
          .sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z))
          .slice(0, 5);
        if (!prey.length || !ship.spec.air) return false;
        const spec = ship.spec.air.dive;
        for (let i = 0; i < 5; i++) {
          const t = prey[i % prey.length];
          const sq = game.air.launch(ship, 'dive', t.pos.x, t.pos.z, true);
          if (!sq) continue;
          // They come out of the clouds right over their prey.
          const a = (i * Math.PI * 2) / 5 + ship.id;
          sq.x = t.pos.x + Math.cos(a) * 900;
          sq.z = t.pos.z + Math.sin(a) * 900;
          sq.y = 500;
          sq.heading = bearingTo(sq.x, sq.z, t.pos.x, t.pos.z);
          sq.state = 'attack';
          sq.target = t;
          sq.skill = st.spec;
          sq.damageMul = 9000 / spec.damage;
          sq.aaImmune = game.time + 6;
          sq.speedMul = 1.4;
          sq.onHit = (s) => {
            s.rudderJam = Math.max(s.rudderJam, 5);
          };
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 6500) || enemiesWithin(ship, game, 6000).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Tidesinger
  def(
    {
      id: 'sirenSong',
      name: 'Siren Song',
      short: 'SIREN SONG',
      description: '3 s: a song no captain can ignore. Enemies within 1.3 km are drawn toward you and their crews leave the guns.',
      cooldown: 20,
      duration: 3,
      accent: 0x9ff0ff,
      icon: 'wave',
      zone: 1300,
    },
    {
      activate(ship, game, st) {
        const heard = enemiesWithin(ship, game, 1300, false);
        if (!heard.length && isAI(ship)) return false;
        st.data.heard = heard;
        for (const s of heard) disarm(s, 3);
      },
      update(ship, _g, dt, st) {
        for (const s of st.data.heard as Ship[]) if (s.alive) pullToward(s, ship.pos.x, ship.pos.z, 45, dt, ship.spec.length + s.spec.length);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1200).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'kelpSnare',
      name: 'Kelp Snare',
      short: 'KELP SNARE',
      description: 'A 500 m kelp forest rises at the reticle (4 km) for 10 s. Enemies caught in it crawl at a quarter speed.',
      cooldown: 18,
      duration: 0,
      accent: 0x5fbf6a,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 500, life: 10, skill: st.spec, look: 'kelp', slow: 0.25 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  def(
    {
      id: 'callOfTheDeep',
      name: 'Call of the Deep',
      short: 'CALL OF THE DEEP',
      description: 'A sea serpent answers and fights beside you for 30 s. Every 2.5 s it bites an enemy within 350 m of it: 9k, flooding and a 1.5 s stun.',
      ult: true,
      cooldown: 80,
      duration: 30,
      accent: 0x60ffc8,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        st.data.serpent = game.spawnWingman(ship, 160, st.spec.duration, -40, 'seaSerpent', 'Sea Serpent');
      },
      update(ship, game, dt, st) {
        const serpent = st.data.serpent as Ship;
        if (!serpent.alive) return;
        if (!every(st, dt, 2.5)) return;
        const prey = nearestEnemy(serpent, game, 350 + serpent.spec.length / 2, false);
        if (!prey || prey.deep) {
          st.data.tick = 0.3;
          return;
        }
        hurt(ship, prey, 9000, st.spec);
        prey.startFlood(ship);
        if (prey.alive) stun(prey, 1.5);
        game.events.emit('explosion', { x: prey.pos.x, y: 3, z: prey.pos.z, size: 1.2 });
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 3500) || enemiesWithin(ship, game, 3000).length >= 1;
      },
    },
  ),
];
