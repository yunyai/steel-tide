import type { Game } from "../../core/Game";
import type { Ship } from "../../ships/Ship";
import type { SkillIcon } from "../../core/types";
import { aimPoint, enemiesWithin, hurt, nearestEnemy, buff } from "../kit";
import { reticleTarget } from "../fantasy/common";
import { def, type SkillDef } from "../types";
import {
  beginSwallow,
  cook,
  emptyPantry,
  GOURMAND,
  ingredient,
  pantryTotal,
  serve,
  skewer,
  swallowedBy,
} from "./GourmandRuntime";

const AMBER = 0xffad58;
const spec = (
  id: string,
  name: string,
  cooldown: number,
  icon: SkillIcon,
  duration = 0,
  ult = false,
) => ({
  id,
  name,
  short: name.toUpperCase(),
  description: "",
  cooldown,
  duration,
  icon,
  accent: AMBER,
  ult,
});
const victim = (s: Ship, reach: number) =>
  reticleTarget(s, s.game, reach, 500) ?? nearestEnemy(s, s.game, reach);
const attack = (s: Ship, _g: Game, t: Ship | null) =>
  !!t && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 3000;
export const GOURMAND_SKILLS: SkillDef[] = [
  def(
    {
      ...spec("gourmandDevour", "Devour", 10, "beast", 4),
      description:
        "Open the bow-mouth for 4 s. Eat hostile shells, surface torpedoes and low missiles before they hit; each feeds one pantry ingredient. Nearby wrecks supply three scrap ingredients. Cannot eat attacks behind the ship, deep torpedoes or high-flying missiles.",
    },
    {
      activate(s) {
        s.gourmand!.mouthUntil = s.game.time + 4;
      },
      aiShouldUse(s, g) {
        return (
          pantryTotal(s.gourmand!.pantry) < GOURMAND.capacity &&
          (g.shells.shells.some(
            (p) =>
              p.alive &&
              p.team !== s.team &&
              Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1500,
          ) ||
            g.torps.torps.some(
              (p) =>
                p.alive &&
                p.team !== s.team &&
                Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1500,
            ))
        );
      },
    },
  ),
  def(
    {
      ...spec("gourmandCarve", "Carve", 9, "blade"),
      description:
        "Sweep giant cutlery through enemies within 900 m for 65k damage. Each victim supplies two wreckage ingredients, so the kitchen can cook even without incoming fire.",
    },
    {
      activate(s) {
        const targets = enemiesWithin(s, s.game, 900);
        if (!targets.length)
          return s.failSkill("Carve: bring an enemy within 900 m");
        for (const t of targets) {
          hurt(s, t, 65000, s.skills[1].spec);
          ingredient(s, "wreckage", 2);
        }
        s.game.events.emit("lightning", {
          points: [
            { x: s.pos.x - 300, y: 20, z: s.pos.z },
            { x: s.pos.x + 300, y: 20, z: s.pos.z },
          ],
          color: AMBER,
          straight: true,
        });
      },
      aiShouldUse(s) {
        return enemiesWithin(s, s.game, 850).length > 0;
      },
    },
  ),
  def(
    {
      ...spec("gourmandCook", "Pressure Cooker", 12, "salvo"),
      description:
        "Cook the pantry into a 14 s preparation for the next main-gun salvo or Serve. Shell ingredients add piercing and damage, explosives add fire and splash, and wreckage adds shrapnel. Serving spends the unfired remainder. Requires at least one ingredient.",
    },
    {
      activate: cook,
      aiShouldUse(s) {
        return pantryTotal(s.gourmand!.pantry) >= 4 && !s.gourmand!.cooked;
      },
    },
  ),
  def(
    {
      ...spec("gourmandSkewer", "Skewer", 13, "magnet"),
      description:
        "Hurl a harpoon-fork at an enemy within 2.5 km for 55k damage. Reel it toward the mouth for 2 s at 240 m/s; land blocks the pull.",
    },
    {
      activate(s) {
        const t = victim(s, 2500);
        if (!t) return false;
        skewer(s, t);
      },
      aiShouldUse(s, _g, t) {
        return (
          !!t &&
          Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) > 600 &&
          Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 2500
        );
      },
    },
  ),
  def(
    {
      ...spec("gourmandServe", "Serve", 7, "strike"),
      description:
        "Lob a dish up to 3.5 km away. After 0.55 s it bursts for 55k in 320 m. A prepared meal adds damage, explosive radius, piercing morsels and scrap knockback. An empty pantry still serves a full basic dish.",
    },
    {
      activate(s) {
        const p = aimPoint(s, 3500);
        serve(s, p.x, p.z);
      },
      aiShouldUse: attack,
    },
  ),
  def(
    {
      ...spec("gourmandComfort", "Comfort Food", 20, "heal"),
      alwaysUsable: true,
      description:
        "Eat the pantry to heal 12k per ingredient and gain a 50k + 18k per ingredient shield for 6 s. An empty pantry still grants 50k shielding. Can be used under crowd control.",
    },
    {
      activate(s) {
        const a = s.gourmand!,
          n = pantryTotal(a.pantry);
        a.pantry = emptyPantry();
        s.heal(n * 12000);
        s.addShield(50000 + n * 18000, 6);
      },
      aiShouldUse(s) {
        return s.hp / s.maxHp < 0.7 || s.lastHurt > s.game.time - 2;
      },
    },
  ),
  def(
    {
      ...spec("gourmandBanquet", "Banquet", 100, "fleet", 12, true),
      empowers: true,
      description:
        "For 12 s the mouth widens, the pantry holds 30 ingredients (excess is lost when it ends), and the kitchen automatically serves a 35k side dish at nearby enemies every 1.5 s. Normal attacks and cooking remain available.",
    },
    {
      activate(s) {
        s.gourmand!.banquetUntil = s.game.time + 12;
        s.gourmand!.nextServing = s.game.time;
        buff(s, "gourmandBanquet", 12, (m) => {
          m.damageTakenMul *= 0.8;
        });
      },
      aiShouldUse: attack,
    },
  ),
  def(
    {
      ...spec("gourmandSwallow", "Swallow Whole", 110, "beast", 4, true),
      description:
        "Warn an enemy within 1 km with a glowing bite circle for 0.8 s, then bite for 90k and swallow it for at most 3 s. Digestion deals 45k/s; the victim retains defensive skills. Spit it into safe water with a 90k impact. Escaping the warning avoids capture.",
    },
    {
      activate(s) {
        const t = victim(s, GOURMAND.swallowReach);
        if (!t)
          return s.failSkill("Swallow Whole: aim at an enemy within 1 km");
        return beginSwallow(s, t);
      },
      aiShouldUse(s, _g, t) {
        return (
          !!t &&
          !swallowedBy(s.game, t) &&
          Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 900
        );
      },
    },
  ),
  def(
    {
      ...spec(
        "gourmandCatastrophe",
        "Kitchen Catastrophe",
        125,
        "nuke",
        0,
        true,
      ),
      description:
        "Vent a 180k furnace explosion within 1.5 km after 1 s, spending the pantry for +12k per ingredient. Explosives enlarge the blast and ignite enemies, shell ingredients add focused damage, and wreckage hurls victims away.",
    },
    {
      activate(s) {
        const a = s.gourmand!,
          p = { ...a.pantry },
          n = pantryTotal(p);
        a.pantry = emptyPantry();
        s.game.strikes.spawn(s, {
          kind: "nuke",
          skill: s.skills[8].spec,
          x: s.pos.x,
          z: s.pos.z,
          radius: 1500 + p.explosives * 35,
          delay: 1,
          damage: 180000 + n * 12000,
          fire: p.explosives ? 1 : 0,
          knock: 100 + p.wreckage * 15,
          look: "fireball",
        });
        if (p.shells) {
          const t = victim(s, 2000);
          if (t) hurt(s, t, p.shells * 10000, s.skills[8].spec);
        }
      },
      aiShouldUse(s) {
        return (
          enemiesWithin(s, s.game, 1400).length >= 2 ||
          (pantryTotal(s.gourmand!.pantry) >= 10 &&
            enemiesWithin(s, s.game, 1400).length > 0)
        );
      },
    },
  ),
];
