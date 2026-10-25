import type { Game } from '../../core/Game';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { bearingTo, forwardX, forwardZ } from '../../core/math';
import { aimPoint, alliesWithin, blinkTo, boltTo, buff, chainLightning, disarm, enemiesWithin, hpFrac, hurt, silence, stun, swapPlaces, underFire, within } from '../kit';
import { def, type SkillDef } from '../types';
import { anyShipAt, crescent, dashStrike, enemiesAround, every, fighting, flashThrough, hurtFrac, knockFrom, queueFlash, rot, shiftSkill, slash, victim } from './common';

// One Piece: Monkey D. Luffy (battlecruiser, the Thousand Sunny's lion on the bow). Rubber fists
// that reach for kilometres, gears that push the engines past their limit, and the Sun God.
// Roronoa Zoro (heavy cruiser): three swords, then nine. Trafalgar Law (submarine): the Op-Op
// Fruit's Room, in which he moves every ship where he likes.

const RUBBER = 0xff3a30;
const NIKA = 0xfff4e0;
const HAKI = 0x8a2cff;
const BLADE = 0xd8f0d0;
const HELL = 0x2a6a3a;
const ROOM = 0x5ab0ff;

/** Law's Room: a dome on the ship for `time` s in which enemies are slowed to `slow` and revealed. */
function operatingRoom(ship: Ship, game: Game, r: number, time: number, slow: number, skill: SkillSpec): void {
  game.fields.add(ship, {
    x: ship.pos.x,
    z: ship.pos.z,
    r,
    life: time,
    follow: ship,
    slow,
    skill,
    look: 'hex',
    color: ROOM,
    onTick: (s) => {
      if (s.team === ship.team) return;
      buff(s, 'debuff:room', 0.4, (m) => {
        m.revealed = true;
      });
    },
  });
}

/** A rubber fist flung at `t`: `damage` on arrival and a shove away from the ship. */
function punch(ship: Ship, game: Game, t: Ship, damage: number, knock: number, skill: SkillSpec, delay = 0): void {
  game.missiles.launch(ship, t.pos.x, t.pos.z, delay, damage, {
    profile: 'hyper',
    speed: 1100,
    look: 'hammer',
    blast: 70,
    target: t,
    skill,
    uninterceptable: true,
    onHit: (s) => knockFrom(s, ship.pos.x, ship.pos.z, knock),
  });
}

