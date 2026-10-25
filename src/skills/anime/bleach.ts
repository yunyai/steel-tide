import type { Game } from '../../core/Game';
import type { Ship } from '../../ships/Ship';
import { aimPoint, blinkTo, buff, disarm, enemiesWithin, fear, hpFrac, hurt, root, underFire, within } from '../kit';
import { def, type SkillDef } from '../types';
import { crescent, dashStrike, enemiesAround, fighting, flashThrough, pack, queueFlash, rot, shiftSkill, slash, victim } from './common';

// Bleach: Ichigo Kurosaki (battlecruiser), Byakuya Kuchiki (carrier) and Sōsuke Aizen (submarine).
// Getsuga crescents and Mugetsu; a thousand blades of cherry blossom; and a hypnosis that turns
// a whole fleet's guns into repair tools.

const GETSUGA = 0x6ab0ff;
const HOLLOW = 0x1a1a1a;
const SAKURA = 0xff9ac8;
const KIDO = 0xffe080;
const HOGYOKU = 0xb070ff;

/** Kyōka Suigetsu: for `time` s the ship's own shots repair whatever they hit. */
function hypnotise(s: Ship, time: number): void {
  buff(s, 'debuff:hypnosis', time, (m) => {
    m.inverted = true;
  });
}

/** Six Rods of Light: held and unable to fire. */
function rods(s: Ship, time: number): void {
  root(s, time);
  disarm(s, time);
}

/** A Black Coffin around `t`: nothing leaves it for `time` s, and it grinds for `dps`. */
function coffin(ship: Ship, game: Game, t: Ship, r: number, time: number, dps: number, skill: SkillDef['spec']): void {
  game.fields.add(ship, { x: t.pos.x, z: t.pos.z, r, life: time, cage: true, dps, skill, look: 'void', color: HOLLOW });
}

