import type { Game } from '../../core/Game';
import { bearingTo, forwardX, forwardZ } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  blinkTo,
  boltTo,
  buff,
  chainLightning,
  enemiesOnLine,
  enemiesWithin,
  hpFrac,
  hurt,
  nearestEnemy,
  nextSalvo,
  silence,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { appearAt, arc, dashStrike, enemiesAround, every, fighting, hurryCooldowns, knockFrom, pack, rot, shiftSkill, victim } from './common';

// Jujutsu Kaisen: Satoru Gojo (battleship), Ryomen Sukuna (heavy cruiser) and Megumi Fushiguro.
// Gojo bends space (Red pushes, Blue pulls, Purple erases); Sukuna cuts it.
// Megumi Fushiguro (carrier) calls shikigami from the shadows, and Mahoraga last of all.

const RED = 0xff3048;
const BLUE = 0x3a7bff;
const PURPLE = 0xa040ff;
const SIX_EYES = 0x8fe0ff;
const CURSE = 0xd01a2a;
const SHADOW = 0x4a3a6a;
const THUNDER = 0x8ad0ff;
const WHEEL = 0xf0e0a0;

/** `n` Divine Dogs for `time` seconds that ram for 20k, hunting `prey` when there is one. */
function hunters(ship: Ship, game: Game, n: number, time: number, prey: Ship | null, skill: SkillSpec): void {
  for (const dog of pack(ship, game, 'divineDog', n, time, 'Divine Dog')) {
    buff(dog, 'fangs', time, (m) => {
      m.ram = Math.max(m.ram, 20000);
      m.ramSkill = skill;
    });
    const ai = game.ai.get(dog);
    if (ai && prey) ai.hunt = prey;
  }
}

