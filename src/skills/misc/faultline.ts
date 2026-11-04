import { def, type SkillDef } from "../types";
import {
  FAULTLINE,
  castAftershock,
  castBedrock,
  castCaldera,
  castDivide,
  castFault,
  castSlip,
  castSubduction,
  castUplift,
  castWorldbreaker,
} from "./FaultlineRuntime";
import { enemiesWithin } from "../kit";
import type { SkillSpec } from "../../core/types";

const spec = (
  id: string,
  name: string,
  short: string,
  cooldown: number,
  description: string,
  icon: SkillSpec["icon"] = "wave",
  ult = false,
): SkillSpec => ({
  id,
  name,
  short,
  cooldown,
  duration: 0,
  description,
  icon,
  accent: FAULTLINE.accent,
  ult,
});
export const FAULTLINE_SKILLS: SkillDef[] = [
  def(
    spec(
      "faultlineFault",
      "Fault",
      "FAULT",
      8,
      "Fracture the sea toward the reticle, up to 2.6 km. After a 0.9 s warning, a travelling rupture deals 48k per pulse with diminishing repeat damage and throws enemies aside.",
    ),
    {
      activate: (s, _g, st) => castFault(s, st.spec),
      aiShouldUse: (s, _g, t) =>
        !!t && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 2600,
    },
  ),
  def(
    spec(
      "faultlineUplift",
      "Uplift",
      "UPLIFT",
      14,
      "Raise a 900 m solid ridge across the reticle after a 0.9 s warning. Lasts 12 s; six ridges maximum. Safely displaces hulls and leaves clear exits. Blocks both teams and low shots.",
      "wall",
    ),
    {
      activate: (s, _g, st) => castUplift(s, st.spec),
      aiShouldUse: (s, _g, t) =>
        !!t && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) > 900,
    },
  ),
  def(
    spec(
      "faultlineSubduction",
      "Subduction",
      "SUBDUCT",
      14,
      "Pull enemies within 700 m toward the fracture nearest the reticle for 2 s, slow them, then crush the basin for 100k. Requires an existing fracture.",
      "gravity",
    ),
    {
      activate: (s, _g, st) => castSubduction(s, st.spec),
      aiShouldUse: (s) => !!s.faultline?.fractures.length,
    },
  ),
  def(
    spec(
      "faultlineSlip",
      "Slip",
      "SLIP",
      10,
      "Ride a clear fracture toward the reticle in 0.65 s. Contact deals 65k once per enemy; gain 15 pressure. Cannot cross islands or ridges.",
      "blink",
    ),
    {
      activate: (s) => castSlip(s),
      aiShouldUse: (s, _g, t) =>
        !!t &&
        !!s.faultline?.fractures.length &&
        Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) > 700,
    },
  ),
  def(
    spec(
      "faultlineAftershock",
      "Aftershock",
      "AFTERSHOCK",
      12,
      "Pulse every living fracture in placement order for 44k per pulse. Repeated hits diminish by 45%, with at most six damaging hits on one enemy.",
      "salvo",
    ),
    {
      activate: (s, _g, st) => castAftershock(s, st.spec),
      aiShouldUse: (s) => !!s.faultline?.fractures.length,
    },
  ),
  def(
    spec(
      "faultlineBedrock",
      "Bedrock",
      "BEDROCK",
      22,
      "Brace for 6 s: take 55% less damage and store absorbed hull damage as pressure, up to 100. Pressure strengthens Caldera.",
      "shield",
    ),
    {
      activate: (s) => castBedrock(s),
      aiShouldUse: (s) =>
        s.hp / s.maxHp < 0.75 || enemiesWithin(s, s.game, 2200).length >= 2,
    },
  ),
  def(
    spec(
      "faultlineDivide",
      "Continental Divide",
      "DIVIDE",
      100,
      "Raise two 1.4 km ridges with open ends around a central fracture. A warned rupture tears through the corridor for 110k per pulse. Ridge placement requires clear sea.",
      "wall",
      true,
    ),
    {
      activate: (s, _g, st) => castDivide(s, st.spec),
      aiShouldUse: (s, _g, t) =>
        !!t && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 2300,
    },
  ),
  def(
    spec(
      "faultlineCaldera",
      "Caldera",
      "CALDERA",
      100,
      "Draw enemies into a 1 km crater for 2 s, then erupt over 1.1 km for 180k plus 3.5k per stored pressure. Spends all pressure; works even at zero.",
      "nuke",
      true,
    ),
    {
      activate: (s, _g, st) => castCaldera(s, st.spec),
      aiShouldUse: (s, _g, t) =>
        !!t &&
        ((s.faultline?.pressure ?? 0) > 40 ||
          enemiesWithin(s, s.game, 2600).length > 1),
    },
  ),
  def(
    spec(
      "faultlineWorldbreaker",
      "Worldbreaker",
      "WORLDBREAK",
      130,
      "Send a travelling 135k rupture through the fracture network, then collapse your ridges in 140k shockwaves. Creates a fault when the sea is unbroken. Repeat hits diminish.",
      "nuke",
      true,
    ),
    {
      activate: (s, _g, st) => castWorldbreaker(s, st.spec),
      aiShouldUse: (s, _g, t) =>
        !!t &&
        ((s.faultline?.fractures.length ?? 0) >= 2 ||
          enemiesWithin(s, s.game, 2500).length >= 2),
    },
  ),
];
