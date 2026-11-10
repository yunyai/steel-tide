import type { GunLook, ShipSpec, Nation } from "../core/types";
import type { SkillDef } from "../skills/types";
import { JUDGE_SKILLS } from "../skills/misc/judge";
import { HEXWEAVER_SKILLS } from "../skills/misc/hexweaver";
import { GOURMAND_SKILLS } from "../skills/misc/gourmand";
import { FAULTLINE_SKILLS } from "../skills/misc/faultline";
import { PHAROS_SKILLS } from "../skills/misc/pharos";
import { TITAN_REPAIR, search } from "./common";
import { HEX } from "../skills/misc/HexweaverRuntime";
import { GOURMAND } from "../skills/misc/GourmandRuntime";
import { FAULTLINE } from "../skills/misc/FaultlineRuntime";
import { PHAROS } from "../skills/misc/PharosRuntime";
/** Each battery fires its own round: gavel bolts, needles, dishes, ember rocks and flares. */
const BATTERY_LOOK: Record<string, GunLook> = { judge: "gavel", hexweaver: "needle", gourmand: "dish", faultline: "magma", pharos: "lamp" };
/** Each hull's paint under its bespoke model. */
const HULL: Record<string, number> = { judge: 0x343642, hexweaver: 0x241b30, gourmand: 0x382b27, faultline: 0x292f31, pharos: 0x1f2c3c };
/** Each battery's AP and HE damage per round, its reload in seconds and its muzzle velocity. */
const BATTERY: Record<string, { ap: number; he: number; reload: number; velocity?: number }> = {
  judge: { ap: 34000, he: 20000, reload: 7 },
  hexweaver: { ap: HEX.battery.damage, he: HEX.battery.he, reload: HEX.battery.reload, velocity: HEX.battery.velocity },
  gourmand: { ap: GOURMAND.battery.damage, he: GOURMAND.battery.he, reload: GOURMAND.battery.reload, velocity: GOURMAND.battery.velocity },
  faultline: { ap: FAULTLINE.battery.damage, he: FAULTLINE.battery.he, reload: FAULTLINE.battery.reload },
  pharos: { ap: PHAROS.battery.damage, he: PHAROS.battery.he, reload: PHAROS.battery.reload },
};
function titan(
  id: string,
  name: string,
  nation: Nation,
  hp: number,
  length: number,
  beam: number,
  draft: number,
  freeboard: number,
  accent: number,
  defs: SkillDef[],
  description: string,
  specialty: string,
): ShipSpec {
  return {
    id,
    name,
    nation,
    cls: "TT",
    year: 2099,
    hp,
    length,
    beam,
    draft,
    freeboard,
    description,
    specialty,
    maxSpeed: 30,
    accelTime: 35,
    turnRadius: 900,
    rudderTime: 11,
    armor: {
      belt: 280,
      deck: 180,
      bow: 70,
      stern: 70,
      superstructure: 70,
      turret: 300,
      citadelInner: 50,
      torpedoProtection: 0.5,
    },
    citadel: { length: 0.5, top: 2, width: 0.65 },
    main: {
      name: name + " battery",
      look: BATTERY_LOOK[id],
      turrets: [
        { x: length * 0.32, y: 0, facing: 0, halfArc: 150, barrels: 3 },
        { x: -length * 0.32, y: 0, facing: 180, halfArc: 150, barrels: 3 },
      ],
      reload: BATTERY[id].reload,
      traverse: 18,
      range: 15000,
      dispersion: 110,
      barrelLength: 20,
      ap: { caliber: 406, mass: 1225, velocity: BATTERY[id].velocity ?? 1050, damage: BATTERY[id].ap, pen: 650 },
      he: {
        caliber: 406,
        mass: 1000,
        velocity: BATTERY[id].velocity ?? 1050,
        damage: BATTERY[id].he,
        pen: 70,
        fireChance: 0.2,
      },
    },
    aa: { range: 4500, dps: 1200 },
    consumables: [TITAN_REPAIR, search(9000)],
    skills: defs.map((d) => d.spec),
    model: {
      palette: {
        hull: HULL[id],
        upper: 0x535864,
        deck: 0x303338,
        accent,
        boot: 0x15151b,
      },
      bow: "straight",
      stern: "transom",
      sheer: 0.3,
      blocks: [{ x: 0, len: length * 0.2, w: beam * 0.55, h: 12 }],
      funnels: [],
      masts: [],
      smokeless: true,
    },
  };
}
export const NEW_MISC: ShipSpec[] = [
  titan(
    "judge",
    "Judge",
    "tribunal",
    1400000,
    400,
    76,
    14,
    16,
    0xffd47b,
    JUDGE_SKILLS,
    "A floating courthouse that writes its own law into the sea. Brass scales balance above an armoured tribunal, while a monumental gavel hangs over the condemned.",
    "Jurisdiction titan. The court enforces six laws at once and every gavel bolt cites its target, so cases build as you fight. Throw the gavel through cited hulls, tax them and hold them in contempt; at 30 violations the Death Penalty takes a whole hull, though shields and defensive skills still apply.",
  ),
  titan(
    "hexweaver",
    "Hexweaver",
    "coven",
    1150000,
    370,
    64,
    13,
    13,
    0xe878bd,
    HEXWEAVER_SKILLS,
    "A needle-prowed shrine carrying an immense suspended effigy. Every stitch binds a living hull to a smaller doll, and every pin makes the curse more personal.",
    "Combo titan. Needle volleys prick bound dolls into free pins, and every pin makes your hits land harder. Pin and twist one doll for focused punishment, or stitch several, set them burning and rip the seams; Effigy Unmaking detonates every doll at once.",
  ),
  titan(
    "gourmand",
    "Gourmand",
    "feast",
    1650000,
    440,
    100,
    16,
    17,
    0xff8844,
    GOURMAND_SKILLS,
    "A banquet furnace with a warship built around its appetite. The bow opens into an armoured mouth, cutlery carves passing hulls and the kitchen cooks whatever the battle provides.",
    "Appetite titan. The galley mortar cooks every salvo from the fullest jar: shells pierce, explosives burn and scrap shreds. Lob the pressure cooker, skewer and chomp, burp off a meal, swallow an enemy whole or blow the whole kitchen.",
  ),
  titan(
    "faultline",
    "Faultline",
    "rift",
    1500000,
    420,
    88,
    16,
    15,
    0xff632f,
    FAULTLINE_SKILLS,
    "An exposed tectonic engine whose pistons reach into the seabed. Split armour plates breathe volcanic light as the machine lifts ridges and tears new fractures through the sea.",
    "Terrain titan. Magma mortars build pressure and open fractures; ride them with Slip, pulse them with Aftershock and raise basalt ridges that erupt as they rise. Brace behind Bedrock to bank pressure, then pour it into the Caldera or break the whole network.",
  ),
  titan(
    "pharos",
    "Pharos",
    "beacon",
    1300000,
    380,
    70,
    14,
    15,
    0xffe9a0,
    PHAROS_SKILLS,
    "A lighthouse that slipped its rock and went to war. A whitewashed tower stands on a breakwater amidships, and the great lens in its lantern turns without rest, sweeping one long beam round the sea.",
    "Lighthouse titan. The lamp's beam sweeps round the hull all battle: ships it crosses are lit and gain Exposure, and islands throw shadows it cannot reach into. Hold the beam on a target, reverse it, lance along it, relay it off lens buoys or shutter it and vanish; Daybreak burns one full turn, and the False Light lures ships onto the rocks.",
  ),
];
