import { def, type SkillDef } from '../types';
import { aimPoint } from '../kit';
import { miscTarget } from './MiscSupport';
import { arrest, collectTaxes, declareMartialLaw, inCourt, JUDGE, judgeWarning, placeCourt, throwGavel, violationCount } from './JudgeRuntime';

// The Judge's nine skills, Q E Z X C V R T B. Their numbers live in `JUDGE`.

const SKILLS = [
  {
    id: 'judgeCourt',
    name: 'Jurisdiction',
    cooldown: 12,
    icon: 'radar',
    description: `Slam a ${JUDGE.court.radius / 1000} km court down under the reticle, up to ${JUDGE.court.range / 1000} km away: ${JUDGE.court.damage / 1000}k and +${JUDGE.court.cite} violations to every enemy inside. All six laws hold inside it at once: hold fire, no skills, keep to 10–20 kn, hold course and stay inside.`,
  },
  {
    id: 'judgeGavel',
    name: 'Gavel',
    cooldown: 9,
    icon: 'strike',
    description: `Throw the gavel at the aimed enemy: ${JUDGE.gavel.damage / 1000}k plus ${JUDGE.gavel.perViolation / 1000}k per violation, citing +${JUDGE.gavel.cite}. It ricochets to up to ${JUDGE.gavel.bounces} more enemies with open cases within ${JUDGE.gavel.reach / 1000} km, each hit at ${JUDGE.gavel.falloff * 100}% of the last.`,
  },
  {
    id: 'judgeContempt',
    name: 'Contempt of Court',
    cooldown: 14,
    icon: 'strike',
    description: `Warn the aimed enemy, then freeze it for ${JUDGE.contempt.freeze} s and hold it in contempt for ${JUDGE.contempt.time} s: every violation counts ×${JUDGE.contempt.mul} and zaps it for ${JUDGE.contempt.zap / 1000}k. Its weapons and defences stay usable.`,
  },
  {
    id: 'judgeArrest',
    name: 'Arrest',
    cooldown: 14,
    icon: 'root',
    description: `Chain an enemy within 5 km and drag it toward court for ${JUDGE.arrest.time} s, dealing ${JUDGE.arrest.dps / 1000}k per second and citing +1 each second. Obstacles, cleansing and escape movement break the chain.`,
  },
  {
    id: 'judgeTaxes',
    name: 'Taxes',
    cooldown: 10,
    icon: 'strike',
    description: `Collect ${JUDGE.taxes.damage / 1000}k plus ${JUDGE.taxes.perViolation / 1000}k per violation from the aimed enemy and heal for ${JUDGE.taxes.heal * 100}% of it. Its case stays open.`,
  },
  {
    id: 'judgeObjection',
    name: 'Objection',
    cooldown: 20,
    duration: 5,
    icon: 'shield',
    description: `For 5 s, each hostile hit has a ${JUDGE.objection.chance * 100}% chance to be dismissed. A dismissed hit cites its attacker +1 and sends ${JUDGE.objection.reflect * 100}% of its damage back.`,
  },
  {
    id: 'judgeMartial',
    name: 'Martial Law',
    cooldown: 90,
    duration: JUDGE.martial.time,
    icon: 'strike',
    description: `For ${JUDGE.martial.time} s the court spans ${JUDGE.court.martialRadius / 1000} km, violations count double and the guns reload twice as fast. Every enemy in court takes ${JUDGE.martial.damage / 1000}k plus ${JUDGE.martial.perViolation / 1000}k per violation at once.`,
  },
  {
    id: 'judgeVerdict',
    name: 'Verdict',
    cooldown: 95,
    icon: 'strike',
    description: `Warn an ${JUDGE.verdict.radius} m area, then slam a giant gavel for ${JUDGE.verdict.damage / 1000}k plus ${JUDGE.verdict.perViolation / 1000}k per violation.`,
  },
  {
    id: 'judgeDeath',
    name: 'Death Penalty',
    cooldown: 120,
    icon: 'skull',
    description: `An enemy with at least ${JUDGE.death} violations receives a warned hit equal to its maximum HP. Spends its case; shields and defensive abilities still apply.`,
  },
] as const;

export const JUDGE_SKILLS: SkillDef[] = SKILLS.map((k, i) =>
  def(
    {
      id: k.id,
      name: k.name,
      short: k.name.toUpperCase(),
      description: k.description,
      cooldown: k.cooldown,
      duration: 'duration' in k ? k.duration : 0,
      accent: 0xffd47b,
      icon: k.icon,
      ult: i >= 6,
      empowers: i === 6,
    },
    {
      activate(s, _g, st) {
        const a = s.judge!;
        const now = s.game.time;
        if (i === 0) {
          const t = miscTarget(s);
          const p = (s.humanIndex < 0 || s.autopilot) && t ? { x: t.pos.x, z: t.pos.z } : aimPoint(s, JUDGE.court.range);
          placeCourt(s, p.x, p.z);
          return;
        }
        if (i === 5) {
          a.objectionUntil = now + 5;
          return;
        }
        if (i === 6) {
          if (!a.court) return s.failSkill('Establish Jurisdiction first');
          declareMartialLaw(s);
          return;
        }
        if (i === 7) {
          const p = aimPoint(s, 5000);
          judgeWarning(s, 'verdict', null, p.x, p.z, st.spec);
          return;
        }
        const t = miscTarget(s);
        if (!t) return s.failSkill('Aim at a detected enemy within 5 km');
        if (i === 1) throwGavel(s, t);
        if (i === 2) judgeWarning(s, 'freeze', t, t.pos.x, t.pos.z, st.spec);
        if (i === 3) {
          if (!a.court) return s.failSkill('Establish Jurisdiction first');
          arrest(s, t);
        }
        if (i === 4) collectTaxes(s, t);
        if (i === 8) {
          if (violationCount(s, t) < JUDGE.death) return s.failSkill(`Death Penalty requires ${JUDGE.death} violations`);
          judgeWarning(s, 'death', t, t.pos.x, t.pos.z, st.spec);
        }
      },
      aiShouldUse(s, _g, t) {
        if (!t) return false;
        const a = s.judge!;
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
        const v = violationCount(s, t);
        if (i === 1) return v > 0 && d < 4800;
        if (i === 0) return !a.court || Math.hypot(t.pos.x - a.court.x, t.pos.z - a.court.z) > JUDGE.court.radius * 0.9;
        if (i === 3) return !!a.court && !inCourt(s, t) && d < 4800;
        if (i === 4) return v >= 3 || s.hp < s.maxHp * 0.6;
        if (i === 5) return s.hp < s.maxHp * 0.8;
        if (i === 6) return !!a.court && inCourt(s, t);
        if (i === 8) return v >= JUDGE.death;
        return d < 4800;
      },
    },
  ),
);
