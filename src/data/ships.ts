import { ARCHITECT } from './architect';
import { AIRCRAFT_HP_BUFF, AIRCRAFT_INTERVAL_MUL, EXTRA_MAIN_BUFF, MAIN_DAMAGE_BUFF, WEAK_SKILL_SHIPS } from './Balance';
import { HP_SCALE, RANGE_SCALE, RELOAD_SCALE } from '../config';
import type { BattleEra, Era, ShipSpec } from '../core/types';
import { ANIME, ANIME_FORMS, ANIME_SUMMONS } from './anime';
import { REPAIR_KIT } from './common';
import { ERAS, FACTIONS, eraOf } from './factions';
import { FANTASY, FANTASY_TITANS } from './fantasy';
import { HISTORIC } from './historic';
import { MISC } from './misc';
import { MODERN, MODERN_TITANS } from './modern';
import { SCIFI, SCIFI_TITANS } from './scifi';
import { SUMMONS } from './summons';
import { TITANS } from './titans';

// Every era's roster, scaled to the battle map (see toBattleScale).

/**
 * Dispersion is metres at max range, so it is left as written: closer fights already make hits
 * easier, and hulls are full size.
 */
const DISPERSION_SCALE = 1;
/** Tighter turning circles suit the smaller sea. */
const TURN_SCALE = 0.75;
/** Arcade handling: the rudder swings and the engines spool up faster than the real ships did. */
const RUDDER_SCALE = 0.5;
const ACCEL_SCALE = 0.6;

const RAW: ShipSpec[] = [...HISTORIC, ...TITANS, ...FANTASY, ...FANTASY_TITANS, ...MODERN, ...MODERN_TITANS, ...SCIFI, ...SCIFI_TITANS, ...ANIME, ...ANIME_FORMS, ...MISC, ...ARCHITECT, ...SUMMONS, ...ANIME_SUMMONS];
const TRAVERSE_MEDIANS = new Map<string, number>();
for (const s of RAW) {
  const key = `${eraOf(s)}:${s.cls}`;
  if (!s.main || s.hidden || s.cls === 'TT' || TRAVERSE_MEDIANS.has(key)) continue;
  const values = RAW.filter(p => p.main && !p.hidden && p.cls === s.cls && eraOf(p) === eraOf(s)).map(p => p.main!.traverse).sort((a, b) => a - b);
  const m = values.length >> 1;
  TRAVERSE_MEDIANS.set(key, values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2);
}

function toBattleScale(s: ShipSpec): ShipSpec {
  const k = RANGE_SCALE;
  const t = FACTIONS[s.nation].trait;
  // Titans are written at their final, already enormous, hit points.
  const hp = (s.cls === 'TT' ? s.hp : Math.round((s.hp * HP_SCALE) / 100) * 100) * (t?.hpMul ?? 1);
  return {
    ...s,
    hp: Math.round(hp / 100) * 100,
    maxSpeed: s.maxSpeed * (t?.speedMul ?? 1),
    turnRadius: s.turnRadius * TURN_SCALE,
    rudderTime: s.rudderTime * RUDDER_SCALE,
    accelTime: s.accelTime * ACCEL_SCALE,
    main: s.main && {
      ...s.main,
      ap: s.main.ap && { ...s.main.ap, damage: s.main.ap.damage * MAIN_DAMAGE_BUFF * (WEAK_SKILL_SHIPS.has(s.id) ? EXTRA_MAIN_BUFF : 1) },
      he: s.main.he && { ...s.main.he, damage: s.main.he.damage * MAIN_DAMAGE_BUFF * (WEAK_SKILL_SHIPS.has(s.id) ? EXTRA_MAIN_BUFF : 1) },
      traverse: Math.max(s.main.traverse, Math.min(s.main.traverse * 1.25, TRAVERSE_MEDIANS.get(`${eraOf(s)}:${s.cls}`) ?? s.main.traverse)),
      range: s.main.range * k * (t?.rangeMul ?? 1),
      reload: s.main.reload * RELOAD_SCALE,
      dispersion: s.main.dispersion * DISPERSION_SCALE * (t?.dispersionMul ?? 1),
    },
    secondaries: s.secondaries?.map((sec) => ({ ...sec, shell: { ...sec.shell, damage: sec.shell.damage * MAIN_DAMAGE_BUFF }, range: sec.range * k, reload: sec.reload * RELOAD_SCALE })),
    torpedoes: s.torpedoes && { ...s.torpedoes, range: s.torpedoes.range * k, detect: s.torpedoes.detect * k, reload: s.torpedoes.reload * RELOAD_SCALE },
    missiles: s.missiles && { ...s.missiles, range: s.missiles.range * k, reload: s.missiles.reload * RELOAD_SCALE },
    air: s.air && {
      ...s.air, range: s.air.range * k, launchCooldown: s.air.launchCooldown * AIRCRAFT_INTERVAL_MUL,
      torpedo: { ...s.air.torpedo, hp: s.air.torpedo.hp * AIRCRAFT_HP_BUFF, restore: s.air.torpedo.restore * AIRCRAFT_INTERVAL_MUL },
      dive: { ...s.air.dive, hp: s.air.dive.hp * AIRCRAFT_HP_BUFF, restore: s.air.dive.restore * AIRCRAFT_INTERVAL_MUL },
      fighter: { ...s.air.fighter, hp: s.air.fighter.hp * AIRCRAFT_HP_BUFF, restore: s.air.fighter.restore * AIRCRAFT_INTERVAL_MUL },
    },
    aa: { ...s.aa, range: s.aa.range * k },
    consumables: s.consumables.map((c) => ({
      ...c,
      power: c.type === 'search' ? c.power! * k : c.power,
    })),
  };
}

