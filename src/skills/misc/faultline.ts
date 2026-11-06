import type { SkillIcon, SkillSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { enemiesWithin } from '../kit';
import { def, type SkillDef } from '../types';
import {
  castAftershock,
  castBedrock,
  castCaldera,
  castDivide,
  castFault,
  castSlip,
  castSubduction,
  castUplift,
  castWorldbreaker,
  divideFits,
  FAULTLINE,
} from './FaultlineRuntime';

// The Faultline's nine skills, Q E Z X C V R T B. Their numbers live in `FAULTLINE`.

const F = FAULTLINE;
const k = (v: number) => `${v / 1000}k`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const range = (s: Ship, t: Ship | null) => (t ? Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : Infinity);
const network = (s: Ship) => (s.faultline?.fractures.length ?? 0) + s.game.map.dynamicRidges.filter((r) => r.owner === s.id).length;

interface Entry {
  id: string;
  name: string;
  short: string;
  cooldown: number;
  icon: SkillIcon;
  description: string;
  activate: (s: Ship, spec: SkillSpec) => boolean | void;
  ai: (s: Ship, t: Ship | null) => boolean;
}

const SKILLS: Entry[] = [
  {
    id: 'faultlineFault',
    name: 'Fault',
    short: 'FAULT',
    cooldown: 7,
    icon: 'wave',
    description: `Split the sea toward the reticle, up to ${F.range / 1000} km. After a ${F.warning} s warning a rupture runs along it for ${k(F.fault.damage)} per pulse and throws enemies aside; each repeat hit on one ship deals ${pct(1 - F.repeat)} less.`,
    activate: (s, spec) => castFault(s, spec),
    ai: (s, t) => range(s, t) < F.range,
  },
  {
    id: 'faultlineUplift',
    name: 'Uplift',
    short: 'UPLIFT',
    cooldown: 12,
    icon: 'wall',
    description: `Raise a ${F.ridgeLength} m basalt ridge across the reticle after a ${F.warning} s warning. It erupts for ${k(F.uplift.damage)} against enemies within ${F.uplift.reach} m of it and throws them clear, then stands for ${F.ridgeLife} s (${F.maxRidges} at most), blocking both teams and low shots.`,
    activate: (s, spec) => castUplift(s, spec),
    ai: (s, t) => range(s, t) < F.range && range(s, t) > 500,
  },
  {
    id: 'faultlineSubduction',
    name: 'Subduction',
    short: 'SUBDUCT',
    cooldown: 13,
    icon: 'gravity',
    description: `Open a basin on the fracture nearest the reticle: enemies within ${F.subduction.radius} m are dragged in and slowed for ${F.subduction.time} s, then the rock jaws close for ${k(F.subduction.damage)}. Needs a fracture; every fourth mortar salvo opens one.`,
    activate: (s, spec) => castSubduction(s, spec),
    ai: (s) => !!s.faultline?.fractures.length && enemiesWithin(s, s.game, F.range).length > 0,
  },
  {
    id: 'faultlineSlip',
    name: 'Slip',
    short: 'SLIP',
    cooldown: 9,
    icon: 'blink',
    description: `Ride the nearest fracture toward the reticle in ${F.slip.time} s, hitting each enemy you touch for ${k(F.slip.damage)} and gaining ${F.slip.pressure} pressure. A magma wake burns along the path for ${k(F.slip.wake)}/s for ${F.slip.wakeTime} s. Cannot cross islands or ridges.`,
    activate: (s) => castSlip(s),
    ai: (s, t) => !!s.faultline?.fractures.length && range(s, t) > 700 && range(s, t) < F.range,
  },
  {
    id: 'faultlineAftershock',
    name: 'Aftershock',
    short: 'AFTERSHOCK',
    cooldown: 11,
    icon: 'salvo',
    description: `Every fracture pulses in turn for ${k(F.aftershock.damage)}, and every ridge sheds boulders for ${k(F.aftershock.boulder)} on enemies within ${F.aftershock.reach} m. Repeat hits on one ship deal ${pct(1 - F.repeat)} less each, ${F.maxHits} hits at most.`,
    activate: (s, spec) => castAftershock(s, spec),
    ai: (s) => network(s) > 0 && enemiesWithin(s, s.game, F.range + 500).length > 0,
  },
  {
    id: 'faultlineBedrock',
    name: 'Bedrock',
    short: 'BEDROCK',
    cooldown: 20,
    icon: 'shield',
    description: `Brace for ${F.bedrock.time} s: take ${pct(F.bedrock.reduction)} less damage and store the hull damage you absorb as pressure, up to ${F.maxPressure}. Then the Rebound throws back everything within ${F.bedrock.radius} m for ${k(F.bedrock.rebound)} plus ${k(F.bedrock.perPressure)} per pressure, without spending it.`,
    activate: (s) => castBedrock(s),
    ai: (s) => s.hp / s.maxHp < 0.75 || enemiesWithin(s, s.game, 1500).length >= 2 || s.lastHurt > s.game.time - 1,
  },
  {
    id: 'faultlineDivide',
    name: 'Continental Divide',
    short: 'DIVIDE',
    cooldown: 100,
    icon: 'wall',
    description: `Raise two ${F.divide.length / 1000} km ridges with open ends either side of the reticle. A warned rupture tears down the corridor between them for ${k(F.divide.damage)} per pulse. Ridges need clear sea.`,
    activate: (s, spec) => castDivide(s, spec),
    // A Divide that cannot fit fails for free, and the AI would retry it ahead of every other skill.
    ai: (s, t) => !!t && range(s, t) < F.range - 300 && divideFits(s, t.pos.x, t.pos.z),
  },
  {
    id: 'faultlineCaldera',
    name: 'Caldera',
    short: 'CALDERA',
    cooldown: 100,
    icon: 'nuke',
    description: `Drag enemies into a ${F.caldera.pull / 1000} km crater for ${F.caldera.time} s, then erupt over ${F.caldera.radius / 1000} km for ${k(F.caldera.damage)} plus ${k(F.caldera.perPressure)} per pressure (${k(F.caldera.damage + F.maxPressure * F.caldera.perPressure)} at full). Spends all pressure.`,
    activate: (s, spec) => castCaldera(s, spec),
    ai: (s, t) => range(s, t) < F.range && ((s.faultline?.pressure ?? 0) >= 40 || enemiesWithin(s, s.game, F.range).length > 1),
  },
  {
    id: 'faultlineWorldbreaker',
    name: 'Worldbreaker',
    short: 'WORLDBREAK',
    cooldown: 130,
    icon: 'nuke',
    description: `A ${k(F.worldbreaker.damage)} rupture runs through every fracture, then each of your ridges collapses in a ${k(F.worldbreaker.collapse)} shockwave over ${F.worldbreaker.radius} m. Opens a fault toward the reticle when the sea is unbroken. Repeat hits diminish.`,
    activate: (s, spec) => castWorldbreaker(s, spec),
    ai: (s, t) => range(s, t) < F.range && (network(s) >= 2 || enemiesWithin(s, s.game, F.range).length >= 2),
  },
];

export const FAULTLINE_SKILLS: SkillDef[] = SKILLS.map((sk, i) =>
  def(
    {
      id: sk.id,
      name: sk.name,
      short: sk.short,
      description: sk.description,
      cooldown: sk.cooldown,
      duration: 0,
      icon: sk.icon,
      accent: F.accent,
      ult: i >= 6,
    },
    {
      activate: (s, _g, st) => sk.activate(s, st.spec),
      aiShouldUse: (s, _g, t) => sk.ai(s, t),
    },
  ),
);
