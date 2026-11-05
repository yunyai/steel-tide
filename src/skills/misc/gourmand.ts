import type { SkillIcon } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { reticleTarget } from '../fantasy/common';
import { aimPoint, enemiesWithin, nearestEnemy } from '../kit';
import { def, type SkillDef } from '../types';
import {
  banquet,
  beginSwallow,
  carve,
  comfortFood,
  devour,
  GOURMAND,
  kitchenCatastrophe,
  mouthPoint,
  pantryTotal,
  pressureCooker,
  serve,
  skewer,
  swallowedBy,
} from './GourmandRuntime';

// The Gourmand's nine skills, Q E Z X C V R T B. Their numbers live in `GOURMAND`.

const AMBER = 0xffad58;
const k = (v: number) => `${v / 1000}k`;

const victim = (s: Ship, reach: number) => reticleTarget(s, s.game, reach, 500) ?? nearestEnemy(s, s.game, reach);
const range = (s: Ship, t: Ship | null) => (t ? Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : Infinity);

interface Entry {
  id: string;
  name: string;
  cooldown: number;
  icon: SkillIcon;
  duration?: number;
  description: string;
  alwaysUsable?: boolean;
  empowers?: boolean;
  activate: (s: Ship) => boolean | void;
  ai: (s: Ship, t: Ship | null) => boolean;
}

const D = GOURMAND;