export const JJK_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Satoru Gojo
  def(
    {
      id: 'reversalRed',
      name: 'Reversal: Red',
      short: 'RED',
      description: 'A point of repulsion bursts at the reticle (up to 5 km): 50k to every enemy within 350 m and a hard shove away.',
      cooldown: 14,
      duration: 0,
      accent: RED,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 350, delay: 0.4, damage: 50000, knock: 120 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'lapseBlue',
      name: 'Lapse: Blue',
      short: 'BLUE',
      description: 'A point of attraction opens at the reticle for 5 s: enemies within 700 m are dragged into its heart and crushed for 10k a second.',
      cooldown: 20,
      duration: 0,
      accent: BLUE,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 700, life: 5, pull: 70, dps: 10000, skill: st.spec, look: 'void', color: BLUE });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  shiftSkill({
    id: 'sixEyes',
    name: 'Six Eyes',
    short: 'SIX EYES',
    description: 'Titan Shift: the blindfold comes off and Gojo becomes the Honored One, a titan with Infinity, Maximum Red and Blue, and Hollow Purple.',
    accent: SIX_EYES,
  }),

  // ------------------------------------------------------------------ Gojo, the Honored One
  def(
    {
      id: 'maxRed',
      name: 'Maximum Output: Red',
      short: 'MAX RED',
      description: 'Red at full output on the reticle (up to 6 km): 120k to every enemy within 600 m, flung far away.',
      cooldown: 8,
      duration: 0,
      accent: RED,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 600, delay: 0.3, damage: 120000, knock: 220 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'maxBlue',
      name: 'Maximum Output: Blue',
      short: 'MAX BLUE',
      description: 'A vortex 1.1 km wide on the reticle for 6 s: enemies are dragged into it and crushed for 30k a second.',
      cooldown: 12,
      duration: 0,
      accent: BLUE,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 1100, life: 6, pull: 130, dps: 30000, skill: st.spec, look: 'void', color: BLUE });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'infinity',
      name: 'Infinity',
      short: 'INFINITY',
      description: 'For 6 s nothing reaches you: no damage, no stun, no silence. Only a cut that splits the world itself gets through.',
      cooldown: 16,
      duration: 6,
      accent: 0xe8f8ff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.invulnerable = true;
          m.ccImmune = true;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 800) >= 4 || (hpFrac(ship) < 0.5 && !!nearestEnemy(ship, game, 5000));
      },
    },
  ),
  def(
    {
      id: 'gojoBlink',
      name: 'Blink',
      short: 'BLINK',
      description: 'Teleport to the reticle, up to 3 km away. Every gun is reloaded when you arrive.',
      cooldown: 7,
      duration: 0,
      accent: SIX_EYES,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 3000);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        for (const t of ship.turrets) t.reload = 0;
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6500) && !within(ship, target, 3000);
      },
    },
  ),
  def(
    {
      id: 'blackFlash',
      name: 'Black Flash',
      short: 'BLACK FLASH',
      description: 'Cursed energy lands within a millionth of a second of the blow: the next salvo is loaded at once, groups twice as tight and hits 2.5 times as hard.',
      cooldown: 10,
      duration: 0,
      accent: 0xff2050,
      icon: 'fist',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, { damageMul: 2.5, dispersionMul: 0.5 });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85);
      },
    },
  ),
  def(
    {
      id: 'gojoRct',
      name: 'Reverse Cursed Technique',
      short: 'REVERSE',
      description: 'Positive energy rebuilds the hull: repair 25% at once and shake off every debuff.',
      cooldown: 22,
      duration: 0,
      accent: 0xbff4ff,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.25);
        ship.cleanse();
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'hollowPurple',
      name: 'Hollow Purple',
      short: 'PURPLE',
      description: 'Red and Blue collide into imaginary mass: after a 1 s charge it tears a 6 km line toward the reticle, 280k to every hull on it.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: PURPLE,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 1, time: 0.8, dps: 0, strike: 280000, length: 6000, width: 140, pierce: true, rate: 0, mx: ship.spec.length * 0.3 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'unlimitedVoid',
      name: 'Domain Expansion: Unlimited Void',
      short: 'UNLIMITED VOID',
      description: 'Every enemy within 3 km is drowned in infinite information: stunned and silenced for 6 s, taking 30% more damage.',
      ult: true,
      cooldown: 100,
      duration: 6,
      accent: 0x9ad8ff,
      icon: 'eye',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        const caught = enemiesWithin(ship, game, 3000, false);
        if (!caught.length) return false;
        for (const s of caught) {
          stun(s, 6);
          silence(s, 6);
          buff(s, 'debuff:void', 6, (m) => {
            m.damageTakenMul *= 1.3;
          });
          arc(game, ship, s, st.spec.accent, false);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'hollowPurple200',
      name: 'Hollow Purple: 200%',
      short: 'PURPLE 200%',
      description: 'Purple at twice the output, swept through a half circle centred on the reticle: 240k to every hull within 4.5 km of the arc.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xc070ff,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'sweep', skill: st.spec, charge: 0.8, time: 1.6, dps: 30000, strike: 240000, length: 4500, width: 120, pierce: true, arc: 180, mx: 0, my: ship.spec.freeboard + 16 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4300).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Ryomen Sukuna
  def(
    {
      id: 'dismantle',
      name: 'Dismantle',
      short: 'DIS\u00adMANTLE',
      description: 'Invisible slashes sweep a 90 degree arc toward the reticle: 40k to every hull within 3.5 km of it.',
      cooldown: 12,
      duration: 0,
      accent: CURSE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'sweep', skill: st.spec, charge: 0.3, time: 0.5, dps: 0, strike: 40000, length: 3500, width: 50, pierce: true, arc: 90, mx: 0 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3300);
      },
    },
  ),
  def(
    {
      id: 'cleave',
      name: 'Cleave',
      short: 'CLEAVE',
      description: 'A cut that adjusts to its target: the enemy under the reticle (within 4 km) takes 6% of its max HP plus 20k.',
      cooldown: 16,
      duration: 0,
      accent: 0xff4040,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        hurt(ship, t, t.maxHp * 0.06 + 20000, st.spec);
        arc(game, ship, t, st.spec.accent);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  shiftSkill({
    id: 'twentyFingers',
    name: 'Twenty Fingers',
    short: '20 FINGERS',
    description: 'Titan Shift: every finger consumed, the King of Curses takes his true form, with the Malevolent Shrine and a cut that splits the world.',
    accent: CURSE,
  }),

  // ------------------------------------------------------------------ King of Curses
  def(
    {
      id: 'maxDismantle',
      name: 'Dismantle: Barrage',
      short: 'DIS\u00adMANTLE',
      description: 'A storm of slashes through a 120 degree arc toward the reticle: 90k to every hull within 4.5 km of it.',
      cooldown: 8,
      duration: 0,
      accent: CURSE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'sweep', skill: st.spec, charge: 0.3, time: 0.6, dps: 0, strike: 90000, length: 4500, width: 70, pierce: true, arc: 120, mx: 0 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4300);
      },
    },
  ),
  def(
    {
      id: 'maxCleave',
      name: 'Cleave: Full',
      short: 'CLEAVE',
      description: 'The enemy under the reticle (within 5 km) takes 10% of its max HP plus 40k; every enemy within 400 m of it takes half.',
      cooldown: 11,
      duration: 0,
      accent: 0xff4040,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        const near = game.ships.filter((s) => s !== t && s.alive && s.team !== ship.team && Math.hypot(s.pos.x - t.pos.x, s.pos.z - t.pos.z) < 400);
        hurt(ship, t, t.maxHp * 0.1 + 40000, st.spec);
        arc(game, ship, t, st.spec.accent);
        for (const s of near) hurt(ship, s, s.maxHp * 0.05 + 20000, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'fugaArrow',
      name: 'Fuga',
      short: 'FUGA',
      description: 'Open: a flaming arrow drawn from the hand, loosed at the reticle: 90k in a 220 m blast that sets everything in it alight.',
      cooldown: 14,
      duration: 0,
      accent: 0xff8a20,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5500);
        const p = t ? t.pos : aimPoint(ship, 5500);
        game.missiles.launch(ship, p.x, p.z, 0, 90000, { profile: 'hyper', speed: 700, look: 'arrow', blast: 220, fire: 1, target: t, skill: st.spec, uninterceptable: true });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5300);
      },
    },
  ),
  def(
    {
      id: 'adaptation',
      name: 'Adaptation',
      short: 'ADAPT',
      description: 'For 10 s the wheel turns: each blow you take cuts damage taken by another 10%, down to half.',
      cooldown: 20,
      duration: 10,
      accent: 0xd8c070,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        st.data.hp = ship.hp;
        st.data.stacks = 0;
      },
      update(ship, _g, _dt, st) {
        const hp = st.data.hp as number;
        let n = st.data.stacks as number;
        // Hull lost since the last tick: one more turn of the wheel.
        if (ship.hp < hp - 1 && n < 5) n++;
        st.data.hp = ship.hp;
        st.data.stacks = n;
        const k = 1 - n * 0.1;
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageTakenMul *= k;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 800) >= 3;
      },
    },
  ),
  def(
    {
      id: 'sukunaRct',
      name: 'Reverse Cursed Technique',
      short: 'REVERSE',
      description: 'Regrow the hull: repair 25% at once and shake off every debuff.',
      cooldown: 20,
      duration: 0,
      accent: 0xffd0d0,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.25);
        ship.cleanse();
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'spiderweb',
      name: 'Spiderweb',
      short: 'SPIDER\u00adWEB',
      description: 'A web of cuts spreads 800 m around the reticle for 6 s: enemies in it slow to 40% and are cut for 20k a second.',
      cooldown: 16,
      duration: 0,
      accent: 0xff6070,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4500);
        game.fields.add(ship, { x: p.x, z: p.z, r: 800, life: 6, slow: 0.4, dps: 20000, skill: st.spec, look: 'hex', color: st.spec.accent });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4300);
      },
    },
  ),
  def(
    {
      id: 'worldSlash',
      name: 'World-Cutting Slash',
      short: 'WORLD CUT',
      description: 'A slash that cuts space itself, 6 km toward the reticle: 220k to every hull on the line, through every shield, guard, ward and Infinity.',
      ult: true,
      cooldown: 90,
      duration: 0.7,
      accent: 0xff1030,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        st.data.x = p.x;
        st.data.z = p.z;
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 0.5, time: 0.25, dps: 0, length: 6000, width: 30, pierce: true, rate: 0, mx: 0 });
      },
      update(ship, game, _dt, st) {
        if (st.data.cut || st.time > st.spec.duration - 0.5) return;
        st.data.cut = true;
        // The line runs the full 6 km from where the slash was drawn, land or no land.
        const x0 = ship.pos.x;
        const z0 = ship.pos.z;
        const b = bearingTo(x0, z0, st.data.x as number, st.data.z as number);
        const x1 = x0 + forwardX(b) * 6000;
        const z1 = z0 + forwardZ(b) * 6000;
        for (const s of enemiesOnLine(ship, game, x0, z0, x1, z1, 80)) hurt(ship, s, 220000, st.spec, true);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'malevolentShrine',
      name: 'Domain Expansion: Malevolent Shrine',
      short: 'SHRINE',
      description: 'For 10 s every enemy within 2.5 km is cut without pause: 4% of its max HP a second, and slowed to 85%.',
      ult: true,
      cooldown: 100,
      duration: 10,
      accent: 0xff2030,
      icon: 'skull',
      zone: 2500,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 2500,
          life: 10,
          follow: ship,
          slow: 0.85,
          skill: st.spec,
          look: 'fire',
          color: st.spec.accent,
          onTick: (s) => {
            if (s.team !== ship.team && s.alive) hurt(ship, s, s.maxHp * 0.01, st.spec);
          },
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'divineFlame',
      name: 'Divine Flame',
      short: 'DIVINE FLAME',
      description: 'Fuga at full strength: a pillar of fire falls on the reticle after 1.5 s, 240k across 800 m and every hull in it burning.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: 0xff7a10,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5500);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 800, delay: 1.5, damage: 240000, fire: 1, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5300);
      },
    },
  ),

  // ------------------------------------------------------------------ Megumi Fushiguro
  def(
    {
      id: 'divineDogs',
      name: 'Divine Dogs',
      short: 'DIVINE DOGS',
      description: 'Two shadow wolves rise from your shadow for 15 s and hunt the enemy under the reticle (within 6 km).',
      cooldown: 20,
      duration: 0,
      accent: SHADOW,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        hunters(ship, game, 2, 15, victim(ship, game, 6000), st.spec);
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'nue',
      name: 'Nue',
      short: 'NUE',
      description: 'The thunder-bird dives out of the sky onto the enemy under the reticle (within 4 km): 45k and a 2 s stun.',
      cooldown: 14,
      duration: 0,
      accent: THUNDER,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        game.missiles.launch(ship, t.pos.x, t.pos.z, 0, 45000, {
          profile: 'ballistic',
          speed: 700,
          look: 'bolt',
          blast: 80,
          target: t,
          skill: st.spec,
          uninterceptable: true,
          onHit: (s) => {
            stun(s, 2);
            boltTo(ship, game, s, THUNDER);
          },
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  shiftSkill({
    id: 'tenShadows',
    name: 'Ten Shadows: Mahoraga',
    short: 'MAHORAGA',
    description: 'Titan Shift: "With this treasure, I summon..." The carrier sinks into its own shadow and the strongest shikigami rises in its place: no planes, a wheel that adapts to everything, and the Sword of Extermination.',
    accent: WHEEL,
  }),

  // ------------------------------------------------------------------ Mahoraga
  def(
    {
      id: 'totality',
      name: 'Divine Dog: Totality',
      short: 'TOTALITY',
      description: 'Four shadow wolves for 20 s, every one hunting the enemy under the reticle (within 6 km).',
      cooldown: 18,
      duration: 0,
      accent: SHADOW,
      icon: 'beast',
    },
    {
      activate(ship, game, st) {
        hunters(ship, game, 4, 20, victim(ship, game, 6000), st.spec);
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'thunderclap',
      name: 'Thunderclap',
      short: 'THUNDER­CLAP',
      description: 'Nue\'s lightning leaps through five hulls, the first within 4 km: 50k and a 1.5 s stun on each.',
      cooldown: 12,
      duration: 0,
      accent: THUNDER,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        return chainLightning(ship, game, st.spec, 5, 4000, 1500, 50000, 1.5).length > 0;
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3900).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'wheelOfDharma',
      name: 'Wheel of Dharma',
      short: 'ADAPT',
      description: 'For 14 s, every 1.5 s spent under fire turns the wheel: 10% less damage taken and 10% more dealt per turn, up to five. From the third turn nothing can hold you.',
      cooldown: 22,
      duration: 14,
      accent: WHEEL,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        st.data.turns = 0;
        st.data.hp = ship.hp;
        st.data.t = 0;
      },
      update(ship, game, dt, st) {
        if (every(st, dt, 1.5)) {
          const hit = ship.hp < (st.data.hp as number) || underFire(ship, game, 900) > 0;
          if (hit) st.data.turns = Math.min(5, (st.data.turns as number) + 1);
          st.data.hp = ship.hp;
        }
        const n = st.data.turns as number;
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageTakenMul *= 1 - 0.1 * n;
          m.damageMul *= 1 + 0.1 * n;
          if (n >= 3) m.ccImmune = true;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  def(
    {
      id: 'swordOfExtermination',
      name: 'Sword of Extermination',
      short: 'EXTER\u00adMINATE',
      description: 'Lunge onto the enemy under the reticle (within 2 km) with the blade that undoes cursed things: 120k, doubled against summons and forms, a 1 s stun and a shove.',
      cooldown: 12,
      duration: 0,
      accent: 0xe8f0ff,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2000);
        if (!t) return false;
        const holy = t.isSummon || t.spec.cls === 'TT';
        return dashStrike(ship, game, t, holy ? 240000 : 120000, st.spec, 150, 1);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1900);
      },
    },
  ),
  def(
    {
      id: 'maxElephant',
      name: 'Max Elephant',
      short: 'ELEPHANT',
      description: 'A torrent crashes down on the reticle (within 5 km) across 900 m: 40k, a hard shove, and every hull caught is slowed to half for 5 s.',
      cooldown: 14,
      duration: 0,
      accent: 0x5ab0ff,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 900, delay: 0.4, damage: 40000, knock: 160, flood: 0.3, look: 'quake' });
        for (const s of enemiesAround(ship, game, p.x, p.z, 900)) {
          buff(s, 'debuff:elephant', 5, (m) => {
            m.speedMul *= 0.5;
          });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'rabbitEscape',
      name: 'Rabbit Escape',
      short: 'RABBITS',
      description: 'A flood of shadow rabbits: nothing can target you for 3 s, and you run 40% faster for 4 s.',
      cooldown: 18,
      duration: 4,
      accent: SHADOW,
      icon: 'cloak',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.4;
        });
        buff(ship, 'rabbitCover', 3, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.5 || underFire(ship, game, 900) >= 5;
      },
    },
  ),
  def(
    {
      id: 'chimeraShadowGarden',
      name: 'Chimera Shadow Garden',
      short: 'SHADOW GARDEN',
      description: 'Domain Expansion: a sea of shadow 2.5 km around you for 10 s. Enemies in it are slowed to 60%, cannot repair, and lose 1% of their hull a second; your skills come back three times as fast.',
      ult: true,
      cooldown: 90,
      duration: 10,
      accent: SHADOW,
      icon: 'portal',
    },
    {
      activate(ship, game, st) {
        rot(ship, game, { x: ship.pos.x, z: ship.pos.z, r: 2500, life: st.spec.duration, follow: ship, slow: 0.6, healBlock: true, skill: st.spec, look: 'void', color: SHADOW }, 0.01);
      },
      update(ship, _g, dt) {
        hurryCooldowns(ship, 2 * dt);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'eightHandledSword',
      name: 'Eight-Handled Sword',
      short: 'EIGHT-HANDLED',
      description: 'The sword that has adapted to everything: appear beside the enemy under the reticle (within 3 km) and cut through every defence for 280k.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0xe8f0ff,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t || !appearAt(ship, game, t, false)) return false;
        hurt(ship, t, 280000, st.spec, true);
        game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 2 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'rampage',
      name: 'Rampage',
      short: 'RAMPAGE',
      description: 'For 12 s Mahoraga stops adapting and starts hunting: 40% faster, nothing stops or moves it, rams strike for 120k, and every hull it touches is flung away.',
      ult: true,
      cooldown: 110,
      duration: 12,
      accent: WHEEL,
      icon: 'ram',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.4;
          m.unstoppable = true;
          m.knockImmune = true;
          m.ram = Math.max(m.ram, 120000);
          m.ramSkill = st.spec;
        });
      },
      update(ship, game, dt, st) {
        if (!every(st, dt, 0.25)) return;
        for (const s of enemiesWithin(ship, game, ship.spec.length * 0.6 + 60, false)) knockFrom(s, ship.pos.x, ship.pos.z, 220);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3000).length >= 1;
      },
    },
  ),
];