export const BLEACH_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Ichigo Kurosaki
  def(
    {
      id: 'getsuga',
      name: 'Getsuga Tenshō',
      short: 'GETSUGA',
      description: 'A crescent of reiatsu swung 60° across the reticle\'s bearing, out to 4 km: 55k to every hull it cuts.',
      cooldown: 12,
      duration: 0,
      accent: GETSUGA,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 60, 4000, 55000);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3800);
      },
    },
  ),
  def(
    {
      id: 'flashStep',
      name: 'Flash Step',
      short: 'FLASH STEP',
      description: 'Shunpo: appear up to 1.2 km toward the reticle, then run 30% faster for 4 s.',
      cooldown: 12,
      duration: 4,
      accent: 0xd8e8ff,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 1200);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.3;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 6000) && !within(ship, target, 3000);
      },
    },
  ),
  shiftSkill({
    id: 'tensaZangetsu',
    name: 'Bankai: Tensa Zangetsu',
    short: 'BANKAI',
    description: 'Titan Shift: Bankai, and then past it. Ichigo becomes Mugetsu itself, a hull of black reiatsu with the Final Getsuga Tenshō in hand.',
    accent: GETSUGA,
  }),

  // ------------------------------------------------------------------ Mugetsu
  def(
    {
      id: 'blackGetsuga',
      name: 'Black Getsuga',
      short: 'BLACK GETSUGA',
      description: 'A black crescent swung 120° across the reticle\'s bearing, out to 5 km: 100k to every hull it cuts.',
      cooldown: 10,
      duration: 0,
      accent: HOLLOW,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 120, 5000, 100000, { width: 80 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'shunpoStrike',
      name: 'Shunpo Strike',
      short: 'SHUNPO',
      description: 'Flash onto the enemy under the reticle (within 2.5 km): 90k, a 1 s stun and a shove.',
      cooldown: 10,
      duration: 0,
      accent: 0xd8e8ff,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2500);
        if (!t) return false;
        return dashStrike(ship, game, t, 90000, st.spec, 120, 1);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2400);
      },
    },
  ),
  def(
    {
      id: 'hollowMask',
      name: 'Hollow Mask',
      short: 'HOLLOW MASK',
      description: 'Pull the mask down for 10 s: 50% more damage, and the guns reload in 60% of the time.',
      cooldown: 20,
      duration: 10,
      accent: 0xf0f0f0,
      icon: 'skull',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.5;
          m.reloadMul *= 0.6;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'cero',
      name: 'Cero',
      short: 'CERO',
      description: 'A hollow\'s blast from the bow: after 0.6 s it crosses 6 km, 110k to every hull on the line; the bow swings toward the reticle.',
      cooldown: 12,
      duration: 0,
      accent: 0xff3040,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 0.6, time: 0.6, dps: 0, strike: 110000, length: 6000, width: 70, pierce: true, steer: 60, knock: 40 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'hierro',
      name: 'Hierro',
      short: 'HIERRO',
      description: 'Skin like steel: the next four heavy hits within 8 s do nothing.',
      cooldown: 18,
      duration: 0,
      accent: 0xc0c0c8,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        ship.guard = { left: 4, min: 2500, until: game.time + 8, skill: st.spec };
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 3;
      },
    },
  ),
  def(
    {
      id: 'highSpeedRegen',
      name: 'High-Speed Regeneration',
      short: 'REGEN',
      description: 'The hollow\'s gift: repair 25% at once and shake off every debuff.',
      cooldown: 24,
      duration: 0,
      accent: 0xf0f0f0,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.25);
        ship.cleanse();
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.5;
      },
    },
  ),
  def(
    {
      id: 'mugetsu',
      name: 'Mugetsu',
      short: 'MUGETSU',
      description: 'The Final Getsuga Tenshō: after 0.8 s a wall of darkness 2 km wide crosses 6 km toward the reticle, and every hull it passes takes 280k.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: HOLLOW,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 6000, 2000, 280000, { charge: 0.8 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'finalGetsuga',
      name: 'Final Getsuga Tenshō',
      short: 'FINAL GETSUGA',
      description: 'Everything in one swing from the bow: after 1 s a black beam 120 m wide crosses 8 km, 300k to every hull on the line.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: HOLLOW,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'bow', skill: st.spec, charge: 1, time: 1, dps: 0, strike: 300000, length: 8000, width: 120, pierce: true, steer: 60, knock: 80 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7800);
      },
    },
  ),
  def(
    {
      id: 'vastoLorde',
      name: 'Vasto Lorde',
      short: 'VASTO LORDE',
      description: 'The full hollow for 12 s: 70% more damage, 30% faster, 3% of the hull repaired a second, and nothing can hold you.',
      ult: true,
      cooldown: 110,
      duration: 12,
      accent: 0xf0f0f0,
      icon: 'skull',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.7;
          m.speedMul *= 1.3;
          m.ccImmune = true;
        });
      },
      update(ship, _g, dt) {
        ship.heal(ship.maxHp * 0.03 * dt);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Byakuya Kuchiki
  def(
    {
      id: 'scatterSenbonzakura',
      name: 'Senbonzakura: Scatter',
      short: 'SENBON­ZAKURA',
      description: 'Scatter: a swarm of blade petals settles on the enemy under the reticle (within 6 km) and everything 500 m around it, 15k a second for 6 s.',
      cooldown: 14,
      duration: 0,
      accent: SAKURA,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 6000);
        if (!t) return false;
        game.fields.add(ship, { x: t.pos.x, z: t.pos.z, r: 500, life: 6, follow: t, dps: 15000, skill: st.spec, look: 'swarm', color: SAKURA });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'sixRods',
      name: 'Six Rods of Light',
      short: 'SIX RODS',
      description: 'Bakudō 61: six bars of light pin the enemy under the reticle (within 4 km). It cannot move or fire for 4 s.',
      cooldown: 16,
      duration: 0,
      accent: KIDO,
      icon: 'root',
    },
    {
      activate(ship, game) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        rods(t, 4);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  shiftSkill({
    id: 'kageyoshi',
    name: 'Bankai: Senbonzakura Kageyoshi',
    short: 'KAGE\u00adYOSHI',
    description: 'Titan Shift: the blade sinks into the deck and a thousand rows of swords rise from the sea. The carrier swells, its petal wing doubles, and Senkei closes around it.',
    accent: SAKURA,
  }),

  // ------------------------------------------------------------------ Senbonzakura Kageyoshi
  def(
    {
      id: 'kageyoshiField',
      name: 'Kageyoshi',
      short: 'KAGE\u00adYOSHI',
      description: 'A storm of petals 900 m across at the reticle (within 6 km) for 8 s: 30k a second to every enemy in it.',
      cooldown: 12,
      duration: 0,
      accent: SAKURA,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 900, life: 8, dps: 30000, skill: st.spec, look: 'swarm', color: SAKURA });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'sixRodsMass',
      name: 'Six Rods of Light',
      short: 'SIX RODS',
      description: 'Bakudō 61 three times over: the three enemies nearest the reticle (within 4 km of it) cannot move or fire for 4 s.',
      cooldown: 14,
      duration: 0,
      accent: KIDO,
      icon: 'root',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 6000);
        const list = enemiesAround(ship, game, p.x, p.z, 4000).slice(0, 3);
        if (!list.length) return false;
        for (const s of list) rods(s, 4);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'gokei',
      name: 'Gōkei',
      short: 'GŌKEI',
      description: 'The petals close into a sphere around the enemy under the reticle (within 5 km): 400 m across for 5 s, 40k a second, and nothing inside can get out.',
      cooldown: 16,
      duration: 0,
      accent: SAKURA,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        game.fields.add(ship, { x: t.pos.x, z: t.pos.z, r: 400, life: 5, cage: true, dps: 40000, skill: st.spec, look: 'swarm', color: SAKURA });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'petalShield',
      name: 'Petal Shield',
      short: 'PETAL SHIELD',
      description: 'The petals gather into a wall: the next five heavy hits within 8 s do nothing.',
      cooldown: 18,
      duration: 0,
      accent: SAKURA,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        ship.guard = { left: 5, min: 2500, until: game.time + 8, skill: st.spec };
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 3;
      },
    },
  ),
  def(
    {
      id: 'raikoho',
      name: 'Raikōhō',
      short: 'RAIKŌHŌ',
      description: 'Hadō 63: a roaring bolt at the enemy under the reticle (within 5 km), 80k across 300 m.',
      cooldown: 10,
      duration: 0,
      accent: KIDO,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        const p = t ? t.pos : aimPoint(ship, 5000);
        game.missiles.launch(ship, p.x, p.z, 0, 80000, { profile: 'hyper', speed: 1800, look: 'bolt', blast: 300, target: t, skill: st.spec, uninterceptable: true });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'byakuyaDanku',
      name: 'Danku',
      short: 'DANKU',
      description: 'Bakudō 81: a wall that stops time for whatever enters it. For 6 s enemy shells, torpedoes and missiles within 800 m of you crawl at a fifth of their speed.',
      cooldown: 20,
      duration: 6,
      accent: KIDO,
      icon: 'wall',
      zone: 800,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 800, life: st.spec.duration, follow: ship, timeScale: 0.2, skill: st.spec, look: 'time', color: KIDO });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1200) >= 4;
      },
    },
  ),
  def(
    {
      id: 'senkei',
      name: 'Senkei',
      short: 'SENKEI',
      description: 'A thousand swords stand in a ring 1.2 km around you for 10 s: enemies inside cannot leave, and lose 4% of their hull a second.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: SAKURA,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        rot(ship, game, { x: ship.pos.x, z: ship.pos.z, r: 1200, life: 10, cage: true, skill: st.spec, look: 'swarm', color: SAKURA }, 0.04);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'shukei',
      name: 'Shūkei: Hakuteiken',
      short: 'HAKUTEIKEN',
      description: 'The blades become one white sword with wings: flash through the four nearest enemies within 4 km, one every 0.4 s, 200k each.',
      ult: true,
      cooldown: 100,
      duration: 1.8,
      accent: 0xffffff,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 4000).slice(0, 4);
        return queueFlash(st, list, list.length);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.4, 200000, 0);
      },
      aiShouldUse(ship, game) {
        return enemiesAround(ship, game, ship.pos.x, ship.pos.z, 3800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'ikkaSenjinka',
      name: 'Ikka Senjinka',
      short: 'SENJINKA',
      description: 'Every blade at once from every side: each enemy within 5 km takes 100k and cannot repair for 6 s.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: SAKURA,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesWithin(ship, game, 5000);
        if (!list.length) return false;
        for (const s of list) {
          hurt(ship, s, 100000, st.spec);
          buff(s, 'debuff:senjinka', 6, (m) => {
            m.healBlock = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Sōsuke Aizen
  def(
    {
      id: 'kyokaSuigetsu',
      name: 'Kyōka Suigetsu',
      short: 'KYŌKA SUIGETSU',
      description: 'Complete hypnosis: for 6 s every shot the enemy under the reticle (within 3 km) fires repairs whatever it hits.',
      cooldown: 18,
      duration: 0,
      accent: HOGYOKU,
      icon: 'eye',
    },
    {
      activate(ship, game) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        hypnotise(t, 6);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'kurohitsugi',
      name: 'Kurohitsugi',
      short: 'BLACK COFFIN',
      description: 'Hadō 90: a Black Coffin 300 m across closes on the enemy under the reticle (within 4 km) for 3 s, 80k in all, and nothing inside gets out.',
      cooldown: 14,
      duration: 0,
      accent: HOLLOW,
      icon: 'portal',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 4000);
        if (!t) return false;
        coffin(ship, game, t, 300, 3, 27000, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  shiftSkill({
    id: 'hogyokuFusion',
    name: 'Hōgyoku Fusion',
    short: 'HŌGYOKU',
    description: 'Titan Shift: the Hōgyoku answers. The boat breaks the surface as something past shinigami and hollow, wings spread, with Fragor and the full Black Coffin.',
    accent: HOGYOKU,
  }),

  // ------------------------------------------------------------------ Hōgyoku Aizen
  def(
    {
      id: 'completeHypnosis',
      name: 'Complete Hypnosis',
      short: 'HYPNOSIS',
      description: 'Every enemy within 2.5 km sees what you want: for 4 s their shots repair whatever they hit.',
      cooldown: 16,
      duration: 0,
      accent: HOGYOKU,
      icon: 'eye',
    },
    {
      activate(ship, game) {
        const list = enemiesWithin(ship, game, 2500);
        if (!list.length) return false;
        for (const s of list) hypnotise(s, 4);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'kurohitsugiFull',
      name: 'Full Incantation Kurohitsugi',
      short: 'FULL COFFIN',
      description: 'The Black Coffin with the full chant: 500 m across on the enemy under the reticle (within 5 km) for 4 s, 160k in all, and nothing inside gets out.',
      cooldown: 14,
      duration: 0,
      accent: HOLLOW,
      icon: 'portal',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        coffin(ship, game, t, 500, 4, 40000, st.spec);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'mirageFleet',
      name: 'Mirage Fleet',
      short: 'MIRAGES',
      description: 'Since when were you under the impression that was the real one? Three mirages of your hull sail with you for 15 s, and nothing can target you for 3 s.',
      cooldown: 22,
      duration: 0,
      accent: HOGYOKU,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        pack(ship, game, 'aizenMirage', 3, 15, 'Mirage', 220);
        buff(ship, 'mirageFleet', 3, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  def(
    {
      id: 'ittoKaso',
      name: 'Ittō Kasō',
      short: 'ITTŌ KASŌ',
      description: 'Hadō 96, paid for with an arm: a pillar of flame on the reticle (within 5 km) after 0.8 s, 120k across 700 m, and most of what it hits burns.',
      cooldown: 12,
      duration: 0,
      accent: 0xff7a20,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x, z: p.z, radius: 700, delay: 0.8, damage: 120000, fire: 0.8, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'hogyokuRegen',
      name: 'Hōgyoku Regeneration',
      short: 'REGEN\u00adERATE',
      description: 'The Hōgyoku will not let you fall: repair 20% at once, then 2% a second for 8 s.',
      cooldown: 22,
      duration: 8,
      accent: HOGYOKU,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.heal(ship.maxHp * 0.2);
      },
      update(ship, _g, dt) {
        ship.heal(ship.maxHp * 0.02 * dt);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.55;
      },
    },
  ),
  def(
    {
      id: 'aizenDanku',
      name: 'Danku',
      short: 'DANKU',
      description: 'Bakudō 81 without the incantation: the next six heavy hits within 8 s do nothing.',
      cooldown: 18,
      duration: 0,
      accent: KIDO,
      icon: 'wall',
    },
    {
      activate(ship, game, st) {
        ship.guard = { left: 6, min: 2500, until: game.time + 8, skill: st.spec };
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 3;
      },
    },
  ),
  def(
    {
      id: 'fragor',
      name: 'Fragor',
      short: 'FRAGOR',
      description: 'A storm of black reiatsu blades bursts on the reticle after 1 s: 260k across 1.2 km.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: HOGYOKU,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 1200, delay: 1, damage: 260000, look: 'rune' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
  def(
    {
      id: 'totalHypnosis',
      name: 'Total Hypnosis',
      short: 'TOTAL HYPNOSIS',
      description: 'Everyone who has ever seen the release is yours: every enemy within 4 km flees from you for 2 s, and for 6 s its shots repair whatever they hit.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: HOGYOKU,
      icon: 'eye',
    },
    {
      activate(ship, game) {
        const list = enemiesWithin(ship, game, 4000);
        if (!list.length) return false;
        for (const s of list) {
          hypnotise(s, 6);
          fear(s, ship.pos.x, ship.pos.z, 2);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'perfectBlackCoffin',
      name: 'Perfect Black Coffin',
      short: 'PERFECT COFFIN',
      description: 'A Black Coffin around every enemy within 2.5 km: for 3 s none of them can get out, and each loses 10% of its hull a second through every defence.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: HOLLOW,
      icon: 'portal',
    },
    {
      activate(ship, game, st) {
        const list = enemiesWithin(ship, game, 2500);
        if (!list.length) return false;
        for (const s of list) rot(ship, game, { x: s.pos.x, z: s.pos.z, r: s.spec.length * 0.5 + 80, life: 3, cage: true, skill: st.spec, look: 'void', color: HOLLOW }, 0.1, true);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 1;
      },
    },
  ),
];