const SKILLS: Entry[] = [
  {
    id: 'gourmandDevour',
    name: 'Devour',
    cooldown: 10,
    duration: D.devour.time,
    icon: 'beast',
    description: `Open the bow mouth for ${D.devour.time} s. It eats hostile shells, surface torpedoes and low missiles, each an ingredient and ${k(D.devour.heal)} of healing; wrecks give three scrap. Ships up to ${D.devour.pull / 1000} km ahead are pulled in at ${D.devour.pullSpeed} m/s, and those within ${D.devour.chomp} m of the mouth are chomped for ${k(D.devour.dps)}/s.`,
    activate: devour,
    ai: (s, t) => {
      const g = s.game;
      const threat = g.shells.shells.some((p) => p.alive && p.team !== s.team && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1500) || g.torps.torps.some((p) => p.alive && p.team !== s.team && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1500);
      const m = mouthPoint(s);
      return threat || (!!t && Math.hypot(t.pos.x - m.x, t.pos.z - m.z) < D.devour.pull * 0.8);
    },
  },
  {
    id: 'gourmandCarve',
    name: 'Carve',
    cooldown: 8,
    icon: 'blade',
    description: `Giant cutlery slices every enemy within ${D.carve.radius} m for ${k(D.carve.damage)}. Each cut bleeds ${k(D.carve.bleed)}/s for ${D.carve.bleedTime} s and gives ${D.carve.scrap} scrap.`,
    activate: carve,
    ai: (s) => enemiesWithin(s, s.game, D.carve.radius - 50).length > 0,
  },
  {
    id: 'gourmandCook',
    name: 'Pressure Cooker',
    cooldown: 12,
    icon: 'salvo',
    description: `Lob the cooker up to ${D.cooker.range / 1000} km. It whistles for ${D.cooker.fuse} s, then bursts for ${k(D.cooker.damage)} plus ${k(D.cooker.perIngredient)} per ingredient, spending up to ${D.cooker.max}. Explosives widen it and set hulls alight, shells hit the nearest hull for ${k(D.cooker.focus)} each, and scrap throws a shrapnel ring that knocks ships back.`,
    activate: (s) => {
      const p = aimPoint(s, D.cooker.range);
      pressureCooker(s, p.x, p.z);
    },
    ai: (s, t) => range(s, t) < D.cooker.range && (pantryTotal(s.gourmand!.pantry) >= 3 || s.hp < s.maxHp * 0.5),
  },
  {
    id: 'gourmandSkewer',
    name: 'Skewer',
    cooldown: 12,
    icon: 'magnet',
    description: `Hurl a harpoon-fork at an enemy within ${D.skewer.range / 1000} km for ${k(D.skewer.damage)} and reel it toward the mouth for ${D.skewer.time} s. If it arrives, the mouth chomps it for ${k(D.skewer.chomp)} and takes ${D.skewer.scrap} scrap. Land stops the pull.`,
    activate: (s) => {
      const t = victim(s, D.skewer.range);
      if (!t) return s.failSkill(`Skewer: aim at an enemy within ${D.skewer.range / 1000} km`);
      skewer(s, t);
    },
    ai: (s, t) => range(s, t) > 600 && range(s, t) < D.skewer.range,
  },
  {
    id: 'gourmandServe',
    name: 'Serve',
    cooldown: 6,
    icon: 'strike',
    description: `Lob a dish up to ${D.serve.range / 1000} km: it lands after ${D.serve.delay} s for ${k(D.serve.damage)} in ${D.serve.radius} m, spending up to ${D.serve.spend} of the fullest jar for its flavour. Shells hit 40% harder, explosives burst half as wide again and burn, and scrap throws a shrapnel ring.`,
    activate: (s) => {
      const p = aimPoint(s, D.serve.range);
      serve(s, p.x, p.z);
    },
    ai: (s, t) => range(s, t) < D.serve.range,
  },
  {
    id: 'gourmandComfort',
    name: 'Comfort Food',
    cooldown: 20,
    icon: 'heal',
    alwaysUsable: true,
    description: `Eat the whole pantry: heal ${D.comfort.heal * 100}% of max HP plus ${k(D.comfort.perHeal)} per ingredient, and gain a ${k(D.comfort.shield)} + ${k(D.comfort.perShield)} per ingredient shield for ${D.comfort.shieldTime} s. Then a burp hits everything within ${D.comfort.burp} m for ${k(D.comfort.burpDamage)} and pushes it away. Usable under crowd control.`,
    activate: comfortFood,
    ai: (s) => s.hp / s.maxHp < 0.7 || s.lastHurt > s.game.time - 2,
  },
  {
    id: 'gourmandBanquet',
    name: 'Banquet',
    cooldown: 100,
    duration: D.banquet.time,
    icon: 'fleet',
    empowers: true,
    description: `For ${D.banquet.time} s the mouth widens, the pantry holds ${D.banquetCapacity} (the excess is lost after), you take ${D.banquet.reduction * 100}% less damage, and the kitchen serves a ${k(D.banquet.side)} side dish at the ${D.banquet.targets} nearest enemies every second.`,
    activate: banquet,
    ai: (s, t) => range(s, t) < 3000,
  },
  {
    id: 'gourmandSwallow',
    name: 'Swallow Whole',
    cooldown: 110,
    duration: 4,
    icon: 'beast',
    description: `Warn an enemy within ${D.swallow.reach / 1000} km with a bite circle for ${D.swallow.warning} s, then bite it for ${k(D.swallow.bite)} and swallow it for ${D.swallow.time} s, digesting ${k(D.swallow.digest)}/s. It keeps its defensive skills. Then it is spat out for ${k(D.swallow.spit)}. Leaving the circle escapes the bite.`,
    activate: (s) => {
      const t = victim(s, D.swallow.reach);
      if (!t) return s.failSkill(`Swallow Whole: aim at an enemy within ${D.swallow.reach / 1000} km`);
      return beginSwallow(s, t);
    },
    ai: (s, t) => !!t && !swallowedBy(s.game, t) && range(s, t) < D.swallow.reach - 100,
  },
  {
    id: 'gourmandCatastrophe',
    name: 'Kitchen Catastrophe',
    cooldown: 125,
    icon: 'nuke',
    description: `After a ${D.catastrophe.fuse} s fuse the kitchen blows: ${k(D.catastrophe.damage)} plus ${k(D.catastrophe.perIngredient)} per ingredient within ${D.catastrophe.radius / 1000} km, spending the pantry. Explosives widen it and set hulls alight, shells hit the nearest hull for ${k(D.catastrophe.focus)} each, scrap throws them further. Leaves an oil fire of ${k(D.catastrophe.oil)}/s for ${D.catastrophe.oilTime} s.`,
    activate: kitchenCatastrophe,
    ai: (s) => {
      const near = enemiesWithin(s, s.game, D.catastrophe.radius - 100).length;
      return near >= 2 || (near > 0 && pantryTotal(s.gourmand!.pantry) >= 8);
    },
  },
];

export const GOURMAND_SKILLS: SkillDef[] = SKILLS.map((sk, i) =>
  def(
    {
      id: sk.id,
      name: sk.name,
      short: sk.name.toUpperCase(),
      description: sk.description,
      cooldown: sk.cooldown,
      duration: sk.duration ?? 0,
      icon: sk.icon,
      accent: AMBER,
      ult: i >= 6,
      ...(sk.alwaysUsable ? { alwaysUsable: true } : {}),
      ...(sk.empowers ? { empowers: true } : {}),
    },
    {
      activate: (s) => sk.activate(s),
      aiShouldUse: (s, _g, t) => sk.ai(s, t),
    },
  ),
);
