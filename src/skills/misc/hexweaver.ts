import { def, type SkillDef } from '../types';
import { aimPoint, hurt } from '../kit';
import { miscTarget } from './MiscSupport';
import { coven, dollOf, effigyFire, HEX, pinCharges, pinDoll, ripSeam, stitch, substitute, thousandNeedles, twist, unmake } from './HexweaverRuntime';

// The Hexweaver's nine skills, Q E Z X C V R T B. Their numbers live in `HEX`.

const k = (v: number) => `${v / 1000}k`;

const SKILLS = [
  {
    id: 'hexPin',
    name: 'Pin',
    cooldown: 0,
    icon: 'salvo',
    description: `${HEX.pin.charges} stored Pins, each back ${HEX.pin.recharge} s after it is spent. Stab the aimed enemy within ${HEX.pin.range / 1000} km for ${k(HEX.pin.damage)} and bind it to a doll, or add a pin to its doll (up to ${HEX.pin.max}). Each pin makes it take +${HEX.pinBonus * 100}% from you. Keep ${HEX.dolls} dolls.`,
  },
  {
    id: 'hexStitch',
    name: 'Stitch',
    cooldown: 12,
    icon: 'root',
    description: `A needle sweep hits every enemy within ${HEX.stitch.radius / 1000} km of the reticle for ${k(HEX.stitch.damage)}, slows them ${HEX.stitch.slow * 100}% for ${HEX.stitch.slowTime} s and stitches their dolls for ${HEX.stitch.time} s: a stitched doll passes ${HEX.stitch.echo * 100}% of Twist, Rip and Needle damage to the others, at most ${k(HEX.stitch.echoCap)} each.`,
  },
  {
    id: 'hexTwist',
    name: 'Twist',
    cooldown: 9,
    icon: 'root',
    description: `Wring the aimed enemy's doll for ${k(HEX.twist.damage)} plus ${k(HEX.twist.perPin)} per pin; spending a pin adds ${k(HEX.twist.consume)}. The hull is wrenched a quarter turn and slowed ${HEX.twist.slow * 100}% for ${HEX.twist.slowTime} s. Works without a doll.`,
  },
  {
    id: 'hexFire',
    name: 'Effigy Fire',
    cooldown: 12,
    icon: 'rune',
    description: `Set a ${HEX.fire.radius} m patch alight: ${k(HEX.fire.damage)} at once and ${k(HEX.fire.field)}/s for ${HEX.fire.fieldTime} s. Dolls inside burn for ${HEX.fire.time} s at ${k(HEX.fire.burn)}/s, +${HEX.fire.perPin * 100}% per pin, and the fire spreads to every stitched doll.`,
  },
  {
    id: 'hexRip',
    name: 'Rip the Seam',
    cooldown: 14,
    icon: 'root',
    description: `Tear a ${HEX.rip.radius} m seam for ${k(HEX.rip.damage)}, cashing out each doll's remaining burn and ${k(HEX.rip.perPin)} per pin it holds. Stitched dolls erupt for ${k(HEX.rip.erupt)} in ${HEX.rip.eruptRadius} m.`,
  },
  {
    id: 'hexSubstitute',
    name: 'Substitute',
    cooldown: 18,
    icon: 'shield',
    description: `Dash up to ${HEX.substitute.dash} m toward the reticle, leaving a straw effigy that soaks ${k(HEX.substitute.hp)} of damage aimed at you and draws enemy fire within ${HEX.substitute.lure / 1000} km for ${HEX.substitute.time} s, then bursts for ${k(HEX.substitute.burst)} in ${HEX.substitute.burstRadius} m.`,
  },
  {
    id: 'hexCoven',
    name: 'Coven',
    cooldown: 85,
    icon: 'root',
    description: `Draw a ${HEX.coven.radius / 1000} km ritual circle at the reticle: every enemy inside is bound with at least one pin, every doll is stitched for ${HEX.coven.stitch} s, and the circle burns ${k(HEX.coven.dps)}/s for ${HEX.coven.time} s.`,
  },
  {
    id: 'hexNeedles',
    name: 'Thousand Needles',
    cooldown: 90,
    duration: HEX.needles.time,
    icon: 'root',
    description: `${HEX.needles.count} needles rain on the aimed enemy over ${HEX.needles.time} s, ${k(HEX.needles.damage)} each, +${HEX.needles.perPin * 100}% per pin. Stitches echo them to the group.`,
  },
  {
    id: 'hexUnmaking',
    name: 'Effigy Unmaking',
    cooldown: 110,
    icon: 'skull',
    description: `Tear every doll apart: each deals ${k(HEX.unmaking.damage)} plus ${k(HEX.unmaking.perPin)} per pin to its ship, and a stitched doll blasts ${k(HEX.unmaking.blast)} across ${HEX.unmaking.blastRadius} m. Clears all dolls.`,
  },
] as const;

export const HEXWEAVER_SKILLS: SkillDef[] = SKILLS.map((sk, i) =>
  def(
    {
      id: sk.id,
      name: sk.name,
      short: sk.name.toUpperCase(),
      description: sk.description,
      cooldown: sk.cooldown,
      duration: 'duration' in sk ? sk.duration : 0,
      ult: i >= 6,
      accent: 0xe878bd,
      icon: sk.icon,
    },
    {
      activate(s, _g, st) {
        const p = aimPoint(s, 5000);
        if (i === 1) return stitch(s, p.x, p.z, st.spec);
        if (i === 3) return effigyFire(s, p.x, p.z, st.spec);
        if (i === 4) return ripSeam(s, p.x, p.z, st.spec);
        if (i === 5) {
          const dest = aimPoint(s, HEX.substitute.dash);
          return substitute(s, dest.x, dest.z);
        }
        if (i === 6) return coven(s, p.x, p.z, st.spec);
        if (i === 8) return unmake(s, st.spec);
        const t = miscTarget(s, HEX.pin.range);
        if (!t) return s.failSkill(`Aim at a detected enemy within ${HEX.pin.range / 1000} km`);
        if (i === 0) {
          if (pinCharges(s) <= 0) return s.failSkill('All four Pins are recovering');
          hurt(s, t, HEX.pin.damage * (1 + (dollOf(s, t)?.pins ?? 0) * HEX.pinBonus), st.spec);
          return pinDoll(s, t);
        }
        if (i === 2) return twist(s, t, st.spec);
        if (i === 7) return thousandNeedles(s, t);
      },
      aiShouldUse(s, _g, t) {
        if (!t) return false;
        const a = s.hexweaver!;
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
        const pins = dollOf(s, t)?.pins ?? 0;
        if (i === 5) return s.hp < s.maxHp * 0.6;
        if (i === 8) return a.dolls.reduce((n, x) => n + x.pins, 0) >= 3 || a.dolls.length >= 2;
        if (i === 1) return a.dolls.length >= 1 && d < 4800;
        if (i === 2) return pins >= 1 && d < 4800;
        if (i === 4) return a.dolls.some((x) => x.pins >= 2 || x.burnUntil > s.game.time) && d < 4800;
        return d < 4800;
      },
    },
  ),
);
