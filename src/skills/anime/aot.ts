import { forwardX, forwardZ } from '../../core/math';
import { aimPoint, alliesWithin, blinkTo, buff, disarm, enemiesWithin, hpFrac, hurt, mark, nextSalvo, root, silence, stun, underFire, within } from '../kit';
import { def, type SkillDef } from '../types';
import { appearAt, dashStrike, enemiesAround, fighting, flashThrough, knockFrom, landNear, pack, queueFlash, rot, shiftSkill, victim, volley } from './common';

// Attack on Titan: Eren Yeager (battleship), Armin Arlert (light cruiser) and Levi Ackerman
// (destroyer). Hardened fists and the Rumbling; steam and the Colossal Titan's blast; blades,
// thunder spears and humanity's strongest soldier.

const TITAN = 0xc8a080;
const BONE = 0xf0ead8;
const STEAM = 0xfff0e0;
const SPEAR = 0xffb040;
const BLADE = 0xd8e8f0;

/** How many Wall Titans march in the Rumbling, and for how long. */
const RUMBLING = { count: 8, time: 18, spacing: 170 };

export const AOT_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Eren Yeager
  def(
    {
      id: 'titanPunch',
      name: 'Titan Punch',
      short: 'TITAN PUNCH',
      description: 'The Attack Titan closes on the enemy under the reticle (within 1.2 km) and hits it: 50k and a hard shove.',
      cooldown: 12,
      duration: 0,
      accent: TITAN,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 1200);
        if (!t) return false;
        return dashStrike(ship, game, t, 50000, st.spec, 200);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1100);
      },
    },
  ),
  def(
    {
      id: 'hardening',
      name: 'Hardening',
      short: 'HARDENING',
      description: 'Crystal over the hull for 8 s: a shield worth a fifth of your hull, and nothing can shove you.',
      cooldown: 20,
      duration: 8,
      accent: 0xa0e0ff,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.addShield(ship.maxHp * 0.2, st.spec.duration);
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.knockImmune = true;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.6;
      },
    },
  ),
  shiftSkill({
    id: 'theCoordinate',
    name: 'The Coordinate',
    short: 'FOUNDER',
    description: 'Titan Shift: Eren reaches the Paths and takes the Founder\'s power. A titan of bone and ribs, the war hammer, and the Rumbling behind him.',
    accent: BONE,
  }),

  // ------------------------------------------------------------------ Founding Titan
  def(
    {
      id: 'warHammerSpikes',
      name: 'War Hammer Spikes',
      short: 'SPIKES',
      description: 'Six hardened spikes burst from the sea around the reticle (within 5 km): 40k each, and every enemy within 600 m of it is held for 2 s.',
      cooldown: 12,
      duration: 0,
      accent: 0xa0e0ff,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        for (let i = 0; i < 6; i++) {
          const b = (i / 6) * Math.PI * 2;
          game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: p.x + forwardX(b) * 300, z: p.z + forwardZ(b) * 300, radius: 250, delay: 0.3, damage: 40000, look: 'quake' });
        }
        for (const s of enemiesAround(ship, game, p.x, p.z, 600)) root(s, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'hardenedFist',
      name: 'Hardened Fist',
      short: 'HARDENED FIST',
      description: 'A crystal fist on the enemy under the reticle (within 2.5 km): 100k, a 1.5 s stun and a hard shove.',
      cooldown: 10,
      duration: 0,
      accent: 0xa0e0ff,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2500);
        if (!t) return false;
        return dashStrike(ship, game, t, 100000, st.spec, 180, 1.5);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2400);
      },
    },
  ),
  def(
    {
      id: 'coordinateScream',
      name: 'Coordinate Scream',
      short: 'SCREAM',
      description: 'A scream that every titan hears: a ring rolls out 2.5 km, 30k and a 2 s stun to every enemy it passes.',
      cooldown: 14,
      duration: 0,
      accent: BONE,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 2500, delay: 0, damage: 30000, stun: 2, speed: 1200, follow: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2300).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'titanRegen',
      name: 'Regeneration',
      short: 'REGEN\u00adERATE',
      description: 'Steam pours off the hull as it knits back together: 4% repaired a second for 8 s.',
      cooldown: 22,
      duration: 8,
      accent: STEAM,
      icon: 'heal',
    },
    {
      activate() {},
      update(ship, _g, dt) {
        ship.heal(ship.maxHp * 0.04 * dt);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'boneJavelins',
      name: 'Bone Javelins',
      short: 'JAVELINS',
      description: 'Five javelins of hardened bone, one at each of the five nearest enemies within 5 km: 40k apiece.',
      cooldown: 10,
      duration: 0,
      accent: BONE,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000).slice(0, 5);
        return volley(ship, game, list, list.length, 40000, st.spec, { look: 'spear' });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'paths',
      name: 'Paths',
      short: 'PATHS',
      description: 'Every Eldian is connected: each ally within 5 km is pulled through the Paths to your side and repaired 15%.',
      cooldown: 24,
      duration: 0,
      accent: 0x8ad8ff,
      icon: 'portal',
    },
    {
      activate(ship, game) {
        const list = alliesWithin(ship, game, 5000).filter((s) => s !== ship && !s.isSummon);
        if (!list.length) return false;
        list.forEach((s, i) => {
          landNear(s, game, ship.pos.x, ship.pos.z, (ship.spec.length + s.spec.length) * 0.4 + 120 + i * 60, ship.heading + Math.PI / 2 + i * 0.9);
          s.heal(s.maxHp * 0.15);
        });
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 5000).some((s) => s !== ship && !s.isSummon && hpFrac(s) < 0.4);
      },
    },
  ),
  def(
    {
      id: 'rumbling',
      name: 'The Rumbling',
      short: 'RUMBLING',
      description: 'The walls come down: eight Wall Titans rise abreast behind you and march along your heading for 18 s. Nothing stops them, nothing moves them, and whatever they walk into takes 60k.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: BONE,
      icon: 'fleet',
    },
    {
      activate(ship, game, st) {
        const { count, time, spacing } = RUMBLING;
        for (let i = 0; i < count; i++) {
          const w = game.spawnWingman(ship, (i - (count - 1) / 2) * spacing, time, -(ship.spec.length * 0.5 + 180), 'wallTitan', `Wall Titan ${i + 1}`);
          buff(w, 'rumbling', time, (m) => {
            m.unstoppable = true;
            m.knockImmune = true;
            m.ram = Math.max(m.ram, 60000);
            m.ramSkill = st.spec;
          });
          const ai = game.ai.get(w);
          if (ai) ai.march = ship.heading;
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 6000).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'foundersCommand',
      name: 'Founder\'s Command',
      short: 'COMMAND',
      description: 'An order through the Paths: every enemy within 4 km cannot fire or use a skill for 5 s.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0x8ad8ff,
      icon: 'silence',
    },
    {
      activate(ship, game) {
        const list = enemiesWithin(ship, game, 4000);
        if (!list.length) return false;
        for (const s of list) {
          disarm(s, 5);
          silence(s, 5);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 3800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'earthShatter',
      name: 'Earth Shatter',
      short: 'SHATTER',
      description: 'The Founder strikes the sea floor: a ring rolls out 3 km, 180k and an enormous shove to every enemy it passes.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: TITAN,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 3000, delay: 0, damage: 180000, knock: 300, hitsSubs: true, speed: 1000, follow: true, look: 'quake' });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ Armin Arlert
  def(
    {
      id: 'strategist',
      name: 'Strategist',
      short: 'STRATEGY',
      description: 'Armin reads the battle: the three nearest enemies within 6 km are marked for 10 s (25% more damage taken) and cannot hide.',
      cooldown: 16,
      duration: 0,
      accent: 0xffe080,
      icon: 'reveal',
    },
    {
      activate(ship, game) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 6000).slice(0, 3);
        if (!list.length) return false;
        for (const s of list) {
          mark(s, 10);
          buff(s, 'debuff:revealed', 10, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5800, false).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'steamBurst',
      name: 'Steam Burst',
      short: 'STEAM BURST',
      description: 'Vent the boilers all at once: a ring of steam 600 m out, 40k and a shove to every enemy in it.',
      cooldown: 12,
      duration: 0,
      accent: STEAM,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 600, delay: 0, damage: 40000, knock: 160, speed: 900, follow: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 550).length >= 1;
      },
    },
  ),
  shiftSkill({
    id: 'colossalTransformation',
    name: 'Colossal Transformation',
    short: 'COLOSSAL',
    description: 'Titan Shift: a flash, a blast, and a sixty-metre titan stands where the cruiser was. Steam, stomps, and the transformation blast itself.',
    accent: SPEAR,
  }),

  // ------------------------------------------------------------------ Colossal Titan
  def(
    {
      id: 'steamRelease',
      name: 'Steam Release',
      short: 'STEAM',
      description: 'Scalding steam pours off the body for 6 s: 25k a second to every enemy within 800 m, and they are pushed away from you.',
      cooldown: 14,
      duration: 0,
      accent: STEAM,
      icon: 'gale',
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, {
          x: ship.pos.x,
          z: ship.pos.z,
          r: 800,
          life: 6,
          follow: ship,
          dps: 25000,
          skill: st.spec,
          look: 'mist',
          color: STEAM,
          onTick: (s) => {
            if (s.team !== ship.team) knockFrom(s, ship.pos.x, ship.pos.z, 40);
          },
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 750).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'colossalStomp',
      name: 'Colossal Stomp',
      short: 'STOMP',
      description: 'A foot comes down on the sea: a ring rolls out 1 km, 90k and an enormous shove to every enemy it passes.',
      cooldown: 12,
      duration: 0,
      accent: TITAN,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1000, delay: 0, damage: 90000, knock: 260, speed: 900, follow: true, look: 'quake' });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 950).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'handSwat',
      name: 'Hand Swat',
      short: 'SWAT',
      description: 'A hand the size of a destroyer: the enemy under the reticle (within 1.5 km) takes 100k and is flung away.',
      cooldown: 10,
      duration: 0,
      accent: TITAN,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 1500);
        if (!t) return false;
        hurt(ship, t, 100000, st.spec);
        if (t.alive) knockFrom(t, ship.pos.x, ship.pos.z, 350);
        game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 1.6 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1400);
      },
    },
  ),
  def(
    {
      id: 'steamShield',
      name: 'Steam Shield',
      short: 'STEAM SHIELD',
      description: 'Burn so hot nothing can touch you for 8 s: 40% less damage taken, and fire cannot catch.',
      cooldown: 20,
      duration: 8,
      accent: STEAM,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        ship.extinguish();
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.6;
          m.fireImmune = true;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'rubbleThrow',
      name: 'Rubble Throw',
      short: 'RUBBLE',
      description: 'A handful of wall thrown at the reticle (within 5 km): five chunks scattered around it, 40k each across 200 m.',
      cooldown: 10,
      duration: 0,
      accent: TITAN,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        for (let i = 0; i < 5; i++) {
          const b = game.rng() * Math.PI * 2;
          const r = game.rng() * 350;
          game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: p.x + forwardX(b) * r, z: p.z + forwardZ(b) * r, radius: 200, delay: 0.8 + i * 0.12, damage: 40000, look: 'meteor' });
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'burnOff',
      name: 'Burn Off',
      short: 'BURN OFF',
      description: 'Burn away whatever is clinging on: shake off every debuff and repair 15%.',
      cooldown: 22,
      duration: 0,
      accent: STEAM,
      icon: 'heal',
    },
    {
      activate(ship) {
        ship.cleanse();
        ship.heal(ship.maxHp * 0.15);
      },
      aiShouldUse(ship) {
        return hpFrac(ship) < 0.55;
      },
    },
  ),
  def(
    {
      id: 'transformationBlast',
      name: 'Transformation Blast',
      short: 'BLAST',
      description: 'Do it again, on purpose: after 1 s the transformation goes off where you stand, 280k across 1.5 km, and everything in it burns. You take none of it.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: SPEAR,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 1500, delay: 1, damage: 280000, fire: 1, knock: 150, look: 'fireball' });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1300).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'seaOfSteam',
      name: 'Sea of Steam',
      short: 'SEA OF STEAM',
      description: 'The whole sea boils for 10 s, 3 km around you: enemies in it lose 2% of their hull a second, their aim is twice as wide, and they are slowed to 70%.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: STEAM,
      icon: 'gale',
    },
    {
      activate(ship, game, st) {
        rot(ship, game, { x: ship.pos.x, z: ship.pos.z, r: 3000, life: 10, follow: ship, scatter: 2, slow: 0.7, skill: st.spec, look: 'mist', color: STEAM }, 0.02);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'armThunderSpears',
      name: 'Thunder Spears',
      short: 'THUNDER SPEARS',
      description: 'The Scout Regiment fires from the shoulders: twelve thunder spears shared between up to four enemies within 5 km, 30k and a 2 s stun each.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: SPEAR,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000).slice(0, 4);
        return volley(ship, game, list, 12, 30000, st.spec, { look: 'spear', stun: 2 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Levi Ackerman
  def(
    {
      id: 'odmSpin',
      name: 'ODM Spin',
      short: 'ODM SPIN',
      description: 'Grapple onto the enemy under the reticle (within 2 km) and spin down its length: three cuts in 1 s, 18k and a short stun each.',
      cooldown: 12,
      duration: 1,
      accent: BLADE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 2000);
        if (!t || !appearAt(ship, game, t, false)) return false;
        return queueFlash(st, [t], 3);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.33, 18000, 0.4);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 1900);
      },
    },
  ),
  def(
    {
      id: 'thunderSpear',
      name: 'Thunder Spear',
      short: 'THUNDER SPEAR',
      description: 'A spear with a charge in the head at the enemy under the reticle (within 5 km): 50k and a 2 s stun.',
      cooldown: 15,
      duration: 0,
      accent: SPEAR,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        return volley(ship, game, [t], 1, 50000, st.spec, { look: 'spear', stun: 2, blast: 80 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  shiftSkill({
    id: 'ackermanAwakening',
    name: 'Ackerman Awakening',
    short: 'AWAKENING',
    description: 'Titan Shift: something in the blood wakes up. Humanity\'s strongest soldier, at a titan\'s size and still as fast as a destroyer, with Squad Levi behind him.',
    accent: BLADE,
  }),

  // ------------------------------------------------------------------ Humanity's Strongest
  def(
    {
      id: 'spinningSlash',
      name: 'Spinning Slash',
      short: 'SPIN SLASH',
      description: 'Flash from enemy to enemy through the four nearest within 2.5 km, one every 0.3 s: 70k each.',
      cooldown: 10,
      duration: 1.3,
      accent: BLADE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 2500).slice(0, 4);
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
      id: 'spearVolley',
      name: 'Spear Volley',
      short: 'SPEAR VOLLEY',
      description: 'Four thunder spears at the enemy under the reticle (within 5 km): 45k and a 2 s stun each.',
      cooldown: 12,
      duration: 0,
      accent: SPEAR,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        return volley(ship, game, [t], 4, 45000, st.spec, { look: 'spear', stun: 2, blast: 80 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'grapple',
      name: 'Grapple',
      short: 'GRAPPLE',
      description: 'Fire the anchors and reel in: appear up to 2 km toward the reticle, and nothing can target you for 1.5 s.',
      cooldown: 10,
      duration: 0,
      accent: BLADE,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 2000);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        buff(ship, 'grapple', 1.5, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5000) && !within(ship, target, 2500);
      },
    },
  ),
  def(
    {
      id: 'bladeSwap',
      name: 'Blade Swap',
      short: 'BLADE SWAP',
      description: 'Fresh blades, fresh gas: guns and torpedo tubes reload at once, and the next salvo hits 50% harder.',
      cooldown: 16,
      duration: 0,
      accent: BLADE,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        for (const tr of ship.turrets) tr.reload = 0;
        for (const l of ship.launchers) l.reload = 0;
        nextSalvo(ship, st.spec, { damageMul: 1.5 });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'cleanSweep',
      name: 'Clean Sweep',
      short: 'CLEAN SWEEP',
      description: 'A spotless hull, as it should be: shake off every debuff and repair 20%.',
      cooldown: 22,
      duration: 0,
      accent: 0xf0f0f0,
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
      id: 'squadLevi',
      name: 'Squad Levi',
      short: 'SQUAD LEVI',
      description: 'The Special Operations Squad: two of Levi\'s own destroyers fall in beside you for 20 s.',
      cooldown: 24,
      duration: 0,
      accent: 0x4a7a4a,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        pack(ship, game, 'levi', 2, 20, 'Squad Levi');
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'beastTitanTakedown',
      name: 'Beast Titan Takedown',
      short: 'TAKEDOWN',
      description: 'The enemy under the reticle (within 3 km) is stunned for 4 s and cut to pieces: twelve cuts in 2 s, 300k in all.',
      ult: true,
      cooldown: 90,
      duration: 2.2,
      accent: BLADE,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        stun(t, 4);
        return queueFlash(st, [t], 12);
      },
      update(ship, game, dt, st) {
        flashThrough(ship, game, st, dt, 0.17, 25000, 0);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'humanitysStrongest',
      name: 'Humanity\'s Strongest',
      short: 'STRONGEST',
      description: 'For 12 s: half again as fast, half of all hits miss, and 50% more damage.',
      ult: true,
      cooldown: 100,
      duration: 12,
      accent: BLADE,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.5;
          m.dodge = Math.max(m.dodge, 0.5);
          m.damageMul *= 1.5;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'spearBarrage',
      name: 'Spear Barrage',
      short: 'SPEAR BARRAGE',
      description: 'Twenty-four thunder spears shared between every enemy within 5 km: 15k and a 1 s stun each.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: SPEAR,
      icon: 'missile',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 5000);
        return volley(ship, game, list, 24, 15000, st.spec, { look: 'spear', stun: 1, spread: 0.05 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4800).length >= 2;
      },
    },
  ),
];
