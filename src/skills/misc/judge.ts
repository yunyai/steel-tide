import { def, type SkillDef } from "../types";
import { aimPoint } from "../kit";
import { miscTarget } from "./MiscSupport";
import { enactLaw, judgeWarning, LAWS, violationCount } from "./JudgeRuntime";
const names = [
  "Jurisdiction",
  "Law",
  "Contempt of Court",
  "Arrest",
  "Taxes",
  "Objection",
  "Martial Law",
  "Verdict",
  "Death Penalty",
];
const descriptions = [
  "Place a 2 km court beneath the reticle within 5 km. Recast to relocate it; laws retain their timers.",
  "Choose one of six laws. Each lasts 30 s; retain three, replacing the oldest. Enemies breaking a law gain violations.",
  "Warn the aimed enemy, then freeze movement for 1.5 s. Weapons and defensive skills remain available.",
  "Handcuff an enemy within 5 km and drag it toward court for 3 s. Obstacles, cleansing and escape movement break the chain.",
  "Collect 35k damage plus 7k per violation from the aimed enemy. Violations remain on its case.",
  "For 5 s, each eligible hostile hit has a 50% chance to be dismissed entirely.",
  "For 12 s, all six laws apply, violations accumulate twice as fast and jurisdiction expands to 3 km.",
  "Warn an 850 m area, then slam a giant gavel for 180k damage plus 9k per violation.",
  "An enemy with at least 20 violations receives a warned hit equal to its maximum HP. Spends its case; shields and defensive abilities still apply.",
];
export const JUDGE_SKILLS: SkillDef[] = names.map((name, i) =>
  def(
    {
      id:
        "judge" +
        [
          "Court",
          "Law",
          "Contempt",
          "Arrest",
          "Taxes",
          "Objection",
          "Martial",
          "Verdict",
          "Death",
        ][i],
      name,
      short: name.toUpperCase(),
      description: descriptions[i],
      cooldown: [12, 10, 15, 14, 10, 20, 90, 95, 120][i],
      duration: i === 5 ? 5 : i === 6 ? 12 : 0,
      accent: 0xffd47b,
      icon:
        i === 5
          ? "shield"
          : i < 2
            ? "radar"
            : i === 3
              ? "root"
              : i === 8
                ? "skull"
                : "strike",
      ult: i >= 6,
      empowers: i === 6,
    },
    {
      activate(s, _g, st) {
        const a = s.judge!;
        const t = miscTarget(s);
        if (i === 0) {
          a.court =
            (s.humanIndex < 0 || s.autopilot) && t
              ? { x: t.pos.x, z: t.pos.z }
              : aimPoint(s, 5000);
          return;
        }
        if (i === 1)
          return enactLaw(
            s,
            LAWS[
              s.control.judgeLaw ??
                Math.max(
                  0,
                  LAWS.findIndex((l) => !a.laws.some((x) => x.id === l)),
                )
            ],
          );
        if (i === 5) {
          a.objectionUntil = s.game.time + 5;
          return;
        }
        if (i === 6) {
          if (!a.court) return s.failSkill("Establish Jurisdiction first");
          a.martialUntil = s.game.time + 12;
          return;
        }
        if (i === 7) {
          const p = aimPoint(s, 5000);
          judgeWarning(s, "verdict", null, p.x, p.z, st.spec);
          return;
        }
        if (!t) return s.failSkill("Aim at a detected enemy within 5 km");
        if (i === 2) judgeWarning(s, "freeze", t, t.pos.x, t.pos.z, st.spec);
        if (i === 3) {
          if (!a.court) return s.failSkill("Establish Jurisdiction first");
          const effect = "debuff:arrest:" + s.id;
          t.addEffect({
            id: effect,
            time: 3,
            apply: (m) => {
              m.speedMul *= 0.45;
            },
          });
          a.arrests = a.arrests.filter((r) => r.target !== t.id);
          a.arrests.push({
            target: t.id,
            until: s.game.time + 3,
            effect,
            x: t.pos.x,
            z: t.pos.z,
          });
        }
        if (i === 4)
          t.takeDamage(
            (35000 + 7000 * violationCount(s, t)) * s.mods.damageMul,
            s,
            st.spec,
          );
        if (i === 8) {
          if (violationCount(s, t) < 20)
            return s.failSkill("Death Penalty requires 20 violations");
          judgeWarning(s, "death", t, t.pos.x, t.pos.z, st.spec);
        }
      },
      aiShouldUse(s, _g, t) {
        if (!t) return false;
        if (i === 0)
          return (
            !s.judge?.court ||
            Math.hypot(t.pos.x - s.judge.court.x, t.pos.z - s.judge.court.z) >
              1800
          );
        if (i === 1) return !!s.judge?.court;
        if (i === 5) return s.hp < s.maxHp * 0.8;
        if (i === 8) return violationCount(s, t) >= 20;
        return Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 4800;
      },
    },
  ),
);