/** Every spec, summon-only ones included. */
export const ALL: ShipSpec[] = RAW.map(toBattleScale);

/** Every ship a captain can sail, in every era (summon-only hulls are left out). */
export const SHIPS: ShipSpec[] = ALL.filter((s) => !s.hidden);

/** Every hull by id, summons included. */
export const SHIP_BY_ID: Record<string, ShipSpec> = Object.fromEntries(ALL.map((s) => [s.id, s]));

/** The sailable ships of one era. */
export function shipsOf(era: Era): ShipSpec[] {
  return SHIPS.filter((s) => eraOf(s) === era);
}

/** The sailable ships of a battle's era (every era for Mixed). */
export function shipsIn(era: BattleEra): ShipSpec[] {
  return era === 'mixed' ? SHIPS : shipsOf(era);
}

/** The titans of a battle's era, in roster order. */
export function titansOf(era: BattleEra): ShipSpec[] {
  return shipsIn(era).filter((s) => s.cls === 'TT');
}

/** Boss Rush bosses of a battle's era: its titans, then the Titan Shift forms of its ships (anime has no others). */
export function bossesOf(era: BattleEra): ShipSpec[] {
  return [...titansOf(era), ...ALL.filter((s) => s.formOf && (era === 'mixed' || eraOf(s) === era))];
}

/** Eras with line ships to fill a battle with. Misc holds only a titan, so it sails in Mixed battles alone. */
export const LINE_ERAS: Era[] = ERAS.filter((e) => shipsOf(e).some((s) => s.cls !== 'TT'));

/** Convoy cargo ships: in battles, never in the hangar. */
export const TRANSPORTS: ShipSpec[] = (
  [
    {
      id: 'liberty',
      name: 'Liberty',
      nation: 'usa',
      cls: 'AK',
      year: 1941,
      description: 'Emergency cargo ship of the Battle of the Atlantic: 2,710 built, the fastest welded in under five days.',
      specialty: 'Unarmed but for light AA. Tall, thin-skinned and full of cargo the fleet must get through.',
      hp: 70000,
      length: 135,
      beam: 17,
      draft: 8.5,
      freeboard: 7,
      maxSpeed: 15,
      accelTime: 40,
      turnRadius: 700,
      rudderTime: 7,
      armor: { belt: 10, deck: 10, bow: 10, stern: 10, superstructure: 6, turret: 6, citadelInner: 0, torpedoProtection: 0 },
      citadel: { length: 0, top: 0, width: 0 },
      aa: { range: 2000, dps: 60 },
      consumables: [{ ...REPAIR_KIT, charges: 1 }],
      skills: [],
      model: {
        palette: { hull: 0x5d6266, upper: 0x9aa0a3, deck: 0x7a6a52, accent: 0x2e3032, boot: 0x6b2c2a },
        camo: 'none',
        bow: 'straight',
        stern: 'cruiser',
        sheer: 0.25,
        blocks: [
          { x: 46, len: 10, w: 9, h: 2.5 },
          { x: -6, len: 20, w: 14, h: 7 },
          { x: -50, len: 10, w: 9, h: 2.5 },
        ],
        funnels: [{ x: -10, r: 2.6, h: 8, len: 4 }],
        masts: [
          { x: 30, h: 20 },
          { x: -32, h: 18 },
        ],
      },
    },
  ] satisfies ShipSpec[]
).map(toBattleScale);

export const CLASS_LABEL: Record<ShipSpec['cls'], string> = {
  BB: 'Battleship',
  CB: 'Battlecruiser',
  CA: 'Heavy Cruiser',
  CL: 'Light Cruiser',
  DD: 'Destroyer',
  CV: 'Aircraft Carrier',
  SS: 'Submarine',
  TT: 'Titan',
  AK: 'Transport',
};

export const NATION_LABEL: Record<ShipSpec['nation'], string> = Object.fromEntries(Object.values(FACTIONS).map((f) => [f.id, f.label])) as Record<ShipSpec['nation'], string>;
