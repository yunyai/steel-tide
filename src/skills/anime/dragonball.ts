import { bearingTo, forwardX, forwardZ } from '../../core/math';
import { aimPoint, alliesWithin, buff, enemiesWithin, hpFrac, hurt, nearestEnemy, stun, underFire, within } from '../kit';
import { airStrike } from '../modern/common';
import { def, type SkillDef } from '../types';
import {
  appearAt,
  burn,
  clingTo,
  dashStrike,
  enemiesAround,
  execute,
  fighting,
  flashThrough,
  landNear,
  lineDash,
  queueFlash,
  shiftSkill,
  slash,
  spendHull,
  victim,
  volley,
} from './common';

// Dragon Ball: Son Goku (battleship). Beams from the bow, Instant Transmission anywhere on the
// map, and Ultra Instinct once the limit breaks. Vegeta (battlecruiser): pride, then Ultra Ego.
// Frieza (carrier): the Frieza Force in the air, then Golden Frieza.

const KI = 0x5ac8ff;
const SILVER = 0xd8e4ff;
const GALICK = 0xa060ff;
const EGO = 0x8a3aff;
const DEATH = 0xff60c0;
const GOLD = 0xffc830;

export const DRAGONBALL_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Son Goku
  def(
    {
      id: 'kamehameha',
      name: 'Kamehameha',
      short: 'KAME\u00adHAMEHA',
      description: 'Cup the hands and fire from the bow: after a 1.2 s charge, 1.2 s of beam out to 4.5 km at 60k a second; the bow swings toward the reticle.',
      cooldown: 16,
      duration: 0,
      accent: KI,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 1.2, time: 1.2, dps: 60000, length: 4500, width: 40, steer: 50, knock: 30 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4300);
      },
    },
  ),
  def(
    {
      id: 'instantTransmission',
      name: 'Instant Transmission',
      short: 'TELEPORT',
      description: 'Lock onto the ki of the enemy under the reticle (within 6 km) and appear beside it, every gun reloaded.',
      cooldown: 14,
      duration: 0,
      accent: 0xbfe8ff,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const t = victim(ship, game, 6000);
        if (!t || !appearAt(ship, game, t, false)) return false;
        for (const tr of ship.turrets) tr.reload = 0;
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6000) && !within(ship, target, 2500) && hpFrac(ship) > 0.4;
      },
    },
  ),
  shiftSkill({
    id: 'ultraInstinct',
    name: 'Ultra Instinct',
    short: 'ULTRA INSTINCT',
    description: 'Titan Shift: silver aura, a body that moves on its own. Goku becomes a titan of perfect motion, with the Spirit Bomb and Kamehameha at ten times the power.',
    accent: SILVER,
  }),

  // ------------------------------------------------------------------ Goku, Ultra Instinct
  def(
    {
      id: 'superKamehameha',
      name: 'Super Kamehameha',
      short: 'SUPER KAME',
      description: 'A beam that follows the reticle: after 0.8 s, 1.5 s through every hull on the line out to 5.5 km at 110k a second.',
      cooldown: 10,
      duration: 0,
      accent: KI,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 0.8, time: 1.5, dps: 110000, length: 5500, width: 70, pierce: true, rate: 20, knock: 40, mx: ship.spec.length * 0.3 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5300);
      },
    },
  ),
  def(
    {
      id: 'instantKamehameha',
      name: 'Instant Kamehameha',
      short: 'INSTANT KAME',
      description: 'Teleport astern of the enemy under the reticle (within 6 km) and fire point-blank: 140k to the first hull in front of you.',
      cooldown: 12,
      duration: 0,
      accent: 0x8ad8ff,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 6000);
        if (!t || !appearAt(ship, game, t, true)) return false;
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 0.25, time: 0.4, dps: 0, strike: 140000, length: 1500, width: 60 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'autonomousDodge',
      name: 'Autonomous Dodge',
      short: 'DODGE',
      description: 'For 6 s the body moves before the mind: 60% of hostile hits miss outright, and the helm turns half again as sharp.',
      cooldown: 16,
      duration: 6,
      accent: SILVER,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.dodge = Math.max(m.dodge, 0.6);
          m.turnMul *= 1.5;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 800) >= 3 || (hpFrac(ship) < 0.5 && fighting(ship, game, 5000));
      },
    },
  ),
  def(
    {
      id: 'kaioken',
      name: 'Kaioken x20',
      short: 'KAIOKEN',
      description: 'Twenty times the ki for 10 s: 60% more damage, 30% faster, guns reload in 75% of the time, at 1% of your hull a second.',
      cooldown: 20,
      duration: 10,
      accent: 0xff3030,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.6;
          m.speedMul *= 1.3;
          m.reloadMul *= 0.75;
        });
      },
      update(ship, _g, dt) {
        spendHull(ship, 0.01 * dt);
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000) && hpFrac(ship) > 0.4;
      },
    },
  ),
  def(
    {
      id: 'dragonFist',
      name: 'Dragon Fist',
      short: 'DRAGON FIST',
      description: 'Become a golden dragon and drive through the enemy under the reticle (within 3 km): 130k, a 3 s stun, and it is hurled away.',
      cooldown: 12,
      duration: 0,
      accent: 0xffd040,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        return dashStrike(ship, game, t, 130000, st.spec, 250, 3);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'senzuBean',
      name: 'Senzu Bean',
      short: 'SENZU',
      description: 'One bean from Korin: repair 35% at once and shake off every debuff.',
      cooldown: 30,
      duration: 0,
      accent: 0x7adf6a,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.35);
        ship.cleanse();
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'spiritBomb',
      name: 'Spirit Bomb',
      short: 'SPIRIT BOMB',
      description: 'Raise the hands and gather energy for 3 s: the bomb falls on the reticle across 900 m, 200k plus 40k for every ally within 4 km (up to 400k).',
      ult: true,
      cooldown: 90,
      duration: 3,
      accent: 0x9adfff,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        const allies = alliesWithin(ship, game, 4000).length - 1;
        const damage = Math.min(400000, 200000 + 40000 * allies);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 900, delay: 3, damage, look: 'meteor' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5500);
      },
    },
  ),
  def(
    {
      id: 'kamehameha10x',
      name: 'Kamehameha x10',
      short: 'KAME x10',
      description: 'The full-power beam: after 1 s, 3 s of it following the reticle out to 6 km, 140k a second through every hull on the line.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0x4ab8ff,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 1, time: 3, dps: 140000, length: 6000, width: 90, pierce: true, rate: 35, knock: 60, mx: ship.spec.length * 0.3 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'silverDragonFlash',
      name: 'Silver Dragon Flash',
      short: 'DRAGON FLASH',
      description: 'Flash from enemy to enemy through the five nearest within 4 km, one every 0.4 s: 90k and a 1.5 s stun on each.',
      ult: true,
      cooldown: 110,
      duration: 2.2,
      accent: SILVER,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 4000).slice(0, 5);
        return queueFlash(st, list, list.length);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.4, 90000, 1.5);
      },
      aiShouldUse(ship, game) {
        return enemiesAround(ship, game, ship.pos.x, ship.pos.z, 3800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Vegeta
  def(
    {
      id: 'galickGun',
      name: 'Galick Gun',
      short: 'GALICK GUN',
      description: 'A violet beam from the bow: after 0.8 s, 1 s of it out to 6 km at 60k a second; the bow swings toward the reticle.',
      cooldown: 14,
      duration: 0,
      accent: GALICK,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 0.8, time: 1, dps: 60000, length: 6000, width: 40, steer: 50, knock: 30 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'bigBangAttack',
      name: 'Big Bang Attack',
      short: 'BIG BANG',
      description: 'One hand out, one sphere of ki: it streaks to the enemy under the reticle (within 6 km) and bursts for 55k across 500 m.',
      cooldown: 12,
      duration: 0,
      accent: 0x8ad8ff,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 6000);
        const p = t ? t.pos : aimPoint(ship, 6000);
        game.missiles.launch(ship, p.x, p.z, 0, 55000, { profile: 'hyper', speed: 1200, look: 'star', blast: 500, target: t, skill: st.spec, uninterceptable: true });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  shiftSkill({
    id: 'saiyanPride',
    name: 'Saiyan Pride',
    short: 'ULTRA EGO',
    description: 'Titan Shift: the Prince of all Saiyans takes the path of destruction. Ultra Ego, purple and proud: the more he is hurt, the harder he hits.',
    accent: EGO,
  }),

  // ------------------------------------------------------------------ Vegeta, Ultra Ego
  def(
    {
      id: 'galickUltra',
      name: 'Galick Gun: Ultra',
      short: 'GALICK ULTRA',
      description: 'The Galick Gun through everything: after 0.6 s, 1 s of beam out to 8 km at 120k a second, through every hull on the line.',
      cooldown: 10,
      duration: 0,
      accent: GALICK,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 0.6, time: 1, dps: 120000, length: 8000, width: 60, pierce: true, steer: 60, knock: 40 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7800);
      },
    },
  ),
  def(
    {
      id: 'bigBangBarrage',
      name: 'Big Bang Barrage',
      short: 'BARRAGE',
      description: 'Six Big Bangs scattered around the reticle (within 6 km): 35k each across 300 m.',
      cooldown: 12,
      duration: 0,
      accent: 0x8ad8ff,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        for (let i = 0; i < 6; i++) {
          const b = (i / 6) * Math.PI * 2;
          const r = i % 2 ? 380 : 180;
          game.missiles.launch(ship, p.x + forwardX(b) * r, p.z + forwardZ(b) * r, i * 0.12, 35000, { profile: 'hyper', speed: 1100, look: 'star', blast: 300, skill: st.spec, uninterceptable: true });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'destroyersRage',
      name: 'Destroyer\'s Rage',
      short: 'RAGE',
      description: 'For 14 s every 10% of hull you have lost adds 10% to your damage (up to 60%), and you take 20% less.',
      cooldown: 20,
      duration: 14,
      accent: EGO,
      icon: 'fist',
    },
    {
      activate() {},
      update(ship, _g, _dt, st) {
        const lost = Math.min(6, Math.floor((1 - hpFrac(ship)) * 10));
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageMul *= 1 + 0.1 * lost;
          m.damageTakenMul *= 0.8;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'princesRush',
      name: 'Prince\'s Rush',
      short: 'RUSH',
      description: 'Close on the enemy under the reticle (within 2 km) in an instant: 100k, a 1.5 s stun and a shove.',
      cooldown: 12,
      duration: 0,
      accent: EGO,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2000);
        if (!t) return false;
        return dashStrike(ship, game, t, 100000, st.spec, 150, 1.5);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1900);
      },
    },
  ),
  def(
    {
      id: 'hakaiSphere',
      name: 'Hakai Sphere',
      short: 'HAKAI SPHERE',
      description: 'A sphere of destruction clings to the enemy under the reticle (within 4 km): 25k a second for 4 s, and it cannot repair.',
      cooldown: 14,
      duration: 0,
      accent: EGO,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        clingTo(ship, game, t, 25000, 4, st.spec, { healBlock: true, look: 'void', color: EGO });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  def(
    {
      id: 'saiyanEndurance',
      name: 'Saiyan Endurance',
      short: 'ENDUR\u00adANCE',
      description: 'A Saiyan does not stay down: repair 25%, shake off every debuff, and nothing can sink you for 3 s.',
      cooldown: 26,
      duration: 3,
      accent: 0xffd040,
      icon: 'heal',
    },
    {
      activate(ship, _g, st) {
        ship.heal(ship.maxHp * 0.25);
        ship.cleanse();
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.undying = true;
        });
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.4;
      },
    },
  ),
  def(
    {
      id: 'finalFlash',
      name: 'Final Flash',
      short: 'FINAL FLASH',
      description: 'Both palms forward: after 1.2 s a beam crosses 8 km from the bow, 300k to every hull on the line; the bow swings toward the reticle while it charges.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0xfff080,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 1.2, time: 1, dps: 0, strike: 300000, length: 8000, width: 110, pierce: true, steer: 60, knock: 80 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7800);
      },
    },
  ),
  def(
    {
      id: 'hakai',
      name: 'Hakai',
      short: 'HAKAI',
      description: 'Destruction itself: the enemy under the reticle (within 3 km) is erased. A line ship is sunk outright; a titan or form loses 20% of its hull.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: EGO,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        execute(ship, t, 0.2, st.spec);
        game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 2 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'finalExplosion',
      name: 'Final Explosion',
      short: 'FINAL EXPLOSION',
      description: 'Everything at once, from the hull itself: 320k across 1.5 km around you. It costs 30% of your hull, and nothing can sink you for 2 s after.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xffe0a0,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        spendHull(ship, 0.3);
        buff(ship, 'finalExplosion', 2, (m) => {
          m.undying = true;
        });
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1500, delay: 0.3, damage: 320000, knock: 150 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1300).length >= 2 && hpFrac(ship) > 0.35;
      },
    },
  ),

  // ------------------------------------------------------------------ Frieza
  def(
    {
      id: 'deathBeam',
      name: 'Death Beam',
      short: 'DEATH BEAM',
      description: 'One finger: a needle of ki crosses 6 km toward the reticle at once, 50k to every hull on the line.',
      cooldown: 10,
      duration: 0,
      accent: DEATH,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 6000, 30, 50000, { charge: 0.1 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'friezaForce',
      name: 'Frieza Force',
      short: 'FRIEZA FORCE',
      description: 'Soldiers in attack pods: a torpedo wing and a dive wing launch at once at the enemy under the reticle, about 50k between them.',
      cooldown: 16,
      duration: 0,
      accent: 0xb080ff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, ship.spec.air?.range ?? 6000);
        if (!t) return false;
        const a = airStrike(ship, game, 'torpedo', t, 30000, st.spec);
        const b = airStrike(ship, game, 'dive', t, 20000, st.spec);
        return !!(a || b);
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, (ship.spec.air?.range ?? 6000) * 0.9);
      },
    },
  ),
  shiftSkill({
    id: 'goldenForm',
    name: 'Golden Form',
    short: 'GOLDEN',
    description: 'Titan Shift: "This isn\'t even my final form." Golden Frieza, with a bigger Frieza Force behind him and planets to spare.',
    accent: GOLD,
  }),

  // ------------------------------------------------------------------ Golden Frieza
  def(
    {
      id: 'deathBeamBarrage',
      name: 'Death Beam Barrage',
      short: 'DEATH BEAMS',
      description: 'A Death Beam at each of the five nearest enemies within 6 km: 45k apiece.',
      cooldown: 12,
      duration: 0,
      accent: DEATH,
      icon: 'laser',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 6000).slice(0, 5);
        return volley(ship, game, list, list.length, 45000, st.spec, { look: 'bolt', profile: 'hyper', speed: 2200, blast: 50, spread: 0.06 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'armada',
      name: 'Armada',
      short: 'ARMADA',
      description: 'The whole Force at once: a torpedo wing and two dive wings launch at the enemy under the reticle, about 80k between them.',
      cooldown: 16,
      duration: 0,
      accent: 0xb080ff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, ship.spec.air?.range ?? 6000);
        if (!t) return false;
        const a = airStrike(ship, game, 'torpedo', t, 35000, st.spec);
        const b = airStrike(ship, game, 'dive', t, 22000, st.spec);
        const c = airStrike(ship, game, 'dive', t, 22000, st.spec);
        return !!(a || b || c);
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, (ship.spec.air?.range ?? 6000) * 0.9);
      },
    },
  ),
  def(
    {
      id: 'deathSaucer',
      name: 'Death Saucer',
      short: 'SAUCER',
      description: 'A spinning disc of ki thrown toward the reticle cuts every hull on the line out to 5 km: 90k each.',
      cooldown: 12,
      duration: 0,
      accent: 0xffa0e0,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 5000, 70, 90000, { charge: 0.2 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'telekinesis',
      name: 'Telekinesis',
      short: 'TELE\u00adKINESIS',
      description: 'Lift the enemy under the reticle (within 3 km) and throw it into the enemy nearest it: 60k and a 2 s stun to both.',
      cooldown: 14,
      duration: 0,
      accent: 0xb080ff,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        const other = enemiesAround(ship, game, t.pos.x, t.pos.z, 3000).find((s) => s !== t);
        if (other) {
          const gap = (t.spec.length + other.spec.length) * 0.3 + 40;
          landNear(t, game, other.pos.x, other.pos.z, gap, bearingTo(other.pos.x, other.pos.z, t.pos.x, t.pos.z));
        }
        for (const s of other ? [t, other] : [t]) {
          hurt(ship, s, 60000, st.spec);
          if (s.alive) stun(s, 2);
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'goldenGuard',
      name: 'Golden Guard',
      short: 'GOLDEN GUARD',
      description: 'A golden barrier for 8 s: a shield worth a quarter of your hull, and 30% of the damage aimed at you thrown back.',
      cooldown: 20,
      duration: 8,
      accent: GOLD,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.addShield(ship.maxHp * 0.25, st.spec.duration);
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.reflect = Math.max(m.reflect, 0.3);
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'goldenRecovery',
      name: 'Golden Recovery',
      short: 'RECOVERY',
      description: 'Frieza does not bleed for long: repair 25% at once.',
      cooldown: 24,
      duration: 0,
      accent: GOLD,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.25);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'supernova',
      name: 'Supernova',
      short: 'SUPERNOVA',
      description: 'A small sun raised overhead and thrown at the reticle: after 1.5 s, 280k across 1 km, and everything it touches burns.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0xffa030,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 1000, delay: 1.5, damage: 280000, fire: 1, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'novaStrike',
      name: 'Nova Strike',
      short: 'NOVA STRIKE',
      description: 'Become a comet: dash 4 km toward the reticle, and every enemy on the way takes 160k.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: GOLD,
      icon: 'ram',
    },
    {
      activate(ship, game, st) {
        return lineDash(ship, game, 4000, 160000, st.spec, 0, 120);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  def(
    {
      id: 'planetBurst',
      name: 'Planet Burst',
      short: 'PLANET BURST',
      description: 'The sea itself goes up: every enemy within 4 km takes 120k and catches fire.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xff6a20,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const list = enemiesWithin(ship, game, 4000);
        if (!list.length) return false;
        for (const s of list) {
          hurt(ship, s, 120000, st.spec);
          if (s.alive) burn(s, ship, game);
          game.events.emit('explosion', { x: s.pos.x, y: s.spec.freeboard, z: s.pos.z, size: 2 });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800).length >= 2;
      },
    },
  ),
];
