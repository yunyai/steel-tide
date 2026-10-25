import type { Game } from '../../core/Game';
import { bearingTo, forwardX, forwardZ } from '../../core/math';
import type { SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { aimPoint, alliesWithin, blinkTo, buff, dispel, enemiesWithin, hpFrac, hurt, nextSalvo, root, underFire, within } from '../kit';
import { def, type SkillDef } from '../types';
import { appearAt, crescent, dashStrike, enemiesAround, fighting, hurryCooldowns, knockFrom, landNear, shiftSkill, slash, victim, volley } from './common';

// My Hero Academia: Izuku Midoriya (destroyer), All Might (battleship) and Katsuki Bakugo (light
// cruiser). One For All at a hundred percent and the quirks of the users before him; the Symbol
// of Peace in his prime; and explosions, a great many of them.

const OFA = 0x5aff8a;
const MIGHT = 0x2a5ad8;
const GOLD = 0xffd040;
const BLAST = 0xff8a20;

/** `n` bomblets scattered within 350 m of (x, z): `damage` across 120 m each, and some fires. */
function clusterAt(ship: Ship, game: Game, skill: SkillSpec, x: number, z: number, n: number, damage: number): void {
  for (let i = 0; i < n; i++) {
    const b = game.rng() * Math.PI * 2;
    const r = game.rng() * 350;
    game.strikes.spawn(ship, { kind: 'cluster', skill, x: x + forwardX(b) * r, z: z + forwardZ(b) * r, radius: 120, delay: 0.4 + game.rng() * 0.5, damage, fire: 0.3 });
  }
}

export const MHA_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Izuku Midoriya
  def(
    {
      id: 'delawareSmash',
      name: 'Delaware Smash',
      short: 'DELAWARE',
      description: 'A finger flicked at the enemy under the reticle (within 5 km): a blast of air that skims the sea, 45k and a shove.',
      cooldown: 12,
      duration: 0,
      accent: OFA,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 5000);
        if (!t) return false;
        return volley(ship, game, [t], 1, 45000, st.spec, { look: 'bolt', speed: 1000, blast: 120, onHit: (s) => knockFrom(s, ship.pos.x, ship.pos.z, 180) });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'fullCowl',
      name: 'Full Cowl 8%',
      short: 'FULL COWL',
      description: 'Power through every fibre: for 8 s, 40% faster and a quarter of the hits aimed at you miss.',
      cooldown: 18,
      duration: 8,
      accent: OFA,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.4;
          m.dodge = Math.max(m.dodge, 0.25);
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  shiftSkill({
    id: 'oneForAll',
    name: 'One For All',
    short: 'ONE FOR ALL',
    description: 'Titan Shift: a hundred percent, and the hull holds. Green lightning over every plate, and the quirks of seven users before him.',
    accent: OFA,
  }),

  // ------------------------------------------------------------------ One For All 100%
  def(
    {
      id: 'detroitSmash',
      name: 'Detroit Smash',
      short: 'DETROIT',
      description: 'A punch that moves the weather: a 60° cone toward the reticle, out to 1.2 km. 110k and an enormous shove to every hull in it.',
      cooldown: 10,
      duration: 0,
      accent: OFA,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 60, 1200, 110000, { width: 140, time: 0.3, knock: 300 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1100).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'blackwhip',
      name: 'Blackwhip',
      short: 'BLACK\u00adWHIP',
      description: 'Black tendrils reel the enemy under the reticle (within 3 km) in beside you: 40k, and held there for 2 s.',
      cooldown: 12,
      duration: 0,
      accent: 0x2a2a2a,
      icon: 'magnet',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        const gap = (t.spec.length + ship.spec.length) * 0.35 + 100;
        if (!landNear(t, game, ship.pos.x, ship.pos.z, gap, bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z))) return false;
        hurt(ship, t, 40000, st.spec);
        if (t.alive) root(t, 2);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900) && !within(ship, target, 1000);
      },
    },
  ),
  def(
    {
      id: 'dangerSense',
      name: 'Danger Sense',
      short: 'DANGER SENSE',
      description: 'A prickle at the back of the neck: for 8 s, half of all hits miss, and every enemy within 4 km cannot hide.',
      cooldown: 18,
      duration: 8,
      accent: 0xffe080,
      icon: 'reveal',
    },
    {
      activate(ship, game, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.dodge = Math.max(m.dodge, 0.5);
        });
        for (const s of enemiesWithin(ship, game, 4000, false)) {
          buff(s, 'debuff:revealed', st.spec.duration, (m) => {
            m.revealed = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 900) >= 4 || hpFrac(ship) < 0.6;
      },
    },
  ),
  def(
    {
      id: 'float',
      name: 'Float',
      short: 'FLOAT',
      description: 'Nana Shimura\'s quirk: lift clear of the water for 8 s. Torpedoes pass beneath, and you move 40% faster.',
      cooldown: 18,
      duration: 8,
      accent: 0xd0e8ff,
      icon: 'gale',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.torpImmune = true;
          m.speedMul *= 1.4;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'faJin',
      name: 'Fa Jin',
      short: 'FA JIN',
      description: 'Stored kinetic energy let go at once: the guns reload now, and the next salvo hits two and a half times as hard.',
      cooldown: 16,
      duration: 0,
      accent: 0x8ad8ff,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        for (const tr of ship.turrets) tr.reload = 0;
        nextSalvo(ship, st.spec, { damageMul: 2.5 });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 6000);
      },
    },
  ),
  def(
    {
      id: 'gearshift',
      name: 'Gearshift',
      short: 'GEARSHIFT',
      description: 'Shift up: every other skill comes back 6 s sooner, and you move 50% faster for 6 s.',
      cooldown: 18,
      duration: 6,
      accent: 0xb0ff60,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        hurryCooldowns(ship, 6);
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.5;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 5000);
      },
    },
  ),
  def(
    {
      id: 'delawareDetroit',
      name: '1,000,000% Delaware Detroit Smash',
      short: 'MILLION SMASH',
      description: 'Everything One For All has: a column of force 8 km long and 200 m wide toward the reticle. 280k to every hull in it, through every defence.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: OFA,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 8000, 200, 280000, { charge: 0.8, knock: 200 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 7800);
      },
    },
  ),
  def(
    {
      id: 'blackwhipNet',
      name: 'Blackwhip Net',
      short: 'WHIP NET',
      description: 'Blackwhip in every direction: every enemy within 3 km takes 40k and is held for 4 s.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: 0x2a2a2a,
      icon: 'root',
    },
    {
      activate(ship, game, st) {
        const list = enemiesWithin(ship, game, 3000);
        if (!list.length) return false;
        for (const s of list) {
          hurt(ship, s, 40000, st.spec);
          if (s.alive) root(s, 4);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'nineQuirks',
      name: 'Nine Quirks',
      short: 'NINE QUIRKS',
      description: 'Every user\'s quirk at once, for 12 s: skills come back more than three times as fast, and 40% more damage.',
      ult: true,
      cooldown: 110,
      duration: 12,
      accent: OFA,
      icon: 'lightning',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.cooldownMul *= 0.3;
          m.damageMul *= 1.4;
        });
      },
      update(ship, _g, dt) {
        hurryCooldowns(ship, 2.3 * dt);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ All Might
  def(
    {
      id: 'texasSmash',
      name: 'Texas Smash',
      short: 'TEXAS',
      description: 'A straight right that turns the air into a hammer: a 60° cone toward the reticle, out to 900 m, 50k and a shove.',
      cooldown: 12,
      duration: 0,
      accent: MIGHT,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 60, 900, 50000, { width: 120, time: 0.3, knock: 160 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 850).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'iAmHere',
      name: 'I Am Here!',
      short: 'I AM HERE',
      description: 'Why? Because I am here: appear beside the most damaged ally within 5 km and give it a shield worth a fifth of its hull for 8 s.',
      cooldown: 20,
      duration: 0,
      accent: GOLD,
      icon: 'shield',
    },
    {
      activate(ship, game) {
        let t: Ship | null = null;
        for (const s of alliesWithin(ship, game, 5000)) if (s !== ship && (!t || hpFrac(s) < hpFrac(t))) t = s;
        if (!t || !appearAt(ship, game, t, false)) return false;
        t.addShield(t.maxHp * 0.2, 8);
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 5000).some((s) => s !== ship && hpFrac(s) < 0.4);
      },
    },
  ),
  shiftSkill({
    id: 'plusUltra',
    name: 'Plus Ultra',
    short: 'PLUS ULTRA',
    description: 'Titan Shift: the Symbol of Peace in his prime, before the wound. Smashes that change the weather, and a smile for everyone watching.',
    accent: GOLD,
  }),

  // ------------------------------------------------------------------ Prime All Might
  def(
    {
      id: 'primeDetroit',
      name: 'Detroit Smash',
      short: 'DETROIT',
      description: 'The punch that made his name: a 60° cone toward the reticle, out to 2 km, 120k and an enormous shove to every hull in it.',
      cooldown: 10,
      duration: 0,
      accent: MIGHT,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        crescent(ship, game, st.spec, 60, 2000, 120000, { width: 180, time: 0.35, knock: 300 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1900).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'carolinaSmash',
      name: 'Carolina Smash',
      short: 'CAROLINA',
      description: 'A flying cross-chop onto the enemy under the reticle (within 2.5 km): 100k, a 1.5 s stun and a shove.',
      cooldown: 12,
      duration: 0,
      accent: MIGHT,
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
      id: 'symbolOfPeace',
      name: 'Symbol of Peace',
      short: 'SYMBOL',
      description: 'Everyone fights better with him there: for 10 s, every ally within 3 km deals 25% more damage and takes 20% less.',
      cooldown: 20,
      duration: 0,
      accent: GOLD,
      icon: 'shield',
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 3000)) {
          buff(s, 'symbolOfPeace', 10, (m) => {
            m.damageMul *= 1.25;
            m.damageTakenMul *= 0.8;
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
      id: 'oklahomaSmash',
      name: 'Oklahoma Smash',
      short: 'OKLAHOMA',
      description: 'Spin so hard the air explodes: a ring 700 m out, 80k and a shove to every enemy in it, and every enemy field it touches is blown away.',
      cooldown: 12,
      duration: 0,
      accent: MIGHT,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 700, delay: 0, damage: 80000, knock: 180, speed: 1000, follow: true });
        dispel(ship, game, ship.pos.x, ship.pos.z, 700);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 650).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'newHampshireSmash',
      name: 'New Hampshire Smash',
      short: 'N.H. SMASH',
      description: 'Punch the air behind you and ride the blast: appear up to 2 km toward the reticle, and the landing hits every enemy within 500 m for 60k.',
      cooldown: 12,
      duration: 0,
      accent: MIGHT,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 2000);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 500, delay: 0, damage: 60000, knock: 120, speed: 900 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4000) && !within(ship, target, 1500);
      },
    },
  ),
  def(
    {
      id: 'nothingsFine',
      name: 'Nothing\'s Fine',
      short: 'SMILE',
      description: 'Smile, because it is not fine: repair 25%, and for 6 s nothing can stun, root, silence or scare you.',
      cooldown: 22,
      duration: 6,
      accent: GOLD,
      icon: 'heal',
    },
    {
      activate(ship, _g, st) {
        ship.cleanse();
        ship.heal(ship.maxHp * 0.25);
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
      id: 'unitedStatesOfSmash',
      name: 'United States of Smash',
      short: 'U.S. SMASH',
      description: 'The last punch: appear beside the enemy under the reticle (within 3 km) and bring it down. 320k across 900 m and an enormous shove.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: GOLD,
      icon: 'fist',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        appearAt(ship, game, t, false);
        game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x: t.pos.x, z: t.pos.z, radius: 900, delay: 0.3, damage: 320000, knock: 300, look: 'quake' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'millionPercent',
      name: '1,000,000%',
      short: '1,000,000%',
      description: 'More than everything: for 12 s, 80% more damage, nothing can move you, and whatever you ram takes 80k.',
      ult: true,
      cooldown: 100,
      duration: 12,
      accent: GOLD,
      icon: 'ram',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.damageMul *= 1.8;
          m.unstoppable = true;
          m.knockImmune = true;
          m.ram = Math.max(m.ram, 80000);
          m.ramSkill = st.spec;
        });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'symbolsPromise',
      name: 'Symbol\'s Promise',
      short: 'PROMISE',
      description: 'It\'s fine now: every ally within 5 km is repaired 40% and cannot sink for 5 s.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: GOLD,
      icon: 'heal',
    },
    {
      activate(ship, game) {
        for (const s of alliesWithin(ship, game, 5000)) {
          s.heal(s.maxHp * 0.4);
          buff(s, 'symbolsPromise', 5, (m) => {
            m.undying = true;
          });
        }
      },
      aiShouldUse(ship, game) {
        return alliesWithin(ship, game, 5000).some((s) => hpFrac(s) < 0.35);
      },
    },
  ),

  // ------------------------------------------------------------------ Katsuki Bakugo
  def(
    {
      id: 'apShot',
      name: 'AP Shot',
      short: 'AP SHOT',
      description: 'A focused blast from the palm: a 4 km line toward the reticle, 45k to every hull on it.',
      cooldown: 12,
      duration: 0,
      accent: BLAST,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        slash(ship, game, st.spec, 4000, 40, 45000, { charge: 0.3 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  def(
    {
      id: 'stunGrenade',
      name: 'Stun Grenade',
      short: 'STUN GRENADE',
      description: 'A flash at the reticle (within 4 km): 25k across 500 m and a 2 s stun.',
      cooldown: 14,
      duration: 0,
      accent: 0xfff0a0,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: p.x, z: p.z, radius: 500, delay: 0.6, damage: 25000, stun: 2 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  shiftSkill({
    id: 'bakugoExplosion',
    name: 'Explosion!',
    short: 'DYNAMIGHT',
    description: 'Titan Shift: sweat like nitroglycerine and a temper to match. Dynamight, the number one hero, and every explosion turned up.',
    accent: BLAST,
  }),

  // ------------------------------------------------------------------ Dynamight
  def(
    {
      id: 'autoCannon',
      name: 'AP Shot: Auto-Cannon',
      short: 'AUTO-CANNON',
      description: 'AP Shot after AP Shot: a 2 s stream toward the reticle, 4 km long, 50k a second to whatever it holds on.',
      cooldown: 10,
      duration: 0,
      accent: BLAST,
      icon: 'beam',
    },
    {
      activate(ship, game, st) {
        game.beams.fire(ship, { mode: 'aim', skill: st.spec, charge: 0.3, time: 2, dps: 50000, length: 4000, width: 50, pierce: true, rate: 25, knock: 20, mx: 0 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 3900);
      },
    },
  ),
  def(
    {
      id: 'megaStunGrenade',
      name: 'Mega Stun Grenade',
      short: 'MEGA STUN',
      description: 'A flash big enough to blind a crowd at the reticle (within 5 km): 40k across 800 m and a 3 s stun.',
      cooldown: 14,
      duration: 0,
      accent: 0xfff0a0,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.strikes.spawn(ship, { kind: 'mortar', skill: st.spec, x: p.x, z: p.z, radius: 800, delay: 0.6, damage: 40000, stun: 3 });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'bakugoCluster',
      name: 'Cluster',
      short: 'CLUSTER',
      description: 'A scatter of small blasts around the reticle (within 5 km): sixteen of them, 15k across 120 m each, and some fires.',
      cooldown: 10,
      duration: 0,
      accent: BLAST,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        clusterAt(ship, game, st.spec, p.x, p.z, 16, 15000);
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4800);
      },
    },
  ),
  def(
    {
      id: 'explosivePropulsion',
      name: 'Explosive Propulsion',
      short: 'PROPUL\u00adSION',
      description: 'Blast off: appear up to 1.5 km toward the reticle, then 50% faster for 4 s.',
      cooldown: 10,
      duration: 4,
      accent: BLAST,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 1500);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.5;
        });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 4000) && !within(ship, target, 1500);
      },
    },
  ),
  def(
    {
      id: 'nitroSweat',
      name: 'Nitro Sweat',
      short: 'NITRO',
      description: 'The palms are running wet: for 8 s, guns reload twice as fast and every hit sets a fire.',
      cooldown: 18,
      duration: 8,
      accent: BLAST,
      icon: 'salvo',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.reloadMul *= 0.5;
          m.guaranteedFire = true;
        });
      },
      aiShouldUse(ship, game) {
        return fighting(ship, game, 7000);
      },
    },
  ),
  def(
    {
      id: 'explosionWall',
      name: 'Explosion Wall',
      short: 'BLAST WALL',
      description: 'Both palms out at once: a ring of fire 600 m out, 60k and a shove to every enemy in it.',
      cooldown: 12,
      duration: 0,
      accent: BLAST,
      icon: 'wave',
    },
    {
      activate(ship, game, st) {
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 600, delay: 0, damage: 60000, knock: 180, fire: 0.5, speed: 900, follow: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 550).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'howitzerImpact',
      name: 'Howitzer Impact',
      short: 'HOWITZER',
      description: 'Spin up into a corkscrew of fire and come down beside the enemy under the reticle (within 3 km): 260k across 600 m, and everything in it burns.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: BLAST,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const t = victim(ship, game, 3000);
        if (!t) return false;
        appearAt(ship, game, t, false);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: t.pos.x, z: t.pos.z, radius: 600, delay: 0.3, damage: 260000, fire: 1, knock: 160, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2900);
      },
    },
  ),
  def(
    {
      id: 'clusterBarrage',
      name: 'Cluster Barrage',
      short: 'BARRAGE',
      description: 'Clusters at everyone: sixteen blasts around each of up to five enemies within 6 km, 15k across 120 m each.',
      ult: true,
      cooldown: 100,
      duration: 0,
      accent: BLAST,
      icon: 'strike',
    },
    {
      activate(ship, game, st) {
        const list = enemiesAround(ship, game, ship.pos.x, ship.pos.z, 6000).slice(0, 5);
        if (!list.length) return false;
        for (const s of list) clusterAt(ship, game, st.spec, s.pos.x, s.pos.z, 16, 15000);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 5800).length >= 2;
      },
    },
  ),
  def(
    {
      id: 'dynamightOverload',
      name: 'Dynamight Overload',
      short: 'OVERLOAD',
      description: 'Everything stored in both gauntlets at the reticle (within 6 km): after 1 s, 300k across 1.2 km.',
      ult: true,
      cooldown: 110,
      duration: 0,
      accent: BLAST,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 1200, delay: 1, damage: 300000, fire: 0.6, knock: 200, look: 'fireball' });
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 5800);
      },
    },
  ),
];
