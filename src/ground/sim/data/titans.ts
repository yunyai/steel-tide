import { GROUND_TITAN_SKILLS } from '../skills/titans';
import { kitOf } from '../skills/types';
import type { VehicleSpec } from '../types';
import { consumablesFor } from './common';

// Titans: one per era, 25× a medium's hit points, six skills and three ultimates.

const S = GROUND_TITAN_SKILLS;

export const GROUND_TITANS: VehicleSpec[] = [
  {
    id: 'ratte',
    name: 'Landkreuzer P.1000 Ratte',
    nation: 'germany',
    era: 'historic',
    cls: 'TT',
    year: 1945,
    description: 'A thousand-tonne land cruiser carrying a battleship turret. It never left the drawing board. Here it did.',
    specialty: 'Crushes the city flat and shells everything it sees.',
    hp: 50000,
    mass: 1000,
    size: { length: 35, width: 14, height: 6, turret: { width: 10, length: 13, height: 4, offset: 6 }, barrel: 16 },
    drive: { type: 'tracks', maxSpeed: 28, reverse: 10, accel: 1.0, turnRate: 10, climbDeg: 25 },
    // Thinner than the paper Ratte, so line guns bite on the flanks and the rear.
    armor: { hull: { front: 200, side: 120, rear: 90, roof: 60, slope: 30 }, turret: { front: 230, side: 150, rear: 120, roof: 80, slope: 20 } },
    gun: {
      name: 'Twin 28 cm SK C/34',
      caliber: 283,
      reload: 10,
      barrels: 2,
      traverse: 8,
      depression: 5,
      elevation: 40,
      dispersion: 0.45,
      aimTime: 3,
      range: 1500,
      ammo: [
        { kind: 'AP', label: 'PzSprGr L/4.4', velocity: 890, damage: 1300, pen: 450 },
        { kind: 'HE', label: 'SprGr L/4.5', velocity: 890, damage: 1100, pen: 90, splash: 14 },
      ],
    },
    consumables: consumablesFor('TT'),
    skills: kitOf(S, 'flakWall', 'crushingTreads', 'barrage128', 'panzerEscort', 'smokeBattery', 'ironRam', 'schwererGustav', 'broadside', 'v2Strike'),
    look: { paint: 0x50565c, trim: 0x2a2c30, camo: 0x7a7458, style: 'ww2', body: 'titan', parts: ['twin', 'flak'] },
  },
];
