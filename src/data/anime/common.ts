import type { ArmorSpec, GunTurretSpec, MainBatterySpec, SecondarySpec, ShellSpec, SquadronSpec } from '../../core/types';

// Shapes every anime series file shares: armour schemes, the gun battery builder, ammo names.
// Each ship's ultimate is a Titan Shift into its form: a hidden titan, at final HP like the other
// titans, that the ship turns into for a short while (see Ship.shiftNow).

export const NO_CITADEL = { length: 0, top: 0, width: 0 };
export const LIGHT: ArmorSpec = { belt: 25, deck: 19, bow: 19, stern: 19, superstructure: 13, turret: 19, citadelInner: 0, torpedoProtection: 0 };
export const SUB: ArmorSpec = { belt: 25, deck: 19, bow: 19, stern: 19, superstructure: 13, turret: 13, citadelInner: 0, torpedoProtection: 0 };
export const SUB_DEPTHS = { periscopeDepth: -11, deepDepth: -55 };
/** Every form is armoured like a titan: shells must find the weak plates or burn it down. */
export const FORM_ARMOR: ArmorSpec = { belt: 400, deck: 180, bow: 50, stern: 50, superstructure: 50, turret: 500, citadelInner: 40, torpedoProtection: 0.45 };
export const FORM_CITADEL = { length: 0.5, top: 1, width: 0.65 };
/** A form that stays under the sea (Law, Muzan): a titan's hull, a submarine's plates. */
export const SUB_FORM_ARMOR: ArmorSpec = { belt: 300, deck: 200, bow: 120, stern: 120, superstructure: 80, turret: 120, citadelInner: 0, torpedoProtection: 0.5 };

export const shell = (caliber: number, mass: number, velocity: number, damage: number, pen: number, fireChance?: number): ShellSpec => ({ caliber, mass, velocity, damage, pen, fireChance });
export const squad = (name: string, planes: number, hangar: number, restore: number, spd: number, hp: number, damage: number): SquadronSpec => ({ name, planes, hangar, restore, speed: spd, hp, damage });

/** A gun battery of `n` houses: `fore` of them forward, the rest aft, superfiring in pairs. */
export function battery(name: string, n: number, fore: number, x: number, barrels: number, o: Omit<MainBatterySpec, 'name' | 'turrets'>): MainBatterySpec {
  const turrets: GunTurretSpec[] = [];
  for (let i = 0; i < n; i++) {
    const aft = i >= fore;
    const k = aft ? i - fore : i;
    const sign = aft ? -1 : 1;
    turrets.push({ x: sign * (x - k * x * 0.24), y: k % 2 ? 4 : 0, facing: aft ? 180 : 0, halfArc: 150, barrels });
  }
  return { name, turrets, ...o };
}

/** A submarine's one deck gun, aft of the tower. */
export function deckGun(name: string, damage: number, look: MainBatterySpec['look'], ammoNames: [string, string]): MainBatterySpec {
  return {
    name,
    turrets: [{ x: -12, y: 0.5, facing: 0, halfArc: 160, barrels: 1 }],
    reload: 3.5,
    traverse: 24,
    range: 4500,
    dispersion: 75,
    barrelLength: 4,
    he: shell(100, 14, 1000, damage, 18, 0.05),
    flat: 2.4,
    look,
    ammoNames,
  };
}

export const pd = (name: string, perSide: number, span: [number, number], damage: number): SecondarySpec => ({ name, perSide, barrels: 1, reload: 3, range: 5500, span, y: 4, shell: shell(100, 14, 1000, damage, 20, 0.04) });

export const KI: [string, string] = ['Ki blast', 'Ki burst'];
export const CURSED: [string, string] = ['Cursed bolt', 'Cursed burst'];
export const CHAKRA: [string, string] = ['Chakra kunai', 'Explosive tags'];
export const HAKI: [string, string] = ['Haki shot', 'Fire shells'];
export const REIATSU: [string, string] = ['Reishi arrow', 'Kidō burst'];
export const STEAM: [string, string] = ['Iron shot', 'Thunder shell'];
export const BREATH: [string, string] = ['Nichirin round', 'Flame round'];
export const QUIRK: [string, string] = ['Smash round', 'Blast round'];
