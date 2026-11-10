import type { SkillIcon, SkillSpec } from '../../core/types';
import { bearingTo, wrapAngle } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import { enemiesWithin } from '../kit';
import { def, type SkillDef } from '../types';
import {
  beamCatches,
  castBuoy,
  castCounter,
  castDark,
  castDaybreak,
  castDazzle,
  castFalseLight,
  castHold,
  castLance,
  castTwin,
  exposureOf,
  isLit,
  nextPass,
  PHAROS,
  pharosDamage,
} from './PharosRuntime';

// The Pharos's nine skills, Q E Z X C V R T B. Their numbers live in `PHAROS`.

const P = PHAROS;
const k = (v: number) => `${v / 1000}k`;
const km = (v: number) => `${v / 1000} km`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => Math.round((v * 180) / Math.PI);
const range = (s: Ship, t: Ship | null) => (t ? Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : Infinity);
const dark = (s: Ship) => (s.pharos?.darkUntil ?? 0) > s.game.time;
const lit = (s: Ship) => enemiesWithin(s, s.game, P.daybreak.range).filter((t) => isLit(s, t));
const caught = (s: Ship, t: Ship | null) => !!t && beamCatches(s, t.pos.x, t.pos.z, t.spec.length / 4);

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
    id: 'pharosHold',
    name: 'Hold the Light',
    short: 'HOLD',
    cooldown: 9,
    icon: 'eye',
    description: `For ${P.hold.time} s the beam leaves its sweep and follows the reticle. Ships held in it burn for ${k(P.hold.burn)} a second and gain 1 Exposure a second; the sweep then carries on from there.`,
    activate: (s) => castHold(s),
    ai: (s, t) => !dark(s) && !s.pharos?.daybreak && range(s, t) < P.range && !caught(s, t) && (nextPass(s, t!) ?? 9) > 1.5,
  },
  {
    id: 'pharosLance',
    name: 'Lance of Light',
    short: 'LANCE',
    cooldown: 10,
    icon: 'beam',
    description: `Focus the lamp where it points now. After ${P.lance.warning} s a lance runs the length of the beam, ${P.lance.width} m wide: ${k(P.lance.damage)} plus ${k(P.lance.perExposure)} per Exposure, and lit hulls catch fire. Land stops it; a Lens Buoy on the line bursts for the same over ${P.lance.buoy} m.`,
    activate: (s, spec) => castLance(s, spec),
    ai: (s, t) => caught(s, t),
  },
  {
    id: 'pharosCounter',
    name: 'Counter-sweep',
    short: 'COUNTER',
    cooldown: 7,
    icon: 'swap',
    description: `Reverse the sweep. For ${P.counter.time} s it turns ${P.counter.speed}× as fast and scorches each ship it crosses for ${k(P.counter.damage)}, the one it is on included.`,
    activate: (s) => castCounter(s),
    // Worth it when turning back reaches the target sooner than carrying on round.
    ai: (s, t) => {
      const a = s.pharos;
      if (!a || !t || dark(s) || a.daybreak || a.holdUntil > s.game.time || range(s, t) > P.range) return false;
      if (caught(s, t)) return true;
      const behind = wrapAngle(bearingTo(s.pos.x, s.pos.z, t.pos.x, t.pos.z) - a.bearing) * a.dir;
      return behind < 0 && behind > -Math.PI / 2;
    },
  },
  {
    id: 'pharosDazzle',
    name: 'Dazzle',
    short: 'DAZZLE',
    cooldown: 15,
    icon: 'reveal',
    description: `The lamp flares in the eyes of every lit enemy: ${k(P.dazzle.damage)} plus ${k(P.dazzle.perExposure)} per Exposure, and for ${P.dazzle.time} s their guns scatter ${P.dazzle.scatter}× as wide and their aimed skills reach ${pct(1 - P.dazzle.reach)} less far.`,
    activate: (s, spec) => castDazzle(s, spec),
    ai: (s) => lit(s).length > 0,
  },
  {
    id: 'pharosBuoy',
    name: 'Lens Buoy',
    short: 'BUOY',
    cooldown: 11,
    icon: 'mine',
    description: `Drop a lens buoy at the reticle, up to ${km(P.reach)} away (${P.buoy.max} at most, ${P.buoy.life} s). Each time a beam crosses it, it flares over ${P.buoy.radius} m: ${k(P.buoy.damage)}, lit and +1 Exposure, even behind an island.`,
    activate: (s) => castBuoy(s),
    ai: (s, t) => !!t && range(s, t) < P.reach && (s.pharos?.buoys.length ?? 0) < P.buoy.max && !s.pharos!.buoys.some((b) => Math.hypot(b.x - t.pos.x, b.z - t.pos.z) < P.buoy.radius),
  },
  {
    id: 'pharosDark',
    name: 'Dark Lamp',
    short: 'DARK',
    cooldown: 22,
    icon: 'cloak',
    description: `Shutter the lamp for ${P.dark.time} s: no beam, but you are cloaked and take ${pct(P.dark.reduction)} less damage. The shutters reopen with a flare over ${km(P.dark.radius)} (${k(P.dark.damage)}, lit, +${P.dark.exposure} Exposure) and the beam runs ${P.dark.widen}× as wide for ${P.dark.wide} s.`,
    activate: (s) => castDark(s),
    ai: (s) => !s.pharos?.daybreak && (s.hp / s.maxHp < 0.6 || s.lastHurt > s.game.time - 1) && enemiesWithin(s, s.game, P.range).length > 0,
  },
  {
    id: 'pharosTwin',
    name: 'Twin Lamps',
    short: 'TWIN',
    cooldown: 100,
    icon: 'radar',
    description: `For ${P.twin.time} s a second beam shines opposite the first and both sweep ${P.twin.speed}× as fast. Lance of Light, Counter-sweep and Daybreak use both.`,
    activate: (s) => castTwin(s),
    ai: (s) => enemiesWithin(s, s.game, P.range).length > 0,
  },
  {
    id: 'pharosDaybreak',
    name: 'Daybreak',
    short: 'DAYBREAK',
    cooldown: 110,
    icon: 'nuke',
    description: `After a ${P.daybreak.warning} s wind-up the lamp burns white for one full turn in ${P.daybreak.time} s, ${deg(P.halfWidth * 2 * P.daybreak.widen)}° wide and ${km(P.daybreak.range)} long. Each ship it crosses takes ${k(P.daybreak.damage)} plus ${k(P.daybreak.perExposure)} per Exposure (${k(pharosDamage.daybreak(P.maxExposure))} at full) once and is set alight; buoys it crosses flare double. Land still shadows it.`,
    activate: (s) => castDaybreak(s),
    ai: (s, t) => !dark(s) && range(s, t) < P.daybreak.range && (enemiesWithin(s, s.game, P.daybreak.range).length > 1 || exposureOf(s, t!) >= 3),
  },
  {
    id: 'pharosFalseLight',
    name: 'False Light',
    short: 'FALSE LIGHT',
    cooldown: 130,
    icon: 'fear',
    description: `Raise a wreckers' beacon at the reticle, up to ${km(P.reach)} away. For ${P.falseLight.time} s enemies within ${km(P.falseLight.lure)} of it are lit and steer for it whatever their captains order (titans for less), then it bursts over ${P.falseLight.radius} m for ${k(P.falseLight.damage)} plus ${k(P.falseLight.perExposure)} per Exposure.`,
    activate: (s, spec) => castFalseLight(s, spec),
    ai: (s, t) => range(s, t) < P.reach && (enemiesWithin(s, s.game, P.reach).length > 1 || exposureOf(s, t!) >= 2),
  },
];

export const PHAROS_SKILLS: SkillDef[] = SKILLS.map((sk, i) =>
  def(
    {
      id: sk.id,
      name: sk.name,
      short: sk.short,
      description: sk.description,
      cooldown: sk.cooldown,
      duration: 0,
      icon: sk.icon,
      accent: P.accent,
      ult: i >= 6,
    },
    {
      activate: (s, _g, st) => sk.activate(s, st.spec),
      aiShouldUse: (s, _g, t) => sk.ai(s, t),
    },
  ),
);
