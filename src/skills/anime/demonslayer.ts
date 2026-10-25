import { bearingTo, forwardX, forwardZ } from '../../core/math';
import { aimPoint, alliesWithin, blinkTo, buff, enemiesWithin, hpFrac, underFire, within } from '../kit';
import { def, type SkillDef } from '../types';
import { burn, crescent, dashStrike, enemiesAround, fighting, flashThrough, lineDash, pack, queueFlash, rot, shiftSkill, spendHull, victim, volley } from './common';

// Demon Slayer: Tanjiro Kamado (destroyer), Kyojuro Rengoku (battleship) and Muzan Kibutsuji
// (submarine). Water and Sun Breathing with Nezuko at his side; the Flame Hashira's Ninth Form;
// and the Demon King with his Upper Moons and the Infinity Castle.

const WATER = 0x3a8aff;
const SUN = 0xff7a20;
const FLAME = 0xff5a10;
const BLOOD = 0xb0102a;
const DEMON = 0x6a0a2a;

export const DEMONSLAYER_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Tanjiro Kamado
  def(
    {
      id: 'waterWheel',
      name: 'Water Wheel',
      short: 'WATER WHEEL',
      description: 'Water Breathing, Second Form: a rolling cut onto the enemy under the reticle (within 1.5 km), 45k and a shove.',
      cooldown: 12,
      duration: 0,
      accent: WATER,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 1500);
        if (!t) return false;
        return dashStrike(ship, game, t, 45000, st.spec, 160);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1400);
      },
    },
  ),
  def(
    {
      id: 'callNezuko',
      name: 'Nezuko',
      short: 'NEZUKO',
      description: 'The box on his back opens: Nezuko fights beside you for 18 s, and everything she hits catches fire.',
      cooldown: 24,
      duration: 0,
      accent: 0xff7aa0,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        for (const s of pack(ship, game, 'nezuko', 1, 18, 'Nezuko')) {
          buff(s, 'bloodDemonArt', 18, (m) => {
            m.guaranteedFire = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  shiftSkill({
    id: 'hinokamiKagura',
    name: 'Hinokami Kagura',
    short: 'SUN BREATHING',
    description: 'Titan Shift: the dance his father taught him, and the mark burning on his brow. Sun Breathing, all thirteen forms of it.',
    accent: SUN,
  }),

  // ------------------------------------------------------------------ Sun Breathing
  def(
    {
      id: 'constantFlux',
      name: 'Constant Flux',
      short: 'CONSTANT FLUX',
      description: 'A dragon of water that never stops moving: flash through the three nearest enemies within 2.5 km, one every 0.3 s, 70k each.',
      cooldown: 10,
      duration: 1,
      accent: WATER,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 2500).slice(0, 3);
        return queueFlash(st, list, list.length);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.3, 70000, 0);
      },
      aiShouldUse(ship, game) {
        return enemiesAround(ship, game, ship.pos.x, ship.pos.z, 2400).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'explodingBlood',
      name: 'Exploding Blood',
      short: 'EXPLOD\u00adING BLOOD',
      description: 'Nezuko joins you for 18 s, and her blood burns on every blade: for 10 s, every hit from you or an ally within 1.5 km sets a fire.',
      cooldown: 16,
      duration: 0,
      accent: 0xff4a6a,
      icon: 'meteor',
    },
    {
      activate(ship, game) {
        pack(ship, game, 'nezuko', 1, 18, 'Nezuko');
        for (const s of alliesWithin(ship, game, 1500)) {
          buff(s, 'explodingBlood', 10, (m) => {
            m.guaranteedFire = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'sunHaloDragon',
      name: 'Sun Halo Dragon',
      short: 'HALO DRAGON',
      description: 'A dragon wreathed in the sun\'s halo onto the enemy under the reticle (within 2.5 km): 100k and two fires.',
      cooldown: 12,
      duration: 0,
      accent: SUN,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2500);
        if (!t || !dashStrike(ship, game, t, 100000, st.spec, 120)) return false;
        if (t.alive) burn(t, ship, game, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2400);
      },
    },
  ),
  def(
    {
      id: 'clearBlueSky',
      name: 'Clear Blue Sky',
      short: 'BLUE SKY',
      description: 'A wide arc of sunlight swept across 180° ahead of the reticle, out to 1.2 km: 80k to each hull it cuts, and they burn.',
      cooldown: 10,
      duration: 0,
      accent: SUN,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 180, 1200, 80000, { fire: 1 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'fakeRainbow',
      name: 'Fake Rainbow',
      short: 'FAKE RAINBOW',
      description: 'An afterimage dance: for 4 s, 60% of the hits aimed at you find nothing.',
      cooldown: 16,
      duration: 4,
      accent: 0xffd0a0,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.dodge = Math.max(m.dodge, 0.6);
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'burningBones',
      name: 'Burning Bones, Summer Sun',
      short: 'BURNING BONES',
      description: 'The blade spins in a ring of fire that follows you for 6 s: 20k a second to every enemy within 700 m.',
      cooldown: 14,
      duration: 0,
      accent: FLAME,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 700, life: 6, follow: ship, dps: 20000, skill: st.spec, look: 'fire', color: SUN });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 650).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'thirteenthForm',
      name: 'Thirteenth Form',
      short: 'THIRTEENTH',
      description: 'All twelve forms in an endless ring: twelve strikes in 3 s, cycling through up to four enemies within 4 km, 40k each.',
      ult: true,
      cooldown: 90,
      duration: 3.2,
      accent: SUN,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 4000).slice(0, 4);
        return queueFlash(st, list, 12);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.25, 40000, 0);
      },
      aiShouldUse(ship, game) {
        return enemiesAround(ship, game, ship.pos.x, ship.pos.z, 3800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'beneficentRadiance',
      name: 'Beneficent Radiance',
      short: 'RADIANCE',
      description: 'A full circle of sunlight, 1.5 km round: 180k to every hull it cuts, and they burn.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: SUN,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 360, 1500, 180000, { fire: 1, time: 0.7 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1400).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'solarDragon',
      name: 'Solar Heat Haze',
      short: 'SOLAR DRAGON',
      description: 'A dragon of the sun runs 5 km toward the reticle: fire falls every 400 m along its path, 120k across 250 m each, and whatever it touches burns.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: SUN,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        const b = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        for (let i = 1; i * 400 <= 5000; i++) {
          const d = i * 400;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: ship.pos.x + forwardX(b) * d, z: ship.pos.z + forwardZ(b) * d, radius: 250, delay: 0.2 + i * 0.08, damage: 120000, fire: 1, look: 'fireball' });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Kyojuro Rengoku
  def(
    {
      id: 'unknowingFire',
      name: 'Unknowing Fire',
      short: 'UNKNOW\u00adING FIRE',
      description: 'Flame Breathing, First Form: a burning lunge onto the enemy under the reticle (within 1.5 km), 55k and a fire.',
      cooldown: 12,
      duration: 0,
      accent: FLAME,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 1500);
        if (!t || !dashStrike(ship, game, t, 55000, st.spec, 140)) return false;
        if (t.alive) burn(t, ship, game);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1400);
      },
    },
  ),
  def(
    {
      id: 'risingScorchingSun',
      name: 'Rising Scorching Sun',
      short: 'SCORCHING SUN',
      description: 'Flame Breathing, Second Form: an upward arc of fire across 120° toward the reticle, out to 1.5 km, 50k to each hull, and they burn.',
      cooldown: 12,
      duration: 0,
      accent: FLAME,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 120, 1500, 50000, { fire: 1 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1400).length >= 1;
      },
    },
  ),
  shiftSkill({
    id: 'setYourHeartAblaze',
    name: 'Set Your Heart Ablaze',
    short: 'HEART ABLAZE',
    description: 'Titan Shift: the Flame Hashira does his duty to the end. A hull wrapped in fire, and the Ninth Form waiting behind it.',
    accent: FLAME,
  }),

  // ------------------------------------------------------------------ Ninth Form: Rengoku
  def(
    {
      id: 'blazingUniverse',
      name: 'Blazing Universe',
      short: 'BLAZING',
      description: 'Flame Breathing, Fifth Form... no, the Sixth: a cut brought down on the reticle (within 5 km), 90k across 600 m, and fires.',
      cooldown: 10,
      duration: 0,
      accent: FLAME,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 600, delay: 0.5, damage: 90000, fire: 1, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'flameTiger',
      name: 'Flame Tiger',
      short: 'FLAME TIGER',
      description: 'A tiger of fire bounds across the sea at the enemy under the reticle (within 6 km): 100k across 400 m, and everything in it burns.',
      cooldown: 12,
      duration: 0,
      accent: FLAME,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 6000);
        if (!t) return false;
        return volley(ship, game, [t], 1, 100000, st.spec, { look: 'boar', speed: 500, blast: 400, fire: 1 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'heartAblaze',
      name: 'Heart Ablaze',
      short: 'ABLAZE',
      description: 'For 10 s: 40% more damage and fire cannot hurt you, and every ally within 2 km fights 20% harder.',
      cooldown: 20,
      duration: 10,
      accent: FLAME,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        ship.extinguish();
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.4;
          m.fireImmune = true;
        });
        for (const s of alliesWithin(ship, game, 2000)) {
          if (s === ship) continue;
          buff(s, 'heartAblaze:ally', st.spec.duration, (m) => {
            m.damageMul *= 1.2;
          });
        }
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  def(
    {
      id: 'unknowingFireFull',
      name: 'Unknowing Fire: Full',
      short: 'FULL FIRE',
      description: 'The First Form with everything behind it: onto the enemy under the reticle (within 3 km), 110k and two fires.',
      cooldown: 12,
      duration: 0,
      accent: FLAME,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t || !dashStrike(ship, game, t, 110000, st.spec, 160)) return false;
        if (t.alive) burn(t, ship, game, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'burningSpirit',
      name: 'Burning Spirit',
      short: 'SPIRIT',
      description: 'He does not fall: for 4 s, nothing can sink you.',
      cooldown: 24,
      duration: 4,
      accent: FLAME,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.undying = true;
        });
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.25;
      },
    },
  ),
  def(
    {
      id: 'flameFocus',
      name: 'Total Concentration',
      short: 'FOCUS',
      description: 'Breathe, and close the wounds: shake off every debuff and repair 20%.',
      cooldown: 22,
      duration: 0,
      accent: 0xffd0a0,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.cleanse();
        ship.heal(ship.maxHp * 0.2);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.55;
      },
    },
  ),
  def(
    {
      id: 'ninthForm',
      name: 'Ninth Form: Rengoku',
      short: 'NINTH FORM',
      description: 'The Flame Hashira\'s own form: a burning charge 4 km toward the reticle through a path 300 m wide, 280k to every enemy on it, and they burn.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: FLAME,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        return lineDash(ship, game, 4000, 280000, st.spec, 0, 150, 1);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  def(
    {
      id: 'pillarOfFlame',
      name: 'Pillar of Flame',
      short: 'PILLAR',
      description: 'The Hashira stands for everyone: every ally within 3 km cannot sink for 6 s and fights 25% harder, and every enemy within 2 km catches fire.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: FLAME,
      icon: 'shield',
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 3000)) {
          buff(s, 'pillarOfFlame', 6, (m) => {
            m.undying = true;
            m.damageMul *= 1.25;
          });
        }
        for (const s of enemiesWithin(ship, game, 2000)) burn(s, ship, game);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3000).length >= 2 || hpFrac(ship) < 0.3;
      },
    },
  ),
  def(
    {
      id: 'flameLastStand',
      name: 'Last Stand',
      short: 'LAST STAND',
      description: 'Everything left, all at once: for 12 s, 80% more damage and nothing can sink you, but the hull burns away 2% a second.',
      ult: true,
      cooldown: 110,
      duration: 12,
      accent: FLAME,
      icon: 'meteor',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.8;
          m.undying = true;
        });
      },
      update(ship, _g, dt) {
        spendHull(ship, 0.02 * dt);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Muzan Kibutsuji
  def(
    {
      id: 'bloodWhips',
      name: 'Blood Whips',
      short: 'WHIPS',
      description: 'Barbed whips lash out from the hull across 180° toward the reticle, out to 1.2 km: 45k to each hull they cut.',
      cooldown: 12,
      duration: 0,
      accent: BLOOD,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 180, 1200, 45000, { width: 40 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'biokinesis',
      name: 'Biokinesis',
      short: 'BIOKINESIS',
      description: 'Flesh knits back as fast as it is cut: repair 20% at once, then 3% a second for 5 s.',
      cooldown: 22,
      duration: 5,
      accent: BLOOD,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.2);
      },
      update(ship, _g, dt) {
        ship.heal(ship.maxHp * 0.03 * dt);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.55;
      },
    },
  ),
  shiftSkill({
    id: 'demonKing',
    name: 'Demon King',
    short: 'DEMON KING',
    description: 'Titan Shift: the progenitor of every demon stops hiding. A titan submarine of flesh and blood, with Upper Moons at its call and the Infinity Castle around it.',
    accent: BLOOD,
  }),

  // ------------------------------------------------------------------ Demon King Muzan
  def(
    {
      id: 'whipStorm',
      name: 'Whip Storm',
      short: 'WHIP STORM',
      description: 'Every whip at once, all the way round: 80k to every hull within 1.5 km.',
      cooldown: 10,
      duration: 0,
      accent: BLOOD,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 360, 1500, 80000, { width: 40, time: 0.6 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1400).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'upperMoons',
      name: 'Upper Moons',
      short: 'UPPER MOONS',
      description: 'The Twelve Kizuki answer: three Upper Moon cruisers fight for you for 20 s.',
      cooldown: 24,
      duration: 0,
      accent: DEMON,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        pack(ship, game, 'upperMoon', 3, 20, 'Upper Moon', 180);
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 7000);
      },
    },
  ),
  def(
    {
      id: 'fiveHearts',
      name: 'Five Hearts',
      short: 'FIVE HEARTS',
      description: 'Five hearts and seven brains: for 6 s nothing can sink you, and the hull repairs 2% a second.',
      cooldown: 22,
      duration: 6,
      accent: BLOOD,
      icon: 'heal',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.undying = true;
        });
      },
      update(ship, _g, dt) {
        ship.heal(ship.maxHp * 0.02 * dt);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.45;
      },
    },
  ),
  def(
    {
      id: 'cursedBlood',
      name: 'Cursed Blood',
      short: 'CURSED BLOOD',
      description: 'Demon blood poured into the sea at the reticle (within 5 km): for 6 s every enemy within 900 m of it takes 20k a second and cannot repair.',
      cooldown: 12,
      duration: 0,
      accent: BLOOD,
      icon: 'skull',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 900, life: 6, dps: 20000, healBlock: true, skill: st.spec, look: 'void', color: BLOOD });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'biwa',
      name: 'Biwa',
      short: 'BIWA',
      description: 'A note on Nakime\'s biwa, and a door opens: appear up to 5 km toward the reticle.',
      cooldown: 12,
      duration: 0,
      accent: DEMON,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 5000);
        return blinkTo(ship, game, p.x, p.z);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 8000) && !within(ship, target, 3000);
      },
    },
  ),
  def(
    {
      id: 'bioEruption',
      name: 'Bio-Eruption',
      short: 'ERUPTION',
      description: 'The body bursts outward: a ring of flesh rolls 900 m out, 70k to every enemy it passes.',
      cooldown: 12,
      duration: 0,
      accent: BLOOD,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 900, delay: 0, damage: 70000, knock: 120, hitsSubs: true, speed: 900, follow: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 850).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'infinityCastle',
      name: 'Infinity Castle',
      short: 'INFINITY CASTLE',
      description: 'The fortress that has no end: a cage 2 km around you for 10 s. Enemies inside cannot leave, lose 3% of their hull a second, and are slowed to 70%.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: DEMON,
      icon: 'portal',
    },
    {
      activate(ship, game, st) {
        rot(ship, game, { x: ship.pos.x, z: ship.pos.z, r: 2000, life: 10, cage: true, slow: 0.7, skill: st.spec, look: 'hex', color: DEMON }, 0.03);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'thousandBloodSpears',
      name: 'Thousand Blood Spears',
      short: 'BLOOD SPEARS',
      description: 'Spears of hardened blood: twenty-four shared between every enemy within 5 km, 12k each.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: BLOOD,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000);
        return volley(ship, game, list, 24, 12000, st.spec, { look: 'spear', spread: 0.05 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'absorption',
      name: 'Absorption',
      short: 'ABSORPTION',
      description: 'He eats what he touches: for 5 s every enemy within 2.5 km loses 6% of its hull a second, and all of it repairs you.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: BLOOD,
      icon: 'heal',
    },
    {
      activate(ship, game, st) {
        rot(ship, game, { x: ship.pos.x, z: ship.pos.z, r: 2500, life: 5, follow: ship, skill: st.spec, look: 'void', color: BLOOD }, 0.06, false, (dealt) => ship.heal(dealt));
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 1;
      },
    },
  ),
];
