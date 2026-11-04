import { def, type SkillDef } from "../types";
import { aimPoint, buff, hurt } from "../kit";
import { miscTarget, moveSafe } from "./MiscSupport";
import { dollDamage, igniteDoll, pinDoll } from "./HexweaverRuntime";
const names = [
  "Pin",
  "Stitch",
  "Twist",
  "Effigy Fire",
  "Rip the Seam",
  "Substitute",
  "Coven",
  "Thousand Needles",
  "Effigy Unmaking",
];
const descriptions = [
  "Four stored Pins, each recovering in 6 s. Hit an enemy within 5 km for 24k and bind an 18 s doll; repeat for up to three pins. Keep four dolls.",
  "A needle sweep hits for 35k and slows around the reticle. Nearby dolls stitch for 8 s, echoing 35% of doll damage once, at most 45k per echo.",
  "Wrench the aimed enemy for 55k plus 15k per pin and slow it. Consume one pin for an extra 45k focused burst. Works without a doll.",
  "Ignite a 650 m patch for 25k and burn dolls for 5 s. Stitches spread ignition. Each pin strengthens the burn.",
  "A 900 m cutting wave deals 50k, cashes out remaining doll fire and consumes pins for 30k each. Stitched dolls erupt in smaller outward bursts.",
  "Dash toward the reticle up to 700 m, leaving a 140k-HP effigy that absorbs incoming damage for 4 s before exploding. Nearby stitched enemies are cursed.",
  "Create a 1.8 km ritual area at the reticle: bind enemies, preserve stronger pins and stitch all dolls for 8 s.",
  "Twelve needle strikes chase the aimed enemy, each dealing 18k plus 30% per pin. Stitches echo a capped share to the group.",
  "A giant effigy tears apart: detonate every doll for 120k plus 70k per pin. Stitched dolls create 650 m blasts. Clears all dolls.",
];
export const HEXWEAVER_SKILLS: SkillDef[] = names.map((name, i) =>
  def(
    {
      id:
        "hex" +
        [
          "Pin",
          "Stitch",
          "Twist",
          "Fire",
          "Rip",
          "Substitute",
          "Coven",
          "Needles",
          "Unmaking",
        ][i],
      name,
      short: name.toUpperCase(),
      description: descriptions[i],
      cooldown: [0, 12, 9, 12, 14, 18, 85, 90, 110][i],
      duration: i === 7 ? 2 : 0,
      ult: i >= 6,
      accent: 0xe878bd,
      icon:
        i === 5
          ? "shield"
          : i === 0
            ? "salvo"
            : i === 3
              ? "rune"
              : i === 8
                ? "skull"
                : "root",
    },
    {
      activate(s, _g, st) {
        const a = s.hexweaver!,
          t = miscTarget(s),
          p = aimPoint(s, 5000),
          now = s.game.time;
        if (i === 0) {
          if (!t) return s.failSkill("Aim at a detected enemy within 5 km");
          if (!pinDoll(s, t)) return false;
          hurt(s, t, 24000, st.spec);
        }
        if (i === 1) {
          for (const v of s.game.ships)
            if (
              v.alive &&
              v.team !== s.team &&
              Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 1200
            ) {
              hurt(s, v, 35000, st.spec);
              buff(v, "debuff:stitchSlow", 3, (m) => {
                m.speedMul *= 0.65;
              });
              const d = a.dolls.find((d) => d.target === v.id);
              if (d) d.stitchedUntil = now + 8;
            }
        }
        if (i === 2) {
          if (!t) return false;
          const d = a.dolls.find((d) => d.target === t.id);
          dollDamage(
            s,
            t,
            55000 + (d?.pins ?? 0) * 15000 + (d && d.pins > 0 ? 45000 : 0),
            st.spec,
          );
          if (d && d.pins > 0) d.pins--;
          buff(t, "debuff:twist", 2, (m) => {
            m.speedMul *= 0.5;
          });
        }
        if (i === 3) {
          for (const v of s.game.ships)
            if (
              v.alive &&
              v.team !== s.team &&
              Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 650
            )
              hurt(s, v, 25000, st.spec);
          const d = t && a.dolls.find((d) => d.target === t.id);
          if (d) {
            igniteDoll(s, d);
            if (d.stitchedUntil > now)
              for (const o of a.dolls)
                if (o.stitchedUntil > now) igniteDoll(s, o);
          }
          s.game.fields.add(s, {
            x: p.x,
            z: p.z,
            r: 650,
            life: 5,
            dps: 9000,
            skill: st.spec,
            look: "fire",
            color: 0xe878bd,
          });
        }
        if (i === 4) {
          for (const v of s.game.ships.slice())
            if (
              v.alive &&
              v.team !== s.team &&
              Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 900
            ) {
              const d = a.dolls.find((d) => d.target === v.id),
                extra = d
                  ? Math.max(0, d.burnUntil - now) *
                      18000 *
                      (1 + d.pins * 0.2) +
                    d.pins * 30000
                  : 0;
              dollDamage(s, v, 50000 + extra, st.spec);
              if (d) {
                if (d.stitchedUntil > now)
                  s.game.strikes.spawn(s, {
                    kind: "rod",
                    skill: st.spec,
                    x: v.pos.x,
                    z: v.pos.z,
                    radius: 450,
                    delay: 0,
                    damage: 35000,
                    look: "rune",
                  });
                d.pins = 0;
                d.burnUntil = 0;
              }
            }
        }
        if (i === 5) {
          const dest = aimPoint(s, 700),
            from = { x: s.pos.x, z: s.pos.z };
          if (!moveSafe(s, dest.x, dest.z))
            return s.failSkill("Substitute needs clear water");
          a.decoy = { ...from, hp: 140000, until: now + 4 };
        }
        if (i === 6) {
          for (const v of s.game.ships)
            if (
              v.alive &&
              v.team !== s.team &&
              !v.mods.untargetable &&
              Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 1800
            ) {
              if (!a.dolls.some((d) => d.target === v.id)) pinDoll(s, v, true);
            }
          for (const d of a.dolls) d.stitchedUntil = now + 8;
        }
        if (i === 7) {
          if (!t) return false;
          a.needles.push({ target: t.id, next: now, left: 12 });
        }
        if (i === 8) {
          if (!a.dolls.length)
            return s.failSkill("Bind at least one doll before Unmaking");
          const dolls = a.dolls.slice();
          a.dolls = [];
          for (const d of dolls) {
            const v = s.game.ships.find((v) => v.id === d.target && v.alive);
            if (v) {
              hurt(s, v, 120000 + d.pins * 70000, st.spec);
              if (d.stitchedUntil > now)
                s.game.strikes.spawn(s, {
                  kind: "rod",
                  skill: st.spec,
                  x: v.pos.x,
                  z: v.pos.z,
                  radius: 650,
                  delay: 0.3,
                  damage: 65000,
                  look: "rune",
                });
            }
          }
        }
      },
      aiShouldUse(s, _g, t) {
        if (!t) return false;
        const a = s.hexweaver!;
        if (i === 5) return s.hp < s.maxHp * 0.6;
        if (i === 8)
          return a.dolls.some((d) => d.pins >= 2) || a.dolls.length >= 2;
        if (i === 1) return a.dolls.length >= 2;
        if (i === 4) return a.dolls.some((d) => d.burnUntil > s.game.time);
        return Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 4800;
      },
    },
  ),
);
