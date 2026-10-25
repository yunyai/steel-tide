import type { Game } from '../../core/Game';
import { bearingTo } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import { aimPoint, alliesWithin, banish, blinkTo, buff, enemiesWithin, fear, hpFrac, hurt, silence, stun, swapPlaces, underFire, within } from '../kit';
import { def, type SkillDef } from '../types';
import { anyShipAt, clingTo, dashStrike, enemiesAround, every, fighting, hurtFrac, landNear, lineDash, pack, rot, shiftSkill, slash, spendHull, victim, volley } from './common';

// Naruto: Naruto Uzumaki (destroyer). Clones everywhere, Rasengan up close, and the Nine-Tails'
// chakra once the link is made. Sasuke Uchiha (heavy cruiser): lightning and black flames, then
// Perfect Susanoo. Itachi Uchiha (submarine): genjutsu from below, then a Susanoo on the surface.

const CHAKRA = 0xffa020;
const RASENGAN = 0x6ac8ff;
const LIGHTNING = 0x9ad8ff;
const SUSANOO = 0x9a5aff;
const BLACK_FLAME = 0x2a1030;
const SHARINGAN = 0xe0202a;
const CRIMSON = 0xd03040;
const CROW = 0x3a3a48;

/** `n` shadow clones fanned out behind the ship for `time` seconds. No cap: they pile up. */
function clones(ship: Ship, game: Game, n: number, time: number): void {
  pack(ship, game, 'narutoClone', n, time, `${ship.name} Clone`);
}

