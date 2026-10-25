import type { ShipSpec } from '../core/types';
import { HADAL_SKILLS } from '../skills/misc/hadal';
import { kitOf } from '../skills/types';
import { TITAN_REPAIR, search } from './common';

// Misc: hulls that belong to no fleet and no age. For now, one titan from the trenches.
// Titan HP is final; ranges and reloads are scaled like every other ship.

export const MISC: ShipSpec[] = [
  {
    id: 'hadal',
    name: 'Hadal',
    nation: 'abyss',
    cls: 'TT',
    year: 2049,
    description: 'Something the sonar operators stopped reporting: a 420 m carrier-submarine that rises from the trenches, looses drone wings from its launch tubes and sinks again before anyone can answer.',
    specialty: 'Titan submarine. 1.5M HP, no guns: drone wings from periscope depth, homing swarms from the deep, a pressure pulse, and a maw that drags line ships under whole.',
    hp: 1500000,
    length: 420,
    beam: 46,
    draft: 16,
    freeboard: 6,
    maxSpeed: 26,
    accelTime: 36,
    turnRadius: 900,
    rudderTime: 11,
    armor: { belt: 300, deck: 200, bow: 120, stern: 120, superstructure: 80, turret: 120, citadelInner: 0, torpedoProtection: 0.5 },
    citadel: { length: 0, top: 0, width: 0 },
    torpedoes: {
      name: 'Abyssal torpedoes',
      launchers: [
        { x: 150, side: 2, tubes: 8 },
        { x: -150, side: -2, tubes: 4 },
      ],
      tubes: 8,
      reload: 32,
      speed: 64,
      range: 8000,
      damage: 20000,
      floodChance: 0.4,
      spread: 6,
      detect: 1000,
      look: 'eel',
    },
    air: {
      torpedo: { name: 'Lancer drones', planes: 6, hangar: 30, restore: 14, speed: 170, hp: 1800, damage: 9000 },
      dive: { name: 'Gulper drones', planes: 6, hangar: 30, restore: 14, speed: 180, hp: 1700, damage: 7000 },
      fighter: { name: 'Ray drones', planes: 8, hangar: 16, restore: 18, speed: 220, hp: 1500, damage: 150 },
      launchCooldown: 14,
      range: 15000,
      look: 'drone',
    },
    aa: { range: 4500, dps: 1500 },
    consumables: [TITAN_REPAIR, search(9000)],
    skills: kitOf(HADAL_SKILLS, 'hkSwarm', 'pressurePulse', 'abyssalVeil', 'droneWing', 'breach', 'sonarLattice', 'hadalTrench', 'swarmMother', 'abyssalMaw'),
    sub: { battery: 160, periscopeDepth: -14, deepDepth: -60, diveRate: 6 },
    model: {
      palette: { hull: 0x14262c, upper: 0x1c343c, deck: 0x14262c, accent: 0x5fe0d0, boot: 0x0a1418 },
      bow: 'clipper',
      stern: 'cruiser',
      blocks: [],
      funnels: [],
      masts: [],
      conningTower: { x: 40, len: 46, h: 12 },
      lightStrip: 0x5fe0d0,
    },
  },
];