export const ONEPIECE_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Monkey D. Luffy
  def(
    {
      id: 'gumGumPistol',
      name: 'Gum-Gum Pistol',
      short: 'PISTOL',
      description: 'A rubber fist stretches up to 4 km at the enemy under the reticle: 45k and a shove.',
      cooldown: 10,
      duration: 0,
      accent: RUBBER,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        punch(ship, game, t, 45000, 120, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  def(
    {
      id: 'gearSecond',
      name: 'Gear Second',
      short: 'GEAR 2',
      description: 'Pump the blood faster for 8 s: 40% more speed, guns reload in 60% of the time, and the helm answers 30% quicker.',
      cooldown: 20,
      duration: 8,
      accent: 0xff7070,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.4;
          m.reloadMul *= 0.6;
          m.turnMul *= 1.3;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  shiftSkill({
    id: 'gearFifth',
    name: 'Gear Fifth',
    short: 'GEAR 5',
    description: 'Titan Shift: the drums of liberation sound and Luffy awakens as the Sun God Nika, a titan that bends the battle like rubber.',
    accent: NIKA,
  }),

  // ------------------------------------------------------------------ Sun God Nika
  def(
    {
      id: 'jetPistol',
      name: 'Gum-Gum Jet Gatling',
      short: 'JET GATLING',
      description: 'Three fists faster than sight at the enemy under the reticle (within 5 km): 40k each, each with a shove.',
      cooldown: 6,
      duration: 0,
      accent: RUBBER,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        for (let i = 0; i < 3; i++) punch(ship, game, t, 40000, 80, st.spec, i * 0.15);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'gearFourth',
      name: 'Gear Fourth: Boundman',
      short: 'GEAR 4',
      description: 'Bounce into battle for 10 s: 60% more speed, guns reload twice as fast, 30% more damage, and nothing slows or stops you.',
      cooldown: 16,
      duration: 10,
      accent: 0xff9a50,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.6;
          m.reloadMul *= 0.5;
          m.damageMul *= 1.3;
          m.unstoppable = true;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  def(
    {
      id: 'toonForce',
      name: 'Toon Force',
      short: 'TOON',
      description: 'For 6 s the hull is a cartoon: damage taken drops by 70%, and attackers get 30% of what they deal bounced back.',
      cooldown: 18,
      duration: 6,
      accent: NIKA,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.3;
          m.reflect = Math.max(m.reflect, 0.3);
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 800) >= 4 || (hpFrac(ship) < 0.5 && fighting(ship, game, 5000));
      },
    },
  ),
  def(
    {
      id: 'lightningGrab',
      name: 'Lightning Grab',
      short: 'LIGHTNING',
      description: 'Grab a bolt from the sky and hurl it: it leaps through up to five enemies within 4 km, 60k and a 1.5 s stun each.',
      cooldown: 12,
      duration: 0,
      accent: 0xfff27a,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        return chainLightning(ship, game, st.spec, 5, 4000, 1500, 60000, 1.5).length > 0;
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 3800);
      },
    },
  ),
  def(
    {
      id: 'giantRubber',
      name: 'Giant Rubber Body',
      short: 'GIANT',
      description: 'Swell to giant size for 10 s: rams deal 90k, 30% faster, 30% less damage taken.',
      cooldown: 20,
      duration: 10,
      accent: 0xffd0a0,
      icon: 'ram',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.ram = Math.max(m.ram, 90000);
          m.ramSkill = st.spec;
          m.speedMul *= 1.3;
          m.damageTakenMul *= 0.7;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1500);
      },
    },
  ),
  def(
    {
      id: 'drumsOfLiberation',
      name: 'Drums of Liberation',
      short: 'DRUMS',
      description: 'The heartbeat of the Sun God reaches every ally within 2.5 km: 20% of their hull repaired, every debuff shaken off, and 20% more damage for 8 s.',
      cooldown: 24,
      duration: 0,
      accent: NIKA,
      icon: 'drums',
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 2500)) {
          s.heal(s.maxHp * 0.2);
          s.cleanse();
          buff(s, 'drumsOfLiberation', 8, (m) => {
            m.damageMul *= 1.2;
          });
        }
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 2500).some((s) => hpFrac(s) < 0.6);
      },
    },
  ),
  def(
    {
      id: 'bajrangGun',
      name: 'Gum-Gum Bajrang Gun',
      short: 'BAJRANG',
      description: 'A fist the size of an island falls on the reticle after 1.2 s: 260k across 650 m, and everything under it is driven away.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0xfff0d0,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5500);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 650, delay: 1.2, damage: 260000, knock: 200, look: 'anvil' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5300);
      },
    },
  ),
  def(
    {
      id: 'conquerorsHaki',
      name: 'Conqueror\'s Haki',
      short: 'HAKI',
      description: 'The will of a king rolls out 3 km: every enemy is stunned for 4 s, and enemy summons in range lose their nerve and vanish.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: HAKI,
      icon: 'fear',
    },
    {
      activate(ship, game, st) {
        const caught = enemiesWithin(ship, game, 3000, false);
        if (!caught.length) return false;
        for (const s of caught) {
          if (s.isSummon) s.takeDamage(s.maxHp * 2, ship, st.spec, false, true);
          else stun(s, 4);
        }
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 3000, delay: 0, damage: 0, speed: 1500, follow: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'kongOrgan',
      name: 'Gum-Gum Kong Organ',
      short: 'KONG ORGAN',
      description: 'Eight giant fists rain on the reticle over 4 s: 70k each across 350 m, every one with a shove.',
      ult: true,
      cooldown: 110,
      duration: 4,
      accent: RUBBER,
      icon: 'fist',
    },
    {
      activate(_s, _g, st) {
        st.data.n = 0;
      },
      update(ship, game, dt, st) {
        if ((st.data.n as number) >= 8 || !every(st, dt, 0.5)) return;
        st.data.n = (st.data.n as number) + 1;
        const p = aimPoint(ship, 5500);
        const x = p.x + (game.rng() - 0.5) * 200;
        const z = p.z + (game.rng() - 0.5) * 200;
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x, z, radius: 350, delay: 0.4, damage: 70000, knock: 150, look: 'anvil' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5000);
      },
    },
  ),

  // ------------------------------------------------------------------ Roronoa Zoro
  def(
    {
      id: 'phoenix36',
      name: '36 Pound Phoenix',
      short: '36 PHOENIX',
      description: 'A flying slash from all three swords: 55k to every hull on the line toward the reticle, out to 5 km.',
      cooldown: 12,
      duration: 0,
      accent: BLADE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 5000, 40, 55000);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'oniGiri',
      name: 'Oni Giri',
      short: 'ONI GIRI',
      description: 'Three swords in a cross: dash onto the enemy under the reticle (within 1.5 km) for 50k, a 1 s stun and a shove.',
      cooldown: 14,
      duration: 0,
      accent: BLADE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 1500);
        if (!t) return false;
        return dashStrike(ship, game, t, 50000, st.spec, 120, 1);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1400);
      },
    },
  ),
  shiftSkill({
    id: 'kingOfHell',
    name: 'King of Hell',
    short: 'KING OF HELL',
    description: 'Titan Shift: Enma drinks the Haki and the King of Hell stands up behind the swords. Nine blades, Asura, and Three Thousand Worlds.',
    accent: HELL,
  }),

  // ------------------------------------------------------------------ King of Hell
  def(
    {
      id: 'phoenix1080',
      name: '1080 Pound Phoenix',
      short: '1080 PHOENIX',
      description: 'Three flying slashes fanned toward the reticle, out to 5 km: 70k to every hull each one crosses.',
      cooldown: 10,
      duration: 0,
      accent: BLADE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        for (const off of [-0.12, 0, 0.12]) slash(ship, game, st.spec, 5000, 40, 70000, { offset: off });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'asura',
      name: 'Asura: Ichibugin',
      short: 'ASURA',
      description: 'Nine swords, three faces: flash through the three nearest enemies within 2.5 km, one every 0.35 s, 90k each.',
      cooldown: 12,
      duration: 1.2,
      accent: HELL,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 2500).slice(0, 3);
        return queueFlash(st, list, list.length);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.35, 90000, 0);
      },
      aiShouldUse(ship, game) {
        return enemiesAround(ship, game, ship.pos.x, ship.pos.z, 2400).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'dragonTwister',
      name: 'Dragon Twister',
      short: 'TWISTER',
      description: 'A tornado of blades at the reticle (within 5 km) for 5 s, 800 m across: it drags hulls in, cuts them for 15k a second and throws their aim off by half.',
      cooldown: 14,
      duration: 0,
      accent: 0xb0f0c0,
      icon: 'gale',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 800, life: 5, pull: 100, dps: 15000, scatter: 1.5, skill: st.spec, look: 'storm', color: 0xb0f0c0 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'blackBlade',
      name: 'Black Blade',
      short: 'BLACK BLADE',
      description: 'Haki hardens Enma black for 10 s: armour-piercing rounds hit 50% harder and you take a quarter less damage.',
      cooldown: 20,
      duration: 10,
      accent: 0x2a2a2a,
      icon: 'blade',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.apDamageMul *= 1.5;
          m.damageTakenMul *= 0.75;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'lost',
      name: 'Lost',
      short: 'LOST',
      description: 'Zoro gets lost. You turn up 1.5 km away in no particular direction, nothing can target you for 2 s, and Phoenix and Asura are ready again.',
      cooldown: 16,
      duration: 0,
      accent: 0x7adf6a,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const b = game.rng() * Math.PI * 2;
        blinkTo(ship, game, ship.pos.x + forwardX(b) * 1500, ship.pos.z + forwardZ(b) * 1500);
        buff(ship, 'lost', 2, (m) => {
          m.untargetable = true;
        });
        for (const k of ship.skills.slice(0, 2)) k.cooldown = 0;
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 5 || (hpFrac(ship) < 0.4 && fighting(ship, game, 3000));
      },
    },
  ),
  def(
    {
      id: 'sake',
      name: 'Sake',
      short: 'SAKE',
      description: 'A long pull from the gourd: repair 20%, and nothing can stun or hold you for 6 s.',
      cooldown: 24,
      duration: 6,
      accent: 0xe0c080,
      icon: 'heal',
    },
    {
      activate(ship, _g, st) {
        ship.heal(ship.maxHp * 0.2);
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.ccImmune = true;
        });
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.55;
      },
    },
  ),
  def(
    {
      id: 'threeThousandWorlds',
      name: 'Three Thousand Worlds',
      short: '3000 WORLDS',
      description: 'Nine swords turning like a wheel: a 200° cut out to 3 km, centred on the reticle, 200k to every hull it crosses.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: HELL,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 200, 3000, 200000, { charge: 0.5, time: 0.8, width: 90 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'purgatoryOnigiri',
      name: 'Purgatory Onigiri',
      short: 'PURGATORY',
      description: 'The King of Hell\'s Oni Giri: dash onto the enemy under the reticle (within 3 km) for 260k and a 3 s stun, and hurl it away.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: HELL,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        return dashStrike(ship, game, t, 260000, st.spec, 300, 3);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'kingsHakiCoat',
      name: 'King\'s Haki Coat',
      short: 'HAKI COAT',
      description: 'Conqueror\'s Haki on every blade for 12 s: 60% more damage, 30% of it repaired, and nothing can hold you.',
      ult: true,
      cooldown: 110,
      duration: 12,
      accent: HAKI,
      icon: 'blade',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.6;
          m.lifesteal += 0.3;
          m.ccImmune = true;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Trafalgar Law
  def(
    {
      id: 'room',
      name: 'Room',
      short: 'ROOM',
      description: 'A blue dome 1.5 km around you for 8 s: enemies inside are slowed to 80% and cannot hide.',
      cooldown: 18,
      duration: 8,
      accent: ROOM,
      icon: 'portal',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        operatingRoom(ship, game, 1500, st.spec.duration, 0.8, st.spec);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1400, false).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'shambles',
      name: 'Shambles',
      short: 'SHAMBLES',
      description: 'Trade places with the ship under the reticle (within 3 km, friend or foe); an enemy also takes 30k.',
      cooldown: 14,
      duration: 0,
      accent: ROOM,
      icon: 'swap',
    },
    {
      activate(ship, game, st) {
        const t = anyShipAt(ship, game, 3000);
        if (!t) return false;
        swapPlaces(ship, t, game);
        if (t.team !== ship.team) hurt(ship, t, 30000, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3000) && hpFrac(ship) < 0.5;
      },
    },
  ),
  shiftSkill({
    id: 'awakening',
    name: 'Ope Ope Awakening',
    short: 'AWAKENING',
    description: 'Titan Shift: the Op-Op Fruit awakens. The Polar Tang swells into a titan that never has to surface, its Room grows to 3 km, and Puncture Wille splits the sea.',
    accent: ROOM,
  }),

  // ------------------------------------------------------------------ Awakening
  def(
    {
      id: 'kRoom',
      name: 'K-Room',
      short: 'K-ROOM',
      description: 'An awakened Room 3 km around you for 10 s: enemies inside are slowed to 70% and cannot hide.',
      cooldown: 20,
      duration: 10,
      accent: ROOM,
      icon: 'portal',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        operatingRoom(ship, game, 3000, st.spec.duration, 0.7, st.spec);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800, false).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'shamblesAwakened',
      name: 'Shambles',
      short: 'SHAMBLES',
      description: 'Trade places with the ship under the reticle (within 5 km, friend or foe); an enemy is left stunned for 2 s.',
      cooldown: 10,
      duration: 0,
      accent: ROOM,
      icon: 'swap',
    },
    {
      activate(ship, game) {
        const t = anyShipAt(ship, game, 5000);
        if (!t) return false;
        swapPlaces(ship, t, game);
        if (t.team !== ship.team) stun(t, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5000) && !within(ship, target, 1500);
      },
    },
  ),
  def(
    {
      id: 'gammaKnife',
      name: 'Gamma Knife',
      short: 'GAMMA KNIFE',
      description: 'A blade that cuts from the inside: the enemy under the reticle (within 3 km) loses 4% of its hull a second for 6 s through every defence, and cannot repair.',
      cooldown: 16,
      duration: 0,
      accent: 0x7affc0,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        rot(ship, game, { x: t.pos.x, z: t.pos.z, r: 30, life: 6, follow: t, healBlock: true, skill: st.spec, look: 'nanite', color: 0x7affc0 }, 0.04, true);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'counterShock',
      name: 'Counter Shock',
      short: 'COUNTER SHOCK',
      description: 'A palm full of current on the enemy under the reticle (within 3 km): 60k and a 3 s stun.',
      cooldown: 12,
      duration: 0,
      accent: 0xffe060,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        boltTo(ship, game, t, 0xffe060);
        hurt(ship, t, 60000, st.spec);
        if (t.alive) stun(t, 3);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'takt',
      name: 'Takt',
      short: 'TAKT',
      description: 'Lift the enemy under the reticle (within 3 km) out of the sea and throw it 1.2 km along the reticle\'s bearing: 50k and a 1.5 s stun.',
      cooldown: 14,
      duration: 0,
      accent: ROOM,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        const b = bearingTo(ship.pos.x, ship.pos.z, ship.control.aimX, ship.control.aimZ);
        blinkTo(t, game, t.pos.x + forwardX(b) * 1200, t.pos.z + forwardZ(b) * 1200);
        hurt(ship, t, 50000, st.spec);
        if (t.alive) stun(t, 1.5);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'mes',
      name: 'Mes',
      short: 'MES',
      description: 'Take the heart of the enemy under the reticle (within 3 km) in a cube: it cannot fire or use a skill for 6 s.',
      cooldown: 18,
      duration: 0,
      accent: 0xff5a7a,
      icon: 'silence',
    },
    {
      activate(ship, game) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        disarm(t, 6);
        silence(t, 6);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'punctureWille',
      name: 'Puncture Wille',
      short: 'PUNCTURE',
      description: 'The awakened blade cuts the sea itself: after 0.6 s, 240k to every hull on the line toward the reticle out to 6 km, and each one is thrown aside.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: ROOM,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 6000, 80, 240000, { charge: 0.6, knock: 120 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'shockWille',
      name: 'Shock Wille',
      short: 'SHOCK WILLE',
      description: 'A shock straight through the enemy under the reticle (within 3 km), past every defence: a quarter of its hull (12% of a titan\'s) and a 4 s stun.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0xffe060,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        boltTo(ship, game, t, 0xffe060);
        hurtFrac(ship, t, t.spec.cls === 'TT' ? 0.12 : 0.25, st.spec, true);
        if (t.alive) stun(t, 4);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'amputate',
      name: 'Amputate',
      short: 'AMPUTATE',
      description: 'The Room cuts everything in it apart: every enemy within 3 km takes 100k, cannot fire for 6 s and is slowed to half.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: ROOM,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesWithin(ship, game, 3000);
        if (!list.length) return false;
        for (const s of list) {
          hurt(ship, s, 100000, st.spec);
          if (!s.alive) continue;
          disarm(s, 6);
          buff(s, 'debuff:amputate', 6, (m) => {
            m.speedMul *= 0.5;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),
];