export const NARUTO_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Naruto Uzumaki
  def(
    {
      id: 'shadowClone',
      name: 'Shadow Clone Jutsu',
      short: 'CLONES',
      description: 'Two shadow clones of your destroyer join the fight for 20 s, guns, torpedoes and all.',
      cooldown: 24,
      duration: 0,
      accent: 0xffd040,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        clones(ship, game, 2, 20);
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'rasengan',
      name: 'Rasengan',
      short: 'RASENGAN',
      description: 'Dash onto the enemy under the reticle (within 1.5 km) and drive a spinning sphere into it: 45k, a 1 s stun and a hard shove.',
      cooldown: 14,
      duration: 0,
      accent: RASENGAN,
      icon: 'ram',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 1500);
        if (!t) return false;
        return dashStrike(ship, game, t, 45000, st.spec, 140, 1);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1400);
      },
    },
  ),
  shiftSkill({
    id: 'kuramaLink',
    name: 'Kurama Link',
    short: 'KURAMA',
    description: 'Titan Shift: Naruto and Kurama fight as one, a titan wreathed in the Nine-Tails\' chakra, with Rasenshuriken, Sage Mode and the Tailed Beast Bomb.',
    accent: CHAKRA,
  }),

  // ------------------------------------------------------------------ Nine-Tails Chakra Mode
  def(
    {
      id: 'multiShadowClone',
      name: 'Multi Shadow Clone Jutsu',
      short: 'MULTI CLONE',
      description: 'Five shadow clones flood the sea around you for 20 s.',
      cooldown: 20,
      duration: 0,
      accent: 0xffd040,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        clones(ship, game, 5, 20);
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'bigBallRasengan',
      name: 'Big Ball Rasengan',
      short: 'BIG BALL',
      description: 'Dash onto the enemy under the reticle (within 2.5 km): 110k, a 2 s stun, and it is flung far away.',
      cooldown: 10,
      duration: 0,
      accent: RASENGAN,
      icon: 'ram',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2500);
        if (!t) return false;
        return dashStrike(ship, game, t, 110000, st.spec, 220, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2400);
      },
    },
  ),
  def(
    {
      id: 'rasenshuriken',
      name: 'Rasenshuriken',
      short: 'RASEN\u00adSHURIKEN',
      description: 'A shuriken of wind blades thrown at the reticle: 70k in a 450 m burst, and every hull caught is shredded for 15k a second for 4 s.',
      cooldown: 12,
      duration: 0,
      accent: 0xbfeaff,
      icon: 'gale',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        const p = t ? t.pos : aimPoint(ship, 5000);
        game.missiles.launch(ship, p.x, p.z, 0, 70000, {
          profile: 'skim',
          speed: 520,
          look: 'star',
          blast: 450,
          target: t,
          skill: st.spec,
          uninterceptable: true,
          onHit: (s) => clingTo(ship, game, s, 15000, 4, st.spec),
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'sageMode',
      name: 'Sage Mode',
      short: 'SAGE',
      description: 'Natural energy for 10 s: guns reload twice as fast and you take 30% less damage.',
      cooldown: 20,
      duration: 10,
      accent: 0xff8a20,
      icon: 'eye',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.reloadMul *= 0.5;
          m.damageTakenMul *= 0.7;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  def(
    {
      id: 'chakraArms',
      name: 'Chakra Arms',
      short: 'CHAKRA ARMS',
      description: 'Chakra arms reach 3 km for the enemy under the reticle, drag it to your side and hold it: 40k and a 3 s stun.',
      cooldown: 14,
      duration: 0,
      accent: CHAKRA,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        const gap = (t.spec.length + ship.spec.length) * 0.3 + 80;
        landNear(t, game, ship.pos.x, ship.pos.z, gap, bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z));
        hurt(ship, t, 40000, st.spec);
        if (t.alive) stun(t, 3);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900) && !within(ship, target, 1200);
      },
    },
  ),
  def(
    {
      id: 'chakraShare',
      name: 'Chakra Share',
      short: 'SHARE',
      description: 'Kurama\'s chakra flows to every ally within 2.5 km: 20% of their hull repaired and 25% more damage for 8 s.',
      cooldown: 22,
      duration: 0,
      accent: CHAKRA,
      icon: 'heal',
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 2500)) {
          s.heal(s.maxHp * 0.2);
          buff(s, 'chakraShare', 8, (m) => {
            m.damageMul *= 1.25;
          });
        }
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 2500).some((s) => hpFrac(s) < 0.6) || (fighting(ship, game, 4000) && alliesWithin(ship, game, 2500).length >= 3);
      },
    },
  ),
  def(
    {
      id: 'tailedBeastBomb',
      name: 'Tailed Beast Bomb',
      short: 'BEAST BOMB',
      description: 'A sphere of compressed chakra hurled at the reticle: 260k across 500 m.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0x5a3cff,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 6000);
        const p = t ? t.pos : aimPoint(ship, 6000);
        game.missiles.launch(ship, p.x, p.z, 0.3, 260000, { profile: 'ballistic', speed: 600, look: 'star', blast: 500, target: t, skill: st.spec, uninterceptable: true, fire: 0.5 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'baryonMode',
      name: 'Baryon Mode',
      short: 'BARYON',
      description: 'Burn your own life force with Kurama\'s for 12 s: 50% more damage, half of all damage dealt repaired, 20% faster and immune to crowd control, at 1% of your hull a second.',
      ult: true,
      cooldown: 100,
      duration: 12,
      accent: 0xff5a90,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.5;
          m.lifesteal += 0.5;
          m.speedMul *= 1.2;
          m.ccImmune = true;
        });
      },
      update(ship, _g, dt) {
        spendHull(ship, 0.01 * dt);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1 && hpFrac(ship) > 0.35;
      },
    },
  ),
  def(
    {
      id: 'planetaryRasengan',
      name: 'Planetary Rasengan',
      short: 'PLANETARY',
      description: 'A Rasengan for each of up to six enemies within 5 km: 120k apiece and a 2 s stun.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: RASENGAN,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const targets = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000).slice(0, 6);
        if (!targets.length) return false;
        targets.forEach((t, i) => {
          game.missiles.launch(ship, t.pos.x, t.pos.z, i * 0.15, 120000, { profile: 'skim', speed: 600, look: 'star', blast: 120, target: t, skill: st.spec, uninterceptable: true, onHit: (s) => stun(s, 2) });
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Sasuke Uchiha
  def(
    {
      id: 'chidori',
      name: 'Chidori',
      short: 'CHIDORI',
      description: 'A thousand birds in one hand: dash 1.2 km toward the reticle, and every enemy on the way takes 50k and a 1.5 s stun.',
      cooldown: 12,
      duration: 0,
      accent: LIGHTNING,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        return lineDash(ship, game, 1200, 50000, st.spec, 1.5, 80);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1200);
      },
    },
  ),
  def(
    {
      id: 'blackFlames',
      name: 'Amaterasu',
      short: 'AMA\u00adTERASU',
      description: 'Black flames that never go out catch the enemy under the reticle (within 5 km): 6k a second for 8 s, and it cannot repair while they burn.',
      cooldown: 16,
      duration: 0,
      accent: BLACK_FLAME,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        clingTo(ship, game, t, 6000, 8, st.spec, { healBlock: true, look: 'fire', color: BLACK_FLAME });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  shiftSkill({
    id: 'eternalMangekyo',
    name: 'Eternal Mangekyō',
    short: 'SUSANOO',
    description: 'Titan Shift: both eyes awake, and a violet warrior of chakra stands up around the hull. Perfect Susanoo, with Indra\'s Arrow and Kirin.',
    accent: SUSANOO,
  }),

  // ------------------------------------------------------------------ Perfect Susanoo
  def(
    {
      id: 'chidoriSpear',
      name: 'Chidori Sharp Spear',
      short: 'SHARP SPEAR',
      description: 'The Chidori thrown as a lance of lightning: 90k to every hull on the line toward the reticle, out to 5 km.',
      cooldown: 10,
      duration: 0,
      accent: LIGHTNING,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 5000, 50, 90000);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'kagutsuchi',
      name: 'Enton: Kagutsuchi',
      short: 'KAGU\u00adTSUCHI',
      description: 'Shape the black flames into a blaze 700 m across at the reticle (within 5 km) for 6 s: 20k a second, and nothing in it can repair.',
      cooldown: 14,
      duration: 0,
      accent: BLACK_FLAME,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 700, life: 6, dps: 20000, healBlock: true, skill: st.spec, look: 'fire', color: BLACK_FLAME });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'susanooRibcage',
      name: 'Susanoo Ribcage',
      short: 'RIBCAGE',
      description: 'The Susanoo\'s ribs close around the hull: a shield worth a quarter of your hull for 8 s.',
      cooldown: 20,
      duration: 0,
      accent: SUSANOO,
      icon: 'shield',
    },
    {
      activate(ship) {
        ship.addShield(ship.maxHp * 0.25, 8);
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'amenotejikara',
      name: 'Amenotejikara',
      short: 'SWAP',
      description: 'The Rinnegan trades places: you and the ship under the reticle (within 5 km, friend or foe) swap in an instant.',
      cooldown: 12,
      duration: 0,
      accent: 0xb080ff,
      icon: 'swap',
    },
    {
      activate(ship, game) {
        const t = anyShipAt(ship, game, 5000);
        if (!t) return false;
        swapPlaces(ship, t, game);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5000) && !within(ship, target, 2000) && hpFrac(ship) > 0.5;
      },
    },
  ),
  def(
    {
      id: 'susanooArrow',
      name: 'Susanoo Arrow',
      short: 'ARROW',
      description: 'The Susanoo draws its bow: an arrow that nothing can shoot down hits the enemy under the reticle (within 7 km) for 110k.',
      cooldown: 10,
      duration: 0,
      accent: SUSANOO,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 7000);
        const p = t ? t.pos : aimPoint(ship, 7000);
        game.missiles.launch(ship, p.x, p.z, 0, 110000, { profile: 'hyper', speed: 1400, look: 'arrow', blast: 90, target: t, skill: st.spec, uninterceptable: true });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800);
      },
    },
  ),
  def(
    {
      id: 'sasukeGenjutsu',
      name: 'Genjutsu',
      short: 'GENJUTSU',
      description: 'One look from the Sharingan: the enemy under the reticle (within 4 km) is stunned and silenced for 3 s.',
      cooldown: 14,
      duration: 0,
      accent: SHARINGAN,
      icon: 'eye',
    },
    {
      activate(ship, game) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        stun(t, 3);
        silence(t, 3);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  def(
    {
      id: 'kirin',
      name: 'Kirin',
      short: 'KIRIN',
      description: 'A dragon of real lightning falls on the reticle after 1 s: 260k across 700 m and a 2 s stun.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: LIGHTNING,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 700, delay: 1, damage: 260000, stun: 2, look: 'plain' });
        game.events.emit('lightning', { points: [{ x: p.x, y: 1400, z: p.z }, { x: p.x + 40, y: 600, z: p.z - 30 }, { x: p.x, y: 0, z: p.z }], color: LIGHTNING });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'indrasArrow',
      name: 'Indra\'s Arrow',
      short: 'INDRA\'S ARROW',
      description: 'Every scrap of chakra in one arrow: after 1 s it crosses 7 km toward the reticle, 300k to every hull on the line.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: SUSANOO,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 7000, 120, 300000, { charge: 1, knock: 80 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6800);
      },
    },
  ),
  def(
    {
      id: 'amaterasuInferno',
      name: 'Amaterasu Inferno',
      short: 'INFERNO',
      description: 'Every enemy within 3 km catches the black flames: 2% of its hull a second for 8 s, and no repair while they burn.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: BLACK_FLAME,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const list = enemiesWithin(ship, game, 3000);
        if (!list.length) return false;
        for (const t of list) rot(ship, game, { x: t.pos.x, z: t.pos.z, r: 30, life: 8, follow: t, healBlock: true, skill: st.spec, look: 'fire', color: BLACK_FLAME }, 0.02);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Itachi Uchiha
  def(
    {
      id: 'crowClone',
      name: 'Crow Clone',
      short: 'CROWS',
      description: 'The hull bursts into crows: nothing can target you for 3 s, and you reappear up to 600 m toward the reticle.',
      cooldown: 16,
      duration: 0,
      accent: CROW,
      icon: 'cloak',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 600);
        blinkTo(ship, game, p.x, p.z);
        buff(ship, 'crowClone', 3, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'tsukuyomi',
      name: 'Tsukuyomi',
      short: 'TSUKUYOMI',
      description: 'Three days of torment in a single instant: the enemy under the reticle (within 3 km) is stunned for 3 s and silenced for 6 s.',
      cooldown: 18,
      duration: 0,
      accent: SHARINGAN,
      icon: 'eye',
    },
    {
      activate(ship, game) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        stun(t, 3);
        silence(t, 6);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  shiftSkill({
    id: 'mangekyoSharingan',
    name: 'Mangekyō Sharingan',
    short: 'SUSANOO',
    description: 'Titan Shift: the boat surfaces and a crimson Susanoo rises over it, the Yata Mirror on one arm and the Totsuka Blade in the other.',
    accent: CRIMSON,
  }),

  // ------------------------------------------------------------------ Susanoo, Yata Mirror
  def(
    {
      id: 'amaterasuGaze',
      name: 'Amaterasu Gaze',
      short: 'AMA\u00adTERASU',
      description: 'Black flames on the enemy under the reticle and the next nearest (within 5 km): 8k a second each for 8 s, and no repair while they burn.',
      cooldown: 12,
      duration: 0,
      accent: BLACK_FLAME,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        const other = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000).find((s) => s !== t);
        for (const s of other ? [t, other] : [t]) clingTo(ship, game, s, 8000, 8, st.spec, { healBlock: true, look: 'fire', color: BLACK_FLAME });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'tsukuyomi72',
      name: 'Tsukuyomi: 72 Hours',
      short: '72 HOURS',
      description: 'Seventy-two hours on the cross, in one blink: the enemy under the reticle (within 3 km) is stunned for 5 s and loses 15% of its hull.',
      cooldown: 16,
      duration: 0,
      accent: SHARINGAN,
      icon: 'eye',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        hurtFrac(ship, t, 0.15, st.spec);
        if (t.alive) stun(t, 5);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'yataMirror',
      name: 'Yata Mirror',
      short: 'YATA MIRROR',
      description: 'The mirror that takes every nature: for 8 s every skill aimed at you turns back on its caster, and the first three hits are blocked.',
      cooldown: 20,
      duration: 8,
      accent: 0xffd0a0,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.spellMirror = true;
        });
        ship.guard = { left: 3, min: 1500, until: game.time + st.spec.duration, skill: st.spec };
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 3 || fighting(ship, game, 3000);
      },
    },
  ),
  def(
    {
      id: 'crowGenjutsu',
      name: 'Crow Genjutsu',
      short: 'CROW GENJUTSU',
      description: 'A storm of crows and false images: every enemy within 2 km flees from you in terror for 3 s.',
      cooldown: 16,
      duration: 0,
      accent: CROW,
      icon: 'fear',
    },
    {
      activate(ship, game) {
        const list = enemiesWithin(ship, game, 2000);
        if (!list.length) return false;
        for (const s of list) fear(s, ship.pos.x, ship.pos.z, 3);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'greatFireball',
      name: 'Great Fireball',
      short: 'FIREBALL',
      description: 'Fire Style: a fireball the size of a hull lands on the reticle (within 5 km): 80k across 600 m, and most of what it hits is set alight.',
      cooldown: 10,
      duration: 0,
      accent: 0xff6a20,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'rocket', skill: st.spec, x: p.x, z: p.z, radius: 600, delay: 0.6, damage: 80000, fire: 0.8, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'izanagi',
      name: 'Izanagi',
      short: 'IZANAGI',
      description: 'Rewrite the last 5 s as a dream: the hull, its place and its skills go back to how they were, and every debuff is gone.',
      cooldown: 30,
      duration: 0,
      accent: SHARINGAN,
      icon: 'time',
    },
    {
      activate(ship) {
        return ship.rewind(5);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.4;
      },
    },
  ),
  def(
    {
      id: 'totsukaBlade',
      name: 'Totsuka Blade',
      short: 'TOTSUKA',
      description: 'The sealing sword finds the enemy under the reticle (within 3 km). A line ship loses 40% of its hull and is sealed away for 10 s; a titan or form loses 12% and is silenced for 6 s.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: CRIMSON,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        const titan = t.spec.cls === 'TT';
        hurtFrac(ship, t, titan ? 0.12 : 0.4, st.spec);
        if (!t.alive) return;
        if (titan) silence(t, 6);
        else banish(t, 10);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'yasakaMagatama',
      name: 'Yasaka Magatama',
      short: 'MAGATAMA',
      description: 'Nine magatama shared between up to three enemies within 5 km: 40k and a 1 s stun each.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: CRIMSON,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000).slice(0, 3);
        return volley(ship, game, list, 9, 40000, st.spec, { look: 'rune', stun: 1, speed: 800 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'izanami',
      name: 'Izanami',
      short: 'IZANAMI',
      description: 'The enemy under the reticle (within 3 km) is caught in a loop for 10 s: every 2 s it is thrown back to where it was 2 s before, and it cannot use a skill the whole time.',
      ult: true,
      cooldown: 110,
      duration: 10,
      accent: SHARINGAN,
      icon: 'time',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        silence(t, st.spec.duration);
        st.data.target = t.id;
      },
      update(_ship, game, dt, st) {
        if (!every(st, dt, 2)) return;
        const t = game.ships.find((s) => s.id === st.data.target);
        if (t?.alive) t.rewind(2, 'pose');
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
];
