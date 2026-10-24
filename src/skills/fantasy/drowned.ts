import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  alliesWithin,
  banish,
  buff,
  enemiesWithin,
  fear,
  hpFrac,
  hurt,
  raiseAt,
  silence,
  targetInGunRange,
  underFire,
  within,
  wrecksNear,
} from '../kit';
import { def, type SkillDef } from '../types';
import { every, reticleTarget, spendHull } from './common';

// The Drowned Court: Revenant, Gravewake, Wraith, Nightwing, Drowned Bell.
// Curses, life drain and the risen dead.

/** Wrecks the Court can raise: line hulls, not cargo. */
function raisable(w: Ship): boolean {
  return w.spec.cls !== 'AK' && w.spec.cls !== 'TT';
}

/** Raise a skeletal galleon from a wreck; the wreck goes under for good. */
export function raiseWreck(ship: Ship, w: Ship, time: number): Ship {
  w.withdrawn = true;
  return raiseAt(ship, ship.game, w.pos.x, w.pos.z, w.heading, time, 'skeletalGalleon', `Drowned ${w.name}`);
}

export const DROWNED_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Revenant
  def(
    {
      id: 'soulHarvest',
      name: 'Soul Harvest',
      short: 'SOUL HARVEST',
      description: 'The guns reload at once and feed on souls for 8 s: they hit 20% harder, and 40% of all the damage you deal comes back as hull.',
      cooldown: 20,
      duration: 8,
      accent: 0x60ff9a,
      icon: 'skull',
    },
    {
      activate(ship, _g, st) {
        for (const t of ship.turrets) t.reload = 0;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.lifesteal += 0.4;
          m.damageMul *= 1.2;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85) && ship.turrets.some((t) => t.reload < 3);
      },
    },
  ),
  def(
    {
      id: 'graveChill',
      name: 'Grave Chill',
      short: 'GRAVE CHILL',
      description: 'The cold of the grave seizes the ship under the reticle (8 km): 10k, then silenced and 30% slower for 8 s.',
      cooldown: 22,
      duration: 0,
      accent: 0x90e8c0,
      icon: 'silence',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 8000);
        if (!t) return false;
        hurt(ship, t, 10000, st.spec);
        silence(t, 8);
        buff(t, `debuff:${st.spec.id}`, 8, (m) => {
          m.speedMul *= 0.7;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7500);
      },
    },
  ),
  def(
    {
      id: 'deathsDoor',
      name: "Death's Door",
      short: "DEATH'S DOOR",
      description: "8 s: you cannot sink. When it ends, everything you took in that time bursts out as a ring of soulfire onto enemies within 1.5 km (at least 30k, at most 150k).",
      ult: true,
      cooldown: 85,
      duration: 8,
      accent: 0x40ff80,
      icon: 'skull',
      zone: 1500,
    },
    {
      activate(ship, _g, st) {
        st.data.intake = ship.intake;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.undying = true;
        });
      },
      end(ship, game, st) {
        const took = ship.intake - (st.data.intake as number);
        const burst = Math.min(150000, Math.max(30000, took));
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1500, delay: 0, damage: burst, speed: 1100 });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.5 && (underFire(ship, game, 800) >= 2 || enemiesWithin(ship, game, 1500).length > 0);
      },
    },
  ),

  // ------------------------------------------------------------------ Gravewake
  def(
    {
      id: 'hexOfRot',
      name: 'Hex of Rot',
      short: 'HEX OF ROT',
      description: '10 s: rot spreads from your hull. Enemies within 2 km cannot bounce armour-piercing rounds, and their fires burn twice as long.',
      cooldown: 22,
      duration: 10,
      accent: 0x9adf60,
      icon: 'rune',
      zone: 2000,
    },
    {
      activate() {},
      update(ship, game, _dt, st) {
        for (const s of enemiesWithin(ship, game, 2000, false)) {
          buff(s, `debuff:${st.spec.id}`, 0.4, (m) => {
            m.noBounce = true;
            m.fireDurationMul *= 2;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1900).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'wraithForm',
      name: 'Wraith Form',
      short: 'WRAITH FORM',
      description: '5 s: the ship fades into a ghost. Nothing can lock or hurt you and you sail 50% faster, but your guns fall silent.',
      cooldown: 24,
      duration: 5,
      accent: 0xb0ffd8,
      icon: 'cloak',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.untargetable = true;
          m.invulnerable = true;
          m.disarmed = true;
          m.speedMul *= 1.5;
        });
      },
      aiShouldUse(ship, game) {
        return (hpFrac(ship) < 0.4 && underFire(ship, game, 700) >= 3) || underFire(ship, game, 700) >= 10;
      },
    },
  ),
  def(
    {
      id: 'raiseTheDrowned',
      name: 'Raise the Drowned',
      short: 'RAISE THE DROWNED',
      description: 'Every wreck within 3 km rises as a skeletal galleon under your flag for 30 s (up to four; if fewer than two wrecks lie near, the sea gives up its own).',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x70ffa0,
      icon: 'skull',
    },
    {
      activate(ship, game) {
        const wrecks = wrecksNear(game, ship.pos.x, ship.pos.z, 3000).filter(raisable).slice(0, 4);
        for (const w of wrecks) raiseWreck(ship, w, 30);
        for (let i = wrecks.length; i < 2; i++) game.spawnWingman(ship, i ? 260 : -260, 30, -120, 'skeletalGalleon', 'Drowned Galleon');
      },
      aiShouldUse(ship, game, target) {
        return wrecksNear(game, ship.pos.x, ship.pos.z, 3000).filter(raisable).length >= 2 || targetInGunRange(ship, target, 0.9);
      },
    },
  ),

  // ------------------------------------------------------------------ Wraith
  def(
    {
      id: 'terror',
      name: 'Terror',
      short: 'TERROR',
      description: 'A shriek of the dead: enemies within 1 km flee from you for 3 s, and their torpedo tubes jam.',
      cooldown: 18,
      duration: 0,
      accent: 0xa0ffc8,
      icon: 'fear',
      zone: 1000,
    },
    {
      activate(ship, game) {
        const near = enemiesWithin(ship, game, 1000, false);
        if (!near.length) return false;
        for (const s of near) {
          fear(s, ship.pos.x, ship.pos.z, 3);
          for (const l of s.launchers) l.reload = Math.max(l.reload, 3);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 950).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'haunt',
      name: 'Haunt',
      short: 'HAUNT',
      description: 'A ghost takes the helm of the ship under the reticle (5 km): for 5 s its rudder jams and its shells scatter three times as wide.',
      cooldown: 18,
      duration: 0,
      accent: 0x80f0b0,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 5000);
        if (!t) return false;
        t.rudderJam = Math.max(t.rudderJam, 5);
        buff(t, `debuff:${st.spec.id}`, 5, (m) => {
          m.dispersionMul *= 3;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4500);
      },
    },
  ),
  def(
    {
      id: 'bansheeWail',
      name: 'Banshee Wail',
      short: 'BANSHEE WAIL',
      description: 'A scream that carries 1.8 km: 20k to every enemy in it, 4 s of blind terror, and every gun they have must reload from empty.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xc0ffe0,
      icon: 'fear',
      zone: 1800,
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1800, delay: 0, damage: 20000, speed: 1400 });
        for (const s of enemiesWithin(ship, game, 1800, false)) {
          fear(s, ship.pos.x, ship.pos.z, 4);
          const full = s.spec.main ? s.spec.main.reload * s.mods.reloadMul : 0;
          for (const t of s.turrets) t.reload = Math.max(t.reload, full);
        }
      },
      aiShouldUse(ship, game) {
        const n = enemiesWithin(ship, game, 1700).length;
        return n >= 2 || (n === 1 && hpFrac(ship) < 0.7);
      },
    },
  ),

  // ------------------------------------------------------------------ Nightwing
  def(
    {
      id: 'batCloud',
      name: 'Bat Cloud',
      short: 'BAT CLOUD',
      description: 'A shrieking cloud of bats, 600 m across, hangs over the reticle (6 km) for 8 s: enemy shells fired from inside scatter 2.5x, and enemies in it take 2k a second.',
      cooldown: 20,
      duration: 0,
      accent: 0x8070a0,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 600, life: 8, skill: st.spec, look: 'swarm', scatter: 2.5, dps: 2000 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'bloodPrice',
      name: 'Blood Price',
      short: 'BLOOD PRICE',
      description: 'Pay 10% of your hull in blood: every hangar refills at once, and the next squadron you launch hits 50% harder.',
      cooldown: 30,
      duration: 0,
      accent: 0xd04060,
      icon: 'skull',
    },
    {
      activate(ship, _g, st) {
        const air = ship.spec.air;
        if (!air || !ship.air || hpFrac(ship) <= 0.12) return false;
        spendHull(ship, 0.1);
        for (const k of ['torpedo', 'dive', 'fighter'] as const) ship.air.hangar[k] = air[k].hangar;
        ship.airBuff = { skill: st.spec, types: ['torpedo', 'dive'], damageMul: 1.5 };
      },
      aiShouldUse(ship) {
        const air = ship.spec.air;
        if (!air || !ship.air || hpFrac(ship) < 0.5) return false;
        const have = ship.air.hangar.torpedo + ship.air.hangar.dive;
        return have < (air.torpedo.hangar + air.dive.hangar) * 0.45;
      },
    },
  ),
  def(
    {
      id: 'nightFalls',
      name: 'Night Falls',
      short: 'NIGHT FALLS',
      description: '10 s: a night of the dead, 3 km around you. Enemy weapons inside cannot reach past 1 km, and enemies in the dark take 5k a second.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x50c080,
      icon: 'eye',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 3000,
          life: 10,
          skill: st.spec,
          look: 'mist',
          follow: ship,
          dps: 5000,
          onTick: (s, f) => {
            if (s.team === f.team) return;
            buff(s, 'debuff:nightFalls', 0.35, (m) => {
              m.rangeCap = m.rangeCap > 0 ? Math.min(m.rangeCap, 1000) : 1000;
            });
          },
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 1 || (hpFrac(ship) < 0.5 && underFire(ship, game, 900) >= 2);
      },
    },
  ),

  // ------------------------------------------------------------------ Drowned Bell
  def(
    {
      id: 'toll',
      name: 'Toll',
      short: 'TOLL',
      description: 'The bell tolls under the sea: every enemy within 1.2 km is silenced for 4 s.',
      cooldown: 18,
      duration: 0,
      accent: 0xa8f0c8,
      icon: 'silence',
      zone: 1200,
    },
    {
      activate(ship, game) {
        const near = enemiesWithin(ship, game, 1200, false);
        if (!near.length) return false;
        for (const s of near) silence(s, 4);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'graspOfDrowned',
      name: 'Grasp of the Drowned',
      short: 'GRASP',
      description: 'Drowned hands drag at the ship under the reticle (3 km): 8k a second and 60% slower for 5 s.',
      cooldown: 18,
      duration: 5,
      accent: 0x60d090,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 3000);
        if (!t) return false;
        st.data.victim = t;
        buff(t, `debuff:${st.spec.id}`, st.spec.duration, (m) => {
          m.speedMul *= 0.4;
        });
      },
      update(ship, _g, dt, st) {
        const t = st.data.victim as Ship;
        if (t.alive && every(st, dt, 0.5)) hurt(ship, t, 4000, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2800);
      },
    },
  ),
  def(
    {
      id: 'abyssalTide',
      name: 'Abyssal Tide',
      short: 'ABYSSAL TIDE',
      description: 'You and every ally within 1.5 km sink into the abyss for 6 s, beyond all harm, then surface with 25% of the hull back and full tubes.',
      ult: true,
      cooldown: 80,
      duration: 6,
      accent: 0x40a080,
      icon: 'portal',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        const crew = alliesWithin(ship, game, 1500);
        st.data.crew = crew;
        for (const s of crew) banish(s, st.spec.duration);
      },
      end(_ship, _g, st) {
        for (const s of st.data.crew as Ship[]) {
          if (!s.alive) continue;
          s.heal(s.maxHp * 0.25);
          for (const l of s.launchers) l.reload = 0;
        }
      },
      aiShouldUse(ship, game) {
        const hurtAllies = alliesWithin(ship, game, 1500).filter((s) => hpFrac(s) < 0.4).length;
        return (hpFrac(ship) < 0.3 && underFire(ship, game, 700) >= 1) || hurtAllies >= 2;
      },
    },
  ),
];
