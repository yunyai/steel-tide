import type { BattleEra } from '../../../core/types';
import type { GroundNation, VehicleSpec } from '../types';
import { HISTORIC_VEHICLES } from './historic';
import { GROUND_TITANS } from './titans';

/** Every ground vehicle, line vehicles first. */
export const VEHICLES: VehicleSpec[] = [...HISTORIC_VEHICLES, ...GROUND_TITANS];

export const VEHICLE_BY_ID: Record<string, VehicleSpec> = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));

/** The vehicles of an era (every era's for Mixed). */
export function vehiclesIn(era: BattleEra): VehicleSpec[] {
  return era === 'mixed' ? VEHICLES : VEHICLES.filter((v) => v.era === era);
}

/** Nations as armies: the factions' names are their navies'. Fantasy factions keep their own. */
export const ARMY: Record<GroundNation, { label: string; short: string }> = {
  japan: { label: 'Imperial Japanese Army', short: 'IJA' },
  usa: { label: 'United States Army', short: 'US' },
  germany: { label: 'Wehrmacht', short: 'DE' },
  uk: { label: 'British Army', short: 'UK' },
  ussr: { label: 'Red Army', short: 'USSR' },
  silverwood: { label: 'Silverwood Elves', short: 'Elves' },
  deepforge: { label: 'Deepforge Clans', short: 'Dwarves' },
  drowned: { label: 'Drowned Court', short: 'Undead' },
  conclave: { label: 'Starfall Conclave', short: 'Archmages' },
  us_mod: { label: 'United States Army', short: 'US' },
  ru_mod: { label: 'Russian Ground Forces', short: 'RU' },
  cn_mod: { label: "People's Liberation Army", short: 'PLA' },
  uk_mod: { label: 'British Army', short: 'UK' },
  jp_sf: { label: 'Japan Kage Legion', short: 'Japan' },
  us_sf: { label: 'United States Space Force', short: 'USSF' },
  ru_sf: { label: 'Russian Bastion Legion', short: 'Bastion' },
  cn_sf: { label: 'Chinese Hive Legion', short: 'Hive' },
};
